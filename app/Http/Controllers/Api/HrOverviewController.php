<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\EmployeeOnboardingInvite;
use App\Models\EmployeeExit;
use App\Models\ExpenseClaim;
use App\Models\Recruitment;
use App\Models\Masters\Departments;
use App\Models\Masters\Designations;
use App\Models\Masters\Roles;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;


class HrOverviewController extends Controller
{
    public function index(Request $request)
    {
        $user      = $request->user();
        $branchArg = $request->integer('branch_id') ?: null;

        $now            = Carbon::now();
        $monthStart     = $now->copy()->startOfMonth();
        $twelveMonthAgo = $now->copy()->subMonths(11)->startOfMonth();

        // ── KPI counters ──────────────────────────────────────────────────
        $activeEmployees = $this->scopedTable($user, $branchArg, 'employees')->count();

        $newHires = $this->scopedTable($user, $branchArg, 'employees')
            ->whereDate('date_of_joining', '>=', $monthStart->toDateString())
            ->whereDate('date_of_joining', '<=', $now->toDateString())
            ->count();

        $openPositions = $this->scopedTable($user, $branchArg, 'recruitments')
            ->whereIn('status', ['In Progress', 'Open', 'open', 'in_progress'])
            ->count();

        $pendingOnboarding = $this->scopedTable($user, $branchArg, 'employee_onboarding_invites')
            ->where('status', 'pending')
            ->where(function ($w) {
                $w->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->count();

        $activeExits = $this->scopedTable($user, $branchArg, 'employee_exits')
            ->whereNotNull('notice_date')
            ->where(function ($w) use ($now) {
                $w->whereNull('last_working_day')
                  ->orWhereDate('last_working_day', '>=', $now->toDateString());
            })
            ->count();

        $pendingExpenseClaims = $this->scopedTable($user, $branchArg, 'expense_claims')
            ->where(function ($w) {
                $w->where('manager_status', 'pending')->orWhere('hr_status', 'pending');
            })
            ->count();

        // ── Headcount by department (top 8 + Other rollup) ───────────────
        // Joined query — must qualify every column that exists on both
        // tables (`client_id`, `branch_id`, `status` on master_departments).
        $byDepartment = Employee::query()
            ->from('employees')
            ->leftJoin('master_departments', 'master_departments.id', '=', 'employees.department_id')
            ->where(fn ($q) => $this->applyScope($q, $user, $branchArg, 'employees'))
            ->select('employees.department_id', 'master_departments.name', DB::raw('COUNT(*) as count'))
            ->groupBy('employees.department_id', 'master_departments.name')
            ->orderByDesc('count')
            ->get()
            ->map(fn ($r) => [
                'id'    => $r->department_id,
                'name'  => $r->name ?: 'Unassigned',
                'count' => (int) $r->count,
            ]);

        // ── Gender split ─────────────────────────────────────────────────
        $byGender = $this->scopedTable($user, $branchArg, 'employees')
            ->select('gender', DB::raw('COUNT(*) as count'))
            ->groupBy('gender')
            ->get()
            ->map(fn ($r) => [
                'gender' => $r->gender ?: 'Unspecified',
                'count'  => (int) $r->count,
            ]);

        // ── Employment-status split ──────────────────────────────────────
        $byStatus = $this->scopedTable($user, $branchArg, 'employees')
            ->select('status', DB::raw('COUNT(*) as count'))
            ->groupBy('status')
            ->get()
            ->map(fn ($r) => [
                'status' => $r->status ?: 'Active',
                'count'  => (int) $r->count,
            ]);

        // ── 12-month joining trend (bucketed in PHP for driver portability) ─
        $joiningRows = $this->scopedTable($user, $branchArg, 'employees')
            ->whereDate('date_of_joining', '>=', $twelveMonthAgo->toDateString())
            ->whereDate('date_of_joining', '<=', $now->toDateString())
            ->get(['date_of_joining']);
        $joiningTrend = $this->bucketByMonth($joiningRows, 'date_of_joining', $twelveMonthAgo, $now);

        // ── 12-month exit trend ──────────────────────────────────────────
        $exitRows = $this->scopedTable($user, $branchArg, 'employee_exits')
            ->whereNotNull('last_working_day')
            ->whereDate('last_working_day', '>=', $twelveMonthAgo->toDateString())
            ->whereDate('last_working_day', '<=', $now->copy()->endOfMonth()->toDateString())
            ->get(['last_working_day']);
        $exitTrend = $this->bucketByMonth($exitRows, 'last_working_day', $twelveMonthAgo, $now);

        // ── Recruitment status split ─────────────────────────────────────
        $recruitmentByStatus = $this->scopedTable($user, $branchArg, 'recruitments')
            ->select('status', DB::raw('COUNT(*) as count'))
            ->groupBy('status')
            ->get()
            ->map(fn ($r) => [
                'status' => $r->status ?: 'Unknown',
                'count'  => (int) $r->count,
            ]);

        // ── Expense-claim status split (rolled up to Pending/Approved/Rejected) ─
        $expenseRows = $this->scopedTable($user, $branchArg, 'expense_claims')
            ->select('manager_status', 'hr_status', DB::raw('COUNT(*) as count'))
            ->groupBy('manager_status', 'hr_status')
            ->get();

        $expenseBuckets = ['Pending' => 0, 'Approved' => 0, 'Rejected' => 0];
        foreach ($expenseRows as $r) {
            $m = (string) $r->manager_status;
            $h = (string) $r->hr_status;
            $c = (int) $r->count;
            if ($m === 'rejected' || $h === 'rejected') {
                $expenseBuckets['Rejected'] += $c;
            } elseif ($m === 'approved' && $h === 'approved') {
                $expenseBuckets['Approved'] += $c;
            } else {
                $expenseBuckets['Pending'] += $c;
            }
        }
        $expenseByStatus = collect($expenseBuckets)
            ->map(fn ($v, $k) => ['status' => $k, 'count' => $v])
            ->values();

        // ── Recent joiners (last 5 on or before today) ───────────────────
        $recentJoiners = Employee::query()
            ->from('employees')
            ->where(fn ($q) => $this->applyScope($q, $user, $branchArg, 'employees'))
            ->whereNotNull('date_of_joining')
            ->whereDate('date_of_joining', '<=', $now->toDateString())
            ->leftJoin('master_departments',  'master_departments.id',  '=', 'employees.department_id')
            ->leftJoin('master_designations', 'master_designations.id', '=', 'employees.designation_id')
            ->orderByDesc('employees.date_of_joining')
            ->limit(5)
            ->get([
                'employees.id', 'employees.emp_code', 'employees.display_name',
                'employees.date_of_joining',
                'master_departments.name as department_name',
                'master_designations.name as designation_name',
            ])
            ->map(fn ($e) => [
                'id'              => $e->id,
                'emp_code'        => $e->emp_code,
                'display_name'    => $e->display_name,
                'date_of_joining' => optional($e->date_of_joining)->toDateString(),
                'department_name' => $e->department_name,
                'designation_name'=> $e->designation_name,
            ]);

        // ── Upcoming joiners — future-dated employees + pending invites ──
        $upcomingFromEmployees = Employee::query()
            ->from('employees')
            ->where(fn ($q) => $this->applyScope($q, $user, $branchArg, 'employees'))
            ->whereNotNull('date_of_joining')
            ->whereDate('date_of_joining', '>', $now->toDateString())
            ->leftJoin('master_departments', 'master_departments.id', '=', 'employees.department_id')
            ->orderBy('employees.date_of_joining')
            ->limit(5)
            ->get([
                'employees.id', 'employees.display_name', 'employees.date_of_joining',
                'master_departments.name as department_name',
            ])
            ->map(fn ($e) => [
                'name'            => $e->display_name,
                'department_name' => $e->department_name,
                'join_date'       => optional($e->date_of_joining)->toDateString(),
                'source'          => 'employee',
            ]);

        $upcomingFromInvites = EmployeeOnboardingInvite::query()
            ->from('employee_onboarding_invites')
            ->where(fn ($q) => $this->applyScope($q, $user, $branchArg, 'employee_onboarding_invites'))
            ->where('employee_onboarding_invites.status', 'pending')
            ->whereNotNull('expected_join_date')
            ->whereDate('expected_join_date', '>', $now->toDateString())
            ->leftJoin('master_departments', 'master_departments.id', '=', 'employee_onboarding_invites.department_id')
            ->orderBy('employee_onboarding_invites.expected_join_date')
            ->limit(5)
            ->get([
                'employee_onboarding_invites.id',
                'employee_onboarding_invites.invitee_name',
                'employee_onboarding_invites.expected_join_date',
                'master_departments.name as department_name',
            ])
            ->map(fn ($i) => [
                'name'            => $i->invitee_name,
                'department_name' => $i->department_name,
                'join_date'       => optional($i->expected_join_date)->toDateString(),
                'source'          => 'invite',
            ]);

        $upcomingJoiners = $upcomingFromEmployees->concat($upcomingFromInvites)
            ->sortBy('join_date')
            ->take(5)
            ->values();

        // ── Department turnover % (last 12 months) ──────────────────────
        // turnover_pct = exits_in_window / current_headcount × 100.
        // Joins both sides on department_id and keeps only departments with
        // at least one current employee (avoids divide-by-zero for old depts
        // that have been emptied). Departments with no exits but non-zero
        // headcount still surface — they read as 0% (a useful "calm" signal).
        $headcountRows = $this->scopedTable($user, $branchArg, 'employees')
            ->leftJoin('master_departments', 'master_departments.id', '=', 'employees.department_id')
            ->select('employees.department_id', 'master_departments.name', DB::raw('COUNT(*) as headcount'))
            ->whereNotNull('employees.department_id')
            ->groupBy('employees.department_id', 'master_departments.name')
            ->get();

        $exitsByDept = $this->scopedTable($user, $branchArg, 'employee_exits')
            ->join('employees', 'employees.id', '=', 'employee_exits.employee_id')
            ->whereNotNull('employee_exits.last_working_day')
            ->whereDate('employee_exits.last_working_day', '>=', $twelveMonthAgo->toDateString())
            ->whereDate('employee_exits.last_working_day', '<=', $now->toDateString())
            ->select('employees.department_id', DB::raw('COUNT(*) as exits'))
            ->groupBy('employees.department_id')
            ->get()
            ->keyBy('department_id');

        $departmentTurnover = $headcountRows->map(function ($d) use ($exitsByDept) {
            $exits = (int) (optional($exitsByDept->get($d->department_id))->exits ?? 0);
            $headcount = (int) $d->headcount;
            $pct = $headcount > 0 ? round(($exits / $headcount) * 100, 1) : 0.0;
            return [
                'id'           => $d->department_id,
                'name'         => $d->name ?: 'Unassigned',
                'headcount'    => $headcount,
                'exits'        => $exits,
                'turnover_pct' => $pct,
            ];
        })
        ->sortByDesc('turnover_pct')
        ->values();

        // ── Probation snapshot (In Progress vs Completed) ────────────────
        // probation_months defaults to 0/null for "no probation policy"; we
        // count those as completed since there's no clock running. The
        // window check is done in PHP because the per-row interval varies
        // and DB drivers differ on date-add syntax.
        $probationRows = $this->scopedTable($user, $branchArg, 'employees')
            ->whereNotNull('date_of_joining')
            ->select('date_of_joining', 'probation_months')
            ->get();

        $inProbation = 0;
        $probationDone = 0;
        $today = $now->copy()->startOfDay();
        foreach ($probationRows as $row) {
            $months = (int) ($row->probation_months ?? 0);
            if ($months <= 0) { $probationDone++; continue; }
            try {
                $end = Carbon::parse($row->date_of_joining)->addMonths($months);
                if ($end->gt($today)) $inProbation++; else $probationDone++;
            } catch (\Throwable $e) {
                $probationDone++;
            }
        }
        $probationSnapshot = [
            'in_progress' => $inProbation,
            'completed'   => $probationDone,
        ];

        // ── Top 5 expense categories by amount ───────────────────────────
        // SUM(amount) groups identical category_name strings — the column
        // is denormalized on ExpenseClaim so we don't need the categories
        // master table. Approved + Pending both included so the chart
        // reflects total committed spend, not just settled.
        $expenseByCategory = $this->scopedTable($user, $branchArg, 'expense_claims')
            ->select('category_name', DB::raw('SUM(amount) as amount'), DB::raw('COUNT(*) as count'))
            ->whereNotNull('category_name')
            ->where('category_name', '!=', '')
            ->groupBy('category_name')
            ->orderByDesc(DB::raw('SUM(amount)'))
            ->limit(5)
            ->get()
            ->map(fn ($r) => [
                'category' => $r->category_name,
                'amount'   => (float) $r->amount,
                'count'    => (int) $r->count,
            ]);

        // ── Master record totals ─────────────────────────────────────────
        $totals = [
            'departments'  => $this->scopedModelCount(Departments::class,  $user, $branchArg),
            'designations' => $this->scopedModelCount(Designations::class, $user, $branchArg),
            'roles'        => $this->scopedModelCount(Roles::class,        $user, $branchArg),
        ];

        return response()->json([
            'kpis' => [
                'active_employees'       => $activeEmployees,
                'new_hires_this_month'   => $newHires,
                'open_positions'         => $openPositions,
                'pending_onboarding'     => $pendingOnboarding,
                'active_exits'           => $activeExits,
                'pending_expense_claims' => $pendingExpenseClaims,
            ],
            'totals'                => $totals,
            'by_department'         => $byDepartment,
            'by_gender'             => $byGender,
            'by_status'             => $byStatus,
            'joining_trend'         => $joiningTrend,
            'exit_trend'            => $exitTrend,
            'recruitment_by_status' => $recruitmentByStatus,
            'expense_by_status'     => $expenseByStatus,
            'recent_joiners'        => $recentJoiners,
            'upcoming_joiners'      => $upcomingJoiners,
            'department_turnover'   => $departmentTurnover,
            'probation_snapshot'    => $probationSnapshot,
            'expense_by_category'   => $expenseByCategory,
        ]);
    }

    /**
     *  Quick helper — `DB::table($name)` already scoped by tenant. Use this
     *  for simple aggregations that don't need an Eloquent model. The
     *  $tableName is also used to qualify the scope columns so joined
     *  queries don't trip Postgres' "ambiguous column" check.
     */
    private function scopedTable($user, ?int $branchFilter, string $tableName)
    {
        $q = DB::table($tableName);
        $this->applyScope($q, $user, $branchFilter, $tableName);
        return $q;
    }

    /** Count an Eloquent master model honoring tenant scope. */
    private function scopedModelCount(string $modelClass, $user, ?int $branchFilter): int
    {
        $instance = new $modelClass;
        $table = $instance->getTable();
        return $this->scopedTable($user, $branchFilter, $table)->count();
    }

    /**
     *  Group a date column into Y-m buckets between two inclusive month
     *  boundaries. Returns a strict 12-row series so chart axes are stable.
     */
    private function bucketByMonth($rows, string $column, Carbon $from, Carbon $to): array
    {
        $buckets = [];
        $cursor  = $from->copy();
        while ($cursor->lte($to)) {
            $buckets[$cursor->format('Y-m')] = 0;
            $cursor->addMonth();
        }
        foreach ($rows as $r) {
            $val = is_array($r) ? ($r[$column] ?? null) : $r->{$column};
            if (!$val) continue;
            $key = Carbon::parse($val)->format('Y-m');
            if (array_key_exists($key, $buckets)) {
                $buckets[$key]++;
            }
        }
        $out = [];
        foreach ($buckets as $k => $v) {
            $out[] = [
                'month' => $k,
                'label' => Carbon::createFromFormat('Y-m', $k)->format('M Y'),
                'count' => $v,
            ];
        }
        return $out;
    }

    /**
     *  Tenant scope — qualifies `client_id` / `branch_id` with the supplied
     *  table prefix so joined queries don't get "ambiguous column" errors
     *  on Postgres. Pass the table name even for un-joined queries; it's
     *  always safe to qualify.
     */
    private function applyScope($q, $user, ?int $branchFilter, string $table): void
    {
        $cl = "{$table}.client_id";
        $br = "{$table}.branch_id";

        if (!$user) { $q->whereRaw('1 = 0'); return; }

        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where($br, $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($cl, $user) {
                $w->whereNull($cl)->orWhere($cl, $user->client_id);
            });
            if ($branchFilter !== null) {
                $q->where($br, $branchFilter);
            }
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $q->where(function ($w) use ($cl, $user) {
                $w->whereNull($cl)->orWhere($cl, $user->client_id);
            });
            $q->where(function ($w) use ($br, $user) {
                $w->whereNull($br)->orWhere($br, $user->branch_id);
            });
            return;
        }

        $q->whereRaw('1 = 0');
    }
}
