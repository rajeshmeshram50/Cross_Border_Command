<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Masters\AddressTypes;
use App\Models\Masters\ComplianceBehaviours;
use App\Models\Masters\Countries;
use App\Models\Masters\CustomerClassifications;
use App\Models\Masters\GstPercentage;
use App\Models\Masters\LicenseName;
use App\Models\Masters\RiskLevels;
use App\Models\Masters\Segments;
use App\Models\Masters\StateCodes;
use App\Models\Masters\States;
use App\Models\Masters\VendorBehaviour;
use App\Models\Masters\VendorTypes;
use App\Models\Vendor;
use App\Models\VendorAddress;
use App\Models\VendorBankAccount;
use App\Models\VendorDocument;
use App\Models\VendorGstScrutiny;
use App\Models\VendorOwner;
use App\Models\VendorProductMapping;
use App\Models\P2p\ServiceSupplier;
use App\Services\P2p\ServiceSupplierMapping;
use App\Support\MasterBundleCache;
use App\Support\MasterVisibility;
use App\Support\SupplierCompliance;
use App\Support\SupplierPricing;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class VendorController extends Controller
{
    private const MAX_UPLOAD_KB = 2048;

    private const FIELD_LABELS = [
        'vendor_id'                => 'supplier',
        'vendor_code'              => 'supplier code',
        'vendor_name'              => 'supplier name',
        'vendor_type_id'           => 'supplier type',
        'vendor_type'              => 'supplier type',
        'vendor_behaviour_id'      => 'supplier behaviour',
        'vendor_behaviour'         => 'supplier behaviour',
        'gst_number'               => 'GST Number',
        'gst_applicable'           => 'GST Applicable',
        'address.country_id'       => 'country',
        'address.state_id'         => 'state',
        'address.state_code'       => 'state code',
        'address.address_line'     => 'registered office address',
        'address.contact_name'     => 'contact name',
        'address.contact_no'       => 'contact number',
        'address.email'            => 'email',
        'primary_address.country_id' => 'country',
        'primary_address.state_id'   => 'state',
    ];

    private const SHOW_WITH = [
        'addresses',
        'documents.licenseType:id,name',
        'owners',
        'bankAccounts',
        'gstScrutiny',
        'productMappings.product:id,product_code,name',
        'vendorType:id,name',
        'riskLevel:id,name',
        'vendorBehaviour:id,name',
        'segment:id,name,regulatory_status',
        'segments:id,name,regulatory_status',
        'complianceBehaviour:id,name',
        'classification:id,name',
        'client:id,org_name',
        'branch:id,name',
        'creator:id,name,user_type',
    ];

    private const SHOW_WITH_LITE = [
        'primaryAddress.country:id,name',
        'primaryAddress.state:id,name',
        'gstScrutiny',
        'productMappings',
        'vendorType:id,name',
        'riskLevel:id,name',
        'segments:id,name',
        'segment',
    ];

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($request->boolean('light')) {
            $rows = Vendor::query()
                ->forUser($user, $request->integer('branch_id') ?: null)
                ->with([
                    'primaryAddress:id,vendor_id,country_id,contact_no,email',
                    'primaryAddress.country:id,name',
                ])
                ->orderBy('company_name')
                ->get(['id', 'vendor_code', 'company_name', 'primary_email'])
                ->map(fn(Vendor $v) => [
                    'id'            => $v->id,
                    'db_id'         => $v->id,
                    'vendor_code'   => $v->vendor_code,
                    'company_name'  => $v->company_name,
                    'country'       => $v->primaryAddress?->country?->name,
                    'mobile'        => $v->primaryAddress?->contact_no,
                    'primary_email' => $v->primary_email ?: $v->primaryAddress?->email,
                ])
                ->all();

            return response()->json(['count' => count($rows), 'data' => $rows]);
        }

        $q = Vendor::query()
            ->forUser($user, $request->integer('branch_id') ?: null)
            ->with([
                'primaryAddress:id,vendor_id,city,country_id,state_id,state_code,contact_name,email,contact_no,designation',
                'primaryAddress.state:id,name',
                'primaryAddress.country:id,name',
                'addresses:id,vendor_id,is_primary,contact_name,designation,contact_no,email',
                'vendorType:id,name,kind,service_type,classification',
                'segment:id,name,regulatory_status',
                'segments:id,name,regulatory_status',
                'riskLevel:id,name',
                'complianceBehaviour:id,name',
            ])
            ->withCount('productMappings')
            ->addSelect(DB::raw('0 as opportunity_count'))
            ->orderByDesc('id');

        if ($search = trim((string) $request->query('q', ''))) {
            $catTerm = str_replace(' ', '_', mb_strtolower($search));

            $q->where(function ($w) use ($search, $catTerm) {
                $w->where('company_name', 'ilike', "%{$search}%")
                    ->orWhere('legal_name',   'ilike', "%{$search}%")
                    ->orWhere('vendor_code',  'ilike', "%{$search}%")
                    ->orWhere('primary_email', 'ilike', "%{$search}%")
                    ->orWhere('gst_number',   'ilike', "%{$search}%")
                    ->orWhere('supplier_category', 'ilike', "%{$catTerm}%")
                    ->orWhereHas('addresses', function ($a) use ($search) {
                        $a->where('contact_name', 'ilike', "%{$search}%")
                            ->orWhere('contact_no', 'ilike', "%{$search}%")
                            ->orWhere('email',      'ilike', "%{$search}%")
                            ->orWhere('city',       'ilike', "%{$search}%")
                            ->orWhere('state_code', 'ilike', "%{$search}%");
                    })
                    ->orWhereHas('primaryAddress.state',   fn($s) => $s->where('name', 'ilike', "%{$search}%"))
                    ->orWhereHas('primaryAddress.country', fn($c) => $c->where('name', 'ilike', "%{$search}%"))
                    ->orWhereHas('vendorType',             fn($t) => $t->where('name', 'ilike', "%{$search}%"))
                    ->orWhereHas('segments',               fn($g) => $g->where('name', 'ilike', "%{$search}%"));
            });
        }
        if ($status = $request->query('status')) {
            $q->where('status', $status);
        }

        $scope = $request->query('scope');
        $applyScope = function ($b, string $sc) {
            $india = fn($a) => $a->whereHas('country', fn($c) => $c->whereRaw('LOWER(name) = ?', ['india']));
            if ($sc === 'domestic') {
                $b->where(fn($w) => $w->whereHas('primaryAddress', $india)
                    ->orWhereDoesntHave('primaryAddress')
                    ->orWhereHas('primaryAddress', fn($a) => $a->whereNull('country_id')));
            } else {
                $b->whereHas('primaryAddress', fn($a) => $a->whereNotNull('country_id')
                    ->whereHas('country', fn($c) => $c->whereRaw('LOWER(name) <> ?', ['india'])));
            }
            return $b;
        };
        $scopeCount = function (string $sc) use ($q, $applyScope) {
            $b = clone $q;
            $b->setEagerLoads([]);
            $b->reorder();
            $b->getQuery()->columns = null;
            return $applyScope($b, $sc)->count();
        };
        $scopeCounts = ['domestic' => $scopeCount('domestic'), 'international' => $scopeCount('international')];
        if ($scope === 'domestic' || $scope === 'international') {
            $applyScope($q, $scope);
        }

        $tab = $request->query('tab');
        if ($tab === 'recurring') {
            $q->whereRaw('1 = 0');
        }

        $facet = function () use ($q) {
            $b = clone $q;
            $b->setEagerLoads([]);
            $b->reorder();
            $b->getQuery()->columns = null;
            return $b;
        };

        $grandTotal = $facet()->count();

        $catCounts = $facet()
            ->select('supplier_category')
            ->selectRaw('count(*) as c')
            ->groupBy('supplier_category')
            ->pluck('c', 'supplier_category');

        $scopedIds = $facet()->pluck('vendors.id')->map(fn($x) => (int) $x)->all();
        $complianceById = SupplierCompliance::statuses(
            $scopedIds,
            (int) ($user->client_id ?? optional($user->branch ?? null)->client_id ?? 0)
        );

        $compliantIds    = [];
        $nonCompliantIds = [];
        foreach ($complianceById as $vid => $status) {
            if ($status === SupplierCompliance::COMPLIANT) $compliantIds[] = $vid;
            else                                           $nonCompliantIds[] = $vid;
        }
        $compliantCount    = count($compliantIds);
        $nonCompliantCount = count($nonCompliantIds);

        $csv = fn(string $key) => array_values(array_filter(array_map(
            'trim',
            explode(',', (string) $request->query($key, ''))
        )));

        if ($cats = $csv('categories')) {
            $q->whereIn('supplier_category', $cats);
        }

        if ($comp = $csv('compliance')) {
            $wanted = [];
            if (in_array('compliant', $comp, true))     $wanted = array_merge($wanted, $compliantIds);
            if (in_array('non_compliant', $comp, true)) $wanted = array_merge($wanted, $nonCompliantIds);
            $q->whereIn('vendors.id', $wanted ?: [0]);
        }

        $page = $q->paginate((int) $request->query('per_page', 24));

        $page->getCollection()->transform(function ($v) use ($complianceById) {
            $v->setAttribute('compliance_status', $complianceById[(int) $v->id] ?? SupplierCompliance::COMPLIANT);
            return $v;
        });

        return response()->json(array_merge($page->toArray(), [
            'facets' => [
                'grand_total' => $grandTotal,
                'scope'       => $scopeCounts,
                'category' => [
                    'star'        => (int) ($catCounts['star'] ?? 0),
                    'general'     => (int) ($catCounts['general'] ?? 0),
                    'high_risk'   => (int) ($catCounts['high_risk'] ?? 0),
                    'blacklisted' => (int) ($catCounts['blacklisted'] ?? 0),
                ],
                'compliance' => [
                    'compliant'     => $compliantCount,
                    'non_compliant' => $nonCompliantCount,
                ],
            ],
        ]));
    }

    public function productMappings(Request $request, int $id): JsonResponse
    {
        $vendor = Vendor::query()->forUser($request->user())->findOrFail($id);

        $rows = VendorProductMapping::query()
            ->where('vendor_id', $vendor->id)
            ->with([
                'product:id,product_code,name,hsn_id,segment_id',
                'product.hsn:id,hsn_code',
                'product.segment:id,name,regulatory_status',
            ])
            ->orderBy('id')
            ->get()
            ->map(fn(VendorProductMapping $m) => [
                'id'               => $m->id,
                'product_id'       => $m->product_id,
                'product_code'     => $m->product?->product_code,
                'product_name'     => $m->product?->name,
                'hsn_sac_code'     => $m->product?->hsn?->hsn_code,
                'segment'          => $m->product?->segment?->name,
                'segment_regulatory_status' => $m->product?->segment?->regulatory_status,
                'batch_serial_lot' => $m->batch_serial_lot,
                'purchase_price'   => $m->purchase_price,
                'gst_percentage'   => $m->gst_percentage,
                'gst_amount'       => $m->gst_amount,
                'total_amount'     => $m->total_amount,
            ]);

        return response()->json([
            'data' => $rows,
            'meta' => [
                'vendor_id'   => $vendor->id,
                'vendor_code' => $vendor->vendor_code,
                'vendor_name' => $vendor->company_name,
                'count'       => $rows->count(),
            ],
        ]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $lite = $request->boolean('lite');
        $vendor = Vendor::query()->forUser($user)
            ->with($lite ? self::SHOW_WITH_LITE : self::SHOW_WITH)
            ->findOrFail($id);

        if ($lite) {
            return response()->json([
                'data'            => $this->shapeLite($vendor),
                'segment_uploads' => ['data' => [], 'by_category' => [], 'count' => 0],
            ]);
        }

        $segmentUploads = $this->safeDelegate(
            fn() => (new \App\Http\Controllers\Api\SegmentDocUploadController())->index($request, 'supplier', $id)
        );

        $data = $this->shape($vendor);
        $lockSrc  = \App\Support\SegmentGuard::vendorLockSources((int) $vendor->id, (int) $vendor->client_id);
        $poNames  = $lockSrc['po'];
        $spiNames = $lockSrc['spi'];
        $prodNames = \App\Support\SegmentGuard::productMappingSegmentNames(
            \App\Models\Vendor::class,
            (int) $vendor->id,
            (int) $vendor->client_id,
        );

        $allNames = array_values(array_unique(array_merge($poNames, $spiNames, $prodNames)));
        $rows = empty($allNames) ? collect() : DB::table('clm_segments')
            ->whereIn('name', $allNames)
            ->where(fn($q) => $q->where('client_id', $vendor->client_id)->orWhereNull('client_id'))
            ->get(['id', 'name']);
        $idsFor = function (array $names) use ($rows) {
            $want = array_map(fn($n) => mb_strtolower(trim((string) $n)), $names);
            return $rows->filter(fn($r) => in_array(mb_strtolower(trim((string) $r->name)), $want, true))
                ->pluck('id')->map(fn($i) => (string) $i)->values()->all();
        };
        $poIds   = $idsFor($poNames);
        $spiIds  = $idsFor($spiNames);
        $prodIds = $idsFor($prodNames);

        $data['locked_segments'] = array_values(array_unique(array_merge($poIds, $spiIds, $prodIds)));
        $reasons = [];
        foreach ($prodIds as $i) {
            $reasons[$i] = 'product';
        }
        foreach ($spiIds  as $i) {
            $reasons[$i] = 'spi';
        }
        foreach ($poIds   as $i) {
            $reasons[$i] = 'po';
        }
        $data['locked_segment_reasons'] = $reasons;

        $data['state_locked'] = \App\Models\P2p\PurchaseOrder::withoutGlobalScope('tenant')
            ->where('client_id', $vendor->client_id)->where('vendor_id', $vendor->id)->exists();

        $data['vendor_type_lock'] = \App\Support\SegmentGuard::vendorCommittedDocument(
            (int) $vendor->id,
            (int) $vendor->client_id,
        );

        $segReq = [];
        foreach (DB::table('vendor_segments as vsg')->join('clm_segments as cs', 'cs.id', '=', 'vsg.segment_id')->where('vsg.vendor_id', $vendor->id)->get(['cs.id', 'cs.name']) as $s) {
            $segReq[(string) $s->id] = \App\Support\SegmentGuard::docKeys((int) $vendor->client_id, $s->name);
        }
        $data['segment_required_doc_keys'] = $segReq;
        $data['uploaded_doc_keys'] = \App\Support\SegmentGuard::uploadedDocKeys(
            \App\Models\Vendor::class,
            (int) $vendor->id,
            (int) $vendor->client_id,
        );

        return response()->json([
            'data'            => $data,
            'segment_uploads' => $segmentUploads ?: ['data' => [], 'by_category' => [], 'count' => 0],
        ]);
    }

    private function safeDelegate(\Closure $call): ?array
    {
        try {
            $res = $call();
            $decoded = json_decode($res->getContent(), true);
            return is_array($decoded) ? $decoded : null;
        } catch (\Throwable $e) {
            \Log::warning('VendorController::show safeDelegate failed: ' . $e->getMessage());
            return null;
        }
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);

        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'delete')) {
            return response()->json(['message' => $denial], 403);
        }

        $this->deleteAllVendorFiles($vendor);

        $vendor->delete();
        MasterBundleCache::bump();
        return response()->json(['id' => $vendor->id, 'deleted' => true]);
    }

    public function storeIdentity(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'id'                       => 'nullable|integer|exists:vendors,id',
            'company_name'             => 'required|string|max:255',
            'legal_name'               => 'required|string|max:255',
            'website'                  => 'nullable|string|max:500',
            'gst_applicable'           => 'nullable|string|in:Yes,No',
            'gst_number'               => 'nullable|string|max:30',
            'vendor_type_id'           => 'nullable|integer|exists:master_vendor_types,id',
            'vendor_type'              => 'nullable|string|max:255',
            'risk_level_id'            => 'nullable|integer|exists:master_risk_levels,id',
            'vendor_behaviour_id'      => 'nullable|integer|exists:master_vendor_behaviour,id',
            'vendor_behaviour'         => 'nullable|string|max:255',
            'segment_id'               => 'nullable|integer|exists:clm_segments,id',
            'segment_ids'              => 'nullable',
            'classification_id'        => 'nullable|integer|exists:master_customer_classifications,id',
            'compliance_behaviour_id'  => 'nullable|integer|exists:master_compliance_behaviours,id',
            'supplier_category'        => 'nullable|string|in:star,general,high_risk,blacklisted',
            'address'                  => 'nullable|array',
            'address.address_line'     => 'nullable|string|max:1000',
            'address.country_id'       => 'nullable|integer|exists:master_countries,id',
            'address.state_id'         => 'nullable|integer|exists:master_states,id',
            'address.state_code'       => 'nullable|string|max:32',
            'address.city'             => 'nullable|string|max:128',
            'address.pincode'          => 'nullable|string|max:16',
            'address.google_location'  => [
                'nullable',
                'string',
                'max:1000',
                'regex:/^https?:\/\/[^\s]+$/i',
            ],
        ], [], self::FIELD_LABELS);

        $address = $data['address'] ?? null;
        unset($data['address']);

        if (!empty($data['vendor_type'])) {
            $vt = VendorTypes::firstOrCreate(
                ['client_id' => $user->client_id, 'name' => trim($data['vendor_type'])],
                ['status' => 'Active', 'created_by' => $user->id],
            );
            $data['vendor_type_id'] = $vt->id;
        }
        unset($data['vendor_type']);

        if (!empty($data['id']) && array_key_exists('vendor_type_id', $data)) {
            $existing = Vendor::query()->forUser($user)->find($data['id']);
            if ($existing && (int) $existing->vendor_type_id !== (int) $data['vendor_type_id']) {
                $held = \App\Support\SegmentGuard::vendorCommittedDocument(
                    (int) $existing->id,
                    (int) $existing->client_id,
                );
                if ($held) {
                    $doc = $held === 'po' ? 'a Purchase Order' : 'a Supplier Invoice';
                    throw \Illuminate\Validation\ValidationException::withMessages([
                        'vendor_type' => ["This supplier is already on {$doc}, so its Supplier Type can no longer be changed."],
                    ]);
                }
            }
        }

        if (!empty($data['vendor_behaviour'])) {
            $vb = \App\Models\Masters\VendorBehaviour::firstOrCreate(
                ['client_id' => $user->client_id, 'name' => trim($data['vendor_behaviour'])],
                ['branch_id' => $user->branch_id, 'status' => 'Active', 'created_by' => $user->id],
            );
            $data['vendor_behaviour_id'] = $vb->id;
        }
        unset($data['vendor_behaviour']);

        $segIds = $this->normalizeSegmentIds($request->input('segment_ids'), $data['segment_id'] ?? null, (int) $user->client_id);
        $data['segment_id'] = $segIds[0] ?? null;
        unset($data['segment_ids']);

        $countryId = $address['country_id'] ?? null;

        if (!$countryId && !empty($data['id'])) {
            $countryId = DB::table('vendor_addresses')
                ->where('vendor_id', (int) $data['id'])
                ->where('is_primary', true)
                ->value('country_id');
        }
        $isIndia = $countryId && DB::table('master_countries')
            ->where('id', $countryId)->whereRaw('LOWER(name) = ?', ['india'])->exists();
        $isIntl  = $countryId && !$isIndia;

        if (!$isIntl && ($data['gst_applicable'] ?? null) === 'No') {
            $data['gst_number'] = null;
        }

        if ($isIntl) {
            $tin = trim((string) ($data['gst_number'] ?? ''));
            if ($tin === '') {
                return response()->json([
                    'message' => 'Tax Identification Number (TIN) is required for an international supplier.',
                    'errors'  => ['gst_number' => ['Tax Identification Number (TIN) is required.']],
                ], 422);
            }
            if (!preg_match('#^[A-Za-z0-9-/. ]{3,30}$#', $tin)) {
                return response()->json([
                    'message' => 'Tax Identification Number (TIN) is invalid.',
                    'errors'  => ['gst_number' => ['TIN must be 3–30 characters: letters, digits, hyphen, slash, period and spaces only.']],
                ], 422);
            }
            $data['gst_number'] = strtoupper($tin);
        }

        if ($isIndia && ($data['gst_applicable'] ?? null) !== 'Yes') {
            return response()->json([
                'message' => 'GST is mandatory for an Indian supplier — set GST Applicable to Yes.',
                'errors'  => ['gst_applicable' => ['GST is mandatory for an Indian supplier.']],
            ], 422);
        }

        if (($data['gst_applicable'] ?? null) === 'Yes' && !empty($data['gst_number'])) {
            $stateCode = trim((string) ($data['address']['state_code'] ?? ''));
            if ($stateCode !== '') {
                $expected = str_pad($stateCode, 2, '0', STR_PAD_LEFT);
                if (substr(strtoupper(trim((string) $data['gst_number'])), 0, 2) !== $expected) {
                    return response()->json([
                        'message' => "GST Number must start with the state code {$expected}.",
                        'errors'  => ['gst_number' => ["GST Number must start with the state code {$expected}."]],
                    ], 422);
                }
            }
        }

        $isEdit = isset($data['id']);
        $vendor = null;
        if ($isEdit) {
            $vendor = Vendor::query()->forUser($user)->findOrFail($data['id']);
            if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
                return response()->json(['message' => $denial], 403);
            }
        }

        if (($data['gst_applicable'] ?? null) === 'Yes' && !empty($data['gst_number'])) {
            $this->assertGstUniqueForClient(
                (int) $user->client_id,
                $data['gst_number'],
                $isEdit ? (int) $data['id'] : null,
            );
        }

        $oldSegIds = ($isEdit && $vendor)
            ? DB::table('vendor_segments')->where('vendor_id', $vendor->id)->pluck('segment_id')->all()
            : [];
        $orphanUploads     = collect();
        $confirmDocRemoval = $request->boolean('confirm_segment_doc_removal');
        if ($isEdit && $vendor) {
            $removedIds = array_values(array_diff(
                array_map('intval', $oldSegIds),
                array_map('intval', $segIds),
            ));
            if (!empty($removedIds)) {
                $removedNames   = DB::table('clm_segments')->whereIn('id', $removedIds)->pluck('name')->all();
                $remainingNames = DB::table('clm_segments')->whereIn('id', array_map('intval', $segIds))->pluck('name')->all();
                $mapBlocked = \App\Support\SegmentGuard::blockedByProductMapping(\App\Models\Vendor::class, (int) $vendor->id, (int) $vendor->client_id, $removedNames);
                if (!empty($mapBlocked)) {
                    return response()->json([
                        'message' => 'This Segment cannot be removed because the Supplier is currently associated with one or more Products under this Segment. Please remove the Product dependency before removing this Segment.',
                        'errors'  => ['segment_ids' => ['Segment(s) mapped to a supplier product cannot be removed: ' . implode(', ', $mapBlocked) . '.']],
                    ], 422);
                }
                $blocked = \App\Support\SegmentGuard::blockedByCompletedDocs(\App\Models\Vendor::class, (int) $vendor->id, (int) $vendor->client_id, $removedNames);
                if (!empty($blocked)) {
                    return response()->json([
                        'message' => 'Cannot remove ' . implode(', ', $blocked) . ' — a product on a Purchase Order or Supplier Invoice belongs to it.',
                        'errors'  => ['segment_ids' => ['Segment(s) used by a PO / Supplier Invoice product cannot be removed: ' . implode(', ', $blocked) . '.']],
                    ], 422);
                }
                $orphanUploads = \App\Support\SegmentGuard::orphanUploads(\App\Models\Vendor::class, (int) $vendor->id, (int) $vendor->client_id, $removedNames, $remainingNames);
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
            }
        }

        DB::transaction(function () use (&$vendor, $isEdit, $user, $data, $segIds, $address, $oldSegIds, $orphanUploads, $confirmDocRemoval) {
            if ($isEdit) {
                $vendor->fill($data);
                $vendor->step_completed = max((int) $vendor->step_completed, 1);
                $vendor->save();
            } else {
                $vendor = new Vendor($data);
                $vendor->client_id  = $user->client_id;
                $vendor->branch_id  = $user->branch_id;
                $vendor->created_by = $user->id;
                $vendor->status     = 'draft';
                $vendor->step_completed = 1;
                $vendor->save();
                if ($user->client_id !== null) {
                    DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
                }
                $vendor->vendor_code = $this->nextVendorCode($user->client_id, $user->branch_id);
                $vendor->save();
            }

            $vendor->segments()->sync($segIds);

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

            if (is_array($address) && array_filter($address, fn($v) => $v !== null && $v !== '')) {
                $addrFields = [
                    'address_line' => $address['address_line'] ?? null,
                    'country_id'   => $address['country_id']   ?? null,
                    'state_id'     => $address['state_id']     ?? null,
                    'state_code'   => $address['state_code']   ?? null,
                    'city'         => $address['city']         ?? null,
                    'pincode'      => $address['pincode']      ?? null,
                    'google_location' => $address['google_location'] ?? null,
                ];
                $primary = $vendor->addresses()->where('is_primary', true)->first();
                if ($primary) {
                    $primary->fill($addrFields);
                    if (!$primary->address_type) $primary->address_type = 'Registered Office';
                    $primary->save();
                } else {
                    $vendor->addresses()->create(array_merge($addrFields, [
                        'address_type' => 'Registered Office',
                        'is_primary'   => true,
                        'contact_name' => '',
                    ]));
                }
            }
        });

        MasterBundleCache::bump();

        $vendor->load(self::SHOW_WITH);
        return response()->json(['data' => $this->shape($vendor)]);
    }

    private function normalizeSegmentIds($raw, $fallbackId = null, ?int $clientId = null): array
    {
        $ids = collect(is_array($raw) ? $raw : (is_string($raw) ? explode(',', $raw) : []))
            ->map(fn($v) => (int) trim((string) $v))
            ->filter(fn($v) => $v > 0);

        if ($ids->isEmpty() && $fallbackId) {
            $ids = collect([(int) $fallbackId]);
        }

        $ids = $ids->unique()->values();
        if ($ids->isEmpty()) return [];

        $existing = DB::table('clm_segments')
            ->whereIn('id', $ids->all())
            ->when($clientId, fn($q) => $q->where('client_id', $clientId))
            ->pluck('id')->flip();
        return $ids->filter(fn($id) => $existing->has($id))->values()->all();
    }

    public function storeContacts(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
            'primary_address'                          => 'required|array',
            'primary_address.address_type'             => 'nullable|string|max:64',
            'primary_address.address_line'             => 'nullable|string|max:1000',
            'primary_address.country_id'               => 'nullable|integer|exists:master_countries,id',
            'primary_address.state_id'                 => 'nullable|integer|exists:master_states,id',
            'primary_address.state_code'               => 'nullable|string|max:32',
            'primary_address.city'                     => 'nullable|string|max:128',
            'primary_address.pincode'                  => 'nullable|string|max:16',
            'primary_address.google_location'          => [
                'nullable',
                'string',
                'max:1000',
                'regex:/^https?:\/\/[^\s]+$/i',
            ],
            'primary_address.contact_name'             => 'required|string|max:255',
            'primary_address.designation'              => 'nullable|string|max:128',
            'primary_address.contact_no'               => 'nullable|string|max:32',
            'primary_address.email'                    => 'nullable|email|max:255',
            'primary_address.whatsapp_enabled'         => 'nullable|boolean',
            'primary_address.attachment_path'          => 'nullable|string|max:500',
            'primary_attachment'                       => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,
            'convert_supplier_id'                      => 'nullable|integer',
        ], [], self::FIELD_LABELS);

        if (! empty($data['convert_supplier_id'])) {
            $source = \App\Models\P2p\Supplier::where('client_id', $user->client_id)->find($data['convert_supplier_id']);
            if (! $source || ($source->converted_vendor_id && (int) $source->converted_vendor_id !== (int) $vendor->id)) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'convert_supplier_id' => ['This New Supplier cannot be converted into this supplier.'],
                ]);
            }
            Vendor::$convertingSupplierId = (int) $source->id;
        }

        $oldPrimaryAttachment = optional($vendor->addresses()->where('is_primary', true)->first())->attachment_path;

        try {
            DB::transaction(function () use ($request, $vendor, $data, $oldPrimaryAttachment) {
                $vendor->addresses()->where('is_primary', true)->delete();

                $primaryAttachment = $this->absorbFile(
                    $request,
                    'primary_attachment',
                    $vendor->id,
                    'contact',
                    $data['primary_address']['attachment_path'] ?? null,
                );

                $primary = new VendorAddress(array_merge($data['primary_address'], [
                    'vendor_id'       => $vendor->id,
                    'is_primary'      => true,
                    'attachment_path' => $primaryAttachment,
                ]));
                $primary->save();

                $primaryEmail = $data['primary_address']['email'] ?? null;
                $primaryEmail = $primaryEmail === null ? null : Str::lower(trim($primaryEmail));
                $data['primary_address']['email'] = $primaryEmail;
                $vendor->primary_email  = $primaryEmail;
                $vendor->step_completed = max((int) $vendor->step_completed, 1);
                $vendor->save();

                if ($oldPrimaryAttachment && $oldPrimaryAttachment !== $primaryAttachment) {
                    try {
                        Storage::disk('public')->delete($oldPrimaryAttachment);
                    } catch (\Throwable $e) {
                    }
                }
            });
        } finally {
            Vendor::$convertingSupplierId = null;
        }

        $vendor->load(self::SHOW_WITH);
        return response()->json(['data' => $this->shape($vendor)]);
    }

    public function storeContact(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $this->validateContact($request);
        $path = $this->absorbFile($request, 'attachment', $vendor->id, 'contact', $data['attachment_path'] ?? null);

        $row = VendorAddress::create([
            'vendor_id'        => $vendor->id,
            'is_primary'       => false,
            'contact_name'     => $data['contact_name'],
            'designation'      => $data['designation'] ?? null,
            'contact_no'       => $data['contact_no'] ?? null,
            'email'            => $data['email'] ?? null,
            'whatsapp_enabled' => $data['whatsapp_enabled'] ?? false,
            'attachment_path'  => $path,
        ]);

        return response()->json(['data' => $this->shapeContact($row)], 201);
    }

    public function updateContact(Request $request, int $id, int $contactId): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $row = VendorAddress::where('vendor_id', $vendor->id)
            ->where('is_primary', false)
            ->findOrFail($contactId);

        $data = $this->validateContact($request);
        $old = $row->attachment_path;
        $removeAttachment = filter_var($request->input('remove_attachment', false), FILTER_VALIDATE_BOOLEAN);
        $fallback = $removeAttachment ? null : ($data['attachment_path'] ?? $old);
        $path = $this->absorbFile($request, 'attachment', $vendor->id, 'contact', $fallback);

        $row->update([
            'contact_name'     => $data['contact_name'],
            'designation'      => $data['designation'] ?? null,
            'contact_no'       => $data['contact_no'] ?? null,
            'email'            => $data['email'] ?? null,
            'whatsapp_enabled' => $data['whatsapp_enabled'] ?? false,
            'attachment_path'  => $path,
        ]);

        if ($old && $old !== $path) {
            try {
                Storage::disk('public')->delete($old);
            } catch (\Throwable $e) {
            }
        }

        return response()->json(['data' => $this->shapeContact($row->fresh())]);
    }

    public function destroyContact(Request $request, int $id, int $contactId): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $row = VendorAddress::where('vendor_id', $vendor->id)
            ->where('is_primary', false)
            ->findOrFail($contactId);

        $old = $row->attachment_path;
        $row->delete();
        if ($old) {
            try {
                Storage::disk('public')->delete($old);
            } catch (\Throwable $e) {
            }
        }

        return response()->json(['message' => 'Contact deleted']);
    }

    private function validateContact(Request $request): array
    {
        $data = $request->validate([
            'contact_name'     => 'required|string|max:255',
            'designation'      => 'nullable|string|max:128',
            'contact_no'       => 'nullable|string|max:32',
            'email'            => 'nullable|email|max:255',
            'whatsapp_enabled' => 'nullable|boolean',
            'attachment'       => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,
            'attachment_path'  => 'nullable|string|max:500',
        ], [], self::FIELD_LABELS);

        if (isset($data['email'])) {
            $data['email'] = $data['email'] === null ? null : Str::lower(trim($data['email']));
        }

        return $data;
    }

    private function shapeContact(VendorAddress $a): array
    {
        return [
            'id'               => $a->id,
            'contact_name'     => $a->contact_name,
            'designation'      => $a->designation,
            'contact_no'       => $a->contact_no,
            'email'            => $a->email,
            'whatsapp_enabled' => (bool) $a->whatsapp_enabled,
            'attachment_path'  => $a->attachment_path,
            'attachment_url'   => file_url($a->attachment_path),
        ];
    }

    public function storeBankAccount(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $this->validateBank($request, $vendor);

        if (VendorBankAccount::where('vendor_id', $vendor->id)
            ->where('account_number', $data['account_number'])
            ->exists()
        ) {
            return response()->json([
                'message' => 'This account number is already added for this supplier.',
                'errors'  => ['account_number' => ['This account number is already added for this supplier.']],
            ], 422);
        }

        $path = $this->absorbFile($request, 'cheque', $vendor->id, 'cheque', $data['cheque_path'] ?? null);

        $row = VendorBankAccount::create([
            'vendor_id'      => $vendor->id,
            'bank_name'      => $data['bank_name'],
            'branch_name'    => $data['branch_name'],
            'account_number' => $data['account_number'],
            'ifsc'           => strtoupper($data['ifsc']),
            'branch_address' => $data['branch_address'] ?? null,
            'cheque_path'    => $path,
            'created_by'     => $user->id,
        ]);

        return response()->json(['data' => $this->shapeBank($row)], 201);
    }

    public function updateBankAccount(Request $request, int $id, int $bankId): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $row = VendorBankAccount::where('vendor_id', $vendor->id)->findOrFail($bankId);
        $data = $this->validateBank($request, $vendor);

        if (VendorBankAccount::where('vendor_id', $vendor->id)
            ->where('account_number', $data['account_number'])
            ->where('id', '!=', $row->id)
            ->exists()
        ) {
            return response()->json([
                'message' => 'This account number is already added for this supplier.',
                'errors'  => ['account_number' => ['This account number is already added for this supplier.']],
            ], 422);
        }

        $old = $row->cheque_path;
        $path = $this->absorbFile($request, 'cheque', $vendor->id, 'cheque', $data['cheque_path'] ?? $old);

        $row->update([
            'bank_name'      => $data['bank_name'],
            'branch_name'    => $data['branch_name'],
            'account_number' => $data['account_number'],
            'ifsc'           => strtoupper($data['ifsc']),
            'branch_address' => $data['branch_address'] ?? null,
            'cheque_path'    => $path,
        ]);

        if ($old && $old !== $path) {
            try {
                Storage::disk('public')->delete($old);
            } catch (\Throwable $e) {
            }
        }

        return response()->json(['data' => $this->shapeBank($row->fresh())]);
    }

    public function destroyBankAccount(Request $request, int $id, int $bankId): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $row = VendorBankAccount::where('vendor_id', $vendor->id)->findOrFail($bankId);
        $old = $row->cheque_path;
        $row->forceDelete();
        if ($old) {
            try {
                Storage::disk('public')->delete($old);
            } catch (\Throwable $e) {
            }
        }

        return response()->json(['message' => 'Bank account deleted']);
    }

    private function validateBank(Request $request, ?Vendor $vendor = null): array
    {
        $isIntl = $vendor !== null && !$this->vendorIsIndian($vendor);

        $routingRule = $isIntl
            ? 'regex:/^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/'
            : 'regex:/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/';
        $routingMsg = $isIntl
            ? 'SWIFT / BIC is invalid (8 or 11 characters: 6 letters then alphanumeric, e.g. HDFCINBB or HDFCINBBXXX).'
            : 'IFSC Code is invalid (format: 4 letters + 0 + 6 characters, e.g. HDFC0001234).';

        $accountRule = $isIntl
            ? 'regex:/^[A-Za-z0-9]{8,34}$/'
            : 'regex:/^[0-9]{9,18}$/';
        $accountMsg = $isIntl
            ? 'Account Number must be 8–34 letters or digits, with no spaces.'
            : 'Account Number must be 9–18 digits.';

        return $request->validate([
            'bank_name'      => 'required|string|max:255',
            'branch_name'    => 'required|string|max:255',
            'account_number' => ['required', 'string', $accountRule],
            'ifsc'           => ['required', 'string', $routingRule],
            'branch_address' => 'nullable|string|max:500',
            'cheque'         => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,
            'cheque_path'    => 'nullable|string|max:500',
        ], [
            'account_number.regex' => $accountMsg,
            'ifsc.regex'           => $routingMsg,
        ], [], self::FIELD_LABELS);
    }

    private function vendorIsIndian(Vendor $vendor): bool
    {
        $countryId = $vendor->primaryAddress?->country_id
            ?? $vendor->addresses()->where('is_primary', true)->value('country_id');
        if (!$countryId) return true;
        return DB::table('master_countries')
            ->where('id', $countryId)
            ->whereRaw('LOWER(name) = ?', ['india'])
            ->exists();
    }

    private function shapeBank(VendorBankAccount $b): array
    {
        return [
            'id'             => $b->id,
            'bank_name'      => $b->bank_name,
            'branch_name'    => $b->branch_name,
            'account_number' => $b->account_number,
            'ifsc'           => $b->ifsc,
            'branch_address' => $b->branch_address,
            'cheque_path'    => $b->cheque_path,
            'cheque_url'     => file_url($b->cheque_path),
        ];
    }

    public function storeGstScrutiny(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $this->validateGst($request);
        $gst = strtoupper($data['gst_number']);
        $this->assertGstNumberUnique($vendor, $gst);
        $row = VendorGstScrutiny::create([
            'vendor_id'               => $vendor->id,
            'gst_number'              => $gst,
            'status'                  => $data['status'] ?? 'Active',
            'last_filing_date'        => $data['last_filing_date'] ?? null,
            'prev_non_gst_2a_invoice' => $data['prev_non_gst_2a_invoice'] ?? null,
            'red_flags'               => $data['red_flags'] ?? null,
            'created_by'              => $user->id,
        ]);

        VendorGstScrutiny::where('vendor_id', $vendor->id)->update(['gst_number' => $gst]);

        return response()->json(['data' => $this->shapeGst($row)], 201);
    }

    public function updateGstScrutiny(Request $request, int $id, int $gstId): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $row = VendorGstScrutiny::where('vendor_id', $vendor->id)->findOrFail($gstId);
        $data = $this->validateGst($request);
        $gst = strtoupper($data['gst_number']);
        $this->assertGstNumberUnique($vendor, $gst);
        $row->update([
            'gst_number'              => $gst,
            'status'                  => $data['status'] ?? 'Active',
            'last_filing_date'        => $data['last_filing_date'] ?? null,
            'prev_non_gst_2a_invoice' => $data['prev_non_gst_2a_invoice'] ?? null,
            'red_flags'               => $data['red_flags'] ?? null,
        ]);

        VendorGstScrutiny::where('vendor_id', $vendor->id)->update(['gst_number' => $gst]);

        return response()->json(['data' => $this->shapeGst($row->fresh())]);
    }

    public function destroyGstScrutiny(Request $request, int $id, int $gstId): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        VendorGstScrutiny::where('vendor_id', $vendor->id)->findOrFail($gstId)->forceDelete();
        return response()->json(['message' => 'GST scrutiny deleted']);
    }

    private function assertGstNumberUnique(Vendor $vendor, string $gstNumber): void
    {
        $this->assertGstUniqueForClient((int) $vendor->client_id, $gstNumber, (int) $vendor->id);
    }

    private function assertGstUniqueForClient(int $clientId, string $gstNumber, ?int $exceptVendorId = null): void
    {
        $gst = strtoupper(trim($gstNumber));
        if ($gst === '') return;

        $onVendor = Vendor::query()
            ->where('client_id', $clientId)
            ->where('gst_number', $gst)
            ->when($exceptVendorId, fn($q) => $q->where('id', '!=', $exceptVendorId))
            ->exists();

        $onScrutiny = VendorGstScrutiny::query()
            ->where('gst_number', $gst)
            ->when($exceptVendorId, fn($q) => $q->where('vendor_id', '!=', $exceptVendorId))
            ->whereHas('vendor', fn($q) => $q->where('client_id', $clientId))
            ->exists();

        if ($onVendor || $onScrutiny) {
            abort(response()->json([
                'message' => "GST number {$gst} is already registered to another supplier.",
                'errors'  => ['gst_number' => ['This GST number is already registered to another supplier.']],
            ], 422));
        }
    }

    private function validateGst(Request $request): array
    {
        return $request->validate([
            'gst_number'              => 'required|string|max:16',
            'status'                  => ['nullable', Rule::in(['Active', 'Inactive'])],
            'last_filing_date'        => 'nullable|date',
            'prev_non_gst_2a_invoice' => 'nullable|string|max:255',
            'red_flags'               => 'nullable|string|max:2000',
        ], [], self::FIELD_LABELS);
    }

    private function shapeGst(VendorGstScrutiny $g): array
    {
        return [
            'id'                       => $g->id,
            'gst_number'               => $g->gst_number,
            'status'                   => $g->status,
            'scrutiny_date'            => optional($g->created_at)->toDateString(),
            'last_filing_date'         => optional($g->last_filing_date)->toDateString(),
            'prev_non_gst_2a_invoice'  => $g->prev_non_gst_2a_invoice,
            'red_flags'                => $g->red_flags,
        ];
    }

    public function storeKyc(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
            'due_diligence'                     => 'nullable|array',
            'due_diligence.*.code'              => 'nullable|string|max:32',
            'due_diligence.*.document_name'     => 'required|string|max:255',
            'due_diligence.*.issuing_authority' => 'nullable|string|max:255',
            'due_diligence.*.expiry'            => 'nullable|string|max:32',
            'due_diligence.*.mandatory'         => 'nullable|boolean',
            'due_diligence.*.existing_path'     => 'nullable|string|max:500',
            'dd_files'                          => 'nullable|array',
            'dd_files.*'                        => 'file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,

            'owner_kyc'                         => 'nullable|array',
            'owner_kyc.*.code'                  => 'nullable|string|max:32',
            'owner_kyc.*.document_name'         => 'required|string|max:255',
            'owner_kyc.*.issuing_authority'     => 'nullable|string|max:255',
            'owner_kyc.*.document_number'       => 'nullable|string|max:128',
            'owner_kyc.*.issue_date'            => 'nullable|date',
            'owner_kyc.*.expiry'                => 'nullable|string|max:32',
            'owner_kyc.*.status'                => ['nullable', Rule::in(['Active', 'Inactive'])],
            'owner_kyc.*.existing_path'         => 'nullable|string|max:500',
            'owner_files'                       => 'nullable|array',
            'owner_files.*'                     => 'file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,

            'trade_licenses'                          => 'nullable|array',
            'trade_licenses.*.code'                   => 'nullable|string|max:32',
            'trade_licenses.*.license_type_id'        => 'nullable|integer|exists:master_license_name,id',
            'trade_licenses.*.license_number'         => 'nullable|string|max:128',
            'trade_licenses.*.issuing_authority'      => 'nullable|string|max:255',
            'trade_licenses.*.issue_date'             => 'nullable|date',
            'trade_licenses.*.expiry_date'            => 'nullable|date',
            'trade_licenses.*.existing_path'          => 'nullable|string|max:500',
            'tl_files'                                => 'nullable|array',
            'tl_files.*'                              => 'file|mimes:jpg,jpeg,png,webp,pdf|max:' . self::MAX_UPLOAD_KB,
        ], [], self::FIELD_LABELS);

        DB::transaction(function () use ($vendor, $data, $request, $user) {
            $userId = $user?->id;

            $keptPaths = collect();
            foreach (($data['due_diligence'] ?? [])  as $r) $keptPaths->push($r['existing_path'] ?? null);
            foreach (($data['owner_kyc'] ?? [])      as $r) $keptPaths->push($r['existing_path'] ?? null);
            foreach (($data['trade_licenses'] ?? []) as $r) $keptPaths->push($r['existing_path'] ?? null);

            $oldPaths = collect()
                ->merge($vendor->documents()->pluck('attachment_path'))
                ->merge($vendor->owners()->pluck('attachment_path'));
            foreach ($oldPaths as $p) {
                if ($p && !$keptPaths->contains($p)) {
                    Storage::disk('public')->delete($p);
                }
            }

            $vendor->documents()->forceDelete();
            $vendor->owners()->forceDelete();

            foreach (($data['due_diligence'] ?? []) as $i => $row) {
                $path = $this->absorbFile($request, "dd_files.$i", $vendor->id, 'dd', $row['existing_path'] ?? null);
                VendorDocument::create([
                    'vendor_id'         => $vendor->id,
                    'kind'              => 'dd',
                    'code'              => $row['code'] ?? null,
                    'document_name'     => $row['document_name'] ?? null,
                    'issuing_authority' => $row['issuing_authority'] ?? null,
                    'expiry'            => $row['expiry'] ?? null,
                    'mandatory'         => (bool) ($row['mandatory'] ?? false),
                    'attachment_path'   => $path,
                    'created_by'        => $userId,
                ]);
            }

            foreach (($data['owner_kyc'] ?? []) as $i => $row) {
                $path = $this->absorbFile($request, "owner_files.$i", $vendor->id, 'owner', $row['existing_path'] ?? null);
                VendorOwner::create([
                    'vendor_id'         => $vendor->id,
                    'code'              => $row['code'] ?? null,
                    'document_name'     => $row['document_name'] ?? '',
                    'issuing_authority' => $row['issuing_authority'] ?? null,
                    'document_number'   => $row['document_number'] ?? null,
                    'issue_date'        => $row['issue_date'] ?? null,
                    'expiry'            => $row['expiry'] ?? null,
                    'status'            => $row['status'] ?? 'Active',
                    'attachment_path'   => $path,
                    'created_by'        => $userId,
                ]);
            }

            foreach (($data['trade_licenses'] ?? []) as $i => $row) {
                $path = $this->absorbFile($request, "tl_files.$i", $vendor->id, 'tl', $row['existing_path'] ?? null);
                VendorDocument::create([
                    'vendor_id'         => $vendor->id,
                    'kind'              => 'tl',
                    'code'              => $row['code'] ?? null,
                    'license_type_id'   => $row['license_type_id'] ?? null,
                    'license_number'    => $row['license_number'] ?? null,
                    'issuing_authority' => $row['issuing_authority'] ?? null,
                    'issue_date'        => $row['issue_date'] ?? null,
                    'expiry_date'       => $row['expiry_date'] ?? null,
                    'attachment_path'   => $path,
                    'created_by'        => $userId,
                ]);
            }

            $vendor->step_completed = max((int) $vendor->step_completed, 2);
            if ($vendor->status === 'draft') $vendor->status = 'inactive';
            $vendor->save();
        });

        $vendor->load(self::SHOW_WITH);
        return response()->json(['data' => $this->shape($vendor)]);
    }

    public function storeProducts(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
            'mappings'                    => 'present|array',
            'mappings.*.product_id'       => 'required|integer|exists:products,id',
            'mappings.*.batch_serial_lot' => 'nullable|string|max:128',
            'mappings.*.purchase_price'   => 'required|numeric|min:0',
            'mappings.*.gst_percentage'   => 'nullable|numeric|min:0',
            'mappings.*.gst_amount'       => 'nullable|numeric|min:0',
            'mappings.*.total_amount'     => 'nullable|numeric|min:0',
        ], [], self::FIELD_LABELS);

        $productIds = array_column($data['mappings'], 'product_id');
        if (count($productIds) !== count(array_unique($productIds))) {
            return response()->json([
                'message' => 'A product can only be mapped once per supplier.',
            ], 422);
        }

        DB::transaction(function () use ($vendor, $data, $user) {
            $userId = $user?->id;

            $vendor->productMappings()->forceDelete();

            $primary = $vendor->primaryAddress;
            $vendorSnapshot = [
                'vendor_id'      => $vendor->id,
                'vendor_code'    => $vendor->vendor_code,
                'vendor_name'    => $vendor->company_name,
                'vendor_website' => $vendor->website,
                'contact_person' => $primary?->contact_name,
                'contact_no'     => $primary?->contact_no,
                'email'          => $primary?->email ?? $vendor->primary_email,
                'designation'    => $primary?->designation,
            ];

            $nowMappedProductIds = [];

            foreach ($data['mappings'] as $row) {
                $productId = (int) $row['product_id'];
                $nowMappedProductIds[] = $productId;

                VendorProductMapping::create([
                    'vendor_id'        => $vendor->id,
                    'product_id'       => $productId,
                    'batch_serial_lot' => $row['batch_serial_lot'] ?? null,
                    'purchase_price'   => $row['purchase_price'],
                    'gst_percentage'   => $row['gst_percentage'] ?? 0,
                    'gst_amount'       => $row['gst_amount'] ?? 0,
                    'total_amount'     => $row['total_amount'] ?? $row['purchase_price'],
                    'created_by'       => $userId,
                ]);

                \App\Models\ProductVendorMap::updateOrCreate(
                    ['product_id' => $productId, 'vendor_id' => $vendor->id],
                    array_merge($vendorSnapshot, [
                        'purchase_price' => $row['purchase_price'],
                        'gst_percentage' => $row['gst_percentage'] ?? 0,
                        'gst_amount'     => $row['gst_amount'] ?? 0,
                        'total_amount'   => $row['total_amount'] ?? $row['purchase_price'],
                        'map_date'       => now()->toDateString(),
                    ])
                );
            }

            if (!empty($nowMappedProductIds)) {
                \App\Models\Product::whereIn('id', array_unique($nowMappedProductIds))
                    ->update([
                        'status'         => 'active',
                        'step_completed' => DB::raw('GREATEST(step_completed, 4)'),
                    ]);
            }

            \App\Models\ProductVendorMap::where('vendor_id', $vendor->id)
                ->when(!empty($nowMappedProductIds), fn($q) => $q->whereNotIn('product_id', $nowMappedProductIds))
                ->delete();

            if (!empty($nowMappedProductIds)) {
                $vendor->step_completed = 4;
                $vendor->status         = 'active';
                $vendor->save();
            }
        });

        $vendor->load(self::SHOW_WITH);
        return response()->json(['data' => $this->shape($vendor)]);
    }

    private function serviceMapping(): ServiceSupplierMapping
    {
        return app(ServiceSupplierMapping::class);
    }

    private function editableVendor(Request $request, int $id): Vendor|JsonResponse
    {
        $user = $request->user();
        $vendor = Vendor::query()->forUser($user)->with(ServiceSupplierMapping::VENDOR_WITH)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($user, $vendor, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        return $vendor;
    }

    private function vendorServiceMaps(Request $request, Vendor $vendor)
    {
        $visible = $this->serviceMapping()->services($request->user())->select('id');

        return ServiceSupplier::query()
            ->where('vendor_id', $vendor->id)
            ->whereIn('service_id', $visible);
    }

    private function findServiceMap(Request $request, Vendor $vendor, int $mapId): ServiceSupplier
    {
        return $this->vendorServiceMaps($request, $vendor)->with('service')->find($mapId)
            ?? abort(404, 'Service mapping not found for this supplier.');
    }

    private function serviceMapRow(ServiceSupplier $m, Vendor $vendor, ?array $card, $user): array
    {
        $s = $m->service;

        return [
            'id'                   => $m->id,
            'service_id'           => $m->service_id,
            'service_code'         => $s?->code,
            'service_name'         => $s?->name,
            'service_type'         => $s?->service_type,
            'service_type_label'   => $s?->service_type_label,
            'classification'       => $s?->classification,
            'classification_label' => $s?->classification_label,
            'category'             => $s?->category?->name,
            'service_status'       => $s?->status,
            'vendor_id'            => $vendor->id,
            'origin'               => $m->origin ?: SupplierPricing::DOMESTIC,
            'currency'             => $m->currency_code ?: 'INR',
            'price'                => (float) $m->price,
            'exchange_rate'        => $m->exchange_rate !== null ? (float) $m->exchange_rate : null,
            'gst_id'               => $m->gst_id,
            'gst_percentage'       => (float) $m->gst_percentage,
            'gst_amount'           => (float) $m->gst_amount,
            'total_amount'         => (float) $m->total_amount,
            'inr_amount'           => (float) ($m->inr_amount ?? $m->total_amount),
            'remarks'              => $m->remarks,
            'status'               => $m->status ?? 'active',
            'mapped_at'            => $m->created_at,
        ] + $this->serviceMapping()->gstSplit($m, $card, $user);
    }

    private function serviceMapsPayload(Request $request, Vendor $vendor): array
    {
        $vendor->loadMissing(ServiceSupplierMapping::VENDOR_WITH);
        $card = $this->serviceMapping()->vendorCard($vendor);
        $maps = $this->vendorServiceMaps($request, $vendor)
            ->with(['service', 'service.category:id,name'])
            ->orderBy('id')
            ->get();
        $active = $maps->where('status', 'active');

        return [
            'data'    => $maps->map(fn (ServiceSupplier $m) => $this->serviceMapRow($m, $vendor, $card, $request->user()))->values(),
            'summary' => [
                'count'               => $active->count(),
                'domestic_count'      => $active->where('origin', '!=', SupplierPricing::INTERNATIONAL)->count(),
                'international_count' => $active->where('origin', SupplierPricing::INTERNATIONAL)->count(),
                'inactive_count'      => $maps->count() - $active->count(),
                'total_amount'        => round((float) $active->sum(fn ($m) => (float) ($m->inr_amount ?? $m->total_amount)), 2),
            ],
            'meta'    => [
                'vendor_id'               => $vendor->id,
                'vendor_code'             => $vendor->vendor_code,
                'vendor_name'             => $vendor->company_name,
                'supplier_type'           => $card['supplier_type'],
                'supplier_service_type'   => $card['supplier_service_type'],
                'supplier_classification' => $card['supplier_classification'],
                'origin'                  => $card['origin'],
                'country'                 => $card['country'],
                'currency'                => $card['currency'],
            ],
        ];
    }

    private function servicePriceRules(string $p = ''): array
    {
        return [
            "{$p}origin"        => ['nullable', Rule::in(SupplierPricing::ORIGINS)],
            "{$p}price"         => 'required|numeric|gt:0|max:' . SupplierPricing::MAX_PRICE,
            "{$p}gst_id"        => 'nullable|integer',
            "{$p}currency"      => 'nullable|string|size:3|alpha',
            "{$p}exchange_rate" => 'nullable|numeric|gt:0|max:' . SupplierPricing::MAX_RATE,
            "{$p}remarks"       => 'nullable|string|max:1000',
        ];
    }

    private function servicePriceMessages(string $p = ''): array
    {
        return [
            "{$p}price.required"    => "Enter the supplier's price.",
            "{$p}price.gt"          => 'The price must be more than 0.',
            "{$p}price.max"         => 'The price cannot be more than ' . number_format(SupplierPricing::MAX_PRICE, 2) . '.',
            "{$p}exchange_rate.gt"  => 'The exchange rate must be more than 0.',
            "{$p}exchange_rate.max" => 'The exchange rate cannot be more than ' . SupplierPricing::MAX_RATE . '.',
            "{$p}currency.size"     => 'Pick a currency (3-letter code, e.g. USD).',
        ];
    }

    public function serviceMappings(Request $request, int $id): JsonResponse
    {
        $vendor = Vendor::query()->forUser($request->user())->findOrFail($id);

        return response()->json($this->serviceMapsPayload($request, $vendor));
    }

    public function storeServices(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $vendor = $this->editableVendor($request, $id);
        if ($vendor instanceof JsonResponse) return $vendor;

        $data = $request->validate([
            'mappings'              => 'present|array',
            'mappings.*.service_id' => 'required|integer|distinct',
        ] + $this->servicePriceRules('mappings.*.'), $this->servicePriceMessages('mappings.*.') + [
            'mappings.*.service_id.distinct' => 'A service can only be mapped once per supplier.',
        ]);

        $mapping = $this->serviceMapping();
        $ids = array_map('intval', array_column($data['mappings'], 'service_id'));
        $services = $ids ? $mapping->services($user)->whereIn('id', $ids)->get()->keyBy('id') : collect();

        $priced = [];
        foreach ($data['mappings'] as $i => $row) {
            $service = $services->get((int) $row['service_id']);
            if (!$service) {
                throw ValidationException::withMessages(["mappings.$i.service_id" => ['Unknown service id: ' . $row['service_id'] . '.']]);
            }
            if ($denial = $mapping->serviceEditDenial($user, $service, 'edit')) {
                return response()->json(['message' => $service->code . ': ' . $denial], 403);
            }
            $mapping->assertServes($vendor, $service, "mappings.$i.service_id");
            $priced[$i] = $mapping->priceFields($user, ['vendor_id' => $vendor->id] + $row, $service, "mappings.$i.");
        }

        $dropped = $this->vendorServiceMaps($request, $vendor)
            ->where('status', 'active')
            ->whereNotIn('service_id', $ids ?: [0])
            ->with('service')
            ->get();
        foreach ($dropped as $m) {
            if ($m->service && ($denial = $mapping->serviceEditDenial($user, $m->service, 'edit'))) {
                return response()->json(['message' => $m->service->code . ': ' . $denial], 403);
            }
        }

        DB::transaction(function () use ($data, $services, $priced, $dropped, $vendor, $mapping, $user) {
            $userId = $user?->id;
            foreach ($data['mappings'] as $i => $row) {
                $service = $services->get((int) $row['service_id']);
                $mapping->upsert($service, $vendor->id, $priced[$i] + ['remarks' => $row['remarks'] ?? null], $userId);
                $mapping->completeStageTwo($service, $userId);
            }
            if ($dropped->isNotEmpty()) {
                ServiceSupplier::whereIn('id', $dropped->pluck('id'))
                    ->update(['status' => 'inactive', 'updated_by' => $userId, 'updated_at' => now()]);
            }
        });

        return response()->json($this->serviceMapsPayload($request, $vendor));
    }

    public function updateServiceMapping(Request $request, int $id, int $mapId): JsonResponse
    {
        $user = $request->user();
        $vendor = $this->editableVendor($request, $id);
        if ($vendor instanceof JsonResponse) return $vendor;

        $map = $this->findServiceMap($request, $vendor, $mapId);
        $mapping = $this->serviceMapping();
        if ($denial = $mapping->serviceEditDenial($user, $map->service, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
            'price'         => 'sometimes|required|numeric|gt:0|max:' . SupplierPricing::MAX_PRICE,
            'gst_id'        => 'sometimes|nullable|integer',
            'currency'      => 'sometimes|required|string|size:3|alpha',
            'exchange_rate' => 'sometimes|required|numeric|gt:0|max:' . SupplierPricing::MAX_RATE,
            'remarks'       => 'sometimes|nullable|string|max:1000',
        ], $this->servicePriceMessages());

        $amounts = $mapping->priceFields($user, [
            'vendor_id'     => $vendor->id,
            'origin'        => $map->origin ?: SupplierPricing::DOMESTIC,
            'price'         => $data['price'] ?? $map->price,
            'gst_id'        => $data['gst_id'] ?? null,
            'currency'      => $data['currency'] ?? $map->currency_code,
            'exchange_rate' => $data['exchange_rate'] ?? $map->exchange_rate,
        ], $map->service);

        $map->fill($amounts + ['updated_by' => $user?->id]);
        if (array_key_exists('remarks', $data)) {
            $map->remarks = $data['remarks'];
        }
        $map->save();

        $map->load('service.category:id,name');

        return response()->json($this->serviceMapRow($map, $vendor, $mapping->vendorCard($vendor), $user));
    }

    public function destroyServiceMapping(Request $request, int $id, int $mapId): JsonResponse
    {
        $user = $request->user();
        $vendor = $this->editableVendor($request, $id);
        if ($vendor instanceof JsonResponse) return $vendor;

        $map = $this->findServiceMap($request, $vendor, $mapId);
        $mapping = $this->serviceMapping();
        if ($denial = $mapping->serviceEditDenial($user, $map->service, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        if ($map->status !== 'inactive') {
            $map->fill(['status' => 'inactive', 'updated_by' => $user?->id])->save();
        }
        $map->load('service.category:id,name');

        return response()->json($this->serviceMapRow($map, $vendor, $mapping->vendorCard($vendor), $user) + [
            'service_suppliers_count' => $map->service->activeSuppliers()->count(),
        ]);
    }

    private function nextVendorCode(?int $clientId, ?int $branchId = null): string
    {
        $codes = Vendor::withTrashed()
            ->where('client_id', $clientId)
            ->when(
                $branchId === null,
                fn($q) => $q->whereNull('branch_id'),
                fn($q) => $q->where('branch_id', $branchId)
            )
            ->pluck('vendor_code');

        $max = 0;
        foreach ($codes as $code) {
            if ($code && preg_match('/(\d+)$/', (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }
        return 'S-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }

    private function absorbFile(Request $request, string $inputKey, int $vendorId, string $slug, ?string $existingPath): ?string
    {
        if ($request->hasFile($inputKey)) {
            $file = $request->file($inputKey);
            $ext  = $file->getClientOriginalExtension() ?: 'bin';
            $original = pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME);
            $safe = preg_replace('/[^A-Za-z0-9 ._-]/', '_', (string) $original);
            $safe = trim((string) $safe);
            if ($safe === '') {
                $safe = 'file';
            }
            $name = $slug . '-' . bin2hex(random_bytes(4)) . '__' . $safe . '.' . $ext;
            return $file->storeAs("vendor_documents/{$vendorId}", $name, 'public');
        }
        return $existingPath ?: null;
    }

    private function deleteAllVendorFiles(Vendor $vendor): void
    {
        $paths = collect()
            ->merge($vendor->documents()->pluck('attachment_path'))
            ->merge($vendor->owners()->pluck('attachment_path'))
            ->merge($vendor->bankAccounts()->pluck('cheque_path'))
            ->merge($vendor->addresses()->pluck('attachment_path'))
            ->filter()
            ->unique();
        foreach ($paths as $p) {
            try {
                Storage::disk('public')->delete($p);
            } catch (\Throwable $e) {
            }
        }
    }

    private function shapeLite(Vendor $v): array
    {
        $p = $v->primaryAddress;
        return [
            'id'                => $v->id,
            'vendor_code'       => $v->vendor_code,
            'company_name'      => $v->company_name,
            'legal_name'        => $v->legal_name,
            'primary_email'     => $v->primary_email,
            'gst_number'        => $v->gst_number,
            'supplier_category' => $v->supplier_category,
            'vendor_type_name'  => optional($v->vendorType)->name,
            'risk_level_name'   => optional($v->riskLevel)->name,

            'segments' => $v->segments->isNotEmpty()
                ? $v->segments->map(fn($s) => ['id' => $s->id, 'name' => $s->name])->all()
                : ($v->segment_id ? [['id' => $v->segment_id, 'name' => optional($v->segment)->title]] : []),

            'primary_address' => $p ? [
                'address_line' => $p->address_line,
                'country_name' => optional($p->country)->name,
                'state_name'   => optional($p->state)->name,
                'state_code'   => $p->state_code,
                'city'         => $p->city,
                'contact_name' => $p->contact_name,
                'designation'  => $p->designation,
                'contact_no'   => $p->contact_no,
                'email'        => $p->email,
            ] : null,

            'gst_scrutiny' => $v->gstScrutiny->map(fn($g) => [
                'id'                      => $g->id,
                'gst_number'              => $g->gst_number,
                'status'                  => $g->status,
                'scrutiny_date'           => optional($g->created_at)->toDateString(),
                'last_filing_date'        => optional($g->last_filing_date)->toDateString(),
                'prev_non_gst_2a_invoice' => $g->prev_non_gst_2a_invoice,
                'red_flags'               => $g->red_flags,
            ])->all(),

            'product_mappings' => $v->productMappings->map(fn($m) => [
                'product_id'     => $m->product_id,
                'purchase_price' => (float) $m->purchase_price,
            ])->all(),
        ];
    }

    private function shape(Vendor $v): array
    {
        $primary = $v->primaryAddress;
        return [
            'id'             => $v->id,
            'vendor_code'    => $v->vendor_code,
            'company_name'   => $v->company_name,
            'legal_name'     => $v->legal_name,
            'website'        => $v->website,
            'gst_applicable' => $v->gst_applicable,
            'gst_number'     => $v->gst_number,
            'status'         => $v->status,
            'step_completed' => (int) $v->step_completed,
            'client_id'      => $v->client_id,
            'branch_id'      => $v->branch_id,
            'created_by'     => $v->created_by,
            'primary_email'  => $v->primary_email,

            'vendor_type_id'           => $v->vendor_type_id,
            'vendor_type_name'         => optional($v->vendorType)->name,
            'risk_level_id'            => $v->risk_level_id,
            'risk_level_name'          => optional($v->riskLevel)->name,
            'vendor_behaviour_id'      => $v->vendor_behaviour_id,
            'vendor_behaviour_name'    => optional($v->vendorBehaviour)->name,
            'segment_id'               => $v->segment_id,
            'segment_name'             => optional($v->segment)->title,
            'segment_ids'              => $v->segments->isNotEmpty()
                ? $v->segments->pluck('id')->all()
                : array_values(array_filter([$v->segment_id])),
            'segments'                 => $v->segments->isNotEmpty()
                ? $v->segments->map(fn($s) => ['id' => $s->id, 'name' => $s->name])->all()
                : ($v->segment_id ? [['id' => $v->segment_id, 'name' => optional($v->segment)->title]] : []),
            'compliance_behaviour_id'  => $v->compliance_behaviour_id,
            'supplier_category'        => $v->supplier_category,
            'compliance_behaviour_name' => optional($v->complianceBehaviour)->name,
            'classification_id'        => $v->classification_id,
            'classification_name'      => optional($v->classification)->name,

            'primary_address' => $primary ? [
                'id'                => $primary->id,
                'address_type'      => $primary->address_type,
                'address_line'      => $primary->address_line,
                'country_id'        => $primary->country_id,
                'country_name'      => optional($primary->country)->name,
                'state_id'          => $primary->state_id,
                'state_name'        => optional($primary->state)->name,
                'state_code'        => $primary->state_code,
                'city'              => $primary->city,
                'pincode'           => $primary->pincode,
                'google_location'   => $primary->google_location,
                'contact_name'      => $primary->contact_name,
                'designation'       => $primary->designation,
                'contact_no'        => $primary->contact_no,
                'email'             => $primary->email,
                'whatsapp_enabled'  => (bool) $primary->whatsapp_enabled,
                'attachment_path'   => $primary->attachment_path,
                'attachment_url'    => file_url($primary->attachment_path),
            ] : null,

            'extra_contacts' => $v->addresses->reject(fn($a) => $a->is_primary)->values()->map(fn($a) => [
                'id'                => $a->id,
                'contact_name'      => $a->contact_name,
                'designation'       => $a->designation,
                'contact_no'        => $a->contact_no,
                'email'             => $a->email,
                'whatsapp_enabled'  => (bool) $a->whatsapp_enabled,
                'attachment_path'   => $a->attachment_path,
                'attachment_url'    => file_url($a->attachment_path),
            ])->all(),

            'due_diligence' => $v->documents->where('kind', 'dd')->values()->map(fn($d) => [
                'id'                => $d->id,
                'code'              => $d->code,
                'document_name'     => $d->document_name,
                'issuing_authority' => $d->issuing_authority,
                'expiry'            => $d->expiry,
                'mandatory'         => (bool) $d->mandatory,
                'attachment_path'   => $d->attachment_path,
                'attachment_url'    => file_url($d->attachment_path),
            ])->all(),

            'trade_licenses' => $v->documents->where('kind', 'tl')->values()->map(fn($d) => [
                'id'                  => $d->id,
                'code'                => $d->code,
                'license_type_id'     => $d->license_type_id,
                'license_type_name'   => optional($d->licenseType)->name,
                'license_number'      => $d->license_number,
                'issuing_authority'   => $d->issuing_authority,
                'issue_date'          => optional($d->issue_date)->toDateString(),
                'expiry_date'         => optional($d->expiry_date)->toDateString(),
                'attachment_path'     => $d->attachment_path,
                'attachment_url'      => file_url($d->attachment_path),
            ])->all(),

            'owner_kyc' => $v->owners->map(fn($o) => [
                'id'                => $o->id,
                'code'              => $o->code,
                'document_name'     => $o->document_name,
                'issuing_authority' => $o->issuing_authority,
                'document_number'   => $o->document_number,
                'issue_date'        => optional($o->issue_date)->toDateString(),
                'expiry'            => $o->expiry,
                'status'            => $o->status,
                'attachment_path'   => $o->attachment_path,
                'attachment_url'    => file_url($o->attachment_path),
            ])->all(),

            'bank_accounts' => $v->bankAccounts->map(fn($b) => [
                'id'             => $b->id,
                'bank_name'      => $b->bank_name,
                'branch_name'    => $b->branch_name,
                'account_number' => $b->account_number,
                'ifsc'           => $b->ifsc,
                'branch_address' => $b->branch_address,
                'cheque_path'    => $b->cheque_path,
                'cheque_url'     => file_url($b->cheque_path),
            ])->all(),

            'gst_scrutiny' => $v->gstScrutiny->map(fn($g) => [
                'id'                       => $g->id,
                'gst_number'               => $g->gst_number,
                'status'                   => $g->status,
                'scrutiny_date'            => optional($g->created_at)->toDateString(),
                'last_filing_date'         => optional($g->last_filing_date)->toDateString(),
                'prev_non_gst_2a_invoice'  => $g->prev_non_gst_2a_invoice,
                'red_flags'                => $g->red_flags,
            ])->all(),

            'product_mappings' => $v->productMappings->map(fn($m) => [
                'id'                => $m->id,
                'product_id'        => $m->product_id,
                'product_code'      => optional($m->product)->product_code,
                'product_name'      => optional($m->product)->name,
                'batch_serial_lot'  => $m->batch_serial_lot,
                'purchase_price'    => (float) $m->purchase_price,
                'gst_percentage'    => (float) $m->gst_percentage,
                'gst_amount'        => (float) $m->gst_amount,
                'total_amount'      => (float) $m->total_amount,
            ])->all(),

            'created_at' => optional($v->created_at)->toDateTimeString(),
            'updated_at' => optional($v->updated_at)->toDateTimeString(),
        ];
    }

    public function masterBundle(Request $request): JsonResponse
    {
        $user = $request->user();
        $cacheKey = MasterBundleCache::key('vendor:master-bundle', $user?->id);

        $bundle = Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user) {
            $scope = fn($q) => MasterVisibility::applyReadScope($q, $user);

            $active = function (string $modelClass, array $cols) use ($scope) {
                return $modelClass::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap($scope)
                    ->orderBy('id')
                    ->get($cols);
            };

            $stateCodes = StateCodes::query()
                ->whereRaw('LOWER(status) = ?', ['active'])
                ->tap($scope)
                ->with('state:id,name,country_id')
                ->statutoryFirst()
                ->get(['id', 'state_id', 'state_code', 'status']);

            return [
                'vendor_types'          => $active(VendorTypes::class,          ['id', 'name', 'kind', 'service_type', 'classification'])
                    ->map(fn ($t) => $t->toArray() + ['group' => $t->group])->values(),
                'risk_levels'           => $active(RiskLevels::class,           ['id', 'name']),
                'vendor_behaviour'      => $active(VendorBehaviour::class,      ['id', 'name']),
                'segments'              => $active(Segments::class,             ['id', 'code', 'name', 'regulatory_status']),
                'compliance_behaviours' => $active(ComplianceBehaviours::class, ['id', 'name']),
                'classifications'       => $active(CustomerClassifications::class, ['id', 'name']),
                'address_types'         => $active(AddressTypes::class,           ['id', 'name']),
                'countries'             => $active(Countries::class,            ['id', 'name']),
                'state_codes'           => $stateCodes,
                'states'                => $active(States::class,               ['id', 'name', 'country_id']),
                'license_name'          => $active(LicenseName::class,          ['id', 'name']),
                'gst_percentage'        => $active(GstPercentage::class,        ['id', 'percentage']),
            ];
        });
        return response()->json($bundle);
    }
}
