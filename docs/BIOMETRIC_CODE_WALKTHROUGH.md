# HRMS Biometric — Code Walkthrough

> A guided tour of the biometric code: which file owns what, how a request flows through them, and which file to open for a given symptom.
> Companion docs: [Functional](BIOMETRIC_FUNCTIONAL_DOCUMENTATION.md) · [Technical](BIOMETRIC_TECHNICAL_DOCUMENTATION.md) · [API](BIOMETRIC_API_DOCUMENTATION.md)
> Audience: engineers and QA who need to find the code behind a behaviour.
>
> _Last updated: 2026-09-04._

---

## 1. The file map

```
app/
├─ Http/Controllers/Api/
│  ├─ AttendanceController.php      1888 lines  face punch, HR views, import endpoint
│  ├─ FaceBiometricController.php    303        enrol / status / revoke
│  ├─ EsslDeviceController.php       169        public /iclock receiver (Mode C)
│  ├─ DeviceTerminalController.php   137        terminal registry CRUD
│  └─ AuthController.php             (partial)  faceLogin() + isDegenerateDescriptor()
├─ Services/
│  ├─ AttendancePunchService.php     173        THE single writer — day, direction, append, recompute
│  └─ EsslAttendanceImporter.php     302        THE normaliser — map, convert, alternate, dedupe
├─ Models/
│  ├─ Attendance.php                 346        daily row + total_worked_seconds / next_direction accessors
│  ├─ AttendancePunch.php             42        one row per tap
│  ├─ DeviceTerminal.php              49        registry + permitsIp()
│  └─ Employee.php                   (partial)  face_* columns, $hidden descriptor, face_registered accessor
routes/
├─ api.php          face + attendance + device-terminals (Sanctum)
└─ web.php          public /iclock/* — ABOVE the SPA catch-all
bootstrap/app.php   CSRF exemption for iclock/*
resources/js/
├─ components/FaceCapture.tsx            273   webcam tile → 128-d descriptor
├─ components/FaceRegistrationModal.tsx  488   consent → capture → save
├─ components/FaceLoginModal.tsx         216   email + face → /login/face
├─ pages/ClockIn.tsx                     727   the employee clock-in screen
├─ pages/hrms/HrAttendance.tsx          1775   the HR sheet (BIOMETRIC badge lives here)
└─ pages/hrms/HrBiometricDevices.tsx     608   terminal CRUD + Import Punches modal
tools/essl-connector/                          on-prem Python poller (Mode B)
```

**Two files carry the weight.** If you only read two, read `AttendancePunchService` (every punch is written through it) and `EsslAttendanceImporter` (every device row is normalised through it).

---

## 2. Request flow — face clock-in

`ClockIn.tsx` → `POST /api/attendance/face/clock-in` → `AttendanceController::faceClockIn()` → `facePunch($request, expected: 'in')`

Inside `facePunch()` ([AttendanceController.php:1750](../app/Http/Controllers/Api/AttendanceController.php#L1750)) the order is deliberate — cheap rejections first, the transaction last:

| Step | What | Failure |
|---|---|---|
| 1 | Validate: 128 numerics bounded ±5, optional label ≤ 50, lat/lng ranges | 422 |
| 2 | `callerEmployee()` — `Employee::where('user_id', …)` | 401 / 404 |
| 3 | `$employee->isDisabled()` | 422 `inactive` |
| 4 | Today vs `date_of_joining` | 422 `before_joining` |
| 5 | Face on file? | 422 `need_enroll` |
| 6 | `euclideanDistance()` vs `MATCH_THRESHOLD` (0.55) | 422 `matched: false` + distance |
| 7 | **`DB::transaction`** opens | |
| 8 | `findOrCreateDay()` — locks the day row | |
| 9 | `nextDirection()` vs the endpoint called | 422 with `next_direction` |
| 10 | `appendPunch()` with `method: 'face'` + distance + IP + lat/lng | |
| 11 | The service recomputes the day and the summary | |

The client's chosen direction is never trusted — step 9 is the whole alternation guard for the real-time path.

## 3. Request flow — device push (Mode C)

Terminal → `POST /iclock/cdata?SN=…&table=ATTLOG` → `EsslDeviceController::cdata()`

```
log the hit (SN, matched?, table, ip, bytes)
   ↓
DeviceTerminal::where('serial', $sn)->first()
   ↓  not found / !is_active  → log warning, reply "OK", INGEST NOTHING
   ↓  !permitsIp($request->ip()) → log warning, reply "OK", INGEST NOTHING
   ↓
stamp last_seen_at
   ↓  table !== 'ATTLOG'  → reply "OK" (OPERLOG / ATTPHOTO not consumed)
   ↓
parseAttlog($body)                      ← tab-split, header-skip, 5000-row cap
   ↓
$importer->importForTerminal($terminal, $rows)   ← tenant comes from the TERMINAL
   ↓
log "[eSSL] ATTLOG ingested"  →  reply "OK: <rows received>"
```

**Every branch replies 200 `OK`.** That is intentional (a non-OK makes the device loop and re-buffer) and it is the single biggest gotcha when debugging: the device looks happy whether or not anything was stored. `storage/logs/laravel.log` is the truth.

A GET on the same path is the handshake and returns `optionsBlock()` — note it deliberately omits `TimeZone` so the device keeps its own clock.

## 4. Request flow — file / connector import (Modes A and B)

`HrBiometricDevices.tsx` (or the Python connector) → `POST /api/attendance/import` → `AttendanceController::import()` ([:120](../app/Http/Controllers/Api/AttendanceController.php#L120))

```
authz: super_admin or client_admin only            → 403 otherwise
validate: file ≤5MB | punches[] | device_terminal_id | branch_id | timezone
resolve client_id from the CALLER                  → 422 if none
if device_terminal_id → findOrFail scoped to the client, inherit branch/serial/timezone
   else serial = 'CSV-IMPORT', tz = payload or Asia/Kolkata
rows = parseUploadedPunches(file)  OR  the inline punches[] array
if rows empty                                      → 422
$importer->importRows($rows, $clientId, $branchId, $serial, $tz)
return the summary
```

`parseUploadedPunches()` splits on TAB when present, else on comma, and skips any line whose second column lacks both a digit and one of `- : /` — that is the header-row heuristic. `EsslDeviceController::parseAttlog()` mirrors it for the push path.

## 5. Inside the normaliser — `EsslAttendanceImporter::importRows()`

This is the most important 200 lines in the subsystem. In order:

| Phase | What it does | Why it is written that way |
|---|---|---|
| **Clean** | Drop rows with an empty `user_id` or timestamp | |
| **Fail closed** | If `$clientId` is null, log and return an empty summary | An unscoped `attendance_number` lookup could attach a punch to another tenant's employee. Refusing beats guessing |
| **Map** | Look up employees by `attendance_number` within the client, keyed on a **normalised** id | Devices pad ids (`001` vs `1`). Only *numeric* ids are normalised — stripping characters from an alphanumeric badge could collide two real employees |
| **Eligibility** | Reject Terminated / Resigned / `attendance_tracking === false` | A reused device number must not land on someone who left |
| **Strict parse** | `createFromFormat('Y-m-d H:i:s' \| 'Y-m-d H:i', …, $tz)` **and round-trip the result back to a string** | `Carbon::parse()` rolls `25:00:00` into 01:00 the next day, silently landing a punch on the wrong date. Even `createFromFormat` overflows unless the round-trip is checked |
| **Joining guard** | Local date < `date_of_joining` → error row | |
| **Payroll lock** | `periodIsLocked()` → error row (PAY-50) | A locked cycle's payslips are immutable; accepting the punch would change the basis of money already paid |
| **Bucket** | Group by `(employee, local date)`, convert each to UTC | |
| **Write** | Per bucket, in a transaction: `findOrCreateDay(lock)`, then per punch check `AttendancePunch::withTrashed()->where(employee_id, punched_at)->exists()` → count as duplicate, else insert with `method='device'` + provenance | `withTrashed()` so a deliberately deleted correction is not resurrected by a re-push. A `QueryException` from the unique index is also counted as a duplicate, not surfaced |
| **Re-derive** | `recomputeDay($day)` once per bucket | Fixes any out-of-order alternation in one pass |
| **Payroll** | `recomputeEmployeePayslips()` for every affected employee | A correction has to reach the money; the service skips approved / paid / locked runs |

`periodIsLocked()` is worth reading closely: a **client-wide** cycle (`branch_id IS NULL`) blocks the punch just as the employee's own branch's cycle would, but a **branch-less** employee is covered *only* by that client-wide cycle — so another branch's closed payroll cannot block them.

## 6. Inside the single writer — `AttendancePunchService`

Four public methods, each solving one problem:

| Method | Problem it solves |
|---|---|
| `findOrCreateDay($employee, $date, $lock)` | Gets today's row. Handles **two** edge cases that used to 500: a soft-deleted row still occupies the `(employee, date)` unique slot (the index is not partial) → restore and reuse; and the **first** punch of a day cannot be serialised by `lockForUpdate` because there is nothing to lock → catch the unique violation and re-resolve |
| `nextDirection($attendance)` | Server truth for the real-time 422 guard — no punches means `in`, else the opposite of the last |
| `appendPunch($attendance, $employee, $attrs)` | Insert, then `recomputeDay()` |
| `recomputeDay($attendance)` | **The invariant.** Re-reads the day in `punched_at, id` order and rewrites direction and label by index parity (even = in, odd = out), then recomputes the summary |
| `recomputeSummary($attendance, $punches?)` | Rewrites the cached `check_in_*` / `check_out_*`. `check_out_at` stays **null** while the last punch is an open `in` — the employee is still clocked in |

`AttendanceController::recomputeSummary()` is now just a delegating shim, kept so older call sites still work.

## 7. Inside enrolment — `FaceBiometricController::register()`

The interesting part is the **duplicate guard**, and specifically why it is inside a transaction:

```php
DB::transaction(function () use ($employee, $captured) {
    Employee::where('client_id', $employee->client_id)
        ->whereNotNull('face_descriptor')
        ->lockForUpdate()->get(['id']);          // serialise enrolments in the tenant

    $conflict = $this->findDuplicateOwner($employee, $captured);
    if ($conflict !== null) throw ValidationException::withMessages([...]);

    $employee->update([... 'face_consent_given_at' => $employee->face_consent_given_at ?: now() ...]);
});
```

Checked *outside* a transaction, two simultaneous enrolments of the same face both scanned before either wrote, both saw no conflict, and the face ended up on two employees — exactly what the guard exists to prevent. Enrolment is a rare, human-paced action, so the lock costs nothing.

`findDuplicateOwner()` uses `withTrashed()` deliberately: a disabled employee keeps their face on file, so it must still block someone else registering the same face.

`resolveTarget()` is the access gate. Self-enrolment returns early (so the Clock-In flow is untouched); acting on **someone else** additionally calls `assertMayEditEmployees()`, which requires `can_edit` on `hr.employee` — before that check existed, a view-only branch user could re-enrol anyone's face.

`revoke()` does more than null the descriptor: it also nulls every historical `match_distance` on the employee's punches and attendance rows (A26), because consent covers biometric-derived data, not just the live signature.

## 8. Inside `AuthController::faceLogin()`

```
validate (128 floats ±5, optional client_id)  →  isDegenerateDescriptor() → 422
brute-force lock check on 'login_attempts:<lowercased email>'
fetch ALL users with that email (email is per-tenant, not global)
for each: find its Employee, skip if no face, compute distance, keep if ≤ 0.50
sort matches by distance
prefer ACTIVE accounts  ─────────────────► else keep inactive ones so the honest
                                            "account not active" message fires
if >1 distinct organisation and no client_id → 409 needs_org_selection
else take the closest, apply the normal account/org/branch gates, issue a token
```

Two subtleties encoded as comments in the file: taking the numerically closest match *before* checking status used to lock an employee out of their active account whenever a disabled look-alike was a hair closer; and with one face enrolled in two tenants the winner used to be decided by capture noise, so the tenant changed between attempts — hence the org prompt.

## 9. Frontend flow

| File | Role |
|---|---|
| `FaceCapture.tsx` | `import('face-api.js')` cached in a module-level promise; loads `tinyFaceDetector`, `faceLandmark68Net`, `faceRecognitionNet` from `import.meta.env.VITE_FACE_MODEL_URL \|\| '/face-models'`. On Capture: `TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })` → landmarks → descriptor. Requires **exactly one** face; zero or many is rejected client-side with a specific message |
| `FaceRegistrationModal.tsx` | Step 1 consent disclosure, step 2 capture, then `POST /face/register` with `consent: true` |
| `FaceLoginModal.tsx` | Email + capture → `POST /login/face`, and renders the org picker on a 409 |
| `ClockIn.tsx` | `GET /attendance/today` on mount, renders the single button from `next_direction`, posts to the matching endpoint, runs the worked-today timer against `auto_cutoff_at` so it stops exactly where the server stops counting |
| `HrBiometricDevices.tsx` | `GET/POST/PUT/DELETE /device-terminals` plus the Import Punches modal (`POST /attendance/import` as `FormData`), rendering the full summary including unmatched ids |
| `HrAttendance.tsx` | The HR sheet; the **BIOMETRIC** source pill is rendered here |

## 10. Patterns you will see in this code

**10.1 One writer, three front doors.** Face punch, file import and device push all end at `AttendancePunchService`. When adding a fourth ingest path, call the service — do not re-implement day resolution or alternation.

**10.2 Reject in real time, re-derive in bulk.** The interactive path 422s on a wrong direction; the bulk path cannot (imports legitimately arrive out of order), so it re-derives the whole day instead. Both end at the same invariant.

**10.3 Fail closed on tenancy.** Where the tenant cannot be resolved, the code refuses rather than running an unscoped query — see the `$clientId === null` guard in the importer and the `abort_if(!$clientId)` in `import()`.

**10.4 Ack, but do not ingest.** The public device path answers `OK` on every refusal so the terminal does not loop, and logs a warning instead. Never read a device `OK` as proof of ingestion.

**10.5 Report, never drop.** Every import row lands in exactly one of `imported`, `skipped_duplicates`, `unmatched_user_ids` or `errors` — an unmatched User ID is HR's to-do list, not an error to swallow.

**10.6 Long comments carry the *why*.** Several blocks in these files are longer than the code they describe (`periodIsLocked`, `findOrCreateDay`, the strict-parse loop, the active-match preference). They exist because each encodes a bug that was already shipped once. Read them before "simplifying".

---

## 11. Symptom → file

| Symptom / question | Start here |
|---|---|
| "Face clock-in rejected — wrong direction" | `AttendancePunchService::nextDirection()` + step 9 of `facePunch()` |
| "Face didn't match" | `AttendanceController::MATCH_THRESHOLD` (0.55) — the response carries the actual distance |
| "Face login fails but clock-in works" | Login uses **0.50**, in `AuthController::faceLogin()` |
| "Login asks me to pick an organisation" | The org-selection block in `faceLogin()` — the email exists in several tenants |
| "This face is already registered for …" | `FaceBiometricController::findDuplicateOwner()` (0.50, includes soft-deleted) |
| "You do not have access to this employee" (enrolment) | `resolveTarget()` + `assertMayEditEmployees()` — needs `can_edit` on `hr.employee` |
| "Device punches never arrive" | `storage/logs/laravel.log` → `[eSSL] hit cdata`. No line at all = the device is not reaching us; "unregistered/inactive" = register or activate the serial; "disallowed IP" = the `allowed_ips` list |
| "Import reported unmatched user ids" | The mapping block in `importRows()` — `attendance_number` mismatch (leading zeros are already handled) |
| "Import says payroll is locked" | `EsslAttendanceImporter::periodIsLocked()` — by design (PAY-50) |
| "Punch time is 5½ hours out" | The terminal's `timezone` column, or the device clock. Conversion happens in the strict-parse block |
| "Duplicate punches after re-upload" | The idempotency check in `importRows()` + the `(employee_id, punched_at)` unique index |
| "Check-out is empty although they punched out" | `recomputeSummary()` — the day probably ends on an open `in` |
| "Day shows Holiday but there are punches" | `resolveDayStatus()` → `workedARestDay()` |
| "Late mark looks wrong" | `resolveDayStatus()` — 10-minute grace, computed in IST against the resolved shift start |
| "Branch user sees another branch" | The `isBranchPinned()` block in `index()` / `dailyView()` |
| "500 on a punch after deleting attendance" | `findOrCreateDay()` — the soft-deleted-row restore path |
| "Models never load / camera blocked" | `FaceCapture.tsx` model URL, `public/face-models/`, and the HTTPS requirement |
| "The Biometric Devices menu is missing" | It rides on the `hr.attendance` permission (`constants.ts`, `routeAccess.ts`, `LayoutMenuData.tsx`) |

---

## 12. How to extend it

**Adding a new ingest source** (a different device brand, a partner API):

1. Parse the vendor format into `[['user_id' => …, 'punched_at' => 'Y-m-d H:i:s', 'status' => …], …]`.
2. Call `EsslAttendanceImporter::importRows($rows, $clientId, $branchId, $serial, $tz)` — you inherit mapping, timezone conversion, alternation, idempotency, the joining and payroll-lock guards, and payslip recomputation.
3. Do **not** write `attendance_punches` directly, and do not derive direction yourself.
4. If the source is public (device-initiated), add a registry row type and derive the tenant from it — never from the payload.

**Changing a threshold:** there are three (`AttendanceController::MATCH_THRESHOLD`, the local `$threshold` in `faceLogin()`, `FaceBiometricController::DUPLICATE_THRESHOLD`). They are intentionally separate — do not collapse them into one constant.

**Adding a punch label:** `AttendanceController::KNOWN_LABELS` is currently `['Check In', 'Check Out']`. The column accepts any `varchar(50)`, but `recomputeDay()` rewrites labels by parity, so a richer label set needs that method taught about it first.
