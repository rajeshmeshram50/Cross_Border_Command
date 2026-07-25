# SEGMENTS MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Segments

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS

All logic lives in `app/Http/Controllers/Api/MasterController.php` (generic engine), `app/Support/MasterVisibility.php` (scoping), and `app/Models/Masters/Segments.php` (the title/name alias + auto-code). Line numbers below are approximate.

---

## 1. LIST / SEARCH  (`list()` ~L261)

1. `authorizeMaster($request, 'segments', 'can_view')`.
2. `resolveModel('segments')` → `Segments::class`; query eager-loads `client/branch/creator` and `orderByDesc('id')`.
3. `applyScope()` → `MasterVisibility::applyReadScope()`. For employees the `clm_` prefix routes to `applyBranchScope()` (branch-shared read).
4. `?search=` builds an `ILIKE %term%` OR across text/select fields (`title`, `status`).
5. Each row passes through `withOwnership()` — flattens `client_name/branch_name/creator_name`; the model's `$appends` adds `title`.

---

## 2. CREATE  (`store()` ~L316)

1. `authorizeMaster(..., 'can_add')`.
2. `validatePayload()` — required `title`, `status ∈ {Active,Inactive}`, then the case-insensitive uniqueness check on `title`.
3. `created_by` set; `resolveOwnership()` stamps `client_id`/`branch_id`.
4. `Segments::create()` fires `booted()::creating` → sets `code` (`S-NNN`), `regulatory_status`, `buyer_consignee`, normalizes `status`. `setTitleAttribute` writes the value to `name`.
5. `MasterBundleCache::bump()`; returns `201` with appended `title`.

---

## 3. UPDATE  (`update()` ~L366)

1. Load row within scope; `hierarchicalDenial()` gate; `is_system` block (n/a here).
2. `validatePayload($request, 'segments', $id)` — uniqueness ignores the current id.
3. `update()`; cache bump.

---

## 4. DELETE  (`destroy()` ~L469)

1. Load within scope; `hierarchicalDenial()` gate.
2. No slug-specific in-use guard for `segments` (unlike `gst_percentage`).
3. `$row->delete()` (soft); cache bump; `{ "message": "Deleted" }`.

---

## SPECIAL PATH — title/name alias & auto-code

- `Segments::getTitleAttribute()/setTitleAttribute()` map `title` ⇄ `name`.
- `$appends = ['title']` re-surfaces it on serialization.
- `Segments::nextCode($clientId)` counts client rows and emits `S-%03d`, shared with `ClmSegmentController`.
- `applyReadScope()` L89: `str_starts_with($table, 'clm_')` → employees get branch-shared reads.

---

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster()` | `master.segments.*`; super bypass |
| Read scope | `MasterVisibility::applyReadScope` | CLM table → branch-shared for employees |
| Write ownership | `resolveOwnership()` | stamps client/branch/created_by |
| Edit/delete gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `title` case-insensitive, tenant-scoped |
| Cache | `MasterBundleCache::bump()` | on every write |

---

## NOTES

- Because `segments` writes to `clm_segments`, edits made here and on the CLM Segment page are the same records.
- No delete guard — prefer deactivation when a segment is referenced by CLM rules or vendors.

---
*Related documents: SEGMENTS_FUNCTIONAL_DOCUMENTATION.md, SEGMENTS_TECHNICAL_DOCUMENTATION.md, SEGMENTS_API_DOCUMENTATION.md*
