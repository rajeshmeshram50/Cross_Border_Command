# CURRENCY EXCHANGE RATE LOG MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Currency Exchange Rate Log

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

No bespoke controller — served by `MasterController` under slug `exchange_rate_log`. Schema in `MasterController::SCHEMAS['exchange_rate_log']`; model `App\Models\Masters\ExchangeRateLog`.

---

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster(...,'can_view')`.
2. Query eager-loads ownership, `orderByDesc('id')`.
3. `applyScope` → creator-hierarchy + optional `?branch_id`.
4. `?search=` → ILIKE across text/select fields (`currency_code`, `currency_name`, `rate_source`, `status`); `effective_date` (date) is not ILIKE-searched.
5. `withOwnership` flattens names.

---

## 2. CREATE — `store()`

1. `authorizeMaster(...,'can_add')`.
2. `validatePayload` builds field rules, then the **composite** branch (`isComposite = count(uFields) > 1`) checks the pair as one combination:
   - `currency_code` → text field → matched via `LOWER()` (case-insensitive).
   - `effective_date` → **not a text field (date)** → matched via exact `where` (no `LOWER()`).
3. `resolveOwnership` stamps client/branch; `created_by` set.
4. `create()`; `MasterBundleCache::bump()`; 201.

---

## 3. UPDATE — `update()`

1. `authorizeMaster(...,'can_edit')`; row loaded under read scope.
2. `hierarchicalDenial` (own row OK, else tier check).
3. `validatePayload(...,$id)` re-runs the composite check excluding self; `update()`; cache bump.

---

## 4. DELETE — `destroy()`

1. `authorizeMaster(...,'can_delete')`; `hierarchicalDenial`.
2. No slug-specific guard → `$row->delete()` (**hard delete**); cache bump.

---

## CROSS-CUTTING PATTERNS

| Concern | Mechanism |
|---|---|
| Tenant scope | `MasterVisibility::applyReadScope` |
| Edit/delete gate | `hierarchicalDenial` |
| Ownership stamp | `resolveOwnership` |
| Uniqueness | Composite `uFields` — `currency_code` LOWER + `effective_date` exact date |
| Enum guard | `Rule::in` on rate_source/status |
| Cache | `MasterBundleCache::bump()` |

---

## NOTES

- The composite mixes column kinds: `currency_code` is case-insensitive text, `effective_date` is an exact-match date — so the same currency gets one row per date.
- `status` enum is `Active / Superseded`; the counts aggregate treats only `Active` as active.
- `next-code` not configured → `{code:null}`.

---
*Related documents: EXCHANGE_RATE_LOG_FUNCTIONAL_DOCUMENTATION.md, EXCHANGE_RATE_LOG_TECHNICAL_DOCUMENTATION.md, EXCHANGE_RATE_LOG_API_DOCUMENTATION.md*
