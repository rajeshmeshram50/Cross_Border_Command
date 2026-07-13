<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PoPayment;
use App\Models\PurchaseOrder;
use App\Models\Vendor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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

        // TDS is cut exactly ONCE per PO — block any re-cut once it's done.
        if ($order->tds_cut) {
            return response()->json([
                'status'  => false,
                'message' => 'TDS is already cut for this PO — it cannot be changed.',
            ], 422);
        }

        // TDS is computed on the BASE amount (taxable value, excluding GST).
        $base = (float) $order->total_product_cost;
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
        // until the deduction is confirmed.
        if (!$order->tds_cut) {
            return response()->json([
                'status'  => false,
                'message' => 'Please cut the TDS first — save the TDS deduction in Payment Details before recording a payment.',
                'errors'  => ['tds' => ['TDS must be cut before payment.']],
            ], 422);
        }

        $data = $request->validate([
            'amount'            => 'required|numeric|min:0.01',
            'bank_name'         => 'nullable|string|max:128',
            'utr_cheque_number' => 'nullable|string|max:64',
            'utr_cheque_date'   => 'nullable|date',
            'status'            => 'nullable|in:Cleared,Pending',
            'attachment'        => 'nullable|file|mimes:pdf,doc,docx,xls,xlsx,jpg,jpeg,png,webp|max:10240',
            // Entry-point trace only (when paid from the SPI screen).
            'supplier_purchase_invoice_id' => 'nullable|integer',
        ]);

        // Guard against over-payment beyond the PO's outstanding balance.
        $amount = round((float) $data['amount'], 2);
        $paidBefore = (float) $order->payments()->sum('amount');
        $netPayable = $this->netPayable($order);
        $balanceBefore = round($netPayable - $paidBefore, 2);
        if ($amount > $balanceBefore + 0.001) {
            return response()->json([
                'status'  => false,
                'message' => 'Amount exceeds the outstanding PO balance of ' . number_format($balanceBefore, 2) . '.',
                'errors'  => ['amount' => ['Amount cannot exceed the outstanding balance.']],
            ], 422);
        }

        $path = null;
        if ($request->hasFile('attachment')) {
            $path = $request->file('attachment')->store('po-payments/attachments', 'public');
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

        return response()->json(['status' => true, 'data' => $this->buildSummary($order->fresh()), 'payment_id' => $payment->id], 201);
    }

    /* DELETE /p2p/purchase-orders/{po}/payments/{payment} — remove a payment. */
    public function destroy(Request $request, int $po, int $payment): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $order = $this->findScoped($po, $user, 'write');

        $row = PoPayment::where('purchase_order_id', $order->id)->findOrFail($payment);
        if ($row->attachment_path) {
            Storage::disk('public')->delete($row->attachment_path);
        }
        $row->delete();

        return response()->json(['status' => true, 'data' => $this->buildSummary($order->fresh())]);
    }

    /* ────────────────────────── internals ────────────────────────── */

    /** Net payable = (Base + GST) − TDS.
     *  TDS is cut on the BASE (taxable value, excl. GST); GST is added back on
     *  the post-TDS base → (base − tds) + gst = base + gst − tds. */
    private function netPayable(PurchaseOrder $po): float
    {
        $baseGst = (float) $po->total_product_cost + (float) $po->total_cgst + (float) $po->total_sgst;
        return round($baseGst - (float) $po->tds_amount, 2);
    }

    /** Assemble the full payment-summary payload for the popup. */
    private function buildSummary(PurchaseOrder $po): array
    {
        $base      = (float) $po->total_product_cost;
        $gstAmount = round((float) $po->total_cgst + (float) $po->total_sgst, 2);
        $totalPo   = (float) $po->grand_total;
        $gstPct    = $base > 0 ? round($gstAmount / $base * 100, 2) : 0.0;
        $tdsPct    = (float) $po->tds_percentage;
        $tdsAmount = (float) $po->tds_amount;
        $netPay    = $this->netPayable($po);

        $payments  = $po->payments()->get();
        $amountPaid = round((float) $payments->sum('amount'), 2);
        $balance   = round($netPay - $amountPaid, 2);
        $progress  = $totalPo > 0 ? min(100, round($amountPaid / $totalPo * 100)) : 0;

        return [
            'po' => [
                'id'        => $po->id,
                'code'      => $po->code,
                'pi_number' => $po->pi_number,
                'status'    => $po->status,
            ],
            'supplier' => $this->supplierBlock($po),
            'amounts'  => [
                'base'       => round($base, 2),
                'gstPct'     => $gstPct,
                'gstAmount'  => $gstAmount,
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
        $g = $v->gstScrutiny->first();
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
