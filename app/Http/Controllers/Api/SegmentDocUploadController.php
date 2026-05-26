<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClmDdDocument;
use App\Models\ClmKycDocument;
use App\Models\ClmQcDocument;
use App\Models\ClmSegment;
use App\Models\ClmSegmentRule;
use App\Models\ClmTradeDocLibrary;
use App\Models\ClmTradeLicense;
use App\Models\Consignee;
use App\Models\Customer;
use App\Models\Product;
use App\Models\SegmentDocUpload;
use App\Models\Vendor;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Polymorphic uploads for the segment-rule reference rows.
 *
 * Backs the Stage 2 per-row uploader + the Stage 3 Evidence Vault for
 * Customers / Consignees / Suppliers. The (entity, category, doc_code)
 * tuple is unique — re-uploading replaces the previous file (server
 * cleans the old disk path before swapping).
 *
 *   GET    /api/segment-uploads/{type}/{id}                → list
 *   GET    /api/segment-uploads/{type}/{id}/summary        → KPI counts
 *   POST   /api/segment-uploads/{type}/{id}                → upload/replace
 *   DELETE /api/segment-uploads/{type}/{id}/{uploadId}     → remove
 *
 *   {type} ∈ customer | consignee | supplier
 *
 * Tenant scope: we resolve the parent entity through its own client_id
 * filter so a user can only attach files to records their tenant owns.
 */
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
            // 2 MB cap + restricted to the same six extensions the
            // frontend allow-list enforces (PDF / JPG / JPEG / PNG /
            // DOC / DOCX). xls/xlsx dropped — spreadsheets aren't a
            // supported KYC/DD/TL attachment format on the client.
            'attachment'  => ['required', 'file', 'max:2048', 'mimes:pdf,jpg,jpeg,png,doc,docx'],
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

        return response()->json([
            'data' => [
                'total_documents'        => count($allRows),
                'verified_signed'        => $verified,
                'pending'                => $pending,
                'company_dd_count'       => count($company_dd),
                'owner_kyc_count'        => count($owner_kyc),
                'trade_license_count'    => count($trade_licenses),
                'trade_documents_count'  => count($trade_documents),
                'total_shipments'        => 0,
                'company_dd'             => $company_dd,
                'owner_kyc'              => $owner_kyc,
                'trade_licenses'         => $trade_licenses,
                'trade_documents'        => $trade_documents,
                /* Per-shipment compliance matrix isn't sourced yet —
                 * keep the key so the frontend's empty-state branch
                 * fires instead of crashing on a missing array. */
                'shipment_agreements'    => [],
                'last_updated'           => optional($uploads->max('updated_at'))->format('d/m/Y'),
            ],
        ]);
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
        $byCode = [];
        foreach ($rows as $r) {
            $attrs = $r->getAttributes();
            $byCode[$r->code] = [
                'code'      => $r->code,
                'name'      => $r->name ?? ($attrs['title'] ?? $r->code),
                'authority' => $attrs['authority'] ?? null,
                'expiry'    => $attrs['expiry'] ?? ($attrs['validity'] ?? null),
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
