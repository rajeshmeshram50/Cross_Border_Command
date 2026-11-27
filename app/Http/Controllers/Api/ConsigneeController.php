<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Consignee;
use App\Models\ConsigneeAddress;
use App\Models\ConsigneeDocument;
use App\Models\ConsigneeOwner;
use App\Models\Customer;
use App\Support\Gst;
use App\Support\MasterVisibility;
use App\Support\PostalCode;
use App\Support\SegmentGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class ConsigneeController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($request->boolean('light')) {
            $rows = Consignee::query()
                ->forUser($user, $request->integer('branch_id') ?: null)
                ->with(['primaryAddress:id,consignee_id,is_primary,country,cp_contact,cp_email'])
                ->orderByDesc('id')
                ->get(['id', 'consignee_code', 'company_name', 'same_as_customer'])
                ->map(fn (Consignee $c) => [
                    'id'               => $c->consignee_code ?: ('CN-' . str_pad((string) $c->id, 3, '0', STR_PAD_LEFT)),
                    'db_id'            => $c->id,
                    'company'          => $c->company_name,
                    'country'          => $c->primaryAddress?->country,
                    'phone'            => $c->primaryAddress?->cp_contact,
                    'email'            => $c->primaryAddress?->cp_email,
                    'same_as_customer' => (bool) $c->same_as_customer,
                ])
                ->all();

            return response()->json(['count' => count($rows), 'data' => $rows]);
        }

        $q = Consignee::query()
            ->forUser($user, $request->integer('branch_id') ?: null)
            ->with(['primaryAddress', 'addresses', 'customer', 'customers.primaryAddress'])
            ->orderByDesc('id');

        if ($search = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('company_name',   'ilike', "%{$search}%")
                    ->orWhere('legal_name',   'ilike', "%{$search}%")
                    ->orWhere('consignee_code', 'ilike', "%{$search}%")
                    ->orWhere('primary_email', 'ilike', "%{$search}%")
                    ->orWhere('segment',      'ilike', "%{$search}%");
            });
        }

        if ($customerId = $request->query('customer_id')) {
            $q->whereHas('customers', fn($w) => $w->whereKey((int) $customerId));
        }

        $rows = $q->get()->map(fn($c) => $this->shape($c))->all();

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
            ->with(['primaryAddress', 'addresses', 'customer', 'customers.primaryAddress'])
            ->findOrFail($id);

        $documents = $this->safeDelegate(
            fn() => (new ConsigneeDocumentController())->index($request, $id)
        );
        $owners = $this->safeDelegate(
            fn() => (new ConsigneeOwnerController())->index($request, $id)
        );
        $segmentUploads = $this->safeDelegate(
            fn() => (new SegmentDocUploadController())->index($request, 'consignee', $id)
        );

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
                        ->map(fn($a) => [
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

        $data = $this->shape($row);
        $data['locked_segments'] = array_values(array_unique(array_merge(
            SegmentGuard::lockedSegmentNames(
                \App\Models\Consignee::class,
                (int) $row->id,
                (int) $row->client_id,
            ),
            SegmentGuard::productMappingSegmentNames(
                \App\Models\Consignee::class,
                (int) $row->id,
                (int) $row->client_id,
            ),
        )));

        return response()->json([
            'data'            => $data,
            'documents'       => $documents['data'] ?? [],
            'owners'          => $owners['data'] ?? [],
            'segment_uploads' => $segmentUploads ?: ['data' => [], 'by_category' => [], 'count' => 0],
            'customer_locations' => $customerLocations,
        ]);
    }

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
        foreach ($data['customer_ids'] as $cid) {
            $this->assertCustomerInScope($user, (int) $cid);
        }
        $this->assertSingleMirrorPerCustomer((int) $data['customer_id'], !empty($data['same_as_customer']), null);
        $this->assertCountryCompatible($data['primary_address']['country'] ?? null, $data['customer_ids']);
        $this->assertContactEmailNotCustomers(
            $data['primary_address']['cp_email'] ?? null,
            !empty($data['same_as_customer']),
            $data['customer_ids'],
        );

        $row = DB::transaction(function () use ($data, $user, $clientId, $branchId) {
            $primary = $data['primary_address'];

            if ($clientId !== null) {
                DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
            }
            $code = $this->nextConsigneeCode($clientId, $branchId);

            $consignee = Consignee::create([
                'client_id'      => $clientId,
                'branch_id'      => $branchId,
                'created_by'       => optional($user)->id,
                'customer_id'      => (int) $data['customer_id'],
                'consignee_code'   => $code,
                'company_name'     => $data['company_name'],
                'legal_name'       => $data['legal_name']     ?? null,
                'segment'          => SegmentGuard::forCustomers($data['customer_ids']) ?: null,
                'segment_ids'      => SegmentGuard::idsForCustomers($data['customer_ids']) ?: null,
                'classification'   => $data['classification'] ?? null,
                'risk_level'       => $data['risk_level']     ?? null,
                'website'          => $data['website']        ?? null,
                'primary_email'    => $primary['cp_email']    ?? null,
                'status'           => $data['status']         ?? 'Active',
                'same_as_customer' => (bool) ($data['same_as_customer'] ?? false),
            ]);

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

            $consignee->customers()->sync($data['customer_ids']);

            return $consignee->load(['primaryAddress', 'addresses', 'customer', 'customers.primaryAddress']);
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
        foreach ($data['customer_ids'] as $cid) {
            $this->assertCustomerInScope($user, (int) $cid);
        }
        $this->assertCountryCompatible($data['primary_address']['country'] ?? null, $data['customer_ids']);
        $intendsMirror = array_key_exists('same_as_customer', $data)
            ? (bool) $data['same_as_customer']
            : (bool) $consignee->same_as_customer;
        $this->assertSingleMirrorPerCustomer((int) $data['customer_id'], $intendsMirror, $consignee->id);
        $this->assertContactEmailNotCustomers(
            $data['primary_address']['cp_email'] ?? null,
            $intendsMirror,
            $data['customer_ids'],
        );

        $derivedSegment = SegmentGuard::forCustomers($data['customer_ids']);

        $oldSegment = $consignee->segment;
        $removed    = SegmentGuard::removedNames($oldSegment, $derivedSegment ?: null);

        $keep = array_values(array_unique(array_merge(
            SegmentGuard::blockedByProductMapping(
                \App\Models\Consignee::class, (int) $consignee->id, (int) $consignee->client_id, $removed,
            ),
            SegmentGuard::blockedByCompletedDocs(
                \App\Models\Consignee::class, (int) $consignee->id, (int) $consignee->client_id, $removed,
            ),
            SegmentGuard::blockedByOrphanDocs(
                \App\Models\Consignee::class, (int) $consignee->id, (int) $consignee->client_id, $removed, SegmentGuard::names($derivedSegment ?: null),
            ),
        )));
        if (!empty($keep)) {
            $derivedSegment = SegmentGuard::mergeRetained($derivedSegment, $keep);
        }
        $derivedIds = SegmentGuard::consigneeIds($data['customer_ids'], $keep, $consignee);

        $row = DB::transaction(function () use ($consignee, $data, $derivedSegment, $derivedIds) {
            $primary = $data['primary_address'];

            $consignee->update([
                'customer_id'      => (int) $data['customer_id'],
                'company_name'     => $data['company_name'],
                'legal_name'       => $data['legal_name']     ?? null,
                'segment'          => $derivedSegment ?: null,
                'segment_ids'      => $derivedIds ?: null,
                'classification'   => $data['classification'] ?? null,
                'risk_level'       => $data['risk_level']     ?? null,
                'website'          => $data['website']        ?? null,
                'primary_email'    => $primary['cp_email']    ?? null,
                'status'           => $data['status']         ?? $consignee->status,
                'same_as_customer' => array_key_exists('same_as_customer', $data)
                    ? (bool) $data['same_as_customer']
                    : $consignee->same_as_customer,
            ]);

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

            $consignee->customers()->sync($data['customer_ids']);

            return $consignee->load(['primaryAddress', 'addresses', 'customer', 'customers.primaryAddress']);
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

            $fileSlots = ['id_proof_path', 'address_proof_path', 'photograph_path'];
            foreach ($customer->owners as $owner) {
                $copies = [];
                foreach ($fileSlots as $slot) {
                    $copies[$slot] = null;
                    if ($owner->{$slot} && $disk->exists($owner->{$slot})) {
                        $ext = pathinfo($owner->{$slot}, PATHINFO_EXTENSION) ?: 'bin';
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

    public function mapCustomer(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $consignee = Consignee::query()->forUser($user)->findOrFail($id);

        if ($denial = MasterVisibility::hierarchicalDenial($user, $consignee, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
            'customer_id' => 'required|integer|exists:customers,id',
        ]);
        $this->assertCustomerInScope($user, (int) $data['customer_id']);

        $customer = Customer::query()->forUser($user)->findOrFail($data['customer_id']);

        $this->assertCountryCompatible(
            optional($consignee->primaryAddress)->country,
            [(int) $customer->id],
        );

        if ($consignee->customers()->whereKey($customer->id)->exists()) {
            return response()->json([
                'message' => "“{$customer->company_name}” is already mapped to this consignee.",
                'errors'  => ['customer_id' => ['This customer is already mapped to this consignee.']],
            ], 422);
        }

        DB::transaction(function () use ($consignee, $customer) {
            $consignee->customers()->syncWithoutDetaching([$customer->id]);

            $derived = SegmentGuard::forCustomers(
                $consignee->customers()->pluck('customers.id')->all()
            );
            $derivedIds = SegmentGuard::idsForCustomers($consignee->customers()->pluck('customers.id')->all());
            if ($derived !== (string) $consignee->segment || $derivedIds !== SegmentGuard::ids($consignee->segment_ids ?? [])) {
                $consignee->update(['segment' => $derived ?: null, 'segment_ids' => $derivedIds ?: null]);
            }
        });

        $consignee->load(['primaryAddress', 'addresses', 'customer', 'customers.primaryAddress']);
        return response()->json(['data' => $this->shape($consignee)]);
    }

    private function shape(Consignee $c): array
    {
        $primary = $c->primaryAddress;
        $mapped = $c->relationLoaded('customers')
            ? $c->customers->map(function ($m) {
                $pa = $m->relationLoaded('primaryAddress') ? $m->primaryAddress : null;
                return [
                    'id'      => $m->id,
                    'code'    => $m->customer_code,
                    'name'    => $m->company_name,
                    'segment' => $m->segment,
                    'segments' => SegmentGuard::rowsFor(SegmentGuard::idsOf($m)),
                    'type'    => $m->type,
                    'risk'    => $m->risk_level,
                    'status'  => $m->status,
                    'country' => $pa?->country,
                    'city'    => $pa?->city,
                    'contact' => $pa?->cp_name,
                    'email'   => $pa?->cp_email,
                    'phone'   => $pa?->cp_contact,
                ];
            })->values()->all()
            : [];
        return [
            'id'              => $c->consignee_code ?: ('CN-' . str_pad((string) $c->id, 3, '0', STR_PAD_LEFT)),
            'db_id'           => $c->id,
            'customer_id'     => $c->customer_id,
            'customer_code'   => $c->customer?->customer_code,
            'customer_name'   => $c->customer?->company_name,
            'customer_ids'    => array_map(fn($m) => $m['id'], $mapped),
            'customers'       => $mapped,
            'company'         => $c->company_name,
            'legalName'       => $c->legal_name,
            'segment'         => $c->segment,
            'segment_ids'     => SegmentGuard::idsOf($c),
            'segments'        => SegmentGuard::rowsFor(SegmentGuard::idsOf($c)),
            'classification'  => $c->classification,
            'riskLevel'       => $c->risk_level,
            'website'         => $c->website,
            'status'          => $c->status,
            'country'         => $primary?->country,
            'country_iso'     => \App\Models\Masters\Countries::isoFor($primary?->country),
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
                ->map(fn($a) => $this->shapeAddress($a))
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

    private function validatePayload(Request $request, ?int $consigneeId = null, $clientId = null, $branchId = null): array
    {
        $sameAsCustomer = (bool) $request->input('same_as_customer', false);

        $incomingIds = $request->input('customer_ids');
        if ((!is_array($incomingIds) || count($incomingIds) === 0) && $request->filled('customer_id')) {
            $request->merge(['customer_ids' => [$request->input('customer_id')]]);
        }

        $rules = [
            'customer_ids'     => 'required|array|min:1',
            'customer_ids.*'   => 'integer|exists:customers,id',
            'company_name'     => 'required|string|max:255',
            'legal_name'       => 'nullable|string|max:255',
            'segment'          => 'nullable|string|max:1024',
            'classification'   => 'nullable|string|max:64',
            'risk_level'       => 'nullable|string|max:32',
            'website'          => 'nullable|string|max:500',
            'status'           => 'nullable|in:Active,Inactive',
            'same_as_customer' => 'sometimes|boolean',

            'primary_address'                => 'required|array',
            'primary_address.type'           => 'required|string|max:64',
            'primary_address.address_line'   => 'required|string|min:4|max:75',
            'primary_address.country'        => 'nullable|string|max:64',
            'primary_address.state'          => 'nullable|string|max:64',
            'primary_address.city'           => 'nullable|string|max:64',
            'primary_address.pin'            => [
                'nullable', 'string',
                PostalCode::rule(fn () => $request->input('primary_address.country')),
            ],
            'primary_address.cp_name'        => 'required|string|max:255',
            'primary_address.cp_designation' => 'nullable|string|max:128',
            'primary_address.cp_whatsapp'    => 'nullable|in:yes,no',

            'locations'                  => 'sometimes|array',
            'locations.*.type'           => 'required_with:locations|string|max:64',
            'locations.*.address_line'   => 'required_with:locations|string|min:4|max:75',
            'locations.*.country'        => 'nullable|string|max:64',
            'locations.*.state'          => 'nullable|string|max:64',
            'locations.*.city'           => 'nullable|string|max:64',
            'locations.*.pin'            => ['nullable', 'string', PostalCode::locationRule($request->all())],
            'locations.*.cp_name'        => 'required_with:locations|string|max:255',
            'locations.*.cp_designation' => 'nullable|string|max:128',
            'locations.*.cp_contact'     => ['nullable', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/'],
            'locations.*.cp_email'       => ['nullable', 'email', 'max:255', 'regex:/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/'],
            'locations.*.cp_whatsapp'    => 'nullable|in:yes,no',
        ];

        if (!$sameAsCustomer) {
            $rules['legal_name'] = [
                'nullable',
                'string',
                'max:255',
                function ($attribute, $value, $fail) use ($clientId, $consigneeId, $branchId) {
                    if (!trim((string) $value)) return;
                    $exists = Consignee::query()
                        ->whereNull('deleted_at')
                        ->where(function ($q) use ($clientId) {
                            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                        })
                        ->where(function ($q) use ($branchId) {
                            $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
                        })
                        ->whereRaw('LOWER(legal_name) = ?', [mb_strtolower(trim((string) $value))])
                        ->when($consigneeId, fn($q) => $q->where('id', '!=', $consigneeId))
                        ->exists();
                    if ($exists) {
                        $fail('This legal name is already used by another consignee in this branch.');
                    }
                },
            ];
            $rules['primary_address.cp_email'] = [
                'required',
                'email',
                'max:255',
                'regex:/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/',
                Rule::unique('consignees', 'primary_email')
                    ->where(function ($q) use ($clientId, $branchId) {
                        $q->whereNull('deleted_at');
                        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
                    })
                    ->ignore($consigneeId),
            ];
            $rules['primary_address.cp_contact'] = [
                'required',
                'string',
                'regex:/^\+?[0-9\s-]{7,15}$/',
                function ($attribute, $value, $fail) use ($clientId, $consigneeId, $branchId) {
                    if (!trim((string) $value)) return;
                    $exists = ConsigneeAddress::query()
                        ->where('cp_contact', $value)
                        ->where('is_primary', true)
                        ->whereHas('consignee', function ($q) use ($clientId, $consigneeId, $branchId) {
                            $q->whereNull('deleted_at');
                            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                            $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
                            if ($consigneeId) $q->where('id', '!=', $consigneeId);
                        })
                        ->exists();
                    if ($exists) {
                        $fail('This phone number is already used by another consignee in this branch.');
                    }
                },
            ];
        } else {
            $rules['primary_address.cp_email']   = ['required', 'email', 'max:255', 'regex:/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/'];
            $rules['primary_address.cp_contact'] = ['nullable', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/'];
        }

        $data = $request->validate($rules);

        $data['customer_ids'] = array_values(array_unique(array_map('intval', $data['customer_ids'])));
        $data['customer_id']  = $data['customer_ids'][0];

        if ($sameAsCustomer && count($data['customer_ids']) > 1) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'same_as_customer' => ['“Same as Customer” can only be used when the consignee is mapped to a single customer.'],
            ]);
        }

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

    private function assertCustomerInScope($user, int $customerId): void
    {
        $exists = Customer::query()
            ->forUser($user)
            ->whereKey($customerId)
            ->exists();
        if (!$exists) abort(404, 'Customer not found');
    }

    private function assertCountryCompatible(?string $consigneeCountry, array $customerIds): void
    {
        $ids = array_values(array_filter(array_map('intval', $customerIds)));
        if (empty($ids)) return;

        $consigneeDomestic = Gst::isDomestic($consigneeCountry);

        $customers = Customer::query()
            ->whereIn('id', $ids)
            ->with('primaryAddress:id,customer_id,country')
            ->get(['id', 'company_name']);

        $bad = [];
        foreach ($customers as $c) {
            $cCountry = optional($c->primaryAddress)->country;
            if (Gst::isDomestic($cCountry) !== $consigneeDomestic) {
                $bad[] = $c->company_name . ' (' . (trim((string) $cCountry) ?: 'no country') . ')';
            }
        }

        if (!empty($bad)) {
            $side = $consigneeDomestic ? 'in India' : 'outside India';
            abort(response()->json([
                'message' => 'This consignee is in ' . ($consigneeDomestic ? 'India' : (trim((string) $consigneeCountry) ?: 'no country'))
                    . ', so it can only be mapped to customers ' . $side . '. Not allowed: ' . implode(', ', $bad) . '.',
                'errors'  => ['customer_ids' => ['Customer and consignee must both be in India, or both outside it.']],
            ], 422));
        }
    }

    private function assertSingleMirrorPerCustomer(int $customerId, bool $intendsMirror, ?int $ignoreConsigneeId): void
    {
        if (!$intendsMirror) return;
        $q = Consignee::query()
            ->where('customer_id', $customerId)
            ->where('same_as_customer', true);
        if ($ignoreConsigneeId !== null) $q->where('id', '!=', $ignoreConsigneeId);
        if ($q->exists()) {
            abort(response()->json([
                'message' => 'Only one same-as-customer consignee is allowed per customer.',
                'errors'  => [
                    'same_as_customer' => ['This customer already has a same-as-customer consignee. Untick the toggle or pick a different customer.'],
                ],
            ], 422));
        }
    }

    private function assertContactEmailNotCustomers(?string $cpEmail, bool $isMirror, array $customerIds): void
    {
        if ($isMirror) return;
        $email = mb_strtolower(trim((string) $cpEmail));
        if ($email === '') return;

        $ids = array_values(array_filter(array_map('intval', $customerIds)));
        if (empty($ids)) return;

        $clash = Customer::query()
            ->whereIn('customers.id', $ids)
            ->whereHas('addresses', fn ($q) => $q->whereRaw('LOWER(cp_email) = ?', [$email]))
            ->pluck('company_name')
            ->all();

        if (!empty($clash)) {
            abort(response()->json([
                'message' => 'This contact person email is already used by ' . implode(', ', $clash)
                    . '. A consignee that is not the same as the customer needs its own contact email,'
                    . ' or tick "Same as customer".',
                'errors'  => [
                    'primary_address.cp_email' => ['Already used by the mapped customer. Use a different email, or tick "Same as customer".'],
                ],
            ], 422));
        }
    }

    private function resolveOwnership($user): array
    {
        if (!$user) return [null, null];
        if ($user->user_type === 'super_admin') return [null, null];
        $clientId = $user->client_id ?? ($user->branch?->client_id);
        $branchId = $user->branch_id;
        return [$clientId, $branchId];
    }

    private function nextConsigneeCode($clientId, $branchId = null): string
    {
        $codes = Consignee::withTrashed()
            ->when(
                $clientId === null,
                fn($q) => $q->whereNull('client_id'),
                fn($q) => $q->where('client_id', $clientId)
            )
            ->when(
                $branchId === null,
                fn($q) => $q->whereNull('branch_id'),
                fn($q) => $q->where('branch_id', $branchId)
            )
            ->pluck('consignee_code');

        $max = 0;
        foreach ($codes as $c) {
            if (preg_match('/^CN-0*(\d+)$/', (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $max) $max = $n;
            }
        }

        return 'CN-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }
}
