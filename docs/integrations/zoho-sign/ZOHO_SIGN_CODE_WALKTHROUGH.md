# Zoho Sign Integration — Code Walkthrough

> A guided, step-by-step tour of preview, send, status reconciliation, and error mapping.
> Follow along with the files open; each step maps to real code.

## Document Control

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-30 | System | Initial Zoho Sign code walkthrough |
| 2.0 | 2026-07-30 | System | Expanded, fresher-friendly edition |

---

## 0. Orientation — where things live

| File | Its job |
|---|---|
| `app/Services/ZohoSignService.php` | All Zoho Sign API calls (create / submit / status / download) |
| `app/Http/Controllers/Api/ClmSignatureController.php` | preview / send / agreement / CTC / sales-doc, status, remind, recall, downloads, **error mapping** |
| `app/Http/Controllers/Api/PurchaseOrderController.php` | `sendForSignature` + `cleanSignError` (the PO Stage-4 path) |
| `resources/js/pages/sales/core-masters/customer/SalesCustomerSendForSignatureModal.tsx` | pdf.js preview + drag box + send |
| `resources/js/pages/p2p/procurement-management/purchase-order/TradeDocsTable.tsx` | PO Stage-4 document table (raw-PDF send) |
| `resources/js/pages/sales/opportunity-pipeline/SigningTrackerModal.tsx` | status timeline |
| blade `pdf.clm-signature-document` | agreement / trade-doc PDF template |

---

## 1. Preview a document — `ClmSignatureController::preview`

1. **Validate.** Require `trade_doc_id` **or** `agreement_id` (mutually exclusive),
   `party_id`, `model_name` (`Customer|Consignee|Vendor`), plus optional header/footer/
   content overrides and `lead_id`.
2. **Load the library row.** For an agreement, alias `title → name` so the shared renderer
   can use it uniformly.
3. **Resolve the party.** `loadParty(model_name, party_id)` fetches the Customer / Consignee
   / Vendor that the placeholders fill from.
4. **Render.** `renderPdf($doc, $party, $modelName, uuid, null, headerOverride,
   footerOverride, contentOverride, $lead)`:
   - `$sourceHtml = contentOverride ?? $doc->content` — **empty content ⇒ blank body**.
   - `replacePlaceholders(...)` fills `{{customer.*}}` / `{{consignee.*}}` / `{{vendor.*}}`.
   - `expandProductTable(...)` expands `{{product.*}}` against the lead's products.
   - Header/footer page-shell config applied (a per-render override wins).
5. **Return** the PDF inline (`Content-Type: application/pdf`).

**Frontend side:** `SalesCustomerSendForSignatureModal` fetches this blob, paints it with
pdf.js one page at a time, then runs `detectSignatureMarkers` to seed the signature box.

---

## 2. Send for signature — `ClmSignatureController::send`

1. **Validate.** `trade_doc_ids` (≤ 10) **or** `agreement_ids` (≤ 10), signers, per-doc
   settings, overrides. `$isAgreement` decides which library table to read.
2. **Same-party constraint.** One request signs documents for a single party.
3. **Render each document** → write the PDF to a temp file (tracked so `finally` can delete
   them). The PO PDF can be bundled alongside via `renderPoPdfBytes`.
4. **Create the Zoho request.** `ZohoSignService::createRequestMultipart($pdfPaths,
   $filenames, $requestData)` uploads the documents and returns the `zoho_request_id` +
   document ids.
5. **Submit with fields.** `submitWithFields($requestId, $actions, $documentIds,
   $perDocCoords)` attaches the signer actions and where each signs, then submits.
6. **Persist** a `clm_signature_requests` row (zoho id, status, signers, names, expiry) and
   return `{ signature_request_id, zoho_request_id, status }`.
7. **On error:** `catch (\Throwable $e)` → `cleanSendError($e, 'Failed to send documents')`
   (no raw Zoho payload reaches the user); `finally` unlinks the temp PDFs.

`agreementSend`, `ctcSend`, and `salesDocSend` mirror this shape for their document types.

---

## 3. Send the PO — `PurchaseOrderController::sendForSignature`

1. **Guard:** a supplier must be attached.
2. **Render:** `renderPoPdfBytes($po, withSignature=true, $vendor)` renders the PO PDF *with*
   the organization signature; the supplier's dragged box is added on submit.
3. **Create + submit** the Zoho request (same service calls) and persist the request row.
4. **On error:** `catch` → `cleanSignError($e)` — the sibling of `cleanSendError` that lives
   in *this* controller (this is what fixed the PO Stage-4 "raw Zoho error" bug).

**Frontend side:** `TradeDocsTable` (PO Stage 4) opens the shared modal in **raw-PDF mode**
with:
```js
rawPdfContext = {
  previewUrl: `/p2p/purchase-orders/${poId}/pdf?signature=1`,
  sendUrl:    `/p2p/purchase-orders/${poId}/send-for-signature`,
}
```
So the modal previews the PO PDF and posts the send to the PO controller.

---

## 4. Status reconciliation (no webhook)

`ClmSignatureController::index` (and the CTC `ctcSignatureStatus`) call
`ZohoSignService::getRequest` to pull Zoho's current status and update
`clm_signature_requests.status`. A background poll (`?sync=1`-style) does the same
periodically, so an in-progress request becomes *Signed* on its own. Because a manual poll
and a background poll can overlap, status writes are **idempotent** — the same or an older
status arriving again must not corrupt the row.

---

## 5. Remind / Recall / Download

| Action | Controller → Service |
|---|---|
| Remind | `remind($id)` → `ZohoSignService::remind(zoho_request_id)` |
| Recall | `recall($id)` → `recall(zoho_request_id, reason)` |
| Download signed file | `downloadFile` / `viewFile` → `downloadDocumentPdf(...)` |
| Certificate | `viewCertificate` → `downloadCertificate(...)` |
| Declined document | `declinedFile` → the declined document |

---

## 6. Error mapping — the `cleanSendError` / `cleanSignError` logic

```php
$marker = 'Zoho Sign API error:';
if (!str_contains($raw, $marker)) {
    return $fallback . ': ' . $raw;          // not a Zoho error → keep the developer message
}
$body    = trim(substr($raw, strpos($raw, $marker) + strlen($marker)));
$zohoMsg = json_decode($body, true)['message'] ?? '';
$low     = strtolower($zohoMsg . ' ' . $body);
if (str_contains($low, 'already') || str_contains($low, 'processed')
    || str_contains($low, 'signed')  || str_contains($low, 'completed')
    || str_contains($low, 'in progress') || str_contains($low, 'duplicate')) {
    return 'This document has already been signed or is being processed in another tab or session…';
}
return $zohoMsg !== ''
    ? 'The e-signature service could not process this request: ' . $zohoMsg
    : 'The e-signature service could not process this request right now. Please try again in a moment.';
```
**Takeaway:** the raw `Zoho Sign API error: {json}` body is never returned to the client.

---

## 7. Following a send end-to-end (story form)

> A user opens PO Stage 4, clicks **Send for Sign**.
>
> 1. `TradeDocsTable` opens the modal in raw-PDF mode; the modal fetches
>    `/p2p/purchase-orders/42/pdf?signature=1` and renders it with pdf.js.
> 2. The user drags the signature box and confirms the supplier as the signer.
> 3. On send, the modal POSTs to `/p2p/purchase-orders/42/send-for-signature`.
> 4. `sendForSignature` renders the PO PDF (with org signature), creates the Zoho request
>    (`createRequestMultipart`), submits the signer field (`submitWithFields`), and stores a
>    `clm_signature_requests` row.
> 5. The supplier gets an email from Zoho, signs, and the request status becomes *sent →
>    signed*.
> 6. A background poll calls `getRequest`, sees *signed*, and flips our stored status.
> 7. The user opens the Signing Tracker, downloads the signed PDF and the certificate.
>
> If Zoho had rejected step 4 (e.g. the PO was already out for signature), `cleanSignError`
> would have turned the raw error into "This document has already been signed or is being
> processed…" — the user never sees the raw payload.

---

## 8. Debugging tips

- **Preview is blank** → the agreement/trade-doc `content` is empty; author the body in the
  library. (Not a signing bug.)
- **Raw Zoho error still showing** → check you're on the current build; both
  `ClmSignatureController` and `PurchaseOrderController::sendForSignature` must map errors.
- **Status stuck at "sent"** → the poll hasn't run yet (or Zoho hasn't recorded the signature
  yet); it reconciles on the next `getRequest`.
- **Preview 404 / won't render** → check the Network tab: is the PDF endpoint returning a PDF
  (200) or an error? A backend render error and a pdf.js error are debugged differently.
