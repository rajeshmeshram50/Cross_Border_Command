<?php

namespace App\Http\Controllers\Api\Inventory;

use App\Models\Inventory\Rack;
use App\Models\Inventory\Warehouse;
use App\Models\Inventory\Zone;
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
    public function __construct(private InventoryMasterService $svc) {}

    /* ══════════════════════════ READ ══════════════════════════ */

    /** GET /inventory/zones */
    public function index(Request $request)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);

            $f = $request->validate($this->listRules() + [
                'warehouse_id' => ['nullable', 'integer'],
                'rack_mode'    => ['nullable', Rule::in(Zone::MODES)],
                'cold_chain'   => ['nullable', 'integer', 'in:0,1'],
                'hazardous'    => ['nullable', 'integer', 'in:0,1'],
            ]);

            $base = Zone::query();
            if (!empty($f['warehouse_id'])) $base->where('warehouse_id', $f['warehouse_id']);
            if (!empty($f['rack_mode']))    $base->where('rack_mode', $f['rack_mode']);
            if (isset($f['cold_chain']))    $base->where('cold_chain', $f['cold_chain']);
            if (isset($f['hazardous']))     $base->where('hazardous', $f['hazardous']);

            $tabs = $this->tabCounts(clone $base);

            $q = $base->with('warehouse:id,wh_name,wh_type')->withCount('racks')->orderByDesc('id');

            $this->applyTab($q, $f['tab'] ?? null);
            $this->applySearch($q, $f['q'] ?? null, ['zone_name', 'purpose']);

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
     * The Rack form's zone dropdown, which lists racked zones only — and sends
     * the AUTO fields it shows beside the picker.
     */
    public function options(Request $request)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);

            $f = $request->validate([
                'warehouse_id' => ['required', 'integer'],
                'rack_mode'    => ['nullable', Rule::in(Zone::MODES)],
            ]);

            $rows = Zone::where('warehouse_id', $f['warehouse_id'])
                ->where('status', 1)
                ->when(!empty($f['rack_mode']), fn ($q) => $q->where('rack_mode', $f['rack_mode']))
                ->orderBy('zone_name')
                ->get(['id', 'zone_name', 'rack_mode', 'area_sqft', 'cold_chain', 'hazardous', 'temp_min_c', 'temp_max_c'])
                ->map(fn (Zone $z) => [
                    'id'         => $z->id,
                    'zone_code'  => $z->zone_code,
                    'zone_name'  => $z->zone_name,
                    'rack_mode'  => $z->rack_mode,
                    'area_sqft'  => (float) $z->area_sqft,
                    'cold_chain' => (int) $z->cold_chain,
                    'hazardous'  => (int) $z->hazardous,
                    'temp_min_c' => $z->temp_min_c !== null ? (float) $z->temp_min_c : null,
                    'temp_max_c' => $z->temp_max_c !== null ? (float) $z->temp_max_c : null,
                ]);

            DB::commit();

            return response()->json(['status' => true, 'data' => $rows], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** GET /inventory/zones/{id} */
    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $zone = Zone::with('warehouse:id,wh_name,wh_type')->withCount('racks')->findOrFail($id);

            $body = $this->row($zone) + ['free_area_sqft' => $this->svc->freeZoneAreaSqft($zone)];

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

            $this->guard($data, null);

            $zone = new Zone($this->shape($data));
            $zone->created_by = $user->id;
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
            $zone = Zone::findOrFail($id);
            $data = $request->validate($this->rules());

            $this->guard($data, $zone);

            /* Un-racking a zone that already has racks would strand them: they
               are only reachable through a racked zone. */
            if ($data['rack_mode'] === Zone::MODE_NORACK && Rack::where('zone_id', $zone->id)->exists()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'This zone already has racks — remove them before switching it to Without Rack.',
                ], 409));
            }

            $zone->fill($this->shape($data));
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
            $zone = Zone::findOrFail($id);
            $data = $request->validate(['status' => ['required', 'integer', 'in:0,1']]);

            if ((int) $data['status'] === 1 && !$zone->warehouse?->isActive()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Its warehouse is inactive — activate that first.',
                ], 409));
            }

            $zone->forceFill(['status' => $data['status'], 'updated_by' => $user->id])->save();

            // A rack under a dead zone must not stay on the put-away picker.
            if ((int) $data['status'] === 0) {
                Rack::where('zone_id', $zone->id)->update(['status' => 0, 'updated_by' => $user->id]);
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

            $this->tenantUser($request);
            $zone = Zone::withCount('racks')->findOrFail($id);

            if ($zone->racks_count > 0) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$zone->zone_name} holds {$zone->racks_count} rack(s). Deactivate it instead of deleting it.",
                ], 409));
            }

            $zone->delete();

            DB::commit();

            return response()->json(['status' => true, 'data' => ['id' => $id, 'deleted' => true]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ INTERNALS ══════════════════════════ */

    private function rules(): array
    {
        return [
            'warehouse_id'    => ['required', 'integer'],
            'zone_name'       => ['required', 'string', 'max:180'],
            'rack_mode'       => ['required', Rule::in(Zone::MODES)],
            'area_sqft'       => ['required', 'numeric', 'min:1'],
            // Free text once the dropdown is on 'Other', so no Rule::in here.
            'purpose'         => ['required', 'string', 'max:120'],

            'cold_chain'      => ['nullable', 'integer', 'in:0,1'],
            // -80 to +60 is the span the screen's temperature picker allows.
            'temp_min_c'      => ['nullable', 'numeric', 'min:-80', 'max:60'],
            'temp_max_c'      => ['nullable', 'numeric', 'min:-80', 'max:60'],
            'hazardous'       => ['nullable', 'integer', 'in:0,1'],

            'storage_mode'    => ['nullable', Rule::in(Zone::STORAGE_MODES)],
            'capacity_litres' => ['nullable', 'numeric', 'min:1'],

            'dim_unit'        => ['nullable', 'in:cm,m'],
            'length'          => ['nullable', 'numeric', 'min:0'],
            'width'           => ['nullable', 'numeric', 'min:0'],
            'height'          => ['nullable', 'numeric', 'min:0'],
            'usable_pct'      => ['nullable', 'numeric', 'min:1', 'max:100'],
            'floor_area'      => ['nullable', 'numeric', 'min:0'],
            'volume'          => ['nullable', 'numeric', 'min:0'],
            'usable_volume'   => ['nullable', 'numeric', 'min:0'],

            'status'          => ['nullable', 'integer', 'in:0,1'],
        ];
    }

    /**
     * The rules a single field cannot express: the shape the rack_mode implies,
     * and the fit against the parent, which needs the other zones to answer.
     * Aborts rather than returning — the caller has nothing to decide.
     */
    private function guard(array $d, ?Zone $editing): void
    {
        $warehouse = Warehouse::find($d['warehouse_id']);

        if (!$warehouse) {
            abort(response()->json(['status' => false, 'message' => 'That warehouse does not exist.'], 404));
        }
        if (!$warehouse->isActive()) {
            abort(response()->json([
                'status'  => false,
                'message' => "{$warehouse->wh_name} is inactive — pick another warehouse.",
            ], 422));
        }

        $duplicate = Zone::where('warehouse_id', $warehouse->id)
            ->where('zone_name', 'ilike', $d['zone_name'])
            ->when($editing, fn ($q) => $q->where('id', '!=', $editing->id))
            ->exists();
        if ($duplicate) {
            abort(response()->json([
                'status'  => false,
                'message' => 'This warehouse already has a zone with this name.',
            ], 422));
        }

        $free = $this->svc->freeWarehouseAreaSqft($warehouse, $editing?->id);
        if ((float) $d['area_sqft'] > $free) {
            abort(response()->json([
                'status'  => false,
                'message' => 'Only ' . number_format($free, 2) . ' Sq. Ft is still free in this warehouse.',
            ], 422));
        }

        if (!empty($d['cold_chain'])) {
            if (!isset($d['temp_min_c'], $d['temp_max_c'])) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Enter both the minimum and maximum temperature.',
                ], 422));
            }
            if ((float) $d['temp_min_c'] >= (float) $d['temp_max_c']) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Minimum temperature must be lower than the maximum.',
                ], 422));
            }
        }

        if ($d['rack_mode'] === Zone::MODE_NORACK) {
            if (empty($d['storage_mode'])) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Choose Refrigerator Storage or Regular Storage.',
                ], 422));
            }
            if ($d['storage_mode'] === Zone::STORAGE_FRIDGE && empty($d['capacity_litres'])) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Enter the refrigerator capacity in litres.',
                ], 422));
            }
            if ($d['storage_mode'] === Zone::STORAGE_REGULAR) {
                foreach (['length', 'width', 'height', 'usable_pct'] as $k) {
                    if (empty($d[$k])) {
                        abort(response()->json([
                            'status'  => false,
                            'message' => 'Enter the length, width, height and usable floor percentage.',
                        ], 422));
                    }
                }
            }
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
