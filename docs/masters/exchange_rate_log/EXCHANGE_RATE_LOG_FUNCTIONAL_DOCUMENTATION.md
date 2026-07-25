# CURRENCY EXCHANGE RATE LOG MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Currency Exchange Rate Log

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

Currency Exchange Rate Log is the **date-wise history of currency rates versus INR** used to convert multi-currency amounts on Purchase Orders and payments. Each row records a currency's rate on a specific effective date and marks whether that rate is currently in force. It is a **P2P (Procure-to-Pay) master** served by the generic schema-driven engine (`MasterController` + `MasterPage.tsx`).

**Downstream P2P consumers:** multi-currency PO and payment conversion, rate lookup by effective date, current-vs-historical rate selection via `status`.

---

## 2. ROLES & ACCESS

| Role | Visibility |
|---|---|
| Super Admin | All tenants; may seed global rows (`client_id = NULL`) |
| Client Admin / User | Own client rows + globals; may narrow by branch switcher |
| Branch User | Globals + client-level + own branch rows |
| Employee | Globals + client-level + only own-created rows |

Permissioned module: `master.exchange_rate_log` (`can_view / can_add / can_edit / can_delete`). Super admin bypasses.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| currency_code | Currency Code | text | Yes | e.g. USD, EUR, GBP |
| currency_name | Currency Name | text | No | e.g. US Dollar |
| rate_vs_inr | Rate vs INR | number | Yes | numeric, 1 unit = N INR |
| effective_date | Effective Date | date | Yes | date the rate applies from |
| rate_source | Rate Source | select | Yes | RBI Reference Rate / Bank Rate / Agreed Rate / Custom |
| status | Status | select | Yes | Active / Superseded |

---

## 4. BUSINESS RULES

- **Composite uniqueness (`uFields = currency_code + effective_date`)** — the **combination** must be unique per tenant `(client_id, branch_id)`. The composite mixes a **case-insensitive text column** (`currency_code`, compared via `LOWER()`) with an **exact-match date column** (`effective_date`). So each currency may have exactly one rate row per effective date; a second row for the same currency+date is rejected.
- Different effective dates for the same currency are allowed — that is the whole point of the log (rate history).
- `rate_source` and `status` are constrained to their enum options server-side.
- **`status` enum is `Active / Superseded`** (not Active/Inactive) — Superseded marks a rate that has been replaced by a newer one.
- Text fields cap at 50 chars; empty optional values are stored as NULL.
- Delete is a **hard delete** (this table has no soft-delete column).

---

## 5. SCREEN

Rendered by the generic `MasterPage.tsx` shell: searchable list, Add/Edit modal, delete confirm. List columns: Currency Code, Currency Name, Rate vs INR, Effective Date, Rate Source, Status. Search runs an ILIKE across text/select fields (the `effective_date` date column is **not** ILIKE-searched).

---

## 6. KNOWN LIMITATIONS

- On the dashboard count pills, only `Active` rows are counted as active — **`Superseded` rows count as inactive** (active = status IN active/1/true/yes/enabled).
- No auto-code generation — `currency_code` is typed manually (`next-code` returns `{code:null}`).
- No FK linking `currency_code` to the Currencies master, so a typo won't fail; and no validation that only one rate per currency is `Active` at a time.

---
*Related documents: EXCHANGE_RATE_LOG_TECHNICAL_DOCUMENTATION.md, EXCHANGE_RATE_LOG_API_DOCUMENTATION.md, EXCHANGE_RATE_LOG_CODE_WALKTHROUGH.md*
