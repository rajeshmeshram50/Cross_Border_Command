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

        /* Which runs already have money out of the door. An approved run that
           was never disbursed is reopenable; one that paid SOME employees (the
           rest held for bank details) is not — reopening would wipe and re-pay
           them, so PayrollController::reopen refuses it. Surfaced here so the
           screen can hide the Reopen action instead of offering a button that
           can only 422. One grouped query, not one per cycle. */
        $paidRunIds = $latestRuns->isEmpty()
            ? collect()
            : Payslip::whereIn('payroll_run_id', $latestRuns->pluck('id'))
                ->where('status', 'Paid')
                ->distinct()
                ->pluck('payroll_run_id')
                ->flip();

        /* Cycles no longer have to run in calendar order — a month can be
           processed whether or not the month before it was completed. The
           `blocked_by` key stays in the payload (always null) so the existing
           UI keeps working without a shape change. */
        $out = [];
        $cursor = now()->startOfMonth()->subMonths(11);
        for ($i = 0; $i < 13; $i++) {
            $m = (int) $cursor->month;
            $y = (int) $cursor->year;
            $existing = $periods->get("$y-$m");

            $isFuture = $cursor->copy()->startOfMonth()->isFuture();

            // An approved/paid run cannot be regenerated (Rule 14). Surfaced so
            // the Run button can be disabled with a reason instead of firing
            // and coming back with "already approved/paid".
            $existingRun = $existing ? $latestRuns->get($existing->id) : null;
            $runLocked = $existingRun && in_array($existingRun->status, ['approved', 'paid'], true);

            $out[] = [
                'key'    => strtolower($cursor->format('M')) . '-' . $y,
                'label'  => $cursor->format('M Y'),
                'range'  => $cursor->copy()->startOfMonth()->format('d M') . '–' . $cursor->copy()->endOfMonth()->format('d M'),
                'month'  => $m,
                'year'   => $y,
                'financial_year' => PayrollPeriod::financialYearFor($m, $y),
                'status' => $this->cycleDisplayStatus($existing, $cursor, $existingRun),
                // A future cycle is frozen outright — there is no attendance to
                // draw from, so processing it would produce a fully-LOP'd run.
                'is_future'   => $isFuture,
                'blocked_by'  => null,
                'run_status'  => $existingRun?->status,
                'run_locked'  => (bool) $runLocked,
                // Frozen but recoverable: approved, nothing disbursed yet, and
                // the period itself not sealed by a full payment.
                'can_reopen'  => (bool) $runLocked
                    && $existingRun->status !== 'paid'
                    && ($existing?->status !== 'locked')
                    && !$paidRunIds->has($existingRun->id),
                'processable' => !$isFuture && !$runLocked,
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

        /* A period ROW existing is not work started. resolveOrCreatePeriod()
           creates one the moment anybody merely opens the cycle (or exports, or
           loads the strip), so treating "row exists" as In Progress painted
           months nobody had touched as active — and, now that cycles run in
           order, made it look like they were holding up later months. Only a
           draft run (someone reopened the cycle to correct it) counts. */
        return ($run && $run->status === 'draft') ? 'In Progress' : 'Not Started';
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
                'financial_year'   => $p->financial_year,
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
        $slips = Payslip::where('payroll_period_id', $period->id)
            ->when($run, fn ($q) => $q->where('payroll_run_id', $run->id))
            ->orderBy('employee_name')
            ->get();

        // A cycle still in progress can only be judged on the days that have
        // actually happened — see elapsedWorkingDaysMap().
        $elapsed = $this->elapsedWorkingDaysMap($period, $slips);
        $rows = $slips->map(fn ($p) => $this->serializePayslip($p, false, $elapsed[$p->employee_id] ?? null));

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

        // The service re-asserts the paid guard itself; surface it as a 422
        // like every other payroll rule instead of letting it 500.
        try {
            $this->payroll->reopen($period);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
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
                // paid_unpaid decides whether the sandwich lands on the leave
                // balance or straight on loss of pay, which the listing gate
                // below turns on — eager-loaded so it is not one query per leave.
                ->with('leaveType:id,paid_unpaid')
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

                /* …with one exception: an UNPAID leave.
                 *
                 * The "already charged" test reads leave_requests.days, which is
                 * the right question for a PAID leave — there the sandwich is
                 * charged to the leave balance, and a leave approved before the
                 * branch switch was turned on never had it folded in, so nothing
                 * is being deducted.
                 *
                 * An unpaid leave has no balance to burn, so PayrollService
                 * charges its sandwiched off-days straight to loss of pay, and it
                 * derives them live from the calendar rather than from `days`.
                 * That charge exists whatever `days` happens to say — so the
                 * exact rows this gate dropped as "a charge that does not exist"
                 * were, for unpaid leave, real money coming off the payslip with
                 * no way to see or waive it from the run screen. */
                $unpaidLeave = in_array(
                    strtolower((string) ($leave->leaveType->paid_unpaid ?? 'paid')),
                    ['unpaid', 'lwp', 'loss of pay', 'loss_of_pay'],
                    true,
                );

                if (!$leave->sandwich_waived && ($extra <= 0 || (!$alreadyCharged && !$unpaidLeave))) continue;

                $items[] = [
                    'leave_id'       => $leave->id,
                    'employee_id'    => $employee->id,
                    'emp_code'       => $employee->emp_code,
                    'emp_name'       => trim(($employee->display_name ?: ($employee->first_name . ' ' . $employee->last_name))),
                    'department'     => $employee->department?->name ?? '—',
                    'from_date'      => Carbon::parse($leave->from_date)->toDateString(),
                    'to_date'        => Carbon::parse($leave->to_date)->toDateString(),
                    'days'           => (float) $leave->days,
                    /* Working days the leave actually covers, sandwich excluded.
                     * On an LOP charge the screen shows this instead of `days`:
                     * an unpaid leave raised while the policy was on has the
                     * off-days folded into `days` AND docked again through loss
                     * of pay (payroll derives that from the calendar, not from
                     * `days`), so printing "3 days deducted + 1 off-day" over a
                     * 2-working-day leave reads as four. */
                    'working_days'   => $bd['working'],
                    'sandwich_days'  => $extra,
                    // What the leave costs with the policy fully applied. The
                    // screen compares this against `days` to know whether the
                    // off-days are ALREADY counted or still pending.
                    'days_with_policy' => $bd['working'] + $extra,
                    /* WHERE the sandwich is charged, which is not the same
                     * question as how much.
                     *
                     * 'balance' — folded into leave_requests.days: entitlement is
                     *   burnt, and pay only follows once the balance runs out.
                     * 'lop'     — an unpaid leave, so there is no balance to burn
                     *   and PayrollService puts the off-days straight on loss of
                     *   pay, on top of `days`.
                     *
                     * The screen needs it because the two read differently: the
                     * first is "3 days deducted, 2 of them off-days", the second
                     * is "1 day deducted PLUS 2 off-days docked". Printing the
                     * balance wording over an LOP charge understates it. */
                    'charged_via'    => $unpaidLeave ? 'lop' : 'balance',
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

        /* Rule 19 — unresolved slips must be dealt with BEFORE approval.
         *
         * "On Hold" means a blocking problem (no salary structure); "Pending
         * Review" means payroll wants a human to check something it could not
         * settle itself — a missing punch, an attendance/leave conflict, a
         * month with no attendance at all. Both were already blocked from
         * producing a payslip PDF, yet the RUN itself could be approved with
         * any number of them outstanding: the flag was raised and then had no
         * effect on the one decision it exists to gate.
         *
         * Not a hard block, deliberately. Some warnings cannot be "corrected"
         * away — an employee who was genuinely late three times leaves a slip
         * that will read Pending Review no matter how many times it is
         * regenerated, and there is no endpoint to clear a slip's status by
         * hand. A hard block would leave those runs unapprovable forever.
         * Instead approval stops once, states exactly what is unresolved, and
         * proceeds only when the caller acknowledges it explicitly — with who
         * did so and what they waved through recorded in the audit log. */
        $unresolved = Payslip::where('payroll_run_id', $run->id)
            ->whereIn('status', ['On Hold', 'Pending Review'])
            ->get(['id', 'employee_name', 'status']);

        if ($unresolved->isNotEmpty() && !$request->boolean('acknowledge_unresolved')) {
            $onHold  = $unresolved->where('status', 'On Hold')->count();
            $review  = $unresolved->where('status', 'Pending Review')->count();
            $parts   = [];
            if ($onHold) $parts[] = "{$onHold} on hold";
            if ($review) $parts[] = "{$review} pending review";

            return response()->json([
                'message' => 'Payroll not approved — ' . implode(' and ', $parts)
                    . '. Correct the attendance or salary data and regenerate, or re-send with '
                    . 'acknowledge_unresolved to approve them as they stand.',
                'errors'  => ['unresolved' => [implode(' and ', $parts) . ' need attention.']],
                'data'    => [
                    'on_hold'        => $onHold,
                    'pending_review' => $review,
                    // Named so HR can go straight to them rather than hunting
                    // through the payslip list for whatever tripped the flag.
                    'employees'      => $unresolved->take(25)->map(fn ($s) => [
                        'payslip_id' => $s->id,
                        'employee'   => $s->employee_name,
                        'status'     => $s->status,
                    ])->values(),
                ],
            ], 422);
        }

        $run->forceFill(['status' => 'approved', 'approved_by' => $request->user()?->id, 'approved_at' => now()])->save();

        $note = "Payroll approved for run #{$run->id}";
        if ($unresolved->isNotEmpty()) {
            $note .= ' — acknowledged ' . $unresolved->count() . ' unresolved slip(s): '
                . $unresolved->take(10)->map(fn ($s) => $s->employee_name . ' (' . $s->status . ')')->implode(', ');
        }
        $this->audit($request, 'approve', $run, $note, ['status' => 'generated'], ['status' => 'approved']);

        return response()->json([
            'message' => $unresolved->isEmpty()
                ? 'Payroll approved.'
                : 'Payroll approved with ' . $unresolved->count() . ' unresolved slip(s) acknowledged.',
            'data'    => $this->serializeRun($run),
        ]);
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
     *  other_dues, other_deductions.
     *
     *  Still computes LIVE — this is the working view HR adjusts before saving.
     *  Any settlement already saved for the employee is returned alongside it as
     *  `saved`, so the screen can show what was previously agreed (and, once it
     *  is approved or paid, show those frozen figures instead of the live ones).
     */
    public function fnf(Request $request, int $employeeId)
    {
        $employee = $this->fnfEmployee($request, $employeeId);
        if ($employee instanceof \Illuminate\Http\JsonResponse) {
            return $employee;
        }

        // Validate the HR-decided numeric inputs (were taken raw from the query —
        // negatives/garbage flowed straight into the calc). (P24)
        $request->validate([
            'leave_encashment_days'  => ['nullable', 'numeric', 'min:0', 'max:365'],
            'notice_recovery_amount' => ['nullable', 'numeric', 'min:0', 'max:100000000'],
            'other_dues'             => ['nullable', 'numeric', 'min:0', 'max:100000000'],
            'other_deductions'       => ['nullable', 'numeric', 'min:0', 'max:100000000'],
        ]);

        $saved = $this->latestFnf($employee->id);
        // Reopening a saved draft with no inputs in the URL must not silently
        // reset the encashment days HR entered last time.
        $opts = $this->fnfOpts($request, $saved);

        return response()->json([
            'data'  => $this->payroll->computeFnf($employee, $opts),
            'saved' => $saved ? $this->serializeFnf($saved) : null,
        ]);
    }

    /**
     * Rule 21 — save (or update) the settlement.
     *
     * Writes the inputs AND the computed breakdown, so the settlement stops
     * being a number that changes every time someone opens the screen. An
     * approved or paid settlement is frozen: it must be reopened deliberately
     * rather than silently overwritten by the next save.
     */
    public function fnfSave(Request $request, int $employeeId)
    {
        $employee = $this->fnfEmployee($request, $employeeId);
        if ($employee instanceof \Illuminate\Http\JsonResponse) {
            return $employee;
        }

        $request->validate([
            'leave_encashment_days'  => ['nullable', 'numeric', 'min:0', 'max:365'],
            'notice_recovery_amount' => ['nullable', 'numeric', 'min:0', 'max:100000000'],
            'other_dues'             => ['nullable', 'numeric', 'min:0', 'max:100000000'],
            'other_deductions'       => ['nullable', 'numeric', 'min:0', 'max:100000000'],
            'notes'                  => ['nullable', 'string', 'max:2000'],
        ]);

        $existing = $this->latestFnf($employee->id);
        if ($existing && !$existing->isEditable()) {
            return response()->json([
                'message' => "This settlement is already {$existing->status} and can no longer be edited. Reopen it to make changes.",
            ], 422);
        }

        $opts = $this->fnfOpts($request, null);
        $calc = $this->payroll->computeFnf($employee, $opts);

        $exitId = \Illuminate\Support\Facades\Schema::hasTable('employee_exits')
            ? \Illuminate\Support\Facades\DB::table('employee_exits')->where('employee_id', $employee->id)->value('id')
            : null;

        $payload = [
            'client_id'        => $employee->client_id,
            'branch_id'        => $employee->branch_id,
            'employee_id'      => $employee->id,
            'employee_exit_id' => $exitId,
            'employee_code'    => $calc['employee_code'] ?? null,
            'employee_name'    => $calc['employee_name'] ?? null,
            'last_working_day' => $calc['last_working_day'] ?? null,
            'exit_type'        => $calc['exit_type'] ?? null,
            'inputs'           => $opts,
            'breakdown'        => $calc,
            'total_earnings'   => $calc['total_earnings'] ?? 0,
            'total_deductions' => $calc['total_deductions'] ?? 0,
            'net_settlement'   => $calc['net_settlement'] ?? 0,
            'status'           => 'draft',
            'notes'            => $request->input('notes'),
        ];

        if ($existing) {
            $existing->update($payload);
            $record = $existing->fresh();
        } else {
            $payload['created_by'] = $request->user()?->id;
            $record = \App\Models\FnfSettlement::create($payload);
        }

        $this->audit($request, 'fnf_save', $record,
            "Full & final settlement saved for {$record->employee_name} (net ₹{$record->net_settlement})");

        return response()->json([
            'message' => 'Full & final settlement saved.',
            'data'    => $this->serializeFnf($record),
        ]);
    }

    /**
     * Rule 21 — move a saved settlement along: approve → pay, or reopen a
     * non-paid one back to draft. Mirrors the payroll run's own lifecycle so
     * the two behave the same way (Rule 14).
     */
    public function fnfStatus(Request $request, int $employeeId)
    {
        $employee = $this->fnfEmployee($request, $employeeId);
        if ($employee instanceof \Illuminate\Http\JsonResponse) {
            return $employee;
        }

        $data = $request->validate([
            'action' => ['required', 'in:approve,pay,reopen'],
        ]);

        $record = $this->latestFnf($employee->id);
        if (!$record) {
            return response()->json(['message' => 'No saved settlement for this employee.'], 404);
        }

        $from = $record->status;
        $userId = $request->user()?->id;

        switch ($data['action']) {
            case 'approve':
                if ($from !== 'draft') {
                    return response()->json(['message' => "Only a draft settlement can be approved (this one is {$from})."], 422);
                }
                $record->update(['status' => 'approved', 'approved_by' => $userId, 'approved_at' => now()]);
                break;

            case 'pay':
                if ($from !== 'approved') {
                    return response()->json(['message' => "Approve the settlement before marking it paid (this one is {$from})."], 422);
                }
                $record->update(['status' => 'paid', 'paid_by' => $userId, 'paid_at' => now()]);
                break;

            case 'reopen':
                // A paid settlement is money out of the door — correcting it is
                // a new transaction, not an edit to the record of the old one.
                if ($from === 'paid') {
                    return response()->json(['message' => 'A paid settlement cannot be reopened.'], 422);
                }
                $record->update(['status' => 'draft', 'approved_by' => null, 'approved_at' => null]);
                break;
        }

        $record = $record->fresh();
        $this->audit($request, 'fnf_' . $data['action'], $record,
            "Full & final settlement {$data['action']}d for {$record->employee_name}",
            ['status' => $from], ['status' => $record->status]);

        return response()->json([
            'message' => "Settlement {$record->status}.",
            'data'    => $this->serializeFnf($record),
        ]);
    }

    /**
     * Shared guard for every FnF endpoint: permission, tenant match, and the
     * exit record the settlement depends on.
     *
     * Returns the Employee, or the JsonResponse to send back — the caller
     * checks the type. Written this way so the three endpoints cannot drift
     * apart on which checks they apply, which is exactly how the employee tier
     * got read access to colleagues' settlements once before (P25).
     */
    private function fnfEmployee(Request $request, int $employeeId)
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

        return $employee;
    }

    /** The employee's current settlement, if one has been saved. */
    private function latestFnf(int $employeeId): ?\App\Models\FnfSettlement
    {
        return \App\Models\FnfSettlement::where('employee_id', $employeeId)->latest('id')->first();
    }

    /**
     * The HR-decided inputs for a computation. Falls back to a saved draft's
     * stored inputs when the request omits them, so reopening the screen does
     * not quietly zero the encashment days someone entered earlier.
     */
    private function fnfOpts(Request $request, ?\App\Models\FnfSettlement $saved): array
    {
        $stored = $saved?->inputs ?? [];
        $pick = function (string $key) use ($request, $stored) {
            $v = $request->input($key, $request->query($key));
            return $v !== null && $v !== '' ? $v : ($stored[$key] ?? null);
        };

        return [
            'leave_encashment_days'  => $pick('leave_encashment_days'),
            'notice_recovery_amount' => $pick('notice_recovery_amount'),
            'other_dues'             => $pick('other_dues'),
            'other_deductions'       => $pick('other_deductions'),
        ];
    }

    /** API shape for a saved settlement. */
    private function serializeFnf(\App\Models\FnfSettlement $r): array
    {
        return [
            'id'               => $r->id,
            'employee_id'      => $r->employee_id,
            'employee_code'    => $r->employee_code,
            'employee_name'    => $r->employee_name,
            'last_working_day' => $r->last_working_day?->toDateString(),
            'exit_type'        => $r->exit_type,
            'inputs'           => $r->inputs,
            'breakdown'        => $r->breakdown,
            'total_earnings'   => $r->total_earnings,
            'total_deductions' => $r->total_deductions,
            'net_settlement'   => $r->net_settlement,
            'status'           => $r->status,
            'editable'         => $r->isEditable(),
            'notes'            => $r->notes,
            'approved_at'      => $r->approved_at?->toDateTimeString(),
            'paid_at'          => $r->paid_at?->toDateTimeString(),
            'created_at'       => $r->created_at?->toDateTimeString(),
        ];
    }

    /** Rule 16 — single payslip (full component breakdown + finalization flag). */
    public function payslip(Request $request, int $id)
    {
        $slip = Payslip::with('run:id,status')->find($id);
        if (!$slip || !$this->ownsRow($request, $slip)) {
            return response()->json(['message' => 'Payslip not found.'], 404);
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
        /* PAY-45 — same self-guard as ownsRow(). This endpoint was tenant-gated
           only, so any employee could read a colleague's whole salary history
           (net pay per cycle) by changing the id in the URL. HR/admin tiers are
           unaffected; the employee tier gets its own history and nothing else. */
        if ($user && $user->user_type === 'employee'
            && (int) $employeeId !== (int) ($user->employee_id ?? 0)) {
            return response()->json(['message' => 'You can only view your own salary history.'], 403);
        }
        $slips = Payslip::with(['run:id,status', 'period:id,label,month,year'])
            ->where('employee_id', $employeeId)
            ->when($user && $user->client_id, fn ($q) => $q->where('client_id', $user->client_id))
            ->orderByDesc('payroll_period_id')
            ->limit(24)
            ->get();

        return response()->json([
            'data' => $slips->map(fn ($s) => [
                'payslip_id' => $s->id,
                'label'      => $s->period?->label ?? '',
                'month'      => $s->period?->month,
                'year'       => $s->period?->year,
                'financial_year' => $s->period?->financial_year,
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

        /* Rule 17 — branch filter. Only meaningful for a caller who can see more
         * than one branch: $ctx already pins a branch_user to their own, and
         * narrowing further is fine, but a requested branch OUTSIDE the caller's
         * scope must not widen it. Cross-checking against $ctx['branch_id']
         * keeps the filter from becoming a tenant-isolation hole (Rule 20). */
        $branchFilter = (int) $request->query('branch_id') ?: null;
        if ($branchFilter && $ctx['branch_id'] && $branchFilter !== (int) $ctx['branch_id']) {
            abort(403, 'You are not allowed to export payroll for that branch.');
        }

        $q = Payslip::where('payroll_period_id', $period->id)
            ->when($run, fn ($q) => $q->where('payroll_run_id', $run->id))
            ->when($request->query('department'), fn ($q, $d) => $q->where('department', $d))
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($branchFilter, fn ($q, $b) => $q->where('branch_id', $b))
            // Employment type reads the payslip's own snapshot, so an old export
            // stays reproducible after the employee's type changes.
            ->when($request->query('employee_type'), fn ($q, $t) => $q->where('employee_type', $t))
            ->orderBy('employee_name');

        // Filename carries the cycle AND its financial year so a Jan-2027 export
        // can't be mistaken for FY 2027-28 once it's off the screen. (PAY-49)
        $filename = 'payroll_' . $period->label . '_FY' . $period->financial_year . '.csv';
        $headers = [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"$filename\"",
        ];

        return response()->stream(function () use ($q) {
            $out = fopen('php://output', 'w');
            fputcsv($out, [
                'Emp Code', 'Employee', 'Department', 'Designation', 'Employment Type',
                'Working Days', 'Paid Days', 'LOP Days',
                'Gross', 'PF', 'ESI', 'PT', 'TDS', 'LOP Amt', 'Advance Rec', 'Loan Rec',
                'Total Deductions', 'Net Pay', 'Status',
            ]);
            $q->chunk(200, function ($slips) use ($out) {
                foreach ($slips as $s) {
                    fputcsv($out, [
                        $s->employee_code, $s->employee_name, $s->department, $s->designation,
                        $s->employee_type,
                        $s->working_days, $s->paid_days, $s->lop_days,
                        $s->gross_earnings, $s->pf_employee, $s->esi, $s->pt, $s->tds,
                        $s->lop_amount, $s->advance_recovery, $s->loan_recovery,
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
        if ((int) $slip->client_id !== (int) $user->client_id) return false;
        /* PAY-45 — the employee tier sees ONLY its own slip. Tenant match alone
           let any logged-in employee read a colleague's payslip (and its PDF, and
           email it to themselves) just by walking the id. A user with no linked
           employee record has no own slip to read, so 0 matches nothing. */
        if ($user->user_type === 'employee') {
            return (int) $slip->employee_id === (int) ($user->employee_id ?? 0);
        }
        return true;
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
            'financial_year'       => $p->financial_year,
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

    /**
     * Working days that have actually ELAPSED, per employee, for a cycle whose
     * month has not finished yet. Empty for a completed month.
     *
     * The Absent figure is derived as working_days − present − paid leave, and
     * working_days is the whole month. On a cycle in progress that counted
     * every day still to come as an absence: on 20 August, an employee with no
     * punches yet read "Present 0 / Absent 26" — twenty-six absences in a month
     * that had only seen seventeen working days. Clipping the denominator to
     * the elapsed part of the month is what makes the column mean anything
     * before month end.
     *
     * Weekly offs come from each employee's own pattern (the same
     * App\Support\WeekOff the engine uses), so a Saturday-and-Sunday employee
     * is not charged for a Saturday. Holidays are deliberately NOT removed —
     * payroll's working_days does not remove them either, and the two figures
     * have to be built the same way or the subtraction goes wrong.
     *
     * One query for the whole page, not one per row.
     */
    private function elapsedWorkingDaysMap(PayrollPeriod $period, $slips): array
    {
        if ($slips->isEmpty()) {
            return [];
        }
        $today = Carbon::today();
        $start = Carbon::parse($period->period_start)->startOfDay();
        $end   = Carbon::parse($period->period_end)->startOfDay();

        // Month already over: working_days is entirely in the past, nothing to clip.
        if ($end->lt($today)) {
            return [];
        }
        // Cycle hasn't started at all — no day can be an absence yet.
        $cut = $today->lt($start) ? null : $today->copy()->min($end);

        $offs = \App\Models\Employee::whereIn('id', $slips->pluck('employee_id')->unique()->all())
            ->pluck('weekly_off', 'id');

        $map = [];
        foreach ($offs as $id => $label) {
            if ($cut === null) { $map[$id] = 0.0; continue; }
            $n = 0;
            for ($d = $start->copy(); $d->lte($cut); $d->addDay()) {
                if (!\App\Support\WeekOff::isOff((string) $label, $d)) $n++;
            }
            $map[$id] = (float) $n;
        }
        return $map;
    }

    /** Maps a Payslip into the shape the SPA's PayrollRow already consumes. */
    private function serializePayslip(Payslip $p, bool $full = false, ?float $elapsedWorkingDays = null): array
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
            /* Absent is derived, not stored. For a cycle still running, the
               denominator is the elapsed part of the month rather than the
               whole of it, so days that have not happened yet are not counted
               as absences. Null (a finished month) keeps the full figure. */
            'absent'      => (float) max(0, ($elapsedWorkingDays !== null
                    ? min((float) $p->working_days, $elapsedWorkingDays)
                    : (float) $p->working_days)
                - (float) $p->present_days - (float) $p->paid_leave_days),
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
                $svc = app(\App\Services\PayrollService::class);

                /* Prefer the pricing inputs STORED on the overtime earning line
                   when the run was generated. Recomputing them here was wrong
                   twice over: the gross passed was `gross_earnings`, which is
                   `prorated gross + overtime + bonus` — it contains the very OT
                   amount being explained, so the rate was circular and drifted
                   with any OT / bonus / proration — and the employee's shift,
                   OT rate or salary may have changed since the run anyway. A
                   payslip has to explain the money that was actually paid. */
                $otLine = collect(is_array($p->earnings) ? $p->earnings : [])
                    ->first(fn ($l) => ($l['code'] ?? null) === 'overtime' && isset($l['rate']));

                if ($otLine) {
                    $row['overtimeRateName']   = $otLine['rate_name'] ?? null;
                    $row['overtimeMultiplier'] = isset($otLine['multiplier']) ? (float) $otLine['multiplier'] : null;
                    $row['overtimeHourly']     = isset($otLine['hourly']) ? (float) $otLine['hourly'] : null;
                    $row['overtimeRate']       = (float) $otLine['rate'];
                    $row['overtimePricedHours'] = isset($otLine['hours']) ? (float) $otLine['hours'] : null;
                } else {
                    /* Slips generated before the breakdown was stored. Derive
                       the effective rate from the amount and hours that were
                       actually paid — that reproduces the figure exactly by
                       construction, where any re-derivation from today's inputs
                       would not. The hourly/multiplier split is left off rather
                       than guessed: the multiplier on file now may not be the
                       one the run used. */
                    $paidHours  = (float) ($p->overtime_hours ?? 0);
                    $paidAmount = (float) ($p->overtime_amount ?? 0);
                    $row['overtimeRateName']   = null;
                    $row['overtimeMultiplier'] = null;
                    $row['overtimeHourly']     = null;
                    $row['overtimeRate']       = $paidHours > 0 ? round($paidAmount / $paidHours, 2) : null;
                    $row['overtimePricedHours'] = $paidHours > 0 ? $paidHours : null;
                }

                /* Hours the ATTENDANCE shows past the shift end, recomputed
                   LIVE — deliberately separate from the paid hours above, which
                   were frozen when the run was generated. Overtime is no longer
                   approval-gated, so the two normally agree; they diverge when
                   an HR adjustment overrode the detected figure, or when the
                   attendance itself changed after the run (a regularization
                   approval rewrites a whole day's punches). Both are surfaced so
                   the payslip can SAY so — what it must never do is print this
                   number next to an amount priced on the other one. */
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
            /* Weekly offs in the period. Not part of paid_days and not meant to
             * be — working_days already excludes them, so the salary is built
             * from a denominator they were never in. The slip simply never said
             * so, which made a low Paid Days figure look like the week-offs had
             * been docked. Recomputed here from the employee's own pattern
             * rather than derived from working_days, which is prorated for a
             * mid-period joiner and would not give this back. */
            $row['weekOffDays'] = 0;
            if ($p->period && $emp) {
                $wStart = Carbon::create((int) $p->period->year, (int) $p->period->month, 1)->startOfDay();
                $wEnd   = (clone $wStart)->endOfMonth()->startOfDay();
                $label  = (string) ($emp->weekly_off ?? '');
                for ($d = $wStart->copy(); $d->lte($wEnd); $d->addDay()) {
                    if (\App\Support\WeekOff::isOff($label, $d)) $row['weekOffDays']++;
                }
            }
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
