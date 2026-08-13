# Zoho Books Integration — API Documentation

> Every internal endpoint that drives the sync, with request/response examples, plus the
> Zoho Books endpoints they call behind the scenes. Written to be usable by someone who has
> never touched this codebase.

## Document Control

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-30 | System | Initial Zoho Books API reference |
| 2.0 | 2026-07-30 | System | Expanded, fresher-friendly edition |

---

## 0. How to read this document

There are **two layers** of API here:

1. **Internal API** — endpoints in *our* app that the frontend calls (e.g. "sync this PO").
   These are what you'll hit from Postman or the browser.
2. **Zoho Books API** — the endpoints *our server* calls on your behalf. You never call
   these directly; they're documented so you understand what a "sync" really does.

**Common conventions for the internal API:**
- All routes live in `routes/api.php` and the real URL is prefixed with `/api`.
- They sit behind `auth:sanctum` + `user.active`, so every request needs a header
  `Authorization: Bearer <sanctum-token>`.
- Requests are scoped to the logged-in user's `client_id` / `branch_id` automatically.
- Response shape: `{ "status": true|false, "message"?: string, "data"?: ... }`.
- Success is HTTP 200; validation/precondition failures are usually **422**; a concurrent
  sync is **409**; Zoho-not-configured is **503**.

---

## 1. Purchase Order endpoints

| Method | Path | Controller | What it does |
|---|---|---|---|
| POST | `/api/p2p/purchase-orders/{id}/sync` | `PurchaseOrderController@sync` | Create the Zoho PO + Bill (bill only, no payments forced) |
| POST | `/api/p2p/purchase-orders/{id}/sync-payment` | `@syncPayment` | Post vendor payment(s) to the bill. Body `{ "payment_id"? }` — omit to sync **all** cleared payments |
| GET | `/api/p2p/purchase-orders/{id}/zoho-pdf` | `@zohoPdf` | Zoho-rendered PO/Bill PDF |
| GET | `/api/p2p/purchase-orders/{id}/attachment-status` | `@attachmentStatus` | Poll the attach job: `queued \| done \| failed` |
| POST | `/api/p2p/purchase-orders/{id}/send-for-signature` | `@sendForSignature` | (Zoho **Sign**, not Books) send the PO PDF for e-signature |

## 2. Supplier Purchase Invoice endpoints

| Method | Path | Controller | What it does |
|---|---|---|---|
| POST | `/api/p2p/supplier-purchase-invoices/{id}/sync` | `SupplierPurchaseInvoiceController@sync` | Create a Bill (a With-PO invoice delegates to the PO sync) |
| POST | `/api/p2p/supplier-purchase-invoices/{id}/sync-payment` | `@syncPayment` | Post payment(s). Body `{ "payment_id"? }` |
| POST | `/api/p2p/supplier-purchase-invoices/{id}/sync-attachment` | `@syncAttachment` | Push the invoice's uploaded document to the Zoho PO/Bill |
| GET | `/api/p2p/supplier-purchase-invoices/{id}/zoho-pdf` | `@zohoPdf` | Zoho bill PDF |

## 3. Debit Note (Vendor Credit) endpoints

| Method | Path | Controller |
|---|---|---|
| POST | `/api/p2p/debit-notes/{id}/sync` | `DebitNoteController@sync` |
| GET | `/api/p2p/debit-notes/{id}/attachment-status` | `@attachmentStatus` |

## 4. Dev Tools inspector (admin / permission-gated)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/dev-tools/zoho/{type}` | `type` ∈ `items \| vendors \| purchase-orders \| vendor-credits \| bills \| payments`. Returns what we have stored per Zoho entity (ids, PDF links, sync state). |

---

## 5. Worked example — sync a PO, then its payments

**Step 1 — create the bill:**
```http
POST /api/p2p/purchase-orders/42/sync
Authorization: Bearer <sanctum-token>
```
Success:
```json
{
  "status": true,
  "message": "Synced to Zoho Books — PO + bill BILL-000123, posted ₹1,00,000.00 payment(s).",
  "data": { "id": 42, "zoho": "Sync", "bill_number": "BILL-000123" }
}
```

**Step 2 — post one specific payment:**
```http
POST /api/p2p/purchase-orders/42/sync-payment
Authorization: Bearer <sanctum-token>
Content-Type: application/json

{ "payment_id": 7 }
```
> Omit `payment_id` entirely to post **all** cleared payments in one go ("Sync All Payments").

Success:
```json
{ "status": true, "message": "Posted ₹50,000.00 for this entry to bill BILL-000123." }
```

---

## 6. Typical failure responses (and the HTTP code)

```json
// 422 — you tried to pay before the bill exists
{ "status": false, "message": "Sync this PO to Zoho Books first — its bill must exist before you can post payments against it." }

// 422 — no payment recorded yet
{ "status": false, "message": "Record at least one payment before syncing to Zoho Books — the first payment is posted against the bill on sync." }

// 422 — Zoho is missing the tax rate (self-heals on retry after you add it in Zoho)
{ "status": false, "message": "18% tax not found in Zoho Books — add it and try again." }

// 422 — no bank/cash account in the Zoho org
{ "status": false, "message": "Add a Bank / Cash account in Zoho Books before syncing payments — they cannot be posted without one." }

// 409 — someone/another tab is already syncing this PO
{ "status": false, "message": "A Zoho sync for this purchase order is already in progress — try again in a moment." }

// 503 — Zoho keys not set on the server
{ "status": false, "message": "Zoho Books is not connected yet. Add the Zoho Books credentials to the server .env, then try again." }
```

---

## 7. The Zoho Books API endpoints our server calls

You do **not** call these — `ZohoBooksService` does. Base host:
`https://www.zohoapis.in/books/v3`, and every call carries `?organization_id=<org>`.

| Our operation | Zoho Books endpoint |
|---|---|
| Create / delete Purchase Order | `POST /purchaseorders`, `DELETE /purchaseorders/{id}` |
| Mark PO "open" | `POST /purchaseorders/{id}/status/open` |
| Create / delete / get Bill | `POST /bills`, `DELETE /bills/{id}`, `GET /bills/{id}` |
| Record / delete Vendor Payment | `POST /vendorpayments`, `DELETE /vendorpayments/{id}` |
| Create / apply / get Vendor Credit | `POST /vendorcredits`, `POST /vendorcredits/{id}/bills`, `GET /vendorcredits/{id}` |
| Find/create Contact (vendor/customer) | `GET /contacts`, `POST /contacts` |
| Find/create Item (product) | `GET /items`, `POST /items` |
| Taxes / currencies / accounts / org | `GET /settings/taxes`, `/settings/currencies`, `/chartofaccounts`, `/organizations` |
| Attach a file (append) | `POST /purchaseorders/{id}/attachment`, `/bills/{id}/attachment`, `/vendorcredits/{id}/attachment` |
| Get PDFs | `GET /purchaseorders/{id}?accept=pdf`, `/bills/{id}?accept=pdf`, `/vendorcredits/{id}?accept=pdf` |

---

## 8. How our server authenticates to Zoho (behind the scenes)

```http
POST {accounts_url}/oauth/v2/token
  ?refresh_token=<ZOHO_BOOKS_REFRESH_TOKEN>
  &client_id=<...>&client_secret=<...>
  &grant_type=refresh_token
→ { "access_token": "1000.xxxx", "expires_in": 3600, ... }
```
That access token is then sent on every Books call as
`Authorization: Zoho-oauthtoken 1000.xxxx`. A 401 triggers exactly **one** automatic
refresh + retry, so token expiry never surfaces to the user.

---

## 9. Quick Postman checklist

1. Log in to get a Sanctum token; set `Authorization: Bearer <token>` on every request.
2. Make sure the target PO/SPI has a supplier, ≥1 product, TDS cut (domestic), and ≥1
   payment before calling `/sync`.
3. Call `/sync`, then `/sync-payment`.
4. Use `GET /dev-tools/zoho/purchase-orders` (as an admin) to confirm the Zoho ids landed.
