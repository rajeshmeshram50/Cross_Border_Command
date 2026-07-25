# PRODUCT CONDITIONS MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Product Conditions

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `conditions` |
| Model | `App\Models\Masters\Conditions` |
| Table | `master_conditions` |
| Relations | `client`, `branch`, `creator` |
| Fillable | `client_id, branch_id, title, status, created_by` |

---

## 2. SCHEMA SPEC (`MasterController::SCHEMAS`)

```php
'conditions' => ['fields' => [
    ['n' => 'title', 't' => 'text', 'r' => true],
    ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']],
], 'uFields' => ['title']],
```

Derived rules: `title` → required|string|max:50; `status` → required|Rule::in. (No regex on the backend; the frontend adds `P_NAME_NO_DIGITS`.)

---

## 3. UNIQUENESS MODEL

`uFields => ['title']` — single text field. The engine promotes it to case-insensitive `LOWER(title)=LOWER(?)`, tenant-scoped by `(client_id, branch_id)`.

---

## 4. ENDPOINTS

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/conditions` | List (`?search=`, `?branch_id=`) |
| POST | `/master/conditions` | Create |
| GET | `/master/conditions/next-code` | `{ "code": null }` |
| GET | `/master/conditions/{id}` | Show |
| PUT | `/master/conditions/{id}` | Update |
| DELETE | `/master/conditions/{id}` | Soft delete |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no auto-code, backend regex, sublists, uploads, or in-use guard. (The digit-guard pattern is frontend-only.)

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
| Form fields | 2 |
| Uniqueness columns | 1 (`title`, case-insensitive) |
| Reference guards on delete | None |

---
*Related documents: CONDITIONS_FUNCTIONAL_DOCUMENTATION.md, CONDITIONS_API_DOCUMENTATION.md, CONDITIONS_CODE_WALKTHROUGH.md*
