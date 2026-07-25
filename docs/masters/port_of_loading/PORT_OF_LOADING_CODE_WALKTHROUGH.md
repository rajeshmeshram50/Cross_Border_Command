# PORTS OF LOADING MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Ports of Loading

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

`authorizeMaster('can_view')` → `resolveModel('port_of_loading')` ⇒ `PortOfLoading` → `query()->with(OWNERSHIP_WITH)->orderByDesc('id')` → `applyScope()` → optional `?search=` ILIKE over text/select/textarea fields (`name`, `code`, `address`, `status`) → `?country_id=` no-op (no column) ⇒ `map(withOwnership)`.

---

## 2. CREATE — `store()`

`authorizeMaster('can_add')` → (not `address_types`) → `validatePayload()` → `resolveOwnership()` stamps `client_id/branch_id`, `created_by` → `PortOfLoading::create()` → `syncSublists()` no-op → `MasterBundleCache::bump()` ⇒ **201**.

`validatePayload`: no normalizers → rules (name/code required|max:50, address nullable|string, status Rule::in) → **`uEach` block**: case-insensitive `LOWER()` uniqueness on `name` and on `code`, tenant-scoped. No `is_system` column ⇒ system-seed block skipped.

---

## 3. UPDATE — `update()`

`authorizeMaster('can_edit')` → load in `applyScope` → `hierarchicalDenial(...,'edit')` (403 if row tier > user tier) → `is_system` skipped (no column) → `validatePayload(id)` (uEach ignores this id) → `update()` → `bump()` ⇒ flattened row.

---

## 4. DELETE — `destroy()`

`authorizeMaster('can_delete')` → load in `applyScope` → `hierarchicalDenial(...,'delete')` → no port-specific guard → `row->delete()` (soft) → `bump()` ⇒ `{message:"Deleted"}`.

---

## SPECIAL PATH

None — the simplest engine path with a two-column `uEach`. No refs, cascade, uploads, sublists, normalization or locks.

---

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission gate | `authorizeMaster()` |
| Read scoping | `applyReadScope` |
| Ownership stamp | `resolveOwnership()` |
| Edit/delete gate | `hierarchicalDenial()` |
| Uniqueness | `uEach` LOWER() block (name, code) |
| Cache | `MasterBundleCache::bump()` |
| Response flatten | `withOwnership()` |

---

## NOTES

- No `AUTO_CODES` ⇒ `nextCode()` ⇒ `{code:null}`.
- `address` empty string is coerced to `NULL` before save.

---

*Related documents: PORT_OF_LOADING_FUNCTIONAL_DOCUMENTATION.md, PORT_OF_LOADING_TECHNICAL_DOCUMENTATION.md, PORT_OF_LOADING_API_DOCUMENTATION.md*
