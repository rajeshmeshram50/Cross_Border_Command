# KPI MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → KPI Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Legend: `→` a call/step, `⇒` a return. Engine: `MasterController` + `SCHEMAS['kpis']`. Model: `App\Models\Masters\Kpis`.

## 1. LIST / SEARCH — `list($request, 'kpis')`

```
authorizeMaster(req, 'kpis', 'can_view')
q = Kpis::with(OWNERSHIP_WITH)->orderByDesc('id')
applyScope(q, user, branch_id)
if search: ILIKE over text/textarea/select fields
⇒ json(rows.map(withOwnership))
```

## 2. CREATE — `store($request, 'kpis')`

```
authorizeMaster(req, 'kpis', 'can_add')
data = validatePayload(req, 'kpis', null)
    → uFields=[name] single text → LOWER() case-insensitive uniqueness (tenant-scoped)
    → role_id integer; target_type/priority/status Rule::in(...)
data['created_by'] = user.id
[clientId, branchId] = resolveOwnership(req, user)
absorbUploads(...) / syncSublists(...)   // no-op
row = Kpis::create(data)
MasterBundleCache::bump()
⇒ json(withOwnership(row), 201)
```

## 3. UPDATE — `update($request, 'kpis', id)`

```
authorizeMaster(req, 'kpis', 'can_edit')
row = scoped->findOrFail(id)
hierarchicalDenial(user, row, 'edit') → 403 if disallowed
if row.is_system → 403                // unused
data = validatePayload(req, 'kpis', id)   // name uniqueness excludes id
row.update(data); MasterBundleCache::bump()
⇒ json(withOwnership(row))
```

## 4. DELETE — `destroy($request, 'kpis', id)`

```
authorizeMaster(req, 'kpis', 'can_delete')
row = scoped->findOrFail(id)
hierarchicalDenial(user, row, 'delete') → 403 if disallowed
// no per-slug in-use guard
row.delete()  (soft)
MasterBundleCache::bump()
⇒ json({message:'Deleted'})
```

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission | `authorizeMaster` (`master.kpis`) |
| Read scope | `applyReadScope` |
| Write ownership | `resolveOwnership` |
| Edit/delete gate | `hierarchicalDenial` |
| Uniqueness | `validatePayload` single-text uField on `name` |
| Cache | `MasterBundleCache::bump()` |

## NOTES

- No auto-code: `nextCode('kpis')` ⇒ `{code:null}`. The `code` column is fillable but unused by the form.
- `role_id` FK validated as integer only (no tenant-scope cross-check on the referenced role).

---
*Related documents: KPIS_FUNCTIONAL_DOCUMENTATION.md, KPIS_TECHNICAL_DOCUMENTATION.md, KPIS_API_DOCUMENTATION.md*
