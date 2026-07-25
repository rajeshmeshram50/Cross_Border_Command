# SOURCING TYPE MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Sourcing Type

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base path `/api/master/sourcing_type`; middleware `auth:sanctum` + `user.active`.
- Auth: `Authorization: Bearer <sanctum_token>`.
- Permission module `master.sourcing_type` (super admin bypasses).
- Responses are **bare** (no envelope), ordered `id DESC`, with flattened `client_name` / `branch_name` / `creator_name`.
- `?search=` runs ILIKE across text/select fields; `?branch_id=` narrows (client roles only).
- Empty strings persist as NULL; validation errors return HTTP 422 `{message, errors}`.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/sourcing_type` |
| GET | `/api/master/sourcing_type/{id}` |
| POST | `/api/master/sourcing_type` |
| PUT | `/api/master/sourcing_type/{id}` |
| DELETE | `/api/master/sourcing_type/{id}` |
| GET | `/api/master/sourcing_type/next-code` → `{ "code": null }` |

---

## 3. LIST / READ

`GET /api/master/sourcing_type?search=spot`

```json
[
  {
    "id": 5,
    "client_id": 12,
    "branch_id": 4,
    "type_code": "SPOT",
    "type_name": "Spot",
    "quotation_required": "Mandatory — Min 1 Quote",
    "approval_required": "Yes",
    "urgency_flag": "Urgent",
    "status": "Active",
    "created_by": 88,
    "created_at": "2026-07-20T09:12:00.000000Z",
    "updated_at": "2026-07-20T09:12:00.000000Z",
    "client_name": "IGC GROUP",
    "branch_name": "Pune",
    "creator_name": "Rajesh",
    "creator_user_type": "branch_user"
  }
]
```

---

## 4. CREATE / UPDATE

`POST /api/master/sourcing_type`

```json
{
  "type_code": "OPEN",
  "type_name": "Open Market",
  "quotation_required": "Mandatory — Min 3 Quotes",
  "approval_required": "Yes",
  "urgency_flag": "Normal",
  "status": "Active"
}
```

`422` — duplicate code (uEach, per-field):
```json
{ "message": "The given data was invalid.",
  "errors": { "type_code": ["This Type code is already registered. Please use a different value."] } }
```

`422` — invalid enum: `{ "errors": { "quotation_required": ["The selected quotation required is invalid."] } }`

`PUT /api/master/sourcing_type/{id}` — same body; hierarchy locks may return `403`.

---

## 5. DELETE

`DELETE /api/master/sourcing_type/{id}` → `{ "message": "Deleted" }` (hard delete). `403` if hierarchy denies.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List / search | `GET /master/sourcing_type?search=` |
| Create | `POST /master/sourcing_type` |
| Update | `PUT /master/sourcing_type/{id}` |
| Delete | `DELETE /master/sourcing_type/{id}` |

---

## 7. NOTES

- `urgency_flag` is optional and may echo back as `null`.
- Both `type_code` and `type_name` are unique (case-insensitive, tenant-scoped).

---
*Related documents: SOURCING_TYPE_FUNCTIONAL_DOCUMENTATION.md, SOURCING_TYPE_TECHNICAL_DOCUMENTATION.md, SOURCING_TYPE_CODE_WALKTHROUGH.md*
