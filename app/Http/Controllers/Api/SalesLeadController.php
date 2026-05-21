<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Lead;
use App\Services\IndiaMartLeadSyncService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Sales Matrix → Leads (My Workplace) backend.
 *
 * Powers the /sales/lead-worksheet SPA page. Three feeders write here:
 *
 *   - index()       — list with tenant scope + tab + search + paginate
 *   - store()       — manual lead capture (Add New Lead modal)
 *   - syncFromCrm() — pull leads from IndiaMart CRM keys configured per tenant
 *
 * Tenant model mirrors SalesTodoController: rows are pinned to the user's
 * client_id. Sub-branch users (non-main branch_user) see their branch only;
 * client_admin / main_branch_user see the whole client; super_admin sees all.
 */
class SalesLeadController extends Controller
{
    /* ─────────────────────────────────────────────────────────────────
     *  LIST — GET /sales/leads
     * ───────────────────────────────────────────────────────────────── */
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = Lead::query()
            ->with([
                'salesperson:id,name',
                'customer:id,company_name,customer_code',
                'consignee:id,company_name',
            ])
            ->orderByDesc('id');

        $this->applyScope($q, $user);

        // ── Status tab (qualified / disqualified / all)
        $status = $request->query('status');
        if ($status === 'qualified') {
            $q->where('qualified', true)->where('disqualified', false);
        } elseif ($status === 'disqualified') {
            $q->where('disqualified', true);
        }
        // 'all' or anything else → no status filter

        // ── Optional filters
        if ($v = $request->query('platform'))           $q->where('platform', $v);
        if ($v = $request->query('query_type'))         $q->where('query_type', $v);
        if ($v = $request->query('salesperson_id'))     $q->where('salesperson_id', $v);
        if ($v = $request->query('lead_stage_id'))      $q->where('lead_stage_id', $v);
        if ($v = $request->query('sender_country_iso')) $q->where('sender_country_iso', $v);

        if ($request->filled('start_date') && $request->filled('end_date')) {
            $q->whereBetween('query_time', [
                $request->query('start_date') . ' 00:00:00',
                $request->query('end_date')   . ' 23:59:59',
            ]);
        }

        if ($search = trim((string) $request->query('search', ''))) {
            $like = "%{$search}%";
            $q->where(function ($w) use ($like) {
                $w->where('opp_code',            'like', $like)
                  ->orWhere('unique_query_id',   'like', $like)
                  ->orWhere('sender_name',       'like', $like)
                  ->orWhere('sender_mobile',     'like', $like)
                  ->orWhere('sender_email',      'like', $like)
                  ->orWhere('sender_company',    'like', $like)
                  ->orWhere('query_product_name','like', $like);
            });
        }

        $perPage = min(max((int) $request->query('per_page', 50), 1), 200);
        $page    = max((int) $request->query('page', 1), 1);

        $paginator = $q->paginate($perPage, ['*'], 'page', $page);

        // Tab counters — single round-trip via conditional aggregation
        // (one index scan over the (client_id, qualified, disqualified)
        // index instead of three). Frontend opts out on pure page changes
        // via with_counts=0 so paginating within a tab stays fast on
        // million-row tables.
        $counts = null;
        if ((int) $request->query('with_counts', 1) === 1) {
            $countsQ = Lead::query();
            $this->applyScope($countsQ, $user);

            // NOTE: comparing booleans with `= 1`/`= 0` works on MySQL but
            // Postgres rejects it (SQLSTATE 42883). Use true/false literals
            // — both engines accept them.
            $row = $countsQ->selectRaw(
                "COUNT(*) AS c_all,
                 SUM(CASE WHEN qualified = true AND disqualified = false THEN 1 ELSE 0 END) AS c_qual,
                 SUM(CASE WHEN disqualified = true THEN 1 ELSE 0 END) AS c_disq"
            )->first();

            $counts = [
                'all'          => (int) ($row->c_all  ?? 0),
                'qualified'    => (int) ($row->c_qual ?? 0),
                'disqualified' => (int) ($row->c_disq ?? 0),
            ];
        }

        $response = [
            'status' => true,
            'data'   => $paginator->items(),
            'pagination' => [
                'current_page' => $paginator->currentPage(),
                'last_page'    => $paginator->lastPage(),
                'per_page'     => $paginator->perPage(),
                'total'        => $paginator->total(),
            ],
        ];
        if ($counts !== null) $response['counts'] = $counts;

        return response()->json($response);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  MANUAL CREATE — POST /sales/leads
     * ───────────────────────────────────────────────────────────────── */
    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $data = $request->validate([
            'sender_name'         => 'required|string|max:255',
            'sender_mobile'       => 'nullable|string|max:32',
            'sender_email'        => 'nullable|email|max:255',
            'sender_company'      => 'nullable|string|max:255',
            'sender_address'      => 'nullable|string|max:1000',
            'sender_city'         => 'nullable|string|max:128',
            'sender_state'        => 'nullable|string|max:128',
            'sender_country_iso'  => 'nullable|string|max:8',
            'sender_country_name' => 'nullable|string|max:128',
            'sender_pincode'      => 'nullable|string|max:32',
            'customer_id'         => 'nullable|integer|exists:customers,id',
            'consignee_id'        => 'nullable|integer|exists:consignees,id',
            'query_message'       => 'nullable|string',
            'product_quantity'    => 'nullable|string|max:64',
            'query_product_name'  => 'nullable|string|max:255',
        ]);

        $lead = DB::transaction(function () use ($data, $user) {
            return Lead::create(array_merge($data, [
                'client_id'       => $user->client_id,
                'branch_id'       => $user->branch_id,
                'opp_code'        => $this->nextOppCode($user->client_id),
                'unique_query_id' => (string) mt_rand(100000000, 999999999),
                'platform'        => 'Offline',
                'query_type'      => 'Manual',
                'query_time'      => now(),
                'lead_stage_id'   => 1,
                'qualified'       => true,
                'disqualified'    => false,
                'key_opportunity' => false,
                'has_whatsapp'    => false,
                'whatsapp_status' => 'pending',
                'created_by'      => $user->id,
            ]));
        });

        $lead->load(['salesperson:id,name', 'customer:id,company_name,customer_code']);

        return response()->json(['status' => true, 'data' => $lead], 201);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  SHOW / UPDATE / DELETE
     * ───────────────────────────────────────────────────────────────── */
    public function show(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = Lead::with(['salesperson:id,name', 'customer', 'consignee', 'ackReason']);
        $this->applyScope($q, $user);
        $lead = $q->findOrFail($id);

        return response()->json(['status' => true, 'data' => $lead]);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = Lead::query();
        $this->applyScope($q, $user);
        $lead = $q->findOrFail($id);

        $data = $request->validate([
            'sender_name'        => 'sometimes|required|string|max:255',
            'sender_mobile'      => 'nullable|string|max:32',
            'sender_email'       => 'nullable|email|max:255',
            'sender_company'     => 'nullable|string|max:255',
            'sender_address'     => 'nullable|string|max:1000',
            'sender_city'        => 'nullable|string|max:128',
            'sender_state'       => 'nullable|string|max:128',
            'sender_pincode'     => 'nullable|string|max:32',
            'sender_country_iso' => 'nullable|string|max:8',
            'qualified'          => 'nullable|boolean',
            'disqualified'       => 'nullable|boolean',
            'lead_stage_id'      => 'nullable|integer|between:1,8',
            'salesperson_id'     => 'nullable|integer|exists:users,id',
            'key_opportunity'    => 'nullable|boolean',
            'remark'             => 'nullable|string',
            'price'              => 'nullable|string|max:64',
            'lead_ack_reason_id' => 'nullable|integer|exists:lead_ack_reasons,id',
            'customer_id'        => 'nullable|integer|exists:customers,id',
            'consignee_id'       => 'nullable|integer|exists:consignees,id',
        ]);

        $lead->update($data);

        return response()->json(['status' => true, 'data' => $lead->fresh(['salesperson:id,name'])]);
    }

    public function destroy(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = Lead::query();
        $this->applyScope($q, $user);
        $lead = $q->findOrFail($id);
        $lead->delete();

        return response()->json(['status' => true, 'message' => 'Lead deleted']);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  SYNC FROM 3rd-PARTY CRM — POST /sales/leads/sync
     * ───────────────────────────────────────────────────────────────── */
    public function syncFromCrm(Request $request, IndiaMartLeadSyncService $service)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // Tenant gate — see config/lead_sync.php. Super-admin bypasses
        // (they can fire sync against any client to test setup), but for
        // everyone else the caller's (client_id, branch_id) must match
        // the env-configured pair.
        $gateError = $this->checkSyncTenantGate($user);
        if ($gateError) {
            return response()->json(['status' => false, 'message' => $gateError], 403);
        }

        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }
        $client = $user->client;
        if (!$client) {
            return response()->json(['status' => false, 'message' => 'Client not loaded'], 422);
        }

        $result = $service->syncForClient($client, $user);

        return response()->json(array_merge(['status' => true], $result));
    }

    /* ─────────────────────────────────────────────────────────────────
     *  SYNC CONFIG (used by the frontend to decide whether to render
     *  the "Sync from IndiaMart" banner button) — GET /sales/leads/sync/config
     * ───────────────────────────────────────────────────────────────── */
    public function syncConfig(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $keys    = (array) config('lead_sync.indiamart.keys', []);
        $enabled = $this->checkSyncTenantGate($user) === null && !empty($keys);

        return response()->json([
            'enabled' => $enabled,
            'labels'  => array_column($keys, 'label'),
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  Helpers
     * ───────────────────────────────────────────────────────────────── */

    /**
     * Tenant scope — pin rows to the caller's tenant. Sub-branch users
     * (non-main branch_user) are pinned to their branch. Mirror of
     * SalesTodoController::applyScope tailored for leads.
     */
    private function applyScope($q, $user): void
    {
        if ($user->user_type === 'super_admin') return;

        if ($user->client_id) {
            $q->where('client_id', $user->client_id);
        }

        $isMain = $user->branch?->is_main ?? false;
        if ($user->user_type === 'branch_user' && !$isMain) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('branch_id')->orWhere('branch_id', $user->branch_id);
            });
        }
    }

    /**
     * Branch gate for sync — returns null when the user is allowed to
     * trigger sync, or a human-readable reason string otherwise.
     *
     *   config('lead_sync.branch') === null    → sync disabled for everyone
     *                                            except super_admin
     *   config('lead_sync.branch') === 'all'   → any authenticated user OK
     *   config('lead_sync.branch') === <int>   → only that branch
     *   config('lead_sync.branch') === [int…]  → any branch in the list
     *
     * super_admin always passes (lets us QA sync against any branch).
     */
    private function checkSyncTenantGate($user): ?string
    {
        if ($user->user_type === 'super_admin') return null;

        $branch    = config('lead_sync.branch');
        $userBr    = (int) $user->branch_id;

        if ($branch === null) {
            return 'Lead sync is not configured. Set LEAD_SYNC_BRANCH_ID in .env.';
        }
        if ($branch === 'all') {
            return null;
        }
        if (is_array($branch)) {
            return in_array($userBr, $branch, true)
                ? null
                : 'Lead sync is configured for a different branch.';
        }
        // scalar int — strict per-branch match
        return $userBr === (int) $branch
            ? null
            : 'Lead sync is configured for a different branch.';
    }

    /**
     * Allocate the next opp_code for a client. Serializes concurrent calls
     * by row-locking the parent client row — Postgres rejects FOR UPDATE
     * on aggregates so we can't lock the count(*) directly. The composite
     * UNIQUE (client_id, opp_code) is the second line of defense.
     */
    public function nextOppCode(int $clientId): string
    {
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        $count = Lead::where('client_id', $clientId)->count();
        return sprintf('OPP-%04d', $count + 1);
    }
}
