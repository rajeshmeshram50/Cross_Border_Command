# AGREEMENTS — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Agreements**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Two tables (`clm_agreement_types`, `clm_agreement_library`) behind `ClmAgreementController` (~1,100 lines). Structurally it mirrors `ClmTradeDocumentController` — two-tab CRUD plus DOCX/PDF round-trip — but adds the module's single largest read endpoint, **`applicableForLead()`**, which joins CLM to the Sales Matrix.

### 1.2 High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                                 │
│  pages/clm/document-masters/                                            │
│    ClmAgreementsPage.tsx        (Types + Library tabs, PARTY_LABELS map)│
│    ClmAgreementWizardModal.tsx  (details → page shell → body)           │
│    ClmRichTextToolbar · ClmClauseInsertPanel ·                          │
│    ClmInsertTableModal · ClmInsertPlaceholderModal                      │
│  pages/sales/matrix/…           (Segment Details card + send modal)     │
└──────────────────────────────┬─────────────────────────────────────────┘
       /api/clm/agreement-types · agreement-library
       /api/clm/leads/{leadId}/agreement-applicable
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmAgreementController  (uses HandlesDocxHtmlRoundtrip)  │
│   TYPES     typesIndex/Store/Update/Destroy                             │
│   LIBRARY   libraryIndex (+is_signed +in_use) · libraryStore ·          │
│             libraryUpdate/Destroy  (422 when in_use)                    │
│   LEAD      applicableForLead()  ← the Sales-Matrix feed                │
│             partyForBuyerConsignee() · segmentTradeDocs()               │
│   FILES     downloadDocx · downloadPdf · uploadDocx · uploadHeaderLogo  │
└──────────────────────────────┬─────────────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│  DATA                                                                   │
│   clm_agreement_types   ← linked BY NAME from the library               │
│   clm_agreement_library ← referenced by clm_signature_requests          │
│                           (document_type = 'agreement')                 │
│   READS: leads · proforma_invoices · quotations · products ·            │
│          clm_segments · customers · consignees · clm_trade_doc_library  │
│   Storage: agreement_library/c{client}/… (docx + logos)                 │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmAgreementController.php
app/Http/Controllers/Concerns/HandlesDocxHtmlRoundtrip.php
app/Models/ClmAgreementType.php · ClmAgreementLibrary.php
app/Models/ClmSignatureRequest.php     ← usedDraftIds / signedDraftIds / hasUsedDraft
resources/views/pdf/clm-signature-document.blade.php
database/migrations/2026_05_22_000110_create_clm_agreement_types_table.php
                    2026_05_22_000120_create_clm_agreement_library_table.php
                    2026_05_30_000300_add_docx_columns_to_clm_agreement_library_table.php
                    2026_05_30_000500_add_header_footer_config_to_clm_agreement_library_table.php
                    2026_05_30_000600_widen_segment_column_on_clm_agreement_library.php
                    2026_06_09_000001_add_purpose_to_clm_agreement_library_table.php
                    2026_07_04_000001_add_branch_id_to_clm_agreement_tables.php
                    2026_07_09_000020_branch_scope_clm_master_code_unique_rest.php
resources/js/pages/clm/document-masters/ClmAgreementsPage.tsx · ClmAgreementWizardModal.tsx
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| DOCX | `phpoffice/phpword` via the shared `HandlesDocxHtmlRoundtrip` trait |
| PDF | `barryvdh/laravel-dompdf` → `pdf.clm-signature-document` blade |
| Frontend | React 19 · TS · multi-stage wizard · shared `HeaderFooterPanel` |
| Storage | `public` disk / Azure Blob; all URLs via `file_url()` |

---

## 3. DATABASE SCHEMA

### 3.1 `clm_agreement_types`
`id · client_id (FK cascade) · branch_id (nullable) · code (AT-NNN) · name · description · status · created_by · updated_by · timestamps`, `UNIQUE(client_id, branch_id, code)`.

### 3.2 `clm_agreement_library`
| Column | Type | Notes |
|---|---|---|
| `id` · `client_id` · `branch_id` | | |
| `code` | varchar(16) | `A-NNN` |
| `agreement_type` | varchar(255) | **the type name** — links to `clm_agreement_types.name` |
| `title` | varchar(255) | |
| `purpose` | varchar(1000) | added 2026-06-09 |
| `party` | varchar(255) | CSV: `Buyer`, `Consignee`, `Supplier-*` |
| `regulatory` | varchar | `highly` \| `less` — **must match the segment's tier to apply** |
| `signing` | **boolean (cast)** | does this agreement require e-signature |
| `segment` | varchar(1024) | CSV of segment names/codes (widened 2026-05-30) |
| `agr_status` | varchar(32) | `Active` by default — only Active rows are offered on a lead |
| `content` | longText | editor HTML |
| `docx_path` · `docx_original_name` | varchar | uploaded Word file |
| `header_config` · `footer_config` | **json (cast to array)** | page shell |
| `status` · `created_by` · `updated_by` · timestamps | | |

`UNIQUE(client_id, branch_id, code)`.

`is_signed` and `in_use` are **derived at read time**, not columns.

---

## 4. MODELS

```php
// ClmAgreementType
fillable: client_id, branch_id, code, name, description, status, created_by, updated_by

// ClmAgreementLibrary  (protected $table = 'clm_agreement_library')
const REG_HIGHLY='highly'; REG_LESS='less'; REG_VALUES=[…]
fillable: client_id, branch_id, code, agreement_type, title, purpose, party,
          regulatory, signing, segment, agr_status, content,
          docx_path, docx_original_name, header_config, footer_config,
          status, created_by, updated_by
casts:    signing => boolean, header_config => array, footer_config => array
```

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    // Types
    Route::get   ('/clm/agreement-types',      [ClmAgreementController::class,'typesIndex']);
    Route::post  ('/clm/agreement-types',      [… 'typesStore']);
    Route::put   ('/clm/agreement-types/{id}', [… 'typesUpdate']);
    Route::delete('/clm/agreement-types/{id}', [… 'typesDestroy']);

    // Library
    Route::get   ('/clm/agreement-library',      [… 'libraryIndex']);
    Route::post  ('/clm/agreement-library',      [… 'libraryStore']);
    Route::put   ('/clm/agreement-library/{id}', [… 'libraryUpdate']);
    Route::delete('/clm/agreement-library/{id}', [… 'libraryDestroy']);
    Route::get   ('/clm/agreement-library/{id}/download',      [… 'downloadDocx'])->whereNumber('id');
    Route::get   ('/clm/agreement-library/{id}/download-pdf',  [… 'downloadPdf'])->whereNumber('id');
    Route::post  ('/clm/agreement-library/{id}/upload-docx',   [… 'uploadDocx'])->whereNumber('id');
    Route::post  ('/clm/agreement-library/upload-header-logo', [… 'uploadHeaderLogo']);

    // Sales-Matrix feed
    Route::get   ('/clm/leads/{leadId}/agreement-applicable',  [… 'applicableForLead'])
                                                               ->whereNumber('leadId');
});
```
Full detail in **AGREEMENTS_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### Types tab
Standard scoped CRUD. `typesStore()` validates `name` + **required** `description`, rejects a scope-relative duplicate with **409**, and allocates `AT-NNN` under the client row lock.

### Library tab
- **`libraryIndex()`** — scoped list ordered `id ASC`, plus **two** batched flags:
  ```php
  $signedIds = ClmSignatureRequest::signedDraftIds($cid, DOC_AGREEMENT);  // completed
  $usedIds   = ClmSignatureRequest::usedDraftIds($cid, DOC_AGREEMENT);    // inprogress OR completed
  ```
  `is_signed` = fully signed; `in_use` = sent at least once. The frontend locks Edit/Delete on `in_use`.
- **`libraryStore()`** — validates the wizard payload; defaults `regulatory → less`, `signing → true`, `agr_status → 'Active'`; allocates `A-NNN` under the client lock.
- **`libraryUpdate()` / `libraryDestroy()`** — `hierarchicalDenial` → **`hasUsedDraft()` → 422** → validate → drop `docx_path` when `content` changed → update/delete.

### `applicableForLead($leadId)` — the Sales-Matrix feed
1. Load the lead (tenant-scoped); compute `stage5Complete = lead_stage_id >= 6`.
2. Resolve the **latest non-cancelled Proforma Invoice**, else the latest non-cancelled **Quotation** — `$source = $pi ?: $quotation`. (Segment Details populates as soon as products are quoted, not only after PI conversion.)
3. `$source->items()->whereNotNull('product_id')` → product ids → `products.segment_id` → `clm_segments` (a soft FK, so missing references are tolerated).
4. Index existing signature requests **by agreement id** (`latestPerAgreement`) and **by trade-doc id** (`latestPerTradeDoc`), both scoped to this lead.
5. Resolve `customer` + `consignee` with `primaryAddress` eager-loaded (the country lives on the address table).
6. Per segment: match agreements on `regulatory === segment.regulatory_status` **and** a comma-boundary CSV `LIKE` on the segment's name *or* code, filtered to `agr_status = 'Active'`, then dropped through `partyForBuyerConsignee()`.
7. Attach per-segment `trade_documents` via `segmentTradeDocs()`.
8. Return totals — segments **in this lead** vs segments **configured in the master**, per tier.

### `partyForBuyerConsignee(?string $party): [applicable, forBuyer, forConsignee]`
Tokenises the CSV and checks for `buyer` / `consignee`. Rows naming only supplier or other parties are **not** applicable (they previously slipped through because "names neither" fell back to "both"). A **blank** party stays universal.

### Files
`downloadDocx()`, `downloadPdf()`, `uploadDocx()` and `uploadHeaderLogo()` are the agreement-flavoured twins of the trade-document methods — same `RENDER_MAX_CHARS = 1_000_000`, same `DOCX_MAX_KB = 20 * 1024`, same Storage-disk streaming, same local-temp-file conversion, same `normaliseEditorHtml` → `toWellFormedHtml` pipeline. Files land under `agreement_library/c{client}/…` so per-doc-type cleanup stays straightforward.

### `nextCode()`
Branch-scoped MAX+1 with skip-taken; prefix `AT-` or `A-`.

---

## 7. FRONTEND

| Component | Role |
|---|---|
| `ClmAgreementsPage.tsx` | Two-tab list; owns the `PARTY_LABELS` map that renders `Buyer → Customer`, `Supplier-Material → Material`, etc. (CBC-436) |
| `ClmAgreementWizardModal.tsx` | Details → page shell → body editor |
| `ClmClauseInsertPanel.tsx` | Inserts a library clause as `<h3>Name</h3>` + body |
| `ClmRichTextToolbar` / `ClmInsertTableModal` / `ClmInsertPlaceholderModal` | Shared editor chrome |
| Sales Matrix `Segment Details` card | Consumes `applicableForLead()` |

---

## 8. INTEGRATIONS

| Integration | How |
|---|---|
| **Sales Matrix** | `applicableForLead()` is the Segment Details feed: per-segment agreements + trade documents, each with live signature status, reminder count and download links |
| **Zoho Sign** | `ClmSignatureController::agreementSend()` (and `send()` with `agreement_ids[]`) render each template to PDF and bundle them into one request tagged `document_type = 'agreement'` |
| **Clause Library** | Clauses are **copied** into `content` as `<h3>Name</h3>` blocks — which is how the clause "in use in a CTC" detection works too |
| **Segments** | Matched by name **or** code inside the `segment` CSV, plus the tier equality check |
| **Buyer / Supplier Profile** | `agr` is one of the five tracked document families; completed agreement signatures are indexed per party and per lead |
| **Evidence Vault** | `buildEntityAgreements()` / `buildShipmentAgreements()` overlay agreement signature status per row |

---

## 9. SECURITY & CAVEATS

1. `client_id` always derived from `auth()->user()`; every lookup is `MasterVisibility`-scoped.
2. **The in-use lock is stricter than trade documents'** — `inprogress` *or* `completed` blocks edit and delete.
3. `hasUsedDraft` / `usedDraftIds` carry the **id-reuse guard**: a request only locks a template created at or before it.
4. `applicableForLead()` runs a handful of `LIKE` patterns per segment against `clm_agreement_library.segment`; on a large library this is the heaviest read in the module.
5. Segment matching is **string-based** — a segment rename is not cascaded into the agreement library (the segment master blocks the rename while referenced, which is what keeps this consistent).
6. `RENDER_MAX_CHARS` and `DOCX_MAX_KB` guard every render/upload path; memory is raised to 1024M and `set_time_limit(300)` per request.
7. Files stream through `Storage::disk('public')`, never `response()->download()` on a raw path.
8. `agr_status` is a free string; only the literal `'Active'` is treated as offerable.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmAgreementController`, ~1,100 lines) |
| Tables | 2 |
| Endpoints | 13 |
| Code prefixes | `AT-NNN` · `A-NNN` (both branch-scoped) |
| Permission slug | `clm.agreements` |
| Lock trigger | signature request **`inprogress` or `completed`** |
| Render cap | 1,000,000 chars · 20 MB upload |
| Cross-module reads | leads · proforma_invoices · quotations · products · segments · customers · consignees · trade-doc library |
| Test coverage | none automated |

---

*Related documents: AGREEMENTS_FUNCTIONAL_DOCUMENTATION.md · AGREEMENTS_CODE_WALKTHROUGH.md · AGREEMENTS_API_DOCUMENTATION.md*
