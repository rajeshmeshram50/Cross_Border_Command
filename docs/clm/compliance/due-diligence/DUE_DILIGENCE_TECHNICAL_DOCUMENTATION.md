# DUE DILIGENCE (DD) — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Due Diligence (DD)**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
A one-table risk-document catalogue (`clm_dd_documents`). `ClmDdController` is a structural twin of `ClmKycController` — same scoping, same authority normalisation, same usage-guarded delete, same branch-sequenced allocator — differing only in the code prefix (`DD-`), the validation messages and the vault category (`dd`).

### 1.2 High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                             │
│  pages/clm/compliance/ClmDdPage.tsx                                 │
│    list · search · AuthorityBadges chips · DdModal                  │
│    ── DdModal is ALSO imported by ClmDcpPage ──                     │
└──────────────────────────────┬─────────────────────────────────────┘
                                │ /api/clm/dd-documents (+ ?branch_id)
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmDdController                                      │
│    index()   scoped list → idNameMap → authority_names → in_use     │
│    store()   dupe(scope) → normalizeIds → nextCode(DD-) → create    │
│    update()  denial → validate → normalizeIds → clash → update      │
│    destroy() usageCheck() → 409 used_in | delete                    │
└──────────────────────────────┬─────────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  DATA — clm_dd_documents                                            │
│  Referenced BY CODE from:                                           │
│    clm_segment_rules.doc_selections["dd"]["DD-002"] = "M"|"O"       │
│    segment_doc_uploads (category='dd', doc_code='DD-002')           │
│  References BY ID:  clm_authorities.id (comma-joined)               │
└────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmDdController.php
app/Models/ClmDdDocument.php
app/Models/ClmAuthority.php                 ← normalizeIds / idNameMap / displayNames
app/Support/MasterVisibility.php
database/migrations/2026_05_22_000040_create_clm_dd_documents_table.php
                    2026_06_06_000100_widen_authority_on_clm_dd_documents_table.php
                    2026_06_17_000000_convert_clm_doc_authority_to_ids.php
                    2026_07_06_000001_add_branch_id_to_clm_compliance_masters.php
                    2026_07_09_000010_branch_scope_clm_master_code_unique.php
resources/js/pages/clm/compliance/ClmDdPage.tsx   (exports DdModal)
resources/js/pages/clm/compliance/AuthorityBadges.tsx
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| Frontend | React 19 · TS · shared CLM page shell · `MasterMultiSelect` for authorities |

---

## 3. DATABASE SCHEMA — `clm_dd_documents`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `client_id` | FK → clients, cascadeOnDelete | |
| `branch_id` | bigint nullable | NULL ⇒ client-level (shared) |
| `code` | varchar(16) | `DD-NNN`, per branch — the key downstream tables store |
| `name` | varchar(255) | Bank Reference Letter, Credit Rating Report … |
| `authority` | varchar(2000) | comma-joined **authority ids** (widened 2026-06-06) |
| `expiry` | varchar(32) | default `N/A`; also `Varies` or `MM/YYYY` |
| `status` | varchar(16) | default `active` |
| `created_by` / `updated_by` | FK → users, nullOnDelete | |
| timestamps | | no soft deletes |

**Indexes:** `UNIQUE(client_id, branch_id, code)`, `INDEX(client_id, status)`.

---

## 4. MODEL — `App\Models\ClmDdDocument`

```php
const STATUS_ACTIVE='active'; STATUS_INACTIVE='inactive'; STATUSES=[…]
fillable: client_id, branch_id, code, name, authority, expiry, status, created_by, updated_by
relations: client()
```
Identical shape to `ClmKycDocument`. No casts, no soft deletes; all authority logic lives in `ClmAuthority`.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/clm/dd-documents',      [ClmDdController::class, 'index']);
    Route::post  ('/clm/dd-documents',      [ClmDdController::class, 'store']);
    Route::put   ('/clm/dd-documents/{id}', [ClmDdController::class, 'update']);
    Route::delete('/clm/dd-documents/{id}', [ClmDdController::class, 'destroy']);
});
```
DD rows are also served (pre-resolved) by `/clm/segment-rules/bootstrap` and `/clm/segment-rules/for-segment/{id}` under the `dd` key. Full detail in **DUE_DILIGENCE_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### `index()`
Scoped list ordered `id ASC` → `ClmAuthority::idNameMap()` once → `authority_names` per row → `usageCheck($r->code)` per row for `in_use` / `used_in`. Returns `{ data, count }`.

### `store()`
Validates `name` (≤255), `authority` (≤2000), `expiry` (≤32), `status`. Duplicate name check runs **inside the caller's read scope**. `ClmAuthority::normalizeIds()` canonicalises the authority list; an empty result throws 422 on `authority`. Insert wrapped in `DB::transaction`, stamping `branch_id` and the allocated `code`.

Duplicate-name failures are raised via `ValidationException::withMessages(['name' => …])` — i.e. a standard Laravel **422** with an `errors.name` array (unlike `ClmTradeLicenseController`, which hand-builds the same envelope).

### `update()`
Scoped `firstOrFail` → `hierarchicalDenial('edit')` → validate (`sometimes`) → re-normalise authority when present → clash check excluding self → update. **No in-use edit lock** — downstream stores the code, so a rename is always safe.

### `destroy()`
Scoped `firstOrFail` → `hierarchicalDenial('delete')` → `usageCheck` → 409 with `used_in` or hard delete.

### `usageCheck(?string $code)`
```php
clm_segment_rules.doc_selections  LIKE '%"DD-002"%'  → 'Segment Rules'
segment_doc_uploads.doc_code      = 'DD-002'        → 'Segment Doc Uploads'
```
Both guarded by `Schema::hasTable()` / `hasColumn()`.
**Known gap:** neither query filters `client_id`; see §9.

### `nextCode($clientId, $branchId)`
Client row lock → `MAX(/^DD-(\d+)$/) + 1` → skip taken → `DD-%03d`, branch-scoped.

---

## 7. FRONTEND — `ClmDdPage.tsx`

- Standard CLM shell (`CLM_CSS`, `ClmPageHeader`, `ClmBrefBox`, `ShimmerClmMaster`, `WorklistPager`).
- Authority column renders `AuthorityBadges` from `authority_list`.
- `in_use` disables Delete and shows `used_in` in a themed tooltip.
- **Exports `DdModal`**, imported by `ClmDcpPage.tsx` so a missing DD document can be added mid-rule-configuration; the DCP re-fetches its bootstrap payload afterwards.

---

## 8. INTEGRATIONS

| Consumer | How |
|---|---|
| Document Control Panel | `bootstrap()` ships the branch-scoped DD list with `authority` + `authority_list`; the rule stores the **code** with an `M`/`O` value under `doc_selections.dd` |
| Customer / Consignee / Vendor forms | `forSegment()` resolves `doc_selections['dd']` codes back into full rows stamped with `requirement` |
| Evidence Vault | `segment_doc_uploads` rows with `category = 'dd'`; `doc_name` + `requirement` snapshotted at upload |
| Buyer / Supplier Profile | The `dd` progress ratio in every compliance scorecard |
| Regulatory Defense File | DD completion is one of the five tracked document families (`kyc`, `dd`, `tl`, `td`, `agr`) |

---

## 9. SECURITY & CAVEATS

1. `client_id` always derived from `auth()->user()`; authority helpers are tenant-scoped.
2. Employees read the whole branch (the `clm_` prefix rule in `MasterVisibility`) but mutate only their own rows.
3. **`usageCheck()` is not client-scoped.** Because `DD-NNN` codes restart per tenant, a foreign tenant's reference can block a delete. The fix mirrors `ClmQcController`: add `->where('client_id', $clientId)` to both lookups.
4. `doc_selections` matching is a raw JSON substring test — portable, not structural.
5. Deletes are hard; `client_id` cascades from `clients`.
6. `authority` at 2,000 characters bounds a document to roughly 200 authority ids.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmDdController`, ~200 lines) |
| Table | 1 |
| Endpoints | 4 (+2 read-through via segment-rules) |
| Referencing tables | 2 |
| Permission slug | `clm.due_diligence` |
| Code prefix | `DD-NNN` (branch-scoped) |
| Vault category | `dd` |
| Test coverage | none automated |

---

*Related documents: DUE_DILIGENCE_FUNCTIONAL_DOCUMENTATION.md · DUE_DILIGENCE_CODE_WALKTHROUGH.md · DUE_DILIGENCE_API_DOCUMENTATION.md*
