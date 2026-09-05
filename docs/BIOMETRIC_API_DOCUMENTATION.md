# HRMS Biometric — API Documentation

> Complete REST reference for every biometric endpoint: face enrolment, face clock-in/out, face login, device push (ADMS/iclock), punch import and the terminal registry.
> Source of truth: [routes/api.php](../routes/api.php) and [routes/web.php](../routes/web.php).
> Audience: QA, integrators, connector authors — anyone hitting these routes directly (Postman / device / script).
>
> _Last updated: 2026-09-04._

---

## 0. How to read this

- **Base URL:** API routes are prefixed with `/api` by Laravel — `POST /login/face` is really `POST /api/login/face`. The device push routes are the **exception**: they live at the **web root** (`/iclock/*`, no `/api`) because the terminal hard-codes that path.
- **Local base:** `http://127.0.0.1:8000/api` · **Live:** `https://cbc.idims.in/api`
- **Auth:** unless a route is listed under §1 (Public), send `Authorization: Bearer <sanctum_token>`.
- **Response shapes:**
  - Single item → `{ "data": {...} }`
  - Paginated list → Laravel paginator envelope (`data`, `current_page`, `total`, …)
  - Validation failure → **422** `{ "message": "...", "errors": { "field": ["..."] } }`
  - Business rejection (face mismatch, wrong punch direction) → **422** with a hint payload, *not* 400
  - Auth failure → **401** (the SPA wipes the token and redirects to `/login`)
  - Permission denial → **403** with a human-readable `message`
- **Timezone:** every timestamp is stored **UTC**; the display timezone is **`Asia/Kolkata`** (`AttendanceController::DISPLAY_TZ`). "Today" server-side means today *in IST*.
- **Descriptor:** wherever `descriptor` appears it is a **128-element array of floats**, each between **−5 and 5**, produced by face-api.js. A near-zero ("degenerate") vector is rejected before matching.

---

## 1. Public routes (no token)

| Method | Path | Middleware | Purpose |
|---|---|---|---|
| POST | `/api/login/face` | `throttle:20,1` | Face login — returns a Sanctum token |
| GET/POST | `/iclock/cdata` | `throttle:120,1`, CSRF-exempt | Device handshake + ATTLOG punch push |
| GET | `/iclock/getrequest` | `throttle:120,1` | Device polls for queued commands |
| POST | `/iclock/devicecmd` | `throttle:120,1` | Device posts command results |

> The `/iclock/*` block is declared in `routes/web.php` **above** the SPA catch-all (otherwise the React fallback view would swallow it) and is CSRF-exempt in `bootstrap/app.php`. It has **no authentication** — a terminal cannot send a token — so tenant safety comes entirely from the Serial → `device_terminals` registry.

---

## 2. `POST /api/login/face` — face login

**Public.** Rate-limited `20/min/IP` (shared with `/login` and `/google-login`).

**Request**

```json
{
  "email": "ravi@acme.com",
  "descriptor": [0.021, -0.113, "… 128 floats …"],
  "client_id": 12
}
```

| Field | Rules |
|---|---|
| `email` | required, valid email |
| `descriptor` | required, array, **exactly 128** items, each numeric between −5 and 5 |
| `client_id` | optional integer — only needed to resolve a multi-organisation email (see below) |

**Matching rules**

- Threshold **0.50** (stricter than the 0.55 used for attendance — a false match here hands over a session).
- The email may exist in **several tenants**. Every matching account's enrolled descriptor is compared and all matches under threshold are collected.
- **Active accounts win.** If any matching account is `active`, inactive matches are discarded, so a disabled look-alike account cannot shadow the real one.
- If more than one **organisation** still matches, the response is **409 `needs_org_selection`** and the client re-posts with `client_id`.

**Responses**

| Code | Body / meaning |
|---|---|
| 200 | `{ token, user: {...} }` — same envelope as password login |
| 409 | `{ "needs_org_selection": true, "organizations": [{ "client_id", "name" }] }` |
| 422 | `{ "errors": { "descriptor": ["That face capture was not usable…"] } }` — degenerate vector |
| 422 | `{ "errors": { "email": ["Face login is not available for this account. Try password login."] } }` — no account with that email has a face enrolled (deliberately generic: it does not reveal whether the email exists) |
| 422 | Face on file but nothing matched within 0.50 |
| 422 | `Too many failed login attempts. Try again in 15 minutes.` — brute-force lock |

**Gates applied after a successful match** (identical to password login): account active, organisation active, branch active, and the **brute-force counter on the same cache key** (`login_attempts:<lowercased email>`), so an attacker cannot dodge the lockout by switching from password to face. Lockout is `5` failures / `15` minutes and is itself gated by the `security.bruteForce` setting.

---

## 3. Face enrolment

All three routes are Sanctum-protected and accept an **optional `employee_id`**; omitted means "act on my own employee row".

### 3.1 `GET /api/face/status`

```json
{
  "employee_id": 41,
  "employee_name": "Ravi Kumar",
  "employee_code": "EMP-014",
  "photo_url": "https://…/storage/…jpg",
  "registered": true,
  "registered_at": "2026-08-11T06:31:22+00:00",
  "consent_given_at": "2026-06-02T09:12:04+00:00",
  "consent_revoked_at": null,
  "biometric_status": "Registered"
}
```

The raw descriptor is **never** returned — only the boolean `registered`. `photo_url` is the ordinary onboarding profile photo, unrelated to the biometric.

### 3.2 `POST /api/face/register`

```json
{
  "descriptor": ["… 128 floats …"],
  "consent": true,
  "employee_id": 41
}
```

| Field | Rules |
|---|---|
| `descriptor` | required, exactly 128 numerics, each −5…5, and **not degenerate** (magnitude ≥ 0.1) |
| `consent` | required, must be **accepted** (`true` / `1` / `"yes"`) — Laravel's `accepted` rule |
| `employee_id` | optional; supplying someone else's id requires `can_edit` on `hr.employee` |

**Server behaviour**

1. Rejects a **disabled** employee (soft-deleted or terminal status) — restore them first.
2. **Duplicate-face guard:** scans every *other* employee in the tenant that has a face on file (including soft-deleted ones) and refuses if any is within **0.50** — one face may belong to exactly one employee. The scan and the write happen inside one transaction with a row lock, so two simultaneous enrolments of the same face cannot both pass.
3. Writes `face_descriptor`, `face_registered_at`, `biometric_status = 'Registered'`, clears `face_consent_revoked_at`, and stamps `face_consent_given_at` **only on the first enrolment**.

| Code | Meaning |
|---|---|
| 200 | `{ message, registered: true, registered_at }` |
| 403 | Cross-tenant target, or missing `can_edit` on `hr.employee` when acting on someone else |
| 404 | No employee linked to the account / employee not found |
| 422 | Consent missing, bad or degenerate descriptor, disabled employee, or **duplicate face** (the message names the conflicting employee) |

### 3.3 `DELETE /api/face/data`

Revokes consent and erases the biometric footprint:

- `face_descriptor` → `null`, `face_registered_at` → `null`, `biometric_status` → `Not Registered`, `face_consent_revoked_at` → now.
- `face_consent_given_at` is **kept** (regulators want both ends of the lifecycle).
- Every historical `match_distance` on that employee's punches and attendance rows is **nulled** — consent covers biometric-derived data, not just the live descriptor. The attendance rows themselves survive.

Returns `200 { "message": "Face data deleted." }`.

---

## 4. Attendance reads

| Method | Path | Who | Returns |
|---|---|---|---|
| GET | `/api/attendance` | HR / admin (`hr.attendance` view permission) | Paginated tenant-scoped rows with punches, employee, branch. Filters: `date`, `from`, `to`, `employee_id`, `status`, `branch_id`, `per_page` (default 50) |
| GET | `/api/attendance/daily-view` | HR / admin | The HR Attendance sheet for one `date` (defaults to today, clamped so a future date is impossible) plus a 90-day history window for the month pills and calendar |
| GET | `/api/attendance/my` | Any employee | Own history, paginated (`from`, `to`, `per_page` default 30) |
| GET | `/api/attendance/today` | Any employee | Today's row + punches + clock-in helper flags (below) |
| GET | `/api/attendance/employee/{employeeId}/summary` | Self, or HR with access | Employee Profile → Attendance tab |

### 4.1 `GET /api/attendance/today`

```json
{
  "date": "2026-09-04",
  "employee": { "id": 41, "emp_code": "EMP-014", "name": "Ravi Kumar", "face_registered": true },
  "record": { "…attendance row with punches…" },
  "next_direction": "out",
  "allowed_labels": ["Check In", "Check Out"],
  "auto_cutoff_at": "2026-09-04T21:00:00+05:30",
  "overtime_applicable": true,
  "shift_end_at": "2026-09-04T18:30:00+05:30",
  "overtime_seconds": 0
}
```

| Field | Meaning |
|---|---|
| `next_direction` | `in` or `out` — **server truth**, derived from the last stored punch. The SPA uses it to decide which button to show; the server re-checks it anyway. |
| `allowed_labels` | The current label set — **`Check In` / `Check Out` only**. (The original six-label set — Step Out, Lunch In, Meeting… — was simplified; the column still accepts any `varchar(50)`.) |
| `auto_cutoff_at` | When an open punch is auto-closed: shift end + 1 h, or 21:00 IST when no shift resolves. For an overtime-applicable employee there is no auto-logout — this is the next shift start, at which an unclosed day forfeits its overtime. |
| `overtime_seconds` | Live/provisional while still clocked in; forfeited if the day is never closed. |

### 4.2 `GET /api/attendance/employee/{employeeId}/summary`

Accepts a **numeric id or an employee code**; the code lookup is tenant-scoped (two tenants may both have `EMP-001`). Returns `employee`, `month`, `stats { present_days, late_marks, missing_biometric, total_leaves }`, `today` and `history[]`.

| Code | Meaning |
|---|---|
| 403 | Cross-tenant employee |
| 404 | Unknown employee |
| 200 | A bad `month` parameter falls back to the current month rather than erroring |

### 4.3 Branch scoping on the list endpoints

A **branch user is hard-pinned** to their own branch — passing a sibling `branch_id` cannot leak another branch's attendance. Only client admins may use the `branch_id` filter, and the branch must belong to their client. Super-admins may filter freely. Malformed `date` / `from` / `to` values return **422** rather than silently yielding an empty list.

---

## 5. Face punch

### `POST /api/attendance/face/clock-in` · `POST /api/attendance/face/clock-out`

```json
{
  "descriptor": ["… 128 floats …"],
  "label": "Check In",
  "lat": 19.0760,
  "lng": 72.8777
}
```

| Field | Rules |
|---|---|
| `descriptor` | required, exactly 128 numerics, −5…5 |
| `label` | optional, ≤ 50 chars; defaults to `Check In` / `Check Out` by direction |
| `lat` / `lng` | optional; `lat` −90…90, `lng` −180…180. **Captured but not enforced** — there is no geo-fence yet |

**Guard order** (each returns 422 with a distinguishing flag):

| # | Guard | Response marker |
|---|---|---|
| 1 | Employee record disabled / terminated | `inactive: true` |
| 2 | Today is before `date_of_joining` | `before_joining: true` |
| 3 | No face enrolled | `need_enroll: true` |
| 4 | Distance > **0.55** | `matched: false`, plus `distance` and `threshold` |
| 5 | Wrong direction (server-derived) | `matched: true`, `next_direction: "in"\|"out"` and a plain-English hint |

Only after all five does it open a transaction, lock the day row, insert the punch with `method = 'face'` and the rounded `match_distance`, and recompute the daily summary.

**Success 200**

```json
{
  "message": "Clocked in successfully.",
  "matched": true,
  "distance": 0.3412,
  "punch":  { "id": 9912, "direction": "in", "label": "Check In", "punched_at": "…", "method": "face" },
  "record": { "…attendance row with punches…" },
  "next_direction": "out"
}
```

> The client **cannot choose the direction**. Calling `/clock-in` when the server expects `out` is rejected — which is exactly what makes the strict in→out alternation trustworthy.

---

## 6. `POST /api/attendance/import` — device punch import (Modes A and B)

**Auth:** Sanctum **and administrators only** — `super_admin` or `client_admin` (the Mode B connector is provisioned as a `client_admin` service account). Any other role gets **403 "Only administrators can import attendance."** A bulk import can write attendance for any employee in the tenant, so a regular employee must never reach it.

**Request** — a multipart file **or** an inline JSON array:

| Field | Rules |
|---|---|
| `file` | optional, ≤ **5 MB**. AttLog (`.dat` / `.txt`) or CSV, tab- **or** comma-delimited, header row optional |
| `punches[]` | optional array; each item needs `user_id` and `punched_at`, with optional `status` |
| `device_terminal_id` | optional — when given, the import inherits that terminal's **branch, timezone and serial** (the terminal must belong to the caller's client) |
| `branch_id` | optional, used only when no terminal is chosen |
| `timezone` | optional IANA zone; defaults to `Asia/Kolkata` |

```json
{
  "device_terminal_id": 3,
  "timezone": "Asia/Kolkata",
  "punches": [
    { "user_id": "101", "punched_at": "2026-07-27 09:03:12", "status": "0" },
    { "user_id": "101", "punched_at": "2026-07-27 18:31:40", "status": "1" }
  ]
}
```

File-parsing rules: a line is split on TAB if one is present, else on comma. Column 1 = User ID, column 2 = datetime, column 3 = status. A line whose second column lacks both a digit and a date separator (`-` `:` `/`) is treated as a header and skipped. The serial recorded for a file import with no terminal is the literal **`CSV-IMPORT`**.

**Response 200**

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
    ],
    "payslips_recomputed": 3,
    "affected_employee_ids": [41, 52, 63]
  }
}
```

**`errors[].reason` values you can receive**

| Reason | Cause |
|---|---|
| `before date_of_joining` | The punch predates the employee's joining date |
| `employee not attendance-eligible` | Employee is Terminated / Resigned, or `attendance_tracking` is off |
| `unparseable timestamp` | Not `Y-m-d H:i[:s]`, or an impossible clock time such as `25:00:00` |
| `payroll for this month is locked (paid) — post an adjustment in the next cycle` | The month's payroll cycle is **locked**; changing its basis after payment is refused (PAY-50) |

**Other codes**

| Code | Meaning |
|---|---|
| 403 | Caller is not an administrator |
| 422 | `No punch rows found. Expected tab/comma-delimited: UserID, DateTime, Status.` |
| 422 | No client could be resolved for the caller |
| 404 | `device_terminal_id` is not a terminal of the caller's client |

**Behaviours worth knowing when testing**

- **Idempotent.** A punch already stored at the same `employee_id` + `punched_at` counts as `skipped_duplicates`. Soft-deleted punches also block re-insert, so a deliberately deleted correction is not resurrected by the device re-pushing its buffer.
- **Leading zeros are tolerated.** Device `001` matches employee `1` (numeric ids only; alphanumeric badge ids are matched literally).
- **Nothing is silently dropped** — every row lands in exactly one of `imported`, `skipped_duplicates`, `unmatched_user_ids` or `errors`.
- **Payslips are recomputed.** Employees whose punches changed have their **draft / generated** payslips recalculated in place. Approved, paid and locked runs are never rewritten.
- **Tenant comes from the caller**, never from the file. If no client can be resolved, the import aborts rather than running an unscoped lookup.

---

## 7. `/api/device-terminals` — terminal registry

Sanctum-protected, tenant-scoped. Registered as an `apiResource` limited to **index, store, update, destroy** (there is no `show`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/device-terminals` | List. Filters: `search` (serial or name, case-insensitive), `branch_id`, and `client_id` for super-admins. Ordered by `last_seen_at` desc, then name |
| POST | `/api/device-terminals` | Register a terminal → **201** |
| PUT | `/api/device-terminals/{id}` | Update |
| DELETE | `/api/device-terminals/{id}` | Soft-delete → `{ "message": "Terminal removed." }` |

**Payload**

| Field | Rules |
|---|---|
| `serial` | **required**, ≤ 64 chars, unique among non-deleted terminals |
| `name` | optional, ≤ 100 chars |
| `branch_id` | optional; must belong to the same client (else 422) |
| `timezone` | optional, valid IANA zone; defaults `Asia/Kolkata` |
| `allowed_ips` | optional, ≤ 255 chars — comma-separated list. **Blank means accept ANY source IP** |
| `is_active` | optional boolean, default `true` |

`client_id` is **always derived** from the caller (super-admins may target one explicitly) and is **immutable on update** — a terminal never changes tenant. A client admin can only see and edit their own client's terminals.

---

## 8. `/iclock/*` — the device push protocol (Mode C)

Public, plain text, `throttle:120,1`. A real terminal polls roughly every 30 s and pushes a handful of rows per punch, so the limit is generous headroom.

| Step | Device request | Server response |
|---|---|---|
| Handshake | `GET /iclock/cdata?SN=<serial>&options=all` | The options block (below), `text/plain` |
| Command poll | `GET /iclock/getrequest?SN=<serial>` | `OK` |
| **Punch push** | `POST /iclock/cdata?SN=<serial>&table=ATTLOG`, tab-delimited body | `OK: <rows received>` |
| Command result | `POST /iclock/devicecmd` | `OK` |

**Handshake body**

```
GET OPTION FROM: <serial>
Stamp=9999
OpStamp=9999
ErrorDelay=60
Delay=30
TransTimes=00:00;23:59
TransInterval=1
TransFlag=1111000000
Realtime=1
Encrypt=0
```

`TimeZone` is deliberately **omitted** so the device keeps its own clock — the server converts local → UTC using the terminal's configured timezone.

**ATTLOG body**

```
101<TAB>2026-07-27 09:03:12<TAB>0<TAB>1<TAB>0
101<TAB>2026-07-27 18:31:40<TAB>1<TAB>1<TAB>0
```

Field 1 = User ID, field 2 = datetime (its internal space is safe because fields are TAB-separated), field 3 = status code. At most **5000 rows** are accepted from one push (a DoS/memory guard); anything beyond is dropped and the device re-sends on its next cycle.

**Acceptance rules — everything returns HTTP 200**

| Condition | Ingested? | Response |
|---|---|---|
| Serial registered, active, IP permitted | ✅ yes | `OK: <n>` |
| Serial unknown or `is_active = false` | ❌ no | `OK` (logged as a warning) |
| Source IP not on the terminal's `allowed_ips` | ❌ no | `OK` (logged) |
| `table` is `OPERLOG` / `ATTPHOTO` / anything else | ❌ no | `OK` |

> **This is the single most important QA nuance of the device path:** the endpoint **always answers `OK`**, even when it refuses the data — otherwise the terminal would loop and re-buffer. "The device said OK" is *not* evidence a punch was ingested. Confirm in `storage/logs/laravel.log` (`[eSSL] ATTLOG ingested`) and on the HR Attendance sheet.

The terminal's `last_seen_at` is stamped on the handshake and on every accepted push — the Biometric Devices screen shows it, and it is the quickest way to prove the device is reaching the server at all.

---

## 9. Postman / curl quick reference

```bash
# 1. Log in (password) and keep the token
curl -s -X POST http://127.0.0.1:8000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@acme.com","password":"secret"}'

# 2. Register a terminal
curl -s -X POST http://127.0.0.1:8000/api/device-terminals \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"serial":"NFZ8252004771","name":"Front door","branch_id":2,"timezone":"Asia/Kolkata","is_active":true}'

# 3. Import punches as JSON (idempotent — run it twice)
curl -s -X POST http://127.0.0.1:8000/api/attendance/import \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"device_terminal_id":3,"punches":[{"user_id":"101","punched_at":"2026-09-04 09:03:12","status":"0"}]}'

# 4. Import an AttLog file
curl -s -X POST http://127.0.0.1:8000/api/attendance/import \
  -H "Authorization: Bearer $TOKEN" -F 'file=@AttLog.dat' -F 'device_terminal_id=3'

# 5. Simulate a device push (no auth — note the tab separators)
curl -s -X POST 'http://127.0.0.1:8000/iclock/cdata?SN=NFZ8252004771&table=ATTLOG' \
  --data-binary $'101\t2026-09-04 09:03:12\t0\t1\t0'

# 6. Simulate the handshake
curl -s 'http://127.0.0.1:8000/iclock/cdata?SN=NFZ8252004771&options=all'
```

A ready-made collection lives at [ESSL_Attendance.postman_collection.json](ESSL_Attendance.postman_collection.json) — set `base_url` and run Login → import → iclock in order.

---

## 10. Status-code cheat sheet

| Code | When you will see it here |
|---|---|
| **200** | Success — **and** every `/iclock/*` reply, including refusals |
| **201** | Terminal registered |
| **401** | Missing or expired Sanctum token |
| **403** | Non-admin calling `/attendance/import`; cross-tenant employee; missing `can_edit` on `hr.employee` for someone else's face |
| **404** | No employee linked to the account; unknown employee; terminal not in the caller's client |
| **409** | Face login matched more than one organisation → `needs_org_selection` |
| **422** | Validation, face mismatch, wrong punch direction, missing consent, duplicate face, disabled employee, before joining date, empty import file |
| **429** | Throttle — `20/min` on the login group, `120/min` on `/iclock/*` |
