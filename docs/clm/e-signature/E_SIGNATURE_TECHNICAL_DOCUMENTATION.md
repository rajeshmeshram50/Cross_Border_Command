# E-SIGNATURE (ZOHO SIGN) — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → **E-signature** (cross-cutting)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
`ClmSignatureController` (**~3,300 lines — the largest file in the codebase**) plus `ZohoSignService` (~430 lines) and the `clm_signature_requests` table. It is the only CLM module that talks to a third-party API, and the only one that both renders PDFs and re-ingests them.

Five document families flow through one table, discriminated by `document_type`:

| `document_type` | Source | Library-backed |
|---|---|---|
| `trade_doc` | `clm_trade_doc_library` | ✔ |
| `agreement` | `clm_agreement_library` | ✔ |
| `quotation` | a rendered Quotation PDF | ✘ |
| `proforma_invoice` | a rendered PI PDF | ✘ |
| `purchase_order` | a rendered PO PDF | ✘ |

Case-to-Case contracts are handled by four dedicated methods on the same controller.

### 1.2 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT — no screen of its own; embedded in five flows                │
│   Trade Document library · Agreement library · Evidence Vault ·       │
│   Sales Matrix Stage 5 + Segment Details · P2P Purchase Order ·       │
│   ClmCtcSignPositionModal (drag the signature box)                    │
└──────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmSignatureController                                 │
│   PREVIEW   preview · agreementPreview · ctcPreview                   │
│   SEND      send · agreementSend · salesDocSend · ctcSend             │
│   TRACK     index(?sync) · show · ctcSignatureStatus                  │
│   ACT       remind · recall · ctcRemindSigning                        │
│   FILES     downloadFile · viewFile · viewCertificate · declinedFile  │
│                                                                       │
│   RENDER    renderPdf · renderAgreementPdf · renderCtcPdf             │
│   MERGE     replacePlaceholders · replacePartyNamespaceTokens ·       │
│             expandProductTable · fillProductTokens · sigMarkerToken   │
│   SYNC      syncSignerActivity · stampDeclineFromZoho ·               │
│             fetchSignedArtifacts · adoptSignedDocsFromDisk            │
│   COORDS    mapClientCoordsToZohoDocIds                               │
│   ERRORS    cleanSendError                                            │
└──────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SERVICE — ZohoSignService                                            │
│   OAuth refresh-token → access token                                  │
│   createRequestMultipart(pdfPaths, filenames, body)                   │
│   getRequest · submitWithFields(actions, docIds, perDocCoords)        │
│   remind · recall                                                     │
│   downloadDocumentPdf · downloadRequestPdf · downloadCertificate      │
└──────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DATA                                                                 │
│   clm_signature_requests (soft-deleted)                               │
│   Storage: uploads/signed_documents/{customer|consignee|vendor}/      │
│   Views:   pdf.clm-signature-document                                 │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmSignatureController.php     ~3,300 lines
app/Services/ZohoSignService.php                        ~430 lines
app/Models/ClmSignatureRequest.php                      the lock-check helpers
app/Support/CtcAuditTime.php                            shared IST conversion
resources/views/pdf/clm-signature-document.blade.php
database/migrations/2026_05_27_000030_create_clm_signature_requests_table.php
                    2026_05_30_000400_add_document_type_to_clm_signature_requests_table.php
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| E-sign | **Zoho Sign REST v1**, OAuth refresh-token grant |
| PDF | `barryvdh/laravel-dompdf` → `pdf.clm-signature-document` |
| Images | GD-based flattening (`flattenImageForPdf`) for signature/stamp images |
| Storage | `public` disk / Azure Blob; every URL through `file_url()` |
| Realtime | none — status is **polled**, not pushed |

---

## 3. DATABASE SCHEMA — `clm_signature_requests`

Soft-deleted. See the CLM technical doc for the full column list; the operationally important ones:

| Column | Role |
|---|---|
| `document_type` | The five-way discriminator |
| `lead_id` | Optional opportunity scope — without it the Sales-Matrix poll cannot find the request |
| `trade_doc_id` | The primary draft (or the quotation / PI / PO id) |
| `trade_doc_ids` (json) | The full multi-doc list — populated even for single-doc sends |
| `document_names` · `zoho_document_ids` (json) | Parallel arrays for the bundle |
| `model_name` + `party_id` | Polymorphic party — `Customer` \| `Consignee` \| `Vendor` |
| `zoho_request_id` | Indexed; the handle for every Zoho call |
| `status` | Indexed; `draft` → `inprogress` → `completed` \| `declined` \| `recalled` \| `expired` \| `superseded` |
| `signers` (json) | Name, email, order, role, plus synced Viewed/Signed activity |
| `signed_document_paths` (json) | `[{zoho_document_id, document_name, path, url, file_url, size}]` |
| `certificate_path` | Zoho's completion certificate — a **separate artefact** |
| `metadata` (json) | Sent-at, document settings, request uuid, bundled PO id, party snapshot |
| `reminder_count` · `last_reminder_sent_at` | Drive the "Sent N times" badge |

---

## 4. THE MODEL'S LOCK HELPERS — `ClmSignatureRequest`

```php
hasSignedDraft($cid, $docId, $docType)   // completed              → trade-doc lock
hasUsedDraft($cid, $docId, $docType)     // inprogress|completed   → agreement lock
signedDraftIds($cid, $docType)           // batch, for list flags
usedDraftIds($cid, $docType)             // batch, for list flags
hasSignedForDoc($cid, $type, $docId)     // sales docs
hasSentForDoc($cid, $type, $docId)       // gates Stage 6 (Victory)
supersedeForDoc($cid, $type, $docId)     // edit-while-pending
```

All the draft-level checks carry an **id-reuse guard**: a request only locks a draft if it was created **at or after** the draft's own `created_at`. Without it, wiping and re-seeding a library — which restarts ids — would re-lock brand-new rows against stale requests.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::post('/clm/signature-requests/preview',            [ClmSignatureController::class,'preview']);
    Route::post('/clm/signature-requests',                    [… 'send']);
    Route::post('/clm/signature-requests/agreement-preview',  [… 'agreementPreview']);
    Route::post('/clm/signature-requests/agreement-send',     [… 'agreementSend']);
    Route::post('/clm/signature-requests/sales-doc-send',     [… 'salesDocSend']);
    Route::post('/clm/signature-requests/ctc-preview',        [… 'ctcPreview']);
    Route::post('/clm/signature-requests/ctc-send',           [… 'ctcSend']);

    Route::get ('/clm/signature-requests',                    [… 'index']);
    Route::get ('/clm/signature-requests/{id}',               [… 'show'])->whereNumber('id');
    Route::post('/clm/signature-requests/{id}/remind',        [… 'remind']);
    Route::post('/clm/signature-requests/{id}/recall',        [… 'recall']);
    Route::get ('/clm/signature-requests/{id}/download-file/{index}', [… 'downloadFile']);
    Route::get ('/clm/signature-requests/{id}/view-file/{index}',     [… 'viewFile']);
    Route::get ('/clm/signature-requests/{id}/certificate',   [… 'viewCertificate']);
    Route::get ('/clm/signature-requests/{id}/declined-file', [… 'declinedFile']);

    Route::get ('/clm/ctc-contracts/{id}/sync-signature',     [… 'ctcSignatureStatus']);
    Route::post('/clm/ctc-contracts/{id}/remind-signing',     [… 'ctcRemindSigning']);
});
```
The literal `/preview`, `/agreement-*`, `/sales-doc-send`, `/ctc-*` paths precede `/{id}`, which is `whereNumber`-constrained. Full detail in **E_SIGNATURE_API_DOCUMENTATION.md**.

---

## 6. `ZohoSignService`

| Member | Purpose |
|---|---|
| `DEFAULT_FIELD_X/Y/PAGE/WIDTH/HEIGHT` | Fallback signature-box geometry (380, 720, page 0, 150 × 45) |
| `SIG_X_NUDGE_PT` / `SIG_Y_NUDGE_PT` | Global pixel nudges for alignment |
| `isConfigured()` / `isTestingMode()` | Gate sending; testing mode changes the success message |
| `getAccessToken()` / `refreshAccessToken()` | OAuth refresh-token grant |
| `makeRequest()` | The generic REST wrapper |
| `createRequestMultipart($pdfPaths, $filenames, $body)` | JSON + N PDFs in one multipart POST |
| `getRequest($id)` | Read back actions, document ids and status |
| `submitWithFields($id, $actions, $docIds, $perDocCoords)` | Place the signature fields and submit |
| `remind($id)` · `recall($id, $reason)` | Post-send actions |
| `downloadDocumentPdf` · `downloadRequestPdf` · `downloadCertificate` | Artefact retrieval |
| `unwrapPdfPayload()` | Strips wrappers Zoho occasionally returns around raw PDF bytes |

---

## 7. THE RENDER PIPELINE

```
document row / sales record
   └─ content HTML  (or a per-send override)
        ├─ replacePlaceholders()
        │     replacePartyNamespaceTokens()   {{customer.*}} {{consignee.*}} {{vendor.*}} {{org.*}}
        │     expandProductTable() → fillProductTokens()   {{product.*}} rows from the lead
        ├─ sigMarkerToken()   the sign-here marker per party
        ├─ header/footer config (+ per-send override)
        │     logo resolved via resolveLogoBase64() — dompdf cannot fetch /storage URLs
        │     signature/stamp images flattened by flattenImageForPdf()
        └─ Pdf::loadView('pdf.clm-signature-document', …)->setPaper('a4')
                                                        ->setOption('isPhpEnabled', true)
```

`isPhpEnabled` is what allows footer page numbering in the blade.

---

## 8. SIGNATURE COORDINATES

`document_settings` is keyed by **document id** (with the reserved key `"po"` for a bundled Purchase Order). Each value is either:

```jsonc
// single signer — a flat box
{ "x": 380, "y": 720, "page": 0, "width": 150, "height": 45 }

// Buyer + Consignee — one box PER ROLE
{ "buyer":     { "x": 380, "y": 720, "page": 0, "width": 150, "height": 45 },
  "consignee": { "x": 380, "y": 640, "page": 0, "width": 150, "height": 45 } }
```

`mapClientCoordsToZohoDocIds()` aligns the client's document-id keys to Zoho's returned document ids **by position**, which is why the ordered document list must exactly mirror the order the temp PDFs were written in (CLM docs first, then the bundled PO).

Each Zoho action is tagged with a `cbc_role` matched from the signer's email, so `submitWithFields()` can place each signer's box at the position dragged for **that** role instead of stacking both at one coordinate.

---

## 9. STATUS SYNC

There is **no webhook** — status is polled:

```
GET /clm/signature-requests?sync=true
   for each row that is `inprogress`, OR `completed` with no signed files:
      getRequest()
        → syncSignerActivity()      per-signer Viewed / Signed timestamps
        → status transition          (+ completed_at on first completion)
        → stampDeclineFromZoho()     who / why / when on decline or recall
        → fetchSignedArtifacts()     per-document signed PDFs + the certificate
   then re-read the list if anything changed
```

Two recovery paths exist because Zoho's per-document download can fail transiently:
1. **Retry on every pass** for rows that are `completed` but still have no `signed_document_paths`.
2. **`adoptSignedDocsFromDisk()`** — a read-time-only disk scan that matches files by the `signed_<slug>_<ts>_<i>.pdf` naming convention. Results are never persisted, so a later successful Zoho fetch (which writes a richer payload) stays authoritative.

The signed-document URL **never** falls back to the certificate — they are different artefacts, and serving the audit trail as if it were the document would be materially misleading.

---

## 10. INTEGRATIONS

| Integration | How |
|---|---|
| **Trade Documents** | `send()` with `trade_doc_ids[]`; completion sets `is_signed` and locks the draft |
| **Agreements** | `send()`/`agreementSend()` with `agreement_ids[]`; sending sets `in_use` and locks the template |
| **Sales Matrix** | `salesDocSend()` for Quotation / PI; `hasSentForDoc()` gates Stage 6 (Victory) |
| **P2P** | A Purchase Order can be bundled under the reserved key `"po"`; the PO row flips to *Sent for Sign* |
| **Case-to-Case** | `ctcPreview` / `ctcSend` / `ctcSignatureStatus` / `ctcRemindSigning`, with the org signature stamped in |
| **Evidence Vault** | Overlays live signature status per document row |
| **Buyer / Supplier Profile** | Completed requests are the `d` side of the `agr` and `td` ratios |
| **CtcAuditTime** | `ctcSignatureStatus()` shares the CTC timeline's UTC→IST conversion (CBC-574) |

---

## 11. SECURITY & CAVEATS

1. Every lookup goes through `ClmSignatureRequest::forUser()`, which delegates to `MasterVisibility` — the tracker cannot leak across branch boundaries.
2. **Raw Zoho error bodies never reach the UI.** `cleanSendError()` strips the third-party JSON and maps "already/processed/signed/duplicate" onto a friendly message.
3. Signed files are streamed through the Storage disk, never `response()->download()` on a raw path (Azure Blob has no local path and would leak it in a 500).
4. Temp PDFs are unlinked in a `finally` block, so a failed send leaves nothing behind.
5. The **same-party constraint** prevents a bundle from routing the wrong papers to the wrong recipients.
6. Duplicate signer emails are collapsed before the request is built.
7. The list is capped at **200 rows**, and `?sync=true` only re-polls rows that need it.
8. `RENDER_MAX_CHARS` (1,000,000) guards every render path; memory is raised to 1 GB and `set_time_limit(300)` per request.
9. A consignee flagged `same_as_customer` **reads through** to its parent customer's requests — the filter is swapped before any `where()` clause runs.
10. `expiration_days` is clamped to ≤ 90 because Zoho caps it at two digits.

---

## 12. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmSignatureController`, **~3,300 lines** — the largest file in the codebase) |
| Service | 1 (`ZohoSignService`, ~430 lines) |
| Table | 1 (soft-deleted) |
| Endpoints | 17 |
| Document types | 5 (+ CTC via dedicated methods) |
| Max documents / signers | 10 / 5 |
| Expiry range | 1–90 days (default 30) |
| List cap | 200 rows |
| Status values | 7 |
| Realtime | **none** — polling only |
| Test coverage | none automated |

---

*Related documents: E_SIGNATURE_FUNCTIONAL_DOCUMENTATION.md · E_SIGNATURE_CODE_WALKTHROUGH.md · E_SIGNATURE_API_DOCUMENTATION.md*
