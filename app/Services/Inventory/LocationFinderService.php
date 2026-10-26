<?php

namespace App\Services\Inventory;

use App\Models\Inventory\LocationLock;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SupplierInvoice;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · where a box may go, and which of those places is best.
 *
 * Serves the whole of Stage 04 Step 02 in one pass: the mode counts on the
 * opening modal, the recommendation in Section A, and the tree in Section B.
 * One pass because the recommendation IS the top of the tree's own ranked list
 * — computing it twice would cost twice and could disagree with itself.
 *
 * WHAT IT DOES NOT DECIDE ANYTHING. Every condition and every weight lives in
 * PutawaySuggestionEngine — one file — so the rules can be read and argued
 * about without reading this one. This service fetches, shapes and counts; the
 * engine judges.
 */
class LocationFinderService
{
    public function __construct(private LocationOccupancyService $occupancy,
                                private LocationLockService $locks,
                                private PutawaySuggestionEngine $engine) {}

    /**
     * @param  string|null $mode 'rack' | 'norack'; null returns only the counts
     * @return array<string,mixed>
     */
    public function forBox(SupplierInvoice $spi, SpiBox $box, ?string $mode = null, ?int $userId = null): array
    {
        $need  = $this->requirements($spi, $box);
        $zones = $this->zones((int) $spi->warehouse_id);

        $counts = $this->modeCounts($zones, $need, $userId);

        $body = [
            'box'   => $need,
            'modes' => $counts,
        ];

        if ($mode === null) return $body;

        $tree = $mode === 'rack'
            ? $this->rackTree($zones->where('rack_mode', 'rack'), $need, $userId)
            : $this->zoneTree($zones->where('rack_mode', 'norack'), $need, $userId);

        $body['zones']       = $tree['zones'];
        $body['eligible']    = $tree['eligible'];
        $body['total']       = $tree['total'];

        /* The same three buckets for the whole warehouse, so the header can
           say "2 available · 1 not valid for this box · 0 full" without the
           caller walking the tree to add it up. A no-rack zone IS the
           location, so there each zone counts as one. */
        $rows = collect($tree['zones']);
        $body['available'] = $mode === 'rack' ? (int) $rows->sum('available') : $rows->where('state', 'available')->count();
        $body['blocked']   = $mode === 'rack' ? (int) $rows->sum('blocked')   : $rows->where('state', 'blocked')->count();
        $body['full']      = $mode === 'rack' ? (int) $rows->sum('full')      : $rows->where('state', 'full')->count();
        $body['recommended'] = $tree['recommended'];

        return $body;
    }

    /* ═══════════════════════ WHAT THE BOX NEEDS ═══════════════════════ */

    /**
     * The box's own demands, resolved once.
     *
     * Cold chain and hazardous come from the product flags INSIDE the box, by
     * meaning rather than by name: inventory_product_flags.behaviour, not the
     * tenant-editable flag_name. A renamed flag must not silently stop a rule.
     */
    private function requirements(SupplierInvoice $spi, SpiBox $box): array
    {
        $flagIds = DB::table('p2p_spi_box_items')
            ->where('box_id', $box->id)->whereNull('deleted_at')
            ->pluck('flags')
            ->flatMap(fn ($j) => array_map('intval', (array) json_decode((string) $j, true)))
            ->unique()->filter()->values();

        $behaviours = $flagIds->isEmpty() ? collect() : DB::table('inventory_product_flags')
            ->whereIn('id', $flagIds)->pluck('behaviour');

        $weight = (float) ($box->gross_weight_kg ?: $box->weight_kg ?: 0);

        return [
            'id'            => $box->id,
            'box_code'      => $box->box_code,
            'weight_kg'     => $weight,
            'height_cm'     => (float) ($box->height_cm ?: 0),
            'footprint_cm2' => (float) ($box->length_cm ?: 0) * (float) ($box->width_cm ?: 0),
            'volume_cm3'    => (float) ($box->length_cm ?: 0) * (float) ($box->width_cm ?: 0) * (float) ($box->height_cm ?: 0),
            'cold_chain'    => $behaviours->contains('cold_chain'),
            'hazardous'     => $behaviours->contains('hazardous'),
            'fragile'       => $behaviours->contains('fragile'),
            'is_stackable'  => (bool) $box->is_stackable,
            'temp_min_c'    => $box->temp_min_c === null ? null : (float) $box->temp_min_c,
            'temp_max_c'    => $box->temp_max_c === null ? null : (float) $box->temp_max_c,
            'spi_id'        => $spi->id,
        ];
    }

    private function zones(int $warehouseId)
    {
        return collect(DB::table('inventory_zones')->where('warehouse_id', $warehouseId)->get());
    }

    /* ═══════════════════════ THE TREE ═══════════════════════ */

    /** Zone › Rack › Shelf, every level carrying its fill and its eligibility. */
    private function rackTree($zones, array $need, ?int $userId): array
    {
        $zoneIds = $zones->pluck('id')->all();

        $racks = $zoneIds ? collect(DB::table('inventory_racks')->whereIn('zone_id', $zoneIds)->get()) : collect();
        $rackIds = $racks->pluck('id')->all();

        $shelves = $rackIds ? collect(DB::table('inventory_shelves')->whereIn('rack_id', $rackIds)->orderBy('level_no')->get()) : collect();

        $loads  = $this->occupancy->shelfLoads($shelves->pluck('id')->all());
        $locked = $this->locks->heldMap(LocationLock::SHELF, $shelves->pluck('id')->all());
        $mates  = $this->invoiceMates($need['spi_id']);

        $total = $eligible = 0;
        $best  = null;

        $out = $zones->map(function ($z) use ($racks, $shelves, $loads, $locked, $mates, $need, $userId, &$total, &$eligible, &$best) {
            $zoneRacks = $racks->where('zone_id', $z->id);

            $rackRows = $zoneRacks->map(function ($r) use ($shelves, $loads, $locked, $mates, $need, $z, $userId, &$total, &$eligible, &$best) {
                $rackShelves = $shelves->where('rack_id', $r->id);

                $shelfRows = $rackShelves->map(function ($s) use ($loads, $locked, $mates, $need, $z, $r, $userId, &$total, &$eligible, &$best) {
                    $total++;
                    $load  = $loads[$s->id] ?? ['weight_kg' => 0, 'volume_cm3' => 0, 'boxes' => 0];
                    $cap   = (float) ($s->max_weight_kg ?: 0);
                    $free  = max(0, $cap - $load['weight_kg']);
                    $hold  = $locked[$s->id] ?? null;

                    $why = $this->engine->refuseShelf($need, $s, $z, $free, $hold, $userId);
                    if ($why === null) $eligible++;

                    $usedBefore = $cap > 0 ? round($load['weight_kg'] / $cap * 100, 1) : 0.0;
                    $usedAfter  = $cap > 0 ? round(($load['weight_kg'] + $need['weight_kg']) / $cap * 100, 1) : 0.0;

                    $volM3  = $this->engine->shelfVolumeM3($s);
                    $usedM3 = (float) ($load['volume_cm3'] ?? 0) / 1_000_000;

                    $row = [
                        'id'            => (int) $s->id,
                        'name'          => $s->shelf_name,
                        // No code column: a shelf is its rack's code plus the level.
                        'code'          => $r->code . '-SH-' . str_pad((string) $s->level_no, 2, '0', STR_PAD_LEFT),
                        'level_no'      => (int) $s->level_no,
                        /* What KIND of shelf it is — Standard, Cold, Heavy
                           Duty and so on. Step 03 states it beside the zone
                           and the rack; without it that cell had to repeat the
                           shelf's name, which the title and the breadcrumb
                           above it already carry twice over. */
                        'shelf_type'    => $s->shelf_type,
                        'max_weight_kg' => $cap,
                        'free_weight_kg' => $free,
                        'boxes'         => $load['boxes'],
                        'used_pct'      => $usedBefore,
                        'used_pct_after' => $usedAfter,
                        /* The shelf as it is, for the panel that explains the
                           pick: its size, what is left of it, and the two
                           conditions a box can be refused on. */
                        'dimensions_cm' => [
                            'length' => (float) ($s->length ?: 0),
                            'width'  => (float) ($s->width ?: 0),
                            'height' => (float) ($s->height_cm ?: $s->height ?: 0),
                        ],
                        'volume_m3'      => $volM3,
                        'free_volume_m3' => $volM3 > 0 ? round(max(0, $volM3 - $usedM3), 3) : 0.0,
                        'cold_chain'     => (bool) $s->cold_chain,
                        'hazardous'      => (bool) $s->hazardous,
                        'shelf_type'     => $s->shelf_type ?? null,
                        // Every rule that ran, pass AND fail — not just the refusal.
                        'checks'         => $this->engine->checkShelf($need, $s, $z, $free),
                        'eligible'      => $why === null,
                        /* available · blocked · full. `eligible` stays for the
                           callers that only ask yes/no; `state` is what tells
                           a wrong-temperature shelf from a full one. */
                        'state'         => $this->engine->state($why),
                        'state_label'   => $this->engine->stateLabel($why),
                        'reason'        => $why,
                        'reason_label'  => $this->engine->label($why),
                        'held_by'       => $hold['held_by'] ?? null,
                    ];

                    if ($why === null) {
                        $scored = $this->engine->scoreShelf($need, $cap, $load, (int) $s->level_no, in_array((int) $s->id, $mates, true));
                        $row['score']       = $scored['score'];
                        $row['score_parts'] = $scored['parts'];
                        if ($best === null || $row['score'] > $best['score']) {
                            $best = $row + [
                                'zone_id' => (int) $z->id, 'zone_name' => $z->zone_name, 'zone_code' => $z->code,
                                'rack_id' => (int) $r->id, 'rack_name' => $r->rack_name, 'rack_code' => $r->code,
                            ];
                        }
                    }

                    return $row;
                })->values();

                /* A rack holds no counters of its own, on purpose — its fill is
                   the sum of its shelves, and a stored copy would be free to
                   drift from both. Summed here from rows already in hand. */
                $rCap  = $shelfRows->sum('max_weight_kg');
                $rFree = $shelfRows->sum('free_weight_kg');

                /* Free space THIS box could actually take. free_weight_kg is a
                   fact about the warehouse and counts every shelf; a rack whose
                   shelves are all the wrong temperature still reports its full
                   capacity as free, which reads as plenty of room when there is
                   none. Invalid is not the same as full, and both numbers have
                   to be on the row for a reader to tell them apart. */
                $fit    = $shelfRows->where('eligible', true);
                $rUsable = $fit->sum('free_weight_kg');
                $rUsableM3 = $fit->sum('free_volume_m3');

                return [
                    'id'       => (int) $r->id,
                    'name'     => $r->rack_name,
                    'code'     => $r->code,
                    'max_weight_kg'  => round($rCap, 3),
                    'free_weight_kg' => round($rFree, 3),
                    'usable_weight_kg' => round($rUsable, 3),
                    'usable_volume_m3' => round($rUsableM3, 3),
                    'boxes'    => $shelfRows->sum('boxes'),
                    'used_pct' => $rCap > 0 ? round(($rCap - $rFree) / $rCap * 100, 1) : 0.0,
                    'shelves'  => $shelfRows->all(),
                    'total'    => $shelfRows->count(),
                    'eligible' => $shelfRows->where('eligible', true)->count(),
                    /* The same shelves split three ways. blocked + full is
                       total - eligible, but a reader should not have to work
                       out which of the two they are looking at. */
                    'available' => $shelfRows->where('state', 'available')->count(),
                    'blocked'   => $shelfRows->where('state', 'blocked')->count(),
                    'full'      => $shelfRows->where('state', 'full')->count(),
                ];
            })->values();

            /* Same again one level up. A RACKED zone's fill comes from its
               shelves; the used_* columns on inventory_zones are only written
               for no-rack zones, where the zone itself holds the boxes. */
            $zCap  = $rackRows->sum('max_weight_kg');
            $zFree = $rackRows->sum('free_weight_kg');
            $zUsable   = $rackRows->sum('usable_weight_kg');
            $zUsableM3 = $rackRows->sum('usable_volume_m3');

            return [
                'id'        => (int) $z->id,
                'name'      => $z->zone_name,
                'code'      => $z->code,
                'rack_mode' => $z->rack_mode,
                'cold_chain' => (int) $z->cold_chain,
                'hazardous' => (int) $z->hazardous,
                'purpose'   => $z->purpose,
                'area_sqft' => $z->area_sqft === null ? null : (float) $z->area_sqft,
                'temp_min_c' => $z->temp_min_c === null ? null : (float) $z->temp_min_c,
                'temp_max_c' => $z->temp_max_c === null ? null : (float) $z->temp_max_c,
                'max_weight_kg'  => round($zCap, 3),
                'free_weight_kg' => round($zFree, 3),
                'usable_weight_kg' => round($zUsable, 3),
                'usable_volume_m3' => round($zUsableM3, 3),
                'boxes'     => $rackRows->sum('boxes'),
                'used_pct'  => $zCap > 0 ? round(($zCap - $zFree) / $zCap * 100, 1) : 0.0,
                'racks'     => $rackRows->all(),
                'total'     => $rackRows->sum('total'),
                'eligible'  => $rackRows->sum('eligible'),
                'available' => $rackRows->sum('available'),
                'blocked'   => $rackRows->sum('blocked'),
                'full'      => $rackRows->sum('full'),
            ];
        })->values();

        return ['zones' => $out->all(), 'total' => $total, 'eligible' => $eligible, 'recommended' => $best];
    }

    /** A no-rack zone IS the location — no racks, no shelves, no levels. */
    private function zoneTree($zones, array $need, ?int $userId): array
    {
        $ids    = $zones->pluck('id')->all();
        $loads  = $this->occupancy->zoneLoads($ids, directOnly: true);
        $locked = $this->locks->heldMap(LocationLock::ZONE, $ids);

        $total = $eligible = 0;
        $best  = null;

        $out = $zones->map(function ($z) use ($loads, $locked, $need, $userId, &$total, &$eligible, &$best) {
            $total++;
            $load = $loads[$z->id] ?? ['weight_kg' => 0, 'volume_cm3' => 0, 'boxes' => 0];
            $hold = $locked[$z->id] ?? null;

            // A zone states capacity in m³ (or litres for a fridge), not kilos.
            $capM3  = (float) ($z->usable_volume ?: $z->volume ?: 0);
            $usedM3 = $load['volume_cm3'] / 1_000_000;
            $freeM3 = max(0, $capM3 - $usedM3);

            $why = $this->engine->refuseZone($need, $z, $freeM3, $hold, $userId);
            if ($why === null) $eligible++;

            $row = [
                'id'             => (int) $z->id,
                'name'           => $z->zone_name,
                'code'           => $z->code,
                'rack_mode'      => $z->rack_mode,
                'cold_chain'     => (int) $z->cold_chain,
                'hazardous'      => (int) $z->hazardous,
                // What the zone IS, and how big its floor is. The rack branch
                // has returned purpose since it was written; the floor branch
                // never did, so Step 02's no-rack pane had nothing to name a
                // zone by beyond its code.
                'purpose'        => $z->purpose,
                'area_sqft'      => $z->area_sqft === null ? null : (float) $z->area_sqft,
                'temp_min_c'     => $z->temp_min_c === null ? null : (float) $z->temp_min_c,
                'temp_max_c'     => $z->temp_max_c === null ? null : (float) $z->temp_max_c,
                'capacity_m3'    => $capM3,
                'free_m3'        => round($freeM3, 3),
                'boxes'          => $load['boxes'],
                'used_pct'       => $capM3 > 0 ? round($usedM3 / $capM3 * 100, 1) : 0.0,
                'used_pct_after' => $capM3 > 0 ? round(($usedM3 + $need['volume_cm3'] / 1_000_000) / $capM3 * 100, 1) : 0.0,
                'eligible'       => $why === null,
                'state'          => $this->engine->state($why),
                'state_label'    => $this->engine->stateLabel($why),
                'reason'         => $why,
                'reason_label'   => $this->engine->label($why),
                'held_by'        => $hold['held_by'] ?? null,
            ];

            if ($why === null && ($best === null || $row['free_m3'] < $best['free_m3'])) {
                $best = $row;
            }

            return $row;
        })->values();

        return ['zones' => $out->all(), 'total' => $total, 'eligible' => $eligible, 'recommended' => $best];
    }

    /** Shelves already holding a box from this same invoice. */
    private function invoiceMates(int $spiId): array
    {
        return DB::table('inventory_location_occupancy as o')
            ->join('p2p_spi_boxes as b', function ($j) {
                $j->on('b.id', '=', 'o.occupant_id')->where('o.occupant_type', '=', 'spi_box');
            })
            ->where('b.supplier_invoice_id', $spiId)
            ->whereIn('o.status', ['reserved', 'occupied'])
            ->whereNotNull('o.shelf_id')
            ->pluck('o.shelf_id')
            ->map(fn ($v) => (int) $v)
            ->unique()->values()->all();
    }

    /** How many places each mode offers — the two numbers on the opening modal. */
    private function modeCounts($zones, array $need, ?int $userId): array
    {
        $rackZones   = $zones->where('rack_mode', 'rack');
        $norackZones = $zones->where('rack_mode', 'norack');

        $shelves = $rackZones->isEmpty() ? collect() : collect(
            DB::table('inventory_shelves as s')
                ->join('inventory_racks as r', 'r.id', '=', 's.rack_id')
                ->whereIn('r.zone_id', $rackZones->pluck('id'))
                ->where('s.status', 1)->where('r.status', 1)
                ->get(['s.id'])
        );

        return [
            'rack'   => $shelves->count(),
            'norack' => $norackZones->where('status', 1)->count(),
        ];
    }
}
