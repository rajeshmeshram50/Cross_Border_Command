# COMPLIANCE BEHAVIOURS MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Compliance Behaviours

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `compliance_behaviours` |
| Model | `App\Models\Masters\ComplianceBehaviours` |
| Table | `master_compliance_behaviours` |
| Soft deletes | Yes (`deleted_at`) |
| Ownership columns | `client_id`, `branch_id`, `created_by` |
| Fillable | `client_id, branch_id, name, action_required, status, created_by` |
| Relations | `client()`, `branch()`, `creator()` |

---

## 2. SCHEMA SPEC

```php
'compliance_behaviours' => ['fields' => [
    ['n'=>'name','t'=>'text','r'=>true],
    ['n'=>'action_required','t'=>'text'],
    ['n'=>'status','t'=>'select','r'=>true,'opts'=>['Active','Inactive']],
], 'uFields' => ['name']],
```

Rules: `name` required string ≤50; `action_required` nullable string ≤50; `status` required in Active/Inactive. Empty → NULL.

---

## 3. UNIQUENESS MODEL

- **`uFields = [name]`** — single text column, promoted to a case-insensitive `LOWER(name)=LOWER(?)` check, scoped to `(client_id, branch_id)`.
- No `is_system` seed rows, so the global collision branch does not apply.

---

## 4. ENDPOINTS

| Verb | Path | Method |
|---|---|---|
| GET | `/master/compliance_behaviours` | `list` |
| POST | `/master/compliance_behaviours` | `store` |
| GET | `/master/compliance_behaviours/next-code` | `nextCode` → `{code:null}` |
| GET | `/master/compliance_behaviours/{id}` | `show` |
| PUT | `/master/compliance_behaviours/{id}` | `update` |
| DELETE | `/master/compliance_behaviours/{id}` | `destroy` (soft) |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no per-slug branches. Generic `is_system` edit-lock present but never triggers (no seeds).

---

## 6. SECURITY & SCOPING

- Reads via `MasterVisibility::applyReadScope`; `?branch_id` honoured only for client admins.
- Writes stamp ownership via `resolveOwnership`; body `client_id` trusted only for super_admin.
- Edit/delete gated by `hierarchicalDenial`.

---

## 7. METRICS

Bare responses, `orderByDesc('id')`, flattened ownership names, `MasterBundleCache` bumped per write. PostgreSQL.

---
*Related documents: COMPLIANCE_BEHAVIOURS_FUNCTIONAL_DOCUMENTATION.md, COMPLIANCE_BEHAVIOURS_API_DOCUMENTATION.md, COMPLIANCE_BEHAVIOURS_CODE_WALKTHROUGH.md*
