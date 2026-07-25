# ADDRESS TYPES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Address Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\AddressTypes` |
| Table | `master_address_types` |
| Slug | `address_types` |
| Fillable | `client_id, branch_id, name, status, is_system, created_by` |
| Casts | `is_system => boolean` |
| Constant | `FIXED_NAMES = ['Warehouse','Registered Office','Billing Address']` |
| Relations | `client()`, `branch()`, `creator()` |
| Soft deletes | Yes |

### Model boot guards (`booted()`)
- `creating` → always throws `RuntimeException` (blocks all Eloquent inserts; canonical rows are inserted via raw `DB::table()` in a migration).
- `updating` → throws if `name` is dirty.
- `deleting` → throws if the row's name is in `FIXED_NAMES`.

---

## 2. SCHEMA SPEC (`SCHEMAS['address_types']`)

```php
'fields' => [
  ['n' => 'name',   't' => 'text',   'r' => true],
  ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active','Inactive']],
],
'uEach' => ['name'],
```

---

## 3. UNIQUENESS MODEL

`uEach` on `name` (single text) → case-insensitive `LOWER()` check, tenant-scoped. Because `master_address_types` has an `is_system` column, `validatePayload` **also** runs the global system-seed collision check (rejects re-creating a seeded name under any tenant). In practice create is blocked before this runs, but the guard covers updates/edge paths.

---

## 4. ENDPOINTS (generic, tenant-scoped)

| Verb | Path | Behaviour |
|---|---|---|
| GET | `/api/master-counts` | Dashboard aggregate |
| GET | `/api/master/address_types` | List |
| GET | `/api/master/address_types/next-code` | `{code:null}` |
| GET | `/api/master/address_types/{id}` | Single row |
| POST | `/api/master/address_types` | **403 always** (locked-fixed) |
| PUT | `/api/master/address_types/{id}` | **403** if `is_system`; else update |
| DELETE | `/api/master/address_types/{id}` | **403** if `is_system`; model also blocks `FIXED_NAMES` |

---

## 5. SPECIAL HANDLING (LOCKED-FIXED + SYSTEM-SEED)

- `store()` has an explicit `$slug === 'address_types'` guard returning **403** before any model work.
- `update()` returns **403** when `row->is_system`.
- `destroy()` has an `$slug === 'address_types' && is_system` guard → **403**.
- Model boot guards enforce the same locks below the API for seeders/Tinker/factories.
- System-seed collision check active (table has `is_system`).

---

## 6. SECURITY & SCOPING

- Reads: `MasterVisibility::applyReadScope`.
- Writes: create fully blocked; updates/deletes on non-system rows still pass through `hierarchicalDenial`.
- Ownership stamp via `resolveOwnership` (only reachable for non-fixed, non-system rows, which practically don't exist given the create block).

---

## 7. METRICS

| Metric | Value |
|---|---|
| Fields | 2 (name, status) + `is_system` flag |
| Required fields | 2 |
| Unique columns | 1 (`uEach` name) |
| Create | Blocked (403) |
| Edit/Delete on system rows | Blocked (403) |
| Referenced by | address sub-forms (Customer/Vendor/Consignee/Entity) |

---

*Related documents: ADDRESS_TYPES_FUNCTIONAL_DOCUMENTATION.md, ADDRESS_TYPES_API_DOCUMENTATION.md, ADDRESS_TYPES_CODE_WALKTHROUGH.md*
