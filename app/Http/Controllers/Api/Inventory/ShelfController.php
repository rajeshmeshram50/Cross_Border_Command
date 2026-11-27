<?php

namespace App\Http\Controllers\Api\Inventory;

use App\Models\Inventory\Rack;
use App\Models\Inventory\Shelf;
use App\Services\Inventory\InventoryMasterService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ShelfController extends BaseInventoryController
{
    public function __construct(private InventoryMasterService $svc) {}

    public function nextCode(Request $request, int $rackId)
    {
        $user = $this->tenantUser($request);
        $rack = $this->ownedQuery(Rack::query(), $user)->findOrFail($rackId);

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

            $user = $this->tenantUser($request);
            $rack = $this->ownedQuery(Rack::query(), $user)
                ->with('zone:id,zone_name,temp_min_c,temp_max_c')->findOrFail($rackId);

            $f = $request->validate($this->listRules());

            $base = Shelf::where('rack_id', $rack->id)->with('rack:id,code,rack_name,height,dim_unit');
            $tabs = $this->tabCounts(clone $base);

            $q = $base->orderBy('level_no');
            $this->applyTab($q, $f['tab'] ?? null);
            $this->applySearch($q, $f['q'] ?? null, ['shelf_name', 'shelf_type', 'purpose'],
                function ($w, $term) use ($rack) {
                    if (!preg_match('/^(.*?)-?sh-?(\d+)$/i', $term, $m)) return;
                    $rackPart = trim($m[1], ' -');
                    if ($rackPart !== '' && stripos((string) $rack->rack_code, $rackPart) === false) return;
                    $w->orWhere('level_no', (int) $m[2]);
                });

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

    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user  = $this->tenantUser($request);
            $shelf = $this->ownedQuery(Shelf::query(), $user)
                ->with('rack.zone:id,zone_name,temp_min_c,temp_max_c')->findOrFail($id);

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

    public function store(Request $request, int $rackId)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $rack = $this->ownedQuery(Rack::query(), $user)->with('zone')->lockForUpdate()->findOrFail($rackId);
            $data = $this->settle($request->validate($this->rules()), $rack, null);

            $this->guard($data, $rack, null);

            $shelf = new Shelf($data);
            $shelf->client_id      = $rack->client_id;
            $shelf->branch_id      = $rack->branch_id;
            $shelf->rack_id        = $rack->id;
            $shelf->height_cm      = $this->svc->toCm((float) $data['height'], $data['dim_unit']);
            $shelf->cold_chain     = (int) ($data['cold_chain'] ?? 0);
            $shelf->hazardous      = (int) ($data['hazardous'] ?? 0);
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

    public function update(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user  = $this->tenantUser($request);
            $rackId = $this->ownedQuery(Shelf::query(), $user)->whereKey($id)->value('rack_id') ?? abort(404);
            $rack   = Rack::with('zone')->lockForUpdate()->findOrFail($rackId);
            $shelf  = Shelf::lockForUpdate()->findOrFail($id);
            $data   = $this->settle($request->validate($this->rules()), $rack, $shelf);

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

    public function setStatus(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user  = $this->tenantUser($request);
            $shelf = $this->ownedQuery(Shelf::query(), $user)->lockForUpdate()->findOrFail($id);
            $data  = $request->validate(['status' => ['required', 'integer', 'in:0,1']]);

            if ((int) $data['status'] === 0 && (int) $shelf->boxes_count > 0) {
                $this->reject("{$shelf->shelf_name} still holds {$shelf->boxes_count} box(es).", null, 409);
            }
            if ((int) $data['status'] === 1 && !$shelf->rack?->isActive()) {
                $this->reject('Its rack is inactive — activate that first.', null, 409);
            }

            $shelf->forceFill(['status' => $data['status'], 'updated_by' => $user->id])->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($shelf, $shelf->rack)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function destroy(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user  = $this->tenantUser($request);
            $shelf = $this->ownedQuery(Shelf::query(), $user)->lockForUpdate()->findOrFail($id);

            if ((int) $shelf->boxes_count > 0) {
                $this->reject("{$shelf->shelf_name} still holds {$shelf->boxes_count} box(es).", null, 409);
            }
            if ($used = $this->referencedBy('shelf_id', $shelf->id)) {
                $this->reject("{$shelf->shelf_name} is used by {$used}. Deactivate it instead of deleting it.", null, 409);
            }

            $shelf->delete();

            DB::commit();

            return response()->json(['status' => true, 'data' => ['id' => $id, 'deleted' => true]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function preview(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $data = $this->labelData($request, $id);

            DB::commit();

            return response()->json(['status' => true, 'data' => $data + [
                'qr'           => $this->qr($this->stickerPayload($data)),
                'download_url' => url("/api/inventory/shelves/{$id}/label"),
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

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

    private function labelData(Request $request, int $id): array
    {
        $user = $this->tenantUser($request);
        $s = $this->scopeTenant(Shelf::query(), $user, $this->branchScope($request, $user))
            ->with(['rack:id,code,zone_id,warehouse_id', 'rack.zone:id,zone_name,code,temp_min_c,temp_max_c', 'rack.warehouse:id,wh_name,code'])
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
            'path'     => [
                ['label' => 'WAREHOUSE', 'code' => $s->rack?->warehouse?->wh_code],
                ['label' => 'ZONE',      'code' => $zone?->zone_code],
                ['label' => 'RACK',      'code' => $s->rack?->rack_code],
                ['label' => 'SHELF',     'code' => $s->shelf_code],
            ],
            'flags'    => array_values(array_filter([
                $this->flag((bool) $s->cold_chain, 'COLD CHAIN', 'cold'),
                $this->flag((bool) $s->hazardous, 'HAZARDOUS', 'haz'),
                $this->flag(!$s->isActive(), 'INACTIVE', 'off'),
            ])),
        ];
    }

    public function qrImage(Request $request, int $id)
    {
        $data = $this->labelData($request, $id);

        return $this->qrPng($this->stickerPayload($data), (int) $request->input('scale', 10), $data['code'] ?? null);
    }

    private function rules(): array
    {
        return [
            'shelf_name'    => ['required', 'string', 'max:180'],
            'level_no'      => ['nullable', 'integer', 'min:1', 'max:32767'],
            'shelf_type'    => ['required', Rule::in(Shelf::TYPES)],
            'max_weight_kg' => ['required', 'numeric', 'min:1', 'max:999999999999'],
            'purpose'       => ['required', 'string', 'max:120'],
            'cold_chain'    => ['nullable', 'integer', 'in:0,1'],
            'hazardous'     => ['nullable', 'integer', 'in:0,1'],
            'dim_unit'      => ['required', 'in:cm,m'],
            'length'        => ['required', 'numeric', 'min:0.01', 'max:9999999999'],
            'width'         => ['required', 'numeric', 'min:0.01', 'max:9999999999'],
            'height'        => ['required', 'numeric', 'min:0.01', 'max:9999999999'],
            'area'          => ['nullable', 'numeric', 'min:0', 'max:999999999999'],
            'volume'        => ['nullable', 'numeric', 'min:0', 'max:9999999999999'],
        ];
    }

    private function settle(array $data, Rack $rack, ?Shelf $editing): array
    {
        $data['level_no']   = $editing ? (int) $editing->level_no : $this->svc->nextShelfLevel($rack);
        $data['cold_chain'] = (int) $rack->cold_chain;
        $data['hazardous']  = (int) $rack->hazardous;

        return $data;
    }

    private function guard(array $d, Rack $rack, ?Shelf $editing): void
    {
        if (!$editing && !$rack->isActive()) {
            $this->reject("{$rack->rack_name} is inactive.", 'rack_id');
        }

        if (!empty($d['cold_chain']) && !$rack->cold_chain) {
            $this->reject("{$rack->rack_name} is not a cold-chain rack.", 'cold_chain');
        }
        if (!empty($d['hazardous']) && !$rack->hazardous) {
            $this->reject("{$rack->rack_name} does not allow hazardous goods.", 'hazardous');
        }

        $levelTaken = Shelf::where('rack_id', $rack->id)
            ->where('level_no', $d['level_no'])
            ->when($editing, fn ($q) => $q->where('id', '!=', $editing->id))
            ->exists();
        if ($levelTaken) {
            $this->reject("Level {$d['level_no']} already exists in this rack.", 'level_no');
        }
        $clash = Shelf::with('rack:id,code')
            ->whereIn('rack_id', Rack::where('warehouse_id', $rack->warehouse_id)->select('id'))
            ->whereRaw('lower(trim(shelf_name)) = lower(trim(?))', [$d['shelf_name']])
            ->when($editing, fn ($q) => $q->where('id', '!=', $editing->id))
            ->first();
        if ($clash) {
            $this->reject("This warehouse already has a shelf with this name ({$clash->shelf_code}).", 'shelf_name');
        }

        $rackL = $this->svc->toCm((float) $rack->length, $rack->dim_unit);
        $rackW = $this->svc->toCm((float) $rack->width, $rack->dim_unit);
        $l     = $this->svc->toCm((float) $d['length'], $d['dim_unit']);
        $w     = $this->svc->toCm((float) $d['width'], $d['dim_unit']);
        $h     = $this->svc->toCm((float) $d['height'], $d['dim_unit']);

        if ($l > $rackL + 0.001) {
            $this->reject('Cannot exceed the rack length (' . number_format($rackL, 2) . ' cm).', 'length');
        }
        if ($w > $rackW + 0.001) {
            $this->reject('Cannot exceed the rack width (' . number_format($rackW, 2) . ' cm).', 'width');
        }

        $free = $this->svc->freeRackHeightCm($rack, $editing?->id);
        if ($h > $free + 0.001) {
            $this->reject('Only ' . number_format($free, 2) . ' cm of rack height is free.', 'height');
        }

        if ($editing && (float) $d['max_weight_kg'] < (float) $editing->used_weight_kg) {
            $this->reject('Cannot be below the ' . (float) $editing->used_weight_kg . ' kg already stored.', 'max_weight_kg');
        }

        if ($editing && (int) $editing->boxes_count > 0) {
            $this->guardOccupied($d, $editing, $l, $w, $h);
        }
    }

    private function guardOccupied(array $d, Shelf $shelf, float $l, float $w, float $h): void
    {
        $boxes = (int) $shelf->boxes_count . ' box(es)';

        if (empty($d['cold_chain']) && $shelf->cold_chain) {
            $this->reject("It holds {$boxes} — it must stay cold chain until they are moved.", 'cold_chain');
        }
        if (empty($d['hazardous']) && $shelf->hazardous) {
            $this->reject("It holds {$boxes} — it must keep allowing hazardous goods until they are moved.", 'hazardous');
        }

        $was = fn ($v) => $this->svc->toCm((float) $v, $shelf->dim_unit);
        foreach ([
            'length' => [$l, $was($shelf->length), 'shorter'],
            'width'  => [$w, $was($shelf->width), 'narrower'],
            'height' => [$h, (float) $shelf->height_cm, 'lower'],
        ] as $field => [$now, $before, $word]) {
            if ($now + 0.001 < $before) {
                $this->reject("It holds {$boxes} — it cannot be made {$word} until they are moved.", $field);
            }
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
