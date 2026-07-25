# RISK LEVELS MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Risk Levels

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Everything is in `app/Http/Controllers/Api/MasterController.php`, driven by the `risk_levels` schema (uEach `name`). Risk Levels is one of the few masters with per-slug guards — watch the `is_system` branches in `update()`, `destroy()`, and `validatePayload()`. Read scope lives in `MasterVisibility.php`.

---

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster(...,'can_view')`.
2. Query + `OWNERSHIP_WITH` + `orderByDesc('id')`; `applyScope()`.
3. Seeded rows (client_id/branch_id NULL) are globals, so they appear for **every** tenant.
4. `?search=` → ILIKE OR across text/select fields; map through `withOwnership`.

---

## 2. CREATE — `store()`

1. `authorizeMaster(...,'can_add')`.
2. `validatePayload()`:
   - `uEach` ci-uniqueness on `name` within the tenant tuple.
   - **System-seed collision:** second query against `client_id NULL / branch_id NULL / is_system=true` — matching "Low"/"High" throws 422.
3. Stamp `created_by` + `resolveOwnership()`, `create()`, bump cache, `201`.

---

## 3. UPDATE — `update()` (is_system 403)

1. `authorizeMaster(...,'can_edit')`, fetch under scope.
2. `hierarchicalDenial()` gate.
3. **`if (!empty($row->is_system)) return 403`** — seeded Low/High are fully locked (name, status, everything).
4. Otherwise `validatePayload($id)` (re-runs uniqueness + seed-collision, ignoring current id) and `update()`.

---

## 4. DELETE — `destroy()` (risk_levels guard)

1. `authorizeMaster(...,'can_delete')`, fetch under scope, `hierarchicalDenial()`.
2. **`if ($slug==='risk_levels' && !empty($row->is_system)) return 403`** with "This risk level is system-managed and cannot be deleted." — protects the KYC/compliance links.
3. Custom rows fall through to `$row->delete()` (soft) + cache bump.

---

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster` | `master.risk_levels`; super_admin bypass |
| Read scope | `applyReadScope` | globals + tier rows |
| Uniqueness | `validatePayload` uEach | LOWER() ci, tenant-scoped |
| Seed lock (edit) | `update()` generic `is_system` | 403 |
| Seed lock (delete) | `destroy()` `risk_levels` branch | 403 |
| Seed lock (create) | `validatePayload` global check | 422 collision |

---

## NOTES

- The `is_system` global-collision check is generic (fires for any master whose table has the column) but here it guards *Low*/*High* specifically.
- `next-code` → `{code:null}` (not in `AUTO_CODES`).

---
*Related documents: RISK_LEVELS_FUNCTIONAL_DOCUMENTATION.md, RISK_LEVELS_TECHNICAL_DOCUMENTATION.md, RISK_LEVELS_API_DOCUMENTATION.md*
