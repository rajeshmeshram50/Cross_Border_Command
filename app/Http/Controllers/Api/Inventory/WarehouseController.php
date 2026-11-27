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
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class WarehouseController extends BaseInventoryController
{
    public function __construct(
        private InventoryMasterService $svc,
        private InventoryCodeAllocator $codes,
    ) {}

    public function index(Request $request)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $branch = $this->branchScope($request, $user);

            $f = $request->validate($this->listRules() + [
                'wh_type'    => ['nullable', Rule::in(Warehouse::TYPES)],
                'city'       => ['nullable', 'string', 'max:100'],
                'state_id'   => ['nullable', 'integer'],
                'country_id' => ['nullable', 'integer'],
            ]);

            $base = $this->scopeTenant(Warehouse::query(), $user, $branch);
            if (!empty($f['wh_type']))    $base->where('wh_type', $f['wh_type']);
            if (!empty($f['city']))       $base->where('city', $f['city']);
            if (!empty($f['state_id']))   $base->where('state_id', $f['state_id']);
            if (!empty($f['country_id'])) $base->where('country_id', $f['country_id']);

            if ($this->wantsOptions($request)) {
                $body = $this->optionsBody(
                    $base->with('state:id,name'),
                    'wh_name',
                    fn (Warehouse $w) => $this->optionRow($w)
                );

                DB::commit();

                return response()->json($body, 200);
            }

            $tabs = $this->tabCounts(clone $base);

            $q = $base->with(['country:id,name', 'state:id,name'])
                ->withCount(['zones', 'racks'])
                ->withSum('zones', 'area_sqft')
                ->orderByDesc('id');

            $this->applyTab($q, $f['tab'] ?? null);
            $this->applySearch($q, $f['q'] ?? null, [
                'code', 'wh_name', 'city', 'state_name', 'contact_person', 'contact_mobile',
            ]);

            $body = $this->listBody($q, $request, $tabs, fn (Warehouse $w) => $this->row($w));

            DB::commit();

            return response()->json($body, 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function options(Request $request)
    {
        return $this->index($request->merge(['view' => 'options']));
    }

    public function nextCode(Request $request)
    {
        $user = $this->tenantUser($request);

        return response()->json(['status' => true, 'data' => [
            'next_code' => $this->codes->peek(
                'inventory_warehouses',
                $user->client_id,
                $this->branchScope($request, $user),
            ),
            'preview'   => true,
        ]], 200);
    }

    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $warehouse = $this->ownedQuery(Warehouse::query(), $user)
                ->with(['country:id,name', 'state:id,name'])
                ->withCount(['zones', 'racks'])
                ->withSum('zones', 'area_sqft')
                ->findOrFail($id);

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

    public function store(Request $request)
    {
        try {
            DB::beginTransaction();

            $user   = $this->tenantUser($request);
            $data   = $request->validate($this->rules(), self::MESSAGES);
            $branch = $this->writeBranch($request, $user);

            $this->guardName($data['wh_name'], $user, $branch, null);
            $this->guardEmail($data['contact_email'], $user, null);

            $warehouse = new Warehouse($data);
            $warehouse->client_id  = $user->client_id;
            $warehouse->branch_id  = $branch;
            $warehouse->created_by = $user->id;
            $warehouse->code = $this->codes->next('inventory_warehouses', $user->client_id, $branch);
            $warehouse->save();
            $warehouse->forceFill($this->storeCard($request, $warehouse))->save();

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($warehouse)], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function update(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user      = $this->tenantUser($request);
            $warehouse = $this->ownedQuery(Warehouse::query(), $user)->lockForUpdate()->findOrFail($id);
            $data      = collect($request->validate($this->rules(), self::MESSAGES))->except('branch_id')->all();

            $this->guardName($data['wh_name'], $user, $warehouse->branch_id, $warehouse->id);
            $this->guardEmail($data['contact_email'], $user, $warehouse->id);
            $this->guardSettled($warehouse, $data);
            $this->guardArea($warehouse, $data);

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

    public function setStatus(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user      = $this->tenantUser($request);
            $warehouse = $this->ownedQuery(Warehouse::query(), $user)->findOrFail($id);
            $data      = $request->validate(['status' => ['required', 'integer', 'in:0,1']]);

            if ((int) $data['status'] === 0 && $warehouse->isActive()
                && (Zone::where('warehouse_id', $warehouse->id)->where('status', 1)->exists()
                    || $this->holdsStock('warehouse_id', $warehouse->id))) {
                $this->reject('Move or deactivate its zones first.', null, 409);
            }

            $warehouse->forceFill(['status' => $data['status'], 'updated_by' => $user->id])->save();

            if ((int) $data['status'] === 0) {
                Zone::where('warehouse_id', $warehouse->id)->update(['status' => 0, 'updated_by' => $user->id]);
                Rack::where('warehouse_id', $warehouse->id)->update(['status' => 0, 'updated_by' => $user->id]);
                Shelf::whereIn('rack_id', Rack::where('warehouse_id', $warehouse->id)->select('id'))
                    ->update(['status' => 0, 'updated_by' => $user->id]);
            }

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->row($warehouse)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function destroy(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user      = $this->tenantUser($request);
            $warehouse = $this->ownedQuery(Warehouse::query(), $user)->withCount('zones')->lockForUpdate()->findOrFail($id);

            if ($warehouse->zones_count > 0) {
                $this->reject("{$warehouse->wh_name} holds {$warehouse->zones_count} zone(s). Deactivate it instead of deleting it.", null, 409);
            }
            if ($used = $this->referencedBy('warehouse_id', $warehouse->id)) {
                $this->reject("{$warehouse->wh_name} is used by {$used}. Deactivate it instead of deleting it.", null, 409);
            }

            $card = $warehouse->card_path;
            $warehouse->delete();

            DB::commit();

            if ($card) Storage::disk('public')->delete($card);

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
                'download_url' => url("/api/inventory/warehouses/{$id}/label"),
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
        $w = $this->scopeTenant(Warehouse::query(), $user, $this->branchScope($request, $user))
            ->with(['country:id,name', 'state:id,name'])
            ->withCount(['zones', 'racks'])
            ->findOrFail($id);

        return [
            'kind'     => 'WAREHOUSE',
            'code'     => $w->wh_code,
            'scan'     => $this->scanValue('WH', (int) $w->id),
            'title'    => $w->wh_name,
            'subtitle' => trim(implode(', ', array_filter([$w->city, $w->stateLabel(), $w->country?->name]))) ?: null,
            'rows'     => array_filter([
                'Type'  => $w->isOwn() ? 'Own Warehouse' : 'Third Party',
                'Area'  => $w->area_sqft ? number_format((float) $w->area_sqft) . ' Sq. Ft' : null,
                'Zones' => $w->zones_count,
                'Racks' => $w->racks_count,
            ], fn ($v) => $v !== null && $v !== ''),
            'path'     => [
                ['label' => 'WAREHOUSE', 'code' => $w->wh_code],
            ],
            'flags'    => array_values(array_filter([
                $this->flag(!$w->isActive(), 'INACTIVE', 'off'),
            ])),
        ];
    }

    public function qrImage(Request $request, int $id)
    {
        $data = $this->labelData($request, $id);

        return $this->qrPng($this->stickerPayload($data), (int) $request->input('scale', 10), $data['code'] ?? null);
    }

    public function card(Request $request, int $id)
    {
        $warehouse = $this->ownedQuery(Warehouse::query(), $this->tenantUser($request))->findOrFail($id);
        $path = $warehouse->card_path;
        if (!$path || !Storage::disk('public')->exists($path)) abort(404, 'No business card on file.');

        return Storage::disk('public')->download($path, $warehouse->card_name ?: basename($path));
    }

    private function guardSettled(Warehouse $warehouse, array $d): void
    {
        if (!$warehouse->zones()->exists()) return;

        $changed = [];

        if (array_key_exists('wh_type', $d) && $d['wh_type'] !== $warehouse->wh_type) {
            $changed[] = 'Warehouse Type';
        }

        foreach ([
            'country_id' => 'Country',
            'state_id'   => 'State',
            'state_name' => 'State',
            'city'       => 'City',
        ] as $col => $label) {
            if (!array_key_exists($col, $d)) continue;
            $was = $warehouse->{$col};
            $now = $d[$col];
            if ((string) ($was ?? '') !== (string) ($now ?? '') && !in_array($label, $changed, true)) {
                $changed[] = $label;
            }
        }

        if (!$changed) return;

        $count = $warehouse->zones()->count();

        abort(response()->json([
            'status'  => false,
            'message' => implode(', ', $changed) . ' cannot be changed once zones exist in this warehouse — '
                . $count . ' zone' . ($count === 1 ? ' is' : 's are') . ' already allocated against it.'
                . ' Remove the zones first, or raise a new warehouse.',
            'errors'  => ['locked' => $changed],
        ], 422));
    }

    private function guardArea(Warehouse $warehouse, array $d): void
    {
        if (!array_key_exists('area_sqft', $d)) return;

        $allocated = round((float) Zone::where('warehouse_id', $warehouse->id)->sum('area_sqft'), 2);
        if ($allocated <= 0 || round((float) $d['area_sqft'], 2) >= $allocated) return;

        $count = $warehouse->zones()->count();

        abort(response()->json([
            'status'  => false,
            'message' => 'Warehouse Area cannot be less than ' . number_format($allocated, 2) . ' Sq. Ft — '
                . $count . ' zone' . ($count === 1 ? ' is' : 's are') . ' already allocated that much of it.',
            'errors'  => ['area_sqft' => ['Warehouse Area cannot be less than the ' . number_format($allocated, 2) . ' Sq. Ft already allocated to zones.']],
        ], 422));
    }

    private const MESSAGES = [
        'city.regex'           => 'City must contain letters only — no numbers or symbols.',
        'contact_person.regex' => 'Contact person must contain letters only — no numbers or symbols.',
    ];

    private function rules(): array
    {
        return [
            'wh_name'        => ['required', 'string', 'max:180'],
            'wh_type'        => ['required', Rule::in(Warehouse::TYPES)],
            'area_sqft'      => ['required', 'numeric', 'min:1', 'max:999999999999'],
            'address'        => ['required', 'string', 'max:1000'],
            'country_id'     => ['required', 'integer', Rule::exists('master_countries', 'id')],
            'state_id'       => ['nullable', 'required_without:state_name', 'integer', Rule::exists('master_states', 'id')],
            'state_name'     => ['nullable', 'required_without:state_id', 'string', 'max:100'],
            'city'           => ['required', 'string', 'max:100', "regex:/^\\p{L}[\\p{L}\\p{M}\\s.'(),-]*$/u"],
            'pincode'        => ['required', 'string', 'max:20'],
            'map_url'        => ['nullable', 'url', 'max:500'],
            'contact_person' => ['required', 'string', 'max:150', "regex:/^\\p{L}[\\p{L}\\p{M}\\s.'-]*$/u"],
            'contact_dial'   => ['nullable', 'string', 'max:8'],
            'contact_mobile' => ['required', 'string', 'regex:/^\d{6,15}$/', function ($attr, $value, $fail) {
                if (request()->input('contact_dial') !== '+91') return;
                $v = (string) $value;
                if (strlen($v) !== 10) {
                    $fail('Mobile Number must be exactly 10 digits (after +91) — you entered ' . strlen($v));
                } elseif (!preg_match('/^[6-9]/', $v)) {
                    $fail('Mobile Number must start with 6, 7, 8 or 9 — Indian mobile numbers do not begin with ' . $v[0]);
                }
            }],
            'contact_email'  => ['required', 'email', 'max:120'],
            'card'           => ['nullable', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
            'branch_id'      => ['nullable', 'integer'],
        ];
    }

    private function guardName(string $name, $user, ?int $branch, ?int $exceptId): void
    {
        $q = Warehouse::where('client_id', $user->client_id)->where('branch_id', $branch);

        if ($this->nameTaken($q, 'wh_name', $name, $exceptId)) {
            $this->reject('A warehouse with this name already exists.', 'wh_name');
        }
    }

    private function guardEmail(string $email, $user, ?int $exceptId): void
    {
        $email = mb_strtolower(trim($email));

        $sources = [
            ['customer',     'customers',               ['primary_email'],                 'company_name'],
            ['customer',     'customer_addresses',      ['cp_email'],                      'customers.company_name',  ['customers', 'customer_id']],
            ['customer',     'customer_owners',         ['official_email'],                'customers.company_name',  ['customers', 'customer_id']],
            ['consignee',    'consignees',              ['primary_email'],                 'company_name'],
            ['consignee',    'consignee_addresses',     ['cp_email'],                      'consignees.company_name', ['consignees', 'consignee_id']],
            ['consignee',    'consignee_owners',        ['official_email'],                'consignees.company_name', ['consignees', 'consignee_id']],
            ['supplier',     'vendors',                 ['primary_email'],                 'company_name'],
            ['supplier',     'vendor_addresses',        ['email'],                         'vendors.company_name',    ['vendors', 'vendor_id']],
            ['supplier',     'p2p_suppliers',           ['email'],                         'name'],
            ['supplier',     'master_vendor_directory', ['email_id'],                      'vendor_company_name'],
            ['supplier',     'product_vendor_maps',     ['email'],                         'product_vendor_maps.vendor_name', ['products', 'product_id']],
            ['lead',         'leads',                   ['sender_email', 'sender_email_alt'], 'sender_name'],
            ['lead contact', 'lead_task_managers',      ['email'],                         'name'],
            ['meeting',      'sales_meetings',          ['email'],                         'customer'],
            ['user',         'users',                   ['email'],                         'name'],
            ['employee',     'employees',               ['email', 'official_email'],       'display_name'],
            ['candidate',    'candidates',              ['email'],                         'name'],
            ['branch',       'branches',                ['email'],                         'name'],
            ['company',      'master_company',          ['email'],                         'company_name'],
            ['department',   'master_departments',      ['email'],                         'name'],
            ['organisation', 'clients',                 ['email'],                         'org_name'],
            ['warehouse',    'inventory_warehouses',    ['contact_email'],                 'wh_name'],
        ];
        $soft = ['customers', 'consignees', 'vendors', 'p2p_suppliers', 'leads', 'sales_meetings',
                 'users', 'employees', 'candidates', 'branches', 'clients'];

        foreach ($sources as $src) {
            [$kind, $table, $cols, $name] = $src;
            $parent = $src[4] ?? null;

            $q = DB::table($table);
            if ($parent) {
                [$pt, $fk] = $parent;
                $q->join($pt, "$pt.id", '=', "$table.$fk")
                  ->where("$pt.client_id", $user->client_id)
                  ->whereNull("$pt.deleted_at");
            } else {
                $q->where($table === 'clients' ? 'clients.id' : "$table.client_id", $user->client_id);
            }
            if (in_array($table, $soft, true)) $q->whereNull("$table.deleted_at");
            if ($table === 'inventory_warehouses' && $exceptId) $q->where('inventory_warehouses.id', '!=', $exceptId);
            $q->where(function ($w) use ($table, $cols, $email) {
                foreach ($cols as $c) $w->orWhereRaw("LOWER(TRIM($table.$c)) = ?", [$email]);
            });

            if (($found = $q->value($name)) !== null) {
                $this->reject("This email is already used by {$kind} \"{$found}\". Use a different contact email for the warehouse.", 'contact_email');
            }
        }
    }

    private function storeCard(Request $request, Warehouse $warehouse): array
    {
        if (!$file = $request->file('card')) return [];

        $path = $file->store("inventory/warehouses/{$warehouse->id}", 'public');
        if ($warehouse->card_path) Storage::disk('public')->delete($warehouse->card_path);

        return ['card_path' => $path, 'card_name' => $file->getClientOriginalName()];
    }

    private function optionRow(Warehouse $w): array
    {
        return [
            'id'        => $w->id,
            'wh_code'   => $w->wh_code,
            'wh_name'   => $w->wh_name,
            'wh_type'   => $w->wh_type,
            'area_sqft' => (float) $w->area_sqft,
            'location'  => trim(implode(', ', array_filter([$w->city, $w->stateLabel()]))),
            'address'   => $w->address,
            'pincode'   => $w->pincode,
            'created_at' => $w->created_at?->toDateString(),
        ];
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
            'country_id'     => $w->country_id,
            'country'        => $w->country?->name,
            'state_id'       => $w->state_id,
            'state'          => $w->stateLabel(),
            'city'           => $w->city,
            'pincode'        => $w->pincode,
            'location'       => trim(implode(', ', array_filter([$w->city, $w->stateLabel()]))),
            'map_url'        => $w->map_url,
            'contact_person' => $w->contact_person,
            'contact_dial'   => $w->contact_dial,
            'contact_mobile' => $w->contact_mobile,
            'contact_email'  => $w->contact_email,
            'card_name'      => $w->card_name,
            'card_url'       => file_url($w->card_path),
            'zones_count'    => $w->zones_count ?? null,
            'racks_count'    => $w->racks_count ?? null,
            'zones_area_sqft' => isset($w->zones_sum_area_sqft) ? (float) $w->zones_sum_area_sqft : null,
            'status'         => (int) $w->status,
            'created_at'     => $w->created_at?->toDateString(),
            'updated_at'     => $w->updated_at?->toDateTimeString(),
        ];
    }
}
