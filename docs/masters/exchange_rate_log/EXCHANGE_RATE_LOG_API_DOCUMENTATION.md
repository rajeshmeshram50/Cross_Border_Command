# CURRENCY EXCHANGE RATE LOG MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Currency Exchange Rate Log

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api/master/exchange_rate_log`; `auth:sanctum` + `user.active`; Bearer token.
- Permission module `master.exchange_rate_log` (super admin bypasses).
- Bare responses, `id DESC`, flattened `client_name/branch_name/creator_name/creator_user_type`.
- `?search=` ILIKE across text/select fields (the `effective_date` date column is **not** searched); `?branch_id=` narrows (client roles).
- Empty strings → NULL; 422 `{message, errors}` on validation failure.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/exchange_rate_log` |
| GET | `/api/master/exchange_rate_log/{id}` |
| POST | `/api/master/exchange_rate_log` |
| PUT | `/api/master/exchange_rate_log/{id}` |
| DELETE | `/api/master/exchange_rate_log/{id}` |
| GET | `/api/master/exchange_rate_log/next-code` → `{ "code": null }` |

---

## 3. LIST / READ

`GET /api/master/exchange_rate_log`

```json
[
  {
    "id": 7,
    "client_id": 12,
    "branch_id": null,
    "currency_code": "USD",
    "currency_name": "US Dollar",
    "rate_vs_inr": "83.4500",
    "effective_date": "2026-07-20",
    "rate_source": "RBI Reference Rate",
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

`POST /api/master/exchange_rate_log`

```json
{
  "currency_code": "EUR",
  "currency_name": "Euro",
  "rate_vs_inr": 90.15,
  "effective_date": "2026-07-21",
  "rate_source": "Bank Rate",
  "status": "Active"
}
```

`422` — composite duplicate (currency_code + effective_date):
```json
{ "message": "The given data was invalid.",
  "errors": { "currency_code": ["A record with this combination of currency_code + effective_date already exists."] } }
```

`422` — missing required rate: `{ "errors": { "rate_vs_inr": ["The rate vs inr field is required."] } }`

`PUT /api/master/exchange_rate_log/{id}` — same body; `403` on hierarchy denial.

---

## 5. DELETE

`DELETE /api/master/exchange_rate_log/{id}` → `{ "message": "Deleted" }` (hard delete). `403` if the row belongs to a higher tier.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List / search | `GET /master/exchange_rate_log?search=` |
| Create | `POST /master/exchange_rate_log` |
| Update | `PUT /master/exchange_rate_log/{id}` |
| Delete | `DELETE /master/exchange_rate_log/{id}` |

---

## 7. NOTES

- Uniqueness is the **combination** of currency code + effective date, not each field alone — same currency, different dates is allowed.
- `rate_vs_inr` echoes back as a decimal string; `effective_date` as an ISO date string.
- `status` enum is `Active / Superseded`; Superseded rows count as inactive in `/master-counts`.

---
*Related documents: EXCHANGE_RATE_LOG_FUNCTIONAL_DOCUMENTATION.md, EXCHANGE_RATE_LOG_TECHNICAL_DOCUMENTATION.md, EXCHANGE_RATE_LOG_CODE_WALKTHROUGH.md*
