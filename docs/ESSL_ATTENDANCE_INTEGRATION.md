# ESSL Biometric Attendance — Implementation & Settings Guide

> **One-file master reference.** Everything needed to integrate an eSSL fingerprint
> terminal (ZKTeco hardware) with the Cross_Border_Command attendance module —
> **from start to end**: what it does, all requirements, every device setting, the
> app-side build plan, the sync flow, verification, test cases, error decoder, and a
> bug template.
>
> ⚠️ **ESSL fingerprint ≠ webcam Face login.** Our app already has a *browser
> face-recognition* clock-in. The ESSL device is separate hardware that does its own
> fingerprint matching. This sheet is **only** about the ESSL **device** integration.
>
> _Prepared: 2026-07-27._

---

## 1. What this feature does (in one line)

An **ESSL fingerprint terminal** at the office door records employee punches; those
punches flow into our app and appear on the **HR Attendance** sheet — mapped to the
right employee by a single number.

**The one rule the whole feature depends on:**

> ESSL device **User ID / Enrollment No.** **=** `employees.attendance_number` in our app.

**What flows, and what it becomes in our app:**

| On the device | Becomes in our app | Where it shows |
|---|---|---|
| A fingerprint punch (User 101, 09:03, In) | An `attendance_punch` (direction `in`) | HR Attendance timeline |
| First punch of the day | `attendances.check_in_at` | HR sheet "In" column |
| Last punch of the day | `attendances.check_out_at` | HR sheet "Out" column |
| Source of the punch | `method = device` → **BIOMETRIC** badge | Punch source pill |

> The device **never** sends a fingerprint image to the app. It matches on-device and
> sends only: **User ID + timestamp + In/Out status.**

---

## 2. Feasibility verdict

✅ **Possible.** The data model is already ~70% ready:

| Already exists | Status |
|---|---|
| `employees.attendance_number` field (digits-only, on every employee form) | ✅ |
| `BIOMETRIC` punch source in the HR UI | ✅ |
| Punch model + strict in/out alternation + daily summary | ✅ (needs extraction to reuse) |
| Roadmap note in repo (`docs/HR_ATTENDANCE.md:307` — "eSSL/Realtime/Anviz imports") | ✅ |

| Still to build | Status |
|---|---|
| `method = 'device'` enum value + a source/terminal column | ❌ New migration |
| Ingest endpoint + AttLog/CSV parser + **normaliser** | ❌ New controller/service |
| "Import Attendance" upload screen (Mode A) | ❌ New frontend |
| Per-tenant uniqueness on `attendance_number` | ❌ Validation gap |
| (Mode C only) public **signed** ingest + device→branch registry | ❌ Larger build |

---

## 2A. 📋 DEVELOPMENT LEDGER — everything built (status at 2026-07-27)

> The integration is **feature-complete for Mode A (file import) + Mode C (live push)**,
> fully operable from the UI. Mode B (LAN connector) shipped as a standalone tool.
> **All local — not yet committed.** One migration is intentionally held (see bottom).

### Build status by phase
| Phase | What | Status |
|---|---|---|
| 0 | Foundation: `device` method enum + provenance cols; shared `AttendancePunchService`; attendance_number uniqueness rule | ✅ done |
| 1 | Normaliser `EsslAttendanceImporter` (map → UTC → alternate-by-time → idempotent) | ✅ done |
| 2 | File import: `POST /attendance/import` + "Import Punches" UI | ✅ done |
| 3 | Verify + hardening (IP allow-list, throttle) | ✅ done |
| C | ADMS/iclock receiver + `device_terminals` registry + HR "Biometric Devices" screen | ✅ done |
| B | `tools/essl-connector/` LAN poller (Python/pyzk) | ✅ done |

### Backend files
| File | Role |
|---|---|
| `app/Services/AttendancePunchService.php` | Shared day/next-dir/append/recompute (face + device) |
| `app/Services/EsslAttendanceImporter.php` | The normaliser (all ingest modes funnel here) |
| `app/Http/Controllers/Api/EsslDeviceController.php` | Mode C `/iclock/*` receiver |
| `app/Http/Controllers/Api/DeviceTerminalController.php` | Terminal registry CRUD (`/api/device-terminals`) |
| `app/Http/Controllers/Api/AttendanceController.php` | `import()` (Phase 2) + `facePunch` now delegates to the service |
| `app/Models/DeviceTerminal.php` | Registry model + `permitsIp()` |
| `app/Models/AttendancePunch.php` | +`device_serial`/`device_user_id`/`raw_status` fillable |
| `routes/web.php` | Public `/iclock/*` (throttled, above SPA catch-all) |
| `routes/api.php` | `/attendance/import`, `apiResource device-terminals` |
| `bootstrap/app.php` | CSRF-exempt `iclock/*` |

### Frontend files
| File | Role |
|---|---|
| `resources/js/pages/hrms/HrBiometricDevices.tsx` | Devices CRUD + "Import Punches" modal |
| `App.tsx`, `constants.ts`, `LayoutMenuData.tsx`, `routeAccess.ts` | Route `/hr/devices` + menu leaf (rides on `hr.attendance` permission) |

### Standalone tool
| File | Role |
|---|---|
| `tools/essl-connector/essl_connector.py` (+ config/README/requirements) | Mode B LAN poller → `/attendance/import` |

### Endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/POST | `/iclock/cdata` | public (SN registry) | Mode C handshake + ATTLOG push |
| GET | `/iclock/getrequest` | public | device command poll |
| POST | `/iclock/devicecmd` | public | device command ack |
| GET/POST/PUT/DELETE | `/api/device-terminals[/{id}]` | sanctum | terminal registry |
| POST | `/api/attendance/import` | sanctum | file/JSON import (Mode A + Mode B) |

### Migrations
| Migration | Status |
|---|---|
| `2026_07_27_000001` device method enum + provenance cols | ✅ applied |
| `2026_07_27_000003` device_terminals table | ✅ applied |
| `2026_07_27_000004` allowed_ips | ✅ applied |
| `2026_07_27_000002` unique attendance_number per client | ⏳ **HELD** — blocked by dup **client 1 / number 1212**; fix the dup then `migrate --path=…000002…` |

### To run / test
1. Rebuild SPA: `npm run dev` (or `npm run build`).
2. Register the device: **HR → Biometric Devices → Add Device** (serial `NFZ8252004771`).
3. **Mode C (live):** on the device set Cloud Server → ADMS, Server Address = dev-PC IP,
   port 8000, HTTPS off; run `php artisan serve --host=0.0.0.0 --port=8000`; punch.
4. **Mode A (file):** export from the device (USB/eTimeTrackLite) → **Import Punches**.
5. **Mode B (poll):** `tools/essl-connector/` — see its README.
6. Verify in **HR → Attendance** (BIOMETRIC source). Import **before** finalising payroll.

---

## 3. Requirements checklist (tick ALL before starting)

### 3.1 Hardware
- [ ] An eSSL / ZKTeco terminal that supports fingerprint (e.g. **eTimeTrack, X990,
      K90/K30, MB460, iClock**). Face/RFID optional.
- [ ] Device firmware supports **at least one** of: USB export, TCP/SDK (port 4370),
      or **ADMS/Cloud** push. (Most eSSL business models support all three.)
- [ ] Power + a mounting location near the entry point.

### 3.2 Network (per mode — see §5)
- [ ] **Mode A (CSV):** none — a USB pen-drive OR eTimeTrackLite software on a PC.
- [ ] **Mode B (LAN):** device + a Windows PC on the **same LAN**; TCP **4370** open.
- [ ] **Mode C (Cloud):** device has internet; our server reachable on a **public
      IP/domain**; the ingest port open.

### 3.3 App / data
- [ ] Every device-tracked employee has `attendance_number` filled (digits only).
- [ ] Those numbers are **unique per tenant** (no two employees share one).
- [ ] Employee `time_tracking` set to **Biometric** (marks who is device-tracked).
- [ ] Employee `date_of_joining` correct (punches before it are rejected).

### 3.4 People / access
- [ ] At least one person set as **device Super Admin** (to open the device menu).
- [ ] HR user who will run the import / verify the sheet.

---

## 4. Pick your integration mode

| # | Mode | How data moves | Real-time? | Needs a PC? | Needs public server? | Effort | Start here if… |
|---|---|---|---|---|---|---|---|
| **A** | **CSV / USB import** ⭐ | HR exports a file → uploads in-app | ❌ batch | Only to run export software | ❌ | **Low** | You want it working now |
| **B** | **LAN connector (Pull SDK)** | A Windows service polls the device → POSTs to our API | ~1 min | ✅ (always-on) | ❌ | Medium | Device + PC share a LAN |
| **C** | **Cloud / ADMS push** | Device POSTs punches to our server itself | ✅ live | ❌ | ✅ | High | SaaS scale, many sites |

**Recommendation:** build **A first** (proves the mapping, zero networking). Add **B**
or **C** once the ingest/normalise logic is proven. **C** is the true SaaS end-state but
requires device→tenant authentication (a device can't send a login token).

---

## 5. ⚙️ DEVICE SETTINGS — do these on the machine

> Menu paths are for typical eSSL/ZKTeco firmware. Labels vary slightly by model.
> Press **M/OK** to open the menu (needs an enrolled admin once users exist).

### 5.1 Common settings — ALL modes (mandatory)

| Setting | Menu path | Value / note |
|---|---|---|
| **Enroll user** | `User Mgmt → New User` | **User ID = employee's `attendance_number`.** Enroll 1–2 fingerprints (scan 3×). Privilege = Normal User. |
| **Admin user** | `User Mgmt → New User → Privilege` | Keep 1–2 as **Super Admin** to open the menu. |
| **Date & time** | `System → Date/Time` | Set correct **IST**. **DST off.** Wrong clock = every punch shifted. |
| **Time format** | `System → Date/Time` | 24-hour recommended (avoids AM/PM parse issues). |
| **In/Out keys** | `Personalize → Shortcut Key` | Enable **Check-In** / **Check-Out** function keys (see §5.2). |

**Enrollment is the #1 rule:** the **User ID you type on the device must be exactly the
Attendance Number** in the app. If employee "Ravi" is `101` in the app, enroll him as
User `101` on the device.

### 5.2 Attendance status / function keys

The Check-In / Check-Out keys set the punch **status code**. The employee presses the
key **before** scanning.

| Status code | Meaning |
|---|---|
| 0 | Check-In |
| 1 | Check-Out |
| 2 | Break-Out |
| 3 | Break-In |
| 4 | Overtime-In |
| 5 | Overtime-Out |

> **Reality:** operators often forget to press the key, so status is frequently all `0`.
> Our importer therefore **must not trust status blindly** — it sorts punches by time
> and forces in/out alternation. (See §8, risk #1.)

### 5.3 Mode A — USB / software export

| Setting | Menu path | Value / note |
|---|---|---|
| USB export | `USB Manager → Download → Attendance Data` | Produces `AttLog` file (`.dat` / `.txt` / `.xls`) on the pen-drive. |
| (Alt) software | eTimeTrackLite on a PC | Connect device → **Download Logs** → export CSV/Excel. |

**AttLog file format** (tab/space-delimited — what the importer parses):
```
UserID   DateTime(YYYY-MM-DD HH:MM:SS)   Status   VerifyMode   WorkCode
101      2026-07-27 09:03:12            0        1            0
101      2026-07-27 18:31:40            1        1            0
```
`Status` = §5.2 codes. `VerifyMode`: 1 = fingerprint, 15 = face, etc.

### 5.4 Mode B — LAN connector (TCP 4370)

| Setting | Menu path | Value / note |
|---|---|---|
| IP Address | `Comm → Ethernet → IP Address` | **Static** IP in the office subnet, e.g. `192.168.1.201`. |
| Subnet Mask | `Comm → Ethernet` | e.g. `255.255.255.0`. |
| Gateway | `Comm → Ethernet` | Router IP. |
| Device ID | `Comm → PC Connection` | Unique per device, e.g. `1`. |
| Comm Key | `Comm → PC Connection → Comm Key` | Default `0`. If non-zero, the connector must use the same key. |
| Port | (fixed) | **4370** TCP — the ZKTeco SDK default. Open it on the LAN. |

A small Windows connector (`zkemkeeper.dll`) connects to `IP:4370` + Comm Key, pulls new
logs on a timer, and POSTs them to our API **with a Sanctum token**.

### 5.5 Mode C — Cloud / ADMS push

First do §5.4 network settings, then:

| Setting | Menu path | Value / note |
|---|---|---|
| Server Mode | `Comm → Cloud Server Setting` | `ADMS` (or `Domain Name`). |
| Server Address | `Comm → Cloud Server Setting` | Our **public IP or domain**, e.g. `api.yourapp.com`. |
| Server Port | `Comm → Cloud Server Setting` | Port our ingest endpoint listens on (`80` / `443` / `8080`). |
| Proxy | `Comm → Cloud Server Setting` | `OFF` unless the site needs one. |
| HTTPS | `Comm → Cloud Server Setting` | `ON` if the model + our endpoint support TLS. |

**Our side for Mode C:** a **public, signed** endpoint speaking the iclock/ADMS protocol
(`GET /iclock/getrequest`, `POST /iclock/cdata`), plus a **device registry** binding the
device **Serial No. → `client_id` + `branch_id`** so punches land in the right tenant,
plus a per-device token to block spoofed punches.

---

## 6. App-side implementation plan (start → end)

> Build in phases. Each phase is independently testable. **Phase 1–3 = Mode A shippable.**

### Phase 0 — Foundation (shared by all modes) — ✅ DONE 2026-07-27
1. ✅ **Migration** `2026_07_27_000001_add_device_method_to_attendance` — added `'device'`
   to the `method` CHECK constraint on `attendances` (check_in/out) **and**
   `attendance_punches`, plus `device_serial` / `device_user_id` / `raw_status` columns
   on `attendance_punches`. **Applied & verified.**
2. ✅ **Extracted** the day/next-direction/append/`recomputeSummary` logic into
   `app/Services/AttendancePunchService.php`; `AttendanceController::facePunch()` now
   delegates to it (behaviour-preserving — face clock-in unchanged). Smoke-tested.
3. ✅ **Validation** — per-tenant uniqueness of `attendance_number` added to the employee
   validator (mirrors `pan_number`). ⏳ **DB index HELD:** migration
   `2026_07_27_000002_unique_attendance_number_per_client` is written but **Pending** —
   it can't apply until an existing duplicate is resolved: **client_id=1,
   attendance_number `1212` is shared by 2 employees.** Fix that, then run:
   `php artisan migrate --path=database/migrations/2026_07_27_000002_unique_attendance_number_per_client.php`

### Phase 1 — Ingest core (the normaliser) — ✅ DONE 2026-07-27
4. ✅ `app/Services/EsslAttendanceImporter.php` — given `(user_id, punched_at, status)`
   rows it maps `attendance_number → employee` (tenant-scoped), converts device-local →
   UTC, **normalises to strict in/out alternation by time** (ignores unreliable status),
   and upserts `attendances` + `attendance_punches` (`method='device'`) **idempotently**
   (skips a punch already stored at the same `employee_id` + `punched_at`). Returns a
   summary (imported / skipped_duplicates / unmatched_user_ids / errors / date_range).
   **Verified** end-to-end (all-status-0 → correct alternation; re-run → all dupes; IST→UTC
   correct; unmatched + before-joining reported).

### Phase 2 — Mode A endpoint + screen — ✅ DONE 2026-07-27
5. ✅ `POST /attendance/import` (authed) — `AttendanceController::import` accepts an
   AttLog/CSV **file upload** OR an inline `punches` JSON array; parses tab- **or**
   comma-delimited, auto-skips a header row; optionally attaches to a registered terminal
   (`device_terminal_id` → inherits branch/timezone/serial) else uses the caller's client
   (+ optional `branch_id`/`timezone`); runs the Phase-1 normaliser; returns the summary.
   **Verified** (CSV w/ header, JSON, idempotency).
6. ✅ **"Import Punches"** button + modal on the Biometric Devices screen: pick a device
   (optional), upload the file, and see a live result summary (imported / duplicates /
   employees / date range / **unmatched User IDs** / skipped rows). Never silently drops —
   unmatched/errored rows are surfaced.

### Phase 3 — Verify & harden
7. Confirm punches appear in `HrAttendance` with the **BIOMETRIC** badge.
8. Run the full test matrix (§9).

### Phase 4 — Mode B (LAN connector) — ✅ DONE 2026-07-27
9. ✅ `tools/essl-connector/` — a standalone **Python (pyzk) connector**
   (`essl_connector.py` + `config.example.ini` + `requirements.txt` + `README.md`).
   Polls the device over TCP 4370, keeps a cursor, and forwards new punches to
   `POST /api/attendance/import` with a service Sanctum token (reuses the Phase-2
   endpoint + Phase-1 normaliser). Syntax-verified (py_compile). Runs unattended via
   Task Scheduler / NSSM. Only needed for pull-mode / non-push devices.

### Phase 5 — Mode C (ADMS receiver) — ✅ MINIMAL RECEIVER DONE 2026-07-27
10. ✅ Public iclock endpoints (`routes/web.php`, above the SPA catch-all, CSRF-exempt in
    `bootstrap/app.php`): `GET|POST /iclock/cdata`, `GET /iclock/getrequest`,
    `POST /iclock/devicecmd` → `app/Http/Controllers/Api/EsslDeviceController.php`.
    Device registry `device_terminals` (serial → client/branch/timezone, `is_active`,
    `last_seen_at`) + `App\Models\DeviceTerminal`. Handshake replies a valid ADMS options
    block; ATTLOG POST parses + feeds the Phase-1 normaliser; **unknown/inactive serials
    are acked but NOT ingested** (tenant is always derived from the registered serial).
    **Verified** via simulated device POST/GET.
11. ✅ **Hardening + management** (2026-07-27): per-terminal **IP allow-list**
    (`device_terminals.allowed_ips`, blank = allow any — enforced in the receiver, push
    from a disallowed IP is acked but not ingested) + **rate-limit** `throttle:120,1` on
    the `/iclock/*` routes. **Device management API** (tenant-scoped, authed):
    `GET|POST /api/device-terminals`, `PUT|DELETE /api/device-terminals/{id}`
    (`DeviceTerminalController`) so terminals are registered/activated from the app, not
    tinker. ⏳ Optional further hardening for a fully public endpoint: signed per-device
    token (the stock device can't send custom headers, so IP allow-list + private network
    is the practical control).

### HR screen — ✅ DONE 2026-07-27
- `resources/js/pages/hrms/HrBiometricDevices.tsx` — list + add/edit/remove terminals
  (serial, name, branch, timezone, allowed IPs, active, last-seen). Mirrors the
  `OrganizationTypes` CRUD pattern (reactstrap + toast + SweetAlert confirm).
- Menu leaf **HR → Time & Pay → Biometric Devices** (`constants.ts`), routed at
  **`/hr/devices`** (`App.tsx`), link in `LayoutMenuData.tsx`. Visibility + route access
  **ride on the `hr.attendance` permission** (no separate permission leaf to seed) — so it
  appears/opens exactly where the Attendance page does. Typechecks clean.
- _Rebuild the SPA (`npm run dev` / `npm run build`) to see it._

### ▶ Go-live test with the real device (LAN pilot)
1. **Register the terminal** (bind Serial → the tenant/branch you're testing):
   ```
   php artisan tinker --execute="\App\Models\DeviceTerminal::create(['client_id'=>1,'branch_id'=>2,'serial'=>'NFZ8252004771','name'=>'Front door x2008','timezone'=>'Asia/Kolkata','is_active'=>true]);"
   ```
2. **Enroll each employee** on the device with **User ID = their `attendance_number`**.
3. On the device `COMM → Cloud Server Setting`: Server Mode `ADMS`, Domain Name **OFF**,
   Server Address = **dev-PC LAN IP**, Port **8000**, HTTPS **OFF** (see §25).
4. Run the app so the device can reach it on the LAN:
   `php artisan serve --host=0.0.0.0 --port=8000`
5. Punch on the device → watch `storage/logs/laravel.log` for `[eSSL] ATTLOG ingested`,
   then open **HR Attendance** — the punch shows with a **BIOMETRIC** source badge.
6. Production later: point Server Address at **cbc.idims.in**, HTTPS **ON**, and add the
   per-device token hardening.

---

## 7. End-to-end flow (Mode A — the recommended start)

```
SETUP (one-time, per employee)
  1. HR sets employee.attendance_number = 101      (field already exists)
  2. Enroll fingerprint ON the device as User 101  (§5.1 — IDs MUST match)
  3. Set employee time_tracking = Biometric

DAILY
  4. Employee presses Check-In/Check-Out key + scans finger   (§5.2)
  5. HR exports the AttLog file                               (§5.3)
  6. HR uploads it in the "Import Attendance" screen          (Phase 2)
       Backend:  map UserID → attendance_number (per tenant)
                 device-local time → UTC
                 NORMALISE to strict in/out alternation   ← critical
                 upsert attendances + punches (method='device')
                 idempotent — skip already-imported rows
  7. Punches show in HrAttendance with a BIOMETRIC source badge
```

---

## 8. Highest-risk areas — test these hardest

1. **Alternation invariant.** App rejects two same-direction punches in a row; device
   status is often all `0`. The importer **must** re-derive in/out by time — never
   replay raw. _#1 risk._
2. **`attendance_number` uniqueness.** Two employees sharing a number → punches on the
   wrong person. Enforce per-tenant uniqueness before go-live.
3. **Timezone.** Device sends local time; app stores UTC (shows IST). Convert on ingest
   or everything is off by 5.5 h.
4. **Duplicate / re-import.** Devices resend; HR may upload twice → need idempotency.
5. **Multi-tenant scoping.** Punches inherit `client_id`/`branch_id` from the **matched
   employee**, never from the file. Mode C: bind device serial → branch.
6. **Reuse, don't copy.** Extract `facePunch()` logic (Phase 0) so both paths behave
   identically.
7. **Face stays independent.** Device-tracked employees don't need webcam enrollment;
   the `time_tracking` toggle separates them.

---

## 9. Test matrix

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | User ID not mapped | Import a log whose User ID matches no `attendance_number` | Row **skipped + reported** in the summary, not silently dropped |
| 2 | Status all `0` | Import a day where keys were never pressed | Normaliser alternates in/out **by time** correctly |
| 3 | Missing out-punch | Odd number of punches in a day | Day = "Missing Out"; open pair auto-closed at 21:00 (like face path) |
| 4 | Re-import same file | Upload the same AttLog twice | **No duplicate** punches (idempotent) |
| 5 | Device clock in local time | Import IST-timed logs | Punches display correct **IST** after import |
| 6 | Shared attendance number | Two employees with the same number | **Blocked at validation** / flagged, not mis-assigned |
| 7 | Punch before joining | Log dated before `date_of_joining` | **Rejected** (mirror the face-path guard) |
| 8 | Cross-branch | Import for an employee in branch B, check branch A | Lands under B's tenant/branch; invisible to A |
| 9 | Mixed device + face | Same day has a device punch and a face punch | Timeline stays strictly alternating; sources render distinctly |
| 10 | Break punches | Logs with status 2/3 (break out/in) | Handled as normal in/out taps; totals correct |
| 11 | Large file | Import a month of logs for many employees | Completes; summary accurate; no timeouts/partial writes |
| 12 | Unmatched + matched mix | File has some mapped and some unmapped IDs | Mapped ones import; unmapped listed; no all-or-nothing failure |

---

## 10. Error decoder — bug or expected?

| What you see | Meaning | Log as bug? |
|---|---|---|
| Some rows "skipped — no matching employee" | Those User IDs aren't set as any `attendance_number` | ❌ Setup — fill the field / re-enroll |
| Punch time off by 5.5 h | Device clock wrong OR TZ conversion missing | ✅ If device clock is correct → **log it** |
| Two same-direction punches accepted | Normaliser failed | ✅ **Log — high priority** |
| Duplicate punches after re-import | Idempotency broke | ✅ **Log — high priority** |
| Punch assigned to the wrong person | Shared/duplicate `attendance_number` | ✅ Log it (and fix the number) |
| Branch A import visible in branch B | Tenant isolation broke | ✅ **Log — high priority** |
| Import blocked for a pre-joining date | Guard working as designed | ❌ Expected |
| Device menu won't open | No admin enrolled on the device | ❌ Device setup — enroll a Super Admin |

---

## 11. Bug-report template (paste into JIRA)

```
Title:      [ESSL Attendance] <symptom in one line>
Module:     Biometric attendance import
Mode:       A (CSV) / B (LAN) / C (Cloud)
Env:        local / staging     Tenant / Branch:  <client / branch>
Device:     <model + serial>

Pre-conditions (from §3):
  - Employee attendance_number set + unique?   Y / N   (value: ____)
  - Device User ID == attendance_number?        Y / N
  - Device date/time correct (IST, DST off)?    Y / N
  - time_tracking = Biometric?                  Y / N

Steps to reproduce:
  1. (device punches / export)
  2. Upload file in Import Attendance
  3.

Expected (from §7 / §9):
Actual:
Import summary (imported / skipped / unmatched):
Punch timeline in HrAttendance:
Screenshots:  (device log/export + app HR sheet)
```

---

## 12. Glossary

- **User ID / Enrollment No.** — the number an employee is enrolled under on the device;
  **must equal** `attendance_number`.
- **AttLog** — the device's attendance transaction log (punch records).
- **Status code** — In/Out/Break code set by the device function keys (§5.2).
- **VerifyMode** — how the punch was verified (1 = fingerprint, 15 = face…).
- **ADMS / Push SDK** — protocol where the **device** POSTs logs to a server (Mode C).
- **Pull SDK / `zkemkeeper.dll`** — Windows library to poll the device over TCP 4370 (Mode B).
- **eTimeTrackLite** — eSSL's official desktop software (Mode A export).
- **Comm Key** — device connection password; the connector must match it.
- **Normaliser** — our importer step that re-derives strict in/out alternation from raw logs.
- **`method = device`** — the punch source value for device punches → renders as **BIOMETRIC**.

---

## 13. Where it plugs into the existing pipeline (important)

Device punches are **not** a standalone feature — they feed the same chain the face
clock already feeds. A device punch travels the full length of this pipeline:

```
Device punch
   → attendance_punches (method='device')
   → attendances (check_in_at = first in, check_out_at = last out)   [recomputeSummary]
   → HrAttendance daily-view  (status derived: Present/Late/Missing Out/…)  [resolveDayStatus]
   → Payroll finalize-attendance  (locks the cycle's attendance)
   → Payslip  (paid_days, missing_punches, late-mark "mismatch")
```

**Consequences you must design for:**

1. **Punches affect payroll.** `POST /payroll/finalize-attendance` reads the same
   `attendances` rows. Wrong/missing device punches → wrong `paid_days`,
   `missing_punches`, or LOP on the payslip. So the importer's correctness is a
   **payroll-grade** requirement, not just a display concern.
2. **Late is computed in IST with a 10-min grace.** `resolveDayStatus()`
   (`AttendanceController.php:731`) promotes Present→**Late** when the local first-in is
   > shift start + 10 min. If the importer doesn't convert device-local time to UTC
   correctly, employees will be wrongly marked Late (or wrongly on-time) — and that
   flows to payroll.
3. **21:00 auto-checkout.** An open (unpaired) "in" is auto-closed at 21:00 IST for the
   worked-hours calc. Device days with a missing out-punch behave like the face path —
   don't special-case them.
4. **Status set on the row.** New device `attendances` rows should default `status`
   exactly like the face path (Present on first in) and let `resolveDayStatus` /
   payroll refine it. Don't invent new statuses.
5. **Payroll snapshot is frozen at generation.** The payslip "Biometric Input" columns
   read a **stored snapshot** taken when payroll is generated — importing punches
   **after** a run is generated won't retro-update it. Import **before** finalising, or
   regenerate. (This has bitten us before.)

---

## 14. Data-model changes (detailed)

### 14.1 New migration — enum + source columns
```php
// attendances + attendance_punches
$table->enum('method', ['face','manual','auto','device'])->...;   // add 'device'
// on attendance_punches (audit of where a device punch came from):
$table->string('device_serial', 64)->nullable()->index();   // which terminal
$table->string('device_user_id', 50)->nullable();           // raw ID from the device
$table->string('raw_status', 8)->nullable();                // 0..5 as sent, pre-normalise
```
> Keep `device_user_id` **and** map it to `employee_id` at ingest — storing the raw ID
> makes disputes/audits reconstructable even if `attendance_number` later changes.

### 14.2 Uniqueness guard
Add a **partial unique index** on `attendance_number` scoped to the tenant
(`client_id`, and normally `branch_id`), ignoring NULLs — mirror the pattern in
`2026_06_12_000003_partial_unique_employee_documents.php`. Enforce it in the employee
create/edit **FormRequest** too (friendly 422), not just the DB.

### 14.3 Idempotency key
Unique on `(employee_id, punched_at)` (or `(device_serial, device_user_id, punched_at)`
before mapping) so a re-uploaded file / re-pushed log can't double-insert.

### 14.4 Optional new table (Mode C / multi-device)
```
device_terminals
  id, client_id, branch_id, serial (unique), name, mode(A/B/C),
  last_seen_at, ingest_token (hashed), is_active
```
Binds a physical terminal to a tenant/branch and holds its push token. Needed for
Mode C; nice-to-have for Mode B auditing.

---

## 15. API contract — the import endpoint (Mode A / B)

**`POST /attendance/import`**  · auth: `auth:sanctum` + `user.active`

Request (multipart file **or** JSON rows):
```json
{
  "device_serial": "XYZ12345",
  "punches": [
    { "user_id": "101", "punched_at": "2026-07-27 09:03:12", "status": "0" },
    { "user_id": "101", "punched_at": "2026-07-27 18:31:40", "status": "1" }
  ],
  "source_tz": "Asia/Kolkata"
}
```

Response (always report, never silently drop):
```json
{
  "data": {
    "imported": 42,
    "skipped_duplicates": 5,
    "unmatched_user_ids": ["777", "888"],
    "employees_affected": 19,
    "date_range": ["2026-07-01", "2026-07-27"],
    "errors": [
      { "user_id": "101", "punched_at": "2026-06-30 09:00", "reason": "before date_of_joining" }
    ]
  }
}
```
- **Tenant-scoped:** only matches employees under the caller's `client_id`.
- **Idempotent:** re-posting the same rows increments `skipped_duplicates`, not `imported`.
- `unmatched_user_ids` drives an HR "fix these attendance numbers" follow-up.

---

## 16. Mode B — the LAN connector app (architecture)

A small always-on Windows service on the office LAN. It is the bridge because the device
speaks TCP/SDK, not HTTP+Sanctum.

| Concern | Design |
|---|---|
| Tech | C#/.NET + `zkemkeeper.dll` (official SDK), **or** Python + `pyzk`. |
| Connect | `Connect_Net(ip, 4370)` with the Comm Key. |
| Poll cadence | Every 1–5 min, or subscribe to real-time events (`OnAttTransactionEx`). |
| Cursor | Persist the **last pulled timestamp** so it only forwards new logs (avoid re-pull storms). |
| Forward | `POST /attendance/import` with a **dedicated service user's Sanctum token** (or a `device_terminals.ingest_token`). |
| Resilience | Queue locally if the API is down; retry with backoff; never drop logs. |
| Clear logs? | **Do NOT** clear device memory after pull (keeps a fallback). Let the device overwrite oldest when full. |
| Multi-device | One connector can poll several terminals; tag each with its `device_serial`. |

> Buffering matters: eSSL terminals hold tens of thousands of logs, so a few hours of PC
> downtime loses nothing — the connector catches up on next poll.

---

## 17. Mode C — the ADMS / iclock push protocol (how the device talks)

The device (in Cloud/ADMS mode) initiates plain-text HTTP to our server. Our public
endpoint must speak this dialect:

| Step | Device sends | Our server replies |
|---|---|---|
| Handshake | `GET /iclock/cdata?SN=<serial>&options=all` | `GET OPTION FROM: <serial>` + stamp/interval config |
| Poll for commands | `GET /iclock/getrequest?SN=<serial>` | `OK` (or queued commands like "clear", "reboot") |
| **Push punches** | `POST /iclock/cdata?SN=<serial>&table=ATTLOG` body = tab-delimited rows | `OK: <count>` |

ATTLOG row body (same fields as the file format, §5.3):
```
101<TAB>2026-07-27 09:03:12<TAB>0<TAB>1<TAB>0 ...
```

**Server responsibilities (Mode C only):**
- **Public, unauthenticated route** (device can't send a bearer token) — so protect it by
  `SN` → `device_terminals` lookup + a shared secret / IP allow-list, and reject unknown
  serials. Log every push.
- **Map `SN` → `client_id`/`branch_id`** — this is how a push lands in the right tenant.
- Reuse the **same normaliser** as Mode A/B (one code path, three front-doors).
- **Idempotency + replay protection** — devices resend on any doubt; dedupe hard.
- Reply `OK` promptly or the device retries and may buffer/duplicate.

---

## 18. Interaction with existing HR features (don't break these)

| Feature | Interaction |
|---|---|
| **Shift / Late** | `resolveDayStatus` marks Late from first-in vs shift + 10 min (IST). Device punches must be UTC-correct so Late is fair. |
| **Weekly-off** | `parseWeeklyOff` + `weekly_off` field — a device punch on a weekly-off day should still record, but status handling stays as-is. |
| **Holidays** | `holidayDatesForGroups` (holiday_group_id) — punches on holidays are unusual but allowed; don't suppress. |
| **Regularization** | Employees fix wrong days via `AttendanceRegularizationController` (approval-routed). Device punches are just another input a regularization can correct — no change needed, but a device mis-import will generate regularization noise. |
| **Auto-checkout 21:00** | Open device "in" auto-closes at 21:00 IST for worked-hours — identical to face path. |
| **Payroll finalize** | Import **before** `finalize-attendance`; the run snapshots attendance. |
| **`time_tracking` flag** | Use `Manual` / `Biometric` to know which employees to expect device punches for — and to skip alerting on face-only staff. |

---

## 19. Security & privacy

- **Biometric data never leaves the device.** Fingerprint templates stay on the
  terminal; the app stores only User ID + time + In/Out. This is a **lighter** privacy
  burden than the webcam-face system (which stores 128-float descriptors + consent
  columns). Still, note it in the employee-consent policy.
- **Mode C endpoint is the attack surface.** It's public → validate `SN` against
  `device_terminals`, use a per-device secret/token, allow-list source IPs where
  possible, rate-limit, and **never** trust the tenant from the payload — derive it from
  the registered serial.
- **Spoofed punches.** Without device auth, anyone could POST fake ATTLOG rows and
  fabricate attendance → payroll fraud. Device registration + token is mandatory for C.
- **Attendance-number reassignment.** If an employee leaves and their number is reused,
  old device logs could attach to the new person. Retire numbers or gate by
  `date_of_joining` / employee `status`.

---

## 20. Operational edge cases (build a plan for each)

| Case | Handling |
|---|---|
| Employee not yet enrolled on device | Their punches simply won't exist; HR sees a gap → regularize or enroll. |
| Employee **leaves** | Delete/disable them on the device; app import guards on employee `status`. |
| Re-enrollment / new finger | No app change — same User ID keeps the mapping. |
| Wrong-branch device | An employee punching at another branch's terminal → punch maps by number, lands under **their** branch (from the employee, not the device). Decide if that's allowed. |
| Device clock drift | Periodically sync device time (Mode B/C can push time); §5.1 is the manual fallback. |
| Device memory full | Terminals overwrite oldest logs → export/pull often enough (or Mode C real-time). |
| Duplicate scan (double-tap) | Two punches seconds apart → normaliser + a small dedupe window collapses accidental doubles. |
| Multiple devices, one branch | Tag each punch with `device_serial`; the employee mapping still resolves by number. |

---

## 21. Rollout plan (pilot → cutover)

1. **Phase 0–3 built** (Mode A working in staging).
2. **Pilot one branch, one device.** Enroll ~5 employees; run device **in parallel** with
   the existing face clock for 1–2 weeks.
3. **Reconcile daily** (see §22) — device punches vs face punches vs expected.
4. Fix mapping/timezone/normalise issues found in the pilot.
5. **Cutover** the pilot branch to device-primary; keep face as fallback.
6. Roll to more branches; add Mode B/C only where real-time is needed.

> Never big-bang all branches — attendance errors are visible to every employee and
> flow straight to their payslip.

---

## 22. Monitoring & reconciliation (post go-live)

- **Daily unmatched-ID report** — device User IDs with no `attendance_number` (someone
  enrolled but not mapped).
- **Coverage check** — device-tracked (`time_tracking=Biometric`) employees with **zero**
  punches on a working day → likely a device/enrollment problem, not absence.
- **Odd-punch report** — days ending on an unpaired "in" (forgot to check out) before
  payroll finalise.
- **Import audit** — keep every import summary (imported/skipped/unmatched) for dispute
  resolution.

---

## 23. Face clock vs ESSL device (how the two coexist)

| | Webcam Face (existing) | ESSL Fingerprint (new) |
|---|---|---|
| Where | Any browser, self-service | Fixed terminal at the door |
| Matches | In-app (128-float descriptor, ≤0.55) | On the device (fingerprint template) |
| Identifies by | Logged-in user (`user_id`) | Device User ID → `attendance_number` |
| App receives | Face descriptor + GPS | User ID + time + In/Out |
| Punch `method` | `face` → BIOMETRIC | `device` → BIOMETRIC |
| Needs enrollment | Face register in-app | Fingerprint enroll on device |
| Marks who uses it | — | `time_tracking = Biometric` |

They can run **side-by-side** — same employee, same day, both feeding one alternating
timeline. Decide policy: device-primary with face as fallback, or per-employee by
`time_tracking`.

---

## 24. Rough effort estimate

| Scope | Rough size |
|---|---|
| Phase 0 (migration + extract service + uniqueness) | Small |
| Phase 1 (normaliser) + Phase 2 (import endpoint + screen) | Medium — **Mode A shippable** |
| Phase 3 (verify + test matrix) | Small |
| Phase 4 (Mode B connector app) | Medium (separate Windows app) |
| Phase 5 (Mode C ADMS endpoint + device registry) | Large |

**Minimum viable ESSL integration = Phases 0–3 (Mode A).** Everything after is an
upgrade to real-time; the core normalise/map/store logic is shared across all modes.

---

## 25. YOUR ACTUAL DEVICE (from the on-site photos, 2026-07-27)

The physical unit on hand — read straight off its screens.

| Field | Value |
|---|---|
| Device name | `x2008` (eSSL) |
| Platform | `ZLM60_TFT` |
| Firmware version | **`8.0.4.3-20230515`** |
| System version | `22.5.10-20170306` |
| Push Service | `2.0.33S-20220613` ✅ (ADMS/push capable) |
| Bio Service | `2.1.12-20170420` |
| Fingerprint algorithm | `Finger VX10.0` |
| **Serial Number** | **`NFZ8252004771`** ← the `SN` for Mode C device→branch binding |
| MAC | `00:17:61:11:13:ae` |
| **Capacity** | Users **2000**, Fingerprints **2000**, T&A records **2,000,000** |
| Current usage | 7 users · 8 fingerprints · 73 records (basically empty — test unit) |
| **Network** | Static IP **`192.168.1.201`**, mask `255.255.255.0`, GW `192.168.1.1`, DNS `192.168.1.1`, DHCP **OFF** |
| **TCP COMM port** | **`4370`** (Mode B ready) |
| Main-menu items | User Mgt · User Role · COMM · System · Personalize · Data Mgt · Access Control · USB Manager |

### 🔴 Critical finding — the device is already pushing to Keka

`COMM → Cloud Server Setting` currently reads:

| Setting | Current value on the device |
|---|---|
| Server Mode | **ADMS** (ON) |
| Enable Domain Name | ON |
| **Server Address** | **`cin3.a.keka.com`** ← **Keka HRMS** |
| Enable Proxy Server | OFF |
| HTTPS | ON |

**What this means:**
1. **Mode C is proven on this exact unit.** Keka ingests via the same iclock/ADMS
   protocol described in §17 — the device already does real-time push successfully.
2. **Repointing `Server Address` to our app will STOP the Keka sync.** Only do this if
   the Keka integration is a test/not in production. (See the decision at the end.)
3. Because the unit is nearly empty (7 users, 73 records), it looks like a **test/eval
   device** — good for a pilot.

### Recommended path for THIS device: **Mode C (ADMS push)** — testable on the LAN

Since the device is already ADMS-capable **and** sits on a static LAN IP, you do **not**
need a public server to pilot it. If the XAMPP dev machine is on the **same `192.168.1.x`
LAN**, the device can push straight to it:

`COMM → Cloud Server Setting`:
| Setting | Set to (local pilot) |
|---|---|
| Server Mode | `ADMS` |
| Enable Domain Name | **OFF** (use a raw IP) |
| Server Address | **`<dev-PC LAN IP>`** e.g. `192.168.1.50` |
| Server Port | **`8000`** (the `php artisan serve` port) |
| Enable Proxy Server | OFF |
| HTTPS | **OFF** (local dev has no TLS) |

Then build the Laravel iclock endpoint (§17). The device will POST punches to the local
app over the LAN — full real-time testing, no internet, no public host. For production,
swap in a public domain + HTTPS and register the serial → branch.

> Keep the eSSL Serial **`NFZ8252004771`** — it's what the Mode C endpoint uses to know
> which tenant/branch a push belongs to (`device_terminals.serial`).

---

## 26. Concrete next-step build (Mode C receiver, minimal)

To ingest from this device, add (Phase 0 first, then):

1. **Public routes** (in the public block of `routes/api.php`, NOT behind Sanctum — the
   device can't authenticate):
   ```
   Route::match(['get','post'], '/iclock/cdata',      [EsslDeviceController::class, 'cdata']);
   Route::get                  ('/iclock/getrequest', [EsslDeviceController::class, 'getrequest']);
   ```
2. **`EsslDeviceController`:**
   - `cdata()` — on `GET` (handshake) reply the options string; on `POST ...&table=ATTLOG`
     parse the tab-delimited body → hand rows to the Phase-1 **normaliser** → reply `OK`.
   - `getrequest()` — reply `OK` (no queued commands) so the device keeps polling.
3. **Guard it:** look up `SN` in `device_terminals`; reject unknown serials; log every hit;
   derive `client_id`/`branch_id` from the registered serial (never from the payload).
4. **Reuse** the same map→UTC→normalise→upsert service as the CSV path — one code path.

This is the smallest change that turns the on-hand device into a live feed. Everything
else (CSV import, HR screen, reconciliation) layers on top.

---

### Key code locations (for the developer)
- Punch creation + alternation + summary: `app/Http/Controllers/Api/AttendanceController.php` → `facePunch()` (959), `recomputeSummary()` (1081). _Extract in Phase 0._
- `attendance_number` column: `database/migrations/2026_05_01_000006_add_employee_extended_fields.php:38`.
- `method` enum: `database/migrations/2026_05_12_060843_create_attendance_punches_table.php:42`.
- HR sheet emits `attendanceNumber`: `AttendanceController.php:588`. UI `BIOMETRIC` source: `resources/js/pages/hrms/HrAttendance.tsx:80`.
- Roadmap note: `docs/HR_ATTENDANCE.md:307`.
