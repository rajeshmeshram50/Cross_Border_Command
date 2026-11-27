<?php

namespace App\Services\Inventory;

use App\Models\Inventory\LocationLock;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SupplierInvoice;
use Illuminate\Support\Facades\DB;

class LocationFinderService
{
    public function __construct(private LocationOccupancyService $occupancy,
                                private LocationLockService $locks,
                                private PutawaySuggestionEngine $engine) {}

    public function forBox(SupplierInvoice $spi, SpiBox $box, ?string $mode = null, ?int $userId = null): array
    {
        $need  = $this->requirements($spi, $box);
        $zones = $this->zones((int) $spi->warehouse_id);

        $counts = $this->modeCounts($zones, $need, $userId);

        $body = [
            'box'   => $need,
            'modes' => $counts,
        ];

        $diag = $this->diagnose($need, $zones);
        if ($diag && $diag['unsatisfiable']) $body['diagnosis'] = $diag;

        if ($mode === null) return $body;

        $tree = $mode === 'rack'
            ? $this->rackTree($zones->where('rack_mode', 'rack'), $need, $userId)
            : $this->zoneTree($zones->where('rack_mode', 'norack'), $need, $userId);

        $body['zones']       = $tree['zones'];
        $body['eligible']    = $tree['eligible'];
        $body['total']       = $tree['total'];

        if ($tree['eligible'] === 0 && $diag) $body['diagnosis'] = $diag;

        $rows = collect($tree['zones']);
        $body['available'] = $mode === 'rack' ? (int) $rows->sum('available') : $rows->where('state', 'available')->count();
        $body['blocked']   = $mode === 'rack' ? (int) $rows->sum('blocked')   : $rows->where('state', 'blocked')->count();
        $body['full']      = $mode === 'rack' ? (int) $rows->sum('full')      : $rows->where('state', 'full')->count();
        $body['recommended'] = $tree['recommended'];

        return $body;
    }

    private function areaToCm2(?string $unit): float
    {
        return match (strtolower((string) $unit)) {
            'cm'    => 1.0,
            'mm'    => 0.01,
            'ft'    => 929.0304,
            'in'    => 6.4516,
            default => 10_000.0,
        };
    }

    private function requirements(SupplierInvoice $spi, SpiBox $box): array
    {
        $flagIds = collect((array) $box->flags)
            ->map(fn ($v) => (int) $v)->unique()->filter()->values();

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

                    $usedBefore = $cap > 0 ? round($load['weight_kg'] / $cap * 100, 1) : null;
                    $usedAfter  = $cap > 0 ? round(($load['weight_kg'] + $need['weight_kg']) / $cap * 100, 1) : null;

                    $volM3  = $this->engine->shelfVolumeM3($s);
                    $usedM3 = (float) ($load['volume_cm3'] ?? 0) / 1_000_000;

                    $row = [
                        'id'            => (int) $s->id,
                        'name'          => $s->shelf_name,
                        'code'          => $r->code . '-SH-' . str_pad((string) $s->level_no, 2, '0', STR_PAD_LEFT),
                        'level_no'      => (int) $s->level_no,
                        'shelf_type'    => $s->shelf_type,
                        'max_weight_kg' => $cap,
                        'free_weight_kg' => $free,
                        'boxes'         => $load['boxes'],
                        'used_pct'      => $usedBefore,
                        'used_pct_after' => $usedAfter,
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
                        'checks'         => $this->engine->checkShelf($need, $s, $z, $free),
                        'eligible'      => $why === null,
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

                $rCap  = $shelfRows->sum('max_weight_kg');
                $rFree = $shelfRows->sum('free_weight_kg');

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
                    'used_pct' => $rCap > 0 ? round(($rCap - $rFree) / $rCap * 100, 1) : null,
                    'shelves'  => $shelfRows->all(),
                    'total'    => $shelfRows->count(),
                    'eligible' => $shelfRows->where('eligible', true)->count(),
                    'available' => $shelfRows->where('state', 'available')->count(),
                    'blocked'   => $shelfRows->where('state', 'blocked')->count(),
                    'full'      => $shelfRows->where('state', 'full')->count(),
                ];
            })->values();

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
                'used_pct'  => $zCap > 0 ? round(($zCap - $zFree) / $zCap * 100, 1) : null,
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

            $capM3  = (float) ($z->usable_volume ?: $z->volume ?: 0);
            $usedM3 = $load['volume_cm3'] / 1_000_000;
            $freeM3 = max(0, $capM3 - $usedM3);

            $usableShare = ((float) ($z->usable_pct ?? 0) > 0) ? (float) $z->usable_pct / 100 : 1.0;

            $floorCm2 = (float) ($z->floor_area ?? 0) > 0
                ? (float) $z->floor_area * $this->areaToCm2($z->dim_unit) * $usableShare
                : (float) ($z->area_sqft ?? 0) * 929.0304 * $usableShare;

            $usedCm2  = (float) ($load['footprint_cm2'] ?? 0);

            if ($capM3 > 0) {
                $basis = 'volume';
                $usedPct      = round($usedM3 / $capM3 * 100, 1);
                $usedPctAfter = round(($usedM3 + $need['volume_cm3'] / 1_000_000) / $capM3 * 100, 1);
            } elseif ($floorCm2 > 0) {
                $basis = 'floor';
                $usedPct      = round($usedCm2 / $floorCm2 * 100, 1);
                $usedPctAfter = round(($usedCm2 + (float) ($need['footprint_cm2'] ?? 0)) / $floorCm2 * 100, 1);
            } else {
                $basis = null;
                $usedPct = $usedPctAfter = null;
            }

            $why = $this->engine->refuseZone($need, $z, $freeM3, $hold, $userId);
            if ($why === null && $basis === 'floor' && (float) ($need['footprint_cm2'] ?? 0) > 0
                && $usedPctAfter !== null && $usedPctAfter > 100.0) {
                $why = $usedCm2 >= $floorCm2 ? 'full' : 'over_capacity';
            }
            if ($why === null) $eligible++;

            $row = [
                'id'             => (int) $z->id,
                'name'           => $z->zone_name,
                'code'           => $z->code,
                'rack_mode'      => $z->rack_mode,
                'cold_chain'     => (int) $z->cold_chain,
                'hazardous'      => (int) $z->hazardous,
                'purpose'        => $z->purpose,
                'area_sqft'      => $z->area_sqft === null ? null : (float) $z->area_sqft,
                'temp_min_c'     => $z->temp_min_c === null ? null : (float) $z->temp_min_c,
                'temp_max_c'     => $z->temp_max_c === null ? null : (float) $z->temp_max_c,
                'capacity_m3'    => $capM3,
                'free_m3'        => round($freeM3, 3),
                'boxes'          => $load['boxes'],
                'used_pct'       => $usedPct,
                'used_pct_after' => $usedPctAfter,
                'used_basis'     => $basis,
                'floor_area_cm2' => $floorCm2 > 0 ? round($floorCm2, 1) : null,
                'used_area_cm2'  => $floorCm2 > 0 ? $usedCm2 : null,
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

    private function diagnose(array $need, $zones): ?array
    {
        $wants = [];
        if ($need['cold_chain']) $wants['cold_chain'] = 'cold chain';
        if ($need['hazardous'])  $wants['hazardous']  = 'hazardous goods';
        if ($need['temp_min_c'] !== null || $need['temp_max_c'] !== null) {
            $wants['temperature'] = 'this temperature range';
        }
        if (!$wants) return null;

        $places = $this->handlingPlaces($zones);
        if (!$places) return null;

        $meets = fn (array $p, string $key): bool => match ($key) {
            'cold_chain'  => $p['cold_chain'],
            'hazardous'   => $p['hazardous'],
            'temperature' => $this->engine->refuseTemperature($need, $p['zone']) === null,
            default       => true,
        };

        $needs = [];
        foreach ($wants as $key => $label) {
            $n = 0;
            foreach ($places as $p) if ($meets($p, $key)) $n++;
            $needs[] = ['key' => $key, 'label' => $label, 'locations' => $n];
        }

        $matching = 0;
        foreach ($places as $p) {
            if ((bool) $p['cold_chain'] !== (bool) $need['cold_chain']) continue;
            if ((bool) $p['hazardous']  !== (bool) $need['hazardous'])  continue;
            if (($need['temp_min_c'] !== null || $need['temp_max_c'] !== null)
                && $this->engine->refuseTemperature($need, $p['zone']) !== null) continue;
            $matching++;
        }

        $missing = array_values(array_filter($needs, fn ($n) => $n['locations'] === 0));
        $total   = count($places);
        $box     = $need['box_code'];

        if ($missing) {
            $names = implode(' or ', array_column($missing, 'label'));

            return [
                'headline'      => "No location in this warehouse is set up for {$names}.",
                'detail'        => "{$box} needs it, and none of the {$total} active locations here is marked for it. "
                                 . 'Mark a zone or shelf for it, or send this box to a warehouse that has one.',
                'unsatisfiable' => array_column($missing, 'key'),
                'needs'         => $needs,
                'matching'      => $matching,
                'places'        => $total,
            ];
        }

        if ($matching === 0) {
            $names = implode(' and ', array_column($needs, 'label'));

            return [
                'headline'      => count($needs) > 1
                    ? "No single location here matches this box's handling ({$names})."
                    : "No location here matches this box's handling exactly.",
                'detail'        => "{$box} can only go where the handling matches exactly — a location that also carries "
                                 . 'cold chain or hazardous it does not need is not eligible. Mark a location for exactly this, or repack.',
                'unsatisfiable' => ['combination'],
                'needs'         => $needs,
                'matching'      => 0,
                'places'        => $total,
            ];
        }

        return [
            'headline'      => $matching === 1
                ? '1 location can handle this box, but it has no room or is in use.'
                : "{$matching} locations can handle this box, but none has room or they are in use.",
            'detail'        => 'The handling flags are not the problem here — space, weight or another operator holding the spot is.',
            'unsatisfiable' => [],
            'needs'         => $needs,
            'matching'      => $matching,
            'places'        => $total,
        ];
    }

    private function handlingPlaces($zones): array
    {
        $active = $zones->where('status', 1);
        $out = [];

        foreach ($active->where('rack_mode', 'norack') as $z) {
            $out[] = ['cold_chain' => (bool) $z->cold_chain, 'hazardous' => (bool) $z->hazardous, 'zone' => $z];
        }

        $rackZones = $active->where('rack_mode', 'rack')->keyBy('id');
        if ($rackZones->isEmpty()) return $out;

        $shelves = DB::table('inventory_shelves as s')
            ->join('inventory_racks as r', 'r.id', '=', 's.rack_id')
            ->whereIn('r.zone_id', $rackZones->keys()->all())
            ->where('s.status', 1)->where('r.status', 1)
            ->get(['s.cold_chain', 's.hazardous', 'r.zone_id']);

        foreach ($shelves as $sh) {
            $z = $rackZones[$sh->zone_id];
            $out[] = [
                'cold_chain' => (bool) $sh->cold_chain || (bool) $z->cold_chain,
                'hazardous'  => (bool) $sh->hazardous  || (bool) $z->hazardous,
                'zone'       => $z,
            ];
        }

        return $out;
    }

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
