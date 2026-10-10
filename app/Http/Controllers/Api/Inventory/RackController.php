<?php

namespace App\Http\Controllers\Api\Inventory;

use App\Models\Inventory\Rack;
use App\Models\Inventory\Shelf;
use App\Models\Inventory\Zone;
use App\Services\Inventory\InventoryMasterService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · Rack Master. /api/inventory/racks
 *
 * A rack only exists inside a RACKED zone, and its footprint has to fit in
 * what that zone has left. The screen cannot check either — it does not know
 * the other racks — so both are enforced here.
 *
 * area_sqft is computed server-side from the dimensions rather than taken from
 * the payload: it is the number the zone-capacity guard sums, so letting the
 * client send it would let the client decide whether the rack fits.
 */
class RackController extends BaseInventoryController
{
    public function __construct(private InventoryMasterService $svc) {}

    /* ══════════════════════════ READ ══════════════════════════ */

    /** GET /inventory/racks */
    public function index(Request $request)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);

            $f = $request->validate($this->listRules() + [
                'warehouse_id' => ['nullable', 'integer'],
                'zone_id'      => ['nullable', 'integer'],
                'cold_chain'   => ['nullable', 'integer', 'in:0,1'],
                'hazardous'    => ['nullable', 'integer', 'in:0,1'],
            ]);

            $base = $this->scopeTenant(Rack::query(), $user, $branch);
            if (!empty($f['warehouse_id'])) $base->where('warehouse_id', $f['warehouse_id']);
            if (!empty($f['zone_id']))      $base->where('zone_id', $f['zone_id']);
            if (isset($f['cold_chain']))    $base->where('cold_chain', $f['cold_chain']);
            if (isset($f['hazardous']))     $base->where('hazardous', $f['hazardous']);

            // The dropdown leaves before the tabs, the counts and the paging.
            if ($this->wantsOptions($request)) {
                $body = $this->optionsBody($base, 'rack_name', fn (Rack $r) => $this->optionRow($r));

                DB::commit();

                return response()->json($body, 200);
            }

            $tabs = $this->tabCounts(clone $base);

            /* The grid shows levels and load against capacity. Three subqueries
               for the whole page rather than three per row. */
            $q = $base
                ->with(['warehouse:id,wh_name', 'zone:id,zone_name,temp_min_c,temp_max_c'])
                ->withCount('shelves')
                ->withSum('shelves as capacity_kg', 'max_weight_kg')
                ->withSum('shelves as used_kg', 'used_weight_kg')
                ->orderByDesc('id');

            $this->applyTab($q, $f['tab'] ?? null);
            $this->applySearch($q, $f['q'] ?? null, ['rack_name']);

            $body = $this->listBody($q, $request, $tabs, fn (Rack $r) => $this->row($r));

            DB::commit();

            return response()->json($body, 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * GET /inventory/racks/options?warehouse_id=&zone_id= - the put-away picker.
     * Same method as the list; both ids are ordinary filters there.
     */
    public function options(Request $request)
    {
        return $this->index($request->merge(['view' => 'options']));
    }

    /** GET /inventory/racks/{id} */
    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);

            $rack = Rack::with(['warehouse:id,wh_name', 'zone:id,zone_name,temp_min_c,temp_max_c'])
                ->withCount('shelves')
                ->withSum('shelves as capacity_kg', 'max_weight_kg')
                ->withSum('shelves as used_kg', 'used_weight_kg')
                ->findOrFail($id);

            $body = $this->row($rack) + [
                'free_height_cm' => $this->svc->freeRackHeightCm($rack),
                'next_level_no'  => $this->svc->nextShelfLevel($rack),
            ];

            DB::commit();

            return response()->json(['status' => true, 'data' => $body], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ WRITE ══════════════════════════ */

    /** POST /inventory/racks */
    public function store(Request $request)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $data = $request->validate($this->rules());

            [$zone, $area] = $this->guard($data, null);

            $rack = new Rack($data);
            $rack->warehouse_id = $zone->warehouse_id;
            $rack->area_sqft    = $area;
            $rack->cold_chain   = (int) ($data['cold_chain'] ?? 0);
            $rack->hazardous    = (int) ($data['hazardous'] ?? 0);
            $rack->created_by   = $user->id;
            $rack->save();

            DB::commit();

            return response()->json([
                'status' => true,
                'data'   => $this->row($rack->load(['warehouse', 'zone'])),
            ], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** PUT /inventory/racks/{id} */
    public function update(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $rack = Rack::findOrFail($id);
            $data = $request->validate($this->rules());

            [$zone, $area] = $this->guard($data, $rack);

            /* Shrinking a rack below the shelves already stacked in it would
               make the next shelf save impossible to reason about. */
            $newHeightCm = $this->svc->toCm((float) $data['height'], $data['dim_unit']);
            $usedCm      = (float) Shelf::where('rack_id', $rack->id)->sum('height_cm');
            if ($newHeightCm + 0.001 < $usedCm) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Its shelves already use ' . number_format($usedCm, 2)
                        . ' cm — the rack cannot be shorter than that.',
                ], 422));
            }

            $rack->fill($data);
            $rack->warehouse_id = $zone->warehouse_id;
            $rack->area_sqft    = $area;
            $rack->cold_chain   = (int) ($data['cold_chain'] ?? 0);
            $rack->hazardous    = (int) ($data['hazardous'] ?? 0);
            $rack->updated_by   = $user->id;
            $rack->save();

            DB::commit();

            return response()->json([
                'status' => true,
                'data'   => $this->row($rack->load(['warehouse', 'zone'])),
            ], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** PUT /inventory/racks/{id}/status */
    public function setStatus(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $rack = Rack::findOrFail($id);
            $data = $request->validate(['status' => ['required', 'integer', 'in:0,1']]);

            if ((int) $data['status'] === 1 && !$rack->zone?->isActive()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Its zone is inactive — activate that first.',
                ], 409));
            }

            $rack->forceFill(['status' => $data['status'], 'updated_by' => $user->id])->save();

            if ((int) $data['status'] === 0) {
                Shelf::where('rack_id', $rack->id)->update(['status' => 0, 'updated_by' => $user->id]);
            }

            DB::commit();

            return response()->json([
                'status' => true,
                'data'   => $this->row($rack->load(['warehouse', 'zone'])),
            ], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** DELETE /inventory/racks/{id} */
    public function destroy(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $rack = Rack::withCount('shelves')->findOrFail($id);

            if ($rack->shelves_count > 0) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$rack->rack_name} holds {$rack->shelves_count} shelf/shelves. Deactivate it instead of deleting it.",
                ], 409));
            }

            $rack->delete();

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
            'zone_id'    => ['required', 'integer'],
            'rack_name'  => ['required', 'string', 'max:180'],
            'cold_chain' => ['nullable', 'integer', 'in:0,1'],
            'hazardous'  => ['nullable', 'integer', 'in:0,1'],
            'dim_unit'   => ['required', 'in:cm,m'],
            'length'     => ['required', 'numeric', 'min:0.01'],
            'width'      => ['required', 'numeric', 'min:0.01'],
            'height'     => ['required', 'numeric', 'min:0.01'],
            'status'     => ['nullable', 'integer', 'in:0,1'],
        ];
    }

    /**
     * Aborts on any breach, otherwise hands back the parent zone and the
     * footprint in square feet the caller should store.
     *
     * @return array{0: Zone, 1: float}
     */
    private function guard(array $d, ?Rack $editing): array
    {
        $zone = Zone::find($d['zone_id']);

        if (!$zone) {
            abort(response()->json(['status' => false, 'message' => 'That zone does not exist.'], 404));
        }
        if (!$zone->isRacked()) {
            abort(response()->json([
                'status'  => false,
                'message' => 'Racks can only go in a zone of type With Rack.',
            ], 422));
        }
        if (!$zone->isActive()) {
            abort(response()->json([
                'status'  => false,
                'message' => "{$zone->zone_name} is inactive — pick another zone.",
            ], 422));
        }

        // Cold stock cannot be racked where the zone has no temperature range.
        if (!empty($d['cold_chain']) && !$zone->cold_chain) {
            abort(response()->json([
                'status'  => false,
                'message' => "{$zone->zone_name} is not a cold-chain zone.",
            ], 422));
        }
        if (!empty($d['hazardous']) && !$zone->hazardous) {
            abort(response()->json([
                'status'  => false,
                'message' => "{$zone->zone_name} does not allow hazardous goods.",
            ], 422));
        }

        $duplicate = Rack::where('zone_id', $zone->id)
            ->where('rack_name', 'ilike', $d['rack_name'])
            ->when($editing, fn ($q) => $q->where('id', '!=', $editing->id))
            ->exists();
        if ($duplicate) {
            abort(response()->json([
                'status'  => false,
                'message' => 'This zone already has a rack with this name.',
            ], 422));
        }

        $area = Rack::areaSqft((float) $d['length'], (float) $d['width'], $d['dim_unit']);
        $free = $this->svc->freeZoneAreaSqft($zone, $editing?->id);
        if ($area > $free) {
            abort(response()->json([
                'status'  => false,
                'message' => 'Rack footprint exceeds the free zone area ('
                    . number_format($free, 2) . ' Sq. Ft left).',
            ], 422));
        }

        return [$zone, $area];
    }

    /** The dropdown shape: enough for the put-away picker to validate a scan. */
    private function optionRow(Rack $r): array
    {
        return [
            'id'         => $r->id,
            'rack_code'  => $r->rack_code,
            'rack_name'  => $r->rack_name,
            'zone_id'    => $r->zone_id,
            'cold_chain' => (int) $r->cold_chain,
            'hazardous'  => (int) $r->hazardous,
            'height_cm'  => $r->height_cm,
        ];
    }

    private function row(Rack $r): array
    {
        $capacity = (float) ($r->capacity_kg ?? 0);
        $used     = (float) ($r->used_kg ?? 0);

        return [
            'id'             => $r->id,
            'rack_code'      => $r->rack_code,
            'rack_name'      => $r->rack_name,
            'warehouse_id'   => $r->warehouse_id,
            'warehouse_name' => $r->warehouse?->wh_name,
            'zone_id'        => $r->zone_id,
            'zone_name'      => $r->zone?->zone_name,
            'cold_chain'     => (int) $r->cold_chain,
            'hazardous'      => (int) $r->hazardous,
            // The range is the zone's; the rack only says it may use it.
            'temp_min_c'     => $r->cold_chain && $r->zone?->temp_min_c !== null ? (float) $r->zone->temp_min_c : null,
            'temp_max_c'     => $r->cold_chain && $r->zone?->temp_max_c !== null ? (float) $r->zone->temp_max_c : null,
            'dim_unit'       => $r->dim_unit,
            'length'         => (float) $r->length,
            'width'          => (float) $r->width,
            'height'         => (float) $r->height,
            'height_cm'      => $r->height_cm,
            'area_sqft'      => (float) $r->area_sqft,
            'shelves_count'  => $r->shelves_count ?? null,
            'capacity_kg'    => $capacity,
            'used_kg'        => $used,
            'load_pct'       => $capacity > 0 ? (int) round($used / $capacity * 100) : 0,
            'status'         => (int) $r->status,
            'created_at'     => $r->created_at?->toDateString(),
            'updated_at'     => $r->updated_at?->toDateTimeString(),
        ];
    }
}
