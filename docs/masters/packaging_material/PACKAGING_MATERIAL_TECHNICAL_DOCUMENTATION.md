# PACKAGING MATERIALS MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Packaging Materials

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `packaging_material` |
| Model | `App\Models\Masters\PackagingMaterial` |
| Table | `master_packaging_material` |
| Relations | `client`, `branch`, `creator` |
| Fillable | `client_id, branch_id, title, material_type, status, created_by` |

---

## 2. SCHEMA SPEC (`MasterController::SCHEMAS`)

```php
'packaging_material' => ['fields' => [
    ['n' => 'title', 't' => 'text', 'r' => true],
    ['n' => 'material_type', 't' => 'select',
        'opts' => ['Bag', 'Box', 'Crate', 'Drum', 'Pallet', 'Wrap', 'Other']],
    ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']],
], 'uEach' => ['title']],
```

Derived rules: `title` → required|string|max:50; `material_type` → nullable|Rule::in; `status` → required|Rule::in.

---

## 3. UNIQUENESS MODEL

`uEach => ['title']` — single text field, run case-insensitively (`LOWER(title)=LOWER(?)`), tenant-scoped by `(client_id, branch_id)`.

---

## 4. ENDPOINTS

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/packaging_material` | List (`?search=`, `?branch_id=`) |
| POST | `/master/packaging_material` | Create |
| GET | `/master/packaging_material/next-code` | `{ "code": null }` |
| GET | `/master/packaging_material/{id}` | Show |
| PUT | `/master/packaging_material/{id}` | Update |
| DELETE | `/master/packaging_material/{id}` | Soft delete |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no auto-code, regex, sublists, uploads, in-use guard, or computed flags.

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
| Form fields | 3 |
| Uniqueness columns | 1 (`title`, case-insensitive) |
| Reference guards on delete | None |

---
*Related documents: PACKAGING_MATERIAL_FUNCTIONAL_DOCUMENTATION.md, PACKAGING_MATERIAL_API_DOCUMENTATION.md, PACKAGING_MATERIAL_CODE_WALKTHROUGH.md*
