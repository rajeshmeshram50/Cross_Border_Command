# LEAVE PLAN MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Leave Plan Master

## DOCUMENT CONTROL

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. How to read

Leave Plan is a schema-driven master with no dedicated controller. Behaviour comes from `App\Http\Controllers\Api\MasterController`, driven by the `MODELS['leave_plan']` + `SCHEMAS['leave_plan']` registry entries. The `App\Models\Masters\LeavePlans` model adds relations only (no lifecycle hooks). Line references below are to `MasterController.php`.

---

## 1. List / Search

`list()` (≈ line 261):
1. `authorizeMaster($request,'leave_plan','can_view')`.
2. `LeavePlans::query()->with(OWNERSHIP_WITH)->orderByDesc('id')`.
3. `applyScope()` → `MasterVisibility::applyReadScope()` (tenant + creator-hierarchy; `?branch_id=` for switcher roles).
4. `?search=` ORs `ilike '%term%'` across text/select fields (`plan_name`, `description`, `from_month_type`, `from_month`, `calendar_year`, `policy_explanation_mode`, `policy_doc_path`, `status`).
5. `withOwnership()` flattens client/branch/creator names.

`show()` (≈ line 306) returns one scoped row via `findOrFail`.

---

## 2. Create

`store()` (≈ line 316):
1. `authorizeMaster(... 'can_add')`.
2. `validatePayload($request,'leave_plan',null)` — enum rules on selects; case-insensitive uniqueness on `plan_name`.
3. `created_by` = auth id; `resolveOwnership()` stamps `client_id` / `branch_id`.
4. `absorbUploads()` is a no-op (no file fields).
5. `LeavePlans::create($data)`; `MasterBundleCache::bump()`; returns 201.

---

## 3. Update

`update()` (≈ line 366):
1. `authorizeMaster(... 'can_edit')`; fetch scoped row via `findOrFail`.
2. `hierarchicalDenial('edit')` — 403 on tier violation.
3. `is_system` guard inert (no such column on `master_leave_plans`).
4. `validatePayload($request,'leave_plan',$id)` (self-ignored on uniqueness).
5. `$row->update()`; `MasterBundleCache::bump()`; returns 200.

---

## 4. Delete

`destroy()` (≈ line 469):
1. `authorizeMaster(... 'can_delete')`; fetch scoped row.
2. `hierarchicalDenial('delete')` — 403 on tier violation.
3. No model delete hook, no slug-specific guard → `$row->delete()` (soft).
4. `MasterBundleCache::bump()`; returns `{message:'Deleted'}`.

---

## Cross-cutting patterns

| Concern | Where | Behaviour for leave_plan |
|---|---|---|
| Permission | `authorizeMaster()` | Module `master.leave_plan`, per action |
| Read scope | `MasterVisibility::applyReadScope()` | Tenant-scoped, creator-hierarchy |
| Uniqueness | `singleTextUFields` block (≈ 994) | `plan_name` case-insensitive, tenant-scoped |
| Conditional field | `masterConfigs.ts` `showWhen` | `from_month` shown only when mode = Calendar (UI only) |
| Ownership stamp | `resolveOwnership()` | `client_id`/`branch_id`/`created_by` |
| Cache | `MasterBundleCache::bump()` | On every write |

---

## Notes

- `next-code` returns `{code:null}` — `leave_plan` is absent from `AUTO_CODES`.
- The `from_month` conditional-requirement lives entirely in the frontend `showWhen` config; the backend schema leaves it nullable, so an API caller can submit Calendar mode without a month.
- Downstream: `LeavePlans` links `LeaveTypes` (pivot `leave_plan_leave_types`) and `Employee` (pivot `leave_plan_employees`) — those associations are managed by the HR Leave module, not this generic master endpoint.

---

*Related documents: LEAVE_PLAN_FUNCTIONAL_DOCUMENTATION.md, LEAVE_PLAN_TECHNICAL_DOCUMENTATION.md, LEAVE_PLAN_API_DOCUMENTATION.md*
