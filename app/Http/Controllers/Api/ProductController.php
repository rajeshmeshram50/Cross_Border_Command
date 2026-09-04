<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\LeadProduct;
use App\Models\PurchaseOrderItem;
use App\Models\SupplierPurchaseInvoiceItem;
use App\Models\Masters\Conditions;
use App\Models\Masters\GstPercentage;
use App\Models\Masters\HazClass;
use App\Models\Masters\HsnCodes;
use App\Models\Masters\PackagingMaterial;
use App\Models\Masters\Segments;
use App\Models\Masters\Uom;
use App\Models\Product;
use App\Models\ProductQcRecord;
use App\Models\ProductVendorMap;
use App\Models\User;
use App\Models\Vendor;
use App\Support\MasterBundleCache;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class ProductController extends Controller
{
    /* ──────────────────────────────────────────────────────────────────
     * Tenant scoping
     *
     * Products are a SHARED branch catalog: branch users AND employees both see
     * globals + client-level + their own branch's rows (sibling branches stay
     * hidden). This intentionally OVERRIDES the peer-isolated employee default
     * in MasterVisibility (where an employee would see only rows they created) —
     * a product master that hides the branch's catalog from staff isn't useful.
     * Other user types still fall through to MasterVisibility. Editing remains
     * gated by hierarchicalDenial, so staff can VIEW but not modify branch-owned
     * products.
     * ────────────────────────────────────────────────────────────── */
    private function applyScope($query, Request $request, bool $applyBranchFilter = false)
    {
        // $applyBranchFilter is opt-in (true only on the LIST endpoint): the
        // BranchSwitcher injects ?branch_id= on every GET incl. show/update,
        // but only the list should narrow by it — resolving a single product
        // by id must not 404 just because a different branch is being viewed.
        $branchFilter = $applyBranchFilter ? ($request->integer('branch_id') ?: null) : null;
        $user = $request->user();

        // Products are a SHARED branch catalog — EVERY employee (not only HODs)
        // sees the whole branch's rows: globals + client-level + their own
        // branch's products, so a product the branch/Director/teammate created is
        // visible to all staff in that branch. Sibling branches stay hidden
        // (branch_id segregation). This deliberately OVERRIDES MasterVisibility's
        // peer-isolated employee default (which would show only self-created
        // rows). Editing is still gated by editDenial()/hierarchicalDenial() —
        // staff can VIEW but not modify products they don't own (HODs manage the
        // whole branch catalog).
        if ($user && ($user->user_type ?? null) === 'employee') {
            MasterVisibility::applyBranchScope($query, $user);
            return $query;
        }

        MasterVisibility::applyReadScope($query, $user, $branchFilter);
        return $query;
    }

    private function applyListFilters($query, Request $request)
    {
        // Free-text search across the four identifying columns.
        if ($q = trim((string) $request->query('q', ''))) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%';
            $query->where(function ($w) use ($like) {
                $w->where('name', 'ilike', $like)
                    ->orWhere('product_code', 'ilike', $like)
                    ->orWhere('brand', 'ilike', $like)
                    ->orWhere('generic_name', 'ilike', $like);
            });
        }

        if ($status = $request->query('status')) {
            $status = strtolower((string) $status);
            if ($status === 'inactive') {
                $query->whereIn('status', ['inactive', 'draft']);
            } elseif (in_array($status, ['active', 'draft'], true)) {
                $query->where('status', $status);
            }
        }

        // Vendor deep-link (/products?vendor_id=…) — one specific supplier.
        if ($vendorId = $request->query('vendor_id')) {
            $query->whereHas('vendorMaps', fn($w) => $w->where('vendor_id', $vendorId));
        }

        $inRelation = function (string $relation, array $columns, ?array $values) use ($query) {
            if (!$values) {
                return;
            }
            $query->whereHas($relation, function ($w) use ($columns, $values) {
                $w->where(function ($inner) use ($columns, $values) {
                    foreach ($columns as $i => $column) {
                        $i === 0
                            ? $inner->whereIn($column, $values)
                            : $inner->orWhereIn($column, $values);
                    }
                });
            });
        };

        $list = fn(string $key) => array_values(array_filter(
            (array) $request->query($key, []),
            fn($v) => $v !== null && $v !== ''
        ));

        $inRelation('segment',   ['name'],                 $list('segment'));
        /* The toolbar's single-select segment is a SEPARATE condition from the
         * sidebar's multi-select — folding them into one IN list would turn an
         * AND into an OR and widen the result instead of narrowing it. */
        if ($segmentEq = $request->query('segment_eq')) {
            $query->whereHas('segment', fn ($w) => $w->where('name', $segmentEq));
        }
        $inRelation('hsn',       ['hsn_code'],             $list('hsn'));
        $inRelation('uom',       ['short_code', 'title'],  $list('uom'));
        $inRelation('condition', ['title'],                $list('condition'));
        $inRelation('hazClass',  ['name'],                 $list('haz_class'));

        if ($gst = $list('gst_rate')) {
            $rates = array_values(array_filter(array_map(
                fn($v) => is_numeric($n = preg_replace('/[^\d.]/', '', (string) $v)) ? (float) $n : null,
                $gst
            ), fn($v) => $v !== null));

            if ($rates) {
                $query->whereHas('gstPercentage', fn($w) => $w->whereIn('percentage', $rates));
            }
        }

        // Mapped supplier company names (product_vendor_maps.vendor_name).
        if ($vendors = $list('vendor')) {
            $query->whereHas('vendorMaps', fn($w) => $w->whereIn('vendor_name', $vendors));
        }

        $hazTypes = array_map('strtoupper', $list('haz_type'));
        $wantsHaz = in_array('HAZ', $hazTypes, true);
        $wantsNon = in_array('NON HAZ', $hazTypes, true);

        if ($wantsHaz !== $wantsNon) {
            $isHaz = fn($w) => $w
                ->where('haz_type', 'ilike', 'haz%')
                ->where('haz_type', 'not ilike', '%non%');

            if ($wantsHaz) {
                $query->where($isHaz);
            } else {
                // NULL never satisfies a NOT-ilike in SQL, so spell it out —
                // otherwise every product with no haz_type would vanish.
                $query->where(fn($w) => $w->whereNull('haz_type')->orWhereNot($isHaz));
            }
        }

        // Product owner — the dropdown's values are users.id (created_by).
        if ($owners = $list('owner')) {
            $query->whereIn('created_by', array_map('intval', $owners));
        }

        // Inclusive created-at window; either side may be omitted.
        if ($from = $request->query('created_from')) {
            $query->whereDate('created_at', '>=', $from);
        }
        if ($to = $request->query('created_to')) {
            $query->whereDate('created_at', '<=', $to);
        }

        /* Relative creation windows from the filter drawer ("Last 7 days",
         * "Last 30 days", …). Several can be ticked at once, so the windows OR
         * together inside one group — otherwise they would cancel each other
         * out and return nothing. 'older' (everything before the 90-day
         * cut-off) is still honoured here, though the drawer no longer offers
         * it as a row. */
        if ($buckets = $list('created_bucket')) {
            $cut = fn(int $days) => now()->subDays($days - 1)->toDateString();

            $query->where(function ($outer) use ($buckets, $cut) {
                foreach ($buckets as $bucket) {
                    $outer->orWhere(function ($w) use ($bucket, $cut) {
                        // "Custom" row: last:<n> days, typed in the drawer.
                        if (preg_match('/^last:(\d{1,4})$/', (string) $bucket, $m) && (int) $m[1] > 0) {
                            $w->whereDate('created_at', '>=', $cut((int) $m[1]));
                            return;
                        }

                        match ($bucket) {
                            'last_7'  => $w->whereDate('created_at', '>=', $cut(7)),
                            'last_30' => $w->whereDate('created_at', '>=', $cut(30)),
                            'last_90' => $w->whereDate('created_at', '>=', $cut(90)),
                            'older'   => $w->whereDate('created_at', '<',  $cut(90)),
                            // Unknown key: match nothing rather than everything.
                            default   => $w->whereRaw('1 = 0'),
                        };
                    });
                }
            });
        }

        return $query;
    }

    /**
     * The Active / Inactive tabs split on SUPPLIER MAPPING, not on the status
     * column: "Supplier Mapped Products" vs "Zero Supplier Products".
     */
    private function applySupplierTab($query, Request $request)
    {
        return match (strtolower((string) $request->query('supplier', ''))) {
            'mapped' => $query->has('vendorMaps'),
            'zero'   => $query->doesntHave('vendorMaps'),
            default  => $query,
        };
    }

    private function ownershipFor(Request $request): array
    {
        $user = $request->user();
        return [
            'client_id'  => $user->client_id,
            'branch_id'  => $user->branch_id,
            'created_by' => $user->id,
        ];
    }

    /**
     * Edit/delete denial for a product. An HOD manages the WHOLE branch catalog
     * (like the Director / branch user), so the peer/hierarchy denial is skipped
     * for them — they can edit/delete any product in their branch, not just the
     * ones they created. Everyone else falls through to the standard rule.
     */
    private function editDenial($user, $product, string $action = 'edit'): ?string
    {
        if ($this->isBranchHod($user, $product)) {
            return null;
        }
        return MasterVisibility::hierarchicalDenial($user, $product, $action);
    }

    /** True when $user is an HOD employee in the same client + branch as $product. */
    private function isBranchHod($user, $product): bool
    {
        if (!$user || ($user->user_type ?? null) !== 'employee') {
            return false;
        }
        if ((int) $user->client_id !== (int) $product->client_id) {
            return false;
        }
        if ($product->branch_id && (int) $user->branch_id !== (int) $product->branch_id) {
            return false;
        }
        return \App\Models\Employee::where('user_id', $user->id)
            ->whereIn('designation_id', \App\Support\DepartmentPermissionSync::hodDesignationIds())
            ->exists();
    }

    /* ──────────────────────────────────────────────────────────────────
     * Department information wall (read-side masking)
     *
     * Products carry BOTH a selling price (base_price / total_price / GST) and
     * the sourcing side (vendor maps: who the supplier is + the purchase
     * price). Two departments must never see the other half:
     *   - PURCHASE department → selling price is hidden. They source; they
     *     must not know the margin / what the product is sold for.
     *   - SALES department    → vendor details are hidden. They quote; they
     *     must not know who the supplier is or the purchase cost.
     *
     * This applies to EVERY employee in that department, the HOD included.
     * Only cross-department accounts (branch_user / client_* / super_admin)
     * carry no department and therefore see everything. It is READ-ONLY
     * masking: the columns still store the data, the same GET endpoints just
     * return a conditional shape depending on who is asking. Writes are not
     * blocked here.
     * ────────────────────────────────────────────────────────────── */

    /** Selling-price fields hidden from the Purchase department. */
    private const SELLING_FIELDS = ['base_price', 'gst_id', 'gst_amount', 'total_price', 'mark_bottom'];

    /**
     * Which product field groups must be stripped from responses for the
     * caller, keyed by group. Only employees carry a department; every other
     * account type sees the full payload.
     *
     * @return array{selling: bool, vendor: bool}
     */
    private function departmentHiddenGroups(Request $request): array
    {
        $hide = ['selling' => false, 'vendor' => false];
        $user = $request->user();
        if (!$user || ($user->user_type ?? null) !== 'employee') {
            return $hide;
        }

        $deptId = \App\Models\Employee::where('user_id', $user->id)->value('department_id');
        if (!$deptId) {
            return $hide;
        }

        $deptName = strtolower(trim((string) \App\Models\Masters\Departments::whereKey($deptId)->value('name')));
        if ($deptName === 'purchase') {
            $hide['selling'] = true;
        } elseif ($deptName === 'sales') {
            $hide['vendor'] = true;
        }
        return $hide;
    }

    /**
     * Apply the department mask to a product's array form. Selling-price fields
     * are nulled (the key stays so the SPA form still binds); the vendor list
     * is emptied so the Sales side sees "no suppliers" rather than the rows.
     *
     * @param array{selling: bool, vendor: bool} $hide
     */
    private function maskProductArray(array $payload, array $hide): array
    {
        if ($hide['selling']) {
            foreach (self::SELLING_FIELDS as $field) {
                if (\array_key_exists($field, $payload)) {
                    $payload[$field] = null;
                }
            }
            // The selling-GST relation (gst_id → gst_percentage) is part of the
            // price picture — drop it too so the rate can't be reverse-read.
            unset($payload['gst_percentage']);
        }
        if ($hide['vendor']) {
            // Empty (not removed) so callers iterating vendor_maps still get a
            // valid array; the Sales side simply sees zero supplier *rows*.
            // BUT keep the bare count — the product card shows "N Suppliers"
            // (and its Active/Zero-supplier tabs key off it). Sales is allowed
            // to know HOW MANY suppliers a product has, just not who they are
            // or the purchase price, so surface the count separately before the
            // identifying rows are dropped.
            if (\array_key_exists('vendor_maps', $payload)) {
                $payload['vendor_count'] = \count($payload['vendor_maps']);
                $payload['vendor_maps'] = [];
            }
        }
        return $payload;
    }

    private function nextProductCode(?int $clientId, ?int $branchId): string
    {
        // Scan every code this BRANCH owns and pick the true numeric max.
        // Codes are per-branch sequential — each branch restarts at P-01 so a
        // new branch doesn't inherit another branch's running count (bug: a
        // product created under Branch 2 was handed P-15 because the counter
        // was client-wide). Matches the branch-scoped CLM/vendor code counters
        // and the (client_id, branch_id, product_code) unique index.
        //
        // Previously this used orderByDesc('id')->value which returns the
        // MOST-RECENTLY-INSERTED code, not the highest one. We also pull from
        // withTrashed so soft-deleted rows don't release their code back into
        // the pool, matching how vendors and customers handle theirs.
        $q = Product::withTrashed();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
        $codes = $q->pluck('product_code');

        $max = 0;
        foreach ($codes as $code) {
            if ($code && preg_match('/(\d+)$/', (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }
        // 2-digit padding: P-01, P-02, …, P-99. Codes beyond 99 fall back
        // to natural width (P-100, P-101) — str_pad won't truncate.
        return 'P-' . str_pad((string) ($max + 1), 2, '0', STR_PAD_LEFT);
    }

    /* ──────────────────────────────────────────────────────────────────
     * GET /products
     * Query params: status, q, per_page
     * ────────────────────────────────────────────────────────────── */
    public function index(Request $request)
    {
        // Lightweight mode for pickers (e.g. the supplier "Map Product" popup).
        // The full listing eager-loads 10 relations — including two hasMany
        // (`vendorMaps`, `qcRecords`) that fan out across every row — which made
        // a 500-row fetch take ~5s. A picker only needs id / code / name / HSN /
        // segment / base price / GST %, so `?lite=1` loads just the three
        // belongsTo relations those fields come from and drops the rest.
        $lite = $request->boolean('lite');

        $query = Product::query()->with(
            $lite
                ? [
                    // Full belongsTo loads (no column restriction) — the picker
                    // only needs these three relations, but restricting columns
                    // risks a wrong column name per table (e.g. clm_segments has
                    // no `title`), so load them whole. The real win is dropping
                    // the heavy hasMany relations below.
                    'hsn',
                    'segment',
                    'gstPercentage',
                ]
                : [
                    'segment',
                    'hazClass',
                    'uom',
                    'hsn',
                    'condition',
                    'packagingMaterial',
                    'gstPercentage',
                    'vendorMaps:id,product_id,vendor_name',
                    'qcRecords:id,product_id',
                ]
        );

        $query = $this->applyScope($query, $request, true); // opt-in BranchSwitcher narrowing

        // Every narrowing the Products page can apply, shared verbatim with
        // stats() so the tab badges and the rows always agree.
        $query = $this->applyListFilters($query, $request);

        /* Tab badges ride along with the rows. They are counted BEFORE the
         * supplier tab narrows the query — each badge has to keep reporting
         * its own total while the other tab is open — and shipping them here
         * saves the page a second round trip to stats() on every filter
         * change. stats() stays for callers that only want the numbers. */
        $mappedCount = (clone $query)->has('vendorMaps')->count();
        $zeroCount   = (clone $query)->doesntHave('vendorMaps')->count();

        $query = $this->applySupplierTab($query, $request);

        /* Sorting. 'recent' (the default) keeps the historical newest-first
         * order. Price sorts use total_price — the figure the card prints.
         * The UI also offers "rating", which has no column behind it; it
         * falls through to the default rather than silently doing nothing
         * different from price. */
        match ($request->query('sort')) {
            'price-asc'  => $query->orderBy('total_price'),
            'price-desc' => $query->orderByDesc('total_price'),
            default      => $query->orderByDesc('id'),
        };

        /* Page size is capped: the page asks for 12 by default, but a crafted
         * per_page=100000 would eager-load ten relations across every row and
         * hand the tenant a multi-second query. */
        $perPage = max(1, min((int) $request->query('per_page', 24), 200));

        $products = $query->paginate($perPage);

        // Department information wall — Purchase hides selling price, Sales hides
        // vendor details. Transform each row into its masked array form.
        $hide = $this->departmentHiddenGroups($request);
        if ($hide['selling'] || $hide['vendor']) {
            $products->setCollection(
                $products->getCollection()->map(fn($p) => $this->maskProductArray($p->toArray(), $hide))
            );
        }

        return response()->json($products->toArray() + [
            'counts' => ['active' => $mappedCount, 'inactive' => $zeroCount],
        ]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * GET /products/{id}
     * ────────────────────────────────────────────────────────────── */
    public function show(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)
            ->with([
                'segment',
                'hazClass',
                'uom',
                'hsn',
                'condition',
                'packagingMaterial',
                'gstPercentage',
                'qcRecords',
                'vendorMaps',
                'vendorMaps.vendor:id,vendor_code',
            ])
            ->findOrFail($id);

        /* Embed the QC reference uploads inline. AddProductModal previously
         * fired GET /segment-uploads/product/{id}?category=qc as a second
         * round-trip on edit-mode open; on `php artisan serve` that single-
         * threaded server made the call pay the full Laravel boot tax
         * (~500ms). Bundling collapses 2 round-trips into 1 — same proven
         * pattern shipped for Customer / Consignee / Vendor.
         *
         * SegmentDocUploadController reads the category filter from
         * $request->query('category'), so we set it on the query bag before
         * delegating. Wrapped in try/catch so a failure here (e.g. fresh
         * product with no uploads returning empty) cannot break show().
         *
         * Backwards-compat shape: we append `segment_uploads` to the
         * product's array form rather than wrapping in {data, segment_uploads}.
         * Other GET callers (ProductView, AddProductModal) read fields
         * directly off res.data (e.g. res.data.name, res.data.qc_records)
         * and the new top-level key is additive — nothing else breaks.
         */
        $segmentUploads = $this->safeDelegate(function () use ($request, $id) {
            $request->query->set('category', 'qc');
            return (new SegmentDocUploadController())->index($request, 'product', $id);
        });

        $payload = $this->maskProductArray($product->toArray(), $this->departmentHiddenGroups($request));
        $payload['segment_uploads'] = $segmentUploads ?: ['data' => [], 'by_category' => [], 'count' => 0];

        return response()->json($payload);
    }

    /**
     * Run a delegated controller call and unwrap its JSON response,
     * returning `null` on any failure. Caller decides how to default
     * the missing key.
     */
    private function safeDelegate(\Closure $call): ?array
    {
        try {
            $res = $call();
            $decoded = json_decode($res->getContent(), true);
            return is_array($decoded) ? $decoded : null;
        } catch (\Throwable $e) {
            \Log::warning('ProductController::show safeDelegate failed: ' . $e->getMessage());
            return null;
        }
    }

    /* ──────────────────────────────────────────────────────────────────
     * POST /products/step/core
     * Create-or-update the Core info. Returns the product with its id so
     * subsequent step calls can target it.
     * ────────────────────────────────────────────────────────────── */
    public function storeCore(Request $request)
    {
        $data = $request->validate([
            'id'                    => 'nullable|integer|exists:products,id',
            'name'                  => 'required|string|max:100',
            'generic_name'          => 'nullable|string|max:255',
            // Cap description at INPUT. The column is TEXT, but an uncapped
            // description let a ~934 KB paste through, which the PI/PO PDFs chunk
            // into ~8k table rows and blow dompdf's memory (2 GB OOM). 10000 chars
            // is very generous for a real description, yet bounded for the
            // renderers (~85 rows). Fix the source, not the templates.
            'description'           => 'nullable|string|max:10000',
            'brand'                 => 'nullable|string',
            'segment_id'            => 'nullable|integer',
            'haz_type'              => 'nullable|string|max:20',
            'haz_class_id'          => 'nullable|integer',
            'uom_id'                => 'nullable|integer',
            'hsn_id'                => 'nullable|integer',
            'condition_id'          => 'nullable|integer',
            'packaging_material_id' => 'nullable|integer',
            'confidential_info'     => 'nullable|string|max:2000',
            // GST is mapped at creation time now: a new product is only committed
            // once its GST % is chosen (the "Map GST" popup that opens on Save &
            // Next). Persisted here so the product is never listed without a GST.
            // Still nullable so an edit-mode core re-save (which omits it) leaves
            // the existing gst_id untouched. The Sales step recomputes gst_amount.
            'gst_id'                => 'nullable|integer',

            // Image inputs — see the doc block above for the upload contract:
            //   primary_image          existing path the client wants to keep
            //   primary_image_file     new file replacing the primary
            //   secondary_images[]     existing paths to keep
            //   secondary_image_files[] new files to append
            'primary_image'         => 'nullable|string|max:500',
            // Product primary & secondary images are PNG / JPG only — PDFs and
            // every other format are rejected. Use a supporting attachment
            // (product_attachment_file below) for spec sheets / PDFs instead.
            'primary_image_file'    => 'nullable|file|mimes:jpg,jpeg,png|max:2048',
            'secondary_images'      => 'nullable|array',
            'secondary_images.*'    => 'nullable|string|max:500',
            'secondary_image_files'   => 'nullable|array|max:10',
            'secondary_image_files.*' => 'file|mimes:jpg,jpeg,png|max:2048',
            // Product-level supporting attachment — a single document that may be
            // ANY type (PDF / Word / Excel / PPT / image / text). Same two-input
            // contract as the primary image:
            //   product_attachment       existing path the client wants to keep
            //   product_attachment_file  new file replacing it
            'product_attachment'      => 'nullable|string|max:500',
            // Supported formats only — PDF, Word, images. Excel/PPT/CSV/TXT are
            // intentionally rejected (a spreadsheet isn't a valid product doc).
            'product_attachment_file' => 'nullable|file|mimes:pdf,doc,docx,jpg,jpeg,png,gif,webp|max:10240',
        ]);

        $product = isset($data['id'])
            ? $this->applyScope(Product::query(), $request)->findOrFail($data['id'])
            : new Product();
        if ($product->exists) {
            $denial = $this->editDenial($request->user(), $product, 'edit');
            if ($denial) return response()->json(['message' => $denial], 403);
        }
        $ownership = $this->ownershipFor($request);

        if (!$product->exists) {
            $product->fill($ownership);
            $product->product_code = $this->nextProductCode($ownership['client_id'], $ownership['branch_id']);
            $product->status = 'draft';
        }

        // Apply scalar fields first (everything except the image inputs which
        // need extra handling).
        $product->fill(
            collect($data)
                ->except(['id', 'primary_image', 'primary_image_file', 'secondary_images', 'secondary_image_files', 'product_attachment', 'product_attachment_file'])
                ->toArray()
        );

        /* ── Primary image ─────────────────────────────────────────────
         * Three possible cases:
         *   1. A new file is uploaded → save it, delete the previous one.
         *   2. No new file, but `primary_image` is sent as a string → keep
         *      what we already had (or update to a new path if it differs).
         *      Empty string explicitly clears the image.
         *   3. Nothing about primary_image in the payload → leave column
         *      untouched (lets clients PATCH only the fields they care
         *      about).
         * ──────────────────────────────────────────────────────────── */
        if ($request->hasFile('primary_image_file')) {
            if ($product->primary_image && !str_starts_with((string) $product->primary_image, 'blob:')) {
                Storage::disk('public')->delete($this->relativePath($product->primary_image));
            }
            $product->primary_image = $this->storeFileWithName($request->file('primary_image_file'), 'products/images');
        } elseif ($request->has('primary_image')) {
            $newPath = $data['primary_image'] ?: null;
            // Reject any `blob:` value an older client might still be sending —
            // these are browser-only URLs that can't be resolved on the server.
            if ($newPath !== null && str_starts_with($newPath, 'blob:')) {
                $newPath = null;
            }
            if (
                $product->primary_image && $product->primary_image !== $newPath
                && !str_starts_with((string) $product->primary_image, 'blob:')
            ) {
                Storage::disk('public')->delete($this->relativePath($product->primary_image));
            }
            $product->primary_image = $newPath;
        }

        /* ── Secondary images ──────────────────────────────────────────
         * The client tells us which existing paths to KEEP via
         * `secondary_images[]`. Anything previously on the row that's
         * missing from that list gets deleted from disk. Then any newly
         * uploaded files in `secondary_image_files[]` are stored and
         * appended.
         *
         * If the client sends neither key, the column is left alone.
         * ──────────────────────────────────────────────────────────── */
        $hasKeptList   = $request->has('secondary_images');
        $hasNewFiles   = $request->hasFile('secondary_image_files');
        // The client sets this whenever it is submitting the full secondary set
        // (add or edit). It lets us tell "user removed the last image" (empty
        // array → FormData omits the key) apart from "payload didn't mention
        // secondary images at all", so a cleared gallery actually persists.
        $forceReplace  = $request->boolean('secondary_images_replace');
        if ($hasKeptList || $hasNewFiles || $forceReplace) {
            $kept = ($hasKeptList || $forceReplace)
                ? (array) ($data['secondary_images'] ?? [])
                : (array) ($product->secondary_images ?? []);
            // Drop blanks and any `blob:` URLs that older clients might still
            // send — those don't resolve on the server.
            $kept = array_values(array_filter(
                $kept,
                fn($v) => is_string($v) && $v !== '' && !str_starts_with($v, 'blob:')
            ));

            // Drop files the user removed (skip blob: entries, nothing to
            // unlink from disk since they were never real files).
            $previous = is_array($product->secondary_images) ? $product->secondary_images : [];
            foreach ($previous as $old) {
                if (!is_string($old) || $old === '' || str_starts_with($old, 'blob:')) continue;
                if (!in_array($old, $kept, true)) {
                    Storage::disk('public')->delete($this->relativePath($old));
                }
            }

            // Save newly uploaded files
            $appended = [];
            foreach ((array) $request->file('secondary_image_files', []) as $file) {
                if ($file) {
                    $appended[] = $this->storeFileWithName($file, 'products/images');
                }
            }

            $product->secondary_images = array_values(array_merge($kept, $appended));
        }

        /* ── Product attachment ────────────────────────────────────────
         * Same three cases as the primary image (see above):
         *   1. New file uploaded → store it (any doc type), delete the old.
         *   2. No new file but `product_attachment` sent as a string → keep
         *      it (or update to a differing path). Empty string clears it.
         *   3. Key absent entirely → leave the column untouched.
         * ──────────────────────────────────────────────────────────── */
        if ($request->hasFile('product_attachment_file')) {
            if ($product->product_attachment && !str_starts_with((string) $product->product_attachment, 'blob:')) {
                Storage::disk('public')->delete($this->relativePath($product->product_attachment));
            }
            $product->product_attachment = $this->storeFileWithName($request->file('product_attachment_file'), 'products/attachments');
        } elseif ($request->has('product_attachment')) {
            $newPath = $data['product_attachment'] ?: null;
            if ($newPath !== null && str_starts_with($newPath, 'blob:')) {
                $newPath = null;
            }
            if (
                $product->product_attachment && $product->product_attachment !== $newPath
                && !str_starts_with((string) $product->product_attachment, 'blob:')
            ) {
                Storage::disk('public')->delete($this->relativePath($product->product_attachment));
            }
            $product->product_attachment = $newPath;
        }

        // Mark step 1 (Core) complete only if it wasn't beyond already.
        $product->step_completed = max((int)($product->step_completed ?? 0), 1);

        $product->save();

        return response()->json(
            $this->maskProductArray($product->fresh()->toArray(), $this->departmentHiddenGroups($request))
        );
    }

    /**
     * Normalise a stored value (legacy `/storage/...` URL or already-relative
     * disk path) into the relative path that `Storage::disk('public')` works
     * with. Lifted from the ClientController helper of the same name.
     */
    private function relativePath(string $stored): string
    {
        if (preg_match('#^https?://#i', $stored)) {
            $path = parse_url($stored, PHP_URL_PATH) ?: '';
            $stored = ltrim($path, '/');
        }
        $stored = ltrim($stored, '/');
        if (str_starts_with($stored, 'storage/')) {
            $stored = substr($stored, strlen('storage/'));
        }
        return $stored;
    }

    /**
     * Store an uploaded file with a collision-safe prefix that still
     * encodes the original filename, so the SPA can show "PAN Card.pdf"
     * instead of a hex string after edit-load. Format:
     *   {dir}/{rand}__{sanitized-original}.{ext}
     * The frontend strips everything up to and including the "__" when
     * surfacing the display name. Mirrors VendorController::absorbFile.
     */
    private function storeFileWithName($file, string $dir): string
    {
        $ext = $file->getClientOriginalExtension() ?: 'bin';
        $original = pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME);
        $safe = preg_replace('/[^A-Za-z0-9 ._-]/', '_', (string) $original);
        $safe = trim((string) $safe);
        if ($safe === '') {
            $safe = 'file';
        }
        $name = bin2hex(random_bytes(4)) . '__' . $safe . '.' . $ext;
        return $file->storeAs($dir, $name, 'public');
    }

    /* ──────────────────────────────────────────────────────────────────
     * PUT /products/{id}/step/sales
     * ────────────────────────────────────────────────────────────── */
    public function storeSales(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        if ($denial = $this->editDenial($request->user(), $product, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
            'base_price'  => 'nullable|numeric|min:0',
            'gst_id'      => 'nullable|integer',
            'gst_amount'  => 'nullable|numeric|min:0',
            'total_price' => 'nullable|numeric|min:0',
            'mark_bottom' => 'nullable|string|max:30',
        ]);

        $product->fill($data);
        // The product form was simplified to two stages (Core → Sales); the
        // Quality step that used to flip 'draft' → 'inactive' is gone, so Sales
        // is now the final data step. Promote a fresh draft to 'inactive' here
        // so a completed product surfaces as a ready (zero-supplier) row.
        // Mapping a supplier later promotes it to 'active' (see storeVendors).
        $product->step_completed = max((int)$product->step_completed, 2);
        if ($product->status === 'draft') {
            $product->status = 'inactive';
        }
        $product->save();

        // A supplier's GST is locked to the product's GST, so a change here must
        // cascade to every already-mapped supplier — otherwise they keep the
        // stale rate captured at map time (bug: supplier GST didn't update after
        // the product GST changed). Recompute each map's %/amount/total from its
        // own purchase price and mirror onto the vendor side.
        $gstPct = (float) (optional(GstPercentage::find($product->gst_id))->percentage ?? 0);
        DB::transaction(function () use ($product, $gstPct) {
            foreach ($product->vendorMaps()->get() as $map) {
                $price  = (float) ($map->purchase_price ?? 0);
                $gstAmt = round($price * $gstPct / 100, 2);
                $total  = round($price + $gstAmt, 2);
                $map->gst_percentage = $gstPct;
                $map->gst_amount     = $gstAmt;
                $map->total_amount   = $total;
                $map->save();

                if ($map->vendor_id) {
                    \App\Models\VendorProductMapping::where('vendor_id', $map->vendor_id)
                        ->where('product_id', $map->product_id)
                        ->update([
                            'gst_percentage' => $gstPct,
                            'gst_amount'     => $gstAmt,
                            'total_amount'   => $total,
                        ]);
                }
            }
        });

        return response()->json(
            $this->maskProductArray(
                $product->fresh(['vendorMaps', 'vendorMaps.vendor:id,vendor_code'])->toArray(),
                $this->departmentHiddenGroups($request)
            )
        );
    }

    /* ──────────────────────────────────────────────────────────────────
     * PUT /products/{id}/step/quality
     * Also replaces QC records (full sync).
     * ────────────────────────────────────────────────────────────── */
    public function storeQuality(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        if ($denial = $this->editDenial($request->user(), $product, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
            'net_weight'                  => 'nullable|numeric|min:0',
            'gross_weight'                => 'nullable|numeric|min:0',
            'length_cm'                   => 'nullable|numeric|min:0',
            'width_cm'                    => 'nullable|numeric|min:0',
            'height_cm'                   => 'nullable|numeric|min:0',
            // Inventory tracking — all optional. Captured on the Quality
            // tab and surfaced on the Product Detail view's Inventory block.
            'batch_no'                    => 'nullable|string|max:100',
            'serial_no'                   => 'nullable|string|max:100',
            'cat_no'                      => 'nullable|string|max:100',
            'lot_no'                      => 'nullable|string|max:100',
            'qc_records'                  => 'nullable|array',
            'qc_records.*.qc_name'        => 'required_with:qc_records|string|max:100',
            'qc_records.*.qc_purpose'     => 'nullable|string|max:255',
            'qc_records.*.issued_by'      => 'nullable|string|max:255',
            'qc_records.*.qa_testing_parameter' => 'nullable|string',
            'qc_records.*.min_acceptance_criteria' => 'nullable|string',
            'qc_records.*.attachment_path' => 'nullable|string|max:500',
            'qc_records.*.attachment_file' => 'nullable|file|mimes:jpg,jpeg,png,pdf|max:10240',
        ]);

        DB::transaction(function () use ($product, $data, $request) {
            $product->fill(collect($data)->except('qc_records')->toArray());

            // Step 1 fully complete when Quality is saved — flip status to inactive
            // so the row appears in the Inactive tab (still needs vendor mapping).
            $product->step_completed = max((int)$product->step_completed, 3);
            if ($product->status === 'draft') {
                $product->status = 'inactive';
            }
            $product->save();

            // Replace QC list — persist each row, swapping `attachment_file`
            // (a real uploaded file when the user picked one) for the
            // public-disk storage path so the frontend can render a working
            // link via resolveFileUrl(). Without this, `attachment_path` was
            // just the original filename, which 404'd and the SPA fallback
            // routed the user to the products overview instead of the file.
            $product->qcRecords()->delete();
            foreach ($data['qc_records'] ?? [] as $idx => $qc) {
                $row = collect($qc)->except(['attachment_file'])->toArray();

                /* Only trust an `attachment_path` value that actually
                 * looks like a path under our storage tree. If the
                 * client (legacy or otherwise) sent a bare basename
                 * like "Bhuvan.jpg", drop it before persisting —
                 * otherwise file_url() resolves to /storage/Bhuvan.jpg
                 * locally or .../cbc-saas/Bhuvan.jpg on Azure, both of
                 * which point at non-existent blobs. The path must
                 * either be empty/null or live under products/qc/. */
                $clientPath = $row['attachment_path'] ?? null;
                if ($clientPath !== null && $clientPath !== '' && !str_starts_with((string) $clientPath, 'products/qc/')) {
                    $row['attachment_path'] = null;
                }

                $uploaded = $request->file("qc_records.{$idx}.attachment_file");
                if ($uploaded) {
                    $row['attachment_path'] = $this->storeFileWithName($uploaded, 'products/qc');
                }
                $product->qcRecords()->create($row);
            }
        });

        return response()->json(
            $this->maskProductArray($product->fresh(['qcRecords'])->toArray(), $this->departmentHiddenGroups($request))
        );
    }

    /* ──────────────────────────────────────────────────────────────────
     * GET /products/{id}/vendor-maps
     * Vendor mappings for a product — powers the Sales Matrix Stage 3
     * "Vendor Count" popup. Returns the inline product_vendor_maps rows
     * (vendor identity + purchase / gst / total amounts); the UI flags the
     * lowest-total row as L1 (best price).
     * ────────────────────────────────────────────────────────────── */
    /* ──────────────────────────────────────────────────────────────────
     * GET /products/{id}/usage
     * Where this product is referenced outside its own record, so the edit
     * UI can decide whether a segment change is safe.
     *
     * Today that means the Sales Matrix product directory (lead_products).
     * The rule the UI applies: a lead that has already been tied to a
     * customer BLOCKS the change — quotations/PIs price off the segment, so
     * moving it under a live customer would rewrite what was quoted. A lead
     * with no customer yet is reported but does not block.
     *
     * It also reports purchase orders and supplier purchase invoices holding
     * the product. Those block outright: a PO/SPI is an issued document and
     * its lines were priced and compliance-checked under the segment the
     * product had at the time, so there is no in-app way to make a change
     * safe after the fact.
     *
     * Shaped as a general "usage" report rather than a yes/no so further
     * blockers can be added here without another round-trip.
     * ────────────────────────────────────────────────────────────── */
    public function usage(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);

        // client_id comes from the token, never the request — a product id
        // alone must not expose another tenant's leads.
        $clientId = $request->user()->client_id;

        $rows = LeadProduct::query()
            ->where('lead_products.product_id', $product->id)
            ->where('lead_products.client_id', $clientId)
            ->join('leads', 'leads.id', '=', 'lead_products.lead_id')
            ->whereNull('leads.deleted_at')
            ->leftJoin('customers', 'customers.id', '=', 'leads.customer_id')
            ->distinct()
            ->orderBy('leads.opp_code')
            ->get([
                'leads.id as lead_id',
                'leads.opp_code',
                'leads.sender_company',
                'leads.customer_id',
                'customers.company_name as customer_name',
            ]);

        $leads = $rows->map(fn($r) => [
            'lead_id'       => (int) $r->lead_id,
            'opp_code'      => $r->opp_code,
            'has_customer'  => $r->customer_id !== null,
            'customer_name' => $r->customer_name ?: $r->sender_company,
        ])->values();

        /* Newest first, by id rather than by code: the code is only
         * lexicographically sortable while the sequence stays 3 digits
         * (PO/2026-27/1000 sorts before .../999), whereas the id is always
         * creation order. The id has to be in the SELECT list for Postgres to
         * accept it in ORDER BY alongside DISTINCT — selecting the pair is
         * also what collapses a document that lists the product twice. */
        $poCodes = PurchaseOrderItem::query()
            ->where('purchase_order_items.product_id', $product->id)
            ->join('purchase_orders', 'purchase_orders.id', '=', 'purchase_order_items.purchase_order_id')
            ->where('purchase_orders.client_id', $clientId)
            ->whereNull('purchase_orders.deleted_at')
            ->distinct()
            ->orderByDesc('purchase_orders.id')
            ->get(['purchase_orders.id', 'purchase_orders.code'])
            ->pluck('code');

        $spiCodes = SupplierPurchaseInvoiceItem::query()
            ->where('supplier_purchase_invoice_items.product_id', $product->id)
            ->join('supplier_purchase_invoices', 'supplier_purchase_invoices.id', '=', 'supplier_purchase_invoice_items.supplier_purchase_invoice_id')
            ->where('supplier_purchase_invoices.client_id', $clientId)
            ->whereNull('supplier_purchase_invoices.deleted_at')
            ->distinct()
            ->orderByDesc('supplier_purchase_invoices.id')
            ->get(['supplier_purchase_invoices.id', 'supplier_purchase_invoices.code'])
            ->pluck('code');

        return response()->json([
            'status' => true,
            'data'   => [
                'leads'          => $leads,
                'lead_count'     => $leads->count(),
                'blocking_leads' => $leads->where('has_customer', true)->values(),
                'po_codes'         => $poCodes,
                'spi_codes'        => $spiCodes,
                // The one to name in the UI: most recent of each, null when
                // the product has never been on that document type.
                'latest_po_code'   => $poCodes->first(),
                'latest_spi_code'  => $spiCodes->first(),
                'in_po_or_spi'   => $poCodes->isNotEmpty() || $spiCodes->isNotEmpty(),
                'segment_locked' => $leads->contains('has_customer', true)
                    || $poCodes->isNotEmpty() || $spiCodes->isNotEmpty(),
            ],
        ]);
    }

    public function vendorMaps(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);

        // Department information wall — the Sales department must never see who
        // the supplier is or the purchase price, so return an empty vendor list.
        if ($this->departmentHiddenGroups($request)['vendor']) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }

        $maps = ProductVendorMap::where('product_id', $product->id)->orderBy('id')->get();
        return response()->json([
            'status' => true,
            'data'   => $maps,
            'count'  => $maps->count(),
        ]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * PATCH /products/{id}/vendor-maps/{mapId}
     * Inline-edit a single mapping's purchase price. GST amount and total
     * are recomputed server-side from the row's existing GST %, and the
     * change is mirrored onto vendor_product_mappings (the vendor side's
     * source of truth). Kept separate from storeVendors — which replaces
     * the whole list — so a price tweak can't wipe the other columns the
     * detail-page DTO doesn't carry (website, email, remarks, …).
     * ────────────────────────────────────────────────────────────── */
    public function updateVendorMapPrice(Request $request, int $id, int $mapId)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        if ($denial = $this->editDenial($request->user(), $product, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $map = ProductVendorMap::where('product_id', $product->id)->findOrFail($mapId);

        $data = $request->validate([
            'purchase_price' => 'required|numeric|min:0',
        ]);

        $price = round((float) $data['purchase_price'], 2);
        $gstPct = (float) ($map->gst_percentage ?? 0);
        $gstAmt = round($price * $gstPct / 100, 2);
        $total  = round($price + $gstAmt, 2);

        DB::transaction(function () use ($map, $price, $gstAmt, $total) {
            $map->purchase_price = $price;
            $map->gst_amount     = $gstAmt;
            $map->total_amount   = $total;
            $map->save();

            // Mirror onto the vendor side so both tables stay in sync.
            if ($map->vendor_id) {
                \App\Models\VendorProductMapping::where('vendor_id', $map->vendor_id)
                    ->where('product_id', $map->product_id)
                    ->update([
                        'purchase_price' => $price,
                        'gst_amount'     => $gstAmt,
                        'total_amount'   => $total,
                    ]);
            }
        });

        return response()->json(
            $this->maskProductArray(
                $product->fresh(['vendorMaps', 'vendorMaps.vendor:id,vendor_code', 'qcRecords'])->toArray(),
                $this->departmentHiddenGroups($request)
            )
        );
    }

    /* ──────────────────────────────────────────────────────────────────
     * DELETE /products/{id}/vendor-maps/{mapId}
     * Unmap a single supplier from the product. Kept separate from
     * storeVendors (full-list replace) so both the Product-Detail-View list
     * and the Edit-form list can delete one row and stay in sync — the
     * vendor side (vendor_product_mappings) is cleared to match.
     * ────────────────────────────────────────────────────────────── */
    public function destroyVendorMap(Request $request, int $id, int $mapId)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        if ($denial = $this->editDenial($request->user(), $product, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $map = ProductVendorMap::where('product_id', $product->id)->findOrFail($mapId);

        DB::transaction(function () use ($map) {
            // Mirror-delete the vendor side so a supplier removed here also
            // drops off the vendor's mapped-products list.
            if ($map->vendor_id) {
                \App\Models\VendorProductMapping::where('vendor_id', $map->vendor_id)
                    ->where('product_id', $map->product_id)
                    ->delete();
            }
            $map->delete();
        });

        return response()->json(
            $this->maskProductArray(
                $product->fresh(['vendorMaps', 'vendorMaps.vendor:id,vendor_code', 'qcRecords'])->toArray(),
                $this->departmentHiddenGroups($request)
            )
        );
    }

    /* ──────────────────────────────────────────────────────────────────
     * PUT /products/{id}/step/vendors
     * Final step. Saves vendor mappings; a non-empty list activates the
     * product. The list is a full replace and MAY be empty — unmapping the
     * last supplier is allowed and drops the product back to the same
     * "ready, zero-supplier" state the Sales step leaves behind.
     * ────────────────────────────────────────────────────────────── */
    public function storeVendors(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        if ($denial = $this->editDenial($request->user(), $product, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
            // `present`, not `required` — an empty array is the legitimate
            // payload for "the last supplier was removed". Under `required`
            // Laravel rejects [] as empty, which made that removal impossible
            // to persist from either supplier list.
            'vendors'                    => 'present|array',
            'vendors.*.vendor_id'        => 'nullable|integer|exists:vendors,id',
            'vendors.*.vendor_code'      => 'nullable|string|max:50',
            'vendors.*.vendor_name'      => 'required|string|max:255',
            'vendors.*.vendor_website'   => 'nullable|string|max:255',
            'vendors.*.contact_person'   => 'nullable|string|max:255',
            'vendors.*.contact_no'       => 'nullable|string|max:50',
            'vendors.*.email'            => 'nullable|email|max:255',
            'vendors.*.designation'      => 'nullable|string|max:100',
            'vendors.*.attachment_path'  => 'nullable|string|max:500',
            'vendors.*.purchase_price'   => 'nullable|numeric|min:0',
            'vendors.*.gst_percentage'   => 'nullable|numeric|min:0',
            'vendors.*.gst_amount'       => 'nullable|numeric|min:0',
            'vendors.*.total_amount'     => 'nullable|numeric|min:0',
            'vendors.*.map_date'         => 'nullable|date',
            'vendors.*.remarks'          => 'nullable|string',
        ]);

        // Segment gate — a supplier can only be mapped to a product in the SAME
        // segment. The product's segment must be one the supplier deals in
        // (vendor_segments pivot + the scalar segment_id). Enforced here so a
        // direct API call can't bypass the frontend validation. Skipped when the
        // product has no segment (nothing to match against).
        if ($product->segment_id) {
            $prodSeg   = (int) $product->segment_id;
            $vendorIds = array_values(array_filter(array_map(fn($v) => $v['vendor_id'] ?? null, $data['vendors'])));
            if ($vendorIds) {
                $mismatches = [];
                foreach (Vendor::with('segments:id')->whereIn('id', $vendorIds)->get(['id', 'company_name', 'segment_id']) as $ven) {
                    $segs = array_values(array_unique(array_filter(array_merge(
                        [$ven->segment_id ? (int) $ven->segment_id : null],
                        $ven->segments->pluck('id')->map(fn($x) => (int) $x)->all(),
                    ))));
                    if (!in_array($prodSeg, $segs, true)) {
                        $mismatches[] = $ven->company_name ?: ('Vendor #' . $ven->id);
                    }
                }
                if (!empty($mismatches)) {
                    $segName = optional(Segments::find($prodSeg))->name;
                    return response()->json([
                        'status'  => false,
                        'message' => 'Segment mismatch: ' . implode(', ', $mismatches)
                            . ' ' . (count($mismatches) > 1 ? 'do' : 'does') . ' not deal in the product\'s segment'
                            . ($segName ? ' "' . $segName . '"' : '') . '. Only a supplier in the same segment can be mapped.',
                    ], 422);
                }
            }
        }

        // Supplier GST is locked to the PRODUCT's GST — derive it server-side so
        // a stale/hand-crafted payload can't persist a mismatched rate (the
        // frontend already mirrors this, but the DB is the source of truth).
        $gstPct = (float) (optional(GstPercentage::find($product->gst_id))->percentage ?? 0);

        DB::transaction(function () use ($product, $data, $request, $gstPct) {
            $userId = $request->user()?->id;

            // Replace the product's vendor list.
            $product->vendorMaps()->delete();

            // Track which vendors this product is now mapped to so we
            // can mirror the link onto vendor_product_mappings (the
            // vendor side's source of truth). Any vendor that the
            // product used to be linked to but is no longer listed
            // gets its corresponding row dropped, keeping the two
            // tables in sync.
            $nowMappedVendorIds = [];

            foreach ($data['vendors'] as $v) {
                // Force the GST to the product's current rate + recompute the
                // amount/total from this row's own purchase price.
                $price = (float) ($v['purchase_price'] ?? 0);
                $v['gst_percentage'] = $gstPct;
                $v['gst_amount']     = round($price * $gstPct / 100, 2);
                $v['total_amount']   = round($price + $v['gst_amount'], 2);

                $product->vendorMaps()->create($v);

                $vendorId = $v['vendor_id'] ?? null;
                if (!$vendorId) continue;
                $nowMappedVendorIds[] = (int) $vendorId;

                // Mirror onto the vendor side. updateOrCreate so a
                // second save doesn't duplicate the row when the same
                // (vendor, product) pair is re-saved on this product.
                \App\Models\VendorProductMapping::updateOrCreate(
                    ['vendor_id' => $vendorId, 'product_id' => $product->id],
                    [
                        'purchase_price' => $v['purchase_price'] ?? 0,
                        'gst_percentage' => $v['gst_percentage'] ?? 0,
                        'gst_amount'     => $v['gst_amount']     ?? 0,
                        'total_amount'   => $v['total_amount']   ?? ($v['purchase_price'] ?? 0),
                        'created_by'     => $userId,
                    ]
                );

                // Auto-activate the vendor as soon as it has at least
                // one product linked to it — same end-state the
                // vendor wizard reaches after Step 4. Use existing
                // step_completed if the vendor was further along.
                $vendor = \App\Models\Vendor::find($vendorId);
                if ($vendor) {
                    $vendor->step_completed = max((int) $vendor->step_completed, 4);
                    if ($vendor->status !== 'active') {
                        $vendor->status = 'active';
                    }
                    $vendor->save();
                }
            }

            // Drop stale mirror rows on the vendor side — any vendor
            // that USED to be mapped to this product but isn't in the
            // current submit.
            \App\Models\VendorProductMapping::where('product_id', $product->id)
                ->when(!empty($nowMappedVendorIds), fn($q) => $q->whereNotIn('vendor_id', $nowMappedVendorIds))
                ->delete();

            if (empty($data['vendors'])) {
                $product->status = 'inactive';
            } else {
                $product->step_completed = 4;
                $product->status = 'active';
            }
            $product->save();
        });

        return response()->json(
            $this->maskProductArray($product->fresh(['vendorMaps', 'qcRecords'])->toArray(), $this->departmentHiddenGroups($request))
        );
    }

    /* ──────────────────────────────────────────────────────────────────
     * DELETE /products/{id}
     * ────────────────────────────────────────────────────────────── */
    public function destroy(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        if ($denial = $this->editDenial($request->user(), $product, 'delete')) {
            return response()->json(['message' => $denial], 403);
        }
        $product->delete();
        return response()->json(['deleted' => true]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * GET /products/stats
     * Counts for header chips on the Products page.
     * ────────────────────────────────────────────────────────────── */
    public function stats(Request $request)
    {
        /* Counts for the two header tabs. They describe the WHOLE filtered
         * catalogue, not the page on screen, so they cannot be derived from
         * the paginated rows — hence a second, cheap COUNT-only query.
         *
         * The split is by SUPPLIER MAPPING, matching the tab labels
         * ("Supplier Mapped Products" / "Zero Supplier Products") and what
         * Products.tsx used to compute client-side from the full fetch. It is
         * deliberately NOT the status column: an `active` product with no
         * supplier belongs under "Zero Supplier Products".
         *
         * Every filter except the tab itself is applied, so ticking a sidebar
         * filter moves BOTH badges rather than only the visible list. */
        $query = $this->applyScope(Product::query(), $request, true);
        $query = $this->applyListFilters($query, $request);

        $mapped = (clone $query)->has('vendorMaps')->count();
        $zero   = (clone $query)->doesntHave('vendorMaps')->count();

        return response()->json([
            'active'   => $mapped,   // "Supplier Mapped Products" tab
            'inactive' => $zero,     // "Zero Supplier Products" tab
            'total'    => $mapped + $zero,
        ]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * GET /products/owners
     *
     * Returns the list of users eligible to own a product, scoped to
     * what the caller is allowed to see:
     *   - branch_user/employee: only branch_user + employee rows in their
     *     own branch (every branch is an isolated peer).
     *   - Anyone else (client_admin, client_user, super_admin): an
     *     empty list — they don't use this filter UI.
     *
     * The frontend's Product Owner filter consumes this directly; rows
     * are typed as {id, name, branch_id, branch_name} so the dropdown can
     * group / label by branch.
     * ────────────────────────────────────────────────────────────── */
    public function owners(Request $request)
    {
        $user = $request->user();
        if (!$user || !in_array($user->user_type, ['branch_user', 'employee'], true)) {
            return response()->json(['data' => []]);
        }

        // No branch context → nothing to scope by, so return empty.
        $myBranch = $user->branch_id ? Branch::find($user->branch_id) : null;
        if (!$myBranch) {
            return response()->json(['data' => []]);
        }

        // Lock the dropdown to only the caller's own branch users.
        $q = User::query()
            ->where('client_id', $user->client_id)
            ->whereIn('user_type', ['branch_user', 'employee'])
            ->where('branch_id', $user->branch_id)
            ->with('branch:id,name')
            ->orderBy('name');

        $rows = $q->get(['id', 'name', 'branch_id'])->map(fn($u) => [
            'id'              => $u->id,
            'name'            => $u->name,
            'branch_id'       => $u->branch_id,
            'branch_name'     => $u->branch->name ?? null,
        ])->values();

        return response()->json(['data' => $rows]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * GET /products/master-bundle
     *
     * Bundle every master dropdown the Add Product / Edit Product modal
     * needs into ONE response. Replaces 8 separate round-trips:
     *   /master/segments, /master/haz_class, /master/uom, /master/hsn_codes,
     *   /master/conditions, /master/packaging_material, /master/gst_percentage,
     *   /vendors?per_page=500
     *
     * Each list is projected to the minimum columns the form actually reads,
     * and filtered to status = 'active' server-side (the modal was previously
     * filtering client-side after downloading inactive rows it never showed).
     *
     * Tenant scope is applied to vendors via Vendor::forUser($user) so the
     * dropdown matches the user's existing /vendors index visibility.
     * ────────────────────────────────────────────────────────────── */
    public function masterBundle(Request $request)
    {
        $user = $request->user();

        // Server-side cache (5-min TTL, per-user key).
        //
        // Per-user keying — vendors are tenant-scoped via Vendor::forUser($user)
        // so we MUST NOT share a single cache entry across users (different
        // clients/branches see different vendor lists). The masters themselves
        // are global, but the cost of keeping them inside the per-user entry
        // is tiny (~3KB) and avoids juggling two cache layers.
        //
        // Invalidation — the frontend busts the matching sessionStorage key
        // on inline master add (see productBundleCache.ts), and reopening
        // the modal after the 5-min TTL also picks up changes made elsewhere.
        // No cross-controller invalidation needed for the Product module to
        // stay self-contained.
        $cacheKey = MasterBundleCache::key('product:master-bundle', $user?->id);

        $bundle = Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user) {
            // Helper — pulls active rows with a fixed column projection.
            // The status column is enum('Active','Inactive') on the master_*
            // tables but lowercase 'active'/'inactive' on clm_segments, so
            // we compare case-insensitively to handle both shapes without
            // touching the DB.
            //
            // Tenant scope — every master here has a `client_id` column, so
            // we apply MasterVisibility::applyReadScope to match the gate
            // /master/{slug} uses (MasterController::list). Without this a
            // client_admin of Client A would see Client B's tenant-scoped
            // master rows (segments, hsn_codes, etc.). Per-user cache key
            // is a second line of defence.
            $active = function (string $modelClass, array $cols) use ($user) {
                return $modelClass::query()
                    ->whereRaw('LOWER(status) = ?', ['active'])
                    ->tap(fn($q) => MasterVisibility::applyReadScope($q, $user))
                    ->orderBy('id')
                    ->get($cols);
            };

            $vendors = Vendor::query()
                ->forUser($user)
                ->with([
                    'primaryAddress:id,vendor_id,state_id,state_code,contact_name,contact_no,email,designation',
                    'primaryAddress.state:id,name',
                    'vendorType:id,name',
                    // Segments the supplier deals in — used to gate product↔supplier
                    // mapping (a supplier can only be mapped to a product in the
                    // same segment).
                    'segments:id',
                ])
                ->orderByDesc('id')
                ->get(['id', 'vendor_code', 'company_name', 'website', 'primary_email', 'status', 'vendor_type_id', 'segment_id'])
                ->map(fn($v) => [
                    'id'             => $v->id,
                    'vendor_code'    => $v->vendor_code,
                    'company_name'   => $v->company_name,
                    'website'        => $v->website,
                    'primary_email'  => $v->primary_email,
                    'status'         => $v->status,
                    'vendor_type_name' => optional($v->vendorType)->name,
                    // Every segment this supplier is tagged with (pivot rows + the
                    // scalar first-segment), so the frontend can enforce the match.
                    'segment_ids'    => array_values(array_unique(array_filter(array_merge(
                        [$v->segment_id ? (int) $v->segment_id : null],
                        $v->segments->pluck('id')->map(fn($x) => (int) $x)->all(),
                    )))),
                    // Supplier's state — name (from the state relation) with the
                    // 2-letter state_code as a fallback when the relation is empty.
                    'state'          => optional(optional($v->primaryAddress)->state)->name
                        ?? (optional($v->primaryAddress)->state_code ?: null),
                    'primary_address' => $v->primaryAddress ? [
                        'contact_name' => $v->primaryAddress->contact_name,
                        'contact_no'   => $v->primaryAddress->contact_no,
                        'email'        => $v->primaryAddress->email,
                        'designation'  => $v->primaryAddress->designation,
                    ] : null,
                ])
                ->values();

            // Column projections match the REAL DB schema:
            //   • Segments uses `name` (clm_segments). The model exposes a
            //     `title` accessor (appends => ['title']) that reads from
            //     `name`, so the JSON response still surfaces `title` for
            //     the frontend — we just need to SELECT the real `name`.
            //   • Every other master uses its own native columns directly.
            return [
                'segments'           => $active(Segments::class,          ['id', 'name']),
                'haz_class'          => $active(HazClass::class,          ['id', 'name']),
                'uom'                => $active(Uom::class,               ['id', 'title', 'short_code', 'unit_type']),
                'hsn_codes'          => $active(HsnCodes::class,          ['id', 'hsn_code', 'description']),
                'conditions'         => $active(Conditions::class,        ['id', 'title']),
                'packaging_material' => $active(PackagingMaterial::class, ['id', 'title']),
                'gst_percentage'     => $active(GstPercentage::class,     ['id', 'percentage']),
                'vendors'            => $vendors,
            ];
        });

        return response()->json($bundle);
    }
}
