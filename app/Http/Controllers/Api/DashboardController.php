<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Models\Attendance;
use App\Models\Branch;
use App\Models\Client;
use App\Models\ClmAgreementLibrary;
use App\Models\ClmClauseLibrary;
use App\Models\ClmDdDocument;
use App\Models\ClmKycDocument;
use App\Models\ClmQcDocument;
use App\Models\ClmSegment;
use App\Models\ClmSignatureRequest;
use App\Models\ClmTncLibrary;
use App\Models\ClmTradeDocLibrary;
use App\Models\ClmTradeLicense;
use App\Models\Employee;
use App\Models\ExpenseClaim;
use App\Models\Lead;
use App\Models\LeaveRequest;
use App\Models\Module;
use App\Models\Payment;
use App\Models\Permission;
use App\Models\Plan;
use App\Models\Product;
use App\Models\ProformaInvoice;
use App\Models\Quotation;
use App\Models\User;
use App\Models\Vendor;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function adminStats()
    {
        // Server-side cache (60-second TTL) — admin-stats is global and
        // every super_admin viewing it sees the same numbers, so a single
        // shared cache entry serves all of them without per-user fanout.
        // 60-second TTL matches the frontend sessionStorage TTL so the
        // server-cache window roughly aligns with the browser-cache window
        // and the stale-data divergence stays bounded.
        return response()->json(Cache::remember('dashboard:admin-stats', now()->addSeconds(60), function () {
            return $this->computeAdminStats();
        }));
    }

    /**
     * Compute the admin-stats payload. Extracted so Cache::remember can
     * wrap the heavy work without changing the response shape — handlers
     * that need bypass-cache paths can call this directly.
     */
    private function computeAdminStats(): array
    {
        // Core counts
        $totalClients = Client::count();
        $activeClients = Client::where('status', 'active')->count();
        $inactiveClients = Client::where('status', '!=', 'active')->count();
        $totalUsers = User::count();
        /* Exclude the auto-provisioned "Head Office" placeholder (code='HO')
         * from the branches KPI — every Client is seeded with one HO row
         * on creation that doesn't represent a real operational branch.
         * Counting it inflated the KPI by one per client and contradicted
         * the Branches page (which already filters HO out). Mirrors the
         * branches_count subquery used for the Recent Clients block. */
        $totalBranches = Branch::query()
            ->where(function ($q) {
                $q->where('code', '!=', 'HO')
                  ->orWhere('name', 'not ilike', '% — Head Office');
            })
            ->count();

        // Revenue
        $totalRevenue = (float) Payment::where('status', 'success')->sum('total');
        $monthlyRevenue = (float) Payment::where('status', 'success')
            ->where('created_at', '>=', now()->startOfMonth())
            ->sum('total');

        // Payments — "Transactions" KPI excludes failed rows so it reads
        // as "completed-or-in-flight transactions" and lines up with the
        // revenue figures next to it. Previously this counted every
        // Payment row regardless of status, so a tenant with several
        // failed retries saw the Transactions tile inflate while
        // revenue stayed flat. failedPayments stays surfaced separately
        // for the dedicated Failed tile.
        $totalPayments = Payment::whereIn('status', ['success', 'pending'])->count();
        $successPayments = Payment::where('status', 'success')->count();
        $pendingPayments = Payment::where('status', 'pending')->count();
        $failedPayments = Payment::where('status', 'failed')->count();

        // Plan distribution
        $planDistribution = Client::select('plan_type', DB::raw('count(*) as count'))
            ->groupBy('plan_type')
            ->get()
            ->mapWithKeys(fn($item) => [$item->plan_type => $item->count])
            ->toArray();

        // Plan breakdown by name
        $planBreakdown = Client::leftJoin('plans', 'clients.plan_id', '=', 'plans.id')
            ->select(DB::raw("COALESCE(plans.name, 'Free') as plan_name"), DB::raw('count(*) as count'))
            ->groupBy('plan_name')
            ->orderByDesc('count')
            ->get()
            ->toArray();

        // Monthly revenue trend (last 6 months)
        $revenueTrend = [];
        for ($i = 5; $i >= 0; $i--) {
            $month = now()->subMonths($i);
            $revenue = (float) Payment::where('status', 'success')
                ->whereYear('created_at', $month->year)
                ->whereMonth('created_at', $month->month)
                ->sum('total');
            $count = Payment::where('status', 'success')
                ->whereYear('created_at', $month->year)
                ->whereMonth('created_at', $month->month)
                ->count();
            $revenueTrend[] = [
                'month' => $month->format('M Y'),
                'short' => $month->format('M'),
                'revenue' => $revenue,
                'count' => $count,
            ];
        }

        // Client growth (last 6 months)
        $clientGrowth = [];
        for ($i = 5; $i >= 0; $i--) {
            $month = now()->subMonths($i);
            $count = Client::whereYear('created_at', $month->year)
                ->whereMonth('created_at', $month->month)
                ->count();
            $clientGrowth[] = [
                'month' => $month->format('M'),
                'clients' => $count,
            ];
        }

        // User type distribution
        $userTypes = User::select('user_type', DB::raw('count(*) as count'))
            ->groupBy('user_type')
            ->get()
            ->mapWithKeys(fn($item) => [$item->user_type => $item->count])
            ->toArray();

        // Recent clients (top 5) — exclude the auto-created "Head Office"
        // placeholder so the branch count matches the Branches page.
        $recentClients = Client::with('plan:id,name')
            ->withCount([
                'branches as branches_count' => function ($q) {
                    $q->where(function ($inner) {
                        $inner->where('code', '!=', 'HO')
                              ->orWhere('name', 'not ilike', '% — Head Office');
                    });
                },
                'users',
            ])
            ->orderByDesc('created_at')
            ->limit(5)
            /* `profile_photo` selected so the appended `profile_photo_url`
             * accessor resolves to a real URL — that drives the new logo
             * thumb on the Super Admin → Recent Clients card. Without
             * this the accessor only saw a null and the dashboard kept
             * falling back to gradient initials even when a client had
             * uploaded a logo. */
            ->get(['id', 'org_name', 'email', 'status', 'plan_id', 'plan_type', 'created_at', 'profile_photo']);

        // Recent payments (top 5)
        $recentPayments = Payment::with(['client:id,org_name', 'plan:id,name'])
            ->orderByDesc('created_at')
            ->limit(5)
            ->get(['id', 'client_id', 'plan_id', 'total', 'status', 'method', 'invoice_number', 'created_at']);

        // Top clients by revenue
        $topClients = Payment::where('status', 'success')
            ->select('client_id', DB::raw('SUM(total) as total_revenue'), DB::raw('COUNT(*) as payments_count'))
            ->groupBy('client_id')
            ->orderByDesc('total_revenue')
            ->limit(5)
            ->with('client:id,org_name')
            ->get();

        // Org type distribution
        $orgTypes = Client::select('org_type', DB::raw('count(*) as count'))
            ->groupBy('org_type')
            ->orderByDesc('count')
            ->get()
            ->toArray();

        // ── SaaS subscription metrics — the platform-owner view: MRR / ARR /
        // ARPU, active subscriptions, signups, and renewal health. Plan
        // prices are normalised to a monthly figure so mixed billing cycles
        // sum into a single comparable MRR. ──────────────────────────────────
        $toMonthly = function ($price, $period): float {
            $price = (float) $price;
            $p = strtolower((string) $period);
            if (str_contains($p, 'year') || str_contains($p, 'annual')) return $price / 12;
            if (str_contains($p, 'quarter')) return $price / 3;
            if (str_contains($p, 'week')) return $price * 4.345;
            return $price; // monthly / default
        };
        $now = now();
        $mrr = 0.0;
        $payingClients = 0;
        $expiringSoon = 0;   // active sub expiring within 30 days
        $expiredSubs = 0;    // plan end date already past
        $mrrByPlan = [];
        Client::with('plan:id,name,price,period')
            ->where('status', 'active')
            ->whereNotNull('plan_id')
            ->get(['id', 'plan_id', 'plan_expires_at'])
            ->each(function ($c) use (&$mrr, &$payingClients, &$expiringSoon, &$expiredSubs, &$mrrByPlan, $toMonthly, $now) {
                $price = (float) ($c->plan->price ?? 0);
                if ($price > 0) {
                    $m = $toMonthly($price, $c->plan->period ?? 'month');
                    $mrr += $m;
                    $payingClients++;
                    $pname = $c->plan->name ?? 'Other';
                    $mrrByPlan[$pname] = ($mrrByPlan[$pname] ?? 0) + $m;
                }
                if ($c->plan_expires_at) {
                    if ($c->plan_expires_at->lt($now)) $expiredSubs++;
                    elseif ($c->plan_expires_at->lte($now->copy()->addDays(30))) $expiringSoon++;
                }
            });
        $arr  = $mrr * 12;
        $arpu = $payingClients > 0 ? $mrr / $payingClients : 0;

        $newThisMonth = Client::where('created_at', '>=', $now->copy()->startOfMonth())->count();
        $newLastMonth = Client::whereBetween('created_at', [
            $now->copy()->subMonthNoOverflow()->startOfMonth(),
            $now->copy()->startOfMonth(),
        ])->count();
        $signupGrowth = $newLastMonth > 0
            ? (int) round((($newThisMonth - $newLastMonth) / $newLastMonth) * 100)
            : ($newThisMonth > 0 ? 100 : 0);

        // Rough churn proxy — expired subscriptions as a share of all clients.
        $churnRate = $totalClients > 0 ? round(($expiredSubs / $totalClients) * 100, 1) : 0;

        $mrrByPlanRows = [];
        foreach ($mrrByPlan as $name => $amount) {
            $mrrByPlanRows[] = ['plan' => $name, 'mrr' => round($amount, 2)];
        }
        usort($mrrByPlanRows, fn ($a, $z) => $z['mrr'] <=> $a['mrr']);

        return [
            'plan_distribution' => $planDistribution,
            'saas' => [
                'mrr'                  => round($mrr, 2),
                'arr'                  => round($arr, 2),
                'arpu'                 => round($arpu, 2),
                'paying_clients'       => $payingClients,
                'free_clients'         => max(0, $totalClients - $payingClients),
                'active_subscriptions' => $payingClients,
                'new_this_month'       => $newThisMonth,
                'new_last_month'       => $newLastMonth,
                'signup_growth'        => $signupGrowth,
                'expiring_soon'        => $expiringSoon,
                'expired'              => $expiredSubs,
                'churn_rate'           => $churnRate,
                'mrr_by_plan'          => $mrrByPlanRows,
            ],
            'counts' => [
                'total_clients' => $totalClients,
                'active_clients' => $activeClients,
                'inactive_clients' => $inactiveClients,
                'total_users' => $totalUsers,
                'total_branches' => $totalBranches,
                'total_payments' => $totalPayments,
                'success_payments' => $successPayments,
                'pending_payments' => $pendingPayments,
                'failed_payments' => $failedPayments,
            ],
            'revenue' => [
                'total' => $totalRevenue,
                'monthly' => $monthlyRevenue,
            ],
            'plan_distribution' => $planDistribution,
            'plan_breakdown' => $planBreakdown,
            'revenue_trend' => $revenueTrend,
            'client_growth' => $clientGrowth,
            'user_types' => $userTypes,
            'org_types' => $orgTypes,
            'recent_clients' => $recentClients,
            'recent_payments' => $recentPayments,
            'top_clients' => $topClients,
        ];
    }

    public function clientStats(Request $request)
    {
        $user = $request->user();
        $clientId = $user->client_id;

        if (!$clientId) {
            return response()->json(['message' => 'No client associated'], 422);
        }

        // Resolve & validate branch_id filter (always scoped within this
        // user's client). We do the validation HERE — before building the
        // cache key — so the cache key reflects the actual data slice being
        // computed. If a user passes a cross-tenant branch_id=99 it gets
        // normalised to null before keying, preventing a "data for null"
        // payload from being cached under ':branch:99'.
        $branchId = $request->integer('branch_id') ?: null;
        if ($branchId && !Branch::where('client_id', $clientId)->where('id', $branchId)->exists()) {
            $branchId = null;
        }
        // Sub-branch user lock — overrides the caller-supplied branch_id
        // so the cache key matches the data the user is actually allowed
        // to see. Sentinel value -1 (no rows match) prevents the cache from
        // ever storing the "no userBranch" case under a real branch id.
        $userBranch = null;
        if ($user->user_type === 'branch_user') {
            $userBranch = $user->branch_id
                ? Branch::where('client_id', $clientId)->find($user->branch_id)
                : null;
            if (!$userBranch) {
                $branchId = -1;
            } else {
                // Every branch is an isolated peer — a branch user is always
                // pinned to their own branch.
                $branchId = $user->branch_id;
            }
        }

        // Server-side cache (60-second TTL) — key includes the canonical
        // client_id + validated branch_id + user_type so different tenants,
        // branches, and role views each get their own cache entry. The
        // user_type segment in the key matters because $canViewPayments
        // differs between client admins and branch users, so caching
        // across roles would leak revenue numbers to branch users.
        $cacheKey = 'dashboard:client-stats:' . $clientId
            . ':branch:' . ($branchId ?? 'all')
            . ':role:' . $user->user_type;
        return response()->json(Cache::remember($cacheKey, now()->addSeconds(60), function () use ($request, $clientId, $branchId, $userBranch) {
            return $this->computeClientStats($request, $clientId, $branchId, $userBranch);
        }));
    }

    /**
     * Compute the client-stats payload. Extracted so Cache::remember can
     * wrap the heavy work and downstream tests / preview tooling can
     * bypass the cache by calling this directly. $branchId and $userBranch
     * are already validated by the caller — see clientStats().
     */
    private function computeClientStats(Request $request, int $clientId, ?int $branchId, ?Branch $userBranch): array
    {
        $user = $request->user();

        // Payment data is billing-level info — only the client admin should
        // see actual amounts and history. Branch users get zeros / empty so
        // the dashboard doesn't leak revenue / invoice numbers across the org
        // (every branch is an isolated peer).
        $canViewPayments = $user->user_type !== 'branch_user';

        $client = Client::with('plan')->find($clientId);

        // Branches — always count via the actual query so a non-existent / sentinel id (-1) returns 0.
        // Exclude the auto-created Head Office branch (code='HO') so the KPI
        // shows only user-created branches (matches Clients list + show()).
        $branchesBase = fn() => Branch::where('client_id', $clientId)
            ->where('code', '!=', 'HO')
            ->when($branchId, fn($q) => $q->where('id', $branchId));
        $totalBranches = $branchesBase()->count();
        $activeBranches = $branchesBase()->where('status', 'active')->count();

        // Users — scoped by branch when filter active.
        //
        // Total counts include soft-deleted rows so deactivating a branch
        // (which cascades soft-deletes onto its users) doesn't make the
        // KPI silently drop. "Active" stays strict — only rows that are
        // alive AND status=active are counted, which mirrors who can
        // actually sign in. Without `withTrashed()` on totals, a tenant
        // that had 10 users would visibly lose them all the moment a
        // branch was deactivated, which is what surfaced as "the KPI
        // doesn't count after inactivating a branch".
        $usersBase = fn() => User::withTrashed()->where('client_id', $clientId)
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId));
        $totalUsers = $usersBase()->count();
        $activeUsers = $usersBase()
            ->whereNull('deleted_at')
            ->where('status', 'active')
            ->count();

        // Payments are subscription-level (per client, not per branch). Show client-level
        // counts to client admins only — branch users get zeros so we don't
        // leak finance data through the dashboard.
        if ($canViewPayments) {
            $totalPayments = Payment::where('client_id', $clientId)->count();
            $successPayments = Payment::where('client_id', $clientId)->where('status', 'success')->count();
            $pendingPayments = Payment::where('client_id', $clientId)->where('status', 'pending')->count();
            $totalPaid = (float) Payment::where('client_id', $clientId)->where('status', 'success')->sum('total');
        } else {
            $totalPayments = 0;
            $successPayments = 0;
            $pendingPayments = 0;
            $totalPaid = 0.0;
        }

        // Plan info
        $planName = $client?->plan?->name ?? 'Free';
        $planExpiry = $client?->plan_expires_at;
        $daysRemaining = $planExpiry ? max(0, (int) now()->diffInDays($planExpiry, false)) : null;
        $planStatus = $planExpiry ? ($planExpiry->isPast() ? 'expired' : 'active') : 'no_plan';

        // Recent payments — restricted to roles allowed to see billing
        $recentPayments = $canViewPayments
            ? Payment::with('plan:id,name')
                ->where('client_id', $clientId)
                ->orderByDesc('created_at')
                ->limit(5)
                ->get(['id', 'plan_id', 'total', 'status', 'method', 'invoice_number', 'valid_from', 'valid_until', 'created_at'])
            : collect();

        // Branches list — full list when no filter, single-branch when filtered.
        // Excludes the auto-provisioned Head Office placeholder (code='HO')
        // so the Client Admin's dashboard list stays in sync with the
        // KPI count + the Branches page (both already filter HO out).
        // Previously this query returned HO so the list showed an extra
        // "— Head Office" row that didn't correspond to a real branch
        // anyone could open.
        $branches = Branch::where('client_id', $clientId)
            ->where('code', '!=', 'HO')
            ->when($branchId, fn($q) => $q->where('id', $branchId))
            ->withCount(['users', 'employees'])
            ->orderBy('name')
            ->get(['id', 'name', 'code', 'status', 'city', 'state', 'email', 'phone']);

        // Payment trend (last 6 months) — same gating as recent payments.
        // For restricted users we still emit month buckets with 0 amounts so
        // the chart axes render, but no revenue numbers leak through.
        $paymentTrend = [];
        for ($i = 5; $i >= 0; $i--) {
            $month = now()->subMonths($i);
            $amount = $canViewPayments
                ? (float) Payment::where('client_id', $clientId)
                    ->where('status', 'success')
                    ->whereYear('created_at', $month->year)
                    ->whereMonth('created_at', $month->month)
                    ->sum('total')
                : 0.0;
            $paymentTrend[] = [
                'month' => $month->format('M'),
                'amount' => $amount,
            ];
        }

        // User role breakdown — scoped to branch when filtered
        $userRoles = User::where('client_id', $clientId)
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId))
            ->select('user_type', DB::raw('count(*) as count'))
            ->groupBy('user_type')
            ->get()
            ->mapWithKeys(fn($item) => [$item->user_type => $item->count])
            ->toArray();

        // ── Employee analytics ──────────────────────────────────────────
        // Scope mirrors the user/branch counts above: a branch user is
        // pinned to their own branch (via the $branchId rewrite up top), a
        // client admin sees the whole client unless they pick a branch.
        // Count LIVE employees only (no withTrashed). A soft-deleted employee
        // is no longer current staff, so counting them — and worse, counting a
        // soft-deleted "Active" row as active — inflates the KPI and makes it
        // disagree with the per-branch headcount donut. Live-only keeps every
        // employee figure (total, active, status donut, by-branch) consistent.
        $empBase = fn() => Employee::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId));

        // Status counts (enum values are Title-Case in the migration).
        $empStatusRows = $empBase()
            ->select('status', DB::raw('count(*) as count'))
            ->groupBy('status')
            ->pluck('count', 'status')
            ->toArray();
        $empStatusLabels = ['Active', 'Inactive', 'On Leave', 'Probation', 'Notice Period', 'Resigned', 'Terminated'];
        $empStatus = [];
        foreach ($empStatusLabels as $label) {
            $empStatus[] = ['name' => $label, 'value' => (int) ($empStatusRows[$label] ?? 0)];
        }

        $totalEmployees    = (int) $empBase()->count();
        $activeEmployees   = (int) ($empStatusRows['Active'] ?? 0);
        $onLeaveEmployees  = (int) ($empStatusRows['On Leave'] ?? 0);
        $probationEmployees= (int) ($empStatusRows['Probation'] ?? 0);
        $noticeEmployees   = (int) ($empStatusRows['Notice Period'] ?? 0);
        $exitedEmployees   = (int) (($empStatusRows['Resigned'] ?? 0) + ($empStatusRows['Terminated'] ?? 0));

        // Hiring activity windows.
        $newJoinersMonth = (int) $empBase()
            ->whereNotNull('date_of_joining')
            ->where('date_of_joining', '>=', now()->startOfMonth())
            ->count();
        $newJoinersLast30 = (int) $empBase()
            ->whereNotNull('date_of_joining')
            ->where('date_of_joining', '>=', now()->subDays(30)->toDateString())
            ->count();

        // Gender split.
        $empGenderRows = $empBase()
            ->whereNotNull('gender')
            ->select('gender', DB::raw('count(*) as count'))
            ->groupBy('gender')
            ->pluck('count', 'gender')
            ->toArray();
        $empGender = [
            ['name' => 'Male',   'value' => (int) ($empGenderRows['Male']   ?? 0)],
            ['name' => 'Female', 'value' => (int) ($empGenderRows['Female'] ?? 0)],
            ['name' => 'Other',  'value' => (int) ($empGenderRows['Other']  ?? 0)],
        ];

        // Department headcount — top 8 by count, joined to master_departments
        // for the readable name. Employees with no department are folded into
        // an "Unassigned" bucket so they don't disappear from the total.
        // Tenant filters must be qualified because master_departments also
        // carries client_id / branch_id columns (multi-tenant masters).
        $empByDeptRows = Employee::query()
            ->leftJoin('master_departments', 'employees.department_id', '=', 'master_departments.id')
            ->where('employees.client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('employees.branch_id', $branchId))
            ->select(DB::raw("COALESCE(master_departments.name, 'Unassigned') as name"), DB::raw('count(*) as count'))
            ->groupBy('name')
            ->orderByDesc('count')
            ->limit(8)
            ->get()
            ->map(fn ($r) => ['name' => $r->name, 'count' => (int) $r->count])
            ->toArray();

        // Designation top 5 — useful "who's most of the org" signal.
        // INNER join + non-null name filter: orphaned designation_id FKs or
        // master rows with blank names just drop out of this chart rather
        // than rendering as "null".
        $empByDesigRows = Employee::query()
            ->join('master_designations', 'employees.designation_id', '=', 'master_designations.id')
            ->where('employees.client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('employees.branch_id', $branchId))
            ->whereNotNull('master_designations.name')
            ->where('master_designations.name', '!=', '')
            ->select(DB::raw('master_designations.name as name'), DB::raw('count(*) as count'))
            ->groupBy('master_designations.name')
            ->orderByDesc('count')
            ->limit(5)
            ->get()
            ->map(fn ($r) => ['name' => $r->name, 'count' => (int) $r->count])
            ->toArray();

        // Joining trend (last 6 months) — count rows whose date_of_joining
        // falls in each month bucket. Pre-seed all 6 buckets so the chart
        // axis is stable even for months with no hires.
        $joiningTrend = [];
        for ($i = 5; $i >= 0; $i--) {
            $month = now()->subMonths($i);
            $count = (int) $empBase()
                ->whereNotNull('date_of_joining')
                ->whereYear('date_of_joining', $month->year)
                ->whereMonth('date_of_joining', $month->month)
                ->count();
            $joiningTrend[] = ['month' => $month->format('M'), 'count' => $count];
        }

        // Tenure buckets — driven by date_of_joining vs today. Skip rows
        // with no joining date so the buckets sum to "joined" not "all".
        $tenureBuckets = ['<1 yr' => 0, '1-3 yr' => 0, '3-5 yr' => 0, '5-10 yr' => 0, '10+ yr' => 0];
        $tenureRows = $empBase()
            ->whereNotNull('date_of_joining')
            ->pluck('date_of_joining');
        foreach ($tenureRows as $d) {
            $years = Carbon::parse($d)->diffInYears(now());
            if ($years < 1)       $tenureBuckets['<1 yr']++;
            elseif ($years < 3)   $tenureBuckets['1-3 yr']++;
            elseif ($years < 5)   $tenureBuckets['3-5 yr']++;
            elseif ($years < 10)  $tenureBuckets['5-10 yr']++;
            else                  $tenureBuckets['10+ yr']++;
        }
        $tenure = collect($tenureBuckets)
            ->map(fn ($v, $k) => ['name' => $k, 'count' => $v])
            ->values()
            ->toArray();

        // Age buckets — driven by date_of_birth.
        $ageBuckets = ['18-25' => 0, '26-35' => 0, '36-45' => 0, '46-55' => 0, '56+' => 0];
        $ageRows = $empBase()
            ->whereNotNull('date_of_birth')
            ->pluck('date_of_birth');
        foreach ($ageRows as $d) {
            $age = Carbon::parse($d)->diffInYears(now());
            if ($age < 26)        $ageBuckets['18-25']++;
            elseif ($age < 36)    $ageBuckets['26-35']++;
            elseif ($age < 46)    $ageBuckets['36-45']++;
            elseif ($age < 56)    $ageBuckets['46-55']++;
            else                  $ageBuckets['56+']++;
        }
        $ageDistribution = collect($ageBuckets)
            ->map(fn ($v, $k) => ['name' => $k, 'count' => $v])
            ->values()
            ->toArray();

        // Average tenure (years) — uses the same population as the buckets
        // so empty/missing joining dates don't drag the average to zero.
        $avgTenureYears = 0.0;
        if ($tenureRows->isNotEmpty()) {
            $sum = 0.0;
            foreach ($tenureRows as $d) {
                $sum += Carbon::parse($d)->floatDiffInYears(now());
            }
            $avgTenureYears = round($sum / $tenureRows->count(), 1);
        }

        // Face-biometric enrollment progress.
        $facesRegistered = (int) $empBase()->whereNotNull('face_registered_at')->count();

        // Upcoming birthdays + work anniversaries in the next 30 days.
        // Same logic the employee dashboard uses — kept inline so this
        // endpoint stays self-contained.
        $today = Carbon::now();
        $rangeEnd = $today->copy()->addDays(30);
        $upcomingEvents = collect();
        $eventRows = $empBase()
            // Only active staff — exclude inactive / exited (resigned / terminated).
            ->whereNotIn('status', ['Inactive', 'Resigned', 'Terminated'])
            ->whereNotNull(DB::raw('COALESCE(date_of_birth, date_of_joining)'))
            ->get(['id', 'display_name', 'emp_code', 'date_of_birth', 'date_of_joining']);
        foreach ($eventRows as $row) {
            foreach (['birthday' => $row->date_of_birth, 'anniversary' => $row->date_of_joining] as $kind => $d) {
                if (!$d) continue;
                try {
                    $base = Carbon::parse($d);
                    $thisYear = $base->copy()->setYear($today->year);
                    $occur = $thisYear->lt($today->copy()->subDay())
                        ? $thisYear->copy()->addYear()
                        : $thisYear;
                    if ($occur->between($today->copy()->subDays(1), $rangeEnd)) {
                        $years = $today->year - $base->year + ($occur->year > $today->year ? 1 : 0);
                        $upcomingEvents->push([
                            'employee_id' => $row->id,
                            'emp_code'    => $row->emp_code,
                            'name'        => $row->display_name,
                            'kind'        => $kind,
                            'on'          => $occur->toDateString(),
                            'years'       => $kind === 'anniversary' ? max(0, $years) : null,
                        ]);
                    }
                } catch (\Throwable $e) { /* skip bad dates */ }
            }
        }
        $upcomingEvents = $upcomingEvents->sortBy('on')->take(6)->values();

        $employeeAnalytics = [
            'totals' => [
                'total'           => $totalEmployees,
                'active'          => $activeEmployees,
                'on_leave'        => $onLeaveEmployees,
                'probation'       => $probationEmployees,
                'notice_period'   => $noticeEmployees,
                'exited'          => $exitedEmployees,
                'new_this_month'  => $newJoinersMonth,
                'new_last_30d'    => $newJoinersLast30,
                'avg_tenure_yrs'  => $avgTenureYears,
                'faces_registered'=> $facesRegistered,
            ],
            'status'           => $empStatus,
            'gender'           => $empGender,
            'by_department'    => $empByDeptRows,
            'by_designation'   => $empByDesigRows,
            'joining_trend'    => $joiningTrend,
            'tenure'           => $tenure,
            'age_distribution' => $ageDistribution,
            'upcoming_events'  => $upcomingEvents,
        ];

        // ── Sales / pipeline analytics ───────────────────────────────────
        // The branch's core business: leads → quotations → proforma invoices.
        // Scoped to client_id + branch_id exactly like the employee analytics
        // above (a sub-branch user is already pinned to their branch via the
        // $branchId rewrite in clientStats()). Quotations / PIs / Leads all
        // carry branch_id, so the same filter applies cleanly.
        $leadBase = fn () => Lead::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId));
        $qtBase = fn () => Quotation::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId));
        $piBase = fn () => ProformaInvoice::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId));

        // Lead KPIs. "Won" = reached the Victory stage (lead_stage_id 6) OR
        // has won_at stamped (the two are set together, but OR-ing is robust
        // against either being missing).
        $isWon = fn ($w) => $w->whereNotNull('won_at')->orWhere('lead_stage_id', '>=', 6);
        $totalLeads     = (int) $leadBase()->count();
        $qualifiedLeads = (int) $leadBase()->where('qualified', true)->where('disqualified', false)->count();
        $disqLeads      = (int) $leadBase()->where('disqualified', true)->count();
        $wonLeads       = (int) $leadBase()->where($isWon)->count();
        $keyOpps        = (int) $leadBase()->where('key_opportunity', true)->count();
        // Active = qualified, still open (not disqualified, not won/victory).
        $activeOpps     = (int) $leadBase()->where('qualified', true)->where('disqualified', false)
            ->whereNull('won_at')->where('lead_stage_id', '<', 6)->count();
        // "Engaged" = leads that moved past the first stage (Inquiry Received)
        // — a meaningful progression metric (qualified is near-always true so a
        // qualified-ratio gauge would be a flat 100%).
        $engagedLeads   = (int) $leadBase()->where('lead_stage_id', '>', 1)->count();
        $newLeadsMonth  = (int) $leadBase()->where('created_at', '>=', now()->startOfMonth())->count();

        // Dominant quotation currency → a display symbol. Values are stored
        // inconsistently ("USD", "US – USD", …) and may mix currencies; we sum
        // them and label with the most common one's symbol rather than a
        // hardcoded ₹ (which mislabels USD figures).
        $curMode = $qtBase()->whereNotNull('currency')->where('currency', '!=', '')
            ->select('currency', DB::raw('count(*) c'))->groupBy('currency')->orderByDesc('c')->value('currency');
        $curUpper = strtoupper((string) $curMode);
        $currencySymbol = str_contains($curUpper, 'USD') ? '$'
            : (str_contains($curUpper, 'EUR') ? '€'
            : (str_contains($curUpper, 'GBP') ? '£'
            : (str_contains($curUpper, 'AED') ? 'AED '
            : '₹')));

        // Pipeline funnel — count by lead_stage_id. The UI uses 1-4 then jumps
        // to 6 (Quotation vs PI) and 8 (Victory).
        $stageRows = $leadBase()
            ->select('lead_stage_id', DB::raw('count(*) as count'))
            ->groupBy('lead_stage_id')
            ->pluck('count', 'lead_stage_id')
            ->toArray();
        // Stage IDs are contiguous 1-6 (validated `between:1,6` in
        // SalesLeadController; Stage4 advances to 5, Stage5 to 6). The earlier
        // 6/8 mapping was wrong and dropped stage-5 leads from the funnel.
        $stageMap = [
            1 => 'Inquiry Received',
            2 => 'Acknowledgement',
            3 => 'Product Sourcing',
            4 => 'Price Shared',
            5 => 'Quotation vs PI',
            6 => 'Victory',
        ];
        $pipeline = [];
        foreach ($stageMap as $id => $label) {
            $pipeline[] = ['stage' => $label, 'count' => (int) ($stageRows[$id] ?? 0)];
        }

        // Quotation KPIs — value excludes cancelled rows. Conversion = the share
        // of quotations that became a PI.
        $totalQuotations     = (int) $qtBase()->count();
        $quotationValue      = (float) $qtBase()->where('status', '!=', 'cancelled')->sum('grand_total');
        $convertedQuotations = (int) $qtBase()->where('status', 'converted_to_pi')->count();
        $conversionRate      = $totalQuotations > 0 ? (int) round(($convertedQuotations / $totalQuotations) * 100) : 0;

        // Proforma Invoice KPIs.
        $totalPis = (int) $piBase()->count();
        $piValue  = (float) $piBase()->where('status', '!=', 'cancelled')->sum('grand_total');

        // Leads trend (last 6 months by created_at) — pre-seed every bucket.
        // The same loop also collects the per-metric spark series (plain number
        // arrays) that drive the mini trend charts inside the KPI tiles.
        $leadsTrend = [];
        $sparkLeads = [];
        $sparkQuotations = [];
        $sparkPis = [];
        $sparkValue = [];
        for ($i = 5; $i >= 0; $i--) {
            $month = now()->subMonths($i);
            $leadCount = (int) $leadBase()
                ->whereYear('created_at', $month->year)
                ->whereMonth('created_at', $month->month)
                ->count();
            $leadsTrend[]  = ['month' => $month->format('M'), 'count' => $leadCount];
            $sparkLeads[]  = $leadCount;

            $qtAgg = $qtBase()
                ->whereYear('created_at', $month->year)
                ->whereMonth('created_at', $month->month)
                ->selectRaw('COUNT(*) as cnt, COALESCE(SUM(grand_total), 0) as val')
                ->first();
            $sparkQuotations[] = (int) ($qtAgg->cnt ?? 0);
            $sparkValue[]      = (float) ($qtAgg->val ?? 0);

            $sparkPis[] = (int) $piBase()
                ->whereYear('created_at', $month->year)
                ->whereMonth('created_at', $month->month)
                ->count();
        }

        // Recent opportunities — latest 6 leads with their stage + customer.
        $recentLeads = $leadBase()
            ->with('customer:id,company_name')
            ->orderByDesc('id')
            ->limit(6)
            ->get(['id', 'opp_code', 'lead_stage_id', 'customer_id', 'sender_company', 'qualified', 'disqualified', 'won_at', 'created_at'])
            ->map(fn ($l) => [
                'id'           => $l->id,
                'opp_code'     => $l->opp_code,
                'customer'     => $l->customer?->company_name ?: ($l->sender_company ?: '—'),
                'stage'        => $stageMap[$l->lead_stage_id] ?? '—',
                'stage_id'     => (int) $l->lead_stage_id,
                'won'          => $l->won_at !== null,
                'disqualified' => (bool) $l->disqualified,
                'created_at'   => optional($l->created_at)->toDateString(),
            ]);

        // Top customers by quotation value (cancelled excluded).
        $topCustomers = $qtBase()
            ->where('status', '!=', 'cancelled')
            ->whereNotNull('customer_id')
            ->select('customer_id', DB::raw('SUM(grand_total) as value'), DB::raw('COUNT(*) as quotations'))
            ->groupBy('customer_id')
            ->orderByDesc('value')
            ->limit(5)
            ->with('customer:id,company_name')
            ->get()
            ->map(fn ($r) => [
                'customer'   => $r->customer?->company_name ?? '—',
                'value'      => (float) $r->value,
                'quotations' => (int) $r->quotations,
            ]);

        // ── Procurement & Vendors analytics ─────────────────────────────
        // Product catalogue + supplier (vendor) onboarding, branch-scoped the
        // same way. Both carry client_id + branch_id and a 4-step onboarding
        // (step_completed 0-4) plus a draft/inactive/active status.
        $prodBase = fn () => Product::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId));
        $venBase = fn () => Vendor::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId));

        $prodStatus = $prodBase()->select('status', DB::raw('count(*) as c'))->groupBy('status')->pluck('c', 'status')->toArray();
        $venStatus  = $venBase()->select('status', DB::raw('count(*) as c'))->groupBy('status')->pluck('c', 'status')->toArray();

        // Onboarding funnels — "reached at least step N" (step_completed is the
        // highest step finished, so >= gives a clean descending funnel).
        $prodFunnel = [
            ['stage' => 'Core',    'count' => (int) $prodBase()->where('step_completed', '>=', 1)->count()],
            ['stage' => 'Sales',   'count' => (int) $prodBase()->where('step_completed', '>=', 2)->count()],
            ['stage' => 'Quality', 'count' => (int) $prodBase()->where('step_completed', '>=', 3)->count()],
            ['stage' => 'Vendors', 'count' => (int) $prodBase()->where('step_completed', '>=', 4)->count()],
        ];
        $venFunnel = [
            ['stage' => 'Identity',  'count' => (int) $venBase()->where('step_completed', '>=', 1)->count()],
            ['stage' => 'Contacts',  'count' => (int) $venBase()->where('step_completed', '>=', 2)->count()],
            ['stage' => 'KYC',       'count' => (int) $venBase()->where('step_completed', '>=', 3)->count()],
            ['stage' => 'Products',  'count' => (int) $venBase()->where('step_completed', '>=', 4)->count()],
        ];

        // Top vendor types (joined to the master for readable names).
        $venByType = Vendor::query()
            ->leftJoin('master_vendor_types', 'vendors.vendor_type_id', '=', 'master_vendor_types.id')
            ->where('vendors.client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('vendors.branch_id', $branchId))
            ->whereNull('vendors.deleted_at')
            ->select(DB::raw("COALESCE(master_vendor_types.name, 'Unassigned') as name"), DB::raw('count(*) as count'))
            ->groupBy('name')
            ->orderByDesc('count')
            ->limit(5)
            ->get()
            ->map(fn ($r) => ['name' => $r->name, 'count' => (int) $r->count])
            ->toArray();

        $procurementAnalytics = [
            'products' => [
                'total'          => (int) $prodBase()->count(),
                'active'         => (int) ($prodStatus['active'] ?? 0),
                'inactive'       => (int) ($prodStatus['inactive'] ?? 0),
                'draft'          => (int) ($prodStatus['draft'] ?? 0),
                'new_this_month' => (int) $prodBase()->where('created_at', '>=', now()->startOfMonth())->count(),
                'status' => [
                    ['name' => 'Active',   'value' => (int) ($prodStatus['active'] ?? 0)],
                    ['name' => 'Inactive', 'value' => (int) ($prodStatus['inactive'] ?? 0)],
                    ['name' => 'Draft',    'value' => (int) ($prodStatus['draft'] ?? 0)],
                ],
                'funnel' => $prodFunnel,
            ],
            'vendors' => [
                'total'          => (int) $venBase()->count(),
                'active'         => (int) ($venStatus['active'] ?? 0),
                'inactive'       => (int) ($venStatus['inactive'] ?? 0),
                'draft'          => (int) ($venStatus['draft'] ?? 0),
                'new_this_month' => (int) $venBase()->where('created_at', '>=', now()->startOfMonth())->count(),
                'status' => [
                    ['name' => 'Active',   'value' => (int) ($venStatus['active'] ?? 0)],
                    ['name' => 'Inactive', 'value' => (int) ($venStatus['inactive'] ?? 0)],
                    ['name' => 'Draft',    'value' => (int) ($venStatus['draft'] ?? 0)],
                ],
                'funnel'  => $venFunnel,
                'by_type' => $venByType,
            ],
        ];

        // ── CLM / Compliance analytics ──────────────────────────────────
        // E-signature requests + segments are branch-scoped; the compliance
        // LIBRARY masters (KYC/DD/QC/TL/agreements/trade-docs/clauses/T&Cs) are
        // client-level only, so those are shown as client-wide catalogue sizes.
        $sigBase = fn () => ClmSignatureRequest::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId));

        $sigStatusRows = $sigBase()->select('status', DB::raw('count(*) as c'))->groupBy('status')->pluck('c', 'status')->toArray();
        $sigTypeRows   = $sigBase()->select('document_type', DB::raw('count(*) as c'))->groupBy('document_type')->pluck('c', 'document_type')->toArray();

        $totalSignatures   = (int) $sigBase()->count();
        $sigCompleted      = (int) ($sigStatusRows['completed'] ?? 0);
        $sigInProgress     = (int) ($sigStatusRows['inprogress'] ?? 0);
        $sigDeclined       = (int) (($sigStatusRows['declined'] ?? 0) + ($sigStatusRows['recalled'] ?? 0) + ($sigStatusRows['expired'] ?? 0));
        $sigCompletionRate = $totalSignatures > 0 ? (int) round(($sigCompleted / $totalSignatures) * 100) : 0;

        $sigStatus = [
            ['name' => 'Completed',   'value' => $sigCompleted],
            ['name' => 'In Progress', 'value' => $sigInProgress],
            ['name' => 'Declined',    'value' => (int) ($sigStatusRows['declined'] ?? 0)],
            ['name' => 'Recalled',    'value' => (int) ($sigStatusRows['recalled'] ?? 0)],
            ['name' => 'Draft',       'value' => (int) ($sigStatusRows['draft'] ?? 0)],
        ];
        $typeLabels = ['quotation' => 'Quotation', 'proforma_invoice' => 'Proforma Inv', 'agreement' => 'Agreement', 'trade_doc' => 'Trade Doc'];
        $sigByType = [];
        foreach ($typeLabels as $k => $lbl) {
            $sigByType[] = ['name' => $lbl, 'count' => (int) ($sigTypeRows[$k] ?? 0)];
        }

        // Compliance library — client-level catalogue sizes (active rows only).
        $library = [
            ['name' => 'KYC Documents',       'count' => (int) ClmKycDocument::where('client_id', $clientId)->count(),     'icon' => 'kyc'],
            ['name' => 'Due Diligence',       'count' => (int) ClmDdDocument::where('client_id', $clientId)->count(),      'icon' => 'dd'],
            ['name' => 'Quality & Compliance','count' => (int) ClmQcDocument::where('client_id', $clientId)->count(),      'icon' => 'qc'],
            ['name' => 'Trade Licenses',      'count' => (int) ClmTradeLicense::where('client_id', $clientId)->count(),    'icon' => 'tl'],
            ['name' => 'Agreements',          'count' => (int) ClmAgreementLibrary::where('client_id', $clientId)->count(),'icon' => 'agr'],
            ['name' => 'Trade Documents',     'count' => (int) ClmTradeDocLibrary::where('client_id', $clientId)->count(), 'icon' => 'td'],
            ['name' => 'Clauses',             'count' => (int) ClmClauseLibrary::where('client_id', $clientId)->count(),   'icon' => 'clause'],
            ['name' => 'Terms & Conditions',  'count' => (int) ClmTncLibrary::where('client_id', $clientId)->count(),      'icon' => 'tnc'],
        ];

        // Segments (branch-aware) — total + highly-regulated count.
        $segBase = fn () => ClmSegment::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId));
        $totalSegments     = (int) $segBase()->count();
        $highlyRegSegments = (int) $segBase()->where('regulatory_status', 'highly')->count();

        $clmAnalytics = [
            'signatures' => [
                'total'           => $totalSignatures,
                'completed'       => $sigCompleted,
                'in_progress'     => $sigInProgress,
                'declined'        => $sigDeclined,
                'completion_rate' => $sigCompletionRate,
                'status'          => $sigStatus,
                'by_type'         => $sigByType,
            ],
            'library'  => $library,
            'segments' => [
                'total'            => $totalSegments,
                'highly_regulated' => $highlyRegSegments,
            ],
        ];

        // ── Per-branch breakdown (client-wide view only) ─────────────────
        // The defining feature of a CLIENT dashboard vs a branch one: let the
        // admin compare branches at a glance. Only computed when no branch
        // filter is active — a branch / filtered view doesn't need it.
        $byBranch = [];
        if ($branchId === null) {
            $branchRows = Branch::where('client_id', $clientId)
                ->where('code', '!=', 'HO')
                ->orderBy('name')
                ->get(['id', 'name', 'code', 'status', 'city', 'state']);
            foreach ($branchRows as $b) {
                $byBranch[] = [
                    'name'       => $b->name,
                    'code'       => $b->code,
                    'status'     => $b->status,
                    'city'       => $b->city,
                    'state'      => $b->state,
                    'employees'  => (int) Employee::where('client_id', $clientId)->where('branch_id', $b->id)->count(),
                    'users'      => (int) User::where('client_id', $clientId)->where('branch_id', $b->id)->count(),
                ];
            }
            // Largest branch by users (login seats) first — this is a tenant
            // view, so we rank by seats, then employees, not sales value.
            usort($byBranch, fn ($a, $z) => ($z['users'] <=> $a['users']) ?: ($z['employees'] <=> $a['employees']));
        }

        // ── Access & permissions overview — how many modules each user can
        // reach (can_view), plus their edit/approve reach. Lets a client admin
        // see "who has how much access" at a glance. Scoped by branch when a
        // branch filter is active. ──────────────────────────────────────────
        $totalModules = (int) Module::count();
        $access = [];
        $permAgg = Permission::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->where('can_view', true)
            ->select(
                'user_id',
                DB::raw('COUNT(DISTINCT module_id) as modules_count'),
                DB::raw('SUM(CASE WHEN can_edit = true THEN 1 ELSE 0 END) as edit_count'),
                DB::raw('SUM(CASE WHEN can_approve = true THEN 1 ELSE 0 END) as approve_count')
            )
            ->groupBy('user_id')
            ->get();
        if ($permAgg->isNotEmpty()) {
            $userRows = User::withTrashed()
                ->whereIn('id', $permAgg->pluck('user_id')->all())
                ->get(['id', 'name', 'user_type', 'branch_id'])
                ->keyBy('id');
            $branchNameMap = Branch::where('client_id', $clientId)->pluck('name', 'id');
            foreach ($permAgg as $row) {
                $u = $userRows->get($row->user_id);
                if (!$u) continue;
                $access[] = [
                    'user_id'     => (int) $u->id,
                    'name'        => $u->name,
                    'role'        => $u->user_type,
                    'branch'      => $branchNameMap[$u->branch_id] ?? null,
                    'modules'     => (int) $row->modules_count,
                    'can_edit'    => (int) $row->edit_count,
                    'can_approve' => (int) $row->approve_count,
                ];
            }
            // Most-privileged users first. Return a generous slice so the
            // frontend can paginate (5 per page) rather than just a top-N.
            usort($access, fn ($a, $z) => $z['modules'] <=> $a['modules']);
            $access = array_slice($access, 0, 60);
        }

        $salesAnalytics = [
            'totals' => [
                'total_leads'     => $totalLeads,
                'active_opps'     => $activeOpps,
                'qualified'       => $qualifiedLeads,
                'disqualified'    => $disqLeads,
                'won'             => $wonLeads,
                'engaged'         => $engagedLeads,
                'key_opps'        => $keyOpps,
                'new_this_month'  => $newLeadsMonth,
                'quotations'      => $totalQuotations,
                'quotation_value' => $quotationValue,
                'pis'             => $totalPis,
                'pi_value'        => $piValue,
                'conversion_rate' => $conversionRate,
                'currency_symbol' => $currencySymbol,
            ],
            'pipeline'      => $pipeline,
            'leads_trend'   => $leadsTrend,
            'recent_leads'  => $recentLeads,
            'top_customers' => $topCustomers,
            // Per-metric 6-month series for the KPI-tile mini sparklines.
            'spark' => [
                'leads'      => $sparkLeads,
                'quotations' => $sparkQuotations,
                'pis'        => $sparkPis,
                'value'      => $sparkValue,
            ],
        ];

        return [
            'client' => [
                'org_name' => $client?->org_name,
                'logo' => $client?->logo,
                'primary_color' => $client?->primary_color,
                'status' => $client?->status,
            ],
            'plan' => [
                'name' => $planName,
                'status' => $planStatus,
                'expires_at' => $planExpiry?->format('Y-m-d'),
                'days_remaining' => $daysRemaining,
                'price' => $client?->plan?->price ?? 0,
            ],
            'counts' => [
                'total_branches' => $totalBranches,
                'active_branches' => $activeBranches,
                'total_employees' => $totalEmployees,
                'active_employees' => $activeEmployees,
                'total_users' => $totalUsers,
                'active_users' => $activeUsers,
                'total_payments' => $totalPayments,
                'success_payments' => $successPayments,
                'pending_payments' => $pendingPayments,
                'total_paid' => $totalPaid,
            ],
            'branches' => $branches,
            'recent_payments' => $recentPayments,
            'payment_trend' => $paymentTrend,
            'user_roles' => $userRoles,
            'access' => [
                'total_modules' => $totalModules,
                'users' => $access,
            ],
            'employees' => $employeeAnalytics,
            'sales' => $salesAnalytics,
            'procurement' => $procurementAnalytics,
            'clm' => $clmAnalytics,
            'by_branch' => $byBranch,
            'can_view_payments' => $canViewPayments,
            'filter' => [
                'branch_id' => $branchId,
            ],
        ];
    }

    /**
     *  Employee Dashboard — personal snapshot for the logged-in employee.
     *  Returns the user's own profile + KPIs, their pending/recent expense
     *  claims, any approvals waiting on them as a manager, peers in their
     *  department, active announcements, upcoming birthdays/anniversaries
     *  and (if still onboarding) wizard progress.
     *
     *  Falls back gracefully when the User has no Employee row attached:
     *  `me` returns minimal fields, lists return empty arrays. The frontend
     *  shows "Profile not yet set up" rather than crashing.
     */
    public function employeeStats(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        // Locate the Employee row paired with this login. Eager-load the
        // bits we display in the hero so we don't N+1 the relations.
        $emp = Employee::with(['department', 'designation', 'reportingManager', 'photoDocument'])
            ->where('user_id', $user->id)
            ->first();

        $clientId = $user->client_id;
        $branchId = $user->branch_id;
        $employeeId = $emp?->id;

        // ── Profile hero ────────────────────────────────────────────────
        $manager = $emp?->reportingManager;
        $me = [
            'employee_id'     => $employeeId,
            'display_name'    => $emp?->display_name ?: trim(($emp?->first_name ?? '') . ' ' . ($emp?->last_name ?? '')) ?: $user->name,
            'emp_code'        => $emp?->emp_code,
            'photo_url'       => $emp?->photo_url,
            'status'          => $emp?->status ?: 'Active',
            'department_name' => $emp?->department?->name,
            'designation_name'=> $emp?->designation?->name,
            'manager_id'      => $manager?->id,
            'manager_name'    => $manager?->display_name,
            'manager_photo'   => $manager?->photo_url,
            'date_of_joining' => $emp?->date_of_joining?->toDateString(),
            'email'           => $user->email,
            'mobile'          => $emp?->mobile,
            'profile_completion_pct' => $this->profileCompletion($emp),
        ];

        // ── Expense KPIs (mine) + recent + pending approvals ────────────
        $myExpensesPending = 0;
        $myExpensesApproved = 0;
        $myExpensesRejected = 0;
        $recentExpenses = collect();
        $pendingApprovals = collect();
        $approvalsPending = 0;

        if ($employeeId) {
            // Counts on claims I filed
            $myExpensesPending = ExpenseClaim::where('employee_id', $employeeId)
                ->where(function ($w) {
                    $w->where('manager_status', 'pending')->orWhere('hr_status', 'pending');
                })
                ->whereNotIn('manager_status', ['rejected'])
                ->whereNotIn('hr_status', ['rejected'])
                ->count();
            $myExpensesApproved = ExpenseClaim::where('employee_id', $employeeId)
                ->where('manager_status', 'approved')
                ->where('hr_status', 'approved')
                ->count();
            $myExpensesRejected = ExpenseClaim::where('employee_id', $employeeId)
                ->where(function ($w) {
                    $w->where('manager_status', 'rejected')->orWhere('hr_status', 'rejected');
                })
                ->count();

            // Last 5 of mine
            $recentExpenses = ExpenseClaim::where('employee_id', $employeeId)
                ->orderByDesc('expense_date')
                ->orderByDesc('id')
                ->limit(5)
                ->get(['id', 'claim_no', 'title', 'category_name', 'amount', 'currency', 'expense_date', 'status', 'manager_status', 'hr_status'])
                ->map(fn ($c) => [
                    'id'           => $c->id,
                    'claim_no'     => $c->claim_no,
                    'title'        => $c->title,
                    'category'     => $c->category_name,
                    'amount'       => (float) $c->amount,
                    'currency'     => $c->currency ?: 'INR',
                    'expense_date' => optional($c->expense_date)->toDateString(),
                    'status'       => $this->rollupExpenseStatus($c->manager_status, $c->hr_status),
                ]);

            // Pending approvals where I'm the manager
            $approvalsPending = ExpenseClaim::where('manager_id', $employeeId)
                ->where('manager_status', 'pending')
                ->count();
            $pendingApprovals = ExpenseClaim::where('manager_id', $employeeId)
                ->where('manager_status', 'pending')
                ->with(['employee:id,display_name,emp_code'])
                ->orderByDesc('created_at')
                ->limit(5)
                ->get(['id', 'claim_no', 'title', 'amount', 'currency', 'employee_id', 'category_name', 'created_at'])
                ->map(fn ($c) => [
                    'id'         => $c->id,
                    'claim_no'   => $c->claim_no,
                    'title'      => $c->title,
                    'category'   => $c->category_name,
                    'amount'     => (float) $c->amount,
                    'currency'   => $c->currency ?: 'INR',
                    'filed_by'   => optional($c->employee)->display_name,
                    'emp_code'   => optional($c->employee)->emp_code,
                    'created_at' => optional($c->created_at)->toDateString(),
                ]);
        }

        // ── Analytics blocks for the dashboard charts ───────────────────
        //   · expense status split + total claimed + 6-month spend trend
        //   · attendance this month (present / leave / absent / half-day)
        //   · leave taken by type this year + request-status split
        // Each is self-contained and degrades to empty/zero when the
        // employee has no rows, so the frontend can hide empty charts.
        $expenseStatus      = ['approved' => $myExpensesApproved, 'pending' => $myExpensesPending, 'rejected' => $myExpensesRejected];
        $totalClaimedAmount = 0.0;
        $expenseTrend       = [];
        $attendanceSummary  = null;
        $leaveByType        = [];
        $leaveStatus        = ['approved' => 0, 'pending' => 0, 'rejected' => 0];

        if ($employeeId) {
            // 6-month expense spend trend (sum of my claim amounts per month).
            $trendStart = Carbon::now()->startOfMonth()->subMonths(5);
            $buckets = [];
            for ($i = 0; $i < 6; $i++) {
                $m = $trendStart->copy()->addMonths($i);
                $buckets[$m->format('Y-m')] = ['month' => $m->format('M'), 'amount' => 0.0];
            }
            ExpenseClaim::where('employee_id', $employeeId)
                ->where('expense_date', '>=', $trendStart->toDateString())
                ->get(['amount', 'expense_date'])
                ->each(function ($c) use (&$buckets) {
                    if (!$c->expense_date) return;
                    $k = $c->expense_date->format('Y-m');
                    if (isset($buckets[$k])) $buckets[$k]['amount'] += (float) $c->amount;
                });
            $expenseTrend = array_values($buckets);
            $totalClaimedAmount = (float) ExpenseClaim::where('employee_id', $employeeId)->sum('amount');

            // Attendance this month — bucket each marked day by its status.
            $monthStart = Carbon::now()->startOfMonth();
            $present = $leaveDays = $absent = $halfDay = 0;
            Attendance::where('employee_id', $employeeId)
                ->where('attendance_date', '>=', $monthStart->toDateString())
                ->get(['attendance_date', 'status', 'check_in_at'])
                ->each(function ($a) use (&$present, &$leaveDays, &$absent, &$halfDay) {
                    $s = strtolower((string) $a->status);
                    if (str_contains($s, 'half'))           $halfDay++;
                    elseif (str_contains($s, 'leave'))      $leaveDays++;
                    elseif (str_contains($s, 'absent'))     $absent++;
                    elseif (str_contains($s, 'present') || $a->check_in_at) $present++;
                });
            // Expected working days so far this month (Mon–Fri, counted from the
            // joining date when it falls inside the month). This is the correct
            // denominator for the attendance %: dividing by the days that merely
            // happened to be MARKED made a single present day read as 100%. Now
            // the % reflects "present out of the working days in the period", so
            // it only reaches 100% when every working day is accounted for.
            $periodStart = ($emp && $emp->date_of_joining && Carbon::parse($emp->date_of_joining)->gt($monthStart))
                ? Carbon::parse($emp->date_of_joining)->startOfDay()
                : $monthStart->copy();
            $todayEod    = Carbon::now()->startOfDay();
            $workingDays = 0;
            if ($periodStart->lte($todayEod)) {
                for ($d = $periodStart->copy(); $d->lte($todayEod); $d->addDay()) {
                    if (!$d->isWeekend()) $workingDays++;
                }
            }
            $marked = $present + $leaveDays + $absent + $halfDay;

            $attendanceSummary = [
                'month'        => $monthStart->format('F Y'),
                'present'      => $present,
                'leave'        => $leaveDays,
                'absent'       => $absent,
                'half_day'     => $halfDay,
                // Days that actually have a record (drives the "X days marked" donut).
                'total'        => $marked,
                // Working days expected so far — the attendance-% denominator.
                'working_days' => $workingDays,
            ];

            // Leave this calendar year — taken days by type (approved) +
            // overall request-status split.
            $yearStart = Carbon::now()->startOfYear();
            $byType = [];
            LeaveRequest::where('employee_id', $employeeId)
                ->where('from_date', '>=', $yearStart->toDateString())
                ->with(['leaveType:id,name,short_code'])
                ->get(['id', 'leave_type_id', 'days', 'status', 'from_date'])
                ->each(function ($lr) use (&$byType, &$leaveStatus) {
                    $st = strtolower((string) $lr->status);
                    $isApproved = str_contains($st, 'approv');
                    if ($isApproved)                                              $leaveStatus['approved']++;
                    elseif (str_contains($st, 'reject') || str_contains($st, 'declin')) $leaveStatus['rejected']++;
                    elseif (str_contains($st, 'pend'))                            $leaveStatus['pending']++;
                    if ($isApproved) {
                        $name = $lr->leaveType?->name ?: $lr->leaveType?->short_code ?: 'Leave';
                        $byType[$name] = ($byType[$name] ?? 0) + (float) $lr->days;
                    }
                });
            foreach ($byType as $name => $days) {
                $leaveByType[] = ['type' => $name, 'days' => round($days, 1)];
            }
            usort($leaveByType, fn ($a, $b) => $b['days'] <=> $a['days']);
        }

        // ── My Team — pick the most-relevant cohort based on where the
        // employee sits in the reporting tree:
        //   1. If they have direct reports  → show those reports
        //                                     (this is "their team" as
        //                                     a manager).
        //   2. Else if they have a manager → show fellow direct reports
        //                                     under the same manager
        //                                     (peer team).
        //   3. Else fall back to department peers so the card still has
        //                                     content for top-of-tree
        //                                     individuals.
        // `team_size` reflects whichever cohort was selected, so the
        // subtitle on the dashboard stays consistent with the photos.
        $teamPeers = collect();
        $teamSize  = 0;
        $teamKind  = 'none';
        if ($emp) {
            // 1. Direct reports of this employee.
            $reportsBase = Employee::where('reporting_manager_id', $employeeId)
                ->where('client_id', $clientId)
                ->where('id', '!=', $employeeId)
                ->whereNotIn('status', ['Inactive', 'Resigned', 'Terminated']);
            $reportsCount = (clone $reportsBase)->count();

            if ($reportsCount > 0) {
                $teamKind  = 'reports';
                $teamSize  = $reportsCount;
                $teamPeers = (clone $reportsBase)
                    ->with(['designation', 'photoDocument'])
                    ->orderBy('display_name')
                    ->limit(6)
                    ->get(['id', 'emp_code', 'display_name', 'designation_id', 'reporting_manager_id']);
            } elseif ($emp->reporting_manager_id) {
                // 2. Siblings — same reporting manager.
                $siblingsBase = Employee::where('reporting_manager_id', $emp->reporting_manager_id)
                    ->where('client_id', $clientId)
                    ->where('id', '!=', $employeeId)
                    ->whereNotIn('status', ['Inactive', 'Resigned', 'Terminated']);
                $teamKind  = 'peers';
                $teamSize  = (clone $siblingsBase)->count();
                $teamPeers = (clone $siblingsBase)
                    ->with(['designation', 'photoDocument'])
                    ->orderBy('display_name')
                    ->limit(6)
                    ->get(['id', 'emp_code', 'display_name', 'designation_id', 'reporting_manager_id']);
            } elseif ($emp->department_id) {
                // 3. Department peers (top-of-tree fallback).
                $deptBase = Employee::where('department_id', $emp->department_id)
                    ->where('client_id', $clientId)
                    ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
                    ->where('id', '!=', $employeeId)
                    ->whereNotIn('status', ['Inactive', 'Resigned', 'Terminated']);
                $teamKind  = 'department';
                $teamSize  = (clone $deptBase)->count();
                $teamPeers = (clone $deptBase)
                    ->with(['designation', 'photoDocument'])
                    ->orderBy('display_name')
                    ->limit(6)
                    ->get(['id', 'emp_code', 'display_name', 'designation_id']);
            }

            $teamPeers = $teamPeers->map(fn ($p) => [
                'id'               => $p->id,
                'emp_code'         => $p->emp_code,
                'display_name'     => $p->display_name,
                'photo_url'        => $p->photo_url,
                'designation_name' => $p->designation?->name,
            ]);
        }

        // ── Announcements (recent active, tenant-scoped) ────────────────
        // AnnouncementController auto-flips Scheduled → Active when publish_at
        // hits and Active → Expired past expires_at, so filtering by lowercase
        // 'active' (the value the seed/migration writes) is enough here.
        $announcements = collect();
        if ($clientId) {
            $announcements = Announcement::query()
                ->where('client_id', $clientId)
                ->whereRaw('LOWER(status) = ?', ['active'])
                ->orderByDesc('created_at')
                ->limit(5)
                ->get(['id', 'title', 'description', 'created_at'])
                ->map(fn ($a) => [
                    'id'         => $a->id,
                    'title'      => $a->title,
                    'snippet'    => mb_strimwidth(strip_tags((string) $a->description), 0, 140, '…'),
                    'created_at' => optional($a->created_at)->toDateString(),
                ]);
        }

        // ── Upcoming events — birthdays + work anniversaries this month ─
        // Compute "next occurrence within ±30 days" so end-of-month birthdays
        // that fall a few days into next month still appear.
        $upcomingEvents = collect();
        if ($clientId) {
            $today = Carbon::now();
            $rangeEnd = $today->copy()->addDays(30);
            $teamRows = Employee::where('client_id', $clientId)
                ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
                // Only active staff — exclude inactive / exited (resigned /
                // terminated) people from birthday / work-anniversary celebrations.
                ->whereNotIn('status', ['Inactive', 'Resigned', 'Terminated'])
                ->whereNotNull(DB::raw('COALESCE(date_of_birth, date_of_joining)'))
                ->get(['id', 'display_name', 'date_of_birth', 'date_of_joining']);
            foreach ($teamRows as $row) {
                foreach (['birthday' => $row->date_of_birth, 'anniversary' => $row->date_of_joining] as $kind => $d) {
                    if (!$d) continue;
                    try {
                        $base = Carbon::parse($d);
                        $thisYear = $base->copy()->setYear($today->year);
                        $occur = $thisYear->lt($today->copy()->subDay())
                            ? $thisYear->copy()->addYear()
                            : $thisYear;
                        if ($occur->between($today->copy()->subDays(1), $rangeEnd)) {
                            $years = $today->year - $base->year + ($occur->year > $today->year ? 1 : 0);
                            $upcomingEvents->push([
                                'employee_id' => $row->id,
                                'name'        => $row->display_name,
                                'kind'        => $kind,
                                'on'          => $occur->toDateString(),
                                'years'       => $kind === 'anniversary' ? max(0, $years) : null,
                            ]);
                        }
                    } catch (\Throwable $e) { /* skip bad dates */ }
                }
            }
            $upcomingEvents = $upcomingEvents->sortBy('on')->take(6)->values();
        }

        // ── Onboarding progress (only surface if incomplete) ───────────
        $onboarding = null;
        if ($emp && (int) $emp->onboarding_stage_completed < 4) {
            $stages = ['Basic Details', 'Job Details', 'Work Details', 'Compensation'];
            $current = max(0, min(4, (int) $emp->onboarding_stage_completed));
            $onboarding = [
                'current_stage'  => $current,
                'total_stages'   => 4,
                'percent'        => (int) round(($current / 4) * 100),
                'next_label'     => $stages[$current] ?? null,
            ];
        }

        // ── Compensation tile — only if employee opted into payroll ────
        $compensation = null;
        if ($emp && $emp->enable_payroll) {
            $compensation = [
                'annual_salary'    => $emp->annual_salary !== null ? (float) $emp->annual_salary : null,
                'salary_frequency' => $emp->salary_frequency,
                'salary_structure' => $emp->salary_structure,
                'tax_regime'       => $emp->tax_regime,
                'effective_from'   => optional($emp->salary_effective_from)->toDateString(),
            ];
        }

        // ── Tenure (days since joining) for the KPI row ────────────────
        // Carbon 3 (Laravel 12) returns diffInDays() as a FLOAT (e.g. 131.404),
        // so cast to int — "Days at Company" must read as a whole number.
        $daysSinceJoining = $emp?->date_of_joining
            ? max(0, (int) $emp->date_of_joining->diffInDays(Carbon::now()))
            : null;

        return response()->json([
            'me' => $me,
            'kpis' => [
                'my_expenses_pending'  => $myExpensesPending,
                'my_expenses_approved' => $myExpensesApproved,
                'my_expenses_rejected' => $myExpensesRejected,
                'approvals_pending'    => $approvalsPending,
                'team_size'            => $teamSize,
                'days_since_joining'   => $daysSinceJoining,
            ],
            'compensation'      => $compensation,
            'analytics'         => [
                'expense_status'   => $expenseStatus,
                'total_claimed'    => $totalClaimedAmount,
                'expense_trend'    => $expenseTrend,
                'attendance'       => $attendanceSummary,
                'leave_by_type'    => $leaveByType,
                'leave_status'     => $leaveStatus,
            ],
            'recent_expenses'   => $recentExpenses,
            'pending_approvals' => $pendingApprovals,
            'team_kind'         => $teamKind,
            'team_peers'        => $teamPeers,
            'announcements'     => $announcements,
            'upcoming_events'   => $upcomingEvents,
            'onboarding'        => $onboarding,
        ]);
    }

    /** Roll up the two-stage expense status into a single chip value. */
    private function rollupExpenseStatus(?string $managerStatus, ?string $hrStatus): string
    {
        if ($managerStatus === 'rejected' || $hrStatus === 'rejected') return 'Rejected';
        if ($managerStatus === 'approved' && $hrStatus === 'approved') return 'Approved';
        return 'Pending';
    }

    /**
     *  Estimate how complete an Employee profile is, from a fixed set of
     *  "would-show-on-the-business-card" fields. Lets the dashboard nudge
     *  new joiners to finish their profile rather than reporting a flat
     *  0%/100% based on `onboarding_stage_completed`.
     */
    private function profileCompletion(?Employee $emp): int
    {
        if (!$emp) return 0;
        $fields = [
            'first_name', 'last_name', 'gender', 'date_of_birth',
            'email', 'mobile',
            'department_id', 'designation_id', 'date_of_joining',
            'address_line1', 'city', 'country_id',
        ];
        $hit = 0;
        foreach ($fields as $f) {
            $v = $emp->{$f};
            if ($v !== null && $v !== '' && $v !== 0) $hit++;
        }
        return (int) round(($hit / count($fields)) * 100);
    }
}
