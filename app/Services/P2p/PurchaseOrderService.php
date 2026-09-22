<?php

namespace App\Services\P2p;

use App\Models\P2p\PurchaseOrder;
use App\Models\P2p\PurchaseOrderDocument;
use App\Models\P2p\PurchaseOrderItem;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Rules shared by the P2P purchase-order endpoints: numbering, pending PI
 * quantity, the GST gate, tax mode and line maths.
 */
class PurchaseOrderService
{
    /** A GST scrutiny or return older than this many months fails the gate. */
    public const GST_STALE_MONTHS = 3;

    /** Restrict a query on a table with client_id / branch_id to the request tenant. */
    public function scopeTenant($query, string $table)
    {
        if (!TenantContext::active()) return $query;
        $query->where("$table.client_id", TenantContext::clientId());
        if (TenantContext::branchId() !== null) {
            $query->where(fn ($w) => $w->whereNull("$table.branch_id")->orWhere("$table.branch_id", TenantContext::branchId()));
        }
        return $query;
    }

    /** Indian financial year label, e.g. 2025-26 for any date Apr 2025 – Mar 2026. */
    public function financialYear(?Carbon $on = null): string
    {
        $d = $on ?: now();
        $start = $d->month >= 4 ? $d->year : $d->year - 1;
        return $start . '-' . substr((string) ($start + 1), -2);
    }

    /**
     * Next PO/<FY>/<SEQ>, one sequence per client. Must be called inside a
     * transaction. The tenant scope is lifted because the code is unique
     * across the whole client — a branch-filtered read would reuse a code
     * another branch already holds.
     */
    public function nextPoCode(int $clientId): string
    {
        return $this->nextCode($clientId, 'PO', PurchaseOrder::withoutGlobalScope('tenant')->withTrashed());
    }

    /** The number the next PO would get — a read only: no lock, nothing reserved or written. */
    public function previewPoCode(int $clientId): string
    {
        return $this->nextCode($clientId, 'PO', PurchaseOrder::withoutGlobalScope('tenant')->withTrashed(), false);
    }

    /** Next DOC/<FY>/<SEQ>, one sequence per client. */
    public function nextDocCode(int $clientId): string
    {
        return $this->nextCode($clientId, 'DOC', PurchaseOrderDocument::withoutGlobalScope('tenant')->withTrashed());
    }

    /* ══════════════════ Stage 04 · documents from the CLM libraries ══════════════════ */

    /**
     * The trade documents and agreements this PO has to carry.
     *
     * Segments come from the PO's own products — what is being bought decides
     * the paperwork, not everything the supplier could supply. Only if the PO
     * has no product segments does it fall back to the supplier's segments.
     * A library row applies when it sits in one of those segments, carries the
     * segment's regulatory status, is active, and names the Supplier as a party.
     * "Highly regulated" is what makes a document mandatory.
     *
     * @return array<int,array{source_type:string,source_id:int,name:string,sub:string,required:bool}>
     */
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

        $out = [];
        foreach ($trade->unique('id') as $row) {
            if (!$this->appliesToSupplier($row->party ?? null)) continue;
            $out[] = [
                'source_type' => 'trade',
                'source_id'   => (int) $row->id,
                'name'        => (string) ($row->title ?: $row->name ?: 'Trade Document'),
                'sub'         => (string) ($row->doc_type ?? ''),
                'required'    => ($row->regulatory ?? 'less') === 'highly',
            ];
        }
        foreach ($agreements->unique('id') as $row) {
            if (!$this->appliesToSupplier($row->party ?? null)) continue;
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

    /**
     * Library rows of one segment. `segment` holds a comma-separated list, so
     * the name (or code) is matched on its own or inside that list.
     */
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

    /**
     * A document is for this PO only when the Supplier is one of its parties.
     * The master writes them as "Supplier-Material / Goods", "Supplier — Tech",
     * and similar, so the token only has to start with "supplier". An empty
     * party means the document is not restricted to anyone.
     */
    private function appliesToSupplier(?string $party): bool
    {
        $party = trim((string) $party);
        if ($party === '') return true;
        foreach (preg_split('/[,;]/', $party) as $token) {
            if (str_starts_with(strtolower(trim($token)), 'supplier')) return true;
        }
        return false;
    }

    private function nextCode(int $clientId, string $prefix, Builder $query, bool $allocate = true): string
    {
        $fy = $this->financialYear();
        // Allocation locks the client row so two saves never take the same number.
        if ($allocate) DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();

        $max = 0;
        $rows = $query->where('client_id', $clientId)->where('code', 'like', "{$prefix}/{$fy}/%")->pluck('code');
        foreach ($rows as $code) {
            if (preg_match('#^' . $prefix . '/' . preg_quote($fy, '#') . '/(\d+)$#', (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }
        return sprintf('%s/%s/%03d', $prefix, $fy, $max + 1);
    }

    /** The PI behind a shipment: its direct link, else the PI on the same opportunity. */
    public function piIdForShipment(object $shipment): ?int
    {
        if (!empty($shipment->proforma_invoice_id)) return (int) $shipment->proforma_invoice_id;
        if (!empty($shipment->lead_id)) {
            $id = DB::table('proforma_invoices')->where('opp_id', $shipment->lead_id)->orderByDesc('id')->value('id');
            return $id ? (int) $id : null;
        }
        return null;
    }

    /**
     * Quantity already ordered per PI line, across every live PO of the client
     * (all branches), excluding cancelled / deleted POs and optionally one PO
     * being edited. Pending = PI qty − this.
     *
     * @return array<int, float> pi_item_id => ordered qty
     */
    public function orderedByPiItem(int $clientId, array $piItemIds, ?int $excludePoId = null): array
    {
        if (!$piItemIds) return [];
        return PurchaseOrderItem::query()
            ->join('p2p_purchase_orders as po', 'po.id', '=', 'p2p_purchase_order_items.purchase_order_id')
            ->where('po.client_id', $clientId)
            ->whereNull('po.deleted_at')
            ->where('po.status', '!=', PurchaseOrder::STATUS_CANCELLED)
            ->when($excludePoId, fn ($q) => $q->where('po.id', '!=', $excludePoId))
            ->whereIn('p2p_purchase_order_items.pi_item_id', $piItemIds)
            ->groupBy('p2p_purchase_order_items.pi_item_id')
            ->selectRaw('p2p_purchase_order_items.pi_item_id as pi_item_id, SUM(p2p_purchase_order_items.quantity) as qty')
            ->pluck('qty', 'pi_item_id')
            ->map(fn ($q) => (float) $q)
            ->all();
    }

    /** The tenant's own GST state code: the branch's, or the first two digits of its GSTIN. */
    public function homeStateCode(?int $branchId): ?string
    {
        if (!$branchId) return null;
        $b = DB::table('branches')->where('id', $branchId)->first(['gst_state_code', 'gst_number']);
        $code = $b->gst_state_code ?? null;
        if (!$code && !empty($b->gst_number)) $code = substr((string) $b->gst_number, 0, 2);
        return $code ?: null;
    }

    /** intra (CGST + SGST) when supplier and tenant share a state, else inter (IGST). */
    public function taxMode(?string $supplierState, ?string $homeState): string
    {
        if (!$supplierState || !$homeState) return 'intra';
        return (string) $supplierState === (string) $homeState ? 'intra' : 'inter';
    }

    /** Tax for one line, never trusted from the client. */
    public function lineAmounts(float $qty, float $rate, float $gstPct, string $taxMode): array
    {
        $taxable = round($qty * $rate, 2);
        $gst     = round($taxable * $gstPct / 100, 2);
        $cgst = $sgst = $igst = 0.0;
        if ($taxMode === 'inter') {
            $igst = $gst;
        } else {
            $cgst = round($gst / 2, 2);
            $sgst = round($gst - $cgst, 2);   // halves always add back to the full GST
        }
        return [
            'taxable_amount' => $taxable,
            'cgst_amount'    => $cgst,
            'sgst_amount'    => $sgst,
            'igst_amount'    => $igst,
            'line_total'     => round($taxable + $cgst + $sgst + $igst, 2),
        ];
    }

    /**
     * GST gate on the supplier's latest scrutiny record: blocked when the
     * scrutiny is stale, approval_required when only the return filing is.
     */
    public function gstGate(?int $vendorId): array
    {
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

    /** Recompute header totals from the saved lines and charges. */
    /**
     * Product and PI details for PO lines, read live from products / PI items
     * (the line stores only the ids). Keyed by PO item id.
     */
    public function lineDetails($items): array
    {
        $productIds = $items->pluck('product_id')->filter()->unique()->values()->all();
        $piItemIds  = $items->pluck('pi_item_id')->filter()->unique()->values()->all();

        // No deleted_at filter: a PO line must still show a product deleted later.
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
    }
}
