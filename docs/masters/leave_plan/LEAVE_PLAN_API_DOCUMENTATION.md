# LEAVE PLAN MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Leave Plan Master

## DOCUMENT CONTROL

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. Conventions

- Base prefix `/api`. Every route requires `Authorization: Bearer <sanctum_token>` and passes `auth:sanctum` + `user.active`.
- Per-action permission on module `master.leave_plan` (super admins bypass).
- Responses are **bare** JSON (no envelope); lists ordered `id DESC`.
- Rows flattened with `client_name`, `branch_name`, `creator_name`, `creator_user_type`.
- `?branch_id=` narrows results for switcher-capable roles; ignored for branch users/employees.
- Validation errors return **HTTP 422** with `{ message, errors: { field: [msg] } }`.

---

## 2. Endpoint Index

| Verb | Path |
|---|---|
| GET | `/api/master/leave_plan` |
| POST | `/api/master/leave_plan` |
| GET | `/api/master/leave_plan/next-code` |
| GET | `/api/master/leave_plan/{id}` |
| PUT | `/api/master/leave_plan/{id}` |
| DELETE | `/api/master/leave_plan/{id}` |
| GET | `/api/master-counts` |

---

## 3. List / Read

`GET /api/master/leave_plan?search=default`

Search matches text/select fields (`plan_name`, `description`, `from_month_type`, `from_month`, `calendar_year`, `policy_explanation_mode`, `policy_doc_path`, `status`) via `ILIKE`.

```json
[
  {
    "id": 7,
    "client_id": 12,
    "branch_id": 5,
    "plan_name": "Default Plan 2026",
    "description": "Standard staff leave policy",
    "from_month_type": "Calendar",
    "from_month": "January",
    "calendar_year": "2026",
    "policy_explanation_mode": "System",
    "policy_doc_path": null,
    "is_default": true,
    "status": "Active",
    "created_by": 88,
    "client_name": "IGC GROUP",
    "branch_name": "Mumbai",
    "creator_name": "Asha R",
    "creator_user_type": "branch_user"
  }
]
```

`GET /api/master/leave_plan/{id}` returns a single row in the same shape.

---

## 4. Create / Update

`POST /api/master/leave_plan`

```json
{
  "plan_name": "Default Plan 2026",
  "description": "Standard staff leave policy",
  "from_month_type": "Calendar",
  "from_month": "January",
  "is_default": "Yes",
  "status": "Active"
}
```

If Joining mode omits `from_month`:

```json
{ "plan_name": "Anniversary Plan", "from_month_type": "If Joining", "status": "Active" }
```

- `client_id` / `branch_id` / `created_by` are stamped from the token; body `client_id` is ignored for non-super users.
- Returns **201** with the created row.

`PUT /api/master/leave_plan/{id}` — same body; returns **200**.

### 422 examples

Duplicate name (uFields, case-insensitive, per tenant):

```json
{ "errors": { "plan_name": "This Plan name is already registered. Please use a different value." } }
```

Invalid enum:

```json
{ "message": "The selected from_month_type is invalid.",
  "errors": { "from_month_type": ["The selected from_month_type is invalid."] } }
```

---

## 5. Delete

`DELETE /api/master/leave_plan/{id}` → `{ "message": "Deleted" }` (soft delete). A tier violation (row created by a higher tier and not your own) returns **403** with a denial message.

---

## 6. Quick Reference

| Need | Call |
|---|---|
| List plans | `GET /master/leave_plan` |
| Search | `GET /master/leave_plan?search=default` |
| Add | `POST /master/leave_plan` |
| Edit | `PUT /master/leave_plan/{id}` |
| Remove | `DELETE /master/leave_plan/{id}` |
| Counts | `GET /master-counts` |

---

## 7. Notes

- `next-code` returns `{ "code": null }` — leave plans have no auto-sequenced code.
- `from_month` is only meaningful under `from_month_type = Calendar` (frontend `showWhen`); the API accepts a plan without it.
- `plan_name` uniqueness is scoped per `(client_id, branch_id)`, so a name may recur across branches.
- The generic master form posts `plan_name`, `description`, `from_month_type`, `from_month`, `status`; other columns are API-only here.

---

*Related documents: LEAVE_PLAN_FUNCTIONAL_DOCUMENTATION.md, LEAVE_PLAN_TECHNICAL_DOCUMENTATION.md, LEAVE_PLAN_CODE_WALKTHROUGH.md*
