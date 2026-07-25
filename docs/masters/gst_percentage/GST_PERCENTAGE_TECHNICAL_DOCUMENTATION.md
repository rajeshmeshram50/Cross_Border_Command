# GST PERCENTAGES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → GST Percentages

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `gst_percentage` |
| Model | `App\Models\Masters\GstPercentage` |
| Table | `master_gst_percentage` (column `percentage` is `DECIMAL(5,2)`) |
| Relations | `client`, `branch`, `creator` |
| Fillable | `client_id, branch_id, percentage, status, created_by` |

---

## 2. SCHEMA SPEC (`MasterController::SCHEMAS`)

```php
'gst_percentage' => ['fields' => [
    ['n' => 'percentage', 't' => 'number', 'r' => true],
    ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']],
], 'uFields' => ['percentage']],
```

Derived rules: `percentage` → required|numeric (no min/max at the master layer — the 0–100 cap is frontend-only); `status` → required|Rule::in.

---

## 3. UNIQUENESS MODEL

`uFields => ['percentage']` — single-field. Because `percentage` is a **number** (not text), the engine keeps exact-match `Rule::unique` (it is *not* promoted to the case-insensitive `LOWER()` path), tenant-scoped by `(client_id, branch_id)`.

---

## 4. ENDPOINTS

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master/gst_percentage` | List (returns `in_use`) |
| POST | `/master/gst_percentage` | Create |
| GET | `/master/gst_percentage/next-code` | `{ "code": null }` |
| GET | `/master/gst_percentage/{id}` | Show (returns `in_use`) |
| PUT | `/master/gst_percentage/{id}` | Update |
| DELETE | `/master/gst_percentage/{id}` | Soft delete — **409 if referenced** |

---

## 5. SPECIAL HANDLING

**In-use `in_use` flag** — `withOwnership()` (~L641) adds it for `GstPercentage` rows:

```php
if ($row instanceof \App\Models\Masters\GstPercentage) {
    $arr['in_use'] = \App\Models\Product::where('gst_id', $row->id)->exists()
        || \App\Models\Masters\HsnCodes::where('gst_rate_id', $row->id)->exists();
}
```

**409 delete guard** — `destroy()` (~L523):

```php
if ($slug === 'gst_percentage') {
    $productHits = Product::where('gst_id', $row->id)->count();
    $hsnHits     = HsnCodes::where('gst_rate_id', $row->id)->count();
    if ($productHits > 0 || $hsnHits > 0) {
        return response()->json(['message' => '...in use by...'], 409);
    }
}
```

No auto-code, sublists, or uploads.

---

## 6. SECURITY & SCOPING

- READ: `applyReadScope` (peer-isolated employees; not a `clm_` table).
- WRITE: `resolveOwnership` stamps `client_id/branch_id/created_by`; body `client_id` untrusted for non-super.
- Edit/delete: `hierarchicalDenial` (own row / tier ladder) — evaluated *before* the 409 in-use guard.
- Cache: `MasterBundleCache::bump()` on writes.

---

## 7. METRICS

| Metric | Value |
|---|---|
| Form fields | 1 (`percentage`) + status |
| Uniqueness columns | 1 (`percentage`, exact match — numeric) |
| Reference guards on delete | 2 (`products.gst_id`, `master_hsn_codes.gst_rate_id`) → 409 |
| Computed response field | `in_use` |

---
*Related documents: GST_PERCENTAGE_FUNCTIONAL_DOCUMENTATION.md, GST_PERCENTAGE_API_DOCUMENTATION.md, GST_PERCENTAGE_CODE_WALKTHROUGH.md*
