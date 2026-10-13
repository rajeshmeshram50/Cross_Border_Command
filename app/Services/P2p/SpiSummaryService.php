<?php

namespace App\Services\P2p;

use App\Models\Inventory\ProductFlag;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SpiBoxItem;
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
            'locations'  => $this->locations($boxes, $places),
            'boxes'      => $this->boxDetails($boxes, $places, $spi),
        ];
    }

    /* ══════════════════════════ SECTIONS ══════════════════════════ */

    /** The pill strip across the top. */
    private function header(SupplierInvoice $spi, $boxes, array $places): array
    {
        $po = $spi->purchaseOrder;
        $pi = $po?->proforma_invoice_id
            ? DB::table('proforma_invoices')->find($po->proforma_invoice_id)
            : null;
        $ship = $po?->shipment_order_id
            ? DB::table('shipment_orders')->find($po->shipment_order_id)
            : null;

        return [
            'spi_id'         => $spi->code,
            'spi_date'       => optional($spi->invoice_date)->toDateString() ?? $spi->invoice_date,
            // "PO + SPI" when the invoice was raised against an order, "Direct
            // SPI" when it stands alone — the same split isStandalone() reads.
            'spi_type'       => $spi->purchase_order_id ? 'PO + SPI' : 'Direct SPI',
            'shipment_id'    => $ship->shipment_code ?? null,
            'opportunity_id' => $pi->opp_code ?? null,
            'procurement_id' => $po->procurement_request_code ?? null,
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

        $carries = fn ($item, array $ids) => (bool) array_intersect(
            array_map('intval', (array) ($item->flags ?? [])),
            $ids,
        );

        return [
            'total_boxes'      => $boxes->count(),
            'total_products'   => $this->distinctProducts($boxes),
            'total_quantity'   => round($items->sum(fn ($i) => (float) $i->quantity), 3),
            'spi_value'        => (float) $spi->grand_total,
            'hazardous'        => $items->filter(fn ($i) => $carries($i, $hazardIds))->count(),
            'cold_chain'       => $items->filter(fn ($i) => $carries($i, $coldIds))->count(),
            'damaged_rejected' => $items->where('remark', SpiBoxItem::REMARK_DAMAGED)->count(),
            'mismatched'       => $items->where('remark', SpiBoxItem::REMARK_MISMATCHED)->count(),
        ];
    }

    /** Customer and consignee come from the PI behind the order; the supplier is the invoice's own. */
    private function parties(SupplierInvoice $spi): array
    {
        $out = [];
        $po  = $spi->purchaseOrder;
        $pi  = $po?->proforma_invoice_id
            ? DB::table('proforma_invoices')->find($po->proforma_invoice_id)
            : null;

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

    /** PI / PO / SPI, each with its date, and the two amounts. */
    private function references(SupplierInvoice $spi): array
    {
        $po = $spi->purchaseOrder;
        $pi = $po?->proforma_invoice_id
            ? DB::table('proforma_invoices')->find($po->proforma_invoice_id)
            : null;

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

        return $b->items->values()->map(function (SpiBoxItem $it, int $i) use ($hazardIds, $coldIds, $master) {
            $flags = array_map('intval', (array) ($it->flags ?? []));
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

            $out[$r->box_id] = [
                'warehouse' => $r->warehouse_id ? ($wh[$r->warehouse_id] ?? null) : null,
                'zone'      => $zone,
                'rack'      => $rack,
                'shelf'     => $shelf,
                // What the screen calls the Rack Allocation ID: the chain that
                // was actually scanned, in the order it was scanned.
                'allocation_id' => implode('-', array_filter([$zone, $rack, $shelf])) ?: null,
                'confirmed'     => $r->confirmed_at !== null,
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
