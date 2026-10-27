<?php

namespace App\Http\Controllers\Api\Inventory;

use App\Models\Inventory\Rack;
use App\Models\Inventory\Shelf;
use App\Models\Inventory\Warehouse;
use App\Models\Inventory\Zone;
use App\Services\Inventory\InventoryCodeAllocator;
use App\Services\Inventory\InventoryMasterService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Inventory · Zone Master. /api/inventory/zones
 *
 * rack_mode decides what the rest of the payload may contain:
 *   rack    racks go inside it, so it sends no capacity figures at all
 *   norack  no shelf to scan, so it must state its own — litres for a fridge,
 *           or length × width × height for an open floor
 *
 * Sending the wrong half is rejected rather than quietly ignored: a fridge
 * saved with floor dimensions would show capacity it does not have.
 *
 * Every computed figure (floor_area, volume, usable_volume) is taken as the
 * screen sent it. The one thing the server insists on is that the zone fits in
 * the warehouse, because only the server can see the other zones.
 */
class ZoneController extends BaseInventoryController
{
    /** Changing its warehouse or type, or switching it off, with racks or stock in it. */
    private const IN_USE = 'This zone holds stock or racks — move them first.';

    public function __construct(
        private InventoryMasterService $svc,
        private InventoryCodeAllocator $codes,
    ) {}

    /* ══════════════════════════ READ ══════════════════════════ */

    /** GET /inventory/zones */
    public function index(Request $request)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);

            $f = $request->validate($this->listRules() + [
                'warehouse_id' => ['nullable', 'integer'],
                'rack_mode'    => ['nullable', Rule::in(Zone::MODES)],
                'cold_chain'   => ['nullable', 'integer', 'in:0,1'],
                'hazardous'    => ['nullable', 'integer', 'in:0,1'],
            ]);

            $base = $this->scopeTenant(Zone::query(), $user, $branch);
            if (!empty($f['warehouse_id'])) $base->where('warehouse_id', $f['warehouse_id']);
            if (!empty($f['rack_mode']))    $base->where('rack_mode', $f['rack_mode']);
            if (isset($f['cold_chain']))    $base->where('cold_chain', $f['cold_chain']);
            if (isset($f['hazardous']))     $base->where('hazardous', $f['hazardous']);

            // The dropdown leaves before the tabs, the counts and the paging.
            if ($this->wantsOptions($request)) {
                $body = $this->optionsBody($base, 'zone_name', fn (Zone $z) => $this->optionRow($z));

                DB::commit();

                return response()->json($body, 200);
            }

            $tabs = $this->tabCounts(clone $base);

            $q = $base->with('warehouse:id,wh_name,wh_type')->withCount('racks')->orderByDesc('id');

            $this->applyTab($q, $f['tab'] ?? null);
            // Searchable by its code now that the code is a stored column.
            $this->applySearch($q, $f['q'] ?? null, ['code', 'zone_name', 'purpose'], function ($w, $term) {
                $w->orWhereHas('warehouse', fn ($h) => $h->where('wh_name', 'ilike', '%' . $term . '%'));
            });

            $body = $this->listBody($q, $request, $tabs, fn (Zone $z) => $this->row($z));

            DB::commit();

            return response()->json($body, 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * GET /inventory/zones/options?warehouse_id=&rack_mode=rack
     * The Rack form's zone dropdown. Same method as the list; warehouse_id and
     * rack_mode are ordinary filters there, so nothing special is needed here.
     */
    public function options(Request $request)
    {
        return $this->index($request->merge(['view' => 'options']));
    }

    /** GET /inventory/zones/next-code — preview of the next zone's code. */
    public function nextCode(Request $request)
    {
        $user = $this->tenantUser($request);

        return response()->json(['status' => true, 'data' => [
            'next_code' => $this->codes->peek('inventory_zones', $user->client_id, $this->branchScope($request, $user)),
            'preview'   => true,
        ]], 200);
    }

    /**
     * What is stored in this zone right now.
     *
     * Volume where the zone records one, floor coverage where it records only
     * its dimensions, and nothing where it records neither — `used_basis`
     * says which, because "42% of the floor" and "42% full" are different
     * claims. Capacity is usable_volume, not volume: the difference is aisles
     * and clearance, space no box can occupy, so measuring fill against the
     * gross figure would make a packed zone look half empty.
     */
    private function stockUsage(Zone $zone): array
    {
        $load = app(\App\Services\Inventory\LocationOccupancyService::class)
            ->zoneLoads([$zone->id], directOnly: true)[$zone->id]
            ?? ['weight_kg' => 0, 'volume_cm3' => 0, 'footprint_cm2' => 0, 'boxes' => 0];

        $capM3  = (float) ($zone->usable_volume ?: $zone->volume ?: 0);
        $usedM3 = (float) $load['volume_cm3'] / 1_000_000;

        $usableShare = ((float) ($zone->usable_pct ?? 0) > 0) ? (float) $zone->usable_pct / 100 : 1.0;
        $unit = match (strtolower((string) $zone->dim_unit)) {
            'cm' => 1.0, 'mm' => 0.01, 'ft' => 929.0304, 'in' => 6.4516, default => 10_000.0,
        };
        $floorCm2 = (float) ($zone->floor_area ?? 0) > 0
            ? (float) $zone->floor_area * $unit * $usableShare
            : (float) ($zone->area_sqft ?? 0) * 929.0304 * $usableShare;
        $usedCm2 = (float) ($load['footprint_cm2'] ?? 0);

        if ($capM3 > 0) {
            $basis = 'volume';
            $pct   = round($usedM3 / $capM3 * 100, 1);
        } elseif ($floorCm2 > 0) {
            $basis = 'floor';
            $pct   = round($usedCm2 / $floorCm2 * 100, 1);
        } else {
            $basis = null;
            $pct   = null;
        }

        return [
            'stored_boxes'    => (int) $load['boxes'],
            'stored_weight_kg'=> round((float) $load['weight_kg'], 3),
            'capacity_m3'     => $capM3 ?: null,
            'used_volume_m3'  => round($usedM3, 6),
            /* Signed on purpose. Clamping at zero hides the one state worth
               acting on — a zone holding more than it can take. */
            'free_volume_m3'  => $capM3 > 0 ? round($capM3 - $usedM3, 3) : null,
            'used_pct'        => $pct,
            // Room still to store in, the same share read the other way.
            'available_pct'   => $pct === null ? null : round(100 - $pct, 1),
            'used_basis'      => $basis,
            'floor_area_cm2'  => $floorCm2 > 0 ? round($floorCm2, 1) : null,
            'used_area_cm2'   => $floorCm2 > 0 ? $usedCm2 : null,
        ];
    }

    /** GET /inventory/zones/{id} */
    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $zone = $this->ownedQuery(Zone::query(), $user)
                ->with('warehouse:id,wh_name,wh_type')->withCount('racks')->findOrFail($id);

            /* free_area_sqft is a LAYOUT figure — floor not yet taken by racks,
               which is what you need when adding one. It says nothing about
               stock, so a zone holding a hundred boxes still reports its whole
               floor free. The occupancy block below is the stock answer. */
            $body = $this->row($zone)
                + ['free_area_sqft' => $this->svc->freeZoneAreaSqft($zone)]
                + $this->stockUsage($zone);

            DB::commit();

            return response()->json(['status' => true, 'data' => $body], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ WRITE ══════════════════════════ */

    /** POST /inventory/zones */
    public function store(Request $request)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $data = $request->validate($this->rules());

            $warehouse = $this->guard($data, null, $user);

            $zone = new Zone($this->shape($data));
            // The warehouse's tenancy, never the user's: a client admin has no
            // branch of their own, and the zone lives where its warehouse does.
            $zone->client_id  = $warehouse->client_id;
            $zone->branch_id  = $warehouse->branch_id;
            $zone->created_by = $user->id;
            // Per branch, under a lock, inside this transaction — see Warehouse.
            $zone->code = $this->codes->next('inventory_zones', $warehouse->client_id, $warehouse->branch_id);
            $zone->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($zone->load('warehouse'))], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** PUT /inventory/zones/{id} */
    public function update(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $zone = $this->ownedQuery(Zone::query(), $user)->lockForUpdate()->findOrFail($id);
            $data = $request->validate($this->rules());

            $warehouse = $this->guard($data, $zone, $user);

            $this->guardChildren($data, $zone);

            $zone->fill($this->shape($data));
            $zone->branch_id  = $warehouse->branch_id;
            $zone->updated_by = $user->id;
            $zone->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($zone->load('warehouse'))], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** PUT /inventory/zones/{id}/status */
    public function setStatus(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $zone = $this->ownedQuery(Zone::query(), $user)->findOrFail($id);
            $data = $request->validate(['status' => ['required', 'integer', 'in:0,1']]);

            if ((int) $data['status'] === 1 && !$zone->warehouse?->isActive()) {
                $this->reject("{$zone->zone_code} cannot be activated — its warehouse {$zone->warehouse?->wh_code} is inactive", null, 409);
            }
            /* Retired from the bottom up: a zone with live racks or boxes used
               to switch them all off with it, silently. */
            if ((int) $data['status'] === 0 && $zone->isActive()
                && (Rack::where('zone_id', $zone->id)->where('status', 1)->exists()
                    || $this->holdsStock('zone_id', $zone->id))) {
                $this->reject(self::IN_USE, null, 409);
            }

            $zone->forceFill(['status' => $data['status'], 'updated_by' => $user->id])->save();

            // A rack under a dead zone must not stay on the put-away picker.
            if ((int) $data['status'] === 0) {
                Rack::where('zone_id', $zone->id)->update(['status' => 0, 'updated_by' => $user->id]);
                Shelf::whereIn('rack_id', Rack::where('zone_id', $zone->id)->select('id'))
                    ->update(['status' => 0, 'updated_by' => $user->id]);
            }

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($zone->load('warehouse'))], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** DELETE /inventory/zones/{id} */
    public function destroy(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $zone = $this->ownedQuery(Zone::query(), $user)->withCount('racks')->lockForUpdate()->findOrFail($id);

            if ($zone->racks_count > 0) {
                $this->reject("{$zone->zone_name} holds {$zone->racks_count} rack(s). Deactivate it instead of deleting it.", null, 409);
            }
            // A no-rack zone IS the location, so its stock points at it directly.
            if ($used = $this->referencedBy('zone_id', $zone->id)) {
                $this->reject("{$zone->zone_name} is used by {$used}. Deactivate it instead of deleting it.", null, 409);
            }

            $zone->delete();

            DB::commit();

            return response()->json(['status' => true, 'data' => ['id' => $id, 'deleted' => true]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * GET /inventory/zones/{id}/preview — the label as data.
     *
     * The screen shows the QR and the details first; the download comes after,
     * from the same numbers. Both read labelData(), so the modal and the paper
     * can never disagree.
     */
    public function preview(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $data = $this->labelData($request, $id);

            DB::commit();

            return response()->json(['status' => true, 'data' => $data + [
                'qr'           => $this->qr($this->stickerPayload($data)),
                'download_url' => url("/api/inventory/zones/{$id}/label"),
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** GET /inventory/zones/{id}/label — the same label, as a 4x3in PDF. */
    public function label(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $data = $this->labelData($request, $id);
            $pdf  = $this->labelPdf($data, $data['code']);

            DB::commit();

            return $pdf;
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * What the zone label prints. Scanned at put-away as scan_type 'location',
     * so the code on it is what the operator's second scan must match.
     */
    private function labelData(Request $request, int $id): array
    {
        $user = $this->tenantUser($request);
        $z = $this->scopeTenant(Zone::query(), $user, $this->branchScope($request, $user))
            ->with('warehouse:id,wh_name')
            ->withCount('racks')
            ->findOrFail($id);

        $temp = $z->cold_chain && $z->temp_min_c !== null
            ? ((float) $z->temp_min_c) . ' to ' . ((float) $z->temp_max_c) . ' C'
            : null;

        return [
            'kind'     => 'ZONE',
            'code'     => $z->zone_code,
            'scan'     => $this->scanValue('ZN', (int) $z->id),
            'title'    => $z->zone_name,
            'subtitle' => $z->warehouse?->wh_name,
            'rows'     => array_filter([
                'Purpose'  => $z->purpose,
                'Type'     => $z->isRacked() ? 'With Rack' : 'Without Rack',
                'Area'     => $z->area_sqft ? number_format((float) $z->area_sqft) . ' Sq. Ft' : null,
                'Racks'    => $z->isRacked() ? $z->racks_count : null,
                'Capacity' => $z->capacity_litres ? number_format((float) $z->capacity_litres) . ' L' : null,
                'Temp'     => $temp,
            ], fn ($v) => $v !== null && $v !== ''),
            'flags'    => array_values(array_filter([
                $this->flag((bool) $z->cold_chain, 'COLD CHAIN', 'cold'),
                $this->flag((bool) $z->hazardous, 'HAZARDOUS', 'haz'),
                $this->flag(!$z->isActive(), 'INACTIVE', 'off'),
            ])),
        ];
    }

    /**
     * GET /inventory/zones/{id}/qr — the QR and nothing else.
     *
     * A bare PNG, served inline so it drops straight into an <img src>. The
     * label endpoint wraps the same code in a printable card; this one is for
     * a screen that places it itself.
     *
     * ?scale=10 sets pixels per module (1-20).
     */
    public function qrImage(Request $request, int $id)
    {
        $data = $this->labelData($request, $id);

        /* Whatever the printed label encodes, byte for byte — one source,
           so a QR saved from this screen and one glued to the rack can never
           resolve to different things. Carries the row id, because codes
           restart at 001 in every branch and "WH-001" names three of them. */
        return $this->qrPng($this->stickerPayload($data), (int) $request->input('scale', 10), $data['code'] ?? null);
    }

    /* ══════════════════════════ INTERNALS ══════════════════════════ */

    private function rules(): array
    {
        return [
            'warehouse_id'    => ['required', 'integer'],
            'zone_name'       => ['required', 'string', 'max:180'],
            'rack_mode'       => ['required', Rule::in(Zone::MODES)],
            // Upper bounds are the columns' — past them is a database error, not a 422.
            'area_sqft'       => ['required', 'numeric', 'min:1', 'max:999999999999'],
            // Free text once the dropdown is on 'Other', so no Rule::in here.
            'purpose'         => ['required', 'string', 'max:120'],

            'cold_chain'      => ['nullable', 'integer', 'in:0,1'],
            // -80 to +60 is the span the screen's temperature picker allows.
            'temp_min_c'      => ['nullable', 'numeric', 'min:-80', 'max:60'],
            'temp_max_c'      => ['nullable', 'numeric', 'min:-80', 'max:60'],
            'hazardous'       => ['nullable', 'integer', 'in:0,1'],

            'storage_mode'    => ['nullable', Rule::in(Zone::STORAGE_MODES)],
            'capacity_litres' => ['nullable', 'numeric', 'min:1', 'max:999999999999'],

            'dim_unit'        => ['nullable', 'in:cm,m'],
            'length'          => ['nullable', 'numeric', 'min:0', 'max:9999999999'],
            'width'           => ['nullable', 'numeric', 'min:0', 'max:9999999999'],
            'height'          => ['nullable', 'numeric', 'min:0', 'max:9999999999'],
            'usable_pct'      => ['nullable', 'numeric', 'min:1', 'max:100'],
            'floor_area'      => ['nullable', 'numeric', 'min:0', 'max:999999999999'],
            'volume'          => ['nullable', 'numeric', 'min:0', 'max:9999999999999'],
            'usable_volume'   => ['nullable', 'numeric', 'min:0', 'max:9999999999999'],
            // No 'status' — setStatus() only, which checks the warehouse and cascades.
        ];
    }

    /**
     * The rules a single field cannot express: the shape the rack_mode implies,
     * and the fit against the parent, which needs the other zones to answer.
     * Aborts rather than returning — the caller has nothing to decide.
     */
    private function guard(array $d, ?Zone $editing, $user): Warehouse
    {
        /* Locked: two zones saved into one warehouse at once would both read
           the same free area and both fit. The second now waits, then reads
           the first one's area. */
        $warehouse = $this->ownedQuery(Warehouse::query(), $user)->lockForUpdate()->find($d['warehouse_id']);

        if (!$warehouse) {
            $this->reject('Select the warehouse', 'warehouse_id');
        }

        $moving = !$editing || (int) $editing->warehouse_id !== (int) $warehouse->id;

        /* Only when the zone is being PUT here. A zone whose warehouse was
           switched off later must still be editable — it was refused even a
           rename. */
        if ($moving && !$warehouse->isActive()) {
            $this->reject("{$warehouse->wh_name} is inactive — pick another warehouse.", 'warehouse_id');
        }
        if ($moving && !$warehouse->isOwn()) {
            $this->reject("{$warehouse->wh_name} is a third-party warehouse — it holds no zones.", 'warehouse_id');
        }

        if ($this->nameTaken(Zone::where('warehouse_id', $warehouse->id), 'zone_name', $d['zone_name'], $editing?->id)) {
            $this->reject('This warehouse already has a zone with this name', 'zone_name');
        }

        $free = $this->svc->freeWarehouseAreaSqft($warehouse, $editing?->id);
        if ((float) $d['area_sqft'] > $free) {
            $this->reject('Only ' . $this->num($free) . ' Sq. Ft is still free in this warehouse', 'area_sqft');
        }

        if (!empty($d['cold_chain'])) {
            if (!isset($d['temp_min_c'], $d['temp_max_c'])) {
                $this->reject('Set the temperature range', 'temp_min_c');
            }
            if ((float) $d['temp_max_c'] <= (float) $d['temp_min_c']) {
                $this->reject('Max temperature must be higher than min temperature.', 'temp_max_c');
            }
        }

        if ($d['rack_mode'] === Zone::MODE_NORACK) {
            if (empty($d['storage_mode'])) {
                $this->reject('Choose Refrigerator Storage or Regular Storage', 'storage_mode');
            }
            if ($d['storage_mode'] === Zone::STORAGE_FRIDGE && empty($d['capacity_litres'])) {
                $this->reject('Enter the refrigerator capacity in litres', 'capacity_litres');
            }
            if ($d['storage_mode'] === Zone::STORAGE_REGULAR) {
                foreach (['length' => 'Enter the length', 'width' => 'Enter the width', 'height' => 'Enter the height'] as $k => $msg) {
                    if (empty($d[$k])) $this->reject($msg, $k);
                }
                // 'min:1|max:100' already holds it when sent; this catches it missing.
                if (empty($d['usable_pct'])) $this->reject('Enter a value from 1 to 100', 'usable_pct');
            }
        }

        return $warehouse;
    }

    /**
     * What an edit may not take away from what is already in this zone.
     *
     * A rack was let in on the zone's area, its warehouse and its cold-chain
     * and hazardous allowances. Taking any of those back afterwards leaves the
     * rack somewhere it could never have been created.
     */
    private function guardChildren(array $d, Zone $zone): void
    {
        $racks    = Rack::where('zone_id', $zone->id);
        $hasRacks = (clone $racks)->exists();

        /* Its warehouse and its type are what the racks and the boxes were
           put there on. A move strands the racks' and the stock's own copies
           of the warehouse id; a type change strands racks in a no-rack zone,
           or boxes on a floor that has become rack-only. */
        $moving   = (int) $d['warehouse_id'] !== (int) $zone->warehouse_id;
        $retyping = $d['rack_mode'] !== $zone->rack_mode;
        if (($moving || $retyping) && ($hasRacks || $this->holdsStock('zone_id', $zone->id))) {
            $this->reject(self::IN_USE, $moving ? 'warehouse_id' : 'rack_mode');
        }

        if (!$hasRacks) return;

        $used = (float) (clone $racks)->sum('area_sqft');
        if ((float) $d['area_sqft'] + 0.001 < $used) {
            $this->reject('Its racks already use ' . $this->num($used) . ' Sq. Ft — the zone cannot be smaller than that', 'area_sqft');
        }

        if (empty($d['cold_chain']) && (clone $racks)->where('cold_chain', 1)->exists()) {
            $this->reject('Cold-chain racks are in this zone — it must stay cold chain.', 'cold_chain');
        }
        if (empty($d['hazardous']) && (clone $racks)->where('hazardous', 1)->exists()) {
            $this->reject('Hazardous racks are in this zone — it must keep allowing hazardous goods.', 'hazardous');
        }
    }

    /**
     * Null out the half the rack_mode does not use, so a zone switched from
     * floor to racked cannot keep showing the capacity it had as a floor.
     */
    private function shape(array $d): array
    {
        $d['cold_chain'] = (int) ($d['cold_chain'] ?? 0);
        $d['hazardous']  = (int) ($d['hazardous'] ?? 0);

        if (!$d['cold_chain']) {
            $d['temp_min_c'] = $d['temp_max_c'] = null;
        }

        $fridge = $d['rack_mode'] === Zone::MODE_NORACK
            && ($d['storage_mode'] ?? null) === Zone::STORAGE_FRIDGE;
        $floor  = $d['rack_mode'] === Zone::MODE_NORACK
            && ($d['storage_mode'] ?? null) === Zone::STORAGE_REGULAR;

        if ($d['rack_mode'] === Zone::MODE_RACK) $d['storage_mode'] = null;
        if (!$fridge) $d['capacity_litres'] = null;
        if (!$floor) {
            foreach (['dim_unit', 'length', 'width', 'height', 'usable_pct', 'floor_area', 'volume', 'usable_volume'] as $k) {
                $d[$k] = null;
            }
        }

        return $d;
    }

    /** The dropdown shape: what the Rack form shows as AUTO beside the picker. */
    private function optionRow(Zone $z): array
    {
        return [
            'id'         => $z->id,
            'zone_code'  => $z->zone_code,
            'zone_name'  => $z->zone_name,
            'rack_mode'  => $z->rack_mode,
            'area_sqft'  => (float) $z->area_sqft,
            'cold_chain' => (int) $z->cold_chain,
            'hazardous'  => (int) $z->hazardous,
            'temp_min_c' => $z->temp_min_c !== null ? (float) $z->temp_min_c : null,
            'temp_max_c' => $z->temp_max_c !== null ? (float) $z->temp_max_c : null,
        ];
    }

    private function row(Zone $z): array
    {
        return [
            'id'              => $z->id,
            'zone_code'       => $z->zone_code,
            'zone_name'       => $z->zone_name,
            'warehouse_id'    => $z->warehouse_id,
            'warehouse_name'  => $z->warehouse?->wh_name,
            'rack_mode'       => $z->rack_mode,
            'rack_mode_label' => $z->isRacked() ? 'Storage Zone (With Rack)' : 'Storage Zone (Without Rack)',
            'area_sqft'       => (float) $z->area_sqft,
            'purpose'         => $z->purpose,
            'cold_chain'      => (int) $z->cold_chain,
            'temp_min_c'      => $z->temp_min_c !== null ? (float) $z->temp_min_c : null,
            'temp_max_c'      => $z->temp_max_c !== null ? (float) $z->temp_max_c : null,
            'hazardous'       => (int) $z->hazardous,
            'storage_mode'    => $z->storage_mode,
            'capacity_litres' => $z->capacity_litres !== null ? (float) $z->capacity_litres : null,
            'dim_unit'        => $z->dim_unit,
            'length'          => $z->length !== null ? (float) $z->length : null,
            'width'           => $z->width !== null ? (float) $z->width : null,
            'height'          => $z->height !== null ? (float) $z->height : null,
            'usable_pct'      => $z->usable_pct !== null ? (float) $z->usable_pct : null,
            'floor_area'      => $z->floor_area !== null ? (float) $z->floor_area : null,
            'volume'          => $z->volume !== null ? (float) $z->volume : null,
            'usable_volume'   => $z->usable_volume !== null ? (float) $z->usable_volume : null,
            'racks_count'     => $z->racks_count ?? null,
            'status'          => (int) $z->status,
            'created_at'      => $z->created_at?->toDateString(),
            'updated_at'      => $z->updated_at?->toDateTimeString(),
        ];
    }
}
