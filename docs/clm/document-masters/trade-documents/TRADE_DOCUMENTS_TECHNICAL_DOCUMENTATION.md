# TRADE DOCUMENTS — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Trade Documents**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Two tables (`clm_trade_doc_names`, `clm_trade_doc_library`) behind one controller, because both tabs render on the same page and share validation patterns. Beyond CRUD, `ClmTradeDocumentController` owns the **DOCX ⇄ HTML round-trip**, **PDF rendering with a page shell**, **header-logo upload**, and the **party filter** the party forms consume.

### 1.2 High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                                 │
│  pages/clm/document-masters/                                            │
│    ClmTradeDocumentsPage.tsx      (Names + Library tabs)                │
│    ClmTradeDocumentDraftPage.tsx  / ClmTradeDocumentDraftModal.tsx      │
│    ClmRichTextToolbar · ClmInsertTableModal ·                           │
│    ClmInsertPlaceholderModal · ClmClauseInsertPanel · ClmInsertHrModal  │
└──────────────────────────────┬─────────────────────────────────────────┘
                                │ /api/clm/trade-doc-names · trade-doc-library
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmTradeDocumentController  (uses HandlesDocxHtmlRoundtrip)│
│   NAMES     namesIndex (+in_use) · namesStore (locked dedupe) ·         │
│             namesUpdate/namesDestroy (409 while in_use)                 │
│   LIBRARY   libraryIndex (+is_signed) · libraryStore ·                  │
│             libraryUpdate/libraryDestroy (422 when signed)              │
│   DOCX      downloadDocx · uploadDocx · docxToHtmlPreview               │
│   PDF       downloadPdf  → view pdf.clm-signature-document              │
│   ASSETS    uploadHeaderLogo                                            │
│   FILTER    libraryForParty                                             │
└──────────────────────────────┬─────────────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│  DATA                                                                   │
│   clm_trade_doc_names   ← linked BY NAME from the library               │
│   clm_trade_doc_library ← referenced by clm_signature_requests          │
│                           (document_type = 'trade_doc')                 │
│   Storage: public disk / Azure Blob                                     │
│     trade_doc_library/c{client}/t{id}/*.docx                            │
│     trade_doc_library/c{client}/logos/*.png                             │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmTradeDocumentController.php
app/Http/Controllers/Concerns/HandlesDocxHtmlRoundtrip.php
app/Models/ClmTradeDocName.php · ClmTradeDocLibrary.php
app/Models/ClmSignatureRequest.php          ← the signed-draft lock helpers
resources/views/pdf/clm-signature-document.blade.php
database/migrations/2026_05_22_000070_create_clm_trade_doc_names_table.php
                    2026_05_22_000080_create_clm_trade_doc_library_table.php
                    2026_05_25_000010_add_header_footer_to_clm_trade_doc_library.php
                    2026_05_27_000010_add_content_to_clm_trade_doc_library.php
                    2026_05_27_000020_add_docx_columns_to_clm_trade_doc_library.php
                    2026_06_08_000010_add_regulatory_segment_to_clm_trade_doc_library.php
                    2026_07_04_000010_add_branch_id_to_clm_trade_doc_tables.php
                    2026_07_09_000020_branch_scope_clm_master_code_unique_rest.php
resources/js/pages/clm/document-masters/…
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| DOCX | `phpoffice/phpword` — `Html::addHtml` (write), custom reader (read) |
| PDF | `barryvdh/laravel-dompdf` → `pdf.clm-signature-document` blade |
| Frontend | React 19 · TS · contentEditable rich text · shared `HeaderFooterPanel` |
| Storage | `public` disk locally, Azure Blob on the server; every URL through `file_url()` |

---

## 3. DATABASE SCHEMA

### 3.1 `clm_trade_doc_names`
| Column | Type | Notes |
|---|---|---|
| `id` · `client_id` (FK cascade) · `branch_id` (nullable) | | |
| `code` | varchar(16) | `TDN-NNN`, per branch |
| `name` | varchar(255) | the type name library drafts store as a **string** |
| `status` · `created_by` · `updated_by` · timestamps | | |

`UNIQUE(client_id, branch_id, code)`.

### 3.2 `clm_trade_doc_library`
| Column | Type | Notes |
|---|---|---|
| `id` · `client_id` · `branch_id` | | |
| `code` | varchar(16) | `TDL-NNN` (legacy `TD-` renamed by migration) |
| `name` | varchar(255) | **the type name** — links to `clm_trade_doc_names.name` |
| `title` | varchar(255) | printed heading |
| `doc_type` | varchar(64) | free-form classification |
| `purpose` | varchar(500) | |
| `party` | varchar(255) | CSV: `Buyer`, `Consignee`, `Supplier-*` |
| `regulatory` | varchar | `highly` \| `less` |
| `segment` | varchar(500) | CSV — **required** |
| `file_path` | varchar(500) | legacy attachment pointer |
| `content` | longText | the editor's HTML body |
| `docx_path` · `docx_original_name` | varchar | the uploaded Word file |
| `header_config` · `footer_config` | **json (cast to array)** | same shape as `hr_document_templates` |
| `status` · `created_by` · `updated_by` · timestamps | | |

`UNIQUE(client_id, branch_id, code)`.

---

## 4. MODELS

```php
// ClmTradeDocName
fillable: client_id, branch_id, code, name, status, created_by, updated_by

// ClmTradeDocLibrary   (protected $table = 'clm_trade_doc_library')
fillable: client_id, branch_id, code, name, title, doc_type, purpose, party,
          regulatory, segment, file_path, content, docx_path, docx_original_name,
          header_config, footer_config, status, created_by, updated_by
casts:    header_config => array, footer_config => array
// "Page-shell header/footer config — same JSON shape used by hr_document_templates
//  so HeaderFooterPanel.tsx reads them back as plain objects with no extra coercion."
```

The `is_signed` flag on library rows is **not** a column — it is stamped at read time from `ClmSignatureRequest::signedDraftIds()`.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    // Names tab
    Route::get   ('/clm/trade-doc-names',      [ClmTradeDocumentController::class,'namesIndex']);
    Route::post  ('/clm/trade-doc-names',      [ClmTradeDocumentController::class,'namesStore']);
    Route::put   ('/clm/trade-doc-names/{id}', [ClmTradeDocumentController::class,'namesUpdate']);
    Route::delete('/clm/trade-doc-names/{id}', [ClmTradeDocumentController::class,'namesDestroy']);

    // Library tab
    Route::get   ('/clm/trade-doc-library',                    [… 'libraryIndex']);
    Route::post  ('/clm/trade-doc-library',                    [… 'libraryStore']);
    Route::post  ('/clm/docx-to-html',                         [… 'docxToHtmlPreview']);
    Route::post  ('/clm/trade-doc-library/upload-header-logo', [… 'uploadHeaderLogo']);
    Route::get   ('/clm/trade-doc-library/for-party/{party}',  [… 'libraryForParty']);
    Route::get   ('/clm/trade-doc-library/{id}/download',      [… 'downloadDocx'])->whereNumber('id');
    Route::get   ('/clm/trade-doc-library/{id}/download-pdf',  [… 'downloadPdf'])->whereNumber('id');
    Route::post  ('/clm/trade-doc-library/{id}/upload-docx',   [… 'uploadDocx'])->whereNumber('id');
    Route::put   ('/clm/trade-doc-library/{id}',               [… 'libraryUpdate'])->whereNumber('id');
    Route::delete('/clm/trade-doc-library/{id}',               [… 'libraryDestroy'])->whereNumber('id');
});
```
`whereNumber('id')` on the `{id}` routes is what keeps `/for-party/{party}` and `/upload-header-logo` from being swallowed by them. Full detail in **TRADE_DOCUMENTS_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### Names tab
- **`namesIndex()`** — scoped list ordered `id DESC`, plus an `in_use` count built with one grouped query over the library (`LOWER(TRIM(name))`), scoped the same way so a branch only counts drafts it can see.
- **`namesStore()`** — the whole dedupe-and-insert runs **inside** `DB::transaction` after locking the `clients` row, so two concurrent "Add" requests cannot both pass the check.
- **`namesUpdate()` / `namesDestroy()`** — 409 while `in_use > 0`. The library links by the name **string**, so renaming would orphan drafts.

### Library tab
- **`libraryIndex()`** — scoped list ordered `id DESC`, plus `is_signed` from a **batched** `ClmSignatureRequest::signedDraftIds($clientId, DOC_TRADE)` lookup (avoids an N+1 of per-row existence checks).
- **`libraryStore()`** — validates the Stage-1 fields (`segment` required) plus the Stage-2 `header_config` / `footer_config` arrays; allocates `TDL-NNN` under the client lock.
- **`libraryUpdate()`** — `hierarchicalDenial` → **signed lock** (`hasSignedDraft` → 422) → validate → **drop `docx_path` when `content` changed** → update.
- **`libraryDestroy()`** — same signed lock, then delete.

### DOCX / PDF
- **`downloadDocx()`** — raises `memory_limit` to 1024M and `set_time_limit(300)`; prefers the stored `docx_path` (streamed **through the Storage disk**, never `response()->download()`, because Azure Blob has no local path); otherwise regenerates from HTML after `normaliseEditorHtml()` + `toWellFormedHtml()`; applies the page-shell header/footer; falls back to `strip_tags` if PhpWord throws.
- **`downloadPdf()`** — renders the shared `pdf.clm-signature-document` blade with a base64 header logo (dompdf cannot fetch `/storage` URLs at render time), placeholders left unresolved.
- **`uploadDocx()`** — `validateDocxUpload()` deliberately avoids `mimes:doc,docx` (a `.docx` is a ZIP and php-fileinfo often reports `application/zip`); stores the file, reads the **bytes** into a local temp file before conversion, and rejects with a clean 422 if nothing readable comes out or the result exceeds the render cap.
- **`docxToHtmlPreview()`** — standalone conversion with no library row, used by the CTC draft editor's "Upload Doc".

### `libraryForParty($party)`
Client-scoped (**not** branch-scoped) `LIKE` filter mapping `buyer`/`customer` → `%Buyer%`, `consignee` → `%Consignee%`, `supplier` → `%Supplier-%`, anything else → a literal substring match.

### `nextCode()`
Branch-scoped MAX+1 with skip-taken, prefix passed in (`TDN-` or `TDL-`).

---

## 7. FRONTEND

| Component | Role |
|---|---|
| `ClmTradeDocumentsPage.tsx` | The two-tab list |
| `ClmTradeDocumentDraftPage.tsx` / `…DraftModal.tsx` | The Stage 1 / Stage 2 / body editor |
| `ClmRichTextToolbar.tsx` | contentEditable formatting toolbar |
| `ClmInsertTableModal.tsx` | Table insertion |
| `ClmInsertPlaceholderModal.tsx` | `{{customer.*}}` / `{{product.*}}` token picker |
| `ClmClauseInsertPanel.tsx` | Inserts a library clause as `<h3>Name</h3>` + body |
| `HeaderFooterPanel` (shared with HRMS) | Reads/writes `header_config` / `footer_config` |

---

## 8. INTEGRATIONS

| Integration | How |
|---|---|
| **Zoho Sign** | `ClmSignatureController::send()` with `trade_doc_ids[]` (max 10) renders each draft to PDF and bundles them into one request tagged `document_type = 'trade_doc'` |
| **Sales Matrix** | `applicableForLead()` surfaces per-segment trade documents on the lead, each stamped with its live signature status via `latestPerTradeDoc` |
| **Evidence Vault** | `SegmentDocUploadController::vault()` overlays trade-document signature status per row |
| **Party forms** | `/for-party/{party}` lists applicable drafts for a customer / consignee / supplier |
| **HR document templates** | Share the `header_config` / `footer_config` JSON shape and the `HeaderFooterPanel` component |
| **P2P** | A Purchase Order PDF can be bundled into the same signature request under the reserved key `po` |

---

## 9. SECURITY & CAVEATS

1. `client_id` always derived from `auth()->user()`; every list and lookup is `MasterVisibility`-scoped.
2. **`libraryForParty()` is client-scoped only** — it does not apply the branch read scope the other endpoints use.
3. Signed drafts are locked with a 422 on both update and delete; the check is guarded against **draft-id reuse** (a request only locks a draft created at or before it).
4. Files are streamed via `Storage::disk('public')->download()`, never `response()->download()` on a raw path.
5. `RENDER_MAX_CHARS = 1_000_000` guards both PDF and DOCX generation; `DOCX_MAX_KB = 20 * 1024`.
6. `validateDocxUpload()` checks file + size + client extension rather than MIME, because php-fileinfo misreports `.docx` as `application/zip`.
7. Uploaded DOCX bytes are copied to a **local** temp file before conversion — `Storage::path()` is unusable on Azure Blob.
8. Editing `content` deletes the stored `docx_path` so downloads cannot serve a stale Word file.
9. The lock triggers on `completed`, so a draft remains editable while a signature is in flight.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmTradeDocumentController`, ~765 lines) |
| Tables | 2 |
| Endpoints | 13 |
| Code prefixes | `TDN-NNN` · `TDL-NNN` (both branch-scoped) |
| Permission slug | `clm.trade_documents` |
| Render cap | 1,000,000 chars · 20 MB upload |
| Lock trigger | signature request `completed` |
| Test coverage | none automated |

---

*Related documents: TRADE_DOCUMENTS_FUNCTIONAL_DOCUMENTATION.md · TRADE_DOCUMENTS_CODE_WALKTHROUGH.md · TRADE_DOCUMENTS_API_DOCUMENTATION.md*
