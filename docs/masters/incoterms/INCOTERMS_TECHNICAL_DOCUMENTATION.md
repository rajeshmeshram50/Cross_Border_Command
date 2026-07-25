# INCOTERMS MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Incoterms

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `incoterms` |
| Model | `App\Models\Masters\Incoterms` |
| Table | `master_incoterms` |
| Relations | `client`, `branch`, `creator` |
| Fillable | `client_id, branch_id, code, full_name, transport_mode, status, created_by` |

---

## 2. SCHEMA SPEC (`MasterController::SCHEMAS`)

```php
'incoterms' => ['fields' => [
    ['n' => 'code', 't' => 'text', 'r' => true],
    ['n' => 'full_name', 't' => 'text', 'r' => true],
    ['n' => 'transport_mode', 't' => 'select',
        'opts' => ['Sea/Inland Waterway', 'Any Mode', 'Air', 'Road', 'Rail']],
    ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']],
], 'uEach' => ['code', 'full_name']],
```

Derived rules: `code/full_name` → required|string|max:50; `transport_mode` → nullable|Rule::in; `status` → required|Rule::in.

---

## 3. UNIQUENESS MODEL

`uEach => ['code', 'full_name']` — each field independently unique. Both text, so each runs case-insensitive `LOWER(col)=LOWER(?)`, tenant-scoped by `(client_id, branch_id)`.

---

## 4. ENDPOINTS

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/incoterms` | List (`?search=`, `?branch_id=`) |
| POST | `/master/incoterms` | Create |
| GET | `/master/incoterms/next-code` | `{ "code": null }` |
| GET | `/master/incoterms/{id}` | Show |
| PUT | `/master/incoterms/{id}` | Update |
| DELETE | `/master/incoterms/{id}` | Soft delete |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no auto-code, backend regex, sublists, uploads, or in-use guard. The only nuance is the dual `uEach` (`code` + `full_name`).

---

## 6. SECURITY & SCOPING

- READ: `applyReadScope` (peer-isolated employees; not a `clm_` table).
- WRITE: `resolveOwnership` stamps `client_id/branch_id/created_by`; body `client_id` untrusted for non-super.
- Edit/delete: `hierarchicalDenial` (own row / tier ladder).
- Cache: `MasterBundleCache::bump()` on writes.

---

## 7. METRICS

| Metric | Value |
|---|---|
| Form fields | 4 |
| Uniqueness columns | 2 (`code`, `full_name` — each case-insensitive) |
| Reference guards on delete | None |

---
*Related documents: INCOTERMS_FUNCTIONAL_DOCUMENTATION.md, INCOTERMS_API_DOCUMENTATION.md, INCOTERMS_CODE_WALKTHROUGH.md*
