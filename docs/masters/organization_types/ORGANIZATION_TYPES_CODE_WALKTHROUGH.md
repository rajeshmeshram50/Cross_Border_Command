# ORGANIZATION TYPES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Organization Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Legend: `→` a call/step, `⇒` a return. This master does **not** use `MasterController`. All logic is in `App\Http\Controllers\Api\OrganizationTypeController`; model `App\Models\OrganizationType`.

## 1. LIST / SEARCH — `index($request)`

```
q = OrganizationType::orderBy('sort_order')->orderBy('name')
if req.boolean('active_only'): q->where('status', 'active')
if search: q->where('name', 'ilike', "%search%")
⇒ json(q->get())          // no scoping, no ownership flattening
```

## 2. CREATE — `store($request)`

```
authorizeSuperAdmin(req)   → 403 if user.user_type !== 'super_admin'
data = req.validate({
    name: required|string|max:100|unique:organization_types,name,
    icon: nullable|string|max:50,
    description: nullable|string|max:255,
    status: required|in:active,inactive,
    sort_order: nullable|integer|min:0
})
data['slug'] = Str::slug(data['name'])
data['sort_order'] = data['sort_order'] ?? (max(sort_order) + 1)
type = OrganizationType::create(data)
MasterBundleCache::bump()
⇒ json(type, 201)
```

## 3. UPDATE — `update($request, $organizationType)`

```
authorizeSuperAdmin(req)
data = req.validate({ …, name: unique:…,{id} })
if data['name'] !== org.name: data['slug'] = Str::slug(data['name'])
org.update(data)
MasterBundleCache::bump()
⇒ json(org)
```
Route-model binding resolves `{id}` → `$organizationType`; no manual tenant scope (table has no ownership columns).

## 4. DELETE — `destroy($request, $organizationType)`

```
authorizeSuperAdmin(req)
inUse = Client::where('org_type', org.name)->exists()
if inUse: ⇒ json({message:'Cannot delete — …used by existing clients.'}, 422)
org.delete()               // hard delete
MasterBundleCache::bump()
⇒ json({message:'Organization type deleted'})
```

## SPECIAL PATH — dashboard count

`MasterController::counts` iterates `MODELS`, which includes
`'organization_types' => App\Models\OrganizationType::class`. For super admins it counts all rows; for others it only appears if they hold `master.organization_types` `can_view`. The count uses the same `status IN ('active','1','true','yes','enabled')` aggregate — `active`/`inactive` map correctly.

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Authorization | `authorizeSuperAdmin` (super-admin only for writes) |
| Slug | `Str::slug(name)` on create / name-change |
| Sort order default | `max(sort_order)+1` |
| Delete guard | `Client::where('org_type', name)->exists()` |
| Cache | `MasterBundleCache::bump()` on every write |
| Dashboard count | `MasterController::counts` (MODELS entry) |

## NOTES

- No `applyReadScope`, `resolveOwnership`, `hierarchicalDenial`, `validatePayload`, `absorbUploads`, or `syncSublists` — none of the generic engine helpers run for this master.
- Delete is a **hard** delete (no SoftDeletes on this model).

---
*Related documents: ORGANIZATION_TYPES_FUNCTIONAL_DOCUMENTATION.md, ORGANIZATION_TYPES_TECHNICAL_DOCUMENTATION.md, ORGANIZATION_TYPES_API_DOCUMENTATION.md*
