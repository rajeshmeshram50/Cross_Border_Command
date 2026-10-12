<?php

namespace App\Http\Controllers\Api\Inventory;

use App\Models\Inventory\Rack;
use App\Models\Inventory\Shelf;
use App\Services\Inventory\InventoryMasterService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Inventory · Shelf Master. /api/inventory/racks/{rack}/shelves
 *
 * Nested under the rack because a shelf has no meaning without one, and every
 * check it has to pass is a comparison against that rack: its length and width
 * cap the shelf's, and the shelves already stacked cap the height left.
 *
 * Those comparisons are all made in centimetres, whatever unit was typed —
 * which is why height_cm is stored as well as height.
 *
 * used_weight_kg and boxes_count are not writable here. They belong to the SPI
 * put-away, and a master form that could set them would let someone mark a
 * shelf empty while boxes are still on it.
 */
class ShelfController extends BaseInventoryController
{
    public function __construct(private InventoryMasterService $svc) {}

    /* ══════════════════════════ READ ══════════════════════════ */

    /**
     * GET /inventory/racks/{rack}/shelves
     * The shelf drawer: the levels, plus the KPI strip above them and the room
     * left, so the Add Shelf form opens already knowing its limits.
     */
    /**
     * GET /inventory/racks/{rack}/shelves/next-code
     *
     * A shelf code is not built from the shelf's own id — it is
     * RK-003-SH-02, the RACK's code plus the shelf's level within it. So the
     * next code is the next LEVEL in this rack, not the next sequence value,
     * and unlike the other three it is contiguous: levels are counted, not
     * handed out, so a deleted shelf's level is reused by the next one.
     *
     * Still a preview — two people adding a shelf to the same rack are both
     * shown this, and the second will get the level after.
     */
    public function nextCode(Request $request, int $rackId)
    {
        $this->tenantUser($request);
        $rack = Rack::findOrFail($rackId);

        $next = (int) Shelf::where('rack_id', $rack->id)->max('level_no') + 1;

        return response()->json(['status' => true, 'data' => [
            'rack_id'   => $rack->id,
            'next_level' => $next,
            'next_code' => $rack->rack_code . '-SH-' . str_pad((string) $next, 2, '0', STR_PAD_LEFT),
            'preview'   => true,
        ]], 200);
    }

    public function index(Request $request, int $rackId)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $rack = Rack::with('zone:id,zone_name,temp_min_c,temp_max_c')->findOrFail($rackId);

            $f = $request->validate($this->listRules());

            $base = Shelf::where('rack_id', $rack->id);
            $tabs = $this->tabCounts(clone $base);

            $q = $base->orderBy('level_no');
            $this->applyTab($q, $f['tab'] ?? null);
            $this->applySearch($q, $f['q'] ?? null, ['shelf_name', 'shelf_type', 'purpose']);

            $shelves  = $q->get();
            $active   = $shelves->where('status', 1);
            $capacity = (float) $active->sum('max_weight_kg');
            $used     = (float) $active->sum('used_weight_kg');

            $body = [
                'status' => true,
                'data'   => $shelves->map(fn (Shelf $s) => $this->row($s, $rack))->all(),
                'tabs'   => $tabs,
                'rack'   => [
                    'id'             => $rack->id,
                    'rack_code'      => $rack->rack_code,
                    'rack_name'      => $rack->rack_name,
                    'zone_name'      => $rack->zone?->zone_name,
                    'dim_unit'       => $rack->dim_unit,
                    'length'         => (float) $rack->length,
                    'width'          => (float) $rack->width,
                    'height_cm'      => $rack->height_cm,
                    'free_height_cm' => $this->svc->freeRackHeightCm($rack),
                    'next_level_no'  => $this->svc->nextShelfLevel($rack),
                    'cold_chain'     => (int) $rack->cold_chain,
                    'hazardous'      => (int) $rack->hazardous,
                ],
                'totals' => [
                    'levels'      => $active->count(),
                    'capacity_kg' => $capacity,
                    'used_kg'     => $used,
                    'load_pct'    => $capacity > 0 ? (int) round($used / $capacity * 100) : 0,
                    'boxes'       => (int) $active->sum('boxes_count'),
                ],
            ];

            DB::commit();

            return response()->json($body, 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** GET /inventory/shelves/{id} */
    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $shelf = Shelf::with('rack.zone:id,zone_name,temp_min_c,temp_max_c')->findOrFail($id);

            DB::commit();

            return response()->json([
                'status' => true,
                'data'   => $this->row($shelf, $shelf->rack),
            ], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ WRITE ══════════════════════════ */

    /** POST /inventory/racks/{rack}/shelves */
    public function store(Request $request, int $rackId)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $rack = Rack::with('zone')->findOrFail($rackId);
            $data = $request->validate($this->rules());

            $this->guard($data, $rack, null);

            $shelf = new Shelf($data);
            $shelf->rack_id        = $rack->id;
            $shelf->height_cm      = $this->svc->toCm((float) $data['height'], $data['dim_unit']);
            $shelf->cold_chain     = (int) ($data['cold_chain'] ?? 0);
            $shelf->hazardous      = (int) ($data['hazardous'] ?? 0);
            // Occupancy belongs to the put-away; a new shelf starts empty.
            $shelf->used_weight_kg = 0;
            $shelf->boxes_count    = 0;
            $shelf->created_by     = $user->id;
            $shelf->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($shelf, $rack)], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** PUT /inventory/shelves/{id} */
    public function update(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user  = $this->tenantUser($request);
            $shelf = Shelf::findOrFail($id);
            $rack  = Rack::with('zone')->findOrFail($shelf->rack_id);
            $data  = $request->validate($this->rules());

            $this->guard($data, $rack, $shelf);

            $shelf->fill($data);
            $shelf->height_cm  = $this->svc->toCm((float) $data['height'], $data['dim_unit']);
            $shelf->cold_chain = (int) ($data['cold_chain'] ?? 0);
            $shelf->hazardous  = (int) ($data['hazardous'] ?? 0);
            $shelf->updated_by = $user->id;
            $shelf->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($shelf, $rack)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** PUT /inventory/shelves/{id}/status */
    public function setStatus(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user  = $this->tenantUser($request);
            $shelf = Shelf::findOrFail($id);
            $data  = $request->validate(['status' => ['required', 'integer', 'in:0,1']]);

            if ((int) $data['status'] === 0 && (int) $shelf->boxes_count > 0) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$shelf->shelf_name} still holds {$shelf->boxes_count} box(es).",
                ], 409));
            }
            if ((int) $data['status'] === 1 && !$shelf->rack?->isActive()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Its rack is inactive — activate that first.',
                ], 409));
            }

            $shelf->forceFill(['status' => $data['status'], 'updated_by' => $user->id])->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($shelf, $shelf->rack)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** DELETE /inventory/shelves/{id} */
    public function destroy(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $shelf = Shelf::findOrFail($id);

            if ((int) $shelf->boxes_count > 0) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$shelf->shelf_name} still holds {$shelf->boxes_count} box(es).",
                ], 409));
            }

            $shelf->delete();

            DB::commit();

            return response()->json(['status' => true, 'data' => ['id' => $id, 'deleted' => true]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * GET /inventory/shelves/{id}/preview — the label as data.
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
                'qr'           => $this->qr($data['scan'] ?? $data['code']),
                'download_url' => url("/api/inventory/shelves/{$id}/label"),
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** GET /inventory/shelves/{id}/label — the same label, as a 4x3in PDF. */
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
     * What the shelf label prints. Scanned at put-away as scan_type 'shelf' —
     * the last link, and the one that records where the box actually went.
     */
    private function labelData(Request $request, int $id): array
    {
        $user = $this->tenantUser($request);
        $s = $this->scopeTenant(Shelf::query(), $user, $this->branchScope($request, $user))
            ->with('rack.zone:id,zone_name,temp_min_c,temp_max_c')
            ->findOrFail($id);

        $zone = $s->rack?->zone;
        $temp = $s->cold_chain && $zone?->temp_min_c !== null
            ? ((float) $zone->temp_min_c) . ' to ' . ((float) $zone->temp_max_c) . ' C'
            : null;

        return [
            'kind'     => 'SHELF',
            'code'     => $s->shelf_code,
            'scan'     => $this->scanValue('SH', (int) $s->id),
            'title'    => $s->shelf_name,
            'subtitle' => trim(implode('  /  ', array_filter([$zone?->zone_name, $s->rack?->rack_name]))) ?: null,
            'rows'     => array_filter([
                'Level'    => $s->level_no,
                'Type'     => $s->shelf_type,
                'Purpose'  => $s->purpose,
                'Max Load' => $s->max_weight_kg ? number_format((float) $s->max_weight_kg) . ' kg' : null,
                'Clear Ht' => $s->height_cm ? ((float) $s->height_cm) . ' cm' : null,
                'Temp'     => $temp,
            ], fn ($v) => $v !== null && $v !== ''),
            'flags'    => array_values(array_filter([
                $this->flag((bool) $s->cold_chain, 'COLD CHAIN', 'cold'),
                $this->flag((bool) $s->hazardous, 'HAZARDOUS', 'haz'),
                $this->flag(!$s->isActive(), 'INACTIVE', 'off'),
            ])),
        ];
    }

    /**
     * GET /inventory/shelves/{id}/qr — the QR and nothing else.
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

        return $this->qrPng($data['code'], (int) $request->input('scale', 10));
    }

    /* ══════════════════════════ INTERNALS ══════════════════════════ */

    private function rules(): array
    {
        return [
            'shelf_name'    => ['required', 'string', 'max:180'],
            'level_no'      => ['required', 'integer', 'min:1'],
            'shelf_type'    => ['required', Rule::in(Shelf::TYPES)],
            'max_weight_kg' => ['required', 'numeric', 'min:1'],
            // Free text once the dropdown is on 'Other', so no Rule::in here.
            'purpose'       => ['required', 'string', 'max:120'],
            'cold_chain'    => ['nullable', 'integer', 'in:0,1'],
            'hazardous'     => ['nullable', 'integer', 'in:0,1'],
            'dim_unit'      => ['required', 'in:cm,m'],
            'length'        => ['required', 'numeric', 'min:0.01'],
            'width'         => ['required', 'numeric', 'min:0.01'],
            'height'        => ['required', 'numeric', 'min:0.01'],
            'area'          => ['nullable', 'numeric', 'min:0'],
            'volume'        => ['nullable', 'numeric', 'min:0'],
            'status'        => ['nullable', 'integer', 'in:0,1'],
        ];
    }

    /** Everything that is a comparison against the parent rack. */
    private function guard(array $d, Rack $rack, ?Shelf $editing): void
    {
        if (!$rack->isActive()) {
            abort(response()->json(['status' => false, 'message' => "{$rack->rack_name} is inactive."], 422));
        }

        // A shelf can never be more permissive than the rack holding it.
        if (!empty($d['cold_chain']) && !$rack->cold_chain) {
            abort(response()->json([
                'status'  => false,
                'message' => "{$rack->rack_name} is not a cold-chain rack.",
            ], 422));
        }
        if (!empty($d['hazardous']) && !$rack->hazardous) {
            abort(response()->json([
                'status'  => false,
                'message' => "{$rack->rack_name} does not allow hazardous goods.",
            ], 422));
        }

        $taken = fn (string $column, $value) => Shelf::where('rack_id', $rack->id)
            ->where($column, $column === 'shelf_name' ? 'ilike' : '=', $value)
            ->when($editing, fn ($q) => $q->where('id', '!=', $editing->id))
            ->exists();

        if ($taken('level_no', $d['level_no'])) {
            abort(response()->json([
                'status'  => false,
                'message' => "Level {$d['level_no']} already exists in this rack.",
            ], 422));
        }
        if ($taken('shelf_name', $d['shelf_name'])) {
            abort(response()->json([
                'status'  => false,
                'message' => 'This rack already has a shelf with this name.',
            ], 422));
        }

        /* Length, width and height are capped by the rack — all compared in
           centimetres, because the two forms can be on different units. */
        $rackL = $this->svc->toCm((float) $rack->length, $rack->dim_unit);
        $rackW = $this->svc->toCm((float) $rack->width, $rack->dim_unit);
        $l     = $this->svc->toCm((float) $d['length'], $d['dim_unit']);
        $w     = $this->svc->toCm((float) $d['width'], $d['dim_unit']);
        $h     = $this->svc->toCm((float) $d['height'], $d['dim_unit']);

        if ($l > $rackL + 0.001) {
            abort(response()->json([
                'status'  => false,
                'message' => 'Cannot exceed the rack length (' . number_format($rackL, 2) . ' cm).',
            ], 422));
        }
        if ($w > $rackW + 0.001) {
            abort(response()->json([
                'status'  => false,
                'message' => 'Cannot exceed the rack width (' . number_format($rackW, 2) . ' cm).',
            ], 422));
        }

        $free = $this->svc->freeRackHeightCm($rack, $editing?->id);
        if ($h > $free + 0.001) {
            abort(response()->json([
                'status'  => false,
                'message' => 'Only ' . number_format($free, 2) . ' cm of rack height is free.',
            ], 422));
        }

        // Lowering the limit under what is already stored would read as a loss.
        if ($editing && (float) $d['max_weight_kg'] < (float) $editing->used_weight_kg) {
            abort(response()->json([
                'status'  => false,
                'message' => 'Cannot be below the ' . (float) $editing->used_weight_kg . ' kg already stored.',
            ], 422));
        }
    }

    private function row(Shelf $s, ?Rack $rack): array
    {
        return [
            'id'             => $s->id,
            'shelf_code'     => $s->shelf_code,
            'shelf_name'     => $s->shelf_name,
            'rack_id'        => $s->rack_id,
            'rack_name'      => $rack?->rack_name,
            'level_no'       => (int) $s->level_no,
            'shelf_type'     => $s->shelf_type,
            'purpose'        => $s->purpose,
            'max_weight_kg'  => (float) $s->max_weight_kg,
            'used_weight_kg' => (float) $s->used_weight_kg,
            'load_pct'       => $s->load_pct,
            'boxes_count'    => (int) $s->boxes_count,
            'occupancy'      => $s->occupancy,
            'cold_chain'     => (int) $s->cold_chain,
            'hazardous'      => (int) $s->hazardous,
            // The range lives on the zone, two levels up.
            'temp_min_c'     => $s->cold_chain && $rack?->zone?->temp_min_c !== null ? (float) $rack->zone->temp_min_c : null,
            'temp_max_c'     => $s->cold_chain && $rack?->zone?->temp_max_c !== null ? (float) $rack->zone->temp_max_c : null,
            'dim_unit'       => $s->dim_unit,
            'length'         => (float) $s->length,
            'width'          => (float) $s->width,
            'height'         => (float) $s->height,
            'height_cm'      => (float) $s->height_cm,
            'area'           => $s->area !== null ? (float) $s->area : null,
            'volume'         => $s->volume !== null ? (float) $s->volume : null,
            'status'         => (int) $s->status,
            'created_at'     => $s->created_at?->toDateString(),
            'updated_at'     => $s->updated_at?->toDateTimeString(),
        ];
    }
}
