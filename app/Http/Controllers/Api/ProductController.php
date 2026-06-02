<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
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
     * Products use the shared creator-hierarchy read rule — sub-branch
     * users see globals + client-level + main-branch + own sub-branch
     * rows; sibling sub-branches are blocked. See MasterVisibility.
     * ────────────────────────────────────────────────────────────── */
    private function applyScope($query, Request $request)
    {
        MasterVisibility::applyReadScope($query, $request->user());
        return $query;
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

    private function nextProductCode(?int $clientId): string
    {
        // Scan every code this client owns and pick the true numeric
        // max. Previously this used orderByDesc('id')->value which
        // returns the MOST-RECENTLY-INSERTED code, not the highest one
        // — a draft created at P-01 after P-02 already existed would
        // make this hand out P-02 again and trip the unique index.
        // We also pull from withTrashed so soft-deleted rows don't
        // release their code back into the pool, matching how vendors
        // and customers handle theirs.
        $codes = Product::withTrashed()
            ->where('client_id', $clientId)
            ->pluck('product_code');

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
        $query = Product::query()
            ->with([
                'segment', 'hazClass', 'uom', 'hsn', 'condition',
                'packagingMaterial', 'gstPercentage',
                'vendorMaps:id,product_id,vendor_name',
                'qcRecords:id,product_id',
                // creator + their branch so the product-owner filter can
                // show "Person Name · Branch Name" and resolve filtering
                // on the frontend without a second lookup.
                'creator:id,name,user_type,branch_id',
                'creator.branch:id,name,is_main',
            ]);

        $query = $this->applyScope($query, $request);

        if ($status = $request->query('status')) {
            // Frontend sends 'active' / 'inactive'. Inactive = inactive + draft
            // both (anything not yet activated).
            if ($status === 'inactive') {
                $query->whereIn('status', ['inactive', 'draft']);
            } else {
                $query->where('status', $status);
            }
        }

        if ($q = $request->query('q')) {
            $like = '%' . str_replace('%', '\%', $q) . '%';
            $query->where(function ($w) use ($like) {
                $w->where('name', 'like', $like)
                  ->orWhere('product_code', 'like', $like)
                  ->orWhere('brand', 'like', $like)
                  ->orWhere('generic_name', 'like', $like);
            });
        }

        // Optional vendor filter — narrows the result to products
        // mapped to one specific vendor. Used by the Vendors page
        // "Map Products" deep-link, which navigates to
        // /products?vendor_id=<id> so the user sees only that
        // vendor's existing mappings (or an empty state offering to
        // add the first one).
        if ($vendorId = $request->query('vendor_id')) {
            $query->whereHas('vendorMaps', function ($w) use ($vendorId) {
                $w->where('vendor_id', $vendorId);
            });
        }

        $products = $query->orderByDesc('id')
            ->paginate((int) $request->query('per_page', 24));

        return response()->json($products);
    }

    /* ──────────────────────────────────────────────────────────────────
     * GET /products/{id}
     * ────────────────────────────────────────────────────────────── */
    public function show(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)
            ->with([
                'segment', 'hazClass', 'uom', 'hsn', 'condition',
                'packagingMaterial', 'gstPercentage',
                'qcRecords', 'vendorMaps',
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

        $payload = $product->toArray();
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
            'name'                  => 'required|string|max:255',
            'generic_name'          => 'nullable|string|max:255',
            'description'           => 'nullable|string',
            'brand'                 => 'nullable|string|max:255',
            'segment_id'            => 'nullable|integer',
            'haz_type'              => 'nullable|string|max:20',
            'haz_class_id'          => 'nullable|integer',
            'uom_id'                => 'nullable|integer',
            'hsn_id'                => 'nullable|integer',
            'condition_id'          => 'nullable|integer',
            'packaging_material_id' => 'nullable|integer',
            'confidential_info'     => 'nullable|string',

            // Image inputs — see the doc block above for the upload contract:
            //   primary_image          existing path the client wants to keep
            //   primary_image_file     new file replacing the primary
            //   secondary_images[]     existing paths to keep
            //   secondary_image_files[] new files to append
            'primary_image'         => 'nullable|string|max:500',
            // Product image attachments are limited to PNG / JPG / PDF
            // only. Dropped `webp` and `image:` flag (the flag rejects
            // PDFs since they're not images) so a PDF spec sheet can be
            // attached as a product reference.
            'primary_image_file'    => 'nullable|file|mimes:jpg,jpeg,png,pdf|max:2048',
            'secondary_images'      => 'nullable|array',
            'secondary_images.*'    => 'nullable|string|max:500',
            'secondary_image_files'   => 'nullable|array|max:10',
            'secondary_image_files.*' => 'file|mimes:jpg,jpeg,png,pdf|max:2048',
        ]);

        $product = isset($data['id'])
            ? $this->applyScope(Product::query(), $request)->findOrFail($data['id'])
            : new Product();
        if ($product->exists) {
            $denial = MasterVisibility::hierarchicalDenial($request->user(), $product, 'edit');
            if ($denial) return response()->json(['message' => $denial], 403);
        }
        $ownership = $this->ownershipFor($request);

        if (!$product->exists) {
            $product->fill($ownership);
            $product->product_code = $this->nextProductCode($ownership['client_id']);
            $product->status = 'draft';
        }

        // Apply scalar fields first (everything except the image inputs which
        // need extra handling).
        $product->fill(
            collect($data)
                ->except(['id', 'primary_image', 'primary_image_file', 'secondary_images', 'secondary_image_files'])
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
            if ($product->primary_image && $product->primary_image !== $newPath
                && !str_starts_with((string) $product->primary_image, 'blob:')) {
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
        if ($hasKeptList || $hasNewFiles) {
            $kept = $hasKeptList ? (array) ($data['secondary_images'] ?? []) : (array) ($product->secondary_images ?? []);
            // Drop blanks and any `blob:` URLs that older clients might still
            // send — those don't resolve on the server.
            $kept = array_values(array_filter(
                $kept,
                fn ($v) => is_string($v) && $v !== '' && !str_starts_with($v, 'blob:')
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

        // Mark step 1 (Core) complete only if it wasn't beyond already.
        $product->step_completed = max((int)($product->step_completed ?? 0), 1);

        $product->save();

        return response()->json($product->fresh());
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
        if ($denial = MasterVisibility::hierarchicalDenial($request->user(), $product, 'edit')) {
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
        $product->step_completed = max((int)$product->step_completed, 2);
        $product->save();

        return response()->json($product->fresh());
    }

    /* ──────────────────────────────────────────────────────────────────
     * PUT /products/{id}/step/quality
     * Also replaces QC records (full sync).
     * ────────────────────────────────────────────────────────────── */
    public function storeQuality(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($request->user(), $product, 'edit')) {
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

        return response()->json($product->fresh(['qcRecords']));
    }

    /* ──────────────────────────────────────────────────────────────────
     * GET /products/{id}/vendor-maps
     * Vendor mappings for a product — powers the Sales Matrix Stage 3
     * "Vendor Count" popup. Returns the inline product_vendor_maps rows
     * (vendor identity + purchase / gst / total amounts); the UI flags the
     * lowest-total row as L1 (best price).
     * ────────────────────────────────────────────────────────────── */
    public function vendorMaps(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        $maps = ProductVendorMap::where('product_id', $product->id)->orderBy('id')->get();
        return response()->json([
            'status' => true,
            'data'   => $maps,
            'count'  => $maps->count(),
        ]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * PUT /products/{id}/step/vendors
     * Final step. Saves vendor mappings and activates the product.
     * ────────────────────────────────────────────────────────────── */
    public function storeVendors(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($request->user(), $product, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
            'vendors'                    => 'required|array|min:1',
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

        DB::transaction(function () use ($product, $data, $request) {
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
                ->when(!empty($nowMappedVendorIds), fn ($q) => $q->whereNotIn('vendor_id', $nowMappedVendorIds))
                ->delete();

            $product->step_completed = 4;
            $product->status = 'active';
            $product->save();
        });

        return response()->json($product->fresh(['vendorMaps', 'qcRecords']));
    }

    /* ──────────────────────────────────────────────────────────────────
     * DELETE /products/{id}
     * ────────────────────────────────────────────────────────────── */
    public function destroy(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        if ($denial = MasterVisibility::hierarchicalDenial($request->user(), $product, 'delete')) {
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
        $query = $this->applyScope(Product::query(), $request);

        // Mirror the index endpoint's vendor filter so the
        // Active / Inactive tab counts stay in sync with the rows
        // the user is actually seeing. Without this, the deep-link
        // (/products?vendor_id=…) showed e.g. "Active 24 / Inactive 9"
        // — the org-wide numbers — even though only 2 products were
        // listed below them.
        if ($vendorId = $request->query('vendor_id')) {
            $query->whereHas('vendorMaps', function ($w) use ($vendorId) {
                $w->where('vendor_id', $vendorId);
            });
        }

        $active   = (clone $query)->where('status', 'active')->count();
        $inactive = (clone $query)->whereIn('status', ['inactive', 'draft'])->count();

        return response()->json([
            'active'   => $active,
            'inactive' => $inactive,
            'total'    => $active + $inactive,
        ]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * GET /products/owners
     *
     * Returns the list of users eligible to own a product, scoped to
     * what the caller is allowed to see:
     *   - Main-branch user (branch_user/employee on a branch with
     *     is_main = true): every branch_user + employee across every
     *     branch of their client.
     *   - Sub-branch user (branch_user/employee on a non-main branch):
     *     only branch_user + employee rows in their own branch.
     *   - Anyone else (client_admin, client_user, super_admin): an
     *     empty list — they don't use this filter UI.
     *
     * The frontend's Product Owner filter consumes this directly; rows
     * are typed as {id, name, branch_id, branch_name, is_main_branch}
     * so the dropdown can group / label by branch.
     * ────────────────────────────────────────────────────────────── */
    public function owners(Request $request)
    {
        $user = $request->user();
        if (!$user || !in_array($user->user_type, ['branch_user', 'employee'], true)) {
            return response()->json(['data' => []]);
        }

        // Confirm the caller's branch + whether it's the main branch.
        // No branch context → nothing to scope by, so return empty.
        $myBranch = $user->branch_id ? Branch::find($user->branch_id) : null;
        if (!$myBranch) {
            return response()->json(['data' => []]);
        }

        $q = User::query()
            ->where('client_id', $user->client_id)
            ->whereIn('user_type', ['branch_user', 'employee'])
            ->with('branch:id,name,is_main')
            ->orderBy('name');

        // Sub-branch user: lock the dropdown to only their own branch's
        // users. Main-branch user falls through and sees every branch.
        if (!$myBranch->is_main) {
            $q->where('branch_id', $user->branch_id);
        }

        $rows = $q->get(['id', 'name', 'branch_id'])->map(fn ($u) => [
            'id'              => $u->id,
            'name'            => $u->name,
            'branch_id'       => $u->branch_id,
            'branch_name'     => $u->branch->name ?? null,
            'is_main_branch'  => (bool) ($u->branch->is_main ?? false),
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
                    ->tap(fn ($q) => MasterVisibility::applyReadScope($q, $user))
                    ->orderBy('id')
                    ->get($cols);
            };

            $vendors = Vendor::query()
                ->forUser($user)
                ->with('primaryAddress:id,vendor_id,contact_name,contact_no,email,designation')
                ->orderByDesc('id')
                ->get(['id', 'vendor_code', 'company_name', 'website', 'primary_email', 'status'])
                ->map(fn ($v) => [
                    'id'             => $v->id,
                    'vendor_code'    => $v->vendor_code,
                    'company_name'   => $v->company_name,
                    'website'        => $v->website,
                    'primary_email'  => $v->primary_email,
                    'status'         => $v->status,
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
