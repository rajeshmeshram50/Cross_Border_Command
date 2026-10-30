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
    public function __construct(
        private InventoryMasterService $svc,
        private InventoryCodeAllocator $codes,
    ) {}

    /* ══════════════════════════ READ ══════════════════════════ */

    /** GET /inventory/warehouses */
    /**
     * GET /inventory/warehouses          the grid
     * GET /inventory/warehouses?view=options   the dropdown
     *
     * One method, because the two differ only in what comes out: the filters,
     * the tenancy and the ordering are the same question asked once.
     */
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

            // The dropdown wants none of what follows — no tabs, no counts, no
            // paging — so it leaves before any of it is built.
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

            /* The grid shows how many zones and racks each warehouse holds.
               Subqueries, so a page of ten costs two extra queries, not twenty. */
            $q = $base->with(['country:id,name', 'state:id,name'])
                ->withCount(['zones', 'racks'])
                // Area the zones already claim — the Add Zone form shows what is
                // still free from it (CS-940 #11). Same sum as freeWarehouseAreaSqft().
                ->withSum('zones', 'area_sqft')
                ->orderByDesc('id');

            $this->applyTab($q, $f['tab'] ?? null);
            // 'code' first: WH-002 is what the list shows and what someone
            // reading a label types in. It was not searchable at all while the
            // code was computed from the id, because there was no column.
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

    /**
     * GET /inventory/warehouses/options — the cascading dropdown on the Zone
     * and Rack forms. Kept as its own route because the URL reads better from
     * the frontend; it is the same method underneath.
     */
    public function options(Request $request)
    {
        return $this->index($request->merge(['view' => 'options']));
    }

    /**
     * GET /inventory/warehouses/next-code — what the next warehouse would be
     * called, for the placeholder on an empty Add form. Preview only; the code
     * is derived from the row id, so it is settled when the row is inserted.
     */
    public function nextCode(Request $request)
    {
        $user = $this->tenantUser($request);

        return response()->json(['status' => true, 'data' => [
            'next_code' => $this->codes->peek(
                'inventory_warehouses',
                $user->client_id,
                $this->branchScope($request, $user),
            ),
            // Nothing is reserved: whoever saves first takes it.
            'preview'   => true,
        ]], 200);
    }

    /** GET /inventory/warehouses/{id} */
    public function show(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $warehouse = $this->ownedQuery(Warehouse::query(), $user)
                ->with(['country:id,name', 'state:id,name'])
                ->withCount(['zones', 'racks'])
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

    /* ══════════════════════════ WRITE ══════════════════════════ */

    /** POST /inventory/warehouses */
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
            /* Allocated under a lock, inside this transaction — so a save that
               fails below gives the number back, which is the whole reason the
               code no longer rides on the id. Same scoping as vendor_code and
               emp_code: each branch runs its own 001, 002, 003. */
            $warehouse->code = $this->codes->next('inventory_warehouses', $user->client_id, $branch);
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
            // Locked: a zone saved meanwhile is what guardSettled() is judging.
            $warehouse = $this->ownedQuery(Warehouse::query(), $user)->lockForUpdate()->findOrFail($id);
            // The branch is fixed at create — fill() must not move it.
            $data      = collect($request->validate($this->rules(), self::MESSAGES))->except('branch_id')->all();

            $this->guardName($data['wh_name'], $user, $warehouse->branch_id, $warehouse->id);
            $this->guardEmail($data['contact_email'], $user, $warehouse->id);
            $this->guardSettled($warehouse, $data);

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
            $warehouse = $this->ownedQuery(Warehouse::query(), $user)->findOrFail($id);
            $data      = $request->validate(['status' => ['required', 'integer', 'in:0,1']]);

            /* Retired from the bottom up. Switching off a warehouse that still
               has live zones or boxes used to take them all down silently. */
            if ((int) $data['status'] === 0 && $warehouse->isActive()
                && (Zone::where('warehouse_id', $warehouse->id)->where('status', 1)->exists()
                    || $this->holdsStock('warehouse_id', $warehouse->id))) {
                $this->reject('Move or deactivate its zones first.', null, 409);
            }

            $warehouse->forceFill(['status' => $data['status'], 'updated_by' => $user->id])->save();

            if ((int) $data['status'] === 0) {
                Zone::where('warehouse_id', $warehouse->id)->update(['status' => 0, 'updated_by' => $user->id]);
                Rack::where('warehouse_id', $warehouse->id)->update(['status' => 0, 'updated_by' => $user->id]);
                // The shelves too — a live shelf under a dead rack is still offered.
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

    /**
     * DELETE /inventory/warehouses/{id}
     * Refused once it holds zones — the screen's toggle is the way to retire a
     * warehouse, and a delete here would orphan every rack and shelf below it.
     */
    public function destroy(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user      = $this->tenantUser($request);
            $warehouse = $this->ownedQuery(Warehouse::query(), $user)->withCount('zones')->lockForUpdate()->findOrFail($id);

            if ($warehouse->zones_count > 0) {
                $this->reject("{$warehouse->wh_name} holds {$warehouse->zones_count} zone(s). Deactivate it instead of deleting it.", null, 409);
            }
            /* A 3PL has no zones, so the check above never stops it — yet its
               put-aways and invoices name it. */
            if ($used = $this->referencedBy('warehouse_id', $warehouse->id)) {
                $this->reject("{$warehouse->wh_name} is used by {$used}. Deactivate it instead of deleting it.", null, 409);
            }

            $card = $warehouse->card_path;
            $warehouse->delete();

            DB::commit();

            // Only once the delete is committed — a rollback must not lose the file.
            if ($card) Storage::disk('public')->delete($card);

            return response()->json(['status' => true, 'data' => ['id' => $id, 'deleted' => true]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * GET /inventory/warehouses/{id}/preview — the label as data.
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
                'download_url' => url("/api/inventory/warehouses/{$id}/label"),
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** GET /inventory/warehouses/{id}/label — the same label, as a 4x3in PDF. */
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
     * What the warehouse label prints. Never scanned at put-away — Stage 04
     * picks the warehouse on screen — so this one is for the gate.
     */
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
            // The scanner's value: the code repeats per branch, the id does not.
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

    /**
     * GET /inventory/warehouses/{id}/qr — the QR and nothing else.
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

    /**
     * What a warehouse may no longer change once zones have been built in it.
     *
     * A zone is allocated AGAINST the warehouse's area — the zone form offers
     * only what is still free — so shrinking the warehouse afterwards leaves
     * every zone over-committed and the free figure pinned at nothing. And the
     * address is not a label: the goods are physically in that city, under that
     * state's tax code, and the stock does not move because someone edited a
     * dropdown.
     *
     * So the moment the first zone exists these four settle. Everything else —
     * the name, the contact, the business card, the map link, the status —
     * stays editable, because none of it is load-bearing.
     *
     * An EMPTY warehouse is untouched by this: nothing has been built on the
     * old figures, so there is nothing to contradict.
     */
    private function guardSettled(Warehouse $warehouse, array $d): void
    {
        if (!$warehouse->zones()->exists()) return;

        $changed = [];

        // Compared as a number: '48000' and 48000.0 are the same area.
        if (array_key_exists('area_sqft', $d)
            && round((float) $d['area_sqft'], 2) !== round((float) $warehouse->area_sqft, 2)) {
            $changed[] = 'Warehouse Area';
        }

        // Own ↔ 3PL: a 3PL has nothing beneath it, and zones are already built here.
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
            // Loose on purpose: an id arrives as a string from a form post, and
            // null and '' both mean "not given".
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

    private const MESSAGES = [
        'city.regex'           => 'City must contain letters only — no numbers or symbols.',
        'contact_person.regex' => 'Contact person must contain letters only — no numbers or symbols.',
    ];

    private function rules(): array
    {
        return [
            'wh_name'        => ['required', 'string', 'max:180'],
            'wh_type'        => ['required', Rule::in(Warehouse::TYPES)],
            // numeric(14,2) — anything larger is a database error, not a 422.
            'area_sqft'      => ['required', 'numeric', 'min:1', 'max:999999999999'],
            'address'        => ['required', 'string', 'max:1000'],
            'country_id'     => ['required', 'integer', Rule::exists('master_countries', 'id')],
            /* The form offers the States master only for India; every other
               country takes a typed province. One of the two is required. */
            'state_id'       => ['nullable', 'required_without:state_name', 'integer', Rule::exists('master_states', 'id')],
            'state_name'     => ['nullable', 'required_without:state_id', 'string', 'max:100'],
            /* City and contact person are names (QA CS-939): they start with a
               letter and hold only letters, spaces and . ' - (city also ( ) ,).
               Blocking just /^\d+$/ still let "123 45", "12.5" and "---" in. */
            'city'           => ['required', 'string', 'max:100', "regex:/^\\p{L}[\\p{L}\\p{M}\\s.'(),-]*$/u"],
            // 6 digits in India, longer postal codes elsewhere.
            'pincode'        => ['required', 'string', 'max:20'],
            'map_url'        => ['nullable', 'url', 'max:500'],
            'contact_person' => ['required', 'string', 'max:150', "regex:/^\\p{L}[\\p{L}\\p{M}\\s.'-]*$/u"],
            'contact_dial'   => ['nullable', 'string', 'max:8'],
            // Digits only — the form strips spaces; 10 in India, 6–15 elsewhere.
            'contact_mobile' => ['required', 'string', 'regex:/^\d{6,15}$/', function ($attr, $value, $fail) {
                /* A +91 mobile is ten digits starting 6-9 (CS-939 #9) - the
                   form checks this, so the API must too, with the same words. */
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
            /* No 'status': it changes only through setStatus(), which cascades
               to the zones, racks and shelves below. A save that set it would
               switch the warehouse off and leave them all live. The branch
               the switcher is on, read by writeBranch() on a create. */
            'branch_id'      => ['nullable', 'integer'],
        ];
    }

    /** One warehouse of a name per branch — two "Main Godown"s are a mis-pick waiting to happen. */
    private function guardName(string $name, $user, ?int $branch, ?int $exceptId): void
    {
        $q = Warehouse::where('client_id', $user->client_id)->where('branch_id', $branch);

        if ($this->nameTaken($q, 'wh_name', $name, $exceptId)) {
            $this->reject('A warehouse with this name already exists.', 'wh_name');
        }
    }

    /**
     * The warehouse contact email must not already belong to anyone else on the
     * platform (QA CS-939): a customer, consignee or supplier email here sends
     * stock and dispatch mail for our own site to an outside inbox, and any
     * other match makes the address ambiguous wherever mail is routed by it.
     *
     * Checked client-wide — parties and people belong to the whole client, not
     * one branch. Each row: who it is, table, email columns, display name, and
     * the parent [table, fk] that carries client_id when the row itself does
     * not. Soft-deleted rows are ignored. Left out on purpose: logs, OTP and
     * reset tokens, pending onboarding invites, previous employers' HR, and
     * sourcing-product supplier copies (no tenant column to scope them by).
     */
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
        // Rows that are soft-deleted themselves (child rows go with their parent).
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

    /** Move an attached business card onto the public disk. Empty when none came. */
    private function storeCard(Request $request, Warehouse $warehouse): array
    {
        if (!$file = $request->file('card')) return [];

        // The old file goes only once the new one is on disk.
        $path = $file->store("inventory/warehouses/{$warehouse->id}", 'public');
        if ($warehouse->card_path) Storage::disk('public')->delete($warehouse->card_path);

        return ['card_path' => $path, 'card_name' => $file->getClientOriginalName()];
    }

    /** The dropdown shape: the id, the label, and the fields the Zone and Rack
     *  forms show as AUTO beside the picker. Nothing else is loaded for it. */
    private function optionRow(Warehouse $w): array
    {
        return [
            'id'        => $w->id,
            'wh_code'   => $w->wh_code,
            'wh_name'   => $w->wh_name,
            'wh_type'   => $w->wh_type,
            'area_sqft' => (float) $w->area_sqft,
            'location'  => trim(implode(', ', array_filter([$w->city, $w->stateLabel()]))),
            // The street line and the postcode, so a picker can show where the
            // site actually is rather than only which city it is in — two
            // warehouses in one city read the same otherwise.
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
            // file_url(), not Storage::disk('public')->url(): on the Azure disk the
            // latter throws, which 500'd the whole Warehouse list once a single
            // warehouse had a card attached.
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
