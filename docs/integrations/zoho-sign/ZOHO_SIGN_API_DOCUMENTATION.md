# Zoho Sign Integration — API Documentation

> Every internal endpoint for the e-signature flow, with examples, plus the Zoho Sign calls
> behind them. Usable by someone new to the codebase.

## Document Control

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-30 | System | Initial Zoho Sign API reference |
| 2.0 | 2026-07-30 | System | Expanded, fresher-friendly edition |

---

## 0. How to read this

Two layers again:
1. **Internal API** — endpoints in *our* app the frontend calls (preview, send, track…).
2. **Zoho Sign API** — endpoints *our server* calls behind the scenes.

**Conventions (internal API):**
- Under `auth:sanctum` + `user.active`; send `Authorization: Bearer <sanctum-token>`.
- Real URLs are prefixed with `/api`.
- Response shape: `{ "status": bool, "message"?: string, "data"?: ... }`.
- Preview endpoints return a **PDF blob** (`Content-Type: application/pdf`), not JSON.

---

## 1. CLM signature requests (agreements & trade documents)

| Method | Path | Controller | Purpose |
|---|---|---|---|
| POST | `/api/clm/signature-requests/preview` | `ClmSignatureController@preview` | Render a trade-doc / agreement PDF (blob) |
| POST | `/api/clm/signature-requests` | `@send` | Create + submit a request (trade docs and/or agreements) |
| GET | `/api/clm/signature-requests` | `@index` | List requests (with live status) |
| GET | `/api/clm/signature-requests/{id}` | `@show` | One request's detail / status |
| POST | `/api/clm/signature-requests/{id}/remind` | `@remind` | Send a reminder |
| POST | `/api/clm/signature-requests/{id}/recall` | `@recall` | Withdraw. Body `{ "reason": "…" }` |
| GET | `/api/clm/signature-requests/{id}/download-file/{index}` | `@downloadFile` | Download a signed document |
| GET | `/api/clm/signature-requests/{id}/view-file/{index}` | `@viewFile` | Inline view a signed document |
| GET | `/api/clm/signature-requests/{id}/certificate` | `@viewCertificate` | Completion certificate |
| GET | `/api/clm/signature-requests/{id}/declined-file` | `@declinedFile` | Declined document |

## 2. Agreement / CTC / sales-doc variants

| Method | Path | Controller |
|---|---|---|
| POST | `/api/clm/signature-requests/agreement-preview` | `@agreementPreview` |
| POST | `/api/clm/signature-requests/agreement-send` | `@agreementSend` |
| POST | `/api/clm/signature-requests/ctc-preview` | `@ctcPreview` |
| POST | `/api/clm/signature-requests/ctc-send` | `@ctcSend` |
| GET | `/api/clm/ctc-contracts/{id}/sync-signature` | `@ctcSignatureStatus` (poll/reconcile) |
| POST | `/api/clm/signature-requests/sales-doc-send` | `@salesDocSend` |

## 3. Purchase Order

| Method | Path | Controller | Purpose |
|---|---|---|---|
| POST | `/api/p2p/purchase-orders/{id}/send-for-signature` | `PurchaseOrderController@sendForSignature` | Send the PO PDF to the supplier |
| GET | `/api/p2p/purchase-orders/{id}/pdf?signature=1` | `@pdf` | PO PDF used as the send-modal preview |

---

## 4. Worked example — preview then send an agreement

**Preview (returns a PDF blob you display in the browser):**
```http
POST /api/clm/signature-requests/agreement-preview
Authorization: Bearer <sanctum-token>
Content-Type: application/json

{ "agreement_id": 12, "party_id": 44, "model_name": "Vendor" }
→ 200 application/pdf  (binary)
```

**Send:**
```http
POST /api/clm/signature-requests
Authorization: Bearer <sanctum-token>
Content-Type: application/json

{
  "agreement_ids": [12],
  "party_id": 44,
  "model_name": "Vendor",
  "signers": [{ "name": "A. Vendor", "email": "vendor@acme.com", "order": 1 }],
  "document_settings": { "12": { "page": 1, "x": 400, "y": 650, "w": 160, "h": 60 } },
  "expiry_days": 30
}
```
Success:
```json
{
  "status": true,
  "message": "Sent for signature via Zoho Sign.",
  "data": { "signature_request_id": 101, "zoho_request_id": "…", "status": "sent" }
}
```

**Field reference for the send body:**
| Field | Meaning |
|---|---|
| `agreement_ids` / `trade_doc_ids` | which library documents to sign (≤ 10) |
| `party_id` + `model_name` | who signs (`Customer` / `Consignee` / `Vendor`) |
| `signers` | list of `{ name, email, order }` (≤ 5) |
| `document_settings` | per-document signature-box coordinates |
| `expiry_days` | how long before the request expires (default 30) |

---

## 5. Clean error responses (raw Zoho text is never returned)

```json
// already out for signature / signed / being processed elsewhere
{ "status": false, "message": "This document has already been signed or is being processed in another tab or session. Refresh the page to see its current status." }

// any other Zoho failure
{ "status": false, "message": "The e-signature service could not process this request right now. Please try again in a moment." }
```

---

## 6. The Zoho Sign API endpoints our server calls

You don't call these — `ZohoSignService` does. Base host: `https://sign.zoho.in`,
API version `v1`.

| Our operation | Zoho Sign endpoint (shape) |
|---|---|
| Create request + upload docs | `POST /api/v1/requests` (multipart: files + `data`) |
| Submit with signer fields | `PUT /api/v1/requests/{id}/submit` (actions + field coords) |
| Get request / status | `GET /api/v1/requests/{id}` |
| Remind | `POST /api/v1/requests/{id}/remind` |
| Recall | `POST /api/v1/requests/{id}/recall` |
| Download document / request / certificate | `GET /api/v1/requests/{id}/documents/{docId}/pdf`, `…/pdf`, `…/completioncertificate` |

---

## 7. How our server authenticates to Zoho

```http
POST {accounts_url}/oauth/v2/token
  ?refresh_token=<ZOHO_REFRESH_TOKEN>&client_id=<...>&client_secret=<...>&grant_type=refresh_token
→ { "access_token": "1000.xxxx", "expires_in": 3600 }
```
Used as `Authorization: Zoho-oauthtoken 1000.xxxx` on every Sign call; one auto-retry on 401.

---

## 8. Status model (no webhook)

There is **no inbound webhook**. Status is reconciled by polling `getRequest` — the
`?sync=1`-style list/status fetch round-trips Zoho so an in-progress request flips to
*Signed* on its own. Status writes are idempotent so an overlapping manual + background poll
can't corrupt the record.

---

## 9. Postman checklist

1. Log in → set `Authorization: Bearer <token>`.
2. `agreement-preview` (or `preview`) to confirm the document renders.
3. `POST /clm/signature-requests` with signers + `document_settings`.
4. `GET /clm/signature-requests` to watch the status flip to *signed* over time.
5. `GET …/certificate` once signed to pull the audit certificate.
