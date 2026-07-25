# RISK LEVELS MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Risk Levels

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `risk_levels` |
| Model | `App\Models\Masters\RiskLevels` |
| Table | `master_risk_levels` |
| Soft deletes | Yes (`deleted_at`) |
| Ownership columns | `client_id`, `branch_id`, `created_by` |
| Fillable | `client_id, branch_id, name, description, action_required, status, created_by` |
| Seed flag | `is_system` column (Low / High seeded at NULL/NULL scope) |
| Relations | `client()`, `branch()`, `creator()` |

---

## 2. SCHEMA SPEC

```php
'risk_levels' => ['fields' => [
    ['n'=>'name','t'=>'text','r'=>true],
    ['n'=>'description','t'=>'text'],
    ['n'=>'action_required','t'=>'text'],
    ['n'=>'status','t'=>'select','r'=>true,'opts'=>['Active','Inactive']],
], 'uEach' => ['name']],
```

Text fields cap at 50 chars. Empty strings → NULL post-validation.

---

## 3. UNIQUENESS MODEL

- **`uEach = [name]`**, single text → promoted to a case-insensitive `LOWER(name)=LOWER(?)` check, scoped to `(client_id, branch_id)`.
- **System-seed collision:** because `master_risk_levels` has an `is_system` column, `validatePayload` runs a second lookup against global (`client_id`/`branch_id` NULL, `is_system=true`) rows and rejects a matching name with a 422 — you cannot shadow-create *Low*/*High*.

---

## 4. ENDPOINTS

| Verb | Path | Method |
|---|---|---|
| GET | `/master/risk_levels` | `list` |
| POST | `/master/risk_levels` | `store` |
| GET | `/master/risk_levels/next-code` | `nextCode` → `{code:null}` |
| GET | `/master/risk_levels/{id}` | `show` |
| PUT | `/master/risk_levels/{id}` | `update` |
| DELETE | `/master/risk_levels/{id}` | `destroy` (soft) |

---

## 5. SPECIAL HANDLING

This master carries two per-slug protections beyond the generic engine:

| Path | Code | Effect |
|---|---|---|
| `update()` | generic `if (!empty($row->is_system)) → 403` | Seeded Low/High cannot be edited |
| `destroy()` | `if ($slug==='risk_levels' && !empty($row->is_system)) → 403` | Seeded Low/High cannot be deleted ("This risk level is system-managed…") |
| `validatePayload()` | `is_system` global collision check | Cannot re-create Low/High by name (422) |

---

## 6. SECURITY & SCOPING

- Reads via `MasterVisibility::applyReadScope`; writes stamp ownership via `resolveOwnership` (body `client_id` trusted only for super_admin).
- `hierarchicalDenial` runs before the `is_system` checks on edit/delete.

---

## 7. METRICS

Bare responses, `orderByDesc('id')`, flattened ownership names, `MasterBundleCache` bumped per write. PostgreSQL backing. Frontend KPI "System Fixed" counts `is_system` rows.

---
*Related documents: RISK_LEVELS_FUNCTIONAL_DOCUMENTATION.md, RISK_LEVELS_API_DOCUMENTATION.md, RISK_LEVELS_CODE_WALKTHROUGH.md*
