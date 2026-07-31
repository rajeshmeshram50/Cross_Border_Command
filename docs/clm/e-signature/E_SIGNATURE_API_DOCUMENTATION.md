# E-SIGNATURE (ZOHO SIGN) — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → **E-signature** (cross-cutting)
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. There is no dedicated permission slug — access follows the source document's own screen.
- Success: `{ status: true, message?, data? }` · Failure: `{ status: false, message }`.
- Codes: 200 · 401 · 403 · 404 · 422 · 500 · **503** (Zoho not configured).
- **Raw Zoho error payloads are never returned** — they are translated into plain messages.
- Binary endpoints (previews, downloads, certificate) stream a file, not JSON.
- Literal paths (`/preview`, `/agreement-*`, `/sales-doc-send`, `/ctc-*`) precede `/{id}`, which is `whereNumber`-constrained.

---

## 2. ENDPOINT INDEX

### Preview
| Method | Path |
|---|---|
| POST | `/clm/signature-requests/preview` · `/agreement-preview` · `/ctc-preview` |

### Send
| Method | Path | Sends |
|---|---|---|
| POST | `/clm/signature-requests` | Trade documents **or** agreements (mutually exclusive) |
| POST | `/clm/signature-requests/agreement-send` | Agreements (Sales-Matrix flow) |
| POST | `/clm/signature-requests/sales-doc-send` | Quotation / Proforma Invoice |
| POST | `/clm/signature-requests/ctc-send` | A Case-to-Case contract |

### Track
| Method | Path |
|---|---|
| GET | `/clm/signature-requests[?sync=true]` · `/{id}` |
| GET | `/clm/ctc-contracts/{id}/sync-signature` |

### Act
| Method | Path |
|---|---|
| POST | `/clm/signature-requests/{id}/remind` · `/{id}/recall` |
| POST | `/clm/ctc-contracts/{id}/remind-signing` |

### Files
| Method | Path |
|---|---|
| GET | `/{id}/download-file/{index}` · `/{id}/view-file/{index}` · `/{id}/certificate` · `/{id}/declined-file` |

---

## 3. POST `/clm/signature-requests` — send

```json
{ "trade_doc_ids": [12, 15],
  "party_id": 88,
  "model_name": "Customer",
  "lead_id": 341,
  "signers": [
    { "name": "A. Rao",   "email": "a@buyer.com",     "order": 1, "role": "buyer" },
    { "name": "M. Iyer",  "email": "m@consignee.com", "order": 2, "role": "consignee" }
  ],
  "expiry_days": 30,
  "is_sequential": false,
  "notes": "Please review and sign these documents.",
  "document_settings": {
    "12": { "buyer":     { "x": 380, "y": 720, "page": 0, "width": 150, "height": 45 },
            "consignee": { "x": 380, "y": 640, "page": 0, "width": 150, "height": 45 } },
    "15": { "x": 380, "y": 700, "page": 0, "width": 150, "height": 45 },
    "po": { "x": 380, "y": 680, "page": 0, "width": 150, "height": 45 }
  },
  "header_config_overrides": { "12": { … } },
  "footer_config_overrides": { "12": { … } },
  "content_overrides":       { "12": "<p>…</p>" },
  "purchase_order_id": 77 }
```

| Field | Rule |
|---|---|
| `trade_doc_ids` | required *without* `agreement_ids` · array · **max 10** · each must exist |
| `agreement_ids` | required *without* `trade_doc_ids` · array · **max 10** · mutually exclusive |
| `party_id` | required · integer |
| `model_name` | optional · `Customer` \| `Consignee` \| `Vendor` (default `Customer`) |
| `lead_id` | optional — **without it the Sales-Matrix status poll cannot find the request** |
| `signers` | required · **1–5** · each `{email, name, order?, role?}` |
| `expiry_days` | optional · **1–90** (default 30; Zoho caps it at two digits) |
| `is_sequential` | optional · boolean |
| `notes` | optional · max 1000 |
| `document_settings` | optional · keyed by document id, plus the reserved key `"po"` |
| `header_config_overrides` / `footer_config_overrides` / `content_overrides` | optional · keyed by document id — **never mutate the saved master** |
| `purchase_order_id` | optional · bundles the rendered PO as one extra document |

**200**
```json
{ "status": true,
  "message": "Documents sent for signature successfully.",
  "data": {
    "signature_request_id": 902,
    "zoho_request_id": "1234567890",
    "status": "inprogress",
    "document_count": 2,
    "document_ids": [12, 15],
    "document_names": ["TDL-004 Non-GMO Declaration", "TDL-007 Packing Declaration"],
    "signers": [ … ],
    "expiry_date": "2026-08-30T00:00:00.000000Z",
    "auto_submitted": true,
    "testing_mode": false } }
```
In sandbox mode the message gains: *"(Sandbox mode — signer emails are only delivered if the recipient is a Zoho Sign user on this org.)"*

### Signature box shapes
```jsonc
// single signer — a flat box
{ "x": 380, "y": 720, "page": 0, "width": 150, "height": 45 }

// Buyer + Consignee — one box PER ROLE
{ "buyer": { … }, "consignee": { … } }
```
Both shapes pass straight through. Each Zoho action is tagged with the signer's `role`, so each box lands where that role's box was dragged instead of both stacking at one coordinate.

### Errors
**503 — Zoho not configured**
```json
{ "status": false, "message": "Zoho Sign is not configured. Contact your administrator." }
```

**422 — mixed applicable parties**
```json
{ "status": false,
  "message": "A single signature request can only contain documents for the same applicable party. Found a mix of: Buyer | Consignee. Send each party group separately." }
```

**422 — nothing accessible**
```json
{ "status": false, "message": "No accessible documents in the selection." }
```

**500 — sanitised Zoho failure**
```json
{ "status": false,
  "message": "This document has already been signed or is being processed in another tab or session. Refresh the page to see its current status." }
```
or
```json
{ "status": false,
  "message": "The e-signature service could not process this request right now. Please try again in a moment." }
```

> Duplicate signer emails are **collapsed automatically** — the first occurrence wins, preserving its signing order.

---

## 4. PREVIEW ENDPOINTS

### POST `/clm/signature-requests/preview`
```json
{ "trade_doc_id": 12,          // or "agreement_id": 31 (mutually exclusive)
  "party_id": 88,
  "model_name": "Customer",
  "lead_id": 341,
  "header_config_override": { … },
  "footer_config_override": { … },
  "content_override": "<p>…</p>" }
```
Streams the **exact PDF that would be sent**, with placeholders resolved:
```
Content-Type: application/pdf
Content-Disposition: inline; filename="preview-TDL-004.pdf"
Cache-Control: no-store
```
The saved document row is **not** mutated — overrides apply to this render only. `lead_id` lets the `{{product.*}}` table resolve against the opportunity's products; without it that table renders empty.

`agreement-preview` and `ctc-preview` follow the same pattern for their document types.

---

## 5. GET `/clm/signature-requests` — the tracker

**Query parameters**

| Param | Effect |
|---|---|
| `party_id` · `model_name` | Filter to one party |
| `document_type` | `trade_doc` \| `agreement` \| `quotation` \| `proforma_invoice` \| `purchase_order` |
| `lead_id` | Scope to one opportunity |
| `status` | A single value or an array |
| `branch_id` | Branch narrowing (auto-injected) |
| **`sync=true`** | Re-poll Zoho before responding |

**200**
```json
{ "status": true,
  "data": [
    { "id": 902,
      "document_type": "trade_doc",
      "lead_id": 341,
      "trade_doc_id": 12,
      "trade_doc_ids": [12, 15],
      "document_names": ["TDL-004 Non-GMO Declaration", "TDL-007 Packing Declaration"],
      "model_name": "Customer",
      "party_id": 88,
      "zoho_request_id": "1234567890",
      "status": "completed",
      "signers": [
        { "name": "A. Rao", "email": "a@buyer.com", "order": 1, "role": "buyer",
          "viewed_at": "2026-07-21T09:12:00+00:00",
          "signed_at": "2026-07-21T09:30:00+00:00" }
      ],
      "expiry_date": "2026-08-20T00:00:00.000000Z",
      "completed_at": "2026-07-21T09:30:00.000000Z",
      "declined_at": null, "decline_reason": null,
      "recalled_at": null, "recall_reason": null,
      "reminder_count": 2,
      "last_reminder_sent_at": "2026-07-20T06:00:00.000000Z",
      "signed_document_paths": [
        { "zoho_document_id": "abc", "document_name": "TDL-004 Non-GMO Declaration",
          "path": "uploads/signed_documents/customer/signed_non-gmo_1721550600_0.pdf",
          "url": "https://…", "file_url": "https://…", "size": 184320 }
      ],
      "signed_document_url": "https://…",
      "certificate_url": "https://…",
      "file_url": "https://…" } ],
  "count": 1 }
```

### `?sync=true`
Re-polls Zoho for rows that are `inprogress`, **or** `completed` but still missing their signed files, then re-reads the list. Per poll it:
- syncs per-signer **Viewed / Signed** activity,
- applies status transitions (stamping `completed_at` on first completion),
- captures **who / why / when** on a decline or recall,
- downloads the signed PDFs and the completion certificate.

> **`signed_document_url` never falls back to `certificate_url`.** They are different artefacts — the certificate is Zoho's audit trail, not the signed document. When the signed PDF has not been fetched yet the URL stays `null` so the UI can say "signed PDF unavailable" rather than silently serving the certificate.

### Two behaviours worth knowing
1. **Capped at 200 rows.**
2. **Same-as-customer read-through:** requesting `model_name=Consignee` for a consignee flagged *same as customer* transparently returns the **parent customer's** requests, so its Trade Documents tab is not empty.

---

## 6. GET `/clm/signature-requests/{id}`

Returns one request with **per-recipient** status pulled live from Zoho's `actions` array — so the tracker can show one signer as *Signed*, another as *Viewed* and a third as *Pending*, instead of painting every row with the single overall request status.

---

## 7. ACTIONS

### POST `/{id}/remind`
Nudges the pending signers; increments `reminder_count` and stamps `last_reminder_sent_at`. Those two fields drive the *"Sent N times"* badge on the Remind button.

### POST `/{id}/recall`
```json
{ "reason": "Superseded by a revised annexure." }
```
Pulls the request back in Zoho and stores `recalled_at` + `recall_reason`. **A recall is one-way** — the request cannot be resumed, only re-sent.

---

## 8. FILE ENDPOINTS

| Endpoint | Returns |
|---|---|
| GET `/{id}/download-file/{index}` | The signed PDF at that index of `signed_document_paths`, as an attachment |
| GET `/{id}/view-file/{index}` | The same, inline |
| GET `/{id}/certificate` | Zoho's **completion certificate** — a separate artefact from the signed document |
| GET `/{id}/declined-file` | The document as it stood when a signer declined |

All are streamed through the Storage disk, so local and Azure Blob behave identically.

---

## 9. CASE-TO-CASE ENDPOINTS

| Method | Path | Purpose |
|---|---|---|
| POST | `/clm/signature-requests/ctc-preview` | Render the contract as it will be sent, with the **organisation signature** stamped in |
| POST | `/clm/signature-requests/ctc-send` | Create the Zoho request |
| GET | `/clm/ctc-contracts/{id}/sync-signature` | Poll Zoho **and** refresh the CTC Review Timeline |
| POST | `/clm/ctc-contracts/{id}/remind-signing` | Nudge the counterparty |

`sync-signature` feeds the **same** Review Timeline as `GET /clm/ctc-contracts/{id}`, so both use the shared `CtcAuditTime` UTC→IST converter — when they didn't, the timeline shifted by 5:30 depending on which endpoint the SPA had last polled (CBC-574).

A counterparty **decline** stamps `signature_declined_at` on the contract and routes it back through `resubmit` → Stage 2. A decline can never go straight back to Zoho.

---

## 10. STATUS VALUES

| Status | Meaning |
|---|---|
| `draft` | Created in Zoho but submission did not flip it |
| `inprogress` | Out with the signers |
| `completed` | Fully signed; artefacts filed |
| `declined` | A signer refused — reason and timestamp captured |
| `recalled` | Pulled back with a reason |
| `expired` | Past its expiry window |
| `superseded` | The source sales document was edited while pending — re-send required |

### What a status does to the source document
| Source | Locks when |
|---|---|
| Trade document | a request reaches **`completed`** |
| Agreement | a request reaches **`inprogress` or `completed`** (stricter) |
| Quotation / PI | a request reaches `completed`; a **sent** PI already unlocks Stage 6 (Victory) |
| Sales doc edited mid-flight | the pending request becomes `superseded` |

---

## 11. QUICK REFERENCE

```
POST /clm/signature-requests/preview            # exactly what will be sent
POST /clm/signature-requests                    # { trade_doc_ids[]|agreement_ids[],
                                                #   party_id, model_name, lead_id,
                                                #   signers[], document_settings{} }
GET  /clm/signature-requests?document_type=trade_doc&lead_id=341&sync=true
                                                # poll → status, signed PDFs, certificate
POST /clm/signature-requests/{id}/remind        # nudge
POST /clm/signature-requests/{id}/recall        # { reason } — one-way
GET  /clm/signature-requests/{id}/view-file/0   # the signed PDF
GET  /clm/signature-requests/{id}/certificate   # the completion certificate

# case-to-case
POST /clm/signature-requests/ctc-send
GET  /clm/ctc-contracts/{id}/sync-signature
```

---

## 12. NOTES (caveats)

1. **No webhook** — status is refreshed only when the list is requested with `?sync=true`.
2. Max **10 documents** and **5 signers** per request; `expiry_days` is clamped to 1–90.
3. All documents in one request must target the **same applicable party** (422 otherwise).
4. Duplicate signer emails are collapsed to a single signing action.
5. `document_settings` keys must match the document ids, plus the reserved `"po"` key for a bundled Purchase Order.
6. Per-send header / footer / body overrides **never mutate** the saved master.
7. **Raw Zoho error bodies are never returned** — they are mapped to plain messages.
8. `signed_document_url` never falls back to `certificate_url` — different artefacts.
9. The tracker list is capped at **200 rows**.
10. A consignee flagged *same as customer* reads through to its parent customer's requests.
11. Documents over ~1,000,000 characters of HTML cannot be rendered for sending.
12. In Zoho's sandbox mode, signer emails only reach Zoho Sign users on the same org.
13. `lead_id` is optional but **required in practice** for Sales-Matrix status polling to find the request.

---

*Related documents: E_SIGNATURE_FUNCTIONAL_DOCUMENTATION.md · E_SIGNATURE_TECHNICAL_DOCUMENTATION.md · E_SIGNATURE_CODE_WALKTHROUGH.md*
