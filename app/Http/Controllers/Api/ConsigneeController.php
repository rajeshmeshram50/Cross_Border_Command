<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Consignee;
use App\Models\ConsigneeAddress;
use App\Models\ConsigneeDocument;
use App\Models\ConsigneeOwner;
use App\Models\Customer;
use App\Support\MasterVisibility;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * Sales Matrix → Consignees.
 *
 * Mirrors CustomerController. The one structural addition is
 * customer_id — every consignee belongs to a customer account
 * (phase A of the Add Consignee modal picks the customer first).
 *
 * Payload contract (POST / PUT):
 *  {
 *    customer_id,
 *    company_name, legal_name, segment, classification, risk_level,
 *    website, status,
 *    primary_address: {
 *       type, address_line, country, state, city, pin,
 *       cp_name, cp_designation, cp_contact, cp_email, cp_whatsapp
 *    },
 *    locations: [ same shape ... ]
 *  }
 *
 *  primary_email mirrors primary_address.cp_email and is unique
 *  within tenant scope (per client_id).
 */
class ConsigneeController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $q = Consignee::query()
            ->forUser($user)
            ->with(['primaryAddress', 'addresses', 'customer'])
            ->orderByDesc('id');

        if ($search = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('company_name',   'ilike', "%{$search}%")
                  ->orWhere('legal_name',   'ilike', "%{$search}%")
                  ->orWhere('consignee_code','ilike', "%{$search}%")
                  ->orWhere('primary_email','ilike', "%{$search}%")
                  ->orWhere('segment',      'ilike', "%{$search}%");
            });
        }

        if ($customerId = $request->query('customer_id')) {
            $q->where('customer_id', (int) $customerId);
        }

        $rows = $q->get()->map(fn ($c) => $this->shape($c))->all();

        return response()->json([
            'count' => count($rows),
            'data'  => $rows,
        ]);
    }

    public function show(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $row = Consignee::query()
            ->forUser($user)
            ->with(['primaryAddress', 'addresses', 'customer'])
            ->findOrFail($id);

        /* Stage 2 + Stage 3 data embedded inline — mirrors the
         * CustomerController::show() bundle pattern. AddConsigneeModal
         * edit-mode previously fired 4 parallel HTTP requests:
         *   - GET /consignees/{id}
         *   - GET /consignees/{id}/documents
         *   - GET /consignees/{id}/owners
         *   - GET /segment-uploads/consignee/{id}
         *
         * On `php artisan serve` these serialised behind each other,
         * costing 2-5 sec of pure Laravel boot tax. Bundling collapses
         * 4 round-trips into 1 — same proven pattern we used for
         * customer + ClientPermissions.
         *
         * Each delegated controller's index() reuses its own
         * resolveConsignee() which applies the same `forUser` tenant
         * scope, so security stays exactly where it was. Wrapped in
         * try/catch so a single nested controller's failure (e.g.
         * segment_uploads returning 404 on a fresh consignee) does
         * not break the whole response — the key falls back to an
         * empty list.
         */
        $documents = $this->safeDelegate(
            fn () => (new ConsigneeDocumentController())->index($request, $id)
        );
        $owners = $this->safeDelegate(
            fn () => (new ConsigneeOwnerController())->index($request, $id)
        );
        $segmentUploads = $this->safeDelegate(
            fn () => (new SegmentDocUploadController())->index($request, 'consignee', $id)
        );

        /* Bundle the parent customer's non-primary addresses ("locations")
         * so AddConsigneeModal's same-as-customer effect can skip its own
         * GET /customers/{customer_id} round-trip on edit-mode open. The
         * production network panel showed that call costing ~3 sec
         * (cbc.idims.in). Frontend uses a skip-once ref pattern: if this
         * bundled list is present it's consumed, otherwise the existing
         * lazy fetch runs as fallback — preserving every existing flow
         * (toggle off/on, change linked customer, etc.).
         *
         * Shape mirrors CustomerController::shapeAddress() exactly so the
         * frontend's map at line 705 reads identical fields. Wrapped in
         * try/catch so a malformed customer reference cannot break show().
         */
        $customerLocations = [];
        try {
            if ($row->customer_id) {
                $customer = \App\Models\Customer::query()
                    ->forUser($user)
                    ->with('addresses')
                    ->find($row->customer_id);
                if ($customer) {
                    $customerLocations = $customer->addresses
                        ->where('is_primary', false)
                        ->values()
                        ->map(fn ($a) => [
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
                        ])
                        ->all();
                }
            }
        } catch (\Throwable $e) {
            \Log::warning('ConsigneeController::show customer_locations bundle failed: ' . $e->getMessage());
        }

        return response()->json([
            'data'            => $this->shape($row),
            'documents'       => $documents['data'] ?? [],
            'owners'          => $owners['data'] ?? [],
            // segment_uploads keeps its full shape (data + by_category + count)
            // because the frontend reads `data[].category` for per-tab bucketing.
            'segment_uploads' => $segmentUploads ?: ['data' => [], 'by_category' => [], 'count' => 0],
            // Pre-shaped parent customer locations for the same-as-customer
            // mirror. Empty array means "no parent customer or no locations" —
            // the frontend falls through to its existing fetch in that case.
            'customer_locations' => $customerLocations,
        ]);
    }

    /**
     * Run a delegated controller call and unwrap its JSON response,
     * returning `null` on any failure. Used by show() to embed nested
     * resources without letting a single inner failure take down the
     * whole response. Caller decides how to default the missing key.
     */
    private function safeDelegate(\Closure $call): ?array
    {
        try {
            $res = $call();
            $decoded = json_decode($res->getContent(), true);
            return is_array($decoded) ? $decoded : null;
        } catch (\Throwable $e) {
            \Log::warning('ConsigneeController::show safeDelegate failed: ' . $e->getMessage());
            return null;
        }
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        [$clientId, $branchId] = $this->resolveOwnership($user);

        $data = $this->validatePayload($request, null, $clientId);
        $this->assertCustomerInScope($user, (int) $data['customer_id']);
        $this->assertSingleMirrorPerCustomer((int) $data['customer_id'], !empty($data['same_as_customer']), null);

        $row = DB::transaction(function () use ($data, $user, $clientId, $branchId) {
            $primary = $data['primary_address'];

            $consignee = Consignee::create([
                'client_id'      => $clientId,
                'branch_id'      => $branchId,
                'created_by'       => optional($user)->id,
                'customer_id'      => (int) $data['customer_id'],
                'company_name'     => $data['company_name'],
                'legal_name'       => $data['legal_name']     ?? null,
                'segment'          => $data['segment']        ?? null,
                'classification'   => $data['classification'] ?? null,
                'risk_level'       => $data['risk_level']     ?? null,
                'website'          => $data['website']        ?? null,
                'primary_email'    => $primary['cp_email']    ?? null,
                'status'           => $data['status']         ?? 'Active',
                'same_as_customer' => (bool) ($data['same_as_customer'] ?? false),
            ]);

            // Display id — CN-### grows from 001 → 1234 naturally with
            // the row count, no separate sequence table.
            $consignee->consignee_code = 'CN-' . str_pad((string) $consignee->id, 3, '0', STR_PAD_LEFT);
            $consignee->save();

            ConsigneeAddress::create(array_merge($primary, [
                'consignee_id' => $consignee->id,
                'is_primary'   => true,
            ]));

            foreach ($data['locations'] ?? [] as $loc) {
                ConsigneeAddress::create(array_merge($loc, [
                    'consignee_id' => $consignee->id,
                    'is_primary'   => false,
                ]));
            }

            return $consignee->load(['primaryAddress', 'addresses', 'customer']);
        });

        return response()->json(['data' => $this->shape($row)], 201);
    }

    public function update(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $consignee = Consignee::query()->forUser($user)->findOrFail($id);

        if ($denial = MasterVisibility::hierarchicalDenial($user, $consignee, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $this->validatePayload($request, (int) $consignee->id, $consignee->client_id);
        $this->assertCustomerInScope($user, (int) $data['customer_id']);
        // Carry the previous value forward if the payload omits the
        // key so the guard reads the user's *current* intent.
        $intendsMirror = array_key_exists('same_as_customer', $data)
            ? (bool) $data['same_as_customer']
            : (bool) $consignee->same_as_customer;
        $this->assertSingleMirrorPerCustomer((int) $data['customer_id'], $intendsMirror, $consignee->id);

        $row = DB::transaction(function () use ($consignee, $data) {
            $primary = $data['primary_address'];

            $consignee->update([
                'customer_id'      => (int) $data['customer_id'],
                'company_name'     => $data['company_name'],
                'legal_name'       => $data['legal_name']     ?? null,
                'segment'          => $data['segment']        ?? null,
                'classification'   => $data['classification'] ?? null,
                'risk_level'       => $data['risk_level']     ?? null,
                'website'          => $data['website']        ?? null,
                'primary_email'    => $primary['cp_email']    ?? null,
                'status'           => $data['status']         ?? $consignee->status,
                'same_as_customer' => array_key_exists('same_as_customer', $data)
                    ? (bool) $data['same_as_customer']
                    : $consignee->same_as_customer,
            ]);

            // Replace-all on addresses (same simple strategy as
            // CustomerController). Cascade keeps it safe — no hard FK
            // dependents yet.
            ConsigneeAddress::where('consignee_id', $consignee->id)->delete();
            ConsigneeAddress::create(array_merge($primary, [
                'consignee_id' => $consignee->id,
                'is_primary'   => true,
            ]));
            foreach ($data['locations'] ?? [] as $loc) {
                ConsigneeAddress::create(array_merge($loc, [
                    'consignee_id' => $consignee->id,
                    'is_primary'   => false,
                ]));
            }

            return $consignee->load(['primaryAddress', 'addresses', 'customer']);
        });

        return response()->json(['data' => $this->shape($row)]);
    }

    public function destroy(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $consignee = Consignee::query()->forUser($user)->findOrFail($id);

        if ($denial = MasterVisibility::hierarchicalDenial($user, $consignee, 'delete')) {
            return response()->json(['message' => $denial], 403);
        }

        $consignee->delete();
        return response()->json(['id' => $consignee->id, 'deleted' => true]);
    }

    /**
     * "Same as Customer" deep-clone. Copies the linked customer's Stage 2
     * KYC documents (Company DD + Trade Licence) and Owner KYC rows onto
     * this consignee — including their file attachments via
     * Storage::copy(). The consignee's *additional addresses* are already
     * carried in the consignee POST/PUT payload, so this endpoint only
     * handles the children that live in separate tables.
     *
     * Replace semantics: each call wipes the consignee's existing KYC
     * (rows + on-disk files) and re-clones fresh from the customer. This
     * keeps "Same as Customer" semantically truthful — re-ticking and
     * re-saving always produces an exact mirror, even if the customer's
     * KYC was edited after the consignee was first created. Manual edits
     * on the consignee side are intentionally overwritten; the user
     * opted into that by re-ticking the box.
     *
     * Tenant scope: both ends are checked. Customer must be visible to
     * the caller via Customer::forUser($user), same as the
     * cross-tenant guard used by store/update.
     *
     * Route: POST /api/consignees/{id}/clone-from-customer
     * Body:  { "customer_id": <int> }
     */
    public function cloneFromCustomer(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $consignee = Consignee::query()
            ->with(['documents', 'owners'])
            ->forUser($user)
            ->findOrFail($id);

        $data = $request->validate([
            'customer_id' => 'required|integer|exists:customers,id',
        ]);

        $customer = Customer::query()
            ->forUser($user)
            ->with(['documents', 'owners'])
            ->findOrFail($data['customer_id']);

        $copied = ['documents' => 0, 'owners' => 0];

        DB::transaction(function () use ($consignee, $customer, $user, &$copied) {
            $disk = Storage::disk('public');

            // ── Wipe existing KYC (replace semantics) ───────────────
            // Delete on-disk files first (best-effort), then the rows.
            // cascadeOnDelete from consignee → docs/owners protects us
            // if anything's left dangling, but explicit deletion is
            // safer here so we don't accidentally orphan a file.
            foreach ($consignee->documents as $d) {
                if ($d->attachment_path) $disk->delete($d->attachment_path);
            }
            foreach ($consignee->owners as $o) {
                foreach (['id_proof_path', 'address_proof_path', 'photograph_path'] as $f) {
                    if ($o->{$f}) $disk->delete($o->{$f});
                }
            }
            $consignee->documents()->delete();
            $consignee->owners()->delete();

            // ── Documents ─────────────────────────────────────────────
            foreach ($customer->documents as $doc) {
                $newPath = null;
                if ($doc->attachment_path && $disk->exists($doc->attachment_path)) {
                    $ext = pathinfo($doc->attachment_path, PATHINFO_EXTENSION) ?: 'bin';
                    $newPath = "consignee_documents/{$consignee->id}/cloned-" . bin2hex(random_bytes(6)) . ".{$ext}";
                    $disk->copy($doc->attachment_path, $newPath);
                }
                ConsigneeDocument::create([
                    'consignee_id'      => $consignee->id,
                    'kind'              => $doc->kind,
                    'name'              => $doc->name,
                    'license_number'    => $doc->license_number,
                    'issuing_authority' => $doc->issuing_authority,
                    'issue_date'        => $doc->issue_date,
                    'expiry_date'       => $doc->expiry_date,
                    'attachment_path'   => $newPath,
                    'description'       => $doc->description,
                    'status'            => $doc->status ?? 'Active',
                    'created_by'        => optional($user)->id,
                ]);
                $copied['documents']++;
            }

            // ── Owners (three file slots each) ────────────────────────
            $fileSlots = ['id_proof_path', 'address_proof_path', 'photograph_path'];
            foreach ($customer->owners as $owner) {
                $copies = [];
                foreach ($fileSlots as $slot) {
                    $copies[$slot] = null;
                    if ($owner->{$slot} && $disk->exists($owner->{$slot})) {
                        $ext = pathinfo($owner->{$slot}, PATHINFO_EXTENSION) ?: 'bin';
                        // Reuse the slot name (id_proof/address_proof/photograph)
                        // in the cloned filename so debugging on-disk stays readable.
                        $slotLabel = str_replace('_path', '', $slot);
                        $newPath = "consignee_documents/{$consignee->id}/owner-clone-{$slotLabel}-" . bin2hex(random_bytes(6)) . ".{$ext}";
                        $disk->copy($owner->{$slot}, $newPath);
                        $copies[$slot] = $newPath;
                    }
                }
                ConsigneeOwner::create([
                    'consignee_id'       => $consignee->id,
                    'owner_name'         => $owner->owner_name,
                    'designation'        => $owner->designation,
                    'official_email'     => $owner->official_email,
                    'phone_number'       => $owner->phone_number,
                    'id_proof_path'      => $copies['id_proof_path'],
                    'address_proof_path' => $copies['address_proof_path'],
                    'photograph_path'    => $copies['photograph_path'],
                    'status'             => $owner->status ?? 'Active',
                    'created_by'         => optional($user)->id,
                ]);
                $copied['owners']++;
            }
        });

        return response()->json([
            'ok'      => true,
            'cloned'  => $copied,
        ]);
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    /**
     * Reshape a Consignee + addresses + linked customer into the
     * frontend contract. The Add Consignee modal's edit hydration and
     * the SalesConsignee list both read these keys.
     */
    private function shape(Consignee $c): array
    {
        $primary = $c->primaryAddress;
        return [
            'id'              => $c->consignee_code ?: ('CN-' . str_pad((string) $c->id, 3, '0', STR_PAD_LEFT)),
            'db_id'           => $c->id,
            'customer_id'     => $c->customer_id,
            'customer_code'   => $c->customer?->customer_code,
            'customer_name'   => $c->customer?->company_name,
            'company'         => $c->company_name,
            'legalName'       => $c->legal_name,
            'segment'         => $c->segment,
            'classification'  => $c->classification,
            'riskLevel'       => $c->risk_level,
            'website'         => $c->website,
            'status'          => $c->status,
            'country'         => $primary?->country,
            'countryDetail'   => trim(implode(', ', array_filter([$primary?->city, $primary?->state, $primary?->country]))),
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
            'same_as_customer' => (bool) $c->same_as_customer,
            'risk'            => $c->risk_level,
            'locations'       => $c->addresses
                ->where('is_primary', false)
                ->values()
                ->map(fn ($a) => $this->shapeAddress($a))
                ->all(),
            'primary_address' => $primary ? $this->shapeAddress($primary) : null,
        ];
    }

    private function shapeAddress(ConsigneeAddress $a): array
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
     * Validate the POST / PUT body. Returns the validated array
     * (nested primary_address + locations preserved).
     *
     * primary_email and primary phone uniqueness is per-tenant within
     * the consignees table, ignoring the row being edited. The
     * Same-as-Customer flow is exempt because it deliberately copies
     * the customer's contact details onto the consignee — a unique
     * rule would block that intended flow.
     */
    private function validatePayload(Request $request, ?int $consigneeId = null, $clientId = null): array
    {
        $sameAsCustomer = (bool) $request->input('same_as_customer', false);

        $rules = [
            'customer_id'      => 'required|integer|exists:customers,id',
            'company_name'     => 'required|string|max:255',
            /* Legal (registered entity) name must be unique per tenant — two
             * consignees can't share the same legal name. Case-insensitive,
             * client-scoped, ignores the row being edited, and skips the
             * check when blank (legal_name stays optional). Mirrors the
             * uniqueness rule on customers.legal_name. */
            'legal_name'       => [
                'nullable', 'string', 'max:255',
                function ($attribute, $value, $fail) use ($clientId, $consigneeId) {
                    if (!trim((string) $value)) return;
                    $exists = Consignee::query()
                        ->whereNull('deleted_at')
                        ->where(function ($q) use ($clientId) {
                            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                        })
                        ->whereRaw('LOWER(legal_name) = ?', [mb_strtolower(trim((string) $value))])
                        ->when($consigneeId, fn ($q) => $q->where('id', '!=', $consigneeId))
                        ->exists();
                    if ($exists) {
                        $fail('This legal name is already used by another consignee.');
                    }
                },
            ],
            'segment'          => 'nullable|string|max:1024',
            'classification'   => 'nullable|string|max:64',
            'risk_level'       => 'nullable|string|max:32',
            'website'          => 'nullable|string|max:500',
            'status'           => 'nullable|in:Active,Inactive',
            // Marks consignees created via the "Same as Customer"
            // toggle. Powers the warning popup on Edit Customer.
            'same_as_customer' => 'sometimes|boolean',

            'primary_address'                => 'required|array',
            'primary_address.type'           => 'required|string|max:64',
            'primary_address.address_line'   => 'required|string|min:4|max:1000',
            'primary_address.country'        => 'nullable|string|max:64',
            'primary_address.state'          => 'nullable|string|max:64',
            'primary_address.city'           => 'nullable|string|max:64',
            // PIN must be exactly 6 digits (Indian postal code format).
            'primary_address.pin'            => ['nullable', 'string', 'regex:/^\d{6}$/'],
            'primary_address.cp_name'        => 'required|string|max:255',
            'primary_address.cp_designation' => 'nullable|string|max:128',
            'primary_address.cp_whatsapp'    => 'nullable|in:yes,no',

            'locations'                  => 'sometimes|array',
            'locations.*.type'           => 'required_with:locations|string|max:64',
            'locations.*.address_line'   => 'required_with:locations|string|min:4|max:1000',
            'locations.*.country'        => 'nullable|string|max:64',
            'locations.*.state'          => 'nullable|string|max:64',
            'locations.*.city'           => 'nullable|string|max:64',
            'locations.*.pin'            => ['nullable', 'string', 'regex:/^\d{6}$/'],
            'locations.*.cp_name'        => 'required_with:locations|string|max:255',
            'locations.*.cp_designation' => 'nullable|string|max:128',
            'locations.*.cp_contact'     => ['nullable', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/'],
            // Strict email format — username@domain.extension. Domain is
            // letters-only (no digits) so junk like "x@gmail12.com" is
            // rejected. Frontend uses the same regex for inline feedback.
            'locations.*.cp_email'       => ['nullable', 'email', 'max:255', 'regex:/^[A-Za-z0-9._%+-]+@(?:[A-Za-z]+\.)+[A-Za-z]{2,}$/'],
            'locations.*.cp_whatsapp'    => 'nullable|in:yes,no',
        ];

        /* Cross-consignee uniqueness on the primary contact's phone +
         * email — mirrors CustomerController so two consignees in the
         * same tenant can't claim the same primary contact. Skipped
         * when same_as_customer is on because that flow deliberately
         * copies the customer's contact details onto the consignee. */
        if (!$sameAsCustomer) {
            $rules['primary_address.cp_email'] = [
                'required', 'email', 'max:255',
                'regex:/^[A-Za-z0-9._%+-]+@(?:[A-Za-z]+\.)+[A-Za-z]{2,}$/',
                Rule::unique('consignees', 'primary_email')
                    ->where(function ($q) use ($clientId) {
                        $q->whereNull('deleted_at');
                        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                    })
                    ->ignore($consigneeId),
            ];
            $rules['primary_address.cp_contact'] = [
                'required', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/',
                function ($attribute, $value, $fail) use ($clientId, $consigneeId) {
                    if (!trim((string) $value)) return;
                    $exists = ConsigneeAddress::query()
                        ->where('cp_contact', $value)
                        ->where('is_primary', true)
                        ->whereHas('consignee', function ($q) use ($clientId, $consigneeId) {
                            $q->whereNull('deleted_at');
                            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                            if ($consigneeId) $q->where('id', '!=', $consigneeId);
                        })
                        ->exists();
                    if ($exists) {
                        $fail('This phone number is already used by another consignee.');
                    }
                },
            ];
        } else {
            // Mirror flow — keep the format / required rules but skip
            // the cross-consignee uniqueness check.
            $rules['primary_address.cp_email']   = ['required', 'email', 'max:255', 'regex:/^[A-Za-z0-9._%+-]+@(?:[A-Za-z]+\.)+[A-Za-z]{2,}$/'];
            $rules['primary_address.cp_contact'] = ['nullable', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/'];
        }

        $data = $request->validate($rules);

        /* Cross-row uniqueness within the payload. A single consignee
         * can't have two addresses sharing the same primary contact
         * (the address book would point to one human under two
         * different roof-tops). Cross-consignee sharing is still
         * allowed — see the comment on primary_address.cp_email above
         * for why ("Same as Customer" copies the customer's email).
         * Errors are keyed by `locations.{i}.cp_email` / `cp_contact`
         * so the frontend's 422 mapper lands them on the right field. */
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
                $errors["locations.{$i}.cp_email"]   = ['This email is already used by another address on this consignee.'];
            }
            if ($phone && isset($seenPhones[$phone])) {
                $errors["locations.{$i}.cp_contact"] = ['This phone number is already used by another address on this consignee.'];
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
     * Ensure the customer the consignee is being attached to is
     * visible under the caller's tenant scope. Without this a tenant
     * could create a consignee under another tenant's customer just
     * by passing its id.
     */
    /**
     * Block cross-tenant linkage — without this check a caller could
     * create a consignee under a customer they're not entitled to
     * see, just by knowing/guessing the customer_id. Reuses the
     * shared Customer::forUser() scope so this stays in lockstep
     * with the customer index visibility.
     */
    private function assertCustomerInScope($user, int $customerId): void
    {
        $exists = Customer::query()
            ->forUser($user)
            ->whereKey($customerId)
            ->exists();
        if (!$exists) abort(404, 'Customer not found');
    }

    /**
     * Business rule: a customer can have *at most one* same-as-customer
     * consignee, but unlimited regular consignees. This guard runs on
     * store() and update() whenever the caller intends to set
     * `same_as_customer = true`. Excludes $ignoreConsigneeId from the
     * count so editing the existing mirror doesn't fail on itself.
     */
    private function assertSingleMirrorPerCustomer(int $customerId, bool $intendsMirror, ?int $ignoreConsigneeId): void
    {
        if (!$intendsMirror) return;
        $q = Consignee::query()
            ->where('customer_id', $customerId)
            ->where('same_as_customer', true);
        if ($ignoreConsigneeId !== null) $q->where('id', '!=', $ignoreConsigneeId);
        if ($q->exists()) {
            // 422 keeps it on the field-validation path so the frontend's
            // existing 422 → inline-error mapper picks it up uniformly.
            abort(response()->json([
                'message' => 'Only one same-as-customer consignee is allowed per customer.',
                'errors'  => [
                    'same_as_customer' => ['This customer already has a same-as-customer consignee. Untick the toggle or pick a different customer.'],
                ],
            ], 422));
        }
    }

    /**
     * Resolve `[client_id, branch_id]` for the row being inserted.
     * Only used by store() — tenant *visibility* is handled by the
     * Consignee::scopeForUser() Eloquent scope.
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
