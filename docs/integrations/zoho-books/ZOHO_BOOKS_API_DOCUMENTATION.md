# Zoho Books Integration — Complete API Documentation

> Every internal endpoint that drives the sync, with request/response examples, plus the
> Zoho Books endpoints they call behind the scenes. Written to be usable by someone who has
> never touched this codebase. **Every fact here is verified against the actual source code.**

## Document Control

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-30 | System | Initial Zoho Books API reference |
| 2.0 | 2026-07-30 | System | Expanded, fresher-friendly edition |
| 3.0 | 2026-07-30 | System | Complete, sectioned, code-verified edition |

---

## Table of Contents

1. System Overview
2. Authentication & Conventions
3. Purchase Order Endpoints
4. Supplier Purchase Invoice Endpoints
5. Debit Note (Vendor Credit) Endpoints
6. Dev Tools & Inspection
7. Worked Examples
8. Error Reference
9. Zoho Books API Reference (what our server calls)
10. Postman Guide
11. Appendix (env, jobs, internals)
12. Quick Reference Card

---

## 1. System Overview

### 1.1 Two API layers

| Layer | Purpose | Who calls it |
|---|---|---|
| **Internal API** | Our app's endpoints the frontend uses ("sync this PO") | Frontend, Postman, cURL |
| **Zoho Books API** | Zoho's endpoints our server calls | `ZohoBooksService` only — never a client |

### 1.2 Data flow for a PO sync

```
 ┌──────────┐   POST /sync   ┌───────────────┐          ┌──────────────────┐        ┌──────────────┐
 │ Frontend │ ─────────────► │ Internal API  │ ───────► │ ZohoBooksService │ ─HTTPS►│ Zoho Books   │
 │  / React │                │ (our server)  │          │ (OAuth, retries) │        │ API (extern) │
 └──────────┘                └───────────────┘          └──────────────────┘        └──────────────┘
                                    │  stamps zoho_* columns on purchase_orders / …
                                    ▼
                             MySQL / Postgres
```

### 1.3 What maps to what

| Our record | Becomes in Zoho Books |
|---|---|
| Purchase Order | Purchase Order **+** Bill |
| Supplier Purchase Invoice (With PO) | Bill on the linked PO |
| Supplier Purchase Invoice (Direct) | standalone Bill |
| PO / SPI Payment | Vendor Payment applied to the bill |
| Debit Note | Vendor Credit |
| Product (first sync) | Item |
| Supplier | Vendor / Contact |

---

## 2. Authentication & Conventions

### 2.1 Getting a token

```http
POST /api/login
Content-Type: application/json

{ "email": "user@company.com", "password": "your-password" }
```
**Actual response shape** (token + user are at the top level — there is no `data` wrapper):
```json
{
  "token": "12|abc123def456...",
  "user": { "id": 5, "name": "…", "user_type": "client_admin", "client_id": 1, "branch_id": 3 }
}
```
Send that token on every subsequent request:
```http
Authorization: Bearer 12|abc123def456...
```

### 2.2 Response shape (integration endpoints)

```json
{ "status": true | false, "message"?: "…", "data"?: { … } }
```

| HTTP code | Meaning |
|---|---|
| 200 | Success |
| 422 | Validation / precondition failure (most common) |
| 409 | A concurrent sync is already running |
| 503 | Zoho Books not configured on the server |
| 401 / 403 | Not authenticated / not permitted |
| 404 | Record not found in the user's tenant |

### 2.3 Scoping

Every request is auto-scoped to the authenticated user's `client_id` / `branch_id` — you
never pass these in the body, and you can only touch your own tenant's records.

---

## 3. Purchase Order Endpoints

### 3.1 Sync a PO (create Zoho PO + Bill)

```http
POST /api/p2p/purchase-orders/{id}/sync
Authorization: Bearer <token>
```

**Prerequisites** (each returns a 422 with a clear message if missing):
- a supplier is attached;
- at least one product line;
- TDS has been cut (deduct 0% if none) — *skipped for International documents*;
- at least one payment has been recorded.

**Success** (`data` is the shaped list row for the PO):
```json
{
  "status": true,
  "message": "Synced to Zoho Books — PO + bill BILL-000123, posted ₹1,00,000.00 payment(s).",
  "data": { "id": 42, "po": "PO/2025-26/001", "zoho": "Sync", "zohoBill": "BILL-000123" }
}
```

**Idempotent re-sync** (already synced): returns `status: true` with
`"This PO is already synced with Zoho Books (bill BILL-000123). Use “Sync Payment” to post its payments."`

### 3.2 Sync payment(s)

```http
POST /api/p2p/purchase-orders/{id}/sync-payment
Content-Type: application/json

{ "payment_id": 7 }     // OMIT payment_id to post ALL cleared payments ("Sync All Payments")
```
**Success (one entry):**
```json
{ "status": true, "message": "Posted ₹50,000.00 for this entry to bill BILL-000123." }
```
**Nothing to post:**
```json
{ "status": true, "message": "All recorded payments are already posted to Zoho Books." }
```

### 3.3 Get the cached Zoho PDF

```http
GET /api/p2p/purchase-orders/{id}/zoho-pdf
```
Returns the cached Zoho-rendered PDF (`Content-Type: application/pdf`). There is **no
`type` parameter** — it serves whatever was cached at sync time (`zoho_pdf_path`).
`404` if nothing is cached yet.

### 3.4 Poll the attachment job

```http
GET /api/p2p/purchase-orders/{id}/attachment-status
→ { "status": "queued" | "done" | "failed" }
```

### 3.5 Send the PO for e-signature (Zoho **Sign**, not Books)

```http
POST /api/p2p/purchase-orders/{id}/send-for-signature
```
See the **Zoho Sign** documentation set for this flow.

---

## 4. Supplier Purchase Invoice Endpoints

### 4.1 Sync the invoice (create a Bill)

```http
POST /api/p2p/supplier-purchase-invoices/{id}/sync
```
- **With-PO** invoice → delegates to the linked PO's sync, then stamps all With-PO invoices
  on that PO with the shared bill.
- **Direct** invoice → creates its own standalone bill.

### 4.2 Sync payment(s)

```http
POST /api/p2p/supplier-purchase-invoices/{id}/sync-payment
{ "payment_id": 15 }    // omit to post all
```
Same semantics as the PO payment sync (§3.2).

### 4.3 Sync the invoice document (**no file in the body**)

```http
POST /api/p2p/supplier-purchase-invoices/{id}/sync-attachment
```
> **Important:** this endpoint does **not** accept a file upload. The invoice document was
> already uploaded when the SPI was created (stored at `attachment_path`, max **2 MB**,
> types pdf/jpg/jpeg/png/webp). `sync-attachment` pushes that stored file to the Zoho PO/Bill.

**Prerequisites:** the invoice has an uploaded document; its bill is synced (With-PO → the
PO's purchase order must exist; Direct → the invoice's own bill must exist); not already
attached.

**Success:**
```json
{ "status": true, "message": "Invoice document attached to the Zoho purchase order and bill." }
```
(For a direct invoice: `"Invoice document attached to the Zoho bill."`)

### 4.4 Get the cached Zoho bill PDF

```http
GET /api/p2p/supplier-purchase-invoices/{id}/zoho-pdf
```

---

## 5. Debit Note (Vendor Credit) Endpoints

```http
POST /api/p2p/debit-notes/{id}/sync                 // create a Zoho Vendor Credit
GET  /api/p2p/debit-notes/{id}/attachment-status    // poll the attach job
```
A debit note (money the supplier owes us back) becomes a **Vendor Credit** in Zoho, which
can be applied against the supplier's open bills.

---

## 6. Dev Tools & Inspection (admin / permission-gated)

```http
GET /api/dev-tools/zoho/{type}
```
`type` ∈ `items | vendors | purchase-orders | vendor-credits | bills | payments`.
Returns what we have **stored** for each Zoho entity (Zoho ids, PDF links, sync state) so
you can confirm "did this reach Zoho?". Admin-only; tenant-scoped.

---

## 7. Worked Examples

> These use the **integration** endpoints. Creating the PO/SPI and recording payments is
> done through the normal P2P screens/endpoints first (a PO is created via the PO wizard;
> payments are recorded one at a time via `POST /p2p/purchase-orders/{id}/payments`, which
> is a **multipart** call carrying `amount`, `bank_name`, `utr_cheque_number`,
> `utr_cheque_date`, and a proof `attachment`).

### 7.1 Full PO sync workflow

```http
# 1) Bill sync — creates the Zoho PO + Bill and posts existing payments
POST /api/p2p/purchase-orders/42/sync
Authorization: Bearer <token>

→ { "status": true,
    "message": "Synced to Zoho Books — PO + bill BILL-000123, posted ₹50,000.00 payment(s).",
    "data": { "id": 42, "zoho": "Sync", "zohoBill": "BILL-000123" } }

# 2) Post a later payment (recorded after the first sync)
POST /api/p2p/purchase-orders/42/sync-payment
{ "payment_id": 8 }

→ { "status": true, "message": "Posted ₹37,500.00 for this entry to bill BILL-000123." }

# 3) Open the cached Zoho PDF
GET /api/p2p/purchase-orders/42/zoho-pdf     → application/pdf

# 4) Confirm the ids landed (admin)
GET /api/dev-tools/zoho/purchase-orders
```

### 7.2 Direct supplier invoice workflow

```http
POST /api/p2p/supplier-purchase-invoices/101/sync          # create the bill
POST /api/p2p/supplier-purchase-invoices/101/sync-payment  # post payment(s)
POST /api/p2p/supplier-purchase-invoices/101/sync-attachment  # push the invoice doc to the bill
```

### 7.3 Debit note → vendor credit

```http
POST /api/p2p/debit-notes/55/sync
→ { "status": true, "message": "…vendor credit created in Zoho Books." }
```

---

## 8. Error Reference

| HTTP | Message (verbatim) | Fix |
|---|---|---|
| 422 | "Sync this PO to Zoho Books first — its bill must exist before you can post payments against it." | Do `/sync` before `/sync-payment` |
| 422 | "Record at least one payment before syncing to Zoho Books — the first payment is posted against the bill on sync." | Record a payment first |
| 422 | "18% tax not found in Zoho Books — add it and try again." | Add the rate in Zoho; retry (self-heals) |
| 422 | "Add a Bank / Cash account in Zoho Books before syncing payments — they cannot be posted without one." | Create a Bank/Cash account in Zoho |
| 422 | "Attach a supplier to this PO before syncing to Zoho Books." | Attach a supplier |
| 422 | "Add at least one product line before syncing to Zoho Books." | Add a product line |
| 409 | "A Zoho sync for this purchase order is already in progress — try again in a moment." | Wait, retry |
| 503 | "Zoho Books is not connected yet. Add the Zoho Books credentials to the server .env, then try again." | Configure `.env` |

> **Self-healing tax cache:** the "tax not found" case rebuilds the tax cache and re-checks
> before failing, so adding the tax in Zoho and retrying works immediately — no wait.

---

## 9. Zoho Books API Reference (what our server calls)

You never call these — `ZohoBooksService` does. Base host: `https://www.zohoapis.in/books/v3`;
every call carries `?organization_id=<org>`.

| Our operation | Zoho Books endpoint | Method |
|---|---|---|
| Create / delete Purchase Order | `/purchaseorders`, `/purchaseorders/{id}` | POST / DELETE |
| Mark PO "open" | `/purchaseorders/{id}/status/open` | POST |
| Create / delete / get Bill | `/bills`, `/bills/{id}` | POST / DELETE / GET |
| Record / delete Vendor Payment | `/vendorpayments`, `/vendorpayments/{id}` | POST / DELETE |
| Create / apply / get Vendor Credit | `/vendorcredits`, `/vendorcredits/{id}/bills`, `/vendorcredits/{id}` | POST / POST / GET |
| Find/create Contact (vendor/customer) | `/contacts` | GET / POST |
| Find/create Item (product) | `/items` | GET / POST |
| Taxes / currencies / accounts / org | `/settings/taxes`, `/settings/currencies`, `/chartofaccounts`, `/organizations` | GET |
| Attach a file (append) | `/purchaseorders/{id}/attachment`, `/bills/{id}/attachment`, `/vendorcredits/{id}/attachment` | POST |
| Get PDFs | `/purchaseorders/{id}?accept=pdf`, `/bills/{id}?accept=pdf`, `/vendorcredits/{id}?accept=pdf` | GET |

### 9.1 Auth flow (OAuth refresh-token grant)

```http
POST {accounts_url}/oauth/v2/token
  ?refresh_token=<ZOHO_BOOKS_REFRESH_TOKEN>&client_id=<…>&client_secret=<…>&grant_type=refresh_token
→ { "access_token": "1000.xxxx", "expires_in": 3600 }
```
Used as `Authorization: Zoho-oauthtoken 1000.xxxx`. A 401 triggers exactly one automatic
refresh + retry. `organization_id` is sent in the query string and, on uploads, also as a
multipart form field.

---

## 10. Postman Guide

### 10.1 Setup

1. `POST /api/login` → copy the top-level `token`.
2. Postman environment variables:
   ```
   BASE_URL      = https://your-app.com
   SANCTUM_TOKEN = 12|abc123...
   PO_ID = 42   SPI_ID = 101   DEBIT_NOTE_ID = 55
   ```
3. Collection-level header: `Authorization: Bearer {{SANCTUM_TOKEN}}`.

### 10.2 Suggested folders

```
Zoho Books Integration/
├── Auth/                 (Login)
├── Purchase Orders/      (Sync, Sync Payment, Zoho PDF, Attachment Status, Send for Signature)
├── Supplier Invoices/    (Sync, Sync Payment, Sync Attachment, Zoho PDF)
├── Debit Notes/          (Sync, Attachment Status)
└── Dev Tools/            (items, vendors, purchase-orders, vendor-credits, bills, payments)
```

### 10.3 Test snippet

```javascript
pm.test("status is true", () => pm.expect(pm.response.json().status).to.eql(true));
```

---

## 11. Appendix (verified internals)

### 11.1 Environment variables (actual names)

```env
# Zoho Books (accounting sync)
ZOHO_BOOKS_CLIENT_ID=1000.xxxx        # falls back to ZOHO_CLIENT_ID if unset
ZOHO_BOOKS_CLIENT_SECRET=yyyy
ZOHO_BOOKS_REFRESH_TOKEN=zzzz          # SEPARATE from Zoho Sign (different scopes)
ZOHO_BOOKS_ORG_ID=123456789            # NOTE: ORG_ID, not ORGANIZATION_ID
ZOHO_BOOKS_BASE_URL=https://www.zohoapis.in/books/v3
ZOHO_BOOKS_ACCOUNTS_URL=https://accounts.zoho.in

# Zoho Sign (e-signature) — different product
ZOHO_CLIENT_ID=1000.aaaa
ZOHO_CLIENT_SECRET=bbbb
ZOHO_REFRESH_TOKEN=cccc
ZOHO_BASE_URL=https://sign.zoho.in
```

### 11.2 Queue jobs that actually exist

| Job | Purpose |
|---|---|
| `AttachPoDocumentToZoho` | Attach the rendered PO PDF to the Zoho PO + Bill |
| `AttachSpiDocumentToZoho` | Attach the SPI's uploaded document to the PO/Bill |
| `AttachDebitNoteDocumentToZoho` | Attach the debit-note document to the vendor credit |

> The PO-PDF attach runs on the queue (needs `php artisan queue:listen`); the SPI document
> attach also runs **inline (best-effort)** from the sync/payment paths and from the manual
> "Sync Attachment" button, so it lands even without a queue worker.

### 11.3 Reliability mechanisms (verified, not invented)

- **Idempotency ledger** — `po_payments` / `spi_payments` store `zoho_payment_id` +
  `zoho_applied_amount`; re-syncing only posts the un-applied remainder.
- **Advisory locks** — `Cache::lock('zoho:sync:po:{id}')`, `zoho:syncpay:po:{id}`,
  `po:payment:{id}` serialize concurrent syncs/payments (a second attempt gets 409).
- **All-or-nothing rollback** — a failed PO sync deletes everything it created in Zoho
  (payments → bill → PO) via `reversePoSync(...)`, then records `zoho_error`.
- **Self-healing tax cache** — `resolveTaxId` rebuilds + re-checks the tax map on a miss.
- **Logs** — failures are written to `storage/logs/laravel-YYYY-MM-DD.log` (search for
  `Zoho …`). There are no custom `zoho`/`zoho-errors` log channels.

---

## 12. Quick Reference Card

| Action | Endpoint | Method |
|---|---|---|
| Sync PO (PO + Bill) | `/api/p2p/purchase-orders/{id}/sync` | POST |
| Sync PO payment(s) | `/api/p2p/purchase-orders/{id}/sync-payment` | POST |
| PO Zoho PDF | `/api/p2p/purchase-orders/{id}/zoho-pdf` | GET |
| PO attachment status | `/api/p2p/purchase-orders/{id}/attachment-status` | GET |
| Sync SPI (Bill) | `/api/p2p/supplier-purchase-invoices/{id}/sync` | POST |
| Sync SPI payment(s) | `/api/p2p/supplier-purchase-invoices/{id}/sync-payment` | POST |
| Sync SPI document | `/api/p2p/supplier-purchase-invoices/{id}/sync-attachment` | POST |
| Sync Debit Note | `/api/p2p/debit-notes/{id}/sync` | POST |
| Inspect stored Zoho data | `/api/dev-tools/zoho/{type}` | GET |

*Note: `sync-payment` takes an optional `{ "payment_id" }`; omit it to post all cleared
payments. `sync-attachment` takes no body — it pushes the already-uploaded document.*
