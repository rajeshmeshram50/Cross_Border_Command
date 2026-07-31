# Zoho Sign Integration — Technical Documentation

> Architecture, configuration, PDF rendering, status reconciliation, error handling and
> security — written so a new engineer can understand and safely extend it.

## Document Control

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-30 | System | Initial Zoho Sign technical reference |
| 2.0 | 2026-07-30 | System | Expanded, fresher-friendly edition |

---

## 0. The big picture

```
 Frontend                              Controllers                       Service
 ────────                              ───────────                       ───────
 SalesCustomerSendForSignatureModal    ClmSignatureController      ┐
   • pdf.js preview                    PurchaseOrderController     ├──► ZohoSignService ──► Zoho Sign API
   • drag the signature box              ::sendForSignature        ┘     (OAuth, create,        (sign.zoho.in)
 SigningTrackerModal (status)                                            submit, download,
 TradeDocsTable (PO Stage 4)                                             remind, recall)
```

`app/Services/ZohoSignService.php` is the single client of the Zoho Sign API. Controllers
render the PDF(s), compose the request, and call the service — the same "single front door"
pattern as Zoho Books.

---

## 1. Zoho Sign vs Zoho Books — don't mix them up

| | Zoho **Sign** | Zoho **Books** |
|---|---|---|
| Purpose | e-signatures | accounting |
| Service class | `ZohoSignService` | `ZohoBooksService` |
| Host | `sign.zoho.in` | `zohoapis.in/books/v3` |
| Config key | `services.zoho` | `services.zoho_books` |
| Refresh token | `ZOHO_REFRESH_TOKEN` | `ZOHO_BOOKS_REFRESH_TOKEN` |

They may share the same OAuth **app** (client id/secret), but the **refresh tokens differ**
because the scopes differ (signing vs accounting).

---

## 2. Configuration (`config/services.php` → `zoho`)

| Config key | Env var | What it is |
|---|---|---|
| `client_id` / `client_secret` | `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` | the OAuth app credentials |
| `refresh_token` | `ZOHO_REFRESH_TOKEN` | long-lived token, Sign scopes |
| `base_url` | `ZOHO_BASE_URL` (default `https://sign.zoho.in`) | the Sign API host |
| `accounts_url` | `ZOHO_ACCOUNTS_URL` | token endpoint |
| `dc` / `api_version` | `ZOHO_DC` (IN) / `ZOHO_API_VERSION` (v1) | data centre + API version |
| `testing_mode` | `ZOHO_TESTING_MODE` | simulate sends in non-prod |

`ZohoSignService::isConfigured()` gates the send flows; `isTestingMode()` tells the UI a
send was simulated.

---

## 3. Authentication

Same OAuth **refresh-token grant** as Zoho Books: swap the refresh token for a short-lived
access token, cache it, send it as `Authorization: Zoho-oauthtoken <token>`, and retry once
on a 401. If you understand the Books auth, you understand this one.

---

## 4. Service surface (public methods)

| Method | Purpose |
|---|---|
| `makeRequest(method, endpoint, data)` | a generic JSON call to Zoho Sign |
| `createRequestMultipart(pdfPaths, filenames, requestData)` | create a request and upload the PDF documents (multipart) |
| `submitWithFields(requestId, actions, documentIds, perDocCoords)` | attach signer actions + field coordinates and submit for signing |
| `getRequest(requestId)` | fetch status/details — used to reconcile our copy |
| `remind(requestId)` / `recall(requestId, reason)` | nudge / withdraw |
| `downloadDocumentPdf(requestId, docId)` | one document's signed PDF |
| `downloadRequestPdf(requestId)` | the whole signed request PDF |
| `downloadCertificate(requestId)` | the completion certificate |

**Why two calls to send?** Zoho's model is: first **create** the request and upload the
files (`createRequestMultipart`), then **submit** it with the signer actions and where each
signer signs (`submitWithFields`). Creating and submitting are separate steps.

---

## 5. PDF rendering — where the document comes from

The document that gets signed is rendered **server-side**:
- **Agreements / trade docs** → `ClmSignatureController::renderPdf(...)`, using the blade
  template `pdf.clm-signature-document`.
- **Purchase Order** → `SalesPdfController::renderPoPdfBytes(...)`.

Rendering does three notable things:
1. **Placeholder substitution.** `replacePlaceholders(...)` fills tokens like
   `{{customer.*}}`, `{{consignee.*}}`, `{{vendor.*}}` with real party data;
   `expandProductTable(...)` expands a `{{product.*}}` table row-per-product for opportunity
   documents.
2. **Page-shell config.** The saved header/footer configuration is applied; a per-render
   override (from the modal's inline edits) wins when present, without changing the saved
   row.
3. **Content source.** `$sourceHtml = contentOverride ?? $doc->content`. If the library
   row's `content` is empty, only the header/footer render — which is why an un-authored
   agreement previews "blank".

---

## 6. Signature field placement

The frontend renders the PDF with pdf.js and runs `detectSignatureMarkers` to find a
signature marker and seed the box position. The user can drag it. On send, the per-signer
(or per-role) coordinates are passed to `submitWithFields` as `perDocCoords`. Multi-role
documents (e.g. Buyer + Consignee) seed a box for each role.

---

## 7. Status reconciliation — polling, not webhooks (important)

**Webhook** = the third party pushes an update to us the moment something changes.
**Polling** = we periodically ask "what changed?".

This integration uses **polling** — there is **no inbound webhook route**. The app calls
`ZohoSignService::getRequest` (on a schedule and on-demand, a `?sync=1`-style fetch) and
updates our stored `clm_signature_requests.status` to match Zoho. So an in-progress request
becomes *Signed* on its own within the poll window.

**Why does this matter to an engineer?** Because a manual poll and a background poll can
overlap and arrive out of order. So status writes are treated **idempotently** — writing the
same status twice, or an older status after a newer one, must not corrupt the record. Keep
that invariant if you touch this code.

---

## 8. Error handling — never leak raw Zoho text

`ZohoSignService` throws `RuntimeException("Zoho Sign API error: <raw body>")` on a non-2xx
response. That raw body must never reach the UI. Every send catch maps it to a clean message:

- `ClmSignatureController` has `cleanSendError($e, $fallback)`, applied in `send`,
  `agreementSend`, `ctcSend`, and `salesDocSend`.
- `PurchaseOrderController::sendForSignature` has a sibling `cleanSignError($e)` (this is the
  PO Stage-4 path, which is separate from the CLM controller — both must be covered).

The mapping detects the "already / processed / signed / completed / in progress / duplicate"
case and returns a specific message; anything else gets a clean generic message; a non-Zoho
error keeps its own developer message.

---

## 9. Data model

| Table | Purpose |
|---|---|
| `clm_signature_requests` | one row per Zoho request — `zoho_request_id`, `document_type`, `status`, `signers`, `document_names`/`ids`, `expiry_date` |
| `clm_agreement_library` / `clm_trade_doc_library` | the content rendered and signed |

**Keying gotcha:** a request is tracked as `agreement-<libId>` vs `trade-<libId>`. A trade
document and an agreement can share the same numeric library id, so the `document_type`
prefix keeps them from overwriting each other in status maps.

---

## 10. Security & multi-tenancy

- All routes are behind `auth:sanctum` + `user.active`.
- Party and document lookups are scoped to the user's tenant (`client_id`).
- Secrets live only in `.env`.
- Temp PDF files created for a send are always cleaned up in a `finally` block.

---

## 11. Where to change things safely

Prefer editing **controller-side** composition, **rendering**, and **error mapping** over
the raw `ZohoSignService` API client. If you must change the service, make sure you don't
change how status is reconciled (idempotency) or how errors are surfaced (no raw leaks).
