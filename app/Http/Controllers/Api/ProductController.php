<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductQcRecord;
use App\Models\ProductVendorMap;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
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
                'vendorMaps:id,product_id',
                'qcRecords:id,product_id',
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

        return response()->json($product);
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
            $product->primary_image = $request->file('primary_image_file')->store('products/images', 'public');
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
                    $appended[] = $file->store('products/images', 'public');
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
                $uploaded = $request->file("qc_records.{$idx}.attachment_file");
                if ($uploaded) {
                    $row['attachment_path'] = $uploaded->store('products/qc', 'public');
                }
                $product->qcRecords()->create($row);
            }
        });

        return response()->json($product->fresh(['qcRecords']));
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

        DB::transaction(function () use ($product, $data) {
            $product->vendorMaps()->delete();
            foreach ($data['vendors'] as $v) {
                $product->vendorMaps()->create($v);
            }

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

        $active   = (clone $query)->where('status', 'active')->count();
        $inactive = (clone $query)->whereIn('status', ['inactive', 'draft'])->count();

        return response()->json([
            'active'   => $active,
            'inactive' => $inactive,
            'total'    => $active + $inactive,
        ]);
    }
}
