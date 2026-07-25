# ROLES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Roles

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Legend: `→` a call/step, `⇒` a return. Engine: `MasterController` + `SCHEMAS['roles']`. Model: `App\Models\Masters\Roles` (with `creating` hook for `ROL-##`).

## 1. LIST / SEARCH — `list($request, 'roles')`

```
authorizeMaster(req, 'roles', 'can_view')
q = Roles::with(OWNERSHIP_WITH)->orderByDesc('id')
applyScope(q, user, branch_id)
if search: ILIKE over text/textarea/select fields
⇒ json(rows.map(withOwnership))
```

## 2. CREATE — `store($request, 'roles')`

```
authorizeMaster(req, 'roles', 'can_add')
data = validatePayload(req, 'roles', null)
    → uFields=[name] single text → LOWER() case-insensitive uniqueness (tenant-scoped)
data['created_by'] = user.id
[clientId, branchId] = resolveOwnership(req, user)
absorbUploads(...) / syncSublists(...)   // no-op
row = Roles::create(data)
    → model creating hook sets code = ROL-## from max(id)+1 when blank
MasterBundleCache::bump()
⇒ json(withOwnership(row), 201)
```

## 3. UPDATE — `update($request, 'roles', id)`

```
authorizeMaster(req, 'roles', 'can_edit')
row = scoped->findOrFail(id)
hierarchicalDenial(user, row, 'edit') → 403 if disallowed
if row.is_system → 403                // unused
data = validatePayload(req, 'roles', id)   // name uniqueness excludes id
row.update(data); MasterBundleCache::bump()
⇒ json(withOwnership(row))
```

## 4. DELETE — `destroy($request, 'roles', id)`

```
authorizeMaster(req, 'roles', 'can_delete')
row = scoped->findOrFail(id)
hierarchicalDenial(user, row, 'delete') → 403 if disallowed
// no per-slug in-use guard
row.delete()  (soft)
MasterBundleCache::bump()
⇒ json({message:'Deleted'})
```

## SPECIAL PATH — auto-code (model hook)

```
Roles::creating(row):
    if empty(row.code):
        next = (int) Roles::max('id') + 1
        row.code = 'ROL-' + pad(next, 2)   // global id-based, not per-tenant
```
`nextCode('roles')` ⇒ `{code:null}` — `roles` is absent from `AUTO_CODES`, so the code is not pre-fetched by the form.

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission | `authorizeMaster` (`master.roles`) |
| Read scope | `applyReadScope` |
| Write ownership | `resolveOwnership` |
| Edit/delete gate | `hierarchicalDenial` |
| Uniqueness | `validatePayload` single-text uField on `name` |
| Auto-code | model `creating` hook (ROL-##) |
| Cache | `MasterBundleCache::bump()` |

## NOTES

- Contrast with Departments: Roles' auto-code is a **model hook** (`max(id)+1`), not the controller's `AUTO_CODES`/`next-code` path.
- `department_id` FK validated as integer; no in-use guard on delete.

---
*Related documents: ROLES_FUNCTIONAL_DOCUMENTATION.md, ROLES_TECHNICAL_DOCUMENTATION.md, ROLES_API_DOCUMENTATION.md*
