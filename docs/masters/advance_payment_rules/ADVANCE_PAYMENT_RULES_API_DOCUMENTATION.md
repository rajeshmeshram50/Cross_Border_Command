# ADVANCE PAYMENT RULES MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Advance Payment Rules

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Base `/api/master/advance_payment_rules`; `auth:sanctum` + `user.active`; Bearer token.
- Permission module `master.advance_payment_rules` (super admin bypasses).
- Bare responses, `id DESC`, flattened `client_name/branch_name/creator_name`.
- `?search=` ILIKE across text/select fields; `?branch_id=` narrows (client roles).
- Empty strings → NULL; 422 `{message, errors}` on validation failure.

---

## 2. ENDPOINT INDEX

| Verb | Path |
|---|---|
| GET | `/api/master/advance_payment_rules` |
| GET | `/api/master/advance_payment_rules/{id}` |
| POST | `/api/master/advance_payment_rules` |
| PUT | `/api/master/advance_payment_rules/{id}` |
| DELETE | `/api/master/advance_payment_rules/{id}` |
| GET | `/api/master/advance_payment_rules/next-code` → `{ "code": null }` |

---

## 3. LIST / READ

`GET /api/master/advance_payment_rules`

```json
[
  {
    "id": 5,
    "client_id": 12,
    "branch_id": null,
    "vendor_type": "Manufacturer",
    "procurement_cat": "Raw Material",
    "max_advance_pct": "30.0000",
    "approval_above": "500000.0000",
    "approver_role": "Finance Head",
    "attachment_required": "Yes",
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

`POST /api/master/advance_payment_rules`

```json
{
  "vendor_type": "Trader",
  "procurement_cat": "Packaging",
  "max_advance_pct": 25,
  "approval_above": 250000,
  "approver_role": "Purchase Manager",
  "attachment_required": "No",
  "status": "Active"
}
```

`422` — composite duplicate (vendor_type + procurement_cat):
```json
{ "message": "The given data was invalid.",
  "errors": { "vendor_type": ["A record with this combination of vendor_type + procurement_cat already exists."] } }
```

`422` — out-of-range percentage:
```json
{ "message": "The given data was invalid.",
  "errors": { "max_advance_pct": ["The max advance pct may not be greater than 100."] } }
```

`PUT /api/master/advance_payment_rules/{id}` — same body; `403` on hierarchy denial.

---

## 5. DELETE

`DELETE /api/master/advance_payment_rules/{id}` → `{ "message": "Deleted" }` (hard delete). `403` if the row belongs to a higher tier.

---

## 6. QUICK REFERENCE

| Need | Call |
|---|---|
| List / search | `GET /master/advance_payment_rules?search=` |
| Create | `POST /master/advance_payment_rules` |
| Update | `PUT /master/advance_payment_rules/{id}` |
| Delete | `DELETE /master/advance_payment_rules/{id}` |

---

## 7. NOTES

- Uniqueness is the **combination** of vendor type + procurement category, not each field alone.
- `max_advance_pct` is bounded 0..100 server-side; numeric fields echo back as decimal strings.

---
*Related documents: ADVANCE_PAYMENT_RULES_FUNCTIONAL_DOCUMENTATION.md, ADVANCE_PAYMENT_RULES_TECHNICAL_DOCUMENTATION.md, ADVANCE_PAYMENT_RULES_CODE_WALKTHROUGH.md*
