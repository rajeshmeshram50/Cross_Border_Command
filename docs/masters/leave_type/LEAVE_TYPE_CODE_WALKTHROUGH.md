# LEAVE TYPE MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Leave Type Master

## DOCUMENT CONTROL

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. How to read

Leave Type is a schema-driven master. There is no dedicated controller — all behaviour comes from `App\Http\Controllers\Api\MasterController` driven by the `MODELS` + `SCHEMAS['leave_type']` registry entries, plus the `App\Models\Masters\LeaveTypes` model's delete hook. File references below are to `MasterController.php` unless noted.

---

## 1. List / Search

`list()` (≈ line 261):
1. `authorizeMaster($request,'leave_type','can_view')` — checks `master.leave_type` permission.
2. Builds `LeaveTypes::query()->with(OWNERSHIP_WITH)->orderByDesc('id')`.
3. `applyScope()` → `MasterVisibility::applyReadScope()` applies tenant + creator-hierarchy scope (and honours `?branch_id=` for switcher roles).
4. If `?search=`, ORs `ilike '%term%'` across text/select fields (`name`, `description`, `type`, `short_code`, `status`).
5. Maps each row through `withOwnership()` to flatten client/branch/creator names.

`show()` (≈ line 306) fetches one scoped row via `findOrFail`.

---

## 2. Create

`store()` (≈ line 316):
1. `authorizeMaster(... 'can_add')`.
2. `validatePayload($request,'leave_type',null)` — see cross-cutting table below.
3. `created_by` = auth id; `resolveOwnership()` stamps `client_id` / `branch_id`.
4. `absorbUploads()` — no file fields on this master, so a no-op.
5. `LeaveTypes::create($data)`; `MasterBundleCache::bump()`; returns 201 with ownership-flattened row.

---

## 3. Update

`update()` (≈ line 366):
1. `authorizeMaster(... 'can_edit')`; fetch scoped row via `findOrFail`.
2. `hierarchicalDenial()` — 403 if the row belongs to a higher tier and isn't the caller's own.
3. `is_system` guard is inert here (`master_leave_types` has no such column).
4. `validatePayload($request,'leave_type',$id)` (ignores self on uniqueness).
5. `$row->update()`; `MasterBundleCache::bump()`; returns 200.

---

## 4. Delete

`destroy()` (≈ line 469):
1. `authorizeMaster(... 'can_delete')`; fetch scoped row.
2. `hierarchicalDenial('delete')` — 403 on tier violation.
3. `$row->delete()` fires `LeaveTypes::booted()` `deleting` listener (model, lines 24-39):
   - Throws `ValidationException` if any `leave_requests.leave_type_id` references the row (LV-26).
   - Otherwise deletes matching `leave_plan_leave_types` pivot rows (no FK there).
4. `MasterBundleCache::bump()`; returns `{message:'Deleted'}`.

---

## Cross-cutting patterns

| Concern | Where | Behaviour for leave_type |
|---|---|---|
| Permission | `authorizeMaster()` | Module `master.leave_type`, per action |
| Read scope | `MasterVisibility::applyReadScope()` | Tenant-scoped, creator-hierarchy |
| Normalize | `validatePayload()` merge (≈ 887) | `short_code` → UPPER before rules |
| Regex | rule builder (≈ 948) | `name` + `short_code` patterns w/ custom messages |
| Uniqueness | uEach block (≈ 994) | `name`, `short_code` case-insensitive, tenant-scoped |
| Ownership stamp | `resolveOwnership()` | `client_id`/`branch_id`/`created_by` |
| Cache | `MasterBundleCache::bump()` | On every write |

---

## Notes

- `next-code` returns `{code:null}` — `leave_type` is absent from `AUTO_CODES`.
- The delete hook is model-level, so it fires for any delete path (API or otherwise), keeping balance sums accurate.
- Frontend form (`masterConfigs.ts` ≈ line 1847) posts a subset of fields; the schema validates the full set.

---

*Related documents: LEAVE_TYPE_FUNCTIONAL_DOCUMENTATION.md, LEAVE_TYPE_TECHNICAL_DOCUMENTATION.md, LEAVE_TYPE_API_DOCUMENTATION.md*
