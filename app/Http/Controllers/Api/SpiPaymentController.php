<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SpiPayment;
use App\Models\SupplierPurchaseInvoice;
use App\Models\Vendor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Direct-SPI Payments ("Payment Summary Against SPI").
 *
 * A Direct SPI (Supplier Purchase Invoice with no linked PO) is payable against
 * its OWN net-payable amount. This mirrors PoPaymentController but is scoped to
 * the SPI: TDS is cut once on the base (net_payable − GST − additional charges,
 * i.e. the goods value only), and payments live in spi_payments. (With-PO SPIs
 * pay through the PO instead — that flow is unchanged.)
 */
class SpiPaymentController extends Controller
{
    /* GET /p2p/supplier-purchase-invoices/{spi}/payment-summary */
    public function summary(Request $request, int $spi): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $inv = $this->findScoped($spi, $user);

        return response()->json(['status' => true, 'data' => $this->buildSummary($inv)]);
    }

    /* POST /p2p/supplier-purchase-invoices/{spi}/payment-summary/tds
     * Save the SPI-level TDS % (Payment Details row → Deduct). Recomputes amounts. */
    public function saveTds(Request $request, int $spi): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $inv = $this->findScoped($spi, $user, 'write');

        $data = $request->validate(['tds_percentage' => 'required|numeric|min:0|max:100']);

        // TDS is cut exactly ONCE per SPI — block any re-cut once it's done.
        if ($inv->tds_cut) {
            return response()->json([
                'status'  => false,
                'message' => 'TDS is already deducted for this SPI — it cannot be changed.',
            ], 422);
        }

        // TDS is computed on the BASE = goods value only. net_payable is
        // (goods + GST) + additional charges, so BOTH GST and the charges come
        // out of the base — TDS is never levied on shipping/packaging/other.
        // Must match buildSummary()'s base exactly or the popup preview and the
        // stored figure would disagree (mirrors PoPaymentController::saveTds).
        $gst  = (float) $inv->total_cgst + (float) $inv->total_sgst + (float) $inv->total_igst;
        $addl = (float) $inv->additional_charges;
        $base = (float) $inv->net_payable - $gst - $addl;
        $tdsPct = round((float) $data['tds_percentage'], 2);
        $inv->tds_percentage = $tdsPct;
        $inv->tds_amount = round($base * $tdsPct / 100, 2);
        $inv->tds_cut = true;
        $inv->save();

        return response()->json(['status' => true, 'data' => $this->buildSummary($inv->fresh())]);
    }

    /* POST /p2p/supplier-purchase-invoices/{spi}/payments  (multipart: proof)
     * Record ONE payment against the SPI ("Update SPI Payment"). */
    public function store(Request $request, int $spi): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $inv = $this->findScoped($spi, $user, 'write');

        // TDS must be cut once before any payment can be recorded.
        if (!$inv->tds_cut) {
            return response()->json([
                'status'  => false,
                'message' => 'Please deduct the TDS first — save the TDS deduction in Payment Details before recording a payment.',
                'errors'  => ['tds' => ['TDS must be deducted before payment.']],
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
        ]);

        // Guard against over-payment beyond the SPI's outstanding balance.
        $amount = round((float) $data['amount'], 2);
        $paidBefore = (float) $inv->spiPayments()->sum('amount');
        $netPayable = $this->netPayable($inv);
        $balanceBefore = round($netPayable - $paidBefore, 2);
        if ($amount > $balanceBefore + 0.001) {
            return response()->json([
                'status'  => false,
                'message' => 'Amount exceeds the outstanding SPI balance of ' . number_format($balanceBefore, 2) . '.',
                'errors'  => ['amount' => ['Amount cannot exceed the outstanding balance.']],
            ], 422);
        }

        $path = null;
        if ($request->hasFile('attachment')) {
            $path = $request->file('attachment')->store('spi-payments/attachments', 'public');
        }

        $payment = SpiPayment::create([
            'client_id'         => $inv->client_id,
            'branch_id'         => $inv->branch_id,
            'supplier_purchase_invoice_id' => $inv->id,
            'amount'            => $amount,
            'bank_name'         => $data['bank_name'] ?? null,
            'utr_cheque_number' => $data['utr_cheque_number'] ?? null,
            'utr_cheque_date'   => $data['utr_cheque_date'] ?? null,
            'attachment_path'   => $path,
            'balance_after'     => round($balanceBefore - $amount, 2),
            'status'            => $data['status'] ?? 'Cleared',
            'created_by'        => $user->id,
        ]);

        // Keep the SPI's stored paid/balance columns in sync with the ledger.
        $paidAfter = round($paidBefore + $amount, 2);
        $inv->update([
            'total_paid' => $paidAfter,
            'balance'    => round($netPayable - $paidAfter, 2),
        ]);

        return response()->json(['status' => true, 'data' => $this->buildSummary($inv->fresh()), 'payment_id' => $payment->id], 201);
    }

    /* DELETE /p2p/supplier-purchase-invoices/{spi}/payments/{payment} */
    public function destroy(Request $request, int $spi, int $payment): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $inv = $this->findScoped($spi, $user, 'write');

        $row = SpiPayment::where('supplier_purchase_invoice_id', $inv->id)->findOrFail($payment);
        if ($row->attachment_path) {
            Storage::disk('public')->delete($row->attachment_path);
        }
        $row->delete();

        $paidAfter = round((float) $inv->spiPayments()->sum('amount'), 2);
        $inv->update(['total_paid' => $paidAfter, 'balance' => round($this->netPayable($inv) - $paidAfter, 2)]);

        return response()->json(['status' => true, 'data' => $this->buildSummary($inv->fresh())]);
    }

    /* ────────────────────────── internals ────────────────────────── */

    /** Net payable = SPI total (net_payable, GST-inclusive) − TDS. */
    private function netPayable(SupplierPurchaseInvoice $inv): float
    {
        return round((float) $inv->net_payable - (float) $inv->tds_amount, 2);
    }

    /** Assemble the full payment-summary payload for the popup. */
    private function buildSummary(SupplierPurchaseInvoice $inv): array
    {
        $totalSpi  = (float) $inv->net_payable;   // SPI grand total (GST + charges incl.)
        $gstAmount = round((float) $inv->total_cgst + (float) $inv->total_sgst + (float) $inv->total_igst, 2);
        // Base = goods value only. net_payable = (goods + GST) + additional charges,
        // so BOTH GST and the charges come out of the base — TDS is levied on the
        // goods value alone (mirrors PoPaymentController::buildSummary). Subtracting
        // GST alone would leave shipping/packaging/other inside the base and tax them.
        $addl      = round((float) $inv->additional_charges, 2);
        $base      = round($totalSpi - $gstAmount - $addl, 2);
        $gstPct    = $base > 0 ? round($gstAmount / $base * 100, 2) : 0.0;
        $tdsPct    = (float) $inv->tds_percentage;
        $tdsAmount = (float) $inv->tds_amount;
        $netPay    = $this->netPayable($inv);

        $payments  = $inv->spiPayments()->get();
        $amountPaid = round((float) $payments->sum('amount'), 2);
        $balance   = round($netPay - $amountPaid, 2);
        $progress  = $netPay > 0 ? min(100, round($amountPaid / $netPay * 100)) : 0;

        return [
            'po' => [
                'id'        => $inv->id,
                'code'      => $inv->code,
                'pi_number' => $inv->pi_number,
                'status'    => $inv->status,
            ],
            'supplier' => $this->supplierBlock($inv),
            'amounts'  => [
                'base'        => round($base, 2),
                'gstPct'      => $gstPct,
                'gstAmount'   => $gstAmount,
                // Charges sit OUTSIDE the base; the popup adds them back into net
                // payable (base + GST + additionalCharges − TDS), same as the PO.
                'additionalCharges' => $addl,
                'totalPo'     => round($totalSpi, 2),
                'tdsPct'      => $tdsPct,
                'tdsAmount'   => round($tdsAmount, 2),
                'tdsCut'      => (bool) $inv->tds_cut,
                'netPayable'  => $netPay,
                'amountPaid'  => $amountPaid,
                'balance'     => $balance,
                'paidCount'   => $payments->count(),
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

    /** Supplier header block — mirrors PoPaymentController::supplierBlock(). */
    private function supplierBlock(SupplierPurchaseInvoice $inv): array
    {
        if (!$inv->vendor_id) {
            return ['name' => $inv->supplier_name, 'code' => $inv->supplier_code];
        }
        $v = Vendor::with(['primaryAddress', 'vendorType', 'gstScrutiny' => fn ($g) => $g->latest('id')])->find($inv->vendor_id);
        if (!$v) {
            return ['name' => $inv->supplier_name, 'code' => $inv->supplier_code];
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

    /** Resolve an SPI scoped to the caller (tenant + branch). */
    private function findScoped(int $id, $user, string $action = 'read'): SupplierPurchaseInvoice
    {
        $inv = SupplierPurchaseInvoice::findOrFail($id);
        if ($user->user_type === 'super_admin') return $inv;
        if (!$user->client_id || (int) $inv->client_id !== (int) $user->client_id) abort(404);
        if ($user->user_type === 'branch_user' && $user->branch_id
            && (int) $inv->branch_id !== (int) $user->branch_id) {
            abort(404);
        }
        return $inv;
    }
}
