<?php

namespace App\Services\P2p;

use App\Models\Inventory\ProductFlag;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SpiBoxAttachment;
use App\Models\P2p\SpiBoxItem;
use App\Models\P2p\PoPayment;
use App\Models\P2p\PoPaymentRequest;
use App\Models\P2p\SupplierInvoice;
use App\Models\Vendor;
use Illuminate\Support\Facades\DB;

class SpiSummaryService
{
    public function build(SupplierInvoice $spi): array
    {
        $spi->loadMissing(['vendor', 'warehouse', 'purchaseOrder', 'items']);

        $boxes = $spi->boxes()->with('items.invoiceItem')->orderBy('box_code')->get();
        $places = $this->placements($spi, $boxes);

        return [
            'header'     => $this->header($spi, $boxes, $places),
            'analytics'  => $this->analytics($spi, $boxes),
            'parties'    => $this->parties($spi),
            'references' => $this->references($spi),
            'financials' => $this->financials($spi),
            'locations'  => $this->locations($boxes, $places),
            'boxes'      => $this->boxDetails($boxes, $places, $spi),
        ];
    }

    public function packedBoxes(SupplierInvoice $spi, array $opts = []): array
    {
        $perPage  = max(1, min((int) ($opts['per_page'] ?? 10), 100));
        $page     = max(1, (int) ($opts['page'] ?? 1));
        $bucket   = strtolower(trim((string) ($opts['bucket'] ?? 'all')));
        $handling = strtolower(trim((string) ($opts['handling'] ?? '')));
        $search   = trim((string) ($opts['search'] ?? ''));

        $boxes = $spi->boxes()->with('items')->orderBy('box_code')->get();
        $flags = $this->flagBehaviours($spi);

        $marks = $boxes->mapWithKeys(fn (SpiBox $b) => [$b->id => $this->classify($b, $flags)])->all();

        $counts = [
            'all'      => $boxes->count(),
            'ship'     => 0,
            'inv'      => 0,
            'damaged'  => 0,
            'mismatch' => 0,
        ];
        $handlingCounts = ['haz' => 0, 'non_haz' => 0, 'cold' => 0];
        $scenarios      = ['s1' => 0, 's2' => 0, 's3' => 0];

        foreach ($boxes as $b) {
            $m = $marks[$b->id];
            $counts[$m['bucket']] = ($counts[$m['bucket']] ?? 0) + 1;
            $handlingCounts[$m['is_hazardous'] ? 'haz' : 'non_haz']++;
            if ($m['is_cold']) $handlingCounts['cold']++;
            if (isset($scenarios[$b->scenario])) $scenarios[$b->scenario]++;
        }

        $matchIds = $search === '' ? null : $this->searchBoxIds($spi, $search);

        $filtered = $boxes->filter(function (SpiBox $b) use ($marks, $bucket, $handling, $matchIds) {
            $m = $marks[$b->id];
            if ($bucket !== '' && $bucket !== 'all' && $m['bucket'] !== $bucket) return false;
            if ($handling === 'haz'     && !$m['is_hazardous']) return false;
            if ($handling === 'non_haz' &&  $m['is_hazardous']) return false;
            if ($handling === 'cold'    && !$m['is_cold'])      return false;
            if ($matchIds !== null && !in_array((int) $b->id, $matchIds, true)) return false;

            return true;
        })->values();

        $total = $filtered->count();
        $pages = max(1, (int) ceil($total / $perPage));
        $page  = min($page, $pages);
        $slice = $filtered->slice(($page - 1) * $perPage, $perPage)->values();

        $allPlaces = $this->placements($spi, $boxes);
        $places    = $allPlaces;
        $master = $this->flagMaster($spi);

        $productIds = $slice->flatMap->items
            ->map(fn (SpiBoxItem $i) => $i->invoiceItem?->product_id)
            ->filter()->unique()->values();
        $products = $productIds->isEmpty()
            ? collect()
            : DB::table('products')->whereIn('id', $productIds)->get(['id', 'product_code', 'name'])->keyBy('id');

        $files = $slice->isEmpty()
            ? collect()
            : SpiBoxAttachment::whereIn('box_id', $slice->pluck('id'))->orderBy('id')->get()->groupBy('box_id');

        $offset = ($page - 1) * $perPage;
        $rows = $slice->map(function (SpiBox $b, int $i) use ($places, $master, $products, $files, $marks, $offset) {
            $p = $places[$b->id] ?? null;
            $m = $marks[$b->id];

            return [
                'sr_no'        => $offset + $i + 1,
                'id'           => $b->id,
                'box_code'     => $b->box_code,
                'putaway_code' => $b->box_code ? 'PUT-' . $b->box_code : null,
                'scenario'     => $b->scenario,
                'scenario_label' => $this->scenarioLabel($b),

                'bucket'       => $m['bucket'],
                'is_hazardous' => $m['is_hazardous'],
                'is_cold'      => $m['is_cold'],
                'is_fragile'   => $m['is_fragile'],

                'length_cm'    => (float) $b->length_cm,
                'width_cm'     => (float) $b->width_cm,
                'height_cm'    => (float) $b->height_cm,
                'weight_kg'    => (float) $b->weight_kg,
                'net_weight_kg'   => (float) $b->net_weight_kg,
                'gross_weight_kg' => (float) $b->gross_weight_kg,
                'volumetric_weight_kg' => $b->volumetricWeightKg(),

                'is_stackable' => (int) $b->is_stackable,
                'temp_min_c'   => $b->temp_min_c === null ? null : (float) $b->temp_min_c,
                'temp_max_c'   => $b->temp_max_c === null ? null : (float) $b->temp_max_c,
                'condition'    => $b->condition,

                'qty'          => round($b->items->sum(fn ($it) => (float) $it->quantity), 3),
                'product_count' => $b->items->pluck('supplier_invoice_item_id')->filter()->unique()->count(),

                'blocking'     => $this->blockingFields($b),

                'putaway'      => [
                    'status'        => $p['status'] ?? 'pending',
                    'putaway_id'    => $p['putaway_id'] ?? null,
                    'warehouse'     => $p['warehouse'] ?? null,
                    'zone'          => $p['zone'] ?? null,
                    'rack'          => $p['rack'] ?? null,
                    'shelf'         => $p['shelf'] ?? null,
                    'allocation_id' => $p['allocation_id'] ?? null,
                    'destination'   => $p['destination'] ?? null,
                    'confirmed'     => (bool) ($p['confirmed'] ?? false),
                    'assigned_at'   => $p['assigned_at'] ?? null,
                    'placed_at'     => $p['placed_at'] ?? null,
                    'verified_by'   => $p['verified_by'] ?? null,
                    'task'          => $p['task'] ?? null,
                ] + \App\Models\P2p\SpiPutaway::stepFor($p['status'] ?? 'pending'),

                'sticker'      => [
                    'printed_at' => optional($b->sticker_printed_at)->toDateTimeString(),
                    'url'        => "/api/p2p/spi/{$b->supplier_invoice_id}/boxes/{$b->id}/sticker/download",
                ],

                'attachments'  => ($files[$b->id] ?? collect())->map(fn (SpiBoxAttachment $a) => [
                    'id'          => $a->id,
                    'name'        => $a->file_name,
                    'box_item_id' => $a->box_item_id,
                    'scope'       => $a->box_item_id ? 'product' : 'box',
                    'url'         => $a->file_path ? file_url($a->file_path) : null,
                ])->values()->all(),

                'products'     => $b->items->values()->map(function (SpiBoxItem $it, int $n) use ($master, $products) {
                    $line = $it->invoiceItem;
                    $prod = $line?->product_id ? $products->get($line->product_id) : null;

                    return [
                        'sr_no'        => $n + 1,
                        'id'           => $it->id,
                        'invoice_item_id' => $it->supplier_invoice_item_id,
                        'line_no'      => $line->line_no ?? null,
                        'product_id'   => $line->product_id ?? null,
                        'product_code' => $prod->product_code ?? null,
                        'product_name' => $line->description ?: ($prod->name ?? null),
                        'hsn_code'     => $line->hsn_code ?? null,
                        'uom'          => $line->uom ?? null,

                        'quantity'     => (float) $it->quantity,
                        'qty_invoiced' => $line ? (float) $line->qty_spi : null,
                        'rate'         => $line ? (float) $line->rate : null,

                        'is_stackable' => (int) $it->is_stackable,

                        'flags'        => array_values(array_filter(array_map(
                            fn (int $id) => $master[$id] ?? null,
                            array_map('intval', (array) ($b->flags ?? [])),
                        ))),

                        'serial_no'    => $it->serial_no,
                        'lot_no'       => $it->lot_no,
                        'batch_no'     => $it->batch_no,
                        'cat_no'       => $it->cat_no,
                        'mfg_date'     => optional($it->mfg_date)->toDateString(),
                        'expiry_date'  => optional($it->expiry_date)->toDateString(),

                        'remark'       => $it->remark,
                        'remark_note'  => $it->remark_note,
                    ];
                })->all(),
            ];
        })->all();

        return [
            'spi'    => [
                'id'            => $spi->id,
                'code'          => $spi->code,
                'date'          => $spi->invoice_date,
                'invoice_no'    => $spi->invoice_no,
                'document_type' => $spi->document_type,
                'po_code'       => $spi->purchaseOrder?->code,
            ],
            'warehouse' => $this->warehouse($spi),
            'supplier'  => $this->supplier($spi),
            'boxes'  => $rows,
            'meta'   => [
                'current_page' => $page,
                'per_page'     => $perPage,
                'last_page'    => $pages,
                'total'        => $total,
                'from'         => $total ? $offset + 1 : 0,
                'to'           => min($offset + $perPage, $total),
                'counts'       => $counts,
                'handling'     => $handlingCounts,
                'scenarios'    => $scenarios,
                'progress'     => [
                    'placed'  => count(array_filter($allPlaces, fn ($p) => $p['confirmed'])),
                    'total'   => $boxes->count(),
                    'pending' => $boxes->count() - count(array_filter($allPlaces, fn ($p) => $p['confirmed'])),
                ],
                'putaway'      => $this->putawayCounts($boxes, $allPlaces),
                'filters'      => ['bucket' => $bucket ?: 'all', 'handling' => $handling ?: null, 'search' => $search ?: null],
            ],
            'totals' => [
                'boxes'        => $boxes->count(),
                'products'     => $this->distinctProducts($boxes),
                'quantity'     => round($boxes->flatMap->items->sum(fn ($i) => (float) $i->quantity), 3),
                'gross_weight_kg' => round($boxes->sum(fn (SpiBox $b) => (float) $b->gross_weight_kg), 3),
                'volumetric_weight_kg' => round($boxes->sum(fn (SpiBox $b) => (float) ($b->volumetricWeightKg() ?? 0)), 3),
                'placed'       => count(array_filter($allPlaces, fn ($p) => $p['confirmed'])),
                'attachments'  => SpiBoxAttachment::whereIn('box_id', $boxes->pluck('id'))->count(),
            ],
        ];
    }

    private function putawayCounts($boxes, array $places): array
    {
        $out = ['pending' => 0, 'draft' => 0, 'awaiting_scan' => 0, 'placed' => 0];
        foreach ($boxes as $b) {
            $state = $places[$b->id]['status'] ?? 'pending';
            $out[$state] = ($out[$state] ?? 0) + 1;
        }

        return $out;
    }

    private function classify(SpiBox $b, array $behaviours): array
    {
        $haz = $cold = $fragile = false;
        $damaged = in_array($b->condition, ['major', 'severe'], true);
        $mismatch = false;

        foreach (array_map('intval', (array) ($b->flags ?? [])) as $id) {
            match ($behaviours[$id] ?? null) {
                'hazardous'  => $haz = true,
                'cold_chain' => $cold = true,
                'fragile'    => $fragile = true,
                default      => null,
            };
        }

        foreach ($b->items as $it) {
            if ($it->remark === 'damaged') $damaged = true;
            if (in_array($it->remark, ['mismatch', 'mismatched'], true)) $mismatch = true;
        }

        return [
            'bucket'       => $damaged ? 'damaged' : ($mismatch ? 'mismatch' : 'inv'),
            'is_hazardous' => $haz,
            'is_cold'      => $cold,
            'is_fragile'   => $fragile,
        ];
    }

    private function flagBehaviours(SupplierInvoice $spi): array
    {
        return collect($this->flagMaster($spi))
            ->mapWithKeys(fn ($f, $id) => [$id => $f['behaviour'] ?? 'none'])
            ->all();
    }

    private function searchBoxIds(SupplierInvoice $spi, string $term): array
    {
        $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $term) . '%';

        $byCode = DB::table('p2p_spi_boxes')
            ->where('supplier_invoice_id', $spi->id)->whereNull('deleted_at')
            ->where('box_code', 'ilike', $like)->pluck('id');

        $byProduct = DB::table('p2p_spi_box_items as bi')
            ->join('p2p_spi_boxes as b', 'b.id', '=', 'bi.box_id')
            ->join('p2p_supplier_invoice_items as ii', 'ii.id', '=', 'bi.supplier_invoice_item_id')
            ->leftJoin('products as p', 'p.id', '=', 'ii.product_id')
            ->where('b.supplier_invoice_id', $spi->id)
            ->whereNull('b.deleted_at')->whereNull('bi.deleted_at')
            ->where(fn ($w) => $w->where('p.product_code', 'ilike', $like)
                ->orWhere('p.name', 'ilike', $like)
                ->orWhere('ii.description', 'ilike', $like))
            ->pluck('bi.box_id');

        return $byCode->merge($byProduct)->unique()->map(fn ($v) => (int) $v)->values()->all();
    }

    private function blockingFields(SpiBox $b): array
    {
        $missing = [];
        if (!(float) $b->length_cm || !(float) $b->width_cm || !(float) $b->height_cm) {
            $missing[] = 'Box dimensions (L × W × H) not recorded';
        }
        if (!(float) $b->gross_weight_kg) $missing[] = 'Gross weight not recorded';
        if (!(float) $b->net_weight_kg)   $missing[] = 'Net weight not recorded';

        return $missing;
    }

    private function header(SupplierInvoice $spi, $boxes, array $places): array
    {
        $po = $spi->purchaseOrder;
        $shipId = $spi->shipment_order_id ?? $po?->shipment_order_id;
        $ship = $shipId ? DB::table('shipment_orders')->find($shipId) : null;
        $pi = $this->piFor($spi, $po, $ship);

        return [
            'spi_id'         => $spi->code,
            'spi_date'       => optional($spi->invoice_date)->toDateString() ?? $spi->invoice_date,
            'spi_type'       => $spi->purchase_order_id ? 'PO + SPI' : 'Direct SPI',
            'shipment_id'    => $ship->shipment_code ?? null,
            'opportunity_id' => $pi->opp_code ?? null,
            'procurement_id' => $spi->procurement_request_code ?? $po?->procurement_request_code,
            'warehouse'      => $this->warehouse($spi),
            'boxes'          => $boxes->count(),
            'products'       => $this->distinctProducts($boxes),
            'total_qty'      => round($boxes->flatMap->items->sum(fn ($i) => (float) $i->quantity), 3),
            'placed_boxes'   => count(array_filter($places, fn ($p) => $p['confirmed'])),
        ];
    }

    private function analytics(SupplierInvoice $spi, $boxes): array
    {
        $items = $boxes->flatMap->items;
        [$hazardIds, $coldIds] = $this->flagIds($spi);

        $carries = fn ($box, array $ids) => (bool) array_intersect(
            array_map('intval', (array) ($box->flags ?? [])),
            $ids,
        );

        return [
            'total_boxes'      => $boxes->count(),
            'total_products'   => $this->distinctProducts($boxes),
            'total_quantity'   => round($items->sum(fn ($i) => (float) $i->quantity), 3),
            'spi_value'        => (float) $spi->grand_total,
            'hazardous'        => $boxes->filter(fn ($b) => $carries($b, $hazardIds))->count(),
            'cold_chain'       => $boxes->filter(fn ($b) => $carries($b, $coldIds))->count(),
            'damaged_rejected' => $items->where('remark', SpiBoxItem::REMARK_DAMAGED)->count(),
            'mismatched'       => $items->where('remark', SpiBoxItem::REMARK_MISMATCHED)->count(),
        ];
    }

    private function piFor(SupplierInvoice $spi, $po, $ship = null)
    {
        if ($po?->proforma_invoice_id) {
            return DB::table('proforma_invoices')->find($po->proforma_invoice_id);
        }

        if ($ship === null) {
            $shipId = $spi->shipment_order_id ?? $po?->shipment_order_id;
            $ship = $shipId ? DB::table('shipment_orders')->find($shipId) : null;
        }

        return $ship?->proforma_invoice_id
            ? DB::table('proforma_invoices')->find($ship->proforma_invoice_id)
            : null;
    }

    private function parties(SupplierInvoice $spi): array
    {
        $out = [];
        $po  = $spi->purchaseOrder;
        $pi  = $this->piFor($spi, $po);

        if ($pi?->customer_id) {
            $c = DB::table('customers')->find($pi->customer_id);
            $out[] = [
                'role'    => 'Customer',
                'name'    => $pi->customer_name ?: ($c->company_name ?? null),
                'code'    => $c->customer_code ?? null,
                'country' => $this->partyCountry('customer_addresses', 'customer_id', $pi->customer_id),
            ];
        }

        if ($pi?->consignee_id) {
            $g = DB::table('consignees')->find($pi->consignee_id);
            $out[] = [
                'role'    => 'Consignee',
                'name'    => $pi->consignee_name ?: ($g->company_name ?? null),
                'code'    => $g->consignee_code ?? null,
                'country' => $this->partyCountry('consignee_addresses', 'consignee_id', $pi->consignee_id),
            ];
        }

        if ($spi->vendor_id) {
            $v = Vendor::withTrashed()->find($spi->vendor_id);
            $out[] = [
                'role'    => 'Supplier',
                'name'    => $v ? ($v->company_name ?: $v->legal_name) : null,
                'code'    => $v->vendor_code ?? null,
                'country' => $v?->primaryAddress?->country_id
                    ? DB::table('master_countries')->where('id', $v->primaryAddress->country_id)->value('name')
                    : null,
            ];
        }

        return $out;
    }

    private function financials(SupplierInvoice $spi): array
    {
        $po = $spi->purchaseOrder;
        $ledger = $po ?: $spi;

        $gst = round((float) $spi->total_cgst + (float) $spi->total_sgst + (float) $spi->total_igst, 2);

        $total = round((float) $ledger->grand_total, 2);
        $tds   = round((float) $ledger->tds_amount, 2);
        $net   = round($total - $tds, 2);
        $paid  = round((float) $ledger->paid_amount, 2);

        $requests = PoPaymentRequest::withoutGlobalScope('tenant')
            ->when($po, fn ($q) => $q->where('purchase_order_id', $po->id))
            ->when(!$po, fn ($q) => $q->whereNull('purchase_order_id')->where('supplier_invoice_id', $spi->id))
            ->get();
        $approved = $requests->where('status', 'approved');

        return [
            'source'         => $po ? 'purchase_order' : 'supplier_invoice',
            'code'           => $ledger->code,
            'currency_code'  => $ledger->currency_code ?: 'INR',

            'spi_amount'     => round((float) $spi->grand_total, 2),
            'spi_base'       => round((float) $spi->taxable_total, 2),
            'spi_gst'        => $gst,
            'po_amount'      => $po ? round((float) $po->grand_total, 2) : null,

            'tds_percentage' => (float) $ledger->tds_percentage,
            'tds_amount'     => $tds,
            'tds_saved'      => (bool) $ledger->tds_updated_at,
            'tds_applies'    => $ledger->document_type !== 'international',

            'net_payable'    => $net,
            'paid_amount'    => $paid,
            'balance_amount' => round($net - $paid, 2),
            'paid_pct'       => $net > 0 ? (int) round($paid / $net * 100) : 0,
            'settled'        => $net > 0 && $paid >= $net - 0.001,

            'requests' => [
                'total'        => $requests->count(),
                'pending'      => $requests->where('status', 'pending')->count(),
                'approved'     => $approved->count(),
                'rejected'     => $requests->where('status', 'rejected')->count(),
                'requested'    => round((float) $requests->sum('requested_amount'), 2),
                'approved_amt' => round((float) $approved->sum('approved_amount'), 2),
                'ready_to_pay' => round((float) $approved->sum(
                    fn ($r) => max(0, (float) $r->approved_amount - (float) $r->paid_amount)
                ), 2),
            ],

            'payments' => $this->paymentEntries($spi, $po, $requests),
        ];
    }

    private function paymentEntries(SupplierInvoice $spi, $po, $requests): array
    {
        $rows = PoPayment::withoutGlobalScope('tenant')
            ->when($po, fn ($q) => $q->where('purchase_order_id', $po->id))
            ->when(!$po, fn ($q) => $q->whereNull('purchase_order_id')->where('supplier_invoice_id', $spi->id))
            ->orderBy('id')
            ->get();

        $codes = $requests->pluck('code', 'id');

        return $rows->map(fn ($p) => [
            'id'                => $p->id,
            'amount'            => (float) $p->amount,
            'bank_name'         => $p->bank_name,
            'utr_cheque_number' => $p->utr_cheque_number,
            'utr_cheque_date'   => $p->utr_cheque_date?->toDateString(),
            'proof_name'        => $p->proof_name,
            'proof_url'         => $p->proof_path ? file_url($p->proof_path) : null,
            'paid_on'           => $p->created_at?->toDateString(),
            'payment_request_id'   => $p->payment_request_id,
            'payment_request_code' => $codes[$p->payment_request_id] ?? null,
        ])->values()->all();
    }

    private function references(SupplierInvoice $spi): array
    {
        $po = $spi->purchaseOrder;
        $pi = $this->piFor($spi, $po);

        return [
            'pi'         => ['code' => $pi->code ?? null, 'date' => $pi->created_at ?? null],
            'po'         => ['code' => $po->code ?? null, 'date' => $po?->po_date],
            'spi'        => ['code' => $spi->code, 'date' => $spi->invoice_date],
            'po_amount'  => $po ? (float) $po->grand_total : null,
            'spi_amount' => (float) $spi->grand_total,
        ];
    }

    private function locations($boxes, array $places): array
    {
        return $boxes->map(function (SpiBox $b, int $i) use ($places) {
            $p = $places[$b->id] ?? null;

            return [
                'sr_no'         => $i + 1,
                'box_id'        => $b->box_code,
                'box_scenario'  => $this->scenarioLabel($b),
                'warehouse'     => $p['warehouse'] ?? null,
                'zone'          => $p['zone'] ?? null,
                'rack'          => $p['rack'] ?? null,
                'shelf'         => $p['shelf'] ?? null,
                'allocation_id' => $p['allocation_id'] ?? null,
                'confirmed'     => (bool) ($p['confirmed'] ?? false),
            ];
        })->values()->all();
    }

    private function boxDetails($boxes, array $places, SupplierInvoice $spi): array
    {
        return $boxes->map(function (SpiBox $b, int $i) use ($places, $spi) {
            $p = $places[$b->id] ?? null;

            return [
                'sr_no'        => $i + 1,
                'box_id'       => $b->box_code,
                'scenario'     => $this->scenarioLabel($b),
                'qty'          => round($b->items->sum(fn ($it) => (float) $it->quantity), 3),
                'length_cm'    => (float) $b->length_cm,
                'width_cm'     => (float) $b->width_cm,
                'height_cm'    => (float) $b->height_cm,
                'weight_kg'    => (float) $b->weight_kg,
                'net_wt_kg'    => (float) $b->net_weight_kg,
                'gross_wt_kg'  => (float) $b->gross_weight_kg,
                'vol_wt_kg'    => $b->volumetricWeightKg(),
                'is_stackable' => (int) $b->is_stackable,
                'temp_min_c'   => $b->temp_min_c === null ? null : (float) $b->temp_min_c,
                'temp_max_c'   => $b->temp_max_c === null ? null : (float) $b->temp_max_c,
                'location'     => $p['allocation_id'] ?? null,
                'products'     => $this->boxProducts($b, $spi),
            ];
        })->values()->all();
    }

    private function boxProducts(SpiBox $b, SupplierInvoice $spi): array
    {
        [$hazardIds, $coldIds] = $this->flagIds($spi);
        $master = $this->flagMaster($spi);

        $boxFlags = array_map('intval', (array) ($b->flags ?? []));

        return $b->items->values()->map(function (SpiBoxItem $it, int $i) use ($hazardIds, $coldIds, $master, $boxFlags) {
            $flags = $boxFlags;
            $line  = $it->invoiceItem;
            $prod  = $line?->product_id ? DB::table('products')->find($line->product_id) : null;

            return [
                'sr_no'        => $i + 1,
                'product_code' => $prod->product_code ?? null,
                'product_name' => $prod->name ?? null,
                'quantity'     => (float) $it->quantity,
                'flags'        => array_values(array_filter(array_map(
                    fn (int $id) => $master[$id] ?? null,
                    $flags,
                ))),
                'hazardous'    => (bool) array_intersect($flags, $hazardIds),
                'cold_chain'   => (bool) array_intersect($flags, $coldIds),
                'serial_no'    => $it->serial_no,
                'lot_no'       => $it->lot_no,
                'batch_no'     => $it->batch_no,
                'cat_no'       => $it->cat_no,
                'remark'       => $it->remark,
                'remark_note'  => $it->remark_note,
            ];
        })->all();
    }

    private function placements(SupplierInvoice $spi, $boxes): array
    {
        $rows = $spi->putaways()->get();
        if ($rows->isEmpty()) return [];

        $openTasks = \App\Models\P2p\SpiPutawayTask::where('supplier_invoice_id', $spi->id)
            ->open()->get(['id', 'task_code', 'box_id', 'completed_scans', 'required_scans', 'expires_at'])
            ->keyBy('box_id');

        $wh = DB::table('inventory_warehouses')->whereIn('id', $rows->pluck('warehouse_id')->filter()->unique())
            ->pluck('code', 'id');
        $zn = DB::table('inventory_zones')->whereIn('id', $rows->pluck('zone_id')->filter()->unique())
            ->pluck('code', 'id');
        $rk = DB::table('inventory_racks')->whereIn('id', $rows->pluck('rack_id')->filter()->unique())
            ->pluck('code', 'id');
        $sh = DB::table('inventory_shelves')->whereIn('id', $rows->pluck('shelf_id')->filter()->unique())
            ->get(['id', 'rack_id', 'level_no'])->keyBy('id');

        $out = [];
        foreach ($rows as $r) {
            $shelf = null;
            if ($r->shelf_id && ($s = $sh->get($r->shelf_id))) {
                $shelf = 'SH-' . str_pad((string) $s->level_no, 2, '0', STR_PAD_LEFT);
            }

            $zone = $r->zone_id ? ($zn[$r->zone_id] ?? null) : null;
            $rack = $r->rack_id ? ($rk[$r->rack_id] ?? null) : null;

            $task = $openTasks->get($r->box_id);

            $out[$r->box_id] = [
                'warehouse' => $r->warehouse_id ? ($wh[$r->warehouse_id] ?? null) : null,
                'zone'      => $zone,
                'rack'      => $rack,
                'shelf'     => $shelf,
                'allocation_id' => implode('-', array_filter([$zone, $rack, $shelf])) ?: null,
                'confirmed'     => $r->confirmed_at !== null,

                'putaway_id'  => $r->id,
                'status'      => $r->stage4Status((bool) $task),
                'destination' => $r->destination,
                'assigned_at' => optional($r->assigned_at)->toDateTimeString(),
                'placed_at'   => optional($r->confirmed_at)->toDateTimeString(),
                'verified_by' => $r->verify_method,
                'task'        => $task ? [
                    'id'         => $task->id,
                    'task_code'  => $task->task_code,
                    'scans'      => ['done' => (int) $task->completed_scans, 'required' => (int) $task->required_scans],
                    'expires_at' => optional($task->expires_at)->toDateTimeString(),
                ] : null,
            ];
        }

        return $out;
    }

    private function flagMaster(SupplierInvoice $spi): array
    {
        static $cache = [];
        $key = ($spi->client_id ?? 0) . ':' . ($spi->branch_id ?? 0);
        if (isset($cache[$key])) return $cache[$key];

        return $cache[$key] = ProductFlag::query()
            ->where(fn ($w) => $w->whereNull('client_id')->orWhere('client_id', $spi->client_id))
            ->where(fn ($w) => $w->whereNull('branch_id')->orWhere('branch_id', $spi->branch_id))
            ->get()
            ->mapWithKeys(fn (ProductFlag $f) => [(int) $f->id => [
                'id'         => (int) $f->id,
                'code'       => $f->flag_code,
                'name'       => $f->flag_name,
                'behaviour'  => $f->behaviour ?: 'none',
                'is_default' => $f->client_id === null,
            ]])
            ->all();
    }

    private function flagIds(?SupplierInvoice $spi): array
    {
        static $cache = [];
        $key = ($spi->client_id ?? 0) . ':' . ($spi->branch_id ?? 0);
        if (isset($cache[$key])) return $cache[$key];

        $rows = ProductFlag::query()
            ->where(fn ($w) => $w->whereNull('client_id')->orWhere('client_id', $spi->client_id ?? null))
            ->where(fn ($w) => $w->whereNull('branch_id')->orWhere('branch_id', $spi->branch_id ?? null))
            ->get(['id', 'flag_name']);

        $named = fn (string $want) => $rows
            ->filter(fn ($f) => str_replace(' ', '', mb_strtolower((string) $f->flag_name)) === $want)
            ->pluck('id')->map('intval')->all();

        return $cache[$key] = [$named('hazardous'), $named('coldchain')];
    }

    private function scenarioLabel(SpiBox $b): string
    {
        return match ($b->scenario) {
            's1'    => '1 Product → 1 Box',
            's2'    => '1 Product → Multiple Boxes',
            's3'    => 'Multiple Products → 1 Box',
            default => (string) $b->scenario,
        };
    }

    private function warehouse(SupplierInvoice $spi): ?array
    {
        $w = $spi->warehouse;
        if (!$w) return null;

        return [
            'id'     => $w->id,
            'code'   => $w->code,
            'name'   => $w->wh_name,
            'is_own' => $w->wh_type === 'own',
        ];
    }

    private function supplier(SupplierInvoice $spi): ?array
    {
        if (!$spi->vendor_id) return null;

        $v = Vendor::withTrashed()->find($spi->vendor_id);
        if (!$v) return null;

        return [
            'id'      => $v->id,
            'code'    => $v->vendor_code,
            'name'    => $v->company_name ?: $v->legal_name,
            'country' => $v->primaryAddress?->country_id
                ? DB::table('master_countries')->where('id', $v->primaryAddress->country_id)->value('name')
                : null,
            'po_code' => $spi->purchaseOrder?->code,
        ];
    }

    private function partyCountry(string $table, string $fk, $id): ?string
    {
        return DB::table($table)->where($fk, $id)->value('country') ?: null;
    }

    private function distinctProducts($boxes): int
    {
        return $boxes->flatMap->items
            ->pluck('supplier_invoice_item_id')
            ->filter()->unique()->count();
    }
}
