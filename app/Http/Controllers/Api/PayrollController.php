<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Payslip;
use App\Models\PayrollPeriod;
use App\Models\PayrollRun;
use App\Services\PayrollService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Payroll operations endpoint. Every action is tenant-scoped from the
 * authenticated user (Rule 20 — never trust a client_id from the body) and the
 * active branch is taken from the Axios-injected `branch_id` query param.
 *
 * Routes (see routes/api.php):
 *   GET    /payroll/cycles                  list periods for the strip
 *   GET    /payroll?month=&year=            full cycle view (period+run+rows)
 *   POST   /payroll/finalize-attendance     Rule 1 gate
 *   GET    /payroll/preflight?month=&year=  blocking/warning issues
 *   POST   /payroll/run                     generate/regenerate (Rule 1/13/14)
 *   POST   /payroll/approve                 lock the run (Rule 15)
 *   POST   /payroll/pay                     disburse (Rule 12 bank gate)
 *   GET    /payroll/payslip/{id}            single payslip detail (Rule 16)
 *   GET    /payroll/export?month=&year=     CSV (Rule 17 permission gate)
 */
class PayrollController extends Controller
{
    public function __construct(
        private PayrollService $payroll,
        private \App\Services\PayslipPdfService $pdf,
    ) {}

    /* ───────────────────────── context ───────────────────────── */

    private function ctx(Request $request): array
    {
        $user = $request->user();
        return [
            'user_id'   => $user?->id,
            'client_id' => $user?->client_id,
            // Branch resolution (every branch is an equal, isolated peer):
            //  - super_admin / client_admin / client_user: use the switcher's
            //    branch_id, or null = the whole client.
            //  - branch_user: PINNED to their own branch (the switcher cannot
            //    widen their payroll scope — Rule 20).
            'branch_id' => $this->effectiveBranchId($request, $user),
        ];
    }

    /** Resolve the branch a user may operate payroll in (see ctx() notes). */
    private function effectiveBranchId(Request $request, $user): ?int
    {
        if (!$user) return null;
        $requested = $request->integer('branch_id') ?: null;

        // Branch users are confined to their own branch, full stop — every
        // branch is an isolated peer.
        if ($user->user_type === 'branch_user' && $user->branch_id) {
            return (int) $user->branch_id;
        }
        // Everyone else: honour the switcher, default to their own branch (if
        // any), else the whole client (null).
        return $requested ?: ($user->branch_id ?: null);
    }

    /**
     * Server-side gate for state-changing payroll actions (finalize / run /
     * approve / pay / reopen). Mirrors canExport but on the edit/approve grant.
     * Plain employees can never manage payroll, even if the menu leaks through.
     */
    private function canManage(Request $request): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin'], true)) return true;
        if ($user->user_type === 'employee') return false;
        $perm = $user->permissions['hr.payroll'] ?? null;
        if (is_array($perm) && (($perm['can_edit'] ?? false) || ($perm['can_approve'] ?? false))) return true;
        // A branch_user (branch admin) manages their branch's payroll.
        return $user->user_type === 'branch_user';
    }

    /** Processing actions need a concrete tenant scope — a super-admin with no
     *  client/branch selected would otherwise pool every tenant's employees
     *  into one run. Returns an error response when scope is missing, else null. */
    private function requireScope(array $ctx)
    {
        if (empty($ctx['client_id']) && empty($ctx['branch_id'])) {
            return response()->json(['message' => 'Select a client or branch before processing payroll.'], 422);
        }
        return null;
    }

    private function resolveMonthYear(Request $request): array
    {
        $month = (int) $request->query('month', $request->input('month', now()->month));
        $year  = (int) $request->query('year', $request->input('year', now()->year));
        if ($month < 1 || $month > 12) $month = (int) now()->month;
        if ($year < 2000 || $year > 2100) $year = (int) now()->year;
        return [$month, $year];
    }

    /**
     * Bug #22 guard — payroll for a period must not be generated/processed
     * before that period has begun. A future cycle (e.g. July while it is still
     * June) has no attendance to draw from, so generating it produces a bogus
     * fully-LOP'd run. Viewing a future cycle is fine; only the mutating
     * generate/finalize actions are blocked.
     *
     * Returns a 422 JsonResponse to short-circuit the caller, or null when the
     * period is current/past and processing may proceed.
     */
    private function guardPeriodStarted(PayrollPeriod $period): ?\Illuminate\Http\JsonResponse
    {
        $start = $period->period_start instanceof Carbon
            ? $period->period_start->copy()
            : Carbon::parse($period->period_start);

        if ($start->startOfDay()->isFuture()) {
            return response()->json([
                'message' => "Payroll for {$period->label} cannot be processed before the period begins on {$start->format('d M Y')}.",
            ], 422);
        }

        return null;
    }

    /* ───────────────────────── cycles ────────────────────────── */

    /** Trailing 13-month strip (existing periods + synthesised placeholders). */
    public function cycles(Request $request)
    {
        $ctx = $this->ctx($request);
        $periods = PayrollPeriod::query()
            ->when($ctx['client_id'], fn ($q) => $q->where('client_id', $ctx['client_id']))
            ->when($ctx['branch_id'], fn ($q) => $q->where('branch_id', $ctx['branch_id']))
            ->get()
            ->keyBy(fn ($p) => $p->year . '-' . $p->month);

        // Batch-load the latest run per period in ONE query instead of querying
        // runs() per period inside the loop (N+1). cycleDisplayStatus only needs
        // the most-recent run's status, so group by period and keep the top id.
        // (Mirrors the pattern already used by history().)
        $latestRuns = $periods->isEmpty()
            ? collect()
            : PayrollRun::whereIn('payroll_period_id', $periods->pluck('id'))
                ->get()
                ->groupBy('payroll_period_id')
                ->map(fn ($g) => $g->sortByDesc('id')->first());

        $out = [];
        $cursor = now()->startOfMonth()->subMonths(11);
        for ($i = 0; $i < 13; $i++) {
            $m = (int) $cursor->month;
            $y = (int) $cursor->year;
            $existing = $periods->get("$y-$m");
            $out[] = [
                'key'    => strtolower($cursor->format('M')) . '-' . $y,
                'label'  => $cursor->format('M Y'),
                'range'  => $cursor->copy()->startOfMonth()->format('d M') . '–' . $cursor->copy()->endOfMonth()->format('d M'),
                'month'  => $m,
                'year'   => $y,
                'status' => $this->cycleDisplayStatus($existing, $cursor, $existing ? $latestRuns->get($existing->id) : null),
            ];
            $cursor->addMonth();
        }
        return response()->json(['data' => $out]);
    }

    private function cycleDisplayStatus(?PayrollPeriod $period, Carbon $cursor, ?PayrollRun $run = null): string
    {
        if ($period) {
            // A finished cycle is COMPLETED. Full disbursement both flips the run
            // to 'paid' AND locks the period — checking the locked period (not
            // just the latest run) keeps a settled month showing Completed even
            // if a later draft/empty run was created on top of the paid one.
            if ($period->status === 'locked' || ($run && $run->status === 'paid')) {
                return 'Completed';
            }
            if ($period->status === 'processing' || ($run && in_array($run->status, ['generated', 'approved']))) return 'In Progress';
            if ($period->attendance_finalized)       return 'In Progress';
        }
        if ($cursor->isFuture() && !$cursor->isSameMonth(now())) return 'Not Started';
        return $period ? 'In Progress' : 'Not Started';
    }

    /**
     * Payroll history across cycles — per-cycle summaries + the full set of
     * payslip rows (every column) for an "overall data" Excel export. Tenant
     * scoped; an employee only ever sees their own rows.
     */
    public function history(Request $request)
    {
        $ctx = $this->ctx($request);
        $user = $request->user();

        $periods = PayrollPeriod::query()
            ->when($ctx['client_id'], fn ($q) => $q->where('client_id', $ctx['client_id']))
            ->when($ctx['branch_id'], fn ($q) => $q->where('branch_id', $ctx['branch_id']))
            ->orderByDesc('year')->orderByDesc('month')
            ->limit(36)
            ->get();

        $periodIds = $periods->pluck('id');
        $runs = PayrollRun::whereIn('payroll_period_id', $periodIds)
            ->get()->groupBy('payroll_period_id')
            ->map(fn ($g) => $g->sortByDesc('id')->first());

        $cycles = $periods->map(function (PayrollPeriod $p) use ($runs) {
            $r = $runs->get($p->id);
            return [
                'period_id'        => $p->id,
                'label'            => $p->label,
                'month'            => $p->month,
                'year'             => $p->year,
                'status'           => $p->status,
                'attendance_final' => (bool) $p->attendance_finalized,
                'run_status'       => $r?->status,
                'employees'        => (int) ($r?->total_employees ?? 0),
                'on_hold'          => (int) ($r?->employees_on_hold ?? 0),
                'gross'            => (float) ($r?->total_gross ?? 0),
                'deductions'       => (float) ($r?->total_deductions ?? 0),
                'net'              => (float) ($r?->total_net ?? 0),
                'paid_at'          => optional($r?->paid_at)->toDateString(),
            ];
        })->values();

        $labelMap = $periods->pluck('label', 'id');
        $slipQ = Payslip::whereIn('payroll_period_id', $periodIds);
        if ($user && $user->user_type === 'employee') {
            $slipQ->where('employee_id', (int) ($user->employee_id ?? 0));
        }
        $rows = $slipQ->orderByDesc('payroll_period_id')->orderBy('employee_name')
            ->limit(8000)
            ->get()
            ->map(fn ($s) => [
                'cycle'            => $labelMap[$s->payroll_period_id] ?? '',
                'employee_code'    => $s->employee_code,
                'employee_name'    => $s->employee_name,
                'department'       => $s->department,
                'designation'      => $s->designation,
                'working_days'     => (float) $s->working_days,
                'present_days'     => (float) $s->present_days,
                'paid_days'        => (float) $s->paid_days,
                'lop_days'         => (float) $s->lop_days,
                'paid_leave_days'  => (float) $s->paid_leave_days,
                'unpaid_leave_days'=> (float) $s->unpaid_leave_days,
                'late_marks'       => (int) $s->late_marks,
                'missing_punches'  => (int) $s->missing_punches,
                'att_source'       => $s->att_source,
                'gross_earnings'   => (float) $s->gross_earnings,
                'basic'            => (float) $s->basic,
                'pf_employee'      => (float) $s->pf_employee,
                'esi'              => (float) $s->esi,
                'pt'               => (float) $s->pt,
                'tds'              => (float) $s->tds,
                'lop_amount'       => (float) $s->lop_amount,
                'advance_recovery' => (float) $s->advance_recovery,
                'total_deductions' => (float) $s->total_deductions,
                'net_pay'          => (float) $s->net_pay,
                'status'           => $s->status,
                'bank_account'     => $s->bank_account_number,
                'ifsc'             => $s->ifsc_code,
            ])->values();

        return response()->json(['data' => ['cycles' => $cycles, 'rows' => $rows]]);
    }

    /**
     * Mirror of Employee::getEncryptedIdAttribute — produce the same URL-safe
     * encrypted token from a bare employee id (the payroll rows come off
     * Payslip, not Employee, so the accessor isn't available here). The
     * resolver in resolveIdParam inverts this before Crypt::decryptString.
     */
    private function encId($employeeId): ?string
    {
        if (!$employeeId) return null;
        try {
            return rtrim(strtr(\Illuminate\Support\Facades\Crypt::encryptString((string) $employeeId), '+/', '-_'), '=');
        } catch (\Throwable $e) {
            return null;
        }
    }

    /* ───────────────────────── cycle view ────────────────────── */

    public function index(Request $request)
    {
        [$month, $year] = $this->resolveMonthYear($request);
        $ctx = $this->ctx($request);

        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);
        $run = $period->runs()->latest('id')->first();
        $rows = Payslip::where('payroll_period_id', $period->id)
            ->when($run, fn ($q) => $q->where('payroll_run_id', $run->id))
            ->orderBy('employee_name')
            ->get()
            ->map(fn ($p) => $this->serializePayslip($p));

        return response()->json([
            'data' => [
                'period'  => $this->serializePeriod($period, $run),
                'run'     => $run ? $this->serializeRun($run) : null,
                'rows'    => $rows,
                'counts'  => $this->counts($rows),
            ],
        ]);
    }

    public function finalizeAttendance(Request $request)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to process payroll.'], 403);
        }
        [$month, $year] = $this->resolveMonthYear($request);
        $ctx = $this->ctx($request);
        if ($scopeErr = $this->requireScope($ctx)) return $scopeErr;
        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);
        if ($futureErr = $this->guardPeriodStarted($period)) return $futureErr;

        if ($period->status === 'locked') {
            return response()->json(['message' => 'Period is locked.'], 422);
        }

        // Surface attendance coverage so HR knows what they're locking in — an
        // employee with zero attendance rows will be fully LOP'd.
        $coverage = $this->payroll->attendanceCoverage($period);

        $this->payroll->finalizeAttendance($period, $ctx['user_id']);
        $this->audit($request, 'finalize_attendance', $period, "Attendance finalized for {$period->label}");

        $msg = "Attendance finalized for {$period->label}.";
        if ($coverage['missing'] > 0) {
            $msg .= " {$coverage['missing']} of {$coverage['total']} employees have no attendance this cycle.";
        }

        return response()->json([
            'message'  => $msg,
            'coverage' => $coverage,
            'data'     => $this->serializePeriod($period->fresh(), null),
        ]);
    }

    /** Rule 15 correction path — revert a non-paid run to draft so HR can fix
     *  attendance/leave and re-run. Paid runs are immutable (adjust next cycle). */
    public function reopen(Request $request)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to process payroll.'], 403);
        }
        [$month, $year] = $this->resolveMonthYear($request);
        $ctx = $this->ctx($request);
        if ($scopeErr = $this->requireScope($ctx)) return $scopeErr;
        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);
        $run = $period->runs()->latest('id')->first();

        if ($run && $run->status === 'paid') {
            return response()->json(['message' => 'Paid payroll cannot be reopened — post an adjustment in the next cycle.'], 422);
        }
        // Guard against double payment: if some employees were already paid in a
        // partial disbursement, reopening would wipe + re-pay them.
        if ($run && Payslip::where('payroll_run_id', $run->id)->where('status', 'Paid')->exists()) {
            return response()->json(['message' => 'Some employees are already paid in this cycle — pay the remaining held employees instead of reopening.'], 422);
        }

        $this->payroll->reopen($period);
        $this->audit($request, 'reopen', $period, "Payroll reopened for {$period->label}");

        return response()->json([
            'message' => "Payroll for {$period->label} reopened for corrections.",
            'data'    => $this->serializePeriod($period->fresh(), $period->runs()->latest('id')->first()),
        ]);
    }

    /** Pre-flight: compute issues without persisting (drives the run modal). */
    /**
     * Leaves inside the selected cycle whose day count the branch's Sandwich
     * Leave Policy has inflated — the review list the payroll screen shows so a
     * genuine emergency can be excused before the run is finalised.
     *
     * The policy fires on the shape of the calendar and cannot tell a
     * bereavement from a stretched long weekend. Payroll is the last point at
     * which a human sees the consequence in money terms, so the exemption has
     * to be reachable from here — not only from the leave approval screen the
     * approver saw weeks earlier.
     *
     * Read-only. Toggling the waiver itself goes through
     * LeaveRequestController::sandwichWaiver(), which also re-sizes the leave,
     * so payroll never gets its own private idea of what a leave costs.
     */
    public function sandwichReview(Request $request)
    {
        [$month, $year] = $this->resolveMonthYear($request);
        $ctx    = $this->ctx($request);
        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);

        $start = Carbon::parse($period->period_start)->startOfDay();
        $end   = Carbon::parse($period->period_end)->endOfDay();

        $items = [];
        // Only employees this cycle actually pays — a leave belonging to someone
        // payroll skips (half-onboarded, exited) is not reviewable here.
        foreach ($this->payroll->eligibleEmployees($period) as $employee) {
            if (!\App\Support\SandwichPolicy::appliesTo($employee)) continue;

            $leaves = \App\Models\LeaveRequest::query()
                ->where('employee_id', $employee->id)
                ->where('status', 'Approved')
                ->whereDate('from_date', '<=', $end->toDateString())
                ->whereDate('to_date', '>=', $start->toDateString())
                ->orderBy('from_date')
                ->get();

            foreach ($leaves as $leave) {
                // How many days the policy contributed — the difference between
                // sizing the leave with the rule and without it. Derived, never
                // stored, so it stays true as neighbouring leaves change.
                $bd    = $this->payroll->sandwichBreakdown($employee, $leave);
                $extra = $bd['sandwich'];

                /* Only list a leave the policy is ACTUALLY charging for.
                 *
                 * Turning the branch switch on does not retroactively re-price
                 * leaves that were approved before it — leave_requests.days is
                 * what both the balance and the payslip read, and it stays as
                 * approved. Such a leave still LOOKS sandwiched (its dates
                 * straddle an off-day), but nothing is being deducted for those
                 * days, so offering "don't deduct them" was an action against a
                 * charge that does not exist. Those rows are dropped; a waived
                 * one is kept so the decision stays visible. */
                $policyTotal = $bd['working'] + $extra;
                $alreadyCharged = (float) $leave->days >= $policyTotal - 0.001;

                if (!$leave->sandwich_waived && ($extra <= 0 || !$alreadyCharged)) continue;

                $items[] = [
                    'leave_id'       => $leave->id,
                    'employee_id'    => $employee->id,
                    'emp_code'       => $employee->emp_code,
                    'emp_name'       => trim(($employee->display_name ?: ($employee->first_name . ' ' . $employee->last_name))),
                    'department'     => $employee->department?->name ?? '—',
                    'from_date'      => Carbon::parse($leave->from_date)->toDateString(),
                    'to_date'        => Carbon::parse($leave->to_date)->toDateString(),
                    'days'           => (float) $leave->days,
                    'sandwich_days'  => $extra,
                    // What the leave costs with the policy fully applied. The
                    // screen compares this against `days` to know whether the
                    // off-days are ALREADY counted or still pending.
                    'days_with_policy' => $bd['working'] + $extra,
                    'waived'         => (bool) $leave->sandwich_waived,
                    'waiver_reason'  => $leave->sandwich_waiver_reason,
                ];
            }
        }

        return response()->json(['data' => $items]);
    }

    public function preflight(Request $request)
    {
        [$month, $year] = $this->resolveMonthYear($request);
        $ctx = $this->ctx($request);
        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);

        // Prefer the already-generated payslips' exceptions; otherwise dry-run.
        $run = $period->runs()->latest('id')->first();
        if ($run) {
            $slips = Payslip::where('payroll_run_id', $run->id)->get();
        } else {
            $slips = $this->payroll->eligibleEmployees($period)->map(function ($e) use ($period) {
                $data = $this->payroll->computeForEmployee($e, $period);
                return new Payslip($data + ['employee_id' => $e->id]);
            });
        }

        $issues = [];
        $blockedAmount = 0;
        $atRiskAmount = 0;
        foreach ($slips as $s) {
            $ex = (array) ($s->exceptions ?? []);
            if (empty($ex)) continue;
            $type = collect($ex)->contains(fn ($e) => $e['type'] === 'blocking') ? 'blocking' : 'warning';
            if ($type === 'blocking') $blockedAmount += (float) $s->net_pay;
            else $atRiskAmount += (float) $s->net_pay;
            $issues[] = [
                'id'         => 'PS-' . ($s->id ?? $s->employee_id),
                'type'       => $type,
                'empCode'    => $s->employee_code,
                'empName'    => $s->employee_name,
                'department' => $s->department,
                'reasons'    => collect($ex)->pluck('reason')->all(),
            ];
        }

        return response()->json([
            'data' => [
                'attendance_finalized' => (bool) $period->attendance_finalized,
                'issues'         => $issues,
                'blocked_amount' => round($blockedAmount, 2),
                'at_risk_amount' => round($atRiskAmount, 2),
                'excluded'       => $this->payroll->payrollExclusions($period),
            ],
        ]);
    }

    public function run(Request $request)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to process payroll.'], 403);
        }
        [$month, $year] = $this->resolveMonthYear($request);
        $ctx = $this->ctx($request);
        if ($scopeErr = $this->requireScope($ctx)) return $scopeErr;
        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);
        if ($futureErr = $this->guardPeriodStarted($period)) return $futureErr;

        try {
            $run = $this->payroll->generate($period, $ctx);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $this->audit($request, 'run', $run, "Payroll generated for {$period->label} ({$run->total_employees} employees)");

        return response()->json([
            'message' => "Payroll generated for {$period->label}.",
            'data'    => $this->serializeRun($run),
        ]);
    }

    public function approve(Request $request)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to approve payroll.'], 403);
        }
        $run = $this->findRun($request);
        if (!$run) return response()->json(['message' => 'Payroll run not found.'], 404);
        if ($run->isLocked()) return response()->json(['message' => 'Run is already approved/paid.'], 422);
        if ($run->total_employees === 0) return response()->json(['message' => 'Nothing to approve — generate payroll first.'], 422);

        $run->forceFill(['status' => 'approved', 'approved_by' => $request->user()?->id, 'approved_at' => now()])->save();
        $this->audit($request, 'approve', $run, "Payroll approved for run #{$run->id}", ['status' => 'generated'], ['status' => 'approved']);

        return response()->json(['message' => 'Payroll approved.', 'data' => $this->serializeRun($run)]);
    }

    /**
     * Disburse — Rule 12. Pays every clear payslip and HOLDS those still
     * missing bank details / under a blocking issue. Bank details are
     * re-checked against the live employee record at pay time, so an HR fix
     * after generation is picked up here without a full regenerate.
     *
     * The period is locked ONLY when nothing remains held — otherwise the run
     * stays 'approved' so HR can fix the held employees and call pay again.
     * Already-paid slips are never re-paid (no double disbursement).
     */
    public function pay(Request $request)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to disburse payroll.'], 403);
        }
        $run = $this->findRun($request);
        if (!$run) return response()->json(['message' => 'Payroll run not found.'], 404);
        if (!in_array($run->status, ['approved', 'paid'], true)) {
            return response()->json(['message' => 'Approve the payroll before paying.'], 422);
        }
        // A 'paid' status is allowed back in ONLY to clear previously-held slips.
        // If nothing is outstanding, refuse — don't let a settled run be re-run
        // (which, after a recompute reset a slip, could re-pay without approval).
        if ($run->status === 'paid'
            && \App\Models\Payslip::where('payroll_run_id', $run->id)->where('status', '!=', 'Paid')->doesntExist()) {
            return response()->json(['message' => 'This payroll run is already fully paid.'], 422);
        }

        // Shared disbursement logic (also used by the Proceed-to-Pay flow).
        $result = $this->payroll->disburseRun($run, $request->user()?->id);
        $paidCount = $result['paid'];
        $heldCount = $result['held'];

        $this->audit($request, 'pay', $run, "Payroll paid for run #{$run->id} ({$paidCount} paid, {$heldCount} held)", ['status' => 'approved'], ['status' => $heldCount === 0 ? 'paid' : 'approved', 'paid' => $paidCount, 'held' => $heldCount]);

        $msg = $heldCount === 0
            ? "Payment completed for {$paidCount} employees."
            : "Paid {$paidCount}; {$heldCount} held for bank/blocking issues — resolve and pay again.";

        return response()->json([
            'message' => $msg,
            'data'    => [
                'paid' => $paidCount,
                'held' => $heldCount,
                'run'  => $this->serializeRun($run->fresh()),
            ],
        ]);
    }

    /** Rule 21 — Full & Final Settlement preview for an exited employee.
     *  Optional query params: leave_encashment_days, notice_recovery_amount,
     *  other_dues, other_deductions. */
    public function fnf(Request $request, int $employeeId)
    {
        $user = $request->user();
        // FnF exposes full salary + settlement figures — manage-only, never the
        // employee tier (which previously could read any colleague's FnF).
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You do not have permission to view full-and-final settlements.'], 403);
        }
        $employee = \App\Models\Employee::find($employeeId);
        if (!$employee) {
            return response()->json(['message' => 'Employee not found.'], 404);
        }
        // Strict tenant match (a null client_id must not pass as "same tenant").
        if ($user && $user->user_type !== 'super_admin' && (int) $employee->client_id !== (int) $user->client_id) {
            return response()->json(['message' => 'Employee belongs to another tenant.'], 403);
        }

        // FnF is only meaningful for an exiting employee — without an exit record
        // the engine silently used "today" as the last working day and produced a
        // bogus settlement for an active employee. (P25)
        $hasExit = \Illuminate\Support\Facades\Schema::hasTable('employee_exits')
            && \Illuminate\Support\Facades\DB::table('employee_exits')->where('employee_id', $employee->id)->exists();
        if (!$hasExit) {
            return response()->json(['message' => 'This employee has no exit record. Initiate the exit before computing a full & final settlement.'], 422);
        }

        // Validate the HR-decided numeric inputs (were taken raw from the query —
        // negatives/garbage flowed straight into the calc). (P24)
        $request->validate([
            'leave_encashment_days'  => ['nullable', 'numeric', 'min:0', 'max:365'],
            'notice_recovery_amount' => ['nullable', 'numeric', 'min:0', 'max:100000000'],
            'other_dues'             => ['nullable', 'numeric', 'min:0', 'max:100000000'],
            'other_deductions'       => ['nullable', 'numeric', 'min:0', 'max:100000000'],
        ]);

        $opts = [
            'leave_encashment_days'  => $request->query('leave_encashment_days'),
            'notice_recovery_amount' => $request->query('notice_recovery_amount'),
            'other_dues'             => $request->query('other_dues'),
            'other_deductions'       => $request->query('other_deductions'),
        ];
        return response()->json(['data' => $this->payroll->computeFnf($employee, $opts)]);
    }

    /** Rule 16 — single payslip (full component breakdown + finalization flag). */
    public function payslip(Request $request, int $id)
    {
        $slip = Payslip::with('run:id,status')->find($id);
        if (!$slip || !$this->ownsRow($request, $slip)) {
            return response()->json(['message' => 'Payslip not found.'], 404);
        }
        // Self-service guard (mirrors payslipPdf) — an employee may only open
        // their OWN payslip, not a colleague's full pay + bank breakdown.
        $user = $request->user();
        if ($user && $user->user_type === 'employee' && (int) ($user->employee_id ?? 0) !== (int) $slip->employee_id) {
            return response()->json(['message' => 'You can only view your own payslip.'], 403);
        }
        $data = $this->serializePayslip($slip, true);
        // Real (branch-resolved) company letterhead for the on-screen viewer.
        $data['company'] = $this->pdf->letterhead($slip);
        $data['period_label'] = $this->periodLabelFor($slip);
        return response()->json(['data' => $data]);
    }

    /** Salary-slip history for one employee across cycles (Rule 16). Only
     *  finalized (approved/paid) payslips are official; drafts are flagged
     *  provisional so the UI can mark them. Tenant-gated. */
    public function employeePayslips(Request $request, int $employeeId)
    {
        $user = $request->user();
        $slips = Payslip::with(['run:id,status', 'period:id,label,month,year'])
            ->where('employee_id', $employeeId)
            ->when($user && $user->client_id, fn ($q) => $q->where('client_id', $user->client_id))
            ->orderByDesc('payroll_period_id')
            ->limit(24)
            ->get();

        // Self-service: an employee may only see their own slips.
        if ($user && $user->user_type === 'employee' && (int) ($user->employee_id ?? 0) !== $employeeId) {
            return response()->json(['message' => 'You can only view your own payslips.'], 403);
        }

        return response()->json([
            'data' => $slips->map(fn ($s) => [
                'payslip_id' => $s->id,
                'label'      => $s->period?->label ?? '',
                'month'      => $s->period?->month,
                'year'       => $s->period?->year,
                'net_pay'    => (float) $s->net_pay,
                'status'     => $s->status,
                'is_final'   => in_array($s->run?->status, ['approved', 'paid'], true),
            ])->values(),
        ]);
    }

    /** Single payslip PDF (matches the house letterhead, branch-branded).
     *  ?download=1 forces attachment; default is inline preview. */
    public function payslipPdf(Request $request, int $id)
    {
        $slip = Payslip::with('run:id,status')->find($id);
        if (!$slip || !$this->ownsRow($request, $slip)) {
            return response()->json(['message' => 'Payslip not found.'], 404);
        }
        $user = $request->user();
        if ($user && $user->user_type === 'employee' && (int) ($user->employee_id ?? 0) !== (int) $slip->employee_id) {
            return response()->json(['message' => 'You can only download your own payslip.'], 403);
        }

        // A payslip with an unresolved status must not be generated — On Hold
        // (blocking issue) and Pending Review (needs HR verification) slips are
        // not final figures, so producing a PDF would hand out a wrong slip.
        if (in_array($slip->status, ['On Hold', 'Pending Review'], true)) {
            return response()->json([
                'message' => "Payslip can't be generated while the status is \"{$slip->status}\". Resolve the issue and set the payroll to Ready first.",
            ], 422);
        }

        $bytes = $this->pdf->render($slip);
        $disposition = $request->boolean('download') ? 'attachment' : 'inline';
        $this->audit($request, 'payslip_pdf', $slip, "Payslip PDF for {$slip->employee_name}");

        return response($bytes, 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => $disposition . '; filename="' . $this->pdf->filename($slip) . '"',
        ]);
    }

    /** Bulk download — every payslip in the cycle zipped into one archive.
     *  Permission-gated (Rule 17) and filter-aware (department/status). */
    public function payslipsBulk(Request $request)
    {
        if (!$this->canExport($request)) {
            return response()->json(['message' => 'You are not allowed to download payslips.'], 403);
        }
        if (!class_exists(\ZipArchive::class)) {
            return response()->json(['message' => 'ZIP support is unavailable on the server.'], 500);
        }

        [$month, $year] = $this->resolveMonthYear($request);
        $ctx = $this->ctx($request);
        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);
        $run = $period->runs()->latest('id')->first();

        $slips = Payslip::where('payroll_period_id', $period->id)
            ->when($run, fn ($q) => $q->where('payroll_run_id', $run->id))
            ->when($request->query('department'), fn ($q, $d) => $q->where('department', $d))
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            // Unresolved slips (On Hold / Pending Review) aren't final, so they
            // are excluded from bulk generation just like the single download.
            ->whereNotIn('status', ['On Hold', 'Pending Review'])
            ->with('run:id,status')
            ->orderBy('employee_name')
            ->get();

        if ($slips->isEmpty()) {
            return response()->json(['message' => 'No payslips to download — generate payroll first.'], 422);
        }

        // dompdf is ~1s/slip; give a large batch enough headroom to finish.
        @set_time_limit(max(120, $slips->count() * 3));

        $tmp = tempnam(sys_get_temp_dir(), 'pslip');
        $zip = new \ZipArchive();
        $zip->open($tmp, \ZipArchive::OVERWRITE);
        $used = [];
        foreach ($slips as $slip) {
            $name = $this->pdf->filename($slip);
            if (isset($used[$name])) {
                $name = preg_replace('/\.pdf$/', '', $name) . '_' . $slip->id . '.pdf';
            }
            $used[$name] = true;
            $zip->addFromString($name, $this->pdf->render($slip));
        }
        $zip->close();

        $this->audit($request, 'payslips_bulk', $period, "Bulk payslip download for {$period->label} ({$slips->count()} slips)");

        $zipName = 'Payslips_' . preg_replace('/[^A-Za-z0-9]+/', '_', $period->label) . '.zip';
        return response()->download($tmp, $zipName, ['Content-Type' => 'application/zip'])->deleteFileAfterSend(true);
    }

    /** Email one employee their payslip PDF (Rule 16 — final payslips only). */
    public function emailPayslip(Request $request, int $id)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to email payslips.'], 403);
        }
        $slip = Payslip::with('run:id,status')->find($id);
        if (!$slip || !$this->ownsRow($request, $slip)) {
            return response()->json(['message' => 'Payslip not found.'], 404);
        }
        if (!$this->isFinalSlip($slip)) {
            return response()->json(['message' => 'Approve the payroll before emailing payslips.'], 422);
        }
        if (in_array($slip->status, ['On Hold', 'Pending Review'], true)) {
            return response()->json([
                'message' => "Payslip can't be emailed while the status is \"{$slip->status}\". Resolve the issue first.",
            ], 422);
        }

        $result = $this->sendPayslipMail($slip);
        if (!$result['ok']) {
            return response()->json(['message' => $result['message']], 422);
        }
        $this->audit($request, 'email_payslip', $slip, "Payslip emailed to {$slip->employee_name} <{$result['to']}>");

        return response()->json(['message' => "Payslip emailed to {$slip->employee_name} ({$result['to']})."]);
    }

    /** Email every (final) payslip in the cycle to each employee. Returns a
     *  per-recipient summary so HR sees who was skipped (no email on file). */
    public function emailPayslipsBulk(Request $request)
    {
        if (!$this->canManage($request) && !$this->canExport($request)) {
            return response()->json(['message' => 'You are not allowed to email payslips.'], 403);
        }
        [$month, $year] = $this->resolveMonthYear($request);
        $ctx = $this->ctx($request);
        if ($scopeErr = $this->requireScope($ctx)) return $scopeErr;
        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);
        $run = $period->runs()->latest('id')->first();

        // P28: explicit "finalized" check instead of the fragile
        // `!isLocked() && status!=='approved'` precedence soup.
        $finalized = $run && ($run->isLocked() || in_array($run->status, ['approved', 'paid'], true));
        if (!$finalized) {
            return response()->json(['message' => 'Approve the payroll before emailing payslips.'], 422);
        }

        $slips = Payslip::where('payroll_run_id', $run->id)
            ->when($request->query('department'), fn ($q, $d) => $q->where('department', $d))
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->with('run:id,status')
            ->orderBy('employee_name')
            ->get();

        if ($slips->isEmpty()) {
            return response()->json(['message' => 'No payslips to email — generate payroll first.'], 422);
        }

        @set_time_limit(max(120, $slips->count() * 4));

        $sent = 0; $skipped = []; $failed = [];
        foreach ($slips as $slip) {
            if (!$this->isFinalSlip($slip)) { $skipped[] = $slip->employee_name . ' (not finalized)'; continue; }
            $r = $this->sendPayslipMail($slip);
            if ($r['ok']) $sent++;
            elseif (str_contains($r['message'], 'no email')) $skipped[] = $slip->employee_name . ' (no email)';
            else $failed[] = $slip->employee_name;
        }

        $this->audit($request, 'email_payslips_bulk', $period, "Bulk payslip email for {$period->label}: {$sent} sent, " . count($skipped) . " skipped, " . count($failed) . " failed");

        return response()->json([
            'message' => "Emailed {$sent} payslip" . ($sent === 1 ? '' : 's')
                . (count($skipped) ? ', ' . count($skipped) . ' skipped' : '')
                . (count($failed) ? ', ' . count($failed) . ' failed' : '') . '.',
            'data' => ['sent' => $sent, 'skipped' => $skipped, 'failed' => $failed],
        ]);
    }

    /** Resolve recipient + render PDF + send. Returns ['ok'=>bool,...]. */
    private function sendPayslipMail(Payslip $slip): array
    {
        $employee = \App\Models\Employee::find($slip->employee_id);
        $to = $employee?->official_email ?: ($employee?->email ?: null);
        if (!$to || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return ['ok' => false, 'message' => 'Employee has no email on file.'];
        }

        try {
            $head = $this->pdf->letterhead($slip);
            $bytes = $this->pdf->render($slip);
            \Illuminate\Support\Facades\Mail::to($to)->send(new \App\Mail\PayslipMail(
                employeeName: $slip->employee_name ?: 'Employee',
                periodLabel:  $this->periodLabelFor($slip),
                companyName:  $head['name'] ?? 'Company',
                hrEmail:      $head['hr_email'] ?? null,
                pdfBytes:     $bytes,
                pdfFilename:  $this->pdf->filename($slip),
            ));
            return ['ok' => true, 'to' => $to];
        } catch (\Throwable $e) {
            return ['ok' => false, 'message' => 'Mail send failed: ' . $e->getMessage()];
        }
    }

    private function isFinalSlip(Payslip $slip): bool
    {
        return in_array(optional($slip->run)->status, ['approved', 'paid'], true) || $slip->status === 'Paid';
    }

    private function periodLabelFor(Payslip $slip): string
    {
        return DB::table('payroll_periods')->where('id', $slip->payroll_period_id)->value('label') ?: now()->format('M Y');
    }

    /** Rule 17 — filtered CSV export, permission-gated. */
    public function export(Request $request): StreamedResponse
    {
        abort_unless($this->canExport($request), 403, 'You are not allowed to export payroll.');

        [$month, $year] = $this->resolveMonthYear($request);
        $ctx = $this->ctx($request);
        // P29: require a concrete tenant scope — without this a super-admin with
        // no client/branch selected would pool every tenant's payslips into one
        // export. (abort_if, since this method must return a StreamedResponse.)
        abort_if(empty($ctx['client_id']) && empty($ctx['branch_id']), 422, 'Select a client or branch before exporting payroll.');
        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);
        $run = $period->runs()->latest('id')->first();

        $q = Payslip::where('payroll_period_id', $period->id)
            ->when($run, fn ($q) => $q->where('payroll_run_id', $run->id))
            ->when($request->query('department'), fn ($q, $d) => $q->where('department', $d))
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->orderBy('employee_name');

        $filename = 'payroll_' . $period->label . '.csv';
        $headers = [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"$filename\"",
        ];

        return response()->stream(function () use ($q) {
            $out = fopen('php://output', 'w');
            fputcsv($out, [
                'Emp Code', 'Employee', 'Department', 'Designation',
                'Working Days', 'Paid Days', 'LOP Days',
                'Gross', 'PF', 'ESI', 'PT', 'TDS', 'LOP Amt', 'Advance Rec',
                'Total Deductions', 'Net Pay', 'Status',
            ]);
            $q->chunk(200, function ($slips) use ($out) {
                foreach ($slips as $s) {
                    fputcsv($out, [
                        $s->employee_code, $s->employee_name, $s->department, $s->designation,
                        $s->working_days, $s->paid_days, $s->lop_days,
                        $s->gross_earnings, $s->pf_employee, $s->esi, $s->pt, $s->tds,
                        $s->lop_amount, $s->advance_recovery,
                        $s->total_deductions, $s->net_pay, $s->status,
                    ]);
                }
            });
            fclose($out);
        }, 200, $headers);
    }

    /* ───────────────────────── helpers ───────────────────────── */

    private function findRun(Request $request): ?PayrollRun
    {
        $ctx = $this->ctx($request);
        $id = (int) $request->input('run_id', $request->query('run_id'));
        $run = PayrollRun::with('period')->find($id);
        if (!$run) return null;
        // Tenant gate — client + (for branch-pinned users) branch. A null
        // client_id on the run must NOT bypass the gate for a scoped caller.
        if ($ctx['client_id'] && (int) $run->client_id !== (int) $ctx['client_id']) {
            return null;
        }
        if ($ctx['branch_id'] && $run->branch_id && (int) $run->branch_id !== (int) $ctx['branch_id']) {
            return null;
        }
        return $run;
    }

    private function ownsRow(Request $request, Payslip $slip): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if ($user->user_type === 'super_admin') return true;
        // Strict match — a null client_id on the slip must NOT pass for a scoped
        // user (that previously let any tenant read client-less payslips).
        return (int) $slip->client_id === (int) $user->client_id;
    }

    private function canExport(Request $request): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin'], true)) return true;
        // A branch admin who can run payroll can also export/download/email it.
        if ($user->user_type === 'branch_user') return true;
        $perm = $user->permissions['hr.payroll'] ?? null;
        return is_array($perm) ? (bool) (($perm['can_export'] ?? false) || ($perm['can_edit'] ?? false)) : false;
    }

    private function counts($rows): array
    {
        $rows = collect($rows);
        return [
            'totalEmployees' => $rows->count(),
            'ready'          => $rows->where('status', 'Ready')->count(),
            'processed'      => $rows->whereIn('status', ['Processed', 'Paid'])->count(),
            'pendingReview'  => $rows->where('status', 'Pending Review')->count(),
            'onHold'         => $rows->where('status', 'On Hold')->count(),
            'totalPayroll'   => round($rows->sum('netPay'), 2),
            'totalGross'     => round($rows->sum('earnings'), 2),
            'totalNetPay'    => round($rows->sum('netPay'), 2),
            'totalPf'        => round($rows->sum('pfEmp'), 2),
            'totalTds'       => round($rows->sum('tds'), 2),
            'totalLop'       => round($rows->sum('lopDeducted'), 2),
        ];
    }

    private function serializePeriod(PayrollPeriod $p, ?PayrollRun $run): array
    {
        return [
            'id'                   => $p->id,
            'month'                => $p->month,
            'year'                 => $p->year,
            'label'                => $p->label,
            'working_days'         => $p->working_days,
            // Total calendar days of the month — the basis salary & loss-of-pay
            // are computed on (÷30/31), so the payslip shows it as the day count.
            'total_month_days'     => Carbon::create((int) $p->year, (int) $p->month, 1)->daysInMonth,
            'attendance_finalized' => (bool) $p->attendance_finalized,
            'status'               => $p->status,
            'run_status'           => $run?->status,
        ];
    }

    private function serializeRun(PayrollRun $run): array
    {
        return [
            'id'                => $run->id,
            'period_id'         => $run->payroll_period_id,
            'status'            => $run->status,
            'total_employees'   => $run->total_employees,
            'employees_on_hold' => $run->employees_on_hold,
            'total_gross'       => (float) $run->total_gross,
            'total_deductions'  => (float) $run->total_deductions,
            'total_net'         => (float) $run->total_net,
        ];
    }

    /** Maps a Payslip into the shape the SPA's PayrollRow already consumes. */
    private function serializePayslip(Payslip $p, bool $full = false): array
    {
        $name = $p->employee_name ?: 'Employee';
        $parts = preg_split('/\s+/', trim($name));
        $initials = strtoupper(substr($parts[0] ?? '', 0, 1) . substr(end($parts) ?: '', 0, 1));

        $row = [
            'id'          => (string) $p->id,
            'payslip_id'  => $p->id,
            'empId'       => $p->employee_code ?: ('EMP-' . $p->employee_id),
            'employee_id' => $p->employee_id,
            // URL-safe encrypted id so the SPA opens the profile via an opaque
            // token (like the employee list), not the readable EMP-### code.
            'encryptedId' => $this->encId($p->employee_id),
            'name'        => $name,
            'initials'    => $initials ?: 'NA',
            'accent'      => $this->accentFor($p->employee_id),
            'department'  => $p->department ?: '—',
            'designation' => $p->designation ?: '—',
            'ctc'         => (float) $p->gross_earnings,
            'earnings'    => (float) $p->gross_earnings,
            'deductions'  => (float) $p->total_deductions,
            'netPay'      => (float) $p->net_pay,
            'attendance'  => (float) $p->paid_days,
            'workingDays' => (float) $p->working_days,
            'lop_days'    => (float) $p->lop_days,
            'status'      => $p->status,
            'present'     => (float) $p->present_days,
            'absent'      => (float) max(0, (float) $p->working_days - (float) $p->present_days - (float) $p->paid_leave_days),
            'lateMarks'   => (int) $p->late_marks,
            'missingPunch'=> (int) $p->missing_punches,
            'unpaidLeave' => (float) $p->unpaid_leave_days,
            'paidLeave'   => (float) $p->paid_leave_days,
            'attSource'   => $p->att_source,
            // Mismatch label mirrors WHY the row is flagged for review: a
            // missing-punch day, or (when punches are complete) late marks that
            // tripped the Review threshold. Previously only missing punches set
            // this, so late-only Review rows showed a blank Mismatch cell.
            'mismatch'    => $p->missing_punches > 0
                ? 'Missing punches'
                : ($p->att_source === 'Review' ? 'Late marks' : null),
            'attMismatch' => $p->att_source === 'Review',
            'pfEmp'       => (float) $p->pf_employee,
            'esi'         => (float) $p->esi,
            'pt'          => (float) $p->pt,
            'tds'         => (float) $p->tds,
            'lopDeducted' => (float) $p->lop_amount,
            'advanceRec'  => (float) $p->advance_recovery,
            'holdReason'  => $p->hold_reason,
            // Real server-computed reasons (blocking + warning) so the Run
            // modal shows the actual issues instead of guessing.
            'reasons'     => collect((array) ($p->exceptions ?? []))->pluck('reason')->filter()->values()->all(),
            'bankVerified' => (bool) $p->bank_verified,
        ];

        if ($full) {
            $row['earningsBreakup']   = $p->earnings ?: [];
            $row['deductionsBreakup'] = $p->deductions ?: [];

            /* Overtime — surfaced only for employees the employee master marks
               overtime-applicable, so the payslip doesn't grow an OT card and
               an OT allowance line for staff the policy doesn't cover.
               The rate here is the DERIVED per-hour figure
               (gross ÷ working days ÷ shift hours × multiplier), which is what
               the amount was actually priced at — see PayrollService::overtimeRate(). */
            $emp = $p->relationLoaded('employee') ? $p->employee : $p->employee()->first();
            $otApplicable = (bool) $emp?->overtimeApplicable();
            $row['overtimeApplicable'] = $otApplicable;
            $row['overtimeHours']      = (float) ($p->overtime_hours ?? 0);
            $row['overtimeAmount']     = (float) ($p->overtime_amount ?? 0);
            if ($otApplicable) {
                $svc  = app(\App\Services\PayrollService::class);
                $rate = $svc->overtimeRate(
                    $emp,
                    (float) $p->gross_earnings,
                    (float) ($p->working_days ?: 0),
                );
                $row['overtimeRateName']  = $rate['rate_name'];
                $row['overtimeMultiplier'] = (float) $rate['multiplier'];
                $row['overtimeHourly']     = (float) $rate['hourly'];
                $row['overtimeRate']       = (float) $rate['effective_rate'];

                /* Hours the ATTENDANCE actually shows past the shift end, which
                   is a different number from the PAID hours above: Rule 4 pays
                   only OT that HR has recorded and approved as an adjustment.
                   Both are surfaced so the payslip can show the real worked
                   hours AND make it obvious when they haven't been approved —
                   showing 0 for someone who demonstrably worked overtime reads
                   as a bug. */
                if ($p->period) {
                    $winStart = Carbon::create((int) $p->period->year, (int) $p->period->month, 1)->startOfDay();
                    $winEnd   = (clone $winStart)->endOfMonth()->startOfDay();
                    $detected = $svc->overtimeHoursFromAttendance($emp, $winStart, $winEnd);
                    $row['overtimeDetectedHours'] = (float) $detected['hours'];
                    $row['overtimeDetectedDays']  = (int) $detected['days'];
                }
            }
            $row['exceptions']        = $p->exceptions ?: [];
            $row['paidDays']          = (float) $p->paid_days;
            $row['lopDays']           = (float) $p->lop_days;
            // Total calendar days of the month — salary & LOP are computed on
            // this basis (÷30/31), so the payslip shows it as the day count.
            $row['totalMonthDays']    = $p->period
                ? Carbon::create((int) $p->period->year, (int) $p->period->month, 1)->daysInMonth
                : null;
            $row['bank_verified']     = (bool) $p->bank_verified;
            // Rule 16 — a payslip is "final" (officially downloadable) only
            // once its run is approved/paid; otherwise it's provisional.
            $row['is_final']          = $p->relationLoaded('run')
                ? in_array($p->run?->status, ['approved', 'paid'], true)
                : in_array($p->status, ['Paid'], true);
        }

        return $row;
    }

    private function accentFor(int $id): string
    {
        $palette = ['#7c5cfc', '#0ab39c', '#3b82f6', '#f59e0b', '#e83e8c', '#0c63b0', '#108548', '#a06f00'];
        return $palette[$id % count($palette)];
    }

    /** Rule 18 — audit trail. $old/$new capture the before/after state for
     *  transitions (e.g. run status generated→approved). Best-effort. */
    private function audit(Request $request, string $action, $target, string $description, array $old = [], array $new = []): void
    {
        if (!class_exists(\App\Models\ActivityLog::class)) return;
        try {
            \App\Models\ActivityLog::create([
                'user_id'     => $request->user()?->id,
                'client_id'   => $request->user()?->client_id,
                'branch_id'   => $this->ctx($request)['branch_id'],
                'action'      => $action,
                'module'      => 'hr.payroll',
                'target_type' => is_object($target) ? get_class($target) : null,
                'target_id'   => is_object($target) ? ($target->id ?? null) : null,
                'description' => $description,
                'old_values'  => $old ?: null,
                'new_values'  => $new ?: null,
                'ip_address'  => $request->ip(),
                'user_agent'  => substr((string) $request->userAgent(), 0, 255),
                'url'         => $request->fullUrl(),
                'method'      => $request->method(),
            ]);
        } catch (\Throwable $e) {
            // Audit logging is best-effort — never block a payroll action on it.
        }
    }
}
