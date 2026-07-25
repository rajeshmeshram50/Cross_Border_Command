# COMPANY DETAILS MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Company Details

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Legend: `→` a call/step, `⇒` a return. All logic lives in `App\Http\Controllers\Api\MasterController` driven by `SCHEMAS['company']`. Model: `App\Models\Masters\Company`.

## 1. LIST / SEARCH — `list($request, 'company')`

```
authorizeMaster(req, 'company', 'can_view')
q = Company::with(OWNERSHIP_WITH)->orderByDesc('id')
applyScope(q, user, branch_id)            → MasterVisibility::applyReadScope
if search: orWhere ILIKE over text/email/textarea/select fields
⇒ json(rows.map(withOwnership))           // client_name/branch_name/creator_name added
```

## 2. CREATE — `store($request, 'company')`

```
authorizeMaster(req, 'company', 'can_add')
data = validatePayload(req, 'company', null)
    → normalize upper: gstin, pan, cin
    → rules: required/nullable, string max 50, email, Rule::in(status)
    → uEach: LOWER() uniqueness on company_name, gstin, pan (tenant-scoped)
data['created_by'] = user.id
[clientId, branchId] = resolveOwnership(req, user)   // body client_id ignored for non-super
data['client_id'|'branch_id'] = clientId | branchId
absorbUploads(...)                          // no-op — no file fields
row = Company::create(data)
syncSublists(...)                           // no-op — no sublist
MasterBundleCache::bump()
⇒ json(withOwnership(row), 201)
```

## 3. UPDATE — `update($request, 'company', id)`

```
authorizeMaster(req, 'company', 'can_edit')
row = Company::scoped(applyScope)->findOrFail(id)
denial = hierarchicalDenial(user, row, 'edit')  → 403 if row tier > user tier (own row OK)
if row.is_system → 403                          // column absent here, never fires
data = validatePayload(req, 'company', id)      // uEach ignores current id
row.update(data); MasterBundleCache::bump()
⇒ json(withOwnership(row))
```

## 4. DELETE — `destroy($request, 'company', id)`

```
authorizeMaster(req, 'company', 'can_delete')
row = Company::scoped(applyScope)->findOrFail(id)
denial = hierarchicalDenial(user, row, 'delete') → 403 if disallowed
// no per-slug in-use guard for company
row.delete()  (soft)
MasterBundleCache::bump()
⇒ json({message: 'Deleted'})
```

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission | `authorizeMaster` (`master.company`) |
| Read scope | `MasterVisibility::applyReadScope` |
| Write ownership | `resolveOwnership` |
| Edit/delete tier gate | `MasterVisibility::hierarchicalDenial` |
| Uniqueness | `validatePayload` uEach LOWER() block |
| Normalization | `validatePayload` normalizers (upper) |
| Cache refresh | `MasterBundleCache::bump()` on every write |

## NOTES

- `nextCode('company')` short-circuits to `{code: null}` — not in `AUTO_CODES`.
- No `absorbUploads` / `syncSublists` effect: company has no `*_file` fields and is not `LegalEntities`.

---
*Related documents: COMPANY_FUNCTIONAL_DOCUMENTATION.md, COMPANY_TECHNICAL_DOCUMENTATION.md, COMPANY_API_DOCUMENTATION.md*
