# LICENSE TYPES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → License Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

All behaviour lives in `app/Http/Controllers/Api/MasterController.php`, driven by the `license_name` entry in `SCHEMAS` (uEach `name`, `license_code`). There is no dedicated controller. Read scoping is in `app/Support/MasterVisibility.php`.

---

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($request,'license_name','can_view')`.
2. Build query with `OWNERSHIP_WITH` eager loads, `orderByDesc('id')`.
3. `applyScope()` → `MasterVisibility::applyReadScope()` restricts rows to the caller's tier.
4. `?search=` wraps an ILIKE OR across text/select fields.
5. Return `$q->get()->map(withOwnership)` — flattens `client_name`/`branch_name`/`creator_name`.

---

## 2. CREATE — `store()`

1. `authorizeMaster(...,'can_add')`.
2. `validatePayload()` — required/type rules + `uEach` case-insensitive uniqueness on `name` and `license_code`.
3. `created_by` = current user; `resolveOwnership()` stamps `client_id`/`branch_id`.
4. `create()`, `MasterBundleCache::bump()`, return `201`.

---

## 3. UPDATE — `update()`

1. `authorizeMaster(...,'can_edit')`, fetch under scope.
2. `hierarchicalDenial()` — 403 if the row is above the user's tier.
3. Generic `is_system` guard: `if (!empty($row->is_system)) → 403`. (No seeded rows here, so it never fires.)
4. `validatePayload($request,'license_name',$id)` — same uniqueness, ignoring the current id.
5. `update()`, bump cache.

---

## 4. DELETE — `destroy()`

1. `authorizeMaster(...,'can_delete')`, fetch under scope.
2. `hierarchicalDenial()` gate.
3. No per-slug guard for `license_name` — straight to `$row->delete()` (soft) + cache bump.

---

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster` | `master.license_name` flag; super_admin bypass |
| Read scope | `MasterVisibility::applyReadScope` | creator-hierarchy tiers |
| Write ownership | `resolveOwnership` | stamps client/branch/created_by |
| Uniqueness | `validatePayload` uEach loop | LOWER() ci, tenant-scoped, both fields |
| Cache | `MasterBundleCache::bump` | after every write |

---

## NOTES

- Frontend `masterConfigs.ts` marks only `license_code` unique; backend `uEach` also enforces `name`.
- `next-code` is `{code:null}` (not in `AUTO_CODES`).

---
*Related documents: LICENSE_NAME_FUNCTIONAL_DOCUMENTATION.md, LICENSE_NAME_TECHNICAL_DOCUMENTATION.md, LICENSE_NAME_API_DOCUMENTATION.md*
