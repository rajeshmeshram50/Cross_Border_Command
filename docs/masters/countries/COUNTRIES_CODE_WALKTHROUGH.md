# COUNTRIES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Countries

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

`→` = calls / delegates to · `⇒` = returns. All logic lives in `MasterController` (shared engine); no per-master controller exists.

---

## 1. LIST / SEARCH — `list()`

`authorizeMaster('can_view')` → `resolveModel('countries')` ⇒ `Countries` → `query()->with(OWNERSHIP_WITH)->orderByDesc('id')` → `applyScope()` (`MasterVisibility::applyReadScope`) → if `?search=` add ILIKE across text/select fields (`name`, `iso_code`, `status`) → `?country_id=` filter is **skipped** (Countries has no `country_id` column) ⇒ `map(withOwnership)` (flattens `client_name` etc.).

---

## 2. CREATE — `store()`

`authorizeMaster('can_add')` → (not `address_types`, so no 403 short-circuit) → `validatePayload()` → `resolveOwnership()` stamps `client_id/branch_id`, `created_by = user.id` → `Countries::create()` → `syncSublists()` (no-op) → `MasterBundleCache::bump()` ⇒ **201** flattened row.

Inside `validatePayload`: `iso_code` uppercased via the `normalize` pass → build rules (name required|max:50, iso_code nullable, status Rule::in) → `uEach` loop runs a case-insensitive `LOWER()` uniqueness check on `name` and `iso_code`, tenant-scoped. `master_countries` has no `is_system` column, so the system-seed collision block is skipped.

---

## 3. UPDATE — `update()`

`authorizeMaster('can_edit')` → load row within `applyScope` → `hierarchicalDenial(user,row,'edit')` (403 if row tier > user tier) → `is_system` check (column absent ⇒ skipped) → `validatePayload(id)` (uniqueness ignores this id) → `update()` → `MasterBundleCache::bump()` ⇒ flattened row.

---

## 4. DELETE — `destroy()`

`authorizeMaster('can_delete')` → load row within `applyScope` → `hierarchicalDenial(...,'delete')` → no `countries`-specific guard → `row->delete()` (soft) → `bump()` ⇒ `{message:"Deleted"}`.

---

## SPECIAL PATH

`Countries::isoFor(?string)` — builds a memoized `name→iso` + `iso→iso` map (uppercased) once per process and resolves a free-text country value to its ISO code; used to render compact Country columns without per-row queries.

---

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission gate | `authorizeMaster()` per verb |
| Read scoping | `MasterVisibility::applyReadScope` |
| Ownership stamp | `resolveOwnership()` |
| Edit/delete gate | `hierarchicalDenial()` |
| Uniqueness | `validatePayload()` `uEach` LOWER() block |
| Cache invalidation | `MasterBundleCache::bump()` on every write |
| Response flatten | `withOwnership()` |

---

## NOTES

- No `AUTO_CODES` entry ⇒ `nextCode()` returns `{code:null}`.
- No sublists/uploads/refs — the simplest engine path.

---

*Related documents: COUNTRIES_FUNCTIONAL_DOCUMENTATION.md, COUNTRIES_TECHNICAL_DOCUMENTATION.md, COUNTRIES_API_DOCUMENTATION.md*
