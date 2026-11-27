<?php

namespace App\Services\P2p;

use App\Models\P2p\PoGstApproval;
use App\Models\P2p\PoItemQtyHistory;
use App\Models\P2p\PoPaymentRequest;
use App\Models\P2p\PoRefundAdjustment;
use App\Models\P2p\PurchaseOrder;
use App\Models\P2p\PurchaseOrderDocument;
use App\Models\P2p\PurchaseOrderItem;
use App\Support\SupplierPartyToken;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use App\Models\P2p\SupplierInvoice;
use App\Models\Vendor;
use App\Services\SegmentDocScope;
use Illuminate\Support\Facades\DB;

class PurchaseOrderService
{
    public const GST_STALE_MONTHS = 3;

    public function scopeTenant($query, string $table)
    {
        if (!TenantContext::active()) return $query;
        $query->where("$table.client_id", TenantContext::clientId());
        if (TenantContext::branchId() !== null) {
            $query->where(fn ($w) => $w->whereNull("$table.branch_id")->orWhere("$table.branch_id", TenantContext::branchId()));
        }
        return $query;
    }

    public function financialYear(?Carbon $on = null): string
    {
        $d = $on ?: now();
        $start = $d->month >= 4 ? $d->year : $d->year - 1;
        return $start . '-' . substr((string) ($start + 1), -2);
    }

    public function nextPoCode(int $clientId, ?int $branchId = null): string
    {
        return $this->nextCode($clientId, 'PO', PurchaseOrder::withoutGlobalScope('tenant')->withTrashed(), true, $branchId);
    }

    public function previewPoCode(int $clientId, ?int $branchId = null): string
    {
        return $this->nextCode($clientId, 'PO', PurchaseOrder::withoutGlobalScope('tenant')->withTrashed(), false, $branchId);
    }

    public function nextPaymentRequestCode(int $clientId, ?int $branchId = null): string
    {
        return $this->nextSerialCode($clientId, 'PRQ', PoPaymentRequest::withoutGlobalScope('tenant'), true, $branchId);
    }

    public function nextRefundCode(int $clientId, ?int $branchId = null, bool $allocate = true): string
    {
        return $this->nextCode($clientId, 'ADR', PoRefundAdjustment::withoutGlobalScope('tenant')->withTrashed(), $allocate, $branchId);
    }

    public function nextDocCode(int $clientId, ?int $branchId = null): string
    {
        return $this->nextCode($clientId, 'DOC', PurchaseOrderDocument::withoutGlobalScope('tenant')->withTrashed(), true, $branchId);
    }

    public function ensureDefaultDocuments(PurchaseOrder $po, int $userId): void
    {
        $rows = array_merge(
            [['source_type' => null, 'source_id' => null, 'name' => 'Purchase Order', 'sub' => null,
                'kind' => 'purchase_order', 'required' => true]],
            array_map(fn ($d) => [
                'source_type' => $d['source_type'],
                'source_id'   => $d['source_id'],
                'name'        => $d['name'],
                'sub'         => $d['sub'] ?: null,
                'kind'        => $d['source_type'] === 'agreement' ? 'agreement' : 'other',
                'required'    => false,
            ], $this->segmentDocuments($po)),
        );

        $have = $po->documents()->get(['doc_kind', 'source_type', 'source_id']);
        $seen = [];
        foreach ($have as $d) {
            $seen[$d->source_type === null ? 'po' : $d->source_type . ':' . $d->source_id] = true;
        }

        foreach ($rows as $row) {
            $key = $row['source_type'] === null ? 'po' : $row['source_type'] . ':' . $row['source_id'];
            if (isset($seen[$key])) continue;
            $seen[$key] = true;

            PurchaseOrderDocument::create([
                'client_id'         => $po->client_id,
                'branch_id'         => $po->branch_id,
                'purchase_order_id' => $po->id,
                'code'              => $this->nextDocCode((int) $po->client_id, $po->branch_id ? (int) $po->branch_id : null),
                'name'              => $row['name'],
                'doc_sub'           => $row['sub'],
                'doc_kind'          => $row['kind'],
                'source_type'       => $row['source_type'],
                'source_id'         => $row['source_id'],
                'is_required'       => $row['required'] ? 'yes' : 'no',
                'needed'            => $row['required'] ? 'yes' : 'no',
                'generated_on'      => now()->toDateString(),
                'status'            => PurchaseOrderDocument::STATUS_PENDING,
                'created_by'        => $userId,
                'updated_by'        => $userId,
            ]);
        }
    }

    public function segmentDocuments(PurchaseOrder $po): array
    {
        $clientId = (int) $po->client_id;
        if (!$clientId) return [];

        $segmentIds = DB::table('p2p_purchase_order_items as i')
            ->join('products as p', 'p.id', '=', 'i.product_id')
            ->where('i.purchase_order_id', $po->id)
            ->whereNotNull('p.segment_id')
            ->pluck('p.segment_id')->map(fn ($v) => (int) $v)->unique()->values()->all();

        if (!$segmentIds && $po->vendor_id) {
            $segmentIds = DB::table('vendor_segments')->where('vendor_id', $po->vendor_id)
                ->pluck('segment_id')->map(fn ($v) => (int) $v)->unique()->values()->all();
            if (!$segmentIds) {
                $own = DB::table('vendors')->where('id', $po->vendor_id)->value('segment_id');
                if ($own) $segmentIds = [(int) $own];
            }
        }
        if (!$segmentIds) return [];

        $segments = DB::table('clm_segments')->whereIn('id', $segmentIds)->get(['name', 'code', 'regulatory_status']);
        $trade = collect();
        $agreements = collect();
        foreach ($segments as $segment) {
            $trade = $trade->merge($this->clmLibraryRows('clm_trade_doc_library', 'status', 'active', $clientId, $segment));
            $agreements = $agreements->merge($this->clmLibraryRows('clm_agreement_library', 'agr_status', 'Active', $clientId, $segment));
        }

        $typeToken = $po->vendor_id
            ? SupplierPartyToken::forVendorTypeId(
                (int) DB::table('vendors')->where('id', $po->vendor_id)->value('vendor_type_id') ?: null,
                $clientId,
            )
            : null;

        $out = [];
        foreach ($trade->unique('id') as $row) {
            if (!$this->appliesToSupplier($row->party ?? null, $typeToken)) continue;
            $out[] = [
                'source_type' => 'trade',
                'source_id'   => (int) $row->id,
                'name'        => (string) ($row->title ?: $row->name ?: 'Trade Document'),
                'sub'         => (string) ($row->doc_type ?? ''),
                'required'    => ($row->regulatory ?? 'less') === 'highly',
            ];
        }
        foreach ($agreements->unique('id') as $row) {
            if (!$this->appliesToSupplier($row->party ?? null, $typeToken)) continue;
            $out[] = [
                'source_type' => 'agreement',
                'source_id'   => (int) $row->id,
                'name'        => (string) ($row->title ?: $row->agreement_type ?: 'Agreement'),
                'sub'         => (string) ($row->agreement_type ?? 'Agreement'),
                'required'    => ($row->regulatory ?? 'less') === 'highly',
            ];
        }
        return $out;
    }

    private function clmLibraryRows(string $table, string $statusColumn, string $statusValue, int $clientId, object $segment)
    {
        $needles = array_values(array_filter([$segment->name, $segment->code]));
        if (!$needles) return collect();

        return DB::table($table)
            ->where('client_id', $clientId)
            ->where('regulatory', $segment->regulatory_status)
            ->where($statusColumn, $statusValue)
            ->where(function ($q) use ($needles) {
                foreach ($needles as $needle) {
                    $q->orWhere('segment', $needle)
                        ->orWhere('segment', 'LIKE', $needle . ',%')->orWhere('segment', 'LIKE', $needle . ', %')
                        ->orWhere('segment', 'LIKE', '%,' . $needle)->orWhere('segment', 'LIKE', '%, ' . $needle)
                        ->orWhere('segment', 'LIKE', '%,' . $needle . ',%')->orWhere('segment', 'LIKE', '%, ' . $needle . ',%');
                }
            })
            ->get();
    }

    private function appliesToSupplier(?string $party, ?string $typeToken = null): bool
    {
        $party = trim((string) $party);
        if ($party === '') return true;

        $wanted = $typeToken ? SupplierPartyToken::aliases($typeToken) : null;

        foreach (preg_split('/[,;]/', $party) as $token) {
            $t = strtolower(trim($token));
            if (!str_starts_with($t, 'supplier')) continue;
            if ($wanted === null || in_array($t, $wanted, true)) return true;
        }
        return false;
    }

    private function nextCode(int $clientId, string $prefix, Builder $query, bool $allocate = true, ?int $branchId = null): string
    {
        $fy = $this->financialYear();

        if ($allocate) {
            $branchId !== null
                ? DB::table('branches')->where('id', $branchId)->lockForUpdate()->first()
                : DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        }

        $max  = 0;
        $rows = $query->where('client_id', $clientId)
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->where('code', 'like', "{$prefix}/{$fy}/%")
            ->pluck('code');
        foreach ($rows as $code) {
            if (preg_match('#^' . $prefix . '/' . preg_quote($fy, '#') . '/(\d+)$#', (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }
        return sprintf('%s/%s/%03d', $prefix, $fy, $max + 1);
    }

    private function nextSerialCode(int $clientId, string $prefix, Builder $query, bool $allocate = true, ?int $branchId = null): string
    {
        if ($allocate) {
            $branchId !== null
                ? DB::table('branches')->where('id', $branchId)->lockForUpdate()->first()
                : DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        }

        $max  = 0;
        $rows = $query->where('client_id', $clientId)
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->where('code', 'like', "{$prefix}-%")
            ->pluck('code');
        foreach ($rows as $code) {
            if (preg_match('#^' . preg_quote($prefix, '#') . '-(\d+)$#', (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }
        return sprintf('%s-%03d', $prefix, $max + 1);
    }

    public function piDate(?int $piId): ?string
    {
        $at = $piId ? DB::table('proforma_invoices')->where('id', $piId)->value('created_at') : null;
        return $at ? substr((string) $at, 0, 10) : null;
    }

    public function piIdForShipment(object $shipment): ?int
    {
        if (!empty($shipment->proforma_invoice_id)) return (int) $shipment->proforma_invoice_id;
        if (!empty($shipment->lead_id)) {
            $id = DB::table('proforma_invoices')->where('opp_id', $shipment->lead_id)->orderByDesc('id')->value('id');
            return $id ? (int) $id : null;
        }
        return null;
    }

    public function orderedByPiItem(int $clientId, array $piItemIds, ?int $excludePoId = null, ?int $excludeSpiId = null): array
    {
        if (!$piItemIds) return [];

        $po = PurchaseOrderItem::query()
            ->join('p2p_purchase_orders as po', 'po.id', '=', 'p2p_purchase_order_items.purchase_order_id')
            ->where('po.client_id', $clientId)
            ->whereNull('po.deleted_at')
            ->where('po.status', '!=', PurchaseOrder::STATUS_CANCELLED)
            ->where(fn ($q) => $q
                ->where('po.status', PurchaseOrder::STATUS_SUBMITTED)
                ->orWhereExists(fn ($s) => $s->selectRaw('1')
                    ->from('p2p_po_gst_approvals as ga')
                    ->whereColumn('ga.purchase_order_id', 'po.id')
                    ->whereIn('ga.status', [PoGstApproval::STATUS_PENDING, PoGstApproval::STATUS_APPROVED])))
            ->when($excludePoId, fn ($q) => $q->where('po.id', '!=', $excludePoId))
            ->whereIn('p2p_purchase_order_items.pi_item_id', $piItemIds)
            ->groupBy('p2p_purchase_order_items.pi_item_id')
            ->selectRaw('p2p_purchase_order_items.pi_item_id as pi_item_id, SUM(p2p_purchase_order_items.quantity) as qty')
            ->pluck('qty', 'pi_item_id')
            ->map(fn ($q) => (float) $q);

        $spi = DB::table('p2p_supplier_invoice_items as si')
            ->join('p2p_supplier_invoices as s', 's.id', '=', 'si.supplier_invoice_id')
            ->where('s.client_id', $clientId)
            ->whereNull('s.purchase_order_id')
            ->whereNull('s.deleted_at')
            ->whereNull('si.deleted_at')
            ->where('s.status', '!=', SupplierInvoice::STATUS_CANCELLED)
            ->when($excludeSpiId, fn ($q) => $q->where('s.id', '!=', $excludeSpiId))
            ->whereIn('si.pi_item_id', $piItemIds)
            ->groupBy('si.pi_item_id')
            ->selectRaw('si.pi_item_id as pi_item_id, SUM(si.qty_spi) as qty')
            ->pluck('qty', 'pi_item_id')
            ->map(fn ($q) => (float) $q);

        $out = $po->all();
        foreach ($spi->all() as $piItemId => $qty) {
            $out[$piItemId] = (float) ($out[$piItemId] ?? 0) + (float) $qty;
        }

        return $out;
    }

    public function expiredStandardDocs(?int $vendorId, int $clientId): array
    {
        if (!$vendorId) return [];

        $vendor = Vendor::with(['primaryAddress.country', 'segments'])->find($vendorId);
        if (!$vendor) return [];

        $codes  = app(SegmentDocScope::class)->applicableCodes($vendor, 'vendor', $clientId);
        $scoped = array_filter([
            'kyc' => $codes['kyc'] ?? [],
            'dd'  => $codes['dd']  ?? [],
            'tl'  => $codes['tl']  ?? [],
        ]);
        if (empty($scoped)) return [];

        return DB::table('segment_doc_uploads')
            ->where('uploadable_type', Vendor::class)
            ->where('uploadable_id', $vendorId)
            ->where('client_id', $clientId)
            ->where(function ($w) use ($scoped) {
                foreach ($scoped as $cat => $list) {
                    $w->orWhere(fn ($q) => $q->where('category', $cat)->whereIn('doc_code', $list));
                }
            })
            ->whereNotNull('expiry_date')
            ->whereDate('expiry_date', '<', now()->toDateString())
            ->orderBy('expiry_date')
            ->get(['doc_code', 'doc_name', 'expiry_date'])
            ->map(fn ($r) => [
                'code'   => (string) $r->doc_code,
                'name'   => (string) ($r->doc_name ?: $r->doc_code),
                'expiry' => Carbon::parse($r->expiry_date)->format('d-M-Y'),
            ])
            ->all();
    }

    public function vendorProductIds(int $vendorId): array
    {
        if (!$vendorId) return [];
        $a = DB::table('product_vendor_maps')->where('vendor_id', $vendorId)->pluck('product_id');
        $b = DB::table('vendor_product_mappings')->where('vendor_id', $vendorId)->whereNull('deleted_at')->pluck('product_id');
        return $a->merge($b)->filter()->map(fn ($v) => (int) $v)->unique()->values()->all();
    }

    public function vendorProductRates(int $vendorId): array
    {
        if (!$vendorId) return [];
        $out = [];
        foreach (DB::table('product_vendor_maps')->where('vendor_id', $vendorId)->get(['product_id', 'purchase_price']) as $r) {
            if ($r->product_id && $r->purchase_price !== null) $out[(int) $r->product_id] = (float) $r->purchase_price;
        }
        foreach (DB::table('vendor_product_mappings')->where('vendor_id', $vendorId)->whereNull('deleted_at')->get(['product_id', 'purchase_price']) as $r) {
            if ($r->product_id && $r->purchase_price !== null) $out[(int) $r->product_id] = (float) $r->purchase_price;
        }
        return $out;
    }

    public function homeStateCode(?int $branchId): ?string
    {
        if (!$branchId) return null;
        $b = DB::table('branches')->where('id', $branchId)->first(['gst_state_code', 'gst_number']);
        $code = $b->gst_state_code ?? null;
        if (!$code && !empty($b->gst_number)) $code = substr((string) $b->gst_number, 0, 2);
        return $code ?: null;
    }

    public function taxMode(?string $supplierState, ?string $homeState): string
    {
        if (!$supplierState || !$homeState) return 'intra';
        return (string) $supplierState === (string) $homeState ? 'intra' : 'inter';
    }

    public function lineAmounts(float $qty, float $rate, float $gstPct, string $taxMode): array
    {
        $taxable = round($qty * $rate, 2);
        $gst     = round($taxable * $gstPct / 100, 2);
        $cgst = $sgst = $igst = 0.0;
        if ($taxMode === 'inter') {
            $igst = $gst;
        } else {
            $cgst = round($gst / 2, 2);
            $sgst = round($gst - $cgst, 2);
        }
        return [
            'taxable_amount' => $taxable,
            'cgst_amount'    => $cgst,
            'sgst_amount'    => $sgst,
            'igst_amount'    => $igst,
            'line_total'     => round($taxable + $cgst + $sgst + $igst, 2),
        ];
    }

    public function gstGate(?int $vendorId, bool $international = false): array
    {
        if ($international) return ['gate' => 'clear', 'scrutiny_date' => null, 'filing_date' => null, 'gstin' => null];
        $row = $vendorId
            ? DB::table('vendor_gst_scrutiny')->where('vendor_id', $vendorId)->whereNull('deleted_at')->orderByDesc('created_at')->first()
            : null;
        $scrutiny = $row ? Carbon::parse($row->created_at)->startOfDay() : null;
        $filing   = ($row && $row->last_filing_date) ? Carbon::parse($row->last_filing_date)->startOfDay() : null;
        $cutoff   = now()->subMonths(self::GST_STALE_MONTHS)->startOfDay();

        $gate = !$scrutiny || $scrutiny->lt($cutoff) ? 'blocked'
            : (!$filing || $filing->lt($cutoff) ? 'approval_required' : 'clear');

        return [
            'gate'          => $gate,
            'scrutiny_date' => $scrutiny?->toDateString(),
            'filing_date'   => $filing?->toDateString(),
            'gstin'         => $row->gst_number ?? null,
        ];
    }

    public function lineDetails($items): array
    {
        $productIds = $items->pluck('product_id')->filter()->unique()->values()->all();
        $piItemIds  = $items->pluck('pi_item_id')->filter()->unique()->values()->all();

        $products = $productIds ? DB::table('products as p')
            ->leftJoin('master_hsn_codes as h', 'h.id', '=', 'p.hsn_id')
            ->leftJoin('master_uom as u', 'u.id', '=', 'p.uom_id')
            ->whereIn('p.id', $productIds)
            ->select('p.id', 'p.product_code', 'p.name', 'h.hsn_code', DB::raw('COALESCE(u.short_code, u.title) as uom'))
            ->get()->keyBy('id') : collect();
        $piItems = $piItemIds ? DB::table('proforma_invoice_items as i')
            ->leftJoin('products as p', 'p.id', '=', 'i.product_id')
            ->whereIn('i.id', $piItemIds)
            ->select('i.id', 'i.product_id', 'p.product_code', 'i.product_name', 'i.quantity', 'i.rate')
            ->get()->keyBy('id') : collect();

        $out = [];
        foreach ($items as $it) {
            $p  = $it->product_id ? $products->get((int) $it->product_id) : null;
            $pi = $it->pi_item_id ? $piItems->get((int) $it->pi_item_id) : null;
            $out[$it->id] = [
                'product_code'    => $p->product_code ?? null,
                'product_name'    => $p->name ?? null,
                'hsn_code'        => $p->hsn_code ?? null,
                'uom'             => $p->uom ?? null,
                'pi_product_id'   => $pi->product_id ?? null,
                'pi_product_code' => $pi->product_code ?? null,
                'pi_product_name' => $pi->product_name ?? null,
                'pi_quantity'     => $pi ? (float) $pi->quantity : null,
                'pi_rate'         => $pi ? (float) $pi->rate : null,
            ];
        }
        return $out;
    }

    public function recomputeTotals(PurchaseOrder $po): void
    {
        $items = $po->items()->get();
        $taxable = round((float) $items->sum('taxable_amount'), 2);
        $cgst    = round((float) $items->sum('cgst_amount'), 2);
        $sgst    = round((float) $items->sum('sgst_amount'), 2);
        $igst    = round((float) $items->sum('igst_amount'), 2);
        $charges = (float) $po->shipping_charges + (float) $po->packaging_charges + (float) $po->other_charges;

        $po->forceFill([
            'taxable_total' => $taxable,
            'total_cgst'    => $cgst,
            'total_sgst'    => $sgst,
            'total_igst'    => $igst,
            'grand_total'   => round($taxable + $cgst + $sgst + $igst + $charges, 2),
        ])->save();
        $this->refreshPaymentTotals($po);
    }

    public function refreshPaymentTotals(PurchaseOrder $po): void
    {
        $paidByRequest = DB::table('p2p_po_payments')
            ->where('purchase_order_id', $po->id)->whereNull('deleted_at')
            ->groupBy('payment_request_id')
            ->selectRaw('payment_request_id, SUM(amount) as paid')
            ->pluck('paid', 'payment_request_id');

        DB::table('p2p_po_payment_requests')->where('purchase_order_id', $po->id)->update(['paid_amount' => 0]);
        foreach ($paidByRequest as $requestId => $paid) {
            DB::table('p2p_po_payment_requests')->where('id', $requestId)->update(['paid_amount' => round((float) $paid, 2)]);
        }

        $paid = round((float) $paidByRequest->sum(), 2);
        $po->forceFill([
            'paid_amount'    => $paid,
            'balance_amount' => round((float) $po->grand_total - (float) $po->tds_amount - $paid, 2),
        ])->save();
    }

    public function logQty(PurchaseOrder $po, ?PurchaseOrderItem $item, ?object $pi, string $event,
                            float $previous, float $current, array $orderedElsewhere, int $userId, ?PurchaseOrderItem $removed = null): void
    {
        $piQty = $pi ? (float) $pi->quantity : null;
        $pending = $pi ? max(0, $piQty - ($orderedElsewhere[(int) $pi->id] ?? 0) - $current) : null;
        PoItemQtyHistory::create([
            'client_id'              => $po->client_id,
            'branch_id'              => $po->branch_id,
            'purchase_order_id'      => $po->id,
            'purchase_order_item_id' => $item?->id,
            'pi_item_id'             => $pi->id ?? ($removed?->pi_item_id),
            'shipment_order_id'      => $po->shipment_order_id,
            'product_id'             => $item?->product_id ?? $removed?->product_id,
            'event'                  => $event,
            'pi_quantity'            => $piQty,
            'previous_qty'           => $previous,
            'current_qty'            => $current,
            'change_qty'             => round($current - $previous, 3),
            'pending_after'          => $pending,
            'changed_by'             => $userId,
        ]);
    }

    public function releaseAll(PurchaseOrder $po, string $event, int $userId): void
    {
        $items = $po->items()->get();
        $piIds = $items->pluck('pi_item_id')->filter()->map(fn ($v) => (int) $v)->all();
        $orderedElsewhere = $this->orderedByPiItem((int) $po->client_id, $piIds, $po->id);
        $piItems = $piIds ? DB::table('proforma_invoice_items')->whereIn('id', $piIds)->get()->keyBy('id') : collect();
        foreach ($items as $item) {
            $pi = $item->pi_item_id ? $piItems->get((int) $item->pi_item_id) : null;
            $this->logQty($po, $item, $pi, $event, (float) $item->quantity, 0.0, $orderedElsewhere, $userId);
        }
    }
}
