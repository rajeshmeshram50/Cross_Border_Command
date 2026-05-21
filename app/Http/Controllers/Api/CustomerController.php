<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\CustomerAddress;
use App\Support\MasterVisibility;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Sales Matrix → Customers.
 *
 * Full CRUD backed by the `customers` + `customer_addresses` tables.
 * Tenant-scoped: super_admin sees everything, client_* see their
 * client's rows, branch_user/employee see their branch's rows.
 *
 * Payload contract (POST / PUT):
 *  {
 *    company_name, legal_name, type, segment, classification, risk_level,
 *    website, status,
 *    primary_address: {
 *       type, address_line, country, state, city, pin,
 *       cp_name, cp_designation, cp_contact, cp_email, cp_whatsapp
 *    },
 *    locations: [ same shape ... ]   // optional additional rows
 *  }
 *
 *  primary_email on the customer row is mirrored from
 *  primary_address.cp_email and is unique within tenant scope.
 */
class CustomerController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $q = Customer::query()
            ->forUser($user)
            ->with(['primaryAddress', 'addresses'])
            ->withCount(['consignees', 'consignees as same_as_customer_consignees_count' => function ($q) {
                $q->where('same_as_customer', true);
            }])
            ->orderByDesc('id');

        if ($search = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('company_name',  'ilike', "%{$search}%")
                  ->orWhere('legal_name',  'ilike', "%{$search}%")
                  ->orWhere('customer_code','ilike', "%{$search}%")
                  ->orWhere('primary_email','ilike', "%{$search}%")
                  ->orWhere('segment',     'ilike', "%{$search}%");
            });
        }

        // Tab filter (fresh / recurring) is a frontend bucketing concept
        // — keep it on the response for now but don't filter rows so the
        // list keeps working until "consignees" linkage lands.
        $tab = $request->query('tab', 'fresh');

        $rows = $q->get()->map(fn ($c) => $this->shape($c))->all();

        return response()->json([
            'tab'   => $tab,
            'count' => count($rows),
            'data'  => $rows,
        ]);
    }

    public function show(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $row = Customer::query()
            ->forUser($user)
            ->with(['primaryAddress', 'addresses'])
            ->findOrFail($id);
        return response()->json(['data' => $this->shape($row)]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        [$clientId, $branchId] = $this->resolveOwnership($user);

        $data = $this->validatePayload($request, null, $clientId);

        $row = DB::transaction(function () use ($data, $user, $clientId, $branchId) {
            $primary = $data['primary_address'];

            $customer = Customer::create([
                'client_id'      => $clientId,
                'branch_id'      => $branchId,
                'created_by'     => optional($user)->id,
                'company_name'   => $data['company_name'],
                'legal_name'     => $data['legal_name']     ?? null,
                'type'           => $data['type']           ?? null,
                'segment'        => $data['segment']        ?? null,
                'classification' => $data['classification'] ?? null,
                'risk_level'     => $data['risk_level']     ?? null,
                'website'        => $data['website']        ?? null,
                'primary_email'  => $primary['cp_email']    ?? null,
                'status'         => $data['status']         ?? 'Active',
            ]);

            // Generate the user-facing C-### code from the new id. Done
            // post-insert so the digit count grows naturally (C-001 →
            // C-123 → C-1234 once we cross 1000) without a sequence table.
            $customer->customer_code = 'C-' . str_pad((string) $customer->id, 3, '0', STR_PAD_LEFT);
            $customer->save();

            // Primary address row — always exactly one.
            CustomerAddress::create(array_merge($primary, [
                'customer_id' => $customer->id,
                'is_primary'  => true,
            ]));

            // Additional locations
            foreach ($data['locations'] ?? [] as $loc) {
                CustomerAddress::create(array_merge($loc, [
                    'customer_id' => $customer->id,
                    'is_primary'  => false,
                ]));
            }

            return $customer->load(['primaryAddress', 'addresses']);
        });

        return response()->json(['data' => $this->shape($row)], 201);
    }

    public function update(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->findOrFail($id);

        if ($denial = MasterVisibility::hierarchicalDenial($user, $customer, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $this->validatePayload($request, (int) $customer->id, $customer->client_id);

        $row = DB::transaction(function () use ($customer, $data) {
            $primary = $data['primary_address'];

            $customer->update([
                'company_name'   => $data['company_name'],
                'legal_name'     => $data['legal_name']     ?? null,
                'type'           => $data['type']           ?? null,
                'segment'        => $data['segment']        ?? null,
                'classification' => $data['classification'] ?? null,
                'risk_level'     => $data['risk_level']     ?? null,
                'website'        => $data['website']        ?? null,
                'primary_email'  => $primary['cp_email']    ?? null,
                'status'         => $data['status']         ?? $customer->status,
            ]);

            // Replace-all strategy on addresses: nuke + recreate from the
            // payload. Customer addresses don't have hard FK dependents
            // (they live under cascadeOnDelete from customer), so this
            // is safe and keeps the update path simple. If/when the
            // addresses get referenced elsewhere (shipments etc.) this
            // becomes a diff-by-id sync.
            CustomerAddress::where('customer_id', $customer->id)->delete();
            CustomerAddress::create(array_merge($primary, [
                'customer_id' => $customer->id,
                'is_primary'  => true,
            ]));
            foreach ($data['locations'] ?? [] as $loc) {
                CustomerAddress::create(array_merge($loc, [
                    'customer_id' => $customer->id,
                    'is_primary'  => false,
                ]));
            }

            return $customer->load(['primaryAddress', 'addresses']);
        });

        return response()->json(['data' => $this->shape($row)]);
    }

    public function destroy(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->findOrFail($id);

        if ($denial = MasterVisibility::hierarchicalDenial($user, $customer, 'delete')) {
            return response()->json(['message' => $denial], 403);
        }

        $customer->delete();
        return response()->json(['id' => $customer->id, 'deleted' => true]);
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    /**
     * Reshape a Customer + addresses to the frontend contract — the
     * list page and modal both read these keys.
     */
    private function shape(Customer $c): array
    {
        $primary = $c->primaryAddress;
        return [
            'id'              => $c->customer_code ?: ('C-' . str_pad((string) $c->id, 3, '0', STR_PAD_LEFT)),
            'db_id'           => $c->id,
            'company'         => $c->company_name,
            'legalName'       => $c->legal_name,
            'type'            => $c->type,
            'segment'         => $c->segment,
            'classification'  => $c->classification,
            'riskLevel'       => $c->risk_level,
            'website'         => $c->website,
            'status'          => $c->status,
            'country'         => $primary?->country,
            'state'           => $primary?->state,
            'city'            => $primary?->city,
            'pin'             => $primary?->pin,
            'addr'            => $primary?->address_line,
            'addrType'        => $primary?->type,
            'contact'         => $primary?->cp_name,
            'cpDesig'         => $primary?->cp_designation,
            'phone'           => $primary?->cp_contact,
            'email'           => $primary?->cp_email,
            'whatsapp'        => $primary?->cp_whatsapp === 'yes' ? 'Yes' : ($primary?->cp_whatsapp === 'no' ? 'No' : null),
            // Eager-counted via `withCount('consignees')` on the index
            // query so the list page doesn't N+1. Falls back to 0 for
            // show() / store() / update() responses that don't load the count.
            'consignees'      => (int) ($c->consignees_count ?? 0),
            // True when at least one consignee linked to this customer was
            // created with the "Same as Customer" toggle on — editing the
            // customer's Stage 1 fields would semantically affect those
            // mirrored consignees, so the UI prompts before opening edit.
            'hasSameAsCustomerConsignees' => ((int) ($c->same_as_customer_consignees_count ?? 0)) > 0,
            'sameAsCustomerConsigneeCount' => (int) ($c->same_as_customer_consignees_count ?? 0),
            'locations'       => $c->addresses
                ->where('is_primary', false)
                ->values()
                ->map(fn ($a) => $this->shapeAddress($a))
                ->all(),
            'primary_address' => $primary ? $this->shapeAddress($primary) : null,
        ];
    }

    private function shapeAddress(CustomerAddress $a): array
    {
        return [
            'id'             => $a->id,
            'type'           => $a->type,
            'address_line'   => $a->address_line,
            'country'        => $a->country,
            'state'          => $a->state,
            'city'           => $a->city,
            'pin'            => $a->pin,
            'cp_name'        => $a->cp_name,
            'cp_designation' => $a->cp_designation,
            'cp_contact'     => $a->cp_contact,
            'cp_email'       => $a->cp_email,
            'cp_whatsapp'    => $a->cp_whatsapp,
        ];
    }

    /**
     * Validate the incoming POST / PUT body. Returns the validated
     * array (nested primary_address + locations preserved).
     *
     * `primary_email` uniqueness is checked against customers within
     * the same client scope; super_admin globals (client_id null) live
     * in their own bucket.
     */
    private function validatePayload(Request $request, ?int $customerId, $clientId): array
    {
        return $request->validate([
            'company_name'   => 'required|string|max:255',
            'legal_name'     => 'nullable|string|max:255',
            'type'           => 'nullable|string|max:64',
            'segment'        => 'nullable|string|max:64',
            'classification' => 'nullable|string|max:64',
            'risk_level'     => 'nullable|string|max:32',
            'website'        => 'nullable|string|max:500',
            'status'         => 'nullable|in:Active,Inactive',

            'primary_address'                => 'required|array',
            'primary_address.type'           => 'required|string|max:64',
            'primary_address.address_line'   => 'required|string|max:1000',
            'primary_address.country'        => 'nullable|string|max:64',
            'primary_address.state'          => 'nullable|string|max:64',
            'primary_address.city'           => 'nullable|string|max:64',
            // PIN must be exactly 6 digits (Indian postal code format).
            'primary_address.pin'            => ['nullable', 'string', 'regex:/^\d{6}$/'],
            'primary_address.cp_name'        => 'required|string|max:255',
            'primary_address.cp_designation' => 'nullable|string|max:128',
            /* Primary phone must be unique within the tenant. Closure
             * rule because the column lives on `customer_addresses`
             * (not the customers table) and we only want to block
             * duplicates among the *primary* address row per customer.
             * Mirrors the email check below but without a dedicated
             * denormalised column. */
            'primary_address.cp_contact'     => [
                'required', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/',
                function ($attribute, $value, $fail) use ($clientId, $customerId) {
                    if (!trim((string) $value)) return;
                    $exists = \App\Models\CustomerAddress::query()
                        ->where('cp_contact', $value)
                        ->where('is_primary', true)
                        ->whereHas('customer', function ($q) use ($clientId, $customerId) {
                            $q->whereNull('deleted_at');
                            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                            if ($customerId) $q->where('id', '!=', $customerId);
                        })
                        ->exists();
                    if ($exists) {
                        $fail('This phone number is already used by another customer.');
                    }
                },
            ],
            'primary_address.cp_email'       => [
                'required', 'email', 'max:255',
                Rule::unique('customers', 'primary_email')
                    ->where(function ($q) use ($clientId) {
                        $q->whereNull('deleted_at');
                        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                    })
                    ->ignore($customerId),
            ],
            'primary_address.cp_whatsapp'    => 'nullable|in:yes,no',

            'locations'                  => 'sometimes|array',
            'locations.*.type'           => 'required_with:locations|string|max:64',
            'locations.*.address_line'   => 'required_with:locations|string|max:1000',
            'locations.*.country'        => 'nullable|string|max:64',
            'locations.*.state'          => 'nullable|string|max:64',
            'locations.*.city'           => 'nullable|string|max:64',
            'locations.*.pin'            => ['nullable', 'string', 'regex:/^\d{6}$/'],
            'locations.*.cp_name'        => 'required_with:locations|string|max:255',
            'locations.*.cp_designation' => 'nullable|string|max:128',
            'locations.*.cp_contact'     => ['nullable', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/'],
            'locations.*.cp_email'       => 'nullable|email|max:255',
            'locations.*.cp_whatsapp'    => 'nullable|in:yes,no',
        ]);
    }

    /**
     * Resolve `[client_id, branch_id]` for the row being inserted.
     * Only used by store() — tenant *visibility* is handled by the
     * Customer::scopeForUser() Eloquent scope.
     */
    private function resolveOwnership($user): array
    {
        if (!$user) return [null, null];
        if ($user->user_type === 'super_admin') return [null, null];
        $clientId = $user->client_id ?? ($user->branch?->client_id);
        $branchId = $user->branch_id;
        return [$clientId, $branchId];
    }
}