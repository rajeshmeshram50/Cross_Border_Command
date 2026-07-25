# DEPARTMENT MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Department Master

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
| GET | `/master/departments` | List (?search=, ?branch_id=) |
| POST | `/master/departments` | Create |
| GET | `/master/departments/next-code` | Next `DEPT-###` |
| GET | `/master/departments/{id}` | Show |
| PUT | `/master/departments/{id}` | Update |
| DELETE | `/master/departments/{id}` | Soft delete |

## 3. LIST / READ

`GET /api/master/departments`

```json
[
  {
    "id": 4,
    "client_id": 12,
    "branch_id": 3,
    "name": "Software Development",
    "code": "DEPT-004",
    "parent_id": 1,
    "head": "Gaurav Jagtap",
    "email": "sd@enterprise.com",
    "status": "Active",
    "client_name": "IGC GROUP",
    "branch_name": "Pune HQ",
    "creator_name": "Branch Admin",
    "creator_user_type": "branch_user"
  }
]
```

`GET /api/master/departments/next-code` → `{ "code": "DEPT-005", "prefix": "DEPT-" }`

## 4. CREATE / UPDATE

`POST /api/master/departments`

```json
{
  "name": "Software Development",
  "code": "DEPT-004",
  "parent_id": 1,
  "head": "Gaurav Jagtap",
  "email": "sd@enterprise.com",
  "status": "Active"
}
```

- The `code` is normally taken from `next-code` and submitted with the form.
- Returns `201`. `PUT /api/master/departments/{id}` uses the same body (uEach ignores the current id).

**Master-specific 422 errors:**

| Trigger | Field | Message |
|---|---|---|
| Duplicate name (case-insensitive) | name | `This Name is already registered. Please use a different value.` |
| Duplicate code | code | `This Code is already registered. Please use a different value.` |
| Missing required | name / code / status | `The <field> field is required.` |
| Bad status enum | status | `The selected status is invalid.` |

## 5. DELETE

`DELETE /api/master/departments/{id}` → `{ "message": "Deleted" }` (soft). Tier gate via `hierarchicalDenial`. No in-use guard (roles/designations/employees referencing the department are not checked).

## 6. QUICK REFERENCE

```
GET    /api/master/departments
GET    /api/master/departments/next-code
POST   /api/master/departments
GET    /api/master/departments/{id}
PUT    /api/master/departments/{id}
DELETE /api/master/departments/{id}
```

## 7. NOTES

- `DEPT-###` is per-tenant — each client/branch has its own DEPT-001…N series.
- Both `name` and `code` are independently unique (case-insensitive).
- `parent_id` builds a self-referential department tree.

---
*Related documents: DEPARTMENTS_FUNCTIONAL_DOCUMENTATION.md, DEPARTMENTS_TECHNICAL_DOCUMENTATION.md, DEPARTMENTS_CODE_WALKTHROUGH.md*
