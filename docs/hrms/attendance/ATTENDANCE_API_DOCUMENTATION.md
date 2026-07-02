# ATTENDANCE MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Attendance
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>` (except face login)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS
- Auth: `auth:sanctum` + `user.active` (face login is public). APIs are user-type + tenant scoped; menu visibility via `hr.attendance`.
- Times stored UTC, shown IST. Face descriptors are 128-d arrays; match distance = Euclidean (attendance ≤ 0.55, enroll/login ≤ 0.50).
- Some reads return **bare arrays/objects** (not `{data}`).
- Status codes: 200/201 · 401 · 403 · 404 · 422 (validation / no-match / alternation / need_enroll).

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | POST | `/login/face` | Face login (public; threshold 0.50) |
| 2 | GET | `/face/status` | Enrolment status |
| 3 | POST | `/face/register` | Enrol/replace face (consent) |
| 4 | DELETE | `/face/data` | Revoke biometrics |
| 5 | GET | `/attendance/today` | Own record today |
| 6 | GET | `/attendance/my` | Own history (paginated) |
| 7 | POST | `/attendance/face/clock-in` · `/clock-out` | Punch in/out |
| 8 | GET | `/attendance` | Admin list |
| 9 | GET | `/attendance/daily-view` | HR daily console |
| 10 | GET | `/attendance/employee/{employeeId}/summary` | Month stats + logs |
| 11 | GET/POST | `/regularizations` (+ `/approvals`, `/{id}`, `/{id}/approvers`, `/{id}/approve|reject|cancel`) | Corrections |

---

## 3. FACE

### POST `/login/face` (public)
`{ "descriptor": [128 floats], "email"? }` → token (or `needs_org_selection`). Match threshold 0.50.

### GET `/face/status`
```json
{ "employee_id": 88, "employee_name": "Ravi", "registered": true, "registered_at": "…",
  "consent_given_at": "…", "consent_revoked_at": null, "biometric_status": "Registered", "photo_url": "…" }
```
(The raw descriptor is never returned.)

### POST `/face/register`
`{ "descriptor": [128 floats], "consent": true, "employee_id"? }` → `{ message, registered: true }`. **422** if a duplicate face (≤0.50) belongs to another employee, or if the employee is disabled.

### DELETE `/face/data`
Wipes descriptor + consent, anonymizes stored match distances. → `{ message }`.

---

## 4. PUNCH & RECORDS

### GET `/attendance/today`
```json
{ "date": "2026-07-01", "employee": { "id": 88, "emp_code": "EMP-013", "name": "Ravi", "face_registered": true },
  "record": { "check_in_at": "…", "check_out_at": null, "status": "Present", "punches": [ … ] },
  "next_direction": "out", "allowed_labels": ["Check In","Step Out","Step In","Lunch Out","Lunch In","Meeting","Check Out"] }
```

### POST `/attendance/face/clock-in` · `/clock-out`
`{ "descriptor": [128 floats], "label"?, "lat"?, "lng"? }`
**200:** `{ message, matched: true, distance, punch, record, next_direction }`
**422:** `{ message, matched: false, distance, threshold }` (no match) · `{ message, matched: true, next_direction }` (wrong direction) · `{ message, need_enroll: true }` (not enrolled).

### GET `/attendance/my?from=&to=`
Paginated own history (per_page 30).

### GET `/attendance` (admin; employees blocked)
**Query:** `date` / `from` / `to` (validated), `employee_id`, `status`, `branch_id`, `per_page` (50). Branch users pinned to their branch. Paginated with punches + employee + branch.

### GET `/attendance/daily-view?date=YYYY-MM-DD` (HR console)
Bare array of per-employee day payloads: `{ id, empCode, name, department, designation, shift, firstIn, lastOut, workedMinutes, presentDays, lateMarks, missingPunch, compliancePct, punches, logs, … }`.

### GET `/attendance/employee/{employeeId}/summary?month=YYYY-MM`
Self or admin (same tenant). `{ employee:{…,shift_start,shift_end}, month, stats:{present_days,late_marks,missing_biometric,total_leaves}, today, history, logs, … }`. `{employeeId}` accepts id or emp_code.

---

## 5. REGULARIZATION

| Method | Path | Purpose |
|---|---|---|
| GET | `/regularizations?employee_id=&status=` | History |
| POST | `/regularizations` | Submit a correction |
| GET | `/regularizations/approvals` | Pending queue (with `can_act_now`) |
| GET | `/regularizations/{id}` · `/{id}/approvers` | Detail / chain |
| POST | `/regularizations/{id}/approve` · `/reject` · `/cancel` | Decide / cancel |

### POST `/regularizations`
```json
{ "employee_id"?, "regularization_date": "2026-06-28", "mode": "adjust",
  "type": "Missed punch", "work_locations": [], "punches": [ { "in": "09:35", "out": "18:40" } ],
  "reason": "Forgot to clock out" }
```
`mode` ∈ adjust/exempt. No future date; one Pending per (employee, date); `adjust` needs ≥1 punch. Auto-approves if the reporting manager is missing/self. **201.**

### POST `/regularizations/{id}/approve`
Only the reporting manager or admin (no self-approval). An approved **adjust** deletes and replaces that day's punches. → serialized request.

---

## 6. ERROR EXAMPLES
**422 — wrong direction**
```json
{ "message": "You must clock out next.", "matched": true, "next_direction": "out" }
```
**422 — not enrolled**
```json
{ "message": "Please register your face first.", "need_enroll": true }
```

---

## 7. QUICK REFERENCE
```
POST /face/register                 # enrol (consent)
GET  /attendance/today              # next_direction + labels
POST /attendance/face/clock-in      # punch (alternates in→out)
POST /attendance/face/clock-out
GET  /attendance/daily-view?date=   # HR console
POST /regularizations               # correction → manager approves
```

---

## 8. NOTES (caveats)
1. Attendance match 0.55; enroll/login 0.50.
2. Strict in→out alternation; one row per employee/day.
3. Descriptor never returned; revoke anonymizes distances.
4. No FaceBiometric table; `attendance_regularizations` has no DB FKs.
5. Times UTC → IST; late uses 09:30 default + 10-min grace; 9 PM auto-checkout cap.

---

*Related documents: ATTENDANCE_TECHNICAL_DOCUMENTATION.md · ATTENDANCE_FUNCTIONAL_DOCUMENTATION.md · ATTENDANCE_CODE_WALKTHROUGH.md*
