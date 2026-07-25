# LEGAL ENTITIES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Legal Entities

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Legend: `→` a call/step, `⇒` a return. Engine: `MasterController` + `SCHEMAS['legal_entities']`. Model: `App\Models\Masters\LegalEntities` (with `banks()` hasMany + `creating` hook). Bank fan-out in `syncSublists`.

## 1. LIST / SEARCH — `list($request, 'legal_entities')`

```
authorizeMaster(req, 'legal_entities', 'can_view')
q = LegalEntities::with(OWNERSHIP_WITH)->orderByDesc('id')
applyScope(q, user, branch_id)
if search: ILIKE over text/email/textarea/select fields
if country_id and schema has country_id: q->where('country_id', …)
⇒ json(rows.map(withOwnership))   // each row appends banks[] (is_primary desc, id)
```

## 2. CREATE — `store($request, 'legal_entities')`

```
authorizeMaster(req, 'legal_entities', 'can_add')
data = validatePayload(req, 'legal_entities', null)
    → uEach LOWER() uniqueness: entity_name, cin, legal_name
data['created_by'] = user.id
[clientId, branchId] = resolveOwnership(req, user)
data = absorbUploads(req, LegalEntities, 'legal_entities', data)   // logo_path file → disk path
row = LegalEntities::create(data)
    → model creating hook sets entity_code = LE-#### when blank
syncSublists(req, 'legal_entities', row):
    banks = req.input('banks')
    require ≥1 bank with bank_name  (else 422)
    per-bank server regex (name/branch charset, 9–18 account, IFSC)
    upsert by id; delete rows not in keptIds  (true-sync)
MasterBundleCache::bump()
⇒ json(withOwnership(row), 201)   // banks[] inline
```

## 3. UPDATE — `update($request, 'legal_entities', id)`

```
authorizeMaster(req, 'legal_entities', 'can_edit')
row = scoped->findOrFail(id)
hierarchicalDenial(user, row, 'edit') → 403 if disallowed
if row.is_system → 403                // not used here
data = validatePayload(req, 'legal_entities', id)
data = absorbUploads(..., row)        // deletes old logo before writing new
row.update(data)
syncSublists(...)                     // re-syncs banks[]
MasterBundleCache::bump()
⇒ json(withOwnership(row))
```

## 4. DELETE — `destroy($request, 'legal_entities', id)`

```
authorizeMaster(req, 'legal_entities', 'can_delete')
row = scoped->findOrFail(id)
hierarchicalDenial(user, row, 'delete') → 403 if disallowed
// no per-slug in-use guard for legal_entities
row.delete()  (soft)
MasterBundleCache::bump()
⇒ json({message:'Deleted'})
```

## SPECIAL PATH — entity_code auto-number

```
LegalEntities::creating(row):
    if empty(row.entity_code):
        maxN = max suffix of entity_code LIKE 'LE-%'   // whole table
        row.entity_code = 'LE-' + pad(maxN + 1, 4)
```
The generic `nextCode('legal_entities')` is NOT wired to this — it returns `{code:null}` because `legal_entities` is absent from `AUTO_CODES`.

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission | `authorizeMaster` (`master.legal_entities`) |
| Read scope / cascade | `applyReadScope` + `?country_id=` |
| Uniqueness | `validatePayload` uEach |
| Upload | `absorbUploads` (logo_path) |
| Sublist | `syncSublists` (banks[], true-sync) |
| Auto-code | model `creating` hook |
| Cache | `MasterBundleCache::bump()` |

## NOTES

- `withOwnership` special-cases `instanceof LegalEntities` to attach `banks[]`.
- Bank server validation mirrors the frontend regex so a crafted API payload can't bypass the UI.

---
*Related documents: LEGAL_ENTITIES_FUNCTIONAL_DOCUMENTATION.md, LEGAL_ENTITIES_TECHNICAL_DOCUMENTATION.md, LEGAL_ENTITIES_API_DOCUMENTATION.md*
