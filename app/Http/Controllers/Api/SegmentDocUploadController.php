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
use App\Models\Quotation;
use App\Models\SegmentDocUpload;
use App\Models\ShipmentOrder;
use App\Models\Vendor;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;


class SegmentDocUploadController extends Controller
{
    /**
     * Map the URL `{type}` segment to a concrete Eloquent class so the
     * morph relation reads back consistently. Adding a fourth entity is
     * a one-line change here + matching frontend mapping.
     */
    private const TYPE_MAP = [
        'customer'  => Customer::class,
        'consignee' => Consignee::class,
        'supplier'  => Vendor::class,
        // alias kept for backward compatibility with any callers that
        // pass `vendor` instead of the user-facing rename.
        'vendor'    => Vendor::class,
        // Products carry a single `segment_id` FK so QC reference rows
        // can attach against the product's chosen segment, the same way
        // the customer/consignee/vendor forms upload their KYC/DD/TL.
        'product'   => Product::class,
    ];

    private const CATEGORIES = ['kyc', 'dd', 'tl', 'td', 'qc'];

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

        // Bucket by category so the frontend can hand each Stage 3
        // sub-tab its own slice without re-filtering on every render.
        $byCategory = [];
        foreach (self::CATEGORIES as $cat) {
            $byCategory[$cat] = [];
        }
        foreach ($rows as $row) {
            $byCategory[$row->category][] = $this->shape($row);
        }

        return response()->json([
            'data'         => $rows->map(fn ($r) => $this->shape($r))->all(),
            'by_category'  => $byCategory,
            'count'        => $rows->count(),
        ]);
    }

    /**
     * KPI roll-up: per-category mandatory/optional counts. The Stage 3
     * Evidence Vault renders these as cards across the top.
     *
     * Shape:
     *   {
     *     total: 12,
     *     mandatory: 8,
     *     optional: 4,
     *     by_category: { kyc: {…}, dd: {…}, tl: {…}, td: {…}, qc: {…} }
     *   }
     */
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
        $total = 0; $mand = 0; $opt = 0;
        foreach ($rows as $r) {
            $cat = $r->category;
            if (!isset($byCategory[$cat])) continue;
            $byCategory[$cat]['total']++;
            if ($r->requirement === 'M') { $byCategory[$cat]['mandatory']++; $mand++; }
            else                          { $byCategory[$cat]['optional']++;  $opt++;  }
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
            // Optional expiry date from the upload popup's Yes/No toggle.
            // Absent / null ⇒ the document carries no expiry.
            'expiry_date' => ['nullable', 'date'],
            // 2 MB cap + restricted to PDF / JPG / JPEG / PNG only — these all
            // preview in-browser via the row's View action. Word (doc/docx)
            // and spreadsheets are NOT accepted: browsers download Office
            // files instead of showing them, which broke the View flow.
            'attachment'  => ['required', 'file', 'max:2048', 'mimes:pdf,jpg,jpeg,png'],
        ]);
        $requirement = $data['requirement'] ?? 'O';
        $expiryDate  = $data['expiry_date'] ?? null;

        // Re-upload semantics: if a row already exists for the same
        // (entity, category, doc_code) tuple, drop its previous file
        // before pointing the row at the new path. The unique index
        // would block a fresh insert otherwise.
        $existing = SegmentDocUpload::query()
            ->where('uploadable_type', get_class($owner))
            ->where('uploadable_id', $owner->id)
            ->where('category', $data['category'])
            ->where('doc_code', $data['doc_code'])
            ->first();

        $path = $this->storeUpload($request->file('attachment'), $type, $owner->id, $data['category'], $data['doc_code']);
        $name = $request->file('attachment')->getClientOriginalName();

        if ($existing) {
            if ($existing->attachment_path && $existing->attachment_path !== $path) {
                Storage::disk('public')->delete($existing->attachment_path);
            }
            $existing->update([
                'doc_name'         => $data['doc_name'],
                'requirement'      => $requirement,
                'attachment_path'  => $path,
                'attachment_name'  => $name,
                'expiry_date'      => $expiryDate,
                'uploaded_by'      => optional($request->user())->id,
            ]);
            return response()->json(['data' => $this->shape($existing->fresh())], 200);
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
            'expiry_date'     => $expiryDate,
            'uploaded_by'     => optional($request->user())->id,
        ]);
        return response()->json(['data' => $this->shape($row)], 201);
    }

    /**
     * GET /api/segment-uploads/download?url=<attachment_url>  (or ?path=<disk path>)
     *
     * Force-download a stored attachment THROUGH the backend. On the deployed
     * server files live on Azure Blob (cross-origin, no CORS), so the browser
     * can't fetch them client-side to force a save — it just opens them. This
     * endpoint reads the file from the storage disk (Azure or local) and streams
     * it back same-origin with a `Content-Disposition: attachment` header, so
     * the download works everywhere. Tenant-scoped: the path must belong to a
     * segment_doc_uploads row the caller's client owns.
     */
    public function download(Request $request)
    {
        $user = $request->user();

        // Resolve the disk-relative path. Accept either an explicit ?path= or a
        // full ?url= (we slice out the segment_doc_uploads/... suffix).
        $path = ltrim((string) $request->query('path', ''), '/');
        if ($path === '') {
            $url = (string) $request->query('url', '');
            if ($url !== '' && preg_match('#(segment_doc_uploads/.+)$#i', $url, $m)) {
                $path = urldecode($m[1]);
            }
        }

        /* Drop any query string that rode along on the URL.
         *
         * `.+$` swallows it, so `…/kyc-001.png?sv=2021&sig=…` became part of
         * the path, matched no stored row, and 404'd. The frontend then fell
         * through to its last-resort `window.open`, which OPENS the file — the
         * "Download opens the document instead of saving it" report.
         *
         * Only the server can produce this: locally the URL is a bare
         * `/storage/…`, while on Azure it is an absolute blob URL that may
         * carry a SAS token or a cache-buster. Stripping here costs nothing and
         * removes a failure that cannot be reproduced on a dev box. */
        $path = explode('?', $path)[0];

        // Hard guard against traversal / arbitrary reads — only our upload tree.
        if ($path === '' || str_contains($path, '..') || ! str_starts_with($path, 'segment_doc_uploads/')) {
            abort(404, 'File not found.');
        }

        $row = SegmentDocUpload::where('attachment_path', $path)->first();
        if (! $row) {
            abort(404, 'File not found.');
        }
        // Tenant scope — non-super users can only pull their own client's files.
        if ($user && ! $user->isSuperAdmin() && $row->client_id && (int) $row->client_id !== (int) $user->client_id) {
            abort(403, 'You are not allowed to download this file.');
        }
        if (! Storage::disk('public')->exists($path)) {
            abort(404, 'File is missing on storage.');
        }

        $name = $row->attachment_name ?: basename($path);
        return Storage::disk('public')->download($path, $name);
    }

    /**
     * GET /api/segment-uploads/{type}/{id}/vault
     *
     * Compose the Evidence Vault payload. Combines three sources:
     *   1. The entity's segment(s)              → which rules apply
     *   2. Each rule's doc_selections           → expected documents
     *   3. segment_doc_uploads for the entity   → what's actually attached
     *
     * Returned shape mirrors VaultData on the frontend so the modal
     * plugs in without further mapping:
     *   {
     *     total_documents, verified_signed, pending,
     *     company_dd_count, owner_kyc_count, trade_license_count,
     *     trade_documents_count, total_shipments,
     *     company_dd: [{id,name,reference,authority,issue_date,expiry,attachment,attachment_url,status}, …],
     *     owner_kyc: […], trade_licenses: […], trade_documents: […],
     *     shipment_agreements: [],
     *     last_updated
     *   }
     *
     * Status semantics:
     *   • An uploaded doc      → 'Verified'
     *   • A doc the rule wants → 'Pending' (no upload yet)
     *   • The shipment_agreements bucket is intentionally empty until
     *     the per-shipment compliance matrix lands as its own table.
     */
    public function vault(Request $request, string $type, int $id): JsonResponse
    {
        $owner = $this->resolveOwner($request, $type, $id);
        $cid   = (int) ($owner->client_id ?? 0);

        // "Same as Customer" consignee — resolveOwner has already swapped
        // $owner to the linked customer (so the vault shows the customer's
        // docs), but the frontend needs to know to show a badge + block
        // uploads (a direct upload to the consignee returns 409).
        $sameAsCustomer = $type === 'consignee'
            && (bool) optional(Consignee::find($id))->same_as_customer;

        // 1. Resolve the entity's segment ids. Customer/Consignee
        // store segment as a comma-joined name string; Vendor uses an
        // FK column.
        //
        // Lead-scoped consignee vault: a consignee can be mapped to several
        // customers, so its own `segment` string is the UNION of every mapped
        // customer's segments. When the Sales Matrix opens a consignee's vault
        // in a lead context it passes ?scope_customer_id=<lead's customer> so
        // the checklist narrows to ONLY that customer's segment (the segment
        // driving that lead) — not the consignee's full cross-customer union.
        // Falls back to the union when the id is absent, not tenant-owned, or
        // not actually mapped to this consignee.
        $scopeCustomer = $this->resolveScopeCustomer($request, $type, $id, $cid);
        $segmentIds = $scopeCustomer
            ? $this->resolveSegmentIds($scopeCustomer, 'customer', $cid)
            : $this->resolveSegmentIds($owner, $type, $cid);

        // 2. Load each rule's doc_selections. A segment can now carry a Domestic
        // AND an International rule, so pick the one matching the entity's trade
        // type (India primary address → domestic, else international). Fall back
        // to whatever rule the segment has when it lacks the matching type, so
        // legacy entities (whose segments may only carry one typed rule) never
        // lose their documents. One rule per segment either way.
        $docType = $this->resolveDocType($owner, $type);
        $rules = ClmSegmentRule::query()
            ->where('client_id', $cid)
            ->whereIn('segment_id', $segmentIds)
            ->get()
            ->groupBy('segment_id')
            ->map(fn ($g) => $g->firstWhere('document_type', $docType) ?? $g->first())
            ->filter()
            ->values();

        /* Per-category union of (code => requirement). When the same
         * code shows up under multiple selected segments, Mandatory
         * wins over Optional (so the Vault renders the strictest
         * requirement the user agreed to). */
        $unionByCat = ['kyc' => [], 'dd' => [], 'tl' => [], 'td' => [], 'qc' => []];
        foreach ($rules as $rule) {
            $sel = $rule->doc_selections ?? [];
            foreach (array_keys($unionByCat) as $cat) {
                $entries = $sel[$cat] ?? [];
                if (!is_array($entries)) continue;
                foreach ($entries as $code => $req) {
                    $existing = $unionByCat[$cat][$code] ?? null;
                    if ($existing === 'M') continue;             // already strictest
                    $unionByCat[$cat][$code] = ($req === 'M') ? 'M' : ($existing ?? 'O');
                }
            }
        }

        // 3. Load master rows so the Vault can render reference/auth
        // metadata next to each row. One query per category keeps the
        // SQL count predictable even when 10+ segments are picked.
        $masters = [
            'kyc' => $this->fetchMasters(ClmKycDocument::class,    array_keys($unionByCat['kyc']), $cid),
            'dd'  => $this->fetchMasters(ClmDdDocument::class,     array_keys($unionByCat['dd']),  $cid),
            'tl'  => $this->fetchMasters(ClmTradeLicense::class,   array_keys($unionByCat['tl']),  $cid),
            'td'  => $this->fetchMasters(ClmTradeDocLibrary::class,array_keys($unionByCat['td']),  $cid),
            'qc'  => $this->fetchMasters(ClmQcDocument::class,     array_keys($unionByCat['qc']),  $cid),
        ];

        // 4. Pull the entity's actual uploads — group by category+code
        // so each (cat, code) doc can lookup its upload in O(1).
        $uploads = SegmentDocUpload::query()
            ->where('uploadable_type', get_class($owner))
            ->where('uploadable_id', $owner->id)
            ->get()
            ->keyBy(fn ($u) => $u->category . '::' . $u->doc_code);

        // 5. Build per-bucket rows.
        $buildBucket = function (string $cat) use ($unionByCat, $masters, $uploads): array {
            $rows = [];
            $i = 0;
            foreach ($unionByCat[$cat] as $code => $req) {
                $i++;
                $master = $masters[$cat][$code] ?? null;
                $upload = $uploads->get($cat . '::' . $code);
                $rows[] = [
                    'id'              => $upload?->id ?? $i,
                    // Master library id — drives the vault's Send-for-Signature
                    // launch for the Trade Documents bucket (null elsewhere).
                    'db_id'           => $master['id'] ?? null,
                    'name'            => $master['name'] ?? $code,
                    'reference'       => $master['code'] ?? $code,
                    'authority'       => $master['authority'] ?? null,
                    'issue_date'      => null,
                    // Prefer the expiry the user picked at upload time; fall
                    // back to the segment-rule master's generic validity text.
                    'expiry'          => optional($upload?->expiry_date)->format('d-M-Y')
                                          ?? ($master['expiry'] ?? '—'),
                    'attachment'      => $upload?->attachment_name,
                    'attachment_url'  => $upload?->attachment_url,
                    'status'          => $upload ? 'Verified' : 'Pending',
                    'requirement'     => $req,
                    'doc_code'        => $code,
                    // Applicable-party CSV so the vault can party-filter the
                    // Trade Documents tab to match the edit form.
                    'party'           => $master['party'] ?? null,
                ];
            }
            return $rows;
        };

        $company_dd      = $buildBucket('dd');
        $owner_kyc       = $buildBucket('kyc');
        $trade_licenses  = $buildBucket('tl');
        $trade_documents = $buildBucket('td');

        // CORE tally = Company DD + Owner KYC + Trade Licences, MANDATORY docs
        // only (the Sales-Matrix CLM card's "X of Y documents" counter). The
        // card tracks required-doc completion, so OPTIONAL docs are excluded —
        // it reads "12 of 12" only when every MANDATORY doc is on file. Trade
        // Documents were also dropped from the customer/consignee form, so they
        // aren't in this count either. total_documents/verified_signed stay
        // all-inclusive for the Evidence Vault (which still lists everything).
        $coreMandatory = collect(array_merge($company_dd, $owner_kyc, $trade_licenses))
            ->where('requirement', 'M');
        $coreVerified  = $coreMandatory->where('status', 'Verified')->count();
        // ALL core docs (mandatory + OPTIONAL) — a segment rule that carries only
        // OPTIONAL core docs still has a catalog, so the CLM card can show "X of Y
        // documents" instead of the misleading "No segment rules set". This does
        // NOT feed the mandatory-completion gate (which keeps using core_total).
        $coreCatalog         = collect(array_merge($company_dd, $owner_kyc, $trade_licenses));
        $coreCatalogVerified = $coreCatalog->where('status', 'Verified')->count();

        // Per-shipment matrix — each of the party's shipments with its buyer +
        // consignee Trade Documents and Agreements (split by signature party).
        // Pass the ORIGINAL route id ($id) for the shipment lookup. For a
        // "same as customer" consignee, $owner was swapped to the linked
        // Customer above, so $owner->id can't be trusted for the lead filter.
        $shipments = $this->buildShipmentAgreements($owner, $type, $cid, $company_dd, $owner_kyc, $trade_licenses, $id);

        // ── Header KPIs ─────────────────────────────────────────────────────
        // Customer/Consignee vaults have two document families:
        //   • Standard  = Company DD + Owner KYC + Trade Licences (one-time docs)
        //   • Case-to-Case = per-shipment Trade Documents + Agreements (per deal)
        // Both feed Total Documents / Verified / Pending, and each Case-to-Case
        // family gets its own KPI (Trade Documents, Total Agreements). Trade
        // Documents are a per-deal doc here, so the standard 'td' bucket is NOT a
        // KPI. Case-to-Case tallies come from each shipment's ratio, which
        // already reflects the displayed set (buyer-only when Customer =
        // Consignee).
        //
        // Supplier/vendor vaults model their per-deal docs differently (vendor
        // deals, not $shipments) and DO use the standard 'td' bucket, so they
        // keep the original all-inclusive standard tally.
        // Top-level Agreements bucket. Vendors fill it in the else branch;
        // customers/consignees fill it here from their OWN segment-applicable
        // agreements (segment-driven, NOT shipment-gated), so the single-bucket
        // Agreements popup matches the Buyer Profile's agr cell even when the
        // party has applicable agreements but no shipment order yet (CBC #66).
        $agreements = [];
        if (in_array($type, ['customer', 'consignee'], true)) {
            $agreements = $this->buildEntityAgreements($cid, $type, $id, $segmentIds);
            $c2c = function (string $key) use ($shipments) {
                $signed = 0; $total = 0;
                foreach ($shipments as $s) {
                    $parts   = explode('/', $s[$key]['ratio'] ?? '0/0');
                    $signed += (int) ($parts[0] ?? 0);
                    $total  += (int) ($parts[1] ?? 0);
                }
                return ['signed' => $signed, 'total' => $total];
            };
            $c2cTd  = $c2c('trade_docs');
            $c2cAgr = $c2c('agreement');

            $stdRows             = array_merge($company_dd, $owner_kyc, $trade_licenses);
            $stdVerified         = collect($stdRows)->where('status', 'Verified')->count();
            $stdPending          = count($stdRows) - $stdVerified;

            /* Agreement figures come from the PARTY's own applicable set, not
               from the shipment rows.
             *
             * $agreements above is already segment-driven for exactly this
             * reason (CBC #66) - a party can have applicable agreements before
             * any shipment order exists. The header card was left on the
             * shipment tally, so a customer with 9 applicable agreements and 3
             * signed showed "TOTAL AGREEMENTS 0" while the Buyer Profile listed
             * 3/9 for the same customer. Trade documents stay shipment-based:
             * they genuinely belong to a deal. */
            $agrTotal  = count($agreements);
            $agrSigned = collect($agreements)
                ->filter(fn ($a) => in_array($a['status'] ?? '', ['Signed', 'Verified'], true))
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

            // Vendor-level Agreements — the applicable agreement-library docs for
            // the vendor's segments, overlaid with this vendor's signature status
            // across ALL its deals (an agreement signed on any deal counts as
            // done). Feeds the PO form's Supplier Legal Status "Agreements" card,
            // mirroring how the standard buckets above expose verified-vs-total.
            $vendorSegIds  = $this->resolveSegmentIds($owner, 'vendor', $cid);
            $agreementLib  = $this->vendorSupplierLibrary($cid, $vendorSegIds, ClmAgreementLibrary::class, 'agr_status');
            $vendorAgrReqs = ClmSignatureRequest::where('client_id', $cid)
                ->where('model_name', 'Vendor')
                ->where('document_type', ClmSignatureRequest::DOC_AGREEMENT)
                ->get();
            $agreements      = $this->overlaySupplierDocs($agreementLib, $vendorAgrReqs, ClmSignatureRequest::DOC_AGREEMENT);
            $agreementsCount = count($agreements);
        }

        // Supplier Case-to-Case deals — split the vendor's procurements by
        // whether their lead carries a shipment (With / Without Shipment ID).
        $vendorDeals = in_array($type, ['supplier', 'vendor'], true) && $cid
            ? $this->buildVendorDeals($owner, $cid, $company_dd, $owner_kyc, $trade_licenses, $trade_documents)
            : ['with_shipment' => [], 'without_shipment' => [], 'ratios' => null];

        return response()->json([
            'data' => [
                'same_as_customer'       => $sameAsCustomer,
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
                'shipment_agreements'    => $shipments,
                'last_updated'           => optional($uploads->max('updated_at'))->format('d-M-Y'),
            ],
        ]);
    }

    /**
     * Supplier Case-to-Case deals for the Evidence Vault. Walks the procurements
     * where THIS vendor is the recorded supplier (procurement_products.vendor_id),
     * then surfaces two views over those deals:
     *   - with_shipment    → one row per shipment on those leads (SHP-xxx) +
     *                        customer / consignee
     *   - without_shipment → one row per procurement (PROC-xxx) whose lead has
     *                        NO shipment yet. Strict either/or split: a deal
     *                        whose lead already has a shipment appears only under
     *                        with_shipment, never here (no overlap).
     * Compliance ratios (KYC/DD/TL/TD) are the vendor's overall verified-vs-total
     * (no per-shipment document tracking exists in the schema), so the same
     * ratios ride on every row.
     */
    private function buildVendorDeals(Model $owner, int $cid, array $companyDd, array $ownerKyc, array $tradeLicenses, array $tradeDocuments): array
    {
        $r = fn (array $rows) => [
            'd' => collect($rows)->where('status', 'Verified')->count(),
            't' => count($rows),
        ];
        $ratios = ['kyc' => $r($ownerKyc), 'dd' => $r($companyDd), 'tl' => $r($tradeLicenses), 'td' => $r($tradeDocuments)];
        $empty  = ['with_shipment' => [], 'without_shipment' => [], 'ratios' => $ratios];
        $supplierName = (string) ($owner->company_name ?? '');

        // Procurements where THIS vendor is the recorded supplier on a product
        // line (procurement_products.vendor_id). Real vendor⇄procurement link —
        // a shared product no longer pulls in someone else's procurement.
        $procs = DB::table('procurements as pr')
            ->where('pr.client_id', $cid)
            ->whereExists(function ($q) use ($owner) {
                $q->selectRaw('1')->from('procurement_products as pp')
                    ->whereColumn('pp.procurement_id', 'pr.id')
                    ->where('pp.vendor_id', $owner->id);
            })
            ->get(['pr.id', 'pr.lead_id']);

        // Doc LISTS are driven by the VENDOR's own SEGMENTS — resolved once and
        // identical for every deal AND for a fresh vendor with no deal yet.
        // Segment (not procurement) is what decides which docs apply, so compute
        // these up-front, before the procurement check.
        $vendorSegIds = $this->resolveSegmentIds($owner, 'vendor', $cid);
        $tdLib  = $this->vendorSupplierLibrary($cid, $vendorSegIds, ClmTradeDocLibrary::class, 'status');
        $agrLib = $this->vendorSupplierLibrary($cid, $vendorSegIds, ClmAgreementLibrary::class, 'agr_status');
        // Trade-Docs column ratio = signed-vs-total of the per-deal docs shown in
        // the drill-down (not the DCP bucket, which is empty here).
        $tdRatio = fn (array $docs) => [
            'd' => collect($docs)->where('status', 'Signed')->count(),
            't' => count($docs),
        ];

        // Fresh vendor — no procurement/shipment yet. The docs STILL come from
        // the vendor's segment, so surface one "Without Shipment ID" row with the
        // segment-based Trade Docs + Agreements (status overlaid client-side by
        // db_id). Without this a freshly-added supplier showed an empty matrix
        // even though its segment defines applicable documents.
        if ($procs->isEmpty()) {
            $docs = $this->overlaySupplierDocs($tdLib,  collect(), ClmSignatureRequest::DOC_TRADE);
            $agrs = $this->overlaySupplierDocs($agrLib, collect(), ClmSignatureRequest::DOC_AGREEMENT);
            if (empty($docs) && empty($agrs)) return $empty;   // segment has no supplier docs at all
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

        // Shipments for those leads (With Shipment ID view).
        $shipByLead = DB::table('shipment_orders')->whereIn('lead_id', $leadIds->all() ?: [0])
            ->where('client_id', $cid)->get(['id', 'lead_id', 'shipment_code'])->keyBy('lead_id');

        $leads = DB::table('leads')->whereIn('id', $leadIds->all() ?: [0])->get(['id', 'customer_id', 'consignee_id'])->keyBy('id');
        $custNames = DB::table('customers')->whereIn('id', $leads->pluck('customer_id')->filter()->unique()->all() ?: [0])->pluck('company_name', 'id');
        $consNames = DB::table('consignees')->whereIn('id', $leads->pluck('consignee_id')->filter()->unique()->all() ?: [0])->pluck('company_name', 'id');

        // Per-deal STATUS is overlaid from this vendor's signature requests; the
        // doc LISTS ($tdLib / $agrLib) were resolved up-front from the vendor's
        // own segments since they're identical for every deal.
        $reqsByLead = ClmSignatureRequest::where('client_id', $cid)
            ->whereIn('lead_id', $leadIds->all() ?: [0])
            ->where('model_name', 'Vendor')
            ->get()
            ->groupBy('lead_id');
        $docCache = []; $agrCache = [];
        $reqsFor  = fn (?int $leadId) => $leadId ? ($reqsByLead[$leadId] ?? collect()) : collect();
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

        // Without Shipment ID = procurement-stage ONLY: procurements whose lead
        // does NOT yet have a shipment. A procurement that already became a
        // shipment appears under With Shipment ID instead — strict either/or
        // split, no overlap (a deal is in exactly one of the two views).
        $withoutShip = [];
        $sr = 0;
        foreach ($procs as $p) {
            $leadId = $p->lead_id ? (int) $p->lead_id : null;
            if ($leadId !== null && $shipByLead->has($leadId)) continue;  // has a shipment → With Shipment only
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

    /**
     * Build the per-shipment matrix for a party's Evidence Vault. Each row is
     * one of the party's shipment-linked opportunities, carrying its Buyer +
     * Consignee Trade Documents and Agreements — split by the signature
     * request's party (Customer vs Consignee). KYC / DD / Trade-License ratios
     * are the party's standard-doc progress (same across its shipments); the
     * Trade-Docs / Agreement ratios are per-shipment from signature completion.
     */
    private function buildShipmentAgreements(Model $owner, string $type, int $cid, array $companyDd, array $ownerKyc, array $tradeLicenses, int $entityId): array
    {
        // Vendors aren't modelled as buyer/consignee shipments here.
        if (!in_array($type, ['customer', 'consignee'], true) || !$cid) return [];

        // Leads (opportunities) for this party that carry a shipment order.
        // NOTE: use $entityId (the route id), NOT $owner->id — for a
        // "same as customer" consignee, resolveOwner swaps $owner to the
        // linked Customer, so $owner->id would be the customer's id and the
        // consignee_id filter would miss this consignee's shipments.
        $leadQ = Lead::where('client_id', $cid);
        if ($type === 'customer') $leadQ->where('customer_id', $entityId);
        else                      $leadQ->where('consignee_id', $entityId);
        $leads = $leadQ->get(['id', 'opp_code', 'customer_id', 'consignee_id']);
        if ($leads->isEmpty()) return [];

        $leadIds = $leads->pluck('id')->all();
        // Pull the actual shipment rows so the matrix can show the REAL
        // shipment code (shipment_orders.shipment_code, e.g. "SHP-258")
        // instead of a value fabricated from the lead id. Two maps:
        //   $shipLeadIds    — presence set (lead has a shipment order at all)
        //   $shipCodeByLead — lead_id ⇒ real SHP-NNN code (latest wins)
        // Legacy rows created before the shipment_code column existed carry a
        // NULL code; those fall back to the synthetic SHP-<lead_id> below.
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

        // Names for the buyer/consignee columns.
        $custIds = $leads->pluck('customer_id')->filter()->unique()->all();
        $consIds = $leads->pluck('consignee_id')->filter()->unique()->all();
        $custById = $custIds ? Customer::whereIn('id', $custIds)->get(['id', 'company_name'])->keyBy('id') : collect();
        $consById = $consIds ? Consignee::whereIn('id', $consIds)->get(['id', 'company_name', 'same_as_customer'])->keyBy('id') : collect();

        // All signature requests across these leads, grouped by lead.
        $sigByLead = ClmSignatureRequest::where('client_id', $cid)
            ->whereIn('lead_id', $leadIds)
            ->whereIn('document_type', [ClmSignatureRequest::DOC_TRADE, ClmSignatureRequest::DOC_AGREEMENT])
            ->orderBy('id')
            ->get()
            ->groupBy('lead_id');

        // Standard-doc ratios (shared across the party's shipments).
        $ratioOf = fn (array $rows) => $this->ratio(collect($rows)->where('status', 'Verified')->count(), count($rows));
        $ddRatio  = $ratioOf($companyDd);
        $kycRatio = $ratioOf($ownerKyc);
        $tlRatio  = $ratioOf($tradeLicenses);

        // Proforma Invoice of each shipment — surfaced as the FIRST Trade
        // Document (and counted in the Trade-Docs ratio). Keyed by lead/opp.
        $piByLead = ProformaInvoice::where('client_id', $cid)
            ->whereIn('opp_id', $leadIds)
            ->where('status', '!=', ProformaInvoice::STATUS_CANCELLED)
            ->orderBy('id')
            ->get(['id', 'opp_id', 'code', 'status', 'emailed_at', 'created_at'])
            ->groupBy('opp_id');

        // A PI reads as "Signed" only once its e-signature is COMPLETE — the same
        // source of truth the Q/PI list uses (ClmSignatureRequest on the PI). The
        // PI's own lifecycle column (sent/approved/…) does NOT imply a customer
        // e-signature, so keying off it made an e-signed PI show "Pending" here.
        // Map: pi_id ⇒ its completed signature request (carries completion date
        // + the signed-document path so the vault can offer a "View" link).
        // Also track an IN-PROGRESS (already-sent, not-yet-signed) PI signature
        // so the vault can hide "Send" and offer "Remind" instead — otherwise the
        // Send button stayed visible after sending and a re-click created a
        // duplicate signature request.
        $piSigReq    = [];   // pi_id ⇒ latest COMPLETED sig (Signed + View link)
        $piActiveReq = [];   // pi_id ⇒ latest IN-PROGRESS sig (sent, remind-able)
        $piLatestReq = [];   // pi_id ⇒ latest sig of ANY status (drives the tracker
                             //         + the display status incl. Declined/Recalled)
        $piIds = $piByLead->flatten()->pluck('id')->all();
        if ($piIds) {
            // ALL statuses (not just completed/inprogress) so a DECLINED or
            // recalled PI still surfaces its signature request — the vault needs
            // the request id to open the Signing Tracker and to read "Declined".
            ClmSignatureRequest::where('client_id', $cid)
                ->where('document_type', ClmSignatureRequest::DOC_PROFORMA_INVOICE)
                ->whereIn('trade_doc_id', $piIds)
                ->orderBy('id')
                ->get()
                ->each(function ($r) use (&$piSigReq, &$piActiveReq, &$piLatestReq) {
                    $pid = (int) $r->trade_doc_id;
                    $st  = strtolower((string) $r->status);
                    $piLatestReq[$pid] = $r;                                 // ordered by id → latest wins
                    if ($st === 'completed')  $piSigReq[$pid]    = $r;       // latest completed wins
                    if ($st === 'inprogress') $piActiveReq[$pid] = $r;       // latest in-progress wins
                });
        }

        // A document whose party covers BOTH buyer and consignee is emitted into
        // both lists; when merging the two sides for the ratio it must be counted
        // once (else "0/3" when only 2 distinct agreements exist). Dedupe by
        // library id (+ doc type), falling back to the name.
        $dedupe = function (array $rows): array {
            $seen = []; $out = [];
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
            if (!isset($shipLeadIds[$lid])) continue;   // shipment-linked only
            $reqs = $sigByLead->get($lid) ?? collect();

            // List EVERY applicable trade-doc / agreement (per the lead's
            // segment rules), with live signature status overlaid — so the
            // vault shows not-yet-sent docs (Draft), in-flight sends (Pending)
            // and signed docs (Signed) together, not just what was sent.
            $applicable = $this->applicableShipmentDocs($lead, $cid, $reqs);
            $tradeBuyer = $applicable['trade_docs_buyer'];
            $tradeCons  = $applicable['trade_docs_consignee'];
            $agrBuyer   = $applicable['agreements_buyer'];
            $agrCons    = $applicable['agreements_consignee'];

            // Prepend this shipment's Proforma Invoice(s) as the FIRST Trade
            // Document, then the other trade docs. It leads the side the current
            // vault displays — the buyer side for the customer vault, the
            // consignee side for the consignee vault (which uses forceParty). A
            // finalised PI reads Signed; a draft Pending. sig_req_id 0 → no Remind.
            foreach (($piByLead->get($lid) ?? collect()) as $pi) {
                $sigReq    = $piSigReq[(int) $pi->id] ?? null;
                $activeReq = $piActiveReq[(int) $pi->id] ?? null;   // sent-but-unsigned
                $latestReq = $piLatestReq[(int) $pi->id] ?? null;   // any status (latest)
                $piSigned  = (bool) $sigReq;
                $piDate    = $sigReq?->completed_at;
                // Latest request drives the display status + the tracker id, so a
                // declined PI reads "Declined" (until re-sent) and can be tracked.
                $latestState = $latestReq ? strtolower((string) $latestReq->status) : null;
                $piStatus = $piSigned ? 'Signed'
                    : (in_array($latestState, ['declined', 'rejected'], true) ? 'Declined'
                    : ($latestState === 'recalled' ? 'Recalled' : 'Pending'));
                // Resolve the signed-document URL the same way trade docs do, so
                // the vault can offer a "View" link on the signed PI.
                $signedUrl = null;
                if ($sigReq) {
                    $paths = is_array($sigReq->signed_document_paths) ? $sigReq->signed_document_paths : [];
                    $signedUrl = $paths[0]['file_url'] ?? $paths[0]['url'] ?? null;
                    if (!$signedUrl && $sigReq->signed_document_path) {
                        $signedUrl = Storage::disk('public')->url($sigReq->signed_document_path);
                    }
                }
                $piRow = [
                    // Non-zero once a signature request exists (completed OR still
                    // in-progress) → the vault hides "Send" and shows "Remind",
                    // so a sent PI can't be re-sent into a duplicate request.
                    'sig_req_id'  => $sigReq ? (int) $sigReq->id : ($activeReq ? (int) $activeReq->id : 0),
                    // Frontend reads `signature_request_id` for the Signing
                    // Tracker + Reminder gating (the legacy `sig_req_id` above is
                    // kept for older callers). Set for ANY status so a declined /
                    // in-progress / signed PI all open the tracker.
                    'signature_request_id' => $latestReq ? (int) $latestReq->id : null,
                    'sig_state'   => $latestState,
                    'name'        => 'Proforma Invoice (' . ($pi->code ?: ('PI-' . $pi->id)) . ')',
                    'required'    => 'REQ',
                    'status'      => $piStatus,
                    // "Signed On" — the e-signature completion date; unsigned shows —.
                    'uploaded_on' => $piSigned && $piDate ? \Illuminate\Support\Carbon::parse($piDate)->format('d-M-Y') : '—',
                    'valid_upto'  => '—',
                    'signed_url'  => $signedUrl,
                    // The PI's own id/code so the vault can offer the SAME
                    // "Send for Signature" flow the Sales-Matrix Q/PI stage uses
                    // (the /sales/proforma-invoices Zoho-sign path). Presence of
                    // pi_id is what tells the frontend this row is the PI.
                    'pi_id'       => (int) $pi->id,
                    'pi_code'     => (string) ($pi->code ?: ('PI-' . $pi->id)),
                ];
                if ($type === 'consignee') array_unshift($tradeCons, $piRow);
                else                       array_unshift($tradeBuyer, $piRow);
            }

            $cons = $lead->consignee_id ? $consById->get($lead->consignee_id) : null;
            $buyerIsConsignee = !$cons || (bool) ($cons->same_as_customer ?? false);

            /* Customer = Consignee → one entity, so the panel hides the
               Customer / Consignee / Both tabs and shows a single list: the
               PRIMARY side of whichever vault is open (buyer for the customer
               vault, consignee for the consignee vault). That list must hold
               documents applicable to that side ALONE, so drop the ones that
               also appear on the other side — a Buyer+Consignee document is
               emitted into both lists with the same db_id, and it belongs to the
               hidden shared view. Keyed the same way dedupe() keys rows.

               The consignee vault used to be excluded from this block because it
               never rendered tabs at all; now that it splits by party like the
               customer vault, it needs the mirror-image strip. */
            if ($buyerIsConsignee) {
                $keyOf = fn (array $r) => !empty($r['db_id'])
                    ? (($r['doc_type'] ?? '') . '#' . $r['db_id'])
                    : ('n#' . ($r['name'] ?? ''));
                $strip = function (array $keep, array $against) use ($keyOf) {
                    $drop = [];
                    foreach ($against as $r) { $drop[$keyOf($r)] = true; }
                    return array_values(array_filter($keep, fn ($r) => !isset($drop[$keyOf($r)])));
                };
                if ($type === 'consignee') {
                    $tradeCons = $strip($tradeCons, $tradeBuyer);
                    $agrCons   = $strip($agrCons, $agrBuyer);
                } else {
                    $tradeBuyer = $strip($tradeBuyer, $tradeCons);
                    $agrBuyer   = $strip($agrBuyer, $agrCons);
                }
            }

            /* The ratio must count exactly what the expanded panel displays.
               Both vaults now show the same three tabs, so both count the same
               way: the primary side alone when Customer = Consignee, otherwise
               buyer + consignee de-duped (the "Both" documents counted once).

               The consignee branch used to count `$tradeCons` only, matching the
               old consignee-only panel. Left as-is it would report e.g. 1/5 over
               a panel now listing 8 documents. */
            $primary = $type === 'consignee'
                ? ['trade' => $tradeCons, 'agr' => $agrCons]
                : ['trade' => $tradeBuyer, 'agr' => $agrBuyer];
            $tradeAll = $buyerIsConsignee ? $primary['trade'] : $dedupe(array_merge($tradeBuyer, $tradeCons));
            $agrAll   = $buyerIsConsignee ? $primary['agr']   : $dedupe(array_merge($agrBuyer, $agrCons));
            $signed   = fn (array $d) => collect($d)->where('status', 'Signed')->count();

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
                'trade_docs_buyer'      => $tradeBuyer,
                'trade_docs_consignee'  => $tradeCons,
                'agreements_buyer'      => $agrBuyer,
                'agreements_consignee'  => $agrCons,
            ];
        }
        return $rows;
    }

    /** {ratio:"d/t", pct:int} helper for the shipment matrix donuts. */
    private function ratio(int $d, int $t): array
    {
        return ['ratio' => $d . '/' . $t, 'pct' => $t > 0 ? (int) round($d / $t * 100) : 0];
    }

    /**
     * Expand the signature requests of one document_type + party into per-doc
     * rows for the Evidence Vault's expanded shipment view.
     */
    private function sigDocs($reqs, string $docType, string $party): array
    {
        $out = [];
        foreach ($reqs as $r) {
            if ($r->document_type !== $docType || $r->model_name !== $party) continue;
            $names = is_array($r->document_names) && $r->document_names ? $r->document_names : [$r->request_name ?: 'Document'];
            $status = match ($r->status) {
                'completed'  => 'Signed',
                'inprogress' => 'Pending',
                'declined'   => 'Declined',
                'recalled'   => 'Recalled',
                'expired'    => 'Expired',
                default      => 'Draft',
            };
            $sentAt = $r->metadata['sent_at'] ?? $r->created_at;
            $paths = is_array($r->signed_document_paths) ? $r->signed_document_paths : [];
            foreach ($names as $i => $name) {
                $p = $paths[$i] ?? $paths[0] ?? null;
                $signedUrl = $p['file_url'] ?? $p['url'] ?? null;
                if (!$signedUrl && $r->signed_document_path) {
                    $signedUrl = Storage::disk('public')->url($r->signed_document_path);
                }
                $out[] = [
                    'sig_req_id'  => (int) $r->id,
                    'name'        => (string) $name,
                    'required'    => 'REQ',
                    'status'      => $status,
                    'uploaded_on' => $sentAt ? \Illuminate\Support\Carbon::parse($sentAt)->format('d-M-Y') : '—',
                    'valid_upto'  => $r->expiry_date ? $r->expiry_date->format('d-M-Y') : '—',
                    'signed_url'  => $signedUrl,
                ];
            }
        }
        return $out;
    }

    /**
     * Every APPLICABLE trade-doc + agreement for a shipment lead, split by
     * party (buyer/consignee), with live signature status overlaid.
     *
     * Unlike sigDocs() — which only surfaces what was SENT — this lists the
     * full set the segment rules make applicable, so the Evidence Vault shows
     * not-yet-sent docs ("Draft"), in-flight sends ("Pending") and signed docs
     * ("Signed") side by side. Mirrors the canonical applicable-doc resolver in
     * ClmAgreementController::applicableForLead (used by the Sales Matrix Trade
     * Documents / Agreements popups) — keep the two in step.
     *
     * Already-sent docs that are no longer in the applicable set (e.g. the
     * segment list changed after a send) are appended as "orphans" so a signed
     * document never vanishes from the archive.
     *
     * @param  \Illuminate\Support\Collection  $reqs  signature requests for this lead
     * @return array{trade_docs_buyer:array,trade_docs_consignee:array,agreements_buyer:array,agreements_consignee:array}
     */
    private function applicableShipmentDocs(Lead $lead, int $cid, $reqs): array
    {
        $empty = ['trade_docs_buyer' => [], 'trade_docs_consignee' => [], 'agreements_buyer' => [], 'agreements_consignee' => []];

        // Segment list = products on the latest non-cancelled PI (or, if none,
        // the latest quotation) — same source applicableForLead() uses.
        $source = ProformaInvoice::where('client_id', $cid)
            ->where('opp_id', $lead->id)
            ->where('status', '!=', ProformaInvoice::STATUS_CANCELLED)
            ->orderByDesc('id')
            ->first()
            ?: Quotation::where('client_id', $cid)
                ->where('opp_id', $lead->id)
                ->where('status', '!=', 'cancelled')
                ->orderByDesc('id')
                ->first();
        if (!$source) return $empty;

        $productIds = $source->items()->whereNotNull('product_id')->pluck('product_id')->filter()->unique();
        if ($productIds->isEmpty()) return $empty;

        $segmentIds = Product::where('client_id', $cid)
            ->whereIn('id', $productIds)
            ->whereNotNull('segment_id')
            ->pluck('segment_id')
            ->unique();
        if ($segmentIds->isEmpty()) return $empty;

        $segments = ClmSegment::where('client_id', $cid)->whereIn('id', $segmentIds)->get();
        if ($segments->isEmpty()) return $empty;

        /* Narrow the deal's segments down to the ones the PARTY itself is
           registered under (QA #6/#7).
         *
         * The list above comes from the products on the PI, so a deal selling a
         * product outside the customer's own segments pulled in that segment's
         * agreements and the vault showed documents the customer has nothing to
         * do with.
         *
         * The guard matters: a party with NO segments recorded is left
         * unfiltered rather than emptied, because a blank segment field is far
         * more likely to be unmaintained data than a genuine "applies to
         * nothing" - and hiding a required agreement is worse than showing a
         * spare one. Segment names are folded to lower case on both sides;
         * casing drift between the two tables is a known source of 0/0. */
        $partySegRaw = $lead->customer_id
            ? optional(Customer::find($lead->customer_id))->segment
            : null;
        $partySegs = array_values(array_filter(array_map(
            fn ($x) => mb_strtolower(trim((string) $x)),
            explode(',', (string) $partySegRaw)
        )));
        if ($partySegs) {
            $segments = $segments->filter(
                fn ($sg) => in_array(mb_strtolower(trim((string) $sg->name)), $partySegs, true)
                         || in_array(mb_strtolower(trim((string) $sg->code)), $partySegs, true)
            )->values();
            if ($segments->isEmpty()) return $empty;
        }

        // Index signature requests by [docType][party] => [libId => request],
        // newest first. The library id lives in trade_doc_ids (multi-doc sends)
        // or the legacy trade_doc_id scalar. Party maps model_name → bucket.
        $sigIndex = [
            ClmSignatureRequest::DOC_TRADE     => ['Customer' => [], 'Consignee' => []],
            ClmSignatureRequest::DOC_AGREEMENT => ['Customer' => [], 'Consignee' => []],
        ];
        /* …plus a PARTY-AGNOSTIC index of the same requests.
         *
         * A signature request belongs to the LEAD and the DOCUMENT, not to one
         * side of the deal. `model_name` records the model the send was raised
         * FROM, and a Sales-Matrix send is always raised from the lead's
         * Customer — 'Consignee' is never written to that column. Bucketing
         * strictly on it therefore filed every send under Customer, so the
         * consignee's Evidence Vault reported its agreements as "Draft · 0/2"
         * while the customer's vault reported "Signed · 2/2" for the very same
         * documents on the very same shipment.
         *
         * The party-specific bucket still wins when one exists (so a genuine
         * consignee-only send keeps its own status); this is only the fallback
         * that stops an already-signed document reading as never sent. */
        $sigAny = [
            ClmSignatureRequest::DOC_TRADE     => [],
            ClmSignatureRequest::DOC_AGREEMENT => [],
        ];
        foreach ($reqs->sortByDesc('id') as $r) {
            $party = $r->model_name === 'Consignee' ? 'Consignee' : 'Customer';
            if (!isset($sigIndex[$r->document_type][$party])) continue;
            $ids = is_array($r->trade_doc_ids) && $r->trade_doc_ids ? $r->trade_doc_ids : [$r->trade_doc_id];
            foreach ((array) $ids as $id) {
                $id = (int) $id;
                if (!$id) continue;
                if (!isset($sigIndex[$r->document_type][$party][$id])) {
                    $sigIndex[$r->document_type][$party][$id] = $r;   // latest wins
                }
                if (!isset($sigAny[$r->document_type][$id])) {
                    $sigAny[$r->document_type][$id] = $r;             // latest wins
                }
            }
        }
        /* Party bucket first, lead-level send as the fallback. */
        $sigFor = fn (string $docType, string $party, int $libId) =>
            $sigIndex[$docType][$party][$libId] ?? $sigAny[$docType][$libId] ?? null;

        $tdBuyer = []; $tdCons = []; $agrBuyer = []; $agrCons = [];
        $seen = ['td' => ['Customer' => [], 'Consignee' => []], 'agr' => ['Customer' => [], 'Consignee' => []]];

        /* Only what THIS deal marked Necessary in the Sales-Matrix popup.
         * The vault used to list every segment-applicable document, so a deal
         * that had already decided it needs three of twelve still showed all
         * twelve here — two screens describing the same deal differently.
         * Keyed "kind:id", loaded once: the loop runs per segment AND per
         * party, so a lookup inside it would re-read the same handful of rows
         * for every document on screen. */
        $needs = [];
        if (Schema::hasTable('clm_lead_doc_needs')) {
            foreach (DB::table('clm_lead_doc_needs')->where('lead_id', $lead->id)->get() as $n) {
                $needs[$n->doc_kind . ':' . $n->doc_id] = (bool) $n->needed;
            }
        }

        foreach ($segments as $seg) {
            // Agreements applicable to this segment.
            foreach ($this->matchSegmentLibrary(ClmAgreementLibrary::query(), $cid, $seg, 'agr_status') as $a) {
                // Not marked Necessary for this deal → not this deal's document.
                if (($needs['agreement:' . $a->id] ?? null) !== true) continue;
                [$forBuyer, $forCons] = $this->partyFlags($a->party);
                $name = $a->title ?: $a->code;
                // Trade docs + agreements are mandatory documents for the deal.
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

            // Trade documents applicable to this segment.
            foreach ($this->matchSegmentLibrary(ClmTradeDocLibrary::query(), $cid, $seg, 'status') as $m) {
                // Same rule as agreements above.
                if (($needs['trade_doc:' . $m->id] ?? null) !== true) continue;
                [$forBuyer, $forCons] = $this->partyFlags($m->party);
                $name = $m->title ?: ($m->name ?: $m->code);
                // Trade docs + agreements are mandatory documents for the deal.
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

        // Only the documents the lead's segments actually make applicable are
        // shown — matching the canonical Sales-Matrix resolver
        // (ClmAgreementController::applicableForLead). We intentionally do NOT
        // append "orphan" sends (agreements/trade-docs sent under a different or
        // earlier segment context): those surfaced as wrong/additional rows that
        // don't belong to this shipment's segment.
        return [
            'trade_docs_buyer'      => $tdBuyer,
            'trade_docs_consignee'  => $tdCons,
            'agreements_buyer'      => $agrBuyer,
            'agreements_consignee'  => $agrCons,
        ];
    }

    /**
     * Match a CLM library (agreements / trade docs) to one segment the same way
     * applicableForLead does: regulatory tier + segment CSV (LIKE-anchored on
     * comma boundaries) + active status. $statusCol is the library's active
     * flag ('agr_status' ⇒ 'Active', 'status' ⇒ 'active').
     */
    private function matchSegmentLibrary($query, int $cid, $seg, string $statusCol)
    {
        $name = $seg->name;
        $code = $seg->code;
        $statusVal = $statusCol === 'agr_status' ? 'Active' : 'active';
        return $query->where('client_id', $cid)
            ->where('regulatory', $seg->regulatory_status)
            /* LOWER() on both sides. Postgres LIKE is case-sensitive, so a
               segment stored as "Foods" never matched a library row written
               "foods" - the vault then showed 0/0 while the Buyer Profile,
               which compares in PHP with mb_strtolower, listed the same doc.
               Casing drift between the two screens is what made the counts
               disagree; both now fold case before comparing. */
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
    }

    /**
     * Parse a doc's applicable-party CSV ("Buyer,Consignee") into buyer/
     * consignee flags for the customer/consignee Case-to-Case section.
     *
     * A blank party stays universal (applies to both, so it's never hidden).
     * But a doc that NAMES parties yet none is Buyer/Consignee (e.g.
     * "Supplier-Material / Goods") is supplier/other-only — not applicable
     * here — so BOTH flags return false and the caller drops the row (the
     * callers only emit a row when forBuyer or forConsignee is true). Mirrors
     * ClmAgreementController::partyForBuyerConsignee().
     *
     * @return array{0:bool,1:bool} [forBuyer, forConsignee]
     */
    private function partyFlags(?string $party): array
    {
        $tokens = array_filter(array_map(
            fn ($t) => strtolower(trim($t)),
            explode(',', (string) $party)
        ));
        // Unclassified (blank party) → applies to both.
        if (empty($tokens)) return [true, true];
        $forBuyer     = in_array('buyer', $tokens, true);
        $forConsignee = in_array('consignee', $tokens, true);
        return [$forBuyer, $forConsignee];
    }

    /**
     * Customer / Consignee top-level Agreements bucket — the agreements applicable
     * to the ENTITY'S OWN segments (segment-driven, exactly like the Buyer
     * Profile's agr cell), overlaid with this entity's COMPLETED agreement
     * e-signatures. Unlike buildShipmentAgreements() this is NOT gated on a
     * shipment order existing, so a party with applicable agreements but no
     * shipment still lists them (CBC #66: popup read "0 of 0" while the profile
     * cell read N). The customer counts every segment agreement; the consignee is
     * party-filtered to the consignee side — matching ClmBuyerProfileController.
     *
     * @param  int[]  $segmentIds  the entity's resolved segment ids
     * @return array<int,array<string,mixed>>  VaultDoc-shaped rows (name + status)
     */
    private function buildEntityAgreements(int $cid, string $type, int $entityId, array $segmentIds): array
    {
        if (!in_array($type, ['customer', 'consignee'], true) || !$cid || empty($segmentIds)) return [];

        $segments = ClmSegment::where('client_id', $cid)->whereIn('id', $segmentIds)->get();
        if ($segments->isEmpty()) return [];

        // Completed agreement e-signatures for THIS entity → set of signed lib ids.
        $modelName = $type === 'consignee' ? 'Consignee' : 'Customer';
        $signed = [];
        foreach (ClmSignatureRequest::where('client_id', $cid)
            ->where('document_type', ClmSignatureRequest::DOC_AGREEMENT)
            ->where('status', 'completed')
            ->where('model_name', $modelName)
            ->where('party_id', $entityId)
            ->get(['trade_doc_ids']) as $sr) {
            foreach ((is_array($sr->trade_doc_ids) ? $sr->trade_doc_ids : []) as $aid) {
                $signed[(int) $aid] = true;
            }
        }

        $rows = []; $seen = [];
        foreach ($segments as $seg) {
            foreach ($this->matchSegmentLibrary(ClmAgreementLibrary::query(), $cid, $seg, 'agr_status') as $a) {
                $aid = (int) $a->id;
                if (isset($seen[$aid])) continue;
                // Consignee vault lists only consignee-side agreements; the customer
                // vault lists every segment agreement (mirrors the profile cell).
                if ($type === 'consignee') {
                    [, $forCons] = $this->partyFlags($a->party);
                    if (!$forCons) continue;
                }
                $seen[$aid] = true;
                $rows[] = [
                    'db_id'     => $aid,
                    'name'      => $a->title ?: $a->code,
                    'authority' => null,
                    'status'    => isset($signed[$aid]) ? 'Signed' : 'Pending',
                ];
            }
        }
        return $rows;
    }

    /**
     * One Evidence-Vault shipment-doc row for an applicable library doc. With
     * no signature request the doc is "Draft" (not yet sent); otherwise the
     * Zoho status maps to Signed / Pending / Declined / Recalled / Expired.
     */
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
        // "Signed On" shows the completion date — only meaningful once signed.
        $signedOn = $status === 'Signed' && $req->completed_at
            ? \Illuminate\Support\Carbon::parse($req->completed_at)->format('d-M-Y')
            : '—';
        $paths  = is_array($req->signed_document_paths) ? $req->signed_document_paths : [];
        $signedUrl = $paths[0]['file_url'] ?? $paths[0]['url'] ?? null;
        if (!$signedUrl && $req->signed_document_path) {
            $signedUrl = Storage::disk('public')->url($req->signed_document_path);
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

    /**
     * True when a library doc's applicable-party CSV targets a SUPPLIER (any
     * Supplier-* sub-type), or names no party at all (applies to everyone).
     * Mirrors the /clm/trade-doc-library/for-party/supplier filter the supplier
     * form uses, so the deal drill-down shows the same docs the form would.
     */
    private function supplierApplicable(?string $party): bool
    {
        $tokens = array_filter(array_map(fn ($t) => strtolower(trim($t)), explode(',', (string) $party)));
        if (empty($tokens)) return true;                    // no party → all parties
        foreach ($tokens as $t) {
            if ($t === 'supplier' || str_starts_with($t, 'supplier')) return true;
        }
        return false;
    }

    /**
     * The Supplier Trade Documents OR Agreements applicable to a vendor —
     * resolved from the vendor's OWN segments (the segments it's onboarded for,
     * via resolveSegmentIds) → Supplier-party library rows. Segment-driven, NOT
     * product- or customer-PI-driven: the vendor's products are validated to its
     * segment anyway, and a stale product mapping must not drive the vault. Same
     * set for every one of the vendor's deals; per-deal signature status is
     * overlaid separately (see overlaySupplierDocs). Returns deduped library rows
     * (empty ⇒ no segment, or no Supplier-applicable library row).
     *
     * @param  array   $segIds     the vendor's segment ids (resolveSegmentIds)
     * @param  string  $libClass   ClmTradeDocLibrary::class | ClmAgreementLibrary::class
     * @param  string  $statusCol  'status' (trade docs) | 'agr_status' (agreements)
     */
    private function vendorSupplierLibrary(int $cid, array $segIds, string $libClass, string $statusCol): \Illuminate\Support\Collection
    {
        if (empty($segIds)) return collect();

        $segments = ClmSegment::where('client_id', $cid)->whereIn('id', $segIds)->get();
        if ($segments->isEmpty()) return collect();

        $docs = collect(); $seen = [];
        foreach ($segments as $seg) {
            foreach ($this->matchSegmentLibrary($libClass::query(), $cid, $seg, $statusCol) as $m) {
                if (isset($seen[$m->id]) || !$this->supplierApplicable($m->party)) continue;
                $seen[$m->id] = true;
                $docs->push($m);
            }
        }
        return $docs;
    }

    /**
     * Overlay this vendor's live Zoho trade-doc signature status (its requests on
     * ONE deal's lead) onto the vendor's applicable trade-doc library rows,
     * producing VaultDoc-shaped rows for the deal drill-down. A doc not yet sent
     * on this deal reads "Pending" with a Send action; once sent/signed the row
     * tracks the request. So the doc LIST is the vendor's (same per deal) while
     * the STATUS is per-deal. Shape matches VaultDoc so the existing
     * DealDocsSubTable + VaultRowActions render it unchanged.
     *
     * @param  \Illuminate\Support\Collection  $libDocs  library rows (from vendorSupplierLibrary)
     * @param  \Illuminate\Support\Collection  $reqs     this vendor's sig-requests on this lead
     * @param  string  $docType  DOC_TRADE | DOC_AGREEMENT — which signature kind to overlay
     */
    private function overlaySupplierDocs(\Illuminate\Support\Collection $libDocs, $reqs, string $docType = ClmSignatureRequest::DOC_TRADE): array
    {
        if ($libDocs->isEmpty()) return [];

        // library id => latest Vendor signature request (of this doc type) on this lead.
        $sigIndex = [];
        foreach ($reqs->sortByDesc('id') as $r) {
            if ($r->model_name !== 'Vendor' || $r->document_type !== $docType) continue;
            $ids = is_array($r->trade_doc_ids) && $r->trade_doc_ids ? $r->trade_doc_ids : [$r->trade_doc_id];
            foreach ((array) $ids as $id) { $id = (int) $id; if ($id && !isset($sigIndex[$id])) $sigIndex[$id] = $r; }
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
                $signedUrl = Storage::disk('public')->url($sig->signed_document_path);
            }
            $rows[] = [
                'id'                   => $sig ? (int) $sig->id : (int) $m->id,
                'db_id'                => (int) $m->id,                 // library id → Send-for-Signature
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
                'certificate_url'      => $sig && $sig->certificate_path ? Storage::disk('public')->url($sig->certificate_path) : null,
            ];
        }
        return $rows;
    }

    /**
     * Returns the MANDATORY documents (per the owner's DCP segment rules)
     * that have NOT yet been uploaded. Reuses the same segment-rule → upload
     * matching the Vault uses, so it stays in lock-step with what the user
     * sees in the Evidence Vault. Each entry: ['category','doc_code','name'].
     * Empty array ⇒ the party is complete (or has no segment / no mandatory
     * rules). Powers the "can't create a PI until the customer & consignee
     * have submitted their required documents" guard in
     * ProformaInvoiceController.
     *
     * @param  Model  $owner  a Customer or Consignee model
     * @param  string $type   'customer' | 'consignee'
     * @param  Customer|null $scopeCustomer  the customer driving the deal —
     *         narrows a CONSIGNEE's checklist to that customer's segment.
     */
    public function missingMandatoryDocs(Model $owner, string $type, ?Customer $scopeCustomer = null): array
    {
        $cid = (int) ($owner->client_id ?? 0);

        /* Lead-scoped consignee checklist — the SAME narrowing vault() does
         * with ?scope_customer_id. A consignee's own `segment` string is the
         * UNION of every customer it's mapped to, so without this the PI gate
         * demanded documents for segments belonging to OTHER customers —
         * documents the Evidence Vault never listed and the user had no way to
         * satisfy from this lead. The vault showed "complete" while the PI was
         * blocked. Scoping to the deal's customer puts the gate and the vault
         * back in lock-step. Falls back to the union when no customer is given
         * or the consignee isn't actually mapped to it. */
        $useScope = $type === 'consignee'
            && $scopeCustomer
            && $this->consigneeMappedToCustomer($cid, (int) $owner->id, (int) $scopeCustomer->id);

        $segmentIds = $useScope
            ? $this->resolveSegmentIds($scopeCustomer, 'customer', $cid)
            : $this->resolveSegmentIds($owner, $type, $cid);
        if (empty($segmentIds)) return [];

        // Match the entity's trade type (with a fallback to any rule) exactly
        // like vault() — otherwise the PI "required docs submitted" gate would
        // count the wrong document set for a domestic/international entity.
        $docType = $this->resolveDocType($owner, $type);
        $rules = ClmSegmentRule::query()
            ->where('client_id', $cid)
            ->whereIn('segment_id', $segmentIds)
            ->get()
            ->groupBy('segment_id')
            ->map(fn ($g) => $g->firstWhere('document_type', $docType) ?? $g->first())
            ->filter()
            ->values();

        // Per-category union of (code => requirement), Mandatory wins.
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

        // Which mandatory (cat, code) pairs are NOT uploaded?
        $uploads = SegmentDocUpload::query()
            ->where('uploadable_type', get_class($owner))
            ->where('uploadable_id', $owner->id)
            ->get()
            ->keyBy(fn ($u) => $u->category . '::' . $u->doc_code);

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

        // Resolve human names for the missing docs (best-effort).
        $masterClass = [
            'kyc' => ClmKycDocument::class,    'dd' => ClmDdDocument::class,
            'tl'  => ClmTradeLicense::class,   'td' => ClmTradeDocLibrary::class,
            'qc'  => ClmQcDocument::class,
        ];
        $missing = [];
        foreach ($missingCodesByCat as $cat => $codes) {
            $masters = $this->fetchMasters($masterClass[$cat], $codes, $cid);
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

    /* ──────────────────────────────────────────────────────────────────
     * Helpers
     * ────────────────────────────────────────────────────────────── */

    /**
     * Resolve `{type}/{id}` to a tenant-scoped entity. Throws 404 if the
     * type isn't supported or the user can't see this record.
     *
     * Same-as-customer read-through: when the resolved row is a Consignee
     * with `same_as_customer = true` and the caller is performing a READ
     * (`$action === 'view'`), we transparently swap to the linked Customer
     * so the consignee's Stage 3 Evidence Vault — segment-rule uploads
     * across all five categories (kyc/dd/tl/td/qc) — surfaces the
     * customer's documents instead of the consignee's empty bucket.
     * Writes ('edit') intentionally do NOT swap: the UI locks Stage 3
     * editing while the toggle is on, so attempting a store/destroy here
     * is a programming error that should fail loudly against the
     * consignee's own row (not silently mutate the customer's uploads).
     */
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
        /** @var Model $row */
        $row = $class::query()->findOrFail($id);
        // Same client_id check pattern Customer/Consignee/Vendor controllers
        // already use. Cross-tenant access reports as 404 (no info leak).
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
                // Defense-in-depth: the consignee's own segment_doc_uploads
                // bucket must stay empty while same_as_customer is on, or
                // the reads (which transparently swap to the customer)
                // would silently orphan the writes. The UI hides the
                // upload buttons under this flag — a 409 here only fires
                // against direct/legacy API callers.
                abort(response()->json([
                    'message' => 'This consignee is flagged Same as Customer. Manage uploads on the linked customer instead.',
                ], 409));
            }
        }

        return $row;
    }

    /**
     * Resolve the owning entity's segment ids regardless of where each
     * model stores them. Customer/Consignee carry a comma-joined name
     * string; Vendor uses an FK column. Returns an empty array when
     * nothing's set — the caller renders an empty vault rather than
     * 500'ing.
     */
    /**
     * The entity's trade type — India (primary address) → domestic, any other
     * country → international. Decides which of a segment's two document-type
     * rules (Domestic / International) the Evidence Vault applies.
     *
     * Customer/Consignee addresses store the country NAME directly; Vendor
     * addresses store a `country_id` FK, so resolve that through the relation.
     * No address (or unresolved country) → international, mirroring the forms'
     * `isDomesticCountry(unset) === false`.
     */
    private function resolveDocType(Model $owner, string $type): string
    {
        $addr = $owner->primaryAddress ?? null;
        if (!$addr) return 'international';
        $name = in_array($type, ['supplier', 'vendor'], true)
            ? optional($addr->country)->name          // VendorAddress.country_id → Countries
            : $addr->country;                          // Customer/Consignee: name string
        return trim((string) $name) === 'India' ? 'domestic' : 'international';
    }

    /**
     * Lead-scoped consignee vault helper. Returns the customer whose segment
     * should drive a consignee's document checklist, or null to fall back to
     * the consignee's own (cross-customer union) segment.
     *
     * Only honoured for `consignee` vaults that carry a `scope_customer_id`
     * query param. The customer must be tenant-owned AND actually mapped to
     * this consignee (via the consignee_customer pivot) — otherwise the scope
     * is ignored, so a stray/foreign id can never narrow or leak a vault.
     * $id is the ORIGINAL route consignee id (resolveOwner may have swapped
     * $owner to the linked customer for a "same as customer" consignee).
     */
    private function resolveScopeCustomer(Request $request, string $type, int $id, int $cid): ?Customer
    {
        if ($type !== 'consignee' || !$cid) return null;
        $scopeId = (int) $request->query('scope_customer_id', 0);
        if ($scopeId <= 0) return null;

        $customer = Customer::where('client_id', $cid)->find($scopeId);
        if (!$customer) return null;

        return $this->consigneeMappedToCustomer($cid, $id, $scopeId) ? $customer : null;
    }

    /**
     * Is this consignee actually mapped to this customer (consignee_customer
     * pivot), within the tenant? Guards both the vault's ?scope_customer_id
     * and missingMandatoryDocs' $scopeCustomer, so a stray or foreign id can
     * never narrow a checklist to a segment the party isn't entitled to.
     */
    private function consigneeMappedToCustomer(int $cid, int $consigneeId, int $customerId): bool
    {
        if (!$cid || !$consigneeId || !$customerId) return false;

        return Consignee::where('client_id', $cid)
            ->whereKey($consigneeId)
            ->whereHas('customers', fn ($q) => $q->whereKey($customerId))
            ->exists();
    }

    private function resolveSegmentIds(Model $owner, string $type, int $cid): array
    {
        if (in_array($type, ['supplier', 'vendor'], true)) {
            // Vendors can carry MULTIPLE segments (vendor_segments pivot) since
            // the Supplier form's multi-select. Union them so the vault counts
            // the docs for every selected segment; fall back to the legacy
            // scalar segment_id when the pivot is empty.
            $ids = $owner->segments()->pluck('clm_segments.id')->map(fn ($x) => (int) $x)->unique()->values()->all();
            if (!empty($ids)) return $ids;
            return $owner->segment_id ? [(int) $owner->segment_id] : [];
        }
        if ($type === 'product') {
            return $owner->segment_id ? [(int) $owner->segment_id] : [];
        }
        // customer / consignee — comma-joined name string. Empty
        // pieces drop out; the lookup is tenant-scoped.
        $names = collect(explode(',', (string) ($owner->segment ?? '')))
            ->map(fn ($n) => trim($n))
            ->filter()
            ->values();
        if ($names->isEmpty()) return [];
        return ClmSegment::query()
            ->where('client_id', $cid)
            ->whereIn('name', $names)
            ->pluck('id')
            ->map(fn ($x) => (int) $x)
            ->all();
    }

    /**
     * Pull master rows for a category, keyed by their code so the
     * Vault row builder can look them up in O(1). Returns each row's
     * useful display attributes (name, authority, expiry…) without
     * leaking internal ids the frontend doesn't need.
     */
    private function fetchMasters(string $modelClass, array $codes, int $cid): array
    {
        if (empty($codes)) return [];
        /* orderBy('id') is load-bearing, not tidiness (QA #102).
         *
         * The KYC / DD / TL / QC catalogues each hold TWO rows for codes
         * ...-001 to ...-020, seeded on different dates with DIFFERENT names
         * (KYC-020 is both "Digital Signature Certificate" and "Latest ITR").
         * The loop below keys by code, so with no ORDER BY whichever row the
         * database happened to return last silently won — and Postgres is free
         * to change that between plans. The Evidence Vault therefore listed a
         * different document for the same rule from one load to the next, while
         * the Document Control Panel (which does order by id) showed the first.
         *
         * Ordering by id and keeping the FIRST occurrence makes the vault
         * deterministic AND agree with the DCP. It does not fix the underlying
         * duplication — that is a data cleanup, and which set to keep is not
         * this function's call — but it stops the same rule rendering as two
         * different documents. */
        $rows = $modelClass::query()
            ->where('client_id', $cid)
            ->whereIn('code', $codes)
            ->orderBy('id')
            ->get();
        // Document masters store the issuing authority by id (comma-joined for
        // multi-authority docs) — resolve to current names so the Evidence
        // Vault shows the authority name, not a raw id. Unknown tokens (e.g. a
        // Trade Document's free-text counter party) pass through unchanged.
        $authMap = ClmAuthority::idNameMap($cid);
        $byCode = [];
        foreach ($rows as $r) {
            // First row per code wins (see the orderBy note above) — a later
            // duplicate must not overwrite it.
            if (isset($byCode[$r->code])) continue;
            $attrs = $r->getAttributes();
            $byCode[$r->code] = [
                // Master row primary key. For the Trade Documents bucket this
                // is the clm_trade_doc_library.id the Send-for-Signature flow
                // needs; harmless metadata for the other categories.
                'id'        => $r->id,
                'code'      => $r->code,
                'name'      => $r->name ?? ($attrs['title'] ?? $r->code),
                'authority' => ClmAuthority::displayNames($attrs['authority'] ?? null, $authMap),
                'expiry'    => $attrs['expiry'] ?? ($attrs['validity'] ?? null),
                // Applicable-party CSV (e.g. "Buyer, Consignee"). Only the
                // Trade Document master carries it; lets the Evidence Vault
                // mirror the edit form's party filter.
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
            'expiry_date'     => optional($row->expiry_date)->format('Y-m-d'),
            'uploaded_by'     => $row->uploaded_by,
            'created_at'      => optional($row->created_at)->toIso8601String(),
            'updated_at'      => optional($row->updated_at)->toIso8601String(),
        ];
    }
}
