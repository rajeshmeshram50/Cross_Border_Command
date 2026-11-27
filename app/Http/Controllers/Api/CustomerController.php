<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\CustomerAddress;
use App\Models\CustomerGstScrutiny;
use App\Models\Masters\AddressTypes;
use App\Models\Masters\Countries;
use App\Models\Masters\CustomerClassifications;
use App\Models\Masters\CustomerTypes;
use App\Models\Masters\Designations;
use App\Models\Masters\DocumentType;
use App\Models\Masters\RiskLevels;
use App\Models\Masters\Segments;
use App\Models\Masters\StateCodes;
use App\Models\Masters\States;
use App\Support\Gst;
use App\Support\MasterBundleCache;
use App\Support\MasterVisibility;
use App\Support\PostalCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class CustomerController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        if ($request->boolean('light')) {
            $user = $request->user();
            $rows = Customer::query()
                ->forUser($user, $request->integer('branch_id') ?: null)
                ->with(['primaryAddress:id,customer_id,is_primary,country,cp_contact,cp_email'])
                ->orderByDesc('id')
                ->get(['id', 'customer_code', 'company_name'])
                ->map(fn(Customer $c) => [
                    'id'      => $c->customer_code ?: ('C-' . str_pad((string) $c->id, 3, '0', STR_PAD_LEFT)),
                    'db_id'   => $c->id,
                    'company' => $c->company_name,
                    'country' => $c->primaryAddress?->country,
                    'phone'   => $c->primaryAddress?->cp_contact,
                    'email'   => $c->primaryAddress?->cp_email,
                ])
                ->all();

            return response()->json(['count' => count($rows), 'data' => $rows]);
        }

        $user = $request->user();

        $q = Customer::query()
            ->forUser($user, $request->integer('branch_id') ?: null)
            ->with(['addresses'])
            ->withCount(['consignees', 'consignees as same_as_customer_consignees_count' => function ($q) {
                $q->where('same_as_customer', true);
            }])
            ->addSelect(['is_recurring' => \DB::table('leads')
                ->selectRaw('1')
                ->whereColumn('leads.customer_id', 'customers.id')
                ->whereNull('leads.deleted_at')
                ->limit(1)])
            ->orderByDesc('id');

        if ($search = trim((string) $request->query('q', ''))) {
            $exact = mb_strtoupper($search);
            $q->where(function ($w) use ($search, $exact) {
                $w->where('customer_code', $exact)
                    ->orWhere('primary_email', 'ilike', $search . '%')
                    ->orWhere('company_name',  'ilike', "%{$search}%")
                    ->orWhere('legal_name',    'ilike', "%{$search}%")
                    ->orWhere('segment',       'ilike', "%{$search}%")
                    ->orWhere('type',          'ilike', "%{$search}%")
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

        $hasLead = function ($w) {
            $w->select(\DB::raw(1))
                ->from('leads')
                ->whereColumn('leads.customer_id', 'customers.id')
                ->whereNull('leads.deleted_at');
        };

        $allCount       = (clone $q)->count();
        $recurringCount = (clone $q)->whereExists($hasLead)->count();
        $tabCounts = [
            'all'       => $allCount,
            'recurring' => $recurringCount,
            'fresh'     => $allCount - $recurringCount,
        ];

        $tab = $request->query('tab', 'fresh');
        if ($tab === 'recurring') {
            $q->whereExists($hasLead);
        } elseif ($tab === 'fresh') {
            $q->whereNotExists($hasLead);
        }

        $page    = (int) $request->query('page', 0);
        $perPage = min((int) $request->query('per_page', 0), 200);

        if ($page > 0 || $perPage > 0) {
            $perPage = $perPage > 0 ? $perPage : 50;
            $page    = $page > 0 ? $page : 1;
            $total   = (clone $q)->count();
            $rows    = $q->forPage($page, $perPage)
                ->get()
                ->map(fn($c) => $this->shape($c))
                ->all();
            return response()->json([
                'tab'        => $tab,
                'count'      => $total,
                'tab_counts' => $tabCounts,
                'page'       => $page,
                'per_page'   => $perPage,
                'data'       => $rows,
            ]);
        }

        $rows = $q->get()->map(fn($c) => $this->shape($c))->all();

        return response()->json([
            'tab'        => $tab,
            'count'      => count($rows),
            'tab_counts' => $tabCounts,
            'data'       => $rows,
        ]);
    }

    public function show(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $row = Customer::query()
            ->forUser($user)
            ->with(['primaryAddress', 'addresses', 'gstScrutiny'])
            ->findOrFail($id);

        $documents = $this->safeDelegate(
            fn() => (new CustomerDocumentController())->index($request, $id)
        );
        $owners = $this->safeDelegate(
            fn() => (new CustomerOwnerController())->index($request, $id)
        );
        $segmentUploads = $this->safeDelegate(
            fn() => (new SegmentDocUploadController())->index($request, 'customer', $id)
        );

        $data = $this->shape($row);
        $piLocked = \App\Support\SegmentGuard::lockedSegmentNames(
            \App\Models\Customer::class,
            (int) $row->id,
            (int) $row->client_id,
        );
        $productLocked = \App\Support\SegmentGuard::productMappingSegmentNames(
            \App\Models\Customer::class,
            (int) $row->id,
            (int) $row->client_id,
        );
        $data['locked_segments'] = array_values(array_unique(array_merge($piLocked, $productLocked)));
        $reasons = [];
        foreach ($productLocked as $n) $reasons[mb_strtolower(trim((string) $n))] = 'product';
        foreach ($piLocked      as $n) $reasons[mb_strtolower(trim((string) $n))] = 'pi';
        $data['locked_segment_reasons'] = $reasons;
        $segReq = [];
        foreach (\App\Support\SegmentGuard::names($row->segment) as $segName) {
            $segReq[$segName] = \App\Support\SegmentGuard::docKeys((int) $row->client_id, $segName, \App\Support\SegmentGuard::idsOf($row));
        }
        $data['segment_required_doc_keys'] = $segReq;
        $data['uploaded_doc_keys'] = \App\Support\SegmentGuard::uploadedDocKeys(
            \App\Models\Customer::class,
            (int) $row->id,
            (int) $row->client_id,
        );

        return response()->json([
            'data'            => $data,
            'documents'       => $documents['data'] ?? [],
            'owners'          => $owners['data'] ?? [],
            'segment_uploads' => $segmentUploads ?: ['data' => [], 'by_category' => [], 'count' => 0],
            'gst_scrutiny'    => $row->gstScrutiny->map(fn($g) => $this->shapeGst($g))->all(),
        ]);
    }

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

        $data = $this->validatePayload($request, null, $clientId, $branchId);
        $data = $this->withSegmentIds($data, $clientId, $branchId, []);

        $row = DB::transaction(function () use ($data, $user, $clientId, $branchId) {
            $primary = $data['primary_address'];

            if ($clientId !== null) {
                DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
            }
            $code = $this->nextCustomerCode($clientId, $branchId);

            $customer = Customer::create([
                'client_id'      => $clientId,
                'branch_id'      => $branchId,
                'created_by'     => optional($user)->id,
                'customer_code'  => $code,
                'company_name'   => $data['company_name'],
                'legal_name'     => $data['legal_name']     ?? null,
                'type'           => $data['type']           ?? null,
                'segment'        => $data['segment']        ?? null,
                'segment_ids'    => $data['segment_ids']    ?? null,
                'classification' => $data['classification'] ?? null,
                'risk_level'     => $data['risk_level']     ?? null,
                'gst_applicable' => $data['gst_applicable'] ?? null,
                'gst_number'     => ($data['gst_applicable'] ?? null) === 'Yes' ? ($data['gst_number'] ?? null) : null,
                'website'        => $data['website']        ?? null,
                'primary_email'  => $primary['cp_email']    ?? null,
                'status'         => $data['status']         ?? 'Active',
                'is_map_lead'    => 'No',
            ]);

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

        return response()->json(['data' => $this->shape($row)], 201);
    }

    public function update(Request $request, $id): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->findOrFail($id);

        if ($denial = MasterVisibility::hierarchicalDenial($user, $customer, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $this->validatePayload($request, (int) $customer->id, $customer->client_id, $customer->branch_id);
        $data = $this->withSegmentIds($data, $customer->client_id, $customer->branch_id, \App\Support\SegmentGuard::ids($customer->segment_ids ?? []));

        $removedSegs = \App\Support\SegmentGuard::removedNames($customer->segment, $data['segment'] ?? null);

        $pdBlocked = \App\Support\SegmentGuard::blockedByProductMapping(
            \App\Models\Customer::class,
            (int) $customer->id,
            (int) $customer->client_id,
            $removedSegs,
        );
        if (!empty($pdBlocked)) {
            return response()->json([
                'message' => 'This Segment cannot be removed because it is currently associated with one or more Product Directory records. Please remove the Product Directory dependency before removing this Segment.',
                'errors'  => ['segment' => ['Segment(s) referenced in the Product Directory cannot be removed: ' . implode(', ', $pdBlocked) . '.']],
            ], 422);
        }

        $usedSegments = \App\Support\SegmentGuard::blockedByCompletedDocs(
            \App\Models\Customer::class,
            (int) $customer->id,
            (int) $customer->client_id,
            $removedSegs,
        );
        if (!empty($usedSegments)) {
            return response()->json([
                'message' => 'Cannot remove ' . implode(', ', $usedSegments) . ' — a product on a Quotation, Proforma Invoice or Shipment belongs to it.',
                'errors'  => ['segment' => ['Segment(s) used by a Quotation / PI / Shipment product cannot be removed: ' . implode(', ', $usedSegments) . '.']],
            ], 422);
        }

        $orphanUploads = \App\Support\SegmentGuard::orphanUploads(
            \App\Models\Customer::class,
            (int) $customer->id,
            (int) $customer->client_id,
            $removedSegs,
            \App\Support\SegmentGuard::names($data['segment'] ?? null),
        );
        $confirmDocRemoval = $request->boolean('confirm_segment_doc_removal');
        if ($orphanUploads->isNotEmpty() && !$confirmDocRemoval) {
            return response()->json([
                'requires_doc_confirmation' => true,
                'message' => 'Removing this segment will delete ' . $orphanUploads->count() . ' document(s) used only by it. Shared documents are kept. Confirm to proceed.',
                'orphan_documents' => $orphanUploads->map(fn($d) => [
                    'id'       => $d->id,
                    'name'     => $d->attachment_name ?: ($d->doc_name ?: ('Document #' . $d->id)),
                    'category' => $d->category,
                ])->values(),
            ], 409);
        }

        if ($denial = $this->consigneeCountryDenial($customer, $data['primary_address']['country'] ?? null)) {
            return $denial;
        }

        if ($denial = $this->mappedLeadCountryDenial($customer, $data['primary_address']['country'] ?? null)) {
            return $denial;
        }

        $row = DB::transaction(function () use ($customer, $data, $orphanUploads, $confirmDocRemoval) {
            $primary = $data['primary_address'];

            if ($confirmDocRemoval && $orphanUploads->isNotEmpty()) {
                foreach ($orphanUploads as $u) {
                    if ($u->attachment_path) {
                        try {
                            \Illuminate\Support\Facades\Storage::disk('public')->delete($u->attachment_path);
                        } catch (\Throwable $e) {
                        }
                    }
                    $u->delete();
                }
            }

            $customer->update([
                'company_name'   => $data['company_name'],
                'legal_name'     => $data['legal_name']     ?? null,
                'type'           => $data['type']           ?? null,
                'segment'        => $data['segment']        ?? null,
                'segment_ids'    => $data['segment_ids']    ?? null,
                'classification' => $data['classification'] ?? null,
                'risk_level'     => $data['risk_level']     ?? null,
                'gst_applicable' => $data['gst_applicable'] ?? null,
                'gst_number'     => ($data['gst_applicable'] ?? null) === 'Yes' ? ($data['gst_number'] ?? null) : null,
                'website'        => $data['website']        ?? null,
                'primary_email'  => $primary['cp_email']    ?? null,
                'status'         => $data['status']         ?? $customer->status,
            ]);

            $this->syncMappedConsigneeSegments($customer->fresh());

            $newGst = ($data['gst_applicable'] ?? null) === 'Yes' ? ($data['gst_number'] ?? null) : null;
            if ($newGst) {
                CustomerGstScrutiny::where('customer_id', $customer->id)
                    ->where('gst_number', '!=', $newGst)
                    ->update(['gst_number' => $newGst]);
            }

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

        \Illuminate\Support\Facades\DB::transaction(function () use ($customer) {
            foreach ($customer->consignees()->get() as $consignee) {
                $consignee->customers()->detach($customer->id);
                $remaining = $consignee->customers()->pluck('customers.id')->all();
                if (empty($remaining)) {
                    $consignee->delete();
                } elseif ((int) $consignee->customer_id === (int) $customer->id) {
                    $consignee->update(['customer_id' => $remaining[0]]);
                }
            }

            $customer->delete();
        });

        return response()->json(['id' => $customer->id, 'deleted' => true]);
    }

    private function withSegmentIds(array $data, ?int $clientId, ?int $branchId, array $currentIds): array
    {
        if (array_key_exists('segment_ids', $data) && $data['segment_ids'] !== null) {
            $ids = \App\Support\SegmentGuard::ids($data['segment_ids']);
            $ids = $ids ? array_values(array_intersect($ids, \App\Models\ClmSegment::withoutGlobalScopes()
                ->whereIn('id', $ids)
                ->where(fn ($q) => $q->where('client_id', $clientId)->orWhereNull('client_id'))
                ->pluck('id')->map(fn ($i) => (int) $i)->all())) : [];
            $data['segment_ids'] = $ids ?: null;
            $names = \App\Support\SegmentGuard::namesFor($ids);
            $data['segment'] = $names !== '' ? $names : null;
            return $data;
        }
        $ids = \App\Support\SegmentGuard::resolveIds($clientId, $branchId, \App\Support\SegmentGuard::names($data['segment'] ?? null), $currentIds);
        $data['segment_ids'] = $ids ?: null;
        return $data;
    }

    private function syncMappedConsigneeSegments(Customer $customer): void
    {
        foreach ($customer->consignees()->get() as $consignee) {
            $custIds    = $consignee->customers()->pluck('customers.id')->all();
            $derived    = \App\Support\SegmentGuard::forCustomers($custIds);
            $oldSegment = $consignee->segment;
            $removed    = \App\Support\SegmentGuard::removedNames($oldSegment, $derived);

            $keep = array_values(array_unique(array_merge(
                \App\Support\SegmentGuard::blockedByCompletedDocs(
                    \App\Models\Consignee::class,
                    (int) $consignee->id,
                    (int) $consignee->client_id,
                    $removed,
                ),
                \App\Support\SegmentGuard::blockedByOrphanDocs(
                    \App\Models\Consignee::class,
                    (int) $consignee->id,
                    (int) $consignee->client_id,
                    $removed,
                    \App\Support\SegmentGuard::names($derived),
                ),
            )));
            $finalSegment = \App\Support\SegmentGuard::mergeRetained($derived, $keep);
            $finalIds     = \App\Support\SegmentGuard::consigneeIds($custIds, $keep, $consignee);
            $consignee->update([
                'segment'     => $finalSegment !== '' ? $finalSegment : null,
                'segment_ids' => $finalIds ?: null,
            ]);
        }
    }

    public function gstAvailable(Request $request): JsonResponse
    {
        $user = $request->user();
        [$clientId, $branchId] = $this->resolveOwnership($user);

        $gst = strtoupper(trim((string) $request->query('gst_number', '')));
        if ($gst === '') {
            return response()->json(['data' => ['available' => true, 'taken_by' => null]]);
        }

        $ignoreId = (int) $request->query('ignore_id', 0);

        $row = Customer::query()
            ->whereNull('deleted_at')
            ->where('gst_number', $gst)
            ->where(function ($q) use ($clientId) {
                $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
            })
            ->where(function ($q) use ($branchId) {
                $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
            })
            ->when($ignoreId > 0, fn($q) => $q->where('id', '!=', $ignoreId))
            ->first(['id', 'company_name', 'legal_name']);

        return response()->json(['data' => [
            'available' => $row === null,
            'taken_by'  => $row ? ($row->legal_name ?: $row->company_name) : null,
        ]]);
    }

    public function indexGstScrutiny(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->with('gstScrutiny')->findOrFail($id);
        return response()->json(['data' => $customer->gstScrutiny->map(fn($g) => $this->shapeGst($g))->all()]);
    }

    public function storeGstScrutiny(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $customer, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $this->validateGst($request, $customer->id);
        $row = CustomerGstScrutiny::create([
            'customer_id'             => $customer->id,
            'gst_number'              => strtoupper($data['gst_number']),
            'status'                  => $data['status'] ?? 'Active',
            'last_filing_date'        => $data['last_filing_date'] ?? null,
            'prev_non_gst_2a_invoice' => $data['prev_non_gst_2a_invoice'] ?? null,
            'red_flags'               => $data['red_flags'] ?? null,
            'created_by'              => $user->id,
        ]);

        return response()->json(['data' => $this->shapeGst($row)], 201);
    }

    public function updateGstScrutiny(Request $request, int $id, int $gstId): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $customer, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $row = CustomerGstScrutiny::where('customer_id', $customer->id)->findOrFail($gstId);
        $data = $this->validateGst($request, $customer->id, $row->id);
        $row->update([
            'gst_number'              => strtoupper($data['gst_number']),
            'status'                  => $data['status'] ?? 'Active',
            'last_filing_date'        => $data['last_filing_date'] ?? null,
            'prev_non_gst_2a_invoice' => $data['prev_non_gst_2a_invoice'] ?? null,
            'red_flags'               => $data['red_flags'] ?? null,
        ]);

        return response()->json(['data' => $this->shapeGst($row->fresh())]);
    }

    public function destroyGstScrutiny(Request $request, int $id, int $gstId): JsonResponse
    {
        $user = $request->user();
        $customer = Customer::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $customer, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        CustomerGstScrutiny::where('customer_id', $customer->id)->findOrFail($gstId)->forceDelete();
        return response()->json(['message' => 'GST scrutiny deleted']);
    }

    private function validateGst(Request $request, int $customerId, ?int $ignoreId = null): array
    {
        $request->merge(['gst_number' => strtoupper((string) $request->input('gst_number'))]);

        return $request->validate([
            'gst_number'              => [
                'required',
                'string',
                'regex:/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/',
                Rule::unique('customer_gst_scrutiny', 'gst_number')
                    ->where(fn($q) => $q->where('customer_id', '!=', $customerId)->whereNull('deleted_at')),
            ],
            'status'                  => ['nullable', Rule::in(['Active', 'Inactive'])],
            'last_filing_date'        => 'nullable|date',
            'prev_non_gst_2a_invoice' => 'nullable|string|max:255',
            'red_flags'               => 'nullable|string|max:2000',
        ], [
            'gst_number.regex'  => 'Invalid GST format. Expected 15 characters: 2 digits, 5 letters, 4 digits, 1 letter, 1 digit/letter, Z, 1 digit/letter (e.g. 27AADCI6120M1ZH).',
            'gst_number.unique' => 'This GST number is already registered to another customer.',
        ]);
    }

    private function shapeGst(CustomerGstScrutiny $g): array
    {
        return [
            'id'                       => $g->id,
            'gst_number'               => $g->gst_number,
            'status'                   => $g->status,
            'last_filing_date'         => optional($g->last_filing_date)->toDateString(),
            'prev_non_gst_2a_invoice'  => $g->prev_non_gst_2a_invoice,
            'red_flags'                => $g->red_flags,
        ];
    }

    private function consigneeCountryDenial(Customer $customer, ?string $newCountry): ?JsonResponse
    {
        $wasDomestic = Gst::isDomestic(optional($customer->primaryAddress)->country);
        $nowDomestic = Gst::isDomestic($newCountry);

        if ($wasDomestic === $nowDomestic) return null;

        $stranded = [];
        foreach ($customer->consignees()->with('primaryAddress:id,consignee_id,country')->get() as $cn) {
            $cnCountry = optional($cn->primaryAddress)->country;
            if (Gst::isDomestic($cnCountry) !== $nowDomestic) {
                $stranded[] = $cn->company_name . ' (' . (trim((string) $cnCountry) ?: 'no country') . ')';
            }
        }

        if (empty($stranded)) return null;

        $to = $nowDomestic ? 'India' : (trim((string) $newCountry) ?: 'no country');
        return response()->json([
            'message' => 'Cannot change this customer\'s country to ' . $to . ' — it is mapped to consignee(s) on the other side of the India border: '
                . implode(', ', $stranded) . '. Unmap them first, or change their country to match.',
            'errors'  => ['primary_address.country' => ['Customer and consignee must both be in India, or both outside it.']],
        ], 422);
    }

    private function mappedLeadCountryDenial(Customer $customer, ?string $newCountry): ?JsonResponse
    {
        if (($customer->is_map_lead ?? 'No') !== 'Yes') {
            return null;
        }

        $current = trim((string) optional($customer->primaryAddress)->country);
        $next    = trim((string) $newCountry);

        if (strcasecmp($current, $next) === 0) {
            return null;
        }

        return response()->json([
            'message' => 'Country cannot be changed — this customer is already mapped to one or more leads'
                . ($current !== '' ? ' with the country "' . $current . '"' : '')
                . '. Existing opportunities, quotations and proforma invoices were raised against it.',
            'errors'  => ['primary_address.country' => ['Locked: the customer is mapped to a lead.']],
        ], 422);
    }

    private function shape(Customer $c): array
    {
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
            'segment_ids'     => \App\Support\SegmentGuard::idsOf($c),
            'segments'        => \App\Support\SegmentGuard::rowsFor(\App\Support\SegmentGuard::idsOf($c)),
            'classification'  => $c->classification,
            'riskLevel'       => $c->risk_level,
            'gstApplicable'   => $c->gst_applicable,
            'gstNumber'       => $c->gst_number,
            'website'         => $c->website,
            'status'          => $c->status,
            'isMapLead'       => $c->is_map_lead ?: 'No',
            'country'         => $primary?->country,
            'country_iso'     => \App\Models\Masters\Countries::isoFor($primary?->country),
            'state'           => $primary?->state,
            'stateCode'       => $primary?->state_code,
            'city'            => $primary?->city,
            'pin'             => $primary?->pin,
            'addr'            => $primary?->address_line,
            'addrType'        => $primary?->type,
            'contact'         => $primary?->cp_name,
            'cpDesig'         => $primary?->cp_designation,
            'phone'           => $primary?->cp_contact,
            'email'           => $primary?->cp_email,
            'whatsapp'        => $primary?->cp_whatsapp === 'yes' ? 'Yes' : ($primary?->cp_whatsapp === 'no' ? 'No' : null),
            'consignees'      => (int) ($c->consignees_count ?? 0),
            'recurring'       => (bool) ($c->is_recurring ?? false),
            'hasSameAsCustomerConsignees' => ((int) ($c->same_as_customer_consignees_count ?? 0)) > 0,
            'sameAsCustomerConsigneeCount' => (int) ($c->same_as_customer_consignees_count ?? 0),
            'locations'       => $c->addresses
                ->where('is_primary', false)
                ->values()
                ->map(fn($a) => $this->shapeAddress($a))
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
            'state_code'     => $a->state_code,
            'city'           => $a->city,
            'pin'            => $a->pin,
            'cp_name'        => $a->cp_name,
            'cp_designation' => $a->cp_designation,
            'cp_contact'     => $a->cp_contact,
            'cp_email'       => $a->cp_email,
            'cp_whatsapp'    => $a->cp_whatsapp,
        ];
    }

    private function validatePayload(Request $request, ?int $customerId, $clientId, $branchId = null): array
    {
        if ($request->filled('gst_number')) {
            $request->merge(['gst_number' => strtoupper(trim((string) $request->input('gst_number')))]);
        }

        $request->merge([
            'gst_applicable' => Gst::applicableFor($request->input('primary_address.country')),
        ]);

        $data = $request->validate([
            'company_name'   => 'required|string|max:255',
            'legal_name'     => [
                'nullable',
                'string',
                'max:255',
                function ($attribute, $value, $fail) use ($clientId, $customerId, $branchId) {
                    if (!trim((string) $value)) return;
                    $exists = \App\Models\Customer::query()
                        ->whereNull('deleted_at')
                        ->where(function ($q) use ($clientId) {
                            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                        })
                        ->where(function ($q) use ($branchId) {
                            $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
                        })
                        ->whereRaw('LOWER(legal_name) = ?', [mb_strtolower(trim((string) $value))])
                        ->when($customerId, fn($q) => $q->where('id', '!=', $customerId))
                        ->exists();
                    if ($exists) {
                        $fail('This legal name is already used by another customer in this branch.');
                    }
                },
            ],
            'type'           => 'nullable|string|max:64',
            'segment'        => 'nullable|string|max:1024',
            'segment_ids'    => 'nullable|array',
            'segment_ids.*'  => 'integer',
            'classification' => 'nullable|string|max:64',
            'risk_level'     => 'nullable|string|max:32',
            'gst_applicable' => ['nullable', Rule::in(['Yes', 'No'])],
            'gst_number'     => [
                'nullable',
                'required_if:gst_applicable,Yes',
                'string',
                'regex:/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/',
                function ($attribute, $value, $fail) use ($request, $clientId, $customerId, $branchId) {
                    if ($request->input('gst_applicable') !== 'Yes') return;
                    $v = strtoupper(trim((string) $value));
                    if ($v === '') return;
                    $exists = \App\Models\Customer::query()
                        ->whereNull('deleted_at')
                        ->where('gst_number', $v)
                        ->where(function ($q) use ($clientId) {
                            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                        })
                        ->where(function ($q) use ($branchId) {
                            $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
                        })
                        ->when($customerId, fn($q) => $q->where('id', '!=', $customerId))
                        ->exists();
                    if ($exists) {
                        $fail('This GST Number is already used by another customer in this branch.');
                    }
                },
                function ($attribute, $value, $fail) use ($request) {
                    if ($request->input('gst_applicable') !== 'Yes') return;
                    $v = strtoupper(trim((string) $value));
                    if ($v === '') return;
                    $stateCode = Gst::stateCodeFor($request->input('primary_address.state'));
                    if ($stateCode && substr($v, 0, 2) !== $stateCode) {
                        $fail("GST state code (" . substr($v, 0, 2) . ") does not match the selected state's code ({$stateCode}).");
                    }
                },
            ],
            'website'        => 'nullable|string|max:500',
            'status'         => 'nullable|in:Active,Inactive',

            'primary_address'                => 'required|array',
            'primary_address.type'           => 'required|string|max:64',
            'primary_address.address_line'   => 'required|string|min:4|max:75',
            'primary_address.country'        => 'nullable|string|max:64',
            'primary_address.state'          => 'nullable|string|max:64',
            'primary_address.state_code'     => 'nullable|string|max:32',
            'primary_address.city'           => 'nullable|string|max:64',
            'primary_address.pin'            => [
                'nullable',
                'string',
                PostalCode::rule(fn() => $request->input('primary_address.country')),
            ],
            'primary_address.cp_name'        => 'required|string|max:255',
            'primary_address.cp_designation' => 'nullable|string|max:128',
            'primary_address.cp_contact'     => [
                'required',
                'string',
                'regex:/^\+?[0-9\s-]{7,15}$/',
                function ($attribute, $value, $fail) use ($clientId, $customerId, $branchId) {
                    if (!trim((string) $value)) return;
                    $exists = \App\Models\CustomerAddress::query()
                        ->where('cp_contact', $value)
                        ->where('is_primary', true)
                        ->whereHas('customer', function ($q) use ($clientId, $customerId, $branchId) {
                            $q->whereNull('deleted_at');
                            $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                            $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
                            if ($customerId) $q->where('id', '!=', $customerId);
                        })
                        ->exists();
                    if ($exists) {
                        $fail('This phone number is already used by another customer in this branch.');
                    }
                },
            ],
            'primary_address.cp_email'       => [
                'required',
                'email',
                'max:255',
                'regex:/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/',
                Rule::unique('customers', 'primary_email')
                    ->where(function ($q) use ($clientId, $branchId) {
                        $q->whereNull('deleted_at');
                        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
                        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
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
            'locations.*.pin'            => ['nullable', 'string', PostalCode::locationRule($request->all())],
            'locations.*.cp_name'        => 'required_with:locations|string|max:255',
            'locations.*.cp_designation' => 'nullable|string|max:128',
            'locations.*.cp_contact'     => ['nullable', 'string', 'regex:/^\+?[0-9\s-]{7,15}$/'],
            'locations.*.cp_email'       => ['nullable', 'email', 'max:255', 'regex:/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/'],
            'locations.*.cp_whatsapp'    => 'nullable|in:yes,no',
        ], [
            'gst_number.required_if' => 'GST Number is required for an India (domestic) customer.',
            'gst_number.regex'       => 'Invalid GST format. Expected 15 characters: 2 digits, 5 letters, 4 digits, 1 letter, 1 digit/letter, Z, 1 digit/letter (e.g. 27AADCI6120M1ZH).',
        ]);

        $data['primary_address']['state_code'] = Gst::isDomestic($data['primary_address']['country'] ?? null)
            ? Gst::stateCodeFor($data['primary_address']['state'] ?? null)
            : null;

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

    private function resolveOwnership($user): array
    {
        if (!$user) return [null, null];
        if ($user->user_type === 'super_admin') return [null, null];
        $clientId = $user->client_id ?? ($user->branch?->client_id);
        $branchId = $user->branch_id;
        return [$clientId, $branchId];
    }

    private function nextCustomerCode($clientId, $branchId = null): string
    {
        $codes = Customer::withTrashed()
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

    public function masterBundle(Request $request): JsonResponse
    {
        $user = $request->user();
        $cacheKey = MasterBundleCache::key('customer:master-bundle', $user?->id);

        $bundle = Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user) {
            $scope = fn($q) => MasterVisibility::applyReadScope($q, $user);

            $active = function (string $modelClass, array $cols) use ($scope) {
                return $modelClass::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->orderBy('id')
                    ->get($cols);
            };

            $ruleQuery = \App\Models\ClmSegmentRule::query()
                ->whereRaw('(COALESCE(mandatory_count, 0) + COALESCE(optional_count, 0)) > 0');
            $scope($ruleQuery);
            $segmentCodesWithDocs = $ruleQuery->distinct()->pluck('segment_code')->filter()->all();
            $segments = Segments::query()
                ->whereRaw('LOWER(status) = ?', ['active'])
                ->tap($scope)
                ->whereIn('code', $segmentCodesWithDocs ?: [''])
                ->orderBy('id')
                ->get(['id', 'name', 'code', 'regulatory_status']);

            return [
                'customer_types'           => $active(CustomerTypes::class,           ['id', 'name']),
                'segments'                 => $segments,
                'customer_classifications' => $active(CustomerClassifications::class, ['id', 'name']),
                'risk_levels'              => $active(RiskLevels::class,              ['id', 'name']),
                'address_types'            => $active(AddressTypes::class,            ['id', 'name']),
                'countries'                => $active(Countries::class,               ['id', 'name']),
                'states'                   => $active(States::class,                  ['id', 'name', 'country_id']),
                'state_codes'              => StateCodes::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->with('state:id,name,country_id')
                    ->statutoryFirst()
                    ->get(['id', 'state_id', 'state_code', 'status']),
                'designations'             => $active(Designations::class,            ['id', 'name']),
                'document_type'            => $active(DocumentType::class,            ['id', 'title']),
            ];
        });

        return response()->json($bundle);
    }
}
