# BANK ACCOUNTS MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Bank Accounts

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

- **Model:** `App\Models\Masters\BankAccounts`
- **Table:** `master_bank_accounts`
- **Fillable:** `client_id, branch_id, bank_name, account_holder, account_number, ifsc_code, branch_name, city, swift_code, ad_code, is_primary, status, created_by`
- **Relations:** `client()`, `branch()`, `creator()`
- **Booted hooks:** none.

---

## 2. SCHEMA SPEC (from `SCHEMAS['bank_accounts']`)

| Field | t | r | normalize | Pattern / Validation |
|---|---|---|---|---|
| bank_name | text | ✔ | — | `^[A-Za-z][A-Za-z .,&'()\-]*$` — "Bank Name may only contain letters…" |
| account_holder | text | ✔ | — | `^[A-Za-z][A-Za-z .,&'()\-]*$` — "Account Holder may only contain letters." |
| account_number | text | ✔ | — | `^[0-9]{9,18}$` — "Account Number must be 9 to 18 digits." |
| ifsc_code | text | ✔ | upper | `^[A-Za-z]{4}0[A-Za-z0-9]{6}$` — "Enter a valid 11-character IFSC code." |
| branch_name | text | — | — | nullable, string max 50 |
| city | text | — | — | nullable, string max 50 |
| swift_code | text | ✔ | — | required, string max 50 |
| ad_code | text | ✔ | — | `^[0-9]{14}$` — "AD Code must be exactly 14 digits." |
| is_primary | select | — | — | Rule::in(No, Yes) |
| status | select | ✔ | — | Rule::in(Active, Inactive) |

---

## 3. UNIQUENESS MODEL

`uFields = [account_number, ifsc_code]` → **composite** (`count(uFields) > 1`). Enforced manually after field validation: for each column, text fields use `LOWER(col) = LOWER(?)`, others exact; combined with `whereNull/where` on `(client_id, branch_id)`. Both `account_number` and `ifsc_code` are declared `text`, so both use the case-insensitive comparison. A collision throws 422 on the first uField:
`A record with this combination of account_number + ifsc_code already exists.`

---

## 4. ENDPOINTS (generic engine, scoped to `bank_accounts`)

| Verb | Path | Notes |
|---|---|---|
| GET | `/api/master/bank_accounts` | list; ?search=, ?branch_id= |
| POST | `/api/master/bank_accounts` | store |
| GET | `/api/master/bank_accounts/next-code` | `{code: null}` |
| GET | `/api/master/bank_accounts/{id}` | show |
| PUT | `/api/master/bank_accounts/{id}` | update |
| DELETE | `/api/master/bank_accounts/{id}` | soft delete |

---

## 5. SPECIAL HANDLING

Standard schema-driven master with two extras: **composite uniqueness** on `account_number + ifsc_code`, and **uppercase normalization** of `ifsc_code`. No cascade, uploads, sublists, auto-code, or system-seed. Rich per-field `pattern` + `patternMessage` regexes are enforced server-side (not just in the UI).

---

## 6. SECURITY & SCOPING

- `authorizeMaster('master.bank_accounts', …)` per verb; super admin bypass.
- Reads via `applyReadScope`; writes stamp ownership via `resolveOwnership`.
- `hierarchicalDenial` gates edit/delete; `is_system` block present but unused (no such column here).

---

## 7. METRICS

| Metric | Value |
|---|---|
| Field count | 10 |
| Required fields | 6 (bank_name, account_holder, account_number, ifsc_code, swift_code, ad_code, status → 7 incl. status) |
| Uniqueness model | `uFields` composite (account_number + ifsc_code) |
| Auto-code | No |
| Uploads / sublist | None |

---
*Related documents: BANK_ACCOUNTS_FUNCTIONAL_DOCUMENTATION.md, BANK_ACCOUNTS_API_DOCUMENTATION.md, BANK_ACCOUNTS_CODE_WALKTHROUGH.md*
