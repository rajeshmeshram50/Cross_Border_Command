# P2P Payment Request Management — Code Walkthrough

## 1. The file map

### Backend

| File | Role |
|---|---|
| `app/Http/Controllers/Api/P2p/PoPaymentRequestController.php` (~797 lines) | The whole module |
| `app/Models/P2p/PoPaymentRequest.php` | Statuses, payment types |
| `app/Models/P2p/PoPayment.php` | Payment rows |
| `app/Services/P2p/PurchaseOrderService.php` | `nextPaymentRequestCode()`, `refreshPaymentTotals()` |
| `app/Services/P2p/PoZohoService.php` | `postPayments()` |
| `app/Jobs/AttachPoPaymentProofToZoho.php` | Queued proof attachment |

### Frontend

`resources/js/pages/p2p/payment-management/payment-request/`

| File | Role |
|---|---|
| `PaymentRequestManagement.tsx` | Queue across all POs |
| `PaymentRequestDetail.tsx` | One request |
| `PaymentRequestDecisionModal.tsx` | Approve |
| `DeclineReasonModal.tsx` | Reject |
| `TxnVaultModal.tsx` | Payments + proofs |

### Routes

`routes/api.php` around line 440, inside `Route::prefix('p2p/orders')`.

---

## 2. The controller's two halves

Read the class docblock first — it states the split:

```php
/**
 * PO payments: TDS, payment requests, their approval, and the payments released against them.
 *
 *  - Manage Payment Requests (one PO): summary cards + requests, TDS, raise, payments.
 *  - Payment Request Management (all POs): paged list, request detail, approve / decline.
 *
 * The PO's paid_amount / balance_amount and each request's paid_amount are stored, and
 * rebuilt from the payment rows inside the same transaction as every change.
 */
```

| One PO | All POs |
|---|---|
| `forPo` · `saveTds` · `store` | `index` · `show` |
| `payments` · `storePayment` · `updatePayment` · `destroyPayment` | `decide` · `decideMany` |
| `zohoSyncPayment` | |

---

## 3. Request flow — raise a request

```
POST /api/p2p/orders/{po}/payment-requests
  │
  ├─ tenantUser($request)
  ├─ findPo($po)                        ← tenant-scoped
  ├─ payable($order)                    ← cancelled? submitted? → refuse
  │
  ├─ TDS GATE  (domestic only)
  │    if (!$order->tds_updated_at)
  │        → "Deduct the TDS on this PO first — save it (even as 0)…"
  │
  ├─ validate: payment_type, percentage, requested_amount, reason, requested_to
  │
  ├─ APPROVER CHECKS
  │    ├─ active user of this client?       → else refuse
  │    ├─ user_type === 'client_admin'?     → "A request stops at the branch head"
  │    └─ approver.branch_id === po.branch? → else "Choose someone from this PO's branch."
  │
  └─ inTransaction:
       code = svc->nextPaymentRequestCode(client_id)   ← PRQ-001, locked
       PoPaymentRequest::create([...status = pending])
```

The TDS gate is the first business rule in the method, before validation —
because without TDS the ceiling every later rule uses does not exist yet.

---

## 4. Inside `saveTds()`

```php
$base   = round((float) $order->taxable_total, 2);
// The amount is what was typed when given; otherwise it follows from the percentage.
$amount = isset($data['tds_amount'])
        ? round((float) $data['tds_amount'], 2)
        : round($base * (float) $data['tds_percentage'] / 100, 2);

if ($amount > $base + 0.001) → "TDS cannot be more than the PO base amount of X."

$pct = $base > 0 ? round($amount / $base * 100, 2) : 0;
// The cap holds whichever field was typed — an amount above 40% is the same deduction.
if ($pct > self::TDS_MAX_PCT + 0.001) → "TDS cannot be more than 40% …"
```

Two guards, in this order: against the **base**, then against the **percentage**.
The second comment explains why the cap is applied to the derived percentage
rather than only to a typed one.

---

## 5. Inside `recordDecision()` — the heart of the module

```php
// 1. identity, not permission
if ((int) $row->requested_to !== (int) $user->id)
    return $no('Only the person this request was sent to can decide it.');

// 2. one decision only
if ($row->status !== STATUS_PENDING)
    return $no('This request is already ' . …);

// 3. the PO must still be alive
$po = PurchaseOrder::withoutGlobalScope('tenant')->find($row->purchase_order_id);
if (!$po || $po->isCancelled())
    return $no('This PO was cancelled — there is nothing to decide.');

// 4. ceiling one — the request itself
if ($approve && $approved > $row->requested_amount + 0.001)
    return $no('You can approve at most the requested X.');

// 5. ceiling two — the PO's headroom
$held = …SUM(GREATEST(approved_amount, paid_amount))… // other approved requests
$open = $po->grand_total - $po->tds_amount - $held;
if ($approved > $open + 0.001)
    return $no('Only X is still open to approve on this PO.');

// 6. commit
$this->inTransaction('record the decision', fn () => $row->update([
    'status' => $decision, 'approved_amount' => $approved,
    'decision_note' => trim($note), 'decided_at' => now(),
]));
```

**Read the order.** Cheapest and most absolute checks first (who you are, is it
already decided), then state (is the PO alive), then arithmetic. By the time the
sums run, everything else is known good.

**`GREATEST(approved_amount, paid_amount)`** — if a request somehow carries more
paid than approved, the headroom must shrink by the larger figure or the PO is
over-committed by the difference.

---

## 6. Request flow — record a payment

```
POST /api/p2p/orders/{po}/payment-requests/{req}/payments   (multipart)
  │
  ├─ request must be approved
  ├─ validate amount, bank_name, UTR_RULE, date, PROOF_RULE
  ├─ store the proof file
  └─ inTransaction([$path]):          ← path passed so a rollback deletes it
       ├─ PoPayment::create([... purchase_order_id denormalised ...])
       ├─ rebuild request.paid_amount  = Σ its payments
       └─ svc->refreshPaymentTotals($po)
             po.paid_amount    = Σ payments on the PO
             po.balance_amount = net payable − paid
```

`updatePayment` is a **POST**, not a PUT:

```php
// POST, not PUT: the edit may carry a new proof file (multipart).
```

PHP does not populate `$_FILES` on a PUT, so a multipart edit has to be a POST.

`destroyPayment` soft-deletes and runs the same two rebuilds.

---

## 7. Inside `index()` — the queue

```php
private const TABS = [
    'all'      => 'TRUE',
    'awaiting' => "r.status = 'pending'",
    'approved' => "r.status = 'approved'",
    'declined' => "r.status = 'rejected'",
];
```

Tabs are SQL fragments against the request alias `r`. `scopedRequests($user)`
builds the base query with tenancy joined explicitly, so the tab condition can
be appended without re-deriving scope.

---

## 8. Zoho flow for one payment

```
POST …/payments/{payment}/zoho-sync
  │
  └─ PoZohoService::postPayments($po, onlyPaymentId: $payment)
        ├─ requires $po->zoho_bill_id            ← bill first, always
        ├─ books->recordVendorPayment([... bills => [[bill_id, amount_applied]] ...])
        ├─ save zoho_payment_id, zoho_applied_amount, zoho_sync_status = synced
        └─ if (proof_path) AttachPoPaymentProofToZoho::dispatch($p->id)   ← QUEUED
```

On failure the row keeps `zoho_sync_status = 'failed'` and `zoho_error`, so the
state is visible on screen rather than buried in a log.

The attachment job goes to the **bill**, not the payment — Zoho Books has no
attachment endpoint for a vendor payment. It is queued, so it needs a worker; if
none is running, the payment syncs and the proof silently does not.

---

## 9. Frontend flow

```
PaymentRequestManagement.tsx
  GET /p2p/orders/payment-requests?tab&q&page
      │ row click
      ▼
PaymentRequestDetail.tsx
  GET /p2p/orders/payment-requests/{req}
      │
      ├─ Approve → PaymentRequestDecisionModal
      │              PUT …/{req}/decision { decision: 'approved', approved_amount, note }
      ├─ Decline → DeclineReasonModal
      │              PUT …/{req}/decision { decision: 'rejected', note }
      └─ Payments → TxnVaultModal
                     POST/POST/DELETE …/payments[/{payment}]
```

---

## 10. Patterns you will see in this code

| Pattern | Why |
|---|---|
| `$no(...)` closure returning an array | `recordDecision` is shared by `decide` and `decideMany`; it returns a refusal rather than a response, so the caller shapes it |
| `+ 0.001` on every money comparison | Float tolerance on currency |
| `withoutGlobalScope('tenant')` on the headroom sum | Must see every approved request on the PO, whatever branch raised it |
| Path passed to `inTransaction([$path])` | A rollback deletes the file that was just uploaded |
| POST for an edit | Multipart cannot ride a PUT in PHP |
| Rebuild, never increment | Totals are recomputed from rows, so a lost update cannot drift them |

---

## 11. Symptom → file

| Symptom | Look in |
|---|---|
| "Deduct the TDS first" when TDS looks set | `store()` — it checks `tds_updated_at`, not the amount |
| TDS refused at an amount under 40% | `saveTds()` — the base check fires before the percentage check |
| Approver not selectable | `store()` — active / not client_admin / same branch |
| "Only X is still open to approve" | `recordDecision()` headroom sum |
| Approve button does nothing for an admin | Identity check — only `requested_to` may decide |
| PO balance wrong | `refreshPaymentTotals()` and every caller of it |
| Payment synced but no proof in Zoho | `AttachPoPaymentProofToZoho` — is a queue worker running? |
| Zoho rejects the payment | `PoZohoService::postPayments()`, then `ZohoBooksService::resolveTaxId()` |
| Pending requests vanished | `PoRefundAdjustmentController::store()` — it closes them with the PO |
