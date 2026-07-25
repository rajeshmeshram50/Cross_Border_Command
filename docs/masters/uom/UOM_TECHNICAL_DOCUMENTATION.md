# UNITS OF MEASUREMENT MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Units of Measurement

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `uom` |
| Model | `App\Models\Masters\Uom` |
| Table | `master_uom` |
| Relations | `client`, `branch`, `creator` |
| Fillable | `client_id, branch_id, title, short_code, unit_type, status, created_by` |

---

## 2. SCHEMA SPEC (`MasterController::SCHEMAS`)

```php
'uom' => ['fields' => [
    ['n' => 'title', 't' => 'text', 'r' => true],
    ['n' => 'short_code', 't' => 'text', 'r' => true],
    ['n' => 'unit_type', 't' => 'select',
        'opts' => ['Weight', 'Volume', 'Length', 'Area', 'Count', 'Other']],
    ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']],
], 'uEach' => ['title', 'short_code']],
```

Derived rules: `title/short_code` → required|string|max:50; `unit_type` → nullable|Rule::in; `status` → required|Rule::in.

Frontend-only extras (`masterConfigs.ts`): `title` pattern `P_NAME_NO_DIGITS`; `short_code` carries `autoDeriveFrom: 'title'`.

---

## 3. UNIQUENESS MODEL

`uEach => ['title', 'short_code']` — each field independently unique. Both text, so each runs case-insensitive `LOWER(col)=LOWER(?)`, tenant-scoped by `(client_id, branch_id)`.

---

## 4. ENDPOINTS

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/uom` | List (`?search=`, `?branch_id=`) |
| POST | `/master/uom` | Create |
| GET | `/master/uom/next-code` | `{ "code": null }` |
| GET | `/master/uom/{id}` | Show |
| PUT | `/master/uom/{id}` | Update |
| DELETE | `/master/uom/{id}` | Soft delete |

---

## 5. SPECIAL HANDLING

- **Auto-derive short code** — a frontend affordance (`autoDeriveFrom: 'title'` in `masterConfigs.ts`): typing the title live-fills `short_code`. The backend performs no derivation; it stores the submitted `short_code` (which is required).
- Otherwise a standard schema-driven master — no auto-code, regex, sublists, uploads, or in-use guard.

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
| Uniqueness columns | 2 (`title`, `short_code` — each case-insensitive) |
| Frontend affordances | short-code auto-derive, digit-guard on title |
| Reference guards on delete | None |

---
*Related documents: UOM_FUNCTIONAL_DOCUMENTATION.md, UOM_API_DOCUMENTATION.md, UOM_CODE_WALKTHROUGH.md*
