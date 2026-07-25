# PAYMENT TERMS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Payment Terms

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base path `/api/master/payment_terms`; middleware `auth:sanctum` + `user.active`.
- Auth: `Authorization: Bearer <sanctum_token>`.
- Permission module `master.payment_terms` (super admin bypasses).
- Responses are **bare** (no envelope), ordered `id DESC`, with flattened `client_name` / `branch_name` / `creator_name`.
- `?search=` runs ILIKE across text/select fields; `?branch_id=` narrows (client roles only).
- Empty strings persist as NULL; validation errors return HTTP 422 `{message, errors}`.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/payment_terms` |
| GET | `/api/master/payment_terms/{id}` |
| POST | `/api/master/payment_terms` |
| PUT | `/api/master/payment_terms/{id}` |
| DELETE | `/api/master/payment_terms/{id}` |
| GET | `/api/master/payment_terms/next-code` → `{ "code": null }` |

---

## 3. LIST / READ

`GET /api/master/payment_terms?search=net`

```json
[
  {
    "id": 2,
    "client_id": 12,
    "branch_id": 4,
    "term_code": "NET30",
    "term_name": "Net 30 Days",
    "credit_days": "30.0000",
    "advance_pct": "0.0000",
    "payment_type": "Credit",
    "milestone_desc": null,
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

`POST /api/master/payment_terms`

```json
{
  "term_code": "ADV50",
  "term_name": "50% Advance + 50% on Delivery",
  "credit_days": 0,
  "advance_pct": 50,
  "payment_type": "Milestone-Based",
  "milestone_desc": "50% advance, 50% on GRN confirmation",
  "status": "Active"
}
```

`422` — duplicate code (uEach, per-field):
```json
{ "message": "The given data was invalid.",
  "errors": { "term_code": ["This Term code is already registered. Please use a different value."] } }
```

`422` — invalid enum: `{ "errors": { "payment_type": ["The selected payment type is invalid."] } }`

`PUT /api/master/payment_terms/{id}` — same body; system/hierarchy locks may return `403`.

---

## 5. DELETE

`DELETE /api/master/payment_terms/{id}` → `{ "message": "Deleted" }` (hard delete). `403` if hierarchy denies.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List / search | `GET /master/payment_terms?search=` |
| Create | `POST /master/payment_terms` |
| Update | `PUT /master/payment_terms/{id}` |
| Delete | `DELETE /master/payment_terms/{id}` |

---

## 7. NOTES

- `credit_days` / `advance_pct` echo back as decimal strings (`decimal(18,4)`).
- Both `term_code` and `term_name` are unique (case-insensitive, tenant-scoped).

---
*Related documents: PAYMENT_TERMS_FUNCTIONAL_DOCUMENTATION.md, PAYMENT_TERMS_TECHNICAL_DOCUMENTATION.md, PAYMENT_TERMS_CODE_WALKTHROUGH.md*
