<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\Masters\Conditions;
use App\Models\Masters\Departments;
use App\Models\Masters\GstPercentage;
use App\Models\Masters\HazClass;
use App\Models\Masters\HsnCodes;
use App\Models\Masters\PackagingMaterial;
use App\Models\Masters\Segments;
use App\Models\Masters\ServiceCategory;
use App\Models\Masters\Uom;
use App\Models\P2p\Service;
use App\Models\P2p\ServiceAttachment;
use App\Models\P2p\ServiceImage;
use App\Models\P2p\ServiceSupplier;
use App\Models\Vendor;
use App\Support\MasterBundleCache;
use App\Support\MasterVisibility;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * P2P · Service Management (Kryptone "Service Master").
 *
 *   List page      GET    /p2p/services                 tabs = service_type, sub-tabs = classification
 *   Add / Edit     POST   /p2p/services/step/core       Stage 1 — Service Core Information (multipart)
 *                  PUT    /p2p/services/{id}/step/suppliers   Stage 2 — Map Service Suppliers + submit
 *   Map Supplier   GET|POST /p2p/services/{id}/suppliers, PATCH …/suppliers/{map}, PATCH …/suppliers/{map}/status
 *   Active/Inactive PATCH  /p2p/services/{id}/status      (nothing in this module is deleted)
 *
 * Dropdown masters come from GET /p2p/services/master-bundle; the "+" (add new)
 * buttons beside them use the generic master API (POST /master/{slug}), and
 * "+ Add new supplier" uses the existing supplier wizard (/vendors/step/…).
 */
class ServiceController extends Controller
{
    private const IMAGE_MIMES      = 'jpg,jpeg,png,webp';
    private const ATTACHMENT_MIMES = 'pdf,doc,docx,xls,xlsx,csv,jpg,jpeg,png,webp';

    /* ══════════════════════════════════════════════════════════════════
     * Scoping & permissions
     * ══════════════════════════════════════════════════════════════════ */

    /**
     * Services are a SHARED branch catalogue, same as products: every employee
     * sees globals + client-level + their own branch's rows; other roles use the
     * standard creator hierarchy. The BranchSwitcher narrowing is opt-in (list
     * only) so show/update never 404 because another branch is being viewed.
     */
    private function scoped(Request $request, bool $applyBranchFilter = false, bool $withTrashed = false)
    {
        $query = $withTrashed ? Service::withTrashed() : Service::query();
        $user  = $request->user();

        if ($user && ($user->user_type ?? null) === 'employee') {
            MasterVisibility::applyBranchScope($query, $user);
            return $query;
        }

        $branchFilter = $applyBranchFilter ? ($request->integer('branch_id') ?: null) : null;
        MasterVisibility::applyReadScope($query, $user, $branchFilter);
        return $query;
    }

    private function findService(Request $request, int $id): Service
    {
        return $this->scoped($request)->findOrFail($id);
    }

    /** Branch staff may edit their branch's services; everyone else follows the hierarchy. */
    private function editDenial($user, Service $service, string $action = 'edit'): ?string
    {
        if ($user && ($user->user_type ?? null) === 'employee'
            && (int) $user->client_id === (int) $service->client_id
            && $service->branch_id && (int) $user->branch_id === (int) $service->branch_id) {
            return null;
        }
        return MasterVisibility::hierarchicalDenial($user, $service, $action);
    }

    private function deny(string $message)
    {
        return response()->json(['message' => $message], 403);
    }

    /** A master row exists, is active and is visible to the user. */
    private function masterQuery(string $modelClass, $user)
    {
        return $modelClass::query()
            ->whereRaw('LOWER(status) = ?', ['active'])
            ->tap(fn ($q) => MasterVisibility::applyReadScope($q, $user));
    }

    private function disk(): string
    {
        return config('filesystems.documents') ?: config('filesystems.default', 'public');
    }

    /* ══════════════════════════════════════════════════════════════════
     * Codes
     * ══════════════════════════════════════════════════════════════════ */

    /**
     * Next SVC-### for the branch. Codes run per (client, branch) and include
     * soft-deleted rows so a deleted service never hands its code back.
     */
    private function nextCode(?int $clientId, ?int $branchId): string
    {
        $q = Service::withTrashed();
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        $max = 0;
        foreach ($q->pluck('code') as $code) {
            if ($code && preg_match('/(\d+)$/', (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }
        return 'SVC-' . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
    }

    /* ══════════════════════════════════════════════════════════════════
     * GET /p2p/services/master-bundle
     * Everything the "Add Service" chooser, the Stage-1 form and the Map
     * Supplier popup need, in one cached response.
     * ══════════════════════════════════════════════════════════════════ */
    public function masterBundle(Request $request)
    {
        $user = $request->user();
        $key  = MasterBundleCache::key('service:master-bundle', $user?->id);

        $bundle = Cache::remember($key, now()->addMinutes(5), function () use ($user) {
            $active = fn (string $cls, array $cols) => $this->masterQuery($cls, $user)->orderBy('id')->get($cols);

            $vendors = Vendor::query()
                ->forUser($user)
                ->with([
                    'primaryAddress:id,vendor_id,state_id,state_code,contact_name,contact_no,email,designation',
                    'primaryAddress.state:id,name',
                    'vendorType:id,name',
                ])
                ->orderByDesc('id')
                ->get(['id', 'vendor_code', 'company_name', 'status', 'vendor_type_id'])
                ->map(fn ($v) => $this->vendorCard($v))
                ->values();

            return [
                'service_types'       => $this->taxonomy(),
                'delivery_types'      => Service::DELIVERY_TYPES,
                'billing_frequencies' => Service::BILLING_FREQUENCIES,
                'haz_types'           => Service::HAZ_TYPES,
                'contract_options'    => [['value' => true, 'label' => 'Required'], ['value' => false, 'label' => 'Not Required']],
                'service_categories'  => $active(ServiceCategory::class, ['id', 'name', 'service_type', 'classification']),
                // The shared Segments master (same list products use).
                'segments'            => $active(Segments::class, ['id', 'name']),
                'hsn_codes'           => $active(HsnCodes::class, ['id', 'hsn_code', 'description']),
                'uom'                 => $active(Uom::class, ['id', 'title', 'short_code', 'unit_type']),
                'haz_class'           => $active(HazClass::class, ['id', 'name']),
                'conditions'          => $active(Conditions::class, ['id', 'title']),
                'packaging_material'  => $active(PackagingMaterial::class, ['id', 'title']),
                'departments'         => $active(Departments::class, ['id', 'name', 'code']),
                'gst_percentage'      => $active(GstPercentage::class, ['id', 'percentage']),
                'vendors'             => $vendors,
            ];
        });

        return response()->json($bundle);
    }

    /** The type → classification tree in list form, for the chooser and the tabs. */
    private function taxonomy(): array
    {
        $out = [];
        foreach (Service::TYPES as $key => $t) {
            $classes = [];
            foreach ($t['classifications'] as $ck => $c) {
                $classes[] = ['key' => $ck] + $c;
            }
            $out[] = [
                'key'         => $key,
                'label'       => $t['label'],
                'short'       => $t['short'],
                'description' => $t['description'],
                // Soft / Digital has no sub-type, so the chooser goes straight to the form.
                'pick_classification' => !empty($t['classifications']),
                'classifications'     => $classes,
            ];
        }
        return $out;
    }

    /* ══════════════════════════════════════════════════════════════════
     * GET /p2p/services/next-code — preview of the code the next save gets.
     * ══════════════════════════════════════════════════════════════════ */
    public function nextCodePreview(Request $request)
    {
        $user = $request->user();
        return response()->json(['code' => $this->nextCode($user->client_id, $user->branch_id)]);
    }

    /* ══════════════════════════════════════════════════════════════════
     * GET /p2p/services/stats — tab + sub-tab badges.
     * Counted on the scoped catalogue WITHOUT the search box, matching the
     * design (badges keep their totals while searching).
     * ══════════════════════════════════════════════════════════════════ */
    public function stats(Request $request)
    {
        return response()->json($this->tabCounts($request));
    }

    private function tabCounts(Request $request): array
    {
        $rows = $this->scoped($request, true)
            ->selectRaw('service_type, classification, COUNT(*) AS n')
            ->groupBy('service_type', 'classification')
            ->get();

        $counts = [];
        foreach (Service::TYPES as $type => $t) {
            $counts[$type] = ['total' => 0] + array_fill_keys(array_keys($t['classifications']), 0);
        }
        foreach ($rows as $r) {
            if (!isset($counts[$r->service_type])) continue;
            $counts[$r->service_type]['total'] += (int) $r->n;
            if ($r->classification && array_key_exists($r->classification, $counts[$r->service_type])) {
                $counts[$r->service_type][$r->classification] += (int) $r->n;
            }
        }
        $counts['all'] = array_sum(array_column($counts, 'total'));
        return $counts;
    }

    /* ══════════════════════════════════════════════════════════════════
     * GET /p2p/services
     * Query: service_type, classification, q, status, supplier=mapped|zero,
     *        sort=recent|oldest|name, per_page (≤200), page
     * ══════════════════════════════════════════════════════════════════ */
    public function index(Request $request)
    {
        $request->validate([
            'service_type'   => ['nullable', Rule::in(array_keys(Service::TYPES))],
            'classification' => 'nullable|string|max:30',
            'status'         => ['nullable', Rule::in(Service::STATUSES)],
            'supplier'       => 'nullable|in:mapped,zero',
            'sort'           => 'nullable|in:recent,oldest,name',
            'per_page'       => 'nullable|integer|min:1|max:200',
        ]);

        $query = $this->scoped($request, true)
            ->with([
                'category:id,name',
                'segment:id,name',
                'hsn:id,hsn_code',
                'uom:id,title,short_code',
                'condition:id,title',
                'department:id,name',
                'primaryImage:id,service_id,file_path,original_name',
                'activeSuppliers:id,service_id,vendor_id,status',
                'activeSuppliers.vendor:id,vendor_code,company_name',
            ])
            ->withCount(['activeSuppliers as suppliers_count']);

        if ($type = $request->query('service_type')) {
            $query->where('service_type', $type);
        }
        if ($class = $request->query('classification')) {
            $query->where('classification', $class);
        }
        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        match ($request->query('supplier')) {
            'mapped' => $query->has('activeSuppliers'),
            'zero'   => $query->doesntHave('activeSuppliers'),
            default  => null,
        };

        match ($request->query('sort')) {
            'oldest' => $query->orderBy('created_at')->orderBy('id'),
            'name'   => $query->orderBy('name'),
            default  => $query->orderByDesc('created_at')->orderByDesc('id'),
        };

        $page = $query->paginate((int) $request->query('per_page', 10));
        $page->setCollection($page->getCollection()->map(fn (Service $s) => $this->listRow($s)));

        return response()->json($page->toArray() + ['counts' => $this->tabCounts($request)]);
    }

    /** One list row — the columns of all three tabs, flattened. */
    private function listRow(Service $s): array
    {
        return [
            'id'                   => $s->id,
            'code'                 => $s->code,
            'created_at'           => $s->created_at,
            'name'                 => $s->name,
            'description'          => $s->description,
            'service_type'         => $s->service_type,
            'service_type_label'   => $s->service_type_label,
            'classification'       => $s->classification,
            'classification_label' => $s->classification_label,
            'category'             => $s->category?->name,
            'segment'              => $s->segment?->name,
            'provider_brand'       => $s->provider_brand,
            'delivery_type'        => $s->delivery_type,
            'billing_frequency'    => $s->billing_frequency,
            'department'           => $s->department?->name,
            'hsn_code'             => $s->hsn?->hsn_code,
            'uom'                  => $s->uom?->short_code ?: $s->uom?->title,
            'condition'            => $s->condition?->title,
            'contract_required'    => (bool) $s->contract_required,
            'status'               => $s->status,
            'step_completed'       => $s->step_completed,
            'primary_image'        => $s->primaryImage?->file_path,
            'suppliers_count'      => (int) $s->suppliers_count,
        ];
    }

    /* ══════════════════════════════════════════════════════════════════
     * GET /p2p/services/{id} — everything the Edit form + detail need.
     * ══════════════════════════════════════════════════════════════════ */
    public function show(Request $request, int $id)
    {
        return response()->json($this->detail($this->findService($request, $id)));
    }

    private function detail(Service $service): array
    {
        $service->load([
            'category:id,name,service_type,classification',
            'segment:id,name',
            'hsn:id,hsn_code,description',
            'uom:id,title,short_code',
            'hazClass:id,name',
            'condition:id,title',
            'packaging:id,title',
            'department:id,name,code',
            'images'      => fn ($q) => $q->orderByDesc('is_primary')->orderBy('sort_order')->orderBy('id'),
            'attachments' => fn ($q) => $q->orderBy('id'),
            'creator:id,name',
            'suppliers'   => fn ($q) => $q->orderBy('id'),
            'suppliers.vendor' => fn ($q) => $q->select('id', 'vendor_code', 'company_name', 'vendor_type_id', 'status'),
            'suppliers.vendor.vendorType:id,name',
            'suppliers.vendor.primaryAddress:id,vendor_id,state_id,state_code,contact_name,contact_no,email',
            'suppliers.vendor.primaryAddress.state:id,name',
        ]);

        $data = $service->toArray();
        $data['suppliers'] = $service->suppliers->map(fn ($m) => $this->supplierRow($m))->values();
        return $data;
    }

    /** A vendor as the Map Supplier popup shows it (auto-filled fields). */
    private function vendorCard(Vendor $v): array
    {
        $addr = $v->primaryAddress;
        return [
            'id'             => $v->id,
            'vendor_code'    => $v->vendor_code,
            'company_name'   => $v->company_name,
            'status'         => $v->status,
            'supplier_type'  => $v->vendorType?->name,
            'state'          => $addr?->state?->name ?? ($addr?->state_code ?: null),
            'contact_person' => $addr?->contact_name,
            'contact_no'     => $addr?->contact_no,
        ];
    }

    /** One row of the "Mapped Service Suppliers" table. */
    private function supplierRow(ServiceSupplier $m): array
    {
        $card = $m->vendor ? $this->vendorCard($m->vendor) : ['id' => $m->vendor_id];
        return [
            'id'             => $m->id,
            'vendor_id'      => $m->vendor_id,
            'vendor_code'    => $card['vendor_code'] ?? null,
            'vendor_name'    => $card['company_name'] ?? null,
            'supplier_type'  => $card['supplier_type'] ?? null,
            'state'          => $card['state'] ?? null,
            'contact_person' => $card['contact_person'] ?? null,
            'price'          => (float) $m->price,
            'gst_percentage' => (float) $m->gst_percentage,
            'gst_amount'     => (float) $m->gst_amount,
            'total_amount'   => (float) $m->total_amount,
            'remarks'        => $m->remarks,
            'status'         => $m->status ?? 'active',
            'mapped_at'      => $m->created_at,
        ];
    }

    /* ══════════════════════════════════════════════════════════════════
     * POST /p2p/services/step/core  (multipart/form-data)
     * Stage 1 — Service Core Information. Without `id` it creates a draft
     * service and allocates its code; with `id` it updates that service.
     * Changing service_type is allowed ("Change Type"): columns the new type
     * doesn't own are cleared, and images go when it stops being Self-Consumable.
     *
     * Files:
     *   primary_image_file        replaces the primary image (Self-Consumable)
     *   secondary_image_files[]   appended secondary images
     *   remove_image_ids[]        image ids to delete
     *   attachment_files[]        appended attachments (any type)
     *   remove_attachment_ids[]   attachment ids to delete
     * ══════════════════════════════════════════════════════════════════ */
    public function storeCore(Request $request)
    {
        $user = $request->user();
        $this->normaliseCoreInput($request);

        $service = null;
        if ($request->filled('id')) {
            $service = $this->findService($request, (int) $request->input('id'));
            if ($denial = $this->editDenial($user, $service, 'edit')) return $this->deny($denial);
        }

        $data = $this->validateCore($request, $service);

        // Self-Consumable needs a primary image — checked before any file is stored.
        if ($data['service_type'] === Service::TYPE_SELF && !$request->hasFile('primary_image_file')) {
            $removing = array_map('intval', (array) $request->input('remove_image_ids', []));
            $keepsOne = $service && $service->service_type === Service::TYPE_SELF
                && $service->images()->where('is_primary', true)->whereNotIn('id', $removing ?: [0])->exists();
            if (!$keepsOne) {
                throw ValidationException::withMessages(['primary_image_file' => ['A primary image is required for Self-Consumable services.']]);
            }
        }

        $service = DB::transaction(function () use ($request, $user, $service, $data) {
            $isNew = !$service;
            if ($isNew) {
                // One code allocation at a time per branch (the unique index is
                // the backstop; this keeps concurrent creates from colliding).
                DB::select('SELECT pg_advisory_xact_lock(?)', [crc32('p2p_services:' . $user->client_id . ':' . $user->branch_id)]);
                $service = new Service([
                    'client_id'  => $user->client_id,
                    'branch_id'  => $user->branch_id,
                    'created_by' => $user->id,
                ]);
                $service->code   = $this->nextCode($user->client_id, $user->branch_id);
                $service->status = 'draft';
            }

            // Clear every type-specific column the (possibly new) type doesn't own.
            $owned = Service::TYPE_FIELDS[$data['service_type']];
            foreach (Service::SWITCHABLE_FIELDS as $col) {
                if (!in_array($col, $owned, true)) {
                    $data[$col] = $col === 'contract_required' ? false : null;
                }
            }
            if (($data['haz_type'] ?? null) !== 'Hazardous') {
                $data['haz_class_id'] = null;
            }

            $service->fill(collect($data)->only((new Service())->getFillable())->except(['client_id', 'branch_id', 'created_by', 'code', 'status'])->all());
            $service->updated_by     = $user->id;
            $service->step_completed = max((int) $service->step_completed, 1);
            $service->save();

            $this->syncImages($request, $service);
            $this->syncAttachments($request, $service);

            return $service;
        });

        return response()->json($this->detail($service->fresh()), $request->filled('id') ? 200 : 201);
    }

    /** Multipart sends everything as strings — normalise toggles and blanks first. */
    private function normaliseCoreInput(Request $request): void
    {
        $merge = [];
        if ($request->has('contract_required')) {
            $v = $request->input('contract_required');
            $merge['contract_required'] = is_string($v)
                ? in_array(strtolower(trim($v)), ['1', 'true', 'yes', 'on', 'required'], true)
                : (bool) $v;
        }
        foreach (['description', 'remark', 'confidential_info'] as $f) {
            if (is_string($request->input($f))) {
                $merge[$f] = str_replace(["\r\n", "\r"], "\n", $request->input($f));
            }
        }
        foreach (['classification', 'category_id', 'segment_id', 'haz_class_id', 'gst_percentage'] as $f) {
            if ($request->input($f) === '') $merge[$f] = null;
        }
        if ($merge) $request->merge($merge);
    }

    private function validateCore(Request $request, ?Service $existing): array
    {
        $user  = $request->user();
        $type  = (string) $request->input('service_type', $existing?->service_type);
        $types = array_keys(Service::TYPES);

        $exists = fn (string $cls) => function ($attr, $value, $fail) use ($cls, $user) {
            if ($value !== null && !$this->masterQuery($cls, $user)->whereKey($value)->exists()) {
                $fail('The selected ' . str_replace('_', ' ', preg_replace('/_id$/', '', $attr)) . ' is invalid or inactive.');
            }
        };

        $rules = [
            'id'             => 'nullable|integer',
            'service_type'   => ['required', Rule::in($types)],
            'name'           => 'required|string|max:150',
            'description'    => 'required|string|max:10000',
            'provider_brand' => 'required|string|max:255',
            'hsn_id'         => ['required', 'integer', $exists(HsnCodes::class)],
            'uom_id'         => ['required', 'integer', $exists(Uom::class)],
            'gst_percentage' => 'nullable|numeric|min:0|max:100',

            'attachment_files'        => 'nullable|array|max:10',
            'attachment_files.*'      => 'file|mimes:' . self::ATTACHMENT_MIMES . '|max:10240',
            'remove_attachment_ids'   => 'nullable|array',
            'remove_attachment_ids.*' => 'integer',
        ];

        if ($type === Service::TYPE_SELF) {
            $rules += [
                'classification'          => ['required', Rule::in(Service::classificationsOf(Service::TYPE_SELF))],
                'segment_id'              => ['required', 'integer'],
                'haz_type'                => ['required', Rule::in(Service::HAZ_TYPES)],
                'haz_class_id'            => ['nullable', 'required_if:haz_type,Hazardous', 'integer', $exists(HazClass::class)],
                'condition_id'            => ['required', 'integer', $exists(Conditions::class)],
                'packaging_id'            => ['required', 'integer', $exists(PackagingMaterial::class)],
                'confidential_info'       => 'nullable|string|max:2000',
                'primary_image_file'      => 'nullable|file|mimes:' . self::IMAGE_MIMES . '|max:2048',
                'secondary_image_files'   => 'nullable|array|max:10',
                'secondary_image_files.*' => 'file|mimes:' . self::IMAGE_MIMES . '|max:2048',
                'remove_image_ids'        => 'nullable|array',
                'remove_image_ids.*'      => 'integer',
            ];
        } elseif ($type === Service::TYPE_SOFT) {
            $rules += [
                'category_id'       => ['required', 'integer'],
                'segment_id'        => ['required', 'integer'],
                'delivery_type'     => ['required', Rule::in(Service::DELIVERY_TYPES)],
                'contract_required' => 'nullable|boolean',
                'remark'            => 'nullable|string|max:2000',
            ];
        } elseif ($type === Service::TYPE_OTHER) {
            $rules += [
                'classification'    => ['required', Rule::in(Service::classificationsOf(Service::TYPE_OTHER))],
                'category_id'       => ['required', 'integer'],
                'department_id'     => ['required', 'integer', $exists(Departments::class)],
                'billing_frequency' => ['required', Rule::in(Service::BILLING_FREQUENCIES)],
                'contract_required' => 'nullable|boolean',
                'remark'            => 'nullable|string|max:2000',
            ];
        }

        $data = $request->validate($rules);
        $errors = [];

        // Category must belong to this type (and, for Other, to the picked classification).
        if (array_key_exists('category_id', $data)) {
            $cat = $this->masterQuery(ServiceCategory::class, $user)->whereKey($data['category_id'])
                ->where('service_type', $type)->first();
            if (!$cat || ($type === Service::TYPE_OTHER && $cat->classification !== $data['classification'])) {
                $errors['category_id'] = ['The selected service category does not belong to this service type.'];
            }
        }

        // Soft / Digital has no sub-type.
        if ($type === Service::TYPE_SOFT) {
            $data['classification'] = null;
        }

        // Segment comes from the shared Segments master (same list as products).
        if (array_key_exists('segment_id', $data)
            && !$this->masterQuery(Segments::class, $user)->whereKey($data['segment_id'])->exists()) {
            $errors['segment_id'] = ['The selected segment is invalid or inactive.'];
        }

        if ($errors) throw ValidationException::withMessages($errors);

        if (!array_key_exists('contract_required', $data) && $type !== Service::TYPE_SELF) {
            $data['contract_required'] = (bool) ($existing?->contract_required ?? false);
        }
        return $data;
    }

    private function syncImages(Request $request, Service $service): void
    {
        $disk = $this->disk();

        // Not a Self-Consumable service any more → its images go.
        $remove = $service->service_type === Service::TYPE_SELF
            ? $service->images()->whereIn('id', (array) $request->input('remove_image_ids', []))->get()
            : $service->images()->get();

        if ($service->service_type === Service::TYPE_SELF && $request->hasFile('primary_image_file')) {
            $remove = $remove->merge($service->images()->where('is_primary', true)->get())->unique('id');
        }
        foreach ($remove as $img) {
            $this->deleteFile($img->file_path);
            $img->delete();
        }
        if ($service->service_type !== Service::TYPE_SELF) return;

        if ($file = $request->file('primary_image_file')) {
            $service->images()->create($this->fileRow($file, "p2p/services/images/{$service->id}", $disk, $service) + ['is_primary' => true]);
        }

        $order = (int) ServiceImage::where('service_id', $service->id)->max('sort_order');
        foreach ((array) $request->file('secondary_image_files', []) as $file) {
            if (!$file) continue;
            $service->images()->create($this->fileRow($file, "p2p/services/images/{$service->id}", $disk, $service)
                + ['is_primary' => false, 'sort_order' => ++$order]);
        }
    }

    private function syncAttachments(Request $request, Service $service): void
    {
        $disk = $this->disk();
        $ids  = (array) $request->input('remove_attachment_ids', []);
        foreach ($service->attachments()->whereIn('id', $ids)->get() as $att) {
            $this->deleteFile($att->file_path);
            $att->delete();
        }
        foreach ((array) $request->file('attachment_files', []) as $file) {
            if (!$file) continue;
            $row = $this->fileRow($file, "p2p/services/attachments/{$service->id}", $disk, $service);
            $service->attachments()->create($row + [
                'mime_type'   => $file->getClientMimeType(),
                'size'        => $file->getSize(),
                'uploaded_by' => $request->user()?->id,
            ]);
        }
    }

    /** Store under a random folder so the original filename survives (it is what downloads show). */
    private function fileRow(UploadedFile $file, string $dir, string $disk, Service $service): array
    {
        $original = $file->getClientOriginalName() ?: 'file';
        $safe     = preg_replace('/[^A-Za-z0-9 ._-]/', '_', $original) ?: 'file';
        $path     = $file->storeAs($dir . '/' . bin2hex(random_bytes(4)), $safe, $disk);
        return ['file_path' => $path, 'original_name' => $original, 'client_id' => $service->client_id];
    }

    private function deleteFile(?string $path): void
    {
        if (!$path) return;
        try {
            Storage::disk($this->disk())->delete($path);
        } catch (\Throwable $e) {
            Log::warning('Service file delete failed', ['path' => $path, 'error' => $e->getMessage()]);
        }
    }

    /* ══════════════════════════════════════════════════════════════════
     * PUT /p2p/services/{id}/step/suppliers
     * Stage 2 — the whole "Mapped Service Suppliers" list (full replace) and
     * submit. The service becomes active. An empty list is allowed, as in the
     * design (the list then shows 0 mapped suppliers).
     * ══════════════════════════════════════════════════════════════════ */
    public function storeSuppliers(Request $request, int $id)
    {
        $service = $this->findService($request, $id);
        if ($denial = $this->editDenial($request->user(), $service, 'edit')) return $this->deny($denial);

        $data = $request->validate([
            'suppliers'                  => 'present|array',
            'suppliers.*.vendor_id'      => 'required|integer|distinct',
            'suppliers.*.price'          => 'required|numeric|gt:0',
            'suppliers.*.gst_percentage' => 'required|numeric|min:0|max:100',
            'suppliers.*.remarks'        => 'nullable|string|max:1000',
        ]);

        $this->assertVendorsVisible($request, array_column($data['suppliers'], 'vendor_id'), 'suppliers');

        DB::transaction(function () use ($service, $data, $request) {
            $userId = $request->user()?->id;
            $keep   = [];
            foreach ($data['suppliers'] as $row) {
                $amounts = ServiceSupplier::amounts((float) $row['price'], (float) $row['gst_percentage']);
                $map = ServiceSupplier::firstOrNew(['service_id' => $service->id, 'vendor_id' => $row['vendor_id']]);
                if (!$map->exists) $map->created_by = $userId;
                $map->fill($amounts + ['remarks' => $row['remarks'] ?? null, 'status' => 'active', 'updated_by' => $userId])->save();
                $keep[] = $map->id;
            }
            // Suppliers left out of the list are switched inactive, never deleted.
            $service->suppliers()->whereNotIn('id', $keep ?: [0])->where('status', 'active')
                ->update(['status' => 'inactive', 'updated_by' => $userId, 'updated_at' => now()]);

            $service->status         = 'active';
            $service->step_completed = 2;
            $service->updated_by     = $userId;
            $service->save();
        });

        return response()->json($this->detail($service->fresh()));
    }

    /* ══════════════════════════════════════════════════════════════════
     * Map Supplier (list-row action + Stage-2 popup), one row at a time.
     * ══════════════════════════════════════════════════════════════════ */

    /** POST /p2p/services/{id}/suppliers — map one supplier. */
    public function storeSupplier(Request $request, int $id)
    {
        $service = $this->findService($request, $id);
        if ($denial = $this->editDenial($request->user(), $service, 'edit')) return $this->deny($denial);

        $data = $request->validate([
            'vendor_id'      => 'required|integer',
            'price'          => 'required|numeric|gt:0',
            'gst_percentage' => 'nullable|numeric|min:0|max:100',
            'remarks'        => 'nullable|string|max:1000',
        ]);
        $this->assertVendorsVisible($request, [$data['vendor_id']], 'vendor_id');

        $existing = $service->suppliers()->where('vendor_id', $data['vendor_id'])->first();
        if ($existing && $existing->status === 'active') {
            throw ValidationException::withMessages(['vendor_id' => ['This supplier is already mapped to the service.']]);
        }

        $gst    = $data['gst_percentage'] ?? ($service->gst_percentage !== null ? (float) $service->gst_percentage : 18.0);
        $userId = $request->user()?->id;
        $fields = ServiceSupplier::amounts((float) $data['price'], (float) $gst) + [
            'remarks' => $data['remarks'] ?? null,
            'status'  => 'active',
        ];

        // A previously de-activated mapping is switched back on with the new price.
        if ($existing) {
            $existing->fill($fields + ['updated_by' => $userId])->save();
            return response()->json($this->supplierRowFresh($existing));
        }

        $map = $service->suppliers()->create($fields + ['vendor_id' => $data['vendor_id'], 'created_by' => $userId]);
        return response()->json($this->supplierRowFresh($map), 201);
    }

    /** PATCH /p2p/services/{id}/suppliers/{mapId} — change price / GST / remarks. */
    public function updateSupplier(Request $request, int $id, int $mapId)
    {
        $service = $this->findService($request, $id);
        if ($denial = $this->editDenial($request->user(), $service, 'edit')) return $this->deny($denial);
        $map = $service->suppliers()->findOrFail($mapId);

        $data = $request->validate([
            'price'          => 'sometimes|required|numeric|gt:0',
            'gst_percentage' => 'sometimes|required|numeric|min:0|max:100',
            'remarks'        => 'sometimes|nullable|string|max:1000',
        ]);

        $amounts = ServiceSupplier::amounts(
            (float) ($data['price'] ?? $map->price),
            (float) ($data['gst_percentage'] ?? $map->gst_percentage)
        );
        $map->fill($amounts + ['updated_by' => $request->user()?->id]);
        if (array_key_exists('remarks', $data)) $map->remarks = $data['remarks'];
        $map->save();

        return response()->json($this->supplierRowFresh($map));
    }

    private function supplierRowFresh(ServiceSupplier $map): array
    {
        $map->load([
            'vendor:id,vendor_code,company_name,vendor_type_id,status',
            'vendor.vendorType:id,name',
            'vendor.primaryAddress:id,vendor_id,state_id,state_code,contact_name,contact_no,email',
            'vendor.primaryAddress.state:id,name',
        ]);
        return $this->supplierRow($map);
    }

    /** Every vendor id must be one the user can see in the supplier book. */
    private function assertVendorsVisible(Request $request, array $ids, string $field): void
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));
        if (!$ids) return;
        $found = Vendor::query()->forUser($request->user())->whereIn('id', $ids)->pluck('id')->map(fn ($x) => (int) $x)->all();
        $missing = array_diff($ids, $found);
        if ($missing) {
            throw ValidationException::withMessages([$field => ['Unknown supplier id(s): ' . implode(', ', $missing) . '.']]);
        }
    }
}
