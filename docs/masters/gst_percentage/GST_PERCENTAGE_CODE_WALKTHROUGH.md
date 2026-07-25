# GST PERCENTAGES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → GST Percentages

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS

Logic lives in `app/Http/Controllers/Api/MasterController.php` (generic engine) and `app/Support/MasterVisibility.php` (scoping). The model `app/Models/Masters/GstPercentage.php` is a plain Eloquent model. The two GST-specific hooks — the `in_use` flag and the 409 delete guard — are both in the controller. Line numbers approximate.

---

## 1. LIST / SEARCH  (`list()` ~L261)

1. `authorizeMaster(..., 'can_view')`.
2. Eager-load `client/branch/creator`, `orderByDesc('id')`, `applyScope()`.
3. Search (`?search=`) is limited to text/select fields — `percentage` is numeric so it is not matched by ILIKE; `status` is.
4. Each row → `withOwnership()`, which for `GstPercentage` appends **`in_use`** via two `exists()` probes (`Product.gst_id`, `HsnCodes.gst_rate_id`).

---

## 2. CREATE  (`store()` ~L316)

1. `authorizeMaster(..., 'can_add')`.
2. `validatePayload('gst_percentage')` — `required|numeric`; `uFields=['percentage']` numeric → exact-match `Rule::unique`, tenant-scoped.
3. `resolveOwnership()` stamps; `create()`; cache bump; `201` with `in_use`.

---

## 3. UPDATE  (`update()` ~L366)

1. Load within scope; `hierarchicalDenial()`; `is_system` block (n/a).
2. `validatePayload(..., $id)` — uniqueness ignores current id.
3. `update()`; cache bump.

---

## 4. DELETE  (`destroy()` ~L469) — the in-use guard path

1. `authorizeMaster(..., 'can_delete')`; load within scope.
2. `hierarchicalDenial()` gate → `403` if the user can't mutate the row.
3. **GST in-use guard** (~L523):
   ```php
   if ($slug === 'gst_percentage') {
       $productHits = Product::where('gst_id', $row->id)->count();
       $hsnHits     = HsnCodes::where('gst_rate_id', $row->id)->count();
       if ($productHits > 0 || $hsnHits > 0) {
           // build "N products and M HSN codes" phrase
           return response()->json(['message' => '...'], 409);
       }
   }
   ```
4. If clear → `$row->delete()` (soft); `MasterBundleCache::bump()`.

---

## SPECIAL PATH — `in_use` flag  (`withOwnership()` ~L641)

```php
if ($row instanceof GstPercentage) {
    $arr['in_use'] = Product::where('gst_id', $row->id)->exists()
        || HsnCodes::where('gst_rate_id', $row->id)->exists();
}
```
The flag mirrors the 409 guard so the UI can disable Delete before the user tries.

---

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster()` | `master.gst_percentage.*`; super bypass |
| Read scope | `applyReadScope` | peer-isolated employees |
| Write ownership | `resolveOwnership()` | client/branch/created_by |
| Edit/delete gate | `hierarchicalDenial()` | evaluated before 409 guard |
| Uniqueness | `validatePayload()` | `percentage` exact match (numeric) |
| In-use guard | `destroy()` | 409 when products/HSN reference the row |
| In-use flag | `withOwnership()` | `in_use` boolean on every row |
| Cache | `MasterBundleCache::bump()` | on writes |

---

## NOTES

- Order matters in `destroy()`: the tier/ownership `403` is decided before the referential `409`.
- The `in_use` probes are cheap (the table holds only a handful of rows).

---
*Related documents: GST_PERCENTAGE_FUNCTIONAL_DOCUMENTATION.md, GST_PERCENTAGE_TECHNICAL_DOCUMENTATION.md, GST_PERCENTAGE_API_DOCUMENTATION.md*
