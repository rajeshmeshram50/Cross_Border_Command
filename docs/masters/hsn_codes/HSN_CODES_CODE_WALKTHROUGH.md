# HSN CODES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → HSN Codes

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS

Logic lives in `app/Http/Controllers/Api/MasterController.php` (generic engine) and `app/Support/MasterVisibility.php` (scoping). The model `app/Models/Masters/HsnCodes.php` is a plain Eloquent model — no overrides. Line numbers approximate.

---

## 1. LIST / SEARCH  (`list()` ~L261)

1. `authorizeMaster(..., 'can_view')`.
2. Query eager-loads `client/branch/creator`, `orderByDesc('id')`.
3. `applyScope()` → `applyReadScope()` (peer-isolated for employees; `master_hsn_codes` is not a `clm_` table).
4. `?search=` → `ILIKE %term%` OR over `hsn_code`, `description`, `status`.
5. `withOwnership()` flattens ownership names.

---

## 2. CREATE  (`store()` ~L316)

1. `authorizeMaster(..., 'can_add')`.
2. `validatePayload('hsn_codes')`:
   - Rules loop adds `regex:/^[0-9]{4,10}$/` from the field's `pattern`; the `patternMessage` becomes the `hsn_code.regex` message.
   - `uEach` runs the case-insensitive `LOWER(hsn_code)=LOWER(?)` uniqueness check, tenant-scoped.
3. `created_by` + `resolveOwnership()` stamps.
4. `HsnCodes::create()`; `MasterBundleCache::bump()`; `201`.

---

## 3. UPDATE  (`update()` ~L366)

1. Load within scope; `hierarchicalDenial()` gate; `is_system` block (n/a).
2. `validatePayload(..., $id)` — regex + uniqueness ignoring current id.
3. `update()`; cache bump.

---

## 4. DELETE  (`destroy()` ~L469)

1. Load within scope; `hierarchicalDenial()` gate.
2. No slug-specific guard for `hsn_codes`.
3. `$row->delete()` (soft); cache bump.

> Note: the reciprocal guard is in `gst_percentage`'s `destroy()` (~L523) — it counts `HsnCodes::where('gst_rate_id', $row->id)` and returns 409 if any HSN still references the slab.

---

## SPECIAL PATH — regex + GST reference

- Rules loop (`validatePayload` ~L948): `if (!empty($f['pattern'])) $r[] = 'regex:'.$f['pattern'];`
- Messages loop (~L979): `$messages[$f['n'].'.regex'] = $f['patternMessage'];`
- `gst_rate_id` is a `ref` field → validated as `integer` (~L924).

---

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster()` | `master.hsn_codes.*`; super bypass |
| Read scope | `applyReadScope` | peer-isolated employees |
| Write ownership | `resolveOwnership()` | client/branch/created_by |
| Edit/delete gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `hsn_code` case-insensitive |
| Regex | rules loop | `^[0-9]{4,10}$` + custom message |
| Cache | `MasterBundleCache::bump()` | on writes |

---

## NOTES

- The frontend also validates the HSN pattern and strips non-digits during typing; the backend regex is the authoritative check.
- Deleting an HSN code does not cascade to products that reference it.

---
*Related documents: HSN_CODES_FUNCTIONAL_DOCUMENTATION.md, HSN_CODES_TECHNICAL_DOCUMENTATION.md, HSN_CODES_API_DOCUMENTATION.md*
