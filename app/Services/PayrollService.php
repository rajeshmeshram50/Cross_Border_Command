<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\Payslip;
use App\Models\PayrollPeriod;
use App\Models\PayrollRun;
use App\Models\SalaryStructure;
use App\Support\ProbationGuard;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

/**
 * The payroll calculation engine. Encodes the 21 development rules supplied for
 * the module. Every method is tenant-agnostic — callers pass an already
 * tenant-scoped PayrollPeriod and the engine only ever reads rows belonging to
 * that period's client/branch.
 *
 * Design notes
 * ------------
 * - Statutory heads (PF/ESI/PT) are computed on the FULL monthly figures while
 *   absence is expressed as a separate "Loss of Pay" deduction line — this
 *   mirrors how the SPA payslip already renders (full earnings + LOP in
 *   deductions) and keeps a payslip legible.
 * - Join / exit mid-month pro-rates the gross itself (Rule 6); intra-window
 *   absence is then layered on as LOP.
 * - Sources the engine reads from may or may not exist in a given install
 *   (overtime + bonus have no tables yet). Those are guarded with Schema
 *   checks and resolve to 0 with a comment, never a fatal error (Rule 4/10).
 */
class PayrollService
{
    // EPF statutory wage ceiling — PF is 12% of basic capped at this.
    private const PF_WAGE_CEILING = 15000;
    private const PF_RATE         = 0.12;
    // ESI applies only when gross is at/under this; employee share 0.75%.
    private const ESI_GROSS_LIMIT = 21000;
    private const ESI_RATE        = 0.0075;
    // Display timezone for the late-mark heuristic — attendance timestamps are
    // stored UTC and the shift-start comparison runs in local time (matches
    // AttendanceController::DISPLAY_TZ).
    private const DISPLAY_TZ = 'Asia/Kolkata';
    // Office default used when the employee's shift carries no parseable
    // window — the same 09:30–18:30 the attendance module falls back to
    // (exactly 9 hours, the OT hourly-rate divisor).
    private const DEFAULT_SHIFT_START = '09:30';
    private const DEFAULT_SHIFT_END   = '18:30';
    private const DEFAULT_SHIFT_HOURS = 9.0;
    // A single day cannot legitimately produce more overtime than this. Past
    // it we assume a forgotten / bad punch-out rather than a 21-hour day, cap
    // the day and flag it, so one stray punch can't inflate a payslip.
    private const MAX_OT_MINUTES_PER_DAY = 720; // 12h

    /** Per-advance recovery split from the most recent advanceRecovery() call
     *  — [ ['advance_request_id','due','recovered','carried'], … ]. generate()
     *  reads this straight after computeForEmployee() to write the ledger. */
    private array $lastRecoveryBreakdown = [];

    /** Resolve the period for a month/year, creating it open+unfinalized.
     *  Race-safe: the unique (client,branch,month,year) index means a
     *  concurrent create throws; we swallow that and re-select. */
    public function resolveOrCreatePeriod(array $ctx, int $month, int $year): PayrollPeriod
    {
        $start = Carbon::create($year, $month, 1)->startOfDay();
        $end   = (clone $start)->endOfMonth()->startOfDay();

        $key = [
            'client_id' => $ctx['client_id'] ?? null,
            'branch_id' => $ctx['branch_id'] ?? null,
            'month'     => $month,
            'year'      => $year,
        ];

        try {
            return PayrollPeriod::firstOrCreate($key, [
                'label'        => $start->format('M Y'),
                'period_start' => $start->toDateString(),
                'period_end'   => $end->toDateString(),
                'working_days' => $this->defaultWorkingDays($start, $end),
                'status'       => 'open',
                'created_by'   => $ctx['user_id'] ?? null,
            ]);
        } catch (\Illuminate\Database\QueryException $e) {
            // Recover ONLY from the lost-create race (the row now exists). For
            // any other DB error, rethrow instead of masking it behind a
            // confusing 404 from firstOrFail. (P2)
            $existing = PayrollPeriod::where($key)->first();
            if ($existing) {
                return $existing;
            }
            throw $e;
        }
    }

    /**
     * Rule 15 correction path — revert a non-paid run to draft and unlock the
     * period's attendance so HR can fix punches/leave and regenerate. Payslips
     * are dropped so a re-run produces a clean set (no duplication).
     */
    public function reopen(PayrollPeriod $period): void
    {
        DB::transaction(function () use ($period) {
            $run = $period->runs()->latest('id')->first();
            if ($run && $run->status !== 'paid') {
                Payslip::where('payroll_run_id', $run->id)->forceDelete();
                // Void any pending disbursement so a stale approved-payment
                // can't be initiated against the now-empty draft run.
                \App\Models\PayrollPayment::where('payroll_run_id', $run->id)
                    ->where('status', '!=', 'paid')
                    ->update(['status' => 'cancelled']);
                $run->forceFill([
                    'status'           => 'draft',
                    'total_employees'  => 0,
                    'employees_on_hold' => 0,
                    'total_gross'      => 0,
                    'total_deductions' => 0,
                    'total_net'        => 0,
                    'approved_by'      => null,
                    'approved_at'      => null,
                ])->save();
            }
            $period->forceFill([
                'status'                  => 'open',
                'attendance_finalized'    => false,
                'attendance_finalized_at' => null,
                'attendance_finalized_by' => null,
                'locked_at'               => null,
            ])->save();
        });
    }

    /**
     * Propagate a change (salary structure, attendance, leave, employee data)
     * to this employee's payslips in every NON-LOCKED run, recomputing them in
     * place so the payroll table reflects the change everywhere. Approved/paid
     * runs are frozen (Rule 14/15) and never touched.
     *
     * Returns the number of payslips updated. Call this after saving a salary
     * structure / approving leave so HR doesn't have to manually re-run.
     */
    public function recomputeEmployeePayslips(int $employeeId): int
    {
        $employee = Employee::find($employeeId);
        if (!$employee) {
            return 0;
        }

        $payslips = Payslip::where('employee_id', $employeeId)
            ->whereHas('run', fn ($q) => $q->whereIn('status', ['draft', 'generated']))
            ->with(['run.period'])
            ->get();

        if ($payslips->isEmpty()) {
            return 0;
        }

        $cache = $this->masterNameCaches();
        $touchedRuns = [];
        $updated = 0;

        foreach ($payslips as $slip) {
            $period = $slip->run?->period;
            if (!$period || $period->status === 'locked') {
                continue;
            }
            $data = $this->computeForEmployee($employee, $period, $cache);
            // Keep the identity / linkage columns; overwrite the computed ones.
            unset($data['client_id'], $data['branch_id']);
            $slip->fill($data)->save();
            $updated++;
            $touchedRuns[$slip->payroll_run_id] = $slip->run;
        }

        foreach ($touchedRuns as $run) {
            $this->refreshRunTotals($run);
        }

        return $updated;
    }

    /**
     * Disburse a run — mark payable payslips Paid and HOLD those still missing
     * bank / under a blocking issue (Rule 12). Bank details are re-checked
     * against the live employee at pay time. Locks the period only when nothing
     * remains held; already-paid slips are never re-paid. Returns [paid, held].
     * Shared by the simple pay endpoint and the Proceed-to-Pay flow.
     */
    public function disburseRun(PayrollRun $run, ?int $userId): array
    {
        return DB::transaction(function () use ($run, $userId) {
            // Lock the run so the two disbursement entry points (/payroll/pay and
            // the Proceed-to-Pay advice flow) can't both pay the same payslips
            // concurrently. The unpaid set below is then read under the lock, so a
            // second caller finds everything already Paid. (P5)
            PayrollRun::whereKey($run->id)->lockForUpdate()->first();

            // Never fabricate a "paid" state for a run that has no payslips
            // (e.g. one reopened back to draft) — that would lock the period
            // with zero disbursement.
            if (Payslip::where('payroll_run_id', $run->id)->count() === 0) {
                return ['paid' => 0, 'held' => 0];
            }
            $unpaid = Payslip::where('payroll_run_id', $run->id)->where('status', '!=', 'Paid')->get();
            $paid = 0; $held = 0;
            foreach ($unpaid as $slip) {
                // Nothing to disburse for a ₹0 net (fully absent / LOP) — skip it
                // so the paid count matches the payment advice exactly.
                if ((float) $slip->net_pay <= 0) {
                    continue;
                }
                $emp = Employee::find($slip->employee_id);
                // P26: don't treat "non-empty" as "valid" — validate the shapes so a
                // typo'd IFSC / account number is HELD rather than disbursed. IFSC is
                // 4 letters + 0 + 6 alphanumerics; account no. is 6–18 digits.
                $ifsc = strtoupper(trim((string) ($emp->ifsc_code ?? '')));
                $acct = preg_replace('/\s+/', '', (string) ($emp->bank_account_number ?? ''));
                $bankOk = (bool) ($emp
                    && preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/', $ifsc)
                    && preg_match('/^\d{6,18}$/', $acct));
                $slip->bank_account_number = $emp->bank_account_number ?? $slip->bank_account_number;
                $slip->ifsc_code = $emp->ifsc_code ?? $slip->ifsc_code;
                $slip->bank_verified = $bankOk;

                $hasOtherBlock = collect((array) $slip->exceptions)
                    ->contains(fn ($e) => ($e['type'] ?? null) === 'blocking'
                        && stripos((string) ($e['reason'] ?? ''), 'bank') === false);

                if ($bankOk && !$hasOtherBlock) {
                    $slip->status = 'Paid'; $slip->hold_reason = null; $paid++;
                } else {
                    $slip->status = 'On Hold';
                    $slip->hold_reason = $hasOtherBlock ? ($slip->hold_reason ?: 'Blocking issue unresolved') : 'Bank details missing/invalid';
                    $held++;
                }
                $slip->save();
            }
            if ($held === 0) {
                $run->forceFill(['status' => 'paid', 'paid_by' => $userId, 'paid_at' => now()])->save();
                $run->period->update(['status' => 'locked', 'locked_at' => now()]);
            } else {
                $run->forceFill(['status' => 'approved', 'paid_by' => $userId, 'paid_at' => now()])->save();
                $run->period->update(['status' => 'processing']);
            }
            return ['paid' => $paid, 'held' => $held];
        });
    }

    /** Recompute a run's headline totals from its current payslips. */
    public function refreshRunTotals(PayrollRun $run): void
    {
        $slips = Payslip::where('payroll_run_id', $run->id)->get();
        $run->forceFill([
            'total_employees'   => $slips->count(),
            'employees_on_hold' => $slips->where('status', 'On Hold')->count(),
            'total_gross'       => round($slips->sum('gross_earnings'), 2),
            'total_deductions'  => round($slips->sum('total_deductions'), 2),
            'total_net'         => round($slips->sum('net_pay'), 2),
        ])->save();
    }

    /**
     * Rule 21 — Full & Final Settlement for an exited employee. Computes the
     * automatic components (salary up to the last working day, approved
     * bonus/incentive, outstanding advance recovery) and folds in the
     * HR-decided components passed via $opts (leave encashment days, notice
     * recovery, other dues / other deductions). Returns a full breakdown.
     */
    public function computeFnf(Employee $employee, array $opts = []): array
    {
        $exit = Schema::hasTable('employee_exits')
            ? DB::table('employee_exits')->where('employee_id', $employee->id)->first()
            : null;
        $lwd = $exit && $exit->last_working_day ? Carbon::parse($exit->last_working_day) : Carbon::now();

        $ctx = ['client_id' => $employee->client_id, 'branch_id' => $employee->branch_id];
        $period = $this->resolveOrCreatePeriod($ctx, (int) $lwd->month, (int) $lwd->year);

        // Final-month salary (the engine pro-rates to the last working day).
        // Add back any advance EMI the engine already deducted for the month so
        // the advance is recovered ONCE — as the full outstanding amount in the
        // FNF deductions below (no double recovery of the final EMI).
        $slip = $this->computeForEmployee($employee, $period);
        $finalSalaryNet = (float) $slip['net_pay'] + (float) ($slip['advance_recovery'] ?? 0);

        $structure = $this->activeStructure($employee, $lwd);
        $monthlyGross = $structure ? (float) $structure->monthly_gross
            : ($employee->annual_salary ? round((float) $employee->annual_salary / 12, 2) : 0);
        // Leave encashment is paid on BASIC monthly salary (not total gross),
        // at a per-day rate over the month's total calendar days (÷30/31) — the
        // same daily basis the salary engine uses.
        $monthlyBasic = $structure ? (float) $structure->basicAmount()
            : ($employee->annual_salary ? round((float) $employee->annual_salary / 12 * 0.5, 2) : 0);
        $fnfMonthDays = max(1, $period->period_start->diffInDays($period->period_end) + 1);
        $perDay = round($monthlyBasic / $fnfMonthDays, 2);

        // HR-decided components.
        $encashDays = max(0, (float) ($opts['leave_encashment_days'] ?? 0));
        $leaveEncashment = round($perDay * $encashDays, 2);
        $noticeRecovery  = max(0, (float) ($opts['notice_recovery_amount'] ?? 0));
        $otherDues       = max(0, (float) ($opts['other_dues'] ?? 0));
        $otherDeductions = max(0, (float) ($opts['other_deductions'] ?? 0));

        // Automatic components.
        $bonus = $this->approvedAdjustments($employee->id, $period, ['bonus', 'incentive']);
        $advanceOutstanding = $this->outstandingAdvances($employee->id);

        $earningsItems = array_values(array_filter([
            ['label' => 'Salary till last working day (' . $lwd->format('d M Y') . ')', 'amount' => round($finalSalaryNet, 2)],
            $leaveEncashment > 0 ? ['label' => "Leave encashment ({$encashDays} days)", 'amount' => $leaveEncashment] : null,
            $bonus > 0          ? ['label' => 'Bonus / incentive (approved)', 'amount' => round($bonus, 2)] : null,
            $otherDues > 0      ? ['label' => 'Other dues', 'amount' => $otherDues] : null,
        ]));
        $deductionItems = array_values(array_filter([
            $advanceOutstanding > 0 ? ['label' => 'Outstanding advance recovery', 'amount' => round($advanceOutstanding, 2)] : null,
            $noticeRecovery > 0     ? ['label' => 'Notice period recovery', 'amount' => $noticeRecovery] : null,
            $otherDeductions > 0    ? ['label' => 'Other deductions', 'amount' => $otherDeductions] : null,
        ]));

        $totalEarnings = array_sum(array_column($earningsItems, 'amount'));
        $totalDeductions = array_sum(array_column($deductionItems, 'amount'));
        $netSettlement = round($totalEarnings - $totalDeductions, 2);

        return [
            'employee_id'      => $employee->id,
            'employee_code'    => $employee->emp_code,
            'employee_name'    => trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')) ?: $employee->display_name,
            'last_working_day' => $lwd->toDateString(),
            'exit_type'        => $exit->exit_type ?? null,
            'monthly_gross'    => $monthlyGross,
            'per_day_rate'     => $perDay,
            'earnings'         => $earningsItems,
            'deductions'       => $deductionItems,
            'total_earnings'   => round($totalEarnings, 2),
            'total_deductions' => round($totalDeductions, 2),
            'net_settlement'   => $netSettlement,
        ];
    }

    /** Sum of approved advance amounts still outstanding (best-effort: the full
     *  approved amount is treated as recoverable at settlement). */
    private function outstandingAdvances(int $employeeId): float
    {
        if (!Schema::hasTable('advance_requests')) {
            return 0;
        }
        return (float) DB::table('advance_requests')
            ->where('employee_id', $employeeId)
            ->where('hr_status', 'approved')
            ->sum('amount');
    }

    /** How many eligible employees have at least one attendance row in the
     *  cycle — lets HR see what they're locking in before finalizing. */
    public function attendanceCoverage(PayrollPeriod $period): array
    {
        $employees = $this->eligibleEmployees($period);
        $total = $employees->count();
        if ($total === 0 || !Schema::hasTable('attendances')) {
            return ['total' => $total, 'with_attendance' => 0, 'missing' => $total];
        }
        $withAttendance = DB::table('attendances')
            ->whereIn('employee_id', $employees->pluck('id')->all())
            ->whereNull('deleted_at')
            ->whereBetween('attendance_date', [$period->period_start->toDateString(), $period->period_end->toDateString()])
            ->distinct('employee_id')
            ->count('employee_id');

        return [
            'total'           => $total,
            'with_attendance' => $withAttendance,
            'missing'         => max(0, $total - $withAttendance),
        ];
    }

    /**
     * Working days for ONE employee — calendar days minus that employee's own
     * weekly offs.
     *
     * The period-level default below counts every non-Sunday, which is only
     * right for a Sunday-only employee. Someone on "Saturday & Sunday" or a
     * rotational Saturday pattern has fewer working days, and using the company
     * number for them inflates the denominator: their per-day salary comes out
     * too low and their LOP too high. Holidays are NOT deducted here — they are
     * paid days handled separately by holidayAggregates().
     */
    private function employeeWorkingDays(Employee $employee, Carbon $start, Carbon $end): int
    {
        $label = (string) ($employee->weekly_off ?? '');
        $days = 0;
        for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
            if (!\App\Support\WeekOff::isOff($label, $d)) {
                $days++;
            }
        }
        return $days;
    }

    /** Working days = calendar days minus Sundays (a sane default; HR can edit).
     *  Company/branch level — stored on the payroll period. Per-EMPLOYEE counts
     *  come from employeeWorkingDays() above, which honours their weekly off. */
    private function defaultWorkingDays(Carbon $start, Carbon $end): int
    {
        $days = 0;
        for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
            if ($d->dayOfWeek !== Carbon::SUNDAY) {
                $days++;
            }
        }
        return $days;
    }

    /**
     * Salary EARNED in the exit month, up to and including the last working
     * day — the "Salary for the Exit Month" line on the Full & Final stage.
     *
     * Runs the real payroll engine for that month rather than pro-rating
     * annual_salary ÷ 12 on calendar days, so the figure matches what payroll
     * would have paid: the employee's salary STRUCTURE (basic / HRA / special
     * allowance / any custom component), attendance-driven paid days, loss of
     * pay, overtime, and the statutory deductions. The old calendar-day
     * estimate ignored all of it — and read ₹0 for anyone paid through a
     * salary structure with no annual_salary set.
     *
     * The amount is NET plus the advance EMI the engine deducted for the
     * month, because the F&F recovers the FULL outstanding advance on its own
     * line — adding it back here keeps the advance from being recovered twice.
     * Same rule computeFnf() uses, so the two never disagree.
     *
     * Read-only: when the exit month has no payroll period row this builds a
     * TRANSIENT one rather than persisting it, since the F&F stage is a GET
     * and must not create payroll periods as a side effect.
     * computeForEmployee() only reads month / period_start / period_end /
     * working_days off it.
     */
    public function earnedSalaryForExitMonth(Employee $employee, Carbon $lwd, $resignationDate = null): array
    {
        $start = $lwd->copy()->startOfMonth();
        $end   = $lwd->copy()->endOfMonth();

        /* EARLY EXIT — resigned/left within ProbationGuard::EARLY_EXIT_DAYS of
         * joining. Such an employee "is not put through payroll at all": the
         * regular run already drops them (eligibleEmployees), and the F&F must
         * agree or the policy is defeated — the month simply gets settled here
         * instead of there, for the same money.
         *
         * Zeroed rather than skipped so the F&F still renders the line (with
         * its reason) and every downstream total keeps a numeric field to add. */
        if (ProbationGuard::isEarlyExit($employee, $lwd, $resignationDate)) {
            $tenure = ProbationGuard::tenureDays($employee, $resignationDate ?: $lwd);

            return [
                'cycle'         => $lwd->format('F Y'),
                'monthly_gross' => 0.0,
                'month_days'    => (int) $end->day,
                'earned_days'   => 0.0,
                'amount'        => 0.0,
                'early_exit'    => true,
                'breakdown'     => [
                    'working_days'      => 0.0,
                    'present_days'      => 0.0,
                    'paid_days'         => 0.0,
                    'weekoff_days'      => 0.0,
                    'lop_days'          => 0.0,
                    'paid_leave_days'   => 0.0,
                    'unpaid_leave_days' => 0.0,
                    'overtime_hours'    => 0.0,
                    'overtime_amount'   => 0.0,
                    'gross_earnings'    => 0.0,
                    'lop_amount'        => 0.0,
                    'total_deductions'  => 0.0,
                    'net_pay'           => 0.0,
                    'earnings'          => [],
                    'deductions'        => [],
                ],
                'note' => 'No salary for this cycle — '
                    . ($tenure !== null ? "exited on day {$tenure} of joining, within " : 'exited within ')
                    . ProbationGuard::EARLY_EXIT_DAYS
                    . ' days, so payroll is not processed for this employee.',
            ];
        }

        $period = PayrollPeriod::where('client_id', $employee->client_id)
            ->where('branch_id', $employee->branch_id)
            ->where('month', (int) $lwd->month)
            ->where('year', (int) $lwd->year)
            ->first()
            ?: new PayrollPeriod([
                'client_id'    => $employee->client_id,
                'branch_id'    => $employee->branch_id,
                'month'        => (int) $lwd->month,
                'year'         => (int) $lwd->year,
                'label'        => $start->format('M Y'),
                'period_start' => $start->toDateString(),
                'period_end'   => $end->toDateString(),
                'working_days' => $this->defaultWorkingDays($start, $end),
            ]);

        $slip = $this->computeForEmployee($employee, $period);

        $amount = round((float) $slip['net_pay'] + (float) ($slip['advance_recovery'] ?? 0), 2);

        return [
            'cycle'         => $lwd->format('F Y'),
            'monthly_gross' => (float) ($slip['gross_earnings'] ?? 0),
            'month_days'    => (int) $end->day,
            // Kept for the existing "X of Y days" caption; paid_days is the
            // figure the money is actually built from.
            'earned_days'   => (float) ($slip['paid_days'] ?? 0),
            'amount'        => max(0, $amount),
            // The full payroll breakdown, so the F&F stage can show WHY the
            // number is what it is instead of an unexplained total.
            'breakdown'     => [
                'working_days'      => (float) ($slip['working_days'] ?? 0),
                'present_days'      => (float) ($slip['present_days'] ?? 0),
                'paid_days'         => (float) ($slip['paid_days'] ?? 0),
                'weekoff_days'      => (float) ($slip['weekoff_days'] ?? 0),
                'lop_days'          => (float) ($slip['lop_days'] ?? 0),
                'paid_leave_days'   => (float) ($slip['paid_leave_days'] ?? 0),
                'unpaid_leave_days' => (float) ($slip['unpaid_leave_days'] ?? 0),
                'overtime_hours'    => (float) ($slip['overtime_hours'] ?? 0),
                'overtime_amount'   => (float) ($slip['overtime_amount'] ?? 0),
                'gross_earnings'    => (float) ($slip['gross_earnings'] ?? 0),
                'lop_amount'        => (float) ($slip['lop_amount'] ?? 0),
                'total_deductions'  => (float) ($slip['total_deductions'] ?? 0),
                'net_pay'           => (float) ($slip['net_pay'] ?? 0),
                'earnings'          => $slip['earnings'] ?? [],
                'deductions'        => $slip['deductions'] ?? [],
            ],
            'note' => 'Excluded from the ' . $lwd->format('F Y')
                . ' payroll run — computed here on the same basis and settled in the F&F.',
        ];
    }

    /** Rule 1 — finalize attendance so payroll can be processed. */
    public function finalizeAttendance(PayrollPeriod $period, ?int $userId): void
    {
        $period->forceFill([
            'attendance_finalized'    => true,
            'attendance_finalized_at' => now(),
            'attendance_finalized_by' => $userId,
        ])->save();
    }

    /**
     * Rule 7 — employees that belong in REGULAR payroll for this period.
     *
     * Excludes Inactive / Resigned / Terminated, and anyone whose LAST WORKING
     * DAY falls on or before the period end. A leaver is settled through Full &
     * Final, not regular payroll: someone who left on 10 August is not in the
     * 1–31 August run at all, and their earned salary for those ten days is one
     * of the F&F lines instead. Paying them here AND in F&F would pay twice.
     *
     * Only the exit CYCLE is excluded — an employee whose last working day is
     * in a LATER month worked this one in full and is paid normally.
     */
    public function eligibleEmployees(PayrollPeriod $period): Collection
    {
        $q = Employee::query()
            ->whereNotIn('status', ['Inactive', 'Resigned', 'Terminated'])
            // Only fully-onboarded staff belong in payroll. Half-onboarded /
            // in-progress employees (onboarding_stage_completed < 6) don't have
            // their org-side context settled yet, so they're excluded — same
            // "fully onboarded" gate the manager picker and Exit Management use.
            ->where('onboarding_stage_completed', '>=', 6)
            ->where(function ($w) use ($period) {
                // Not yet joined after the period? Excluded.
                $w->whereNull('date_of_joining')
                  ->orWhere('date_of_joining', '<=', $period->period_end);
            });

        if ($period->client_id) {
            $q->where('client_id', $period->client_id);
        }
        if ($period->branch_id) {
            $q->where('branch_id', $period->branch_id);
        }

        $employees = $q->get();

        // Drop anyone whose exit last-working-day lands on or before this
        // period's end — they are settled through F&F, not regular payroll —
        // and anyone who RESIGNED (or left) within 15 days of joining: an early
        // exit is not put through payroll at all, ProbationGuard::EARLY_EXIT_DAYS.
        $ids     = $employees->pluck('id')->all();
        $exits   = $this->exitMap($ids);
        $resigns = $this->resignationMap($ids);
        return $employees->reject(function (Employee $e) use ($exits, $resigns, $period) {
            $lwd = $exits[$e->id] ?? null;
            if ($lwd && Carbon::parse($lwd)->lte($period->period_end)) {
                return true;
            }
            return ProbationGuard::isEarlyExit($e, $lwd, $resigns[$e->id] ?? null);
        })->values();
    }

    /**
     * Employees held OUT of this period's payroll and why — so HR can see that
     * someone was skipped deliberately rather than lost. Two reasons:
     *
     *   · Exited in this cycle — settled through F&F instead of regular pay.
     *     Reported because a mid-month leaver vanishing from the run is exactly
     *     the kind of thing that reads as a bug unless it's spelled out.
     *   · Resigned (or left) within 15 days of joining — payroll not processed
     *     at all. Reported even when no last working day has been set yet, so
     *     an in-progress early exit still shows up as deliberately skipped.
     *
     * Both reasons are scoped to employees THIS period would otherwise have
     * expected — see the relevance gate below. The panel answers "who is
     * missing from this run and why", so anyone the run was never going to
     * contain has no business in it.
     */
    public function payrollExclusions(PayrollPeriod $period): array
    {
        /* No status filter here, unlike eligibleEmployees(): an early leaver is
           normally already stamped Resigned/Terminated by the exit flow, and
           filtering those out would hide exactly the people this reports on.

           withTrashed for the same reason — completing an exit now soft-deletes
           the employee (ExitController::complete, so they land in the Disabled
           list). Without this they would silently drop out of the panel in the
           very cycle it needs to explain their absence, which is the exact
           "person vanished from the run" confusion it exists to prevent. */
        $q = Employee::withTrashed()->where('onboarding_stage_completed', '>=', 6);
        if ($period->client_id) $q->where('client_id', $period->client_id);
        if ($period->branch_id) $q->where('branch_id', $period->branch_id);

        $employees = $q->get();
        $ids       = $employees->pluck('id')->all();
        $exits     = $this->exitMap($ids);
        $resigns   = $this->resignationMap($ids);
        $out       = [];

        foreach ($employees as $e) {
            $lwd    = $exits[$e->id] ?? null;
            $resign = $resigns[$e->id] ?? null;

            /* Relevance gate — only report people this period would otherwise
               have expected, mirroring eligibleEmployees()' own bounds:

                 · Not joined by the period end → they did not exist as an
                   employee yet. A July 2026 hire has no business appearing on
                   the January 2026 preflight, whatever happened to them later.
                   A NULL joining date is kept, because eligibleEmployees()
                   keeps it too.
                 · Last working day before the period start → they belong to an
                   earlier cycle and were never expected here. An exit with no
                   last working day agreed yet is still open, so it stays.

               Without this the early-exit branch reported against EVERY period
               the tenant has ever opened, turning the panel into a running log
               of all-time early exits. */
            if ($e->date_of_joining && Carbon::parse($e->date_of_joining)->gt($period->period_end)) {
                continue;
            }
            if ($lwd && Carbon::parse($lwd)->lt($period->period_start)) {
                continue;
            }

            $earlyExit = ProbationGuard::isEarlyExit($e, $lwd, $resign);
            // Exited inside THIS cycle (not before it — that's an earlier
            // period's business).
            $exitedInCycle = $lwd
                && Carbon::parse($lwd)->lte($period->period_end)
                && Carbon::parse($lwd)->gte($period->period_start);

            if (!$earlyExit && !$exitedInCycle) {
                continue;
            }

            /* Report the tenure against whichever date actually triggered the
               exclusion. An early exit can be keyed on the RESIGNATION date, in
               which case quoting the (later, or entirely absent) last-working-day
               tenure would either contradict the reason or blow up on a null. */
            $lwdTenure = ProbationGuard::tenureDays($e, $lwd);
            $tenure    = $lwdTenure;
            if ($earlyExit) {
                $found  = array_filter(
                    [ProbationGuard::tenureDays($e, $resign), $lwdTenure],
                    fn ($t) => $t !== null,
                );
                $tenure = $found ? min($found) : null;
            }
            $out[] = [
                'employee_id'      => $e->id,
                'employee_code'    => $e->emp_code,
                'employee_name'    => trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')) ?: $e->display_name,
                'date_of_joining'  => $e->date_of_joining ? Carbon::parse($e->date_of_joining)->toDateString() : null,
                'resignation_date' => $resign ? Carbon::parse($resign)->toDateString() : null,
                // Null is possible on an early resignation whose last working
                // day has not been agreed yet — the exclusion still stands.
                'last_working_day' => $lwd ? Carbon::parse($lwd)->toDateString() : null,
                'tenure_days'      => $tenure,
                // Early exit is the stronger statement (no payroll at all), so
                // it wins when both apply.
                'reason'           => $earlyExit
                    ? 'Resigned within ' . ProbationGuard::EARLY_EXIT_DAYS
                        . ' days of joining' . ($tenure !== null ? " ({$tenure} day(s))" : '')
                        . ' — notice period not applicable and payroll not processed.'
                    : 'Left on ' . Carbon::parse($lwd)->format('j M Y')
                        . ' — excluded from this cycle; salary and dues are settled in the Full & Final settlement.',
            ];
        }

        return $out;
    }

    /**
     * employee_id => notice/resignation date, for the given ids.
     *
     * Kept separate from exitMap() rather than folded into it: exitMap's
     * id => last_working_day shape is consumed by computeForEmployee() for
     * mid-month proration, and widening it there would touch the pay maths for
     * the sake of a policy check that only two callers need.
     */
    private function resignationMap(array $employeeIds): array
    {
        if (empty($employeeIds) || !Schema::hasTable('employee_exits')) {
            return [];
        }
        return DB::table('employee_exits')
            ->whereIn('employee_id', $employeeIds)
            ->whereNotNull('notice_date')
            ->pluck('notice_date', 'employee_id')
            ->all();
    }

    /** employee_id => last_working_day, for the given ids (empty if no table). */
    private function exitMap(array $employeeIds): array
    {
        if (empty($employeeIds) || !Schema::hasTable('employee_exits')) {
            return [];
        }
        return DB::table('employee_exits')
            ->whereIn('employee_id', $employeeIds)
            ->whereNotNull('last_working_day')
            ->pluck('last_working_day', 'employee_id')
            ->all();
    }

    /**
     * Generate (or regenerate) a draft run + payslips for every eligible
     * employee. Rule 1 gate, Rule 13 dedup (replaces a non-locked run's
     * payslips), Rule 14 lock guard.
     */
    public function generate(PayrollPeriod $period, array $ctx): PayrollRun
    {
        if (!$period->attendance_finalized) {
            throw new RuntimeException('Payroll cannot be processed because attendance is not finalized.');
        }
        if ($period->status === 'locked') {
            throw new RuntimeException('This payroll period is locked. Adjustments must go to the next cycle.');
        }

        return DB::transaction(function () use ($period, $ctx) {
            // Serialize concurrent generation for this period: row-lock the
            // period, THEN read the latest run inside the lock. Without this a
            // double-click / two HR users both saw "no run" and each created a
            // full PayrollRun + payslip set (doubled totals). The loser now
            // waits, then reuses the run the winner created. (P1)
            PayrollPeriod::whereKey($period->id)->lockForUpdate()->first();

            $existing = $period->runs()->latest('id')->first();
            if ($existing && $existing->isLocked()) {
                throw new RuntimeException('Payroll for this period is already approved/paid and cannot be regenerated.');
            }

            $run = $existing ?: new PayrollRun([
                'client_id'         => $period->client_id,
                'branch_id'         => $period->branch_id,
                'payroll_period_id' => $period->id,
                'created_by'        => $ctx['user_id'] ?? null,
            ]);
            $run->status       = 'generated';
            $run->generated_by = $ctx['user_id'] ?? null;
            $run->generated_at = now();
            $run->save();

            // Wipe prior payslips for a clean regenerate (Rule 13).
            Payslip::where('payroll_run_id', $run->id)->forceDelete();

            $employees = $this->eligibleEmployees($period);

            // Rule 13 (cross-level) — never let an employee be paid twice in the
            // same month. Skip anyone who already has a payslip in ANOTHER run
            // for this client+month+year (e.g. a branch-level run already
            // covered them, now a client-wide run is generating, or vice versa).
            $siblingPeriodIds = PayrollPeriod::where('client_id', $period->client_id)
                ->where('month', $period->month)
                ->where('year', $period->year)
                ->where('id', '!=', $period->id)
                ->pluck('id');
            if ($siblingPeriodIds->isNotEmpty()) {
                $covered = Payslip::whereIn('payroll_period_id', $siblingPeriodIds)
                    ->pluck('employee_id')->unique()->all();
                if (!empty($covered)) {
                    $employees = $employees->reject(fn ($e) => in_array($e->id, $covered, true))->values();
                }
            }

            $nameCache = $this->masterNameCaches();
            // Batch the exit lookup ONCE for the whole run instead of querying
            // employee_exits (plus a Schema::hasTable check) per employee inside
            // computeForEmployee — exitMap() already accepts an id array. (perf)
            $exitMap = $this->exitMap($employees->pluck('id')->all());

            $totGross = 0;
            $totDed   = 0;
            $totNet   = 0;
            $onHold   = 0;

            foreach ($employees as $employee) {
                $data = $this->computeForEmployee($employee, $period, $nameCache, $exitMap);
                $data['client_id']         = $period->client_id;
                // Store the EMPLOYEE's real branch (not the period's), so a
                // client-wide run still keeps per-branch reporting accurate.
                $data['branch_id']         = $employee->branch_id ?: $period->branch_id;
                $data['payroll_run_id']    = $run->id;
                $data['payroll_period_id'] = $period->id;
                $data['employee_id']       = $employee->id;
                $data['created_by']        = $ctx['user_id'] ?? null;

                Payslip::create($data);
                // Record what each advance actually recovered this cycle (and
                // what carried) — read straight off the compute above. Written
                // here, once, so previews/FNF never pollute the ledger.
                $this->recordRecoveryLedger($period, $employee->id, $this->lastRecoveryBreakdown);

                $totGross += $data['gross_earnings'];
                $totDed   += $data['total_deductions'];
                $totNet   += $data['net_pay'];
                if ($data['status'] === 'On Hold') {
                    $onHold++;
                }
            }

            $run->forceFill([
                'total_employees'   => $employees->count(),
                'employees_on_hold' => $onHold,
                'total_gross'       => round($totGross, 2),
                'total_deductions'  => round($totDed, 2),
                'total_net'         => round($totNet, 2),
            ])->save();

            $period->update(['status' => 'processing']);

            return $run->fresh();
        });
    }

    /**
     * The core per-employee calculation. Returns a full Payslip attribute array.
     * Pure-ish: only reads, never writes.
     */
    public function computeForEmployee(Employee $employee, PayrollPeriod $period, array $nameCache = [], ?array $exitMap = null): array
    {
        $exceptions = [];

        $deptName = $nameCache['departments'][$employee->department_id] ?? null;
        $desigName = $nameCache['designations'][$employee->designation_id] ?? null;

        $base = [
            'employee_code' => $employee->emp_code,
            'employee_name' => trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')) ?: $employee->display_name,
            'department'    => $deptName,
            'designation'   => $desigName,
            // Per-employee, not the period's company-wide figure — the payslip's
            // "Total Days" has to match the denominator the pay is divided by.
            'working_days'  => $this->employeeWorkingDays(
                $employee,
                Carbon::parse($period->period_start),
                Carbon::parse($period->period_end),
            ),
            'present_days'  => 0,
            'paid_days'     => 0,
            'lop_days'      => 0,
            'paid_leave_days'   => 0,
            'unpaid_leave_days' => 0,
            'late_marks'    => 0,
            'missing_punches' => 0,
            'overtime_hours'  => 0,
            'att_source'    => 'Manual',
            'earnings'      => [],
            'deductions'    => [],
            'gross_earnings' => 0,
            'basic'         => 0,
            'overtime_amount' => 0,
            'bonus_amount'  => 0,
            'pf_employee'   => 0,
            'esi'           => 0,
            'pt'            => 0,
            'tds'           => 0,
            'lop_amount'    => 0,
            'advance_recovery' => 0,
            'loan_recovery' => 0,
            'other_deductions' => 0,
            'total_deductions' => 0,
            'net_pay'       => 0,
            'status'        => 'Ready',
            'hold_reason'   => null,
            'bank_account_number' => $employee->bank_account_number,
            'ifsc_code'     => $employee->ifsc_code,
            'bank_verified' => (bool) ($employee->bank_account_number && $employee->ifsc_code),
        ];

        // ── Rule 5 — active salary structure is mandatory ──────────────────
        $structure = $this->activeStructure($employee, $period->period_end);
        [$gross, $basic, $earnComponents, $structDeductions, $pfApplicable, $esiApplicable, $ptApplicable] =
            $this->resolveCompensation($employee, $structure, $exceptions);

        if ($gross <= 0) {
            // No structure and no fallback salary → cannot pay. Block it.
            $base['exceptions'] = $this->withException($exceptions, 'blocking',
                'No active salary structure or salary on file — employee skipped.');
            $base['status']      = 'On Hold';
            $base['hold_reason'] = 'Missing salary structure';
            return $base;
        }

        // ── Rule 6 — join / exit pro-ration ────────────────────────────────
        $winStart = $period->period_start->copy();
        $winEnd   = $period->period_end->copy();
        if ($employee->date_of_joining && Carbon::parse($employee->date_of_joining)->gt($winStart)) {
            $winStart = Carbon::parse($employee->date_of_joining)->copy();
        }
        $lwd = ($exitMap ?? $this->exitMap([$employee->id]))[$employee->id] ?? null;
        if ($lwd && Carbon::parse($lwd)->lt($winEnd)) {
            $winEnd = Carbon::parse($lwd)->copy();
        }
        $calDays    = $period->period_start->diffInDays($period->period_end) + 1;
        $activeDays = max(0, $winStart->diffInDays($winEnd) + 1);
        $proration  = $calDays > 0 ? min(1, $activeDays / $calDays) : 1;
        if ($proration < 1) {
            $exceptions = $this->withException($exceptions, 'warning',
                'Mid-cycle join/exit — salary pro-rated to ' . round($proration * 100) . '% of the month.');
        }

        /* Effective payable working days within the active window.
         *
         * Counted from THIS employee's weekly-off pattern rather than the
         * period's company-wide figure. The period number is calendar-minus-
         * Sundays, so a Saturday-off employee was being measured against a
         * denominator that included days they never work — deflating per-day
         * salary and inflating LOP. */
        $empWorkingDays       = $this->employeeWorkingDays(
            $employee,
            $period->period_start->copy(),
            $period->period_end->copy(),
        );
        $effectiveWorkingDays = round($empWorkingDays * $proration, 2);

        // ── Rules 2 & 3 — attendance + leave ───────────────────────────────
        $att = $this->attendanceAggregates(
            $employee->id, $winStart, $winEnd, $employee->resolveShiftWindow()[0]
        );
        $leave = $this->leaveAggregates($employee->id, $winStart, $winEnd);
        // Holidays from the employee's assigned holiday group that fall on a
        // working day in the active window — paid like leave, never LOP.
        $holidayDays = $this->holidayAggregates($employee, $winStart, $winEnd);

        $presentDays   = $att['present'];
        $lateMarks     = $att['late'];
        $missingPunch  = $att['missing'];
        $paidLeaveDays = $leave['paid'];
        $unpaidLeaveDays = $leave['unpaid'];

        // Incomplete punches are an attendance data-quality issue — flag them so
        // the employee surfaces as a "Mismatch"/Review case (att_source=Review)
        // in the Biometric Input table for HR to reconcile before approving. (#34)
        if ($missingPunch > 0) {
            $exceptions = $this->withException($exceptions, 'warning',
                "{$missingPunch} day(s) with a missing punch — verify attendance before approving.");
        }

        // Paid days = present + paid leave + group holidays (capped to the
        // window). The min() cap means holidays only ever fill the unpaid gap
        // up to the working-day ceiling — they can never inflate paid days for
        // an employee who was already present every working day.
        $paidDays = min($effectiveWorkingDays, $presentDays + $paidLeaveDays + $holidayDays);

        /* Weekly offs in the active window.
         * They are NOT part of paid_days and must not be: working_days already
         * excludes them, so the money is built from a denominator they were
         * never in. But that also means nothing on the slip showed them at all
         * — an August slip read "Paid Days 5" for an employee who was in fact
         * paid for those 5 plus every Sunday, and it looked like the week-offs
         * had been docked. This is reported alongside so the slip can say so.
         * A week-off only ever costs anything when the sandwich rule bites, and
         * that is charged through leave_requests.days, not here. */
        $weekOffDays = 0;
        for ($d = $winStart->copy(); $d->lte($winEnd); $d->addDay()) {
            if (\App\Support\WeekOff::isOff((string) ($employee->weekly_off ?? ''), $d)) {
                $weekOffDays++;
            }
        }
        if ($holidayDays > 0) {
            $exceptions = $this->withException($exceptions, 'info',
                "{$holidayDays} holiday day(s) in this period credited as paid.");
        }
        // Everything else in the active window is loss-of-pay.
        $lopDays = max(0, round($effectiveWorkingDays - $paidDays, 2));
        // Off-days sandwiched inside an UNPAID leave are unpaid too. They sit
        // outside the working-day denominator, so they are added rather than
        // subtracted — there is nothing in that denominator to take them from.
        $sandwichLop = (float) ($leave['sandwich_lop'] ?? 0);
        if ($sandwichLop > 0) {
            $lopDays = round($lopDays + $sandwichLop, 2);
            $exceptions = $this->withException($exceptions, 'info',
                "{$sandwichLop} off-day(s) sandwiched inside unpaid leave charged as loss of pay.");
        }

        // Rule 2 (BR-01) — LOP accrues in 0.5-day steps for every completed block
        // of 3 late marks: 3→0.5, 6→1, 9→1.5, 12→2, and +0.5 per extra 3.
        // Fewer than 3 late marks never deducts. Flag for HR review rather than
        // silently docking (exception: late-sitting may have covered the hours;
        // HR can hold/waive on review).
        $lateLopDays = intdiv(max(0, $lateMarks), 3) * 0.5;
        if ($lateLopDays > 0) {
            $lopDays += $lateLopDays;
            $exceptions = $this->withException($exceptions, 'warning',
                "{$lateMarks} late marks → {$lateLopDays} day LOP (verify hours covered before approving).");
        }
        $lopDays = min($effectiveWorkingDays, $lopDays);
        $paidDays = max(0, round($effectiveWorkingDays - $lopDays, 2));

        // Unpaid-leave vs LOP sanity — an employee on unpaid leave should be
        // docked at least those working days. When fewer LOP days are charged
        // than the unpaid leave taken, the same dates are ALSO marked present /
        // paid-leave (overlapping attendance), so the unpaid leave was silently
        // not cut. Surface it as a WARNING (never blocks) so it shows in the
        // execution summary + row exceptions instead of reading as "no cut".
        if ($unpaidLeaveDays > $lopDays + 0.001) {
            $notCharged = round($unpaidLeaveDays - $lopDays, 2);
            $exceptions = $this->withException($exceptions, 'warning',
                "{$notCharged} unpaid-leave day(s) not charged as LOP — the employee is also marked present/paid-leave on those dates. Verify attendance before approving.");
        }

        // ── Money ──────────────────────────────────────────────────────────
        $proratedGross = round($gross * $proration, 2);
        $proratedBasic = round($basic * $proration, 2);

        // Daily salary is computed on the TOTAL CALENDAR DAYS of the month
        // (e.g. ÷30 or ÷31), NOT on working days (÷26). So one loss-of-pay day
        // always costs the same regardless of how many Sundays the month has.
        $totalMonthDays = max(1, $calDays);

        // Loss-of-pay is charged on the BASIC monthly salary — NOT on the total
        // monthly earning (gross). Per-day = basic ÷ total month days, times the
        // absent working days. Allowances (HRA / special / etc.) are not clawed
        // back for an absence. The deduction is capped at the pro-rated basic so
        // it can never exceed the basic actually payable this cycle.
        $lopAmount = round(($basic / $totalMonthDays) * $lopDays, 2);
        $lopAmount = min($lopAmount, $proratedBasic);

        // Earned pay = pro-rated gross minus the basic-based LOP. earnedBasic
        // drops by the same amount (LOP is entirely basic) so PF rides on the
        // reduced basic. earnedFactor = share of pro-rated gross actually earned,
        // used to scale other fixed deductions onto an absent month.
        $earnedGross  = round($proratedGross - $lopAmount, 2);
        $earnedBasic  = round(max(0, $proratedBasic - $lopAmount), 2);
        $earnedFactor = $proratedGross > 0 ? min(1, $earnedGross / $proratedGross) : 0;

        // Build earnings JSON from structure components (pro-rated for join/exit).
        $earnings = [];
        foreach ($earnComponents as $c) {
            $earnings[] = [
                'code'   => $c['code'] ?? 'comp',
                'label'  => $c['label'] ?? 'Component',
                'amount' => round(((float) ($c['amount'] ?? 0)) * $proration, 2),
            ];
        }
        /* Overtime, priced as
             (gross ÷ working days ÷ shift hours) × OT multiplier × hours.
           Computed off the FULL monthly gross + the period's working days, so
           the hourly rate doesn't move with a mid-month join or with absence.

           Overtime is NO LONGER approval-gated: hours the attendance shows past
           the shift end are paid directly. An explicitly recorded adjustment
           still WINS when one exists, so HR can override the detected figure
           (a negotiated number, or OT that never made it onto a punch); the
           detected hours are the fallback when they haven't. */
        $ot = $this->overtimeForCycle($employee, $period, $gross, (float) $period->working_days);
        foreach ($ot['exceptions'] as $otEx) {
            $exceptions = $this->withException($exceptions, $otEx['type'], $otEx['reason']);
        }

        $otDetected = $this->overtimeHoursFromAttendance($employee, $winStart, $winEnd);

        if ($ot['hours'] <= 0 && $ot['amount'] <= 0 && $otDetected['hours'] > 0) {
            $rate   = $this->overtimeRate($employee, $gross, (float) $period->working_days);
            $hours  = (float) $otDetected['hours'];
            $amount = round($hours * $rate['effective_rate_exact'], 2);
            $ot = [
                'hours'  => $hours,
                'amount' => $amount,
                // Pricing inputs stored alongside the amount — see the note in
                // overtimeForCycle(). Without them the payslip re-derives the
                // rate from the WRONG gross (the stored gross_earnings, which
                // already contains this very amount) and re-reads the hours
                // live from attendance, so neither matches what was paid.
                'lines'  => [[
                    'code'       => 'overtime',
                    'label'      => 'Overtime Allowance',
                    'amount'     => $amount,
                    'hours'      => $hours,
                    'rate'       => $rate['effective_rate'],
                    'hourly'     => $rate['hourly'],
                    'multiplier' => $rate['multiplier'],
                    'rate_name'  => $rate['rate_found'] ? $rate['rate_name'] : null,
                ]],
                'exceptions' => [],
            ];
            // Spell the arithmetic out so the figure is checkable by hand.
            $exceptions = $this->withException($exceptions, 'info', sprintf(
                'Overtime: %s hr past the %s shift end across %d day(s) × ₹%s/hr (%s%s) = ₹%s — paid from attendance.',
                $this->trimNum($hours),
                $otDetected['shift_end'],
                $otDetected['days'],
                number_format($rate['effective_rate'], 2),
                $this->trimNum($rate['multiplier']),
                $rate['rate_found'] ? ' ' . $rate['rate_name'] : '× (no active OT rate — 1× hourly)',
                number_format($amount, 2),
            ));
        } elseif ($otDetected['hours'] > 0) {
            // An adjustment overrode the detected hours — say so, so a figure
            // that doesn't match the attendance isn't mistaken for a bug.
            $exceptions = $this->withException($exceptions, 'info', sprintf(
                'Attendance shows %s OT hr past the %s shift end across %d day(s); %s hr recorded and paid.',
                $this->trimNum($otDetected['hours']),
                $otDetected['shift_end'],
                $otDetected['days'],
                $this->trimNum($ot['hours']),
            ));
        }

        if ($otDetected['capped_days'] > 0) {
            $exceptions = $this->withException($exceptions, 'warning', sprintf(
                '%d day(s) show more than 12 hr past the shift end — likely a missed punch-out. Verify the attendance; the overtime is capped at 12 hr for those days.',
                $otDetected['capped_days'],
            ));
        }

        // Approved overtime / bonus / incentive show as separate earning lines.
        foreach ($ot['lines'] as $line) {
            $earnings[] = $line;
        }
        foreach ($this->adjustmentLines($employee->id, $period, ['bonus', 'incentive']) as $line) {
            $earnings[] = $line;
        }

        // Statutory deductions on EARNED figures (Rule 8/9) — no earned pay
        // means no statutory deduction.
        $pf  = 0;
        if ($pfApplicable && $employee->pf_eligible && $this->isPfEligibleType($employee) && $earnedBasic > 0) {
            // PF type (employee Stage 4): 'standard' = 12% of the FULL basic;
            // anything else ('statutory' / null) caps the basic at the ₹15k
            // EPF wage ceiling (max ₹1,800/month).
            $pfBase = strtolower((string) $employee->pf_type) === 'standard'
                ? $earnedBasic
                : min($earnedBasic, self::PF_WAGE_CEILING);
            $pf = round($pfBase * self::PF_RATE, 2);
        }
        // ESI — honour a MANUAL structure 'esi' line first (HR/accounts enter
        // the amount in the salary breakup); fall back to the statutory 0.75%
        // of gross when no manual line exists. Manual amounts scale to earned
        // pay like other deductions so an unpaid month doesn't over-deduct.
        $esiManual = $this->structureDeduction($structDeductions, 'esi');
        $esi = 0;
        if ($esiManual > 0) {
            $esi = round($esiManual * $earnedFactor, 2);
        } elseif ($esiApplicable && $earnedGross > 0 && $earnedGross <= self::ESI_GROSS_LIMIT) {
            $esi = round($earnedGross * self::ESI_RATE, 2);
        }

        // Professional Tax — manual structure 'pt' line if present, else the
        // statutory Maharashtra slab.
        $ptManual = $this->structureDeduction($structDeductions, 'pt');
        $pt = 0;
        if ($ptManual > 0) {
            $pt = round($ptManual * $earnedFactor, 2);
        } elseif ($ptApplicable && $earnedGross > 0) {
            $pt = $this->professionalTax($employee, $earnedGross, $period->month);
        }

        // TDS — no slab engine yet; honour a structure 'tds' deduction line if
        // present (only when there's earned pay).
        $tds = $earnedGross > 0 ? $this->structureDeduction($structDeductions, 'tds') : 0;

        // Other fixed deductions from the structure (anything not pf/esi/pt/tds)
        // — scaled to earned pay so they don't apply to an unpaid month.
        $other = 0;
        foreach ($structDeductions as $d) {
            $code = strtolower($d['code'] ?? '');
            if (!in_array($code, ['pf', 'esi', 'pt', 'tds'], true)) {
                $other += round(((float) ($d['amount'] ?? 0)) * $earnedFactor, 2);
            }
        }
        // Approved one-off deduction adjustments (not pro-rated — they're
        // explicit amounts HR entered for this cycle).
        $adjDeductions = $this->approvedDeductionAdjustments($employee->id, $period);
        $other += $adjDeductions;

        // ── Rule 11 — advance / loan recovery ──────────────────────────────
        // Net before recovery = earned pay minus the non-LOP deductions. The
        // FOI ceiling caps TOTAL advance recovery at 70% of it (the same
        // headroom enforced when advances are raised). We pass that cap INTO the
        // allocator so, when two EMIs won't both fit in a lean month, the oldest
        // advance is recovered first and the remainder of the newer one carries
        // to its next cycle instead of being silently dropped.
        $netBeforeRecovery = $earnedGross - ($pf + $esi + $pt + $tds + $other);
        $foiCap = round(max(0, $netBeforeRecovery) * 0.70, 2);
        $advanceRec = $this->advanceRecovery($employee->id, $period, $foiCap);
        $carried = round(array_sum(array_column($this->lastRecoveryBreakdown, 'carried')), 2);
        if ($carried > 0.01) {
            $exceptions = $this->withException($exceptions, 'warning',
                'Advance recovery exceeded the 70% FOI headroom this cycle — ₹'
                . number_format($carried, 2) . ' carried to the next cycle.');
        }

        // Overtime + bonus/incentive (Rule 10). Overtime was priced above:
        // a recorded adjustment when one exists, otherwise the hours the
        // attendance shows past the shift end. Bonus still counts only
        // APPROVED adjustments.
        $overtimeAmount = $ot['amount'];
        $overtimeHours  = $ot['hours'];
        $bonusAmount    = $this->approvedBonusAmount($employee->id, $period);

        $totalDeductions = round($pf + $esi + $pt + $tds + $lopAmount + $advanceRec + $other, 2);
        // Net = earned pay + approved OT/bonus − non-LOP deductions (LOP is
        // already embodied in earnedGross < proratedGross).
        $netPay = round($earnedGross + $overtimeAmount + $bonusAmount - ($pf + $esi + $pt + $tds + $advanceRec + $other), 2);
        if ($netPay < 0) {
            // Fixed deductions exceeded earned pay — floor to zero and flag so
            // HR can carry the shortfall to the next cycle.
            $exceptions = $this->withException($exceptions, 'warning',
                'Deductions exceeded earned pay — net floored to ₹0; carry the balance to the next cycle.');
            $netPay = 0;
        }
        // A zero net on a paid structure means the employee was effectively
        // fully absent / on LOP this cycle — never let that pass silently as
        // "Ready"; flag it so HR verifies before disbursing.
        if ($netPay <= 0 && $proratedGross > 0) {
            $exceptions = $this->withException($exceptions, 'warning',
                'Zero net pay — employee was fully absent / on loss-of-pay this cycle. Verify before processing.');
        }

        // Deductions JSON for the payslip (only non-zero heads).
        $deductions = [];
        if ($pt > 0)          $deductions[] = ['code' => 'pt',  'label' => 'Professional Tax', 'amount' => $pt];
        if ($pf > 0)          $deductions[] = ['code' => 'pf',  'label' => 'Provident Fund (12%)', 'amount' => $pf];
        if ($esi > 0)         $deductions[] = ['code' => 'esi', 'label' => 'ESI', 'amount' => $esi];
        if ($tds > 0)         $deductions[] = ['code' => 'tds', 'label' => 'Income Tax (TDS)', 'amount' => $tds];
        if ($lopAmount > 0)   $deductions[] = ['code' => 'lop', 'label' => 'Loss of Pay', 'amount' => $lopAmount];
        // Advance recovery — ONE line per advance (its own EMI), not a lump sum,
        // so the payslip shows exactly which advance each rupee went to. Falls
        // back to a single "Advance Recovery" line if the split is unavailable.
        if ($advanceRec > 0) {
            $advLines = array_values(array_filter(
                $this->lastRecoveryBreakdown,
                fn ($b) => ($b['recovered'] ?? 0) > 0
            ));
            if (!empty($advLines)) {
                foreach ($advLines as $b) {
                    $deductions[] = [
                        'code'       => 'advance',
                        'label'      => $b['label'] ?? 'Advance Recovery',
                        'amount'     => round((float) $b['recovered'], 2),
                        'advance_no' => $b['advance_no'] ?? null,
                    ];
                }
            } else {
                $deductions[] = ['code' => 'advance', 'label' => 'Advance Recovery', 'amount' => $advanceRec];
            }
        }
        // Structure "other" portion (excludes the adjustment deductions, which
        // are listed as their own labelled lines below to avoid double-display).
        $structOther = round($other - $adjDeductions, 2);
        if ($structOther > 0) $deductions[] = ['code' => 'other', 'label' => 'Other Deductions', 'amount' => $structOther];
        foreach ($this->adjustmentLines($employee->id, $period, ['deduction']) as $line) {
            $deductions[] = $line;
        }

        // ── Rule 12 — bank details gate (warn now, block at pay/export) ─────
        if (!$base['bank_verified']) {
            $exceptions = $this->withException($exceptions, 'blocking',
                'Bank details missing/invalid — payment blocked until corrected.');
        }

        // ── Status + attendance source ─────────────────────────────────────
        $hasBlocking = collect($exceptions)->contains(fn ($e) => $e['type'] === 'blocking');
        $hasWarning  = collect($exceptions)->contains(fn ($e) => $e['type'] === 'warning');
        $status = $hasBlocking ? 'On Hold' : ($hasWarning ? 'Pending Review' : 'Ready');

        $attSource = $att['rows'] > 0
            ? ($hasWarning && ($missingPunch > 0 || $lateLopDays > 0) ? 'Review' : 'Biometric')
            : 'Manual';

        return array_merge($base, [
            'present_days'   => $presentDays,
            'paid_days'      => $paidDays,
            'weekoff_days'   => $weekOffDays,
            'lop_days'       => $lopDays,
            'paid_leave_days'   => $paidLeaveDays,
            'unpaid_leave_days' => $unpaidLeaveDays,
            'late_marks'     => $lateMarks,
            'missing_punches' => $missingPunch,
            'overtime_hours' => $overtimeHours,
            'att_source'     => $attSource,
            'earnings'       => $earnings,
            'deductions'     => $deductions,
            // Total earnings = structure gross (pre-LOP) + approved OT/bonus,
            // so the payslip's "Total Earnings" matches the line items and
            // Net = Total Earnings − Total Deductions (LOP sits in deductions).
            'gross_earnings' => round($proratedGross + $overtimeAmount + $bonusAmount, 2),
            'basic'          => $proratedBasic,
            'overtime_amount' => $overtimeAmount,
            'bonus_amount'   => $bonusAmount,
            'pf_employee'    => $pf,
            'esi'            => $esi,
            'pt'             => $pt,
            'tds'            => $tds,
            'lop_amount'     => $lopAmount,
            'advance_recovery' => $advanceRec,
            'loan_recovery'  => 0,
            'other_deductions' => $other,
            'total_deductions' => $totalDeductions,
            'net_pay'        => $netPay,
            'status'         => $status,
            'hold_reason'    => $hasBlocking ? collect($exceptions)->firstWhere('type', 'blocking')['reason'] : null,
            'exceptions'     => $exceptions,
        ]);
    }

    // ── Compensation resolution ────────────────────────────────────────────

    /** Latest active structure effective on/before $asOf. */
    public function activeStructure(Employee $employee, $asOf): ?SalaryStructure
    {
        // Resolve the version actually IN FORCE on $asOf — the latest one whose
        // effective_from has arrived. We include 'superseded' rows (not just
        // the currently-'active' one) so a FUTURE-dated revision doesn't orphan
        // the current period: the still-effective prior version is used until
        // the new one's effective date arrives, and past payslips reconstruct
        // against whatever was in force then (Rule 19). Drafts are excluded.
        return SalaryStructure::where('employee_id', $employee->id)
            ->whereIn('status', ['active', 'superseded'])
            ->whereDate('effective_from', '<=', Carbon::parse($asOf))
            ->orderByDesc('effective_from')
            ->orderByDesc('version')
            ->first();
    }

    /**
     * Returns [gross, basic, earningComponents[], deductionComponents[],
     * pfApplicable, esiApplicable, ptApplicable]. Falls back to the employee's
     * annual_salary (with a warning) when no structure exists, so the cycle is
     * still usable before structures are authored.
     */
    private function resolveCompensation(Employee $employee, ?SalaryStructure $structure, array &$exceptions): array
    {
        if ($structure) {
            return [
                (float) $structure->monthly_gross,
                (float) $structure->basicAmount(),
                (array) $structure->earnings,
                (array) $structure->deductions,
                (bool) $structure->pf_applicable,
                (bool) $structure->esi_applicable,
                (bool) $structure->pt_applicable,
            ];
        }

        // Fallback: derive a standard 50/30/20 split from annual salary.
        $annual = (float) ($employee->annual_salary ?? 0);
        if ($annual <= 0) {
            return [0, 0, [], [], false, false, true];
        }
        $exceptions = $this->withException($exceptions, 'warning',
            'No salary structure on file — auto-derived from annual salary (Basic/HRA/Special).');
        $gross   = round($annual / 12, 2);
        $basic   = round($gross * 0.5, 2);
        $hra     = round($gross * 0.3, 2);
        $special = round($gross - $basic - $hra, 2);
        return [
            $gross,
            $basic,
            [
                ['code' => 'basic',   'label' => 'Basic Salary',           'amount' => $basic],
                ['code' => 'hra',     'label' => 'House Rent Allowance',   'amount' => $hra],
                ['code' => 'special', 'label' => 'Special Allowance',      'amount' => $special],
            ],
            [],
            (bool) $employee->pf_eligible,
            // Honour the employee's own "ESI Applicable" flag (onboarding
            // Stage 4 / Compensation). The ₹21k gross ceiling is still
            // enforced separately where ESI is actually computed.
            strtolower((string) ($employee->esi_applicable ?? '')) === 'yes',
            true,
        ];
    }

    private function structureDeduction(array $deductions, string $code): float
    {
        foreach ($deductions as $d) {
            if (strtolower($d['code'] ?? '') === $code) {
                return round((float) ($d['amount'] ?? 0), 2);
            }
        }
        return 0;
    }

    /** PF applies to full-time staff; treat unknown work_type as eligible. */
    private function isPfEligibleType(Employee $employee): bool
    {
        $type = strtolower((string) ($employee->work_type ?? ''));
        return $type === '' || str_contains($type, 'full');
    }

    // ── Attendance / leave aggregates ──────────────────────────────────────

    /**
     * Count the company holidays (from the employee's assigned holiday group)
     * that fall on a WORKING day within the active window. Sundays are already
     * excluded from working_days, so they're skipped here to avoid crediting a
     * holiday that lands on an off-day. Recurring holidays are matched by
     * month/day against the window's year. Returns a whole-day count.
     */
    private function holidayAggregates($employee, Carbon $start, Carbon $end): float
    {
        if (!Schema::hasTable('holidays')) {
            return 0.0;
        }
        $groupId = $employee->holiday_group_id ?? null;
        if (!$groupId) {
            return 0.0;
        }

        $count = 0;
        $label = (string) ($employee->weekly_off ?? '');
        foreach (array_keys($this->holidayDateSet($employee, $start, $end)) as $ds) {
            // A holiday landing on this employee's OWN weekly off is already a
            // non-working day — crediting it again would pay the same day twice.
            // Was hardcoded to Sunday, which double-counted for anyone whose
            // Saturday is off.
            if (\App\Support\WeekOff::isOff($label, Carbon::parse($ds))) continue;
            $count++;
        }

        return (float) $count;
    }

    /**
     * Holiday dates for this employee's group within [start, end], as a
     * Y-m-d => true lookup, with recurring entries re-anchored to the window.
     *
     * Extracted so leave sizing can ask the same question. It used to be inline
     * in holidayAggregates(), which meant leaveAggregates() had no way to know
     * about holidays at all and counted them as ordinary working days — the
     * opposite of what LeaveRequestController does with the same leave.
     *
     * @return array<string,true>
     */
    private function holidayDateSet($employee, Carbon $start, Carbon $end): array
    {
        if (!Schema::hasTable('holidays')) {
            return [];
        }
        $groupId = $employee->holiday_group_id ?? null;
        if (!$groupId) {
            return [];
        }

        $rows = DB::table('holidays')
            ->where('holiday_group_id', $groupId)
            ->whereNull('deleted_at')
            ->get(['date', 'is_recurring']);

        $dates = [];
        foreach ($rows as $r) {
            if (!$r->date) continue;
            $d = Carbon::parse($r->date);

            if ($r->is_recurring) {
                // Anchor to EVERY year the window touches, not just the start
                // year: padding a December window pushes it into January, and
                // anchoring only to the start year would drop a New Year
                // holiday that genuinely falls inside it.
                foreach (range($start->year, $end->year) as $year) {
                    $anchored = Carbon::create($year, $d->month, $d->day);
                    if ($anchored->gte($start) && $anchored->lte($end)) {
                        $dates[$anchored->toDateString()] = true;
                    }
                }
                continue;
            }

            if ($d->lt($start) || $d->gt($end)) continue;
            $dates[$d->toDateString()] = true; // dedupe same-day entries
        }

        return $dates;
    }

    private function attendanceAggregates(int $employeeId, Carbon $start, Carbon $end, ?string $shiftStart = null): array
    {
        if (!Schema::hasTable('attendances')) {
            return ['present' => 0, 'late' => 0, 'missing' => 0, 'rows' => 0];
        }
        $rows = DB::table('attendances')
            ->where('employee_id', $employeeId)
            ->whereNull('deleted_at')
            ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])
            ->get(['status', 'check_in_at', 'check_out_at']);

        // The face-clock flow always stores 'Present' on first punch — the
        // 'Late' status is derived at READ time from the shift-start heuristic
        // (AttendanceController::resolveDayStatus). Payroll must apply the same
        // promotion, otherwise Late Marks / Mismatch always read 0 on the
        // payslip + Biometric Input table even when the employee was late. (#34)
        $shiftStart = $shiftStart ?: '09:30';

        $present = 0.0;
        $late = 0;
        $missing = 0;
        foreach ($rows as $r) {
            $status = (string) ($r->status ?? '');
            $hasIn  = !empty($r->check_in_at);
            $hasOut = !empty($r->check_out_at);
            // Promote Present → Late when first-in is >10 min past shift start
            // (10-min grace + UTC→local conversion mirror the attendance module).
            if (strcasecmp($status, 'Present') === 0 && $hasIn) {
                $localIn = Carbon::parse($r->check_in_at, 'UTC')->setTimezone(self::DISPLAY_TZ)->format('H:i');
                if ($this->minutesBetween($shiftStart, $localIn) > 10) {
                    $status = 'Late';
                }
            }

            $worked = false;
            switch ($status) {
                case 'Present':
                case 'On Duty':
                case 'Work From Home':
                case 'Corrected':
                    $present += 1; $worked = true; break;
                case 'Late':
                    $present += 1; $late++; $worked = true; break;
                case 'Half Day':
                    $present += 0.5; $worked = true; break;
                case 'Missing In':
                case 'Missing Out':
                    $present += 1; $missing++; $worked = true; break;
                // Absent / Leave / Weekly Off / Holiday → not counted present.
            }

            // "Missing punch" is never persisted as a status anywhere in the
            // system, so derive it: a worked day that recorded only one side of
            // the punch pair (in without out, or out without in) is an
            // incomplete/missing punch. This is what drives the Missing Punch +
            // Mismatch columns in the Biometric Input table. (#34)
            if ($worked && $status !== 'Missing In' && $status !== 'Missing Out' && ($hasIn xor $hasOut)) {
                $missing++;
            }
        }
        return ['present' => round($present, 2), 'late' => $late, 'missing' => $missing, 'rows' => $rows->count()];
    }

    /** Minutes from $from ("HH:MM") to $to ("HH:MM"); negative if $to earlier. */
    private function minutesBetween(string $from, string $to): int
    {
        [$fh, $fm] = array_map('intval', explode(':', $from));
        [$th, $tm] = array_map('intval', explode(':', $to));
        return ($th * 60 + $tm) - ($fh * 60 + $fm);
    }

    /**
     * How many of a leave's days exist only because of the Sandwich Leave
     * Policy — i.e. what waiving it would give back.
     *
     * Public because the payroll screen's review list needs the same figure the
     * leave screen shows. Both call this rather than each deriving it, so a
     * "+2 days" on one screen is never a "+1 day" on the other.
     */
    public function sandwichDaysFor(Employee $employee, $leave): float
    {
        return $this->sandwichBreakdown($employee, $leave)['sandwich'];
    }

    /**
     * How a leave splits under the policy: working days actually applied for,
     * and the off-days the policy adds on top.
     *
     * Both numbers are needed because leave_requests.days ALONE is ambiguous —
     * a leave raised while the policy was on already has the off-days folded
     * into it, while one approved before it was switched on does not. A screen
     * given only "days" and "sandwich days" cannot tell whether to add them or
     * not, and read "4 days deducted (+2 off-days)" as six.
     *
     * @return array{working: float, sandwich: float}
     */
    public function sandwichBreakdown(Employee $employee, $leave): array
    {
        if (!\App\Support\SandwichPolicy::appliesTo($employee)) {
            return ['working' => 0.0, 'sandwich' => 0.0];
        }

        $from = Carbon::parse($leave->from_date);
        $to   = Carbon::parse($leave->to_date);

        // Padded: the scan steps outside the leave on both sides, and an
        // off-run adjacent to it can sit wholly beyond the dates.
        $pad     = \App\Support\SandwichPolicy::LOOKAROUND_DAYS;
        $padFrom = $from->copy()->subDays($pad);
        $padTo   = $to->copy()->addDays($pad);

        $weeklyOffLabel = (string) ($employee->weekly_off ?? '');
        $holidaySet     = $this->holidayDateSet($employee, $padFrom, $padTo);

        $isOff = fn (Carbon $d): bool => \App\Support\WeekOff::isOff($weeklyOffLabel, $d)
            || isset($holidaySet[$d->toDateString()]);

        // This leave is itself Approved, so it is already inside the set — no
        // need to add its own range back the way the request path has to.
        $approved = \App\Support\SandwichPolicy::approvedLeaveDates((int) $employee->id, $padFrom, $padTo);
        $isLeave  = fn (Carbon $d): bool => isset($approved[$d->copy()->startOfDay()->toDateString()]);

        $working = 0.0;
        for ($d = $from->copy(); $d->lte($to); $d->addDay()) {
            if (!$isOff($d)) $working += 1.0;
        }

        return [
            'working'  => $working,
            'sandwich' => (float) count(
                \App\Support\SandwichPolicy::chargeableOffDays($from, $to, $isOff, $isLeave)
            ),
        ];
    }

    /**
     * Approved leave in the window split into paid vs unpaid by the leave
     * type's paid_unpaid flag (Rule 3). Days clipped to the active window.
     */
    private function leaveAggregates(int $employeeId, Carbon $start, Carbon $end): array
    {
        if (!Schema::hasTable('leave_requests')) {
            return ['paid' => 0, 'unpaid' => 0, 'sandwich_lop' => 0];
        }

        // The employee's own weekly-off pattern decides which days inside a
        // leave span are chargeable — same rule LeaveRequestController uses.
        $employee = Employee::find($employeeId);
        $weeklyOffLabel = (string) ($employee->weekly_off ?? '');

        $rows = DB::table('leave_requests')
            ->where('employee_id', $employeeId)
            ->where('status', 'Approved')
            ->whereDate('from_date', '<=', $end->toDateString())
            ->whereDate('to_date', '>=', $start->toDateString())
            ->get(['leave_type_id', 'from_date', 'to_date', 'days', 'day_type', 'sandwich_waived']);

        if ($rows->isEmpty()) {
            return ['paid' => 0, 'unpaid' => 0, 'sandwich_lop' => 0];
        }

        $paidMap = $this->leaveTypePaidMap($rows->pluck('leave_type_id')->unique()->all());

        /* One "is this an off day?" predicate, shared by the span count below
         * and by the sandwich scan, so the two can never disagree with each
         * other — or with LeaveRequestController, which sizes the very same
         * leave when it is raised.
         *
         * Holidays now count as off days here. They always did on the request
         * side; payroll only looked at weekly-offs, so a holiday inside a leave
         * was silently credited as a payable leave day. Leaving that in place
         * would also have double-charged under the sandwich rule — once as a
         * "working" day in the span, once as a sandwiched off-day. */
        $pad      = \App\Support\SandwichPolicy::LOOKAROUND_DAYS;
        $padStart = $start->copy()->subDays($pad);
        $padEnd   = $end->copy()->addDays($pad);
        $holidaySet = $employee ? $this->holidayDateSet($employee, $padStart, $padEnd) : [];

        $isOff = fn (Carbon $d): bool => \App\Support\WeekOff::isOff($weeklyOffLabel, $d)
            || isset($holidaySet[$d->toDateString()]);

        $sandwichOn = \App\Support\SandwichPolicy::appliesTo($employee);
        // Every approved leave in the padded window, so a sandwich whose two
        // halves were filed as separate requests is still seen.
        $approvedDates = $sandwichOn
            ? \App\Support\SandwichPolicy::approvedLeaveDates($employeeId, $padStart, $padEnd)
            : [];
        $isLeave = fn (Carbon $d): bool => isset($approvedDates[$d->copy()->startOfDay()->toDateString()]);

        $windowStart = $start->toDateString();
        $windowEnd   = $end->toDateString();

        $paid = 0.0;
        $unpaid = 0.0;
        /* Sandwiched off-days on an UNPAID leave, charged straight to LOP.
         *
         * On a PAID leave the sandwich is charged to the leave BALANCE, and
         * that is the whole cost — 4 days of entitlement burnt for a 2-day
         * absence, with pay following only once the balance runs out.
         * An unpaid leave has no balance to burn, so the rule had nothing to
         * bite on and simply did not apply: the same Friday-off-Monday absence
         * cost an extra day on paid leave and nothing at all on LWP, purely
         * because of the leave type. From the employee's side it is the same
         * absence.
         * It cannot be fixed by adding the day to $unpaid either — paid days
         * are built from present + paid leave + holidays, and LOP is whatever
         * is left of the WORKING days, which never contained the off-day. So
         * the charge has to be added to LOP explicitly, which is also what an
         * LWP sandwich means in practice: the off-day is unpaid too. */
        $sandwichLop = 0.0;
        foreach ($rows as $r) {
            // Clip the leave span to the active window, then size it.
            $from = Carbon::parse($r->from_date)->max($start);
            $to   = Carbon::parse($r->to_date)->min($end);
            if ($to->lt($from)) {
                continue;
            }
            // Count only WORKING days in the clipped window so a leave that
            // straddles a weekend doesn't over-credit paid days (Rule 3
            // precision). Was hardcoded to Sundays — a Saturday-off employee
            // therefore had every Saturday inside a leave counted as payable.
            $span = 0;
            for ($d = $from->copy(); $d->lte($to); $d->addDay()) {
                if (!$isOff($d)) {
                    $span++;
                }
            }

            /* Sandwiched off-days are DELIBERATELY NOT added to this span.
             *
             * This figure answers exactly one question: how many WORKING days
             * did the leave cover? It is compared against effectiveWorkingDays
             * to size paid days and loss-of-pay — and weekly-offs and holidays
             * are not in that denominator. Counting a sandwiched Saturday as a
             * paid leave day credits the employee for a day they were never due
             * to work. Measured on this data it cut LOP from 19 days to 16 and
             * made the sandwich policy PAY MORE, the exact opposite of what it
             * exists to do.
             *
             * The sandwich lives in leave_requests.days instead — the leave
             * BALANCE. That is what the policy really costs: 4 days of
             * entitlement burnt for a 2-working-day absence. Salary follows only
             * once that balance is exhausted and further leave must be unpaid. */

            // Half-day flag on a single-day request.
            if ($r->day_type !== 'full' && $from->isSameDay($to)) {
                $span = 0.5;
            }
            // Never credit more than the days HR actually recorded on the request.
            if ((float) $r->days > 0 && (float) $r->days < $span) {
                $span = (float) $r->days;
            }
            $flag = strtolower((string) ($paidMap[$r->leave_type_id] ?? 'paid'));
            if (in_array($flag, ['unpaid', 'lwp', 'loss of pay', 'loss_of_pay'], true)) {
                $unpaid += $span;
                // Waived by HR on the payroll review — the same flag the paid
                // side honours, so one decision covers both.
                if ($sandwichOn && $employee && !$r->sandwich_waived) {
                    $sandwichLop += (float) $this->sandwichBreakdown($employee, $r)['sandwich'];
                }
            } else {
                $paid += $span;
            }
        }
        return [
            'paid' => round($paid, 2),
            'unpaid' => round($unpaid, 2),
            'sandwich_lop' => round($sandwichLop, 2),
        ];
    }

    /** leave_type_id => paid_unpaid flag (defensive about table/column names). */
    private function leaveTypePaidMap(array $ids): array
    {
        if (empty($ids)) {
            return [];
        }
        foreach (['master_leave_types', 'leave_types'] as $table) {
            if (Schema::hasTable($table) && Schema::hasColumn($table, 'paid_unpaid')) {
                return DB::table($table)->whereIn('id', $ids)->pluck('paid_unpaid', 'id')->all();
            }
        }
        return [];
    }

    // ── Statutory + recovery helpers ───────────────────────────────────────

    /**
     * Rule 9 — Professional Tax by state slab + gender. Defaults to the
     * Maharashtra slab (the primary test tenant is Pune/MH); unknown states
     * fall back to the same slab. Women are exempt up to ₹25,000 gross.
     */
    public function professionalTax(Employee $employee, float $gross, int $month): float
    {
        $gender = strtolower((string) ($employee->gender ?? ''));
        $isFemale = str_starts_with($gender, 'f');

        // Maharashtra slab.
        if ($isFemale) {
            return $gross <= 25000 ? 0 : 200;
        }
        if ($gross <= 7500)  return 0;
        if ($gross <= 10000) return 175;
        // February carries the ₹300 top-up (₹2,500 annual cap).
        return $month === 2 ? 300 : 200;
    }

    /**
     * Rule 11 — sum of approved advance EMIs due in this period. Reads
     * advance_requests (hr_status approved) whose recovery schedule covers the
     * cycle. Returns 0 if the table is absent.
     */
    /**
     * Advance / loan recovery for the cycle, allocated across the employee's
     * running advances under a hard ceiling ($cap — the 70% FOI headroom).
     *
     * Each advance's NORMAL due this cycle is stateless: an EMI / bi-monthly
     * advance owes its monthly_emi while the cycle sits inside its schedule
     * window; a lump-sum owes the whole amount in its start month only. On top
     * of that we ADD any arrears the ledger says were carried from a prior lean
     * month. So with NO ledger the engine behaves exactly like a plain monthly
     * schedule (no double-counting); the ledger only ever *adds* a real,
     * previously-recorded shortfall.
     *
     * When the combined dues won't fit under the cap, the OLDEST advance is
     * recovered first (by recovery_start, then id); whatever doesn't fit on a
     * newer advance is CARRIED to its next cycle. `carried` in the ledger is the
     * running outstanding arrears, so taking the latest prior row already folds
     * in everything deferred to date. Recovery is also capped at the advance's
     * outstanding balance so it can never over-collect.
     *
     * READ-ONLY — it never writes the ledger (generate() does, once, at persist
     * time). The per-advance split is exposed via $this->lastRecoveryBreakdown.
     */
    private function advanceRecovery(int $employeeId, PayrollPeriod $period, float $cap = INF): float
    {
        $this->lastRecoveryBreakdown = [];
        if (!Schema::hasTable('advance_requests')) {
            return 0;
        }
        $hasLedger = Schema::hasTable('advance_recovery_ledger');
        $room  = max(0.0, $cap);
        $total = 0.0;

        // Build the recovery STREAMS for this employee. An advance can be
        // recovered on two independent streams:
        //   self   — the employee repaying the advance they took (recovery_*).
        //   return — the employee returning UNUSED advance via payroll
        //            (settle_return_*), scheduled at settlement time.
        $streams = [];

        foreach (DB::table('advance_requests')
            ->where('employee_id', $employeeId)
            ->where('hr_status', 'approved')
            ->whereNotNull('recovery_start')
            ->whereDate('recovery_start', '<=', $period->period_end->toDateString())
            ->get(['id', 'amount', 'sanctioned_amount', 'recovery_start', 'recovery_mode', 'recovery_months', 'monthly_emi',
                   'advance_no', 'advance_type', 'advance_type_other']) as $r) {
            $type = $this->advanceTypeLabel($r->advance_type, $r->advance_type_other);
            $streams[] = [
                'advance_request_id' => (int) $r->id,
                'stream'     => 'self',
                'start'      => $r->recovery_start,
                'mode'       => $r->recovery_mode,
                'months'     => (int) ($r->recovery_months ?: 0),
                'emi'        => (float) ($r->monthly_emi ?: 0),
                // Recover only what the employee actually RECEIVED — the sanctioned
                // (net) amount after any deduction/addition at payout, not the
                // originally-claimed amount. The last EMI trims to this total.
                'amount'     => (float) ($r->sanctioned_amount ?? $r->amount),
                'advance_no' => $r->advance_no,
                'label'      => 'Advance Recovery – ' . $type . ($r->advance_no ? ' (' . $r->advance_no . ')' : ''),
            ];
        }

        // Company-return-via-payroll streams (only once scheduled at settlement).
        foreach (DB::table('advance_requests')
            ->where('employee_id', $employeeId)
            ->whereNotNull('settle_return_scheduled_at')
            ->whereNotNull('settle_return_recovery_start')
            ->whereDate('settle_return_recovery_start', '<=', $period->period_end->toDateString())
            ->get(['id', 'settle_balance', 'settle_return_payments', 'settle_return_recovery_start',
                   'settle_return_recovery_mode', 'settle_return_recovery_months', 'settle_return_monthly',
                   'advance_no', 'advance_type', 'advance_type_other']) as $r) {
            // Amount to recover via payroll = balance owed minus any DIRECT
            // return payments already recorded (cash/bank before scheduling).
            $paid = 0.0;
            foreach ((json_decode((string) ($r->settle_return_payments ?? '[]'), true) ?: []) as $p) {
                $paid += (float) ($p['amount'] ?? 0);
            }
            $retAmount = round((float) $r->settle_balance - $paid, 2);
            if ($retAmount <= 0.0) {
                continue;
            }
            $type = $this->advanceTypeLabel($r->advance_type, $r->advance_type_other);
            $streams[] = [
                'advance_request_id' => (int) $r->id,
                'stream'     => 'return',
                'start'      => $r->settle_return_recovery_start,
                'mode'       => $r->settle_return_recovery_mode,
                'months'     => (int) ($r->settle_return_recovery_months ?: 0),
                'emi'        => (float) ($r->settle_return_monthly ?: 0),
                'amount'     => $retAmount,
                'advance_no' => $r->advance_no,
                'label'      => 'Advance Return – ' . $type . ($r->advance_no ? ' (' . $r->advance_no . ')' : ''),
            ];
        }

        // Oldest schedule first — that stream gets priority when the cap can't
        // cover everything (self before return on the same date/advance).
        usort($streams, function ($a, $b) {
            return strcmp((string) $a['start'], (string) $b['start'])
                ?: ($a['advance_request_id'] <=> $b['advance_request_id'])
                ?: strcmp($a['stream'], $b['stream']);
        });

        $priorScope = function ($q) use ($period) {
            $q->where('year', '<', (int) $period->year)
              ->orWhere(function ($q2) use ($period) {
                  $q2->where('year', (int) $period->year)->where('month', '<', (int) $period->month);
              });
        };

        foreach ($streams as $s) {
            $amount = $s['amount'];
            $start  = Carbon::parse($s['start'])->startOfMonth();
            if ($period->period_end->lt($start)) {
                continue; // recovery hasn't started yet
            }
            // 0-based month offset from the start month to this cycle.
            $monthIndex = $start->diffInMonths($period->period_end->copy()->startOfMonth());

            // NORMAL amount owed for THIS cycle (stateless — no ledger needed).
            $normalDue = $this->scheduledDueForCycle($s['mode'], $monthIndex, $s['months'], $s['emi'], $amount);

            // Arrears carried from prior lean months + total already recovered on
            // THIS stream (both zero when there's no ledger yet).
            $arrears = 0.0; $recoveredBefore = 0.0;
            if ($hasLedger) {
                $prior = DB::table('advance_recovery_ledger')
                    ->where('advance_request_id', $s['advance_request_id'])->where('stream', $s['stream'])
                    ->where($priorScope)->orderByDesc('year')->orderByDesc('month')->first();
                $arrears = $prior ? (float) $prior->carried : 0.0;
                $recoveredBefore = (float) DB::table('advance_recovery_ledger')
                    ->where('advance_request_id', $s['advance_request_id'])->where('stream', $s['stream'])
                    ->where($priorScope)->sum('amount');
            }

            // Due = this cycle's EMI + carried arrears, never beyond the balance.
            $outstanding = round($amount - $recoveredBefore, 2);
            $due = round(min($normalDue + $arrears, max(0.0, $outstanding)), 2);
            if ($due <= 0.0) {
                continue;
            }

            // Recover as much as the remaining headroom allows; the rest carries.
            $take = round(min($due, $room), 2);
            $room  = round($room - $take, 2);
            $total = round($total + $take, 2);
            $this->lastRecoveryBreakdown[] = [
                'advance_request_id' => $s['advance_request_id'],
                'stream'             => $s['stream'],
                'advance_no'         => $s['advance_no'],
                'label'              => $s['label'],
                'due'                => $due,
                'recovered'          => $take,
                'carried'            => round($due - $take, 2),
            ];
        }
        return round($total, 2);
    }

    /**
     * The stateless amount an advance stream owes in a given cycle (no ledger).
     * EMI = the instalment every month within the schedule; BI-MONTHLY = the
     * instalment on ALTERNATE months (offsets 0, 2, 4 …); LUMP-SUM = the whole
     * amount in the start month only.
     */
    private function scheduledDueForCycle(?string $mode, int $monthIndex, int $months, float $emi, float $amount): float
    {
        if ($monthIndex < 0) {
            return 0.0;
        }
        $hasEmi = in_array($mode, ['emi', 'bimonthly'], true) && ($emi > 0 || $months > 0);
        if (!$hasEmi) {
            return $monthIndex === 0 ? $amount : 0.0; // lump-sum: start month only
        }
        $n   = max(1, $months);
        $per = $emi > 0 ? $emi : round($amount / $n, 2);
        if ($mode === 'bimonthly') {
            if ($monthIndex % 2 !== 0) {
                return 0.0; // off month
            }
            return intdiv($monthIndex, 2) < $n ? $per : 0.0;
        }
        return $monthIndex < $n ? $per : 0.0; // plain monthly EMI
    }

    /** Friendly advance-type label ("Other" falls back to the free-text type). */
    private function advanceTypeLabel(?string $type, ?string $other): string
    {
        $t = trim((string) ($type === 'Other' ? ($other ?: 'Advance') : ($type ?: 'Advance')));
        return $t !== '' ? $t : 'Advance';
    }

    /**
     * Persist the per-advance recovery split for a cycle (called once, from
     * generate(), after the payslip is saved). One row per advance/month,
     * overwritten on regenerate so re-processing a month stays idempotent.
     */
    private function recordRecoveryLedger(PayrollPeriod $period, int $employeeId, array $breakdown): void
    {
        if (empty($breakdown) || !Schema::hasTable('advance_recovery_ledger')) {
            return;
        }
        foreach ($breakdown as $b) {
            DB::table('advance_recovery_ledger')->updateOrInsert(
                [
                    'advance_request_id' => $b['advance_request_id'],
                    'stream'             => $b['stream'] ?? 'self',
                    'year'               => (int) $period->year,
                    'month'              => (int) $period->month,
                ],
                [
                    'employee_id' => $employeeId,
                    'client_id'   => $period->client_id,
                    'branch_id'   => $period->branch_id,
                    'due'         => $b['due'],
                    'amount'      => $b['recovered'],
                    'carried'     => $b['carried'],
                    'updated_at'  => now(),
                    'created_at'  => now(),
                ]
            );
        }
    }

    
    private function shiftHours(Employee $employee): float
    {
        [$start, $end] = $employee->resolveShiftWindow();
        if (!$start || !$end) {
            return self::DEFAULT_SHIFT_HOURS;
        }
        $minutes = $this->minutesBetween($start, $end);
        if ($minutes <= 0) {
            $minutes += 24 * 60; // overnight shift, e.g. 22:00 → 06:00
        }
        return $minutes > 0 ? round($minutes / 60, 2) : self::DEFAULT_SHIFT_HOURS;
    }

   
    private function overtimeMultiplier(Employee $employee): array
    {
        $name = trim((string) ($employee->overtime ?? ''));
        // Blank, or the legacy "Not applicable" sentinel the field used to hold
        // before the OT Master existed — both mean "no policy assigned", so
        // report no name and let the caller use the friendlier warning.
        $unset = $name === '' || strcasecmp($name, 'Not Applicable') === 0;
        $none  = ['name' => $unset ? null : $name, 'multiplier' => 1.0, 'found' => false];

        if ($unset || !Schema::hasTable('master_overtime_rates')) {
            return $none;
        }

        $row = DB::table('master_overtime_rates')
            ->whereRaw('LOWER(rate_name) = ?', [mb_strtolower($name)])
            // Tenant scope mirrors MasterVisibility::applyReadScope — the
            // client's own rows plus super-admin globals (NULL client/branch).
            ->where(fn ($q) => $q->whereNull('client_id')->orWhere('client_id', $employee->client_id))
            ->where(fn ($q) => $q->whereNull('branch_id')->orWhere('branch_id', $employee->branch_id))
            ->whereRaw('LOWER(status) = ?', ['active'])
            // Tenant-specific row first (client_id IS NULL sorts false→true).
            ->orderByRaw('client_id IS NULL')
            ->orderByRaw('branch_id IS NULL')
            ->first(['rate_name', 'multiplier']);

        if (!$row || (float) $row->multiplier <= 0) {
            return $none;
        }
        return [
            'name'       => (string) $row->rate_name,
            'multiplier' => (float) $row->multiplier,
            'found'      => true,
        ];
    }

    /**
     * The employee's overtime pricing for a cycle — the breakdown behind
     * "OT Amount = Hourly Salary × Multiplier × Approved OT Hours".
     *
     * $gross is the FULL monthly gross and $workingDays the PERIOD's working
     * days, deliberately NOT the join/exit pro-rated figures: an hour of
     * overtime is worth the same whether the employee joined on the 1st or the
     * 20th. `effective_rate` is rounded to paise so a payslip's
     * hours × rate always reproduces the amount exactly.
     */
    public function overtimeRate(Employee $employee, float $gross, float $workingDays): array
    {
        $shiftHours = $this->shiftHours($employee);
        $days       = $workingDays > 0 ? $workingDays : 1.0;
        // Hourly Salary is rounded to paise — the spec's own worked example
        // carries ₹128.21 forward, not the unrounded ₹128.2051.
        $hourly     = round($shiftHours > 0 ? $gross / $days / $shiftHours : 0.0, 2);
        $policy     = $this->overtimeMultiplier($employee);

        return [
            'rate_name'      => $policy['name'],
            'multiplier'     => $policy['multiplier'],
            'rate_found'     => $policy['found'],
            'gross'          => round($gross, 2),
            'working_days'   => $days,
            'shift_hours'    => $shiftHours,
            'hourly'         => $hourly,
            // Per-hour figure for DISPLAY. The amount is rounded only once, at
            // the end of `hourly × multiplier × hours` (spec: ₹128.21 × 1.5 × 2
            // = ₹384.63), so never price off this rounded rate — ₹192.32 × 2
            // would give ₹384.64. `effective_rate_exact` is the math input.
            'effective_rate'       => round($hourly * $policy['multiplier'], 2),
            'effective_rate_exact' => $hourly * $policy['multiplier'],
        ];
    }

    /**
     * Overtime hours DETECTED from attendance: the time an employee stayed
     * past the END of their assigned shift.
     *
     * The shift end comes from the branch's configured Shift Details (Branch
     * form → Work Shifts), matched by name through
     * `Employee::resolveShiftWindow()`; an employee whose shift has no
     * parseable timing falls back to the 18:30 office default. Punches are
     * stored UTC and compared in local time, same as the late-mark heuristic.
     *
     * These hours are PAID directly when no overtime adjustment has been
     * recorded for the cycle — the approval gate was removed. An explicit
     * adjustment still overrides them.
     */
    public function overtimeHoursFromAttendance(Employee $employee, Carbon $start, Carbon $end): array
    {
        [$shiftStart, $shiftEnd] = $employee->resolveShiftWindow();
        $shiftStart = $shiftStart ?: self::DEFAULT_SHIFT_START;
        $shiftEnd   = $shiftEnd   ?: self::DEFAULT_SHIFT_END;
        // A shift whose end is at/before its start runs past midnight, so its
        // end belongs to the NEXT calendar day (e.g. 22:00 → 06:00).
        $overnight  = $this->minutesBetween($shiftStart, $shiftEnd) <= 0;

        $blank = ['hours' => 0.0, 'days' => 0, 'capped_days' => 0, 'shift_end' => $shiftEnd,
                  'applicable' => $employee->overtimeApplicable(), 'detail' => []];
        // Overtime is a per-employee setting (employee form → Leave &
        // Attendance → "Overtime Applicable"). Staying past the shift end
        // earns nothing for an employee it isn't applicable to, so detection
        // never runs for them.
        if (!$employee->overtimeApplicable() || !Schema::hasTable('attendances')) {
            return $blank;
        }

        $rows = DB::table('attendances')
            ->where('employee_id', $employee->id)
            ->whereNull('deleted_at')
            ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])
            ->whereNotNull('check_out_at')
            ->orderBy('attendance_date')
            ->get(['attendance_date', 'status', 'check_out_at']);

        $minutes = 0;
        $days    = 0;
        $capped  = 0;
        $detail  = [];

        foreach ($rows as $r) {
            // Only a day actually worked can carry overtime. A stray punch on
            // an off day is a data issue for HR, not automatic overtime.
            $status = strtolower(trim((string) ($r->status ?? '')));
            if (in_array($status, ['absent', 'leave', 'weekly off', 'holiday'], true)) {
                continue;
            }

            $date = substr((string) $r->attendance_date, 0, 10);
            // Compare real instants, not wall-clock strings: a punch-out at
            // 01:00 is 6.5h of overtime on an 18:30 shift, while one two days
            // later must read as a huge (cappable) gap — not as "left early".
            $endAt = Carbon::parse($date . ' ' . $shiftEnd, self::DISPLAY_TZ);
            if ($overnight) {
                $endAt->addDay();
            }
            $out  = Carbon::parse($r->check_out_at, 'UTC')->setTimezone(self::DISPLAY_TZ);
            $mins = intdiv($out->getTimestamp() - $endAt->getTimestamp(), 60);

            if ($mins <= 0) {
                continue; // left at or before shift end — no overtime
            }
            // The punch-out has to land before the employee's NEXT shift
            // starts. Past that the day was never properly closed, so its
            // overtime doesn't count at all (it is not carried, capped or
            // pro-rated — it's dropped). Mirrors Attendance::overtimeSecondsForDay().
            $nextShiftStart = Carbon::parse($date . ' ' . $shiftStart, self::DISPLAY_TZ)->addDay();
            if ($out->greaterThanOrEqualTo($nextShiftStart)) {
                continue;
            }
            if ($mins > self::MAX_OT_MINUTES_PER_DAY) {
                $mins = self::MAX_OT_MINUTES_PER_DAY;
                $capped++;
            }

            $minutes += $mins;
            $days++;
            $detail[] = [
                'date'      => $date,
                'shift_end' => $shiftEnd,
                // Date-stamped when the punch landed on a later day, so a
                // 01:00 out-punch isn't mistaken for an early morning one.
                'punch_out' => $out->toDateString() === $date
                    ? $out->format('H:i')
                    : $out->format('d M H:i'),
                'minutes'   => $mins,
                'hours'     => round($mins / 60, 2),
            ];
        }

        return [
            'hours'       => round($minutes / 60, 2),
            'days'        => $days,
            'capped_days' => $capped,
            'shift_end'   => $shiftEnd,
            'applicable'  => true,
            'detail'      => $detail,
        ];
    }

    /**
     * What HR sees before recording an overtime adjustment: the hours
     * attendance detected past the shift end, the rate they would be paid at,
     * and the resulting amount. Nothing is written.
     */
    public function overtimePreview(Employee $employee, int $month, int $year): array
    {
        $start = Carbon::create($year, $month, 1)->startOfDay();
        $end   = (clone $start)->endOfMonth()->startOfDay();

        $detected = $this->overtimeHoursFromAttendance($employee, $start, $end);
        $rate     = $this->overtimeRateForMonth($employee, $month, $year);

        return [
            'month'          => $month,
            'year'           => $year,
            'shift_end'      => $detected['shift_end'],
            // False when the employee master says overtime isn't applicable —
            // detected_hours is then always 0, and the UI can say WHY instead
            // of implying nobody stayed late.
            'applicable'     => $detected['applicable'],
            'detected_hours' => $detected['hours'],
            'days'           => $detected['days'],
            'capped_days'    => $detected['capped_days'],
            'detail'         => $detected['detail'],
            'rate'           => $rate,
            'amount'         => round($detected['hours'] * $rate['effective_rate_exact'], 2),
        ];
    }

    /**
     * The same OT rate resolved for a bare month/year — used when recording an
     * adjustment, before a payroll period/run necessarily exists. Working days
     * come from the period row when HR has already created (and possibly
     * edited) one, otherwise from the standard non-Sunday count.
     */
    public function overtimeRateForMonth(Employee $employee, int $month, int $year): array
    {
        $start = Carbon::create($year, $month, 1)->startOfDay();
        $end   = (clone $start)->endOfMonth()->startOfDay();

        $workingDays = PayrollPeriod::query()
            ->where('month', $month)
            ->where('year', $year)
            ->when($employee->client_id, fn ($q) => $q->where('client_id', $employee->client_id))
            ->when($employee->branch_id, fn ($q) => $q->where(fn ($w) => $w->whereNull('branch_id')->orWhere('branch_id', $employee->branch_id)))
            // A branch-scoped period beats a client-wide one for this employee.
            ->orderByRaw('branch_id IS NULL')
            ->value('working_days');

        $exceptions = [];
        $structure  = $this->activeStructure($employee, $end);
        [$gross] = $this->resolveCompensation($employee, $structure, $exceptions);

        return $this->overtimeRate(
            $employee,
            (float) $gross,
            (float) ($workingDays ?: $this->defaultWorkingDays($start, $end)),
        );
    }

    /**
     * Explicitly RECORDED overtime for the cycle, priced by the OT-rate formula.
     * Returns zero hours when none exists, in which case the caller falls back
     * to the hours detected from attendance.
     * Returns the total hours, the payable amount, the payslip earning lines
     * and any exceptions to surface to HR.
     *
     * Rows carrying `hours` are priced by the formula. A row with an explicit
     * `rate` keeps it as a manual per-hour override. Legacy rows with no hours
     * at all pay their stored flat `amount`, so adjustments recorded before
     * this rule existed are never silently zeroed.
     */
    public function overtimeForCycle(Employee $employee, PayrollPeriod $period, float $gross, float $workingDays): array
    {
        $empty = ['hours' => 0.0, 'amount' => 0.0, 'lines' => [], 'exceptions' => []];
        $rows  = $this->approvedOvertimeRows($employee->id, $period);
        if (empty($rows)) {
            return $empty;
        }

        $rate       = $this->overtimeRate($employee, $gross, $workingDays);
        $exceptions = [];
        $hours      = 0.0;
        $amount     = 0.0;
        $lines      = [];
        $usedDerivedRate = false;

        foreach ($rows as $r) {
            $rowHours = (float) ($r->hours ?? 0);
            $override = $r->rate !== null && (float) $r->rate > 0 ? (float) $r->rate : null;

            if ($rowHours > 0) {
                // Single rounding, at the end — see overtimeRate().
                $rowRate   = $override ?? $rate['effective_rate_exact'];
                $rowAmount = round($rowHours * $rowRate, 2);
                $hours    += $rowHours;
                if ($override === null) {
                    $usedDerivedRate = true;
                }
            } else {
                // No hours recorded — flat amount entered by HR.
                $rowAmount = round((float) $r->amount, 2);
            }

            $amount += $rowAmount;
            /* The pricing inputs travel WITH the amount. The payslip used to
               re-derive them at view time, which is how it ended up printing a
               rate and an hour count that didn't multiply out to the figure
               beside them. Stored here, the working is a snapshot of what was
               actually paid and cannot drift from it. `rate` is the effective
               per-hour (hourly × multiplier) the amount was priced at, so
               hours × rate reproduces it. */
            $lines[] = [
                'code'   => 'overtime',
                'label'  => $r->label ?: 'Overtime',
                'amount' => $rowAmount,
            ] + ($rowHours > 0 ? [
                'hours'      => $rowHours,
                'rate'       => round($override ?? $rate['effective_rate_exact'], 2),
                // A per-row rate override is a negotiated all-in figure, so the
                // hourly/multiplier split below only describes the derived rate.
                'hourly'     => $override === null ? $rate['hourly'] : null,
                'multiplier' => $override === null ? $rate['multiplier'] : null,
                'rate_name'  => $override === null && $rate['rate_found'] ? $rate['rate_name'] : null,
            ] : []);
        }

        $amount = round($amount, 2);

        if ($usedDerivedRate) {
            // Spell the arithmetic out on the payslip so HR/QA can verify the
            // figure without recomputing it by hand. 'info' never changes the
            // payslip status.
            $exceptions[] = ['type' => 'info', 'reason' => sprintf(
                'Overtime: ₹%s gross ÷ %s working days ÷ %s shift hrs = ₹%s/hr × %s%s × %s hr = ₹%s.',
                number_format($rate['gross'], 2),
                $this->trimNum($rate['working_days']),
                $this->trimNum($rate['shift_hours']),
                number_format($rate['hourly'], 2),
                $this->trimNum($rate['multiplier']),
                $rate['rate_found'] ? ' (' . $rate['rate_name'] . ')' : '',
                $this->trimNum($hours),
                number_format($amount, 2),
            )];

            if (!$rate['rate_found']) {
                $exceptions[] = ['type' => 'warning', 'reason' => $rate['rate_name']
                    ? "Overtime rate \"{$rate['rate_name']}\" is not an Active rate in Master › Overtime (OT) — overtime paid at 1× hourly. Verify before approving."
                    : 'Overtime hours recorded but no Overtime (OT) rate is assigned to this employee — paid at 1× hourly. Assign a rate in the employee\'s Leave & Attendance step.'];
            }
        }

        return ['hours' => round($hours, 2), 'amount' => $amount, 'lines' => $lines, 'exceptions' => $exceptions];
    }

    /** Approved overtime adjustment rows for the cycle (tenant-scoped). */
    private function approvedOvertimeRows(int $employeeId, PayrollPeriod $period): array
    {
        if (!Schema::hasTable('payroll_adjustments')) {
            return [];
        }
        return DB::table('payroll_adjustments')
            ->where('employee_id', $employeeId)
            // P23: same tenant scoping as approvedAdjustments().
            ->when($period->client_id, fn ($q) => $q->where('client_id', $period->client_id))
            ->when($period->branch_id, fn ($q) => $q->where(fn ($w) => $w->whereNull('branch_id')->orWhere('branch_id', $period->branch_id)))
            ->where('month', (int) $period->month)
            ->where('year', (int) $period->year)
            ->where('status', 'approved')
            ->where('type', 'overtime')
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->get(['id', 'label', 'amount', 'hours', 'rate'])
            ->all();
    }

    /** Rule 10 — sum of APPROVED bonus/incentive adjustments for the cycle. */
    private function approvedBonusAmount(int $employeeId, PayrollPeriod $period): float
    {
        return $this->approvedAdjustments($employeeId, $period, ['bonus', 'incentive']);
    }

    /** Sum of approved one-off DEDUCTION adjustments for the cycle. */
    private function approvedDeductionAdjustments(int $employeeId, PayrollPeriod $period): float
    {
        return $this->approvedAdjustments($employeeId, $period, ['deduction']);
    }

    /**
     * Approved payroll adjustments of the given types for an employee in the
     * cycle's month/year (Rule 4 / 10). Only `approved` rows count — pending /
     * rejected are ignored. Returns 0 if the table doesn't exist.
     */
    private function approvedAdjustments(int $employeeId, PayrollPeriod $period, array $types): float
    {
        if (!Schema::hasTable('payroll_adjustments')) {
            return 0;
        }
        return (float) DB::table('payroll_adjustments')
            ->where('employee_id', $employeeId)
            // P23: scope to the period's tenant so an adjustment can't bleed into
            // another client's run (or another branch's), matching by client and
            // — when the run is branch-scoped — that branch or a client-wide row.
            ->when($period->client_id, fn ($q) => $q->where('client_id', $period->client_id))
            ->when($period->branch_id, fn ($q) => $q->where(fn ($w) => $w->whereNull('branch_id')->orWhere('branch_id', $period->branch_id)))
            ->where('month', (int) $period->month)
            ->where('year', (int) $period->year)
            ->where('status', 'approved')
            ->whereIn('type', $types)
            ->whereNull('deleted_at')
            ->sum('amount');
    }

    /** Approved adjustment line items (for the payslip earnings/deductions). */
    private function adjustmentLines(int $employeeId, PayrollPeriod $period, array $types): array
    {
        if (!Schema::hasTable('payroll_adjustments')) {
            return [];
        }
        return DB::table('payroll_adjustments')
            ->where('employee_id', $employeeId)
            // P23: same tenant scoping as approvedAdjustments().
            ->when($period->client_id, fn ($q) => $q->where('client_id', $period->client_id))
            ->when($period->branch_id, fn ($q) => $q->where(fn ($w) => $w->whereNull('branch_id')->orWhere('branch_id', $period->branch_id)))
            ->where('month', (int) $period->month)
            ->where('year', (int) $period->year)
            ->where('status', 'approved')
            ->whereIn('type', $types)
            ->whereNull('deleted_at')
            ->get(['type', 'label', 'amount'])
            ->map(fn ($r) => [
                'code'   => $r->type,
                'label'  => $r->label ?: ucfirst($r->type),
                'amount' => round((float) $r->amount, 2),
            ])->all();
    }

    // ── Master name caches + small utils ───────────────────────────────────

    private function masterNameCaches(): array
    {
        $departments = [];
        $designations = [];
        foreach ([['master_departments', 'departments'], ['master_designations', 'designations']] as [$table, $key]) {
            if (Schema::hasTable($table) && Schema::hasColumn($table, 'name')) {
                ${$key} = DB::table($table)->pluck('name', 'id')->all();
            }
        }
        return ['departments' => $departments, 'designations' => $designations];
    }

    private function withException(array $list, string $type, string $reason): array
    {
        $list[] = ['type' => $type, 'reason' => $reason];
        return $list;
    }

    /** Format for prose: 10.00 → "10", 1.50 → "1.5", 1234.5 → "1,234.5". */
    private function trimNum(float $n): string
    {
        $s = number_format($n, 2);
        return str_contains($s, '.') ? rtrim(rtrim($s, '0'), '.') : $s;
    }
}
