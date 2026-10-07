# P2P Advance Receipt Refund Adjustment — Technical Documentation

## 1. Stack

| Layer | Technology |
|---|---|
| Backend | PHP 8.2, Laravel 12 |
| Database | PostgreSQL |
| Auth | Sanctum + `user.active` |
| Frontend | React 19 + TypeScript |
| PDF | `barryvdh/laravel-dompdf` |
| Accounting | Zoho Books via `PoZohoService` |
| Files | `public` disk under `p2p/refund-adjustments/`, `p2p/refund-recoveries/` |

---

## 2. Architecture

```
React   AdvanceRefundAdjustment.tsx     (list + tabs)
        RefundPoPickerModal             (eligible POs)
        RefundAdjustmentForm            (raise / edit)
        AddRecoveryModal / RecoverPaymentModal
        EvidenceVaultModal              (proofs)
  │  axios
  ▼
routes/api.php → p2p/orders/refund-adjustments/*
  ▼
PoRefundAdjustmentController (~723 lines)
  ├─ index · eligiblePos · forPo · show
  ├─ store · update                      ← raising cancels the PO
  ├─ storeRecovery · updateRecovery · destroyRecovery
  ├─ zohoSync · zohoSyncRecovery
  └─ pdf
  ▼
PurchaseOrderService  nextRefundCode()
PoZohoService         pushVendorCredit() · pushRecovery() · removeRecovery()
  ▼
p2p_po_refund_adjustments (31) ─1:n─ p2p_po_refund_recoveries (20)
              │
              └─ drives p2p_purchase_orders.cancel_stage
```

---

## 3. Data model

### `p2p_po_refund_adjustments`

```
id, client_id, branch_id, code, purchase_order_id, vendor_id,
refund_date, supplier_ref_no, attachment_path, attachment_name,
refund_type, reason,
paid_amount, refund_amount, retained_amount, retained_type, retained_remark,
recovered_amount, balance_amount, status,
zoho_vendorcredit_id, zoho_vendorcredit_number, zoho_applied_amount,
zoho_sync_status, zoho_synced_at, zoho_error,
created_by, updated_by, created_at, updated_at, deleted_at
```

`paid_amount` is a **snapshot** of `po.paid_amount` at the moment the adjustment
was raised — not a live read. The PO is cancelled in the same transaction, so
that figure can never move again.

### `p2p_po_refund_recoveries`

```
id, client_id, branch_id, refund_adjustment_id, purchase_order_id,
amount, recovered_date, reference_no, proof_path, proof_name, proof_files,
zoho_refund_id, zoho_sync_status, zoho_synced_at, zoho_error,
created_by, updated_by, created_at, updated_at, deleted_at
```

`proof_files` is JSON holding `[{path, name, mime, size}]`; `proof_path` /
`proof_name` are the legacy single-file columns kept in step with it.

Both tables soft-delete.

---

## 4. Code allocation

```php
ADR/<FY>/<SEQ>   nextRefundCode(clientId, allocate = true)
```

Same contract as the PO code: inside a transaction, tenant scope lifted
(`withoutGlobalScope('tenant')->withTrashed()`), trashed rows still own their
numbers. `allocate = false` gives the preview without reserving.

---

## 5. The two arithmetic functions

### `figures()` — on write

```php
refund = round(data.refund_amount, 2)

if (refund > paid + 0.001)        → "cannot be more than the X paid"
if (refund + 0.001 < recovered)   → "X has already been recovered — the refund cannot be less"

retained = paid − refund
full     = refund_type === 'Full Refund'

if ( full && retained > 0.001)    → "A full refund must return the whole X paid"
if (!full && retained ≤ 0.001)    → "A partial refund must be less than the amount paid"
if (retained > 0.001 && (no retained_type || blank retained_remark)) → refuse

return [refund_amount, retained_amount, retained_type, retained_remark]
```

Four guards in a deliberate order: against the ceiling, against the floor, then
the type/arithmetic agreement, then the justification. `retained_type` and
`retained_remark` are **nulled** when nothing is retained, so a stale reason
cannot survive an edit that changed the type to Full.

### `refreshTotals()` — after any recovery change

```php
recovered = Σ recoveries
balance   = max(0, refund_amount − recovered)

status = balance ≤ 0.005 ? RECOVERED
       : (recovered > 0  ? PARTIAL : PENDING)

adj->forceFill([recovered_amount, balance_amount, status])->save();

po.cancel_stage     = (status === RECOVERED) ? CANCEL_CLOSED : CANCEL_INITIATED
po.cancel_closed_at = (status === RECOVERED) ? now() : null
```

**This is the only place `cancel_stage` moves to closed through this path.** The
PO's lifecycle is driven by the adjustment's balance, not the other way round.

Note the asymmetric tolerances: `0.001` on comparisons, `0.005` on the
settled test — half a paisa, so rounding across many recoveries cannot leave an
adjustment permanently one paisa short of closed.

---

## 6. Raising — the transaction

```php
inTransaction('raise the refund adjustment', function () {
    $po = PurchaseOrder::whereKey($id)->lockForUpdate()->first();   // ← LOCK

    if ($po->isCancelled())                        abort
    if (PoRefundAdjustment::where('purchase_order_id', $po->id)->exists()) abort
    $paid = round($po->paid_amount, 2);
    if ($paid <= 0)                                abort

    $figures = $this->figures($data, $paid, 0.0);
    $adj = PoRefundAdjustment::create([... code = nextRefundCode() ...] + $figures);
    $this->refreshTotals($adj);

    PoPaymentRequest::where('purchase_order_id', $po->id)
        ->where('status', STATUS_PENDING)
        ->update(['status' => 'rejected',
                  'decision_note' => 'Closed — PO cancelled (' . $adj->code . ').']);

    $this->svc->releaseAll($po, 'cancelled', $user->id);
    $po->update([... STATUS_CANCELLED, cancel_stage = CANCEL_INITIATED ...]);
}, [$path]);
```

Five invariants, one lock:

1. The PO row is **locked first**; the uniqueness check happens inside it, which is what makes "one adjustment per PO" real rather than a race.
2. `paid_amount` is read inside the lock, so a payment cannot land between the read and the snapshot.
3. Pending requests are closed in the same unit of work.
4. PI reservations released.
5. `[$path]` passes the uploaded attachment, so a rollback deletes it.

---

## 7. Reference-number uniqueness

```php
$ref = mb_strtoupper(trim($data['reference_no']));
$dup = PoRefundRecovery::withoutGlobalScope('tenant')
         ->where('client_id', $adj->client_id)
         ->whereRaw('UPPER(TRIM(reference_no)) = ?', [$ref])
         ->when($existing, fn ($q) => $q->where('id', '!=', $existing->id))
         ->first();
```

- **Client-wide**, not per-adjustment — a UTR is a bank fact, unique everywhere.
- Case- and whitespace-insensitive on both sides.
- The current row is excluded so an edit that keeps its own reference is not a self-collision.
- The message names the holding adjustment, the PO, the amount and the date, because the earlier generic wording *"already used on another recovered payment"* left people hunting (CS-567).

---

## 8. The Zoho lock

```php
private function zohoLockedRecovery(?PoRefundRecovery $r): ?JsonResponse
{
    return $r && ($r->zoho_sync_status === 'synced' || !empty($r->zoho_refund_id))
        ? $this->fail('This refund is already posted to Zoho Books — it can no longer be changed or deleted.')
        : null;
}
```

**Two conditions, deliberately.** `zoho_sync_status` is our bookkeeping;
`zoho_refund_id` is the hard evidence. If a sync succeeded but the status write
failed, the id alone still locks the row — the ledger wins over our flag.

### The adjustment has three locks, and Zoho is the last of them

> **Corrected.** This section previously said only that "amounts are fixed once
> the vendor credit exists in Zoho". That is the third and narrowest lock; two
> others fire earlier.

`update()` tests them in this order, inside a `lockForUpdate()` on the row:

```php
if ($row->status === STATUS_RECOVERED)                        // 1
    abort('Every rupee of this refund has been recovered — it can no longer be changed.');

if ((float) $row->recovered_amount > 0.001                    // 2
    || $row->recoveries()->exists())
    abort('A recovery has already been recorded against this refund — its figures can no longer be changed.');

if ($amountsChanged && $row->zoho_vendorcredit_id)            // 3
    abort('The vendor credit is already in Zoho Books — the refund amount can no longer be changed.');
```

| # | Fires when | Freezes |
|:-:|---|---|
| 1 | Fully recovered | Everything |
| 2 | **Any** recovery exists | Everything — *"recoveries are booked against these figures"* (CS-588) |
| 3 | Credit in Zoho **and** the amount or retained reason changed | **Only** those fields |

Lock 2 is the one that bites in practice, and it is why the list swaps the
pencil for an eye: `isSettled` on the frontend is the same test, shown early.

Lock 3 is deliberately narrow — `$amountsChanged` is computed first, so a
synced adjustment with no recoveries can still have its reason, reference and
attachment edited. "Synced" does not mean "frozen".

---

## 9. Zoho Books mapping

| Ours | Zoho | Method |
|---|---|---|
| Adjustment | **Vendor Credit** | `pushVendorCredit()` |
| Recovery | **Vendor Credit Refund** | `pushRecovery()` |
| Deleted recovery | Refund removed | `removeRecovery()` |

`creditPreview()` renders what *would* be sent, so the operator can check the
lines before pushing.

> **Corrected.** This previously said `zohoSyncRecovery` *requires*
> `zoho_vendorcredit_id`. It does not test it at all.

Ordering is guaranteed a different way: **both sync entry points call
`syncAll()` on the parent PO**, which walks PO → bill → payments → vendor credit
→ refunds in sequence. A refund therefore cannot be created before its credit
because the same run creates the credit first.

```php
// zohoSyncRecovery(), after the chain
if (empty($row->fresh()->zoho_refund_id))
    return $this->fail('This refund was not posted to Zoho Books — try again.');
```

That post-check is the only recovery-specific test, and it runs **after** the
chain, not before it — it reports a refund that did not land, rather than
refusing to try.

---

## 10. Concurrency

| Risk | Guard |
|---|---|
| Two adjustments on one PO | PO `lockForUpdate()`, existence checked inside |
| Payment landing mid-raise | `paid_amount` read inside the same lock |
| Two recoveries over-recovering | `refreshTotals()` recomputes from rows, clamped by `max(0, …)` |
| Editing a synced row | `zohoLockedRecovery()` on every write path |
| Orphan upload after rollback | Paths passed to `inTransaction()` |

---

## 11. Multi-tenancy

`BelongsToTenant` on both tables; `client_id` / `branch_id` copied from the
**PO**, not from the request — the adjustment belongs wherever the order did.

Scope is lifted for: code allocation, the one-per-PO check, the reference
uniqueness sweep, and the pending-request closure — all four are client-wide
questions.

### Authorisation — there is none beyond the tenant

```php
private function tenantUser(Request $request) {
    $user = $request->user();
    if (!$user?->client_id) abort(/* 403 No tenant context */);
    return $user;
}
```

No role test, no module-permission test, and **no approval step** anywhere in
this controller. Any authenticated user with a `client_id` can raise an
adjustment, which cancels a purchase order and writes off money in one
transaction. The menu leaf `p2p.advance_refund` is permission-gated in the UI,
so visibility and capability diverge as they do across the rest of P2P.

Worth recording as a finding rather than relying on it — of the three P2P
modules this is the one where the gap matters most, because the action is both
immediate and irreversible.

---

## 12. Frontend internals

| File | Role |
|---|---|
| `AdvanceRefundAdjustment.tsx` | List, tabs, Zoho Sync column |
| `RefundPoPickerModal.tsx` | Eligible POs |
| `RefundAdjustmentForm.tsx` | Raise / edit, the Full-vs-Partial logic mirrored client-side |
| `AddRecoveryModal.tsx` / `RecoverPaymentModal.tsx` | Recoveries |
| `EvidenceVaultModal.tsx` | Proofs |
| `refund-data.ts` | Shapes and constants |
| `useEscapeClose.ts` | Shared modal behaviour |

The client mirrors the arithmetic rules for immediate feedback; the server is
the authority and re-checks every one of them.

---

## 13. Coupling points

- **Purchase Order** — this module is the only legal way to cancel a paid PO, and it owns `cancel_stage` from then on.
- **Payment Requests** — pending ones are closed when the adjustment is raised.
- **Zoho Books** — vendor credit and refunds; once posted, rows freeze.
- **Proforma Invoice / Shipment** — reservations released on cancellation.
