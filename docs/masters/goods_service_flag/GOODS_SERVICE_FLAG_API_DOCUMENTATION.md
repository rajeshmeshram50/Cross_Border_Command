# GOODS VS SERVICE FLAG MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Goods vs Service Flag

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base path `/api/master/goods_service_flag`; middleware `auth:sanctum` + `user.active`.
- Auth: `Authorization: Bearer <sanctum_token>`.
- Permission module `master.goods_service_flag` (super admin bypasses).
- Responses are **bare** (no envelope), ordered `id DESC`, with flattened `client_name` / `branch_name` / `creator_name`.
- `?search=` runs ILIKE across text/select fields; `?branch_id=` narrows (client roles only).
- Empty strings persist as NULL; validation errors return HTTP 422 `{message, errors}`.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/goods_service_flag` |
| GET | `/api/master/goods_service_flag/{id}` |
| POST | `/api/master/goods_service_flag` |
| PUT | `/api/master/goods_service_flag/{id}` |
| DELETE | `/api/master/goods_service_flag/{id}` |
| GET | `/api/master/goods_service_flag/next-code` → `{ "code": null }` |

---

## 3. LIST / READ

`GET /api/master/goods_service_flag?search=service`

```json
[
  {
    "id": 3,
    "client_id": 12,
    "branch_id": 4,
    "flag_code": "SERVICE",
    "flag_name": "Service / Job Work",
    "grn_screen": "Service Completion — Date + Proof Doc",
    "evidence_type": "Completion Certificate",
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

`POST /api/master/goods_service_flag`

```json
{
  "flag_code": "GOODS",
  "flag_name": "Physical Goods",
  "grn_screen": "Physical Receipt — Qty + Batch + Warehouse",
  "evidence_type": "Delivery Challan",
  "status": "Active"
}
```

`422` — duplicate code (uEach, per-field):
```json
{ "message": "The given data was invalid.",
  "errors": { "flag_code": ["This Flag code is already registered. Please use a different value."] } }
```

`422` — invalid enum: `{ "errors": { "grn_screen": ["The selected grn screen is invalid."] } }`

`PUT /api/master/goods_service_flag/{id}` — same body; hierarchy locks may return `403`.

---

## 5. DELETE

`DELETE /api/master/goods_service_flag/{id}` → `{ "message": "Deleted" }` (hard delete). `403` if hierarchy denies.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List / search | `GET /master/goods_service_flag?search=` |
| Create | `POST /master/goods_service_flag` |
| Update | `PUT /master/goods_service_flag/{id}` |
| Delete | `DELETE /master/goods_service_flag/{id}` |

---

## 7. NOTES

- Both `flag_code` and `flag_name` are unique (case-insensitive, tenant-scoped).
- `grn_screen` is the switch that selects the GRN capture form; `evidence_type` names the attachment that proves completion.

---
*Related documents: GOODS_SERVICE_FLAG_FUNCTIONAL_DOCUMENTATION.md, GOODS_SERVICE_FLAG_TECHNICAL_DOCUMENTATION.md, GOODS_SERVICE_FLAG_CODE_WALKTHROUGH.md*
