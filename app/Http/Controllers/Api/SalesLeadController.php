<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Employee;
use App\Models\Lead;
use App\Models\LeadAckReason;
use App\Models\LeadAcknowledgement;
use App\Models\LeadProduct;
use App\Models\LeadProductSharedPrice;
use App\Models\LeadTaskManager;
use App\Models\Procurement;
use App\Models\ProcurementProduct;
use App\Models\Product;
use Barryvdh\DomPDF\Facade\Pdf;
use App\Models\User;
use App\Services\IndiaMartLeadSyncService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
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
        // `withTrashed()` on customer/consignee/salesperson so soft-deleted
        // mapped rows still surface (with their saved labels) instead of
        // turning into blank/null entries on the worksheet. Source of B2.
        $q = Lead::query()
            ->with([
                'salesperson' => fn ($r) => $r->select('id', 'name')->withTrashed(),
                'customer'    => fn ($r) => $r->select('id', 'company_name', 'customer_code')->withTrashed(),
                'consignee'   => fn ($r) => $r->select('id', 'company_name')->withTrashed(),
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
            /* Full-table search — every column the My Workplace table
             * shows is now searchable from the single header search box.
             * Coverage:
             *   • Opportunity Id   → opp_code, unique_query_id
             *   • Lead Type        → query_type ("W" / "B" / "BIZ")
             *   • Lead Source      → platform ("Vortex" / "Purvee" …)
             *   • Customer Name    → sender_name + customer.org_name
             *   • Customer Number  → sender_mobile + sender_mobile_alt
             *   • Customer Email   → sender_email + sender_email_alt
             *   • Company          → sender_company + sender_address /
             *                        sender_city / sender_state
             *   • Product Name     → query_product_name + query_mcat_name
             *   • Country          → sender_country_iso / sender_country_name
             *   • Remark / message → remark + query_message
             *   • Assigned To      → salesperson.name (relation lookup)
             * The relation-based searches use whereHas so they stay
             * indexed and don't pull every related row into PHP. */
            $q->where(function ($w) use ($like, $search) {
                $w->where('opp_code',              'like', $like)
                  ->orWhere('unique_query_id',     'like', $like)
                  ->orWhere('query_type',          'like', $like)
                  ->orWhere('platform',            'like', $like)
                  ->orWhere('source_account',      'like', $like)
                  ->orWhere('sender_name',         'like', $like)
                  ->orWhere('sender_mobile',       'like', $like)
                  ->orWhere('sender_mobile_alt',   'like', $like)
                  ->orWhere('sender_email',        'like', $like)
                  ->orWhere('sender_email_alt',    'like', $like)
                  ->orWhere('sender_company',      'like', $like)
                  ->orWhere('sender_address',      'like', $like)
                  ->orWhere('sender_city',         'like', $like)
                  ->orWhere('sender_state',        'like', $like)
                  ->orWhere('sender_pincode',      'like', $like)
                  ->orWhere('sender_country_iso',  'like', $like)
                  ->orWhere('sender_country_name', 'like', $like)
                  ->orWhere('query_product_name',  'like', $like)
                  ->orWhere('query_mcat_name',     'like', $like)
                  ->orWhere('query_message',       'like', $like)
                  ->orWhere('remark',              'like', $like)
                  ->orWhere('whatsapp_status',     'like', $like)
                  // Related lookups — salesperson and customer names.
                  ->orWhereHas('salesperson', function ($s) use ($like) {
                      $s->where('name',  'like', $like)
                        ->orWhere('email','like', $like);
                  })
                  ->orWhereHas('customer', function ($c) use ($like) {
                      // customers table uses company_name / legal_name —
                      // the earlier `org_name` reference was inherited
                      // from the clients table and crashed with "column
                      // org_name does not exist" on Postgres.
                      $c->where('company_name', 'like', $like)
                        ->orWhere('legal_name',   'like', $like)
                        ->orWhere('customer_code','like', $like)
                        ->orWhere('primary_email','like', $like);
                  });

                // Numeric columns get a strict-equals branch when the
                // term looks like an integer so a search for the bare
                // price "50000" still matches without forcing the user
                // to remember the exact formatting.
                if (ctype_digit($search)) {
                    $w->orWhere('product_quantity', (int) $search);
                }
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
            // B9: cap query_message at 10k chars — Postgres TEXT happily
            // stores gigabytes, but accepting them lets a single payload
            // wreck the worksheet list response shape + memory.
            'query_message'       => 'nullable|string|max:10000',
            'product_quantity'    => 'nullable|string|max:64',
            'query_product_name'  => 'nullable|string|max:255',
        ]);

        /* Auto-fill sender_country_iso from the master_countries table
         * when the client sends sender_country_name but no iso. The
         * Add-New-Lead frontend only collects a country name; the
         * leads table column renders the ISO code (e.g. "IN", "DE"),
         * so without this lookup every manually-created lead showed
         * "—" in the Country column. Lookup is case-insensitive so
         * "India" / "INDIA" / "india" all resolve. */
        if (empty($data['sender_country_iso']) && !empty($data['sender_country_name'])) {
            $iso = \App\Models\Masters\Countries::query()
                ->whereRaw('LOWER(name) = ?', [strtolower(trim($data['sender_country_name']))])
                ->value('iso_code');
            if ($iso) {
                $data['sender_country_iso'] = strtoupper($iso);
            }
        }

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

        $q = Lead::with([
            'salesperson' => fn ($r) => $r->withTrashed(),
            // Full customer + consignee rows — the matrix-detail toolbar
            // reads these to decide whether to open the Edit form or the
            // Picker for each button. withTrashed() so a soft-deleted but
            // still-mapped customer / consignee surfaces (showing its
            // legacy company_name) instead of returning a NULL relation
            // that breaks the toolbar + CLM panel display.
            'customer'  => fn ($r) => $r->withTrashed(),
            'consignee' => fn ($r) => $r->withTrashed(),
            'ackReason',
            // Stage 1 form pre-populates from this. One-to-one row created
            // / updated by POST /sales/leads/{lead}/task-manager.
            'taskManager',
            // Stage 2 activity log — already ordered latest-first via the
            // hasMany scope on the relation.
            'acknowledgements',
        ]);
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
            // B5: stage range is 1–6 (Inquiry → Victory). Earlier `between:1,8`
            // allowed nonexistent stages 7/8 in via direct API hits.
            'lead_stage_id'      => 'nullable|integer|between:1,6',
            // B4: must point at a salesperson that is NOT soft-deleted.
            'salesperson_id'     => ['nullable', 'integer', \Illuminate\Validation\Rule::exists('users', 'id')->whereNull('deleted_at')],
            'key_opportunity'    => 'nullable|boolean',
            // B8: cap remark at 5000 chars — the worksheet renders it
            // inline and a 10MB note breaks the list render + indexing.
            'remark'             => 'nullable|string|max:5000',
            'price'              => 'nullable|string|max:64',
            // B3: lead_ack_reason must be active. The reasons table has no
            // soft-delete column (admin removes reasons by flipping status
            // to 'inactive'), so the where() filter is the gate.
            'lead_ack_reason_id' => ['nullable', 'integer', \Illuminate\Validation\Rule::exists('lead_ack_reasons', 'id')->where(fn ($w) => $w->where('status', 'active'))],
            'customer_id'        => 'nullable|integer|exists:customers,id',
            'consignee_id'       => 'nullable|integer|exists:consignees,id',
            // WhatsApp text-only updates ride along on the same endpoint;
            // attach-screenshot uploads use the dedicated multipart route.
            'has_whatsapp'       => 'nullable|boolean',
            'whatsapp_status'    => 'nullable|string|in:connected,pending,not_connected,opted_out',
            'whatsapp_reason'    => 'nullable|string|max:1000',
        ]);

        // B6: qualified + disqualified must be mutually exclusive. If the
        // payload sets both true the lead drops off BOTH tabs (each tab
        // filters by one of the flags). Reject explicitly.
        if (!empty($data['qualified']) && !empty($data['disqualified'])) {
            return response()->json([
                'status'  => false,
                'message' => 'A lead cannot be both Qualified and Disqualified at the same time.',
            ], 422);
        }

        // Auto-mark the deal as won the FIRST time it lands on Stage 6
        // (Victory). Keeping this server-side means we don't trust the
        // client to send a timestamp, and the column is set exactly once
        // — re-advancing to Stage 6 after a regression won't overwrite
        // the original win date.
        if (isset($data['lead_stage_id']) && (int) $data['lead_stage_id'] === 6 && $lead->won_at === null) {
            $data['won_at'] = now();
        }
        // B7: regressing OUT of Stage 6 must clear won_at — otherwise the
        // lead reads as "won" while it's actually back in the pipeline,
        // and reports filter on won_at IS NOT NULL.
        if (isset($data['lead_stage_id']) && (int) $data['lead_stage_id'] < 6 && $lead->won_at !== null) {
            $data['won_at'] = null;
        }

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
     *  TASK MANAGER UPSERT — POST /sales/leads/{lead}/task-manager
     *
     *  Stage 1 (Inquiry Received) save target. Accepts multipart so the
     *  optional supporting document rides along on the same request.
     *  Idempotent: one row per (client, lead) — re-saves overwrite the
     *  prior file on disk to avoid orphaned blobs.
     *
     *  Body shape (FormData):
     *    name             string  required, max 255
     *    mobile_no        string  required, 6–15 digits
     *    email            string  required, valid email
     *    order_value      number  optional, ≥ 0
     *    buying_plan      Y-m-d   optional date
     *    attachment       File    optional (jpg/png/pdf, ≤ 5 MB)
     * ───────────────────────────────────────────────────────────────── */
    public function storeTaskManager(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        // Tenant-scoped lookup — a hostile id from another tenant 404s
        // instead of leaking the record's existence.
        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $data = $request->validate([
            'name'        => 'required|string|max:255',
            'mobile_no'   => ['required', 'string', 'regex:/^\d{6,15}$/'],
            'email'       => 'required|email|max:255',
            'order_value' => 'nullable|numeric|min:0',
            'buying_plan' => 'nullable|date_format:Y-m-d',
            'attachment'  => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:5120',
        ], [
            'mobile_no.regex' => 'Mobile number must be 6–15 digits',
        ]);

        $existing = LeadTaskManager::where('client_id', $user->client_id)
            ->where('lead_id', $lead->id)
            ->first();

        // Replace prior attachment on disk if a new file came in. We
        // unlink before write so a half-written upload never leaves two
        // files lingering for the same task-manager row.
        $attachmentPath = $existing?->attachment;
        $attachmentName = $existing?->attachment_original;
        if ($request->hasFile('attachment')) {
            if ($existing?->attachment && Storage::disk('public')->exists($existing->attachment)) {
                Storage::disk('public')->delete($existing->attachment);
            }
            $file           = $request->file('attachment');
            $attachmentName = $file->getClientOriginalName();
            $attachmentPath = $file->store(
                "leads/task-manager/{$user->client_id}",
                'public',
            );
        }

        $payload = [
            'client_id'           => $user->client_id,
            'lead_id'             => $lead->id,
            'name'                => $data['name'],
            'mobile_no'           => $data['mobile_no'],
            'email'               => $data['email'],
            'order_value'         => $data['order_value'] ?? null,
            'buying_plan'         => $data['buying_plan'] ?? null,
            'attachment'          => $attachmentPath,
            'attachment_original' => $attachmentName,
            'updated_by'          => $user->id,
        ];

        $row = $existing
            ? tap($existing)->update($payload)
            : LeadTaskManager::create($payload);

        return response()->json([
            'status'  => true,
            'message' => $existing ? 'Task manager updated' : 'Task manager saved',
            'data'    => $row->fresh(),
        ], $existing ? 200 : 201);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  WHATSAPP STATUS — POST /sales/leads/{lead}/whatsapp
     *
     *  Multipart endpoint. Body: { whatsapp_status, whatsapp_reason?,
     *  screenshot? (file) }. Updates the lead row in place. When a new
     *  screenshot comes in, the prior file is unlinked from disk before
     *  the new path is written so we never leave orphans.
     *
     *  has_whatsapp is auto-derived: true iff status is "connected".
     * ───────────────────────────────────────────────────────────────── */
    public function updateWhatsApp(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $data = $request->validate([
            'whatsapp_status' => 'required|string|in:connected,pending,not_connected,opted_out',
            'whatsapp_reason' => 'nullable|string|max:1000',
            'screenshot'      => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:5120',
        ]);

        $screenshotPath = $lead->whatsapp_screenshot;
        if ($request->hasFile('screenshot')) {
            if ($lead->whatsapp_screenshot && Storage::disk('public')->exists($lead->whatsapp_screenshot)) {
                Storage::disk('public')->delete($lead->whatsapp_screenshot);
            }
            $screenshotPath = $request->file('screenshot')->store(
                "leads/whatsapp/{$user->client_id}",
                'public',
            );
        }

        $lead->update([
            'whatsapp_status'     => $data['whatsapp_status'],
            'whatsapp_reason'     => $data['whatsapp_reason'] ?? null,
            'whatsapp_screenshot' => $screenshotPath,
            'has_whatsapp'        => $data['whatsapp_status'] === 'connected',
        ]);

        return response()->json([
            'status' => true,
            'data'   => $lead->fresh()->only([
                'id', 'has_whatsapp', 'whatsapp_status', 'whatsapp_reason', 'whatsapp_screenshot',
            ]),
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  LEAD PRODUCTS — GET /sales/leads/{lead}/products
     *
     *  Returns rows from lead_products joined with the product master
     *  for display. Shape kept lean so the modal can render directly.
     * ───────────────────────────────────────────────────────────────── */
    public function listLeadProducts(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $rows = LeadProduct::with(['product:id,product_code,name,status'])
            ->where('lead_id', $lead->id)
            ->orderByDesc('id')
            ->get();

        // Latest procurement_id per lead_product (Stage 3 Required tab uses
        // this to swap the row between "select to procure" and "Mark Sourced").
        $procByLeadProduct = ProcurementProduct::query()
            ->whereIn('lead_product_id', $rows->pluck('id'))
            ->orderByDesc('id')
            ->get()
            ->groupBy('lead_product_id')
            ->map(fn ($g) => $g->first()->procurement_id);

        $mapped = $rows->map(fn ($r) => [
            'id'               => $r->id,
            'product_id'       => $r->product_id,
            'product_code'     => $r->product?->product_code,
            'product_name'     => $r->product?->name,
            'product_status'   => $r->product?->status,
            'currency'         => $r->currency,
            'quantity'         => $r->quantity,
            'target_price'     => $r->target_price,
            'notes'            => $r->notes,
            'sourcing_status'  => $r->sourcing_status,
            'procurement_done' => (bool) $r->procurement_done,
            'procurement_id'   => $procByLeadProduct[$r->id] ?? null,
            'created_at'       => $r->created_at,
        ]);

        return response()->json(['status' => true, 'data' => $mapped]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  LEAD PRODUCTS — PATCH /sales/leads/{lead}/products/{mapping}/sourcing-status
     *
     *  Stage 3 sub-flow. Salesperson labels each mapped product as
     *  `required` (needs procurement) or `not_required`. The business
     *  rule mirrors IDIMS: inactive / draft product masters cannot be
     *  marked not_required — they have no current selling price so they
     *  always need procurement before they can be quoted.
     * ───────────────────────────────────────────────────────────────── */
    public function updateLeadProductSourcingStatus(Request $request, int $leadId, int $mappingId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $row = LeadProduct::with('product:id,status')
            ->where('lead_id', $lead->id)
            ->findOrFail($mappingId);

        $data = $request->validate([
            'sourcing_status' => 'required|in:required,not_required',
        ]);

        $productStatus = strtolower((string) ($row->product?->status ?? ''));
        if (in_array($productStatus, ['inactive', 'draft'], true)
            && $data['sourcing_status'] !== 'required'
        ) {
            return response()->json([
                'status'  => false,
                'message' => 'Inactive or draft products must be marked Sourcing Required',
            ], 422);
        }

        $row->update([
            'sourcing_status'  => $data['sourcing_status'],
            // Flipping to "not required" wipes any prior mark-sourced state
            // so the row can't sneak past Stage 4 gating later.
            'procurement_done' => $data['sourcing_status'] === 'required'
                ? $row->procurement_done
                : false,
        ]);

        return response()->json(['status' => true, 'data' => [
            'id'               => $row->id,
            'sourcing_status'  => $row->sourcing_status,
            'procurement_done' => (bool) $row->procurement_done,
        ]]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  LEAD PRODUCTS — PATCH /sales/leads/{lead}/products/{mapping}/mark-sourced
     *
     *  Equivalent to IDIMS's "Mark as Done" on product_directories. Only
     *  meaningful on rows already labelled sourcing_status = required. We
     *  don't yet have a procurement-orders module in CBC, so the action
     *  collapses to a single boolean flip — the IDIMS gate on vendor
     *  mapping has no analogue here and is deliberately omitted.
     * ───────────────────────────────────────────────────────────────── */
    public function markLeadProductSourced(Request $request, int $leadId, int $mappingId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $row = LeadProduct::where('lead_id', $lead->id)->findOrFail($mappingId);

        if ($row->sourcing_status !== 'required') {
            return response()->json([
                'status'  => false,
                'message' => 'Only Sourcing Required products can be marked sourced',
            ], 422);
        }

        // B24: idempotency gate. Calling this endpoint twice in a row
        // used to silently succeed both times, masking double-submits
        // (which often signal a UI bug worth surfacing). Return 409 on
        // the second call so the client can detect and stop retrying.
        if ($row->procurement_done) {
            return response()->json([
                'status'  => false,
                'message' => 'This product is already marked sourced.',
                'data'    => [
                    'id'               => $row->id,
                    'sourcing_status'  => $row->sourcing_status,
                    'procurement_done' => true,
                ],
            ], 409);
        }

        // Mirror IDIMS: cannot mark sourced unless a procurement has been
        // created for this row (Sourcing Required + procurement linked).
        $hasProcurement = ProcurementProduct::where('lead_product_id', $row->id)->exists();
        if (!$hasProcurement) {
            return response()->json([
                'status'  => false,
                'message' => 'Create a procurement for this product before marking it sourced',
            ], 422);
        }

        $row->update(['procurement_done' => true]);

        return response()->json(['status' => true, 'data' => [
            'id'               => $row->id,
            'sourcing_status'  => $row->sourcing_status,
            'procurement_done' => true,
        ]]);
    }

    /* ═════════════════════════════════════════════════════════════════
     *  STAGE 4 — PRICE SHARED
     *
     *  POST   /sales/leads/{lead}/products/{mapping}/shared-prices
     *           record a quoted price entry (append-only history)
     *  GET    /sales/leads/{lead}/shared-prices
     *           flat history list across all products on this lead
     *  GET    /sales/leads/{lead}/products/{mapping}/shared-prices
     *           history scoped to a single product mapping
     *  GET    /sales/shared-prices/{id}/pdf
     *           generate the quotation PDF (dompdf)
     * ═════════════════════════════════════════════════════════════════ */

    public function storeSharedPrice(Request $request, int $leadId, int $mappingId)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $row = LeadProduct::with('product:id,status')
            ->where('lead_id', $lead->id)
            ->findOrFail($mappingId);

        // Mirror IDIMS: incomplete product masters (draft / inactive) can't
        // have a shared price recorded. The frontend disables the input but
        // we double-check server-side so direct API hits don't slip past.
        $productStatus = strtolower((string) ($row->product?->status ?? ''));
        if (in_array($productStatus, ['draft', 'inactive', 'pending'], true)) {
            return response()->json([
                'status'  => false,
                'message' => 'Cannot share a price for an incomplete product. Activate it on the Product Master first.',
            ], 422);
        }

        $data = $request->validate([
            // B12: zero quoted price would render "₹ 0.00" to the customer.
            // gt:0 forces a real number; if a free sample is intended, that
            // belongs in a separate "complimentary" flag, not the price.
            'quoted_price' => 'required|numeric|gt:0',
        ]);

        $entry = LeadProductSharedPrice::create([
            'client_id'       => $user->client_id,
            'lead_id'         => $lead->id,
            'lead_product_id' => $row->id,
            'quoted_price'    => $data['quoted_price'],
            'shared_at'       => now(),
            'created_by'      => $user->id,
        ]);

        return response()->json([
            'status' => true,
            'data'   => $entry->load('creator:id,name'),
        ], 201);
    }

    public function listSharedPrices(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $rows = LeadProductSharedPrice::with([
            'leadProduct:id,product_id,currency,quantity,target_price',
            'leadProduct.product:id,product_code,name,status',
        ])
            ->where('lead_id', $lead->id)
            // Defense-in-depth: the lead-scope check above already rejects
            // cross-tenant leadIds, but if a shared-price row ever drifted
            // to the wrong client_id (data corruption / bad backfill), the
            // extra filter here keeps it from leaking out.
            ->when($user->client_id, fn ($q) => $q->where('client_id', $user->client_id))
            ->orderByDesc('shared_at')
            ->get()
            ->map(fn ($e) => [
                'id'              => $e->id,
                'lead_product_id' => $e->lead_product_id,
                'product_id'      => $e->leadProduct?->product_id,
                'product_code'    => $e->leadProduct?->product?->product_code,
                'product_name'    => $e->leadProduct?->product?->name,
                'product_status'  => $e->leadProduct?->product?->status,
                'currency'        => $e->leadProduct?->currency,
                'quantity'        => $e->leadProduct?->quantity,
                'target_price'    => $e->leadProduct?->target_price,
                'quoted_price'    => $e->quoted_price,
                'shared_at'       => $e->shared_at,
            ]);

        return response()->json(['status' => true, 'data' => $rows]);
    }

    public function listSharedPricesByProduct(Request $request, int $leadId, int $mappingId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $product = LeadProduct::where('lead_id', $lead->id)->findOrFail($mappingId);

        $rows = LeadProductSharedPrice::where('lead_id', $lead->id)
            ->where('lead_product_id', $product->id)
            // Defense-in-depth tenant filter — see listSharedPrices comment.
            ->when($user->client_id, fn ($q) => $q->where('client_id', $user->client_id))
            ->orderByDesc('shared_at')
            ->get()
            ->map(fn ($e) => [
                'id'           => $e->id,
                'quoted_price' => $e->quoted_price,
                'shared_at'    => $e->shared_at,
            ]);

        return response()->json([
            'status' => true,
            'data'   => $rows,
            'product' => [
                'lead_product_id' => $product->id,
                'currency'        => $product->currency,
                'quantity'        => $product->quantity,
                'target_price'    => $product->target_price,
            ],
        ]);
    }

    public function sharedPricePdf(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $entry = LeadProductSharedPrice::with([
            'lead:id,opp_code,unique_query_id,sender_name,sender_email,sender_mobile',
            'lead.customer:id,company_name,customer_code',
            'leadProduct:id,product_id,currency,quantity,target_price',
            'leadProduct.product:id,product_code,name',
            'creator:id,name',
        ])
            ->where('client_id', $user->client_id)
            ->findOrFail($id);

        // Tenant branding — every PDF is stamped with the caller's client
        // org details (logo, address, GST/PAN/CIN, website) so each tenant
        // gets a branded quotation document.
        $client = \App\Models\Client::find($entry->client_id);

        // Code-128 barcode encoding the quotation code (Q-#####). milon/barcode
        // returns an HTML string we can embed inline in the Blade.
        $quoteCode = 'Q-' . str_pad((string) $entry->id, 5, '0', STR_PAD_LEFT);
        $barcodeHtml = '';
        try {
            $generator = new \Milon\Barcode\DNS1D();
            $barcodeHtml = $generator->getBarcodeHTML($quoteCode, 'C128', 1.4, 30);
        } catch (\Throwable $e) {
            $barcodeHtml = ''; // PDF still renders without the barcode
        }

        $pdf = Pdf::loadView('pdf.shared_price_quotation', [
            'entry'       => $entry,
            'client'      => $client,
            'quoteCode'   => $quoteCode,
            'barcodeHtml' => $barcodeHtml,
            'inline'      => $request->boolean('inline'),
        ])->setPaper('a4');

        $filename = 'quotation_' . str_pad((string) $entry->id, 5, '0', STR_PAD_LEFT) . '.pdf';

        return $request->boolean('inline')
            ? $pdf->stream($filename)
            : $pdf->download($filename);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  LEAD PRODUCTcheS — POST /sales/leads/{lead}/products
     *
     *  Map a product master to this lead. The composite unique on
     *  (lead_id, product_id) prevents duplicates; the controller pre-
     *  checks so the user gets a friendly 422 rather than a 500.
     * ───────────────────────────────────────────────────────────────── */
    public function storeLeadProduct(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $data = $request->validate([
            'product_id'   => 'required|integer|exists:products,id',
            // Currency stored as free-form code (USD, INR, EUR …). No
            // length cap because the lock-banner pre-fills the value
            // from existing rows and a longer string shouldn't fail
            // the save — the column itself takes whatever fits.
            'currency'     => 'nullable|string',
            'quantity'     => 'nullable|numeric|min:0',
            'target_price' => 'nullable|numeric|min:0',
            'notes'        => 'nullable|string|max:1000',
        ]);

        $dupe = LeadProduct::where('lead_id', $lead->id)
            ->where('product_id', $data['product_id'])
            ->exists();
        if ($dupe) {
            return response()->json([
                'status'  => false,
                'message' => 'This product is already mapped to the lead — edit the existing row instead',
            ], 422);
        }

        /* Single-currency-per-lead rule. Every LeadProduct row on the
         * same lead must share one currency — mixing INR + USD on the
         * same opportunity breaks every downstream total (shared price
         * PDF, quotation, PI, shipment) because we have no FX rate to
         * collapse them. The first product mapped sets the currency;
         * later additions are pinned to it. */
        $lockedCurrency = LeadProduct::where('lead_id', $lead->id)
            ->whereNotNull('currency')
            ->value('currency');
        $picked = $data['currency'] ?? null;
        if ($lockedCurrency && $picked && strtoupper($picked) !== strtoupper($lockedCurrency)) {
            return response()->json([
                'status'  => false,
                'message' => "This opportunity is already using {$lockedCurrency}. All products on a lead must share one currency — remove the existing rows first if you want to switch.",
                'locked_currency' => $lockedCurrency,
            ], 422);
        }
        /* Default to the locked currency when the client didn't send one,
         * otherwise fall back to USD (the pre-existing default). */
        $effectiveCurrency = $picked ?? $lockedCurrency ?? 'USD';

        $row = LeadProduct::create([
            'client_id'    => $user->client_id,
            'lead_id'      => $lead->id,
            'product_id'   => $data['product_id'],
            'currency'     => $effectiveCurrency,
            'quantity'     => $data['quantity']     ?? null,
            'target_price' => $data['target_price'] ?? null,
            'notes'        => $data['notes']        ?? null,
            'created_by'   => $user->id,
        ]);

        return response()->json(['status' => true, 'data' => $row->fresh(['product:id,product_code,name'])], 201);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  LEAD PRODUCTS — PUT /sales/leads/{lead}/products/{mapping}
     *
     *  Update the quantity / target price / currency / notes for a
     *  mapping. The product itself is immutable — to swap products
     *  the user removes this row and adds a new one.
     * ───────────────────────────────────────────────────────────────── */
    public function updateLeadProduct(Request $request, int $leadId, int $mappingId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $row = LeadProduct::where('lead_id', $lead->id)->findOrFail($mappingId);

        $data = $request->validate([
            // No max length on currency — see storeLeadProduct above.
            'currency'     => 'nullable|string',
            'quantity'     => 'nullable|numeric|min:0',
            'target_price' => 'nullable|numeric|min:0',
            'notes'        => 'nullable|string|max:1000',
        ]);

        /* Same single-currency-per-lead rule as storeLeadProduct, but
         * on edit. Allowed transitions:
         *   • This is the ONLY mapping on the lead → free to change.
         *   • Otherwise the picked currency must match every OTHER
         *     mapping's currency on the same lead.
         * Set the field to null/empty to leave currency unchanged. */
        if (array_key_exists('currency', $data) && $data['currency'] !== null && $data['currency'] !== '') {
            $picked = strtoupper($data['currency']);
            $others = LeadProduct::where('lead_id', $lead->id)
                ->where('id', '!=', $row->id)
                ->whereNotNull('currency')
                ->pluck('currency')
                ->map(fn ($c) => strtoupper((string) $c))
                ->unique()
                ->values();
            if ($others->isNotEmpty() && !$others->contains($picked)) {
                return response()->json([
                    'status'  => false,
                    'message' => "This opportunity already uses {$others->first()}. All products on a lead must share one currency — change the other rows first or remove them.",
                    'locked_currency' => $others->first(),
                ], 422);
            }
            $data['currency'] = $picked;
        }

        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh(['product:id,product_code,name'])]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  LEAD PRODUCTS — DELETE /sales/leads/{lead}/products/{mapping}
     * ───────────────────────────────────────────────────────────────── */
    public function destroyLeadProduct(Request $request, int $leadId, int $mappingId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $row = LeadProduct::where('lead_id', $lead->id)->findOrFail($mappingId);
        $row->delete();

        return response()->json(['status' => true, 'message' => 'Product unmapped']);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  ACKNOWLEDGEMENTS — GET /sales/leads/{lead}/acknowledgements
     *
     *  Activity log feed for the Stage 2 Activity Report card. Rows
     *  come back newest-first thanks to the hasMany scope on the Lead
     *  model. Tenant-scoped via applyScope().
     * ───────────────────────────────────────────────────────────────── */
    public function listAcknowledgements(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $rows = LeadAcknowledgement::where('lead_id', $lead->id)
            ->orderByDesc('id')
            ->get();

        return response()->json(['status' => true, 'data' => $rows]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  ACKNOWLEDGEMENTS — POST /sales/leads/{lead}/acknowledgements
     *
     *  Bulk-creates Stage 2 activity rows for the picked master reasons.
     *  Body: { reason_ids: int[] }. All ids must share the same
     *  opportunity_type (qualified / disqualified / clarity_pending) —
     *  the Stage 2 modal opens one type at a time so this matches the UX.
     *
     *  Side effect: the lead's `qualified` / `disqualified` flags are
     *  flipped to mirror the submitted bucket so the worksheet's
     *  Qualified / Disqualified tabs stay in sync without a separate
     *  call. lead_stage_id is left alone — advancing to Stage 3 is the
     *  caller's job via PUT /sales/leads/{id}.
     * ───────────────────────────────────────────────────────────────── */
    public function storeAcknowledgements(Request $request, int $leadId)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => false, 'message' => 'No client tenant on user'], 422);
        }

        $leadQ = Lead::query();
        $this->applyScope($leadQ, $user);
        $lead = $leadQ->findOrFail($leadId);

        $data = $request->validate([
            'reason_ids'   => 'required|array|min:1',
            'reason_ids.*' => 'integer',
        ]);

        $reasons = LeadAckReason::where('client_id', $user->client_id)
            ->whereIn('id', $data['reason_ids'])
            ->get();

        if ($reasons->count() !== count($data['reason_ids'])) {
            return response()->json([
                'status'  => false,
                'message' => 'One or more reasons are unavailable for this tenant',
            ], 422);
        }

        // All picked reasons must belong to the same opportunity bucket.
        // The frontend modal enforces this; the backend gates it again.
        $types = $reasons->pluck('opportunity_type')->unique();
        if ($types->count() !== 1) {
            return response()->json([
                'status'  => false,
                'message' => 'All picked reasons must belong to the same opportunity bucket',
            ], 422);
        }
        $type = $types->first();

        $created = DB::transaction(function () use ($lead, $reasons, $type, $user) {
            $rows = [];
            foreach ($reasons as $r) {
                $rows[] = LeadAcknowledgement::create([
                    'client_id'         => $user->client_id,
                    'lead_id'           => $lead->id,
                    'lead_ack_reason_id'=> $r->id,
                    'opportunity_type'  => $r->opportunity_type,
                    'dq_status'         => $r->dq_status,
                    'reason_snapshot'   => $r->reason,
                    'created_by'        => $user->id,
                ]);
            }

            // Mirror the latest bucket onto the lead so the worksheet
            // tabs and counts reflect the new state immediately.
            $lead->update([
                'qualified'          => $type === LeadAckReason::TYPE_QUALIFIED,
                'disqualified'       => $type === LeadAckReason::TYPE_DISQUALIFIED,
                'lead_ack_reason_id' => $reasons->first()->id,
            ]);

            return $rows;
        });

        return response()->json([
            'status'        => true,
            'message'       => 'Acknowledgement(s) recorded',
            'created_count' => count($created),
            'data'          => array_map(fn ($r) => $r->fresh(), $created),
            'lead'          => $lead->fresh()->only(['id', 'qualified', 'disqualified', 'lead_stage_id', 'lead_ack_reason_id']),
        ], 201);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  SALESPERSON SUMMARY — GET /sales/leads/salesperson-summary
     *
     *  Powers the Lead-Distribution table inside the "Assigned Leads"
     *  modal. Returns:
     *    - summary    : { total_sales_persons, total_leads, assigned, unassigned }
     *    - platforms  : distinct platforms seen across this tenant's leads
     *    - data       : one row per salesperson, with employee-record
     *                   enrichment (department / designation / primary
     *                   & ancillary role / reporting manager) so the
     *                   table can render the chip-driven layout
     *
     *  Tenant-scoped via applyScope().
     * ───────────────────────────────────────────────────────────────── */
    public function salespersonSummary(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // ── 1) Lead counts pivoted per (salesperson, platform).
        $countsQ = Lead::query()
            ->whereNotNull('salesperson_id')
            ->selectRaw('salesperson_id, platform, COUNT(*) AS cnt')
            ->groupBy('salesperson_id', 'platform');
        $this->applyScope($countsQ, $user);
        $countRows = $countsQ->get();

        $platforms = $countRows->pluck('platform')->filter()->unique()->sort()->values()->all();

        $perUser = [];   // salesperson_id => ['platform_counts' => [...], 'total' => N]
        foreach ($countRows as $r) {
            $uid = (int) $r->salesperson_id;
            if (!isset($perUser[$uid])) {
                $perUser[$uid] = ['platform_counts' => array_fill_keys($platforms, 0), 'total' => 0];
            }
            $platform = $r->platform ?? 'Unknown';
            $perUser[$uid]['platform_counts'][$platform] = (int) $r->cnt;
            $perUser[$uid]['total']                     += (int) $r->cnt;
        }

        // ── 2) Aggregate stats for the 4 header cards.
        $totalsQ = Lead::query();
        $this->applyScope($totalsQ, $user);
        $totalsRow = $totalsQ->selectRaw(
            "COUNT(*) AS total_all,
             SUM(CASE WHEN salesperson_id IS NOT NULL THEN 1 ELSE 0 END) AS total_assigned,
             SUM(CASE WHEN salesperson_id IS NULL THEN 1 ELSE 0 END) AS total_unassigned"
        )->first();

        // ── 3) Salespeople roster — every user the tenant can assign
        // leads to (mirrors GET /sales/leads/salespeople scope), enriched
        // with the corresponding employee profile when one exists. The
        // table shows zero-lead salespeople too so the user can see the
        // whole team at a glance.
        $usersQ = User::query()
            ->whereIn('user_type', ['client_admin', 'client_user', 'branch_user', 'employee'])
            ->where('status', 'active');

        if ($user->user_type !== 'super_admin') {
            $usersQ->where('client_id', $user->client_id);
            $isMain = $user->branch?->is_main ?? false;
            if ($user->user_type === 'branch_user' && !$isMain) {
                $usersQ->where(function ($w) use ($user) {
                    $w->whereNull('branch_id')->orWhere('branch_id', $user->branch_id);
                });
            }
        }

        $users = $usersQ->orderBy('name')->get(['id', 'name', 'designation', 'user_type', 'email']);

        // Pull employee profiles for those users in one query (linked via
        // employees.user_id). Eager-load the four relations we need so the
        // shape stays predictable even when a relation is missing.
        $userIds = $users->pluck('id')->all();
        $employees = Employee::whereIn('user_id', $userIds)
            ->with([
                'department:id,name',
                'designation:id,name',
                'primaryRole:id,name',
                'ancillaryRole:id,name',
                'reportingManager:id,first_name,last_name,display_name',
            ])
            ->get()
            ->keyBy('user_id');

        $data = [];
        foreach ($users as $u) {
            $emp     = $employees->get($u->id);
            $counts  = $perUser[$u->id]['platform_counts'] ?? array_fill_keys($platforms, 0);
            $total   = $perUser[$u->id]['total']           ?? 0;

            $mgr = $emp?->reportingManager;
            $mgrName = $mgr
                ? trim($mgr->display_name ?: trim(($mgr->first_name ?? '') . ' ' . ($mgr->last_name ?? '')))
                : null;

            $data[] = [
                'salesperson_id'        => $u->id,
                'salesperson_name'      => $emp
                    ? trim($emp->display_name ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? '')))
                    : ($u->name ?: '—'),
                'salesperson_code'      => $emp?->emp_code ?: ('EMP-' . str_pad((string) $u->id, 3, '0', STR_PAD_LEFT)),
                'department'            => $emp?->department?->name,
                'designation'           => $emp?->designation?->name ?: ($u->designation ?: null),
                'primary_role'          => $emp?->primaryRole?->name,
                'ancillary_role'        => $emp?->ancillaryRole?->name,
                'reporting_manager'     => $mgrName,
                'email'                 => $u->email,
                'platform_counts'       => $counts,
                'total_assigned_leads'  => $total,
            ];
        }

        // Stable order: most loaded first, then by name. Keeps the
        // top-performers visible above the fold.
        usort($data, function ($a, $b) {
            $diff = $b['total_assigned_leads'] - $a['total_assigned_leads'];
            return $diff !== 0 ? $diff : strcmp($a['salesperson_name'], $b['salesperson_name']);
        });

        return response()->json([
            'status'    => true,
            'summary'   => [
                'total_sales_persons' => $users->count(),
                'total_leads'         => (int) ($totalsRow->total_all        ?? 0),
                'assigned_leads'      => (int) ($totalsRow->total_assigned   ?? 0),
                'unassigned_leads'    => (int) ($totalsRow->total_unassigned ?? 0),
            ],
            'platforms' => $platforms,
            'data'      => $data,
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

        /* P1: previously this loop fired one extra SELECT per distinct
         * ISO code to resolve the human-readable country name. A tenant
         * with 20 countries paid 20 round-trips just to render the
         * Filter modal. Bulk-resolve the ISO→name map in a single
         * grouped query, then lookup in PHP. */
        $isoCodes = (clone $base)
            ->select('sender_country_iso')
            ->whereNotNull('sender_country_iso')
            ->groupBy('sender_country_iso')
            ->orderBy('sender_country_iso')
            ->pluck('sender_country_iso');

        $nameByIso = (clone $base)
            ->whereIn('sender_country_iso', $isoCodes)
            ->whereNotNull('sender_country_name')
            ->select('sender_country_iso', 'sender_country_name')
            ->groupBy('sender_country_iso', 'sender_country_name')
            ->pluck('sender_country_name', 'sender_country_iso')
            ->all();

        $countries = $isoCodes
            ->map(function ($iso) use ($nameByIso) {
                $name = $nameByIso[$iso] ?? self::ISO_COUNTRY_NAMES[$iso] ?? $iso;
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
                            'code'  => $c->customer_code,
                        ])
                        ->values();

        return response()->json([
            'status'      => true,
            'platforms'   => $platforms,
            'query_types' => $queryTypes,
            'countries'   => $countries,
            'customers'   => $customers,
            // Filter exposes only the 6 canonical Sales Matrix stages defined
            // in CLAUDE.md. The Pre-PI CLM (5) and Post-PI CLM (7) checkpoints
            // are kept in DB for historical leads but excluded here so the
            // filter UI stays aligned with the visible pipeline.
            'stages'      => [
                ['value' => '1', 'label' => 'Inquiry Required'],
                ['value' => '2', 'label' => 'Lead Acknowledgement'],
                ['value' => '3', 'label' => 'Product Sourcing'],
                ['value' => '4', 'label' => 'Price Shared'],
                ['value' => '6', 'label' => 'Quotation vs PI'],
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
