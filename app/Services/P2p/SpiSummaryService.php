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

/**
 * Everything the Temporary Putaway Summary screen reads, in one answer.
 *
 * The screen used to build itself: zones, racks and shelves were arithmetic on
 * the invoice number (`ZN-0${(seed % 9) + 1}`), so it showed a tidy allocation
 * for an invoice whose boxes had never been scanned. This reads the rows that
 * actually exist — p2p_spi_putaways for the placement, p2p_spi_boxes and their
 * items for the contents — and says plainly when there is nothing there.
 *
 * CODES, NOT IDS. The putaway row stores zone_id / rack_id / shelf_id, and the
 * screen prints ZN-006 / RC-006 / SH-06. Resolving that here rather than on the
 * client keeps it to three queries for the whole page, and means the shelf's
 * code is built from its rack's stored code the one way the rest of the app
 * builds it.
 */
class SpiSummaryService
{
    /** @return array<string, mixed> */
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

    /**
     * Every packed box of one invoice — the INDEX the Stage 04 box list reads.
     *
     * Two phases on purpose. One invoice can hold a hundred boxes, and a box
     * carries its products, their flags and its attachments; a product name in
     * live data runs past a thousand characters. Building all of that to show
     * ten rows is most of a megabyte thrown away.
     *
     *   1. CLASSIFY every box from its own columns and its items — no product
     *      names, no attachments. That is what the tab counts, the handling
     *      chips and the filters are computed from, so they stay invoice-wide
     *      however small the page.
     *   2. HYDRATE only the page: the products named, the flags resolved, the
     *      put-away location, the sticker and the attachments.
     *
     * The counts therefore never come from the rows returned. Computed from the
     * page, "All Boxes 7" would read 10 the moment an invoice had more than one
     * page of boxes.
     *
     * @param array{bucket?:string,handling?:string,search?:string,page?:int,per_page?:int} $opts
     * @return array<string, mixed>
     */
    public function packedBoxes(SupplierInvoice $spi, array $opts = []): array
    {
        $perPage  = max(1, min((int) ($opts['per_page'] ?? 10), 100));
        $page     = max(1, (int) ($opts['page'] ?? 1));
        $bucket   = strtolower(trim((string) ($opts['bucket'] ?? 'all')));
        $handling = strtolower(trim((string) ($opts['handling'] ?? '')));
        $search   = trim((string) ($opts['search'] ?? ''));

        /* ── phase 1 · classify, without touching a product name ────────── */

        $boxes = $spi->boxes()->with('items')->orderBy('box_code')->get();
        $flags = $this->flagBehaviours($spi);

        $marks = $boxes->mapWithKeys(fn (SpiBox $b) => [$b->id => $this->classify($b, $flags)])->all();

        // Counted over EVERY box, never over the page.
        $counts = [
            'all'      => $boxes->count(),
            // Dispatch does not apply to an invoice; the tab is a placeholder.
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

        /* ── phase 2 · hydrate the page only ────────────────────────────── */

        /* Resolved ONCE for the whole invoice: the page reads its own rows
           out of it, and the progress counts need every box anyway. */
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
                // Keeps counting across pages: page two starts at 11, not 1.
                'sr_no'        => $offset + $i + 1,
                'id'           => $b->id,
                'box_code'     => $b->box_code,
                /* What Stage 04 puts on screen: the SAME code with a marker,
                   never a second number. The sticker on the carton says B-001,
                   and an operator at the rack has to match what they are
                   holding to what the screen shows — two independent sequences
                   for one box is how cartons get misplaced. Derived, so it
                   cannot drift from the code it is built on. */
                'putaway_code' => $b->box_code ? 'PUT-' . $b->box_code : null,
                'scenario'     => $b->scenario,
                'scenario_label' => $this->scenarioLabel($b),

                /* Decided on the server from the products' flag BEHAVIOUR, not
                   from the flag ids. Re-derived in the browser, the chip count
                   and the group a box falls into drift apart. */
                'bucket'       => $m['bucket'],
                'is_hazardous' => $m['is_hazardous'],
                'is_cold'      => $m['is_cold'],
                'is_fragile'   => $m['is_fragile'],

                // As measured, plus the volumetric figure the carrier charges on.
                'length_cm'    => (float) $b->length_cm,
                'width_cm'     => (float) $b->width_cm,
                'height_cm'    => (float) $b->height_cm,
                'weight_kg'    => (float) $b->weight_kg,
                'net_weight_kg'   => (float) $b->net_weight_kg,
                'gross_weight_kg' => (float) $b->gross_weight_kg,
                'volumetric_weight_kg' => $b->volumetricWeightKg(),

                // How it must be handled.
                'is_stackable' => (int) $b->is_stackable,
                'temp_min_c'   => $b->temp_min_c === null ? null : (float) $b->temp_min_c,
                'temp_max_c'   => $b->temp_max_c === null ? null : (float) $b->temp_max_c,
                'condition'    => $b->condition,

                'qty'          => round($b->items->sum(fn ($it) => (float) $it->quantity), 3),
                'product_count' => $b->items->pluck('supplier_invoice_item_id')->filter()->unique()->count(),

                /* What the box still owes before Stage 04 will let it move on:
                   a shelf cannot be chosen for a carton whose size and weight
                   nobody wrote down. */
                'blocking'     => $this->blockingFields($b),

                /* Where it is and how far along. A box with no put-away row at
                   all is 'pending' — and that is the box the operator is
                   looking for, so it must never be missing from this list. */
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

                /* The sticker is rendered on demand, so what is stored is only
                   WHETHER it has been printed — the link is the action. */
                'sticker'      => [
                    'printed_at' => optional($b->sticker_printed_at)->toDateTimeString(),
                    'url'        => "/api/p2p/spi/{$b->supplier_invoice_id}/boxes/{$b->id}/sticker/download",
                ],

                'attachments'  => ($files[$b->id] ?? collect())->map(fn (SpiBoxAttachment $a) => [
                    'id'          => $a->id,
                    'name'        => $a->file_name,
                    // A box_item_id means the picture is of ONE product inside.
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

                        // Packed here, against what the invoice billed on that line.
                        'quantity'     => (float) $it->quantity,
                        'qty_invoiced' => $line ? (float) $line->qty_spi : null,
                        'rate'         => $line ? (float) $line->rate : null,

                        'is_stackable' => (int) $it->is_stackable,

                        /* The flag MASTER rows, not the ids the column holds.
                           Read off the BOX: flags describe the carton, and
                           this line is in it. */
                        'flags'        => array_values(array_filter(array_map(
                            fn (int $id) => $master[$id] ?? null,
                            array_map('intval', (array) ($b->flags ?? [])),
                        ))),

                        // Traceability, as entered at packing.
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
            /* Where the goods are going, and who they came from — the two
               facts the Storage & Warehouse panel prints beside every box.
               Resolved once for the invoice rather than copied onto each row:
               they are the same for all of them, and a box that has not been
               allocated yet still has to show them. */
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
                // Invoice-wide, every one of them.
                'counts'       => $counts,
                'handling'     => $handlingCounts,
                'scenarios'    => $scenarios,
                'progress'     => [
                    'placed'  => count(array_filter($allPlaces, fn ($p) => $p['confirmed'])),
                    'total'   => $boxes->count(),
                    'pending' => $boxes->count() - count(array_filter($allPlaces, fn ($p) => $p['confirmed'])),
                ],
                /* Over every box, including the ones with no put-away row —
                   which is why this counts the BOXES and reads the state off
                   the placements, rather than counting put-away rows. */
                'putaway'      => $this->putawayCounts($boxes, $allPlaces),
                'filters'      => ['bucket' => $bucket ?: 'all', 'handling' => $handling ?: null, 'search' => $search ?: null],
            ],
            // Over the WHOLE invoice, so the footer does not change with the page.
            'totals' => [
                'boxes'        => $boxes->count(),
                'products'     => $this->distinctProducts($boxes),
                'quantity'     => round($boxes->flatMap->items->sum(fn ($i) => (float) $i->quantity), 3),
                'gross_weight_kg' => round($boxes->sum(fn (SpiBox $b) => (float) $b->gross_weight_kg), 3),
                // What a carrier bills on: the greater of actual and volumetric.
                'volumetric_weight_kg' => round($boxes->sum(fn (SpiBox $b) => (float) ($b->volumetricWeightKg() ?? 0)), 3),
                'placed'       => count(array_filter($allPlaces, fn ($p) => $p['confirmed'])),
                'attachments'  => SpiBoxAttachment::whereIn('box_id', $boxes->pluck('id'))->count(),
            ],
        ];
    }

    /**
     * How many boxes sit in each Stage 04 state.
     *
     * @param array<int,array> $places
     * @return array<string,int>
     */
    private function putawayCounts($boxes, array $places): array
    {
        $out = ['pending' => 0, 'draft' => 0, 'awaiting_scan' => 0, 'placed' => 0];
        foreach ($boxes as $b) {
            $state = $places[$b->id]['status'] ?? 'pending';
            $out[$state] = ($out[$state] ?? 0) + 1;
        }

        return $out;
    }

    /**
     * Which list a box belongs in, and how it must be handled.
     *
     * Order matters: a damaged carton is damaged whatever else is true of it.
     *
     * NOTE the remark value. The column holds 'mismatched'; the HTML prototype
     * tests 'mismatch'. Ported literally that bucket stays empty for ever, so
     * both spellings are accepted here. 'extra' is not a bucket of its own —
     * it is inventory, exactly as the prototype's own card label says.
     *
     * @param array<int,string> $behaviours flag id => behaviour
     */
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

    /** flag id => behaviour, for the tenant's own flags and the platform ones. */
    private function flagBehaviours(SupplierInvoice $spi): array
    {
        return collect($this->flagMaster($spi))
            ->mapWithKeys(fn ($f, $id) => [$id => $f['behaviour'] ?? 'none'])
            ->all();
    }

    /**
     * Boxes the search box matches, by box code or by anything about a product
     * inside it. Ids only — the names are never loaded for boxes that will not
     * be shown.
     *
     * @return array<int>
     */
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

    /**
     * What Stage 04 will not let a box past without. Dimensions and weight
     * decide which shelves can take it, so a box missing them cannot be
     * allocated at all — the screen reads DATA MISSING and names these.
     *
     * @return array<int,string>
     */
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

    /* ══════════════════════════ SECTIONS ══════════════════════════ */

    /** The pill strip across the top. */
    private function header(SupplierInvoice $spi, $boxes, array $places): array
    {
        $po = $spi->purchaseOrder;
        /* The invoice's own shipment first. A Direct SPI captures it at
           Step 01 of its setup; before that column existed this could only
           come from the order, so a Direct SPI reported no shipment even
           when one had been chosen. */
        $shipId = $spi->shipment_order_id ?? $po?->shipment_order_id;
        $ship = $shipId ? DB::table('shipment_orders')->find($shipId) : null;
        $pi = $this->piFor($spi, $po, $ship);

        return [
            'spi_id'         => $spi->code,
            'spi_date'       => optional($spi->invoice_date)->toDateString() ?? $spi->invoice_date,
            // "PO + SPI" when the invoice was raised against an order, "Direct
            // SPI" when it stands alone — the same split isStandalone() reads.
            'spi_type'       => $spi->purchase_order_id ? 'PO + SPI' : 'Direct SPI',
            'shipment_id'    => $ship->shipment_code ?? null,
            'opportunity_id' => $pi->opp_code ?? null,
            // Same rule: Step 02 writes it onto the invoice, and only a
            // PO-backed one falls through to the order.
            'procurement_id' => $spi->procurement_request_code ?? $po?->procurement_request_code,
            'warehouse'      => $this->warehouse($spi),
            'boxes'          => $boxes->count(),
            'products'       => $this->distinctProducts($boxes),
            'total_qty'      => round($boxes->flatMap->items->sum(fn ($i) => (float) $i->quantity), 3),
            // How far the scanning has actually got, which is the one thing the
            // seeded version could never say.
            'placed_boxes'   => count(array_filter($places, fn ($p) => $p['confirmed'])),
        ];
    }

    /** The eight tiles. Counted from the box items, never stored. */
    private function analytics(SupplierInvoice $spi, $boxes): array
    {
        $items = $boxes->flatMap->items;
        [$hazardIds, $coldIds] = $this->flagIds($spi);

        /* Asked of the BOX now, so these count cartons rather than lines.
           They counted lines before only because every line in a carton
           carried the same copy — with one list per box, a line has no
           flags of its own to count. */
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

    /**
     * The proforma invoice this SPI hangs off.
     *
     * The ORDER first, which stays authoritative while it exists; then the
     * SHIPMENT, which carries the same id and is all a Direct SPI has. Read
     * off the order alone, a Direct SPI had no PI - and so no opportunity,
     * customer or consignee - however complete its Step 01 was.
     */
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

    /** Customer and consignee come from the PI behind the order or its shipment; the supplier is the invoice's own. */
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

    /**
     * What is owed on this invoice, and against which document.
     *
     * A PO-backed invoice is paid on its ORDER — the deduction, the payments
     * and the balance all live there, and the invoice is a line of evidence
     * against it. A Direct SPI is paid on itself. `source` says which, so a
     * screen never has to guess which figures it is reading.
     *
     * TDS is cut on taxable_total, not grand_total: it is not deducted on GST.
     */
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
            /* 'purchase_order' or 'supplier_invoice' — which document the money
               moves on, and therefore which figures these are. */
            'source'         => $po ? 'purchase_order' : 'supplier_invoice',
            'code'           => $ledger->code,
            'currency_code'  => $ledger->currency_code ?: 'INR',

            /* The invoice's own value, whichever document is paid. */
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
                /* Approved, not yet paid — what can be released right now. */
                'ready_to_pay' => round((float) $approved->sum(
                    fn ($r) => max(0, (float) $r->approved_amount - (float) $r->paid_amount)
                ), 2),
            ],

            /* The transfers themselves. The totals above say 40,000 is paid;
               these say it was two payments, when, against which request and
               with what proof. */
            'payments' => $this->paymentEntries($spi, $po, $requests),
        ];
    }

    /**
     * Every payment on this invoice's ledger, newest last.
     *
     * Read from the same document the ledger is on — the ORDER for a PO-backed
     * invoice, the INVOICE for a Direct one — and tagged with the request each
     * was released against, because a request may be paid in instalments.
     */
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
            /* Which release this transfer belongs to — one approval can be
               paid in parts. */
            'payment_request_id'   => $p->payment_request_id,
            'payment_request_code' => $codes[$p->payment_request_id] ?? null,
        ])->values()->all();
    }

    /** PI / PO / SPI, each with its date, and the two amounts. */
    private function references(SupplierInvoice $spi): array
    {
        $po = $spi->purchaseOrder;
        /* Through the shared resolver: the order first, then the shipment. Read
           off the order alone this stayed null on a Direct SPI. */
        $pi = $this->piFor($spi, $po);

        return [
            'pi'         => ['code' => $pi->code ?? null, 'date' => $pi->created_at ?? null],
            'po'         => ['code' => $po->code ?? null, 'date' => $po?->po_date],
            'spi'        => ['code' => $spi->code, 'date' => $spi->invoice_date],
            'po_amount'  => $po ? (float) $po->grand_total : null,
            'spi_amount' => (float) $spi->grand_total,
        ];
    }

    /** One row per box: where it was put away, named the way a label reads. */
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

    /** Per-box dimensions and weights, each with the products inside it. */
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

    /** @return array<int, array<string, mixed>> */
    private function boxProducts(SpiBox $b, SupplierInvoice $spi): array
    {
        [$hazardIds, $coldIds] = $this->flagIds($spi);
        $master = $this->flagMaster($spi);

        /* The carton's flags, read once: they describe the box, and every
           line in it is inside that box. */
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
                /* The flag MASTER rows this item carries, not just the two
                 * the tiles count. A box item stores ids in its `flags` json and
                 * nothing else; an id on its own tells a reader nothing, and the
                 * screen draws a chip per flag. Named here from
                 * inventory_product_flags, one query for the whole page.
                 *
                 * is_default marks the platform rows (Hazardous, Cold Chain,
                 * Fragile) that every tenant shares and none may rename — the
                 * same flag the master list returns. */
                'flags'        => array_values(array_filter(array_map(
                    fn (int $id) => $master[$id] ?? null,
                    $flags,
                ))),
                // Kept as their own booleans: the two analytics tiles count
                // these specifically, and a tile should not have to search a list.
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

    /* ══════════════════════════ INTERNALS ══════════════════════════ */

    /**
     * box_id => its put-away row, with the four locations resolved to CODES.
     *
     * Three queries for the whole page, whatever the box count. The shelf has no
     * code column — it is its rack's code plus the level — so it is assembled
     * here exactly as Shelf::getShelfCodeAttribute() assembles it.
     */
    private function placements(SupplierInvoice $spi, $boxes): array
    {
        $rows = $spi->putaways()->get();
        if ($rows->isEmpty()) return [];

        /* Which boxes are out with the warehouse. One query for the invoice —
           a box is only "awaiting scan" while a task on it is still open, and
           that is a different fact from the put-away row's own columns. */
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
                // What the screen calls the Rack Allocation ID: the chain that
                // was actually scanned, in the order it was scanned.
                'allocation_id' => implode('-', array_filter([$zone, $rack, $shelf])) ?: null,
                'confirmed'     => $r->confirmed_at !== null,

                /* The state the left rail groups and badges by. Derived, never
                   read from a column that could disagree with confirmed_at:
                     pending        nobody has started
                     draft          a location is held, nothing confirmed it
                     awaiting_scan  out with the floor on a Zebra task
                     placed         confirmed. Final. */
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

    /**
     * id => the product flag master row, for every flag this tenant can see.
     *
     * Platform defaults (client_id null) included, because that is what the
     * packing screen's built-in chips resolve to and what a box item actually
     * stores. Memoised per client+branch, so a page of boxes costs one query.
     *
     * @return array<int, array{id:int, code:string, name:string, is_default:bool}>
     */
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
                // What the flag MEANS, so a renamed one still routes a box.
                'behaviour'  => $f->behaviour ?: 'none',
                'is_default' => $f->client_id === null,
            ]])
            ->all();
    }

    /**
     * The flag ids that mean Hazardous and Cold Chain for this tenant.
     *
     * Matched by NAME, because the packing screen draws them as built-in chips
     * and the master rows behind them are platform defaults a tenant can also
     * shadow with its own. Ids, once resolved, are what a box item stores.
     *
     * @return array{0: int[], 1: int[]}
     */
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

    /** "1 Product → 1 Box" and the like, from the stored scenario. */
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

    /**
     * The supplier this invoice is against.
     *
     * Off the INVOICE's own vendor_id, not the purchase order's. They are the
     * same supplier — Stage 01 copies it down when the PO is linked — but a
     * standalone invoice has no PO at all, and reading through one would leave
     * the panel blank on exactly the invoices that have nowhere else to show it.
     */
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
            // Which order brought it here; null on a standalone invoice.
            'po_code' => $spi->purchaseOrder?->code,
        ];
    }

    /** A party's country, which lives on its address rather than on the party. */
    private function partyCountry(string $table, string $fk, $id): ?string
    {
        return DB::table($table)->where($fk, $id)->value('country') ?: null;
    }

    /** Distinct invoice LINES packed, which is what the screen counts as products. */
    private function distinctProducts($boxes): int
    {
        return $boxes->flatMap->items
            ->pluck('supplier_invoice_item_id')
            ->filter()->unique()->count();
    }
}
