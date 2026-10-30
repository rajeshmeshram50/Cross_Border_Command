<?php

namespace App\Http\Controllers\Api\Inventory;

use App\Models\Inventory\Rack;
use App\Models\Inventory\Shelf;
use App\Models\Inventory\Zone;
use App\Services\Inventory\InventoryCodeAllocator;
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
    public function __construct(
        private InventoryMasterService $svc,
        private InventoryCodeAllocator $codes,
    ) {}

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
                ->withSum(['shelves as capacity_kg' => fn ($s) => $s->where('status', 1)], 'max_weight_kg')
                ->withSum(['shelves as used_kg' => fn ($s) => $s->where('status', 1)], 'used_weight_kg')
                ->orderByDesc('id');

            $this->applyTab($q, $f['tab'] ?? null);
            /* The screen's placeholder has always read "rack ID, rack name,
               zone or warehouse" while only rack_name was searched — three of
               the four did nothing. The code is a column now, and the other
               two are one whereHas each. */
            $this->applySearch($q, $f['q'] ?? null, ['code', 'rack_name'], function ($w, $term) {
                $like = '%' . $term . '%';
                $w->orWhereHas('zone', fn ($h) => $h->where('zone_name', 'ilike', $like))
                  ->orWhereHas('warehouse', fn ($h) => $h->where('wh_name', 'ilike', $like));
            });

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

    /** GET /inventory/racks/next-code — preview of the next rack's code. */
    public function nextCode(Request $request)
    {
        $user = $this->tenantUser($request);

        return response()->json(['status' => true, 'data' => [
            'next_code' => $this->codes->peek('inventory_racks', $user->client_id, $this->branchScope($request, $user)),
            'preview'   => true,
        ]], 200);
    }

    /** GET /inventory/racks/{id} */
    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);

            $rack = $this->ownedQuery(Rack::query(), $user)
                ->with(['warehouse:id,wh_name', 'zone:id,zone_name,temp_min_c,temp_max_c'])
                ->withCount('shelves')
                ->withSum(['shelves as capacity_kg' => fn ($s) => $s->where('status', 1)], 'max_weight_kg')
                ->withSum(['shelves as used_kg' => fn ($s) => $s->where('status', 1)], 'used_weight_kg')
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

            [$zone, $area] = $this->guard($data, null, $user);
            $data = $this->inheritFlags($data, $zone);

            $rack = new Rack($data);
            // The zone's tenancy, never the user's — see ZoneController::store.
            $rack->client_id    = $zone->client_id;
            $rack->branch_id    = $zone->branch_id;
            $rack->warehouse_id = $zone->warehouse_id;
            $rack->area_sqft    = $area;
            $rack->cold_chain   = (int) ($data['cold_chain'] ?? 0);
            $rack->hazardous    = (int) ($data['hazardous'] ?? 0);
            $rack->created_by   = $user->id;
            // Per branch, under a lock, inside this transaction — see Warehouse.
            $rack->code = $this->codes->next('inventory_racks', $zone->client_id, $zone->branch_id);
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

    /**
     * A rack takes its cold-chain and hazardous flags from its zone (QA CS-941
     * #13). A cold-chain zone is a refrigerated room and a hazardous zone a
     * segregated one — every rack standing in it is the same, so the form's
     * switch is shown locked and whatever it sent is overridden here.
     */
    private function inheritFlags(array $data, Zone $zone): array
    {
        $data['cold_chain'] = (int) $zone->cold_chain;
        $data['hazardous']  = (int) $zone->hazardous;

        return $data;
    }

    /** PUT /inventory/racks/{id} */
    public function update(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            // Locked: a shelf saved meanwhile is what guardChildren() is judging.
            $rack = $this->ownedQuery(Rack::query(), $user)->lockForUpdate()->findOrFail($id);
            $data = $request->validate($this->rules());

            [$zone, $area] = $this->guard($data, $rack, $user);
            $data = $this->inheritFlags($data, $zone);

            $this->guardChildren($data, $rack);

            $rack->fill($data);
            $rack->branch_id    = $zone->branch_id;
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
            $rack = $this->ownedQuery(Rack::query(), $user)->findOrFail($id);
            $data = $request->validate(['status' => ['required', 'integer', 'in:0,1']]);

            if ((int) $data['status'] === 1 && !$rack->zone?->isActive()) {
                $this->reject("{$rack->rack_code} cannot be activated — its zone {$rack->zone?->zone_code} is inactive", null, 409);
            }
            if ((int) $data['status'] === 1 && !$rack->warehouse?->isActive()) {
                $this->reject("{$rack->rack_code} cannot be activated — its warehouse {$rack->warehouse?->wh_code} is inactive", null, 409);
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

            $user = $this->tenantUser($request);
            $rack = $this->ownedQuery(Rack::query(), $user)->withCount('shelves')->lockForUpdate()->findOrFail($id);

            if ($rack->shelves_count > 0) {
                $this->reject("{$rack->rack_name} holds {$rack->shelves_count} shelf/shelves. Deactivate it instead of deleting it.", null, 409);
            }
            if ($used = $this->referencedBy('rack_id', $rack->id)) {
                $this->reject("{$rack->rack_name} is used by {$used}. Deactivate it instead of deleting it.", null, 409);
            }

            $rack->delete();

            DB::commit();

            return response()->json(['status' => true, 'data' => ['id' => $id, 'deleted' => true]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * GET /inventory/racks/{id}/preview — the label as data.
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
                'download_url' => url("/api/inventory/racks/{$id}/label"),
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** GET /inventory/racks/{id}/label — the same label, as a 4x3in PDF. */
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
     * What the rack label prints. Scanned at put-away as scan_type 'rack',
     * the third link in the chain.
     */
    private function labelData(Request $request, int $id): array
    {
        $user = $this->tenantUser($request);
        $r = $this->scopeTenant(Rack::query(), $user, $this->branchScope($request, $user))
            ->with(['warehouse:id,wh_name,code', 'zone:id,zone_name,code,temp_min_c,temp_max_c'])
            ->withCount('shelves')
            ->findOrFail($id);

        $temp = $r->cold_chain && $r->zone?->temp_min_c !== null
            ? ((float) $r->zone->temp_min_c) . ' to ' . ((float) $r->zone->temp_max_c) . ' C'
            : null;

        $size = $r->length
            ? ((float) $r->length) . ' x ' . ((float) $r->width) . ' x ' . ((float) $r->height) . ' ' . $r->dim_unit
            : null;

        return [
            'kind'     => 'RACK',
            'code'     => $r->rack_code,
            'scan'     => $this->scanValue('RC', (int) $r->id),
            'title'    => $r->rack_name,
            'subtitle' => trim(implode('  /  ', array_filter([$r->warehouse?->wh_name, $r->zone?->zone_name]))) ?: null,
            'rows'     => array_filter([
                'Shelves' => $r->shelves_count,
                'Size'    => $size,
                'Height'  => $r->height_cm ? $r->height_cm . ' cm' : null,
                'Area'    => $r->area_sqft ? number_format((float) $r->area_sqft, 2) . ' Sq. Ft' : null,
                'Temp'    => $temp,
            ], fn ($v) => $v !== null && $v !== ''),
            'path'     => [
                ['label' => 'WAREHOUSE', 'code' => $r->warehouse?->wh_code],
                ['label' => 'ZONE',      'code' => $r->zone?->zone_code],
                ['label' => 'RACK',      'code' => $r->rack_code],
            ],
            'flags'    => array_values(array_filter([
                $this->flag((bool) $r->cold_chain, 'COLD CHAIN', 'cold'),
                $this->flag((bool) $r->hazardous, 'HAZARDOUS', 'haz'),
                $this->flag(!$r->isActive(), 'INACTIVE', 'off'),
            ])),
        ];
    }

    /**
     * GET /inventory/racks/{id}/qr — the QR and nothing else.
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
            'zone_id'    => ['required', 'integer'],
            'rack_name'  => ['required', 'string', 'max:180'],
            'cold_chain' => ['nullable', 'integer', 'in:0,1'],
            'hazardous'  => ['nullable', 'integer', 'in:0,1'],
            'dim_unit'   => ['required', 'in:cm,m'],
            // numeric(12,2) — past that is a database error, not a 422.
            'length'     => ['required', 'numeric', 'min:0.01', 'max:9999999999'],
            'width'      => ['required', 'numeric', 'min:0.01', 'max:9999999999'],
            'height'     => ['required', 'numeric', 'min:0.01', 'max:9999999999'],
            // No 'status' — setStatus() only, which checks the zone and cascades.
        ];
    }

    /**
     * Aborts on any breach, otherwise hands back the parent zone and the
     * footprint in square feet the caller should store.
     *
     * @return array{0: Zone, 1: float}
     */
    private function guard(array $d, ?Rack $editing, $user): array
    {
        /* Locked: two racks saved into one zone at once would both read the
           same free area and both fit. */
        $zone = $this->ownedQuery(Zone::query(), $user)->lockForUpdate()->find($d['zone_id']);

        if (!$zone) {
            $this->reject('Select a zone (with rack)', 'zone_id');
        }

        /* Only when the rack is being PUT here. A rack whose zone was switched
           off later must still be editable — it was refused even a rename. */
        $moving = !$editing || (int) $editing->zone_id !== (int) $zone->id;

        if ($moving && !$zone->isRacked()) {
            $this->reject('Select a zone (with rack)', 'zone_id');
        }
        if ($moving && !$zone->isActive()) {
            $this->reject("{$zone->zone_name} is inactive — pick another zone.", 'zone_id');
        }

        // Cold stock cannot be racked where the zone has no temperature range.
        if (!empty($d['cold_chain']) && !$zone->cold_chain) {
            $this->reject("{$zone->zone_name} is not a cold-chain zone.", 'cold_chain');
        }
        if (!empty($d['hazardous']) && !$zone->hazardous) {
            $this->reject("{$zone->zone_name} does not allow hazardous goods.", 'hazardous');
        }

        /* Unique across the whole warehouse, not just the zone (QA CS-941 #18):
           racks are picked and scanned by name within a warehouse, and two
           "Rack A"s in different zones of it cannot be told apart. */
        $clash = Rack::where('warehouse_id', $zone->warehouse_id)
            ->whereRaw('lower(trim(rack_name)) = lower(trim(?))', [$d['rack_name']])
            ->when($editing, fn ($q) => $q->where('id', '!=', $editing->id))
            ->first();
        if ($clash) {
            $this->reject("This warehouse already has a rack with this name ({$clash->rack_code}).", 'rack_name');
        }

        $area = Rack::areaSqft((float) $d['length'], (float) $d['width'], $d['dim_unit']);
        $free = $this->svc->freeZoneAreaSqft($zone, $editing?->id);
        if ($area > $free) {
            $this->reject('Rack footprint exceeds the free zone area (' . $this->num($free) . ' Sq. Ft left)', 'length');
        }

        return [$zone, $area];
    }

    /**
     * What an edit may not take away from the shelves already in this rack.
     *
     * Every shelf was let in against the rack's length, width, height and
     * flags (ShelfController::guard). Shrinking or narrowing the rack after
     * the fact left those shelves uneditable — their next save failed a rule
     * they had passed — so the rack may not go below what they use.
     */
    private function guardChildren(array $d, Rack $rack): void
    {
        $shelves = Shelf::where('rack_id', $rack->id)->get(['length', 'width', 'height_cm', 'dim_unit', 'cold_chain', 'hazardous']);

        if ((int) $d['zone_id'] !== (int) $rack->zone_id) {
            if ($shelves->isNotEmpty()) {
                $this->reject('This rack has shelves — it cannot move to another zone.', 'zone_id');
            }
            if ($used = $this->referencedBy('rack_id', $rack->id)) {
                $this->reject("This rack is used by {$used} — it cannot move to another zone.", 'zone_id');
            }
        }
        if ($shelves->isEmpty()) return;

        $cm = fn ($v) => $this->svc->toCm((float) $v, $d['dim_unit']);

        $usedH = (float) $shelves->sum('height_cm');
        if ($cm($d['height']) + 0.001 < $usedH) {
            $this->reject('Its shelves already use ' . number_format($usedH, 2) . ' cm — the rack cannot be shorter than that.', 'height');
        }

        $maxL = (float) $shelves->max(fn ($s) => $this->svc->toCm((float) $s->length, $s->dim_unit));
        if ($cm($d['length']) + 0.001 < $maxL) {
            $this->reject('A shelf in it is ' . number_format($maxL, 2) . ' cm long — the rack cannot be shorter than that.', 'length');
        }
        $maxW = (float) $shelves->max(fn ($s) => $this->svc->toCm((float) $s->width, $s->dim_unit));
        if ($cm($d['width']) + 0.001 < $maxW) {
            $this->reject('A shelf in it is ' . number_format($maxW, 2) . ' cm wide — the rack cannot be narrower than that.', 'width');
        }

        if (empty($d['cold_chain']) && $shelves->contains(fn ($s) => (int) $s->cold_chain === 1)) {
            $this->reject('Cold-chain shelves are in this rack — it must stay cold chain.', 'cold_chain');
        }
        if (empty($d['hazardous']) && $shelves->contains(fn ($s) => (int) $s->hazardous === 1)) {
            $this->reject('Hazardous shelves are in this rack — it must keep allowing hazardous goods.', 'hazardous');
        }
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
