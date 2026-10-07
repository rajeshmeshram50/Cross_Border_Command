# P2P Purchase Order — Code Walkthrough

## 1. The file map

### Backend

| File | Lines | Role |
|---|---|---|
| `app/Http/Controllers/Api/P2p/PurchaseOrderController.php` | 1330 | Stages 01–03, list, detail, cancel, **delete**, qty-history, proofs, Zoho entrypoints |
| `app/Http/Controllers/Api/P2p/PurchaseOrderDocumentController.php` | 386 | Stage 04 |
| `app/Http/Controllers/Api/P2p/PurchaseOrderInspectionController.php` | 263 | Physical inspection — **not** a stage |
| `app/Http/Controllers/Api/P2p/PoGstApprovalController.php` | 376 | GST gate approvals |
| `app/Http/Controllers/Api/P2p/PoPaymentRequestController.php` | — | **Step 05** — TDS, requests, payments |
| `app/Http/Controllers/Api/P2p/PoRefundAdjustmentController.php` | — | The only exit for a paid PO |
| `app/Http/Controllers/Api/P2p/Concerns/RunsInTransaction.php` | — | Transaction + rollback file cleanup |
| `app/Models/P2p/PoPhysicalInspection.php` | — | `VERDICTS = ['correct','damaged','mismatched']` |
| `app/Models/Concerns/BelongsToTenant.php` | — | The `tenant` global scope |
| `app/Support/TenantContext.php` | — | What that scope reads |
| `app/Support/FxRate.php` | — | `MAX = 10,000`, shared with QT / PI / SPI |
| `app/Services/P2p/PurchaseOrderService.php` | — | Codes, totals, tax, Stage 04 materialisation |
| `app/Services/P2p/PoDocumentService.php` | — | PDF, Zoho Sign, email |
| `app/Services/P2p/PoZohoService.php` | — | Every Zoho Books push |
| `app/Services/P2p/VendorCurrencyGuard.php` | — | One trading currency per supplier |
| `app/Models/P2p/PurchaseOrder.php` | — | Statuses, enums, relations |
| `app/Models/P2p/PurchaseOrderItem.php` | — | Lines |
| `app/Models/P2p/PoItemQtyHistory.php` | — | Quantity audit |

### Frontend

> **Two PO screens exist. Make sure you are in the right one.**
>
> | Route | Component | Backend |
> |---|---|---|
> | `/p2p/order` | `p2p/purchase-management/order/` | **`/p2p/orders`** — this document |
> | `/p2p/purchase-order` | `p2p/procurement-management/purchase-order/` | `/p2p/purchase-orders` — the **legacy** backend, a different controller |
>
> The route file says it outright: *"P2P · Create Purchase Order (new backend —
> independent of /p2p/purchase-orders)."*

All paths below are under `resources/js/pages/p2p/purchase-management/order/`.

| Folder / file | Role |
|---|---|
| `api/po-api.ts` | **Every** call this module makes — one place |
| `po-list/Order.tsx` | The list and its five tabs |
| `po-list/ZohoTrackerModal.tsx` | Per-step Zoho state |
| `create-po/CreatePoModal.tsx`, `CreatePoForm.tsx`, `steps/` | The wizard |
| `create-po/use-po-lookups.ts` | Dropdown data, loaded once when the form opens |
| `create-po/validation.ts`, `gst-check.ts`, `supplier-checks.tsx` | Client-side mirrors of the server rules |
| `create-po/po-draft.ts` | Draft persistence |
| `create-po/GstNoticeModal.tsx`, `CurrencyNoticeModal.tsx`, `SupplierDocsNoticeModal.tsx` | The three blocking notices |
| `manage-payment/` | TDS, raise request, add payment — Step 05 |
| `cancel-po/CancelPoModal.tsx` | Cancellation |
| `gst-approval/` | Raise and review the senior approval |
| `physical-inspection/` | Verdict, attachments, camera capture |
| `evidence-vault/PoEvidenceVaultModal.tsx` | All proofs on the PO |

### Routes

`routes/api.php`, `Route::prefix('p2p/orders')` — around line 421.

---

## 2. Request flow — create a draft (Stage 01)

```
POST /api/p2p/orders
  │
  ├─ auth:sanctum → user.active → tenant middleware (sets the global scope)
  │
  ├─ PurchaseOrderController::store()
  │    ├─ tenantUser($request)         ← refuses a super admin: no client_id
  │    ├─ validate(stage1Rules())
  │    ├─ resolveStage1()              ← supplier, shipment, PI, GST gate, tax mode
  │    └─ inTransaction('create the PO'):
  │          ├─ PurchaseOrder::create(
  │          │     stage1Attributes() + client_id, branch_id,
  │          │     code = svc->nextPoCode(client_id),     ← LOCKED
  │          │     status = draft, current_step = 1 )
  │          └─ rememberCurrency($po)   ← VendorCurrencyGuard
  │
  └─ 201  { status: true, data: shapeDetail($po) }
```

**The two things to notice:** the code is allocated *inside* the transaction, and
every identity field comes from `$user`, never from `$data`.

---

## 3. Request flow — items (Stage 02)

```
PUT /api/p2p/orders/{id}/items      { lines: [...], shipping/packaging/other_charges }
  │
  ├─ findPo($id)                       ← tenant-scoped
  ├─ editBlock($po)                    ← refuses a cancelled PO
  ├─ if (paid_amount > 0) → 422        ← ANY payment, not "below what is paid"
  │     "Payments are already recorded on this PO — its product lines and
  │      charges can no longer change."
  ├─ $fx = exchange_rate ?: 1
  │     $maxRate  = MAX_UNIT_RATE_BASE / $fx     ← ceilings built INTO the
  │     $maxTotal = MAX_ZOHO_BASE / $fx            validation rules
  ├─ validate: lines required|min:1
  │            lines.*.pi_item_id  distinct
  │            lines.*.product_id  required_without pi_item_id
  │            lines.*.quantity    gt:0 max:10,000,000
  │            lines.*.rate        min:0 max:$maxRate
  │            charges             min:0 max:$maxTotal
  ├─ every pi_item_id must belong to THIS PO's PI
  └─ inTransaction:
       ├─ for each line:
       │     gst = intl ? 0 : product.gst_pct      ← FROM THE MASTER
       │     svc->lineAmounts(qty, rate, gst, po.tax_mode)
       │       → taxable, cgst, sgst, igst, line_total
       ├─ replace p2p_purchase_order_items
       ├─ svc->logQty(po, item, pi, event, …)   → p2p_po_item_qty_histories
       └─ svc->recomputeTotals($po)
```

**Two corrections to an earlier version of this section.** The guard is not a
comparison against the new total — any payment at all freezes the lines. And
the request does **not** carry `gst_pct`: the body is `quantity`, `rate`,
`description` and one of `product_id` / `pi_item_id`. GST comes from
`products.gst_id` → `master_gst_percentage.percentage`, zeroed on an
international PO.

`lineAmounts()` is the only place GST is split, and the ceilings are expressed
as Laravel `max:` rules rather than hand-rolled checks — which is why their
messages name a converted figure in the PO's own currency.

---

## 4. Request flow — submit (Stage 03)

```
PUT /api/p2p/orders/{id}/terms   { terms, submit: 'yes' | 'no' }
  │                                         ↑ AN ENUM, NOT A BOOLEAN
  ├─ editBlock($po)
  ├─ validate: terms nullable|max:20000
  │            submit nullable|in:yes,no
  ├─ $submit = ($data['submit'] ?? 'no') === 'yes'
  │
  ├─ if ($submit) — the six gates, in order, each returning 422:
  │     1  vendor_id set            "Select a supplier before submitting."
  │     2  items()->exists()        "Add at least one product line…"
  │     3  every line still in the supplier's segments OR mapped to them
  │           → lists the product codes that are not
  │     4  gstGate() RE-READ NOW    blocked / pending / rejected / none raised
  │     5  supplier KYC · DD · trade licences in date   (CS-407)
  │     6  Case to Case — earlier POs' necessary documents signed
  │
  └─ inTransaction:
       ├─ update terms
       ├─ svc->recomputeTotals($po)
       └─ if ($submit):
             ├─ status = submitted, submitted_at, submitted_by
             ├─ current_step = max(current_step, 3)
             ├─ svc->ensureDefaultDocuments($po, $userId)   ← Stage 04 rows
             └─ GeneratePoDocumentPdf::dispatch()->afterCommit()   ← QUEUED
```

> **The charges are not on this endpoint.** They are validated and saved by
> `PUT /items`, even though the Step 03 screen shows them. An earlier version
> of this walkthrough had `{ terms, charges, submit: true }` — wrong on both
> counts.

Gate 3 exists because *"the supplier may have changed after the lines were
saved"*; gate 4 re-reads GST at submission, not at creation. Four of the six
read live data, which is why the browser cannot pre-empt them.

The PDF is **queued**, so Step 04 polls for it. A missing PDF straight after
submit is expected; a missing PDF with no queue worker is the fault.

---

## 5. Inside `PurchaseOrderService::nextPoCode()`

```php
public function nextPoCode(int $clientId): string
{
    return $this->nextCode(
        $clientId, 'PO',
        PurchaseOrder::withoutGlobalScope('tenant')->withTrashed()
    );
}
```

Three deliberate choices, each with a failure it prevents:

| Choice | Prevents |
|---|---|
| `withoutGlobalScope('tenant')` | A branch reusing a code another branch holds |
| `withTrashed()` | A soft-deleted PO's number being handed out again |
| Called inside a transaction | Two concurrent creates taking the same number |

`previewPoCode()` passes `allocate = false` — same read, no lock, nothing
written. That is what the "next code" field on the wizard displays.

---

## 6. Inside `ensureDefaultDocuments()`

```php
// Additive and safe to re-run — a row already there keeps its file, its
// signature and its Necessary flag. Stage 03 calls it on submit and Stage 04
// calls it on every read, so a document added to the segment master after the
// PO was raised still reaches the PO (CS-414). Anything new arrives Not
// necessary, so it never retroactively gates this PO or the supplier's others.
```

The comment in the source states the contract. When reading this method, the
question to keep asking is *"what happens on the second call?"* — the answer
must always be "nothing is lost".

---

## 7. Inside `cancel()`

```php
if ($po->isCancelled())        return $this->fail('This PO is already cancelled.');
if ((float) $po->paid_amount > 0)
    return $this->fail('Payments are recorded on this PO — raise the advance refund adjustment instead.');

$this->inTransaction('cancel the PO', function () {
    $this->svc->releaseAll($po, 'cancelled', $user->id);   // free the PI lines
    $po->update([
        'status'       => STATUS_CANCELLED,
        'cancel_stage' => CANCEL_CLOSED,     // ← closed, because nothing is owed
        'cancel_closed_at' => now(),
        …
    ]);
    $this->currency()->forget($po->client_id, $po->vendor_id, $po->id);
});
```

Compare with the refund-adjustment path, which sets `cancel_stage = INITIATED`
and leaves it open until recoveries close it. **The same PO status, two very
different meanings** — `cancel_stage` is what tells them apart.

---

## 7A. Inside `PurchaseOrderInspectionController`

Every method begins at the same guard and ends at the same response, which is
the shape to recognise before reading any one of them:

```php
private function inspectable(int $poId): PurchaseOrder|JsonResponse
{
    $po = PurchaseOrder::findOrFail($poId);
    if ($po->physical_inspection !== 'yes') return $this->fail('This PO does not require physical inspection.');
    if ($po->status !== PurchaseOrder::STATUS_SUBMITTED) return $this->fail('Only a submitted PO can be inspected.');
    return $po;
}
```

Note the return type: it hands back **either** the PO **or** the refusal, and
every caller opens with `if ($order instanceof JsonResponse) return $order;`.
That is the module's idiom for a guard that needs to carry a message.

Note also what is **not** in it — `signing_started` and `isCancelled()`. The
documents going out for signature gates Step 05, not this; and cancellation is
not tested here at all.

### `updateLine()` — the merge, and the cap before the write

```php
'verdict' => ['nullable', 'required_without:files', Rule::in(PoPhysicalInspection::VERDICTS)],
'files'   => 'nullable|array|max:10',
'files.*' => 'file|max:20480|mimetypes:image/*,video/*,application/pdf',
```

```
├─ if (inspection_status === 'completed') → 422
│     "Inspection is signed off — withdraw the sign-off to change a line."
│
├─ CAP CHECKED BEFORE STORAGE:
│     $held + $adding > 10  →  422 naming the room left
│
├─ $stored = storeFiles(...)          ← files land on disk first
└─ inTransaction('save the inspection line', …, array_column($stored, 'path'))
      firstOrNew(['purchase_order_item_id' => $line->id])
        verdict     = input('verdict', $row->verdict)     ← keeps the old one
        remark      = has('remark') ? input('remark') : $row->remark
        proof_files = array_merge($row->proof_files ?? [], $stored)   ← APPEND
```

Three things in that block are deliberate and easy to break:

| Line | Why it is written that way |
|---|---|
| `required_without:files` | Proof may arrive before anyone has decided what it shows |
| `input('verdict', $row->verdict)` | A file-only call must not blank an existing verdict |
| `has('remark') ? … : $row->remark` | Distinguishes *"clear the remark"* from *"did not mention it"* |
| `array_merge(…, $stored)` | *"New proof is added to what is already there, never replacing it"* |

The cap is checked **before** `storeFiles()` so a refusal leaves nothing on
disk; and the paths are passed to `inTransaction()` so a rollback removes them.

### `removeFile()` — row first, disk second

```php
array_splice($files, $index, 1);
$this->inTransaction('remove the proof file', fn () => $row->update(['proof_files' => $files]));
Storage::disk('public')->delete($gone);   // ← AFTER the row no longer points at it
```

*"The stored file is deleted only after the row no longer points at it."* The
index is positional, so removing one re-indexes the rest — a client holding a
stale index gets *"That file is no longer on this line."* with a `404`.

### `signOff()` — one query decides it

```php
$unmarked = $order->items()
    ->whereDoesntHave('inspection', fn ($q) => $q->whereNotNull('verdict'))
    ->count();
if ($unmarked > 0) return $this->fail("{$unmarked} line(s) have no verdict yet — mark every line before signing off.");
```

`whereDoesntHave(… whereNotNull('verdict'))` catches both cases at once: a line
with no inspection row, and a line whose row exists but holds only files. A
remark is never required — only the verdict.

### `withdraw()` — and what it leaves behind

```php
$order->update([
    'inspection_status' => 'pending',
    'inspected_by'      => null,
    'inspected_at'      => null,
    'updated_by'        => $request->user()->id,
]);
```

> **`inspection_note` and `inspection_note_files` are not in that list.** The
> note from the withdrawn sign-off stays on the PO and still reads as current.
> Whether that is intended is unclear from the code; it is not stated in any
> comment. Raise it rather than depending on it.

### `summary()` — why every method returns the whole thing

All five mutating routes return `summary($order)`, a full redraw: header
references, every line with its live product details, `lines_total`,
`lines_marked`, the sign-off and resolved file URLs. One round trip per change,
no client-side reconciliation. It reads product details through
`svc->lineDetails()` — **live**, not frozen on the PO — so renaming a product
changes what the inspection screen shows for an old order.

---

## 8. Inside `PoZohoService::syncAll()`

```
syncAll()
  ├─ preflight()        throws RuntimeException with a readable message
  ├─ syncPo()           Zoho Purchase Order → Bill   (skips if zoho_bill_id set)
  ├─ postPayments()     one Vendor Payment per payment row
  ├─ pushVendorCredit() if a refund adjustment exists
  └─ pushRecovery()     per recovery
```

Each step is guarded by "does this already carry a Zoho id?", which is what
makes re-running safe. The controller catches `RuntimeException` and returns it
as a `422` with the message — Zoho's own wording reaches the user.

---

## 9. Frontend flow

```
po-list/Order.tsx                       ← the component is Order.tsx
  useEffect → GET /p2p/orders?tab=&search=&page=&per_page=
                              ↑ tab is all|with|without|cancelinit|cancelclosed
                                     ↑ "search", not "q"
  "+ Create PO" → create-po/CreatePoModal.tsx     the LINK CHOOSER
        │   mode 'with'    → needs a shipment; Confirm disabled until picked
        │   mode 'without' → Confirm enabled at once
        ▼
      create-po/CreatePoForm.tsx                   the WIZARD SHELL
        holds po-draft.ts, so each step opens with StageSummary (a recap)
        step 1  POST /p2p/orders                 → id   (then PUT /stage-1)
        step 2  PUT  /p2p/orders/{id}/items      lines + charges
        step 3  PUT  /p2p/orders/{id}/terms      { submit: 'yes' }
        step 4  steps/Step4Documents.tsx         → /documents endpoints
        step 5  manage-payment/                  → TDS, requests, payments
  row actions, outside the wizard:
        physical-inspection/PhysicalInspectionModal.tsx  → /inspection
        evidence-vault/PoEvidenceVaultModal.tsx          → /proofs + /documents
        po-list/ZohoTrackerModal.tsx                     → /zoho-tracker
        cancel-po/CancelPoModal.tsx                      → /cancel
```

The wizard holds the PO id after step 1 and PUTs each later stage. A draft
abandoned mid-way is a real row — that is why every business column is nullable.

**Step 05 is payments; physical inspection is not a step.** It is a row action,
available as soon as the PO is submitted, and it reaches none of the wizard
endpoints.

Two frontend details that cause "it works but looks wrong" reports:

| Detail | Where |
|---|---|
| `+ Add Product Line` renders only when `link_type !== 'with_shipment'` | `Step2ProductDetails.tsx` — *"a shipment PO orders only its PI lines"* |
| Step 02 has its **own** Save beside the Grand Total, and only the pressed button spins (CS-409) | `ChargesSummary` action prop |

---

## 10. Patterns you will see in this code

| Pattern | Where | Why |
|---|---|---|
| `ok()` / `fail()` helpers | Top of each controller | One response shape across the module |
| `RunsInTransaction` trait | Every mutating method | Rollback also deletes files uploaded in the attempt |
| `withoutGlobalScope('tenant')` | Code allocation, uniqueness checks | Those questions are client-wide, not branch-wide |
| `lockForUpdate()` | Sequence reads, PO before cancel | Serialise the read-then-write |
| Server-computed amounts | `lineAmounts`, `recomputeTotals` | The client may not price the order |
| Stored-then-rebuilt totals | `refreshPaymentTotals` | Fast list reads, honest numbers |
| Long explanatory comments | Throughout | Each one records a bug that was fixed; read them before changing the line beneath |

---

## 11. Symptom → file

| Symptom | Look in |
|---|---|
| Wrong or duplicate PO code | `PurchaseOrderService::nextPoCode()` |
| GST split wrong on a line | `PurchaseOrderService::lineAmounts()` + `taxMode()` |
| Totals disagree with the lines | `recomputeTotals()` |
| Balance disagrees with payments | `refreshPaymentTotals()` — and the Payment Request module |
| Cancel refused unexpectedly | `PurchaseOrderController::cancel()` — check `paid_amount` |
| Document vanished from Stage 04 | `ensureDefaultDocuments()` — it should never remove |
| Zoho rejects the bill | `PoZohoService::preflight()` and `ZohoBooksService::resolveTaxId()` |
| PI line shows as taken | `PurchaseOrderService::orderedByPiItem()` |
| Supplier currency refused | `VendorCurrencyGuard` |
| A big line passes in the browser then fails on save | **Known drift** — `create-po/validation.ts` ceilings vs `PurchaseOrderController::MAX_ZOHO_BASE` |
| Lines cannot be edited any more | `updateItems()` — `paid_amount > 0` freezes them |
| Supplier cannot be changed | `updateStage1()` — a pending **or** approved GST approval fixes it |
| Shipment cannot be changed | `updateStage1()` — refuses while `items()->exists()` |
| Inspection screen refuses to open | `inspectable()` — `physical_inspection` and `status` are the only two checks |
| Sign-off refused with everything apparently marked | `signOff()`'s `whereDoesntHave` — a line with files but no verdict counts as unmarked |
| A withdrawn inspection still shows an old note | `withdraw()` does not clear `inspection_note` |
| Proof file upload rejected | `FILE_RULE` (20 MB, image/video/pdf) and `MAX_PROOF` = 10 per line |
| A document upload rejected | `PurchaseOrderDocumentController::store()` — 10 MB, pdf/doc/docx/jpg/png |
| Step 05 unreachable on a submitted PO | `signing_started` — set by `documents/sign`, not by submit |
| Delete refused | `destroy()` — drafts only |
| A deleted draft freed the supplier's currency | `destroy()` calls `currency()->forget()`; cancel does not |
| Evidence Vault shows no payment rows | `proofs()` lists **files**, not payments — a payment with no proof has nothing to show |
| A row appears in the wrong tab | `self::TABS` — `without` is a `COALESCE` catch-all, so a null `link_type` lands there |
| An endpoint answered for a user who should not have it | There is **no permission check** — only `tenantUser()`. By design of the current code, not a bug in the call |
