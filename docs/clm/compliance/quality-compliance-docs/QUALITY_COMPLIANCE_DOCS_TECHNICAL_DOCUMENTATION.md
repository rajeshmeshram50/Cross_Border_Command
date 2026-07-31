# QUALITY & COMPLIANCE DOCS (QC) — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Quality & Compliance Docs**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
A one-table quality catalogue (`clm_qc_documents`) with the richest field set of the four CLM document masters — 7 business columns versus KYC's 4. `ClmQcController` follows the standard master pattern but is the **only one whose usage check is correctly scoped by `client_id`**, and the only one whose authority column is named `issued_by` rather than `authority`.

### 1.2 High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                             │
│  pages/clm/compliance/ClmQcPage.tsx                                 │
│    tabs(all|cert|comp) · search · AuthorityBadges chips · QcModal   │
│    ── QcModal is ALSO imported by ClmDcpPage ──                     │
└──────────────────────────────┬─────────────────────────────────────┘
                                │ /api/clm/qc-documents (+ ?branch_id)
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmQcController                                      │
│    index()   scoped list → idNameMap → issued_by_names →            │
│              in_use → counts{all,cert,comp}                         │
│    store()   dupe(scope) → normalizeIds → nextCode(QC-) → create    │
│    update()  denial → validate → normalizeIds → clash → update      │
│    destroy() usageCheck(CLIENT-SCOPED) → 409 used_in | delete       │
└──────────────────────────────┬─────────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│  DATA — clm_qc_documents                                            │
│  Referenced BY CODE from:                                           │
│    clm_segment_rules.doc_selections["qc"]["QC-003"] = "M"|"O"       │
│    segment_doc_uploads (category='qc', doc_code='QC-003')           │
│  Referenced BY NAME from:                                           │
│    product_qc_records.qc_name   (joined via products for tenancy)   │
│  References BY ID:  clm_authorities.id → issued_by                  │
└────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmQcController.php
app/Models/ClmQcDocument.php
app/Models/ClmAuthority.php                 ← normalizeIds / idNameMap / displayNames
app/Support/MasterVisibility.php
database/migrations/2026_05_22_000060_create_clm_qc_documents_table.php
                    2026_06_17_000000_convert_clm_doc_authority_to_ids.php
                    2026_07_06_000001_add_branch_id_to_clm_compliance_masters.php
                    2026_07_09_000010_branch_scope_clm_master_code_unique.php
resources/js/pages/clm/compliance/ClmQcPage.tsx   (exports QcModal)
resources/js/pages/clm/compliance/AuthorityBadges.tsx
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| Frontend | React 19 · TS · shared CLM page shell · `MasterMultiSelect` for authorities |

---

## 3. DATABASE SCHEMA — `clm_qc_documents`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `client_id` | FK → clients, cascadeOnDelete | |
| `branch_id` | bigint nullable | NULL ⇒ client-level (shared) |
| `code` | varchar(16) | `QC-NNN`, per branch — the key rules and uploads store |
| `name` | varchar(255) | ISO 9001, HACCP Certification, … |
| `purpose` | varchar(500) | required — what the certificate attests |
| `issued_by` | varchar(255) | comma-joined **authority ids** (converted from names in June 2026) |
| `doc_type` | varchar(16) | `cert` \| `comp`, default `cert` |
| `qa_params` | text nullable | free text — testing parameters |
| `min_criteria` | text nullable | free text — minimum acceptance criteria |
| `status` | varchar(16) | default `active` |
| `created_by` / `updated_by` | FK → users, nullOnDelete | |
| timestamps | | no soft deletes |

**Indexes:** `UNIQUE(client_id, branch_id, code)`, `INDEX(client_id, doc_type)` — the latter backs the cert/comp tab counts.

The controller validates `qa_params` and `min_criteria` at **256** characters even though the columns are `text`.

---

## 4. MODEL — `App\Models\ClmQcDocument`

```php
const TYPE_CERT='cert'; TYPE_COMP='comp';  TYPES=[…]
const STATUS_ACTIVE='active'; STATUS_INACTIVE='inactive'; STATUSES=[…]

fillable: client_id, branch_id, code, name, purpose, issued_by, doc_type,
          qa_params, min_criteria, status, created_by, updated_by
relations: client()
```
No casts, no soft deletes.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/clm/qc-documents',      [ClmQcController::class, 'index']);
    Route::post  ('/clm/qc-documents',      [ClmQcController::class, 'store']);
    Route::put   ('/clm/qc-documents/{id}', [ClmQcController::class, 'update']);
    Route::delete('/clm/qc-documents/{id}', [ClmQcController::class, 'destroy']);
});
```
QC rows are also served (pre-resolved) by `/clm/segment-rules/bootstrap` and `/clm/segment-rules/for-segment/{id}` under the `qc` key. Full detail in **QUALITY_COMPLIANCE_DOCS_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### `index()`
1. `MasterVisibility::applyReadScope` with the switcher's `branch_id`, ordered `id ASC`.
2. `ClmAuthority::idNameMap($clientId)` once → **`issued_by_names`** stamped per row.
3. `usageCheck($clientId, $r->code, $r->name)` per row → `in_use` + `used_in[]`.
4. Returns `counts.{all, cert, comp}` computed in PHP off the loaded collection (matching the `(client_id, doc_type)` index used elsewhere).

### `store()`
Validates `name` (≤255), `purpose` (required, ≤500), `issued_by` (required, ≤255), `doc_type` (`Rule::in(TYPES)`), `qa_params` / `min_criteria` (≤256), `status`.

Duplicate check runs inside the caller's read scope and returns a **hand-built 422 envelope**:
```php
return response()->json(['status'=>false, 'message'=>$msg,
                         'errors'=>['name'=>[$msg]]], 422);
// 422 + errors.name so the modal shows it inline under QC CERTIFICATE NAME
```
Then `ClmAuthority::normalizeIds($data['issued_by'], $clientId)`; an empty result throws a `ValidationException` on `issued_by` ("Select a valid authority."). Insert wrapped in `DB::transaction`, stamping `branch_id`, the allocated `code`, and defaulting `doc_type` to `cert`.

### `update()`
Scoped `firstOrFail` → `hierarchicalDenial('edit')` → validate (`sometimes`) → trim `name`/`purpose` → re-normalise `issued_by` when present → clash check excluding self (same hand-built 422) → update. **No in-use edit lock.**

### `destroy()`
Scoped `firstOrFail` → `hierarchicalDenial('delete')` → `usageCheck` → 409 with `used_in` or hard delete.

### `usageCheck(int $clientId, ?string $code, ?string $name)` — the scoped reference implementation
```php
// Codes (QC-001, …) are allocated PER CLIENT, so every tenant has a "QC-001".
// The usage lookups MUST be scoped to this client's rows — otherwise a freshly
// created QC-001 falsely matches another tenant's reference to THEIR QC-001
// and the delete is wrongly blocked.

clm_segment_rules   WHERE client_id = $clientId
                      AND doc_selections LIKE '%"QC-003"%'      → 'Segment Rules'

segment_doc_uploads WHERE client_id = $clientId
                      AND doc_code = 'QC-003'                   → 'Segment Doc Uploads'

// product_qc_records has NO client_id — scope through its product.
product_qc_records JOIN products ON products.id = product_qc_records.product_id
                    WHERE products.client_id = $clientId
                      AND product_qc_records.qc_name = $name    → 'Product QC Records'
```
This is the only one of the four catalogues that gets the tenant scoping right; KYC, DD and Trade Licenses omit it.

### `nextCode($clientId, $branchId)`
Client row lock → `MAX(/^QC-(\d+)$/) + 1` → skip taken → `QC-%03d`, branch-scoped.

---

## 7. FRONTEND — `ClmQcPage.tsx`

- Standard CLM shell with three tabs driven by the response's `counts` object.
- Issued-by column renders `AuthorityBadges` from the array form.
- `in_use` disables Delete and shows `used_in` in a themed tooltip.
- `errors.name` from the server is bound to the QC CERTIFICATE NAME input.
- **Exports `QcModal`**, imported by `ClmDcpPage.tsx` so a missing QC document can be added mid-rule-configuration; the DCP re-fetches its bootstrap payload afterwards.

---

## 8. INTEGRATIONS

| Consumer | How |
|---|---|
| Document Control Panel | `bootstrap()` ships the branch-scoped QC list, resolving **`issued_by`** into `issued_by` (names) + `authority_list` (array); the rule stores the **code** under `doc_selections.qc` |
| Customer / Consignee / Vendor forms | `forSegment()` resolves `doc_selections['qc']` codes back into full rows stamped with `requirement`, surfacing `purpose` and `doc_type` |
| Evidence Vault | `segment_doc_uploads` rows with `category = 'qc'` |
| Product master | `product_qc_records.qc_name` references the QC entry **by name** (the only name-based link among the four catalogues) |
| Buyer / Supplier Profile | QC is *not* one of the four scorecard families (`kyc`, `dd`, `tl`, `td`) — it surfaces through the rule and the vault instead |

---

## 9. SECURITY & CAVEATS

1. `client_id` always derived from `auth()->user()`; authority helpers are tenant-scoped.
2. **`usageCheck()` is client-scoped here** — the correct form. Apply the same pattern when fixing KYC / DD / Trade Licenses.
3. `product_qc_records` carries no `client_id`; the join through `products` is what keeps that lookup tenant-safe.
4. The **name-based** product link means a QC rename detaches existing product QC records — there is no cascade for it (contrast `ClmAuthorityController::cascadeRename`).
5. `doc_selections` matching is a raw JSON substring test — portable, not structural.
6. `issued_by` is 255 characters, bounding how many certifying bodies one entry can name.
7. Deletes are hard; `client_id` cascades from `clients`.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmQcController`, ~245 lines) |
| Table | 1 |
| Business columns | 7 (the richest of the four catalogues) |
| Endpoints | 4 (+2 read-through via segment-rules) |
| Referencing tables | 3 |
| Permission slug | `clm.quality_docs` |
| Code prefix | `QC-NNN` (branch-scoped) |
| Vault category | `qc` |
| Test coverage | none automated |

---

*Related documents: QUALITY_COMPLIANCE_DOCS_FUNCTIONAL_DOCUMENTATION.md · QUALITY_COMPLIANCE_DOCS_CODE_WALKTHROUGH.md · QUALITY_COMPLIANCE_DOCS_API_DOCUMENTATION.md*
