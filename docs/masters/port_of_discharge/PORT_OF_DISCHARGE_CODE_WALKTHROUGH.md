# PORTS OF DISCHARGE MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Ports of Discharge

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

`authorizeMaster('can_view')` → `resolveModel('port_of_discharge')` ⇒ `PortOfDischarge` → `query()->with(OWNERSHIP_WITH)->orderByDesc('id')` → `applyScope()` → optional `?search=` ILIKE over text/select fields (`name`, `code`, `city`, `status`) → **`?country_id=` cascade**: schema has a `country_id` field, so `where('country_id', ?country_id)` is applied ⇒ `map(withOwnership)`.

---

## 2. CREATE — `store()`

`authorizeMaster('can_add')` → (not `address_types`) → `validatePayload()` → `resolveOwnership()` stamps `client_id/branch_id`, `created_by` → `PortOfDischarge::create()` → `syncSublists()` no-op → `MasterBundleCache::bump()` ⇒ **201**.

`validatePayload`: no normalizers → rules (name/code required|max:50, country_id required|integer, city nullable|max:50, status Rule::in) → **`uEach` block**: case-insensitive `LOWER()` uniqueness on `name` and on `code`, tenant-scoped (`country_id` is not part of the key). No `is_system` column ⇒ system-seed block skipped.

---

## 3. UPDATE — `update()`

`authorizeMaster('can_edit')` → load in `applyScope` → `hierarchicalDenial(...,'edit')` (403 if row tier > user tier) → `is_system` skipped (no column) → `validatePayload(id)` (uEach ignores this id) → `update()` → `bump()` ⇒ flattened row.

---

## 4. DELETE — `destroy()`

`authorizeMaster('can_delete')` → load in `applyScope` → `hierarchicalDenial(...,'delete')` → no port-specific guard → `row->delete()` (soft) → `bump()` ⇒ `{message:"Deleted"}`.

---

## SPECIAL PATH

`country_id` cascade — the generic `?country_id=` filter in `list()` applies here because `master_port_of_discharge` carries a `country_id` column (references `countries`). This lets forms load only a destination country's discharge ports.

---

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission gate | `authorizeMaster()` |
| Read scoping | `applyReadScope` |
| Cascade filter | `list()` `?country_id=` block |
| Ownership stamp | `resolveOwnership()` |
| Edit/delete gate | `hierarchicalDenial()` |
| Uniqueness | `uEach` LOWER() block (name, code) |
| Cache | `MasterBundleCache::bump()` |

---

## NOTES

- No `AUTO_CODES` ⇒ `nextCode()` ⇒ `{code:null}`.
- Single FK ref (`countries`); no sublists/uploads.

---

*Related documents: PORT_OF_DISCHARGE_FUNCTIONAL_DOCUMENTATION.md, PORT_OF_DISCHARGE_TECHNICAL_DOCUMENTATION.md, PORT_OF_DISCHARGE_API_DOCUMENTATION.md*
