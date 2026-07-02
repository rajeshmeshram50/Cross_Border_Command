# LEAVE MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Leave
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS
- Auth: `auth:sanctum` + `user.active`. Menu slugs `hr.leave` / `hr.leave_approvals` gate the UI; the API enforces **tenant scope + chain/role authorization** (`can_act_now`, no self-approval), not the slug.
- Leave **types** are served via generic `/master/leave_type`.
- Responses use `{ data: ... }`.
- Status codes: 200/201 · 401 · 403 · 404 · 422 (validation / balance / overlap / cap).

---

## 2. ENDPOINT INDEX

### Requests
| Method | Path |
|---|---|
| GET/POST | `/leave-requests` |
| GET | `/leave-requests/approvals` · `/leave-requests/colleagues` |
| GET | `/leave-requests/{id}` · `/{id}/approvers` |
| POST | `/leave-requests/{id}/approve` · `/reject` · `/cancel` · `/hr-view` |

### Plans / types / balances
| Method | Path |
|---|---|
| GET/POST/PUT/DELETE | `/leave-plans` · `/leave-plans/{id}` |
| POST | `/leave-plans/{id}/clone` · `/make-default` · `/types` · `/employees` |
| PUT | `/leave-plans/{id}/types/{typeId}/config` |
| DELETE | `/leave-plans/{id}/types/{typeId}` · `/employees/{employeeId}` |
| GET | `/leave-balances` · `/employees/{employeeId}/leave-balances` |

---

## 3. REQUESTS

### POST `/leave-requests`
```json
{ "employee_id"?: 88, "leave_type_id": 3, "from_date": "2026-07-10", "to_date": "2026-07-12",
  "day_type": "full", "reason": "Trip", "notify": [90],
  "handover_required": true, "cover_person_id": 40, "handover_notes": "…" }
```
`day_type` ∈ full/first_half/second_half. Enforced: type-in-plan, balance (quota+overdraft − used), half-day (single day + `allowHalfDay`), monthly cap, no overlap, no backdating, same-day → second_half only.
**Response 201:** `{ data: { …request…, status, approval_chain, current_approval_level } }` (auto-approved if the chain has no actionable level).
**Errors:** 403 · 422 (any rule).

### GET `/leave-requests/approvals?status=&branch_id=&search=`
The approvals queue; each row carries **`can_act_now`**. Default status Pending; `All` = no filter.

### POST `/leave-requests/{id}/approve` · `/reject`
`{ "comment"? }`. Only the current-level approver / super-admin (or HR when the RM is unavailable). **No self-approval.** Reject skips downstream levels. Approve advances / finalizes. → `{ data: row }`.

### POST `/leave-requests/{id}/cancel` · `/hr-view`
Cancel: owner/admin, Pending only. `hr-view`: HR marks the request reviewed (idempotent).

### GET `/leave-requests/{id}/approvers`
The full snapshotted chain with per-level status + `is_current`.

### GET `/leave-requests/colleagues?search=&branch_id=`
Lightweight employee search for the Notify field (own client + branch).

---

## 4. PLANS / TYPES / BALANCES

### POST `/leave-plans` · PUT `/leave-plans/{id}`
`{ plan_name, from_month_type (Calendar/If Joining), from_month, calendar_year, policy_explanation_mode, status, is_default }`. Edit locked once fully set up unless `unlocked` (clone).

### POST `/leave-plans/{id}/types` · PUT `/leave-plans/{id}/types/{typeId}/config`
Assign leave types; save the 6-tab `config_json` (accrual/leaveApp/approval/yearEnd/probation/noticePeriod).

### POST `/leave-plans/{id}/employees`
`{ "employee_ids": [1,2,3] }` — assigns (one plan per employee; moves off prior plan). → `{ assigned: n }`.

### GET `/employees/{employeeId}/leave-balances`
```json
{ "employee": {…},
  "types": [ { "leave_type_id": 3, "name": "Casual", "quota": 12, "extra": 0, "used": 4,
               "available": 8, "unlimited": false, "allow_half_day": true, "transactions": [ … ] } ] }
```

### GET `/leave-balances?department_id=&location=&search=&branch_id=`
Grid: dynamic columns (one per leave type) with `available = (quota+extra) − used` per employee.

---

## 5. ERROR EXAMPLES
**422 — over balance**
```json
{ "message": "…", "errors": { "days": ["You have only 2 day(s) of Casual Leave available."] } }
```
**403 — self-approval / out of turn**
```json
{ "message": "You can't approve this request — it's awaiting the reporting manager." }
```

---

## 6. QUICK REFERENCE
```
POST /leave-plans → /types → /types/{t}/config → /employees   # HR setup
POST /leave-requests                                          # employee applies
GET  /leave-requests/approvals                                # queue (can_act_now)
POST /leave-requests/{id}/approve|reject                      # manager decides
GET  /employees/{id}/leave-balances                           # balance ledger
```

---

## 7. NOTES (caveats)
1. HR is view-only on decisions (acts only if the RM is unavailable); no self-approval.
2. Half-day = 0.5 (single day + `allowHalfDay`); balance counts Approved + Pending.
3. Approved/rejected/cancelled recompute payroll (paid vs unpaid).
4. Leave types via `/master/leave_type`; delete guarded vs requests.
5. Notifications sent synchronously (no queue worker).

---

*Related documents: LEAVE_TECHNICAL_DOCUMENTATION.md · LEAVE_FUNCTIONAL_DOCUMENTATION.md · LEAVE_CODE_WALKTHROUGH.md*
