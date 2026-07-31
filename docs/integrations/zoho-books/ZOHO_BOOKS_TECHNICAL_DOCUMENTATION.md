# Zoho Books Integration — Technical Documentation

> Architecture, configuration, security, data model, idempotency and failure handling —
> written so a new engineer can understand the whole picture and safely make changes.
> **Every fact here is verified against the actual source; illustrative code is labelled.**

## Document Control

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-30 | System | Initial Zoho Books technical reference |
| 2.0 | 2026-07-30 | System | Expanded, fresher-friendly edition |
| 3.0 | 2026-07-30 | System | Complete, sectioned, code-verified edition |

---

## Table of Contents

1. The Big Picture
2. Why a Service Class?
3. Configuration
4. Authentication — OAuth Flow
5. The Service Surface
6. Tax Resolution & Self-Healing Cache
7. Idempotency & Concurrency
8. All-or-Nothing Failure Handling
9. Data Model
10. Async Jobs
11. Security & Multi-Tenancy
12. Ownership & Change Policy
13. Logging & Troubleshooting
14. Development Guidelines

---

## 1. The Big Picture

```
 ┌──────────────────────── Cross_Border_Command (Laravel API) ────────────────────────┐
 │  CONTROLLER LAYER                                                                   │
 │   PurchaseOrderController          — sync, syncPayment, zohoPdf, attachmentStatus,  │
 │   SupplierPurchaseInvoiceController — sync, syncPayment, syncAttachment, zohoPdf    │
 │   PoPaymentController / SpiPaymentController — payment summary + TDS                │
 │   DebitNoteController — sync                                                        │
 │            │                                                                        │
 │            ▼                                                                        │
 │  SERVICE LAYER                                                                      │
 │   ZohoBooksService  — the ONLY class that talks to Zoho Books                       │
 │     (OAuth token, HTTP + one 401-retry, find-or-create, documents, attachments)     │
 │            │                                                                        │
 │            ▼                                                                        │
 │  ASYNC JOBS                                                                         │
 │   AttachPoDocumentToZoho   — PO PDF → Zoho PO + Bill                                │
 │   AttachSpiDocumentToZoho  — SPI file → Zoho PO/Bill                                │
 │   AttachDebitNoteDocumentToZoho — DN doc → Vendor Credit                            │
 │            │                                                                        │
 │            ▼                                                                        │
 │  DATABASE  purchase_orders · supplier_purchase_invoices · po_payments · spi_payments │
 └──────────────────────────────────────────┼─────────────────────────────────────────┘
                                             │  HTTPS + OAuth
                                             ▼
                              Zoho Books API — https://www.zohoapis.in/books/v3
                              (Purchase Orders, Bills, Vendor Payments, Vendor Credits,
                               Contacts, Items, Attachments, PDFs)
```

### 1.1 The golden rule
`app/Services/ZohoBooksService.php` is the **only** place that makes HTTP calls to Zoho
Books. Controllers never call Zoho directly — they build data ("payloads") and ask the
service to do the network work. All the tricky auth/retry/error logic lives in one file.

### 1.2 Key design principles

| Principle | How it shows up |
|---|---|
| Single Responsibility | one service class owns all Zoho communication |
| Idempotency | re-running a sync/payment never duplicates |
| All-or-Nothing | a failed sync deletes everything it created in Zoho |
| Self-Healing | the tax cache rebuilds on a miss |
| Tenant Isolation | every request scoped to the user's client/branch |

---

## 2. Why a Service Class?

If every controller called Zoho directly, we'd copy-paste the token, retry and
error-handling logic into a dozen places, and a single Zoho change would mean a dozen
fixes. A **service class** is the single front door: a controller says "create this bill"
and the service handles tokens, headers, retries and parsing. That's the **Single
Responsibility Principle** — and it makes the controllers small, consistent and testable.

---

## 3. Configuration

### 3.1 Environment variables (actual names)

```env
# Zoho Books (accounting sync)
ZOHO_BOOKS_CLIENT_ID=1000.xxxx        # falls back to ZOHO_CLIENT_ID if unset
ZOHO_BOOKS_CLIENT_SECRET=yyyy
ZOHO_BOOKS_REFRESH_TOKEN=zzzz          # SEPARATE token from Zoho Sign (different scopes)
ZOHO_BOOKS_ORG_ID=123456789            # NOTE: ORG_ID, not ORGANIZATION_ID
ZOHO_BOOKS_BASE_URL=https://www.zohoapis.in/books/v3
ZOHO_BOOKS_ACCOUNTS_URL=https://accounts.zoho.in

# Zoho Sign (e-signature) — a DIFFERENT product, different token
ZOHO_CLIENT_ID=1000.aaaa
ZOHO_CLIENT_SECRET=bbbb
ZOHO_REFRESH_TOKEN=cccc
ZOHO_BASE_URL=https://sign.zoho.in
```

### 3.2 `config/services.php` mapping

| Config key (`zoho_books.*`) | Env var |
|---|---|
| `client_id` | `ZOHO_BOOKS_CLIENT_ID` (falls back to `ZOHO_CLIENT_ID`) |
| `client_secret` | `ZOHO_BOOKS_CLIENT_SECRET` |
| `refresh_token` | `ZOHO_BOOKS_REFRESH_TOKEN` |
| `organization_id` | `ZOHO_BOOKS_ORG_ID` |
| `base_url` | `ZOHO_BOOKS_BASE_URL` (default `https://www.zohoapis.in/books/v3`) |
| `accounts_url` | `ZOHO_BOOKS_ACCOUNTS_URL` |

### 3.3 The "is it connected?" gate
`ZohoBooksService::isConfigured()` returns `false` when the essential keys are missing.
Every controller checks it first and, if unconfigured, returns a 503-style response instead
of crashing:
```json
{ "status": false, "message": "Zoho Books is not connected yet. Add the Zoho Books credentials to the server .env, then try again." }
```

### 3.4 The organization id
`organization_id` is sent on **every** call — in the query string, and *also* as a
multipart form field on file uploads (Zoho ignores the query-string org on multipart
requests, so we send it both ways).

---

## 4. Authentication — OAuth Flow

Zoho uses **OAuth 2.0** with the refresh-token grant (server-to-server):

```
 SETUP (one-time, human):  create the OAuth app → get client id/secret → generate a
                           refresh token → store all three in .env

 RUNTIME (each request):   swap the refresh token for a short-lived ACCESS token
                           POST {accounts_url}/oauth/v2/token?grant_type=refresh_token&…
                           → { "access_token": "1000.xxxx", "expires_in": 3600 }

 EVERY CALL:               Authorization: Zoho-oauthtoken 1000.xxxx
```

**Verified specifics:**
- The access token is cached under the key `zoho_books_access_token` with a TTL derived from
  `expires_in`, so we don't refresh on every call.
- A **401** response makes the service `Cache::forget('zoho_books_access_token')`, mint a
  fresh token and retry **once** (`sendWithAuthRetry`). Token expiry is invisible to
  controllers.

> There is **no** custom rate-limiting / exponential-backoff / 429 handling in the service —
> the only automatic retry is the single 401 auth retry above.

---

## 5. The Service Surface

Public methods on `ZohoBooksService` (grouped). "Find-or-create" = look it up in Zoho,
create it if missing, return its id.

**Master data**
- `findOrCreateVendorId(Vendor, gstin?, stateCode?)` — supplier → Zoho contact id
- `findOrCreateItemId(name, rate, taxId?, productId?, gstPct?)` — product → Zoho item id
- `findOrCreateCustomerId(...)`, `resolveCurrencyId(code)`, `resolveTaxId(rate, interState)`,
  `resolvePaidThroughAccountId(bankName?)`, `orgStateCode()`, `placeOfSupply(numeric)`

**Documents**
- `createPurchaseOrder(payload)` / `deletePurchaseOrder(id)` / `markPurchaseOrderOpen(id)`
- `createBill(payload)` / `deleteBill(id)` / `getBill(id)`
- `recordVendorPayment(payload)` / `deleteVendorPayment(id)`
- `createVendorCredit(payload)` / `applyVendorCreditToBills(id, bills)` / `getVendorCredit(id)`

**PDFs & attachments**
- `getPurchaseOrderPdf(id)`, `getBillPdf(id)`, `getVendorCreditPdf(id)`
- `attachToPurchaseOrder(id, bytes, name)`, `attachToBill(id, bytes, name)`,
  `attachToVendorCredit(id, bytes, name)` — these **append** files (Zoho keeps every upload).

> The `delete*` methods exist so a half-finished sync can be **rolled back** (see §8). The
> exact payload arrays are composed inside the controllers/service; they carry the vendor,
> the line items (with the resolved tax id), the TDS amount + percentage, and the PO link for
> a bill. (This doc intentionally doesn't reproduce the exact payload keys — read the service
> for the authoritative shape.)

---

## 6. Tax Resolution & Self-Healing Cache

Zoho identifies each tax rate by an **id**, not a percentage, so `resolveTaxId(rate,
interState)` maps our `18%` to Zoho's tax id. The tax list is cached to avoid asking Zoho
every call.

**The problem:** if finance adds a new rate in Zoho, a stale cache would wrongly say
"18% tax not found" until it expires.

**The self-heal:** on a cache **miss**, the service force-forgets the cache, rebuilds it
fresh from Zoho, and re-checks *before* throwing `"<rate>% tax not found…"`. So adding the
tax in Zoho and hitting retry works immediately — no wait.

**GST rules encoded here:**
- Forward tax (CGST/SGST or IGST) is attached **only for a GST-registered supplier**; an
  unregistered vendor's bill is sent pre-tax (reverse-charge), else Zoho rejects it.
- **Intra-state** (supplier in our home state) → CGST + SGST (half each).
- **Inter-state** (different state) → a single IGST at the full rate.

---

## 7. Idempotency & Concurrency

**Idempotency** = doing it twice has the same effect as once. Users double-click; networks
retry. We must never create two bills or double-post a payment.

- **Payment ledger** — each `po_payment` / `spi_payment` stores `zoho_payment_id` and
  `zoho_applied_amount`. When posting, we push only the **un-applied remainder**
  (`amount − zoho_applied_amount`), so a re-sync posts nothing once fully applied.
- **Advisory locks** (verified keys) — `Cache::lock('zoho:sync:po:{id}')`,
  `zoho:syncpay:po:{id}`, `po:payment:{id}`. A second concurrent attempt can't get the lock
  and gets a clean **409** ("already in progress") instead of racing.
- **Attachment stamps** — `zoho_doc_attached_at` (SPI) and `zoho_attachment_status` (PO)
  stop the same file being appended twice.

---

## 8. All-or-Nothing Failure Handling

Creating a PO in Zoho is several calls (vendor → PO → bill → payments). If a later call
fails, we must not leave earlier ones as orphans that collide on the next attempt.

`PurchaseOrderController::sync` tracks what it creates in a run (`$createdPoId`,
`$createdBillId`, `$createdPayments`). On **any** exception it calls `reversePoSync(...)`
which deletes them in reverse order (payments → bill → PO), then records `zoho_error` and
sets `zoho_status = 'Not Sync'`. Net effect: a failed sync leaves Zoho exactly as before.

**Best-effort steps run *outside* the all-or-nothing block** and swallow their own errors so
they can never roll the bill back:
- posting already-recorded payments after the bill commits,
- caching Zoho's rendered PDF,
- dispatching the document-attachment jobs.

The local state write **and** the queued attachment job are committed in the **same
`DB::transaction`**, so a rolled-back state write also rolls back the queued job — they can
never drift apart.

---

## 9. Data Model — the Zoho columns we stamp

> Verified against the migrations. `zoho_status` is a plain `string(16)` defaulting to
> `'Not Sync'`; its only values are **`Sync`** and **`Not Sync`** (it is *not* an enum with
> Pending/Failed). `zoho_attachment_status` is a nullable `string(20)` holding
> `queued`/`done`/`failed`.

| Table | Zoho columns |
|---|---|
| `purchase_orders` | `zoho_status`, `zoho_purchaseorder_id`, `zoho_bill_id`, `zoho_bill_number`, `zoho_synced_at`, `zoho_error`, `zoho_pdf_path`, `zoho_attachment_status` |
| `supplier_purchase_invoices` | `zoho_status`, `zoho_bill_id`, `zoho_bill_number`, `zoho_synced_at`, `zoho_error`, `zoho_pdf_path`, `zoho_doc_attached_at` |
| `po_payments` / `spi_payments` | `zoho_payment_id`, `zoho_applied_amount` |
| debit notes | `zoho_vendorcredit_id`, `zoho_credit_number` |

These columns drive the UI ("Sync" vs "Not Sync"), tell us which bill a row maps to, and
whether the attachment landed.

---

## 10. Async Jobs

Rendering a PO PDF (long T&C) is slow, so it runs on a **queued job** and the sync returns
fast. The jobs are dispatched to the **default** queue (there is no dedicated `zoho` queue).

### 10.1 `AttachPoDocumentToZoho`
Renders the PO PDF (cached), attaches it to the Zoho PO + Bill, and tracks attempted vs
succeeded:

| PO attached | Bill attached | Result |
|---|---|---|
| ✅ | ✅ | `zoho_attachment_status = 'done'` |
| ✅ | ❌ (or ❌ / ✅) | `'failed'` — flagged for a manual re-attach, **not** retried (would duplicate) |
| ❌ | ❌ | throws → the queue retries the whole job |

### 10.2 `AttachSpiDocumentToZoho`
Attaches the SPI's uploaded document to the PO (With-PO) or its own bill (Direct):
1. Bail if there's no `attachment_path` or `zoho_doc_attached_at` is already set (idempotent).
2. Normalize the stored path (`/storage/spi/…` → disk-relative `spi/…`) and read the bytes
   off the `public` disk (local on dev, Azure Blob on prod — same abstraction).
3. Build the filename `<SPI number>-<invoice number>.<ext>`, sanitized to `[A-Za-z0-9_-]`
   (spaces/backticks make Zoho reject the upload: "Invalid value passed for attachment").
4. Attach to the primary target, stamp `zoho_doc_attached_at`, then best-effort to the bill.

### 10.3 Queue vs inline
The PO-PDF attach runs on the queue (needs `php artisan queue:listen`). The SPI document
attach also runs **inline (best-effort)** from the sync/payment paths and from the manual
"Sync Attachment" button, so it lands even without a queue worker.

---

## 11. Security & Multi-Tenancy

- Every internal route is behind `auth:sanctum` + `user.active`.
- Controllers resolve the record through a tenant-scoped guard (`assertScope` / `forUser`
  off the authenticated user's `client_id` / `branch_id`) — tenant ids are **never** taken
  from the request body, so one tenant can't touch another's records.
- Secrets live only in `.env`; the config file just reads env vars; nothing sensitive is
  logged.
- The **Dev Tools** inspector is admin/permission-gated and tenant-scoped.

---

## 12. Ownership & Change Policy

```
 ┌───────────────────────────────────────────────────────────────┐
 │  SENIOR-OWNED: app/Services/ZohoBooksService.php               │
 │  Do NOT modify without explicit per-change authorization.      │
 │  It is the single entry point to the Zoho API — a change here  │
 │  affects ALL sync operations.                                  │
 └───────────────────────────────────────────────────────────────┘
```

| Area | Safe to change? | Notes |
|---|---|---|
| Controllers | ✅ | payload composition, gating, messages |
| Jobs | ✅ | attachment logic, filename sanitization |
| Frontend | ✅ | UI, user feedback |
| `ZohoBooksService` | ❌ | get explicit permission first |

---

## 13. Logging & Troubleshooting

### 13.1 Where logs go
Failures are written to `storage/logs/laravel-YYYY-MM-DD.log` (Laravel's default daily
channel). There are **no** custom `zoho` / `zoho-errors` log channels; grep the daily file.

Useful search terms: `Zoho`, `Zoho attach`, `Invalid value passed for attachment`,
`reversePoSync`.

### 13.2 Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| 503 "not connected" | missing `.env` keys | set the `ZOHO_BOOKS_*` vars |
| 401 loops | bad/expired token | it auto-refreshes once; if persistent, re-check the refresh token; `php artisan cache:clear` |
| 422 "tax not found" | rate missing in Zoho | add it in Zoho, retry (self-heals) |
| 422 "no bank account" | no Bank/Cash account in Zoho | create one |
| 409 "in progress" | concurrent sync | wait, retry |
| "Invalid value passed for attachment" | bad filename chars | fixed by the sanitizer (`[A-Za-z0-9_-]`) |
| auto-attach never lands | no queue worker | run `php artisan queue:listen` (or use the manual "Sync Attachment", which is inline) |

### 13.3 Quick database checks

```sql
SELECT zoho_status, zoho_error FROM purchase_orders WHERE id = 42;
SELECT id, amount, zoho_payment_id, zoho_applied_amount FROM po_payments WHERE purchase_order_id = 42;
```
Or, as an admin: `GET /api/dev-tools/zoho/purchase-orders`.

---

## 14. Development Guidelines

### 14.1 Adding a new sync feature
1. Compose the payload and call the relevant **existing** `ZohoBooksService` method from a
   controller (do **not** add to the service without authorization).
2. Add the route in `routes/api.php` under the `auth:sanctum` + `user.active` group.
3. If the work is slow (PDF render, upload), do it in a **queued job**.
4. If you store new Zoho ids, add the column via a migration and stamp it in the same
   `DB::transaction` as the sync state.
5. Keep the controller idempotent (check stored ids; take an advisory lock).

### 14.2 Testing
Resolve the service from the container and mock it (controllers call
`app(ZohoBooksService::class)`), so tests never hit the real Zoho API. Assert the response
shape and that the row's `zoho_*` columns are stamped.

### 14.3 Security checklist
- [ ] route behind `auth:sanctum` + `user.active`
- [ ] record resolved via tenant scope, not request-body ids
- [ ] attachment filenames sanitized to `[A-Za-z0-9_-]`
- [ ] secrets only in `.env`, nothing sensitive logged
- [ ] admin/dev routes permission-gated

---

## Quick Reference

| File | Purpose |
|---|---|
| `app/Services/ZohoBooksService.php` | all Zoho API calls (**senior-owned**) |
| `app/Http/Controllers/Api/PurchaseOrderController.php` | PO sync / payment sync |
| `app/Http/Controllers/Api/SupplierPurchaseInvoiceController.php` | SPI sync / payment / attachment |
| `app/Http/Controllers/Api/DebitNoteController.php` | vendor credits |
| `app/Jobs/AttachPoDocumentToZoho.php` · `AttachSpiDocumentToZoho.php` | attachment jobs |
| `config/services.php` | Zoho configuration |

```bash
php artisan queue:listen     # required for the queued PO-PDF attach
php artisan cache:clear      # clears the cached OAuth token + tax map if needed
```
