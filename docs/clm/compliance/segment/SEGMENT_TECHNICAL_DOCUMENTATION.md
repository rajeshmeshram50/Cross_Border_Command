# SEGMENT — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Segment**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
A single-table master (`clm_segments`) with a controller that carries three responsibilities beyond CRUD: **usage detection across 9 tables**, **field freezing while referenced**, and **rename cascade into denormalised party columns**. It is also one of two screens that write to the master-bundle cache.

### 1.2 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  CLIENT                                                           │
│  pages/clm/compliance/ClmSegmentPage.tsx                          │
│    tabs(all|highly|less) · search · table · Add/Edit modal        │
│    bustAllMasterBundles() after every write                       │
│  ── the SAME component is mounted at /master/segments ──          │
└────────────────────────────┬─────────────────────────────────────┘
                              │ /api/clm/segments (+ ?branch_id)
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmSegmentController                               │
│    index()    scoped list + counts + batched usageLabels()        │
│    store()    dupe check → nextCode() → create → cache bump       │
│    update()   freeze guards → clash → update → cascadeRename →    │
│               cache bump                                          │
│    destroy()  9-table usage check → 409 | delete → cache bump     │
│  Support: MasterVisibility · MasterBundleCache                    │
└────────────────────────────┬─────────────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  DATA — clm_segments  (PostgreSQL)                                │
│  Referenced by: clm_segment_rules · customers · consignees ·      │
│                 vendors · products · master_vendor_directory ·    │
│                 clm_tnc_library · clm_agreement_library           │
└──────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmSegmentController.php
app/Models/ClmSegment.php
app/Support/MasterVisibility.php · MasterBundleCache.php
database/migrations/2026_05_22_000010_create_clm_segments_table.php
                    2026_05_26_000010_consolidate_segments_into_clm.php
                    2026_05_26_000020_add_branch_id_to_clm_segments.php
                    2026_06_30_000001_rename_segment_code_prefix_to_sg.php
                    2026_07_09_000010_branch_scope_clm_master_code_unique.php
resources/js/pages/clm/compliance/ClmSegmentPage.tsx
resources/js/utils/bustMasterBundles.ts
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| Frontend | React 19 · TS · Velzon/Bootstrap · shared `ClmPageShell` + `WorklistPager` |
| Caching | `MasterBundleCache` (server) + `bustAllMasterBundles()` (client) |

---

## 3. DATABASE SCHEMA — `clm_segments`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `client_id` | FK → clients, **cascadeOnDelete** | tenant |
| `branch_id` | bigint nullable | branch-owned; NULL ⇒ client-level (shared) |
| `code` | varchar(16) | `SG-NNN`; legacy `S-NNN` still parsed |
| `name` | varchar(255) | |
| `regulatory_status` | varchar(16) | `highly` \| `less` |
| `buyer_consignee` | varchar(16) | `allowed` \| `not_allowed` |
| `status` | varchar(16) | default `active` |
| `created_by` / `updated_by` | FK → users, nullOnDelete | |
| `created_at` / `updated_at` | timestamps | no soft deletes |

**Indexes:** `UNIQUE(client_id, branch_id, code)` (branch-scoped since 2026-07-09; originally `UNIQUE(client_id, code)`), `INDEX(client_id, regulatory_status)`.

**History:** `2026_05_26_000010_consolidate_segments_into_clm` merged the legacy `master_segments` table into this one — which is why the code allocator uses MAX+1 rather than `count()+1` (the merge left gaps).

---

## 4. MODEL — `App\Models\ClmSegment`

```php
const REG_HIGHLY='highly'; REG_LESS='less';   REG_VALUES=[…]
const BC_ALLOWED='allowed'; BC_NOT_ALLOWED='not_allowed';  BC_VALUES=[…]
const STATUS_ACTIVE='active'; STATUS_INACTIVE='inactive';  STATUSES=[…]

fillable: client_id, branch_id, code, name, regulatory_status,
          buyer_consignee, status, created_by, updated_by
relations: client() · creator() · updater()
```
No casts, no soft deletes, no global scopes — visibility is applied per query.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/clm/segments',      [ClmSegmentController::class, 'index']);
    Route::post  ('/clm/segments',      [ClmSegmentController::class, 'store']);
    Route::put   ('/clm/segments/{id}', [ClmSegmentController::class, 'update']);
    Route::delete('/clm/segments/{id}', [ClmSegmentController::class, 'destroy']);
});
```
Full detail in **SEGMENT_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### `index()`
Scoped query ordered `id DESC`, then **one batched usage pass** (`usageLabels()`) rather than N×tables queries per row. Returns `counts.{all,highly,less}` computed in PHP off the loaded collection.

### `usageLabels($rows)`
Builds `[segment_id => [labels…]]` with a single query per referencing table:
- **id-based:** `clm_segment_rules.segment_id`, `vendors.segment_id`, `products.segment_id`, `customers.segment_id`
- **string id-or-name:** `master_vendor_directory.segment_id`
- **name-based:** `customers.segment`, `consignees.segment`, `clm_tnc_library.segment`, `clm_agreement_library.segment`

Every lookup is wrapped in `Schema::hasTable()` / `hasColumn()` so the endpoint survives an environment that hasn't run a given migration.

### `store()`
Validate → case-insensitive dupe check **within the caller's read scope** → `DB::transaction { create(branch_id, nextCode()) }` → `MasterBundleCache::bump()`. Duplicates return **422** with `errors.name` so the modal renders inline.

### `update()`
1. Scoped `firstOrFail()` → `hierarchicalDenial('edit')` → 403.
2. Compute `$usedIn` once (same map the index uses).
3. **Name freeze** → 409 when the value actually changes and `$usedIn` is non-empty.
4. **Tier freeze** → 422 under the same condition.
5. Clash check excluding self → 422.
6. Capture `$oldName`, update, then `cascadeSegmentRename()` if the name really changed.
7. `MasterBundleCache::bump()`.

### `cascadeSegmentRename($clientId, $old, $new)`
Walks `customers` / `consignees` where `segment ILIKE '%old%'` and `deleted_at IS NULL`, splits the CSV, and replaces only parts matching `strcasecmp($part, $old) === 0`. Scoped to the **client**, not the branch — a customer in one branch may reference a segment owned by another, and names are effectively client-unique.

### `destroy()`
Re-runs the reference checks individually (not the batched map) and returns 409 with `used_in[]`, else hard-deletes and bumps the cache.

### `nextCode($clientId, $branchId)`
```php
DB::table('clients')->where('id',$clientId)->lockForUpdate()->first();
$codes = ClmSegment::where('client_id',$clientId)
           ->{branchId===null ? whereNull('branch_id') : where('branch_id',$branchId)}
           ->pluck('code');
$maxN = max over /^SG?-(\d+)$/;             // matches SG- AND legacy S-
do { $n++; $code = sprintf('SG-%03d',$n); } while (isset($taken[$code]));
```

---

## 7. FRONTEND — `ClmSegmentPage.tsx`

- Mounted twice: `/clm/segment` and `/master/segments`.
- Uses the shared CLM shell (`CLM_CSS`, `ClmPageHeader`, `ClmBrefBox`, `ICO`) and `ShimmerClmMaster` while loading.
- After every successful write it calls `bustAllMasterBundles()` so the client-side picker caches drop too.
- `in_use` disables the delete control and renders `used_in` inside a themed `Tooltip`.
- The Add/Edit modal renders Name and Regulatory Status read-only when the row is in use — a convenience mirror of the server-side freeze, which is enforced regardless.

---

## 8. INTEGRATIONS

| Consumer | How it reads the segment |
|---|---|
| Document Control Panel | `segment_id` + `segment_code` snapshot on `clm_segment_rules` |
| Customers / Consignees | comma-joined `segment` **names** (+ `customers.segment_id`) |
| Vendors / Products | `segment_id` |
| Agreement / T&C / Trade-Doc libraries | comma-joined `segment` string, matched by name **or** code |
| Buyer & Supplier Profiles | name→id and id→tier maps built at the top of every aggregation |
| Segment picker | `masterBundle`, which only offers segments whose rule has ≥1 document |

---

## 9. SECURITY & CAVEATS

1. `client_id` always comes from `auth()->user()`.
2. Employees read the whole branch (the `clm_` prefix rule in `MasterVisibility`) but mutate only their own rows.
3. Deletes are **hard** — `client_id` is `cascadeOnDelete`, so removing a client removes its segments.
4. The rename cascade uses `ilike '%name%'` to pre-filter then exact-matches in PHP; on a very large customer table this is a full scan of matching rows.
5. `master_vendor_directory.segment_id` is a string holding either an id or a name — both branches are checked.
6. Delete-time checks and the index's `in_use` flag are two separate code paths over the same table list; they must be kept in sync.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmSegmentController`, ~440 lines) |
| Table | 1 |
| Endpoints | 4 |
| Referencing tables | 9 |
| Permission slug | `clm.segment` |
| Code prefix | `SG-NNN` (branch-scoped) |
| Test coverage | none automated |

---

*Related documents: SEGMENT_FUNCTIONAL_DOCUMENTATION.md · SEGMENT_CODE_WALKTHROUGH.md · SEGMENT_API_DOCUMENTATION.md*
