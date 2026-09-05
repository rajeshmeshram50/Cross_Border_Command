# HRMS Biometric — Technical Documentation

> How the biometric subsystem is built: stack, architecture, matching maths, data model, invariants, concurrency, security and deployment.
> Companion docs: [Functional](BIOMETRIC_FUNCTIONAL_DOCUMENTATION.md) · [API](BIOMETRIC_API_DOCUMENTATION.md) · [Code Walkthrough](BIOMETRIC_CODE_WALKTHROUGH.md)
> Audience: engineers.
>
> _Last updated: 2026-09-04._

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Face detection + recognition | **face-api.js 0.22.2** (TensorFlow.js) | The only npm dependency the whole face feature added. Runs 100 % in the browser — no cloud call, no per-match cost |
| Model set | TinyFaceDetector + FaceLandmark68 + FaceRecognition | 7 weight files, ~6.8 MB, **self-hosted** in `public/face-models/` |
| Descriptor | 128-float embedding | Compared by Euclidean distance |
| Camera | `navigator.mediaDevices.getUserMedia` | Requires a **secure context** — HTTPS or localhost |
| Matching | **Server-side**, PHP | The threshold lives on the server so a patched client cannot force a match |
| Storage | Postgres `json` column `employees.face_descriptor` | ~1.5 KB per employee. No index — the comparison target is always a known row |
| Device protocol | eSSL / ZKTeco **ADMS ("iclock")**, plain-text HTTP | Plus TCP 4370 pull for the on-prem connector |
| On-prem connector | Python + `pyzk` | `tools/essl-connector/`, runs under Task Scheduler / NSSM |
| Backend | Laravel + Sanctum + Postgres | No new backend dependency for either channel |

> **Correction to `CLAUDE.md`:** it states a 0.55 threshold everywhere. The real values are **0.55 attendance / 0.50 login / 0.50 duplicate-detection**, and the punch label set was reduced from seven labels to **Check In / Check Out**.

---

## 2. Architecture

```
 ┌───────────────────────────────┐        ┌──────────────────────────────┐
 │ Browser (React SPA)           │        │ eSSL terminal (on the wall)  │
 │  FaceCapture → 128-d vector   │        │  matches the finger itself   │
 └───────────────┬───────────────┘        └───────┬──────────────┬───────┘
                 │ Bearer token                   │ Mode C push  │ Mode B poll
                 │                                │ (no auth)    │ (TCP 4370)
                 ▼                                ▼              ▼
   /api/attendance/face/clock-in        /iclock/cdata     office connector
   /api/face/register                   (routes/web.php)  (Python, on-prem)
   /api/login/face                              │                │
                 │                              │                │ Bearer token
                 ▼                              ▼                ▼
        AttendanceController          EsslDeviceController   /api/attendance/import
        FaceBiometricController                 │                │
        AuthController::faceLogin               └───────┬────────┘
                 │                                      ▼
                 │                         EsslAttendanceImporter   (the normaliser)
                 │                                      │
                 └──────────────┬───────────────────────┘
                                ▼
                    AttendancePunchService     ← the single writer
                                │
                 attendance_punches → attendances
                                │
                        HR daily view → PayrollService
```

Three front doors, **one writer**. Every path that creates a punch goes through `AttendancePunchService`, which is why the face timeline and the device timeline can never diverge in their rules.

---

## 3. The face-matching maths

A face-api.js descriptor is a 128-dimensional embedding whose magnitude sits around 1. Two captures are compared by plain Euclidean distance:

```
d = sqrt( Σ (a[i] − b[i])² )      for i = 0…127
```

| Purpose | Threshold | Where | Why this value |
|---|---|---|---|
| Attendance punch | **0.55** | `AttendanceController::MATCH_THRESHOLD` | Slightly tighter than face-api's 0.6 default |
| Face login | **0.50** | `AuthController::faceLogin()` | Authentication — a false match hands over a session |
| Duplicate-face detection at enrolment | **0.50** | `FaceBiometricController::DUPLICATE_THRESHOLD` | For de-dup we would rather flag a borderline case than let a real duplicate through |

Observed distances: identical capture ≈ 0, same person under different light 0.2–0.4, same person under very different conditions up to ≈ 0.5, a different person > 0.6. Legitimate production clock-ins sit at 0.30–0.45.

### 3.1 Input hardening

Every path that accepts a descriptor applies the same three checks before any arithmetic:

1. **Shape** — exactly 128 elements.
2. **Bounds** — each element numeric and within ±5. Without this, a caller could post huge or infinite values and skew the distance sum.
3. **Degeneracy** — `AuthController::isDegenerateDescriptor()` rejects non-finite values and any vector whose magnitude is below **0.1**. An all-zero vector sits an equal small distance from *every* enrolled face, which makes it both useless as a credential and dangerous as a probe.

The helper is `public static` precisely so login, enrolment and punching share one definition of "not a usable capture".

### 3.2 Cost

Enrolment scans every other enrolled employee in the tenant — N distance computations of 128 dimensions each. Negligible into the low thousands of employees. Past roughly 10 000 enrolled faces, swap the scan for a vector index (pgvector).

---

## 4. The punch invariant, and how it is enforced

The rule is: **within one day, punches alternate `in → out → in → out`.** Two mechanisms enforce it, and they are deliberately different.

### 4.1 Real-time face path — reject

`AttendancePunchService::nextDirection()` reads the last punch of the day and returns its opposite. `facePunch()` compares that against the endpoint the client called and returns **422** on a mismatch. The client's opinion of the direction is never used; a double-tap on the SPA cannot produce two check-ins.

### 4.2 Import path — re-derive

A bulk import can legitimately deliver punches **out of chronological order** (a backfill landing before existing punches). Rejecting there would be wrong. So the importer inserts with a placeholder direction, then calls `AttendancePunchService::recomputeDay()`, which re-reads the whole day in time order and rewrites every punch's direction and label by index parity — **even index = in, odd = out** — before recomputing the summary.

That is why the device's own status codes (0 = Check-In, 1 = Check-Out, …) are **ignored for direction**. Operators forget the function keys, so the codes are unreliable; the raw value is kept in `attendance_punches.raw_status` for audit only.

### 4.3 Summary recomputation

`recomputeSummary()` rewrites the parent row's cached columns from the re-derived punches:

- `check_in_at` = the first `in` punch (with its method, distance, IP, lat/lng).
- `check_out_at` = the last `out` punch — **but only when the day is closed**. While the final punch is an open `in`, the employee is still clocked in, so `check_out_at` stays `null`.

---

## 5. Data model

### 5.1 `employees` — biometric columns

| Column | Type | Notes |
|---|---|---|
| `face_descriptor` | json | The 128 floats. In `$hidden` — it never serialises onto an API response |
| `face_registered_at` | timestamp | When the current enrolment was captured |
| `face_consent_given_at` | timestamp | Stamped **once**; survives re-enrolment and revoke |
| `face_consent_revoked_at` | timestamp | Stamped on revoke |
| `biometric_status` | string | `Registered` / `Not Registered` — drives the existing HR view |
| `attendance_number` | string | The device mapping key. Digits-only, unique per tenant |
| `time_tracking` | string | `Manual` / `Biometric` — marks who is device-tracked |

The model appends a boolean `face_registered` accessor, which is what the API exposes.

### 5.2 `attendances` — daily summary

One row per `(employee_id, attendance_date)`, protected by a **unique index**. Holds `client_id`, `branch_id`, `user_id`, the cached `check_in_*` / `check_out_*` (time, method, match distance, IP, lat, lng), `status`, `notes`, soft deletes.

### 5.3 `attendance_punches` — the intraday ledger

One row per tap: `attendance_id`, `employee_id`, `punched_at`, `direction` (`in`/`out`), `label`, `method`, `match_distance`, `ip`, `lat`, `lng`, `notes`, soft deletes, plus the device provenance trio:

| Column | Purpose |
|---|---|
| `device_serial` | Which physical terminal produced it (indexed) |
| `device_user_id` | The **raw** ID the device sent — retained so a dispute is reconstructable even if the employee's Attendance Number later changes |
| `raw_status` | The device status code exactly as received, before normalisation |

### 5.4 Migrations

| Migration | What |
|---|---|
| `2026_05_12_042448_add_face_biometric_to_employees` | The four face columns |
| `2026_05_12_042451_create_attendances_table` | Daily summary |
| `2026_05_12_060843_create_attendance_punches_table` | Punch ledger |
| `2026_05_12_064252_backfill_attendance_punches` | Synthesises Check In/Out punches for rows predating multi-punch |
| `2026_07_27_000001_add_device_method_to_attendance` | Widens the `method` CHECK constraint to include `device` on three columns, and adds the provenance trio |
| `2026_07_27_000002_unique_attendance_number_per_client` | Per-tenant unique index — **⏳ pending**, blocked by one duplicate |
| `2026_07_27_000003_create_device_terminals_table` | The terminal registry |
| `2026_07_27_000004_add_allowed_ips_to_device_terminals` | Mode C IP allow-list |
| `2026_07_28_000001_unique_attendance_punch_per_instant` | Unique `(employee_id, punched_at)` — the idempotency backstop |

> **Postgres note.** Laravel's `enum()` compiles to a CHECK constraint, so widening `method` means dropping and re-adding `<table>_<column>_check`. The `down()` coerces existing `device` rows back to `auto` before restoring the tighter constraint, so the rollback cannot fail on its own data.

### 5.5 `device_terminals`

`client_id`, `branch_id`, `serial` (unique among live rows), `name`, `timezone`, `allowed_ips`, `ingest_token` (**reserved, unused**), `is_active`, `last_seen_at`, soft deletes.

`allowedIpList()` splits the comma-separated string; `permitsIp()` returns true when the list is **empty** (allow all) or contains the caller's IP.

---

## 6. Concurrency and race handling

Attendance is written from a webcam that people double-tap and from a device that re-pushes its buffer. Four races are handled explicitly.

| Race | Handling |
|---|---|
| **Two punches at once for the same day** | `findOrCreateDay()` takes `lockForUpdate()` on the day row, and `facePunch()` wraps everything in a transaction |
| **The first punch of a day cannot be locked** (there is no row to lock yet) | The `create()` is wrapped in a `try/catch` on `QueryException`; on a unique violation it re-resolves the winning row instead of returning a 500 |
| **A soft-deleted day row occupies the unique slot** | The unique index is not partial, so the lookup uses `withTrashed()` and **restores** the row rather than failing |
| **Two simultaneous enrolments of the same face** | The duplicate scan and the write are one transaction; enrolled rows in the tenant are `lockForUpdate()`-ed first, serialising a rare, human-paced action |
| **Duplicate punch insert losing the idempotency check** | The unique `(employee_id, punched_at)` index catches it; the `QueryException` is counted as a duplicate, not surfaced as an error |

Idempotency itself uses `withTrashed()`: a punch that was **deliberately soft-deleted** (a correction) must not be resurrected the next time the device re-pushes its buffer.

---

## 7. Timezone handling

- Storage is **UTC**; display is **`Asia/Kolkata`** (`AttendanceController::DISPLAY_TZ`). "Today" server-side is `now(IST)->toDateString()`.
- The importer parses each device timestamp **in the terminal's configured timezone**, then converts to UTC.
- Parsing is **strict**. `Carbon::parse()` is lenient and rolls `25:00:00` over into 01:00 the next day, silently landing a punch on the wrong date. Instead the importer tries `Y-m-d H:i:s` then `Y-m-d H:i` with `createFromFormat` and **round-trips the result back to a string** to detect the overflow, rejecting anything that does not match as `unparseable timestamp`.
- The ADMS handshake deliberately **omits `TimeZone`**, so the device keeps its own clock and conversion stays in one place — ours.
- Late detection compares the local first-in against the shift start with a **10-minute grace**, in IST. A timezone bug here does not just misdisplay — it changes the late marks and therefore the pay.

---

## 8. Multi-tenancy and how each path resolves its tenant

| Path | Tenant source |
|---|---|
| Face punch / enrolment (self) | The authenticated user's employee row |
| Enrolment (someone else) | Target employee, checked to be same-tenant **and** requiring `can_edit` on `hr.employee`; globally-scoped rows (`client_id IS NULL`) are also permitted, mirroring `EmployeeController::applyScope` |
| Face login | Every account with that email is considered; the winner determines the tenant, with an org-selection prompt when several remain |
| `/attendance/import` | **The caller's `client_id`.** If none resolves, the import **aborts** rather than running an unscoped `attendance_number` lookup — a fail-closed decision, because an unscoped lookup could attach a punch to another tenant's employee |
| `/iclock/*` push | **The registered serial only.** Never the payload |
| HR list / daily view | `client_id` from the user; branch users are **hard-pinned** to their branch before any filter is applied, so a hand-passed sibling `branch_id` cannot leak |

Employee-code lookups are tenant-scoped because two tenants can each own an `EMP-001`.

---

## 9. Security posture

### 9.1 Face

- The threshold is server-side; the client never decides a match.
- Descriptors are `$hidden`, so they cannot leak through any employee endpoint.
- Login shares the brute-force cache key `login_attempts:<lowercased email>` with password and Google login — 5 attempts / 15 minutes — so an attacker cannot dodge the lock by switching methods. The public auth group is additionally throttled at 20 req/min/IP.
- Degenerate-vector rejection blocks the "probe every enrolled face with a zero vector" attack.
- Enrolling another person requires employee-edit rights — it is a credential grant, not a profile tweak.
- **Not implemented:** liveness detection (a printed photo can pass), encryption at rest, retention/auto-wipe.

### 9.2 Device

- The fingerprint template never leaves the terminal; we receive an ID, a time and a status. That is a materially lighter privacy burden than the face path.
- `/iclock/*` is **public and unauthenticated** — a terminal cannot present a token. The controls are: serial → registry lookup, `is_active`, the per-terminal IP allow-list, `throttle:120,1`, a **5000-row cap** per push, and logging of every hit.
- **The serial is the sole credential.** It is printed on the device and guessable, so a fully internet-facing Mode C deployment can be spoofed by anyone who knows it and is not blocked by IP. `ingest_token` exists on the table as the reserved fix. This is the reason **Mode B (on-prem pull) is the recommended production mode** — it exposes nothing.
- Every refusal still answers `OK`, so the device does not loop. Absence of an error is therefore not evidence of ingestion; the logs are.
- `/attendance/import` is admin-gated because it can fabricate attendance for anyone — which is a payroll write.

### 9.3 Consent

Revocation clears the descriptor, stamps `face_consent_revoked_at`, keeps `face_consent_given_at`, and **nulls every historical `match_distance`** on the employee's punches and attendance rows. Consent governs biometric-derived data, not just the live signature; the attendance facts themselves are retained.

---

## 10. Payroll coupling

Attendance is the basis of pay, so the importer takes two deliberate positions.

1. **A locked (fully disbursed) payroll period rejects new punches.** Accepting one would silently change the basis of money already paid, leaving the payslip and the attendance permanently disagreeing with nothing to reconcile them. Such rows come back as an error telling the user to post an adjustment next cycle. The check is cached per `client|branch|Y-m`, and a client-wide cycle (`branch_id IS NULL`) blocks the punch just as the employee's own branch's cycle would — while a branch-less employee is covered *only* by that client-wide cycle, so another branch's closed payroll cannot block them.
2. **Corrections must reach the money.** Every employee whose punches changed has their payslips in **draft / generated** runs recomputed **in place** — same row, recalculated columns — so the payroll table reflects the corrected attendance without anyone remembering to re-run, and without a second payslip appearing. `PayrollService::recomputeEmployeePayslips()` skips approved, paid and locked runs by design.

The count is reported back as `payslips_recomputed`.

---

## 11. Frontend internals

- **Dynamic import.** `FaceCapture.tsx` loads face-api with `import('face-api.js')` and caches the promise, so pages without a camera never pay the ~1 MB. Vite's dependency scanner misses dynamic imports, hence `optimizeDeps.include: ['face-api.js']` in `vite.config.js`; after changing it, clear `node_modules/.vite`.
- **Model URL.** `import.meta.env.VITE_FACE_MODEL_URL || '/face-models'`. The three nets — `tinyFaceDetector`, `faceLandmark68Net`, `faceRecognitionNet` — are loaded in parallel from it.
- **Detection.** `TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })`, then landmarks and descriptor. **Exactly one** face is required: zero → "No face detected", more than one → "Multiple faces detected". Neither ever reaches the server.
- **Secure context.** `getUserMedia` refuses on plain `http://` outside localhost, and it fails *without* showing a permission prompt — which is why the symptom reads as "permission denied" when the real cause is a missing certificate.
- **The SPA never decides direction.** It renders the button from `next_direction` returned by `/attendance/today`; the server re-derives and re-checks it anyway.

---

## 12. Deployment notes

| Concern | Detail |
|---|---|
| Model weights | 7 files, ~6.8 MB in `public/face-models/`. Vite copies `public/` verbatim, so they ship with `npm run build`. If they are missing the SPA hangs on "Loading face-recognition models…" |
| HTTPS | Mandatory anywhere but localhost |
| Route order | `/iclock/*` must stay **above** the SPA catch-all in `routes/web.php`, and CSRF-exempt in `bootstrap/app.php` |
| Pre-migrate checks | The two unique-index migrations fail on violating data. Check for duplicate `(client_id, attendance_number)` and duplicate `(employee_id, punched_at)` **before** `migrate --force` |
| Rollback | All five device migrations are additive and reversible (`migrate:rollback --step=5`); nothing is dropped destructively |
| Connector placement | The Mode B connector runs **on-prem** — it needs LAN access to the terminal on TCP 4370. Only the API lives on the server |
| Bring-up logging | `EsslDeviceController` logs every `/iclock` hit (`[eSSL] hit cdata`, `[eSSL] ATTLOG ingested`, and warnings for unregistered serials or disallowed IPs). Useful during commissioning; trim once verified |
| Reverse proxy | `TrustProxies` must be correct or the IP allow-list will compare against the proxy's address instead of the device's |

---

## 13. Open technical items

| # | Item |
|---|---|
| 1 | `2026_07_27_000002` still pending — resolve the duplicate Attendance Number, then apply the per-client unique index |
| 2 | Implement the reserved per-device `ingest_token` so a Mode C deployment does not rest on a printed serial |
| 3 | Liveness challenge on capture |
| 4 | Encrypt `face_descriptor` at rest (`pgcrypto` or an encrypted cast) |
| 5 | Retention job — auto-revoke and wipe after N years of inactivity |
| 6 | Enforce the geo-fence using the lat/lng already captured (`branch.geo_lat / geo_lng / geo_radius_m`) |
| 7 | Night-shift days crossing midnight |
| 8 | Push device clock sync from Mode B / C |
| 9 | Vector index (pgvector) if any tenant passes ~10 000 enrolled faces |
| 10 | Manual punch UI — `method = 'manual'` exists in the enum but has no screen |
