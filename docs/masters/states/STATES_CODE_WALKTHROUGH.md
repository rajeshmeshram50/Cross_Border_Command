# STATES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → States

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

`authorizeMaster('can_view')` → `resolveModel('states')` ⇒ `States` → `query()->with(OWNERSHIP_WITH)->orderByDesc('id')` → `applyScope()` → if `?search=` add ILIKE over text/select fields → **`?country_id=` cascade**: schema contains a `country_id` field, so `where('country_id', ?country_id)` is applied (loads ~30 states, not the 10k+ table) ⇒ `map(withOwnership)`.

`counts()` for this slug deliberately uses one `selectRaw('COUNT(*)…')` aggregate — never `get()` — to avoid loading the huge table into PHP (bug #16/#21).

---

## 2. CREATE — `store()`

`authorizeMaster('can_add')` → `validatePayload()` → `resolveOwnership()` stamps `client_id/branch_id`, `created_by` → `States::create()` → `syncSublists()` no-op → `MasterBundleCache::bump()` ⇒ **201**.

`validatePayload`: no normalizers → rules (country_id required|integer, name required|max:50, status Rule::in) → **composite `uFields` block**: matches `LOWER(name)` + exact `country_id`, tenant-scoped; duplicate ⇒ 422 on `name`. No `is_system` column ⇒ system-seed block skipped.

---

## 3. UPDATE — `update()`

`authorizeMaster('can_edit')` → load in `applyScope` → `hierarchicalDenial(...,'edit')` (403 if row tier > user tier) → `is_system` skipped (no column) → `validatePayload(id)` (composite check ignores this id) → `update()` → `bump()` ⇒ flattened row.

---

## 4. DELETE — `destroy()`

`authorizeMaster('can_delete')` → load in `applyScope` → `hierarchicalDenial(...,'delete')` → no states-specific guard → `row->delete()` (soft) → `bump()` ⇒ `{message:"Deleted"}`.

---

## SPECIAL PATH

`country_id` cascade — the same field the frontend uses to narrow the State dropdown off the chosen Country. States both *consumes* the cascade (as a filter) and *feeds* the next level (State Codes eager-load `state.country_id`).

---

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission gate | `authorizeMaster()` |
| Read scoping | `applyReadScope` |
| Cascade filter | `list()` `?country_id=` block |
| Ownership stamp | `resolveOwnership()` |
| Edit/delete gate | `hierarchicalDenial()` |
| Uniqueness | composite `uFields` LOWER()/exact block |
| Big-table counts | `counts()` SQL aggregate |
| Cache | `MasterBundleCache::bump()` |

---

## NOTES

- No `AUTO_CODES` ⇒ `nextCode()` ⇒ `{code:null}`.
- Single FK ref (`countries`); no sublists/uploads.

---

*Related documents: STATES_FUNCTIONAL_DOCUMENTATION.md, STATES_TECHNICAL_DOCUMENTATION.md, STATES_API_DOCUMENTATION.md*
