# TRIGGER POINT MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Trigger Point Master

## DOCUMENT CONTROL

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. How to read

- `→ call` = a function/method invoked.
- `⇒ return` = value handed back to caller.
- All logic lives in the generic `MasterController` (`App\Http\Controllers\Api\MasterController`); `trigger_point` supplies only its `MODELS` + `SCHEMAS` entry.

---

## 1. List / Search — `GET /master/trigger_point`

```
index('trigger_point', request)
  → authorizeMaster('trigger_point', 'view')      // master.trigger_point can_view (super bypass)
  → resolve model = TriggerPoints, schema = SCHEMAS['trigger_point']
  → query = TriggerPoints::query()->with(client, branch, creator)
  → MasterVisibility::applyReadScope(query, user)  // tier + tenantScoped filter, ?branch_id
  → if ?search: WHERE module_name ILIKE %s% OR description ILIKE %s%
  → orderByDesc('id')
  ⇒ bare JSON array, each flattened with client_name/branch_name/creator_name/creator_user_type
```

---

## 2. Create — `POST /master/trigger_point`

```
store('trigger_point', request)
  → authorizeMaster('trigger_point', 'add')
  → validatePayload(schema, body)                  // required module_name+status, status in [Active,Inactive]
  → uniqueness: uFields=['module_name'] LOWER() within tenant scope → 422 on hit
  → resolveOwnership(user): stamp client_id, branch_id, created_by (body client_id ignored non-super)
  → empty strings ⇒ NULL
  → TriggerPoints::create(payload)
  → MasterBundleCache::bump()
  ⇒ 201 bare created row
```

---

## 3. Update — `PUT /master/trigger_point/{id}`

```
update('trigger_point', id, request)
  → authorizeMaster('trigger_point', 'edit')
  → row = TriggerPoints::findOrFail(id)             // 404 if missing/soft-deleted
  → hierarchicalDenial(row, user)                   // own row OK; employees own-only; else tier ≤ actor else 403
  → validatePayload(schema, body)
  → uniqueness on module_name excluding current id → 422 on hit
  → row->update(payload); empty ⇒ NULL
  → MasterBundleCache::bump()
  ⇒ bare updated row
```

---

## 4. Delete — `DELETE /master/trigger_point/{id}`

```
destroy('trigger_point', id)
  → authorizeMaster('trigger_point', 'delete')
  → row = TriggerPoints::findOrFail(id)
  → hierarchicalDenial(row, user)                   // 403 if row tier > actor tier
  → row->delete()                                   // soft delete, sets deleted_at
  → MasterBundleCache::bump()
  ⇒ success message
```

---

## Cross-cutting patterns

| Concern | Mechanism | Effect for trigger_point |
|---|---|---|
| Permission | `authorizeMaster` | Gates on `master.trigger_point`; super bypass |
| Read scope | `MasterVisibility::applyReadScope` | Globals + tenant rows per tier; `tenantScoped` |
| Write ownership | `resolveOwnership` | Stamps client/branch/created_by |
| Edit/delete tier | `hierarchicalDenial` | Own row or row tier ≤ actor tier |
| Validation | `validatePayload` | required/enum/string(max 50) |
| Uniqueness | `uFields` LOWER() | `module_name` unique per tenant |
| Cache | `MasterBundleCache` | Bumped on every write |
| Soft delete | Eloquent `deleted_at` | Rows retained, hidden from lists |

---

## Notes

- No custom hooks: `trigger_point` is a plain schema entry, so all four verbs run the shared code path unchanged.
- `next-code` short-circuits to `{code:null}` because the schema declares no code field.
- Responses are intentionally **bare** (no `{data}` envelope) to match the rest of the Masters module and `MasterPage.tsx` expectations.

---

*Related documents: TRIGGER_POINT_FUNCTIONAL_DOCUMENTATION.md, TRIGGER_POINT_TECHNICAL_DOCUMENTATION.md, TRIGGER_POINT_API_DOCUMENTATION.md*
