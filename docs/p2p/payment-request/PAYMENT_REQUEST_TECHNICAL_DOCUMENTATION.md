# P2P Payment Request Management — Technical Documentation

## 1. Stack

| Layer | Technology |
|---|---|
| Backend | PHP 8.2, Laravel 12 |
| Database | PostgreSQL |
| Auth | Sanctum + `user.active` |
| Frontend | React 19 + TypeScript |
| Files | `public` disk, served through `P2pFileController` |
| Accounting | Zoho Books via `PoZohoService` |
| Queue | database driver (proof attachment job) |

---

## 2. Architecture

```
React   PaymentRequestManagement.tsx   (queue, all POs)
        PaymentRequestDetail.tsx       (one request)
        PaymentRequestDecisionModal / DeclineReasonModal
        TxnVaultModal                  (payments + proofs)
  │  axios
  ▼
routes/api.php  →  p2p/orders/{…}/payment-requests, /tds, /payments
  ▼
PoPaymentRequestController  (~797 lines)
  ├─ one-PO face : forPo · saveTds · store · payments · storePayment ·
  │                updatePayment · destroyPayment · zohoSyncPayment
  └─ all-PO face : index · show · decide · decideMany
  ▼
PurchaseOrderService   codes, refreshPaymentTotals()
PoZohoService          postPayments()
  ▼
p2p_po_payment_requests (19 cols) ─1:n─ p2p_po_payments (21 cols)
                     │
                     └─ p2p_purchase_orders.paid_amount / balance_amount
```

---

## 3. Data model

### `p2p_po_payment_requests`

```
id, client_id, branch_id, purchase_order_id, code,
payment_type, percentage, requested_amount, reason,
requested_by, requested_to, requested_at,
status, approved_amount, decision_note, decided_at,
paid_amount, created_at, updated_at
```

`requested_to` is a **user id**, not a role — the decision check is an identity
check.

### `p2p_po_payments`

```
id, client_id, branch_id, purchase_order_id, payment_request_id,
amount, bank_name, utr_cheque_number, utr_cheque_date,
proof_path, proof_name, created_by, updated_by,
created_at, updated_at, deleted_at,
zoho_payment_id, zoho_applied_amount, zoho_sync_status, zoho_synced_at, zoho_error
```

Soft-deleted, so a removed payment leaves a trace. `purchase_order_id` is
denormalised onto the payment so the PO's totals can be rebuilt without joining
through the request.

---

## 4. Code allocation — why `PRQ-001` and not `PRQ/<FY>/<SEQ>`

```php
/**
 * Plain PRQ-001, not PRQ/<FY>/<SEQ> like the documents around it: a payment
 * request is referred to by number in conversation, and the financial year
 * added length without telling anyone anything the request date does not.
 * The sequence therefore runs on and never restarts, or April would hand out
 * a PRQ-001 that already exists.
 */
public function nextPaymentRequestCode(int $clientId): string
```

One running serial per client, allocated inside the transaction, tenant scope
lifted so a branch cannot reuse another branch's number.

---

## 5. The money invariant

```
request.paid_amount  = Σ payments WHERE payment_request_id = request.id
po.paid_amount       = Σ payments WHERE purchase_order_id  = po.id
po.balance_amount    = po.net_payable − po.paid_amount
```

All three are **stored columns**, and all three are rebuilt by
`PurchaseOrderService::refreshPaymentTotals()` **inside the same transaction**
as any create, edit or delete of a payment.

The denormalisation exists because the PO list must show a balance per row
without aggregating payments; the rebuild-in-transaction rule is what keeps it
from drifting.

---

## 6. The two approval ceilings

```php
// 1. never more than requested
if ($approved > $row->requested_amount + 0.001) …

// 2. never more than the PO's remaining headroom
$held = PoPaymentRequest::where('purchase_order_id', $po->id)
          ->where('id', '!=', $row->id)
          ->where('status', STATUS_APPROVED)
          ->selectRaw('COALESCE(SUM(GREATEST(approved_amount, paid_amount)), 0)')
          ->value('s');
$open = $po->grand_total - $po->tds_amount - $held;
if ($approved > $open + 0.001) …
```

`GREATEST(approved_amount, paid_amount)` is the detail to understand: if a
request was approved for 50,000 but 60,000 was somehow paid against it, the
headroom calculation must use the **larger** figure, or the PO could be
over-committed by the difference.

The `0.001` tolerances throughout are float-comparison guards on money values.

---

## 7. Authorisation — identity, not role

```php
if ((int) $row->requested_to !== (int) $user->id)
    return $no('Only the person this request was sent to can decide it.');
```

Not a permission check, not a role check. The request names one person and only
that person can decide it. A client admin with every permission still cannot.

At raise time the approver is validated three ways: active user of the client,
not a `client_admin`, and in the PO's branch.

---

## 8. Validation constants

```php
private const PROOF_RULE = 'file|max:10240|mimes:pdf,doc,docx,xls,xlsx,jpg,jpeg,png,webp';
private const UTR_RULE   = ['nullable', 'string', 'regex:/^[A-Za-z0-9]{6,22}$/'];
public  const TDS_MAX_PCT = 40.0;
```

The UTR range covers a 6-digit cheque number through a 22-character RTGS UTR —
letters and digits only.

---

## 9. TDS derivation

```php
$base   = round($order->taxable_total, 2);
$amount = isset($data['tds_amount'])
        ? round($data['tds_amount'], 2)              // the amount as typed
        : round($base * $data['tds_percentage'] / 100, 2);
$pct    = $base > 0 ? round($amount / $base * 100, 2) : 0;

if ($amount > $base + 0.001)        → refuse
if ($pct > TDS_MAX_PCT + 0.001)     → refuse
```

Whichever field was typed wins; the other is derived. **The 40% cap is applied
to the derived percentage**, so an amount above 40% is refused with the same
message — "an amount above 40% is the same deduction".

---

## 10. Concurrency

| Risk | Guard |
|---|---|
| Two approvals pushing the PO over its value | Headroom read inside the decision transaction |
| Double decision | `status !== pending` re-checked inside the transaction |
| Totals drifting from the payment rows | `refreshPaymentTotals()` in the same transaction as every write |
| Orphaned upload after a rollback | `RunsInTransaction` deletes files passed to it on failure |

---

## 11. Multi-tenancy

`BelongsToTenant` global scope on both tables. Writes always take
`client_id` / `branch_id` from the authenticated user.

The scope is lifted in exactly three places, each with a reason:

| Lift | Why |
|---|---|
| Code allocation | The sequence is client-wide |
| Headroom sum | Must see every approved request on the PO, whatever branch |
| PO lookup during a decision | The request already proved tenancy; the PO is reached by id |

`scopedRequests()` builds the queue query with the tenant join explicit, and the
four tabs are SQL conditions:

```php
'all' => 'TRUE', 'awaiting' => "r.status = 'pending'",
'approved' => "r.status = 'approved'", 'declined' => "r.status = 'rejected'",
```

---

## 12. Zoho Books coupling

A payment becomes a Zoho **vendor payment** applied to the PO's bill:

```php
'vendor_id' => ..., 'payment_mode' => 'banktransfer',
'amount' => $amt, 'date' => $p->utr_cheque_date ?? $p->created_at,
'paid_through_account_id' => resolvePaidThroughAccountId($p->bank_name),
'bills' => [['bill_id' => $po->zoho_bill_id, 'amount_applied' => $amt]],
'reference_number' => $p->utr_cheque_number,
```

Then `AttachPoPaymentProofToZoho` is **queued** to attach the proof to the bill.
Being queued, it needs a worker running; without one the payment syncs and the
proof silently does not.

Failures write `zoho_sync_status = 'failed'` and `zoho_error` on the payment row,
so the state is visible rather than lost in a log.

---

## 13. Frontend internals

| File | Role |
|---|---|
| `PaymentRequestManagement.tsx` | Queue: tabs, search, pager |
| `PaymentRequestDetail.tsx` | One request in full |
| `PaymentRequestDecisionModal.tsx` | Approve with amount + remark |
| `DeclineReasonModal.tsx` | Reject with reason |
| `TxnVaultModal.tsx` | Payments and their proofs |
| `paymentRequestData.ts`, `payment-request-suppliers.ts` | Shapes and lookups |

---

## 14. Coupling points

- **Purchase Order** owns `grand_total`, `tds_amount` and the stored paid/balance figures this module rewrites.
- **Refund Adjustment** force-rejects pending requests when it cancels the PO.
- **Zoho Books** needs the bill before any payment can post.
