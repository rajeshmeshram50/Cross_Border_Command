# Zoho Books Integration — Code Walkthrough

> A guided, step-by-step tour of the real code paths — bill sync, payment sync, direct SPI
> sync, and the attachment jobs. Follow along with the files open; every step maps to code.

## Document Control

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-30 | System | Initial Zoho Books code walkthrough |
| 2.0 | 2026-07-30 | System | Expanded, fresher-friendly edition |

---

## 0. Orientation — where things live

| File | Its job |
|---|---|
| `app/Services/ZohoBooksService.php` | **All** Zoho Books API calls (senior-owned) |
| `app/Http/Controllers/Api/PurchaseOrderController.php` | PO bill sync, payment sync, send-for-sign, PO code allocation |
| `app/Http/Controllers/Api/SupplierPurchaseInvoiceController.php` | SPI bill / payment / attachment sync |
| `app/Http/Controllers/Api/PoPaymentController.php`, `SpiPaymentController.php` | Payment Summary + TDS |
| `app/Http/Controllers/Api/DebitNoteController.php` | Vendor credits |
| `app/Jobs/AttachPoDocumentToZoho.php`, `AttachSpiDocumentToZoho.php` | Attachment jobs |
| `app/Http/Controllers/Api/DevToolsController.php` | Read-only Zoho data inspector |

Read this alongside the **Technical** tab, which explains the *concepts* (auth, idempotency,
rollback). This tab shows the *sequence*.

---

## 1. PO bill sync — `PurchaseOrderController::sync($id)`

Think of it as a checklist the code walks top to bottom. Each numbered step is a guard or an
action:

1. **Authenticate & load.** Resolve the user, load the PO with its items, `assertScope` (is
   this PO in the user's tenant?). If `!ZohoBooksService::isConfigured()` → return the
   "not connected" 503 message.
2. **Serialize.** Take `Cache::lock('zoho:sync:po:{id}', 120)`. If a second request can't get
   it → return 409 "already in progress". This stops double-clicks creating two bills.
3. **Idempotency short-circuit.** If the PO already has *both* `zoho_purchaseorder_id` and
   `zoho_bill_id`, it's already synced — return "already synced", and (best-effort) push any
   invoice documents that were raised after the first sync.
4. **Pre-condition guards** (each returns a clear 422 if it fails):
   - a supplier is attached;
   - at least one product line exists;
   - `tds_cut` is true — **unless** `document_type === 'International'` (then skipped);
   - at least one payment has been recorded.
5. **Create in Zoho, tracking for rollback.** Inside a `try`:
   - `findOrCreateVendorId(vendor, gstin, stateCode)` → the Zoho contact id;
   - `createPurchaseOrder(buildZohoPayload(...))` → sets `$createdPoId` (reversible);
   - `createBill(...)` → sets `$createdBillId`, plus the bill number.
6. **Commit atomically.** In a `DB::transaction`, stamp the PO (`zoho_status='Sync'`,
   `zoho_purchaseorder_id`, `zoho_bill_id`, `zoho_bill_number`, `zoho_synced_at`,
   `zoho_attachment_status='queued'`) **and** dispatch `AttachPoDocumentToZoho`. Because the
   DB queue write is in the same transaction, the job and the state can never drift.
7. **Best-effort extras (outside the safety block).** `postPoPaymentsToBill(...)` posts any
   already-cleared payments so they show "Synced"; then `attachSpiDocsToZoho($po)` stamps
   linked invoices and queues their document attachments. Errors here are logged, never roll
   the bill back.
8. **On any exception.** `reversePoSync($books, $createdPoId, $createdBillId, $createdPayments)`
   deletes what this run created (payments → bill → PO), sets `zoho_status='Not Sync'` +
   `zoho_error`, and returns 422. Zoho is left exactly as before.

> **Reading tip:** step 5 is "do the risky network stuff"; step 8 is "undo it if anything
> went wrong". That pairing is the all-or-nothing pattern.

---

## 2. Payment sync — `PurchaseOrderController::syncPayment($id)`

1. Guard + `isConfigured`. Require `zoho_bill_id` (the bill must exist) and a vendor.
2. If a `payment_id` was passed, validate it belongs to this PO and is **Cleared**.
3. Require a Zoho **Bank/Cash account** via `resolvePaidThroughAccountId(null)`.
4. Lock `zoho:syncpay:po:{id}`.
5. `getBill(zoho_bill_id)` to read the current balance, then
   `postPoPaymentsToBill($po, $books, $vendorId, $billId, $balance, $created, $onlyPaymentId)`.
6. `attachSpiDocsToZoho($po->fresh())` — push any invoice docs raised after the first sync.
7. Return the posted amount, or "already posted" / "nothing to post".

**Inside `postPoPaymentsToBill`:** it walks each Cleared `po_payment`, computes the
**un-applied remainder** (`amount − zoho_applied_amount`), and if > 0 calls
`recordVendorPayment(...)`, then stamps `zoho_payment_id` + `zoho_applied_amount`. This
ledger is exactly why re-running the sync never double-posts.

---

## 3. Supplier invoice sync — `SupplierPurchaseInvoiceController::sync($id)`

There are two branches:

- **With-PO invoice** → it delegates to `PurchaseOrderController::sync($po->id)` (the invoice
  is paid through the PO's bill). After the PO sync, it stamps **every** With-PO invoice on
  that PO with the shared `zoho_bill_id` + `zoho_status='Sync'` so their rows all reflect the
  sync.
- **Direct invoice** (no PO) → same guards (TDS skipped for International, ≥1 payment),
  creates its **own** bill via `createBill`, caches the bill PDF, best-effort posts existing
  payments, then `attachDirectSpiDoc($spi)` pushes the uploaded document to the new bill.

The `syncAttachment($id)` endpoint is the **manual** button: it validates the target exists
(the PO for a With-PO invoice, or the invoice's own bill for a Direct one), then runs
`AttachSpiDocumentToZoho::dispatchSync($id)` **in-request** so the user gets immediate
feedback.

---

## 4. The attachment jobs

**`AttachPoDocumentToZoho::handle()`**
1. Load the PO; bail if it has no `zoho_purchaseorder_id`.
2. Render the PO PDF via `SalesPdfController::renderPoPdfBytesCached($po)` (cached so a
   re-attach doesn't re-render).
3. Attach to the Zoho PO and (if present) the Bill, counting attempted vs succeeded.
4. All succeeded → `zoho_attachment_status='done'`. None → throw (queue retries). Partial →
   flag `failed` and stop (retrying would duplicate the copy that worked).

**`AttachSpiDocumentToZoho::handle()`**
1. Load the SPI; bail if no `attachment_path`, or if `zoho_doc_attached_at` is already set
   (idempotency).
2. Choose targets: With-PO → the PO's `zoho_purchaseorder_id` (primary) + `zoho_bill_id`;
   Direct → the invoice's own `zoho_bill_id`.
3. **Normalize the path.** `attachment_path` is stored as a public URL like
   `/storage/spi/1/abc.pdf`, but the `public` disk root is `storage/app/public`, so we strip
   `/storage/` down to the disk-relative `spi/1/abc.pdf` (a regex mirrors the download
   endpoint). This works identically on local disk (dev) and Azure Blob (prod).
4. **Build a safe filename.** `SPI-no-invoice-no.ext`, sanitized so only `[A-Za-z0-9_-]`
   survive — spaces and characters like a backtick make Zoho reject the upload with
   "Invalid value passed for attachment".
5. Attach to the primary target, stamp `zoho_doc_attached_at`, then best-effort to the bill.

---

## 5. Tax id resolution — `ZohoBooksService::resolveTaxId`

```
build map: rate% → tax_id   (cached)
if the requested rate is missing:
    Cache::forget(...)          // throw away the stale cache
    rebuild the map from Zoho   // ask Zoho for the current tax list
    re-check                    // maybe finance just added it
    still missing → throw "<rate>% tax not found in Zoho Books — add it and try again."
```
This is the "self-healing cache": add the tax in Zoho, hit retry, done — no 30-minute wait.

---

## 6. Following a single sync end-to-end (story form)

> A branch user opens PO/2026-27/025, cuts 2% TDS, records a ₹1,00,000 payment, clicks
> **Zoho Sync**.
>
> 1. `sync()` locks the PO, passes all guards.
> 2. The supplier is found in Zoho (or created) → contact id.
> 3. A Zoho purchase order is created → `zoho_purchaseorder_id`.
> 4. A bill is created from the PO → `zoho_bill_id`, `BILL-000123`.
> 5. The PO row is stamped "Sync" and `AttachPoDocumentToZoho` is queued (PO PDF → PO+Bill).
> 6. The ₹1,00,000 payment is posted to the bill (best-effort) → it shows "Synced".
> 7. The linked supplier invoice's document is queued to attach to the PO + Bill.
> 8. The user sees "Synced to Zoho Books — PO + bill BILL-000123, posted ₹1,00,000.00
>    payment(s)."
>
> If step 4 had failed, `reversePoSync` would have deleted the Zoho PO from step 3, and the
> row would read "Not Sync" with the error stored — nothing left half-done in Zoho.

---

## 7. Debugging tips

- **"Did it reach Zoho?"** → open **Dev Tools · Zoho Books** (admin) and look for the ids.
- **Attachment failed** → check `storage/logs/laravel-YYYY-MM-DD.log` for
  `Zoho attach … failed` warnings; the message includes the exact Zoho error.
- **"Tax not found" but it exists** → it was a stale cache; just retry (self-heals).
- **Nothing happens on auto-attach** → ensure `php artisan queue:listen` is running (the
  PO-PDF attach is queued); the manual "Sync Attachment" button always runs inline.
