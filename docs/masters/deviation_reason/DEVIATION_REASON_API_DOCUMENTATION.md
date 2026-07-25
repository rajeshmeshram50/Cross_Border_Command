# OVERRIDE / DEVIATION REASON MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Override / Deviation Reason

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base path `/api/master/deviation_reason`; middleware `auth:sanctum` + `user.active`.
- Auth: `Authorization: Bearer <sanctum_token>`.
- Permission module `master.deviation_reason` (super admin bypasses).
- Responses are **bare** (no envelope), ordered `id DESC`, with flattened `client_name` / `branch_name` / `creator_name`.
- `?search=` runs ILIKE across text/select fields; `?branch_id=` narrows (client roles only).
- Empty strings persist as NULL; validation errors return HTTP 422 `{message, errors}`.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/deviation_reason` |
| GET | `/api/master/deviation_reason/{id}` |
| POST | `/api/master/deviation_reason` |
| PUT | `/api/master/deviation_reason/{id}` |
| DELETE | `/api/master/deviation_reason/{id}` |
| GET | `/api/master/deviation_reason/next-code` → `{ "code": null }` |

---

## 3. LIST / READ

`GET /api/master/deviation_reason?search=price`

```json
[
  {
    "id": 7,
    "client_id": 12,
    "branch_id": 4,
    "reason_code": "PO-PRICE",
    "reason_name": "Price variance approved",
    "module": "Purchase Order",
    "attachment_required": "Yes",
    "requires_approval": "Yes",
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

`POST /api/master/deviation_reason`

```json
{
  "reason_code": "GRN-QTY",
  "reason_name": "Short quantity accepted",
  "module": "GRN",
  "attachment_required": "Yes",
  "requires_approval": "No",
  "status": "Active"
}
```

`422` — duplicate code (uEach, per-field):
```json
{ "message": "The given data was invalid.",
  "errors": { "reason_code": ["This Reason code is already registered. Please use a different value."] } }
```

`422` — invalid enum (note backend expects `"Vendor Comparison"`, not `"Supplier Comparison"`): `{ "errors": { "module": ["The selected module is invalid."] } }`

`PUT /api/master/deviation_reason/{id}` — same body; hierarchy locks may return `403`.

---

## 5. DELETE

`DELETE /api/master/deviation_reason/{id}` → `{ "message": "Deleted" }` (hard delete). `403` if hierarchy denies.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List / search | `GET /master/deviation_reason?search=` |
| Create | `POST /master/deviation_reason` |
| Update | `PUT /master/deviation_reason/{id}` |
| Delete | `DELETE /master/deviation_reason/{id}` |

---

## 7. NOTES

- The `module` value must be one of `Purchase Order`, `Vendor Comparison`, `VTI`, `GRN`, `Payment`, `All` — the frontend label "Supplier Comparison" maps to backend "Vendor Comparison".
- Both `reason_code` and `reason_name` are unique (case-insensitive, tenant-scoped).

---
*Related documents: DEVIATION_REASON_FUNCTIONAL_DOCUMENTATION.md, DEVIATION_REASON_TECHNICAL_DOCUMENTATION.md, DEVIATION_REASON_CODE_WALKTHROUGH.md*
