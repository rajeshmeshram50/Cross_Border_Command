# P2P Advance Receipt Refund Adjustment — Code Walkthrough

## 1. The file map

### Backend

| File | Role |
|---|---|
| `app/Http/Controllers/Api/P2p/PoRefundAdjustmentController.php` (~723 lines) | The whole module |
| `app/Models/P2p/PoRefundAdjustment.php` | Statuses, refund types, retain reasons |
| `app/Models/P2p/PoRefundRecovery.php` | Recovery rows |
| `app/Services/P2p/PurchaseOrderService.php` | `nextRefundCode()` |
| `app/Services/P2p/PoZohoService.php` | `pushVendorCredit()`, `pushRecovery()`, `removeRecovery()`, `creditPreview()` |
| `app/Jobs/AttachRefundAdjustmentToZoho.php`, `AttachRefundRecoveryToZoho.php` | Queued attachment pushes |

### Frontend

`resources/js/pages/p2p/payment-management/advance-refund/`

| File | Role |
|---|---|
| `AdvanceRefundAdjustment.tsx` | List, tabs, Zoho Sync column |
| `RefundPoPickerModal.tsx` | Eligible PO picker |
| `RefundAdjustmentForm.tsx` | Raise / edit |
| `AddRecoveryModal.tsx`, `RecoverPaymentModal.tsx` | Recoveries |
| `EvidenceVaultModal.tsx` | Proofs |

### Routes

`routes/api.php` around line 469.

---

## 2. Start with the class docblock

```php
/**
 * P2P · Advance Receipt Refund Adjustment — /api/p2p/orders/refund-adjustments
 *
 * Raising one cancels a PO that has money released (Cancellation Initiated); the supplier's
 * refunds are logged as recoveries until nothing is outstanding (Cancellation Closed).
 * Zoho Books is synced from the list's Zoho Sync column (zohoSync): the vendor credit, then
 * a vendor-credit refund per recovery. Saving never calls Zoho.
 */
```

Four sentences, four design decisions. Everything below is an elaboration of
them.

---

## 3. Request flow — raising one

```
POST /api/p2p/orders/refund-adjustments   (multipart)
  │
  ├─ tenantUser($request)
  ├─ validateForm($request, true)          ← the shared rule set
  ├─ PurchaseOrder::findOrFail(...)
  ├─ store the attachment → $path          ← BEFORE the transaction
  │
  └─ inTransaction('raise the refund adjustment', …, [$path]):
       │
       ├─ $po = PurchaseOrder::whereKey($order->id)->lockForUpdate()->first();
       │
       ├─ GUARD  already cancelled?           → abort
       ├─ GUARD  adjustment already exists?   → abort   ← inside the lock
       ├─ GUARD  $paid = $po->paid_amount ≤ 0 → abort
       │
       ├─ $figures = figures($data, $paid, 0.0)   ← all the arithmetic rules
       │
       ├─ PoRefundAdjustment::create([
       │      code = svc->nextRefundCode(client_id),   ← locked sequence
       │      paid_amount = $paid,                     ← SNAPSHOT
       │      … ] + $figures)
       │
       ├─ refreshTotals($adj)                 → status, balance, po.cancel_stage
       │
       ├─ PoPaymentRequest::where(status = pending)->update([
       │      status = 'rejected',
       │      decision_note = 'Closed — PO cancelled (ADR/…).' ])
       │
       ├─ svc->releaseAll($po, 'cancelled', $userId)   ← free the PI lines
       │
       └─ $po->update([ status = cancelled,
                        cancel_stage = CANCEL_INITIATED ])   ← NOT closed
```

**Three things worth pausing on.**

*The file is stored before the transaction, and its path is handed to
`inTransaction([$path])`.* If the transaction rolls back, the trait deletes the
orphan. Storing inside would leave the file whatever happened.

*The uniqueness check sits inside `lockForUpdate()`.* Outside it, two concurrent
requests would both see "no adjustment yet" and both insert. The lock is what
makes "one adjustment per PO" a fact rather than an intention.

*`cancel_stage = INITIATED`, not CLOSED.* Compare `PurchaseOrderController::cancel()`,
which sets CLOSED — same PO status, opposite meaning. The difference is whether
money is owed.

---

## 4. Inside `figures()` — the arithmetic gate

```php
private function figures(array $data, float $paid, float $recovered): array
{
    $refund = round((float) $data['refund_amount'], 2);

    if ($refund > $paid + 0.001)
        abort("The amount to be refunded cannot be more than the {$paid} paid.");

    if ($refund + 0.001 < $recovered)
        abort("{$recovered} has already been recovered — the refund cannot be less…");

    $retained = round($paid - $refund, 2);
    $full = $data['refund_type'] === 'Full Refund';

    if ($full && $retained > 0.001)
        abort('A full refund must return the whole … — choose Partial Refund…');

    if (!$full && $retained <= 0.001)
        abort('A partial refund must be less than the amount paid — choose Full Refund…');

    if ($retained > 0.001 && (empty($data['retained_type']) || trim($data['retained_remark']) === ''))
        abort('Give the reason and a remark for the … not being refunded.', [field errors]);

    return [
        'refund_amount'   => $refund,
        'retained_amount' => max(0, $retained),
        'retained_type'   => $retained > 0.001 ? $data['retained_type'] : null,
        'retained_remark' => $retained > 0.001 ? trim($data['retained_remark']) : null,
    ];
}
```

The **ceiling** (can't refund more than was paid) and the **floor** (can't refund
less than is already back) bracket the value. Then the type and the arithmetic
must agree, then any retention must be justified.

The last two lines are the subtle part: `retained_type` and `retained_remark` are
**nulled** when nothing is retained. Without that, editing a Partial to a Full
would leave a stale "Cancellation Charges" on a record that retains nothing.

`$recovered` is passed as `0.0` on create and as the live figure on edit — the
same function serves both, with the floor only meaningful on edit.

---

## 5. Inside `refreshTotals()` — the state machine

```php
private function refreshTotals(PoRefundAdjustment $adj): void
{
    $recovered = round(Σ PoRefundRecovery WHERE refund_adjustment_id = adj->id, 2);
    $balance   = round(max(0, $adj->refund_amount - $recovered), 2);

    $status = $balance <= 0.005 ? STATUS_RECOVERED
            : ($recovered > 0   ? STATUS_PARTIAL : STATUS_PENDING);

    $adj->forceFill(['recovered_amount' => $recovered,
                     'balance_amount'   => $balance,
                     'status'           => $status])->save();

    $closed = $status === STATUS_RECOVERED;
    PurchaseOrder::whereKey($adj->purchase_order_id)->update([
        'cancel_stage'     => $closed ? CANCEL_CLOSED : CANCEL_INITIATED,
        'cancel_closed_at' => $closed ? now() : null,
    ]);
}
```

Called after **every** recovery create, edit and delete, and after raising.

Two details:

- `max(0, …)` — an over-recovery clamps the balance at zero rather than going negative.
- `0.005` not `0.001` — half a paisa. Rounding across many recoveries must not leave an adjustment permanently one paisa short of settled.

The last block is the whole reason this module exists: **the PO's cancellation
stage is a function of this balance.**

---

## 6. Inside `saveRecovery()` — shared by create and edit

```php
$existing = $recId ? $adj->recoveries()->findOrFail($recId) : null;
if ($blocked = $this->zohoLockedRecovery($existing)) return $blocked;   // ← first

validate([
  'amount'         => 'required|numeric|min:1|…',
  'recovered_date' => 'required|date|before_or_equal:today|after_or_equal:' . $adj->refund_date,
  'reference_no'   => 'nullable|string|max:64',
  'proof'  / 'proofs' => max 1 file, PROOF_RULE,
  'keep'   => paths of stored proofs the form still shows,
]);
```

The date rule brackets the recovery between the adjustment and today — money
cannot come back before the refund was agreed, nor in the future.

### The duplicate-reference sweep

```php
$ref = mb_strtoupper(trim($data['reference_no']));
$dup = PoRefundRecovery::withoutGlobalScope('tenant')
    ->where('client_id', $adj->client_id)
    ->whereRaw('UPPER(TRIM(reference_no)) = ?', [$ref])
    ->when($existing, fn ($q) => $q->where('id', '!=', $existing->id))
    ->first([...]);

if ($dup) {
    /* Name the recovery holding it, and on which refund — "already
       used on another recovered payment" left the user hunting for
       which one (CS-567). */
    $msg = "Cheque / UTR number {$ref} is already recorded on {$onAdj} · {$onPo} "
         . "for ₹{$amount} on {$date}. Enter the reference from this payment instead.";
}
```

Four things in four lines: client-wide scope, case/whitespace-insensitive match,
self-exclusion on edit, and an error that names where the collision is. The
comment records why the message is long.

### Proof handling

```php
/* What this recovery ends up holding: the stored proof the form still
   shows, plus whatever was attached this time. A recovered payment keeps
   one proof, so a new one takes the old one's place; the list shape is
   what `proof_files` stores and what the download endpoint reads. */
$stored = [];
foreach (array_filter(array_merge([$request->file('proof')], $request->file('proofs') ?? [])) as $f) {
    $p = $f->store("p2p/refund-recoveries/{$adj->id}", 'public');
    $stored[] = ['path' => $p, 'name' => …, 'mime' => …, 'size' => …];
}
```

`proof` and `proofs[]` are merged so either field name works — the form moved
from one to the other and both are still accepted.

---

## 7. Inside `zohoLockedRecovery()`

```php
return $r && ($r->zoho_sync_status === 'synced' || !empty($r->zoho_refund_id))
    ? $this->fail('This refund is already posted to Zoho Books — it can no longer be changed or deleted.')
    : null;
```

**Two conditions, not one.** `zoho_sync_status` is our flag; `zoho_refund_id` is
the ledger's own evidence. If a push succeeded but the status write failed, the
id alone must still lock the row. The accounts win over our bookkeeping.

Called first in `saveRecovery()` and in `destroyRecovery()` — before validation,
because there is no point validating an edit that cannot be made.

---

## 8. Zoho flow

```
POST /refund-adjustments/{id}/zoho-sync
  └─ PoZohoService::pushVendorCredit($adj, $userId)
        creditPreview()  → the lines that will be sent
        books->createVendorCredit(...)
        save zoho_vendorcredit_id / _number / status

POST /refund-adjustments/{id}/recoveries/{rec}/zoho-sync
  └─ PoZohoService::pushRecovery($rec, $userId)
        requires $adj->zoho_vendorcredit_id      ← ordering enforced
        books->refundVendorCredit(...)
        save zoho_refund_id / status

DELETE a synced recovery → refused by zohoLockedRecovery()
removeRecovery() exists for the administrative path
```

---

## 9. Frontend flow

```
AdvanceRefundAdjustment.tsx
  GET /refund-adjustments?tab&q&page
  "Raise"  → RefundPoPickerModal
               GET /refund-adjustments/eligible-pos
             → RefundAdjustmentForm
               POST /refund-adjustments  (multipart)
  row     → detail
               AddRecoveryModal → POST /{id}/recoveries
               EvidenceVaultModal → proofs
  Zoho column → POST /{id}/zoho-sync
                POST /{id}/recoveries/{rec}/zoho-sync
```

`RefundAdjustmentForm` mirrors the Full-vs-Partial rules client-side for instant
feedback. The server re-checks every one — the client's copy is a convenience,
never the authority.

---

## 10. Patterns you will see in this code

| Pattern | Why |
|---|---|
| Guard clauses before validation | A locked row cannot be edited, so validating it is wasted work |
| `withoutGlobalScope('tenant')` | One-per-PO, reference uniqueness and request closure are client-wide questions |
| `lockForUpdate()` then re-check | Turns an intention into an invariant |
| Snapshot, not live read | `paid_amount` is frozen because the PO is cancelled in the same breath |
| `max(0, …)` on a balance | An over-recovery clamps rather than going negative |
| Two-condition locks | Trust the ledger's id over our own status flag |
| Error messages that name the other record | *(CS-567)* — "already used somewhere" is not actionable |
| POST for edits | Multipart cannot ride a PUT |

---

## 11. Symptom → file

| Symptom | Look in |
|---|---|
| "This PO already has a refund adjustment" on a PO that has none | `store()` — the check is inside the lock and ignores tenant scope |
| Full / Partial refused unexpectedly | `figures()` — the type must agree with `paid − refund` |
| Retained reason persists after switching to Full | `figures()` — it nulls both fields when nothing is retained |
| Status stuck on `partial` at zero balance | `refreshTotals()` — check the `0.005` tolerance |
| PO still shows Cancellation Initiated | `refreshTotals()` is the only writer of `cancel_stage` here |
| Duplicate UTR allowed | The sweep is client-wide and case-insensitive — check `client_id` on the rows |
| Cannot edit a recovery | `zohoLockedRecovery()` — look at `zoho_refund_id`, not just the status |
| Recovery sync refused | `pushRecovery()` needs `zoho_vendorcredit_id` first |
| Pending payment requests still open after cancelling | `store()` — the bulk update that closes them |
| Attachment left behind after a failed save | The path must be passed to `inTransaction([$path])` |
