<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Models\Branch;
use App\Models\Client;
use App\Models\Employee;
use App\Models\ExpenseClaim;
use App\Models\Payment;
use App\Models\Plan;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function adminStats()
    {
        // Core counts
        $totalClients = Client::count();
        $activeClients = Client::where('status', 'active')->count();
        $inactiveClients = Client::where('status', '!=', 'active')->count();
        $totalUsers = User::count();
        $totalBranches = Branch::count();

        // Revenue
        $totalRevenue = (float) Payment::where('status', 'success')->sum('total');
        $monthlyRevenue = (float) Payment::where('status', 'success')
            ->where('created_at', '>=', now()->startOfMonth())
            ->sum('total');

        // Payments
        $totalPayments = Payment::count();
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
            ->get(['id', 'org_name', 'email', 'status', 'plan_id', 'plan_type', 'created_at']);

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

        return response()->json([
            'plan_distribution' => $planDistribution,
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
        ]);
    }

    public function clientStats(Request $request)
    {
        $user = $request->user();
        $clientId = $user->client_id;

        if (!$clientId) {
            return response()->json(['message' => 'No client associated'], 422);
        }

        // Resolve & validate branch_id filter (always scoped within this user's client)
        $branchId = $request->integer('branch_id') ?: null;
        if ($branchId && !Branch::where('client_id', $clientId)->where('id', $branchId)->exists()) {
            $branchId = null; // ignore stale / cross-client ids
        }
        // Sub-branch users (non-main) are always server-locked to their own branch.
        // If their branch_id is missing or invalid (data integrity issue), force a
        // sentinel value so no rows match — never silently widen the scope.
        $userBranch = null;
        if ($user->user_type === 'branch_user') {
            $userBranch = $user->branch_id
                ? Branch::where('client_id', $clientId)->find($user->branch_id)
                : null;
            if (!$userBranch) {
                $branchId = -1; // matches nothing → empty result is safer than leaked data
            } elseif (!$userBranch->is_main) {
                $branchId = $user->branch_id;
            }
            // Main branch user: $branchId stays as caller-supplied (already validated above)
        }

        // Payment data is billing-level info — only the client admin and the
        // main branch (head office) should see actual amounts and history.
        // Non-main branch users get zeros / empty so the dashboard doesn't
        // leak revenue / invoice numbers across the org.
        $canViewPayments = $user->user_type !== 'branch_user' || (bool) $userBranch?->is_main;

        $client = Client::with('plan')->find($clientId);

        // Branches — always count via the actual query so a non-existent / sentinel id (-1) returns 0
        $branchesBase = fn() => Branch::where('client_id', $clientId)
            ->when($branchId, fn($q) => $q->where('id', $branchId));
        $totalBranches = $branchesBase()->count();
        $activeBranches = $branchesBase()->where('status', 'active')->count();

        // Users — scoped by branch when filter active
        $usersBase = fn() => User::where('client_id', $clientId)
            ->when($branchId, fn($q) => $q->where('branch_id', $branchId));
        $totalUsers = $usersBase()->count();
        $activeUsers = $usersBase()->where('status', 'active')->count();

        // Payments are subscription-level (per client, not per branch). Show client-level
        // counts to client admins and main-branch users only — sub-branch users get
        // zeros so we don't leak finance data through the dashboard.
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

        // Branches list — full list when no filter, single-branch when filtered
        $branches = Branch::where('client_id', $clientId)
            ->when($branchId, fn($q) => $q->where('id', $branchId))
            ->withCount('users')
            ->orderByDesc('is_main')
            ->orderBy('name')
            ->get(['id', 'name', 'code', 'status', 'is_main', 'city', 'state', 'email', 'phone']);

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
        // Scope mirrors the user/branch counts above: a sub-branch user is
        // pinned to their own branch (via the $branchId rewrite up top), a
        // main-branch user sees the whole client unless they pick a branch.
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

        return response()->json([
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
            'employees' => $employeeAnalytics,
            'can_view_payments' => $canViewPayments,
            'filter' => [
                'branch_id' => $branchId,
            ],
        ]);
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

        // ── Team peers (same department, excl. self) ────────────────────
        $teamPeers = collect();
        $teamSize  = 0;
        if ($emp?->department_id) {
            $teamSize = Employee::where('department_id', $emp->department_id)
                ->where('client_id', $clientId)
                ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
                ->where('id', '!=', $employeeId)
                ->count();
            $teamPeers = Employee::with(['designation', 'photoDocument'])
                ->where('department_id', $emp->department_id)
                ->where('client_id', $clientId)
                ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
                ->where('id', '!=', $employeeId)
                ->orderBy('display_name')
                ->limit(6)
                ->get(['id', 'emp_code', 'display_name', 'designation_id', 'date_of_joining'])
                ->map(fn ($p) => [
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
        $daysSinceJoining = $emp?->date_of_joining
            ? max(0, $emp->date_of_joining->diffInDays(Carbon::now()))
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
            'recent_expenses'   => $recentExpenses,
            'pending_approvals' => $pendingApprovals,
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
