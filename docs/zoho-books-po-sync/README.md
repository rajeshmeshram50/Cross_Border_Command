# Purchase Order → Zoho Books Sync — Complete Reference

Everything needed to understand, run, and test the "Sync with Zohobook" feature —
from generating the Zoho token to the exact API payloads that move a Purchase
Order into Zoho Books.

> Org used: **Inorbvict Agrotech Pvt Ltd** · `organization_id = 60077655856` · data centre **`.in`** (India).

---

## What this folder contains

| File | What's in it |
|---|---|
| [`01-token-generation.md`](01-token-generation.md) | Zoho OAuth — Self Client → grant code → **refresh token**, every command, scopes, `.env` keys |
| [`02-app-po-apis.md`](02-app-po-apis.md) | Every **app** PO endpoint (`/api/p2p/purchase-orders/*`) with request payloads + responses + the tax math |
| [`03-zoho-books-apis.md`](03-zoho-books-apis.md) | Every **Zoho Books** API call the sync makes — real payloads & responses |
| [`04-sync-flow-and-rules.md`](04-sync-flow-and-rules.md) | End-to-end sync sequence, field mapping, GST rules, edit-lock, error handling |
| [`zoho-books-po-sync.postman_collection.json`](zoho-books-po-sync.postman_collection.json) | Import into Postman — all requests, ready to run |

---

## Architecture (one glance)

```
React SPA  ──POST /api/p2p/purchase-orders/{id}/sync──►  Laravel
                                                          │
                              PurchaseOrderController::sync()
                                                          │
                                              App\Services\ZohoBooksService
                                                          │
              ┌───────────────────────────────────────────┴───────────────┐
              │  OAuth refresh → access token (cached 55 min)              │
              │  find/create vendor (contact)                              │
              │  find/create each product (item)                           │
              │  resolve GST%→tax_id (intra GST vs inter IGST)             │
              │  POST /purchaseorders                                       │
              │  GET  /purchaseorders/{id}?accept=pdf   (cache PDF)        │
              └───────────────────────────────────────────────────────────┘
                                     │
                            Zoho Books org 60077655856
```

## Code in the repo (not in this folder)

| Concern | File |
|---|---|
| Zoho Books API client | `app/Services/ZohoBooksService.php` |
| Sync endpoint + payload builder | `app/Http/Controllers/Api/PurchaseOrderController.php` (`sync()`, `buildZohoPayload()`) |
| Config block | `config/services.php` → `zoho_books` |
| Credentials | `.env` → `ZOHO_BOOKS_*` |
| DB columns | migration `..._add_zoho_ref_to_purchase_orders` (`purchase_orders.zoho_*`, `vendors.zoho_contact_id`) |
| Routes | `routes/api.php` (`/p2p/purchase-orders/*`) |
| Frontend | `resources/js/pages/p2p/procurement-management/purchase-order/PurchaseOrder.tsx` |

## `.env` keys (summary — full detail in 01)

```env
ZOHO_BOOKS_CLIENT_ID=1000.xxxxxxxx
ZOHO_BOOKS_CLIENT_SECRET=xxxxxxxx
ZOHO_BOOKS_REFRESH_TOKEN=1000.xxxxxxxx
ZOHO_BOOKS_ORG_ID=60077655856
ZOHO_BOOKS_BASE_URL=https://www.zohoapis.in/books/v3
ZOHO_BOOKS_ACCOUNTS_URL=https://accounts.zoho.in
```

After editing `.env`: `php artisan config:clear`.

## The 60-second mental model

1. A PO is created in the app (`PO/FY/NNN`) with line items, GST, charges.
2. Clicking **Zoho Sync** posts to `/sync`.
3. The service resolves the vendor + products + tax into Zoho ids, builds a PO
   payload, and creates it in Zoho Books.
4. The Zoho PO id is stored so the PO is **locked** (no re-sync, no edit).
5. If the vendor has a **GSTIN** → tax flows (totals match). If not → Zoho records
   it pre-tax (GST law: no forward tax from unregistered vendors).
