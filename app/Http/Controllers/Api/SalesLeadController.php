<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Lead;
use App\Models\User;
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
    /* ISO 3166-1 alpha-2 → human-readable name. Used as a fallback in
     * filterOptions() when a lead row has an ISO code but no persisted
     * sender_country_name. Kept narrow to the countries we actually see
     * in customer data; unknown ISOs fall through to the raw code. */
    private const ISO_COUNTRY_NAMES = [
        'IN' => 'India',         'US' => 'United States', 'GB' => 'United Kingdom',
        'AU' => 'Australia',     'CA' => 'Canada',        'IT' => 'Italy',
        'PK' => 'Pakistan',      'CN' => 'China',         'SA' => 'Saudi Arabia',
        'AE' => 'United Arab Emirates', 'NG' => 'Nigeria','KE' => 'Kenya',
        'KR' => 'South Korea',   'UG' => 'Uganda',        'YE' => 'Yemen',
        'KZ' => 'Kazakhstan',    'JP' => 'Japan',         'DE' => 'Germany',
        'FR' => 'France',        'ES' => 'Spain',         'BR' => 'Brazil',
        'MX' => 'Mexico',        'RU' => 'Russia',        'ZA' => 'South Africa',
        'EG' => 'Egypt',         'TR' => 'Turkey',        'BD' => 'Bangladesh',
        'LK' => 'Sri Lanka',     'NP' => 'Nepal',         'TH' => 'Thailand',
        'VN' => 'Vietnam',       'MY' => 'Malaysia',      'SG' => 'Singapore',
        'PH' => 'Philippines',   'ID' => 'Indonesia',     'OM' => 'Oman',
        'QA' => 'Qatar',         'KW' => 'Kuwait',        'BH' => 'Bahrain',
        'JO' => 'Jordan',        'LB' => 'Lebanon',       'IQ' => 'Iraq',
        'IR' => 'Iran',          'AF' => 'Afghanistan',   'NZ' => 'New Zealand',
    ];

    /* ─────────────────────────────────────────────────────────────────
     *  LIST — GET /sales/leads
     * ───────────────────────────────────────────────────────────────── */
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // ── Build the LIST query: scope + status tab + active filters + search.
        $q = Lead::query()
            ->with([
                'salesperson:id,name',
                'customer:id,company_name,customer_code',
                'consignee:id,company_name',
            ])
            ->orderByDesc('id');

        $this->applyScope($q, $user);

        $status = $request->query('status');
        if ($status === 'qualified') {
            $q->where('qualified', true)->where('disqualified', false);
        } elseif ($status === 'disqualified') {
            $q->where('disqualified', true);
        }
        // 'all' or anything else → no status filter

        $this->applyListFilters($q, $request);

        $perPage = min(max((int) $request->query('per_page', 50), 1), 200);
        $page    = max((int) $request->query('page', 1), 1);

        $paginator = $q->paginate($perPage, ['*'], 'page', $page);

        // ── Tab counters — single round-trip via conditional aggregation.
        // Active filters (platform / type / country / date / search) DO
        // apply here so each pill shows the filtered total; only the
        // status tab itself is dropped (else each pill would mirror the
        // current tab's count). Frontend opts out on pure pagination via
        // with_counts=0.
        $counts = null;
        if ((int) $request->query('with_counts', 1) === 1) {
            $countsQ = Lead::query();
            $this->applyScope($countsQ, $user);
            $this->applyListFilters($countsQ, $request);

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

    /**
     * Shared list-filter application — runs over the listing query and
     * the counts query so the two stay in sync. Skips the status filter
     * on purpose (counts need to surface every bucket).
     */
    private function applyListFilters($q, Request $request): void
    {
        if ($v = $request->query('platform'))           $q->where('platform', $v);
        if ($v = $request->query('query_type'))         $q->where('query_type', $v);
        if ($v = $request->query('salesperson_id'))     $q->where('salesperson_id', $v);
        if ($v = $request->query('lead_stage_id'))      $q->where('lead_stage_id', $v);
        if ($v = $request->query('sender_country_iso')) $q->where('sender_country_iso', $v);
        if ($v = $request->query('customer_id'))        $q->where('customer_id', $v);

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
     *  ASSIGN — POST /sales/leads/assign
     *
     *  Assigns one or many leads to a single salesperson. Powers both
     *  the row-level Assign action and the bulk "Assign Leads" modal in
     *  the worksheet. Mirrors the legacy IDIMS assignMultipleLeads flow
     *  but tenant-scoped via applyScope() so a hostile lead_id from
     *  another tenant cannot be touched.
     * ───────────────────────────────────────────────────────────────── */
    public function assign(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'lead_ids'        => 'required|array|min:1',
            'lead_ids.*'      => 'integer',
            'salesperson_id'  => 'required|integer|exists:users,id',
        ]);

        $q = Lead::query()->whereIn('id', $data['lead_ids']);
        $this->applyScope($q, $user);
        $leads = $q->get(['id', 'salesperson_id']);

        $newCount       = 0;
        $reassignCount  = 0;
        $skippedCount   = count($data['lead_ids']) - $leads->count();
        $touchedIds     = [];

        foreach ($leads as $lead) {
            if ($lead->salesperson_id && (int) $lead->salesperson_id !== (int) $data['salesperson_id']) {
                $reassignCount++;
            } elseif (!$lead->salesperson_id) {
                $newCount++;
            }
            $touchedIds[] = $lead->id;
        }

        if (!empty($touchedIds)) {
            Lead::whereIn('id', $touchedIds)->update([
                'salesperson_id' => $data['salesperson_id'],
            ]);
        }

        return response()->json([
            'status'           => true,
            'message'          => 'Leads assigned',
            'new_assigned'     => $newCount,
            'reassigned'       => $reassignCount,
            'skipped_no_scope' => $skippedCount,
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  CONVERT TO QUALIFIED — POST /sales/leads/convert-to-qualified
     *
     *  Flips one or many disqualified leads back into the qualified
     *  bucket. Powers the row-level CTQ pill and the bulk-CTQ button
     *  in the floating selection bar. Tenant-scoped — a hostile id from
     *  outside the caller's tenant is silently skipped.
     * ───────────────────────────────────────────────────────────────── */
    public function convertToQualified(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'lead_ids'   => 'required|array|min:1',
            'lead_ids.*' => 'integer',
        ]);

        $q = Lead::query()->whereIn('id', $data['lead_ids']);
        $this->applyScope($q, $user);

        $touched = $q->update([
            'qualified'    => true,
            'disqualified' => false,
            // Clear the disqualification reason if any — the lead is back
            // in play, the old reason no longer applies.
            'lead_ack_reason_id' => null,
        ]);

        return response()->json([
            'status'    => true,
            'message'   => "$touched lead(s) converted to Qualified",
            'converted' => $touched,
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  DISTRIBUTE — POST /sales/leads/distribute
     *
     *  Round-robin distribute unassigned leads (optionally filtered by
     *  platform/query_type/date range) across the chosen salespeople.
     *  Body: { salesperson_ids: int[], filters?: {...} }.
     *
     *  Idempotent against re-distribution: once a lead has a
     *  salesperson_id it's skipped here so a re-run doesn't shuffle
     *  ownership. Use the explicit Assign flow for forced reassignment.
     * ───────────────────────────────────────────────────────────────── */
    public function distribute(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'salesperson_ids'   => 'required|array|min:1',
            'salesperson_ids.*' => 'integer|exists:users,id',
            'filters'                       => 'array',
            'filters.platform'              => 'nullable|string|max:64',
            'filters.query_type'            => 'nullable|string|max:64',
            'filters.start_date'            => 'nullable|date_format:Y-m-d',
            'filters.end_date'              => 'nullable|date_format:Y-m-d',
            'filters.lead_stage_id'         => 'nullable|integer|between:1,8',
            'filters.sender_country_iso'    => 'nullable|string|max:8',
        ]);

        $q = Lead::query()->whereNull('salesperson_id');
        $this->applyScope($q, $user);

        $f = $data['filters'] ?? [];
        if (!empty($f['platform']))           $q->where('platform', $f['platform']);
        if (!empty($f['query_type']))         $q->where('query_type', $f['query_type']);
        if (!empty($f['lead_stage_id']))      $q->where('lead_stage_id', $f['lead_stage_id']);
        if (!empty($f['sender_country_iso'])) $q->where('sender_country_iso', $f['sender_country_iso']);
        if (!empty($f['start_date']) && !empty($f['end_date'])) {
            $q->whereBetween('query_time', [
                $f['start_date'] . ' 00:00:00',
                $f['end_date']   . ' 23:59:59',
            ]);
        }

        $leadIds = $q->orderBy('id')->pluck('id')->all();

        if (empty($leadIds)) {
            return response()->json([
                'status'  => true,
                'message' => 'No unassigned leads matched the filters',
                'total'   => 0,
                'per_user' => [],
            ]);
        }

        // Round-robin: bucket lead ids by salesperson index, then bulk-update
        // each bucket in one UPDATE so we don't issue N queries on a 100k+ run.
        $sps     = $data['salesperson_ids'];
        $buckets = array_fill(0, count($sps), []);
        foreach ($leadIds as $i => $leadId) {
            $buckets[$i % count($sps)][] = $leadId;
        }

        $perUser = [];
        DB::transaction(function () use ($sps, $buckets, &$perUser) {
            foreach ($sps as $i => $sp) {
                if (empty($buckets[$i])) {
                    $perUser[$sp] = 0;
                    continue;
                }
                Lead::whereIn('id', $buckets[$i])->update(['salesperson_id' => $sp]);
                $perUser[$sp] = count($buckets[$i]);
            }
        });

        return response()->json([
            'status'   => true,
            'message'  => 'Leads distributed',
            'total'    => count($leadIds),
            'per_user' => $perUser,
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  SALESPEOPLE — GET /sales/leads/salespeople
     *
     *  Returns the users in the caller's tenant that can own a lead.
     *  Mirrors the EmployeeController managers() shape: the login_users
     *  collection scoped to the tenant. Used by the Assign + Distribute
     *  modals as their dropdown source.
     * ───────────────────────────────────────────────────────────────── */
    public function salespeople(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $q = User::query()
            ->whereIn('user_type', ['client_admin', 'client_user', 'branch_user', 'employee'])
            ->where('status', 'active');

        if ($user->user_type !== 'super_admin') {
            $q->where('client_id', $user->client_id);
            $isMain = $user->branch?->is_main ?? false;
            if ($user->user_type === 'branch_user' && !$isMain) {
                $q->where(function ($w) use ($user) {
                    $w->whereNull('branch_id')->orWhere('branch_id', $user->branch_id);
                });
            }
        }

        $rows = $q->select(['id', 'name', 'user_type', 'designation', 'email'])
                  ->orderBy('name')
                  ->get();

        return response()->json([
            'status' => true,
            'data'   => $rows->map(fn ($u) => [
                'id'        => $u->id,
                'name'      => $u->name,
                'code'      => 'EMP-' . str_pad((string) $u->id, 3, '0', STR_PAD_LEFT),
                'role'      => $u->user_type,
                'subtitle'  => $u->designation ?: ucfirst(str_replace('_', ' ', $u->user_type)),
            ]),
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  FILTER OPTIONS — GET /sales/leads/filter-options
     *
     *  One round-trip that feeds the Filter modal: distinct platforms /
     *  query_types / countries seen in this tenant's leads + the live
     *  customer list. Saves the modal from firing 4 separate calls.
     * ───────────────────────────────────────────────────────────────── */
    public function filterOptions(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $base = Lead::query();
        $this->applyScope($base, $user);

        $platforms = (clone $base)
            ->select('platform')->whereNotNull('platform')
            ->distinct()->orderBy('platform')->pluck('platform')->values();

        $queryTypes = (clone $base)
            ->select('query_type')->whereNotNull('query_type')
            ->distinct()->orderBy('query_type')->pluck('query_type')->values();

        // Country list — group by ISO so we don't get duplicate buckets
        // when one row has the name populated and another doesn't, then
        // fall back to a built-in ISO→name dictionary for any row that
        // never had the name persisted (IndiaMart sometimes omits it).
        $countries = (clone $base)
            ->select('sender_country_iso')
            ->whereNotNull('sender_country_iso')
            ->groupBy('sender_country_iso')
            ->orderBy('sender_country_iso')
            ->pluck('sender_country_iso')
            ->map(function ($iso) use ($base) {
                // Prefer the persisted name if any row has one for this ISO.
                $name = (clone $base)
                    ->where('sender_country_iso', $iso)
                    ->whereNotNull('sender_country_name')
                    ->value('sender_country_name');
                if (!$name) $name = self::ISO_COUNTRY_NAMES[$iso] ?? $iso;
                return ['value' => $iso, 'label' => $name];
            })
            ->sortBy('label')
            ->values();

        // Customer dropdown — same tenant scope as the main listing.
        // We cap at 500 so the modal stays light; the search box on the
        // right pane is client-side so this is plenty for typical usage.
        $cq = Customer::query();
        if ($user->user_type !== 'super_admin' && $user->client_id) {
            $cq->where('client_id', $user->client_id);
        }
        $customers = $cq->select(['id', 'company_name', 'customer_code'])
                        ->orderBy('company_name')
                        ->limit(500)
                        ->get()
                        ->map(fn ($c) => [
                            'value' => (string) $c->id,
                            'label' => $c->company_name ?: ('Customer #' . $c->id),
                        ])
                        ->values();

        return response()->json([
            'status'      => true,
            'platforms'   => $platforms,
            'query_types' => $queryTypes,
            'countries'   => $countries,
            'customers'   => $customers,
            'stages'      => [
                ['value' => '1', 'label' => 'Inquiry Required'],
                ['value' => '2', 'label' => 'Lead Acknowledgement'],
                ['value' => '3', 'label' => 'Product Sourcing'],
                ['value' => '4', 'label' => 'Price Shared'],
                ['value' => '5', 'label' => 'Pre-PI CLM'],
                ['value' => '6', 'label' => 'Quotation vs PI'],
                ['value' => '7', 'label' => 'Post-PI CLM'],
                ['value' => '8', 'label' => 'Victory'],
            ],
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
