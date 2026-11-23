<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\LeadProduct;
use App\Models\ProformaInvoiceItem;
use App\Models\Masters\Conditions;
use App\Models\Masters\GstPercentage;
use App\Models\Masters\HazClass;
use App\Models\Masters\HsnCodes;
use App\Models\Masters\PackagingMaterial;
use App\Models\Masters\Segments;
use App\Models\Masters\Uom;
use App\Models\Product;
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
    private function applyScope($query, Request $request, bool $applyBranchFilter = false)
    {
        $branchFilter = $applyBranchFilter ? ($request->integer('branch_id') ?: null) : null;
        $user = $request->user();

        if ($user && ($user->user_type ?? null) === 'employee') {
            MasterVisibility::applyBranchScope($query, $user);
            return $query;
        }

        MasterVisibility::applyReadScope($query, $user, $branchFilter);
        return $query;
    }

    private function applyListFilters($query, Request $request)
    {
        if ($q = trim((string) $request->query('q', ''))) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%';
            $query->where(function ($w) use ($like, $q) {
                $w->where('name', 'ilike', $like)
                    ->orWhere('product_code', 'ilike', $like)
                    ->orWhere('brand', 'ilike', $like)
                    ->orWhere('generic_name', 'ilike', $like)
                    ->orWhereHas('hsn', fn($h) => $h->where('hsn_code', 'ilike', $like));

                if (preg_match('/^[A-Za-z]*[\s\-]*0*(\d{1,6})$/', $q, $m)) {
                    foreach ([1, 2, 3, 4] as $pad) {
                        $w->orWhere('product_code', 'ilike', '%-' . str_pad($m[1], $pad, '0', STR_PAD_LEFT));
                    }
                }
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
        if ($segmentEq = $request->query('segment_eq')) {
            $query->whereHas('segment', fn($w) => $w->where('name', $segmentEq));
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
                $query->where(fn($w) => $w->whereNull('haz_type')->orWhereNot($isHaz));
            }
        }

        if ($owners = $list('owner')) {
            $query->whereIn('created_by', array_map('intval', $owners));
        }

        if ($from = $request->query('created_from')) {
            $query->whereDate('created_at', '>=', $from);
        }
        if ($to = $request->query('created_to')) {
            $query->whereDate('created_at', '<=', $to);
        }

        if ($buckets = $list('created_bucket')) {
            $cut = fn(int $days) => now()->subDays($days - 1)->toDateString();

            $query->where(function ($outer) use ($buckets, $cut) {
                foreach ($buckets as $bucket) {
                    $outer->orWhere(function ($w) use ($bucket, $cut) {
                        if (preg_match('/^last:(\d{1,4})$/', (string) $bucket, $m) && (int) $m[1] > 0) {
                            $w->whereDate('created_at', '>=', $cut((int) $m[1]));
                            return;
                        }

                        match ($bucket) {
                            'last_7'  => $w->whereDate('created_at', '>=', $cut(7)),
                            'last_30' => $w->whereDate('created_at', '>=', $cut(30)),
                            'last_90' => $w->whereDate('created_at', '>=', $cut(90)),
                            'older'   => $w->whereDate('created_at', '<',  $cut(90)),
                            default   => $w->whereRaw('1 = 0'),
                        };
                    });
                }
            });
        }

        return $query;
    }

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

    private function editDenial($user, $product, string $action = 'edit'): ?string
    {
        if ($this->isBranchMember($user, $product)) {
            return null;
        }
        return MasterVisibility::hierarchicalDenial($user, $product, $action);
    }

    private function isBranchMember($user, $product): bool
    {
        if (!$user || ($user->user_type ?? null) !== 'employee') {
            return false;
        }
        if ((int) $user->client_id !== (int) $product->client_id) {
            return false;
        }
        if (!$product->branch_id || !$user->branch_id) {
            return false;
        }
        return (int) $user->branch_id === (int) $product->branch_id;
    }

    private function issuedDocumentCodes(Product $product, ?int $clientId): array
    {
        $codes = function ($query, string $table, string $idColumn, bool $softDeletes) use ($clientId) {
            return $query
                ->join($table, "{$table}.id", '=', $idColumn)
                ->where("{$table}.client_id", $clientId)
                ->when($softDeletes, fn($q) => $q->whereNull("{$table}.deleted_at"))
                ->distinct()
                ->orderByDesc("{$table}.id")
                ->get(["{$table}.id", "{$table}.code"])
                ->pluck('code');
        };

        return [
            'po' => $codes(
                \App\Models\P2p\PurchaseOrderItem::query()->where('p2p_purchase_order_items.product_id', $product->id),
                'p2p_purchase_orders',
                'p2p_purchase_order_items.purchase_order_id',
                true,
            ),
            'pi' => $codes(
                ProformaInvoiceItem::query()->where('proforma_invoice_items.product_id', $product->id),
                'proforma_invoices',
                'proforma_invoice_items.proforma_invoice_id',
                false,
            ),
            'spi' => collect(),
        ];
    }

    private function gstLockDocuments(Product $product, ?int $clientId, ?array $documents = null): array
    {
        $docs = $documents ?? $this->issuedDocumentCodes($product, $clientId);

        return array_values(array_filter([
            $docs['po']->first(),
            $docs['pi']->first(),
            $docs['spi']->first(),
        ]));
    }

    private function gstChangeDenial(Product $product, array $data, ?int $clientId): ?string
    {
        if (!array_key_exists('gst_id', $data)) {
            return null;
        }
        $incoming = ($data['gst_id'] === null || $data['gst_id'] === '') ? null : (int) $data['gst_id'];
        $current  = $product->gst_id === null ? null : (int) $product->gst_id;
        if ($incoming === $current) {
            return null;
        }

        $docs = $this->gstLockDocuments($product, $clientId);
        if (!empty($docs)) {
            return 'GST % cannot be changed — this product is already used in '
                . implode(' and ', $docs)
                . '. The tax on that document was calculated from the current rate.';
        }

        $suppliers = ProductVendorMap::where('product_id', $product->id)
            ->where(fn ($q) => $q->whereNull('origin')->orWhere('origin', '!=', \App\Support\SupplierPricing::INTERNATIONAL))
            ->orderBy('id')
            ->pluck('vendor_name')
            ->filter()
            ->values();
        if ($suppliers->isNotEmpty()) {
            $named = $suppliers->take(2)->implode(', ')
                . ($suppliers->count() > 2 ? ' and ' . ($suppliers->count() - 2) . ' more' : '');

            return "GST % cannot be changed — {$named} " . ($suppliers->count() === 1 ? 'is' : 'are')
                . ' mapped to this product at the current rate. Unmap '
                . ($suppliers->count() === 1 ? 'it' : 'them') . ' first.';
        }

        return null;
    }

    // Price fields hidden from Purchase. gst_id / gst_percentage are NOT here:
    // Purchase maps the GST and must see it round-trip (it drives the supplier
    // GST calc) — only the money (price, amount, total, markup) stays hidden.
    private const SELLING_FIELDS = ['base_price', 'gst_amount', 'total_price', 'mark_bottom'];

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

    private function maskProductArray(array $payload, array $hide): array
    {
        if ($hide['selling']) {
            foreach (self::SELLING_FIELDS as $field) {
                if (\array_key_exists($field, $payload)) {
                    $payload[$field] = null;
                }
            }
            // gst_percentage stays: Purchase maps the GST and needs the rate back.
        }
        if ($hide['vendor']) {
            if (\array_key_exists('vendor_maps', $payload)) {
                $payload['vendor_count'] = \count($payload['vendor_maps']);
                $payload['vendor_maps'] = [];
            }
        }
        return $payload;
    }

    private function nextProductCode(?int $clientId, ?int $branchId): string
    {
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
        return 'P-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }

    public function index(Request $request)
    {
        $lite = $request->boolean('lite');

        $query = Product::query()->with(
            $lite
                ? [
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

        $query = $this->applyScope($query, $request, true);

        $query = $this->applyListFilters($query, $request);

        $mappedCount = $lite ? 0 : (clone $query)->has('vendorMaps')->count();
        $zeroCount   = $lite ? 0 : (clone $query)->doesntHave('vendorMaps')->count();

        $query = $this->applySupplierTab($query, $request);

        match ($request->query('sort')) {
            'price-asc'  => $query->orderBy('total_price'),
            'price-desc' => $query->orderByDesc('total_price'),
            default      => $query->orderByDesc('id'),
        };

        $perPage = max(1, min((int) $request->query('per_page', 24), 200));

        $products = $query->paginate($perPage);

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

        $segmentUploads = $this->safeDelegate(function () use ($request, $id) {
            $request->query->set('category', 'qc');
            return (new SegmentDocUploadController())->index($request, 'product', $id);
        });

        $payload = $this->maskProductArray($product->toArray(), $this->departmentHiddenGroups($request));
        $payload['segment_uploads'] = $segmentUploads ?: ['data' => [], 'by_category' => [], 'count' => 0];

        return response()->json($payload);
    }

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

    public function storeCore(Request $request)
    {
        foreach (['description', 'confidential_info'] as $textField) {
            $value = $request->input($textField);
            if (is_string($value)) {
                $request->merge([$textField => str_replace(["\r\n", "\r"], "\n", $value)]);
            }
        }

        $data = $request->validate([
            'id'                    => 'nullable|integer|exists:products,id',
            'name'                  => 'required|string|max:100',
            'generic_name'          => 'nullable|string|max:255',
            'description'           => 'nullable|string|max:10000',
            'brand'                 => 'nullable|string|max:255',
            'segment_id'            => 'nullable|integer',
            'haz_type'              => 'nullable|string|max:20',
            'haz_class_id'          => 'nullable|integer',
            'uom_id'                => 'nullable|integer',
            'hsn_id'                => 'nullable|integer',
            'condition_id'          => 'nullable|integer',
            'packaging_material_id' => 'nullable|integer',
            'confidential_info'     => 'nullable|string|max:2000',
            'cold_chain'            => 'nullable|boolean',
            'cold_chain_temp_min'   => 'nullable|required_if_accepted:cold_chain|numeric|between:-100,100',
            'cold_chain_temp_max'   => 'nullable|required_if_accepted:cold_chain|numeric|between:-100,100|gte:cold_chain_temp_min',
            'gst_id'                => 'nullable|integer',

            'primary_image'         => 'nullable|string|max:500',
            'primary_image_file'    => 'nullable|file|mimes:jpg,jpeg,png|max:2048',
            'secondary_images'      => 'nullable|array',
            'secondary_images.*'    => 'nullable|string|max:500',
            'secondary_image_files'   => 'nullable|array|max:10',
            'secondary_image_files.*' => 'file|mimes:jpg,jpeg,png|max:2048',
            'product_attachment'      => 'nullable|string|max:500',
            'product_attachment_file' => 'nullable|file|mimes:pdf,doc,docx,jpg,jpeg,png,gif,webp|max:10240',
        ]);

        if (!isset($data['id']) && empty($data['gst_id'])) {
            $msg = 'GST is mandatory. Select a GST rate from the GST Master before saving the product.';
            return response()->json(['message' => $msg, 'errors' => ['gst_id' => [$msg]]], 422);
        }

        $product = isset($data['id'])
            ? $this->applyScope(Product::query(), $request)->findOrFail($data['id'])
            : new Product();
        if ($product->exists) {
            $denial = $this->editDenial($request->user(), $product, 'edit');
            if ($denial) return response()->json(['message' => $denial], 403);

            if ($gstDenial = $this->gstChangeDenial($product, $data, $request->user()?->client_id)) {
                return response()->json([
                    'message' => $gstDenial,
                    'errors'  => ['gst_id' => [$gstDenial]],
                ], 422);
            }
        }
        $ownership = $this->ownershipFor($request);

        if (!$product->exists) {
            $product->fill($ownership);
            $product->product_code = $this->nextProductCode($ownership['client_id'], $ownership['branch_id']);
            $product->status = 'draft';
        }

        if (array_key_exists('cold_chain', $data) && !$data['cold_chain']) {
            $data['cold_chain'] = false;
            $data['cold_chain_temp_min'] = null;
            $data['cold_chain_temp_max'] = null;
        }

        $product->fill(
            collect($data)
                ->except(['id', 'primary_image', 'primary_image_file', 'secondary_images', 'secondary_image_files', 'product_attachment', 'product_attachment_file'])
                ->toArray()
        );

        if ($request->hasFile('primary_image_file')) {
            if ($product->primary_image && !str_starts_with((string) $product->primary_image, 'blob:')) {
                Storage::disk('public')->delete($this->relativePath($product->primary_image));
            }
            $product->primary_image = $this->storeFileWithName($request->file('primary_image_file'), 'products/images');
        } elseif ($request->has('primary_image')) {
            $newPath = $data['primary_image'] ?: null;
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

        $hasKeptList   = $request->has('secondary_images');
        $hasNewFiles   = $request->hasFile('secondary_image_files');
        $forceReplace  = $request->boolean('secondary_images_replace');
        if ($hasKeptList || $hasNewFiles || $forceReplace) {
            $kept = ($hasKeptList || $forceReplace)
                ? (array) ($data['secondary_images'] ?? [])
                : (array) ($product->secondary_images ?? []);
            $kept = array_values(array_filter(
                $kept,
                fn($v) => is_string($v) && $v !== '' && !str_starts_with($v, 'blob:')
            ));

            $previous = is_array($product->secondary_images) ? $product->secondary_images : [];
            foreach ($previous as $old) {
                if (!is_string($old) || $old === '' || str_starts_with($old, 'blob:')) continue;
                if (!in_array($old, $kept, true)) {
                    Storage::disk('public')->delete($this->relativePath($old));
                }
            }

            $appended = [];
            foreach ((array) $request->file('secondary_image_files', []) as $file) {
                if ($file) {
                    $appended[] = $this->storeFileWithName($file, 'products/images');
                }
            }

            $product->secondary_images = array_values(array_merge($kept, $appended));
        }

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

        $product->step_completed = max((int)($product->step_completed ?? 0), 1);

        $product->save();

        return response()->json(
            $this->maskProductArray($product->fresh()->toArray(), $this->departmentHiddenGroups($request))
        );
    }

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

        if ($denial = $this->gstChangeDenial($product, $data, $request->user()?->client_id)) {
            return response()->json([
                'message' => $denial,
                'errors'  => ['gst_id' => [$denial]],
            ], 422);
        }

        $product->fill($data);
        $product->step_completed = max((int)$product->step_completed, 2);
        if ($product->status === 'draft') {
            $product->status = 'inactive';
        }
        $product->save();

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

            $product->step_completed = max((int)$product->step_completed, 3);
            if ($product->status === 'draft') {
                $product->status = 'inactive';
            }
            $product->save();

            $product->qcRecords()->delete();
            foreach ($data['qc_records'] ?? [] as $idx => $qc) {
                $row = collect($qc)->except(['attachment_file'])->toArray();

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

    public function usage(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);

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

        $docs         = $this->issuedDocumentCodes($product, $clientId);
        $poCodes      = $docs['po'];
        $piCodes      = $docs['pi'];
        $spiCodes     = $docs['spi'];
        $gstLockCodes = $this->gstLockDocuments($product, $clientId, $docs);

        $gstLockSuppliers = ProductVendorMap::where('product_id', $product->id)
            ->where(fn ($q) => $q->whereNull('origin')->orWhere('origin', '!=', \App\Support\SupplierPricing::INTERNATIONAL))
            ->orderBy('id')
            ->pluck('vendor_name')
            ->filter()
            ->values();

        return response()->json([
            'status' => true,
            'data'   => [
                'leads'          => $leads,
                'lead_count'     => $leads->count(),
                'blocking_leads' => $leads->where('has_customer', true)->values(),
                'po_codes'         => $poCodes,
                'pi_codes'         => $piCodes,
                'spi_codes'        => $spiCodes,
                'latest_po_code'   => $poCodes->first(),
                'latest_pi_code'   => $piCodes->first(),
                'latest_spi_code'  => $spiCodes->first(),
                'in_po_or_spi'   => $poCodes->isNotEmpty() || $spiCodes->isNotEmpty(),
                'segment_locked' => $leads->contains('has_customer', true)
                    || $poCodes->isNotEmpty() || $spiCodes->isNotEmpty(),

                'gst_lock_codes' => $gstLockCodes,
                'gst_lock_suppliers' => $gstLockSuppliers,
                'gst_locked'     => !empty($gstLockCodes) || $gstLockSuppliers->isNotEmpty(),
            ],
        ]);
    }

    public function vendorMaps(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);

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
        $intl  = $map->origin === \App\Support\SupplierPricing::INTERNATIONAL;

        $gstPct = $intl ? 0.0 : (float) ($map->gst_percentage ?? 0);
        $gstAmt = $intl ? 0.0 : round($price * $gstPct / 100, 2);
        $total  = round($price + $gstAmt, 2);
        $rate   = (float) ($map->exchange_rate ?? 0);
        $inr    = $intl && $rate > 0 ? round($price * $rate, 2) : null;

        DB::transaction(function () use ($map, $price, $gstAmt, $total, $inr) {
            $map->purchase_price = $price;
            $map->gst_amount     = $gstAmt;
            $map->total_amount   = $total;
            $map->inr_amount     = $inr;
            $map->save();

            if ($map->vendor_id) {
                \App\Models\VendorProductMapping::where('vendor_id', $map->vendor_id)
                    ->where('product_id', $map->product_id)
                    ->update([
                        'purchase_price' => $price,
                        'gst_amount'     => $gstAmt,
                        'total_amount'   => $total,
                        'inr_amount'     => $inr,
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

    public function destroyVendorMap(Request $request, int $id, int $mapId)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        if ($denial = $this->editDenial($request->user(), $product, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $map = ProductVendorMap::where('product_id', $product->id)->findOrFail($mapId);

        DB::transaction(function () use ($map) {
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

    public function storeVendors(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        if ($denial = $this->editDenial($request->user(), $product, 'edit')) {
            return response()->json(['message' => $denial], 403);
        }

        $data = $request->validate([
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
            'vendors.*.origin'           => ['nullable', \Illuminate\Validation\Rule::in(\App\Support\SupplierPricing::ORIGINS)],
            'vendors.*.currency'         => 'nullable|string|size:3|alpha',
            'vendors.*.exchange_rate'    => 'nullable|numeric|gt:0|max:'.\App\Support\SupplierPricing::MAX_RATE,
            'vendors.*.purchase_price'   => 'nullable|numeric|min:0',
            'vendors.*.gst_percentage'   => 'nullable|numeric|min:0',
            'vendors.*.gst_amount'       => 'nullable|numeric|min:0',
            'vendors.*.total_amount'     => 'nullable|numeric|min:0',
            'vendors.*.map_date'         => 'nullable|date',
            'vendors.*.remarks'          => 'nullable|string',
        ]);

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

        $gstPct = (float) (optional(GstPercentage::find($product->gst_id))->percentage ?? 0);

        DB::transaction(function () use ($product, $data, $request, $gstPct) {
            $userId = $request->user()?->id;

            $product->vendorMaps()->delete();

            $nowMappedVendorIds = [];

            foreach ($data['vendors'] as $v) {
                $price = (float) ($v['purchase_price'] ?? 0);

                if (($v['origin'] ?? null) === \App\Support\SupplierPricing::INTERNATIONAL) {
                    $amounts = \App\Support\SupplierPricing::international(
                        $price,
                        (string) ($v['currency'] ?? 'USD'),
                        (float) ($v['exchange_rate'] ?? 0),
                    );
                    \App\Support\SupplierPricing::assertFits($amounts, 'vendors.');
                    $v['origin']         = $amounts['origin'];
                    $v['currency_code']  = $amounts['currency_code'];
                    $v['exchange_rate']  = $amounts['exchange_rate'];
                    $v['inr_amount']     = $amounts['inr_amount'];
                    $v['gst_percentage'] = 0;
                    $v['gst_amount']     = 0;
                    $v['total_amount']   = $amounts['total_amount'];
                } else {
                    $v['origin']         = \App\Support\SupplierPricing::DOMESTIC;
                    $v['currency_code']  = null;
                    $v['exchange_rate']  = null;
                    $v['inr_amount']     = null;
                    $v['gst_percentage'] = $gstPct;
                    $v['gst_amount']     = round($price * $gstPct / 100, 2);
                    $v['total_amount']   = round($price + $v['gst_amount'], 2);
                }
                unset($v['currency']);

                $product->vendorMaps()->create($v);

                $vendorId = $v['vendor_id'] ?? null;
                if (!$vendorId) continue;
                $nowMappedVendorIds[] = (int) $vendorId;

                \App\Models\VendorProductMapping::updateOrCreate(
                    ['vendor_id' => $vendorId, 'product_id' => $product->id],
                    [
                        'origin'         => $v['origin']         ?? null,
                        'currency_code'  => $v['currency_code']  ?? null,
                        'exchange_rate'  => $v['exchange_rate']  ?? null,
                        'inr_amount'     => $v['inr_amount']     ?? null,
                        'purchase_price' => $v['purchase_price'] ?? 0,
                        'gst_percentage' => $v['gst_percentage'] ?? 0,
                        'gst_amount'     => $v['gst_amount']     ?? 0,
                        'total_amount'   => $v['total_amount']   ?? ($v['purchase_price'] ?? 0),
                        'created_by'     => $userId,
                    ]
                );

                $vendor = \App\Models\Vendor::find($vendorId);
                if ($vendor) {
                    $vendor->step_completed = max((int) $vendor->step_completed, 4);
                    if ($vendor->status !== 'active') {
                        $vendor->status = 'active';
                    }
                    $vendor->save();
                }
            }

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

    public function destroy(Request $request, int $id)
    {
        $product = $this->applyScope(Product::query(), $request)->findOrFail($id);
        if ($denial = $this->editDenial($request->user(), $product, 'delete')) {
            return response()->json(['message' => $denial], 403);
        }
        $product->delete();
        return response()->json(['deleted' => true]);
    }

    public function stats(Request $request)
    {
        $query = $this->applyScope(Product::query(), $request, true);
        $query = $this->applyListFilters($query, $request);

        $mapped = (clone $query)->has('vendorMaps')->count();
        $zero   = (clone $query)->doesntHave('vendorMaps')->count();

        return response()->json([
            'active'   => $mapped,
            'inactive' => $zero,
            'total'    => $mapped + $zero,
        ]);
    }

    public function owners(Request $request)
    {
        $user = $request->user();
        if (!$user || !in_array($user->user_type, ['branch_user', 'employee'], true)) {
            return response()->json(['data' => []]);
        }

        $myBranch = $user->branch_id ? Branch::find($user->branch_id) : null;
        if (!$myBranch) {
            return response()->json(['data' => []]);
        }

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

    public function masterBundle(Request $request)
    {
        $user = $request->user();

        $cacheKey = MasterBundleCache::key('product:master-bundle', $user?->id);

        $bundle = Cache::remember($cacheKey, now()->addMinutes(5), function () use ($user) {
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
                    'primaryAddress:id,vendor_id,country_id,state_id,state_code,city,contact_name,contact_no,email,designation',
                    'primaryAddress.state:id,name',
                    'primaryAddress.country:id,name',
                    'vendorType:id,name,kind',
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
                    'vendor_type_kind' => optional($v->vendorType)->kind,
                    'segment_ids'    => array_values(array_unique(array_filter(array_merge(
                        [$v->segment_id ? (int) $v->segment_id : null],
                        $v->segments->pluck('id')->map(fn($x) => (int) $x)->all(),
                    )))),
                    'state'          => optional(optional($v->primaryAddress)->state)->name
                        ?? (optional($v->primaryAddress)->state_code ?: null),
                    'country'        => optional(optional($v->primaryAddress)->country)->name,
                    'city'           => optional($v->primaryAddress)->city,
                    'origin'         => \App\Support\SupplierPricing::originOf(
                        optional(optional($v->primaryAddress)->country)->name,
                    ),
                    'currency'       => \App\Support\SupplierPricing::currencyFor(
                        optional(optional($v->primaryAddress)->country)->name,
                    ),
                    'primary_address' => $v->primaryAddress ? [
                        'contact_name' => $v->primaryAddress->contact_name,
                        'contact_no'   => $v->primaryAddress->contact_no,
                        'email'        => $v->primaryAddress->email,
                        'designation'  => $v->primaryAddress->designation,
                    ] : null,
                ])
                ->values();

            return [
                'segments'           => $active(Segments::class,          ['id', 'name', 'regulatory_status']),
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
