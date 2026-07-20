# Zoho Books Integration — API & Flow Sheet

> Every place Cross_Border_Command pushes a record into **Zoho Books**, with the
> end-to-end flow, prerequisites, request/curl, and the error matrix.
> Companion Postman file: **`docs/ZOHO_BOOKS_API.postman_collection.json`**.

---

## 0. Setup

| What | Value |
|---|---|
| Local base URL | `http://127.0.0.1:8000` |
| Prod base URL | `https://cbc.idims.in` |
| Auth | Sanctum bearer — `Authorization: Bearer <token>` from `POST /api/login` |
| Zoho org | `60077655856` (Inorbvict Agrotech, books.zoho.in / India DC) |
| Server creds (.env) | `ZOHO_BOOKS_ORG_ID`, `ZOHO_BOOKS_REFRESH_TOKEN` (scope `ZohoBooks.fullaccess.all`); `ZOHO_BOOKS_CLIENT_ID/_SECRET` fall back to the Zoho Sign app |

If the server has no Zoho Books creds, **every sync returns `503`** with a clean "not connected" message. Nothing else is affected.

Get a token:
```bash
curl -s -X POST http://127.0.0.1:8000/api/login \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"email":"igcceo@mailinator.com","password":"Secret@123"}'
# → { "token": "…", "user": {…} }   ← use as Bearer for everything below
```

---

## 1. What maps to what (the whole cycle → Zoho Books)

| App record | Zoho Books object | Endpoint | Reduces / increases |
|---|---|---|---|
| Purchase Order | **Purchase Order** | `POST /p2p/purchase-orders/{id}/sync` | — |
| PO / Direct-SPI payment | **Vendor Payment** (applied to the bill) | (posted during SPI sync) | pays the bill |
| Supplier Purchase Invoice | **Bill** | `POST /p2p/supplier-purchase-invoices/{id}/sync` | ↑ payable |
| Debit Note | **Vendor Credit** (applied to the bill) | `POST /p2p/debit-notes/{id}/sync` | ↓ payable |
| Quotation | **Estimate** | `POST /sales/quotations/{id}/sync` | — |
| Proforma Invoice | **Invoice** | `POST /sales/proforma-invoices/{id}/sync` | ↑ receivable |
| Supplier / Customer | **Contact** (vendor / customer) | created on first sync, **deduped** | — |
| Product | **Item** | created on first use, **deduped** | — |

Every synced document also caches Zoho's own rendered PDF, streamed by the matching `GET …/zoho-pdf`.

---

## 2. Shared guarantees (all 5 document flows)

- **503** when Zoho Books isn't connected.
- **Atomic lock** — a concurrent double-submit of the same record returns **409** (never two Zoho docs).
- **Idempotent** — once synced, re-calling returns "already synced"; a second Zoho doc is never created.
- **No duplicate contacts/items** — supplier, customer and product Zoho ids are cached on the local rows (`vendors.zoho_contact_id`, `customers.zoho_contact_id`, `products.zoho_item_id`) and reused.
- **Edit / delete locked after sync** — updating or deleting a synced record returns **422** (the Zoho doc is the source of truth).
- **Auth** — no token → **401**; a user from another branch/tenant → **404**.
- **Errors are surfaced verbatim** — a Zoho rejection returns **422** with Zoho's message; the record is marked `Not Sync` and the error stored in `zoho_error`.

---

## 3. Purchases (P2P)

### 3a. Purchase Order → Zoho Purchase Order
**Flow:** cut TDS once → record payments until the PO balance is cleared → **sync**.
(e-signature is **not** required — that guard was removed 2026-07-17. The PO must still be fully paid.)

```bash
# 1) cut TDS once (base = Total PO − GST)
curl -s -X POST $B/api/p2p/purchase-orders/6/payment-summary/tds \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"tds_percentage":2}'

# 2) record payment(s) until balance = 0  (multipart, optional proof)
curl -s -X POST $B/api/p2p/purchase-orders/6/payments \
  -H "Authorization: Bearer $T" \
  -F amount=396169.67 -F bank_name=HDFC -F utr_cheque_number=UTR-1 -F status=Cleared

# 3) sync → Zoho Purchase Order
curl -s -X POST $B/api/p2p/purchase-orders/6/sync -H "Authorization: Bearer $T" -H 'Accept: application/json'
# → { "status": true, "message": "Synced to Zoho Books (PO-000xx)." }

# 4) view Zoho's PDF
curl -s $B/api/p2p/purchase-orders/6/zoho-pdf -H "Authorization: Bearer $T" -o zoho-po.pdf
```

### 3b. Supplier Purchase Invoice → Zoho Bill (+ vendor payments)
**Flow:** fully utilise the payable — a **With-PO SPI** pays through its linked PO (folder 3a); a **Direct SPI** cuts its own TDS + pays itself — then **sync**. Sync creates the Bill, posts each recorded payment as a Zoho **vendor payment** (matched to the bank ledger, capped at the bill balance), and caches the PDF.

```bash
# Direct SPI only: TDS + payment
curl -s -X POST $B/api/p2p/supplier-purchase-invoices/1/payment-summary/tds \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"tds_percentage":5}'
curl -s -X POST $B/api/p2p/supplier-purchase-invoices/1/payments \
  -H "Authorization: Bearer $T" -F amount=11800 -F bank_name=SBI -F status=Cleared

# sync → Zoho Bill + vendor payments
curl -s -X POST $B/api/p2p/supplier-purchase-invoices/1/sync -H "Authorization: Bearer $T"
# → "Synced to Zoho Books as bill BILL-000xx. ₹… TDS remains as an open balance in Zoho…"
```
- **Re-sync tops up** any payment that failed to post the first time (no duplicate bill).
- **TDS residual** stays as an open balance on the Zoho bill (TDS is withheld, not paid) — by design.
- An **unregistered vendor** bill is pre-tax (Zoho drops forward GST); the applied payment caps at the smaller bill balance — expected/logged.

### 3c. Debit Note → Zoho Vendor Credit (+ apply to bill)
A debit note **reduces** the payable → a Zoho **Vendor Credit** (not a bill). **The linked SPI must already be synced as a bill** (its `bill_id` is sent at creation — this org enforces "associate with a bill"). Sync creates the credit and applies it to that bill.

```bash
curl -s -X POST $B/api/p2p/debit-notes/1/sync -H "Authorization: Bearer $T"
# → "Synced to Zoho Books as vendor credit VC-000xx. ₹… applied to the linked bill."
```
- **Re-sync retries the apply** if it didn't land the first time.
- Any amount **recovered as cash locally** is *not* applied to the bill (avoids double-counting) — record it as a refund in Zoho if needed.

---

## 4. Sales

### 4a. Quotation → Zoho Estimate  ·  4b. Proforma Invoice → Zoho Invoice
No prerequisites beyond a customer + at least one line item.

```bash
curl -s -X POST $B/api/sales/quotations/13/sync        -H "Authorization: Bearer $T"   # → Estimate
curl -s -X POST $B/api/sales/proforma-invoices/10/sync -H "Authorization: Bearer $T"   # → Invoice
```
- **Zoho auto-numbers** estimates/invoices; our `QT/…` / `INV/…` code rides on `reference_number` (we don't send the number).
- **Forward GST always applies on a sale.** Inter-state **IGST only for a GST-registered customer** — Zoho forces intra-state (CGST+SGST) for unregistered customers; `place_of_supply` is set only for registered ones.

---

## 5. Full endpoint list

| # | Method | Path | Controller@method | Body |
|---|---|---|---|---|
| 1 | POST | `/api/p2p/purchase-orders/{id}/sync` | `PurchaseOrderController@sync` | — |
| 2 | GET | `/api/p2p/purchase-orders/{id}/zoho-pdf` | `@zohoPdf` | — |
| 3 | GET | `/api/p2p/purchase-orders/{po}/payment-summary` | `PoPaymentController@summary` | — |
| 4 | POST | `/api/p2p/purchase-orders/{po}/payment-summary/tds` | `@saveTds` | `{tds_percentage}` |
| 5 | POST | `/api/p2p/purchase-orders/{po}/payments` | `@store` | multipart |
| 6 | DELETE | `/api/p2p/purchase-orders/{po}/payments/{payment}` | `@destroy` | — |
| 7 | POST | `/api/p2p/supplier-purchase-invoices/{id}/sync` | `SupplierPurchaseInvoiceController@sync` | — |
| 8 | GET | `/api/p2p/supplier-purchase-invoices/{id}/zoho-pdf` | `@zohoPdf` | — |
| 9 | GET | `/api/p2p/supplier-purchase-invoices/{spi}/payment-summary` | `SpiPaymentController@summary` | — |
| 10 | POST | `/api/p2p/supplier-purchase-invoices/{spi}/payment-summary/tds` | `@saveTds` | `{tds_percentage}` |
| 11 | POST | `/api/p2p/supplier-purchase-invoices/{spi}/payments` | `@store` | multipart |
| 12 | DELETE | `/api/p2p/supplier-purchase-invoices/{spi}/payments/{payment}` | `@destroy` | — |
| 13 | POST | `/api/p2p/debit-notes/{id}/sync` | `DebitNoteController@sync` | — |
| 14 | GET | `/api/p2p/debit-notes/{id}/zoho-pdf` | `@zohoPdf` | — |
| 15 | GET | `/api/p2p/debit-notes/{dn}/payment-summary` | `DebitNotePaymentController@summary` | — |
| 16 | POST | `/api/p2p/debit-notes/{dn}/payments` | `@store` | multipart |
| 17 | DELETE | `/api/p2p/debit-notes/{dn}/payments/{payment}` | `@destroy` | — |
| 18 | POST | `/api/sales/quotations/{id}/sync` | `QuotationController@sync` | — |
| 19 | GET | `/api/sales/quotations/{id}/zoho-pdf` | `@zohoPdf` | — |
| 20 | POST | `/api/sales/proforma-invoices/{id}/sync` | `ProformaInvoiceController@sync` | — |
| 21 | GET | `/api/sales/proforma-invoices/{id}/zoho-pdf` | `@zohoPdf` | — |

---

## 6. Error matrix (every sync)

| HTTP | When | Message (example) |
|---|---|---|
| 200 | Success (or already synced) | `Synced to Zoho Books as …` |
| 401 | No / invalid token | (Unauthenticated) |
| 404 | Cross-tenant / cross-branch record | (Not found) |
| 409 | Concurrent sync of the same record | `A Zoho sync … is already in progress …` |
| 422 | No vendor/customer, no items | `Attach a supplier/customer …` / `Add at least one product line …` |
| 422 | PO/SPI not fully paid | `Utilise the full amount first …` |
| 422 | Debit note's linked SPI not yet synced | `Sync the linked supplier invoice (SPI) to Zoho Books first …` |
| 422 | Edit/delete after sync | `… synced to Zoho Books … can no longer be edited …` |
| 422 | Zoho rejected the call | Zoho's own message (e.g. `No 12% GST tax configured …`) |
| 503 | Zoho Books not connected | `Zoho Books is not connected yet. Add the Zoho Books credentials …` |

---

## 7. Config notes (data, not code)

- **GST home state.** Intra vs inter-state tax uses the Zoho org's GSTIN, falling back to the branch `gst_state_code`, then Maharashtra (27). A non-Maharashtra tenant should set the branch's GST state code for the correct tax *type*.
- **Tax slabs in Zoho.** The org must have GST enabled (Settings → Taxes) so `GST5/12/18/28` + IGST exist, else a registered-vendor/customer sync fails with `No X% GST tax configured`.

*Generated 2026-07-17. Sync surface = exactly 3 P2P + 2 Sales controllers; 21 endpoints.*
