# HSN CODES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → HSN Codes

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `hsn_codes` |
| Model | `App\Models\Masters\HsnCodes` |
| Table | `master_hsn_codes` |
| Relations | `client`, `branch`, `creator` |
| Fillable | `client_id, branch_id, hsn_code, description, gst_rate_id, status, created_by` |

---

## 2. SCHEMA SPEC (`MasterController::SCHEMAS`)

```php
'hsn_codes' => ['fields' => [
    ['n' => 'hsn_code', 't' => 'text', 'r' => true,
        'pattern' => '/^[0-9]{4,10}$/',
        'patternMessage' => 'HSN/SAC code must be 4 to 10 digits.'],
    ['n' => 'description', 't' => 'textarea', 'r' => true],
    ['n' => 'gst_rate_id', 't' => 'select', 'ref' => 'gst_percentage'],
    ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']],
], 'uEach' => ['hsn_code']],
```

Validation rules derived: `hsn_code` → required|string|max:50|regex; `description` → required|string; `gst_rate_id` → nullable|integer; `status` → required|Rule::in.

---

## 3. UNIQUENESS MODEL

`uEach => ['hsn_code']` — independent per-field uniqueness. As a text field it runs the case-insensitive `LOWER(hsn_code) = LOWER(?)` check scoped by `(client_id, branch_id)`.

---

## 4. ENDPOINTS

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/hsn_codes` | List (`?search=`, `?branch_id=`) |
| POST | `/master/hsn_codes` | Create |
| GET | `/master/hsn_codes/next-code` | `{ "code": null }` |
| GET | `/master/hsn_codes/{id}` | Show |
| PUT | `/master/hsn_codes/{id}` | Update |
| DELETE | `/master/hsn_codes/{id}` | Soft delete |

---

## 5. SPECIAL HANDLING

- **Regex + custom message** — the `pattern`/`patternMessage` pair adds a `regex:` rule and a `{field}.regex` message override in `validatePayload()`.
- **GST rate reference** — `gst_rate_id` is a `ref` to `gst_percentage`; validated as `integer` (accepts string or int from the `<MasterSelect>` hidden input). The delete guard that protects this link lives in `gst_percentage`'s `destroy()` (409 when `master_hsn_codes.gst_rate_id` still points at it).
- No auto-code, no sublists, no uploads — otherwise a standard schema-driven master.

---

## 6. SECURITY & SCOPING

- READ: `MasterVisibility::applyReadScope` (super=all; client=globals+own via switcher; branch_user=globals+client-level+own branch; employee=globals+client-level+own rows). Not a `clm_` table, so employees are peer-isolated.
- WRITE: `resolveOwnership` stamps `client_id/branch_id/created_by`; body `client_id` untrusted for non-super.
- Edit/delete: `hierarchicalDenial` (own row / tier ladder).
- Cache: `MasterBundleCache::bump()` on writes.

---

## 7. METRICS

| Metric | Value |
|---|---|
| Form fields | 4 |
| Regex-validated fields | 1 (`hsn_code`) |
| Reference fields | 1 (`gst_rate_id` → gst_percentage) |
| Uniqueness columns | 1 (`hsn_code`, case-insensitive) |

---
*Related documents: HSN_CODES_FUNCTIONAL_DOCUMENTATION.md, HSN_CODES_API_DOCUMENTATION.md, HSN_CODES_CODE_WALKTHROUGH.md*
