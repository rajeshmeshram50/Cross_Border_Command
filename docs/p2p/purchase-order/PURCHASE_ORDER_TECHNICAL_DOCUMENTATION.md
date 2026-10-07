# P2P Purchase Order — Technical Documentation

## 1. Stack

| Layer | Technology |
|---|---|
| Backend | PHP 8.2, Laravel 12 |
| Database | PostgreSQL |
| Auth | Sanctum bearer token + `user.active` |
| Frontend | React 19 + TypeScript, Vite |
| PDF | `barryvdh/laravel-dompdf` |
| E-signature | Zoho Sign (`ZohoSignService`) |
| Accounting | Zoho Books (`ZohoBooksService` → `PoZohoService`) |
| Queue | database driver |

---

## 2. Architecture

```
React  purchase-management/order/  (po-list · create-po · manage-payment)
  │  axios  (Bearer token, branch_id injected on GETs)
  ▼
routes/api.php  →  prefix p2p/orders
  ▼
PurchaseOrderController      ← stages 01-03, list, cancel, DELETE,
                               qty-history, proofs, zoho entrypoints
PurchaseOrderDocumentController   ← stage 04
PoPaymentRequestController        ← stage 05  (TDS, requests, payments)
PurchaseOrderInspectionController ← physical inspection — NOT a stage;
                                    it sits outside the five steps
PoGstApprovalController      ← the GST gate
PoRefundAdjustmentController ← the only exit for a paid PO
  ▼
PurchaseOrderService   codes · totals · tax · stage-04 materialisation
PoDocumentService      PDF · Zoho Sign · email
PoZohoService          every Zoho Books push
VendorCurrencyGuard    one trading currency per supplier
  ▼
p2p_purchase_orders (78 cols) + items + documents + qty histories
                              + gst approvals + physical inspections
```

---

## 3. Data model

| Table | Rows hold |
|---|---|
| `p2p_purchase_orders` | The order. 78 columns: header, linkage, tax, GST gate, totals, TDS, payment figures, cancellation, Zoho refs |
| `p2p_purchase_order_items` | One row per line: `quantity`, `rate`, `gst_pct`, and the five server-computed amounts |
| `p2p_po_item_qty_histories` | Append-only: previous → current quantity, per PI line, with event and actor |
| `p2p_purchase_order_documents` | Stage 04: generated / uploaded / signed documents |
| `p2p_po_gst_approvals` | The senior approval when GST filing is overdue |
| `p2p_po_physical_inspections` | **One row per PO line**, keyed on `purchase_order_item_id`: `verdict`, `remark`, `proof_files` (JSON), `inspected_by`, `inspected_at` |

Column count on `p2p_purchase_orders` verified at **78**
(`Schema::getColumnListing`).

### Where the inspection state actually lives

It is split across two tables, which is worth knowing before writing a query:

| On | Columns |
|---|---|
| `p2p_purchase_orders` | `physical_inspection` (`yes`/`no`, set at Stage 01) · `inspection_status` (`pending` / `completed`) · `inspection_note` · `inspection_note_files` (JSON) · `inspected_by` · `inspected_at` |
| `p2p_po_physical_inspections` | The per-line verdict, remark and `proof_files` |

So the **sign-off** is on the header and the **verdicts** are on the lines.
`PoPhysicalInspection::VERDICTS = ['correct', 'damaged', 'mismatched']` is the
whole enum — there is no fourth value and no free-text verdict.

`proof_files` and `inspection_note_files` are JSON arrays of
`{path, name, mime, size}`; the API adds `index` and a resolved `url` on read,
and the index is **positional**, which is why removing a file re-indexes the
rest.

Every business field is **nullable** so a draft can be saved stage by stage, and
every fixed-value field is an **enum** — which on PostgreSQL is a CHECK
constraint, so a bad value is refused by the database itself.

Soft deletes on the PO (`deleted_at`).

---

## 4. Code allocation

```php
PO/<FY>/<SEQ>    nextPoCode()        per client
DOC/<FY>/<SEQ>   nextDocCode()       per client
```

`<FY>` is the Indian financial year: April–March, rendered `2026-27`
(`$start . '-' . substr($start + 1, -2)`). The sequence is `%03d`, so a real
code reads **`PO/2026-27/018`** and a document **`DOC/2026-27/004`**. It is not
the two-digit `25-26` shape some other modules use.

Three properties matter:

1. **Must be called inside a transaction** — the sequence read and the insert are one unit.
2. **The tenant scope is lifted** (`withoutGlobalScope('tenant')->withTrashed()`) because the code is unique across the whole client. A branch-filtered read would hand out a code another branch already holds.
3. **Trashed rows count** — a soft-deleted PO still owns its number.

`previewPoCode()` is the read-only twin for the "next code" display: no lock,
nothing reserved.

---

## 5. Totals and tax

```php
lineAmounts(qty, rate, gstPct, taxMode)
  taxable = qty × rate
  intra   → cgst = sgst = taxable × gst/200
  inter   → igst = taxable × gst/100
  export  → no GST
  total   = taxable + cgst + sgst + igst
```

`taxMode()` compares the supplier's state code with the branch's home state
code. `recomputeTotals()` re-derives the PO's `taxable_total`, `total_cgst`,
`total_sgst`, `total_igst` and `grand_total` from the lines plus charges.

**Client-supplied amounts are never trusted.** The request carries quantity,
rate and an optional description — **nothing else**. `gst_pct` is not accepted
either: it is resolved from `products.gst_id` → `master_gst_percentage.percentage`
and forced to `0` when `document_type = international`.

---

## 5A. The ceilings, and a known front/back drift

```php
MAX_ZOHO_BASE      = 1_000_000_000;      // ₹100 crore — the whole PO, and each charge
MAX_UNIT_RATE_BASE = self::MAX_ZOHO_BASE // one unit's rate
MAX_QUANTITY       = 10_000_000;         // one line
MAX_EXCHANGE_RATE  = FxRate::MAX         // 10,000 — shared with QT / PI / SPI
```

Both money ceilings are **rupee** ones and are divided by the PO's exchange
rate at validation time, so one rule fits every currency:

```php
$fx       = (float) ($po->exchange_rate ?: 0) ?: 1.0;
$maxRate  = self::MAX_UNIT_RATE_BASE / $fx;
$maxTotal = self::MAX_ZOHO_BASE / $fx;
```

The unit rate is **tied to the order ceiling** rather than carrying its own
number — *"one unit cannot be worth more than the whole order may be, and at
any quantity above 1 the order ceiling binds first anyway."*

Why rupees, and why this size:

> *Zoho converts a PO at its own rate and posts the rupee figure to the ledger,
> so that is the only number it judges. Evidence from this org: 20.88 trillion
> synced, 2,546 trillion refused as "out of range" — Zoho's amount field is a
> 14-digit whole part, the same shape as ours.*

> *Measured against this org's own 17 orders: the largest GENUINE order is
> ₹1.73 crore, so a 100-crore ceiling still leaves ~58x headroom.*

> ### Known defect: the browser's copy was not updated
>
> `resources/js/pages/p2p/purchase-management/order/create-po/validation.ts`
> carries the **pre-tightening** values under a comment that still reads
> *"Mirrors PurchaseOrderController"*:
>
> | | Server | Browser | Drift |
> |---|---|---|---|
> | Unit rate | ₹1,000,000,000 | ₹10,000,000,000 | **10×** |
> | Whole PO | ₹1,000,000,000 | ₹1,000,000,000,000 | **1,000×** |
> | Quantity | 10,000,000 | 10,000,000 | — |
> | Charges | ₹1,000,000,000 each | **not checked** | — |
>
> A line in the gap passes every client check with no error in any cell and is
> refused on save with a different figure. Fixing it is a one-line change in
> `validation.ts`; it is recorded here rather than silently corrected.

---

## 6. Payment figures on the PO

`paid_amount` and `balance_amount` are **stored** but never authoritative on
their own — `refreshPaymentTotals()` rebuilds them from the payment rows inside
the same transaction as every change that could affect them.

This is a deliberate denormalisation: the list screen needs the balance without
aggregating payments per row, and the rebuild-in-transaction rule is what keeps
it honest.

### What a payment freezes

Because those stored figures rest on the line total, `updateItems()` refuses
once **any** payment exists — not merely when the new total would fall below
what is paid:

```php
if ((float) $po->paid_amount > 0)
    return $this->fail('Payments are already recorded on this PO — its product
                        lines and charges can no longer change.');
```

`editBlock($po)` is the shared guard ahead of it, and `payable($po)` is the
Step 05 equivalent. Three separate locks therefore exist on one PO, and they
are easy to confuse:

| Lock | Trigger | Freezes |
|---|---|---|
| `editBlock()` | Cancelled | Every stage |
| `paid_amount > 0` | A payment exists | Lines and charges |
| A GST approval raised | Pending **or** approved | Supplier and document type |
| Lines exist | — | The shipment link |

---

## 7. Concurrency

| Risk | Guard |
|---|---|
| Two POs taking the same code | `lockForUpdate` on the sequence read, inside the transaction |
| Two refund adjustments on one PO | PO row locked, existence re-checked inside the lock |
| Payment recorded while the PO is being cancelled | Cancel path re-reads `paid_amount` inside the transaction |
| Same PI line ordered twice | `orderedByPiItem()` excludes the current PO and is read inside the write transaction |
| Supplier currency changing mid-flight | `VendorCurrencyGuard` remembers the currency the first PO set and refuses a conflicting one |
| Two people paying at once, both passing the balance check | Both ceilings (request headroom and PO balance) are computed **inside a `lockForUpdate()` on the PO row** |
| A UTR recorded twice | Unique across the whole client, checked inside the transaction |

Every mutating endpoint runs through the `RunsInTransaction` trait, which also
cleans up uploaded files when the transaction rolls back.

---

## 8. Multi-tenancy

`BelongsToTenant` adds a global scope named `tenant`, driven by
`App\Support\TenantContext` rather than by the model or the controller:

```php
rows with NULL client_id                      ← globals / shared rows
  OR ( client_id = TenantContext::clientId()
       AND ( NULL branch_id
             OR branch_id = TenantContext::branchId() ) )
```

The branch half applies **only when a branch is in context**. For GETs the Axios
interceptor supplies it from the branch switcher, so the same query returns
different rows depending on the active branch — and with no branch in context it
returns the whole client.

On create the trait fills what the controller left empty:

```php
if (empty($row->client_id))            $row->client_id = TenantContext::clientId();
if (!$row->isDirty('branch_id') && …)  $row->branch_id = TenantContext::branchId();
```

*"Fill only what the controller left empty — an explicit value always wins."* So
a `client_id` in a request body is never read; it is not rejected, it is simply
never consulted.

### The only authorisation check

```php
private function tenantUser(Request $request) {
    $user = $request->user();
    if (!$user?->client_id) abort(response()->json(
        ['status' => false, 'message' => 'No tenant context'], 403));
    return $user;
}
```

**That is the whole of it.** No role test, no module-permission test, on any
route in this group — raising, editing, submitting, cancelling, deleting,
inspecting and syncing are all open to any authenticated user with a
`client_id`. A super admin has none, so every write (and read) is refused.

The UI gates the menu leaf `p2p.order` through `perms[id].can_view`
(`Sidebar.canView`), with no rollout bypass of the kind Sales and CLM carry. So
visibility and capability diverge: **hiding the menu item does not stop the
endpoints answering.** Recorded as a finding.

Two decisions do check the actor, and both live outside this screen: a GST
approval may only be decided by its addressee, and a payment request only by
its addressee, who must be an active non-client-admin in the branch.

### Where the scope is deliberately lifted

| Lift | Why |
|---|---|
| `nextPoCode()` / `nextDocCode()` — `withoutGlobalScope('tenant')->withTrashed()` | The code is unique across the **whole client**; a branch-filtered read would reuse a number another branch holds, and a trashed PO still owns its number |
| `orderedByPiItem()` | PI quantity is consumed client-wide, so every branch's POs must count |
| `PoGstApprovalController::clientPoIds()` | An approval is addressed to a senior who may sit in another branch |
| `PoZohoService` payment reads | The tracker must see every payment on the PO, whatever branch recorded it |

Each is narrowed back to `client_id` by hand immediately after the lift — the
scope is lifted, the tenant is not.

---

## 9. Stage 04 materialisation

`ensureDefaultDocuments()` is **additive and idempotent**:

- Called on submit (Stage 03) and on every Stage 04 read
- A row already present keeps its file, signature and Necessary flag
- New rows arrive **Not necessary**

That last point is the design decision worth knowing: a document added to the
segment master later must not retroactively gate a PO that was already
complete, nor the supplier's other orders.

Rows are matched by `source_type:source_id`, which is what makes the re-run
additive rather than a diff.

### Which library rows reach a PO

| Step | Rule |
|---|---|
| 1 · segments | The segments of the **products on this PO**. Falls back to the supplier's segments, then the supplier's own, then nothing |
| 2 · library rows | `clm_trade_doc_library` + `clm_agreement_library`, same client, **`regulatory` equal to the segment's**, `Active`, and the row's comma-separated `segment` list containing this segment's name or code **matched whole** |
| 3 · party | Only rows naming the **supplier** as a party |
| 4 · result | The PO document (always, always Necessary) + each survivor as **Not necessary** |

The substring trap in step 2 is real: the `segment` column is a comma-separated
list, so matching must be on whole entries or `Rice` picks up `Rice Bran`.

---

## 10. Zoho Books coupling

`PoZohoService::syncAll()` runs the chain and returns a per-step result;
`summary()` renders it for the toast.

| Step | Creates |
|---|---|
| `syncPo()` | Zoho Purchase Order, then the Bill |
| `postPayments()` | Vendor Payment per payment, applied to the bill |
| `pushVendorCredit()` | Vendor Credit for a refund adjustment |
| `pushRecovery()` | Vendor Credit Refund per recovery |

`preflight()` validates the preconditions first — vendor contact, GSTIN, tax
availability, currency — and throws a `RuntimeException` with a readable message
rather than letting Zoho reject the chain halfway.

**Tax resolution** is by Zoho's own `tax_specification` field, not the tax name:
a tax *named* `GST3` can still be an inter-state tax, and sending it on an
intra-state bill is refused. The rate→id maps are cached 30 minutes and
re-fetched once on a miss, so a tax added in Zoho moments ago still works on a
retry.

---

## 11. File storage

| What | Where | Limit | Types |
|---|---|---|---|
| Documents (Stage 04) | `p2p/po-documents/{po}` | **10 MB** | `pdf,doc,docx,jpg,jpeg,png` |
| **Inspection proof** | `p2p/po-inspections/{po}` | **20 MB** | `image/*`, `video/*`, `application/pdf` |
| Payment proofs | `public` disk | | |
| Refund attachments | `p2p/refund-adjustments/{po}` | | |

The two limits differ on purpose: inspection proof is *"what a phone camera or
scanner produces"*, so it allows video and a larger file; a trade document does
not.

Downloads go through `P2pFileController::download` rather than a direct URL, so
tenancy is checked on the way out. Inspection files are the exception — they
stream from their own controller methods, because *"a link straight at the
stored file cannot be downloaded once the disk is remote (Azure): the browser
drops the `download` hint across origins and only opens the image."*

`RunsInTransaction` takes the stored paths as a second argument and deletes them
if the transaction rolls back, which is why every upload stores the file
**before** opening the transaction rather than inside it.

---

## 12. Where every field's data comes from

Nothing on the Create PO form is free text except quantities, rates and the
terms. This is the provenance of each dropdown, loaded once when the form opens
(`create-po/use-po-lookups.ts` → `api/po-api.ts`).

| Field | Endpoint | Source of truth |
|---|---|---|
| **Supplier** list | `GET /p2p/purchase-orders/suppliers` | `vendors` |
| Supplier detail — GSTIN, state, allowed currencies | `GET /p2p/purchase-orders/suppliers/{id}` | `vendors` + `vendor_gst_scrutiny` |
| Supplier legal status / Evidence Vault | `GET /segment-uploads/supplier/{id}/vault` | Segment uploads — KYC, DD, trade licences |
| **Shipment** dropdown | `GET /p2p/purchase-orders/shipments` | `shipment_orders` |
| **PI lines** (with-shipment only) | `GET /p2p/orders/shipments/{id}/pi-lines` | `proforma_invoice_items` |
| **Products** | `GET /products?lite=1&per_page=200` | `products` |
| → product GST % | same payload | `products.gst_id` → `master_gst_percentage.percentage` — **null means the server refuses the line** (domestic only) |
| → product segment | same payload | `clm_segments` — a PO orders only its supplier's segments |
| → product status | same payload | Anything but `Active` is **listed but locked** |
| **Currencies** | `GET /master/currencies` | `Masters\Currencies` |
| **Incoterms** | `GET /master/incoterms` | `Masters\Incoterms` |
| **Countries** | `GET /master/countries` | `Masters\Countries` |
| **Port of loading** | `GET /master/port_of_loading` | `Masters\PortOfLoading` |
| **Port of discharge** | `GET /master/port_of_discharge` | `Masters\PortOfDischarge` |
| Next PO code | `GET /p2p/orders/next-code` | Sequence over `p2p_purchase_orders` |
| GST approvers | `GET /p2p/orders/gst-approvals/approvers` | `users`, seniors of the branch |

`poLookupApi.master(slug)` is one generic reader for **any** master list, so a
new dropdown backed by a master needs no new endpoint.

### Derived on the server, never sent by the client

| Field | Derived from |
|---|---|
| `tax_mode` | Supplier's state code vs the branch's `home_state_code` |
| `taxable_amount`, `cgst/sgst/igst_amount`, `line_total` | `lineAmounts(qty, rate, gst_pct, tax_mode)` |
| `grand_total` | `recomputeTotals()` over lines + charges |
| net payable | `grand_total − tds_amount` |
| `paid_amount`, `balance_amount` | `refreshPaymentTotals()` over the payment rows |
| `gst_gate` | `gstGate()` — **re-read at submission**, not at creation |
| `code` | `nextPoCode()` under a lock |
| `gst_pct` on a line | The product master, forced to `0` on an international PO — **never accepted from the client** |
| `charges_total` | `shipping + packaging + other`, rounded on read |
| `inspection_status` | `signOff()` / `withdraw()` — never set directly |
| `signing_started` | Set when any Stage 04 document is sent for signature; the Step 05 gate reads it |

---

## 13. Frontend internals

> **Two PO screens exist, on two different backends.**
>
> | Route | Component folder | Backend |
> |---|---|---|
> | `/p2p/order` | `p2p/purchase-management/order/` | **`/p2p/orders`** — this document |
> | `/p2p/purchase-order` | `p2p/procurement-management/purchase-order/` | `/p2p/purchase-orders` — legacy, different controller |

| Folder | Role |
|---|---|
| `api/po-api.ts` | Every call the module makes, in one file |
| `po-list/` | `Order.tsx`, `ZohoTrackerModal.tsx` |
| `create-po/` | Wizard + `use-po-lookups.ts`, `validation.ts`, `gst-check.ts`, three notice modals |
| `manage-payment/` | TDS, raise request, add payment |
| `cancel-po/` · `gst-approval/` · `physical-inspection/` · `evidence-vault/` | One concern each |

State is local to the page (React state + axios), not Redux — Redux in this
codebase is for the Velzon theme only.

---

## 14. Known coupling points

- **Payment Requests** read and write `po.paid_amount` / `po.balance_amount`.
- **Refund Adjustment** is the only legal exit for a paid PO, and it drives `cancel_stage`.
- **CLM segment libraries** supply Stage 04's document list.
- **Shipment / Proforma Invoice** supply Stage 02's lines and hold the reservation that cancelling releases.
- **Zoho Books** mirrors the PO; a change after sync does not propagate automatically.
- **Physical inspection** is coupled to nothing: it reads the PO's lines and writes its own tables. No payment waits on it and it waits on no payment.
- **The PO Evidence Vault** reads the payment, recovery and adjustment tables directly through `proofs()`, so it reflects money even where no document exists.

---

## 15. Things this module does NOT do

Stated because each one is a reasonable assumption that is wrong:

| Assumption | Reality |
|---|---|
| A permission guards the endpoints | Only a tenant check — §8 |
| Physical inspection gates payment | It gates nothing |
| The charges are saved with the terms | They are saved with the **items** |
| `gst_pct` comes from the request | From the product master |
| `submit` is a boolean | `'yes'` / `'no'` |
| Cancelling and deleting are the same | Delete is drafts-only and drops the currency lock |
| The browser and server agree on the ceilings | They differ by 10× and 1,000× — §5A |
| A standalone PO can cite a procurement request | `prohibited_if:link_type,standalone` |
