# APPROVAL AUTHORITY MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Approval Authority

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api/master/approval_authority`; `auth:sanctum` + `user.active`; Bearer token.
- Permission module `master.approval_authority` (super admin bypasses).
- Bare responses, `id DESC`, flattened `client_name/branch_name/creator_name`.
- `?search=` ILIKE across text/select fields; `?branch_id=` narrows (client roles).
- Empty strings → NULL; 422 `{message, errors}` on validation failure.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/approval_authority` |
| GET | `/api/master/approval_authority/{id}` |
| POST | `/api/master/approval_authority` |
| PUT | `/api/master/approval_authority/{id}` |
| DELETE | `/api/master/approval_authority/{id}` |
| GET | `/api/master/approval_authority/next-code` → `{ "code": null }` |

---

## 3. LIST / READ

`GET /api/master/approval_authority`

```json
[
  {
    "id": 2,
    "client_id": 12,
    "branch_id": null,
    "role_name": "Purchase Manager",
    "module_scope": "Purchase Order",
    "min_value": "50001.0000",
    "max_value": "500000.0000",
    "currency": "INR",
    "escalate_to": "Director",
    "status": "Active",
    "created_by": 88,
    "created_at": "2026-07-20T09:12:00.000000Z",
    "updated_at": "2026-07-20T09:12:00.000000Z",
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Admin",
    "creator_user_type": "client_admin"
  }
]
```

---

## 4. CREATE / UPDATE

`POST /api/master/approval_authority`

```json
{
  "role_name": "Finance Manager",
  "module_scope": "Payment",
  "min_value": 100001,
  "max_value": 1000000,
  "currency": "INR",
  "escalate_to": "Director",
  "status": "Active"
}
```

`422` — composite duplicate (role_name + module_scope):
```json
{ "message": "The given data was invalid.",
  "errors": { "role_name": ["A record with this combination of role_name + module_scope already exists."] } }
```

`422` — missing required ceiling: `{ "errors": { "max_value": ["The max value field is required."] } }`

`PUT /api/master/approval_authority/{id}` — same body; `403` on hierarchy denial.

---

## 5. DELETE

`DELETE /api/master/approval_authority/{id}` → `{ "message": "Deleted" }` (hard delete). `403` if the row belongs to a higher tier.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List / search | `GET /master/approval_authority?search=` |
| Create | `POST /master/approval_authority` |
| Update | `PUT /master/approval_authority/{id}` |
| Delete | `DELETE /master/approval_authority/{id}` |

---

## 7. NOTES

- Uniqueness is the **combination** of role + module scope, not each field alone.
- Value fields echo back as decimal strings.

---
*Related documents: APPROVAL_AUTHORITY_FUNCTIONAL_DOCUMENTATION.md, APPROVAL_AUTHORITY_TECHNICAL_DOCUMENTATION.md, APPROVAL_AUTHORITY_CODE_WALKTHROUGH.md*
