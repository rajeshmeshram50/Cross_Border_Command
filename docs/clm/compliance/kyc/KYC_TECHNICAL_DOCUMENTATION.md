# KYC — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **KYC**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
A one-table document catalogue (`clm_kyc_documents`) whose controller is the **reference implementation** of the CLM master pattern: branch-scoped read, scope-relative duplicate check, authority normalisation to ids, usage-guarded delete, branch-sequenced code allocation. `ClmDdController` and `ClmTradeLicenseController` are near-identical copies.

### 1.2 High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                             │
│  pages/clm/compliance/ClmKycPage.tsx                                │
│    list · search · AuthorityBadges chips · KycModal                 │
│    ── KycModal is ALSO imported by ClmDcpPage ──                    │
└──────────────────────────────┬─────────────────────────────────────┘
                                │ /api/clm/kyc-documents (+ ?branch_id)
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmKycController                                     │
│    index()   scoped list → idNameMap → authority_names → in_use     │
│    store()   dupe(scope) → normalizeIds → nextCode(KYC-) → create   │
│    update()  denial → validate → normalizeIds → clash → update      │
│    destroy() usageCheck() → 409 used_in | delete                    │
│  Support: MasterVisibility · ClmAuthority statics                   │
└──────────────────────────────┬─────────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  DATA — clm_kyc_documents                                           │
│  Referenced BY CODE from:                                           │
│    clm_segment_rules.doc_selections["kyc"]["KYC-003"] = "M"|"O"     │
│    segment_doc_uploads.doc_code = "KYC-003"                         │
│  References BY ID:  clm_authorities.id (comma-joined)               │
└────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmKycController.php
app/Models/ClmKycDocument.php
app/Models/ClmAuthority.php                 ← normalizeIds / idNameMap / displayNames
app/Support/MasterVisibility.php
database/migrations/2026_05_22_000030_create_clm_kyc_documents_table.php
                    2026_06_06_000200_widen_authority_on_clm_kyc_documents_table.php
                    2026_06_17_000000_convert_clm_doc_authority_to_ids.php
                    2026_07_06_000001_add_branch_id_to_clm_compliance_masters.php
                    2026_07_09_000010_branch_scope_clm_master_code_unique.php
resources/js/pages/clm/compliance/ClmKycPage.tsx   (exports KycModal)
resources/js/pages/clm/compliance/AuthorityBadges.tsx
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| Frontend | React 19 · TS · shared CLM page shell · `MasterMultiSelect` for authorities |

---

## 3. DATABASE SCHEMA — `clm_kyc_documents`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `client_id` | FK → clients, cascadeOnDelete | |
| `branch_id` | bigint nullable | NULL ⇒ client-level (shared) |
| `code` | varchar(16) | `KYC-NNN`, per branch — **this is the key downstream tables store** |
| `name` | varchar(255) | PAN Card, Aadhaar Card, GST Certificate … |
| `authority` | varchar(2000) | comma-joined **authority ids** (widened 2026-06-06) |
| `expiry` | varchar(32) | default `N/A`; also `Varies` or `MM/YYYY` |
| `status` | varchar(16) | default `active` |
| `created_by` / `updated_by` | FK → users, nullOnDelete | |
| timestamps | | no soft deletes |

**Indexes:** `UNIQUE(client_id, branch_id, code)`, `INDEX(client_id, status)`.

> The original migration described `authority` as free text. `2026_06_17_000000_convert_clm_doc_authority_to_ids` converted it to an id list; unresolvable tokens were left as-is and still pass through the display helpers unchanged.

---

## 4. MODEL — `App\Models\ClmKycDocument`

```php
const STATUS_ACTIVE='active'; STATUS_INACTIVE='inactive'; STATUSES=[…]
fillable: client_id, branch_id, code, name, authority, expiry, status, created_by, updated_by
relations: client()
```
No casts and no soft deletes — a thin master. All authority intelligence lives in `ClmAuthority`.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/clm/kyc-documents',      [ClmKycController::class, 'index']);
    Route::post  ('/clm/kyc-documents',      [ClmKycController::class, 'store']);
    Route::put   ('/clm/kyc-documents/{id}', [ClmKycController::class, 'update']);
    Route::delete('/clm/kyc-documents/{id}', [ClmKycController::class, 'destroy']);
});
```
KYC rows are **also** served (pre-resolved) by `/clm/segment-rules/bootstrap` and `/clm/segment-rules/for-segment/{id}`. Full detail in **KYC_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### `index()`
1. `MasterVisibility::applyReadScope` with the switcher's `branch_id`, ordered `id ASC`.
2. `ClmAuthority::idNameMap($clientId)` once, then `authority_names` stamped per row.
3. `usageCheck($r->code)` per row → `in_use` + `used_in[]`.

Returns `{ data, count }`.

### `store()`
- Validates `name` (required, ≤255), `authority` (required, ≤2000), `expiry` (≤32), `status`.
- Duplicate name check runs **inside the caller's read scope**, so a sibling branch may reuse the name.
- `ClmAuthority::normalizeIds()` converts whatever the client sent (ids and/or names) into the canonical id list; an empty result throws a 422 on the `authority` field.
- `DB::transaction { create(... branch_id, nextCode()) }`.

### `update()`
Scoped `firstOrFail` → `hierarchicalDenial('edit')` → 403 → validate (`sometimes`) → re-normalise authority if present → clash check excluding self → update.

### `destroy()`
Scoped `firstOrFail` → `hierarchicalDenial('delete')` → `usageCheck` → **409 with `used_in`** or hard delete.

### `usageCheck(?string $code)`
```php
clm_segment_rules.doc_selections  LIKE '%"KYC-003"%'  → 'Segment Rules'
segment_doc_uploads.doc_code      = 'KYC-003'         → 'Segment Doc Uploads'
```
Both guarded by `Schema::hasTable()` / `hasColumn()`.
**Known gap:** neither query filters `client_id`. Because codes restart per tenant, another tenant's reference to *their* `KYC-001` can block your delete. `ClmQcController::usageCheck()` is the scoped version of the same logic.

### `nextCode($clientId, $branchId)`
Client row lock → `MAX(/^KYC-(\d+)$/) + 1` → skip taken → `KYC-%03d`. Branch-scoped: `whereNull('branch_id')` for a client-level creator, `where('branch_id', $bid)` otherwise.

---

## 7. FRONTEND — `ClmKycPage.tsx`

- Standard CLM shell (`CLM_CSS`, `ClmPageHeader`, `ClmBrefBox`, `ShimmerClmMaster`, `WorklistPager`).
- Authority column renders `AuthorityBadges` from `authority_list` (never from the joined string).
- `in_use` disables Delete and renders `used_in` in a themed tooltip.
- **Exports `KycModal`**, which `ClmDcpPage.tsx` imports so a user can create a missing KYC document mid-rule-configuration. The DCP re-fetches its bootstrap payload afterwards.

---

## 8. INTEGRATIONS

| Consumer | How |
|---|---|
| Document Control Panel | `bootstrap()` ships the branch-scoped KYC list with `authority` + `authority_list` resolved; the rule stores the **code** with an `M`/`O` value |
| Customer / Consignee / Vendor forms | `forSegment()` resolves `doc_selections['kyc']` codes back into full rows stamped with `requirement` |
| Evidence Vault | `segment_doc_uploads.doc_code` holds the KYC code; `doc_name` + `requirement` are snapshotted at upload time so the vault renders what the user *saw* |
| Buyer / Supplier Profile | Counts uploaded-vs-required KYC docs per party |

---

## 9. SECURITY & CAVEATS

1. `client_id` always derived from `auth()->user()`; `normalizeIds()` and `idNameMap()` are tenant-scoped.
2. Employees read the whole branch (the `clm_` prefix rule) but mutate only their own rows.
3. **`usageCheck()` is not client-scoped** — see §6. Fixing it means adding `->where('client_id', $clientId)` to both queries, exactly as `ClmQcController` does.
4. `doc_selections` matching is a raw JSON substring test (`LIKE '%"KYC-003"%'`), portable but not structural.
5. Deletes are hard; `client_id` cascades from `clients`.
6. `authority` at 2,000 chars bounds a document to roughly 200 authority ids.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmKycController`, ~200 lines) |
| Table | 1 |
| Endpoints | 4 (+2 read-through via segment-rules) |
| Referencing tables | 2 |
| Permission slug | `clm.kyc` |
| Code prefix | `KYC-NNN` (branch-scoped) |
| Test coverage | none automated |

---

*Related documents: KYC_FUNCTIONAL_DOCUMENTATION.md · KYC_CODE_WALKTHROUGH.md · KYC_API_DOCUMENTATION.md*
