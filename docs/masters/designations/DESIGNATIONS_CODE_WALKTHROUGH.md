# DESIGNATIONS MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Designations

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Legend: `→` a call/step, `⇒` a return. Engine: `MasterController` + `SCHEMAS['designations']`. Model: `App\Models\Masters\Designations` (with `creating` hook for `DGN-##`).

## 1. LIST / SEARCH — `list($request, 'designations')`

```
authorizeMaster(req, 'designations', 'can_view')
q = Designations::with(OWNERSHIP_WITH)->orderByDesc('id')
applyScope(q, user, branch_id)
if search: ILIKE over text/select fields
⇒ json(rows.map(withOwnership))
```

## 2. CREATE — `store($request, 'designations')`

```
authorizeMaster(req, 'designations', 'can_add')
data = validatePayload(req, 'designations', null)
    → uFields=[name] single text → LOWER() case-insensitive uniqueness (tenant-scoped)
data['created_by'] = user.id
[clientId, branchId] = resolveOwnership(req, user)
absorbUploads(...) / syncSublists(...)   // no-op
row = Designations::create(data)
    → model creating hook sets code = DGN-## from max(id)+1 when blank
MasterBundleCache::bump()
⇒ json(withOwnership(row), 201)
```

## 3. UPDATE — `update($request, 'designations', id)`

```
authorizeMaster(req, 'designations', 'can_edit')
row = scoped->findOrFail(id)
hierarchicalDenial(user, row, 'edit') → 403 if disallowed
if row.is_system → 403                // unused
data = validatePayload(req, 'designations', id)   // name uniqueness excludes id
row.update(data); MasterBundleCache::bump()
⇒ json(withOwnership(row))
```

## 4. DELETE — `destroy($request, 'designations', id)`

```
authorizeMaster(req, 'designations', 'can_delete')
row = scoped->findOrFail(id)
hierarchicalDenial(user, row, 'delete') → 403 if disallowed
// no per-slug in-use guard
row.delete()  (soft)
MasterBundleCache::bump()
⇒ json({message:'Deleted'})
```

## SPECIAL PATH — auto-code (model hook)

```
Designations::creating(row):
    if empty(row.code):
        next = (int) Designations::max('id') + 1
        row.code = 'DGN-' + pad(next, 2)   // global id-based, grows past 99
```
`nextCode('designations')` ⇒ `{code:null}` (not in `AUTO_CODES`).

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission | `authorizeMaster` (`master.designations`) |
| Read scope | `applyReadScope` |
| Write ownership | `resolveOwnership` |
| Edit/delete gate | `hierarchicalDenial` |
| Uniqueness | `validatePayload` single-text uField on `name` |
| Auto-code | model `creating` hook (DGN-##) |
| Cache | `MasterBundleCache::bump()` |

## NOTES

- Like Roles, the auto-code is a **model hook** (`max(id)+1`), not the controller's `AUTO_CODES`/`next-code`.
- `reports_to_id` is a self FK (integer); `department_id` FK integer. No cycle check, no in-use guard.

---
*Related documents: DESIGNATIONS_FUNCTIONAL_DOCUMENTATION.md, DESIGNATIONS_TECHNICAL_DOCUMENTATION.md, DESIGNATIONS_API_DOCUMENTATION.md*
