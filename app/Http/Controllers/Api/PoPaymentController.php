<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PoPayment;
use App\Models\PurchaseOrder;
use App\Models\Vendor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Purchase-Order Payments ("Payment Summary Against PO").
 *
 * Payments are ALWAYS scoped to a Purchase Order — the amount subtracts from
 * the PO's balance, never a separate SPI amount. The same flow is reachable
 * from the PO screen and from the SPI screen (which resolves the SPI's linked
 * PO); `supplier_purchase_invoice_id` only traces the entry point.
 */
class PoPaymentController extends Controller
{
    /* GET /p2p/purchase-orders/{po}/payment-summary
     * Everything the "Payment Summary Against PO" popup renders, for THIS PO. */
    public function summary(Request $request, int $po): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $order = $this->findScoped($po, $user);

        return response()->json(['status' => true, 'data' => $this->buildSummary($order)]);
    }

    /* POST /p2p/purchase-orders/{po}/payment-summary/tds
     * Save the PO-level TDS % (Payment Details row → Save). Recomputes amounts. */
    public function saveTds(Request $request, int $po): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $order = $this->findScoped($po, $user, 'write');

        $data = $request->validate(['tds_percentage' => 'required|numeric|min:0|max:100']);

        // TDS % stays editable until the FIRST payment is recorded — re-saving
        // just recomputes the deduction. Once any payment exists, changing the
        // TDS would desync the already-paid balance, so it locks (QA #15).
        if ($order->payments()->exists()) {
            return response()->json([
                'status'  => false,
                'message' => 'TDS cannot be changed — a payment has already been recorded against this PO.',
            ], 422);
        }
        // It also locks once the bill is synced to Zoho Books: the Zoho bill folds
        // in the TDS as a deduction at sync time, so changing it here afterwards
        // would desync the local net payable from the already-created Zoho bill.
        if (!empty($order->zoho_bill_id)) {
            return response()->json([
                'status'  => false,
                'message' => 'TDS cannot be changed — this PO’s bill is already synced to Zoho Books. Deduct/update the TDS before syncing.',
            ], 422);
        }

        /* TDS is computed on the BASE amount = Total PO − GST − Additional
         * Charges: the taxable value of the GOODS only.
         *
         * `grand_total` = total_product_cost + additional_charges, and
         * total_product_cost already carries the line GST. So subtracting only
         * GST would leave shipping/packaging/other inside the base and levy TDS
         * on them. Those charges are not part of the purchase value — they're
         * added back after the deduction, alongside GST (see buildSummary).
         * Must match buildSummary()'s base exactly or the popup's preview and
         * the saved figure disagree. */
        $gst  = (float) $order->total_cgst + (float) $order->total_sgst;
        $addl = (float) $order->additional_charges;
        $base = (float) $order->grand_total - $gst - $addl;
        $tdsPct = round((float) $data['tds_percentage'], 2);
        $order->tds_percentage = $tdsPct;
        $order->tds_amount = round($base * $tdsPct / 100, 2);
        $order->tds_cut = true;   // mark the one-time TDS deduction as done
        $order->save();

        return response()->json(['status' => true, 'data' => $this->buildSummary($order->fresh())]);
    }

    /* POST /p2p/purchase-orders/{po}/payments  (multipart: proof attachment)
     * Record ONE payment against the PO ("Update PO Payment"). */
    public function store(Request $request, int $po): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $order = $this->findScoped($po, $user, 'write');

        // TDS must be cut once (Payment Details → Save) BEFORE any payment can be
        // recorded — from the PO or the SPI screen. Blocks "Update PO Payment"
        // until the deduction is confirmed. International POs are exempt: GST/TDS
        // don't apply, so a payment can be recorded without cutting TDS first.
        $isIntl = strtolower((string) $order->document_type) === 'international';
        if (!$isIntl && !$order->tds_cut) {
            return response()->json([
                'status'  => false,
                'message' => 'Please cut the TDS first — save the TDS deduction in Payment Details before recording a payment.',
                'errors'  => ['tds' => ['TDS must be cut before payment.']],
            ], 422);
        }

        $data = $request->validate([
            'amount'            => 'required|numeric|min:0.01',
            'bank_name'         => 'nullable|string|max:128',
            // Letters+digits, 6–22 chars — cheque (6 digits) through RTGS UTR (22).
            'utr_cheque_number' => ['nullable', 'string', 'regex:/^[A-Za-z0-9]{6,22}$/'],
            'utr_cheque_date'   => 'nullable|date',
            'status'            => 'nullable|in:Cleared,Pending',
            'attachment'        => 'nullable|file|mimes:pdf,doc,docx,xls,xlsx,jpg,jpeg,png,webp|max:10240',
            // Entry-point trace only (when paid from the SPI screen).
            'supplier_purchase_invoice_id' => 'nullable|integer',
        ]);

        // A UTR / Cheque number is a bank transaction reference — it can back at
        // most one PO payment. Reject a duplicate within this tenant so the same
        // reference can't be recorded against multiple payments (QA #14).
        // Case-insensitive; the model's SoftDeletes scope means a deleted
        // payment's reference is freed for reuse.
        if (!empty($data['utr_cheque_number'])) {
            $dupExists = PoPayment::where('client_id', $order->client_id)
                ->whereRaw('LOWER(utr_cheque_number) = ?', [mb_strtolower($data['utr_cheque_number'])])
                ->exists();
            if ($dupExists) {
                return response()->json([
                    'status'  => false,
                    'message' => 'This UTR / Cheque number has already been used for another PO payment.',
                    'errors'  => ['utr_cheque_number' => ['This UTR / Cheque number has already been used for another PO payment.']],
                ], 422);
            }
        }

        $amount = round((float) $data['amount'], 2);

        // Store the proof up-front so the per-PO lock (below) isn't held during
        // file I/O.
        $path = null;
        if ($request->hasFile('attachment')) {
            $path = $request->file('attachment')->store('po-payments/attachments', 'public');
        }

        // Serialize concurrent payment writes for the same PO so two tabs can't
        // both pass the balance check and over-pay (which would then satisfy the
        // Zoho "fully paid" gate and post duplicate vendor payments).
        $lock = Cache::lock('po:payment:' . $order->id, 10);
        try {
            $lock->block(5);
        } catch (\Illuminate\Contracts\Cache\LockTimeoutException $e) {
            if ($path) Storage::disk('public')->delete($path);
            return response()->json([
                'status'  => false,
                'message' => 'Another payment for this PO is being recorded — please retry in a moment.',
            ], 409);
        }

        try {
            // Guard against over-payment beyond the PO's outstanding balance.
            $paidBefore = (float) $order->payments()->sum('amount');
            $netPayable = $this->netPayable($order);
            $balanceBefore = round($netPayable - $paidBefore, 2);
            if ($amount > $balanceBefore + 0.001) {
                if ($path) Storage::disk('public')->delete($path);
                return response()->json([
                    'status'  => false,
                    'message' => 'Amount exceeds the outstanding PO balance of ' . number_format($balanceBefore, 2) . '.',
                    'errors'  => ['amount' => ['Amount cannot exceed the outstanding balance.']],
                ], 422);
            }

            $payment = PoPayment::create([
                'client_id'         => $order->client_id,
                'branch_id'         => $order->branch_id,
                'purchase_order_id' => $order->id,
                'supplier_purchase_invoice_id' => $data['supplier_purchase_invoice_id'] ?? null,
                'amount'            => $amount,
                'bank_name'         => $data['bank_name'] ?? null,
                'utr_cheque_number' => $data['utr_cheque_number'] ?? null,
                'utr_cheque_date'   => $data['utr_cheque_date'] ?? null,
                'attachment_path'   => $path,
                'balance_after'     => round($balanceBefore - $amount, 2),
                'status'            => $data['status'] ?? 'Cleared',
                'created_by'        => $user->id,
            ]);
        } finally {
            $lock->release();
        }

        return response()->json(['status' => true, 'data' => $this->buildSummary($order->fresh()), 'payment_id' => $payment->id], 201);
    }

    /* DELETE /p2p/purchase-orders/{po}/payments/{payment} — remove a payment. */
    public function destroy(Request $request, int $po, int $payment): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $order = $this->findScoped($po, $user, 'write');

        $row = PoPayment::where('purchase_order_id', $order->id)->findOrFail($payment);
        // A payment already posted to Zoho Books as a vendor payment must not be
        // deleted here: doing so orphans the Zoho payment AND reopens the local
        // balance, letting a later re-sync double-post against the bill. Reverse
        // it in Zoho Books first.
        if ($row->zoho_payment_id || (float) $row->zoho_applied_amount > 0.005) {
            return response()->json([
                'status'  => false,
                'message' => 'This payment is already posted to Zoho Books and can no longer be deleted here — reverse it in Zoho Books instead.',
            ], 422);
        }
        if ($row->attachment_path) {
            Storage::disk('public')->delete($row->attachment_path);
        }
        $row->delete();

        return response()->json(['status' => true, 'data' => $this->buildSummary($order->fresh())]);
    }

    /* ────────────────────────── internals ────────────────────────── */

    /** Net payable = (Base − TDS) + GST + Additional Charges.
     *
     *  Base = Total PO − GST − Additional, so Base + GST + Additional collapses
     *  back to Total PO, leaving net payable = Total PO − TDS. Excluding the
     *  additional charges from the base therefore changes only how much TDS is
     *  deducted (a smaller base ⇒ less TDS) — the supplier is still paid the
     *  full charges, they're simply not taxed at source. */
    private function netPayable(PurchaseOrder $po): float
    {
        return round((float) $po->grand_total - (float) $po->tds_amount, 2);
    }

    /** Assemble the full payment-summary payload for the popup. */
    private function buildSummary(PurchaseOrder $po): array
    {
        $totalPo   = (float) $po->grand_total;
        $gstAmount = round((float) $po->total_cgst + (float) $po->total_sgst, 2);
        /* Base = Total PO − GST − Additional Charges: the taxable value of the
         * GOODS only, which is what TDS is levied on. grand_total bundles
         * shipping/packaging/other on top of the GST-inclusive product cost, so
         * subtracting GST alone would leave those charges in the base and tax
         * them. They are added back after the deduction (see netPayable).
         * Keep in lockstep with saveTds(). */
        $addl      = round((float) $po->additional_charges, 2);
        $base      = round($totalPo - $gstAmount - $addl, 2);
        // GST % is effective-on-goods, so measure it against the goods base.
        $gstPct    = $base > 0 ? round($gstAmount / $base * 100, 2) : 0.0;
        $tdsPct    = (float) $po->tds_percentage;
        $tdsAmount = (float) $po->tds_amount;
        $netPay    = $this->netPayable($po);

        $payments  = $po->payments()->get();
        $amountPaid = round((float) $payments->sum('amount'), 2);
        $balance   = round($netPay - $amountPaid, 2);
        // Progress is measured against the NET PAYABLE (post-TDS) — that's the
        // amount actually owed, so 100% = balance cleared.
        $progress  = $netPay > 0 ? min(100, round($amountPaid / $netPay * 100)) : 0;

        // Source-trace key (backend only): every PO payment belongs to this PO and,
        // when it was recorded via a specific invoice, traces to that SPI. Batch-load
        // the SPI codes so the per-payment mapping stays N+1-free.
        $spiIds   = $payments->pluck('supplier_purchase_invoice_id')->filter()->unique()->values();
        $spiCodes = $spiIds->isNotEmpty()
            ? \App\Models\SupplierPurchaseInvoice::whereIn('id', $spiIds)->pluck('code', 'id')
            : collect();

        return [
            'po' => [
                'id'          => $po->id,
                'code'        => $po->code,
                'pi_number'   => $po->pi_number,
                'status'      => $po->status,
                // Zoho Books bill state — drives the "Sync Payment" button (a
                // payment can only be posted once the bill exists in Zoho).
                'zoho_synced'      => !empty($po->zoho_bill_id),
                'zoho_bill_number' => $po->zoho_bill_number,
                // International POs carry no GST/TDS: the popup freezes the TDS
                // deduction, disables the GST breakdown, and drops the "cut TDS
                // first" gate for both payments and Zoho sync.
                'is_international'  => strtolower((string) $po->document_type) === 'international',
            ],
            'supplier' => $this->supplierBlock($po),
            'amounts'  => [
                'base'       => round($base, 2),
                'gstPct'     => $gstPct,
                'gstAmount'  => $gstAmount,
                /* Excluded from the TDS base and added back after it, so the
                 * popup needs it to preview: net = base − TDS + GST + addl. */
                'additionalCharges' => $addl,
                'totalPo'    => round($totalPo, 2),
                'tdsPct'     => $tdsPct,
                'tdsAmount'  => round($tdsAmount, 2),
                'tdsCut'     => (bool) $po->tds_cut,
                'netPayable' => $netPay,
                'amountPaid' => $amountPaid,
                'balance'    => $balance,
                'paidCount'  => $payments->count(),
                'progressPct' => $progress,
            ],
            'payments' => $payments->values()->map(fn ($p, $i) => [
                'id'                => $p->id,
                'sr'                => $i + 1,
                'amount'            => (float) $p->amount,
                'bank_name'         => $p->bank_name,
                'utr_cheque_number' => $p->utr_cheque_number,
                'utr_cheque_date'   => optional($p->utr_cheque_date)->toDateString(),
                'attachment_url'    => $p->attachment_url,
                'attachment_name'   => $p->attachment_path ? basename($p->attachment_path) : null,
                'balance_after'     => (float) $p->balance_after,
                'status'            => $p->status,
                // Per-entry Zoho Books state — drives the row-level "Sync" button.
                // A payment is synced once its full amount is applied to the bill.
                'zoho_applied'      => round((float) $p->zoho_applied_amount, 2),
                'zoho_synced'       => !empty($p->zoho_payment_id) && ((float) $p->zoho_applied_amount + 0.005) >= (float) $p->amount,
                // Which PO / SPI this payment was made against (+ ids) — backend trace.
                // `type` = the document the payment is booked against: always 'po'
                // here (po_payments); `spi` only traces the invoice it was for.
                'source'            => [
                    'type' => 'po',
                    'po'   => ['id' => $po->id, 'code' => $po->code],
                    'spi'  => $p->supplier_purchase_invoice_id
                        ? ['id' => (int) $p->supplier_purchase_invoice_id, 'code' => $spiCodes[$p->supplier_purchase_invoice_id] ?? null]
                        : null,
                ],
            ]),
        ];
    }

    /** Supplier header block — mirrors PurchaseOrderController::supplier(). */
    private function supplierBlock(PurchaseOrder $po): array
    {
        if (!$po->vendor_id) {
            return ['name' => $po->supplier_name, 'code' => $po->supplier_code];
        }
        $v = Vendor::with(['primaryAddress', 'vendorType', 'gstScrutiny' => fn ($g) => $g->latest('id')])->find($po->vendor_id);
        if (!$v) {
            return ['name' => $po->supplier_name, 'code' => $po->supplier_code];
        }
        $a = $v->primaryAddress;
        // Newest scrutiny = current GST status (order-safe; see PurchaseOrderController).
        $g = $v->gstScrutiny->sortByDesc('id')->first();
        $state = $a && $a->state_id ? DB::table('master_states')->where('id', $a->state_id)->value('name') : null;

        return [
            'name'      => $v->company_name ?: $v->legal_name,
            'code'      => $v->vendor_code,
            'type'      => optional($v->vendorType)->name,
            'state'     => $state,
            'stateCode' => optional($a)->state_code,
            'city'      => optional($a)->city,
            'contact'   => optional($a)->contact_name,
            'phone'     => optional($a)->contact_no,
            'gstNo'     => optional($g)->gst_number,
            'gstStatus' => optional($g)->status,
        ];
    }

    /** Resolve a PO scoped to the caller (tenant + branch), mirroring
     *  PurchaseOrderController::assertScope. `write` blocks cross-branch edits. */
    private function findScoped(int $id, $user, string $action = 'read'): PurchaseOrder
    {
        $po = PurchaseOrder::findOrFail($id);
        if ($user->user_type === 'super_admin') return $po;
        if (!$user->client_id || (int) $po->client_id !== (int) $user->client_id) abort(404);
        if ($user->user_type === 'branch_user' && $user->branch_id
            && (int) $po->branch_id !== (int) $user->branch_id) {
            abort(404);
        }
        return $po;
    }
}
