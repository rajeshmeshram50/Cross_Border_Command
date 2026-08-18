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

    /**
     * Set by professionalTax() when the slab it used needed explaining — an
     * unconfigured work state falling back to Maharashtra, or a gross that no
     * band covers. Read once, immediately after the call, and raised onto the
     * payslip as an exception. Null when the slab resolved cleanly.
     */
    private ?string $lastPtNote = null;

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

            /* A paid run is final. The controller already refuses to reopen one,
             * but this method used to leave the run alone and STILL unlock the
             * period — clearing attendance_finalized and flipping it back to
             * open, so a settled month looked reopenable to everything that
             * reads the period rather than the run. Refuse outright instead, so
             * the guard holds no matter who calls the service. */
            if ($run && $run->status === 'paid') {
                throw new RuntimeException('Paid payroll cannot be reopened — post an adjustment in the next cycle.');
            }

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
            ->whereHas('run', fn($q) => $q->whereIn('status', ['draft', 'generated']))
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
            // Keep the advance-recovery ledger in step with the recomputed slip.
            // generate() writes it, but this correction path did not — so after
            // an attendance/leave fix changed the EMI actually recovered, the
            // ledger kept the pre-correction figure and the advance's
            // recovered/carried balance drifted from the payslip. The write is
            // keyed (advance, stream, year, month), so re-running it overwrites
            // rather than adding a row. (PAY-50)
            $this->recordRecoveryLedger($period, $employeeId, $this->lastRecoveryBreakdown);
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
            $paid = 0;
            $held = 0;
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
                    ->contains(fn($e) => ($e['type'] ?? null) === 'blocking'
                        && stripos((string) ($e['reason'] ?? ''), 'bank') === false);

                if ($bankOk && !$hasOtherBlock) {
                    $slip->status = 'Paid';
                    $slip->hold_reason = null;
                    $paid++;
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
                    'structure_gross'   => 0.0,
                    'monthly_gross_full' => 0.0,
                    'monthly_basic_full' => 0.0,
                    'proration'          => 1.0,
                    'active_days'        => 0.0,
                    'cycle_days'         => 0.0,
                    'structure_components' => [],
                    'extra_earnings'       => [],
                    'earned_gross'         => 0.0,
                    'earned_basic'         => 0.0,
                    'earned_factor'        => 0.0,
                    'lop_amount'        => 0.0,
                    'per_day_rate'      => 0.0,
                    'lop_basis'         => 'basic',
                    'lop_divisor'       => 'calendar',
                    'lop_divisor_days'  => 0.0,
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
                // Basic + allowances only — the "monthly salary" the per-day
                // rate and the component list are read against.
                'structure_gross'   => (float) ($slip['structure_gross'] ?? 0),
                // Full monthly package + the pro-ration applied to it, so the
                // F&F can show the package and the earned share as two
                // separate, reconcilable figures.
                'monthly_gross_full' => (float) ($slip['monthly_gross_full'] ?? 0),
                'monthly_basic_full' => (float) ($slip['monthly_basic_full'] ?? 0),
                'proration'          => (float) ($slip['proration'] ?? 1),
                'active_days'        => (float) ($slip['active_days'] ?? 0),
                'cycle_days'         => (float) ($slip['cycle_days'] ?? 0),
                // The package as the employee master shows it, kept separate
                // from the pro-rated `earnings` lines above.
                'structure_components' => $slip['structure_components'] ?? [],
                'extra_earnings'       => $slip['extra_earnings'] ?? [],
                'earned_gross'         => (float) ($slip['earned_gross'] ?? 0),
                'earned_basic'         => (float) ($slip['earned_basic'] ?? 0),
                'earned_factor'        => (float) ($slip['earned_factor'] ?? 0),
                'lop_amount'        => (float) ($slip['lop_amount'] ?? 0),
                // Per-day salary + the branch rule that priced it, so the F&F
                // can show HOW the LOP deduction was arrived at rather than
                // asking Finance to reverse-engineer it from the total.
                'per_day_rate'      => (float) ($slip['lop_per_day'] ?? 0),
                'lop_basis'         => (string) ($slip['lop_basis'] ?? 'basic'),
                'lop_divisor'       => (string) ($slip['lop_divisor'] ?? 'calendar'),
                'lop_divisor_days'  => (float) ($slip['lop_divisor_days'] ?? 0),
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
            // Branch carries the shift windows AND the late-mark policy, both
            // read per employee inside computeForEmployee() — eager-load to
            // keep a 400-employee run from firing 800 queries.
            // `state` joins them: it decides which Professional Tax slab the
            // employee is taxed on (Rule 9).
            ->with('branch:id,shifts,late_mark_policy,state')
            ->whereNotIn('status', ['Inactive', 'Resigned', 'Terminated'])
            // Only fully-onboarded staff belong in payroll. Half-onboarded /
            // in-progress employees (onboarding_stage_completed < 6) don't have
            // their org-side context settled yet, so they're excluded — same
            // "fully onboarded" gate the manager picker and Exit Management use.
            ->where('onboarding_stage_completed', '>=', 6)
            /* The employee record's own "Payroll" switch (Employee → Salary,
               `enable_payroll`). It was being ignored entirely: turning payroll
               OFF for someone still produced a full payslip for them. Only an
               EXPLICIT false excludes — NULL means the switch was never set
               (legacy rows, imports) and those have always been paid, so
               treating null as "off" would empty a tenant's whole run. */
            ->where(function ($w) {
                $w->whereNull('enable_payroll')->orWhere('enable_payroll', true);
            })
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
        /* NO onboarding filter, unlike eligibleEmployees(): a half-onboarded
           employee is dropped from the run by that gate, and filtering them out
           here too made them vanish from BOTH lists — the silent drop this
           panel exists to prevent (PAY-04). They are reported below with the
           stage they are stuck on. */
        $q = Employee::withTrashed();
        if ($period->client_id) $q->where('client_id', $period->client_id);
        if ($period->branch_id) $q->where('branch_id', $period->branch_id);

        $employees = $q->get();
        $ids       = $employees->pluck('id')->all();
        $exits     = $this->exitMap($ids);
        $resigns   = $this->resignationMap($ids);
        $paidLast  = $this->paidInPreviousPeriod($period, $ids);
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

            /* PAY-04 — onboarding never finished, so eligibleEmployees()' stage
               gate keeps them out of the run. Reported only when nothing
               stronger applies: an exit says more about why they are missing
               than a half-finished profile does. Soft-deleted rows are skipped
               — a disabled half-onboarded record is not a payroll omission
               anyone is waiting on, and reporting them would fill the panel
               with every abandoned draft the tenant ever created. */
            $halfOnboarded = !$e->trashed() && (int) $e->onboarding_stage_completed < 6;
            /* Payroll switched off on the employee record. Same soft-delete
               carve-out and the same "explicit false only" reading as the
               eligibility query. */
            $payrollOff = !$e->trashed() && $e->enable_payroll !== null && !$e->enable_payroll;

            /* Status says they have left, but no exit case carries a last
               working day — so neither the exit branch above nor the run
               itself accounts for them, and they simply disappear. Reported
               ONLY for someone who was paid in the PREVIOUS cycle: that is
               what makes the absence a change worth explaining. Without that
               bound, every employee who ever left would be re-listed on every
               cycle forever. */
            $statusGone = !$lwd
                && in_array((string) $e->status, ['Inactive', 'Resigned', 'Terminated'], true)
                && in_array($e->id, $paidLast, true);

            /* Removed from the Employees list (EmployeeController::destroy soft-
               deletes and disables the login) WITHOUT going through Exit
               Management, so there is no last working day and the status is
               often still "Active". None of the branches above fire, and the
               employee simply disappeared from the run — the exact silent drop
               this panel exists to prevent. Bounded by paidLast for the same
               reason statusGone is: only a person the previous cycle actually
               paid makes their absence a change worth explaining, and the bound
               keeps every long-disabled record out of every future panel. */
            $disabledNoExit = !$lwd && $e->trashed() && in_array($e->id, $paidLast, true);

            if (!$earlyExit && !$exitedInCycle && !$halfOnboarded && !$payrollOff && !$statusGone && !$disabledNoExit) {
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
                    fn($t) => $t !== null,
                );
                $tenure = $found ? min($found) : null;
            }

            /* Was the employment still inside probation when it ended? Keyed on
               the same date the exclusion is keyed on — the resignation date
               when that is what triggered it, otherwise the last working day —
               so the label always agrees with the reason beside it. */
            $probationEnd   = ProbationGuard::endDate($e);
            $endedOn        = $earlyExit ? ($resign ?: $lwd) : $lwd;
            $probationLeaver = $probationEnd && $endedOn
                && ProbationGuard::isOnProbation($e, Carbon::parse($endedOn)->startOfDay());

            $fnfAmount = null;
            if (!$earlyExit && $exitedInCycle) {
                try {
                    $fnfAmount = round(
                        (float) ($this->earnedSalaryForExitMonth($e, Carbon::parse($lwd), $resign)['amount'] ?? 0),
                        2,
                    );
                } catch (\Throwable $ex) {
                    $fnfAmount = null;
                }
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
                /* PAY-02 — left BEFORE completing probation. Reported as a
                 * qualifier on the exclusion rather than as a third reason of
                 * its own: leaving on probation changes nothing about whether
                 * payroll runs (that is decided by the exit itself, or by the
                 * 15-day early-exit rule), only about what the reviewer needs
                 * to know when they see the row. Measured against whichever
                 * date ended the employment, so an exit dated after probation
                 * ended does not get labelled as a probation leaver. */
                'on_probation'     => $probationLeaver,
                'probation_end'    => $probationEnd?->toDateString(),
                /* PAY-10 — what the F&F has to settle for this cycle.
                 *
                 * The reason text promises the money is "settled in the Full &
                 * Final settlement", but the panel had no figure, so the run
                 * could be approved with no idea whether that meant ₹2,000 or a
                 * full month's salary. Someone who leaves on the 31st is
                 * excluded from the run having worked every single day — the
                 * amount is the only thing that shows it.
                 *
                 * Computed only for a real exit in this cycle: an early exit
                 * settles nothing by definition, and the other exclusion
                 * reasons have no exit month to price. Failures are swallowed —
                 * an explanatory panel must never be what breaks a payroll
                 * screen. */
                'fnf_amount'       => $fnfAmount,
                // Early exit is the stronger statement (no payroll at all), so
                // it wins when both apply.
                'reason'           => ($earlyExit
                    ? 'Resigned within ' . ProbationGuard::EARLY_EXIT_DAYS
                    . ' days of joining' . ($tenure !== null ? " ({$tenure} day(s))" : '')
                    . ' — notice period not applicable and payroll not processed.'
                    : ($exitedInCycle
                        ? 'Left on ' . Carbon::parse($lwd)->format('j M Y')
                        . ' — excluded from this cycle; salary and dues are settled in the Full & Final settlement'
                        . ($fnfAmount !== null
                            ? ' (earned this cycle: ₹' . number_format($fnfAmount, 2) . ').'
                            : '.')
                        : ($halfOnboarded
                            ? 'Onboarding incomplete (stage ' . (int) $e->onboarding_stage_completed
                            . ' of 6) — excluded from payroll until onboarding is completed.'
                            : ($payrollOff
                                ? 'Payroll is switched off on this employee record — no payslip is generated for them.'
                                : ($disabledNoExit
                                    ? 'Employee record was removed/disabled — paid last cycle, not this one.'
                                    . ' No exit record with a last working day exists, so any dues must be'
                                    . ' settled manually or through Exit Management.'
                                    : 'Employee status is ' . $e->status . ' — paid last cycle, not this one.'
                                    . ' No exit record with a last working day exists, so any dues must be'
                                    . ' settled manually or through Exit Management.')))))
                    . ($probationLeaver
                        ? ' Left before completing probation (probation ran to '
                        . $probationEnd->format('j M Y') . ') — notice period was not applicable.'
                        : ''),
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
            ->join('employees', 'employees.id', '=', 'employee_exits.employee_id')
            ->whereIn('employee_exits.employee_id', $employeeIds)
            ->whereNotNull('employee_exits.notice_date')
            ->where(fn($q) => $q->whereNull('employees.date_of_joining')
                ->orWhereColumn('employee_exits.notice_date', '>=', 'employees.date_of_joining'))
            ->pluck('employee_exits.notice_date', 'employee_exits.employee_id')
            ->all();
    }

    /**
     * Employee ids (of the given set) that HAVE a payslip in the period
     * immediately before this one, same client + branch.
     *
     * Used to bound the "status says gone, no exit record" exclusion to a
     * genuine change: someone paid last month and missing this month is a
     * question the panel must answer, while someone who left two years ago is
     * not. Empty when the previous period was never run.
     */
    private function paidInPreviousPeriod(PayrollPeriod $period, array $employeeIds): array
    {
        if (empty($employeeIds) || !Schema::hasTable('payslips')) {
            return [];
        }
        $prev = Carbon::create((int) $period->year, (int) $period->month, 1)->subMonth();

        return DB::table('payslips')
            ->join('payroll_periods', 'payroll_periods.id', '=', 'payslips.payroll_period_id')
            ->whereIn('payslips.employee_id', $employeeIds)
            ->where('payroll_periods.month', $prev->month)
            ->where('payroll_periods.year', $prev->year)
            ->when($period->client_id, fn($q) => $q->where('payroll_periods.client_id', $period->client_id))
            ->when($period->branch_id, fn($q) => $q->where('payroll_periods.branch_id', $period->branch_id))
            ->pluck('payslips.employee_id')
            ->map(fn($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * employee_id => last_working_day, for the given ids (empty if no table).
     *
     * REHIRES (PAY-12): an exit that ended BEFORE the employee's current
     * joining date belongs to a previous stint and is ignored. Without this a
     * rehired employee kept their old exit row, so every future run dropped
     * them as "already left" — and because the exclusion panel only reports
     * exits inside or after the period, they were not even listed as skipped.
     * They simply never got paid again.
     */
    private function exitMap(array $employeeIds): array
    {
        if (empty($employeeIds) || !Schema::hasTable('employee_exits')) {
            return [];
        }
        return DB::table('employee_exits')
            ->join('employees', 'employees.id', '=', 'employee_exits.employee_id')
            ->whereIn('employee_exits.employee_id', $employeeIds)
            ->whereNotNull('employee_exits.last_working_day')
            ->where(fn($q) => $q->whereNull('employees.date_of_joining')
                ->orWhereColumn('employee_exits.last_working_day', '>=', 'employees.date_of_joining'))
            ->pluck('employee_exits.last_working_day', 'employee_exits.employee_id')
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
                    $employees = $employees->reject(fn($e) => in_array($e->id, $covered, true))->values();
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

        /* PAY-01 — probation does NOT withhold salary. A probationer is paid on
         * the same rules as a confirmed employee (joining proration, LOP, late
         * marks); the only tenure-based carve-out in payroll is the early exit
         * (≤ ProbationGuard::EARLY_EXIT_DAYS, handled in eligibleEmployees()).
         *
         * Stated on the slip as an info line rather than left implicit: the
         * scenario's failure mode is a probationer being silently mishandled,
         * and "paid, and here is the probation status that was considered" is
         * the only way a reviewer can tell the rule was applied on purpose.
         * Evaluated at PERIOD END, so an employee who completes probation
         * mid-cycle (PAY-03) reads as completed rather than still serving. */
        $probationEnd = ProbationGuard::endDate($employee);
        if ($probationEnd) {
            $periodStart = Carbon::parse($period->period_start)->startOfDay();
            $periodEnd   = Carbon::parse($period->period_end)->startOfDay();
            if (ProbationGuard::isOnProbation($employee, $periodEnd)) {
                $exceptions = $this->withException(
                    $exceptions,
                    'info',
                    'On probation until ' . $probationEnd->format('j M Y')
                        . ' — paid in full for this cycle; probation does not withhold salary.'
                );
            } elseif ($probationEnd->gte($periodStart)) {
                $exceptions = $this->withException(
                    $exceptions,
                    'info',
                    'Probation completed on ' . $probationEnd->format('j M Y')
                        . ' (inside this cycle) — paid in full for the whole cycle.'
                );
            }
        }

        $deptName = $nameCache['departments'][$employee->department_id] ?? null;
        $desigName = $nameCache['designations'][$employee->designation_id] ?? null;

        $base = [
            'employee_code' => $employee->emp_code,
            'employee_name' => trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')) ?: $employee->display_name,
            'department'    => $deptName,
            'designation'   => $desigName,
            // Snapshotted, not joined at read time (Rule 17): a later promotion
            // from Contract to Full-time must not change which rows an old
            // export returns.
            'employee_type' => $employee->employee_type,
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

        /* ── Rule 6 — join / exit pro-ration ────────────────────────────────
         * Resolved BEFORE the salary structure (Rule 5) because a mid-cycle
         * revision is blended across this window — the structure that applies
         * is a function of the days actually worked, so the window has to
         * exist first. */
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
            $exceptions = $this->withException(
                $exceptions,
                'warning',
                'Mid-cycle join/exit — salary pro-rated to ' . round($proration * 100) . '% of the month.'
            );
        }

        // ── Rule 5 — active salary structure is mandatory ──────────────────
        $structure = $this->activeStructure($employee, $winEnd);
        [$gross, $basic, $earnComponents, $structDeductions, $pfApplicable, $esiApplicable, $ptApplicable] =
            $this->resolveCompensation($employee, $structure, $exceptions);

        /* Rule 19 (PAY-27) — a revision dated INSIDE the cycle is blended, not
         * applied to the whole month. resolveCompensation() above returns the
         * version in force at the END of the window, which on its own paid a
         * 15-Aug revision from the 1st. blendCompensation() replaces the money
         * with a day-weighted average of every version that was in force
         * during the window; the flags (PF / ESI / PT applicability) stay with
         * the latest version, since those are properties of the employee's
         * current terms rather than amounts to average. */
        [$gross, $basic, $earnComponents, $exceptions] = $this->blendCompensation(
            $employee,
            $winStart,
            $winEnd,
            $gross,
            $basic,
            $earnComponents,
            $exceptions,
        );

        if ($gross <= 0) {
            /* Rule 26 — nothing payable, so the employee is held rather than
             * paid ₹0. The reason has to say WHICH of these it is: all four
             * used to read "No active salary structure or salary on file",
             * which sends HR hunting for a structure that in three of the four
             * cases already exists — it is merely a draft, future-dated, or
             * priced at zero. Naming the actual cause turns a support ticket
             * into a two-minute fix. */
            $anyStructure = SalaryStructure::where('employee_id', $employee->id)
                ->orderByDesc('effective_from')->orderByDesc('version')
                ->first(['status', 'effective_from', 'monthly_gross']);

            [$holdReason, $detail] = match (true) {
                $anyStructure === null => [
                    'Missing salary structure',
                    'No salary structure and no annual salary on file — nothing to pay.',
                ],
                (float) $anyStructure->monthly_gross <= 0 => [
                    'Salary structure has no value',
                    'The salary structure on file has a monthly gross of ₹0 — set the amounts before running payroll.',
                ],
                Carbon::parse($anyStructure->effective_from)->gt($winEnd) => [
                    'Salary structure not yet effective',
                    'The salary structure starts on ' . Carbon::parse($anyStructure->effective_from)->format('d M Y')
                        . ', after this cycle ends — no version is in force for ' . $period->label . '.',
                ],
                strtolower((string) $anyStructure->status) === 'draft' => [
                    'Salary structure is still a draft',
                    'The salary structure is saved as a draft — publish it (Active) so payroll can use it.',
                ],
                default => [
                    'Missing salary structure',
                    'No active salary structure or salary on file — employee skipped.',
                ],
            };

            $base['exceptions'] = $this->withException($exceptions, 'blocking', $detail);
            $base['status']      = 'On Hold';
            $base['hold_reason'] = $holdReason;
            return $base;
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
        /* COUNTED over the active window, not the month's figure scaled by the
         * calendar-day proration.
         *
         * Scaling produced a fraction (26 × 30/31 = 25.16) while an employee
         * can only ever be present on whole days — so a 2-Aug joiner who
         * attended all 25 of their working days was charged 0.16 of a day's
         * loss of pay for an absence that never happened. Counting the window
         * gives a whole number that attendance can actually reach.
         *
         * The MONEY is untouched: gross is still pro-rated on calendar days
         * ($proration above). Only the day denominator that LOP is measured
         * against changes. */
        $effectiveWorkingDays = $proration < 1
            ? $this->employeeWorkingDays($employee, $winStart->copy(), $winEnd->copy())
            : $empWorkingDays;

        // ── Rules 2 & 3 — attendance + leave ───────────────────────────────
        // Short-hours policy comes from the employee's own branch; an employee
        // with no branch gets the disabled defaults, so nothing is demoted.
        $shortBranch = $employee->relationLoaded('branch') ? $employee->getRelation('branch') : $employee->branch;
        $shortPolicy = $shortBranch
            ? $shortBranch->shortHoursPolicy()
            : \App\Models\Branch::normalizeShortHoursPolicy(null);

        $att = $this->attendanceAggregates(
            $employee->id,
            $winStart,
            $winEnd,
            $employee->resolveShiftWindow()[0],
            $shortPolicy
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
            $exceptions = $this->withException(
                $exceptions,
                'warning',
                "{$missingPunch} day(s) with a missing punch — verify attendance before approving."
            );
        }

        /* PAY-17 — days the short-hours policy demoted. Named individually with
         * the hours actually worked, because this is pay coming off the back of
         * a threshold the employee cannot see on their own clock-in screen; HR
         * has to be able to check the claim day by day before approving. */
        $shortDays = $att['short_days'] ?? [];
        if ($shortDays) {
            $detail = implode(', ', array_map(
                fn($d) => Carbon::parse($d['date'])->format('d M')
                    . ' (' . ($d['hours'] !== null ? $this->trimNum((float) $d['hours']) . 'h' : 'unmeasured')
                    . ' → ' . $this->trimNum((float) $d['credit']) . ' day)',
                array_slice($shortDays, 0, 8),
            ));
            $more = count($shortDays) > 8 ? ' +' . (count($shortDays) - 8) . ' more' : '';
            $exceptions = $this->withException(
                $exceptions,
                'warning',
                count($shortDays) . " day(s) short of this branch's "
                    . $this->trimNum((float) $shortPolicy['half_day_below']) . "h minimum: {$detail}{$more}."
            );
        }

        /* Paid days, reconciled DATE BY DATE (PAY-13 / PAY-14).
         *
         * This used to be three independent running totals added together and
         * capped: min(workingDays, present + paidLeave + holidays). The cap
         * kept the ceiling honest, but the arithmetic was blind to WHICH dates
         * each total came from, and that silently mispaid two shapes:
         *
         *   · A paid leave filed on dates the employee was ALREADY marked
         *     present freed up head-room that then backfilled unrelated days
         *     they never turned up for. 23 present + 3 unexplained absences +
         *     a 3-day paid leave over the present ones = 26 paid, 0 LOP, a
         *     full month's salary, and nothing on the slip.
         *   · An approved UNPAID leave on dates attendance also marked present
         *     deducted nothing at all: LOP is whatever is left of the working
         *     days, those days were already filled by the present credit, and
         *     so unpaid_leave_days was a label with no money behind it.
         *
         * Both disappear once each date is settled on its own:
         *
         *     payable(d) = min(1 - unpaidLeave(d), present(d) + paidLeave(d) + holiday(d))
         *
         * An approved unpaid leave now RESERVES its share of the day and
         * nothing can pay it back — a present punch on an LWP day no longer
         * cancels the deduction. Conversely a paid leave can only ever pay for
         * its own dates, so it can never mask an absence somewhere else.
         *
         * Half days survive intact: 0.5 present + 0.5 paid leave = 1 payable;
         * 0.5 present + 0.5 unpaid = min(0.5, 0.5) = 0.5 payable, 0.5 LOP.
         *
         * Only the employee's OWN working dates are walked. Attendance on a
         * weekly off is deliberately not payable here — those days are not in
         * the working-day denominator the money is built from, so crediting
         * them would let a Sunday shift cancel a Monday absence. Hours worked
         * on an off-day are paid through overtime, not by offsetting LOP. */
        $holidaySet   = $this->holidayDateSet($employee, $winStart, $winEnd);
        $workedDates  = $att['worked_dates'] ?? [];
        $paidDates    = $leave['paid_dates'] ?? [];
        $unpaidDates  = $leave['unpaid_dates'] ?? [];
        $weeklyOffLbl = (string) ($employee->weekly_off ?? '');

        $paidDays    = 0.0;
        $overlapDays = 0.0;
        /* Work credit earned on the employee's OWN working dates. This is what
         * "did this person actually attend?" means — distinct from $presentDays,
         * which also counts punches on weekly offs. Used by the zero-attendance
         * check further down. */
        $workedOnWorkingDays = 0.0;
        for ($d = $winStart->copy(); $d->lte($winEnd); $d->addDay()) {
            if (\App\Support\WeekOff::isOff($weeklyOffLbl, $d)) {
                continue;
            }
            $ds       = $d->toDateString();
            $worked   = (float) ($workedDates[$ds] ?? 0);
            $workedOnWorkingDays += $worked;
            $paidLv   = (float) ($paidDates[$ds] ?? 0);
            $unpaidLv = (float) ($unpaidDates[$ds] ?? 0);
            $holiday  = isset($holidaySet[$ds]) ? 1.0 : 0.0;

            $credited = $worked + $paidLv + $holiday;
            $paidDays += max(0.0, min(1.0 - $unpaidLv, $credited));

            // Two sources claiming the same day is a data-quality problem even
            // now that the money is right — HR should still be told that the
            // punch and the leave request disagree.
            if ($credited + $unpaidLv > 1.001) {
                $overlapDays += $credited + $unpaidLv - 1;
            }
        }
        $paidDays    = round(min($effectiveWorkingDays, $paidDays), 2);
        $overlapDays = round($overlapDays, 2);
        if ($overlapDays > 0) {
            $exceptions = $this->withException(
                $exceptions,
                'warning',
                "{$overlapDays} day(s) where attendance and an approved leave request cover the same date. "
                    . "The leave request has been taken as the truth for pay — verify the punches before approving."
            );
        }

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
            $exceptions = $this->withException(
                $exceptions,
                'info',
                "{$holidayDays} holiday day(s) in this period credited as paid."
            );
        }
        // Everything else in the active window is loss-of-pay.
        $lopDays = max(0, round($effectiveWorkingDays - $paidDays, 2));
        // Off-days sandwiched inside an UNPAID leave are unpaid too. They sit
        // outside the working-day denominator, so they are added rather than
        // subtracted — there is nothing in that denominator to take them from.
        $sandwichLop = (float) ($leave['sandwich_lop'] ?? 0);
        if ($sandwichLop > 0) {
            $lopDays = round($lopDays + $sandwichLop, 2);
            $exceptions = $this->withException(
                $exceptions,
                'info',
                "{$sandwichLop} off-day(s) sandwiched inside unpaid leave charged as loss of pay."
            );
        }

        /* Rule 2 (BR-01) — LOP for late marks, per the EMPLOYEE'S BRANCH policy
         * (Branch → Attendance Policy: "every N late marks = half / full day").
         * LOP accrues once per completed block: with the default 3 / half day,
         * 3→0.5, 6→1, 9→1.5; fewer than N late marks never deducts.
         *
         * A branch that was never configured falls back to that legacy 3 → half
         * day rule inside Branch::lateMarkPolicy(), so old runs stay reproducible.
         * Flagged for HR review rather than silently docked — late sitting may
         * have covered the hours, and HR can hold/waive on review. */
        $lateBranch  = $employee->relationLoaded('branch') ? $employee->getRelation('branch') : $employee->branch;
        // An employee with no branch (or a soft-deleted one) still has to be
        // paid — normalize(null) hands back the legacy 3 → half day defaults.
        $latePolicy  = $lateBranch
            ? $lateBranch->lateMarkPolicy()
            : \App\Models\Branch::normalizeLateMarkPolicy(null);
        $lateLopDays = \App\Models\Branch::lateMarkLopFor($latePolicy, (int) $lateMarks);
        $lateUnit    = $latePolicy['deduction'] === 'full_day' ? 'full day' : 'half day';
        if ($lateLopDays > 0) {
            $lopDays += $lateLopDays;
            // Spelled out in words HR can check against the branch setting.
            // Pluralised because "every 1 late marks = full day" read like a bug
            // report of its own on the review screen.
            $lateBlock = $latePolicy['count'] === 1 ? 'late mark' : 'late marks';
            $lateDays  = $this->trimNum($lateLopDays);
            $exceptions = $this->withException(
                $exceptions,
                'warning',
                "{$lateMarks} late marks → {$lateDays} day" . ($lateLopDays == 1 ? '' : 's') . " LOP "
                    . "(branch rule: every {$latePolicy['count']} {$lateBlock} = {$lateUnit}; "
                    . "verify hours covered before approving)."
            );
        } elseif ($lateMarks > 0) {
            /* Late but nothing deducted — say why, as INFO so it never holds the
             * run. Without this the row reads clean: a branch with deduction
             * switched off produced no message at all, and a branch that does
             * deduct produced none for someone sitting just under the threshold.
             * Both cases had HR looking at a non-zero Late Marks column with no
             * explanation of why the pay was untouched. */
            $exceptions = $this->withException($exceptions, 'info', $latePolicy['enabled']
                ? "{$lateMarks} late mark(s) — under this branch's threshold of {$latePolicy['count']}, no pay deducted."
                : "{$lateMarks} late mark(s) — this branch does not deduct pay for late marks.");
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
            $exceptions = $this->withException(
                $exceptions,
                'warning',
                "{$notCharged} unpaid-leave day(s) not charged as LOP — the employee is also marked present/paid-leave on those dates. Verify attendance before approving."
            );
        }

        // ── Money ──────────────────────────────────────────────────────────
        $proratedGross = round($gross * $proration, 2);
        $proratedBasic = round($basic * $proration, 2);

        $totalMonthDays = max(1, $calDays);

        /* Rule 3 (PAY-15) — what one absent day costs, per the EMPLOYEE'S
         * BRANCH policy (Branch → LOP Policy):
         *
         *     per-day = (basic | gross) ÷ (calendar days | working days)
         *
         * A branch that was never configured falls back to the legacy rule
         * inside Branch::lopPolicy() — BASIC ÷ CALENDAR DAYS — so historic runs
         * stay reproducible and nothing moves until an admin changes it.
         *
         * Dividing by calendar days rather than working days means one LOP day
         * costs the same no matter how many Sundays the month happens to have.
         * Charging on basic rather than gross means allowances (HRA / special)
         * are not clawed back for an absence — which is why an employee absent
         * for a whole month still receives the allowance half of their salary.
         * Both are now deliberate settings rather than buried constants.
         *
         * The deduction is capped at the pro-rated BASIC either way, so it can
         * never exceed the basic actually payable this cycle. */
        $lopBranch = $employee->relationLoaded('branch') ? $employee->getRelation('branch') : $employee->branch;
        $lopPolicy = $lopBranch
            ? $lopBranch->lopPolicy()
            : \App\Models\Branch::normalizeLopPolicy(null);
        $lopPerDay = \App\Models\Branch::lopPerDayFor(
            $lopPolicy,
            $basic,
            $gross,
            $totalMonthDays,
            (float) $effectiveWorkingDays,
        );
        $lopAmount = round($lopPerDay * $lopDays, 2);
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
             (BASIC ÷ working days ÷ shift hours) × OT multiplier × hours.
           Basic, not gross: allowances pay for costs that don't scale with an
           extra hour worked, so pricing OT off the gross paid every allowance
           a second time for each OT hour. Computed off the FULL monthly basic
           + the period's working days, so the hourly rate doesn't move with a
           mid-month join or with absence.

           Overtime is NO LONGER approval-gated: hours the attendance shows past
           the shift end are paid directly. An explicitly recorded adjustment
           still WINS when one exists, so HR can override the detected figure
           (a negotiated number, or OT that never made it onto a punch); the
           detected hours are the fallback when they haven't. */
        $ot = $this->overtimeForCycle($employee, $period, $basic, (float) $period->working_days);
        foreach ($ot['exceptions'] as $otEx) {
            $exceptions = $this->withException($exceptions, $otEx['type'], $otEx['reason']);
        }

        $otDetected = $this->overtimeHoursFromAttendance($employee, $winStart, $winEnd);

        if ($ot['hours'] <= 0 && $ot['amount'] <= 0 && $otDetected['hours'] > 0) {
            $rate   = $this->overtimeRate($employee, $basic, (float) $period->working_days);
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
            /* Spell the arithmetic out so the figure is checkable by hand.
               Rest days (weekly off / holiday) count every worked hour, not
               just the hours past the shift end, so the wording has to say
               which basis produced the number — "12 hr past the 18:30 shift
               end" for a Sunday worked 09:30–21:30 reads as a bug otherwise. */
            $restDayCount = count(array_filter($otDetected['detail'] ?? [], fn($d) => !empty($d['rest_day'])));
            $exceptions = $this->withException($exceptions, 'info', sprintf(
                'Overtime: %s hr %s across %d day(s) × ₹%s/hr (%s%s) = ₹%s — paid from attendance.',
                $this->trimNum($hours),
                $restDayCount === $otDetected['days']
                    ? 'worked on weekly offs / holidays (every hour counts)'
                    : ($restDayCount > 0
                        ? sprintf(
                            'past the %s shift end, plus %d rest day(s) counted in full',
                            $otDetected['shift_end'],
                            $restDayCount
                        )
                        : 'past the ' . $otDetected['shift_end'] . ' shift end'),
                $otDetected['days'],
                number_format($rate['effective_rate'], 2),
                $this->trimNum($rate['multiplier']),
                $rate['rate_found'] ? ' ' . $rate['rate_name'] : '× (no active OT rate — 1× hourly)',
                number_format($amount, 2),
            ));

            /* PAY-21 — the employee is assigned an OT rate that no longer
             * resolves against the Overtime Rate master (renamed, deactivated,
             * deleted, or scoped to another tenant). The multiplier silently
             * falls back to 1×, which on a "Double Time" employee is half the
             * overtime they were promised — and the line above said so only as
             * `info`, leaving the slip Ready. Somebody deactivating one master
             * row could quietly halve overtime for everyone on it with nothing
             * on the run to show for it. Warned, so the slip goes to Pending
             * Review and HR fixes the master or the employee record. */
            if (!$rate['rate_found'] && $rate['rate_name'] !== null) {
                $exceptions = $this->withException($exceptions, 'warning', sprintf(
                    'Overtime rate "%s" is not an active rate in the Overtime Rate master — '
                        . 'overtime paid at 1× hourly instead. Fix the rate or the employee\'s '
                        . 'overtime setting before approving.',
                    $rate['rate_name'],
                ));
            }
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

        /* Overtime is priced off basic, so a structure that carries a gross but
         * no basic component prices every OT hour at ₹0. Silently paying
         * nothing for hours the attendance clearly shows is the worst outcome —
         * flag it as blocking so the structure is fixed before the run is paid,
         * rather than after someone notices a missing allowance. */
        if (($ot['hours'] > 0 || $otDetected['hours'] > 0) && $basic <= 0 && $gross > 0) {
            $exceptions = $this->withException(
                $exceptions,
                'blocking',
                'Overtime hours recorded but this employee has no Basic component — overtime is priced off basic, so it computes to ₹0. Fix the salary structure before paying.'
            );
        }

        if ($otDetected['capped_days'] > 0) {
            $exceptions = $this->withException($exceptions, 'warning', sprintf(
                '%d day(s) show more than 12 hr past the shift end — likely a missed punch-out. Verify the attendance; the overtime is capped at 12 hr for those days.',
                $otDetected['capped_days'],
            ));
        }

        /* Approved overtime / bonus / incentive show as separate earning lines.
           Also kept in $extraEarnings on their own: they are NOT part of the
           monthly salary structure, so a consumer showing the package (the F&F
           breakdown) has to be able to tell the two apart — pro-rating or
           per-day maths applied to an OT line would be nonsense. */
        $extraEarnings = [];
        foreach ($ot['lines'] as $line) {
            $earnings[] = $line;
            $extraEarnings[] = $line;
        }
        foreach ($this->adjustmentLines($employee->id, $period, ['bonus', 'incentive']) as $line) {
            $earnings[] = $line;
            $extraEarnings[] = $line;
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
            // PF was charged on an assumption, not a recorded employment type.
            // Info rather than warning: it is the correct default and holding
            // every half-filled record for review would drown the run.
            if ($this->employmentTypeUnknown($employee)) {
                $exceptions = $this->withException(
                    $exceptions,
                    'info',
                    'No employment type on file — PF charged on the assumption this employee is full-time. '
                        . 'Set Employment Type on the employee record to confirm.'
                );
            }
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
        // statutory slab for the employee's WORK STATE (Rule 9).
        $ptManual = $this->structureDeduction($structDeductions, 'pt');
        $pt = 0;
        if ($ptManual > 0) {
            $pt = round($ptManual * $earnedFactor, 2);
        } elseif ($ptApplicable && $earnedGross > 0) {
            $pt = $this->professionalTax($employee, $earnedGross, $period->month);
            // A fallback or an uncovered gross is a configuration gap HR needs
            // to see. Warning, not blocking: the run must not stop because one
            // state master is missing, but the slip should not read clean.
            if ($this->lastPtNote !== null) {
                $exceptions = $this->withException($exceptions, 'warning', $this->lastPtNote);
            }
        }

        /* TDS — a MANUAL 'tds' line on the structure always wins: accounts may
         * have worked the figure out from declarations and proofs this module
         * never sees. Only when there is no manual line, and the structure opts
         * in via tds_applicable, does the slab engine compute one. */
        $tds = 0;
        if ($earnedGross > 0) {
            $tds = $this->structureDeduction($structDeductions, 'tds');
            if ($tds <= 0 && $structure && $structure->tds_applicable) {
                $tds = $this->tdsForCycle($employee, $structure, $period, $earnedGross);
                if ($tds > 0) {
                    $exceptions = $this->withException($exceptions, 'info', $this->lastTdsNote
                        ?? 'Income tax computed on the new regime and spread over the remaining months of the financial year.');
                }
            }
        }

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
        // Total recovered across every stream, then split by kind for reporting.
        // The FOI cap, the oldest-first allocation and the arrears carry all
        // operate on the COMBINED figure — a loan and an advance compete for the
        // same 70% headroom, because they come out of the same net pay.
        $totalRec   = $this->advanceRecovery($employee->id, $period, $foiCap);
        $loanRec    = $this->recoveredOfKind('loan');
        $advanceRec = round($totalRec - $loanRec, 2);
        $carried = round(array_sum(array_column($this->lastRecoveryBreakdown, 'carried')), 2);
        if ($carried > 0.01) {
            $exceptions = $this->withException(
                $exceptions,
                'warning',
                'Advance recovery exceeded the 70% FOI headroom this cycle — ₹'
                    . number_format($carried, 2) . ' carried to the next cycle.'
            );
        }

        // Overtime + bonus/incentive (Rule 10). Overtime was priced above:
        // a recorded adjustment when one exists, otherwise the hours the
        // attendance shows past the shift end. Bonus still counts only
        // APPROVED adjustments.
        $overtimeAmount = $ot['amount'];
        $overtimeHours  = $ot['hours'];
        $bonusAmount    = $this->approvedBonusAmount($employee->id, $period);

        $totalDeductions = round($pf + $esi + $pt + $tds + $lopAmount + $advanceRec + $loanRec + $other, 2);
        // Net = earned pay + approved OT/bonus − non-LOP deductions (LOP is
        // already embodied in earnedGross < proratedGross).
        $netPay = round($earnedGross + $overtimeAmount + $bonusAmount - ($pf + $esi + $pt + $tds + $advanceRec + $loanRec + $other), 2);
        if ($netPay < 0) {
            // Fixed deductions exceeded earned pay — floor to zero and flag so
            // HR can carry the shortfall to the next cycle.
            $exceptions = $this->withException(
                $exceptions,
                'warning',
                'Deductions exceeded earned pay — net floored to ₹0; carry the balance to the next cycle.'
            );
            $netPay = 0;
        }
        // A zero net on a paid structure means the employee was effectively
        // fully absent / on LOP this cycle — never let that pass silently as
        // "Ready"; flag it so HR verifies before disbursing.
        /* PAY-20 — not one attendance row in the whole active window, on an
         * employee the run still pays. Almost always a data problem (device
         * not syncing, employee never enrolled, import missed) rather than
         * someone who genuinely never showed up, and the zero-net check below
         * never catches it: LOP is capped at the pro-rated BASIC, so a full
         * month of absence still leaves every allowance payable and the slip
         * reads "Ready" with a large net. Flagged as a warning rather than a
         * hold, because tenants that do not track attendance at all would
         * otherwise have their entire run blocked. */
        /* The test is "did this employee earn ANY work credit on a day they were
         * due to work, while still losing pay?" — not "does the attendance
         * table have zero rows for them".
         *
         * Keying off the row count let a single meaningless row switch the
         * warning off while the employee stayed fully docked. All three of
         * these silently read "Ready" with a five-figure deduction and nothing
         * on the slip:
         *   · one row whose status is 'Absent' — the marker a missed import
         *     often leaves behind;
         *   · punches on weekly offs only, which are not payable and so paid
         *     for nothing, yet counted as "rows exist";
         *   · a public holiday inside the cycle, which credited paid days above
         *     zero and defeated the old $paidDays <= 0 half of the test.
         *
         * Work credit on the employee's own working dates answers the question
         * directly, and $lopDays > 0 keeps a legitimately fully-covered month
         * (all approved paid leave) from being flagged as a data problem. */
        if ($workedOnWorkingDays <= 0 && $effectiveWorkingDays > 0 && $lopDays > 0) {
            // An approved unpaid leave covering the cycle explains the absence,
            // so don't send HR hunting for a broken device sync in that case.
            $explained = $unpaidLeaveDays > 0
                && $unpaidLeaveDays + 0.005 >= $effectiveWorkingDays;
            $exceptions = $this->withException(
                $exceptions,
                'warning',
                'No attendance recorded at all this cycle — ' . $this->trimNum($lopDays)
                    . ' day(s) charged as loss of pay.'
                    . ($explained
                        ? ' Covered by approved unpaid leave; confirm that is correct before approving.'
                        : ' Verify the attendance data before approving;'
                        . ' a missing device sync looks exactly like this.')
            );
        }
        if ($netPay <= 0 && $proratedGross > 0) {
            $exceptions = $this->withException(
                $exceptions,
                'warning',
                'Zero net pay — employee was fully absent / on loss-of-pay this cycle. Verify before processing.'
            );
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
        if ($advanceRec > 0 || $loanRec > 0) {
            $advLines = array_values(array_filter(
                $this->lastRecoveryBreakdown,
                fn($b) => ($b['recovered'] ?? 0) > 0
            ));
            if (!empty($advLines)) {
                foreach ($advLines as $b) {
                    // Loan rows carry code 'loan' so the PDF and the deduction
                    // totals can tell the two apart without re-parsing labels.
                    $isLoan = ($b['kind'] ?? 'advance') === 'loan';
                    $deductions[] = [
                        'code'       => $isLoan ? 'loan' : 'advance',
                        'label'      => $b['label'] ?? ($isLoan ? 'Loan Recovery' : 'Advance Recovery'),
                        'amount'     => round((float) $b['recovered'], 2),
                        'advance_no' => $b['advance_no'] ?? null,
                    ];
                }
            } else {
                if ($advanceRec > 0) {
                    $deductions[] = ['code' => 'advance', 'label' => 'Advance Recovery', 'amount' => $advanceRec];
                }
                if ($loanRec > 0) {
                    $deductions[] = ['code' => 'loan', 'label' => 'Loan Recovery', 'amount' => $loanRec];
                }
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
            $exceptions = $this->withException(
                $exceptions,
                'blocking',
                'Bank details missing/invalid — payment blocked until corrected.'
            );
        }

        // ── Status + attendance source ─────────────────────────────────────
        $hasBlocking = collect($exceptions)->contains(fn($e) => $e['type'] === 'blocking');
        $hasWarning  = collect($exceptions)->contains(fn($e) => $e['type'] === 'warning');
        $status = $hasBlocking ? 'On Hold' : ($hasWarning ? 'Pending Review' : 'Ready');

        $attSource = $att['rows'] > 0
            ? ($hasWarning && ($missingPunch > 0 || $lateLopDays > 0) ? 'Review' : 'Biometric')
            : 'Manual';

        return array_merge($base, [
            /* PAY-06 — the payable working days of the ACTIVE window, not of
               the whole month. $base seeds this with the full-month figure
               because it is also the value returned on the early-exit paths
               above, where no window has been resolved yet; here the window IS
               known, so the prorated figure replaces it.
               Without this a 5-Aug joiner's slip read "Total Days 26, Paid 0,
               LOP 22.65" — three numbers that cannot be reconciled by anyone
               reading the payslip, because 26 covers the whole month while the
               other two cover only the part they were employed for. */
            'working_days'   => $effectiveWorkingDays,
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
            'structure_gross' => $proratedGross,
            /* The FULL monthly package, before the mid-cycle join/exit
               pro-ration is applied. The component lines in `earnings` are
               already pro-rated, so their sum is what was earned for the
               window — not what the employee is paid for a whole month, and
               not the figure lop_per_day is priced off (that uses the full
               monthly basic). Both have to be visible or the two disagree on
               screen with nothing to reconcile them. */
            'monthly_gross_full' => round($gross, 2),
            'monthly_basic_full' => round($basic, 2),
            'proration'          => round($proration, 4),
            'active_days'        => (float) $activeDays,
            'cycle_days'         => (float) $calDays,
            /* The monthly component list EXACTLY as the employee master and
               the onboarding Compensation step show it (Basic / HRA / Special
               / any custom head), before pro-ration. `earnings` above carries
               the pro-rated copies plus OT and bonus lines, so it cannot stand
               in for the package — the F&F breakdown was showing pro-rated
               figures under the same labels the master shows full ones, and
               the two read as a contradiction. */
            'structure_components' => array_values(array_map(fn ($c) => [
                'code'   => $c['code'] ?? 'comp',
                'label'  => $c['label'] ?? 'Component',
                'amount' => round((float) ($c['amount'] ?? 0), 2),
            ], $earnComponents)),
            'extra_earnings' => $extraEarnings,
            /* What the statutory heads are actually charged on. PF is 12% of
               the EARNED basic and PT / ESI are scaled by the earned share, so
               they land well below the monthly figures on the employee master
               whenever a cycle carries loss of pay — which reads as a bug
               without these numbers to explain it. */
            'earned_gross'  => $earnedGross,
            'earned_basic'  => $earnedBasic,
            'earned_factor' => round($earnedFactor, 4),
            'lop_per_day'      => $lopPerDay,
            'lop_basis'        => $lopPolicy['basis'],
            'lop_divisor'      => $lopPolicy['divisor'],
            'lop_divisor_days' => $lopPolicy['divisor'] === 'working'
                ? (float) max(1, $effectiveWorkingDays)
                : (float) max(1, $totalMonthDays),
            'basic'          => $proratedBasic,
            'overtime_amount' => $overtimeAmount,
            'bonus_amount'   => $bonusAmount,
            'pf_employee'    => $pf,
            'esi'            => $esi,
            'pt'             => $pt,
            'tds'            => $tds,
            'lop_amount'     => $lopAmount,
            'advance_recovery' => $advanceRec,
            // Rule 11 — a real figure now: Loan-type requests recovered this
            // cycle. Still 0 for every tenant that raises no Loan advances.
            'loan_recovery'  => $loanRec,
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
    /**
     * Rule 19 / PAY-27 — day-weight every salary structure version that was in
     * force during the active window.
     *
     * A revision effective 15-Aug used to pay the NEW rate for the whole of
     * August, because only the latest version in force at the period end was
     * read. Here the window is cut at each version's effective date and the
     * amounts are averaged by the days each one covered: 14 days at ₹40,000 +
     * 17 days at ₹50,000 in a 31-day month gives a blended monthly rate that,
     * once the caller applies the usual pro-ration, pays exactly
     * 40,000×14/31 + 50,000×17/31.
     *
     * Returns the same [gross, basic, earnings, exceptions] shape it is given,
     * unchanged when only one version applies — the overwhelmingly common case,
     * which costs one extra query and no arithmetic.
     *
     * @param  array  $earnings  Component lines of the LAST version in force —
     *                           their labels/codes are kept, only the amounts
     *                           are re-weighted.
     */
    private function blendCompensation(
        Employee $employee,
        Carbon $winStart,
        Carbon $winEnd,
        float $gross,
        float $basic,
        array $earnings,
        array $exceptions,
    ): array {
        $versions = SalaryStructure::where('employee_id', $employee->id)
            ->whereIn('status', ['active', 'superseded'])
            ->whereDate('effective_from', '<=', $winEnd)
            ->orderBy('effective_from')
            ->orderBy('version')
            ->get();

        // Versions whose effective date falls INSIDE the window are the only
        // ones that can split it; anything earlier is simply "in force at the
        // start". No split → nothing to blend.
        $cuts = $versions->filter(fn($s) => Carbon::parse($s->effective_from)->gt($winStart));
        if ($versions->count() < 2 || $cuts->isEmpty()) {
            return [$gross, $basic, $earnings, $exceptions];
        }

        $totalDays = max(1, $winStart->diffInDays($winEnd) + 1);
        $inForceAt = function (Carbon $day) use ($versions) {
            $found = null;
            foreach ($versions as $s) {
                if (Carbon::parse($s->effective_from)->lte($day)) $found = $s;
            }
            return $found;
        };

        // Segment boundaries: the window start, then each cut date.
        $bounds = collect([$winStart->copy()])
            ->concat($cuts->map(fn($s) => Carbon::parse($s->effective_from)->startOfDay()))
            ->unique(fn(Carbon $d) => $d->toDateString())
            ->sort(fn(Carbon $a, Carbon $b) => $a <=> $b)
            ->values();

        $wGross = 0.0;
        $wBasic = 0.0;
        $wComponents = [];
        $segments = [];
        foreach ($bounds as $i => $from) {
            $to   = isset($bounds[$i + 1]) ? $bounds[$i + 1]->copy()->subDay() : $winEnd->copy();
            $days = max(0, $from->diffInDays($to) + 1);
            if ($days <= 0) continue;

            $s = $inForceAt($from);
            // No version in force yet at the window start (a revision dated
            // after joining, with nothing before it): those days carry the
            // FIRST version rather than nothing, so the employee is not
            // silently unpaid for them.
            $s = $s ?: $versions->first();

            $share  = $days / $totalDays;
            $sGross = (float) $s->monthly_gross;
            $wGross += $sGross * $share;
            $wBasic += (float) $s->basicAmount() * $share;
            foreach ((array) $s->earnings as $c) {
                $code = $c['code'] ?? 'comp';
                $wComponents[$code] ??= ['code' => $code, 'label' => $c['label'] ?? 'Component', 'amount' => 0.0];
                $wComponents[$code]['amount'] += ((float) ($c['amount'] ?? 0)) * $share;
            }
            $segments[] = $from->format('j M') . '–' . $to->format('j M') . ' at ₹'
                . number_format($sGross, 2) . '/month (' . $days . ' day(s))';
        }

        foreach ($wComponents as &$c) {
            $c['amount'] = round($c['amount'], 2);
        }
        unset($c);

        $exceptions = $this->withException(
            $exceptions,
            'info',
            'Salary revised mid-cycle — pay blended across ' . count($segments) . ' rate(s): '
                . implode('; ', $segments) . '.'
        );

        return [round($wGross, 2), round($wBasic, 2), array_values($wComponents), $exceptions];
    }

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
        $exceptions = $this->withException(
            $exceptions,
            'warning',
            'No salary structure on file — auto-derived from annual salary (Basic/HRA/Special).'
        );
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

    /**
     * Rule 8 — PF applies to full-time staff.
     *
     * Reads the canonical `employee_type` first and only falls back to the
     * free-text `work_type` for rows the backfill could not classify. An
     * employee with neither on file stays eligible, which is the long-standing
     * behaviour: PF is the norm, and holding a payslip over a blank dropdown
     * would stop runs on data that is merely incomplete. The blank case is
     * flagged separately on the slip so it does not stay invisible.
     */
    private function isPfEligibleType(Employee $employee): bool
    {
        $type = strtolower(trim((string) ($employee->employee_type ?? '')));
        if ($type !== '') {
            return $type === 'full-time';
        }

        $legacy = strtolower((string) ($employee->work_type ?? ''));
        return $legacy === '' || str_contains($legacy, 'full');
    }

    /** True when neither employment-type column is set — PF assumed, not known. */
    private function employmentTypeUnknown(Employee $employee): bool
    {
        return trim((string) ($employee->employee_type ?? '')) === ''
            && trim((string) ($employee->work_type ?? '')) === '';
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
     * Is this date a REST day for the employee, and which kind?
     *
     * Returns 'Holiday', 'Weekly Off', or null for an ordinary working day.
     *
     * Overtime detection treats a rest day specially (PAY-23: every hour worked
     * on one is overtime), so anything that WRITES an attendance status has to
     * be able to ask the same question this service answers — otherwise it can
     * silently convert a rest day into a working day, or the reverse. Exposed
     * for AttendanceRegularizationController, which must not let an approved
     * correction restamp a weekly off as 'Present' and thereby turn the whole
     * day into auto-paid overtime.
     */
    public function restDayKind(Employee $employee, Carbon $date): ?string
    {
        if (isset($this->holidayDateSet($employee, $date, $date)[$date->toDateString()])) {
            return 'Holiday';
        }

        return \App\Support\WeekOff::isOff((string) ($employee->weekly_off ?? ''), $date)
            ? 'Weekly Off'
            : null;
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

    private function attendanceAggregates(
        int $employeeId,
        Carbon $start,
        Carbon $end,
        ?string $shiftStart = null,
        array $shortHours = [],
    ): array {
        if (!Schema::hasTable('attendances')) {
            return [
                'present' => 0,
                'late' => 0,
                'missing' => 0,
                'rows' => 0,
                'worked_dates' => [],
                'short_days' => []
            ];
        }
        $rows = DB::table('attendances')
            ->where('employee_id', $employeeId)
            ->whereNull('deleted_at')
            ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])
            ->get(['id', 'attendance_date', 'status', 'check_in_at', 'check_out_at']);

        /* Minutes actually worked per day, only fetched when the branch runs a
         * short-hours policy — otherwise this is a punch-table scan nobody
         * needs. Measured from completed in→out pairs so a lunch break is not
         * counted as time worked; a day whose pairs don't close falls back to
         * the first-in → last-out span, and a day missing one side entirely
         * measures to null and is left alone (see Branch::shortHoursCreditFor). */
        $shortPolicy   = \App\Models\Branch::normalizeShortHoursPolicy($shortHours ?: null);
        $workedMinutes = $shortPolicy['enabled']
            ? $this->workedMinutesByDate($rows)
            : [];

        // The face-clock flow always stores 'Present' on first punch — the
        // 'Late' status is derived at READ time from the shift-start heuristic
        // (AttendanceController::resolveDayStatus). Payroll must apply the same
        // promotion, otherwise Late Marks / Mismatch always read 0 on the
        // payslip + Biometric Input table even when the employee was late. (#34)
        $shiftStart = $shiftStart ?: '09:30';

        $present = 0.0;
        $late = 0;
        $missing = 0;
        /* Per-date credit (1 / 0.5), so the paid-leave overlap check can ask
         * "was this employee ALSO credited present on the very dates their
         * approved leave covers?" — a question the running total can't answer.
         * See the overlap guard in computeForEmployee(). */
        $workedDates = [];
        /** Days the short-hours policy demoted, for the payslip warning. */
        $shortDays = [];
        foreach ($rows as $r) {
            $status = (string) ($r->status ?? '');
            $hasIn  = !empty($r->check_in_at);
            $hasOut = !empty($r->check_out_at);
            /* Is the first punch past the shift start? 10-minute grace, and the
             * UTC→local conversion mirrors the attendance module. */
            $arrivedLate = false;
            if ($hasIn && in_array(strtolower($status), ['present', 'half day'], true)) {
                $localIn = Carbon::parse($r->check_in_at, 'UTC')->setTimezone(self::DISPLAY_TZ)->format('H:i');
                $arrivedLate = $this->minutesBetween($shiftStart, $localIn) > 10;
            }
            // Promote Present → Late so the payslip's Late Marks column and the
            // Biometric Input table are not permanently zero (#34).
            if ($arrivedLate && strcasecmp($status, 'Present') === 0) {
                $status = 'Late';
            }

            $worked = false;
            $creditBefore = $present;
            switch ($status) {
                case 'Present':
                case 'On Duty':
                case 'Work From Home':
                case 'Corrected':
                    $present += 1;
                    $worked = true;
                    break;
                case 'Late':
                    $present += 1;
                    $late++;
                    $worked = true;
                    break;
                case 'Half Day':
                    /* A half day counts a late mark too when the employee
                     * arrived after the grace window. It used to be invisible:
                     * the promotion above only ran on 'Present', so someone who
                     * turned up at 10:30 and worked a half day recorded ZERO
                     * late marks and the slip carried no late-mark line at all —
                     * turning up late was free as long as the day was short.
                     * The day's credit is untouched at 0.5; only the late count
                     * changes, and that still only costs pay once the branch's
                     * threshold is reached. */
                    $present += 0.5;
                    if ($arrivedLate) $late++;
                    $worked = true;
                    break;
                case 'Missing In':
                case 'Missing Out':
                    $present += 1;
                    $missing++;
                    $worked = true;
                    break;
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

            $credit = round($present - $creditBefore, 2);
            $key    = Carbon::parse($r->attendance_date)->toDateString();

            /* Rule 3 (PAY-17) — short hours demote a full day to half (or to
             * nothing) per the branch policy. Applied here, at the point the
             * day earns its credit, so every downstream figure — present days,
             * paid days, LOP, the per-date overlap reconciliation — sees one
             * consistent number. A day the policy demotes is reported so the
             * slip can say why it was not a full day. */
            if ($shortPolicy['enabled'] && $credit >= 1.0) {
                $mins    = $workedMinutes[$key] ?? null;
                $allowed = \App\Models\Branch::shortHoursCreditFor($shortPolicy, $mins, $credit);
                if ($allowed < $credit) {
                    $shortDays[] = [
                        'date'    => $key,
                        'hours'   => $mins !== null ? round($mins / 60, 2) : null,
                        'credit'  => $allowed,
                    ];
                    $present = round($present - ($credit - $allowed), 2);
                    $credit  = $allowed;
                }
            }

            if ($credit > 0) {
                $workedDates[$key] = round(($workedDates[$key] ?? 0) + $credit, 2);
            }
        }
        return [
            'present' => round($present, 2),
            'late' => $late,
            'missing' => $missing,
            'rows' => $rows->count(),
            'worked_dates' => $workedDates,
            'short_days' => $shortDays,
        ];
    }

    /**
     * Minutes actually worked per attendance date, for the short-hours policy.
     *
     * Preference order, per day:
     *   1. Sum of COMPLETED in→out punch pairs. This is the only figure that
     *      excludes breaks — an employee who punches out for two hours at lunch
     *      did not work them, and a policy measured on the raw span would say
     *      otherwise.
     *   2. First-in → last-out span, when the day has both header timestamps
     *      but no usable pairs (older rows, imported days with no punch detail).
     *   3. null — the hours cannot be measured, so the policy leaves the day
     *      alone rather than docking pay on a guess.
     *
     * @return array<string,int|null> Y-m-d => minutes worked
     */
    private function workedMinutesByDate($rows): array
    {
        $out = [];
        $ids = [];
        foreach ($rows as $r) {
            $ids[] = $r->id;
        }

        $punchesByAttendance = [];
        if ($ids && Schema::hasTable('attendance_punches')) {
            $punches = DB::table('attendance_punches')
                ->whereIn('attendance_id', $ids)
                ->orderBy('attendance_id')->orderBy('punched_at')
                ->get(['attendance_id', 'punched_at', 'direction']);
            foreach ($punches as $p) {
                $punchesByAttendance[$p->attendance_id][] = $p;
            }
        }

        foreach ($rows as $r) {
            $date = Carbon::parse($r->attendance_date)->toDateString();

            $paired  = 0;
            $openIn  = null;
            foreach ($punchesByAttendance[$r->id] ?? [] as $p) {
                if (strcasecmp((string) $p->direction, 'in') === 0) {
                    // Two INs in a row: keep the first, the alternation guard
                    // upstream should have prevented this.
                    $openIn = $openIn ?: Carbon::parse($p->punched_at);
                    continue;
                }
                if ($openIn) {
                    $paired += max(0, $openIn->diffInMinutes(Carbon::parse($p->punched_at)));
                    $openIn = null;
                }
            }

            if ($paired > 0) {
                $out[$date] = $paired;
                continue;
            }

            if (!empty($r->check_in_at) && !empty($r->check_out_at)) {
                $out[$date] = max(0, Carbon::parse($r->check_in_at)
                    ->diffInMinutes(Carbon::parse($r->check_out_at)));
                continue;
            }

            $out[$date] = null;   // unmeasurable — policy must not guess
        }

        return $out;
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

        $isOff = fn(Carbon $d): bool => \App\Support\WeekOff::isOff($weeklyOffLabel, $d)
            || isset($holidaySet[$d->toDateString()]);

        // This leave is itself Approved, so it is already inside the set — no
        // need to add its own range back the way the request path has to.
        $approved = \App\Support\SandwichPolicy::approvedLeaveDates((int) $employee->id, $padFrom, $padTo);
        $isLeave  = fn(Carbon $d): bool => isset($approved[$d->copy()->startOfDay()->toDateString()]);

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
            return ['paid' => 0, 'unpaid' => 0, 'sandwich_lop' => 0, 'paid_dates' => [], 'unpaid_dates' => []];
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
            return ['paid' => 0, 'unpaid' => 0, 'sandwich_lop' => 0, 'paid_dates' => [], 'unpaid_dates' => []];
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

        $isOff = fn(Carbon $d): bool => \App\Support\WeekOff::isOff($weeklyOffLabel, $d)
            || isset($holidaySet[$d->toDateString()]);

        $sandwichOn = \App\Support\SandwichPolicy::appliesTo($employee);
        // Every approved leave in the padded window, so a sandwich whose two
        // halves were filed as separate requests is still seen.
        $approvedDates = $sandwichOn
            ? \App\Support\SandwichPolicy::approvedLeaveDates($employeeId, $padStart, $padEnd)
            : [];
        $isLeave = fn(Carbon $d): bool => isset($approvedDates[$d->copy()->startOfDay()->toDateString()]);

        $windowStart = $start->toDateString();
        $windowEnd   = $end->toDateString();

        $paid = 0.0;
        $unpaid = 0.0;
        $paidDates = [];
        $unpaidDates = [];
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
            $spanDates = [];
            for ($d = $from->copy(); $d->lte($to); $d->addDay()) {
                if (!$isOff($d)) {
                    $span++;
                    $spanDates[] = $d->toDateString();
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
            // Per-date credit for the date-by-date reconciliation in
            // computeForEmployee(): the span is spread evenly over the working
            // dates it covers, so a half-day lands as 0.5 on its one date and
            // a 3-day leave as 1.0 on each of its three.
            $per = $spanDates ? round($span / count($spanDates), 2) : 0.0;

            $flag = strtolower((string) ($paidMap[$r->leave_type_id] ?? 'paid'));
            if (in_array($flag, ['unpaid', 'lwp', 'loss of pay', 'loss_of_pay'], true)) {
                $unpaid += $span;
                foreach ($spanDates as $sd) {
                    $unpaidDates[$sd] = round(min(1.0, ($unpaidDates[$sd] ?? 0) + $per), 2);
                }
                // Waived by HR on the payroll review — the same flag the paid
                // side honours, so one decision covers both.
                if ($sandwichOn && $employee && !$r->sandwich_waived) {
                    $sandwichLop += (float) $this->sandwichBreakdown($employee, $r)['sandwich'];
                }
            } else {
                $paid += $span;
                foreach ($spanDates as $sd) {
                    $paidDates[$sd] = round(min(1.0, ($paidDates[$sd] ?? 0) + $per), 2);
                }
            }
        }
        return [
            'paid' => round($paid, 2),
            'unpaid' => round($unpaid, 2),
            'sandwich_lop' => round($sandwichLop, 2),
            'paid_dates' => $paidDates,
            'unpaid_dates' => $unpaidDates,
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
     * Rule 9 — Professional Tax from the state slab master.
     *
     * The employee's WORK state decides the table — PT is levied by the state
     * the office sits in, not the one the employee's home address is in, so the
     * branch is asked first and the employee's own state_id is only a fallback
     * for tenants that have not filled the branch address in.
     *
     * A state with no slab on file falls back to the Maharashtra table and says
     * so through $lastPtNote, so the figure is never silently wrong for a state
     * nobody has configured. States that genuinely levy no PT are seeded with an
     * explicit ₹0 row and so resolve quietly.
     */
    public function professionalTax(Employee $employee, float $gross, int $month): float
    {
        $this->lastPtNote = null;
        $state = $this->workState($employee);

        $rows = $this->ptSlabsFor($employee, $state);
        if ($rows === []) {
            $this->lastPtNote = $state === null
                ? 'No work state on file for this employee — Professional Tax charged on the Maharashtra slab.'
                : "No Professional Tax slab configured for {$state} — charged on the Maharashtra slab. "
                . 'Add the state in Master › PT Slabs to tax it correctly.';
            return $this->maharashtraPt($employee, $gross, $month);
        }

        $isFemale = str_starts_with(strtolower((string) ($employee->gender ?? '')), 'f');
        $band = $isFemale ? 'female' : 'male';

        foreach ($rows as $row) {
            // 'any' rows apply to everyone; gendered rows only to their band.
            $g = strtolower((string) $row->gender);
            if ($g !== 'any' && $g !== $band) {
                continue;
            }
            if ($gross + 0.001 < (float) $row->min_gross) {
                continue;
            }
            if ($row->max_gross !== null && $gross > (float) $row->max_gross + 0.001) {
                continue;
            }
            // February carries the top-up where a state uses one to reach its
            // annual cap (Maharashtra's ₹2,500, and the same trick elsewhere).
            $amount = $month === 2 && $row->feb_amount !== null
                ? (float) $row->feb_amount
                : (float) $row->amount;

            return round($amount, 2);
        }

        // Slabs exist but none covers this gross — a hole in the ladder rather
        // than a nil rating, so flag it instead of quietly charging nothing.
        $this->lastPtNote = "Professional Tax slabs for {$state} do not cover a gross of ₹"
            . number_format($gross, 2) . ' — no PT deducted. Check the bands in Master › PT Slabs.';

        return 0.0;
    }

    /**
     * Income-tax slabs, NEW REGIME, FY 2025-26 (AY 2026-27). Each entry is
     * [upper bound of the band, rate]; the last band is open-ended.
     */
    private const TDS_SLABS = [
        [400000, 0.00],
        [800000, 0.05],
        [1200000, 0.10],
        [1600000, 0.15],
        [2000000, 0.20],
        [2400000, 0.25],
        [PHP_INT_MAX, 0.30],
    ];

    /** Standard deduction available to salaried staff on the new regime. */
    private const TDS_STANDARD_DEDUCTION = 75000;

    /** Section 87A — full rebate while taxable income stays at or under this. */
    private const TDS_REBATE_CEILING = 1200000;

    /** Health & education cess on the computed tax. */
    private const TDS_CESS_RATE = 0.04;

    /** Explanation of the last computed TDS figure, raised onto the payslip. */
    private ?string $lastTdsNote = null;

    /**
     * This cycle's TDS instalment.
     *
     * Projects the year: annual salary is taken from the structure's monthly
     * gross (the contracted figure, NOT this month's earned pay — a single
     * unpaid week would otherwise collapse the projection and under-deduct for
     * the rest of the year), the standard deduction and the 87A rebate are
     * applied, cess is added, and the result is spread evenly over the months
     * of the financial year still to be paid. Deducting the whole annual
     * liability in one month, or restarting the spread each month, are both
     * wrong; the remaining-months divisor is what makes a mid-year salary
     * revision self-correct over the rest of the year.
     *
     * Deliberately NOT modelled: old-regime elections, Chapter VI-A
     * declarations, house-property loss, previous-employer income and
     * proof-of-investment reconciliation. Those need a declarations module.
     * Until one exists this is a new-regime estimate, and the manual structure
     * line remains the way to enter a figure worked out properly — which is why
     * the manual line takes precedence and why this raises an info line saying
     * what it assumed.
     */
    private function tdsForCycle(Employee $employee, $structure, PayrollPeriod $period, float $earnedGross): float
    {
        $this->lastTdsNote = null;

        $monthlyGross = (float) ($structure->monthly_gross ?? 0);
        if ($monthlyGross <= 0) {
            $monthlyGross = $earnedGross;
        }
        if ($monthlyGross <= 0) {
            return 0.0;
        }

        $annualGross  = $monthlyGross * 12;
        $taxable      = max(0.0, $annualGross - self::TDS_STANDARD_DEDUCTION);
        $tax          = $this->slabTax($taxable);

        // Section 87A — the rebate wipes the liability out entirely at or below
        // the ceiling, which is why most salaries under ~₹12.75L pay nil.
        if ($taxable <= self::TDS_REBATE_CEILING) {
            $tax = 0.0;
        }
        if ($tax <= 0) {
            return 0.0;
        }

        $annualTds = round($tax * (1 + self::TDS_CESS_RATE), 2);

        // Months of THIS financial year still to be paid, counting the current
        // one. India's FY runs April–March, so April is month 1 of 12.
        $monthsElapsed  = ((int) $period->month >= 4) ? ((int) $period->month - 3) : ((int) $period->month + 9);
        $monthsRemaining = max(1, 12 - $monthsElapsed + 1);

        // Already deducted this financial year, so the spread self-corrects
        // after a mid-year revision instead of compounding the old estimate.
        $paidSoFar  = $this->tdsPaidThisFinancialYear($employee->id, $period);
        $instalment = round(max(0.0, $annualTds - $paidSoFar) / $monthsRemaining, 2);

        $this->lastTdsNote = 'Income tax ₹' . number_format($annualTds, 2)
            . ' estimated for the year on the new regime (₹' . number_format($annualGross, 2)
            . ' projected gross, ₹' . number_format(self::TDS_STANDARD_DEDUCTION, 2) . ' standard deduction), '
            . '₹' . number_format($paidSoFar, 2) . ' already deducted, balance spread over '
            . $monthsRemaining . ' remaining month(s) of the financial year. '
            . 'Investment declarations are not modelled — enter a manual TDS line on the salary structure to override.';

        return $instalment;
    }

    /** Tax on a taxable income, walking the slab ladder band by band. */
    private function slabTax(float $taxable): float
    {
        $tax = 0.0;
        $lower = 0.0;
        foreach (self::TDS_SLABS as [$upper, $rate]) {
            if ($taxable <= $lower) {
                break;
            }
            $inBand = min($taxable, (float) $upper) - $lower;
            $tax += $inBand * $rate;
            $lower = (float) $upper;
        }
        return round($tax, 2);
    }

    /** TDS already deducted for this employee in the current financial year. */
    private function tdsPaidThisFinancialYear(int $employeeId, PayrollPeriod $period): float
    {
        // FY starts in April: a January cycle belongs to the FY that began the
        // previous April.
        $fyStartYear = ((int) $period->month >= 4) ? (int) $period->year : (int) $period->year - 1;

        return (float) Payslip::query()
            ->where('employee_id', $employeeId)
            ->whereHas('period', function ($q) use ($fyStartYear, $period) {
                $q->where(function ($q2) use ($fyStartYear) {
                    $q2->where('year', $fyStartYear)->where('month', '>=', 4);
                })->orWhere(function ($q2) use ($fyStartYear) {
                    $q2->where('year', $fyStartYear + 1)->where('month', '<=', 3);
                });
                // Exclude the cycle being computed — regenerating a month must
                // not count its own previous figure as already paid.
                $q->where('id', '!=', $period->id);
            })
            ->sum('tds');
    }

    /** The legacy hardcoded Maharashtra ladder, kept as the fallback. */
    private function maharashtraPt(Employee $employee, float $gross, int $month): float
    {
        $isFemale = str_starts_with(strtolower((string) ($employee->gender ?? '')), 'f');
        if ($isFemale) {
            return $gross <= 25000 ? 0 : 200;
        }
        if ($gross <= 7500)  return 0;
        if ($gross <= 10000) return 175;

        return $month === 2 ? 300 : 200;
    }

    /**
     * Active PT bands for a state, tenant rows preferred over the seeded
     * statutory globals — the same precedence master_overtime_rates uses.
     */
    private function ptSlabsFor(Employee $employee, ?string $state): array
    {
        if ($state === null || !Schema::hasTable('master_pt_slabs')) {
            return [];
        }

        $rows = DB::table('master_pt_slabs')
            ->whereRaw('LOWER(state) = ?', [mb_strtolower($state)])
            ->where(fn($q) => $q->whereNull('client_id')->orWhere('client_id', $employee->client_id))
            ->where(fn($q) => $q->whereNull('branch_id')->orWhere('branch_id', $employee->branch_id))
            ->whereRaw('LOWER(status) = ?', ['active'])
            ->orderBy('min_gross')
            ->get(['client_id', 'gender', 'min_gross', 'max_gross', 'amount', 'feb_amount'])
            ->all();

        // If the tenant has defined its own table for this state, that table
        // replaces the statutory one wholesale — mixing a tenant band into the
        // seeded ladder would leave overlapping or gapped bands.
        $own = array_values(array_filter($rows, fn($r) => $r->client_id !== null));

        return $own !== [] ? $own : $rows;
    }

    /**
     * The state whose PT table applies: the employee's branch address first,
     * then their own state_id. Returns null when neither is on file.
     */
    private function workState(Employee $employee): ?string
    {
        $branch = $employee->relationLoaded('branch') ? $employee->getRelation('branch') : $employee->branch;
        $state = $branch?->state;
        if (is_string($state) && trim($state) !== '') {
            return trim($state);
        }

        if ($employee->state_id && Schema::hasTable('master_states')) {
            $name = DB::table('master_states')->where('id', $employee->state_id)->value('name');
            if (is_string($name) && trim($name) !== '') {
                return trim($name);
            }
        }

        return null;
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

        foreach (
            DB::table('advance_requests')
                ->where('employee_id', $employeeId)
                ->where('hr_status', 'approved')
                ->whereNotNull('recovery_start')
                ->whereDate('recovery_start', '<=', $period->period_end->toDateString())
                ->get([
                    'id',
                    'amount',
                    'sanctioned_amount',
                    'recovery_start',
                    'recovery_mode',
                    'recovery_months',
                    'monthly_emi',
                    'advance_no',
                    'advance_type',
                    'advance_type_other'
                ]) as $r
        ) {
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
                // Rule 11 — a Loan-type request is recovered by the same
                // machinery but reported on its own payslip line.
                'kind'       => $this->recoveryKind($r->advance_type),
                'label'      => ($this->recoveryKind($r->advance_type) === 'loan' ? 'Loan Recovery – ' : 'Advance Recovery – ')
                    . $type . ($r->advance_no ? ' (' . $r->advance_no . ')' : ''),
            ];
        }

        // Company-return-via-payroll streams (only once scheduled at settlement).
        foreach (
            DB::table('advance_requests')
                ->where('employee_id', $employeeId)
                ->whereNotNull('settle_return_scheduled_at')
                ->whereNotNull('settle_return_recovery_start')
                ->whereDate('settle_return_recovery_start', '<=', $period->period_end->toDateString())
                ->get([
                    'id',
                    'settle_balance',
                    'settle_return_payments',
                    'settle_return_recovery_start',
                    'settle_return_recovery_mode',
                    'settle_return_recovery_months',
                    'settle_return_monthly',
                    'advance_no',
                    'advance_type',
                    'advance_type_other'
                ]) as $r
        ) {
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
                // An UNUSED-money return is an advance being handed back, not a
                // loan being serviced — it stays on the advance line whatever
                // the original request was typed as.
                'kind'       => 'advance',
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
            $arrears = 0.0;
            $recoveredBefore = 0.0;
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
                'kind'               => $s['kind'] ?? 'advance',
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

    /**
     * Rule 11 — which payslip column a recovery belongs on. Loan-type requests
     * report as `loan_recovery`; everything else stays `advance_recovery`.
     */
    private function recoveryKind(?string $advanceType): string
    {
        return str_contains(strtolower((string) $advanceType), 'loan') ? 'loan' : 'advance';
    }

    /** The recovered total for one kind, from the last recovery breakdown. */
    private function recoveredOfKind(string $kind): float
    {
        $sum = 0.0;
        foreach ($this->lastRecoveryBreakdown as $b) {
            if (($b['kind'] ?? 'advance') === $kind) {
                $sum += (float) $b['recovered'];
            }
        }
        return round($sum, 2);
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
            ->where(fn($q) => $q->whereNull('client_id')->orWhere('client_id', $employee->client_id))
            ->where(fn($q) => $q->whereNull('branch_id')->orWhere('branch_id', $employee->branch_id))
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
     * $base is the monthly **BASIC** salary, not the gross. Overtime is priced
     * off basic only: allowances (HRA, conveyance, special) compensate for
     * living/travel costs that do not scale with an extra hour worked, so
     * pricing an OT hour off the full gross overpaid every allowance again for
     * each extra hour. This mirrors the statutory "ordinary rate of wages"
     * basis used for OT.
     *
     * $workingDays is the PERIOD's working days, deliberately NOT the
     * join/exit pro-rated figure: an hour of overtime is worth the same
     * whether the employee joined on the 1st or the 20th. `effective_rate` is
     * rounded to paise so a payslip's hours × rate always reproduces the
     * amount exactly.
     */
    public function overtimeRate(Employee $employee, float $base, float $workingDays): array
    {
        $shiftHours = $this->shiftHours($employee);
        $days       = $workingDays > 0 ? $workingDays : 1.0;
        // A negative basic is corrupt data, not a discount — floored at 0 so it
        // can never turn overtime into a deduction from take-home pay.
        $base       = max(0.0, $base);
        // Hourly Salary is rounded to paise — the spec's own worked example
        // carries ₹64.10 forward, not the unrounded ₹64.1025.
        $hourly     = round($shiftHours > 0 ? $base / $days / $shiftHours : 0.0, 2);
        $policy     = $this->overtimeMultiplier($employee);

        return [
            'rate_name'      => $policy['name'],
            'multiplier'     => $policy['multiplier'],
            'rate_found'     => $policy['found'],
            // What the hourly was derived FROM. Named `base` rather than
            // `gross` so a future reader can't mistake it for the gross again;
            // `basis` labels it for the payslip working.
            'base'           => round($base, 2),
            'basis'          => 'basic',
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

        $blank = [
            'hours' => 0.0,
            'days' => 0,
            'capped_days' => 0,
            'shift_end' => $shiftEnd,
            'applicable' => $employee->overtimeApplicable(),
            'detail' => []
        ];
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
            ->get(['attendance_date', 'status', 'check_in_at', 'check_out_at']);

        /* PAY-23 — a weekly off or a holiday is not a short working day, it is
         * a REST day, so every hour worked on it is overtime. Measuring those
         * days against the shift end paid an employee who worked a full
         * Sunday only for the hours that happened to run past 18:30, and
         * nothing for the shift-length stretch before it. */
        $restDays = $this->holidayDateSet($employee, $start, $end);
        $weeklyOff = (string) ($employee->weekly_off ?? '');

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

            // Rest day → the whole worked stretch is overtime.
            $isRestDay = isset($restDays[$date])
                || \App\Support\WeekOff::isOff($weeklyOff, Carbon::parse($date));
            if ($isRestDay) {
                if (empty($r->check_in_at)) {
                    continue;   // can't measure a stretch with only one side
                }
                $in   = Carbon::parse($r->check_in_at, 'UTC')->setTimezone(self::DISPLAY_TZ);
                $out  = Carbon::parse($r->check_out_at, 'UTC')->setTimezone(self::DISPLAY_TZ);
                $mins = intdiv($out->getTimestamp() - $in->getTimestamp(), 60);
                if ($mins <= 0) {
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
                    'rest_day'  => true,
                    'punch_out' => $out->format('H:i'),
                    'minutes'   => $mins,
                    'hours'     => round($mins / 60, 2),
                ];
                continue;
            }

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
            ->when($employee->client_id, fn($q) => $q->where('client_id', $employee->client_id))
            ->when($employee->branch_id, fn($q) => $q->where(fn($w) => $w->whereNull('branch_id')->orWhere('branch_id', $employee->branch_id)))
            // A branch-scoped period beats a client-wide one for this employee.
            ->orderByRaw('branch_id IS NULL')
            ->value('working_days');

        $exceptions = [];
        $structure  = $this->activeStructure($employee, $end);
        // Index 1 is BASIC — overtime is priced off basic, not the gross at [0].
        [, $basic] = $this->resolveCompensation($employee, $structure, $exceptions);

        return $this->overtimeRate(
            $employee,
            (float) $basic,
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
    public function overtimeForCycle(Employee $employee, PayrollPeriod $period, float $base, float $workingDays): array
    {
        $empty = ['hours' => 0.0, 'amount' => 0.0, 'lines' => [], 'exceptions' => []];
        $rows  = $this->approvedOvertimeRows($employee->id, $period);
        if (empty($rows)) {
            return $empty;
        }

        $rate       = $this->overtimeRate($employee, $base, $workingDays);
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
                'Overtime: ₹%s basic ÷ %s working days ÷ %s shift hrs = ₹%s/hr × %s%s × %s hr = ₹%s.',
                number_format($rate['base'], 2),
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
            ->when($period->client_id, fn($q) => $q->where('client_id', $period->client_id))
            ->when($period->branch_id, fn($q) => $q->where(fn($w) => $w->whereNull('branch_id')->orWhere('branch_id', $period->branch_id)))
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
            ->when($period->client_id, fn($q) => $q->where('client_id', $period->client_id))
            ->when($period->branch_id, fn($q) => $q->where(fn($w) => $w->whereNull('branch_id')->orWhere('branch_id', $period->branch_id)))
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
            ->when($period->client_id, fn($q) => $q->where('client_id', $period->client_id))
            ->when($period->branch_id, fn($q) => $q->where(fn($w) => $w->whereNull('branch_id')->orWhere('branch_id', $period->branch_id)))
            ->where('month', (int) $period->month)
            ->where('year', (int) $period->year)
            ->where('status', 'approved')
            ->whereIn('type', $types)
            ->whereNull('deleted_at')
            ->get(['type', 'label', 'amount'])
            ->map(fn($r) => [
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
