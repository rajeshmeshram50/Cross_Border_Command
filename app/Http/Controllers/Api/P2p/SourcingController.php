<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\P2p\SourcingProduct;
use App\Models\P2p\SourcingProductSupplier;
use App\Models\P2p\SourcingTarget;
use App\Models\Masters\Segments;
use App\Models\Product;
use App\Models\User;
use App\Models\Vendor;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Procure to Pay (P2P) · Procurement Management → Bulk Sourcing.
 *
 * Backs the whole Bulk Sourcing screen (list + Assign/Edit wizard + Sourcing
 * Report + Map/Mapped suppliers). The contract these methods satisfy lives in
 * resources/js/pages/p2p/procurement-management/bulk-sourcing/API.md.
 *
 * Multi-tenant: every query is scoped by the authenticated user's client_id;
 * the public identifier of a target is its per-client `code` (SRC-001), never
 * the numeric id, so all {target} route params are codes.
 */
class SourcingController extends Controller
{
    /* ── helpers ─────────────────────────────────────────────────────────── */

    private function ok($data)
    {
        return response()->json(['status' => true, 'data' => $data]);
    }

    /** Resolve a target by its per-client code or fail (tenant-scoped). */
    private function target(Request $request, string $code): SourcingTarget
    {
        return SourcingTarget::where('client_id', $request->user()->client_id)
            ->where('code', $code)
            ->firstOrFail();
    }

    private function sourceLabel(?string $s): string
    {
        return $s === 'manual' ? 'Manual Entry' : 'Product Master';
    }

    /** Shape one target into the list/report header row the SPA expects. */
    private function row(SourcingTarget $t): array
    {
        $total = $t->products->count();
        $done  = $t->products->where('status', 'Completed')->count();

        return [
            'id'        => $t->code,
            'source'    => $this->sourceLabel($t->source),
            'start'     => optional($t->start_date)->format('Y-m-d') ?? '',
            'due'       => optional($t->due_date)->format('Y-m-d') ?? '',
            'createdBy' => $t->created_by_name ?: '—',
            'assignee'  => $t->assignee_name ?: '—',
            'products'  => $total,
            'completed' => $done,
        ];
    }

    /* ── 1. list ─────────────────────────────────────────────────────────── */
    // GET /p2p/sourcing-targets → { assigned, created }
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->client_id) return $this->ok(['assigned' => [], 'created' => []]);

        $targets = SourcingTarget::where('client_id', $user->client_id)
            ->with('products:id,sourcing_target_id,status')
            ->latest()
            ->get();

        return $this->ok([
            'assigned' => $targets->filter(fn ($t) => (int) $t->assignee_id === (int) $user->id)
                ->map(fn ($t) => $this->row($t))->values(),
            'created'  => $targets->filter(fn ($t) => (int) $t->created_by === (int) $user->id)
                ->map(fn ($t) => $this->row($t))->values(),
        ]);
    }

    /* ── 2. product master ───────────────────────────────────────────────── */
    // GET /p2p/products
    public function products(Request $request)
    {
        $user = $request->user();
        $rows = Product::where('client_id', $user->client_id)
            ->with(['segment:id,name', 'hsn:id,hsn_code'])
            ->orderBy('name')
            ->get()
            ->map(fn ($p) => [
                'code'    => $p->product_code,
                'name'    => $p->name,
                'segment' => $p->segment->name ?? '',
                'hsn'     => $p->hsn->hsn_code ?? '',
            ]);

        return $this->ok($rows);
    }

    /* ── 3. team members (logged-in user's branch only) ──────────────────── */
    // GET /p2p/team-members — people in the current user's branch. Branch users
    // are pinned to their own branch_id; client admins (no branch_id) get the
    // active branch the SPA injects as ?branch_id.
    public function teamMembers(Request $request)
    {
        $user   = $request->user();
        $branch = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);

        $rows = User::where('client_id', $user->client_id)
            ->when($branch, fn ($q) => $q->where('branch_id', $branch))
            ->where('user_type', '!=', 'super_admin')
            ->orderBy('name')
            ->get(['id', 'name', 'user_type', 'designation'])
            ->map(fn ($u) => [
                'id'   => (string) $u->id,
                'name' => $u->name,
                'role' => $u->designation ?: ucwords(str_replace('_', ' ', (string) $u->user_type)),
            ]);

        return $this->ok($rows);
    }

    /* ── next code preview ───────────────────────────────────────────────── */
    // GET /p2p/sourcing-targets/next-code — shows the ID the next create will get
    // (the real code is still allocated under a row lock at store() time).
    public function nextCode(Request $request)
    {
        $user = $request->user();
        $seq  = SourcingTarget::withTrashed()->where('client_id', $user->client_id)->count() + 1;
        return $this->ok(['code' => sprintf('SRC-%03d', $seq)]);
    }

    /* ── 4 & 6. create / update ──────────────────────────────────────────── */
    // POST /p2p/sourcing-targets
    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $this->validatePayload($request);

        $target = DB::transaction(function () use ($user, $data) {
            // Per-client sequential code under a row lock (same as Quotation/PI/CTC).
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $seq  = SourcingTarget::withTrashed()->where('client_id', $user->client_id)->count() + 1;
            $code = sprintf('SRC-%03d', $seq);

            $assignee = $this->resolveAssignee($user->client_id, $data['assignee_id'] ?? null);

            $target = SourcingTarget::create([
                'client_id'       => $user->client_id,
                'branch_id'       => $user->branch_id ?? null,
                'code'            => $code,
                'source'          => $data['source'],
                'start_date'      => now()->toDateString(),
                'due_date'        => $data['due_date'] ?? null,
                'assignee_id'     => $assignee['id'],
                'assignee_name'   => $assignee['name'],
                'created_by'      => $user->id,
                'created_by_name' => $user->name ?? null,
                'status'          => 'In Progress',
            ]);

            $this->syncProducts($target, $user->client_id, $data['products']);

            return $target;
        });

        return $this->ok(['id' => $target->code]);
    }

    // PUT /p2p/sourcing-targets/{target}
    public function update(Request $request, string $target)
    {
        $user = $request->user();
        $t    = $this->target($request, $target);
        $data = $this->validatePayload($request);

        DB::transaction(function () use ($t, $user, $data) {
            $assignee = $this->resolveAssignee($user->client_id, $data['assignee_id'] ?? null);

            $t->update([
                'source'        => $data['source'],
                'due_date'      => $data['due_date'] ?? null,
                'assignee_id'   => $assignee['id'],
                'assignee_name' => $assignee['name'],
            ]);

            // Replace the product list wholesale (suppliers cascade on delete).
            $t->products()->each(fn ($p) => $p->suppliers()->delete());
            $t->products()->delete();
            $this->syncProducts($t, $user->client_id, $data['products']);
        });

        return $this->ok(['id' => $t->code]);
    }

    /* ── 5. edit pre-fill ────────────────────────────────────────────────── */
    // GET /p2p/sourcing-targets/{target}
    public function show(Request $request, string $target)
    {
        $t = $this->target($request, $target);
        $t->load('products');

        $clarity = fn ($p) => $p->clarity_type
            ? ['type' => $p->clarity_type, 'val' => $p->clarity_value]
            : null;

        $master = $t->products->where('source', 'master')->values()->map(fn ($p) => [
            'code'    => $p->code,
            'name'    => $p->name,
            'segment' => $p->segment,
            'hsn'     => $p->hsn,
            'price'   => $p->target_price ?? '',
            'clarity' => $clarity($p),
        ]);

        $manual = $t->products->where('source', 'manual')->values()->map(fn ($p) => [
            'name'    => $p->name,
            'price'   => $p->target_price ?? '',
            'clarity' => $clarity($p),
        ]);

        return $this->ok([
            'id'         => $t->code,
            'source'     => $this->sourceLabel($t->source),
            'start'      => optional($t->start_date)->format('Y-m-d') ?? '',
            'due'        => optional($t->due_date)->format('Y-m-d') ?? '',
            'assignee'   => $t->assignee_name ?: '',
            'masterRows' => $master,
            'manualRows' => $manual,
        ]);
    }

    /* ── 7. report ───────────────────────────────────────────────────────── */
    // GET /p2p/sourcing-targets/{target}/report
    public function report(Request $request, string $target)
    {
        $t = $this->target($request, $target);
        $t->load(['products' => fn ($q) => $q->withCount('suppliers')]);

        $products = $t->products->map(fn ($p) => [
            'id'            => $p->id,
            'type'          => $p->source,
            'code'          => $p->code ?? '',
            'name'          => $p->name,
            'segment'       => $p->segment ?? '',
            'hsn'           => $p->hsn ?? '',
            'price'         => $p->target_price ?? '',
            'status'        => $p->status,
            'supplierCount' => $p->suppliers_count,
        ])->values();

        return $this->ok([
            'id'        => $t->code,
            'source'    => $this->sourceLabel($t->source),
            'start'     => optional($t->start_date)->format('Y-m-d') ?? '',
            'due'       => optional($t->due_date)->format('Y-m-d') ?? '',
            'createdBy' => $t->created_by_name ?: '—',
            'assignee'  => $t->assignee_name ?: '—',
            'products'  => $products,
        ]);
    }

    /* ── 8. toggle product status ────────────────────────────────────────── */
    // PATCH /p2p/sourcing-targets/{target}/products/{product}/status
    public function setProductStatus(Request $request, string $target, int $product)
    {
        $t = $this->target($request, $target);
        $data = $request->validate(['status' => 'required|in:Completed,In Progress']);

        $p = $t->products()->where('id', $product)->firstOrFail();
        $p->update(['status' => $data['status']]);

        return $this->ok([
            'id'     => $p->id,
            'status' => $p->status,
        ]);
    }

    /* ── 9. supplier master ──────────────────────────────────────────────── */
    // GET /p2p/suppliers
    public function suppliers(Request $request)
    {
        $user = $request->user();
        $rows = Vendor::where('client_id', $user->client_id)
            ->with('segment:id,name')
            ->orderBy('company_name')
            ->get()
            ->map(fn ($v) => [
                'id'      => (string) $v->id,
                'name'    => $v->company_name,
                'segment' => $v->segment->name ?? '',
                'contact' => '',
                'mobile'  => '',
                'email'   => $v->primary_email ?? '',
            ]);

        return $this->ok($rows);
    }

    /* ── 10. map a supplier to a product ─────────────────────────────────── */
    // POST /p2p/sourcing-targets/{target}/products/{product}/suppliers
    public function mapSupplier(Request $request, string $target, int $product)
    {
        $user = $request->user();
        $t    = $this->target($request, $target);
        $p    = $t->products()->where('id', $product)->firstOrFail();

        $request->validate([
            'supplier_id'        => 'nullable',
            'new_supplier'       => 'nullable|array',
            'new_supplier.name'  => 'required_with:new_supplier|string|max:255',
            'new_supplier.email' => 'nullable|email',
        ], [
            'new_supplier.name.required_with' => 'Enter the supplier company name.',
            'new_supplier.email.email'        => 'Enter a valid supplier email address.',
        ]);

        if ($request->filled('supplier_id')) {
            $v = Vendor::where('client_id', $user->client_id)
                ->with('segment:id,name')
                ->findOrFail($request->input('supplier_id'));

            // A product can't have the same vendor mapped twice.
            if ($p->suppliers()->where('supplier_id', $v->id)->exists()) {
                return response()->json(['status' => false, 'message' => "“{$v->company_name}” is already mapped to this product."], 422);
            }

            $p->suppliers()->create([
                'supplier_id' => $v->id,
                'source'      => 'master',
                'name'        => $v->company_name,
                'segment'     => $v->segment->name ?? null,
                'email'       => $v->primary_email,
            ]);
        } elseif ($request->filled('new_supplier')) {
            $n    = $request->input('new_supplier');
            $name = trim($n['name'] ?? '') ?: '—';

            // Also register the supplier in the Vendor master so it's reusable
            // in the Supplier Master dropdown next time. Reuse an existing
            // vendor with the same name (case-insensitive) to avoid duplicates.
            $vendorId = $this->upsertVendor($user, $name, $n['email'] ?? null, $n['segment'] ?? null);

            // Same vendor (by name → same master id) can't be mapped twice.
            if ($p->suppliers()->where('supplier_id', $vendorId)->exists()) {
                return response()->json(['status' => false, 'message' => "“{$name}” is already mapped to this product."], 422);
            }

            $p->suppliers()->create([
                'supplier_id' => $vendorId,
                'source'      => 'new',
                'name'        => $name,
                'segment'     => $n['segment'] ?? null,
                'contact'     => $n['contact'] ?? null,
                'mobile'      => $n['mobile'] ?? null,
                'email'       => $n['email'] ?? null,
                'gmaps'       => $n['gmaps'] ?? null,
                'address'     => $n['address'] ?? null,
                'country'     => $n['country'] ?? null,
                'state'       => $n['state'] ?? null,
                'state_code'  => $n['state_code'] ?? null,
                'city'        => $n['city'] ?? null,
            ]);
        } else {
            return response()->json(['status' => false, 'message' => 'Provide supplier_id or new_supplier'], 422);
        }

        // A product with at least one supplier counts as sourced.
        if ($p->status !== 'Completed') $p->update(['status' => 'Completed']);

        return $this->ok(['supplierCount' => $p->suppliers()->count()]);
    }

    /* ── 11. mapped suppliers for a product ──────────────────────────────── */
    // GET /p2p/sourcing-targets/{target}/products/{product}/suppliers
    public function mappedSuppliers(Request $request, string $target, int $product)
    {
        $t = $this->target($request, $target);
        $p = $t->products()->where('id', $product)->firstOrFail();

        $rows = $p->suppliers()->latest()->get()->map(fn ($s) => [
            'id'      => (string) $s->id,
            'name'    => $s->name,
            'segment' => $s->segment ?? '',
            'contact' => $s->contact ?? '',
            'mobile'  => $s->mobile ?? '',
            'email'   => $s->email ?? '',
            'source'  => $s->source === 'new' ? 'New Supplier' : 'Master',
        ]);

        return $this->ok($rows);
    }

    /* ── shared write helpers ────────────────────────────────────────────── */

    private function validatePayload(Request $request): array
    {
        return $request->validate([
            'due_date'                => 'nullable|date',
            'source'                  => 'required|in:master,manual',
            'assignee_id'             => 'required',                 // must be assigned to someone
            'products'                => 'required|array|min:1',
            'products.*.from'         => 'required|in:master,manual',
            'products.*.code'         => 'nullable|string|max:64',
            'products.*.name'         => 'nullable|string|max:255',
            'products.*.target_price' => 'nullable|string|max:64',
            'products.*.clarity'      => 'nullable|array',
        ], [
            'assignee_id.required'    => 'Assign this sourcing target to a team member before saving.',
        ]);
    }

    /**
     * Find-or-create a Vendor master record for an inline "New Supplier" so it
     * becomes reusable in the Supplier Master list. Dedupes on company name
     * (case-insensitive) per client. Vendor codes are V-01, V-02 … (max+1),
     * allocated under a clients row lock (same convention as VendorController).
     */
    private function upsertVendor($user, string $name, ?string $email, ?string $segmentName): int
    {
        return DB::transaction(function () use ($user, $name, $email, $segmentName) {
            $existing = Vendor::where('client_id', $user->client_id)
                ->whereRaw('LOWER(company_name) = ?', [mb_strtolower($name)])
                ->first();
            if ($existing) return (int) $existing->id;

            $segmentId = null;
            if ($segmentName) {
                $segmentId = Segments::where('client_id', $user->client_id)
                    ->whereRaw('LOWER(name) = ?', [mb_strtolower(trim($segmentName))])
                    ->value('id');
            }

            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $codes = Vendor::withTrashed()->where('client_id', $user->client_id)->pluck('vendor_code');
            $max = 0;
            foreach ($codes as $c) {
                if ($c && preg_match('/(\d+)$/', (string) $c, $m)) $max = max($max, (int) $m[1]);
            }
            $code = 'V-' . str_pad((string) ($max + 1), 2, '0', STR_PAD_LEFT);

            $vendor = Vendor::create([
                'client_id'      => $user->client_id,
                'branch_id'      => $user->branch_id ?? null,
                'created_by'     => $user->id,
                'vendor_code'    => $code,
                'company_name'   => $name,
                'segment_id'     => $segmentId,
                'primary_email'  => $email ?: null,
                'status'         => 'Active',
                'step_completed' => 1,
            ]);

            return (int) $vendor->id;
        });
    }

    /** Resolve an assignee id to {id, name} within the client, or nulls. */
    private function resolveAssignee($clientId, $assigneeId): array
    {
        if (!$assigneeId) return ['id' => null, 'name' => null];
        $u = User::where('client_id', $clientId)->find($assigneeId);
        return ['id' => $u?->id, 'name' => $u?->name];
    }

    /** Create sourcing_products from the request payload (master rows resolve
     *  their name/segment/hsn from the Product Master by code). */
    private function syncProducts(SourcingTarget $target, $clientId, array $products): void
    {
        foreach ($products as $p) {
            $from    = $p['from'] ?? 'manual';
            $clarity = $p['clarity'] ?? null;
            $row = [
                'source'        => $from,
                'target_price'  => $p['target_price'] ?? null,
                'clarity_type'  => $clarity['type'] ?? null,
                'clarity_value' => $clarity['val'] ?? ($clarity['value'] ?? null),
                'status'        => 'In Progress',
            ];

            if ($from === 'master') {
                $prod = Product::where('client_id', $clientId)
                    ->with(['segment:id,name', 'hsn:id,hsn_code'])
                    ->where('product_code', $p['code'] ?? '')
                    ->first();

                $row += [
                    'product_id' => $prod->id ?? null,
                    'code'       => $p['code'] ?? ($prod->product_code ?? null),
                    'name'       => $prod->name ?? ($p['name'] ?? ($p['code'] ?? '—')),
                    'segment'    => $prod->segment->name ?? null,
                    'hsn'        => $prod->hsn->hsn_code ?? null,
                ];
            } else {
                $row += [
                    'product_id' => null,
                    'code'       => null,
                    'name'       => $p['name'] ?? '—',
                    'segment'    => null,
                    'hsn'        => null,
                ];
            }

            $target->products()->create($row);
        }
    }
}
