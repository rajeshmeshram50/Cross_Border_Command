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
use App\Models\SegmentDocUpload;
use App\Models\ShipmentOrder;
use App\Models\Vendor;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
            // 2 MB cap + restricted to PDF / JPG / JPEG / PNG only — these all
            // preview in-browser via the row's View action. Word (doc/docx)
            // and spreadsheets are NOT accepted: browsers download Office
            // files instead of showing them, which broke the View flow.
            'attachment'  => ['required', 'file', 'max:2048', 'mimes:pdf,jpg,jpeg,png'],
        ]);
        $requirement = $data['requirement'] ?? 'O';

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
        $segmentIds = $this->resolveSegmentIds($owner, $type, $cid);

        // 2. Load each rule's doc_selections — only the ones for this
        // tenant. Empty selections array stays harmless downstream.
        $rules = ClmSegmentRule::query()
            ->where('client_id', $cid)
            ->whereIn('segment_id', $segmentIds)
            ->get();

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
                    'expiry'          => $master['expiry'] ?? '—',
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

        $allRows = array_merge($company_dd, $owner_kyc, $trade_licenses, $trade_documents);
        $verified = collect($allRows)->where('status', 'Verified')->count();
        $pending  = collect($allRows)->where('status', 'Pending')->count();

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

        // Per-shipment matrix — each of the party's shipments with its buyer +
        // consignee Trade Documents and Agreements (split by signature party).
        // Pass the ORIGINAL route id ($id) for the shipment lookup. For a
        // "same as customer" consignee, $owner was swapped to the linked
        // Customer above, so $owner->id can't be trusted for the lead filter.
        $shipments = $this->buildShipmentAgreements($owner, $type, $cid, $company_dd, $owner_kyc, $trade_licenses, $id);

        return response()->json([
            'data' => [
                'same_as_customer'       => $sameAsCustomer,
                'total_documents'        => count($allRows),
                'verified_signed'        => $verified,
                'core_total_documents'   => $coreMandatory->count(),
                'core_verified_signed'   => $coreVerified,
                'pending'                => $pending,
                'company_dd_count'       => count($company_dd),
                'owner_kyc_count'        => count($owner_kyc),
                'trade_license_count'    => count($trade_licenses),
                'trade_documents_count'  => count($trade_documents),
                'total_shipments'        => count($shipments),
                'company_dd'             => $company_dd,
                'owner_kyc'              => $owner_kyc,
                'trade_licenses'         => $trade_licenses,
                'trade_documents'        => $trade_documents,
                'shipment_agreements'    => $shipments,
                'last_updated'           => optional($uploads->max('updated_at'))->format('d/m/Y'),
            ],
        ]);
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

        $rows = [];
        $sr = 0;
        foreach ($leads as $lead) {
            $lid = (int) $lead->id;
            if (!isset($shipLeadIds[$lid])) continue;   // shipment-linked only
            $reqs = $sigByLead->get($lid) ?? collect();

            $tradeBuyer = $this->sigDocs($reqs, ClmSignatureRequest::DOC_TRADE, 'Customer');
            $tradeCons  = $this->sigDocs($reqs, ClmSignatureRequest::DOC_TRADE, 'Consignee');
            $agrBuyer   = $this->sigDocs($reqs, ClmSignatureRequest::DOC_AGREEMENT, 'Customer');
            $agrCons    = $this->sigDocs($reqs, ClmSignatureRequest::DOC_AGREEMENT, 'Consignee');

            // Prepend this shipment's Proforma Invoice(s) as the first Trade
            // Documents on the Buyer side. They count toward the Trade-Docs
            // ratio. A finalised PI (sent/approved/converted) reads as Signed;
            // a draft is still Pending. sig_req_id is 0 → no Zoho Remind action.
            foreach (($piByLead->get($lid) ?? collect()) as $pi) {
                $piSigned = in_array($pi->status, [
                    ProformaInvoice::STATUS_SENT,
                    ProformaInvoice::STATUS_APPROVED,
                    ProformaInvoice::STATUS_CONVERTED_TO_CONTRACT,
                ], true);
                $piDate = $pi->emailed_at ?? $pi->created_at;
                array_unshift($tradeBuyer, [
                    'sig_req_id'  => 0,
                    'name'        => 'Proforma Invoice (' . ($pi->code ?: ('PI-' . $pi->id)) . ')',
                    'required'    => 'REQ',
                    'status'      => $piSigned ? 'Signed' : 'Pending',
                    'uploaded_on' => $piDate ? \Illuminate\Support\Carbon::parse($piDate)->format('d/m/Y') : '—',
                    'valid_upto'  => '—',
                    'signed_url'  => null,
                ]);
            }

            $tradeAll = array_merge($tradeBuyer, $tradeCons);
            $agrAll   = array_merge($agrBuyer, $agrCons);
            $signed   = fn (array $d) => collect($d)->where('status', 'Signed')->count();

            $cons = $lead->consignee_id ? $consById->get($lead->consignee_id) : null;
            $buyerIsConsignee = !$cons || (bool) ($cons->same_as_customer ?? false);

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
                    'uploaded_on' => $sentAt ? \Illuminate\Support\Carbon::parse($sentAt)->format('d/m/Y') : '—',
                    'valid_upto'  => $r->expiry_date ? $r->expiry_date->format('d/m/Y') : '—',
                    'signed_url'  => $signedUrl,
                ];
            }
        }
        return $out;
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
     */
    public function missingMandatoryDocs(Model $owner, string $type): array
    {
        $cid = (int) ($owner->client_id ?? 0);
        $segmentIds = $this->resolveSegmentIds($owner, $type, $cid);
        if (empty($segmentIds)) return [];

        $rules = ClmSegmentRule::query()
            ->where('client_id', $cid)
            ->whereIn('segment_id', $segmentIds)
            ->get();

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
    private function resolveSegmentIds(Model $owner, string $type, int $cid): array
    {
        if (in_array($type, ['supplier', 'vendor', 'product'], true)) {
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
        $rows = $modelClass::query()
            ->where('client_id', $cid)
            ->whereIn('code', $codes)
            ->get();
        // Document masters store the issuing authority by id (comma-joined for
        // multi-authority docs) — resolve to current names so the Evidence
        // Vault shows the authority name, not a raw id. Unknown tokens (e.g. a
        // Trade Document's free-text counter party) pass through unchanged.
        $authMap = ClmAuthority::idNameMap($cid);
        $byCode = [];
        foreach ($rows as $r) {
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
            'uploaded_by'     => $row->uploaded_by,
            'created_at'      => optional($row->created_at)->toIso8601String(),
            'updated_at'      => optional($row->updated_at)->toIso8601String(),
        ];
    }
}
