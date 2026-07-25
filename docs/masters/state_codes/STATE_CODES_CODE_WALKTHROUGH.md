# STATE CODES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → State Codes

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

`→` = calls / delegates to · `⇒` = returns. All logic is in `MasterController` (shared engine).

---

## 1. LIST / SEARCH — `list()`

`authorizeMaster('can_view')` → `resolveModel('state_codes')` ⇒ `StateCodes` → `query()->with(OWNERSHIP_WITH)->orderByDesc('id')` → **`$slug === 'state_codes'` branch**: `->with('state:id,name,country_id')` (inline state name + country_id for cascade, avoids pulling the 10k+ `master_states` table) → `applyScope()` → if `?search=` add ILIKE over text/select fields → `?country_id=` filter is a **no-op** (no `country_id` column on this table) ⇒ `map(withOwnership)`.

---

## 2. CREATE — `store()`

`authorizeMaster('can_add')` → `validatePayload()` → `resolveOwnership()` stamps `client_id/branch_id`, `created_by` → `StateCodes::create()` → `syncSublists()` no-op → `MasterBundleCache::bump()` ⇒ **201**.

`validatePayload`: no normalizers → rules (state_id required|integer, state_code required|max:50, status Rule::in) → **composite `uFields` block**: exact `state_id` + `LOWER(state_code)`, tenant-scoped; duplicate ⇒ 422 on `state_id`. No `is_system` column ⇒ system-seed block skipped.

---

## 3. UPDATE — `update()`

`authorizeMaster('can_edit')` → load in `applyScope` → `hierarchicalDenial(...,'edit')` (403 if row tier > user tier) → `is_system` skipped (no column) → `validatePayload(id)` (composite ignores this id) → `update()` → `bump()` ⇒ flattened row.

---

## 4. DELETE — `destroy()`

`authorizeMaster('can_delete')` → load in `applyScope` → `hierarchicalDenial(...,'delete')` → no state_codes-specific guard → `row->delete()` (soft) → `bump()` ⇒ `{message:"Deleted"}`.

---

## SPECIAL PATH

State eager-load: the only per-slug branch in `list()` for this master. It rides `country_id` on the nested `state` so the frontend can cascade State off Country even though `master_state_codes` itself has no country column.

---

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission gate | `authorizeMaster()` |
| Read scoping | `applyReadScope` |
| State eager-load | `list()` `state_codes` branch |
| Ownership stamp | `resolveOwnership()` |
| Edit/delete gate | `hierarchicalDenial()` |
| Uniqueness | composite `uFields` block |
| Cache | `MasterBundleCache::bump()` |

---

## NOTES

- No `AUTO_CODES` ⇒ `nextCode()` ⇒ `{code:null}`.
- Single FK ref (`states`), eager-loaded; no sublists/uploads.

---

*Related documents: STATE_CODES_FUNCTIONAL_DOCUMENTATION.md, STATE_CODES_TECHNICAL_DOCUMENTATION.md, STATE_CODES_API_DOCUMENTATION.md*
