# DESIGNATIONS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Designations

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api`; `auth:sanctum` + `user.active`; `Authorization: Bearer <token>`.
- Bare responses (no `{data}`); rows flattened with `client_name/branch_name/creator_name/creator_user_type`.
- Errors: HTTP 422 `{ message, errors }`.

## 2. ENDPOINT INDEX

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/designations` | List (?search=, ?branch_id=) |
| POST | `/master/designations` | Create |
| GET | `/master/designations/next-code` | `{ "code": null }` |
| GET | `/master/designations/{id}` | Show |
| PUT | `/master/designations/{id}` | Update |
| DELETE | `/master/designations/{id}` | Soft delete |

## 3. LIST / READ

`GET /api/master/designations`

```json
[
  {
    "id": 8,
    "client_id": 12,
    "branch_id": null,
    "name": "Senior Software Engineer",
    "code": "DGN-08",
    "department_id": 1,
    "level": "Executive",
    "reports_to_id": 3,
    "status": "Active",
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Admin",
    "creator_user_type": "client_admin"
  }
]
```

## 4. CREATE / UPDATE

`POST /api/master/designations`

```json
{
  "name": "Senior Software Engineer",
  "department_id": 1,
  "level": "Executive",
  "reports_to_id": 3,
  "status": "Active"
}
```

- Do **not** send `code` — auto-assigned (`DGN-##`) by the model on create if blank.
- Returns `201`. `PUT /api/master/designations/{id}` uses the same body.

**Master-specific 422 errors:**

| Trigger | Field | Message |
|---|---|---|
| Duplicate designation name (case-insensitive) | name | `This Name is already registered. Please use a different value.` |
| Missing required | name / level / status | `The <field> field is required.` |
| Bad level | level | `The selected level is invalid.` |
| Bad status | status | `The selected status is invalid.` |

## 5. DELETE

`DELETE /api/master/designations/{id}` → `{ "message": "Deleted" }` (soft). Tier gate via `hierarchicalDenial`. No in-use guard.

## 6. QUICK REFERENCE

```
GET    /api/master/designations
POST   /api/master/designations
GET    /api/master/designations/{id}
PUT    /api/master/designations/{id}
DELETE /api/master/designations/{id}
```

## 7. NOTES

- `next-code` returns `{code: null}` — `DGN-##` is assigned by the model hook at save.
- Only `name` is unique (case-insensitive).
- `reports_to_id` references another designation (self-referential reporting line); `department_id` references the Department master.

---
*Related documents: DESIGNATIONS_FUNCTIONAL_DOCUMENTATION.md, DESIGNATIONS_TECHNICAL_DOCUMENTATION.md, DESIGNATIONS_CODE_WALKTHROUGH.md*
