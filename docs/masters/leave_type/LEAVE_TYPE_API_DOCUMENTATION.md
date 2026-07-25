# LEAVE TYPE MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Leave Type Master

## DOCUMENT CONTROL

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. Conventions

- Base prefix `/api`. All routes require `Authorization: Bearer <sanctum_token>` and pass `auth:sanctum` + `user.active`.
- Per-action permission on module `master.leave_type` (super admins bypass).
- Responses are **bare** JSON (no `{data:…}` envelope). Lists are ordered `id DESC`.
- Rows are flattened with ownership names: `client_name`, `branch_name`, `creator_name`, `creator_user_type`.
- `?branch_id=` narrows results for switcher-capable roles; ignored for branch users/employees.
- Validation failures return **HTTP 422** with `{ message, errors: { field: [msg] } }`.

---

## 2. Endpoint Index

| Verb | Path |
|---|---|
| GET | `/api/master/leave_type` |
| POST | `/api/master/leave_type` |
| GET | `/api/master/leave_type/next-code` |
| GET | `/api/master/leave_type/{id}` |
| PUT | `/api/master/leave_type/{id}` |
| DELETE | `/api/master/leave_type/{id}` |
| GET | `/api/master-counts` |

---

## 3. List / Read

`GET /api/master/leave_type?search=sick`

Search matches text/select fields (`name`, `description`, `type`, `short_code`, `status`) via `ILIKE`.

```json
[
  {
    "id": 42,
    "client_id": 12,
    "branch_id": 5,
    "name": "Sick Leave",
    "description": "Medical leave",
    "type": "Incident Based Leave",
    "short_code": "SL",
    "is_sick_medical": true,
    "paid_unpaid": "Paid",
    "gender_restriction": "None",
    "status": "Active",
    "created_by": 88,
    "client_name": "IGC GROUP",
    "branch_name": "Mumbai",
    "creator_name": "Asha R",
    "creator_user_type": "branch_user"
  }
]
```

`GET /api/master/leave_type/{id}` returns a single row in the same shape.

---

## 4. Create / Update

`POST /api/master/leave_type`

```json
{
  "name": "Annual Leave",
  "type": "Regular",
  "short_code": "al",
  "is_sick_medical": "No",
  "paid_unpaid": "Paid",
  "gender_restriction": "None",
  "status": "Active"
}
```

- `short_code` is upper-cased server-side (`al` → `AL`) before validation and storage.
- `client_id` / `branch_id` / `created_by` are stamped from the token — never sent by the client.
- Returns **201** with the created row.

`PUT /api/master/leave_type/{id}` — same body; returns **200**.

### 422 examples

```json
{ "message": "The name field format is invalid.",
  "errors": { "name": ["Leave Type Name cannot contain special characters (only letters, numbers, spaces and . , - & ( ) / ' are allowed)."] } }
```

```json
{ "message": "...",
  "errors": { "short_code": ["Only letters and numbers are allowed (no spaces or special characters)."] } }
```

Duplicate (uEach, case-insensitive, per tenant):

```json
{ "errors": {
  "name": "This Name is already registered. Please use a different value.",
  "short_code": "This Short code is already registered. Please use a different value."
} }
```

---

## 5. Delete

`DELETE /api/master/leave_type/{id}` → `{ "message": "Deleted" }` (soft delete).

Blocked when leave requests reference the type:

```json
{ "errors": { "leave_type": ["Cannot delete this leave type — existing leave requests reference it. Archive it instead."] } }
```

Forbidden by hierarchy (row created by a higher tier) returns **403** with a denial message.

---

## 6. Quick Reference

| Need | Call |
|---|---|
| List types | `GET /master/leave_type` |
| Search | `GET /master/leave_type?search=al` |
| Add | `POST /master/leave_type` |
| Edit | `PUT /master/leave_type/{id}` |
| Remove | `DELETE /master/leave_type/{id}` |
| Counts | `GET /master-counts` |

---

## 7. Notes

- `next-code` returns `{ "code": null }` — leave types have no auto-sequenced code.
- Uniqueness is scoped per `(client_id, branch_id)`, so the same name/code may recur across branches.
- The React form posts only `name`, `type`, `short_code`, `status`; the extra optional fields are API-only.

---

*Related documents: LEAVE_TYPE_FUNCTIONAL_DOCUMENTATION.md, LEAVE_TYPE_TECHNICAL_DOCUMENTATION.md, LEAVE_TYPE_CODE_WALKTHROUGH.md*
