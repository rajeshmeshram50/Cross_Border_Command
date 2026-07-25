# ROLES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Roles

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
| GET | `/master/roles` | List (?search=, ?branch_id=) |
| POST | `/master/roles` | Create |
| GET | `/master/roles/next-code` | `{ "code": null }` |
| GET | `/master/roles/{id}` | Show |
| PUT | `/master/roles/{id}` | Update |
| DELETE | `/master/roles/{id}` | Soft delete |

## 3. LIST / READ

`GET /api/master/roles`

```json
[
  {
    "id": 1,
    "client_id": 12,
    "branch_id": null,
    "name": "Approver",
    "code": "ROL-04",
    "role_type": "Ancillary",
    "department_id": 2,
    "role_category": "Compliance",
    "description": "Approves compliance documents",
    "status": "Active",
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Admin",
    "creator_user_type": "client_admin"
  }
]
```

## 4. CREATE / UPDATE

`POST /api/master/roles`

```json
{
  "name": "Approver",
  "role_type": "Ancillary",
  "department_id": 2,
  "role_category": "Compliance",
  "description": "Approves compliance documents",
  "status": "Active"
}
```

- Do **not** send `code` — it is auto-assigned (`ROL-##`) by the model on create if blank.
- Returns `201`. `PUT /api/master/roles/{id}` uses the same body.

**Master-specific 422 errors:**

| Trigger | Field | Message |
|---|---|---|
| Duplicate role name (case-insensitive) | name | `This Name is already registered. Please use a different value.` |
| Missing required | name / role_type / status | `The <field> field is required.` |
| Bad role_type | role_type | `The selected role type is invalid.` (only Primary/Ancillary) |
| Bad status | status | `The selected status is invalid.` |

## 5. DELETE

`DELETE /api/master/roles/{id}` → `{ "message": "Deleted" }` (soft). Tier gate via `hierarchicalDenial`. No in-use guard.

## 6. QUICK REFERENCE

```
GET    /api/master/roles
POST   /api/master/roles
GET    /api/master/roles/{id}
PUT    /api/master/roles/{id}
DELETE /api/master/roles/{id}
```

## 7. NOTES

- `next-code` returns `{code: null}` — the `ROL-##` code is assigned by the model hook at save, not pre-fetched.
- Only `name` is unique (case-insensitive); `code` can repeat.
- `department_id` references the Department master.

---
*Related documents: ROLES_FUNCTIONAL_DOCUMENTATION.md, ROLES_TECHNICAL_DOCUMENTATION.md, ROLES_CODE_WALKTHROUGH.md*
