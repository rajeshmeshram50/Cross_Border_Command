# CURRENCY EXCHANGE RATE LOG MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Currency Exchange Rate Log

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\ExchangeRateLog` |
| Table | `master_exchange_rate_log` |
| Slug | `exchange_rate_log` |
| Soft deletes | No (hard delete) |
| Relations | `client()`, `branch()`, `creator()` |

---

## 2. SCHEMA SPEC

Source: `MasterController::SCHEMAS['exchange_rate_log']`.

| Column | Type | Rules |
|---|---|---|
| currency_code | text | required, max 50 |
| currency_name | text | nullable, max 50 |
| rate_vs_inr | number | required, numeric |
| effective_date | date | required, `date` |
| rate_source | select | required, `Rule::in(RBI Reference Rate, Bank Rate, Agreed Rate, Custom)` |
| status | select | required, `Rule::in(Active, Superseded)` |

Ownership columns (`client_id`, `branch_id`, `created_by`) stamped server-side.

---

## 3. UNIQUENESS MODEL

**Composite** — `uFields = [currency_code, effective_date]` (`count > 1` → composite path). The combination is checked in one query scoped to `(client_id, branch_id)`: `currency_code` via `LOWER()` (text field, case-insensitive), `effective_date` via exact `where` (a date column — not a text field, so no `LOWER()`). The composite therefore **mixes a case-insensitive text match with an exact date match**. On update the current id is excluded. Violation message keys on the first field (`currency_code`).

---

## 4. ENDPOINTS

| Verb | Path | Perm |
|---|---|---|
| GET | `/api/master-counts` | can_view |
| GET | `/api/master/exchange_rate_log` | can_view |
| GET | `/api/master/exchange_rate_log/{id}` | can_view |
| POST | `/api/master/exchange_rate_log` | can_add |
| PUT | `/api/master/exchange_rate_log/{id}` | can_edit |
| DELETE | `/api/master/exchange_rate_log/{id}` | can_delete |
| GET | `/api/master/exchange_rate_log/next-code` | `{code:null}` |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no uploads/sublists/refs/auto-codes; the only non-default aspect is composite uniqueness (text `LOWER` + exact date — see §3).

---

## 6. SECURITY & SCOPING

`applyReadScope` for list/read; `hierarchicalDenial` for edit/delete (own row OK; employees only own; else row tier ≤ user tier else 403); `resolveOwnership` for write stamping (body `client_id` trusted only for super admin). `MasterBundleCache::bump()` on write. DB is PostgreSQL.

---

## 7. METRICS

`/master-counts` → `{active, inactive, total}` via single SQL aggregate. `active` = status IN (active/1/true/yes/enabled), so **`Superseded` rows count as inactive**. Bare responses, `orderByDesc(id)`. `rate_vs_inr` echoes as a decimal string; `effective_date` as an ISO date string.

---
*Related documents: EXCHANGE_RATE_LOG_FUNCTIONAL_DOCUMENTATION.md, EXCHANGE_RATE_LOG_API_DOCUMENTATION.md, EXCHANGE_RATE_LOG_CODE_WALKTHROUGH.md*
