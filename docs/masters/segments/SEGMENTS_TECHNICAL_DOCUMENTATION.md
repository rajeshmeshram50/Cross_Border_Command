# SEGMENTS MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Segments

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `segments` |
| Model | `App\Models\Masters\Segments` |
| Table | **`clm_segments`** (shared with the CLM Segment module — not a `master_*` table) |
| Soft deletes | Yes (via the shared table) |
| Appends | `title` (accessor over the `name` column) |
| Relations | `client`, `branch`, `creator` |

---

## 2. SCHEMA SPEC (as declared in `MasterController::SCHEMAS`)

```php
'segments' => ['fields' => [
    ['n' => 'title',  't' => 'text',   'r' => true],
    ['n' => 'status', 't' => 'select', 'r' => true, 'opts' => ['Active', 'Inactive']],
], 'uFields' => ['title']],
```

Model-managed extras (set in `booted()::creating`): `code` (`S-%03d` per client), `regulatory_status` (`less`), `buyer_consignee` (`allowed`), `status` lower-cased/normalized.

---

## 3. UNIQUENESS MODEL

`uFields => ['title']` — a single-field text uFields entry. Because it is one text column, the engine *promotes* it to the case-insensitive `LOWER(title) = LOWER(?)` path, tenant-scoped by `(client_id, branch_id)`. Effectively identical to a `uEach` on `title`.

---

## 4. ENDPOINTS

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master-counts` | Batch Active/Inactive/total for the dashboard |
| GET | `/master/segments` | List (`?search=`, `?branch_id=`) |
| POST | `/master/segments` | Create |
| GET | `/master/segments/next-code` | Returns `{ "code": null }` (not an auto-code master) |
| GET | `/master/segments/{id}` | Show |
| PUT | `/master/segments/{id}` | Update |
| DELETE | `/master/segments/{id}` | Soft delete |

All under `auth:sanctum` + `user.active`; each gated by `master.segments` permissions.

---

## 5. SPECIAL HANDLING

- **Title/name aliasing** — `getTitleAttribute()` / `setTitleAttribute()` map `title` ⇄ `name`; `$appends = ['title']` re-surfaces it on every response.
- **Auto code** — `Segments::nextCode($clientId)` counts existing rows and emits `S-001…`; mirrors `ClmSegmentController` so both writers share one counter.
- **Employee READ scope** — `MasterVisibility::applyReadScope` detects the `clm_` table prefix and treats segments as **branch-shared** for employees (they see the whole branch's rows, not just their own). Mutation stays creator/tier-gated.
- **Downstream FK** — `vendor_directory.segment_id` and CLM rules reference `clm_segments.id`; no delete guard exists here.

---

## 6. SECURITY & SCOPING

- READ: `applyReadScope` (super=all; client=globals+own client via switcher; branch_user=globals+client-level+own branch; employee=**branch-shared** for CLM tables).
- WRITE ownership stamped by `resolveOwnership` (`client_id`/`branch_id`/`created_by`); body `client_id` never trusted for non-super.
- Edit/delete gated by `hierarchicalDenial` (own row OK; employees own-only; else row tier ≤ user tier else 403).
- Every write bumps `MasterBundleCache`.

---

## 7. METRICS

| Metric | Value |
|---|---|
| Form fields | 2 (plus 3 model-managed) |
| Uniqueness columns | 1 (`title`, case-insensitive) |
| Reference guards on delete | None |
| Backing table | Shared `clm_segments` |

---
*Related documents: SEGMENTS_FUNCTIONAL_DOCUMENTATION.md, SEGMENTS_API_DOCUMENTATION.md, SEGMENTS_CODE_WALKTHROUGH.md*
