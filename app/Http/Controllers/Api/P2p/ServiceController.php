<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\Masters\Conditions;
use App\Models\Masters\Currencies;
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
use App\Support\SupplierPricing;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ServiceController extends Controller
{
    private const IMAGE_MIMES      = 'jpg,jpeg,png,webp';
    private const ATTACHMENT_MIMES = 'pdf,doc,docx,xls,xlsx,csv,jpg,jpeg,png,webp';

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

    public function masterBundle(Request $request)
    {
        $user = $request->user();
        $key  = MasterBundleCache::key('service:master-bundle:v2', $user?->id);

        $bundle = Cache::remember($key, now()->addMinutes(5), function () use ($user) {
            $active = fn (string $cls, array $cols) => $this->masterQuery($cls, $user)->orderBy('id')->get($cols);

            $vendors = Vendor::query()
                ->forUser($user)
                ->with(self::VENDOR_WITH)
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

                'segments'            => $active(Segments::class, ['id', 'name']),
                'hsn_codes'           => $active(HsnCodes::class, ['id', 'hsn_code', 'description']),
                'uom'                 => $active(Uom::class, ['id', 'title', 'short_code', 'unit_type']),
                'haz_class'           => $active(HazClass::class, ['id', 'name']),
                'conditions'          => $active(Conditions::class, ['id', 'title']),
                'packaging_material'  => $active(PackagingMaterial::class, ['id', 'title']),
                'departments'         => $active(Departments::class, ['id', 'name', 'code']),
                'gst_percentage'      => $active(GstPercentage::class, ['id', 'percentage']),
                'vendors'             => $vendors,

                'supplier_origins'    => [
                    ['value' => SupplierPricing::DOMESTIC,      'label' => 'Domestic Supplier',      'note' => 'Supplier based in India — price in ₹ with GST applied'],
                    ['value' => SupplierPricing::INTERNATIONAL, 'label' => 'International Supplier', 'note' => 'Overseas supplier — price in its currency, no GST'],
                ],

                'currencies'          => $active(Currencies::class, ['id', 'code', 'name', 'symbol', 'exchange_rate'])
                    ->reject(fn ($c) => strtoupper((string) $c->code) === 'INR')->values(),
            ];
        });

        return response()->json($bundle);
    }

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

                'pick_classification' => !empty($t['classifications']),
                'classifications'     => $classes,
            ];
        }
        return $out;
    }

    public function nextCodePreview(Request $request)
    {
        $user = $request->user();
        return response()->json(['code' => $this->nextCode($user->client_id, $user->branch_id)]);
    }

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

        if ($q = trim((string) $request->query('q', ''))) {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $q) . '%';
            $query->where(function ($w) use ($like) {
                $w->where('code', 'ilike', $like)
                    ->orWhere('name', 'ilike', $like)
                    ->orWhere('description', 'ilike', $like)
                    ->orWhere('provider_brand', 'ilike', $like)
                    ->orWhere('delivery_type', 'ilike', $like)
                    ->orWhere('billing_frequency', 'ilike', $like)
                    ->orWhereHas('category', fn ($r) => $r->where('name', 'ilike', $like))
                    ->orWhereHas('segment', fn ($r) => $r->where('name', 'ilike', $like))
                    ->orWhereHas('hsn', fn ($r) => $r->where('hsn_code', 'ilike', $like))
                    ->orWhereHas('uom', fn ($r) => $r->where('title', 'ilike', $like)->orWhere('short_code', 'ilike', $like))
                    ->orWhereHas('condition', fn ($r) => $r->where('title', 'ilike', $like))
                    ->orWhereHas('activeSuppliers.vendor', fn ($r) => $r->where('company_name', 'ilike', $like)->orWhere('vendor_code', 'ilike', $like));
            });
        }

        match ($request->query('sort')) {
            'oldest' => $query->orderBy('created_at')->orderBy('id'),
            'name'   => $query->orderBy('name'),
            default  => $query->orderByDesc('created_at')->orderByDesc('id'),
        };

        $page = $query->paginate((int) $request->query('per_page', 10));
        $page->setCollection($page->getCollection()->map(fn (Service $s) => $this->listRow($s)));

        return response()->json($page->toArray() + ['counts' => $this->tabCounts($request)]);
    }

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

            'supplier_names'       => $s->activeSuppliers->map(fn ($m) => $m->vendor?->company_name)->filter()->values(),
        ];
    }

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
            'suppliers.vendor.primaryAddress:id,vendor_id,country_id,state_id,state_code,city,contact_name,contact_no,email',
            'suppliers.vendor.primaryAddress.state:id,name',
            'suppliers.vendor.primaryAddress.country:id,name',
        ]);

        $data = $service->toArray();
        $data['suppliers'] = $service->suppliers->map(fn ($m) => $this->supplierRow($m))->values();
        $active = $service->suppliers->where('status', 'active');
        $data['suppliers_summary'] = [
            'count'               => $active->count(),
            'domestic_count'      => $active->where('origin', '!=', SupplierPricing::INTERNATIONAL)->count(),
            'international_count' => $active->where('origin', SupplierPricing::INTERNATIONAL)->count(),
            'inactive_count'      => $service->suppliers->count() - $active->count(),

            'total_amount'        => round((float) $active->sum(fn ($m) => (float) ($m->inr_amount ?? $m->total_amount)), 2),
        ];
        return $data;
    }

    private const VENDOR_WITH = [
        'primaryAddress:id,vendor_id,country_id,state_id,state_code,city,contact_name,contact_no,email,designation',
        'primaryAddress.state:id,name',
        'primaryAddress.country:id,name',
        'vendorType:id,name',
    ];

    private function vendorCard(Vendor $v): array
    {
        $addr    = $v->primaryAddress;
        $country = $addr?->country?->name;
        return [
            'id'             => $v->id,
            'vendor_code'    => $v->vendor_code,
            'company_name'   => $v->company_name,
            'status'         => $v->status,
            'supplier_type'  => $v->vendorType?->name,
            'origin'         => SupplierPricing::originOf($country),
            'country'        => $country ?: 'India',
            'state'          => $addr?->state?->name ?? ($addr?->state_code ?: null),
            'gst_state_code' => $addr?->state_code ?: null,
            'city'           => $addr?->city,
            'currency'       => SupplierPricing::currencyFor($country),
            'contact_person' => $addr?->contact_name,
            'contact_no'     => $addr?->contact_no,
        ];
    }

    private function supplierRow(ServiceSupplier $m): array
    {
        $card = $m->vendor ? $this->vendorCard($m->vendor) : ['id' => $m->vendor_id];
        return [
            'id'             => $m->id,
            'vendor_id'      => $m->vendor_id,
            'vendor_code'    => $card['vendor_code'] ?? null,
            'vendor_name'    => $card['company_name'] ?? null,
            'supplier_type'  => $card['supplier_type'] ?? null,
            'origin'         => $m->origin ?: SupplierPricing::DOMESTIC,
            'country'        => $card['country'] ?? null,
            'state'          => $card['state'] ?? null,
            'city'           => $card['city'] ?? null,
            'contact_person' => $card['contact_person'] ?? null,
            'currency'       => $m->currency_code ?: 'INR',
            'price'          => (float) $m->price,
            'exchange_rate'  => $m->exchange_rate !== null ? (float) $m->exchange_rate : null,
            'gst_percentage' => (float) $m->gst_percentage,
            'gst_amount'     => (float) $m->gst_amount,
            'total_amount'   => (float) $m->total_amount,
            'inr_amount'     => (float) ($m->inr_amount ?? $m->total_amount),
            'remarks'        => $m->remarks,
            'status'         => $m->status ?? 'active',
            'mapped_at'      => $m->created_at,
        ];
    }

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
                DB::select('SELECT pg_advisory_xact_lock(?)', [crc32('p2p_services:' . $user->client_id . ':' . $user->branch_id)]);
                $service = new Service([
                    'client_id'  => $user->client_id,
                    'branch_id'  => $user->branch_id,
                    'created_by' => $user->id,
                ]);
                $service->code   = $this->nextCode($user->client_id, $user->branch_id);
                $service->status = 'draft';
            }

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

        if (array_key_exists('category_id', $data)) {
            $cat = $this->masterQuery(ServiceCategory::class, $user)->whereKey($data['category_id'])
                ->where('service_type', $type)->first();
            if (!$cat || ($type === Service::TYPE_OTHER && $cat->classification !== $data['classification'])) {
                $errors['category_id'] = ['The selected service category does not belong to this service type.'];
            }
        }

        if ($type === Service::TYPE_SOFT) {
            $data['classification'] = null;
        }

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

    public function storeSuppliers(Request $request, int $id)
    {
        $service = $this->findService($request, $id);
        if ($denial = $this->editDenial($request->user(), $service, 'edit')) return $this->deny($denial);

        $data = $request->validate([
            'suppliers'                  => 'present|array',
            'suppliers.*.vendor_id'      => 'required|integer|distinct',
            'suppliers.*.origin'         => ['nullable', Rule::in(SupplierPricing::ORIGINS)],
            'suppliers.*.price'          => 'required|numeric|gt:0',
            'suppliers.*.gst_percentage' => 'nullable|numeric|min:0|max:100',
            'suppliers.*.currency'       => 'nullable|string|size:3|alpha',
            'suppliers.*.exchange_rate'  => 'nullable|numeric|gt:0',
            'suppliers.*.remarks'        => 'nullable|string|max:1000',
        ], $this->priceMessages());

        $this->assertVendorsVisible($request, array_column($data['suppliers'], 'vendor_id'), 'suppliers');

        $priced = [];
        foreach ($data['suppliers'] as $i => $row) {
            $priced[$i] = $this->priceFields($request, $row, $service, "suppliers.$i.");
        }

        DB::transaction(function () use ($service, $data, $priced, $request) {
            $userId = $request->user()?->id;
            $keep   = [];
            foreach ($data['suppliers'] as $i => $row) {
                $amounts = $priced[$i];
                $map = ServiceSupplier::firstOrNew(['service_id' => $service->id, 'vendor_id' => $row['vendor_id']]);
                if (!$map->exists) $map->created_by = $userId;
                $map->fill($amounts + ['remarks' => $row['remarks'] ?? null, 'status' => 'active', 'updated_by' => $userId])->save();
                $keep[] = $map->id;
            }

            $service->suppliers()->whereNotIn('id', $keep ?: [0])->where('status', 'active')
                ->update(['status' => 'inactive', 'updated_by' => $userId, 'updated_at' => now()]);

            $service->status         = 'active';
            $service->step_completed = 2;
            $service->updated_by     = $userId;
            $service->save();
        });

        return response()->json($this->detail($service->fresh()));
    }

    public function suppliers(Request $request, int $id)
    {
        $service = $this->findService($request, $id);
        $detail  = $this->detail($service);
        return response()->json([
            'service' => ['id' => $service->id, 'code' => $service->code, 'name' => $service->name],
            'data'    => $detail['suppliers'],
            'summary' => $detail['suppliers_summary'],
        ]);
    }

    public function storeSupplier(Request $request, int $id)
    {
        $service = $this->findService($request, $id);
        if ($denial = $this->editDenial($request->user(), $service, 'edit')) return $this->deny($denial);

        $data = $request->validate([
            'vendor_id'      => 'required|integer',
            'origin'         => ['nullable', Rule::in(SupplierPricing::ORIGINS)],
            'price'          => 'required|numeric|gt:0',
            'gst_percentage' => 'nullable|numeric|min:0|max:100',
            'currency'       => 'nullable|string|size:3|alpha',
            'exchange_rate'  => 'nullable|numeric|gt:0',
            'remarks'        => 'nullable|string|max:1000',
        ], $this->priceMessages());
        $this->assertVendorsVisible($request, [$data['vendor_id']], 'vendor_id');

        $existing = $service->suppliers()->where('vendor_id', $data['vendor_id'])->first();
        if ($existing && $existing->status === 'active') {
            throw ValidationException::withMessages(['vendor_id' => ['This supplier is already mapped to the service.']]);
        }

        $userId = $request->user()?->id;
        $fields = $this->priceFields($request, $data, $service) + [
            'remarks' => $data['remarks'] ?? null,
            'status'  => 'active',
        ];

        if ($existing) {
            $existing->fill($fields + ['updated_by' => $userId])->save();
            return response()->json($this->supplierRowFresh($existing));
        }

        $map = $service->suppliers()->create($fields + ['vendor_id' => $data['vendor_id'], 'created_by' => $userId]);
        return response()->json($this->supplierRowFresh($map), 201);
    }

    public function updateSupplier(Request $request, int $id, int $mapId)
    {
        $service = $this->findService($request, $id);
        if ($denial = $this->editDenial($request->user(), $service, 'edit')) return $this->deny($denial);
        $map = $service->suppliers()->findOrFail($mapId);

        $data = $request->validate([
            'price'          => 'sometimes|required|numeric|gt:0',
            'gst_percentage' => 'sometimes|required|numeric|min:0|max:100',
            'currency'       => 'sometimes|required|string|size:3|alpha',
            'exchange_rate'  => 'sometimes|required|numeric|gt:0',
            'remarks'        => 'sometimes|nullable|string|max:1000',
        ], $this->priceMessages());

        $amounts = $this->priceFields($request, [
            'vendor_id'      => $map->vendor_id,
            'origin'         => $map->origin ?: SupplierPricing::DOMESTIC,
            'price'          => $data['price'] ?? $map->price,
            'gst_percentage' => $data['gst_percentage'] ?? $map->gst_percentage,
            'currency'       => $data['currency'] ?? $map->currency_code,
            'exchange_rate'  => $data['exchange_rate'] ?? $map->exchange_rate,
        ], $service);
        $map->fill($amounts + ['updated_by' => $request->user()?->id]);
        if (array_key_exists('remarks', $data)) $map->remarks = $data['remarks'];
        $map->save();

        return response()->json($this->supplierRowFresh($map));
    }

    public function updateSupplierStatus(Request $request, int $id, int $mapId)
    {
        $service = $this->findService($request, $id);
        if ($denial = $this->editDenial($request->user(), $service, 'edit')) return $this->deny($denial);
        $map  = $service->suppliers()->findOrFail($mapId);
        $data = $request->validate(['status' => ['required', Rule::in(ServiceSupplier::STATUSES)]]);

        $map->fill(['status' => $data['status'], 'updated_by' => $request->user()?->id])->save();

        return response()->json($this->supplierRowFresh($map) + [
            'suppliers_count' => $service->activeSuppliers()->count(),
        ]);
    }

    private function priceFields(Request $request, array $in, Service $service, string $prefix = ''): array
    {
        $vendor = Vendor::query()->with(self::VENDOR_WITH)->find($in['vendor_id']);
        $card   = $vendor ? $this->vendorCard($vendor) : ['origin' => SupplierPricing::DOMESTIC, 'country' => null, 'currency' => 'INR'];
        $origin = $in['origin'] ?? $card['origin'];

        if ($origin !== $card['origin']) {
            throw ValidationException::withMessages([$prefix . 'origin' => [
                $origin === SupplierPricing::INTERNATIONAL
                    ? 'This supplier is based in India — map it as a Domestic supplier.'
                    : 'This supplier is based in ' . ($card['country'] ?: 'another country') . ' — map it as an International supplier.',
            ]]);
        }

        if ($origin === SupplierPricing::INTERNATIONAL) {
            $currency = strtoupper((string) ($in['currency'] ?? '')) ?: $card['currency'];
            if ($currency === 'INR') {
                throw ValidationException::withMessages([$prefix . 'currency' => ["Pick the supplier's currency — an International price is not in ₹."]]);
            }
            $rate = isset($in['exchange_rate']) && (float) $in['exchange_rate'] > 0
                ? (float) $in['exchange_rate']
                : SupplierPricing::defaultRate($currency, $request->user());
            if (!$rate) {
                throw ValidationException::withMessages([$prefix . 'exchange_rate' => ["Enter the exchange rate (₹ per {$currency})."]]);
            }
            return SupplierPricing::international((float) $in['price'], $currency, $rate);
        }

        $gst = isset($in['gst_percentage']) && $in['gst_percentage'] !== ''
            ? (float) $in['gst_percentage']
            : ($service->gst_percentage !== null ? (float) $service->gst_percentage : 18.0);

        return array_intersect_key(
            SupplierPricing::domestic((float) $in['price'], $gst),
            array_flip(['origin', 'currency_code', 'exchange_rate', 'price', 'gst_percentage', 'gst_amount', 'total_amount', 'inr_amount'])
        );
    }

    private function priceMessages(): array
    {
        return [
            'price.required'             => "Enter the supplier's price.",
            'price.gt'                   => 'The price must be more than 0.',
            'suppliers.*.price.required' => "Enter the supplier's price.",
            'suppliers.*.price.gt'       => 'The price must be more than 0.',
            'exchange_rate.gt'           => 'The exchange rate must be more than 0.',
            'currency.size'              => 'Pick a currency (3-letter code, e.g. USD).',
        ];
    }

    private function supplierRowFresh(ServiceSupplier $map): array
    {
        $map->load([
            'vendor:id,vendor_code,company_name,vendor_type_id,status',
            'vendor.vendorType:id,name',
            'vendor.primaryAddress:id,vendor_id,country_id,state_id,state_code,city,contact_name,contact_no,email',
            'vendor.primaryAddress.state:id,name',
            'vendor.primaryAddress.country:id,name',
        ]);
        return $this->supplierRow($map);
    }

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

    public function updateStatus(Request $request, int $id)
    {
        $service = $this->findService($request, $id);
        if ($denial = $this->editDenial($request->user(), $service, 'edit')) return $this->deny($denial);

        $data = $request->validate(['status' => ['required', Rule::in(['active', 'inactive'])]]);
        if ($data['status'] === 'active' && (int) $service->step_completed < 2) {
            throw ValidationException::withMessages(['status' => ['Complete Stage 2 (Map Service Suppliers) before activating this service.']]);
        }

        $service->status     = $data['status'];
        $service->updated_by = $request->user()?->id;
        $service->save();

        return response()->json([
            'id'     => $service->id,
            'code'   => $service->code,
            'status' => $service->status,
            'message' => 'Service ' . $service->code . ' is now ' . $service->status . '.',
        ]);
    }
}
