# ADDRESS TYPES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Address Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

`→` = calls / delegates to · `⇒` = returns. Logic spans `MasterController` (engine) **and** `AddressTypes::booted()` (model guards).

---

## 1. LIST / SEARCH — `list()`

`authorizeMaster('can_view')` → `resolveModel('address_types')` ⇒ `AddressTypes` → `query()->with(OWNERSHIP_WITH)->orderByDesc('id')` → `applyScope()` → optional `?search=` ILIKE over `name`/`status` → `?country_id=` no-op (no column) ⇒ `map(withOwnership)`.

---

## 2. CREATE — `store()` (BLOCKED)

`authorizeMaster('can_add')` → **`if ($slug === 'address_types') return 403`** — short-circuits before `validatePayload`/`resolveOwnership`. No row is ever created via the API.

Below the API, `AddressTypes::booted()::creating` throws a `RuntimeException` on any Eloquent insert, so seeders/Tinker are blocked too; the three canonical rows are inserted via raw `DB::table()` in a migration.

---

## 3. UPDATE — `update()`

`authorizeMaster('can_edit')` → load row in `applyScope` → `hierarchicalDenial(...,'edit')` → **`if (!empty($row->is_system)) return 403`** → `validatePayload(id)` (uEach name LOWER() + system-seed collision check) → `update()` → `bump()`.

If a caller somehow reaches `update()` on a canonical row and changes `name`, the model's `updating` guard throws (`name` is system-fixed).

---

## 4. DELETE — `destroy()`

`authorizeMaster('can_delete')` → load in `applyScope` → `hierarchicalDenial(...,'delete')` → **`if ($slug === 'address_types' && !empty($row->is_system)) return 403`** → `row->delete()`.

The model's `deleting` guard independently throws if the row's name is in `FIXED_NAMES` — a second line of defence.

---

## SPECIAL PATH — LOCKED-FIXED

Three enforcement layers stack:
1. **Controller** — `store()` 403; `update()`/`destroy()` `is_system` 403.
2. **Model boot** — `creating` (all), `updating` (name), `deleting` (FIXED_NAMES).
3. **Uniqueness** — `uEach` + system-seed collision block (table has `is_system`).

---

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission gate | `authorizeMaster()` |
| Read scoping | `applyReadScope` |
| Create lock | `store()` slug guard (403) |
| Edit/Delete lock | `is_system` guards + model boot |
| Uniqueness | `uEach` + system-seed collision |
| Cache | `MasterBundleCache::bump()` |

---

## NOTES

- Naming discrepancy to be aware of: model `FIXED_NAMES` = Warehouse / Registered Office / Billing Address, while the controller's 403 message text names "Branch". The model constant is authoritative.
- No `AUTO_CODES` ⇒ `nextCode()` ⇒ `{code:null}`.

---

*Related documents: ADDRESS_TYPES_FUNCTIONAL_DOCUMENTATION.md, ADDRESS_TYPES_TECHNICAL_DOCUMENTATION.md, ADDRESS_TYPES_API_DOCUMENTATION.md*
