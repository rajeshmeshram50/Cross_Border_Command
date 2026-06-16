<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\CustomerAddress;
use App\Models\Masters\AddressTypes;
use App\Models\Masters\Countries;
use App\Models\Masters\CustomerClassifications;
use App\Models\Masters\CustomerTypes;
use App\Models\Masters\Designations;
use App\Models\Masters\DocumentType;
use App\Models\Masters\RiskLevels;
use App\Models\Masters\Segments;
use App\Models\Masters\States;
use App\Support\MasterBundleCache;
use App\Support\MasterVisibility;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;


class CustomerController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $q = Customer::query()
            // Honour the BranchSwitcher: when a client-admin / main-branch user
            // has picked a specific branch, narrow the list to it. Ignored for
            // sub-branch users (they can't switch) inside applyReadScope.
            ->forUser($user, $request->integer('branch_id') ?: null)
            /* Single eager-load — `addresses` returns ALL rows in
             * customer_addresses (primary + extras). The Customer
             * model's `primaryAddress` relationship reads from the
             * already-loaded collection via a HasOne with the
             * is_primary scope; loading `addresses` separately on
             * top was firing the same SELECT twice per index call. */
            ->with(['addresses'])
            ->withCount(['consignees', 'consignees as same_as_customer_consignees_count' => function ($q) {
                $q->where('same_as_customer', true);
            }])
            /* Order on the indexed customer_id (PK) — same monotonic
             * sequence as created_at but uses the clustered PK index
             * directly, so no sort step at all. */
            ->orderByDesc('id');

        if ($search = trim((string) $request->query('q', ''))) {
            /* Customer code is unique + indexed → cheap exact lookup
             * first. Email is also indexed (client_id, primary_email)
             * → starts-with against the email column. Everything else
             * falls back to ilike contains-search. The early-out on
             * the indexed columns keeps small/medium tables fast and
             * the OR-chain only fires when none of the indexed
             * shortcuts match. */
            $exact = mb_strtoupper($search);
            $q->where(function ($w) use ($search, $exact) {
                $w->where('customer_code', $exact)
                  ->orWhere('primary_email', 'ilike', $search . '%')
                  ->orWhere('company_name',  'ilike', "%{$search}%")
                  ->orWhere('legal_name',    'ilike', "%{$search}%")
                  ->orWhere('segment',       'ilike', "%{$search}%")
                  // Customer Type (shown in the list) — e.g. "Retailer".
                  ->orWhere('type',          'ilike', "%{$search}%")
                  /* Country / Contact Person / Contact No live on the primary
                   * address row (mirrored into the list's Country / Contact /
                   * Phone columns), so search them via the addresses relation
                   * to match what the user actually sees in the table. */
                  ->orWhereHas('addresses', function ($a) use ($search) {
                      $a->where('is_primary', true)
                        ->where(function ($x) use ($search) {
                            $x->where('country',    'ilike', "%{$search}%")
                              ->orWhere('cp_name',  'ilike', "%{$search}%")
                              ->orWhere('cp_contact', 'ilike', "%{$search}%");
                        });
                  });
            });
        }

        /* Tab filter — buckets the list by whether the customer has at
         * least one lead pointing at them (leads.customer_id):
         *   - `recurring` → customer has been linked to ≥ 1 lead in the
         *     Sales Matrix (the "we've worked with them before" bucket).
         *   - `fresh`     → customer has NO leads yet (newly added but
         *     not yet engaged via the opp pipeline).
         * Defaults to `fresh` to match the frontend's initial tab state.
         *
         * Implemented via a sub-select EXISTS so we don't need to add a
         * `leads()` HasMany relation on Customer (keeps the model lean).
         * Soft-deleted leads are excluded — a deleted lead doesn't keep
         * the customer in the recurring bucket. */
        $tab = $request->query('tab', 'fresh');
        if ($tab === 'recurring') {
            $q->whereExists(function ($w) {
                $w->select(\DB::raw(1))
                    ->from('leads')
                    ->whereColumn('leads.customer_id', 'customers.id')
                    ->whereNull('leads.deleted_at');
            });
        } elseif ($tab === 'fresh') {
            $q->whereNotExists(function ($w) {
                $w->select(\DB::raw(1))
                    ->from('leads')
                    ->whereColumn('leads.customer_id', 'customers.id')
                    ->whereNull('leads.deleted_at');
            });
        }
        // 'all' or anything else → no tab filter

        /* Optional server-side pagination — kicks in when the client
         * sends `?page` or `?per_page`. Defaults preserve the legacy
         * "return everything" shape so existing callers don't break.
         * Cap per_page at 200 so a misbehaving client can't fetch
         * tens of thousands of rows in one round-trip. */
        $page    = (int) $request->query('page', 0);
        $perPage = min((int) $request->query('per_page', 0), 200);

        if ($page > 0 || $perPage > 0) {
            $perPage = $perPage > 0 ? $perPage : 50;
            $page    = $page > 0 ? $page : 1;
            $total   = (clone $q)->count();
            $rows    = $q->forPage($page, $perPage)
                ->get()
                ->map(fn ($c) => $this->shape($c))
                ->all();
            return response()->json([
                'tab'      => $tab,
                'count'    => $total,
                'page'     => $page,
                'per_page' => $perPage,
                'data'     => $rows,
            ]);
        }

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

        /* Stage 2 + Stage 3 data embedded inline.
         *
         * The AddCustomerModal edit-mode previously fired 4 parallel HTTP
         * requests on open (/customers/{id} + /customers/{id}/documents +
         * /customers/{id}/owners + /segment-uploads/customer/{id}). On the
         * single-threaded `php artisan serve` and even on a multi-process
         * Apache, each request paid a ~500ms Laravel framework boot tax.
         * Result: edit-modal opens cost 2-5 sec of pure framework overhead
         * even though the SQL was sub-50ms.
         *
         * Bundling the three nested resources into this response collapses
         * 4 round-trips into 1 — same proven pattern we used for
         * ClientPermissions (embedded admin_permissions in clients/{id}).
         *
         * Each delegated controller's index() reuses its own resolveCustomer()
         * which applies the same `forUser` tenant scope, so security stays
         * exactly where it was. Wrapped in try/catch so a single nested
         * controller's failure (e.g. segment_uploads 404 on a customer with
         * no uploads yet) does not break the entire show() response — the
         * key just lands as an empty list and the frontend falls back to
         * its existing on-tab fetch.
         */
        $documents = $this->safeDelegate(
            fn () => (new CustomerDocumentController())->index($request, $id)
        );
        $owners = $this->safeDelegate(
            fn () => (new CustomerOwnerController())->index($request, $id)
        );
        $segmentUploads = $this->safeDelegate(
            fn () => (new SegmentDocUploadController())->index($request, 'customer', $id)
        );

        return response()->json([
            'data'            => $this->shape($row),
            'documents'       => $documents['data'] ?? [],
            'owners'          => $owners['data'] ?? [],
            // segment_uploads keeps its full shape (data + by_category + count)
            // because the frontend reads `data[].category` for the per-tab
            // bucketing in Stage 2 KYC. Fallback to a stable empty shape so
            // consumers don't have to null-check.
            'segment_uploads' => $segmentUploads ?: ['data' => [], 'by_category' => [], 'count' => 0],
        ]);
    }

    /**
     * Run a delegated controller call and unwrap its JSON response, returning
     * `null` on any failure. Used by show() to embed nested resources without
     * letting a single inner failure (404, validation, etc.) take down the
     * whole response. Caller decides how to default the missing key.
     */
    private function safeDelegate(\Closure $call): ?array
    {
        try {
            $res = $call();
            $decoded = json_decode($res->getContent(), true);
            return is_array($decoded) ? $decoded : null;
        } catch (\Throwable $e) {
            \Log::warning('CustomerController::show safeDelegate failed: ' . $e->getMessage());
            return null;
        }
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        [$clientId, $branchId] = $this->resolveOwnership($user);

        $data = $this->validatePayload($request, null, $clientId);

        $row = DB::transaction(function () use ($data, $user, $clientId, $branchId) {
            $primary = $data['primary_address'];

            // Allocate the user-facing C-### code PER CLIENT (not from the
            // global autoincrement id). The old id-based code leaked the
            // cross-tenant sequence into every client's list — Client A
            // would see C-009 → C-060 with gaps because the numbers in
            // between belonged to other tenants. We serialise the
            // allocation with a row lock on the owning client (same pattern
            // QuotationController uses for QT/PI codes) so two concurrent
            // inserts can't grab the same number.
            if ($clientId !== null) {
                DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
            }
            $code = $this->nextCustomerCode($clientId);

            $customer = Customer::create([
                'client_id'      => $clientId,
                'branch_id'      => $branchId,
                'created_by'     => optional($user)->id,
                'customer_code'  => $code,
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

        // Segment-document protection: a segment that already has uploaded
        // documents cannot be removed from the customer (its evidence would be
        // orphaned). Reject the edit naming the offending segment(s).
        $blockedSegments = \App\Support\SegmentGuard::blockedRemovals(
            \App\Models\Customer::class,
            (int) $customer->id,
            (int) $customer->client_id,
            $customer->segment,
            $data['segment'] ?? null,
        );
        if (!empty($blockedSegments)) {
            return response()->json([
                'message' => 'Cannot remove the segment(s): ' . implode(', ', $blockedSegments)
                    . ' — documents have already been uploaded for them. Remove those documents first.',
                'errors'  => ['segment' => ['Segment(s) with uploaded documents cannot be removed: ' . implode(', ', $blockedSegments) . '.']],
            ], 422);
        }

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

        // Keep any same-as-customer consignee's CORE details (company/legal
        // name, segment, classification, risk, website, email + primary
        // address) in lock-step with the customer. Best-effort — a mirror
        // hiccup must never fail the customer save.
        try {
            app(\App\Services\ConsigneeKycMirror::class)->syncCoreFromCustomer($row, $user?->id);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Consignee core mirror failed: ' . $e->getMessage());
        }

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
        /* Derive `primary` from the already-loaded `addresses`
         * collection so we don't trigger a separate
         * `primaryAddress` SELECT for every customer in the list
         * (used to be the source of an N+1 — fixed by dropping the
         * `with(['primaryAddress'])` in index() and keeping just
         * `with(['addresses'])`). The `addresses` HasMany already
         * orders by `is_primary DESC` so the first row is the
         * primary one if any exists. Falls back to the standalone
         * `primaryAddress` lookup only when `addresses` isn't
         * eager-loaded (i.e. show() or freshly-loaded create
         * responses that opted into the explicit load). */
        $primary = $c->relationLoaded('addresses')
            ? $c->addresses->firstWhere('is_primary', true)
            : $c->primaryAddress;
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
        $data = $request->validate([
            'company_name'   => 'required|string|max:255',
            /* Legal (registered entity) name must be unique per tenant — two
             * customers can't share the same legal name. Case-insensitive,
             * client-scoped, ignores the row being edited, and skips the check
             * when blank (legal_name stays optional). */
            'legal_name'     => [
                'nullable', 'string', 'max:255',
                function ($attribute, $value, $fail) use ($clientId, $customerId) {
                    if (!trim((string) $value)) return;
                    $exists = \App\Models\Customer::query()
                        ->whereNull('deleted_at')
                        ->where(function ($q) use ($clientId) {
                            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                        })
                        ->whereRaw('LOWER(legal_name) = ?', [mb_strtolower(trim((string) $value))])
                        ->when($customerId, fn ($q) => $q->where('id', '!=', $customerId))
                        ->exists();
                    if ($exists) {
                        $fail('This legal name is already used by another customer.');
                    }
                },
            ],
            'type'           => 'nullable|string|max:64',
            'segment'        => 'nullable|string|max:1024',
            'classification' => 'nullable|string|max:64',
            'risk_level'     => 'nullable|string|max:32',
            'website'        => 'nullable|string|max:500',
            'status'         => 'nullable|in:Active,Inactive',

            'primary_address'                => 'required|array',
            'primary_address.type'           => 'required|string|max:64',
            'primary_address.address_line'   => 'required|string|min:4|max:75',
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
            // Standard email format — username@domain.extension. Allows
            // digit-containing domains (office365.com, 7eleven.com) but
            // still rejects malformed inputs like "x@.com", "x@gmail",
            // or "x@gmail.c". Frontend uses the same regex inline.
            'primary_address.cp_email'       => [
                'required', 'email', 'max:255',
                'regex:/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/',
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
            'locations.*.address_line'   => 'required_with:locations|string|min:4|max:75',
            'locations.*.country'        => 'nullable|string|max:64',
            'locations.*.state'          => 'nullable|string|max:64',
            'locations.*.city'           => 'nullable|string|max:64',
            'locations.*.pin'            => ['nullable', 'string', 'regex:/^\d{6}$/'],
            'locations.*.cp_name'        => 'required_with:locations|string|max:255',
            'locations.*.cp_designation' => 'nullable|string|max:128',
            'locations.*.cp_contact'     => ['nullable', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/'],
            'locations.*.cp_email'       => ['nullable', 'email', 'max:255', 'regex:/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/'],
            'locations.*.cp_whatsapp'    => 'nullable|in:yes,no',
        ]);

        /* Cross-row uniqueness within the payload. Catches the case
         * where the user reuses the primary contact's email/phone on
         * an additional location (or duplicates across two additional
         * locations) — the same address book can't list one person
         * under two different addresses. Errors are keyed by the
         * `locations.{i}.cp_email` / `cp_contact` paths so the
         * frontend's 422 mapper lands them on the right field. */
        $primary       = $data['primary_address'] ?? [];
        $seenEmails    = [];
        $seenPhones    = [];
        $primaryEmail  = strtolower(trim((string) ($primary['cp_email']   ?? '')));
        $primaryPhone  = trim((string) ($primary['cp_contact'] ?? ''));
        if ($primaryEmail) $seenEmails[$primaryEmail] = 'primary_address';
        if ($primaryPhone) $seenPhones[$primaryPhone] = 'primary_address';
        $errors = [];
        foreach ($data['locations'] ?? [] as $i => $loc) {
            $email = strtolower(trim((string) ($loc['cp_email']   ?? '')));
            $phone = trim((string) ($loc['cp_contact'] ?? ''));
            if ($email && isset($seenEmails[$email])) {
                $errors["locations.{$i}.cp_email"]   = ['This email is already used by another address on this customer.'];
            }
            if ($phone && isset($seenPhones[$phone])) {
                $errors["locations.{$i}.cp_contact"] = ['This phone number is already used by another address on this customer.'];
            }
            if ($email) $seenEmails[$email] = "locations.{$i}";
            if ($phone) $seenPhones[$phone] = "locations.{$i}";
        }
        if (!empty($errors)) {
            throw \Illuminate\Validation\ValidationException::withMessages($errors);
        }

        return $data;
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

    /**
     * Next per-client customer code (C-001, C-002 …).
     *
     * Codes are sequential WITHIN a tenant, not global — so every client
     * gets a clean gap-free list. The caller holds a lockForUpdate on the
     * owning `clients` row (the super_admin null-client bucket excepted),
     * which serialises concurrent allocations. Scans `withTrashed` so a
     * soft-deleted customer's number is never reused — keeping codes a
     * stable per-tenant audit trail.
     */
    private function nextCustomerCode($clientId): string
    {
        $codes = Customer::withTrashed()
            ->when(
                $clientId === null,
                fn ($q) => $q->whereNull('client_id'),
                fn ($q) => $q->where('client_id', $clientId)
            )
            ->pluck('customer_code');

        $max = 0;
        foreach ($codes as $c) {
            if (preg_match('/^C-0*(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }

        return 'C-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }

    /* ──────────────────────────────────────────────────────────────────
     * GET /customers/master-bundle
     *
     * Bundle every master dropdown the Add Customer / Add Consignee modal
     * needs into ONE response. Replaces 9 separate round-trips:
     *   /master/customer_types, /master/segments, /master/customer_classifications,
     *   /master/risk_levels, /master/address_types, /master/countries,
     *   /master/states, /master/designations, /master/document_type
     *
     * Shared between BOTH customer flows — opening Add Customer warms the
     * cache for Add Consignee (and vice versa) since their dropdown
     * needs overlap by 8 of 9 masters. `customer_types` is unused by the
     * consignee modal but is so small (~10 rows) that including it for
     * cache parity costs nothing.
     *
     * Cached server-side via Cache::remember (5-min TTL, per-user). Masters
     * change rarely, so the cache absorbs the bulk of repeat opens. The
     * frontend mirrors this with a sessionStorage cache in
     * customerBundleCache.ts.
     *
     * Status filtering is case-insensitive because clm_segments uses
     * 'active'/'inactive' while master_* tables use 'Active'/'Inactive'.
     * Segments projects `name` (the real column) — the model's `title`
     * accessor surfaces it as `title` in JSON for legacy consumers.
     * ────────────────────────────────────────────────────────────── */
    public function masterBundle(Request $request): JsonResponse
    {
        $user = $request->user();
        $cacheKey = MasterBundleCache::key('customer:master-bundle', $user?->id);

        $bundle = Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user) {
            // Tenant scope — apply MasterVisibility::applyReadScope to every
            // master query, matching the gate /master/{slug} uses. Without
            // this a client_admin of Client A would see Client B's
            // tenant-scoped master rows via the bundle endpoint. Per-user
            // cache key is a second line of defence.
            $scope = fn ($q) => MasterVisibility::applyReadScope($q, $user);

            $active = function (string $modelClass, array $cols) use ($scope) {
                return $modelClass::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->orderBy('id')
                    ->get($cols);
            };

            return [
                'customer_types'           => $active(CustomerTypes::class,           ['id', 'name']),
                'segments'                 => $active(Segments::class,                ['id', 'name']),
                'customer_classifications' => $active(CustomerClassifications::class, ['id', 'name']),
                'risk_levels'              => $active(RiskLevels::class,              ['id', 'name']),
                'address_types'            => $active(AddressTypes::class,            ['id', 'name']),
                'countries'                => $active(Countries::class,               ['id', 'name']),
                'states'                   => $active(States::class,                  ['id', 'name', 'country_id']),
                'designations'             => $active(Designations::class,            ['id', 'name']),
                'document_type'            => $active(DocumentType::class,            ['id', 'title']),
            ];
        });

        return response()->json($bundle);
    }
}