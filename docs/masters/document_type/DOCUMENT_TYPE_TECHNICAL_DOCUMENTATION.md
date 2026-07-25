# DOCUMENT TYPES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Document Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `document_type` |
| Model | `App\Models\Masters\DocumentType` |
| Table | `master_document_type` |
| Soft deletes | Yes (`deleted_at`) |
| Ownership columns | `client_id`, `branch_id`, `created_by` |
| Fillable | `client_id, branch_id, title, applicable_to, is_mandatory, status, created_by` |
| Relations | `client()`, `branch()`, `creator()` |

---

## 2. SCHEMA SPEC

```php
'document_type' => ['fields' => [
    ['n'=>'title','t'=>'text','r'=>true],
    ['n'=>'applicable_to','t'=>'select','opts'=>['Customer','Vendor','Supplier','Both','Internal']],
    ['n'=>'is_mandatory','t'=>'select','opts'=>['Yes','No']],
    ['n'=>'status','t'=>'select','r'=>true,'opts'=>['Active','Inactive']],
], 'uFields' => ['title']],
```

Rules: `title` required string ≤50; `applicable_to`/`is_mandatory` nullable with `Rule::in`; `status` required in Active/Inactive. Empty → NULL.

---

## 3. UNIQUENESS MODEL

- **`uFields = [title]`** — a single text column. Because it is not composite (count 1), it is promoted to `singleTextUFields` and enforced case-insensitively via `LOWER(title)=LOWER(?)`, scoped to `(client_id, branch_id)`.
- No `is_system` seed rows, so the global collision branch does not apply.

---

## 4. ENDPOINTS

| Verb | Path | Method |
|---|---|---|
| GET | `/master/document_type` | `list` |
| POST | `/master/document_type` | `store` |
| GET | `/master/document_type/next-code` | `nextCode` → `{code:null}` |
| GET | `/master/document_type/{id}` | `show` |
| PUT | `/master/document_type/{id}` | `update` |
| DELETE | `/master/document_type/{id}` | `destroy` (soft) |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no per-slug branches in `store/update/destroy`. Generic `is_system` edit-lock present but never triggers (no seeds).

---

## 6. SECURITY & SCOPING

- Reads via `MasterVisibility::applyReadScope`; `?branch_id` honoured only for client admins.
- Writes stamp ownership via `resolveOwnership`; body `client_id` trusted only for super_admin.
- Edit/delete gated by `hierarchicalDenial`.

---

## 7. METRICS

Bare responses, `orderByDesc('id')`, flattened ownership names, `MasterBundleCache` bumped per write. PostgreSQL.

---
*Related documents: DOCUMENT_TYPE_FUNCTIONAL_DOCUMENTATION.md, DOCUMENT_TYPE_API_DOCUMENTATION.md, DOCUMENT_TYPE_CODE_WALKTHROUGH.md*
