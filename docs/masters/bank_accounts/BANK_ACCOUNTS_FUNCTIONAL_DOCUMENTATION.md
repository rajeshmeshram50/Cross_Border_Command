# BANK ACCOUNTS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Bank Accounts

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Bank Accounts** master (`bank_accounts`) is the tenant's registry of bank accounts, including the **export-banking** fields (Swift Code and AD Code) required on FIRC/eBRC and shipping-bill reconciliation. It is one of the ~56 schema-driven masters served by `MasterController` + `MasterPage.tsx`.

**Downstream consumers:** account/IFSC/Swift/AD details printed on export invoices and used for payment collection; the "Primary Account" flag marks the default account for documents.

---

## 2. ROLES & ACCESS

Permissioned module `master.bank_accounts` (`can_view / can_add / can_edit / can_delete`). Super admin bypasses.

| Role | Visibility |
|---|---|
| Super Admin | All rows, all tenants; may seed globals |
| Client Admin / Client User | Own client's rows + globals; branch-switcher narrows |
| Branch User | Globals + client-level + own branch rows |
| Employee | Globals + client-level + only own rows |

---

## 3. FIELDS

| Field / Label | Type | Required | Options | Rules & Notes |
|---|---|---|---|---|
| bank_name / Bank Name | text | Yes | — | Letters + `. , & ' ( ) -` only (no digits/symbols) |
| account_holder / Account Holder | text | Yes | — | Letters only (same charset) |
| account_number / Account Number | text | Yes | — | 9–18 digits; part of composite uniqueness |
| ifsc_code / IFSC Code | text | Yes | — | 11-char IFSC (`AAAA0######`); uppercased; part of composite uniqueness |
| branch_name / Branch Name | text | No | — | max 50 |
| city / City | text | No | — | max 50 |
| swift_code / Swift Code | text | Yes | — | Required (export banking) |
| ad_code / AD Code | text | Yes | — | Exactly 14 digits |
| is_primary / Primary Account | select | No | No, Yes | Marks default account |
| status / Status | select | Yes | Active, Inactive | |

---

## 4. BUSINESS RULES

- **Uniqueness (`uFields` — composite):** the **combination** of `account_number` + `ifsc_code` must be unique within the tenant scope. The same account number may recur under a different IFSC and vice-versa; only the pair collides. (Text columns in the composite compare case-insensitively; the IFSC is uppercased first.)
- **Normalization:** `ifsc_code` is uppercased before validation and storage.
- **Format guards (server-side regex):** bank name/account holder charset, account 9–18 digits, IFSC 11-char pattern, AD Code exactly 14 digits — all enforced with per-field messages.
- **No auto-code, no uploads, no sublist, no system-seed.**
- **Empty strings → NULL.**

---

## 5. SCREEN

Lives under Masters → **Bank Accounts** (`/masters/bank_accounts`). Add/Edit modal groups the core account fields plus an "Export Banking" section (Swift Code, AD Code). List columns: Bank Name, Account Holder, Account No., IFSC, Swift Code, Status.

---

## 6. KNOWN LIMITATIONS

- No Luhn/checksum validation on the account number — only length/digit format.
- `is_primary` is a plain flag with no "single primary per entity" enforcement at this master level.
- Delete has no in-use guard against documents referencing the account.

---
*Related documents: BANK_ACCOUNTS_TECHNICAL_DOCUMENTATION.md, BANK_ACCOUNTS_API_DOCUMENTATION.md, BANK_ACCOUNTS_CODE_WALKTHROUGH.md*
