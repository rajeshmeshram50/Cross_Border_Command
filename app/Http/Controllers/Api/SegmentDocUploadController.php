<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmAgreementLibrary;
use App\Models\ClmAuthority;
use App\Models\ClmDdDocument;
use App\Models\ClmKycDocument;
use App\Models\ClmQcDocument;
use App\Models\ClmSegment;
use App\Models\ClmSegmentRule;
use App\Models\ClmSignatureRequest;
use App\Models\ClmTradeDocLibrary;
use App\Models\ClmTradeLicense;
use App\Models\Consignee;
use App\Models\Customer;
use App\Models\Lead;
use App\Models\Product;
use App\Models\ProformaInvoice;
use App\Models\ProformaInvoiceItem;
use App\Models\Quotation;
use App\Models\SegmentDocUpload;
use App\Models\ShipmentOrder;
use App\Models\Vendor;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class SegmentDocUploadController extends Controller
{
    private const TYPE_MAP = [
        'customer'  => Customer::class,
        'consignee' => Consignee::class,
        'supplier'  => Vendor::class,
        'vendor'    => Vendor::class,
        'product'   => Product::class,
    ];

    private const CATEGORIES = ['kyc', 'dd', 'tl', 'td', 'qc'];

    private array $segmentLibraryCache = [];

    public function index(Request $request, string $type, int $id): JsonResponse
    {
        $owner = $this->resolveOwner($request, $type, $id);

        $q = SegmentDocUpload::query()
            ->where('uploadable_type', get_class($owner))
            ->where('uploadable_id', $owner->id);

        if ($category = $request->query('category')) {
            $q->where('category', $category);
        }
        $rows = $q->orderBy('category')->orderBy('doc_code')->get();

        $byCategory = [];
        foreach (self::CATEGORIES as $cat) {
            $byCategory[$cat] = [];
        }
        foreach ($rows as $row) {
            $byCategory[$row->category][] = $this->shape($row);
        }

        return response()->json([
            'data'         => $rows->map(fn($r) => $this->shape($r))->all(),
            'by_category'  => $byCategory,
            'count'        => $rows->count(),
        ]);
    }

    public function summary(Request $request, string $type, int $id): JsonResponse
    {
        $owner = $this->resolveOwner($request, $type, $id);

        $rows = SegmentDocUpload::query()
            ->where('uploadable_type', get_class($owner))
            ->where('uploadable_id', $owner->id)
            ->get(['category', 'requirement']);

        $byCategory = [];
        foreach (self::CATEGORIES as $cat) {
            $byCategory[$cat] = ['total' => 0, 'mandatory' => 0, 'optional' => 0];
        }
        $total = 0;
        $mand = 0;
        $opt = 0;
        foreach ($rows as $r) {
            $cat = $r->category;
            if (!isset($byCategory[$cat])) continue;
            $byCategory[$cat]['total']++;
            if ($r->requirement === 'M') {
                $byCategory[$cat]['mandatory']++;
                $mand++;
            } else {
                $byCategory[$cat]['optional']++;
                $opt++;
            }
            $total++;
        }
        return response()->json([
            'total'       => $total,
            'mandatory'   => $mand,
            'optional'    => $opt,
            'by_category' => $byCategory,
        ]);
    }

    public function store(Request $request, string $type, int $id): JsonResponse
    {
        $owner = $this->resolveOwner($request, $type, $id, 'edit');

        $data = $request->validate([
            'category'    => ['required', Rule::in(self::CATEGORIES)],
            'doc_code'    => ['required', 'string', 'max:32'],
            'doc_name'    => ['required', 'string', 'max:255'],
            'requirement' => ['nullable', Rule::in(['M', 'O'])],
            'issue_date'  => ['nullable', 'date', 'before_or_equal:today'],
            'expiry_date' => ['nullable', 'date', 'after_or_equal:issue_date'],

            'attachment'  => ['nullable', 'file', 'max:2048', 'mimes:pdf,jpg,jpeg,png'],
        ]);
        $requirement = $data['requirement'] ?? 'O';
        $issueDate   = $data['issue_date'] ?? null;
        $expiryDate  = $data['expiry_date'] ?? null;
        $issueDate   = $data['issue_date'] ?? null;

        $existing = SegmentDocUpload::query()
            ->where('uploadable_type', get_class($owner))
            ->where('uploadable_id', $owner->id)
            ->where('category', $data['category'])
            ->where('doc_code', $data['doc_code'])
            ->first();

        $file = $request->file('attachment');

        if (!$file && !$existing) {
            return response()->json([
                'message' => 'The attachment field is required.',
                'errors'  => ['attachment' => ['Select a file to upload.']],
            ], 422);
        }

        $path = $file ? $this->storeUpload($file, $type, $owner->id, $data['category'], $data['doc_code']) : null;
        $name = $file?->getClientOriginalName();

        if ($existing) {
            if ($path && $existing->attachment_path && $existing->attachment_path !== $path) {
                Storage::disk('public')->delete($existing->attachment_path);
            }
            $existing->update(array_filter([
                'doc_name'         => $data['doc_name'],
                'requirement'      => $requirement,
                'attachment_path'  => $path,
                'attachment_name'  => $name,
                'uploaded_by'      => optional($request->user())->id,
            ], fn($v) => $v !== null) + [
                'issue_date'       => $issueDate,
                'expiry_date'      => $expiryDate,
            ]);
            return response()->json([
                'data'  => $this->shape($existing->fresh()),
                'vault' => $this->vaultPayloadFor($request, $type, $id),
            ], 200);
        }

        $row = SegmentDocUpload::create([
            'uploadable_type' => get_class($owner),
            'uploadable_id'   => $owner->id,
            'client_id'       => $owner->client_id,
            'category'        => $data['category'],
            'doc_code'        => $data['doc_code'],
            'doc_name'        => $data['doc_name'],
            'requirement'     => $requirement,
            'attachment_path' => $path,
            'attachment_name' => $name,
            'issue_date'      => $issueDate,
            'expiry_date'     => $expiryDate,
            'uploaded_by'     => optional($request->user())->id,
        ]);
        return response()->json([
            'data'  => $this->shape($row),
            'vault' => $this->vaultPayloadFor($request, $type, $id),
        ], 201);
    }

    private function vaultPayloadFor(Request $request, string $type, int $id): ?array
    {
        try {
            $decoded = json_decode($this->vault($request, $type, $id)->getContent(), true);
            return is_array($decoded['data'] ?? null) ? $decoded['data'] : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    public function download(Request $request)
    {
        $user = $request->user();

        $path = ltrim((string) $request->query('path', ''), '/');
        if ($path === '') {
            $url = (string) $request->query('url', '');
            if ($url !== '' && preg_match('#(segment_doc_uploads/.+)$#i', $url, $m)) {
                $path = urldecode($m[1]);
            }
        }

        $path = explode('?', $path)[0];

        if ($path === '' || str_contains($path, '..') || ! str_starts_with($path, 'segment_doc_uploads/')) {
            abort(404, 'File not found.');
        }

        $row = SegmentDocUpload::where('attachment_path', $path)->first();
        if (! $row) {
            abort(404, 'File not found.');
        }
        if ($user && ! $user->isSuperAdmin() && $row->client_id && (int) $row->client_id !== (int) $user->client_id) {
            abort(403, 'You are not allowed to download this file.');
        }
        if (! Storage::disk('public')->exists($path)) {
            abort(404, 'File is missing on storage.');
        }

        $name = $row->attachment_name ?: basename($path);
        return Storage::disk('public')->download($path, $name);
    }

    public function vault(Request $request, string $type, int $id): JsonResponse
    {
        $owner = $this->resolveOwner($request, $type, $id);
        $cid   = (int) ($owner->client_id ?? 0);

        $sameAsCustomer = $type === 'consignee'
            && (bool) optional(Consignee::find($id))->same_as_customer;

        $mirrorCustomer = null;
        if ($sameAsCustomer && $owner instanceof Customer) {
            $addr = $owner->primaryAddress;
            $mirrorCustomer = [
                'id'      => $owner->id,
                'code'    => $owner->customer_code,
                'name'    => $owner->company_name,
                'segment' => $owner->segment,
                'type'    => $owner->type,
                'risk'    => $owner->risk_level,
                'country' => $addr?->country,
                'city'    => $addr?->city,
                'contact' => $addr?->cp_name,
            ];
        }

        $scopeCustomer = $this->resolveScopeCustomer($request, $type, $id, $cid);
        $segmentIds = $scopeCustomer
            ? $this->resolveSegmentIds($scopeCustomer, 'customer', $cid)
            : $this->resolveSegmentIds($owner, $type, $cid);

        $docType = $this->resolveDocType($owner, $type);
        $rules = ClmSegmentRule::query()
            ->where('client_id', $cid)
            ->whereIn('segment_id', $segmentIds)
            ->get()
            ->groupBy('segment_id')
            ->map(fn($g) => $g->firstWhere('document_type', $docType) ?? $g->first())
            ->filter()
            ->values();

        $unionByCat = ['kyc' => [], 'dd' => [], 'tl' => [], 'td' => [], 'qc' => []];
        foreach ($rules as $rule) {
            $sel = $rule->doc_selections ?? [];
            foreach (array_keys($unionByCat) as $cat) {
                $entries = $sel[$cat] ?? [];
                if (!is_array($entries)) continue;
                foreach ($entries as $code => $req) {
                    $existing = $unionByCat[$cat][$code] ?? null;
                    if ($existing === 'M') continue;
                    $unionByCat[$cat][$code] = ($req === 'M') ? 'M' : ($existing ?? 'O');
                }
            }
        }

        $authMap = ClmAuthority::idNameMap($cid);
        $masters = [
            'kyc' => $this->fetchMasters(ClmKycDocument::class,    array_keys($unionByCat['kyc']), $cid, $authMap, $owner->branch_id ?? null),
            'dd'  => $this->fetchMasters(ClmDdDocument::class,     array_keys($unionByCat['dd']),  $cid, $authMap, $owner->branch_id ?? null),
            'tl'  => $this->fetchMasters(ClmTradeLicense::class,   array_keys($unionByCat['tl']),  $cid, $authMap, $owner->branch_id ?? null),
            'td'  => $this->fetchMasters(ClmTradeDocLibrary::class, array_keys($unionByCat['td']),  $cid, $authMap, $owner->branch_id ?? null),
            'qc'  => $this->fetchMasters(ClmQcDocument::class,     array_keys($unionByCat['qc']),  $cid, $authMap, $owner->branch_id ?? null),
        ];

        $uploads = SegmentDocUpload::query()
            ->where('uploadable_type', get_class($owner))
            ->where('uploadable_id', $owner->id)
            ->get()
            ->keyBy(fn($u) => $u->category . '::' . $u->doc_code);

        $buildBucket = function (string $cat) use ($unionByCat, $masters, $uploads): array {
            $rows = [];
            $i = 0;
            foreach ($unionByCat[$cat] as $code => $req) {
                $i++;
                $master = $masters[$cat][$code] ?? null;
                $upload = $uploads->get($cat . '::' . $code);
                $rows[] = [
                    'id'              => $upload?->id ?? $i,
                    'db_id'           => $master['id'] ?? null,
                    'name'            => $master['name'] ?? $code,
                    'reference'       => $master['code'] ?? $code,
                    'authority'       => $master['authority'] ?? null,
                    'issue_date'      => optional($upload?->issue_date)->format('d-M-Y'),
                    'expiry'          => optional($upload?->expiry_date)->format('d-M-Y')
                        ?? ($master['expiry'] ?? '—'),
                    'expiry_date'     => optional($upload?->expiry_date)->format('d-M-Y'),
                    'attachment'      => $upload?->attachment_name,
                    'attachment_url'  => $upload?->attachment_url,
                    'status'          => $upload ? 'Verified' : 'Pending',
                    'requirement'     => $req,
                    'doc_code'        => $code,
                    'party'           => $master['party'] ?? null,
                ];
            }
            return $rows;
        };

        $company_dd      = $buildBucket('dd');
        $owner_kyc       = $buildBucket('kyc');
        $trade_licenses  = $buildBucket('tl');
        $trade_documents = $buildBucket('td');

        $coreMandatory = collect(array_merge($company_dd, $owner_kyc, $trade_licenses))
            ->where('requirement', 'M');
        $coreVerified  = $coreMandatory->where('status', 'Verified')->count();
        $coreCatalog         = collect(array_merge($company_dd, $owner_kyc, $trade_licenses));
        $coreCatalogVerified = $coreCatalog->where('status', 'Verified')->count();

        if ($request->boolean('tally')) {
            return response()->json([
                'data' => [
                    'core_total_documents'   => $coreMandatory->count(),
                    'core_verified_signed'   => $coreVerified,
                    'core_catalog_documents' => $coreCatalog->count(),
                    'core_catalog_verified'  => $coreCatalogVerified,
                ],
            ]);
        }

        if ($request->boolean('docs')) {
            return response()->json([
                'data' => [
                    'segment_rows'           => $this->segmentRowsOf($type, $owner),
                    'party_contact'          => $this->partyContactOf($owner),
                    'same_as_customer'       => $sameAsCustomer,
                    'mirror_customer'        => $mirrorCustomer,
                    'company_dd'             => $company_dd,
                    'owner_kyc'              => $owner_kyc,
                    'trade_licenses'         => $trade_licenses,
                    'company_dd_count'       => count($company_dd),
                    'owner_kyc_count'        => count($owner_kyc),
                    'trade_license_count'    => count($trade_licenses),
                    'core_total_documents'   => $coreMandatory->count(),
                    'core_verified_signed'   => $coreVerified,
                    'core_catalog_documents' => $coreCatalog->count(),
                    'core_catalog_verified'  => $coreCatalogVerified,
                    'last_updated'           => optional($uploads->max('updated_at'))->format('d-M-Y'),
                ],
            ]);
        }

        $deals     = $this->buildShipmentAgreements($owner, $type, $cid, $company_dd, $owner_kyc, $trade_licenses, $id, false, $sameAsCustomer);
        $shipments = array_values(array_filter($deals, fn($r) => !empty($r['has_shipment'])));

        $ctcRows   = $shipments;

        if ($request->boolean('ring')) {
            $ringDeals = in_array($type, ['supplier', 'vendor'], true) && $cid
                ? $this->buildVendorDeals($owner, $cid, $company_dd, $owner_kyc, $trade_licenses, $trade_documents)['with_shipment']
                : [];

            return response()->json([
                'data' => [
                    'core_total_documents' => $coreMandatory->count(),
                    'core_verified_signed' => $coreVerified,
                    'shipment_agreements'  => array_map(fn ($s) => [
                        'has_shipment' => $s['has_shipment'] ?? null,
                        'trade_docs'   => ['ratio' => $s['trade_docs']['ratio'] ?? '0/0'],
                        'agreement'    => ['ratio' => $s['agreement']['ratio'] ?? '0/0'],
                    ], array_values($ctcRows)),
                    'vendor_with_shipment' => array_map(fn ($d) => [
                        'ratios' => ['td' => $d['ratios']['td'] ?? null],
                    ], array_values($ringDeals)),
                ],
            ]);
        }

        $agreements = [];
        if (in_array($type, ['customer', 'consignee'], true)) {
            $dealTag = fn(array $s): array => [
                'deal_shipment_id'    => $s['shipment_id'] ?? null,
                'deal_opportunity_id' => $s['opportunity_id'] ?? null,
                'deal_has_shipment'   => (bool) ($s['has_shipment'] ?? false),
            ];

            foreach ($ctcRows as $s) {
                $rows = $type === 'consignee' ? ($s['agreements_consignee'] ?? []) : ($s['agreements_buyer'] ?? []);
                foreach ($rows as $r) {
                    $agreements[] = $r + $dealTag($s);
                }
            }
            $c2c = function (string $key) use ($ctcRows) {
                $signed = 0;
                $total = 0;
                foreach ($ctcRows as $s) {
                    $parts   = explode('/', $s[$key]['ratio'] ?? '0/0');
                    $signed += (int) ($parts[0] ?? 0);
                    $total  += (int) ($parts[1] ?? 0);
                }
                return ['signed' => $signed, 'total' => $total];
            };
            $c2cTd  = $c2c('trade_docs');
            $c2cAgr = $c2c('agreement');

            $c2cTradeRows = [];
            foreach ($ctcRows as $s) {
                $buyerRows = $s['trade_docs_buyer']     ?? [];
                $consRows  = $s['trade_docs_consignee'] ?? [];
                $sideRows = $type === 'consignee'
                    ? ($sameAsCustomer
                        ? array_merge(
                            array_values(array_filter($buyerRows, fn($r) => empty($r['pi_id']))),
                            $consRows,
                        )
                        : $consRows)
                    : $buyerRows;
                $seenInDeal = [];
                foreach ($sideRows as $r) {
                    $k = ($r['db_id'] ?? 'x') . '|' . ($r['name'] ?? '');
                    if (isset($seenInDeal[$k])) continue;
                    $seenInDeal[$k] = true;
                    $c2cTradeRows[] = $r + $dealTag($s);
                }
            }
            $trade_documents = $c2cTradeRows;

            $stdRows             = array_merge($company_dd, $owner_kyc, $trade_licenses);
            $stdVerified         = collect($stdRows)->where('status', 'Verified')->count();
            $stdPending          = count($stdRows) - $stdVerified;

            $agrTotal  = count($agreements);
            $agrSigned = collect($agreements)
                ->filter(fn($a) => in_array($a['status'] ?? '', ['Signed', 'Verified'], true))
                ->count();

            $totalDocuments      = count($stdRows) + $c2cTd['total'] + $agrTotal;
            $verifiedSigned      = $stdVerified + $c2cTd['signed'] + $agrSigned;
            $pending             = $stdPending
                + ($c2cTd['total'] - $c2cTd['signed'])
                + ($agrTotal - $agrSigned);
            $tradeDocumentsCount = $c2cTd['total'];
            $agreementsCount     = $agrTotal;
        } else {
            $allRows             = array_merge($company_dd, $owner_kyc, $trade_licenses, $trade_documents);
            $totalDocuments      = count($allRows);
            $verifiedSigned      = collect($allRows)->where('status', 'Verified')->count();
            $pending             = collect($allRows)->where('status', 'Pending')->count();
            $tradeDocumentsCount = count($trade_documents);

            $vendorSegIds  = $this->resolveSegmentIds($owner, 'vendor', $cid);
            $agreementLib  = $this->vendorSupplierLibrary($cid, $vendorSegIds, ClmAgreementLibrary::class, 'agr_status');
            $vendorAgrReqs = ClmSignatureRequest::where('client_id', $cid)
                ->where('model_name', 'Vendor')
                ->where('document_type', ClmSignatureRequest::DOC_AGREEMENT)
                ->where('party_id', $id)
                ->get();
            $agreements      = $this->overlaySupplierDocs($agreementLib, $vendorAgrReqs, ClmSignatureRequest::DOC_AGREEMENT, $id);
            $agreementsCount = count($agreements);
        }

        $vendorDeals = in_array($type, ['supplier', 'vendor'], true) && $cid
            ? $this->buildVendorDeals($owner, $cid, $company_dd, $owner_kyc, $trade_licenses, $trade_documents)
            : ['with_shipment' => [], 'without_shipment' => [], 'ratios' => null];

        if (in_array($type, ['supplier', 'vendor'], true) && $cid) {
            $poDeals = $this->buildPoDeals($owner, $cid, $vendorDeals['ratios'] ?? []);
            if ($poDeals) {
                $vendorDeals['with_shipment']    = $poDeals['with_shipment'];
                $vendorDeals['without_shipment'] = $poDeals['without_shipment'];
            } else {
                $vendorDeals['with_shipment']    = [];
                $vendorDeals['without_shipment'] = [];
            }
        }

        return response()->json([
            'data' => [
                'same_as_customer'       => $sameAsCustomer,
                'mirror_customer'        => $mirrorCustomer,
                'segment_rows'           => $this->segmentRowsOf($type, $owner),
                'party_contact'          => $this->partyContactOf($owner),
                'vendor_with_shipment'    => $vendorDeals['with_shipment'],
                'vendor_without_shipment' => $vendorDeals['without_shipment'],
                'vendor_deal_ratios'      => $vendorDeals['ratios'],
                'total_documents'        => $totalDocuments,
                'verified_signed'        => $verifiedSigned,
                'core_total_documents'   => $coreMandatory->count(),
                'core_verified_signed'   => $coreVerified,
                'core_catalog_documents' => $coreCatalog->count(),
                'core_catalog_verified'  => $coreCatalogVerified,
                'pending'                => $pending,
                'company_dd_count'       => count($company_dd),
                'owner_kyc_count'        => count($owner_kyc),
                'trade_license_count'    => count($trade_licenses),
                'trade_documents_count'  => $tradeDocumentsCount,
                'agreements_count'       => $agreementsCount,
                'total_shipments'        => count($shipments),
                'company_dd'             => $company_dd,
                'owner_kyc'              => $owner_kyc,
                'trade_licenses'         => $trade_licenses,
                'trade_documents'        => $trade_documents,
                'agreements'             => $agreements,
                'shipment_agreements'    => $ctcRows,
                'last_updated'           => optional($uploads->max('updated_at'))->format('d-M-Y'),
                'last_updated_at'        => optional($uploads->max('updated_at'))->toIso8601String(),
            ],
        ]);
    }

    private function buildPoDeals(Model $owner, int $cid, array $ratios): ?array
    {
        $pos = DB::table('p2p_purchase_orders')
            ->where('client_id', $cid)
            ->where('vendor_id', $owner->id)
            ->whereNull('deleted_at')
            ->orderByDesc('id')
            ->get(['id', 'code', 'po_date', 'shipment_order_id', 'proforma_invoice_id', 'status',
                'procurement_request_code', 'document_type', 'grand_total', 'currency_code']);
        if ($pos->isEmpty()) return null;

        $ships = DB::table('shipment_orders')
            ->whereIn('id', $pos->pluck('shipment_order_id')->filter()->unique()->all() ?: [0])
            ->pluck('shipment_code', 'id');
        $pis = DB::table('proforma_invoices')
            ->whereIn('id', $pos->pluck('proforma_invoice_id')->filter()->unique()->all() ?: [0])
            ->get(['id', 'customer_name'])->keyBy('id');

        $docs = DB::table('p2p_purchase_order_documents')
            ->whereIn('purchase_order_id', $pos->pluck('id'))
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->get()
            ->groupBy('purchase_order_id');

        $spiDocs = $this->buildSpiDocs($pos->pluck('id')->all());

        $sigStates = DB::table('clm_signature_requests')
            ->whereIn('id', $docs->flatten(1)->pluck('signature_request_id')->filter()->unique()->all() ?: [0])
            ->pluck('status', 'id');

        $supplierName = (string) ($owner->company_name ?? '');
        $with = [];
        $without = [];

        foreach ($pos as $po) {
            $rows = ($docs[$po->id] ?? collect())
                ->filter(fn ($d) => ($d->needed ?? 'no') === 'yes')
                ->values();

            $shaped = $rows->map(fn ($d) => $this->shapePoDoc(
                $d, $po->code, $d->signature_request_id ? ($sigStates[$d->signature_request_id] ?? null) : null,
            ))->all();
            $agr = array_values(array_filter($shaped, fn ($r) => $r['is_agreement']));
            $td  = array_values(array_filter($shaped, fn ($r) => !$r['is_agreement']));
            $ratio = fn (array $set) => [
                'd' => count(array_filter($set, fn ($r) => $r['status'] === 'Signed')),
                't' => count($set),
            ];
            $poRow = [
                'po_id'      => (int) $po->id,
                'po_code'    => $po->code,
                'procurement_id' => $po->procurement_request_code ?: null,
                'po_date'    => $po->po_date,
                'po_status'  => $po->status,
                'po_total'   => (float) $po->grand_total,
                'currency'   => $po->currency_code,
                'docs'       => $td,
                'agreements' => $agr,
                'spi_docs'   => $spiDocs[$po->id] ?? [],
                'ratios'     => array_merge($ratios, ['td' => $ratio($td), 'agr' => $ratio($agr)]),
            ];

            $shipCode = $po->shipment_order_id ? ($ships[$po->shipment_order_id] ?? null) : null;
            if ($shipCode) {
                $key = 'S:' . $shipCode;
                $with[$key] ??= [
                    'shipment_id' => $shipCode,
                    'customer'    => $pis[$po->proforma_invoice_id]->customer_name ?? '—',
                    'consignee'   => '—',
                    'supplier'    => $supplierName,
                    'pos'         => [],
                ];
                $with[$key]['pos'][] = $poRow;
            } else {
                $without[] = $poRow + [
                    'procurement_id' => $po->procurement_request_code ?: null,
                    'supplier'       => $supplierName,
                ];
            }
        }

        $finish = function (array $groups) use ($ratios): array {
            $out = [];
            $sr = 0;
            foreach ($groups as $g) {
                $docs = array_merge(...array_map(fn ($r) => $r['docs'], $g['pos'])) ?: [];
                $agrs = array_merge(...array_map(fn ($r) => $r['agreements'], $g['pos'])) ?: [];
                $spis = array_merge(...array_map(fn ($r) => $r['spi_docs'] ?? [], $g['pos'])) ?: [];
                $signed = fn (array $set) => count(array_filter($set, fn ($r) => $r['status'] === 'Signed'));
                $out[] = $g + [
                    'sr'         => ++$sr,
                    'po_count'   => count($g['pos']),
                    'docs'       => $docs,
                    'agreements' => $agrs,
                    'spi_docs'   => $spis,
                    'ratios'     => array_merge($ratios, [
                        'td'  => ['d' => $signed($docs), 't' => count($docs)],
                        'agr' => ['d' => $signed($agrs), 't' => count($agrs)],
                    ]),
                ];
            }
            return $out;
        };

        $numbered = [];
        $sr = 0;
        foreach ($without as $row) $numbered[] = $row + ['sr' => ++$sr];

        return ($with || $numbered)
            ? ['with_shipment' => $finish($with), 'without_shipment' => $numbered]
            : null;
    }

    private function shapePoDoc($d, ?string $poCode = null, ?string $sigState = null): array
    {
        $state = match ((string) $sigState) {
            'declined'   => 'declined',
            'recalled'   => 'recalled',
            'expired'    => 'expired',
            'completed'  => 'signed',
            'inprogress' => 'sent',
            default      => (string) $d->status,
        };
        $status = match ($state) {
            'signed'    => 'Signed',
            'sent'      => 'Pending',
            'declined'  => 'Declined',
            'recalled'  => 'Recalled',
            'expired'   => 'Expired',
            default     => 'Pending',
        };
        $sub = mb_strtolower((string) ($d->doc_sub ?? '') . ' ' . (string) ($d->doc_kind ?? '') . ' ' . (string) ($d->name ?? ''));

        $lib = in_array((string) ($d->source_type ?? ''), ['trade', 'agreement'], true) ? (int) $d->source_id : null;

        return [
            'id'                   => (int) $d->id,
            'db_id'                => $lib,
            'po_id'                => (int) $d->purchase_order_id,
            'po_code'              => $poCode,
            'po_doc_id'            => (int) $d->id,
            'party'                => 'Vendor',
            'signature_request_id' => $d->signature_request_id ? (int) $d->signature_request_id : null,
            'sig_state'            => $state,
            'name'                 => $d->name ?: $d->code,
            'reference'            => $d->code,
            'authority'            => null,
            'issue_date'           => $d->generated_on ? Carbon::parse($d->generated_on)->format('d-M-Y') : null,
            'expiry'               => $d->valid_up_to ? Carbon::parse($d->valid_up_to)->format('d-M-Y') : '—',
            'attachment'           => $d->original_name,
            'attachment_url'       => $d->file_path ? file_url($d->file_path) : null,
            'status'               => $status,
            'doc_code'             => $d->code,
            'requirement'          => 'M',
            'certificate_url'      => null,
            'is_agreement'         => str_contains($sub, 'agreement'),
            'doc_kind'             => (string) ($d->doc_kind ?? ''),
        ];
    }

    private function buildSpiDocs(array $poIds): array
    {
        if (!$poIds) return [];

        $invoices = DB::table('p2p_supplier_invoices')
            ->whereIn('purchase_order_id', $poIds)
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->get(['id', 'purchase_order_id', 'code', 'invoice_no', 'invoice_date',
                'invoice_file_path', 'invoice_file_name', 'eway_no', 'eway_file_path', 'eway_file_name']);
        if ($invoices->isEmpty()) return [];

        $photos = DB::table('p2p_spi_box_attachments as a')
            ->join('p2p_spi_boxes as b', 'b.id', '=', 'a.box_id')
            ->whereIn('b.supplier_invoice_id', $invoices->pluck('id'))
            ->whereNull('a.deleted_at')
            ->whereNull('b.deleted_at')
            ->orderBy('a.id')
            ->get(['a.id', 'a.file_path', 'a.file_name', 'a.created_at', 'b.supplier_invoice_id', 'b.box_code'])
            ->groupBy('supplier_invoice_id');

        $row = fn (string $kind, string $name, ?string $path, ?string $file, $spi, ?string $ref = null) => [
            'id'             => $spi->id . ':' . $kind,
            'spi_id'         => (int) $spi->id,
            'spi_code'       => $spi->code,
            'po_id'          => (int) $spi->purchase_order_id,
            'party'          => 'Supplier',
            'kind'           => $kind,
            'name'           => $name,
            'reference'      => $ref,
            'issue_date'     => $spi->invoice_date ? Carbon::parse($spi->invoice_date)->format('d-M-Y') : null,
            'attachment'     => $file,
            'attachment_url' => $path ? file_url($path) : null,
            'status'         => $path ? 'Received' : 'Awaited',
        ];

        $out = [];

        foreach ($invoices as $spi) {
            $list = [
                $row('invoice', 'Supplier Invoice', $spi->invoice_file_path, $spi->invoice_file_name, $spi, $spi->invoice_no),
                $row('eway', 'E-Way Bill', $spi->eway_file_path, $spi->eway_file_name, $spi, $spi->eway_no),
            ];

            foreach ($photos[$spi->id] ?? [] as $p) {
                $list[] = $row('photo', 'Unpacking photo — ' . $p->box_code, $p->file_path, $p->file_name, $spi, $p->box_code);
            }

            $out[$spi->purchase_order_id] = array_merge($out[$spi->purchase_order_id] ?? [], $list);
        }

        return $out;
    }

    private function buildVendorDeals(Model $owner, int $cid, array $companyDd, array $ownerKyc, array $tradeLicenses, array $tradeDocuments): array
    {
        $r = fn(array $rows) => [
            'd' => collect($rows)->where('status', 'Verified')->count(),
            't' => count($rows),
        ];
        $ratios = ['kyc' => $r($ownerKyc), 'dd' => $r($companyDd), 'tl' => $r($tradeLicenses), 'td' => $r($tradeDocuments)];
        $empty  = ['with_shipment' => [], 'without_shipment' => [], 'ratios' => $ratios];
        $supplierName = (string) ($owner->company_name ?? '');

        $procs = DB::table('procurements as pr')
            ->where('pr.client_id', $cid)
            ->whereExists(function ($q) use ($owner) {
                $q->selectRaw('1')->from('procurement_products as pp')
                    ->whereColumn('pp.procurement_id', 'pr.id')
                    ->where('pp.vendor_id', $owner->id);
            })
            ->get(['pr.id', 'pr.lead_id']);

        $vendorSegIds = $this->resolveSegmentIds($owner, 'vendor', $cid);
        $tdLib  = $this->vendorSupplierLibrary($cid, $vendorSegIds, ClmTradeDocLibrary::class, 'status');
        $agrLib = $this->vendorSupplierLibrary($cid, $vendorSegIds, ClmAgreementLibrary::class, 'agr_status');
        $tdRatio = fn(array $docs) => [
            'd' => collect($docs)->where('status', 'Signed')->count(),
            't' => count($docs),
        ];

        if ($procs->isEmpty()) {
            $docs = $this->overlaySupplierDocs($tdLib,  collect(), ClmSignatureRequest::DOC_TRADE);
            $agrs = $this->overlaySupplierDocs($agrLib, collect(), ClmSignatureRequest::DOC_AGREEMENT);
            if (empty($docs) && empty($agrs)) return $empty;
            return [
                'with_shipment'    => [],
                'without_shipment' => [[
                    'sr'             => 1,
                    'procurement_id' => '—',
                    'supplier'       => $supplierName,
                    'ratios'         => array_merge($ratios, ['td' => $tdRatio($docs)]),
                    'docs'           => $docs,
                    'agreements'     => $agrs,
                ]],
                'ratios' => $ratios,
            ];
        }

        $leadIds = $procs->pluck('lead_id')->filter()->unique()->values();

        $shipByLead = DB::table('shipment_orders')->whereIn('lead_id', $leadIds->all() ?: [0])
            ->where('client_id', $cid)->get(['id', 'lead_id', 'shipment_code'])->keyBy('lead_id');

        $leads = DB::table('leads')->whereIn('id', $leadIds->all() ?: [0])->get(['id', 'customer_id', 'consignee_id'])->keyBy('id');
        $custNames = DB::table('customers')->whereIn('id', $leads->pluck('customer_id')->filter()->unique()->all() ?: [0])->pluck('company_name', 'id');
        $consNames = DB::table('consignees')->whereIn('id', $leads->pluck('consignee_id')->filter()->unique()->all() ?: [0])->pluck('company_name', 'id');

        $reqsByLead = ClmSignatureRequest::where('client_id', $cid)
            ->whereIn('lead_id', $leadIds->all() ?: [0])
            ->where('model_name', 'Vendor')
            ->get()
            ->groupBy('lead_id');
        $docCache = [];
        $agrCache = [];
        $reqsFor  = fn(?int $leadId) => $leadId ? ($reqsByLead[$leadId] ?? collect()) : collect();
        $dealDocs = function (?int $leadId) use (&$docCache, $tdLib, $reqsFor) {
            $key = $leadId ?? 0;
            if (!array_key_exists($key, $docCache)) {
                $docCache[$key] = $this->overlaySupplierDocs($tdLib, $reqsFor($leadId), ClmSignatureRequest::DOC_TRADE);
            }
            return $docCache[$key];
        };
        $dealAgrs = function (?int $leadId) use (&$agrCache, $agrLib, $reqsFor) {
            $key = $leadId ?? 0;
            if (!array_key_exists($key, $agrCache)) {
                $agrCache[$key] = $this->overlaySupplierDocs($agrLib, $reqsFor($leadId), ClmSignatureRequest::DOC_AGREEMENT);
            }
            return $agrCache[$key];
        };
        $withShip = [];
        $sr = 0;
        foreach ($shipByLead as $leadId => $so) {
            $lead = $leads[$leadId] ?? null;
            $docs = $dealDocs((int) $leadId);
            $withShip[] = [
                'sr'          => ++$sr,
                'shipment_id' => $so->shipment_code ?: ('SHP-' . str_pad((string) $so->id, 3, '0', STR_PAD_LEFT)),
                'customer'    => $lead && $lead->customer_id ? ($custNames[$lead->customer_id] ?? '—') : '—',
                'consignee'   => $lead && $lead->consignee_id ? ($consNames[$lead->consignee_id] ?? '—') : '—',
                'supplier'    => $supplierName,
                'ratios'      => array_merge($ratios, ['td' => $tdRatio($docs)]),
                'docs'        => $docs,
                'agreements'  => $dealAgrs((int) $leadId),
            ];
        }

        $withoutShip = [];
        $sr = 0;
        foreach ($procs as $p) {
            $leadId = $p->lead_id ? (int) $p->lead_id : null;
            if ($leadId !== null && $shipByLead->has($leadId)) continue;
            $docs   = $dealDocs($leadId);
            $withoutShip[] = [
                'sr'             => ++$sr,
                'procurement_id' => 'PROC-' . str_pad((string) $p->id, 3, '0', STR_PAD_LEFT),
                'supplier'       => $supplierName,
                'ratios'         => array_merge($ratios, ['td' => $tdRatio($docs)]),
                'docs'           => $docs,
                'agreements'     => $dealAgrs($leadId),
            ];
        }

        return ['with_shipment' => $withShip, 'without_shipment' => $withoutShip, 'ratios' => $ratios];
    }

    private function buildShipmentAgreements(Model $owner, string $type, int $cid, array $companyDd, array $ownerKyc, array $tradeLicenses, int $entityId, bool $shipmentLinkedOnly = true, ?bool $sameAsCustomer = null): array
    {
        if (!in_array($type, ['customer', 'consignee'], true) || !$cid) return [];

        $ownerIsSameAsCustomer = $sameAsCustomer ?? ($type === 'consignee'
            && (bool) optional(Consignee::find($entityId))->same_as_customer);

        $leadQ = Lead::where('client_id', $cid);
        if ($type === 'customer') $leadQ->where('customer_id', $entityId);
        else                      $leadQ->where('consignee_id', $entityId);
        $leads = $leadQ->get(['id', 'opp_code', 'customer_id', 'consignee_id']);
        if ($leads->isEmpty()) return [];

        $leadIds = $leads->pluck('id')->all();
        $shipLeadIds = [];
        $shipCodeByLead = [];
        ShipmentOrder::where('client_id', $cid)
            ->whereIn('lead_id', $leadIds)
            ->orderBy('id')
            ->get(['lead_id', 'shipment_code'])
            ->each(function ($s) use (&$shipLeadIds, &$shipCodeByLead) {
                $lid = (int) $s->lead_id;
                $shipLeadIds[$lid] = true;
                if ($s->shipment_code) $shipCodeByLead[$lid] = $s->shipment_code;
            });

        $custIds = $leads->pluck('customer_id')->filter()->unique()->all();
        $consIds = $leads->pluck('consignee_id')->filter()->unique()->all();
        $custById = $custIds ? Customer::whereIn('id', $custIds)->get(['id', 'company_name'])->keyBy('id') : collect();
        $consById = $consIds ? Consignee::whereIn('id', $consIds)->get(['id', 'company_name', 'same_as_customer'])->keyBy('id') : collect();

        $sigByLead = ClmSignatureRequest::where('client_id', $cid)
            ->whereIn('lead_id', $leadIds)
            ->whereIn('document_type', [ClmSignatureRequest::DOC_TRADE, ClmSignatureRequest::DOC_AGREEMENT])
            ->orderBy('id')
            ->get()
            ->groupBy('lead_id');

        $ratioOf = fn(array $rows) => $this->ratio(collect($rows)->where('status', 'Verified')->count(), count($rows));
        $ddRatio  = $ratioOf($companyDd);
        $kycRatio = $ratioOf($ownerKyc);
        $tlRatio  = $ratioOf($tradeLicenses);

        $piByLead = ProformaInvoice::where('client_id', $cid)
            ->whereIn('opp_id', $leadIds)
            ->where('status', '!=', ProformaInvoice::STATUS_CANCELLED)
            ->orderBy('id')
            ->get(['id', 'opp_id', 'code', 'status', 'emailed_at', 'created_at'])
            ->groupBy('opp_id');

        $piSigReq    = [];
        $piActiveReq = [];
        $piLatestReq = [];
        $piIds = $piByLead->flatten()->pluck('id')->all();
        if ($piIds) {
            ClmSignatureRequest::where('client_id', $cid)
                ->where('document_type', ClmSignatureRequest::DOC_PROFORMA_INVOICE)
                ->whereIn('trade_doc_id', $piIds)
                ->orderBy('id')
                ->get()
                ->each(function ($r) use (&$piSigReq, &$piActiveReq, &$piLatestReq) {
                    $pid = (int) $r->trade_doc_id;
                    $st  = strtolower((string) $r->status);
                    $piLatestReq[$pid] = $r;
                    if ($st === 'completed')  $piSigReq[$pid]    = $r;
                    if ($st === 'inprogress') $piActiveReq[$pid] = $r;
                });
        }

        $dealCtx = $this->prefetchDealContext($cid, $piByLead, $piIds);

        $dedupe = function (array $rows): array {
            $seen = [];
            $out = [];
            foreach ($rows as $r) {
                $key = !empty($r['db_id']) ? (($r['doc_type'] ?? '') . '#' . $r['db_id']) : ('n#' . ($r['name'] ?? ''));
                if (isset($seen[$key])) continue;
                $seen[$key] = true;
                $out[] = $r;
            }
            return $out;
        };

        $rows = [];
        $sr = 0;
        foreach ($leads as $lead) {
            $lid = (int) $lead->id;
            $hasShipment = isset($shipLeadIds[$lid]);
            if ($shipmentLinkedOnly && !$hasShipment) continue;
            $reqs = $sigByLead->get($lid) ?? collect();

            $applicable = $this->applicableShipmentDocs($lead, $cid, $reqs, $owner->segment ?? null, $dealCtx);
            $tradeBuyer = $applicable['trade_docs_buyer'];
            $tradeCons  = $applicable['trade_docs_consignee'];
            $agrBuyer   = $applicable['agreements_buyer'];
            $agrCons    = $applicable['agreements_consignee'];

            foreach (($piByLead->get($lid) ?? collect()) as $pi) {
                $sigReq    = $piSigReq[(int) $pi->id] ?? null;
                $activeReq = $piActiveReq[(int) $pi->id] ?? null;
                $latestReq = $piLatestReq[(int) $pi->id] ?? null;
                $piSigned  = (bool) $sigReq;
                $piDate    = $sigReq?->completed_at;
                $latestState = $latestReq ? strtolower((string) $latestReq->status) : null;
                $piStatus = $piSigned ? 'Signed'
                    : (in_array($latestState, ['declined', 'rejected'], true) ? 'Declined'
                        : ($latestState === 'recalled' ? 'Recalled' : 'Pending'));
                $signedUrl = null;
                if ($sigReq) {
                    $paths = is_array($sigReq->signed_document_paths) ? $sigReq->signed_document_paths : [];
                    $signedUrl = $paths[0]['file_url'] ?? $paths[0]['url'] ?? null;
                    if (!$signedUrl && $sigReq->signed_document_path) {
                        $signedUrl = file_url($sigReq->signed_document_path);
                    }
                }
                $piRow = [
                    'sig_req_id'  => $sigReq ? (int) $sigReq->id : ($activeReq ? (int) $activeReq->id : 0),
                    'signature_request_id' => $latestReq ? (int) $latestReq->id : null,
                    'sig_state'   => $latestState,
                    'name'        => 'Proforma Invoice (' . ($pi->code ?: ('PI-' . $pi->id)) . ')',
                    'required'    => 'REQ',
                    'status'      => $piStatus,
                    'uploaded_on' => $piSigned && $piDate ? \Illuminate\Support\Carbon::parse($piDate)->format('d-M-Y') : '—',
                    'valid_upto'  => '—',
                    'signed_url'  => $signedUrl,
                    'pi_id'       => (int) $pi->id,
                    'pi_code'     => (string) ($pi->code ?: ('PI-' . $pi->id)),
                ];
                array_unshift($tradeBuyer, $piRow);
            }

            $cons = $lead->consignee_id ? $consById->get($lead->consignee_id) : null;
            $buyerIsConsignee = !$cons || (bool) ($cons->same_as_customer ?? false);

            $primary = $type === 'consignee'
                ? ['trade' => $tradeCons, 'agr' => $agrCons]
                : ['trade' => $tradeBuyer, 'agr' => $agrBuyer];
            $tradeAll = ($type === 'consignee' && $ownerIsSameAsCustomer)
                ? $dedupe(array_merge(
                    array_values(array_filter($tradeBuyer, fn($r) => empty($r['pi_id']))),
                    $tradeCons,
                ))
                : $primary['trade'];
            $agrAll   = $primary['agr'];
            $signed   = fn(array $d) => collect($d)->where('status', 'Signed')->count();

            $sr++;
            $rows[] = [
                'id'             => $lid,
                'shipment_id'    => $shipCodeByLead[$lid] ?? ('SHP-' . str_pad((string) $lid, 3, '0', STR_PAD_LEFT)),
                'opportunity_id' => $lead->opp_code ?: ('OPP-' . $lid),
                'customer'       => optional($custById->get($lead->customer_id))->company_name ?: ($type === 'customer' ? $owner->company_name : '—'),
                'consignee'      => $cons->company_name ?? '—',
                'country'        => '',
                'due_dil'        => $ddRatio,
                'kyc'            => $kycRatio,
                'trade_lic'      => $tlRatio,
                'trade_docs'     => $this->ratio($signed($tradeAll), count($tradeAll)),
                'agreement'      => $this->ratio($signed($agrAll), count($agrAll)),
                'risk'           => ($signed($tradeAll) + $signed($agrAll)) >= (count($tradeAll) + count($agrAll)) && (count($tradeAll) + count($agrAll)) > 0 ? 'Compliant' : 'Medium',
                'buyer_is_consignee' => $buyerIsConsignee,
                'has_shipment'   => $hasShipment,
                'trade_docs_buyer'      => $tradeBuyer,
                'trade_docs_consignee'  => $tradeCons,
                'agreements_buyer'      => $agrBuyer,
                'agreements_consignee'  => $agrCons,
            ];
        }
        return $rows;
    }

    private function ratio(int $d, int $t): array
    {
        return ['ratio' => $d . '/' . $t, 'pct' => $t > 0 ? (int) round($d / $t * 100) : 0];
    }

    private function prefetchDealContext(int $cid, $piByLead, array $piIds): array
    {
        $ctx = [
            'prefetched'         => true,
            'pi'                 => [],
            'pi_products'        => [],
            'segment_by_product' => [],
            'segments'           => [],
        ];

        foreach ($piByLead as $oppId => $group) {
            $latest = $group->last();
            if ($latest) $ctx['pi'][(int) $oppId] = $latest;
        }
        if (!$piIds) return $ctx;

        foreach (
            ProformaInvoiceItem::whereIn('proforma_invoice_id', $piIds)
                ->whereNotNull('product_id')
                ->orderBy('line_no')
                ->orderBy('id')
                ->get(['proforma_invoice_id', 'product_id']) as $item
        ) {
            $ctx['pi_products'][(int) $item->proforma_invoice_id][] = (int) $item->product_id;
        }
        $productIds = collect($ctx['pi_products'])->flatten()->unique()->values()->all();
        if (!$productIds) return $ctx;

        foreach (
            Product::where('client_id', $cid)
                ->whereIn('id', $productIds)
                ->whereNotNull('segment_id')
                ->get(['id', 'segment_id']) as $product
        ) {
            $ctx['segment_by_product'][(int) $product->id] = (int) $product->segment_id;
        }
        $segmentIds = array_values(array_unique($ctx['segment_by_product']));
        if (!$segmentIds) return $ctx;

        foreach (ClmSegment::where('client_id', $cid)->whereIn('id', $segmentIds)->orderBy('id')->get() as $seg) {
            $ctx['segments'][(int) $seg->id] = $seg;
        }

        return $ctx;
    }

    private function applicableShipmentDocs(Lead $lead, int $cid, $reqs, ?string $partySegments = null, array $ctx = []): array
    {
        $empty = ['trade_docs_buyer' => [], 'trade_docs_consignee' => [], 'agreements_buyer' => [], 'agreements_consignee' => []];

        $prefetched = !empty($ctx['prefetched']);
        $source = $ctx['pi'][(int) $lead->id] ?? null;

        if (!$source && !$prefetched) {
            $source = ProformaInvoice::where('client_id', $cid)
                ->where('opp_id', $lead->id)
                ->where('status', '!=', ProformaInvoice::STATUS_CANCELLED)
                ->orderByDesc('id')
                ->first();
        }
        $fromPi = (bool) $source;
        if (!$source && $reqs->isNotEmpty()) {
            $source = Quotation::where('client_id', $cid)
                ->where('opp_id', $lead->id)
                ->where('status', '!=', 'cancelled')
                ->orderByDesc('id')
                ->first();
        }
        if (!$source) return $empty;

        if ($fromPi && $prefetched) {
            $productIds = collect($ctx['pi_products'][(int) $source->id] ?? [])->filter()->unique();
            if ($productIds->isEmpty()) return $empty;

            $segmentIds = $productIds
                ->map(fn($pid) => $ctx['segment_by_product'][(int) $pid] ?? null)
                ->filter()
                ->unique()
                ->flip();
            if ($segmentIds->isEmpty()) return $empty;

            $segments = collect($ctx['segments'])
                ->filter(fn($seg, $sid) => $segmentIds->has((int) $sid))
                ->values();
        } else {
            $productIds = $source->items()->whereNotNull('product_id')->pluck('product_id')->filter()->unique();
            if ($productIds->isEmpty()) return $empty;

            $segmentIds = Product::where('client_id', $cid)
                ->whereIn('id', $productIds)
                ->whereNotNull('segment_id')
                ->pluck('segment_id')
                ->unique();
            if ($segmentIds->isEmpty()) return $empty;

            $segments = ClmSegment::where('client_id', $cid)->whereIn('id', $segmentIds)->get();
        }
        if ($segments->isEmpty()) return $empty;

        $partySegRaw = $partySegments;
        $partySegs = array_values(array_filter(array_map(
            fn($x) => mb_strtolower(trim((string) $x)),
            explode(',', (string) $partySegRaw)
        )));
        unset($partySegs);

        $sigIndex = [
            ClmSignatureRequest::DOC_TRADE     => ['Customer' => [], 'Consignee' => []],
            ClmSignatureRequest::DOC_AGREEMENT => ['Customer' => [], 'Consignee' => []],
        ];
        $sigAny = [
            ClmSignatureRequest::DOC_TRADE     => [],
            ClmSignatureRequest::DOC_AGREEMENT => [],
        ];
        foreach ($reqs->sortByDesc('id') as $r) {
            $party = $r->model_name === 'Consignee' ? 'Consignee' : 'Customer';

            $meta     = is_array($r->metadata) ? $r->metadata : [];
            $kindIds  = is_array($meta['doc_kind_ids'] ?? null) ? $meta['doc_kind_ids'] : null;
            $byKind   = $kindIds ?: [
                $r->document_type => (is_array($r->trade_doc_ids) && $r->trade_doc_ids)
                    ? $r->trade_doc_ids
                    : [$r->trade_doc_id],
            ];

            foreach ($byKind as $kind => $ids) {
                if (!isset($sigIndex[$kind][$party])) continue;
                foreach ((array) $ids as $id) {
                    $id = (int) $id;
                    if (!$id) continue;
                    if (!isset($sigIndex[$kind][$party][$id])) {
                        $sigIndex[$kind][$party][$id] = $r;
                    }
                    if (!isset($sigAny[$kind][$id])) {
                        $sigAny[$kind][$id] = $r;
                    }
                }
            }
        }
        $sigFor = fn(string $docType, string $party, int $libId) =>
        $sigIndex[$docType][$party][$libId] ?? $sigAny[$docType][$libId] ?? null;

        $tdBuyer = [];
        $tdCons = [];
        $agrBuyer = [];
        $agrCons = [];
        $seen = ['td' => ['Customer' => [], 'Consignee' => []], 'agr' => ['Customer' => [], 'Consignee' => []]];

        foreach ($segments as $seg) {
            foreach ($this->matchSegmentLibrary(ClmAgreementLibrary::query(), $cid, $seg, 'agr_status') as $a) {
                [$forBuyer, $forCons] = $this->partyFlags($a->party);
                $name = $a->title ?: $a->code;
                $req  = 'REQ';
                if ($forBuyer && !isset($seen['agr']['Customer'][$a->id])) {
                    $seen['agr']['Customer'][$a->id] = true;
                    $sig = $sigFor(ClmSignatureRequest::DOC_AGREEMENT, 'Customer', (int) $a->id);
                    $agrBuyer[] = $this->shipmentDocRow($name, $req, $sig, $a->id, ClmSignatureRequest::DOC_AGREEMENT);
                }
                if ($forCons && !isset($seen['agr']['Consignee'][$a->id])) {
                    $seen['agr']['Consignee'][$a->id] = true;
                    $sig = $sigFor(ClmSignatureRequest::DOC_AGREEMENT, 'Consignee', (int) $a->id);
                    $agrCons[] = $this->shipmentDocRow($name, $req, $sig, $a->id, ClmSignatureRequest::DOC_AGREEMENT);
                }
            }

            foreach ($this->matchSegmentLibrary(ClmTradeDocLibrary::query(), $cid, $seg, 'status') as $m) {
                [$forBuyer, $forCons] = $this->partyFlags($m->party);
                $name = $m->title ?: ($m->name ?: $m->code);
                $req  = 'REQ';
                if ($forBuyer && !isset($seen['td']['Customer'][$m->id])) {
                    $seen['td']['Customer'][$m->id] = true;
                    $sig = $sigFor(ClmSignatureRequest::DOC_TRADE, 'Customer', (int) $m->id);
                    $tdBuyer[] = $this->shipmentDocRow($name, $req, $sig, $m->id, ClmSignatureRequest::DOC_TRADE);
                }
                if ($forCons && !isset($seen['td']['Consignee'][$m->id])) {
                    $seen['td']['Consignee'][$m->id] = true;
                    $sig = $sigFor(ClmSignatureRequest::DOC_TRADE, 'Consignee', (int) $m->id);
                    $tdCons[] = $this->shipmentDocRow($name, $req, $sig, $m->id, ClmSignatureRequest::DOC_TRADE);
                }
            }
        }

        return [
            'trade_docs_buyer'      => $tdBuyer,
            'trade_docs_consignee'  => $tdCons,
            'agreements_buyer'      => $agrBuyer,
            'agreements_consignee'  => $agrCons,
        ];
    }

    private function matchSegmentLibrary($query, int $cid, $seg, string $statusCol)
    {
        $name = $seg->name;
        $code = $seg->code;
        $statusVal = $statusCol === 'agr_status' ? 'Active' : 'active';

        $key = $seg->id ?? null;
        $cacheKey = $key === null ? null
            : get_class($query->getModel()) . '|' . $cid . '|' . $statusCol . '|' . (int) $key;
        if ($cacheKey !== null && isset($this->segmentLibraryCache[$cacheKey])) {
            return $this->segmentLibraryCache[$cacheKey];
        }

        $rows = $query->where('client_id', $cid)
            ->where('regulatory', $seg->regulatory_status)
            ->where(function ($q) use ($name, $code) {
                foreach ([$name, $code] as $needle) {
                    $n = mb_strtolower(trim((string) $needle));
                    if ($n === '') continue;
                    $q->orWhereRaw('LOWER(segment) = ?', [$n])
                        ->orWhereRaw('LOWER(segment) LIKE ?', [$n . ',%'])
                        ->orWhereRaw('LOWER(segment) LIKE ?', [$n . ', %'])
                        ->orWhereRaw('LOWER(segment) LIKE ?', ['%,' . $n])
                        ->orWhereRaw('LOWER(segment) LIKE ?', ['%, ' . $n])
                        ->orWhereRaw('LOWER(segment) LIKE ?', ['%,' . $n . ',%'])
                        ->orWhereRaw('LOWER(segment) LIKE ?', ['%, ' . $n . ',%']);
                }
            })
            ->where($statusCol, $statusVal)
            ->orderBy('id')
            ->get();

        if ($cacheKey !== null) $this->segmentLibraryCache[$cacheKey] = $rows;

        return $rows;
    }

    private function partyFlags(?string $party): array
    {
        $tokens = array_filter(array_map(
            fn($t) => strtolower(trim($t)),
            explode(',', (string) $party)
        ));
        if (empty($tokens)) return [true, true];
        $forBuyer     = in_array('buyer', $tokens, true);
        $forConsignee = in_array('consignee', $tokens, true);
        return [$forBuyer, $forConsignee];
    }

    private function shipmentDocRow(string $name, string $required, ?ClmSignatureRequest $req, ?int $libId = null, ?string $docType = null): array
    {
        if (!$req) {
            return [
                'sig_req_id'  => 0,
                'db_id'       => $libId,
                'doc_type'    => $docType,
                'name'        => $name,
                'required'    => $required,
                'status'      => 'Draft',
                'uploaded_on' => '—',
                'valid_upto'  => '—',
                'signed_url'  => null,
            ];
        }

        $status = match ($req->status) {
            'completed'  => 'Signed',
            'inprogress' => 'Pending',
            'declined'   => 'Declined',
            'recalled'   => 'Recalled',
            'expired'    => 'Expired',
            default      => 'Draft',
        };
        $signedOn = $status === 'Signed' && $req->completed_at
            ? \Illuminate\Support\Carbon::parse($req->completed_at)->format('d-M-Y')
            : '—';
        $paths  = is_array($req->signed_document_paths) ? $req->signed_document_paths : [];
        $signedUrl = $paths[0]['file_url'] ?? $paths[0]['url'] ?? null;
        if (!$signedUrl && $req->signed_document_path) {
            $signedUrl = file_url($req->signed_document_path);
        }

        return [
            'sig_req_id'  => (int) $req->id,
            'db_id'       => $libId,
            'doc_type'    => $docType,
            'name'        => $name,
            'required'    => $required,
            'status'      => $status,
            'uploaded_on' => $signedOn,
            'valid_upto'  => $req->expiry_date ? $req->expiry_date->format('d-M-Y') : '—',
            'signed_url'  => $signedUrl,
        ];
    }

    private function supplierApplicable(?string $party): bool
    {
        $tokens = array_filter(array_map(fn($t) => strtolower(trim($t)), explode(',', (string) $party)));
        if (empty($tokens)) return true;
        foreach ($tokens as $t) {
            if ($t === 'supplier' || str_starts_with($t, 'supplier')) return true;
        }
        return false;
    }

    private function vendorSupplierLibrary(int $cid, array $segIds, string $libClass, string $statusCol): \Illuminate\Support\Collection
    {
        if (empty($segIds)) return collect();

        $segments = ClmSegment::where('client_id', $cid)->whereIn('id', $segIds)->get();
        if ($segments->isEmpty()) return collect();

        $docs = collect();
        $seen = [];
        foreach ($segments as $seg) {
            foreach ($this->matchSegmentLibrary($libClass::query(), $cid, $seg, $statusCol) as $m) {
                if (isset($seen[$m->id]) || !$this->supplierApplicable($m->party)) continue;
                $seen[$m->id] = true;
                $docs->push($m);
            }
        }
        return $docs;
    }

    private function overlaySupplierDocs(\Illuminate\Support\Collection $libDocs, $reqs, string $docType = ClmSignatureRequest::DOC_TRADE, ?int $partyId = null): array
    {
        if ($libDocs->isEmpty()) return [];

        $sigIndex = [];
        foreach ($reqs->sortByDesc('id') as $r) {
            if ($r->model_name !== 'Vendor' || $r->document_type !== $docType) continue;
            if ($partyId !== null && (int) $r->party_id !== $partyId) continue;
            $ids = is_array($r->trade_doc_ids) && $r->trade_doc_ids ? $r->trade_doc_ids : [$r->trade_doc_id];
            foreach ((array) $ids as $id) {
                $id = (int) $id;
                if ($id && !isset($sigIndex[$id])) $sigIndex[$id] = $r;
            }
        }

        $rows = [];
        foreach ($libDocs as $m) {
            $sig = $sigIndex[$m->id] ?? null;
            $status = $sig ? (match ($sig->status) {
                'completed'  => 'Signed',
                'inprogress' => 'Pending',
                'declined'   => 'Declined',
                'recalled'   => 'Recalled',
                'expired'    => 'Expired',
                default      => 'Pending',
            }) : 'Pending';
            $signedOn = ($sig && $sig->status === 'completed' && $sig->completed_at)
                ? \Illuminate\Support\Carbon::parse($sig->completed_at)->format('d-M-Y') : null;
            $paths = $sig && is_array($sig->signed_document_paths) ? $sig->signed_document_paths : [];
            $signedUrl = $paths[0]['file_url'] ?? $paths[0]['url'] ?? null;
            if (!$signedUrl && $sig && $sig->signed_document_path) {
                $signedUrl = file_url($sig->signed_document_path);
            }
            $rows[] = [
                'id'                   => $sig ? (int) $sig->id : (int) $m->id,
                'db_id'                => (int) $m->id,
                'party'                => $m->party,
                'signature_request_id' => $sig ? (int) $sig->id : null,
                'sig_state'            => $sig?->status,
                'name'                 => $m->title ?: ($m->name ?: $m->code),
                'reference'            => $m->code,
                'authority'            => null,
                'issue_date'           => $signedOn,
                'expiry'               => $sig && $sig->expiry_date ? $sig->expiry_date->format('d-M-Y') : '—',
                'attachment'           => null,
                'attachment_url'       => $signedUrl,
                'status'               => $status,
                'doc_code'             => $m->code,
                'requirement'          => 'M',
                'certificate_url'      => $sig ? file_url($sig->certificate_path) : null,
            ];
        }
        return $rows;
    }

    public function missingMandatoryDocs(Model $owner, string $type, ?Customer $scopeCustomer = null): array
    {
        $cid = (int) ($owner->client_id ?? 0);

        $useScope = $type === 'consignee'
            && $scopeCustomer
            && $this->consigneeMappedToCustomer($cid, (int) $owner->id, (int) $scopeCustomer->id);

        $segmentIds = $useScope
            ? $this->resolveSegmentIds($scopeCustomer, 'customer', $cid)
            : $this->resolveSegmentIds($owner, $type, $cid);
        if (empty($segmentIds)) return [];

        $docType = $this->resolveDocType($owner, $type);
        $rules = ClmSegmentRule::query()
            ->where('client_id', $cid)
            ->whereIn('segment_id', $segmentIds)
            ->get()
            ->groupBy('segment_id')
            ->map(fn($g) => $g->firstWhere('document_type', $docType) ?? $g->first())
            ->filter()
            ->values();

        $unionByCat = ['kyc' => [], 'dd' => [], 'tl' => [], 'td' => [], 'qc' => []];
        foreach ($rules as $rule) {
            $sel = $rule->doc_selections ?? [];
            foreach (array_keys($unionByCat) as $cat) {
                $entries = $sel[$cat] ?? [];
                if (!is_array($entries)) continue;
                foreach ($entries as $code => $req) {
                    if (($unionByCat[$cat][$code] ?? null) === 'M') continue;
                    $unionByCat[$cat][$code] = ($req === 'M') ? 'M' : ($unionByCat[$cat][$code] ?? 'O');
                }
            }
        }

        $uploads = SegmentDocUpload::query()
            ->where('uploadable_type', get_class($owner))
            ->where('uploadable_id', $owner->id)
            ->get()
            ->keyBy(fn($u) => $u->category . '::' . $u->doc_code);

        $missingCodesByCat = [];
        foreach ($unionByCat as $cat => $codes) {
            foreach ($codes as $code => $req) {
                if ($req !== 'M') continue;
                if (!$uploads->get($cat . '::' . $code)) {
                    $missingCodesByCat[$cat][] = $code;
                }
            }
        }
        if (empty($missingCodesByCat)) return [];

        $masterClass = [
            'kyc' => ClmKycDocument::class,
            'dd' => ClmDdDocument::class,
            'tl'  => ClmTradeLicense::class,
            'td' => ClmTradeDocLibrary::class,
            'qc'  => ClmQcDocument::class,
        ];
        $missing = [];
        foreach ($missingCodesByCat as $cat => $codes) {
            $masters = $this->fetchMasters($masterClass[$cat], $codes, $cid, null, $owner->branch_id ?? null);
            foreach ($codes as $code) {
                $missing[] = [
                    'category' => $cat,
                    'doc_code' => $code,
                    'name'     => $masters[$code]['name'] ?? $code,
                ];
            }
        }
        return $missing;
    }

    public function destroy(Request $request, string $type, int $id, int $uploadId): JsonResponse
    {
        $owner = $this->resolveOwner($request, $type, $id, 'edit');

        $row = SegmentDocUpload::query()
            ->where('uploadable_type', get_class($owner))
            ->where('uploadable_id', $owner->id)
            ->where('id', $uploadId)
            ->firstOrFail();

        if ($row->attachment_path) {
            Storage::disk('public')->delete($row->attachment_path);
        }
        $row->delete();
        return response()->json(['data' => ['id' => $uploadId], 'message' => 'Deleted']);
    }

    private function segmentRowsOf(string $type, $owner): array
    {
        if (in_array($type, ['customer', 'consignee'], true)) {
            return \App\Support\SegmentGuard::rowsFor(\App\Support\SegmentGuard::idsOf($owner));
        }
        if ($owner instanceof \App\Models\Vendor) {
            $ids = DB::table('vendor_segments')->where('vendor_id', $owner->id)->orderBy('id')->pluck('segment_id')->all();
            if (!$ids && $owner->segment_id) $ids = [$owner->segment_id];
            return \App\Support\SegmentGuard::rowsFor($ids);
        }
        return [];
    }

    private function partyContactOf($owner): ?array
    {
        if (!$owner instanceof \App\Models\Vendor) return null;
        $addr = $owner->primaryAddress;
        return [
            'name'  => $addr?->contact_name ?: null,
            'email' => strtolower(trim((string) ($addr?->email ?: ($owner->primary_email ?? '')))) ?: null,
        ];
    }

    private function resolveOwner(Request $request, string $type, int $id, string $action = 'view'): Model
    {
        $class = self::TYPE_MAP[$type] ?? null;
        if (!$class) {
            abort(404, "Unsupported uploadable type: {$type}");
        }
        $user = $request->user();
        if (!$user) {
            abort(401);
        }
        $row = $class::query()->findOrFail($id);
        if ($user->client_id && (int) ($row->client_id ?? 0) !== (int) $user->client_id) {
            abort(404);
        }

        if ($row instanceof Consignee && $row->same_as_customer && $row->customer_id) {
            if ($action === 'view') {
                $linked = Customer::query()->find($row->customer_id);
                if ($linked && (!$user->client_id || (int) ($linked->client_id ?? 0) === (int) $user->client_id)) {
                    return $linked;
                }
            } else {
                abort(response()->json([
                    'message' => 'This consignee is flagged Same as Customer. Manage uploads on the linked customer instead.',
                ], 409));
            }
        }

        return $row;
    }

    private function resolveDocType(Model $owner, string $type): string
    {
        return app(\App\Services\SegmentDocScope::class)->docType($owner, $type);
    }

    private function resolveScopeCustomer(Request $request, string $type, int $id, int $cid): ?Customer
    {
        if ($type !== 'consignee' || !$cid) return null;
        $scopeId = (int) $request->query('scope_customer_id', 0);
        if ($scopeId <= 0) return null;

        $customer = Customer::where('client_id', $cid)->find($scopeId);
        if (!$customer) return null;

        return $this->consigneeMappedToCustomer($cid, $id, $scopeId) ? $customer : null;
    }

    private function consigneeMappedToCustomer(int $cid, int $consigneeId, int $customerId): bool
    {
        if (!$cid || !$consigneeId || !$customerId) return false;

        return Consignee::where('client_id', $cid)
            ->whereKey($consigneeId)
            ->whereHas('customers', fn($q) => $q->whereKey($customerId))
            ->exists();
    }

    private function resolveSegmentIds(Model $owner, string $type, int $cid): array
    {
        return app(\App\Services\SegmentDocScope::class)->segmentIds($owner, $type);
    }

    private function fetchMasters(string $modelClass, array $codes, int $cid, ?array $authMap = null, ?int $branchId = null): array
    {
        if (empty($codes)) return [];
        $rows = \App\Support\SegmentGuard::branchCatalogue($modelClass::query(), $cid, $codes, $branchId)->get();
        $authMap ??= ClmAuthority::idNameMap($cid);
        $byCode = [];
        foreach ($rows as $r) {
            if (isset($byCode[$r->code])) continue;
            $attrs = $r->getAttributes();
            $byCode[$r->code] = [
                'id'        => $r->id,
                'code'      => $r->code,
                'name'      => $r->name ?? ($attrs['title'] ?? $r->code),
                'authority' => ClmAuthority::displayNames($attrs['authority'] ?? null, $authMap),
                'expiry'    => $attrs['expiry'] ?? ($attrs['validity'] ?? null),
                'party'     => $attrs['party'] ?? null,
            ];
        }
        return $byCode;
    }

    private function storeUpload($file, string $type, int $ownerId, string $category, string $docCode): string
    {
        $ext = $file->getClientOriginalExtension() ?: 'bin';
        $slug = Str::slug("{$category}-{$docCode}", '-') ?: 'doc';
        $filename = "{$slug}-" . Str::random(8) . ".{$ext}";
        return $file->storeAs("segment_doc_uploads/{$type}/{$ownerId}", $filename, 'public');
    }

    private function shape(SegmentDocUpload $row): array
    {
        return [
            'id'              => $row->id,
            'category'        => $row->category,
            'doc_code'        => $row->doc_code,
            'doc_name'        => $row->doc_name,
            'requirement'     => $row->requirement,
            'attachment_path' => $row->attachment_path,
            'attachment_url'  => $row->attachment_url,
            'attachment_name' => $row->attachment_name,
            'issue_date'      => optional($row->issue_date)->format('Y-m-d'),
            'expiry_date'     => optional($row->expiry_date)->format('Y-m-d'),
            'uploaded_by'     => $row->uploaded_by,
            'created_at'      => optional($row->created_at)->toIso8601String(),
            'updated_at'      => optional($row->updated_at)->toIso8601String(),
        ];
    }
}
