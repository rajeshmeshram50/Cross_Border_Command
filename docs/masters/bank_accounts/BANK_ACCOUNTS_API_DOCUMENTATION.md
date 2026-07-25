# BANK ACCOUNTS MASTER — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Bank Accounts

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
| GET | `/master/bank_accounts` | List (?search=, ?branch_id=) |
| POST | `/master/bank_accounts` | Create |
| GET | `/master/bank_accounts/next-code` | `{ "code": null }` |
| GET | `/master/bank_accounts/{id}` | Show |
| PUT | `/master/bank_accounts/{id}` | Update |
| DELETE | `/master/bank_accounts/{id}` | Soft delete |

## 3. LIST / READ

`GET /api/master/bank_accounts?search=sbi`

```json
[
  {
    "id": 1,
    "client_id": 12,
    "branch_id": null,
    "bank_name": "State Bank of India",
    "account_holder": "Inorbvict Healthcare Pvt Ltd",
    "account_number": "501000001122",
    "ifsc_code": "SBIN0000691",
    "branch_name": "New Delhi Main Branch",
    "city": "New Delhi",
    "swift_code": "SBININBB104",
    "ad_code": "05105730000001",
    "is_primary": "Yes",
    "status": "Active",
    "client_name": "IGC GROUP",
    "branch_name": null,
    "creator_name": "Admin",
    "creator_user_type": "client_admin"
  }
]
```

## 4. CREATE / UPDATE

`POST /api/master/bank_accounts`

```json
{
  "bank_name": "State Bank of India",
  "account_holder": "Inorbvict Healthcare Pvt Ltd",
  "account_number": "501000001122",
  "ifsc_code": "sbin0000691",
  "branch_name": "New Delhi Main Branch",
  "city": "New Delhi",
  "swift_code": "SBININBB104",
  "ad_code": "05105730000001",
  "is_primary": "Yes",
  "status": "Active"
}
```

- `ifsc_code` is uppercased before validation/storage.
- Returns `201`. `PUT /api/master/bank_accounts/{id}` uses the same body (composite uniqueness ignores the current id).

**Master-specific 422 errors:**

| Trigger | Field | Message |
|---|---|---|
| Same account_number + ifsc_code pair exists | account_number | `A record with this combination of account_number + ifsc_code already exists.` |
| Bank name has digits/symbols | bank_name | `Bank Name may only contain letters (no numbers or special characters).` |
| Account not 9–18 digits | account_number | `Account Number must be 9 to 18 digits.` |
| Bad IFSC | ifsc_code | `Enter a valid 11-character IFSC code.` |
| AD Code not 14 digits | ad_code | `AD Code must be exactly 14 digits.` |
| Missing required | swift_code / status / … | `The <field> field is required.` |

## 5. DELETE

`DELETE /api/master/bank_accounts/{id}` → `{ "message": "Deleted" }` (soft). Tier gate via `hierarchicalDenial`. No in-use guard.

## 6. QUICK REFERENCE

```
GET    /api/master/bank_accounts
POST   /api/master/bank_accounts
GET    /api/master/bank_accounts/{id}
PUT    /api/master/bank_accounts/{id}
DELETE /api/master/bank_accounts/{id}
```

## 7. NOTES

- Uniqueness is the **pair** (account_number, ifsc_code), not either field alone.
- `next-code` returns `{code: null}` — no auto-numbering.
- Search matches text/select fields via ILIKE.

---
*Related documents: BANK_ACCOUNTS_FUNCTIONAL_DOCUMENTATION.md, BANK_ACCOUNTS_TECHNICAL_DOCUMENTATION.md, BANK_ACCOUNTS_CODE_WALKTHROUGH.md*
