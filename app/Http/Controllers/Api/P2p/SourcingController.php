<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Masters\Countries;
use App\Models\Masters\Currencies;
use App\Models\Masters\GstPercentage;
use App\Models\Masters\Segments;
use App\Models\Masters\StateCodes;
use App\Models\Masters\States;
use App\Models\P2p\SourcingProductSupplier;
use App\Models\P2p\SourcingTarget;
use App\Models\P2p\Supplier as P2pSupplier;
use App\Models\Product;
use App\Models\User;
use App\Models\Vendor;
use App\Support\MasterVisibility;
use App\Support\SupplierPricing;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class SourcingController extends Controller
{
    private function ok($data)
    {
        return response()->json(['status' => true, 'data' => $data]);
    }

    private function target(Request $request, string $code): SourcingTarget
    {
        return SourcingTarget::where('client_id', $request->user()->client_id)
            ->where('code', $code)
            ->first() ?? abort(404, 'Sourcing target not found.');
    }

    private function sourceLabel(?string $s): string
    {
        return $s === 'manual' ? 'Manual Entry' : 'Product Master';
    }

    private function padCode(?string $code): ?string
    {
        if (! $code) {
            return $code;
        }

        return preg_replace_callback(
            '/(\d+)$/',
            fn ($m) => str_pad($m[1], 3, '0', STR_PAD_LEFT),
            $code,
        );
    }

    private function row(SourcingTarget $t): array
    {
        $total = $t->products->count();
        $done = $t->products->where('status', 'Completed')->count();

        $present = $t->products->pluck('source')->filter()->unique();
        $sources = [];
        if ($present->contains('master')) {
            $sources[] = 'Product Master';
        }
        if ($present->contains('manual')) {
            $sources[] = 'Manual Entry';
        }
        if (empty($sources)) {
            $sources[] = $this->sourceLabel($t->source);
        }

        $isComplete = $total > 0 && $done >= $total;
        $overdue = ! $isComplete
            && $t->due_date
            && Carbon::parse($t->due_date)->endOfDay()->isPast();

        $first = $t->products->sortBy('id')->first();
        $progress = $total > 0 ? (int) round($done * 100 / $total) : 0;

        return [
            'id' => $t->code,
            'source' => $this->sourceLabel($t->source),
            'sources' => $sources,
            'start' => optional($t->start_date)->format('Y-m-d') ?? '',
            'due' => optional($t->due_date)->format('Y-m-d') ?? '',
            'createdBy' => $t->created_by_name ?: '—',
            'assignee' => $t->assignee_name ?: '—',
            'products' => $total,
            'completed' => $done,
            'overdue' => $overdue,

            'createdById' => $t->created_by ? (string) $t->created_by : null,
            'assigneeId' => $t->assignee_id ? (string) $t->assignee_id : null,
            'firstProduct' => $first->name ?? null,
            'moreProducts' => max(0, $total - 1),
            'pending' => $total - $done,
            'progress' => $progress,
            'progressPercent' => $progress.'%',
            'totalProducts' => $total,
            'completedProducts' => $done,
            'mappedSuppliers' => (int) $t->products->sum(fn ($p) => (int) ($p->suppliers_count ?? 0)),
            'progressStatus' => $isComplete ? 'Completed' : 'In Progress',
        ];
    }

    public function index(Request $request)
    {
        $user = $request->user();
        if (! $user || ! $user->client_id) {
            return $this->ok($request->filled('tab')
                ? ['rows' => [], 'counts' => ['all' => 0, 'created' => 0, 'assigned' => 0], 'pagination' => ['page' => 1, 'per_page' => 10, 'total' => 0, 'last_page' => 1]]
                : ['assigned' => [], 'created' => []]);
        }

        $targets = SourcingTarget::where('client_id', $user->client_id)
            ->with(['products' => fn ($q) => $q->select('id', 'sourcing_target_id', 'status', 'source', 'name')->withCount('suppliers')])
            ->latest()
            ->get();

        if ($request->filled('tab')) {
            return $this->ok($this->trackerList($request, $targets, (int) $user->id));
        }

        return $this->ok([
            'assigned' => $targets->filter(fn ($t) => (int) $t->assignee_id === (int) $user->id)
                ->map(fn ($t) => $this->row($t))->values(),
            'created' => $targets->filter(fn ($t) => (int) $t->created_by === (int) $user->id)
                ->map(fn ($t) => $this->row($t))->values(),
        ]);
    }

    private function trackerList(Request $request, $targets, int $userId): array
    {
        $request->validate([
            'tab' => 'required|in:all,created,assigned',
            'q' => 'nullable|string|max:100',
            'status' => 'nullable|in:In Progress,Completed,Overdue',
            'page' => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:1|max:200',
        ]);

        $created = $targets->filter(fn ($t) => (int) $t->created_by === $userId);
        $assigned = $targets->filter(fn ($t) => (int) $t->assignee_id === $userId);
        $all = $created->concat($assigned)->unique('id')->sortByDesc('id')->values();

        $rows = match ($request->query('tab')) {
            'created' => $created->values(),
            'assigned' => $assigned->values(),
            default => $all,
        };
        $rows = $rows->map(fn ($t) => $this->row($t) + ['_names' => $t->products->pluck('name')->implode(' ')]);

        if ($q = mb_strtolower(trim((string) $request->query('q', '')))) {
            $rows = $rows->filter(fn ($r) => str_contains(mb_strtolower(implode(' ', [
                $r['id'], $r['source'], implode(' ', $r['sources']), $r['createdBy'], $r['assignee'],
                $r['progressStatus'], $r['overdue'] ? 'overdue' : '', $r['_names'],
            ])), $q));
        }
        if ($status = $request->query('status')) {
            $rows = $rows->filter(fn ($r) => $status === 'Overdue' ? $r['overdue'] : $r['progressStatus'] === $status);
        }

        $perPage = (int) $request->query('per_page', 10);
        $total = $rows->count();
        $last = max(1, (int) ceil($total / $perPage));
        $page = min((int) $request->query('page', 1), $last);

        return [
            'rows' => $rows->slice(($page - 1) * $perPage, $perPage)
                ->map(fn ($r) => Arr::except($r, ['_names']))->values(),
            'counts' => ['all' => $all->count(), 'created' => $created->count(), 'assigned' => $assigned->count()],
            'pagination' => ['page' => $page, 'per_page' => $perPage, 'total' => $total, 'last_page' => $last],
        ];
    }

    public function products(Request $request)
    {
        $user = $request->user();

        $branch = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);
        $rows = Product::where('client_id', $user->client_id)
            ->when($branch, fn ($q) => $q->where('branch_id', $branch))
            ->with(['segment:id,name', 'hsn:id,hsn_code'])

            ->orderByRaw("NULLIF(regexp_replace(product_code, '[^0-9]', '', 'g'), '')::int ASC NULLS LAST")
            ->orderBy('product_code')
            ->get()
            ->map(fn ($p) => [
                'code' => $this->padCode($p->product_code),
                'name' => $p->name,
                'segment' => $p->segment->name ?? '',
                'hsn' => $p->hsn->hsn_code ?? '',
            ]);

        return $this->ok($rows);
    }

    public function teamMembers(Request $request)
    {
        $user = $request->user();
        $branch = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);

        $deptIds = DB::table('master_departments')
            ->whereRaw('LOWER(name) LIKE ? OR LOWER(name) LIKE ?', ['%sales%', '%purchase%'])
            ->pluck('id');

        $eligibleEmployees = Employee::where('client_id', $user->client_id)
            ->whereIn('department_id', $deptIds)

            ->whereRaw('LOWER(status) = ?', ['active'])

            ->where('onboarding_stage_completed', '>=', 6)
            ->whereNotNull('user_id')
            ->with('designation:id,name')
            ->get(['id', 'user_id', 'designation_id']);

        $eligibleUserIds = $eligibleEmployees->pluck('user_id');
        $designationByUser = $eligibleEmployees
            ->mapWithKeys(fn ($e) => [(int) $e->user_id => ($e->designation->name ?? null)]);

        $rows = User::where('client_id', $user->client_id)
            ->whereIn('id', $eligibleUserIds)

            ->whereRaw('LOWER(status) = ?', ['active'])
            ->when($branch, fn ($q) => $q->where('branch_id', $branch))
            ->where('user_type', '!=', 'super_admin')
            ->orderBy('name')
            ->get(['id', 'name', 'user_type', 'designation'])
            ->map(fn ($u) => [
                'id' => (string) $u->id,
                'name' => $u->name,

                'role' => ($designationByUser[(int) $u->id] ?? null)
                    ?: ($u->designation ?: ucwords(str_replace('_', ' ', (string) $u->user_type))),
            ]);

        return $this->ok($rows);
    }

    public function formMasters(Request $request)
    {
        $user = $request->user();
        $scope = fn ($q) => MasterVisibility::applyReadScope($q, $user);
        $active = fn ($q) => $q->whereRaw('LOWER(status) = ?', ['active']);

        return $this->ok([
            'segments' => Segments::query()->tap($scope)->tap($active)->orderBy('name')->get(['id', 'name', 'regulatory_status']),
            'countries' => Countries::query()->tap($scope)->tap($active)->orderBy('name')->get(['id', 'name']),
            'states' => States::query()->tap($scope)->tap($active)->orderBy('name')->get(['id', 'country_id', 'name']),
            'stateCodes' => StateCodes::query()->tap($scope)->tap($active)->statutoryFirst()->get(['id', 'state_id', 'state_code']),

            'supplierOrigins' => [
                ['value' => SupplierPricing::DOMESTIC,      'label' => 'Domestic Supplier',      'note' => 'Supplier based in India — price in ₹ with GST applied'],
                ['value' => SupplierPricing::INTERNATIONAL, 'label' => 'International Supplier', 'note' => 'Overseas supplier — price in its currency, no GST'],
            ],
            'gstRates' => GstPercentage::query()->tap($scope)->tap($active)->orderBy('percentage')->pluck('percentage')
                ->map(fn ($g) => (float) $g)->unique()->values(),
            'gstTypes' => [
                ['value' => SupplierPricing::GST_INTRA, 'label' => 'CGST + SGST (Intra-state)'],
                ['value' => SupplierPricing::GST_INTER, 'label' => 'IGST (Inter-state)'],
            ],
            'currencies' => Currencies::query()->tap($scope)->tap($active)->whereRaw('UPPER(code) <> ?', ['INR'])
                ->orderBy('code')->get(['id', 'code', 'name', 'symbol', 'exchange_rate']),

            'homeState' => $this->homeState($user),
        ]);
    }

    private function homeState($user): array
    {
        $b = $user && $user->branch_id ? Branch::find($user->branch_id, ['id', 'state', 'gst_state_code']) : null;

        return ['state' => $b->state ?? null, 'stateCode' => $b->gst_state_code ?? null];
    }

    public function upload(Request $request)
    {
        $request->validate([
            'file' => 'required|file|max:5120',
            'kind' => 'nullable|in:clarity,card',
        ]);

        $allowed = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];
        $ext = strtolower($request->file('file')->getClientOriginalExtension());
        if (! in_array($ext, $allowed, true)) {
            return response()->json([
                'message' => 'The file must be a PDF, JPG, PNG, or WEBP.',
                'errors' => ['file' => ['The file must be a PDF, JPG, PNG, or WEBP.']],
            ], 422);
        }

        $file = $request->file('file');
        $token = Str::random(24);
        $safeName = $this->safeUploadName($file->getClientOriginalName(), $ext);
        $dir = 'p2p/'.($request->input('kind') === 'card' ? 'supplier-cards' : 'clarity').'/'.$token;
        $path = $file->storeAs($dir, $safeName, 'public');

        return $this->ok([
            'path' => '/storage/'.$path,
            'name' => $file->getClientOriginalName(),
        ]);
    }

    private function safeUploadName(string $original, string $ext): string
    {
        $base = pathinfo(basename($original), PATHINFO_FILENAME);
        $base = preg_replace('/[^\p{L}\p{N}\-_. ]+/u', '', $base) ?? '';
        $base = trim(preg_replace('/\s+/', ' ', $base) ?? '');
        if ($base === '' || $base === '.') {
            $base = 'document';
        }

        if (mb_strlen($base) > 120) {
            $base = mb_substr($base, 0, 120);
        }

        return $base.'.'.$ext;
    }

    public function downloadClarity(Request $request)
    {
        $data = $request->validate(['path' => 'required|string']);

        $rel = ltrim(str_replace('\\', '/', $data['path']), '/');
        $rel = preg_replace('#^storage/#', '', $rel);

        if (str_contains($rel, '..') || ! str_starts_with($rel, 'p2p/clarity/')) {
            abort(404);
        }

        $disk = Storage::disk('public');
        if (! $disk->exists($rel)) {
            abort(404);
        }

        return $disk->download($rel, basename($rel));
    }

    public function nextCode(Request $request)
    {
        $user = $request->user();
        $seq = SourcingTarget::withTrashed()->where('client_id', $user->client_id)->count() + 1;

        return $this->ok(['code' => sprintf('SRC-%03d', $seq)]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (! $user->client_id) {
            return response()->json(['status' => false, 'message' => 'No tenant context'], 403);
        }

        $data = $this->validatePayload($request, true);

        $target = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $seq = SourcingTarget::withTrashed()->where('client_id', $user->client_id)->count() + 1;
            $code = sprintf('SRC-%03d', $seq);

            $assignee = $this->resolveAssignee($user->client_id, $data['assignee_id'] ?? null);

            $target = SourcingTarget::create([
                'client_id' => $user->client_id,
                'branch_id' => $user->branch_id ?? null,
                'code' => $code,
                'source' => $data['source'],
                'start_date' => now()->toDateString(),
                'due_date' => $data['due_date'] ?? null,
                'assignee_id' => $assignee['id'],
                'assignee_name' => $assignee['name'],
                'created_by' => $user->id,
                'created_by_name' => $user->name ?? null,
                'status' => 'In Progress',
            ]);

            $this->syncProducts($target, $user->client_id, $data['products']);

            return $target;
        });

        return $this->ok(['id' => $target->code]);
    }

    public function update(Request $request, string $target)
    {
        $user = $request->user();
        $t = $this->target($request, $target);

        if ((int) $t->created_by !== (int) $user->id) {
            return response()->json([
                'status' => false,
                'message' => 'Only the creator can edit this sourcing target.',
            ], 403);
        }

        $data = $this->validatePayload($request);

        $existing = $t->products()->withCount('suppliers')->get();
        $incomingIds = collect($data['products'])
            ->pluck('id')->filter()->map(fn ($x) => (int) $x)->all();

        $blocked = $existing->first(
            fn ($p) => $p->suppliers_count > 0 && ! in_array((int) $p->id, $incomingIds, true)
        );
        if ($blocked) {
            return response()->json([
                'status' => false,
                'message' => "“{$blocked->name}” has suppliers mapped in the Sourcing Report and can't be removed. Unmap its suppliers first.",
            ], 422);
        }

        if (! $this->assigneeIsActive($t->client_id, $t->assignee_id)) {
            return response()->json([
                'status' => false,
                'message' => 'This sourcing target’s assignee is inactive or exited — it is view-only and can’t be edited.',
            ], 403);
        }

        DB::transaction(function () use ($t, $user, $data, $existing) {
            $t->update([
                'source' => $data['source'],
                'due_date' => $data['due_date'] ?? null,
            ]);

            $existingById = $existing->keyBy('id');
            $keptIds = [];

            foreach ($data['products'] as $p) {
                $pid = isset($p['id']) ? (int) $p['id'] : 0;

                if ($pid && $existingById->has($pid)) {
                    $clarity = $p['clarity'] ?? null;
                    $update = [
                        'target_price' => $p['target_price'] ?? null,
                        'clarity_type' => $clarity['type'] ?? null,
                        'clarity_value' => $clarity['val'] ?? ($clarity['value'] ?? null),
                    ];

                    if (($p['from'] ?? null) === 'manual' && array_key_exists('name', $p)) {
                        $update['name'] = $p['name'] ?? '—';
                    }
                    $existingById->get($pid)->update($update);
                    $keptIds[] = $pid;
                } else {
                    $this->syncProducts($t, $user->client_id, [$p]);
                }
            }

            $existing->reject(fn ($p) => in_array((int) $p->id, $keptIds, true))
                ->each(function ($p) {
                    $p->suppliers()->delete();
                    $p->delete();
                });
        });

        return $this->ok(['id' => $t->code]);
    }

    public function show(Request $request, string $target)
    {
        $t = $this->target($request, $target);

        $t->load(['products' => fn ($q) => $q->withCount('suppliers')]);

        $clarity = fn ($p) => $p->clarity_type
            ? ['type' => $p->clarity_type, 'val' => $p->clarity_value]
            : null;

        $resolve = $this->productDisplayResolver($t->products);
        $master = $t->products->where('source', 'master')->values()->map(function ($p) use ($clarity, $resolve) {
            $d = $resolve($p);

            return [
                'id' => $p->id,
                'mapped' => $p->suppliers_count > 0,
                'code' => $this->padCode($p->code),
                'name' => $d['name'],
                'segment' => $d['segment'],
                'hsn' => $d['hsn'],
                'price' => $p->target_price ?? '',
                'clarity' => $clarity($p),
            ];
        });

        $manual = $t->products->where('source', 'manual')->values()->map(fn ($p) => [
            'id' => $p->id,
            'mapped' => $p->suppliers_count > 0,
            'name' => $p->name,
            'price' => $p->target_price ?? '',
            'clarity' => $clarity($p),
        ]);

        return $this->ok([
            'id' => $t->code,
            'source' => $this->sourceLabel($t->source),
            'start' => optional($t->start_date)->format('Y-m-d') ?? '',
            'due' => optional($t->due_date)->format('Y-m-d') ?? '',
            'assignee' => $t->assignee_name ?: '',

            'assigneeId' => $t->assignee_id ? (string) $t->assignee_id : null,

            'assigneeActive' => $this->assigneeIsActive($t->client_id, $t->assignee_id),
            'masterRows' => $master,
            'manualRows' => $manual,
        ]);
    }

    public function report(Request $request, string $target)
    {
        $t = $this->target($request, $target);
        $t->load(['products' => fn ($q) => $q->withCount('suppliers')]);

        $clarity = fn ($p) => $p->clarity_type
            ? ['type' => $p->clarity_type, 'val' => $p->clarity_value]
            : null;

        $resolve = $this->productDisplayResolver($t->products);
        $products = $t->products->map(function ($p) use ($clarity, $resolve) {
            $d = $resolve($p);

            return [
                'id' => $p->id,
                'type' => $p->source,
                'code' => $this->padCode($p->code) ?? '',
                'name' => $d['name'],
                'segment' => $d['segment'] ?? '',
                'hsn' => $d['hsn'] ?? '',
                'price' => $p->target_price ?? '',
                'status' => $p->status,
                'supplierCount' => $p->suppliers_count,
                'clarity' => $clarity($p),
            ];
        })->values();

        return $this->ok([
            'id' => $t->code,
            'source' => $this->sourceLabel($t->source),
            'start' => optional($t->start_date)->format('Y-m-d') ?? '',
            'due' => optional($t->due_date)->format('Y-m-d') ?? '',
            'createdBy' => $t->created_by_name ?: '—',
            'assignee' => $t->assignee_name ?: '—',
            'products' => $products,
        ]);
    }

    public function setProductStatus(Request $request, string $target, int $product)
    {
        $t = $this->target($request, $target);
        $data = $request->validate(['status' => 'required|in:Completed,In Progress']);

        $p = $t->products()->where('id', $product)->first() ?? abort(404, 'Product not found in this sourcing target.');
        $p->update(['status' => $data['status']]);

        return $this->ok([
            'id' => $p->id,
            'status' => $p->status,
        ]);
    }

    public function updateProductClarity(Request $request, string $target, int $product)
    {
        $t = $this->target($request, $target);
        $p = $t->products()->where('id', $product)->first() ?? abort(404, 'Product not found in this sourcing target.');

        $data = $request->validate([
            'clarity_type' => 'nullable|string|in:text,link,pdf',
            'clarity_value' => 'nullable|string',
        ]);

        $p->update([
            'clarity_type' => $data['clarity_type'] ?: null,
            'clarity_value' => $data['clarity_value'] ?? null,
        ]);

        return $this->ok([
            'id' => $p->id,
            'clarity_type' => $p->clarity_type,
            'clarity_value' => $p->clarity_value,
        ]);
    }

    public function suppliers(Request $request)
    {
        $user = $request->user();

        $request->validate(['origin' => ['nullable', Rule::in(SupplierPricing::ORIGINS)]]);
        $origin = $request->query('origin');

        $rows = Vendor::query()->forUser($user, $request->integer('branch_id') ?: null)
            ->with(['segment:id,name', 'vendorType:id,name', 'addresses', 'addresses.country:id,name', 'addresses.state:id,name'])
            ->orderBy('company_name')
            ->get()
            ->map(function ($v) {
                $addr = $v->addresses->first();

                $countryName = $addr && $addr->country ? $addr->country->name : '';
                $region = $countryName === ''
                    ? ''
                    : (strcasecmp($countryName, 'India') === 0 ? 'Domestic' : 'International');

                return [
                    'origin' => SupplierPricing::originOf($countryName),
                    'supplierType' => $v->vendorType->name ?? '',
                    'state' => $addr && $addr->state ? $addr->state->name : '',
                    'stateCode' => $addr->state_code ?? '',
                    'city' => $addr->city ?? '',
                    'currency' => SupplierPricing::currencyFor($countryName),
                    'id' => (string) $v->id,

                    'code' => $v->vendor_code ?? '',
                    'name' => $v->company_name,
                    'segment' => $v->segment->name ?? '',
                    'contact' => $addr->contact_name ?? '',
                    'mobile' => $addr->contact_no ?? '',
                    'email' => ($addr->email ?? '') ?: ($v->primary_email ?? ''),
                    'country' => $countryName,
                    'region' => $region,
                ];
            })
            ->when($origin, fn ($c) => $c->where('origin', $origin)->values());

        return $this->ok($rows);
    }

    public function newSuppliers(Request $request)
    {
        $user = $request->user();
        if (! $user || ! $user->client_id) {
            return $this->ok([]);
        }

        $suppliers = P2pSupplier::where('client_id', $user->client_id)
            ->orderByDesc('id')
            ->get();

        $counts = DB::table('p2p_sourcing_product_suppliers as sps')
            ->join('p2p_sourcing_products as sp', 'sp.id', '=', 'sps.sourcing_product_id')
            ->where('sps.source', 'new')
            ->whereNull('sps.deleted_at')
            ->whereNull('sp.deleted_at')
            ->whereIn('sps.supplier_id', $suppliers->pluck('id'))
            ->groupBy('sps.supplier_id')
            ->selectRaw('sps.supplier_id, COUNT(DISTINCT sp.sourcing_target_id) as cnt')
            ->pluck('cnt', 'sps.supplier_id');

        $rows = $suppliers->map(fn ($s) => [
            'id' => $s->id,
            'name' => $s->name,
            'segment' => $s->segment,
            'contact' => $s->contact,
            'mobile' => $s->mobile,
            'email' => $s->email,
            'address' => $s->address,
            'country' => $s->country,
            'state' => $s->state,
            'state_code' => $s->state_code,
            'city' => $s->city,
            'gmaps' => $s->gmaps,
            'origin' => $s->origin ?: SupplierPricing::originOf($s->country),
            'sourcing_count' => (int) ($counts[$s->id] ?? 0),

            'converted' => (bool) $s->converted_vendor_id,
            'converted_vendor_id' => $s->converted_vendor_id,
            'converted_at' => optional($s->converted_at)->toIso8601String(),
            'created_at' => optional($s->created_at)->toIso8601String(),
        ]);

        return $this->ok($rows);
    }

    public function supplierSourcings(Request $request, int $supplier)
    {
        $user = $request->user();
        if (! $user || ! $user->client_id) {
            return $this->ok([]);
        }

        $sup = P2pSupplier::where('client_id', $user->client_id)->find($supplier);
        if (! $sup) {
            return $this->ok([]);
        }

        $rows = DB::table('p2p_sourcing_product_suppliers as sps')
            ->join('p2p_sourcing_products as sp', 'sp.id', '=', 'sps.sourcing_product_id')
            ->join('p2p_sourcing_targets as t', 't.id', '=', 'sp.sourcing_target_id')
            ->where('sps.source', 'new')
            ->where('sps.supplier_id', $supplier)
            ->where('t.client_id', $user->client_id)
            ->whereNull('sps.deleted_at')
            ->whereNull('sp.deleted_at')
            ->whereNull('t.deleted_at')
            ->orderByDesc('t.id')
            ->get(['t.id as target_id', 't.code as code', 't.due_date as due_date', 'sp.name as product']);

        $grouped = $rows->groupBy('target_id')->map(fn ($g) => [
            'code' => $g->first()->code,
            'due_date' => $g->first()->due_date,
            'products' => $g->pluck('product')->filter()->unique()->values(),
        ])->values();

        return $this->ok($grouped);
    }

    public function mapSupplier(Request $request, string $target, int $product)
    {
        $user = $request->user();
        $t = $this->target($request, $target);

        if ((int) $t->assignee_id !== (int) $user->id
            && $user->user_type !== 'super_admin') {
            $mine = (int) $t->created_by === (int) $user->id;

            return response()->json([
                'status' => false,
                'message' => $mine
                    ? 'You created this sourcing target — vendor mapping is done by the assignee, not the creator.'
                    : 'This sourcing target is assigned to someone else — only the assignee can map suppliers.',
            ], 403);
        }

        $p = $t->products()->where('id', $product)->first() ?? abort(404, 'Product not found in this sourcing target.');

        $request->validate([
            'supplier_id' => 'nullable',
            'new_supplier' => 'nullable|array',
            'new_supplier.name' => 'required_with:new_supplier|string|max:255',
            'new_supplier.segment' => 'nullable|string|max:512',
            'new_supplier.contact' => 'nullable|string|max:255',
            'new_supplier.mobile' => 'nullable|string|max:64',
            'new_supplier.email' => 'nullable|email|max:255',
            'new_supplier.gmaps' => 'nullable|string|max:512',
            'new_supplier.address' => 'nullable|string|max:255',
            'new_supplier.country' => 'nullable|string|max:128',
            'new_supplier.state' => 'nullable|string|max:128',
            'new_supplier.state_code' => 'nullable|string|max:16',
            'new_supplier.city' => 'nullable|string|max:128',
            'new_supplier.card' => 'nullable|string|max:512',

            'origin' => ['nullable', Rule::in(SupplierPricing::ORIGINS)],
            'price' => 'required|numeric|gt:0',
            'gst_percentage' => 'nullable|numeric|min:0|max:100',
            'gst_type' => ['nullable', Rule::in([SupplierPricing::GST_INTRA, SupplierPricing::GST_INTER])],
            'currency' => 'nullable|string|size:3|alpha',
            'exchange_rate' => 'nullable|numeric|gt:0',
            'valid_till' => 'nullable|date|after_or_equal:today',
        ], [
            'new_supplier.name.required_with' => 'Enter the supplier company name.',
            'new_supplier.email.email' => 'Enter a valid supplier email address.',
            'price.required' => "Please enter the supplier's unit price.",
            'price.gt' => 'The unit price must be more than 0.',
            'exchange_rate.gt' => 'The exchange rate must be more than 0.',
            'valid_till.after_or_equal' => 'Price Valid Till cannot be in the past.',
        ], [
            'new_supplier.name' => 'Supplier Company Name',
            'new_supplier.segment' => 'Segment',
            'new_supplier.contact' => 'Contact Person',
            'new_supplier.mobile' => 'Contact Number',
            'new_supplier.email' => 'Email',
            'new_supplier.gmaps' => 'Google Maps Link',
            'new_supplier.address' => 'Street Address',
            'new_supplier.country' => 'Country',
            'new_supplier.state' => 'State',
            'new_supplier.state_code' => 'State Code',
            'new_supplier.city' => 'City',
        ]);

        if ($request->filled('supplier_id')) {
            $v = Vendor::query()->forUser($user)
                ->with(['segment:id,name', 'addresses'])
                ->findOrFail($request->input('supplier_id'));

            if ($p->suppliers()->where('source', 'master')->where('supplier_id', $v->id)->exists()) {
                return response()->json(['status' => false, 'message' => "“{$v->company_name}” is already mapped to this product."], 422);
            }

            $addr = $v->addresses->first();
            $country = $addr && $addr->country_id ? Countries::whereKey($addr->country_id)->value('name') : null;
            $state = $addr && $addr->state_id ? States::whereKey($addr->state_id)->value('name') : null;
            $price = $this->sourcingPrice($request, $user, $country, $state, $addr->state_code ?? null);
            $p->suppliers()->create($price + [
                'supplier_id' => $v->id,
                'source' => 'master',
                'name' => $v->company_name,
                'segment' => $v->segment->name ?? null,
                'contact' => $addr->contact_name ?? null,
                'mobile' => $addr->contact_no ?? null,
                'email' => ($addr->email ?? '') ?: $v->primary_email,
                'country' => $country ?: ($price['origin'] === SupplierPricing::DOMESTIC ? 'India' : null),
                'state' => $state,
                'state_code' => $addr->state_code ?? null,
                'city' => $addr->city ?? null,
                'mapped_by' => $user->id,
            ]);
        } elseif ($request->filled('new_supplier')) {
            $n = $request->input('new_supplier');
            $name = trim($n['name'] ?? '') ?: '—';

            $origin = $request->input('origin') ?: SupplierPricing::originOf($n['country'] ?? null);
            if ($origin === SupplierPricing::INTERNATIONAL && ! SupplierPricing::isInternational($n['country'] ?? null)) {
                throw ValidationException::withMessages(['new_supplier.country' => ["Please select the supplier's country (outside India)."]]);
            }
            if ($origin === SupplierPricing::DOMESTIC && SupplierPricing::isInternational($n['country'] ?? null)) {
                throw ValidationException::withMessages(['new_supplier.country' => ['A Domestic supplier must be in India — choose International for an overseas supplier.']]);
            }
            if ($origin === SupplierPricing::DOMESTIC) {
                $n['country'] = 'India';
            }
            $price = $this->sourcingPrice($request, $user, $n['country'] ?? null, $n['state'] ?? null, $n['state_code'] ?? null);

            $fields = [
                'segment' => $n['segment'] ?? null,
                'contact' => $n['contact'] ?? null,
                'mobile' => $n['mobile'] ?? null,
                'email' => $n['email'] ?? null,
                'gmaps' => $n['gmaps'] ?? null,
                'address' => $n['address'] ?? null,
                'country' => $n['country'] ?? null,
                'state' => $n['state'] ?? null,
                'state_code' => $n['state_code'] ?? null,
                'city' => $n['city'] ?? null,
                'card_path' => $n['card'] ?? null,
            ];

            $directory = P2pSupplier::where('client_id', $user->client_id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                ->first();
            if (! $directory) {
                $directory = P2pSupplier::create($fields + [
                    'client_id' => $user->client_id,
                    'branch_id' => $user->branch_id ?? null,
                    'name' => $name,
                    'origin' => $price['origin'],
                    'created_by' => $user->id,
                ]);
            }

            if ($directory->converted_vendor_id) {
                return response()->json(['status' => false, 'message' => "“{$name}” is already in the Supplier Master — map it from Supplier Master."], 422);
            }

            if ($p->suppliers()->where('source', 'new')->where('supplier_id', $directory->id)->exists()) {
                return response()->json(['status' => false, 'message' => "“{$name}” is already mapped to this product."], 422);
            }

            $p->suppliers()->create($price + $fields + [
                'supplier_id' => $directory->id,
                'source' => 'new',
                'name' => $name,
                'mapped_by' => $user->id,
            ]);
        } else {
            return response()->json(['status' => false, 'message' => 'Provide supplier_id or new_supplier'], 422);
        }

        if ($p->status !== 'Completed') {
            $p->update(['status' => 'Completed']);
        }

        return $this->ok(['supplierCount' => $p->suppliers()->count()]);
    }

    public function updateSupplier(Request $request, string $target, int $product, int $supplier)
    {
        $user = $request->user();
        $t = $this->target($request, $target);

        if ((int) $t->assignee_id !== (int) $user->id
            && $user->user_type !== 'super_admin') {
            $mine = (int) $t->created_by === (int) $user->id;

            return response()->json([
                'status' => false,
                'message' => $mine
                    ? 'You created this sourcing target — supplier editing is done by the assignee, not the creator.'
                    : 'This sourcing target is assigned to someone else — only the assignee can edit suppliers.',
            ], 403);
        }

        $p = $t->products()->where('id', $product)->first() ?? abort(404, 'Product not found in this sourcing target.');
        $row = $p->suppliers()->where('id', $supplier)->first() ?? abort(404, 'Mapped supplier not found for this product.');

        if ($row->source !== 'new') {
            return response()->json(['status' => false, 'message' => 'Only new (manual) suppliers can be edited here. Edit master suppliers from the Supplier master.'], 422);
        }

        $request->validate([
            'new_supplier' => 'required|array',
            'new_supplier.name' => 'required|string|max:255',
            'new_supplier.segment' => 'nullable|string|max:512',
            'new_supplier.contact' => 'nullable|string|max:255',
            'new_supplier.mobile' => 'nullable|string|max:64',
            'new_supplier.email' => 'nullable|email|max:255',
            'new_supplier.gmaps' => 'nullable|string|max:512',
            'new_supplier.address' => 'nullable|string|max:255',
            'new_supplier.country' => 'nullable|string|max:128',
            'new_supplier.state' => 'nullable|string|max:128',
            'new_supplier.state_code' => 'nullable|string|max:16',
            'new_supplier.city' => 'nullable|string|max:128',
            'new_supplier.card' => 'nullable|string|max:512',

            'price' => 'sometimes|required|numeric|gt:0',
            'gst_percentage' => 'nullable|numeric|min:0|max:100',
            'gst_type' => ['nullable', Rule::in([SupplierPricing::GST_INTRA, SupplierPricing::GST_INTER])],
            'currency' => 'nullable|string|size:3|alpha',
            'exchange_rate' => 'nullable|numeric|gt:0',
            'valid_till' => 'nullable|date|after_or_equal:today',
        ], [
            'new_supplier.name.required' => 'Enter the supplier company name.',
            'new_supplier.email.email' => 'Enter a valid supplier email address.',
        ], [
            'new_supplier.name' => 'Supplier Company Name',
            'new_supplier.segment' => 'Segment',
            'new_supplier.contact' => 'Contact Person',
            'new_supplier.mobile' => 'Contact Number',
            'new_supplier.email' => 'Email',
            'new_supplier.gmaps' => 'Google Maps Link',
            'new_supplier.address' => 'Street Address',
            'new_supplier.country' => 'Country',
            'new_supplier.state' => 'State',
            'new_supplier.state_code' => 'State Code',
            'new_supplier.city' => 'City',
        ]);

        $n = $request->input('new_supplier');
        $name = trim($n['name'] ?? '') ?: '—';

        $fields = [
            'segment' => $n['segment'] ?? null,
            'contact' => $n['contact'] ?? null,
            'mobile' => $n['mobile'] ?? null,
            'email' => $n['email'] ?? null,
            'gmaps' => $n['gmaps'] ?? null,
            'address' => $n['address'] ?? null,
            'country' => $n['country'] ?? null,
            'state' => $n['state'] ?? null,
            'state_code' => $n['state_code'] ?? null,
            'city' => $n['city'] ?? null,
            'card_path' => $n['card'] ?? null,
        ];

        if (($row->origin ?? null) && $row->origin !== SupplierPricing::originOf($n['country'] ?? null)) {
            throw ValidationException::withMessages(['new_supplier.country' => [
                $row->origin === SupplierPricing::INTERNATIONAL
                    ? 'This is an International supplier — choose a country outside India.'
                    : 'This is a Domestic supplier — the country must be India.',
            ]]);
        }
        $price = [];
        if ($request->has('price')) {
            $request->merge(['origin' => $row->origin ?: SupplierPricing::originOf($n['country'] ?? null)]);
            $price = $this->sourcingPrice($request, $user, $n['country'] ?? null, $n['state'] ?? null, $n['state_code'] ?? null);
        }

        $row->update($price + $fields + ['name' => $name]);

        if ($row->supplier_id) {
            P2pSupplier::where('client_id', $user->client_id)
                ->where('id', $row->supplier_id)
                ->update($fields + ['name' => $name]);
        }

        return $this->ok(['id' => (string) $row->id]);
    }

    public function mappedSuppliers(Request $request, string $target, int $product)
    {
        $t = $this->target($request, $target);
        $p = $t->products()->where('id', $product)->first() ?? abort(404, 'Product not found in this sourcing target.');

        $target = $p->target_price !== null && $p->target_price !== '' ? (float) str_replace(',', '', (string) $p->target_price) : null;
        $converted = P2pSupplier::where('client_id', $request->user()->client_id)
            ->whereIn('id', $p->suppliers()->where('source', 'new')->pluck('supplier_id'))
            ->pluck('converted_vendor_id', 'id');

        $rows = $p->suppliers()->latest()->get()->map(fn ($s) => [
            'id' => (string) $s->id,

            'supplier_id' => $s->supplier_id,
            'name' => $s->name,
            'segment' => $s->segment ?? '',
            'contact' => $s->contact ?? '',
            'mobile' => $s->mobile ?? '',
            'email' => $s->email ?? '',
            'card' => $s->card_path ?? '',

            'gmaps' => $s->gmaps ?? '',
            'address' => $s->address ?? '',
            'country' => $s->country ?? '',
            'state' => $s->state ?? '',
            'state_code' => $s->state_code ?? '',
            'city' => $s->city ?? '',
            'source' => $s->source === 'new' ? 'New Supplier' : 'Master',

            'origin' => $s->origin,
            'currency' => $s->currency_code,
            'price' => $s->price !== null ? (float) $s->price : null,
            'gstPercentage' => $s->gst_percentage !== null ? (float) $s->gst_percentage : null,
            'gstType' => $s->gst_type,
            'cgst' => $s->cgst_amount !== null ? (float) $s->cgst_amount : null,
            'sgst' => $s->sgst_amount !== null ? (float) $s->sgst_amount : null,
            'igst' => $s->igst_amount !== null ? (float) $s->igst_amount : null,
            'gstAmount' => $s->gst_amount !== null ? (float) $s->gst_amount : null,
            'total' => $s->total_amount !== null ? (float) $s->total_amount : null,
            'exchangeRate' => $s->exchange_rate !== null ? (float) $s->exchange_rate : null,
            'inrAmount' => $s->inr_amount !== null ? (float) $s->inr_amount : null,
            'validTill' => optional($s->price_valid_till)->format('Y-m-d'),

            'vsTarget' => $s->price === null ? null : SupplierPricing::vsTarget(
                $s->origin === SupplierPricing::INTERNATIONAL ? (float) $s->inr_amount : (float) $s->price, $target),
            'mappedOn' => optional($s->created_at)->toIso8601String(),

            'canConvert' => $s->source === 'new' && empty($converted[$s->supplier_id]),
        ]);

        return $this->ok($rows);
    }

    private function sourcingPrice(Request $request, $user, ?string $country, ?string $state, ?string $stateCode): array
    {
        $origin = $request->input('origin') ?: SupplierPricing::originOf($country);
        if ($origin !== SupplierPricing::originOf($country)) {
            throw ValidationException::withMessages(['origin' => [
                $origin === SupplierPricing::INTERNATIONAL
                    ? 'This supplier is based in India — map it as a Domestic supplier.'
                    : 'This supplier is based in '.($country ?: 'another country').' — map it as an International supplier.',
            ]]);
        }

        if ($origin === SupplierPricing::INTERNATIONAL) {
            $currency = strtoupper((string) $request->input('currency')) ?: SupplierPricing::currencyFor($country);
            if ($currency === 'INR') {
                throw ValidationException::withMessages(['currency' => ["Pick the supplier's currency — an International price is not in ₹."]]);
            }
            $rate = (float) $request->input('exchange_rate') ?: SupplierPricing::defaultRate($currency, $user);
            if (! $rate) {
                throw ValidationException::withMessages(['exchange_rate' => ["Please enter the exchange rate (₹ per {$currency})."]]);
            }
            $price = SupplierPricing::international((float) $request->input('price'), $currency, $rate);
        } else {
            $home = $this->homeState($user);
            $type = $request->input('gst_type')
                ?: SupplierPricing::gstTypeFor($state, $stateCode, $home['state'], $home['stateCode']);
            $gst = $request->filled('gst_percentage') ? (float) $request->input('gst_percentage') : 18.0;
            $price = SupplierPricing::domestic((float) $request->input('price'), $gst, $type);
        }

        return $price + ['price_valid_till' => $request->input('valid_till') ?: null];
    }

    public function convertPrefill(Request $request, int $supplier)
    {
        $user = $request->user();
        $s = P2pSupplier::where('client_id', $user->client_id)->findOrFail($supplier);
        $scope = fn ($q) => MasterVisibility::applyReadScope($q, $user);

        $countryId = $s->country ? Countries::query()->tap($scope)->whereRaw('LOWER(name) = ?', [mb_strtolower($s->country)])->value('id') : null;
        $stateId = $s->state ? States::query()->tap($scope)
            ->when($countryId, fn ($q) => $q->where('country_id', $countryId))
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($s->state)])->value('id') : null;
        $segmentId = $s->segment ? Segments::query()->tap($scope)->whereRaw('LOWER(name) = ?', [mb_strtolower($s->segment)])->value('id') : null;
        $origin = $s->origin ?: SupplierPricing::originOf($s->country);

        return $this->ok([
            'supplier_id' => $s->id,
            'origin' => $origin,
            'converted' => (bool) $s->converted_vendor_id,
            'converted_vendor_id' => $s->converted_vendor_id,
            'sourcing_count' => SourcingProductSupplier::where('source', 'new')->where('supplier_id', $s->id)->count(),

            'identity' => [
                'company_name' => $s->name,
                'legal_name' => $s->name,
                'primary_email' => $s->email,
                'segment_id' => $segmentId,
                'segment' => $s->segment,
                'gst_applicable' => $origin === SupplierPricing::INTERNATIONAL ? 'No' : null,
            ],

            'address' => [
                'address_line' => $s->address,
                'country_id' => $countryId,
                'country' => $s->country,
                'state_id' => $stateId,
                'state' => $s->state,
                'state_code' => $s->state_code,
                'city' => $s->city,
                'google_location' => $s->gmaps,
                'contact_name' => $s->contact,
                'contact_no' => $s->mobile,
                'email' => $s->email,
                'is_primary' => true,
            ],
            'business_card' => $s->card_path,
        ]);
    }

    public function convertSupplier(Request $request, int $supplier)
    {
        $user = $request->user();
        $s = P2pSupplier::where('client_id', $user->client_id)->findOrFail($supplier);
        $data = $request->validate(['vendor_id' => 'required|integer'], ['vendor_id.required' => 'Save the supplier in the Supplier Master first.']);

        $vendor = Vendor::query()->forUser($user)->find($data['vendor_id']);
        if (! $vendor) {
            throw ValidationException::withMessages(['vendor_id' => ['Unknown supplier in the Supplier Master.']]);
        }
        if ($s->converted_vendor_id && (int) $s->converted_vendor_id !== (int) $vendor->id) {
            return response()->json(['status' => false, 'message' => "“{$s->name}” is already converted to another supplier in the Supplier Master."], 422);
        }

        $moved = 0;
        $merged = 0;
        DB::transaction(function () use ($s, $vendor, $user, &$moved, &$merged) {
            $rows = SourcingProductSupplier::where('source', 'new')->where('supplier_id', $s->id)->get();
            foreach ($rows as $row) {
                $dup = SourcingProductSupplier::where('sourcing_product_id', $row->sourcing_product_id)
                    ->where('source', 'master')->where('supplier_id', $vendor->id)->exists();
                if ($dup) {
                    $row->delete();
                    $merged++;

                    continue;
                }
                $row->update(['source' => 'master', 'supplier_id' => $vendor->id, 'name' => $vendor->company_name]);
                $moved++;
            }
            $s->update(['converted_vendor_id' => $vendor->id, 'converted_at' => now(), 'converted_by' => $user->id]);
        });

        return $this->ok([
            'supplier_id' => $s->id,
            'vendor_id' => $vendor->id,
            'vendor_code' => $vendor->vendor_code,
            'vendor_name' => $vendor->company_name,
            'mappings_moved' => $moved,
            'mappings_merged' => $merged,
            'message' => "{$s->name} is now in the Supplier Master as {$vendor->vendor_code}.",
        ]);
    }

    private function validatePayload(Request $request, bool $creating = false): array
    {
        return $request->validate([
            'due_date' => ['required', 'date', ...($creating ? ['after_or_equal:today'] : [])],
            'source' => 'required|in:master,manual',
            'assignee_id' => 'required',
            'products' => 'required|array|min:1',
            'products.*.id' => 'nullable|integer',
            'products.*.from' => 'required|in:master,manual',

            'products.*.code' => 'nullable|required_if:products.*.from,master|string|max:64',

            'products.*.name' => 'nullable|required_if:products.*.from,manual|string|max:255',
            'products.*.target_price' => ['nullable', 'required_if:products.*.from,manual', 'regex:/^\d[\d,]*(\.\d{1,2})?$/', 'max:64'],
            'products.*.clarity' => 'nullable|array',
            'products.*.clarity.type' => 'nullable|in:text,link,pdf',
            'products.*.clarity.val' => 'nullable|string',
        ], [
            'assignee_id.required' => 'Assign this sourcing target to a team member before saving.',
            'due_date.required' => 'Pick the Sourcing TAT (target completion date).',
            'due_date.after_or_equal' => 'The Sourcing TAT cannot be in the past.',
            'products.required' => 'Add at least one product to the Product List.',
            'products.*.code.required_if' => 'Pick a product from the Product Master.',
            'products.*.name.required_if' => 'Enter the product name.',
            'products.*.target_price.required_if' => 'Enter the target price.',
            'products.*.target_price.regex' => 'The target price must be a number (up to 2 decimals).',
        ]);
    }

    private function resolveAssignee($clientId, $assigneeId): array
    {
        if (! $assigneeId) {
            return ['id' => null, 'name' => null];
        }
        $u = User::where('client_id', $clientId)->find($assigneeId);

        return ['id' => $u?->id, 'name' => $u?->name];
    }

    private function productDisplayResolver($products): \Closure
    {
        $ids = collect($products)
            ->filter(fn ($p) => $p->source === 'master')
            ->pluck('product_id')->filter()->unique()->values();
        $map = $ids->isNotEmpty()
            ? Product::whereIn('id', $ids)->with(['segment:id,name', 'hsn:id,hsn_code'])->get()->keyBy('id')
            : collect();

        return function ($p) use ($map) {
            $live = ($p->source === 'master' && $p->product_id) ? $map->get($p->product_id) : null;

            return [
                'name' => $live->name ?? $p->name,
                'segment' => $live->segment->name ?? $p->segment,
                'hsn' => $live->hsn->hsn_code ?? $p->hsn,
            ];
        };
    }

    private function assigneeIsActive($clientId, $assigneeUserId): bool
    {
        if (! $assigneeUserId) {
            return false;
        }

        $userActive = User::where('id', $assigneeUserId)
            ->whereRaw('LOWER(status) = ?', ['active'])->exists();
        if (! $userActive) {
            return false;
        }

        $emp = Employee::where('client_id', $clientId)
            ->where('user_id', $assigneeUserId)->first();
        if (! $emp) {
            return true;
        }

        return strtolower((string) $emp->status) === 'active';
    }

    private function syncProducts(SourcingTarget $target, $clientId, array $products): void
    {
        foreach ($products as $p) {
            $from = $p['from'] ?? 'manual';
            $clarity = $p['clarity'] ?? null;
            $row = [
                'source' => $from,
                'target_price' => $p['target_price'] ?? null,
                'clarity_type' => $clarity['type'] ?? null,
                'clarity_value' => $clarity['val'] ?? ($clarity['value'] ?? null),
                'status' => 'In Progress',
            ];

            if ($from === 'master') {
                $code = $p['code'] ?? '';

                $byBranch = fn () => Product::where('client_id', $clientId)
                    ->with(['segment:id,name', 'hsn:id,hsn_code'])
                    ->where('product_code', $code);
                $prod = $target->branch_id
                    ? (clone $byBranch())->where('branch_id', $target->branch_id)->first()
                    : null;
                if (! $prod) {
                    $prod = $byBranch()->first();
                }

                if (! $prod && $code !== '') {
                    $padded = Product::where('client_id', $clientId)
                        ->when($target->branch_id, fn ($q) => $q->where('branch_id', $target->branch_id))
                        ->with(['segment:id,name', 'hsn:id,hsn_code'])
                        ->get()
                        ->first(fn ($x) => $this->padCode($x->product_code) === $code);
                    $prod = $padded ?: Product::where('client_id', $clientId)
                        ->with(['segment:id,name', 'hsn:id,hsn_code'])
                        ->get()
                        ->first(fn ($x) => $this->padCode($x->product_code) === $code);
                }

                $row += [
                    'product_id' => $prod->id ?? null,
                    'code' => $p['code'] ?? ($prod->product_code ?? null),
                    'name' => $prod->name ?? ($p['name'] ?? ($p['code'] ?? '—')),
                    'segment' => $prod->segment->name ?? null,
                    'hsn' => $prod->hsn->hsn_code ?? null,
                ];
            } else {
                $row += [
                    'product_id' => null,
                    'code' => null,
                    'name' => $p['name'] ?? '—',
                    'segment' => null,
                    'hsn' => null,
                ];
            }

            $target->products()->create($row);
        }
    }
}
