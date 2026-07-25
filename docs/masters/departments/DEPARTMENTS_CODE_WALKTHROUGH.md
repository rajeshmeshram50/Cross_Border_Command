# DEPARTMENT MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Department Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Legend: `→` a call/step, `⇒` a return. Engine: `MasterController` + `SCHEMAS['departments']` + `AUTO_CODES['departments']`. Model: `App\Models\Masters\Departments`.

## 1. LIST / SEARCH — `list($request, 'departments')`

```
authorizeMaster(req, 'departments', 'can_view')
q = Departments::with(OWNERSHIP_WITH)->orderByDesc('id')
applyScope(q, user, branch_id)
if search: ILIKE over text/email/select fields
⇒ json(rows.map(withOwnership))
```

## 2. CREATE — `store($request, 'departments')`

```
authorizeMaster(req, 'departments', 'can_add')
data = validatePayload(req, 'departments', null)
    → uEach LOWER() uniqueness: name, code (tenant-scoped)
data['created_by'] = user.id
[clientId, branchId] = resolveOwnership(req, user)   // branch_user/employee → (client, branch)
absorbUploads(...) / syncSublists(...)               // no-op
row = Departments::create(data)
MasterBundleCache::bump()
⇒ json(withOwnership(row), 201)
```

## 3. UPDATE — `update($request, 'departments', id)`

```
authorizeMaster(req, 'departments', 'can_edit')
row = scoped->findOrFail(id)
hierarchicalDenial(user, row, 'edit') → 403 if disallowed
if row.is_system → 403                // unused here
data = validatePayload(req, 'departments', id)
row.update(data); MasterBundleCache::bump()
⇒ json(withOwnership(row))
```

## 4. DELETE — `destroy($request, 'departments', id)`

```
authorizeMaster(req, 'departments', 'can_delete')
row = scoped->findOrFail(id)
hierarchicalDenial(user, row, 'delete') → 403 if disallowed
// no per-slug in-use guard
row.delete()  (soft)
MasterBundleCache::bump()
⇒ json({message:'Deleted'})
```

## SPECIAL PATH — auto-code — `nextCode($request, 'departments')`

```
authorizeMaster(req, 'departments', 'can_view')
cfg = AUTO_CODES['departments'] = { col:'code', prefix:'DEPT-', pad:3 }
q = Departments::query(); applyScope(q, user, branch_id)   // same scope as list()
codes = q->pluck('code')
max = highest int matched by /^DEPT-(\d+)$/i
next = 'DEPT-' + pad(max + 1, 3)
⇒ json({ code: next, prefix: 'DEPT-' })
```
Scope mirrors `list()` deliberately: a user who can *see* DEPT-001…010 (via a broader scope) won't be handed a colliding DEPT-001.

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission | `authorizeMaster` (`master.departments`) |
| Read scope | `applyReadScope` |
| Write ownership (tenant) | `resolveOwnership` (branch tuple) |
| Edit/delete gate | `hierarchicalDenial` |
| Uniqueness | `validatePayload` uEach (name, code) |
| Auto-code | `AUTO_CODES` + `nextCode` (DEPT-###) |
| Cache | `MasterBundleCache::bump()` |

## NOTES

- Auto-code lives in the controller registry, not a model hook (contrast Roles/Designations which use model hooks).
- `parent_id` is a self FK; validated as an integer, no cycle check.

---
*Related documents: DEPARTMENTS_FUNCTIONAL_DOCUMENTATION.md, DEPARTMENTS_TECHNICAL_DOCUMENTATION.md, DEPARTMENTS_API_DOCUMENTATION.md*
