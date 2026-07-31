# E-SIGNATURE (ZOHO SIGN) — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → **E-signature** (cross-cutting)
> No menu entry of its own — it is embedded in the Trade Document, Agreement, Sales-Matrix, Purchase-Order and Case-to-Case screens.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
E-signature is how a CLM document stops being a draft and becomes a **legal record**. It wraps **Zoho Sign**: render the document to PDF with the party's details merged in, place the signature boxes where the user dragged them, send it, track who viewed and signed, and file the signed PDF plus Zoho's completion certificate back into the tenant's storage.

It has **no screen of its own**. It appears as a *Send for Signature* action inside five different flows:

| Flow | What is sent | `document_type` |
|---|---|---|
| Trade Documents (vault + Sales Matrix) | up to 10 trade-document drafts | `trade_doc` |
| Agreements (vault + Sales Matrix) | up to 10 agreement templates | `agreement` |
| Sales Matrix Stage 5 | the rendered Quotation PDF | `quotation` |
| Sales Matrix Stage 5 | the rendered Proforma Invoice PDF | `proforma_invoice` |
| P2P | the rendered Purchase Order PDF | `purchase_order` |
| Case-to-Case | the contract, with the org signature stamped in | (CTC-specific endpoints) |

### 1.2 Business value
| Benefit | Description |
|---|---|
| Legally filed | The signed PDF **and** Zoho's completion certificate are stored against the request |
| Bundled sends | Up to 10 documents in a single signing session for the recipient |
| Placed signatures | The user drags each signature box; per-signer positions are honoured |
| Live tracking | Viewed / Signed per recipient, with timestamps |
| Reminders and recall | Nudge a signer, or pull the request back with a reason |
| Decline captured | Who declined, why and when |
| Documents lock | A sent or signed document can no longer diverge from what the counterparty saw |

### 1.3 Key features
- Preview before sending (the exact PDF that will be dispatched).
- Multi-document bundles (max 10) and multi-signer requests (max 5).
- Per-document and **per-signer-role** signature box positions.
- `{{placeholder}}` merge for party, organisation and product tokens.
- Per-send header / footer / body overrides that never mutate the saved master.
- Status polling with automatic signed-PDF and certificate download.
- A Purchase Order can be **bundled** into a trade-document request.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Any user who can see the source document | May preview and send |
| Branch users / employees | Bound by the same visibility rules as the document they are sending |

There is no separate permission slug — access follows the document's own screen (`clm.trade_documents`, `clm.agreements`, the Sales Matrix, P2P, `clm.case_to_case`).

---

## 3. BUSINESS PROCESS FLOW

```
   1. PREVIEW                       (optional)
        the exact PDF that will be sent, with placeholders resolved
        │
   2. SEND
        ├─ render each document to a temp PDF
        │    · placeholders merged from the party / lead / organisation
        │    · per-doc header, footer and body overrides applied
        │    · signature markers placed
        ├─ create the Zoho request (JSON + N PDFs, multipart)
        ├─ read back Zoho's action ids and document ids
        ├─ submit with the dragged signature-box coordinates
        └─ persist a signature request row
        │
   3. TRACK
        the list polls Zoho for in-progress requests
        · per-signer Viewed / Signed activity
        · status transitions
        · on completion → download the signed PDFs + the certificate
        │
   4. OUTCOMES
        completed  → the signed PDF and certificate are downloadable
        declined   → who / why / when captured
        recalled   → pulled back with a reason
        superseded → the source document was edited mid-flight; re-send required
        │
   5. CONSEQUENCES
        Trade document signed   → locked against edit and delete
        Agreement sent          → locked against edit and delete (stricter)
        PI sent                 → the deal may advance to Victory
        Sales doc edited        → the pending request is superseded
```

### 3.1 The status model
| Status | Meaning |
|---|---|
| `draft` | Created in Zoho but submission did not flip it |
| `inprogress` | Out with the signers |
| `completed` | Everyone signed; the signed PDF and certificate are filed |
| `declined` | A signer refused — reason and timestamp captured |
| `recalled` | Pulled back by the sender with a reason |
| `expired` | Passed its expiry window |
| `superseded` | The source document was edited while the signature was pending |

### 3.2 The same-party rule
> **All documents in one signature request must target the same applicable party.**

A bundle may be all-Buyer, all-Consignee, or all-Buyer+Consignee — but not a mix. The signer set is tied to the document's applicable party, so a mixed bundle would route the wrong papers to the wrong people. Attempting it returns a 422 naming the conflicting parties.

### 3.3 Why documents lock
| Document | Locks when | Reason |
|---|---|---|
| Trade document | a request reaches **`completed`** | The signed copy is a legal record |
| Agreement | a request reaches **`inprogress` or `completed`** | A contract already sitting in a counterparty's inbox must not change |
| Quotation / PI | a request reaches `completed` | Same as trade documents |

Editing a **sales** document while a signature is pending does not fail — instead the pending request is marked **superseded**, so it no longer counts and the updated document must be re-sent.

### 3.4 Limits
| Limit | Value |
|---|---|
| Documents per request | **10** |
| Signers per request | **5** |
| Expiry window | 1–90 days (default 30) |
| Render ceiling | ~1,000,000 characters of HTML |
| Signed-request list page | 200 rows |

Duplicate signer emails are collapsed automatically — one person receives one signing action, not several.

---

## 4. SCREEN TOUCHPOINTS

| Screen | Where e-signature appears |
|---|---|
| Trade Documents library / Evidence Vault | *Send for Signature* on a draft |
| Agreements library / Sales Matrix Segment Details | *Send* per applicable agreement, with live status badges |
| Sales Matrix Stage 5 | Send the Quotation or Proforma Invoice |
| P2P Purchase Order | Send the PO, or bundle it into a trade-document request |
| Case to Case | *Send for Signing* via Zoho, with the org signature stamped in |
| Signing Tracker | Per-signer Viewed / Signed timeline, Remind, Recall, downloads |

Each row surfaces: status, sent date, completion date, signed-PDF link, certificate link, reminder count and last-reminder timestamp.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Zoho Sign must be configured — otherwise sending returns **503** |
| 2 | A request may bundle at most **10 documents** and **5 signers** |
| 3 | All documents in one request must target the **same applicable party** |
| 4 | Duplicate signer emails are collapsed, keeping the first occurrence and its signing order |
| 5 | Expiry is clamped to 1–90 days |
| 6 | Per-send header / footer / body overrides apply only to that send — the saved master is never mutated |
| 7 | Signature box positions are per document, and may be **per signer role** on a Buyer + Consignee send |
| 8 | Raw Zoho error payloads are **never** shown to the user — they are translated into plain messages |
| 9 | On completion the signed PDFs and the completion certificate are downloaded and stored |
| 10 | The signed-document link never falls back to the certificate — they are different artefacts |
| 11 | A completed request locks its source trade document; a sent request locks its source agreement |
| 12 | Editing a sales document with a pending request **supersedes** that request |
| 13 | A consignee flagged *same as customer* reads through to the parent customer's requests |

---

## 6. WHAT THE USER SEES ON FAILURE

| Situation | Message |
|---|---|
| Zoho not configured | *"Zoho Sign is not configured. Contact your administrator."* |
| Already sent / signed elsewhere | *"This document has already been signed or is being processed in another tab or session. Refresh the page to see its current status."* |
| Any other Zoho failure | *"The e-signature service could not process this request right now. Please try again in a moment."* |
| Mixed applicable parties | *"A single signature request can only contain documents for the same applicable party… Send each party group separately."* |

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Polling, not webhooks | Status is refreshed when the list is opened with sync enabled — there is no push from Zoho |
| Signed PDF may lag | If Zoho's per-document download fails transiently, the certificate can appear before the signed PDF; the next sync retries |
| Sandbox mode | In Zoho's testing mode, signer emails are only delivered to Zoho Sign users on the same org — the UI says so in the success message |
| Trade docs lock late | The lock fires on *completed*, so a draft remains editable while a signature is in flight |
| Recall is one-way | A recalled request cannot be resumed — it must be re-sent |
| 200-row cap | The signature-request list returns at most 200 rows |
| Render ceiling | Documents over ~1 MB of HTML cannot be rendered for sending |

---

*Related documents: E_SIGNATURE_TECHNICAL_DOCUMENTATION.md · E_SIGNATURE_CODE_WALKTHROUGH.md · E_SIGNATURE_API_DOCUMENTATION.md*
