# CLM MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Central Legal Module — architecture, schema, controllers, scoping

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation (module-wide) |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
CLM spans **17 controllers**, **17 models**, **~20 tables** and **~30 React pages/components**. It is organised as *masters → rules → content libraries → execution*, with the Document Control Panel rule (`clm_segment_rules`) as the single hinge every downstream module reads.

### 1.2 High-level architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                 │
│  pages/clm/compliance/       ClmSegmentPage · ClmAuthorityPage ·          │
│                              ClmKycPage · ClmDdPage · ClmQcPage ·         │
│                              ClmTradeLicensesPage · ClmDcpPage            │
│  pages/clm/document-masters/ ClmTradeDocumentsPage · ClmAgreementsPage ·  │
│                              ClmTncPage · ClmClauseLibraryPage (+wizards, │
│                              rich-text toolbar, insert panels)            │
│  pages/clm/operations/       ClmCaseToCasePage · ClmCtcForm ·             │
│                              ClmAgreementsSentPage ·                      │
│                              ClmAgreementsToApprovePage ·                 │
│                              ClmBuyerProfilePage · ClmSupplierProfilePage │
│  pages/clm/command-center/   ClmAnalyticsPage · ClmDiagnosisResolution ·  │
│                              ClmRegulatoryDefenseFilePage                 │
│  pages/clm/shared/           ClmPageShell · ClmDocsPopup · clmShared      │
└────────────────────────────────┬─────────────────────────────────────────┘
                                  │ Axios (Bearer + auto ?branch_id on GET)
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER (Laravel 12)                         │
│  Masters      ClmSegmentController · ClmAuthorityController ·             │
│               ClmKycController · ClmDdController · ClmQcController ·      │
│               ClmTradeLicenseController                                   │
│  Rules        ClmSegmentRuleController  (index/bootstrap/forSegment/CRUD) │
│  Libraries    ClmTradeDocumentController · ClmAgreementController ·       │
│               ClmClauseController · ClmTncController                      │
│  Execution    ClmSignatureController (→ ZohoSignService) ·                │
│               CtcContractController · SegmentDocUploadController          │
│  Oversight    ClmBuyerProfileController · ClmSupplierProfileController ·  │
│               ClmDiagnosisResolutionController ·                          │
│               ClmRegulatoryDefenseFileController                          │
│                                                                           │
│  Cross-cutting: App\Support\MasterVisibility (read scope + mutate gate)   │
│                 App\Support\MasterBundleCache (picker cache bump)         │
│                 App\Support\CtcAuditTime      (UTC → IST on read)         │
│                 Concerns\HandlesDocxHtmlRoundtrip (DOCX ⇄ HTML)           │
└────────────────────────────────┬─────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    DATA LAYER (PostgreSQL `c_b_c`)                        │
│  clm_segments · clm_authorities · clm_kyc_documents · clm_dd_documents ·  │
│  clm_qc_documents · clm_trade_licenses · clm_segment_rules               │
│  clm_trade_doc_names · clm_trade_doc_library                             │
│  clm_agreement_types · clm_agreement_library                             │
│  clm_clause_types · clm_clause_library                                   │
│  clm_tnc_categories · clm_tnc_library                                    │
│  clm_signature_requests · ctc_contracts · segment_doc_uploads            │
│  Storage: public disk / Azure Blob (signed PDFs, DOCX, header logos)      │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                        Zoho Sign REST API (OAuth refresh-token)
```

### 1.3 Module structure
```
app/Http/Controllers/Api/   Clm*Controller.php (16) · CtcContractController.php ·
                            SegmentDocUploadController.php
app/Http/Controllers/Concerns/HandlesDocxHtmlRoundtrip.php
app/Models/                 ClmSegment · ClmSegmentRule · ClmAuthority ·
                            ClmKycDocument · ClmDdDocument · ClmQcDocument ·
                            ClmTradeLicense · ClmTradeDocName · ClmTradeDocLibrary ·
                            ClmAgreementType · ClmAgreementLibrary ·
                            ClmClauseType · ClmClauseLibrary ·
                            ClmTncCategory · ClmTncLibrary ·
                            ClmSignatureRequest · CtcContract · SegmentDocUpload
app/Services/ZohoSignService.php
app/Support/                MasterVisibility.php · MasterBundleCache.php · CtcAuditTime.php
database/migrations/        2026_05_22_0000*  (the 15 original CLM tables)
                            2026_05_26/27     (consolidate segments, uploads, signatures)
                            2026_06_03..06_24 (ctc_contracts + lifecycle)
                            2026_07_04/06/09  (branch_id + branch-scoped unique codes)
                            2026_07_21        (document_type on segment rules)
resources/js/pages/clm/     compliance/ · document-masters/ · operations/ ·
                            command-center/ · shared/
resources/views/pdf/clm-signature-document.blade.php
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · **PostgreSQL** (`c_b_c`) · Sanctum |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) · contentEditable rich-text |
| PDF | `barryvdh/laravel-dompdf` → `resources/views/pdf/clm-signature-document.blade.php` |
| DOCX | `phpoffice/phpword` (HTML reader + Word2007 writer) via `HandlesDocxHtmlRoundtrip` |
| E-sign | Zoho Sign REST v1 (`ZohoSignService`), OAuth refresh-token grant |
| Realtime | Laravel Reverb — `CtcApprovalUpdated` broadcast on every CTC approval action |
| Storage | `public` disk locally, Azure Blob on the server; all reads go through `file_url()` |

---

## 3. DATABASE SCHEMA

### 3.1 Compliance masters (identical skeleton)
All six carry `id · client_id (FK cascade) · branch_id (nullable) · code · name · status · created_by · updated_by · timestamps`, with **`UNIQUE(client_id, branch_id, code)`** (branch-scoped since the 2026-07-09 migrations) and an index on `(client_id, status)`.

| Table | Extra columns | Code |
|---|---|---|
| `clm_segments` | `regulatory_status` (highly\|less), `buyer_consignee` (allowed\|not_allowed) | `SG-NNN` (legacy `S-NNN`) |
| `clm_authorities` | `description` | `AUTH-NNN` |
| `clm_kyc_documents` | `authority` (comma-joined **ids**), `expiry` (`N/A`\|`Varies`\|`MM/YYYY`) | `KYC-NNN` |
| `clm_dd_documents` | `authority` (ids), `expiry` | `DD-NNN` |
| `clm_trade_licenses` | `authority` (ids), `validity` | `TL-NNN` |
| `clm_qc_documents` | `purpose`, `issued_by` (ids), `doc_type` (cert\|comp), `qa_params`, `min_criteria` | `QC-NNN` |

> `authority` / `issued_by` were converted from names to **ids** by `2026_06_17_000000_convert_clm_doc_authority_to_ids`. Tokens that don't resolve pass through unchanged so legacy text never disappears.

### 3.2 `clm_segment_rules` — the DCP rule
`client_id · branch_id · segment_id (FK nullOnDelete) · segment_code (snapshot) · rule_code (SR-NNN) · regulatory_status · **document_type** (domestic\|international, NOT NULL DEFAULT 'international') · auths_json (array) · doc_selections (array) · mandatory_count · optional_count · status · created_by/updated_by`.

`doc_selections` shape:
```json
{ "kyc": { "KYC-001": "M", "KYC-004": "O" },
  "dd":  { "DD-002": "M" },
  "tl":  { "TL-001": "M" },
  "qc":  { "QC-003": "O" } }
```
`UNIQUE(client_id, rule_code)`; indexes on `(client_id, segment_id)` and `(client_id, regulatory_status)`. The `td` key is **stripped on write** — trade documents were removed from the panel.

### 3.3 Drafting libraries
| Table | Key columns | Code |
|---|---|---|
| `clm_trade_doc_names` | `name` | `TDN-NNN` |
| `clm_trade_doc_library` | `name` (links to the catalogue by string), `title`, `doc_type`, `purpose`, `party` (CSV), `regulatory`, `segment` (CSV), `content` (HTML), `docx_path`, `docx_original_name`, `header_config` (array), `footer_config` (array), `file_path` | `TDL-NNN` (legacy `TD-`) |
| `clm_agreement_types` | `name`, `description` | `AT-NNN` |
| `clm_agreement_library` | `agreement_type`, `title`, `purpose`, `party` (CSV), `regulatory` (highly\|less), `signing` (bool), `segment` (CSV), `agr_status`, `content`, `docx_path`, `header_config`, `footer_config` | `A-NNN` |
| `clm_clause_types` | `name`, `description` | `CLT-NNN` |
| `clm_clause_library` | `clause_type` (by **name**), `name`, `party`, `clause_status`, `content` | `CL-NNN` |
| `clm_tnc_categories` | `short_code`, `name` — the four standard categories are **global** (`client_id` NULL) | `DC-NNN` |
| `clm_tnc_library` | `segment` (CSV), `regulatory`, `category`, `party`, `content` | `TNC-NNN` |

### 3.4 `clm_signature_requests`
Soft-deleted. `client_id · branch_id · document_type (trade_doc\|agreement\|quotation\|proforma_invoice\|purchase_order) · lead_id · trade_doc_id (primary) · trade_doc_ids (json) · document_names (json) · zoho_document_ids (json) · model_name (Customer\|Consignee\|Vendor) · party_id · zoho_request_id · request_name · status · signers (json) · signing_urls · expiry_date · completed_at · declined_at · decline_reason · recalled_at · recall_reason · signed_document_path · signed_document_paths (json) · certificate_path · metadata (json) · created_by · last_reminder_sent_at · reminder_count`.

Indexes: `zoho_request_id`, `status`, `(model_name, party_id)`, `(client_id, branch_id)`, `(client_id, status)`.

### 3.5 `ctc_contracts`
Soft-deleted. `client_id · branch_id · code (CTC-NNN) · title · agreement_type · org_* (name/short_code/state/country) · counterparties (json) · eff_date · end_date · auto_renewal · renewal_type · content (longText HTML) · header_config · footer_config · approvers (json) · approver_emails (json, queryable) · clarifications (json) · versions (json, append-only) · signing_recipients (json) · days_to_sign · zoho_request_id · signature_request_id · signature_declined_at · stage (1-4) · approval_status · status · rejection_reason · days_to_approve · reminder_days · cp_signed_date · primary_approver_* · created_by(_name) · submitted_at`.

### 3.6 `segment_doc_uploads` — the Evidence Vault store
Polymorphic: `uploadable_type/uploadable_id` → Customer \| Consignee \| Vendor. Plus `client_id · category (kyc\|dd\|tl\|td\|qc) · doc_code · doc_name (snapshot) · requirement (M\|O snapshot) · attachment_path · attachment_name · expiry_date · uploaded_by`.
**`UNIQUE(uploadable_type, uploadable_id, category, doc_code)`** — one file per document per entity; re-upload replaces.

---

## 4. MODELS

| Model | Table | Notes |
|---|---|---|
| `ClmSegment` | clm_segments | `REG_*`, `BC_*`, `STATUSES` constants |
| `ClmSegmentRule` | clm_segment_rules | `DOC_DOMESTIC`/`DOC_INTERNATIONAL`; casts `auths_json`, `doc_selections` to array |
| `ClmAuthority` | clm_authorities | **The id↔name bridge**: `idNameMap()`, `displayNames()`, `displayNamesList()`, `normalizeIds()`, `storedContainsId()` |
| `ClmKycDocument` / `ClmDdDocument` / `ClmTradeLicense` / `ClmQcDocument` | — | Thin masters; `belongsTo(Client)` only |
| `ClmTradeDocName` / `ClmTradeDocLibrary` | — | Library casts `header_config`/`footer_config` to array |
| `ClmAgreementType` / `ClmAgreementLibrary` | — | Library casts `signing` bool + header/footer arrays |
| `ClmClauseType` / `ClmClauseLibrary` | — | Clause type linked **by name**, no FK |
| `ClmTncCategory` / `ClmTncLibrary` | — | `client_id` nullable on categories (globals) |
| `ClmSignatureRequest` | clm_signature_requests | SoftDeletes; polymorphic `party()`; `documents()`; the whole lock-check family (`hasSignedDraft`, `hasUsedDraft`, `signedDraftIds`, `usedDraftIds`, `hasSignedForDoc`, `hasSentForDoc`, `supersedeForDoc`); `scopeForUser` delegates to MasterVisibility |
| `CtcContract` | ctc_contracts | SoftDeletes; 9 JSON casts |
| `SegmentDocUpload` | segment_doc_uploads | Polymorphic owner |

`ClmAuthority::displayNamesList()` exists specifically because **authority names may themselves contain commas** — splitting the joined display string would over-count.

---

## 5. TENANCY & VISIBILITY — `App\Support\MasterVisibility`

```
READ (applyReadScope)
  super_admin   → everything (optional branch filter)
  client_*      → globals + own client; BranchSwitcher may narrow
  branch_user   → globals + client-level + OWN branch (siblings hidden)
  employee      → *** table name starts with `clm_` ⇒ SAME AS branch_user ***
                  (all other tables: globals + client-level + own rows only)

MUTATE (hierarchicalDenial)
  super_admin        → always allowed
  own row            → always allowed
  employee           → ONLY own rows, even inside their own branch
  otherwise          → viewer tier must be ≥ the ROW's tier,
                       tier derived from the row's client_id/branch_id stamps
                       (never from the creator's current user_type)
```

Every CLM controller follows the same three lines:
```php
$q = Model::query();  MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);
$row = Model::query()->whereKey($id)->tap($scope)->firstOrFail();
if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) return 403;
```

---

## 6. CODE ALLOCATION

All prefixes are allocated under `DB::table('clients')->lockForUpdate()` and use **MAX(numeric suffix) + 1, then skip-taken** — never `count()+1`, because deletes leave gaps that would collide with the composite unique.

| Prefix | Table | Scope |
|---|---|---|
| `SG-NNN` | clm_segments | client + branch |
| `AUTH-NNN` | clm_authorities | client + branch |
| `KYC-NNN` `DD-NNN` `TL-NNN` `QC-NNN` | the four doc masters | client + branch |
| `TDN-NNN` `TDL-NNN` | trade doc names / library | client + branch |
| `AT-NNN` `A-NNN` | agreement types / library | client + branch |
| `CLT-NNN` `CL-NNN` | clause types / library | client + branch |
| `DC-NNN` `TNC-NNN` | tnc categories / library | client + branch |
| `CTC-NNN` | ctc_contracts | client + branch (`count()+1` with `withTrashed()`) |
| **`SR-NNN`** | clm_segment_rules | **client-wide only — not branch-scoped** |

---

## 7. API SURFACE

All routes sit inside `Route::middleware(['auth:sanctum','user.active'])` in [routes/api.php](../../routes/api.php) lines ~254–425. Full request/response detail lives in **CLM_API_DOCUMENTATION.md**.

```php
// Masters — identical 4-verb shape each
GET|POST /clm/segments · /clm/authorities · /clm/kyc-documents ·
         /clm/dd-documents · /clm/trade-licenses · /clm/qc-documents
PUT|DELETE  …/{id}

// Rules
GET  /clm/segment-rules/bootstrap                    // every master the modal needs, one call
GET  /clm/segment-rules/for-segment/{segmentId}      // rule + resolved doc rows + M|O
GET|POST /clm/segment-rules · PUT|DELETE /clm/segment-rules/{id}

// Libraries
/clm/trade-doc-names · /clm/trade-doc-library (+ /{id}/download, /download-pdf,
   /{id}/upload-docx, /upload-header-logo, /for-party/{party}) · /clm/docx-to-html
/clm/agreement-types · /clm/agreement-library (+ same download/upload family)
/clm/clause-types · /clm/clause-library
/clm/tnc-categories · /clm/tnc-library

// Signatures
POST /clm/signature-requests/preview | (send) | agreement-preview | agreement-send |
     sales-doc-send | ctc-preview | ctc-send
GET  /clm/signature-requests[?sync=true] · /{id} · /{id}/download-file/{index} ·
     /{id}/view-file/{index} · /{id}/certificate · /{id}/declined-file
POST /clm/signature-requests/{id}/remind · /recall

// Case-to-Case
/clm/ctc-contracts (index/store) · /sent · /to-approve · /approver-candidates ·
   /contact-persons · /placeholder-values · /{id} (show/update/destroy) ·
   /{id}/approve|reject|clarify|respond|resubmit|send-for-signing|
        record-signature|move-to-repository|versions|versions/{v}/download|
        sync-signature|remind-signing

// Oversight
GET  /clm/buyer-profile · /clm/supplier-profile · /clm/regulatory-defense
GET  /clm/diagnosis-resolution · POST /clm/diagnosis-resolution/escalate
GET  /clm/leads/{leadId}/agreement-applicable

// Evidence Vault
GET  /segment-uploads/{type}/{id} · /summary · /vault · /download
POST /segment-uploads/{type}/{id}   DELETE /segment-uploads/{type}/{id}/{uploadId}
```

---

## 8. INTEGRATIONS

| Integration | How CLM uses it |
|---|---|
| **Zoho Sign** | `ZohoSignService`: OAuth refresh → `createRequestMultipart()` (JSON + N PDFs) → `getRequest()` → `submitWithFields()` (per-doc, per-role signature coords) → `getRequest()` again → poll → `downloadDocumentPdf()` + `downloadCertificate()` |
| **Sales Matrix** | `applicableForLead()` walks lead → latest non-cancelled PI (else Quotation) → line items → products → `segment_id` → segments → matching agreements + trade documents, each stamped with its live signature status |
| **P2P / Procurement** | Supplier Profile aggregates procurement + vendor-product mappings; a Purchase Order PDF can be **bundled** into a trade-document signature request under the reserved key `po` |
| **Masters** | `MasterBundleCache::bump()` on every segment / rule write, so the cached per-user picker bundle refreshes instead of waiting out its 5-minute TTL |
| **Reverb** | `CtcApprovalUpdated` broadcast (deferred to `app()->terminating()`) after every CTC approve/reject/clarify/respond |

---

## 9. SECURITY & CAVEATS

1. **`client_id` is always derived from `auth()->user()`** — never read from the request body.
2. **Employees are read-widened but mutate-locked** on CLM tables — the widening is keyed off the literal `clm_` table prefix in `MasterVisibility::applyReadScope`.
3. **Zoho error bodies never reach the UI** — `cleanSendError()` strips the raw third-party JSON and maps "already/processed/signed" into a friendly message.
4. **Signed documents are streamed through the Storage disk**, never `response()->download()` on a raw path (Azure Blob has no local path and would leak it in a 500).
5. **`hasSignedDraft` / `usedDraftIds` guard against id reuse** — a signature request only locks a draft if it was created *at or after* the draft's own `created_at`. Without it, wiping and re-seeding a library re-locks brand-new rows.
6. **Signature-request lists are capped at 200 rows**; `?sync=true` only re-polls rows that are `inprogress` or `completed`-with-no-file.
7. **Render caps**: `RENDER_MAX_CHARS = 1,000,000`. Beyond it PDF/DOCX generation returns 422 instead of OOM-ing the worker. `memory_limit` is raised to 1024M and `set_time_limit(300)` for every render/convert request.
8. **`usageCheck` on KYC/DD/TL is not client-scoped** (it substring-matches `doc_selections` across all tenants) — QC's version *is* scoped. Codes repeat per tenant, so the unscoped variants can over-report "in use".
9. **Clause / trade-doc "in use" is string matching**, not referential integrity.
10. **Postgres**, not MySQL — write raw SQL in Postgres dialect (`ilike`, `whereJsonContains`).

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controllers | 17 (16 `Clm*` + `CtcContractController`) + `SegmentDocUploadController` |
| Models | 18 |
| Tables | 19 |
| API routes | ~90 |
| React pages | 20 (+ ~15 modals/helpers) |
| Permission slugs | 17 (`clm.*`) |
| Largest file | `ClmSignatureController.php` (~3,300 lines) |
| Test coverage | none automated |

---

*Related documents: CLM_FUNCTIONAL_DOCUMENTATION.md · CLM_CODE_WALKTHROUGH.md · CLM_API_DOCUMENTATION.md*
