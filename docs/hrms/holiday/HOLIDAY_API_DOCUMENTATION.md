# HOLIDAY MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Holiday
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS
- Auth: `auth:sanctum` + `user.active`. Permission slug: **`hr.holiday`** (view/add/edit/delete; import = can_add). Super-admin bypasses. Branch users are branch-scoped.
- The employee calendar (`/employees/{id}/holidays`) uses the employee `can_view`/self gate, not `hr.holiday`.
- Status codes: 200/201 · 401 · 403 · 404 · 422 (validation / duplicate date / in-use delete).

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET/POST | `/holidays` | List / create |
| 2 | GET/PUT/DELETE | `/holidays/{id}` | Show / update / delete |
| 3 | GET | `/holidays/my` | My group's holidays (recurring-shifted) |
| 4 | POST | `/holidays/import` | Bulk import |
| 5 | GET/POST | `/holiday-groups` | List / create |
| 6 | GET/PUT/DELETE | `/holiday-groups/{id}` | Show / update / delete |
| 7 | GET | `/employees/{id}/holidays?year=` | Employee calendar |

---

## 3. HOLIDAYS

### GET `/holidays`
**Query:** `branch_id`, `holiday_group_id`, `search`, `type`, `year`.
**Response 200:** array `[{ id, code, name, date, type, is_recurring, description, holiday_group_id, group:{id,name}, creator:{id,name} }]`.

### POST `/holidays`
```json
{ "name": "Independence Day", "date": "2026-08-15", "type": "Public",
  "is_recurring": true, "description": "…", "holiday_group_id": 4 }
```
Validation: `name`* (≤191), `date`* (unique per group), `type` (Public/Restricted/Company/Regional/Optional, default Public), `is_recurring` (bool), `description` (≤1000), `holiday_group_id` (must be in scope).
**Response 201:** the holiday row (`code` `HOL-###`).
**Errors:** 403 · 422 (duplicate date in group).

### PUT `/holidays/{id}` · DELETE `/holidays/{id}`
Update propagates to the group's employees. **Delete → 422** if the holiday's group is assigned to ≥1 employee.

### GET `/holidays/my?year=YYYY`
Logged-in user's group holidays, recurring dates shifted to the year. Any authenticated user (employee-safe). Empty if no group.

### POST `/holidays/import`
```json
{ "rows": [ { "name": "Diwali", "date": "2026-11-08", "type": "Public", "recurring": "yes", "group": "Indian Employees", "description": "" } ],
  "holiday_group_id": 4 }
```
≤1000 rows. Unknown group name → row rejected; blank → falls back to `holiday_group_id`. De-dupes by (group|date).
**Response 200:** `{ "message": "…", "created": n, "skipped": m, "errors": [ { "row": i, "message": "…" } ] }`

---

## 4. HOLIDAY GROUPS

### GET `/holiday-groups`
**Query:** `search`, `status`, `branch_id`.
**Response 200:** array `[{ id, code, name, description, status, holidays_count, employees_count, creator }]`.

### POST `/holiday-groups`
`{ "name": "Indian Employees", "description": "…", "status": "Active" }` → 201 (`code` `HGRP-####`). Duplicate name (ci) per tenant → 422.

### DELETE `/holiday-groups/{id}`
**422** if ≥1 employee assigned. Otherwise ungroups its holidays (keeps them) and soft-deletes.
**Response 200:** `{ "message": "Holiday group removed. Its holidays were kept but ungrouped." }`

---

## 5. EMPLOYEE CALENDAR

### GET `/employees/{id}/holidays?year=YYYY`
Self or viewer (no `hr.holiday` grant needed).
**Response 200:** `{ "group": { "id": 4, "name": "Indian Employees" }, "year": 2026, "holidays": [ { "date": "2026-08-15", "name": "Independence Day", "type": "Public", "is_recurring": true } ] }`

---

## 6. ERROR EXAMPLES
**422 — in-use delete**
```json
{ "message": "This holiday's group is assigned to 12 employee(s) and can't be deleted." }
```
**422 — duplicate date**
```json
{ "message": "…", "errors": { "date": ["Holiday already exists for the selected date."] } }
```

---

## 7. QUICK REFERENCE
```
POST /holiday-groups                 # create a calendar (HGRP-####)
POST /holidays {holiday_group_id}    # add holidays (HOL-###)  or  POST /holidays/import
# assign employees via Employee form (holiday_group_id)
GET  /employees/{id}/holidays?year=  # employee calendar
GET  /holidays/my?year=              # my calendar
```

---

## 8. NOTES (caveats)
1. Both controllers gate on `hr.holiday`; the employee calendar uses the employee/self gate.
2. No DB foreign keys.
3. Delete guards protect assigned holidays/groups.
4. Recurring holidays repeat (re-anchored on read); `is_recurring` set via import only.
5. Holidays feed payroll (paid, never LOP) and attendance (excluded from compliance).

---

*Related documents: HOLIDAY_TECHNICAL_DOCUMENTATION.md · HOLIDAY_FUNCTIONAL_DOCUMENTATION.md · HOLIDAY_CODE_WALKTHROUGH.md*
