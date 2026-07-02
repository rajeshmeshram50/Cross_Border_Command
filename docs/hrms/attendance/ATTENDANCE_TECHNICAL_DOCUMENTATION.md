# ATTENDANCE MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Attendance (face clock-in & punch records)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Attendance is a **face-based, multi-punch** time system: employees clock in/out with a face descriptor (`face-api.js`), each tap is a `AttendancePunch` under a daily `Attendance` row, and punch direction must **strictly alternate in→out**. HR reviews a daily console; employees can request **regularization** (corrections) through a manager-approval flow. Times are stored UTC and rendered in the tenant timezone (IST). There is **no separate FaceBiometric table** — the 128-d descriptor is a JSON column on `employees`.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  ClockIn.tsx      (employee face clock-in + intraday timeline + geo)   │
│  HrAttendance.tsx (HR daily-view console + logs/calendar + regularize) │
│  face-api.js → 128-d descriptor                                       │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  AttendanceController: today/my/faceClockIn/faceClockOut/index/        │
│    dailyView/employeeSummary  (multi-punch, strict alternation,        │
│    late detection, 9 PM auto-checkout)                                │
│  FaceBiometricController: status/register/revoke (enroll dedup 0.50)   │
│  AttendanceRegularizationController: submit/approve/reject/cancel      │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  attendances (1/employee/day; status enum) ─ hasMany ─ attendance_    │
│    punches (each tap; in/out) · employees.face_descriptor (JSON)      │
│  attendance_regularizations (correction requests)                     │
│  Feeds: PayrollService attendanceAggregates (Present/Late/Missing)    │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/
  AttendanceController.php               # punch + review + summary
  FaceBiometricController.php            # face enroll/status/revoke
  AttendanceRegularizationController.php # correction workflow
app/Models/Attendance.php · AttendancePunch.php   # (face descriptor lives on Employee)
database/migrations/
  2026_05_12_042451_create_attendances_table.php
  2026_05_12_060843_create_attendance_punches_table.php
  2026_05_12_042448_add_face_biometric_to_employees.php
  2026_06_30_000010_create_attendance_regularizations_table.php
resources/js/pages/ClockIn.tsx · pages/hrms/HrAttendance.tsx
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum |
| Biometrics | face-api.js (browser) → 128-d descriptor; Euclidean-distance match server-side |
| Time | Stored UTC; rendered `Asia/Kolkata` (IST) |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) · geolocation + reverse-geocode |

---

## 3. KEY CONSTANTS & INVARIANTS
| Constant | Value | Meaning |
|---|---|---|
| Attendance face match | **0.55** | `AttendanceController::MATCH_THRESHOLD` (Euclidean); > 0.55 → 422 no-match |
| Enroll dedup / face login | **0.50** | `FaceBiometricController::DUPLICATE_THRESHOLD` (stricter) |
| Descriptor length | 128 | validated on punch/enroll |
| Display TZ | Asia/Kolkata | UTC stored, IST on read |
| Shift default | 09:30–18:30 (540 min) | late = first-in > shift+10min |
| Late grace | 10 min | Present → Late promotion (read-time) |
| Auto-checkout cap | 21:00 IST | forgotten clock-outs bounded at 9 PM |
| **7 punch labels** | Check In · Step Out · Step In · Lunch Out · Lunch In · Meeting · Check Out | `KNOWN_LABELS` |

**Core invariant:** punch direction **strictly alternates** `in → out → in → out`; two same-direction punches are rejected (422 with `next_direction`).

---

## 4. DATABASE SCHEMA

### 4.1 `attendances` (SoftDeletes; one row per employee/day)
`UNIQUE(employee_id, attendance_date)`. Columns: tenancy (`client_id`/`branch_id`/`user_id` FKs), `employee_id` (FK cascade), `attendance_date` (indexed), `check_in_at`/`check_out_at`, `check_in_method`/`check_out_method` (enum face/manual/auto), `check_in_match_distance`/`check_out_match_distance` (decimal 5,4), ip/lat/lng (in & out), **`status`** enum (default Present) = Present · Late · Half Day · Missing In · Missing Out · Weekly Off · Holiday · On Duty · Work From Home · Absent · Leave · Corrected, `notes`.

### 4.2 `attendance_punches` (SoftDeletes; one per tap)
`attendance_id` (FK cascade), `employee_id` (FK cascade), `punched_at` (indexed), `direction` (enum in/out), `label` (default Check In), `method` (enum face/manual/auto), `match_distance`, ip/lat/lng, `notes`.

### 4.3 `employees` face columns
`face_descriptor` (**json**, `$hidden`), `face_registered_at`, `face_consent_given_at`, `face_consent_revoked_at`, `biometric_status`. Plus `attendance_tracking`, `shift`, `weekly_off`, `attendance_number`.

### 4.4 `attendance_regularizations`
`employee_id`/`attendance_id`, `regularization_date`, `mode` (enum adjust/exempt), `type`, `work_locations` (json), `punches` (json), `reason`, `status` (enum Pending/Approved/Rejected/Cancelled), `approval_chain` (json), `current_approval_level`, approver fields. **No DB FKs** (bare unsignedBigInteger).

---

## 5. MODELS

### Attendance (`app/Models/Attendance.php`)
SoftDeletes. `appends`: `total_worked_seconds`, `next_direction`, `punches_count`. Relations: employee/user/client/branch, `punches` hasMany (ordered by `punched_at`). Work-time engine: `WORK_TZ=Asia/Kolkata`, `AUTO_CHECKOUT_HOUR=21:00`; `getNextDirectionAttribute` ('in' if empty/last-out else 'out'); epoch-based worked-seconds to avoid Carbon 3 signed-diff.

### AttendancePunch (`app/Models/AttendancePunch.php`)
SoftDeletes. Relations: attendance, employee. `punched_at`/`match_distance`/`lat`/`lng` cast.

> **No `FaceBiometric` model/table** — the descriptor is `employees.face_descriptor` (JSON, `$hidden`).

---

## 6. API ENDPOINTS CONFIGURATION

```php
// PUBLIC
Route::post('/login/face', [AuthController::class, 'faceLogin']);   // login threshold 0.50

Route::middleware(['auth:sanctum','user.active'])->group(function () {
    // Face biometric
    Route::get   ('/face/status',   [FaceBiometricController::class, 'status']);
    Route::post  ('/face/register', [FaceBiometricController::class, 'register']);
    Route::delete('/face/data',     [FaceBiometricController::class, 'revoke']);
    // Attendance
    Route::get ('/attendance',                                [AttendanceController::class, 'index']);
    Route::get ('/attendance/daily-view',                     [AttendanceController::class, 'dailyView']);
    Route::get ('/attendance/my',                             [AttendanceController::class, 'my']);
    Route::get ('/attendance/today',                          [AttendanceController::class, 'today']);
    Route::get ('/attendance/employee/{employeeId}/summary',  [AttendanceController::class, 'employeeSummary']);
    Route::post('/attendance/face/clock-in',                  [AttendanceController::class, 'faceClockIn']);
    Route::post('/attendance/face/clock-out',                 [AttendanceController::class, 'faceClockOut']);
    // Regularization
    Route::get ('/regularizations',            [AttendanceRegularizationController::class, 'index']);
    Route::post('/regularizations',            [AttendanceRegularizationController::class, 'store']);
    Route::get ('/regularizations/approvals',  [AttendanceRegularizationController::class, 'approvals']);
    Route::get ('/regularizations/{id}',       [AttendanceRegularizationController::class, 'show']);
    Route::get ('/regularizations/{id}/approvers', [AttendanceRegularizationController::class, 'approvers']);
    Route::post('/regularizations/{id}/approve',   [AttendanceRegularizationController::class, 'approve']);
    Route::post('/regularizations/{id}/reject',    [AttendanceRegularizationController::class, 'reject']);
    Route::post('/regularizations/{id}/cancel',    [AttendanceRegularizationController::class, 'cancel']);
});
```
Full detail in **ATTENDANCE_API_DOCUMENTATION.md**.

---

## 7. CONTROLLER ANALYSIS

### 7.1 AttendanceController
| Method | Purpose |
|---|---|
| `today` / `my` | Caller's own record today / paginated history |
| `faceClockIn` / `faceClockOut` | `facePunch(expected='in'/'out')` — the core write |
| `index` | Admin list (employees blocked → use `/attendance/my`); tenant/branch-pinned |
| `dailyView` | HR console per-employee day payload (worked minutes, compliance, logs) |
| `employeeSummary` | Month stats + logs (self/admin), late/missing/present |

**`facePunch` pipeline:** validate 128-d descriptor → enrollment guard (422 `need_enroll`) → Euclidean match vs stored (>0.55 → 422) → **transaction + `lockForUpdate`** on the day row → server-truth `next_direction` → **strict alternation** (422 if mismatch) → default label by direction → create `AttendancePunch` (UTC) → `recomputeSummary` (first-in / last-out) → return.

### 7.2 FaceBiometricController
`status` (never returns the raw descriptor), `register` (consent required; **dedup ≤ 0.50** against other tenant faces; 422 if disabled), `revoke` (wipes descriptor + consent, anonymizes stored match distances).

### 7.3 AttendanceRegularizationController
Correction workflow — single reporting-manager level, **no self-approval**, auto-approve when the manager is missing/self-loop. `adjust` mode **replaces** the day's punches (re-flattened, alternation enforced); `exempt` changes no punches.

**Scoping:** branch users hard-pinned to their own branch; client admins may filter by branch; super-admins see all. Attendance APIs rely on `user_type` + tenant checks (menu-level `hr.attendance` governs visibility).

---

## 8. FRONTEND

### 8.1 `ClockIn.tsx`
Face capture (`FaceCapture`/`FaceRegistrationModal`), direction from `next_direction`, quick-label chips filtered per direction, geolocation (30s refresh + reverse-geocode) sent with each punch. Today's Summary + live worked timer (capped at 9 PM) + intraday punch timeline. Endpoints: `GET /attendance/today`, `POST /attendance/face/clock-in|out`.

### 8.2 `HrAttendance.tsx`
Daily-view console: left employee list (status filters), right KPI cards (Present Days, Late Marks, Missing Punches, Compliance %), day record card (live timer), intraday timeline (BIOMETRIC/MANUAL/WEB badges), logs + calendar view, and the regularization modal/approvals. Endpoint: `GET /attendance/daily-view?date=`.

---

## 9. INTEGRATION: PAYROLL
`PayrollService::attendanceAggregates` reads `attendances` for the cycle window, promotes Present→Late (>shift+10min), derives missing punches (one-sided pair), and feeds present/late/missing into payslips (see `docs/payroll/`, and the #34/#36 fixes).

---

## 10. SECURITY & CAVEATS
1. **Face thresholds differ:** attendance match 0.55; enroll-dedup/face-login 0.50.
2. **Descriptor is `$hidden`** and never returned; revoke anonymizes historical match distances.
3. **Strict alternation** + day-row `lockForUpdate` prevent double-tap races.
4. **Times UTC**, rendered IST; late detection uses a 09:30 default + 10-min grace.
5. **Regularization** has no self-approval; `adjust` replaces the day's punches.
6. **No FaceBiometric table** (descriptor on `employees`); `attendance_regularizations` has no DB FKs.
7. Attendance APIs are `user_type`/tenant-gated (menu `hr.attendance` governs `can_view`).

---

## 11. METRICS
| Metric | Value |
|---|---|
| Controllers | 3 (Attendance, FaceBiometric, Regularization) |
| Punch labels | 7 |
| Status values | 12 |
| DB transactions | facePunch / applyApprovedAdjustment |
| Test coverage | none automated |

---

*Related documents: ATTENDANCE_FUNCTIONAL_DOCUMENTATION.md · ATTENDANCE_CODE_WALKTHROUGH.md · ATTENDANCE_API_DOCUMENTATION.md*
