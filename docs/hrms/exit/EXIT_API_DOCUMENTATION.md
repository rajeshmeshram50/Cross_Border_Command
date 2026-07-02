# EXIT MANAGEMENT MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Exit Management
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS

- All routes are authenticated (`auth:sanctum` + `user.active`) and nested under an employee.
- **Authorization:** the `master.employees` permission (`can_edit`) + same-tenant as the employee (super-admin bypasses).
- **Tenancy:** `client_id`/`branch_id` are copied from the employee — never taken from the body.
- Responses are flat objects (no `{data}` wrapper): `{ ...exit fields... }` or `{ message, exit }`.
- Status codes: 200 · 401 · 403 (cross-tenant / missing `master.employees` edit) · 404 · 422 (validation).

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/employees/{employee}/exit` | Get the exit record (lazily defaulted) |
| 2 | PUT | `/employees/{employee}/exit` | Save/update draft (any stage) |
| 3 | POST | `/employees/{employee}/exit/complete` | Finalize the exit |

---

## 3. ENDPOINT DETAIL

### 3.1 GET `/employees/{employee}/exit`
Returns the exit row, or a default shape if none exists (so the form always renders). The employee is resolved `withTrashed`.

**Response 200**
```json
{
  "id": 12, "employee_id": 88,
  "exit_type": "Resignation", "initiated_by": "Employee", "reason_for_exit": "Relocation",
  "other_reason": null, "notice_date": "2026-06-01", "last_working_day": "2026-06-30",
  "reporting_manager_id": 40,
  "reporting_manager": { "id": 40, "display_name": "Asha K", "emp_code": "EMP-004", "disabled": false },
  "comments": null, "business_impact": "Medium", "replacement_required": "Yes — Within 30 days",
  "clearances": [ { "type": "IT", "status": "Approved" } ],
  "asset_returns": [ { "asset": "Laptop", "status": "Handed Over" } ],
  "handover_notes": "…", "validation": [ ... ],
  "final_employee_status": null, "profile_lock": null,
  "exit_case_status": "Open", "hr_sign_off": "Pending",
  "stage_status": { "1": "done", "2": "in_progress" }, "current_stage": 2,
  "completed_at": null, "employee_status": "Notice Period", "updated_at": "…"
}
```

### 3.2 PUT `/employees/{employee}/exit`
Save/update draft. All fields nullable (stage-by-stage).

**Body (subset)**
```json
{
  "exit_type": "Resignation", "initiated_by": "Employee", "reason_for_exit": "Relocation",
  "notice_date": "2026-06-01", "last_working_day": "2026-06-30",
  "reporting_manager_id": 40, "business_impact": "Medium", "replacement_required": "No",
  "clearances": [ { "type": "IT", "status": "Pending" } ],
  "asset_returns": [ { "asset": "Laptop", "status": "Pending" } ],
  "handover_notes": "…", "validation": [], "current_stage": 2, "stage_status": {}
}
```
**Validation highlights:** `exit_type` in Resignation/Termination/Retirement/End of Contract/Absconding/Other; `initiated_by` in Employee/HR/Manager; `last_working_day` ≥ `notice_date`; `business_impact` in Low/Medium/High/Critical; `current_stage` 1–4; JSON arrays for clearances/asset_returns/validation/stage_status.

**Response 200:** `{ "message": "Saved", "exit": { …format… } }`
**Errors:** 401 · 403 · 422.

### 3.3 POST `/employees/{employee}/exit/complete`
Finalizes: forces `exit_case_status=Closed`, `current_stage=4`, `completed_at=now`; sets employee status to Resigned/Terminated; disables the login and revokes tokens; sends a farewell email (best-effort). Wrapped in a transaction.

**Body:** same shape as PUT (the final stage's data).

**Response 200**
```json
{ "message": "Exit completed — employee marked as exited and login disabled.",
  "exit": { "…": "…", "exit_case_status": "Closed", "current_stage": 4, "completed_at": "2026-06-30T18:30:00Z" } }
```
**Effects:**
- `employees.status` → `Terminated` (Termination/Absconding) or `Resigned` (all others).
- `users.status` → `inactive`; all Sanctum tokens revoked.
- Employee now excluded from regular payroll; Full & Final becomes available.

**Errors:** 401 · 403 · 422.

> The frontend enforces the completion gates (LWD reached, manager ok, assets handed over, exit docs Completed, clearances Approved, validations ticked, HR sign-off Approved) before calling this endpoint; the server forces the closure fields regardless.

---

## 4. RELATED ENDPOINTS (consumed by Stage 3 & Payroll)

| Method | Path | Purpose |
|---|---|---|
| GET | `/hr-document-templates/match?trigger_keyword=exit` | Match exit-trigger templates |
| POST | `/hr-document-signatures` (+ `/{id}/remind`, `/{id}/download-pdf`) | Send/track exit-document signatures |
| GET | `/payroll/fnf/{employeeId}` | Full & Final settlement (requires an exit record) — see `docs/payroll/` |

---

## 5. ERROR EXAMPLES

**403 — missing permission / cross-tenant**
```json
{ "message": "This action is unauthorized." }
```
**422 — validation**
```json
{ "message": "The last working day must be a date after or equal to notice date.",
  "errors": { "last_working_day": ["…"] } }
```

---

## 6. QUICK REFERENCE

```
GET  /employees/{id}/exit             # open (defaults if none)
PUT  /employees/{id}/exit             # save each stage
POST /employees/{id}/exit/complete    # finalize → Resigned/Terminated + login disabled
GET  /payroll/fnf/{id}                # then run Full & Final
```

---

## 7. NOTES (caveats)
1. Gated by `master.employees` edit (no dedicated exit permission).
2. `employee_exits` has no DB foreign keys.
3. Completion is reversible (re-activate the employee).
4. Status enum has no Retired/Exited (Retirement → Resigned).
5. Farewell email is best-effort; never blocks completion.

---

*Related documents: EXIT_TECHNICAL_DOCUMENTATION.md · EXIT_FUNCTIONAL_DOCUMENTATION.md · EXIT_CODE_WALKTHROUGH.md*
