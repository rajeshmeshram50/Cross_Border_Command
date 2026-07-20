<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\P2p\SourcingProduct;
use App\Models\P2p\SourcingProductSupplier;
use App\Models\P2p\SourcingTarget;
use App\Models\Masters\Countries;
use App\Models\Masters\Segments;
use App\Models\P2p\Supplier as P2pSupplier;
use App\Models\Masters\StateCodes;
use App\Models\Masters\States;
use App\Models\Product;
use App\Models\User;
use App\Models\Vendor;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;


class SourcingController extends Controller
{


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

    /** Normalise a product code's trailing number to 3 digits for display,
     *  e.g. "P-02" → "P-002", so bulk sourcing shows the same width as the
     *  supplier codes (S-003). Codes already 3+ digits and values without a
     *  trailing number are returned untouched. */
    private function padCode(?string $code): ?string
    {
        if (!$code) return $code;
        return preg_replace_callback(
            '/(\d+)$/',
            fn($m) => str_pad($m[1], 3, '0', STR_PAD_LEFT),
            $code,
        );
    }


    private function row(SourcingTarget $t): array
    {
        $total = $t->products->count();
        $done  = $t->products->where('status', 'Completed')->count();

        // A target's actual source mix comes from its products, not just the
        // `source` chosen at creation — it can hold BOTH master and manual rows.
        // Surface every source present so the list can render 1 or 2 badges.
        $present = $t->products->pluck('source')->filter()->unique();
        $sources = [];
        if ($present->contains('master')) $sources[] = 'Product Master';
        if ($present->contains('manual')) $sources[] = 'Manual Entry';
        if (empty($sources)) $sources[] = $this->sourceLabel($t->source);

        return [
            'id'        => $t->code,
            'source'    => $this->sourceLabel($t->source),
            'sources'   => $sources,
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
            ->with('products:id,sourcing_target_id,status,source')
            ->latest()
            ->get();

        return $this->ok([
            'assigned' => $targets->filter(fn($t) => (int) $t->assignee_id === (int) $user->id)
                ->map(fn($t) => $this->row($t))->values(),
            'created'  => $targets->filter(fn($t) => (int) $t->created_by === (int) $user->id)
                ->map(fn($t) => $this->row($t))->values(),
        ]);
    }

    /* ── 2. product master ───────────────────────────────────────────────── */
    // GET /p2p/products
    public function products(Request $request)
    {
        $user = $request->user();
        // Branch-scope the picker: a branch user sees only their own branch's
        // products; the active branch from the switcher (?branch_id) is the
        // fallback for tenant-wide users. Mirrors teamMembers().
        $branch = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);
        $rows = Product::where('client_id', $user->client_id)
            ->when($branch, fn($q) => $q->where('branch_id', $branch))
            ->with(['segment:id,name', 'hsn:id,hsn_code'])
            // Order by the product-code SERIES (numeric part) so the picker lists
            // P-1, P-2 … P-10 in order rather than lexicographically or by name.
            ->orderByRaw("NULLIF(regexp_replace(product_code, '[^0-9]', '', 'g'), '')::int ASC NULLS LAST")
            ->orderBy('product_code')
            ->get()
            ->map(fn($p) => [
                'code'    => $this->padCode($p->product_code),
                'name'    => $p->name,
                'segment' => $p->segment->name ?? '',
                'hsn'     => $p->hsn->hsn_code ?? '',
            ]);

        return $this->ok($rows);
    }


    public function teamMembers(Request $request)
    {
        $user   = $request->user();
        $branch = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);

        // Only Sales & Purchase department staff can be assigned a sourcing
        // target — procurement is their remit. Department lives on the EMPLOYEE
        // record (employees.department_id → master_departments), NOT on the user,
        // so resolve the eligible user ids through employees. master_departments
        // is global (client_id null), matched by name so it holds across tenants.
        $deptIds = \Illuminate\Support\Facades\DB::table('master_departments')
            ->whereRaw('LOWER(name) LIKE ? OR LOWER(name) LIKE ?', ['%sales%', '%purchase%'])
            ->pluck('id');

        $eligibleUserIds = \App\Models\Employee::where('client_id', $user->client_id)
            ->whereIn('department_id', $deptIds)
            // Only ACTIVE employees are assignable — Inactive and Exited staff
            // (the exit flow flips employees.status to those) must not appear.
            ->whereRaw('LOWER(status) = ?', ['active'])
            ->whereNotNull('user_id')
            ->pluck('user_id');

        $rows = User::where('client_id', $user->client_id)
            ->whereIn('id', $eligibleUserIds)
            // Belt-and-braces: also drop any deactivated login (exit flips the
            // linked user's status to 'inactive').
            ->whereRaw('LOWER(status) = ?', ['active'])
            ->when($branch, fn($q) => $q->where('branch_id', $branch))
            ->where('user_type', '!=', 'super_admin')
            ->orderBy('name')
            ->get(['id', 'name', 'user_type', 'designation'])
            ->map(fn($u) => [
                'id'   => (string) $u->id,
                'name' => $u->name,
                'role' => $u->designation ?: ucwords(str_replace('_', ' ', (string) $u->user_type)),
            ]);

        return $this->ok($rows);
    }

    public function formMasters(Request $request)
    {
        $user   = $request->user();
        $scope  = fn($q) => \App\Support\MasterVisibility::applyReadScope($q, $user);
        $active = fn($q) => $q->whereRaw('LOWER(status) = ?', ['active']);

        return $this->ok([
            'segments'   => Segments::query()->tap($scope)->tap($active)->orderBy('name')->get(['id', 'name']),
            'countries'  => Countries::query()->tap($scope)->tap($active)->orderBy('name')->get(['id', 'name']),
            'states'     => States::query()->tap($scope)->tap($active)->orderBy('name')->get(['id', 'country_id', 'name']),
            'stateCodes' => StateCodes::query()->tap($scope)->tap($active)->get(['id', 'state_id', 'state_code']),
        ]);
    }


    public function upload(Request $request)
    {
        // NOTE: validate the file's actual extension, not the content-sniffed
        // MIME type. Laravel's `mimes:` rule sniffs the bytes with finfo, and on
        // some XAMPP/Windows setups a perfectly valid PDF sniffs as
        // application/octet-stream → false "must be a file of type pdf…" 422s.
        // Files here are download-only + auth-gated, so trusting the extension
        // (with a size cap) is safe and lets every real PDF through.
        $request->validate([
            'file' => 'required|file|max:5120',
            'kind' => 'nullable|in:clarity,card',
        ]);

        $allowed = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];
        $ext     = strtolower($request->file('file')->getClientOriginalExtension());
        if (!in_array($ext, $allowed, true)) {
            return response()->json([
                'message' => 'The file must be a PDF, JPG, PNG, or WEBP.',
                'errors'  => ['file' => ['The file must be a PDF, JPG, PNG, or WEBP.']],
            ], 422);
        }

        $dir  = 'p2p/' . ($request->input('kind') === 'card' ? 'supplier-cards' : 'clarity');
        $path = $request->file('file')->store($dir, 'public');

        return $this->ok([
            'path' => '/storage/' . $path,
            'name' => $request->file('file')->getClientOriginalName(),
        ]);
    }

    /* Stream ONE clarity file for download. The path is passed as a query
     * parameter (?path=…) — not as a URL segment — so a multi-PDF value can
     * never smear several storage paths into one request URL. Auth-gated and
     * locked to the p2p/clarity folder to block directory traversal. */
    // GET /p2p/clarity/download?path=/storage/p2p/clarity/xxxx.pdf
    public function downloadClarity(Request $request)
    {
        $data = $request->validate(['path' => 'required|string']);

        // Normalise to a disk-relative path: strip a leading /storage/ and slashes.
        $rel = ltrim(str_replace('\\', '/', $data['path']), '/');
        $rel = preg_replace('#^storage/#', '', $rel);

        if (str_contains($rel, '..') || !str_starts_with($rel, 'p2p/clarity/')) {
            abort(404);
        }

        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        if (!$disk->exists($rel)) abort(404);

        return $disk->download($rel, basename($rel));
    }


    public function nextCode(Request $request)
    {
        $user = $request->user();
        $seq  = SourcingTarget::withTrashed()->where('client_id', $user->client_id)->count() + 1;
        return $this->ok(['code' => sprintf('SRC-%03d', $seq)]);
    }


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


    public function update(Request $request, string $target)
    {
        $user = $request->user();
        $t    = $this->target($request, $target);

        // Owner-only: a user merely assigned to a target can't re-edit it (they
        // work it via the Sourcing Report). Mirrors the frontend hiding Edit on
        // the "Assigned to Me" tab — enforced here so the API can't be bypassed.
        if ((int) $t->created_by !== (int) $user->id) {
            return response()->json([
                'status'  => false,
                'message' => 'Only the creator can edit this sourcing target.',
            ], 403);
        }

        $data = $this->validatePayload($request);

        // Reconcile the product list instead of wiping it. A product already
        // mapped to a supplier in the Sourcing Report is LOCKED — it can't be
        // removed via edit (the UI hides its delete button; this is the
        // server-side guard). Unmapped products may be removed, retained
        // products keep their suppliers, and new rows are appended.
        $existing    = $t->products()->withCount('suppliers')->get();
        $incomingIds = collect($data['products'])
            ->pluck('id')->filter()->map(fn($x) => (int) $x)->all();

        $blocked = $existing->first(
            fn($p) => $p->suppliers_count > 0 && !in_array((int) $p->id, $incomingIds, true)
        );
        if ($blocked) {
            return response()->json([
                'status'  => false,
                'message' => "“{$blocked->name}” has suppliers mapped in the Sourcing Report and can't be removed. Unmap its suppliers first.",
            ], 422);
        }

        // A target whose assignee has gone Inactive/Exited is view-only — no
        // edits are accepted (the frontend also disables the form + shows a
        // toast). Reassignment is NOT offered; the assignee stays fixed.
        if (!$this->assigneeIsActive($t->client_id, $t->assignee_id)) {
            return response()->json([
                'status'  => false,
                'message' => 'This sourcing target’s assignee is inactive or exited — it is view-only and can’t be edited.',
            ], 403);
        }

        DB::transaction(function () use ($t, $user, $data, $existing) {
            // Assignee is fixed once the target is created — edit never reassigns
            // it (the frontend also locks the "Assign to Team Member" control).
            $t->update([
                'source'   => $data['source'],
                'due_date' => $data['due_date'] ?? null,
            ]);

            $existingById = $existing->keyBy('id');
            $keptIds = [];

            foreach ($data['products'] as $p) {
                $pid = isset($p['id']) ? (int) $p['id'] : 0;

                if ($pid && $existingById->has($pid)) {
                    // Retained row — update editable fields, keep its suppliers.
                    $clarity = $p['clarity'] ?? null;
                    $update  = [
                        'target_price'  => $p['target_price'] ?? null,
                        'clarity_type'  => $clarity['type'] ?? null,
                        'clarity_value' => $clarity['val'] ?? ($clarity['value'] ?? null),
                    ];
                    // Manual rows allow inline name edits; master names are fixed.
                    if (($p['from'] ?? null) === 'manual' && array_key_exists('name', $p)) {
                        $update['name'] = $p['name'] ?? '—';
                    }
                    $existingById->get($pid)->update($update);
                    $keptIds[] = $pid;
                } else {
                    // Brand-new product line.
                    $this->syncProducts($t, $user->client_id, [$p]);
                }
            }

            // Drop the (unmapped) products the user removed from the list.
            $existing->reject(fn($p) => in_array((int) $p->id, $keptIds, true))
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
        // suppliers_count drives the edit form's per-row lock: a product already
        // mapped to a supplier can't be removed (only its price/clarity edited).
        $t->load(['products' => fn($q) => $q->withCount('suppliers')]);

        $clarity = fn($p) => $p->clarity_type
            ? ['type' => $p->clarity_type, 'val' => $p->clarity_value]
            : null;

        // Master rows show the LIVE product name/segment/HSN whenever the row
        // still links to a product — so the edit form never surfaces a stale
        // "code as name" (P-004 instead of the real text). Snapshot is the
        // fallback only for free-text/legacy rows with no product_id.
        $resolve = $this->productDisplayResolver($t->products);
        $master  = $t->products->where('source', 'master')->values()->map(function ($p) use ($clarity, $resolve) {
            $d = $resolve($p);
            return [
                'id'      => $p->id,
                'mapped'  => $p->suppliers_count > 0,
                'code'    => $this->padCode($p->code),
                'name'    => $d['name'],
                'segment' => $d['segment'],
                'hsn'     => $d['hsn'],
                'price'   => $p->target_price ?? '',
                'clarity' => $clarity($p),
            ];
        });

        $manual = $t->products->where('source', 'manual')->values()->map(fn($p) => [
            'id'      => $p->id,
            'mapped'  => $p->suppliers_count > 0,
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
            // The assignee is fixed on edit; the frontend sends this id straight
            // back on Update so it doesn't have to re-resolve the (now Sales/
            // Purchase-only, active-only) team list by name.
            'assigneeId' => $t->assignee_id ? (string) $t->assignee_id : null,
            // False when the assignee has gone Inactive/Exited — the edit form
            // then becomes view-only (no save).
            'assigneeActive' => $this->assigneeIsActive($t->client_id, $t->assignee_id),
            'masterRows' => $master,
            'manualRows' => $manual,
        ]);
    }


    public function report(Request $request, string $target)
    {
        $t = $this->target($request, $target);
        $t->load(['products' => fn($q) => $q->withCount('suppliers')]);

        $clarity = fn($p) => $p->clarity_type
            ? ['type' => $p->clarity_type, 'val' => $p->clarity_value]
            : null;

        $resolve  = $this->productDisplayResolver($t->products);
        $products = $t->products->map(function ($p) use ($clarity, $resolve) {
            $d = $resolve($p);
            return [
                'id'            => $p->id,
                'type'          => $p->source,
                'code'          => $this->padCode($p->code) ?? '',
                'name'          => $d['name'],
                'segment'       => $d['segment'] ?? '',
                'hsn'           => $d['hsn'] ?? '',
                'price'         => $p->target_price ?? '',
                'status'        => $p->status,
                'supplierCount' => $p->suppliers_count,
                'clarity'       => $clarity($p),
            ];
        })->values();

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

    /* Persist a single product's clarity WITHOUT re-saving the whole target —
     * the Product List "Update" button writes it straight to the DB (PDF paths
     * are newline-joined in clarity_value; empty type/value clears it). */
    // PUT /p2p/sourcing-targets/{target}/products/{product}/clarity
    public function updateProductClarity(Request $request, string $target, int $product)
    {
        $t = $this->target($request, $target);
        $p = $t->products()->where('id', $product)->firstOrFail();

        $data = $request->validate([
            'clarity_type'  => 'nullable|string|in:text,link,pdf',
            'clarity_value' => 'nullable|string',
        ]);

        $p->update([
            'clarity_type'  => $data['clarity_type'] ?: null,
            'clarity_value' => $data['clarity_value'] ?? null,
        ]);

        return $this->ok([
            'id'            => $p->id,
            'clarity_type'  => $p->clarity_type,
            'clarity_value' => $p->clarity_value,
        ]);
    }


    public function suppliers(Request $request)
    {
        $user = $request->user();
        // Pull the vendor's primary contact person from its primary address
        // (contact_name / contact_no / email) — `addresses` is ordered
        // is_primary-first, so first() is the primary (or the only) one.
        $rows = Vendor::where('client_id', $user->client_id)
            ->with(['segment:id,name', 'addresses'])
            ->orderBy('company_name')
            ->get()
            ->map(function ($v) {
                $addr = $v->addresses->first();
                return [
                    'id'      => (string) $v->id,
                    // Human-facing supplier code (e.g. "S-002"). The picker
                    // shows this instead of the raw numeric id.
                    'code'    => $v->vendor_code ?? '',
                    'name'    => $v->company_name,
                    'segment' => $v->segment->name ?? '',
                    'contact' => $addr->contact_name ?? '',
                    'mobile'  => $addr->contact_no ?? '',
                    'email'   => ($addr->email ?? '') ?: ($v->primary_email ?? ''),
                ];
            });

        return $this->ok($rows);
    }

    /* ── list the P2P "New Supplier" directory (Dev Tools tab) ───────────── */
    // GET /p2p/new-suppliers — every inline-created supplier (p2p_suppliers),
    // i.e. those registered via the Map Supplier Directory "New Supplier" flow,
    // NOT the Vendor master. Tenant-scoped.
    public function newSuppliers(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->client_id) return $this->ok([]);

        $suppliers = P2pSupplier::where('client_id', $user->client_id)
            ->orderByDesc('id')
            ->get();

        // How many DISTINCT sourcing targets each supplier is mapped into.
        $counts = DB::table('p2p_sourcing_product_suppliers as sps')
            ->join('p2p_sourcing_products as sp', 'sp.id', '=', 'sps.sourcing_product_id')
            ->where('sps.source', 'new')
            ->whereNull('sps.deleted_at')
            ->whereNull('sp.deleted_at')
            ->whereIn('sps.supplier_id', $suppliers->pluck('id'))
            ->groupBy('sps.supplier_id')
            ->selectRaw('sps.supplier_id, COUNT(DISTINCT sp.sourcing_target_id) as cnt')
            ->pluck('cnt', 'sps.supplier_id');

        $rows = $suppliers->map(fn($s) => [
            'id'             => $s->id,
            'name'           => $s->name,
            'segment'        => $s->segment,
            'contact'        => $s->contact,
            'mobile'         => $s->mobile,
            'email'          => $s->email,
            'address'        => $s->address,
            'country'        => $s->country,
            'state'          => $s->state,
            'state_code'     => $s->state_code,
            'city'           => $s->city,
            'gmaps'          => $s->gmaps,
            'sourcing_count' => (int) ($counts[$s->id] ?? 0),
            'created_at'     => optional($s->created_at)->toIso8601String(),
        ]);

        return $this->ok($rows);
    }

    /* ── sourcings that use a given New Supplier (Dev Tools drill-down) ───── */
    // GET /p2p/new-suppliers/{supplier}/sourcings — each distinct sourcing
    // target this supplier is mapped into, with the product(s) it was mapped on.
    public function supplierSourcings(Request $request, int $supplier)
    {
        $user = $request->user();
        if (!$user || !$user->client_id) return $this->ok([]);

        // Tenant guard: the supplier must belong to this client.
        $sup = P2pSupplier::where('client_id', $user->client_id)->find($supplier);
        if (!$sup) return $this->ok([]);

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

        // One entry per sourcing target, with the product names mapped under it.
        $grouped = $rows->groupBy('target_id')->map(fn($g) => [
            'code'     => $g->first()->code,
            'due_date' => $g->first()->due_date,
            'products' => $g->pluck('product')->filter()->unique()->values(),
        ])->values();

        return $this->ok($grouped);
    }

    /* ── 10. map a supplier to a product ─────────────────────────────────── */
    // POST /p2p/sourcing-targets/{target}/products/{product}/suppliers
    public function mapSupplier(Request $request, string $target, int $product)
    {
        $user = $request->user();
        $t    = $this->target($request, $target);

        // The creator of a sourcing target gets a view-only report — supplier
        // mapping is the assignee's job. You can't map vendors to a target you
        // raised yourself UNLESS you also assigned it to yourself (creator ==
        // assignee), in which case you ARE the assignee and mapping is allowed.
        if ((int) $t->created_by === (int) $user->id
            && (int) $t->assignee_id !== (int) $user->id
            && $user->user_type !== 'super_admin') {
            return response()->json([
                'status'  => false,
                'message' => 'You created this sourcing target — vendor mapping is done by the assignee, not the creator.',
            ], 403);
        }

        $p    = $t->products()->where('id', $product)->firstOrFail();

        // Length caps mirror the p2p_suppliers column limits so an over-long
        // value is caught here as a friendly 422 instead of leaking a raw
        // PostgreSQL "value too long" error from the insert. Street Address is
        // capped at 255 even though the column is TEXT (product decision).
        $request->validate([
            'supplier_id'             => 'nullable',
            'new_supplier'            => 'nullable|array',
            'new_supplier.name'       => 'required_with:new_supplier|string|max:255',
            'new_supplier.segment'    => 'nullable|string|max:512',
            'new_supplier.contact'    => 'nullable|string|max:255',
            'new_supplier.mobile'     => 'nullable|string|max:64',
            'new_supplier.email'      => 'nullable|email|max:255',
            'new_supplier.gmaps'      => 'nullable|string|max:512',
            'new_supplier.address'    => 'nullable|string|max:255',
            'new_supplier.country'    => 'nullable|string|max:128',
            'new_supplier.state'      => 'nullable|string|max:128',
            'new_supplier.state_code' => 'nullable|string|max:16',
            'new_supplier.city'       => 'nullable|string|max:128',
            'new_supplier.card'       => 'nullable|string|max:512',
        ], [
            'new_supplier.name.required_with' => 'Enter the supplier company name.',
            'new_supplier.email.email'        => 'Enter a valid supplier email address.',
        ], [
            // Friendly field names so a message reads "The Contact Person must not
            // be greater than 255 characters" rather than "The new supplier.name
            // field …" (Laravel's raw dotted-path default).
            'new_supplier.name'       => 'Supplier Company Name',
            'new_supplier.segment'    => 'Segment',
            'new_supplier.contact'    => 'Contact Person',
            'new_supplier.mobile'     => 'Contact Number',
            'new_supplier.email'      => 'Email',
            'new_supplier.gmaps'      => 'Google Maps Link',
            'new_supplier.address'    => 'Street Address',
            'new_supplier.country'    => 'Country',
            'new_supplier.state'      => 'State',
            'new_supplier.state_code' => 'State Code',
            'new_supplier.city'       => 'City',
        ]);

        if ($request->filled('supplier_id')) {
            $v = Vendor::where('client_id', $user->client_id)
                ->with(['segment:id,name', 'addresses'])
                ->findOrFail($request->input('supplier_id'));

            // A product can't have the same vendor mapped twice.
            if ($p->suppliers()->where('supplier_id', $v->id)->exists()) {
                return response()->json(['status' => false, 'message' => "“{$v->company_name}” is already mapped to this product."], 422);
            }

            // Snapshot the vendor's primary contact person (from its primary
            // address) so the mapped-supplier card shows real contact details.
            $addr = $v->addresses->first();
            $p->suppliers()->create([
                'supplier_id' => $v->id,
                'source'      => 'master',
                'name'        => $v->company_name,
                'segment'     => $v->segment->name ?? null,
                'contact'     => $addr->contact_name ?? null,
                'mobile'      => $addr->contact_no ?? null,
                'email'       => ($addr->email ?? '') ?: $v->primary_email,
            ]);
        } elseif ($request->filled('new_supplier')) {
            $n    = $request->input('new_supplier');
            $name = trim($n['name'] ?? '') ?: '—';

            $fields = [
                'segment'    => $n['segment'] ?? null,
                'contact'    => $n['contact'] ?? null,
                'mobile'     => $n['mobile'] ?? null,
                'email'      => $n['email'] ?? null,
                'gmaps'      => $n['gmaps'] ?? null,
                'address'    => $n['address'] ?? null,
                'country'    => $n['country'] ?? null,
                'state'      => $n['state'] ?? null,
                'state_code' => $n['state_code'] ?? null,
                'city'       => $n['city'] ?? null,
                'card_path'  => $n['card'] ?? null,
            ];

            // Store in the dedicated P2P supplier directory (p2p_suppliers) — NOT
            // the company Vendor master. Reuse an existing directory entry with
            // the same name (per client) so one supplier keeps a single id and
            // can be re-mapped to other products by that id.
            $directory = P2pSupplier::where('client_id', $user->client_id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                ->first();
            if (!$directory) {
                $directory = P2pSupplier::create($fields + [
                    'client_id'  => $user->client_id,
                    'branch_id'  => $user->branch_id ?? null,
                    'name'       => $name,
                    'created_by' => $user->id,
                ]);
            }

            // A product can't have the same directory supplier mapped twice.
            if ($p->suppliers()->where('source', 'new')->where('supplier_id', $directory->id)->exists()) {
                return response()->json(['status' => false, 'message' => "“{$name}” is already mapped to this product."], 422);
            }

            // Mapping row snapshots the details; supplier_id → p2p_suppliers.id.
            $p->suppliers()->create($fields + [
                'supplier_id' => $directory->id,
                'source'      => 'new',
                'name'        => $name,
            ]);
        } else {
            return response()->json(['status' => false, 'message' => 'Provide supplier_id or new_supplier'], 422);
        }

        // A product with at least one supplier counts as sourced.
        if ($p->status !== 'Completed') $p->update(['status' => 'Completed']);

        return $this->ok(['supplierCount' => $p->suppliers()->count()]);
    }


    public function mappedSuppliers(Request $request, string $target, int $product)
    {
        $t = $this->target($request, $target);
        $p = $t->products()->where('id', $product)->firstOrFail();

        $rows = $p->suppliers()->latest()->get()->map(fn($s) => [
            'id'      => (string) $s->id,
            'name'    => $s->name,
            'segment' => $s->segment ?? '',
            'contact' => $s->contact ?? '',
            'mobile'  => $s->mobile ?? '',
            'email'   => $s->email ?? '',
            'card'    => $s->card_path ?? '',
            'source'  => $s->source === 'new' ? 'New Supplier' : 'Master',
        ]);

        return $this->ok($rows);
    }



    private function validatePayload(Request $request): array
    {
        return $request->validate([
            'due_date'                => 'nullable|date',
            'source'                  => 'required|in:master,manual',
            'assignee_id'             => 'required',                 // must be assigned to someone
            'products'                => 'required|array|min:1',
            'products.*.id'           => 'nullable|integer',   // existing row (edit); absent = new
            'products.*.from'         => 'required|in:master,manual',
            'products.*.code'         => 'nullable|string|max:64',
            'products.*.name'         => 'nullable|string|max:255',
            'products.*.target_price' => 'nullable|string|max:64',
            'products.*.clarity'      => 'nullable|array',
        ], [
            'assignee_id.required'    => 'Assign this sourcing target to a team member before saving.',
        ]);
    }


    private function resolveAssignee($clientId, $assigneeId): array
    {
        if (!$assigneeId) return ['id' => null, 'name' => null];
        $u = User::where('client_id', $clientId)->find($assigneeId);
        return ['id' => $u?->id, 'name' => $u?->name];
    }

    /**
     * Live display resolver for a set of sourcing products. Master rows follow
     * the linked product master (name / segment / HSN) so a raw code never shows
     * in place of the name; manual & legacy rows fall back to their snapshot.
     * Returns fn($sourcingProduct) => ['name','segment','hsn'].
     */
    private function productDisplayResolver($products): \Closure
    {
        $ids = collect($products)
            ->filter(fn($p) => $p->source === 'master')
            ->pluck('product_id')->filter()->unique()->values();
        $map = $ids->isNotEmpty()
            ? Product::whereIn('id', $ids)->with(['segment:id,name', 'hsn:id,hsn_code'])->get()->keyBy('id')
            : collect();
        return function ($p) use ($map) {
            $live = ($p->source === 'master' && $p->product_id) ? $map->get($p->product_id) : null;
            return [
                'name'    => $live->name ?? $p->name,
                'segment' => $live->segment->name ?? $p->segment,
                'hsn'     => $live->hsn->hsn_code ?? $p->hsn,
            ];
        };
    }

    /**
     * Whether the target's current assignee is still an ACTIVE, assignable
     * member — i.e. their login is active AND their employee record is 'Active'
     * (not Inactive / Exited). Drives the edit form's reassignment unlock: once
     * the assignee goes Inactive/Exited the creator may hand the target off to
     * another active member.
     */
    private function assigneeIsActive($clientId, $assigneeUserId): bool
    {
        if (!$assigneeUserId) return false;
        // A deactivated login is never active (the exit flow also flips this).
        $userActive = User::where('id', $assigneeUserId)
            ->whereRaw('LOWER(status) = ?', ['active'])->exists();
        if (!$userActive) return false;
        // The unlock trigger is specifically an EMPLOYEE going Inactive/Exited.
        // If the assignee has an employee record it must be 'Active'; if they
        // have no employee record they never "exit", so keep them valid (locked)
        // rather than forcing reassignment on legacy/non-employee assignees.
        $emp = \App\Models\Employee::where('client_id', $clientId)
            ->where('user_id', $assigneeUserId)->first();
        if (!$emp) return true;
        return strtolower((string) $emp->status) === 'active';
    }

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
                $code = $p['code'] ?? '';
                $prod = Product::where('client_id', $clientId)
                    ->with(['segment:id,name', 'hsn:id,hsn_code'])
                    ->where('product_code', $code)
                    ->first();

                // The frontend sends the DISPLAY code, padded by padCode()
                // ("P-41" → "P-041"). When product_code is stored unpadded the
                // exact match above misses — which left the row showing the code
                // as its name and no segment/HSN. Fall back to matching on the
                // padded form so the real product (name, segment, HSN, id) resolves.
                if (!$prod && $code !== '') {
                    $prod = Product::where('client_id', $clientId)
                        ->with(['segment:id,name', 'hsn:id,hsn_code'])
                        ->get()
                        ->first(fn($x) => $this->padCode($x->product_code) === $code);
                }

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
