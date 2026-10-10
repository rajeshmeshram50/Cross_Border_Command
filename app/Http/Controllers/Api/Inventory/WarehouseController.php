<?php

namespace App\Http\Controllers\Api\Inventory;

use App\Models\Inventory\Rack;
use App\Models\Inventory\Warehouse;
use App\Models\Inventory\Zone;
use App\Services\Inventory\InventoryMasterService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * Inventory · Warehouse Master. /api/inventory/warehouses
 *
 * wh_type is the one field with consequences: 'own' means the site is zoned,
 * racked and scanned to a shelf, 'tpl' means a third party holds the stock and
 * a put-away is a summary drop with no structure beneath it.
 *
 * Store and update are POST, not PUT: the business-card upload is multipart,
 * and PHP does not populate $_FILES on a PUT. Both still accept plain JSON.
 */
class WarehouseController extends BaseInventoryController
{
    public function __construct(private InventoryMasterService $svc) {}

    /* ══════════════════════════ READ ══════════════════════════ */

    /** GET /inventory/warehouses */
    public function index(Request $request)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);

            $f = $request->validate($this->listRules() + [
                'wh_type' => ['nullable', Rule::in(Warehouse::TYPES)],
                'city'    => ['nullable', 'string', 'max:100'],
                'state'   => ['nullable', 'string', 'max:100'],
            ]);

            $base = Warehouse::query();
            if (!empty($f['wh_type'])) $base->where('wh_type', $f['wh_type']);
            if (!empty($f['city']))    $base->where('city', $f['city']);
            if (!empty($f['state']))   $base->where('state', $f['state']);

            $tabs = $this->tabCounts(clone $base);

            /* The grid shows how many zones and racks each warehouse holds.
               Subqueries, so a page of ten costs two extra queries, not twenty. */
            $q = $base->withCount(['zones', 'racks'])->orderByDesc('id');

            $this->applyTab($q, $f['tab'] ?? null);
            $this->applySearch($q, $f['q'] ?? null, [
                'wh_name', 'city', 'state', 'contact_person', 'contact_mobile',
            ]);

            $body = $this->listBody($q, $request, $tabs, fn (Warehouse $w) => $this->row($w));

            DB::commit();

            return response()->json($body, 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * GET /inventory/warehouses/options
     * The cascading dropdown on the Zone and Rack forms. Active only, and only
     * the fields those forms display as AUTO.
     */
    public function options(Request $request)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);

            $rows = Warehouse::where('status', 1)
                ->orderBy('wh_name')
                ->get(['id', 'wh_name', 'wh_type', 'area_sqft', 'city', 'state'])
                ->map(fn (Warehouse $w) => [
                    'id'        => $w->id,
                    'wh_code'   => $w->wh_code,
                    'wh_name'   => $w->wh_name,
                    'wh_type'   => $w->wh_type,
                    'area_sqft' => (float) $w->area_sqft,
                    'location'  => trim(implode(', ', array_filter([$w->city, $w->state]))),
                ]);

            DB::commit();

            return response()->json(['status' => true, 'data' => $rows], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** GET /inventory/warehouses/{id} */
    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $warehouse = Warehouse::withCount(['zones', 'racks'])->findOrFail($id);

            $body = $this->row($warehouse) + [
                'free_area_sqft' => $this->svc->freeWarehouseAreaSqft($warehouse),
            ];

            DB::commit();

            return response()->json(['status' => true, 'data' => $body], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ WRITE ══════════════════════════ */

    /** POST /inventory/warehouses */
    public function store(Request $request)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $data = $request->validate($this->rules());

            $warehouse = new Warehouse($data);
            $warehouse->created_by = $user->id;
            $warehouse->save();
            // Needs the id for the storage path, so the card lands after the insert.
            $warehouse->forceFill($this->storeCard($request, $warehouse))->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($warehouse)], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** POST /inventory/warehouses/{id} */
    public function update(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user      = $this->tenantUser($request);
            $warehouse = Warehouse::findOrFail($id);
            $data      = $request->validate($this->rules());

            $warehouse->fill($data);
            $warehouse->updated_by = $user->id;
            $warehouse->fill($this->storeCard($request, $warehouse))->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($warehouse)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * PUT /inventory/warehouses/{id}/status
     * Deactivating cascades down: a zone or rack under a dead warehouse would
     * still show as available on the put-away picker otherwise.
     */
    public function setStatus(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user      = $this->tenantUser($request);
            $warehouse = Warehouse::findOrFail($id);
            $data      = $request->validate(['status' => ['required', 'integer', 'in:0,1']]);

            $warehouse->forceFill(['status' => $data['status'], 'updated_by' => $user->id])->save();

            if ((int) $data['status'] === 0) {
                Zone::where('warehouse_id', $warehouse->id)->update(['status' => 0, 'updated_by' => $user->id]);
                Rack::where('warehouse_id', $warehouse->id)->update(['status' => 0, 'updated_by' => $user->id]);
            }

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($warehouse)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * DELETE /inventory/warehouses/{id}
     * Refused once it holds zones — the screen's toggle is the way to retire a
     * warehouse, and a delete here would orphan every rack and shelf below it.
     */
    public function destroy(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $warehouse = Warehouse::withCount('zones')->findOrFail($id);

            if ($warehouse->zones_count > 0) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$warehouse->wh_name} holds {$warehouse->zones_count} zone(s). Deactivate it instead of deleting it.",
                ], 409));
            }

            if ($warehouse->card_path) Storage::disk('public')->delete($warehouse->card_path);
            $warehouse->delete();

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
            'wh_name'        => ['required', 'string', 'max:180'],
            'wh_type'        => ['required', Rule::in(Warehouse::TYPES)],
            'area_sqft'      => ['required', 'numeric', 'min:1'],
            'address'        => ['required', 'string', 'max:1000'],
            'country'        => ['required', 'string', 'max:100'],
            'state'          => ['required', 'string', 'max:100'],
            'city'           => ['required', 'string', 'max:100'],
            // 6 digits in India, longer postal codes elsewhere.
            'pincode'        => ['required', 'string', 'max:20'],
            'map_url'        => ['nullable', 'url', 'max:500'],
            'contact_person' => ['required', 'string', 'max:150'],
            'contact_dial'   => ['nullable', 'string', 'max:8'],
            'contact_mobile' => ['required', 'string', 'max:20'],
            'contact_email'  => ['required', 'email', 'max:120'],
            'card'           => ['nullable', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
            'status'         => ['nullable', 'integer', 'in:0,1'],
        ];
    }

    /** Move an attached business card onto the public disk. Empty when none came. */
    private function storeCard(Request $request, Warehouse $warehouse): array
    {
        if (!$file = $request->file('card')) return [];

        // The old file goes only once the new one is on disk.
        $path = $file->store("inventory/warehouses/{$warehouse->id}", 'public');
        if ($warehouse->card_path) Storage::disk('public')->delete($warehouse->card_path);

        return ['card_path' => $path, 'card_name' => $file->getClientOriginalName()];
    }

    private function row(Warehouse $w): array
    {
        return [
            'id'             => $w->id,
            'wh_code'        => $w->wh_code,
            'wh_name'        => $w->wh_name,
            'wh_type'        => $w->wh_type,
            'wh_type_label'  => $w->isOwn() ? 'Own Warehouse' : 'Third Party Warehouse',
            'area_sqft'      => (float) $w->area_sqft,
            'address'        => $w->address,
            'country'        => $w->country,
            'state'          => $w->state,
            'city'           => $w->city,
            'pincode'        => $w->pincode,
            'location'       => trim(implode(', ', array_filter([$w->city, $w->state]))),
            'map_url'        => $w->map_url,
            'contact_person' => $w->contact_person,
            'contact_dial'   => $w->contact_dial,
            'contact_mobile' => $w->contact_mobile,
            'contact_email'  => $w->contact_email,
            'card_name'      => $w->card_name,
            'card_url'       => $w->card_path ? Storage::disk('public')->url($w->card_path) : null,
            'zones_count'    => $w->zones_count ?? null,
            'racks_count'    => $w->racks_count ?? null,
            'status'         => (int) $w->status,
            'created_at'     => $w->created_at?->toDateString(),
            'updated_at'     => $w->updated_at?->toDateTimeString(),
        ];
    }
}
