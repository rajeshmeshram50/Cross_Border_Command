<?php

namespace App\Services\P2p;

use App\Models\P2p\PoPayment;
use App\Models\P2p\PoRefundAdjustment;
use App\Models\P2p\PoRefundRecovery;
use App\Models\P2p\PurchaseOrder;
use App\Models\Vendor;
use App\Services\ZohoBooksService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Zoho Books for the P2P PO (same flow as the old PO module):
 *   PO → Zoho purchase order + bill; each payment → vendor payment against the bill.
 * Cancelling with money released:
 *   refund adjustment → vendor credit for the PO's items, applied to the bill's open balance;
 *   each recovery → vendor-credit refund, so the supplier's account ends at zero.
 * Every method throws RuntimeException with a message fit for the user.
 */
class PoZohoService
{
    /** The single line every advance-refund vendor credit is raised on. */
    private const CREDIT_ITEM = 'Advance Refund Adjustment';

    public function __construct(private ZohoBooksService $books) {}

    public function configured(): bool
    {
        return $this->books->isConfigured();
    }

    /* ══════════════════════════ THE WHOLE CHAIN ══════════════════════════ */

    /**
     * Everything this PO still owes Zoho, in order — PO + bill, its payments, the
     * cancellation's vendor credit applied to the bill, then each recovery's refund.
     * Every Zoho Sync button runs this, so pressing any of them leaves the books complete.
     * Each step is idempotent: what is already there is reused, never created twice.
     *
     * @return array{bill_number:string, already:bool, pushed:int, applied:float, credit:?string, refunds:int}
     */
    public function syncAll(PurchaseOrder $po, ?int $userId): array
    {
        $this->assertConfigured();
        $out = $this->syncPo($po, $userId) + ['credit' => null, 'refunds' => 0];

        // Scoped to the PO's own tenant and branch, live rows only — the sync runs
        // outside the global scope, so the filter is spelled out here.
        $adj = PoRefundAdjustment::withoutGlobalScope('tenant')
            ->where('client_id', $po->client_id)
            ->where('purchase_order_id', $po->id)
            ->latest('id')->first();
        if (!$adj) return $out;

        $this->pushVendorCredit($adj, $userId);
        $adj->refresh();
        $out['credit'] = (string) $adj->zoho_vendorcredit_number;
        $pending = $adj->recoveries()->withoutGlobalScope('tenant')
            ->where('client_id', $adj->client_id)
            ->whereNull('zoho_refund_id')
            ->orderBy('id')->get();
        foreach ($pending as $rec) {
            $this->pushRecovery($rec, $userId);
            $out['refunds']++;
        }
        return $out;
    }

    /** One line for the toast: what this run actually did in Zoho. */
    public function summary(array $r): string
    {
        $parts = ['bill ' . ($r['bill_number'] ?? '—')];
        if (($r['pushed'] ?? 0) > 0) $parts[] = $r['pushed'] . ' payment(s) of ₹' . number_format((float) $r['applied'], 2);
        if (!empty($r['credit'])) $parts[] = 'vendor credit ' . $r['credit'];
        if (($r['refunds'] ?? 0) > 0) $parts[] = $r['refunds'] . ' refund(s)';
        return implode(', ', $parts);
    }

    /* ══════════════════════════ PO + BILL ══════════════════════════ */

    /**
     * Create the Zoho PO and bill (once), then post any unposted payments.
     * All-or-nothing for PO + bill: whatever this run created is deleted on failure.
     *
     * @return array{bill_number:string, pushed:int, applied:float, already:bool}
     */
    public function syncPo(PurchaseOrder $po, ?int $userId): array
    {
        $this->assertConfigured();
        return $this->withLock('zoho:p2p:po:' . $po->id, function () use ($po, $userId) {
            $po->refresh();
            if (!empty($po->zoho_bill_id)) {
                $pay = $this->postPayments($po);
                return ['bill_number' => (string) ($po->zoho_bill_number ?: $po->zoho_bill_id), 'already' => true] + $pay;
            }
            $this->assertSyncable($po);

            $createdPo = null;
            $createdBill = null;
            try {
                $ctx = $this->context($po);
                $zohoPoId = (string) $po->zoho_purchaseorder_id;
                $poLineIds = [];
                if ($zohoPoId === '') {
                    $created = $this->books->createPurchaseOrder($this->poPayload($po, $ctx));
                    $zohoPoId = $createdPo = (string) $created['purchaseorder_id'];
                    $poLineIds = collect($created['line_items'] ?? [])->pluck('line_item_id')->map(fn ($x) => (string) $x)->all();
                    // A draft Zoho PO cannot be billed.
                    try { $this->books->markPurchaseOrderOpen($zohoPoId); }
                    catch (\Throwable $e) { Log::warning('P2P Zoho: mark PO open failed', ['po' => $po->id, 'err' => $e->getMessage()]); }
                }

                $bill = $this->books->createBill($this->billPayload($po, $ctx, $poLineIds));
                $createdBill = (string) $bill['bill_id'];

                $po->forceFill([
                    'zoho_status'           => 'synced',
                    'zoho_purchaseorder_id' => $zohoPoId,
                    'zoho_bill_id'          => $createdBill,
                    'zoho_bill_number'      => (string) ($bill['bill_number'] ?? $po->code),
                    'zoho_synced_at'        => now(),
                    'zoho_error'            => null,
                    'updated_by'            => $userId ?? $po->updated_by,
                ])->save();
            } catch (\Throwable $e) {
                if ($createdBill) $this->quietly(fn () => $this->books->deleteBill($createdBill), 'bill delete');
                if ($createdPo) $this->quietly(fn () => $this->books->deletePurchaseOrder($createdPo), 'PO delete');
                $po->forceFill(['zoho_status' => 'failed', 'zoho_error' => $e->getMessage()])->save();
                throw new RuntimeException($this->clean($e));
            }

            // Payments are best-effort: the bill stays even if one fails, and the row shows why.
            $pay = ['pushed' => 0, 'applied' => 0.0];
            try { $pay = $this->postPayments($po->fresh()); }
            catch (\Throwable $e) { Log::warning('P2P Zoho: payment posting after bill failed', ['po' => $po->id, 'err' => $e->getMessage()]); }

            return ['bill_number' => (string) $po->zoho_bill_number, 'already' => false] + $pay;
        });
    }

    /**
     * Post unposted payments (or one) to the PO's bill as vendor payments.
     * Idempotent through zoho_applied_amount; capped at the bill's open balance.
     *
     * @return array{pushed:int, applied:float}
     */
    public function postPayments(PurchaseOrder $po, ?int $onlyPaymentId = null): array
    {
        $result = ['pushed' => 0, 'applied' => 0.0];
        if (empty($po->zoho_bill_id)) return $result;

        $payments = PoPayment::withoutGlobalScope('tenant')->where('purchase_order_id', $po->id)
            ->whereColumn('zoho_applied_amount', '<', 'amount')
            ->when($onlyPaymentId, fn ($q) => $q->where('id', $onlyPaymentId))
            ->orderBy('id')->get();
        if ($payments->isEmpty()) return $result;

        if (!$this->books->resolvePaidThroughAccountId(null)) {
            throw new RuntimeException('Zoho Books has no bank or cash account to pay from — add one in Zoho, then sync the payments.');
        }
        $ctx = $this->context($po);
        $remaining = round((float) ($this->books->getBill((string) $po->zoho_bill_id)['balance'] ?? 0), 2);

        foreach ($payments as $p) {
            $amt = round(min((float) $p->amount - (float) $p->zoho_applied_amount, $remaining), 2);
            if ($amt <= 0.005) continue;
            $date = optional($p->utr_cheque_date)->toDateString() ?: optional($p->created_at)->toDateString() ?: now()->toDateString();
            $payload = [
                'vendor_id'               => $ctx['vendor_id'],
                'payment_mode'            => 'banktransfer',
                'amount'                  => $amt,
                'date'                    => $date,
                'paid_through_account_id' => $this->books->resolvePaidThroughAccountId($p->bank_name),
                'bills'                   => [['bill_id' => (string) $po->zoho_bill_id, 'amount_applied' => $amt]],
                'description'             => implode(' · ', array_filter(['PO ' . $po->code, $p->bank_name ? 'Bank: ' . $p->bank_name : null])),
            ];
            if ($p->utr_cheque_number) $payload['reference_number'] = (string) $p->utr_cheque_number;
            if ($ctx['exchange_rate']) $payload['exchange_rate'] = $ctx['exchange_rate'];

            try {
                $zpay = $this->books->recordVendorPayment($payload);
            } catch (\Throwable $e) {
                $p->forceFill(['zoho_sync_status' => 'failed', 'zoho_error' => $this->clean($e)])->saveQuietly();
                throw new RuntimeException($this->clean($e));
            }
            $p->forceFill([
                'zoho_payment_id'     => (string) ($zpay['payment_id'] ?? $p->zoho_payment_id),
                'zoho_applied_amount' => round((float) $p->zoho_applied_amount + $amt, 2),
                'zoho_sync_status'    => 'synced',
                'zoho_synced_at'      => now(),
                'zoho_error'          => null,
            ])->saveQuietly();

            $remaining = round($remaining - $amt, 2);
            $result['pushed']++;
            $result['applied'] = round($result['applied'] + $amt, 2);
        }
        return $result;
    }

    /* ══════════════════════════ REFUND: VENDOR CREDIT ══════════════════════════ */

    /**
     * Vendor credit for all the PO's items (charges added; TDS and the retained amount deducted),
     * applied to the bill's open balance. What stays open on it is the refund owed.
     */
    public function pushVendorCredit(PoRefundAdjustment $adj, ?int $userId): void
    {
        $this->assertConfigured();
        $this->withLock('zoho:p2p:adr:' . $adj->id, function () use ($adj, $userId) {
            $adj->refresh();
            $po = PurchaseOrder::withoutGlobalScope('tenant')->with('items')->findOrFail($adj->purchase_order_id);
            try {
                // The credit reverses the bill, so the PO and its payments go to Zoho first.
                if (empty($po->zoho_bill_id)) $this->syncPo($po, $userId);
                else $this->postPayments($po);
                $po->refresh();

                $ctx = $this->context($po);
                $vcId = (string) $adj->zoho_vendorcredit_id;
                if ($vcId === '') {
                    $vc = $this->books->createVendorCredit($this->vendorCreditPayload($adj, $po, $ctx));
                    $vcId = $vc['vendor_credit_id'];
                    $adj->forceFill([
                        'zoho_vendorcredit_id'     => $vcId,
                        'zoho_vendorcredit_number' => (string) ($vc['vendor_credit_number'] ?? $adj->code),
                    ])->save();
                }

                // Not applied to the bill: the credit stands for money already released,
                // so the whole of it has to come back in cash, refund by refund.
                $adj->forceFill([
                    'zoho_sync_status'    => 'synced',
                    'zoho_synced_at'      => now(),
                    'zoho_error'          => null,
                ])->save();
            } catch (\Throwable $e) {
                $adj->forceFill(['zoho_sync_status' => 'failed', 'zoho_error' => $this->clean($e)])->save();
                throw new RuntimeException($this->clean($e));
            }
        });
    }

    /**
     * Exactly what the vendor credit carries — the PO's lines, the single adjustment
     * (charges less TDS, less what the supplier keeps) and the credit total, worked out
     * from our own data. Nothing is asked of Zoho, so it also answers before a sync.
     */
    public function creditPreview(PoRefundAdjustment $adj): array
    {
        $po = PurchaseOrder::withoutGlobalScope('tenant')->with('items')->findOrFail($adj->purchase_order_id);
        $items = $po->items()->get();
        $meta = DB::table('products as p')
            ->leftJoin('master_uom as u', 'u.id', '=', 'p.uom_id')
            ->leftJoin('master_hsn_codes as h', 'h.id', '=', 'p.hsn_id')
            ->whereIn('p.id', $items->pluck('product_id')->filter()->unique()->all())
            ->get(['p.id', 'p.name', 'p.product_code', 'u.short_code', 'u.title', 'h.hsn_code'])
            ->keyBy('id');

        $lines = $items->values()->map(function ($it) use ($meta) {
            $m = $meta[(int) $it->product_id] ?? null;
            $qty = (float) $it->quantity;
            $rate = (float) $it->rate;
            $gst = (float) $it->gst_pct;
            $taxable = round($qty * $rate, 2);
            return [
                'name'        => (string) ($m->name ?? $m->product_code ?? 'Item'),
                'code'        => (string) ($m->product_code ?? ''),
                'description' => trim((string) $it->description),
                'hsn'         => (string) ($m->hsn_code ?? ''),
                'unit'        => (string) ($m ? ($m->short_code ?: $m->title) : ''),
                'quantity'    => $qty,
                'rate'        => $rate,
                'gst_pct'     => $gst,
                'taxable'     => $taxable,
                'tax'         => round($taxable * $gst / 100, 2),
                'amount'      => round($taxable * (1 + $gst / 100), 2),
            ];
        })->all();

        $charges = $this->charges($po);
        $tds = $this->tds($po);
        $paid = round((float) $adj->paid_amount, 2);
        $retained = round((float) $adj->retained_amount, 2);
        $poTotal = round((float) $po->grand_total, 2);

        return [
            'po'        => $po,
            'lines'     => $lines,
            'sub_total' => round(array_sum(array_column($lines, 'taxable')), 2),
            'tax_total' => round(array_sum(array_column($lines, 'tax')), 2),
            'charges'   => $charges,
            'tds'       => $tds,
            // The credit's own figures: raised on what was released, less what is kept.
            'po_total'  => $poTotal,
            'net'       => round($poTotal - $tds, 2),
            'paid'      => $paid,
            'retained'  => $retained,
            'total'     => round($paid - $retained, 2),
            'tax_mode'  => $po->document_type === 'international' ? 'export' : ((string) $po->tax_mode ?: 'intra'),
        ];
    }

    /* ══════════════════════════ REFUND: RECOVERY ══════════════════════════ */

    /** Money received back → a refund against the vendor credit (credit created first if missing). */
    public function pushRecovery(PoRefundRecovery $rec, ?int $userId): void
    {
        $this->assertConfigured();
        $adj = PoRefundAdjustment::withoutGlobalScope('tenant')->findOrFail($rec->refund_adjustment_id);
        if (empty($adj->zoho_vendorcredit_id) || $adj->zoho_sync_status !== 'synced') {
            $this->pushVendorCredit($adj, $userId);
            $adj->refresh();
        }

        $this->withLock('zoho:p2p:rec:' . $rec->id, function () use ($rec, $adj) {
            $rec->refresh();
            if (!empty($rec->zoho_refund_id)) return;
            try {
                $account = $this->books->resolvePaidThroughAccountId(null);
                if (!$account) throw new RuntimeException('Zoho Books has no bank account to receive the refund into — add one in Zoho, then sync.');
                $po = PurchaseOrder::withoutGlobalScope('tenant')->find($rec->purchase_order_id);
                $payload = [
                    'date'        => optional($rec->recovered_date)->toDateString() ?: now()->toDateString(),
                    'amount'      => round((float) $rec->amount, 2),
                    'account_id'  => $account,
                    'refund_mode' => 'banktransfer',
                    'description' => 'Advance refund ' . $adj->code . ($po ? ' · PO ' . $po->code : ''),
                ];
                if ($rec->reference_no) $payload['reference_number'] = (string) $rec->reference_no;
                $node = $this->books->refundVendorCredit((string) $adj->zoho_vendorcredit_id, $payload);
                $rec->forceFill([
                    'zoho_refund_id'   => $node['vendor_credit_refund_id'],
                    'zoho_sync_status' => 'synced',
                    'zoho_synced_at'   => now(),
                    'zoho_error'       => null,
                ])->save();
            } catch (\Throwable $e) {
                $rec->forceFill(['zoho_sync_status' => 'failed', 'zoho_error' => $this->clean($e)])->save();
                throw new RuntimeException($this->clean($e));
            }
        });
    }

    /** Remove a recovery's Zoho refund before it is edited or deleted, so the books never disagree. */
    public function removeRecovery(PoRefundRecovery $rec): void
    {
        if (empty($rec->zoho_refund_id)) return;
        $this->assertConfigured();
        $adj = PoRefundAdjustment::withoutGlobalScope('tenant')->findOrFail($rec->refund_adjustment_id);
        try {
            $this->books->deleteVendorCreditRefund((string) $adj->zoho_vendorcredit_id, (string) $rec->zoho_refund_id);
        } catch (\Throwable $e) {
            throw new RuntimeException('Could not remove this refund from Zoho Books: ' . $this->clean($e));
        }
        $rec->forceFill(['zoho_refund_id' => null, 'zoho_sync_status' => null, 'zoho_synced_at' => null, 'zoho_error' => null])->save();
    }

    /* ══════════════════════════ PAYLOADS ══════════════════════════ */

    private function assertSyncable(PurchaseOrder $po): void
    {
        if (!$po->vendor_id) throw new RuntimeException('Attach a supplier to this PO before syncing to Zoho Books.');
        if ($po->status === PurchaseOrder::STATUS_DRAFT) throw new RuntimeException('Submit the PO before syncing it to Zoho Books.');
        if (!$po->items()->exists()) throw new RuntimeException('Add at least one product line before syncing to Zoho Books.');
        // The bill carries TDS as a deduction, so it must be decided first.
        if ($po->document_type !== 'international' && !$po->tds_updated_at) {
            throw new RuntimeException('Deduct the TDS on this PO first (0% if none applies) — the bill amount depends on it.');
        }
        if (!$po->payments()->withoutGlobalScope('tenant')->exists()) {
            throw new RuntimeException('Record at least one payment before syncing to Zoho Books.');
        }
    }

    /** Zoho vendor, GST registration, intra/inter state and currency for a PO. */
    private function context(PurchaseOrder $po): array
    {
        $vendor = Vendor::withTrashed()->with('primaryAddress')->findOrFail($po->vendor_id);
        $gstin = ($vendor->gst_number ?: null)
            ?: (DB::table('vendor_gst_scrutiny')->where('vendor_id', $vendor->id)->latest('id')->value('gst_number') ?: null);
        $stateCode = optional($vendor->primaryAddress)->state_code;
        $orgState = $this->books->orgStateCode() ?: $po->home_state_code;
        $party = ZohoBooksService::normStateCode($stateCode);
        $ccyId = $this->books->resolveCurrencyId($po->currency_code);

        return [
            'vendor_id'     => $this->books->findOrCreateVendorId($vendor, $gstin, $stateCode),
            'registered'    => (bool) $gstin,
            'inter_state'   => $party !== null && $party !== ZohoBooksService::normStateCode($orgState),
            'currency_id'   => $ccyId,
            'exchange_rate' => ($ccyId && (float) $po->exchange_rate > 0) ? (float) $po->exchange_rate : null,
        ];
    }

    /** The PO's items as Zoho lines (same rate and GST on the PO, bill and vendor credit). */
    private function lines(PurchaseOrder $po, array $ctx, array $poLineIds = []): array
    {
        $items = $po->items()->get();
        $meta = DB::table('products as p')
            ->leftJoin('master_uom as u', 'u.id', '=', 'p.uom_id')
            ->leftJoin('master_hsn_codes as h', 'h.id', '=', 'p.hsn_id')
            ->whereIn('p.id', $items->pluck('product_id')->filter()->unique()->all())
            ->get(['p.id', 'p.name', 'p.product_code', 'u.short_code', 'u.title', 'h.hsn_code'])
            ->keyBy('id');

        return $items->values()->map(function ($it, $idx) use ($ctx, $meta, $poLineIds) {
            $m = $meta[(int) $it->product_id] ?? null;
            $name = (string) ($m->name ?? $m->product_code ?? 'Item');
            $gst = (float) $it->gst_pct;
            $taxId = $ctx['registered'] && $gst > 0 ? $this->books->resolveTaxId($gst, $ctx['inter_state']) : null;
            $desc = trim(implode(' · ', array_filter([(string) ($m->product_code ?? ''), trim((string) $it->description)])));
            $line = [
                'item_id'     => $this->books->findOrCreateItemId($name, (float) $it->rate, $taxId, $it->product_id, $gst),
                'name'        => $name,
                'description' => mb_substr($desc, 0, 5500),
                'rate'        => (float) $it->rate,
                'quantity'    => (float) $it->quantity,
            ];
            if (!empty($poLineIds[$idx])) $line['purchaseorder_item_id'] = (string) $poLineIds[$idx];
            if (!empty($m->hsn_code)) $line['hsn_or_sac'] = (string) $m->hsn_code;
            $unit = $m ? ($m->short_code ?: $m->title) : null;
            if ($unit) $line['unit'] = (string) $unit;
            if ($taxId) $line['tax_id'] = $taxId;
            return $line;
        })->all();
    }

    private function charges(PurchaseOrder $po): float
    {
        return round((float) $po->shipping_charges + (float) $po->packaging_charges + (float) $po->other_charges, 2);
    }

    /** TDS as a deduction, as the old sync does, so the bill equals our net payable. */
    private function tds(PurchaseOrder $po): float
    {
        return ($po->tds_updated_at && (float) $po->tds_amount > 0) ? round((float) $po->tds_amount, 2) : 0.0;
    }

    private function withCurrency(array $payload, array $ctx): array
    {
        if ($ctx['currency_id']) {
            $payload['currency_id'] = $ctx['currency_id'];
            if ($ctx['exchange_rate']) $payload['exchange_rate'] = $ctx['exchange_rate'];
        }
        return $payload;
    }

    private function poPayload(PurchaseOrder $po, array $ctx): array
    {
        $payload = [
            'vendor_id'        => $ctx['vendor_id'],
            'date'             => optional($po->po_date)->toDateString() ?: now()->toDateString(),
            'reference_number' => (string) $po->code,
            'line_items'       => $this->lines($po, $ctx),
        ];
        if ($po->expected_delivery_date) $payload['delivery_date'] = $po->expected_delivery_date->toDateString();
        if (trim((string) $po->terms) !== '') $payload['terms'] = mb_substr(trim(strip_tags((string) $po->terms)), 0, 9500);
        if ((float) $po->shipping_charges != 0.0) $payload['shipping_charge'] = (float) $po->shipping_charges;
        $other = round((float) $po->packaging_charges + (float) $po->other_charges, 2);
        if ($other != 0.0) {
            $payload['adjustment'] = $other;
            $payload['adjustment_description'] = 'Packaging & other charges';
        }
        return $this->withCurrency($payload, $ctx);
    }

    private function billPayload(PurchaseOrder $po, array $ctx, array $poLineIds): array
    {
        $payload = [
            'vendor_id'        => $ctx['vendor_id'],
            'bill_number'      => (string) $po->code,
            'date'             => optional($po->po_date)->toDateString() ?: now()->toDateString(),
            'reference_number' => (string) $po->code,
            'line_items'       => $this->lines($po, $ctx, $poLineIds),
        ];
        $charges = $this->charges($po);
        $tds = $this->tds($po);
        $parts = array_filter([
            $charges != 0.0 ? 'Charges ₹' . number_format($charges, 2) : null,
            $tds > 0 ? 'less TDS ₹' . number_format($tds, 2) : null,
        ]);
        if (round($charges - $tds, 2) != 0.0) {
            $payload['adjustment'] = round($charges - $tds, 2);
            $payload['adjustment_description'] = implode(' ', $parts);
        }
        return $this->withCurrency($payload, $ctx);
    }

    /**
     * The credit is raised for the money actually released against the PO — not the
     * order's value — less what the supplier keeps as cancellation charges. What stays
     * open on it is therefore exactly the cash the supplier has to send back.
     */
    private function vendorCreditPayload(PoRefundAdjustment $adj, PurchaseOrder $po, array $ctx): array
    {
        $paid = round((float) $adj->paid_amount, 2);
        $retained = round((float) $adj->retained_amount, 2);

        $payload = [
            'vendor_id'            => $ctx['vendor_id'],
            'vendor_credit_number' => (string) $adj->code,
            'date'                 => optional($adj->refund_date)->toDateString() ?: now()->toDateString(),
            'reference_number'     => (string) $po->code,
            'line_items'           => [[
                'item_id'     => $this->books->findOrCreateItemId(self::CREDIT_ITEM, $paid, null, null, 0.0),
                'name'        => self::CREDIT_ITEM,
                'description' => mb_substr('Advance released against PO ' . $po->code . ' — ' . $adj->reason, 0, 5500),
                'rate'        => $paid,
                'quantity'    => 1,
            ]],
            'notes' => mb_substr('PO cancelled — ' . $adj->reason, 0, 500),
        ];
        if ($retained > 0) {
            $payload['adjustment'] = -$retained;
            $payload['adjustment_description'] = mb_substr(
                'less cancellation charges ₹' . number_format($retained, 2) . ($adj->retained_type ? ' (' . $adj->retained_type . ')' : ''),
                0,
                250,
            );
        }
        return $this->withCurrency($payload, $ctx);
    }

    /* ══════════════════════════ HELPERS ══════════════════════════ */

    private function assertConfigured(): void
    {
        if (!$this->books->isConfigured()) {
            throw new RuntimeException('Zoho Books is not connected yet — add the Zoho Books credentials to the server, then try again.');
        }
    }

    /** One sync per record at a time — a double click must not create two Zoho documents. */
    private function withLock(string $key, callable $work): mixed
    {
        $lock = Cache::lock($key, 120);
        if (!$lock->get()) throw new RuntimeException('A Zoho sync for this record is already running — try again in a moment.');
        try { return $work(); } finally { $lock->release(); }
    }

    private function quietly(callable $fn, string $what): void
    {
        try { $fn(); } catch (\Throwable $e) { Log::warning("P2P Zoho reverse: {$what} failed", ['err' => $e->getMessage()]); }
    }

    private function clean(\Throwable $e): string
    {
        return mb_substr(preg_replace('/^Zoho Books:\s*/', 'Zoho Books: ', $e->getMessage()), 0, 500);
    }
}
