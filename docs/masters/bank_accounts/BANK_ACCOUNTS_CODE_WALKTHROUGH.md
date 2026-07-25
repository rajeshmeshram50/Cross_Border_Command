# BANK ACCOUNTS MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Bank Accounts

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Legend: `→` a call/step, `⇒` a return. Engine: `MasterController` + `SCHEMAS['bank_accounts']`. Model: `App\Models\Masters\BankAccounts`.

## 1. LIST / SEARCH — `list($request, 'bank_accounts')`

```
authorizeMaster(req, 'bank_accounts', 'can_view')
q = BankAccounts::with(OWNERSHIP_WITH)->orderByDesc('id')
applyScope(q, user, branch_id)
if search: ILIKE over text/select fields
⇒ json(rows.map(withOwnership))
```

## 2. CREATE — `store($request, 'bank_accounts')`

```
authorizeMaster(req, 'bank_accounts', 'can_add')
data = validatePayload(req, 'bank_accounts', null)
    → normalize upper: ifsc_code
    → per-field regex: bank_name, account_holder, account_number, ifsc_code, ad_code
    → COMPOSITE uniqueness: (account_number, ifsc_code) tenant-scoped, LOWER() on text
data['created_by'] = user.id
[clientId, branchId] = resolveOwnership(req, user)
absorbUploads(...)   // no-op
row = BankAccounts::create(data)
syncSublists(...)    // no-op
MasterBundleCache::bump()
⇒ json(withOwnership(row), 201)
```

## 3. UPDATE — `update($request, 'bank_accounts', id)`

```
authorizeMaster(req, 'bank_accounts', 'can_edit')
row = scoped->findOrFail(id)
hierarchicalDenial(user, row, 'edit') → 403 if disallowed
if row.is_system → 403                // no such column, never fires
data = validatePayload(req, 'bank_accounts', id)   // composite check excludes id
row.update(data); MasterBundleCache::bump()
⇒ json(withOwnership(row))
```

## 4. DELETE — `destroy($request, 'bank_accounts', id)`

```
authorizeMaster(req, 'bank_accounts', 'can_delete')
row = scoped->findOrFail(id)
hierarchicalDenial(user, row, 'delete') → 403 if disallowed
// no per-slug in-use guard
row.delete()  (soft)
MasterBundleCache::bump()
⇒ json({message:'Deleted'})
```

## SPECIAL PATH — composite uniqueness

```
// in validatePayload, isComposite = count(uFields) > 1 = true
query = BankAccounts::query()
foreach [account_number, ifsc_code] as col:
    isTextField(col) ? whereRaw('LOWER(col)=LOWER(?)', val) : where(col, val)
scope by (client_id, branch_id); exclude current id on update
if query->exists(): 422 "A record with this combination of account_number + ifsc_code already exists."
```

## CROSS-CUTTING PATTERNS

| Concern | Where |
|---|---|
| Permission | `authorizeMaster` (`master.bank_accounts`) |
| Read scope | `applyReadScope` |
| Write ownership | `resolveOwnership` |
| Edit/delete gate | `hierarchicalDenial` |
| Normalization | upper `ifsc_code` |
| Uniqueness | composite `uFields` block |
| Field regex | `pattern` + `patternMessage` per field |
| Cache | `MasterBundleCache::bump()` |

## NOTES

- `nextCode('bank_accounts')` ⇒ `{code:null}` (not in `AUTO_CODES`).
- Both composite columns are `text`, so both compare case-insensitively.

---
*Related documents: BANK_ACCOUNTS_FUNCTIONAL_DOCUMENTATION.md, BANK_ACCOUNTS_TECHNICAL_DOCUMENTATION.md, BANK_ACCOUNTS_API_DOCUMENTATION.md*
