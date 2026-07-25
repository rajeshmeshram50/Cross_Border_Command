# MATCH EXCEPTION TYPE MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Match Exception Type

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base path `/api/master/match_exception`; middleware `auth:sanctum` + `user.active`.
- Auth: `Authorization: Bearer <sanctum_token>`.
- Permission module `master.match_exception` (super admin bypasses).
- Responses are **bare** (no envelope), ordered `id DESC`, with flattened `client_name` / `branch_name` / `creator_name` / `creator_user_type`.
- `?search=` runs ILIKE across text/select fields; `?branch_id=` narrows (client roles only).
- Empty strings persist as NULL; validation errors return HTTP 422 `{message, errors}`.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/match_exception` |
| GET | `/api/master/match_exception/{id}` |
| POST | `/api/master/match_exception` |
| PUT | `/api/master/match_exception/{id}` |
| DELETE | `/api/master/match_exception/{id}` |
| GET | `/api/master/match_exception/next-code` → `{ "code": null }` |

---

## 3. LIST / READ

`GET /api/master/match_exception?search=price`

```json
[
  {
    "id": 7,
    "client_id": 12,
    "branch_id": 4,
    "exc_code": "PRICE-VAR",
    "exc_name": "Price Variance",
    "tolerance_pct": "2.5000",
    "blocks_payment": "Yes — Hard Block",
    "resolver_role": "Procurement Manager",
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

`POST /api/master/match_exception`

```json
{
  "exc_code": "QTY-SHORT",
  "exc_name": "Quantity Shortfall",
  "tolerance_pct": 5,
  "blocks_payment": "Yes — Soft Block (Warning)",
  "resolver_role": "Warehouse Supervisor",
  "status": "Active"
}
```

`422` — duplicate code (uEach, per-field):
```json
{ "message": "The given data was invalid.",
  "errors": { "exc_code": ["This Exc code is already registered. Please use a different value."] } }
```

`422` — `tolerance_pct` out of range (0..100 bound):
```json
{ "message": "The given data was invalid.",
  "errors": { "tolerance_pct": ["The tolerance pct may not be greater than 100."] } }
```

`422` — invalid enum: `{ "errors": { "blocks_payment": ["The selected blocks payment is invalid."] } }`

`PUT /api/master/match_exception/{id}` — same body; hierarchy locks may return `403`.

---

## 5. DELETE

`DELETE /api/master/match_exception/{id}` → `{ "message": "Deleted" }` (hard delete). `403` if hierarchy denies.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List / search | `GET /master/match_exception?search=` |
| Create | `POST /master/match_exception` |
| Update | `PUT /master/match_exception/{id}` |
| Delete | `DELETE /master/match_exception/{id}` |

---

## 7. NOTES

- `tolerance_pct` echoes back as a decimal string (`decimal(18,4)`) and is bounded 0..100 server-side.
- Both `exc_code` and `exc_name` are unique (case-insensitive, tenant-scoped).

---
*Related documents: MATCH_EXCEPTION_FUNCTIONAL_DOCUMENTATION.md, MATCH_EXCEPTION_TECHNICAL_DOCUMENTATION.md, MATCH_EXCEPTION_CODE_WALKTHROUGH.md*
