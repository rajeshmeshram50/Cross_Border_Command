<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\Payslip;
use App\Models\PayrollPeriod;
use App\Models\PayrollRun;
use App\Models\SalaryStructure;
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
            // Lost the create race — the row now exists, fetch it.
            return PayrollPeriod::where($key)->firstOrFail();
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
                $bankOk = (bool) ($emp && $emp->bank_account_number && $emp->ifsc_code);
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
        $perDay = $period->working_days > 0 ? round($monthlyGross / $period->working_days, 2) : 0;

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

    /** Working days = calendar days minus Sundays (a sane default; HR can edit). */
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
     * Excludes Inactive / Resigned / Terminated and anyone whose last working
     * day fell before the period starts (those go to F&F, not regular pay).
     */
    public function eligibleEmployees(PayrollPeriod $period): Collection
    {
        $q = Employee::query()
            ->whereNotIn('status', ['Inactive', 'Resigned', 'Terminated'])
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

        // Drop anyone whose exit last-working-day is before this period starts.
        $exits = $this->exitMap($employees->pluck('id')->all());
        return $employees->reject(function (Employee $e) use ($exits, $period) {
            $lwd = $exits[$e->id] ?? null;
            return $lwd && Carbon::parse($lwd)->lt($period->period_start);
        })->values();
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

        $existing = $period->runs()->latest('id')->first();
        if ($existing && $existing->isLocked()) {
            throw new RuntimeException('Payroll for this period is already approved/paid and cannot be regenerated.');
        }

        return DB::transaction(function () use ($period, $ctx, $existing) {
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

            $totGross = 0;
            $totDed   = 0;
            $totNet   = 0;
            $onHold   = 0;

            foreach ($employees as $employee) {
                $data = $this->computeForEmployee($employee, $period, $nameCache);
                $data['client_id']         = $period->client_id;
                // Store the EMPLOYEE's real branch (not the period's), so a
                // client-wide run still keeps per-branch reporting accurate.
                $data['branch_id']         = $employee->branch_id ?: $period->branch_id;
                $data['payroll_run_id']    = $run->id;
                $data['payroll_period_id'] = $period->id;
                $data['employee_id']       = $employee->id;
                $data['created_by']        = $ctx['user_id'] ?? null;

                Payslip::create($data);

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
    public function computeForEmployee(Employee $employee, PayrollPeriod $period, array $nameCache = []): array
    {
        $exceptions = [];

        $deptName = $nameCache['departments'][$employee->department_id] ?? null;
        $desigName = $nameCache['designations'][$employee->designation_id] ?? null;

        $base = [
            'employee_code' => $employee->emp_code,
            'employee_name' => trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')) ?: $employee->display_name,
            'department'    => $deptName,
            'designation'   => $desigName,
            'working_days'  => $period->working_days,
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
        $lwd = $this->exitMap([$employee->id])[$employee->id] ?? null;
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

        // Effective payable working days within the active window.
        $effectiveWorkingDays = round($period->working_days * $proration, 2);

        // ── Rules 2 & 3 — attendance + leave ───────────────────────────────
        $att = $this->attendanceAggregates($employee->id, $winStart, $winEnd);
        $leave = $this->leaveAggregates($employee->id, $winStart, $winEnd);
        // Holidays from the employee's assigned holiday group that fall on a
        // working day in the active window — paid like leave, never LOP.
        $holidayDays = $this->holidayAggregates($employee, $winStart, $winEnd);

        $presentDays   = $att['present'];
        $lateMarks     = $att['late'];
        $missingPunch  = $att['missing'];
        $paidLeaveDays = $leave['paid'];
        $unpaidLeaveDays = $leave['unpaid'];

        // Paid days = present + paid leave + group holidays (capped to the
        // window). The min() cap means holidays only ever fill the unpaid gap
        // up to the working-day ceiling — they can never inflate paid days for
        // an employee who was already present every working day.
        $paidDays = min($effectiveWorkingDays, $presentDays + $paidLeaveDays + $holidayDays);
        if ($holidayDays > 0) {
            $exceptions = $this->withException($exceptions, 'info',
                "{$holidayDays} holiday day(s) in this period credited as paid.");
        }
        // Everything else in the active window is loss-of-pay.
        $lopDays = max(0, round($effectiveWorkingDays - $paidDays, 2));

        // Rule 2 — every 3 late marks costs 1 day. Flag for HR review rather
        // than silently docking (exception: late-sitting may have covered the
        // hours; HR can hold/waive on review).
        $lateLopDays = intdiv($lateMarks, 3);
        if ($lateLopDays > 0) {
            $lopDays += $lateLopDays;
            $exceptions = $this->withException($exceptions, 'warning',
                "{$lateMarks} late marks → {$lateLopDays} day LOP (verify hours covered before approving).");
        }
        $lopDays = min($effectiveWorkingDays, $lopDays);
        $paidDays = max(0, round($effectiveWorkingDays - $lopDays, 2));

        // ── Money ──────────────────────────────────────────────────────────
        $proratedGross = round($gross * $proration, 2);
        $proratedBasic = round($basic * $proration, 2);

        // Earned factor — the share of the active window that is actually paid
        // (present + paid leave, after LOP). Statutory deductions are computed
        // on EARNED pay, not full pay, so a heavily-absent month never produces
        // a negative net by stacking PT/PF on top of a wiped-out salary.
        $earnedFactor = $effectiveWorkingDays > 0 ? min(1, $paidDays / $effectiveWorkingDays) : 0;
        $earnedGross  = round($proratedGross * $earnedFactor, 2);
        $earnedBasic  = round($proratedBasic * $earnedFactor, 2);
        // LOP is the gap between full (pro-rated) gross and what was earned.
        $lopAmount    = round($proratedGross - $earnedGross, 2);

        // Build earnings JSON from structure components (pro-rated for join/exit).
        $earnings = [];
        foreach ($earnComponents as $c) {
            $earnings[] = [
                'code'   => $c['code'] ?? 'comp',
                'label'  => $c['label'] ?? 'Component',
                'amount' => round(((float) ($c['amount'] ?? 0)) * $proration, 2),
            ];
        }
        // Approved overtime / bonus / incentive show as separate earning lines.
        foreach ($this->adjustmentLines($employee->id, $period, ['overtime', 'bonus', 'incentive']) as $line) {
            $earnings[] = $line;
        }

        // Statutory deductions on EARNED figures (Rule 8/9) — no earned pay
        // means no statutory deduction.
        $pf  = 0;
        if ($pfApplicable && $employee->pf_eligible && $this->isPfEligibleType($employee) && $earnedBasic > 0) {
            $pf = round(min($earnedBasic, self::PF_WAGE_CEILING) * self::PF_RATE, 2);
        }
        $esi = 0;
        if ($esiApplicable && $earnedGross > 0 && $earnedGross <= self::ESI_GROSS_LIMIT) {
            $esi = round($earnedGross * self::ESI_RATE, 2);
        }
        $pt = ($ptApplicable && $earnedGross > 0)
            ? $this->professionalTax($employee, $earnedGross, $period->month)
            : 0;

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
        $advanceRec = $this->advanceRecovery($employee->id, $period);
        // EMI must not exceed net before recovery (Rule 11 validation). Net
        // before recovery is earned pay minus the non-LOP deductions.
        $netBeforeRecovery = $earnedGross - ($pf + $esi + $pt + $tds + $other);
        if ($advanceRec > max(0, $netBeforeRecovery)) {
            $advanceRec = round(max(0, $netBeforeRecovery), 2);
            $exceptions = $this->withException($exceptions, 'warning',
                'Advance EMI exceeded net salary — capped to available net this cycle.');
        }

        // Overtime (Rule 4) + bonus/incentive (Rule 10) — only APPROVED
        // adjustments count (pending/rejected are ignored by the query).
        $overtimeAmount = $this->approvedOvertimeAmount($employee->id, $period);
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
        if ($advanceRec > 0)  $deductions[] = ['code' => 'advance', 'label' => 'Advance Recovery', 'amount' => $advanceRec];
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
            'lop_days'       => $lopDays,
            'paid_leave_days'   => $paidLeaveDays,
            'unpaid_leave_days' => $unpaidLeaveDays,
            'late_marks'     => $lateMarks,
            'missing_punches' => $missingPunch,
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
            $gross <= self::ESI_GROSS_LIMIT,
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

        $rows = DB::table('holidays')
            ->where('holiday_group_id', $groupId)
            ->whereNull('deleted_at')
            ->get(['date', 'is_recurring']);

        $dates = [];
        foreach ($rows as $r) {
            if (!$r->date) continue;
            $d = Carbon::parse($r->date);

            // A recurring holiday repeats every year — re-anchor it to the
            // window's year (use the window start's year) before comparing.
            if ($r->is_recurring) {
                $d = Carbon::create($start->year, $d->month, $d->day);
            }

            if ($d->lt($start) || $d->gt($end)) continue;
            if ($d->dayOfWeek === Carbon::SUNDAY) continue; // not a working day

            $dates[$d->toDateString()] = true; // dedupe same-day entries
        }

        return (float) count($dates);
    }

    private function attendanceAggregates(int $employeeId, Carbon $start, Carbon $end): array
    {
        if (!Schema::hasTable('attendances')) {
            return ['present' => 0, 'late' => 0, 'missing' => 0, 'rows' => 0];
        }
        $rows = DB::table('attendances')
            ->where('employee_id', $employeeId)
            ->whereNull('deleted_at')
            ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])
            ->get(['status']);

        $present = 0.0;
        $late = 0;
        $missing = 0;
        foreach ($rows as $r) {
            switch ($r->status) {
                case 'Present':
                case 'On Duty':
                case 'Work From Home':
                case 'Corrected':
                    $present += 1; break;
                case 'Late':
                    $present += 1; $late++; break;
                case 'Half Day':
                    $present += 0.5; break;
                case 'Missing In':
                case 'Missing Out':
                    $present += 1; $missing++; break;
                // Absent / Leave / Weekly Off / Holiday → not counted present.
            }
        }
        return ['present' => round($present, 2), 'late' => $late, 'missing' => $missing, 'rows' => $rows->count()];
    }

    /**
     * Approved leave in the window split into paid vs unpaid by the leave
     * type's paid_unpaid flag (Rule 3). Days clipped to the active window.
     */
    private function leaveAggregates(int $employeeId, Carbon $start, Carbon $end): array
    {
        if (!Schema::hasTable('leave_requests')) {
            return ['paid' => 0, 'unpaid' => 0];
        }

        $rows = DB::table('leave_requests')
            ->where('employee_id', $employeeId)
            ->where('status', 'Approved')
            ->whereDate('from_date', '<=', $end->toDateString())
            ->whereDate('to_date', '>=', $start->toDateString())
            ->get(['leave_type_id', 'from_date', 'to_date', 'days', 'day_type']);

        if ($rows->isEmpty()) {
            return ['paid' => 0, 'unpaid' => 0];
        }

        $paidMap = $this->leaveTypePaidMap($rows->pluck('leave_type_id')->unique()->all());

        $paid = 0.0;
        $unpaid = 0.0;
        foreach ($rows as $r) {
            // Clip the leave span to the active window, then size it.
            $from = Carbon::parse($r->from_date)->max($start);
            $to   = Carbon::parse($r->to_date)->min($end);
            if ($to->lt($from)) {
                continue;
            }
            // Count only WORKING days (exclude Sundays) in the clipped window so
            // a leave that straddles a weekend doesn't over-credit paid days
            // (Rule 3 precision).
            $span = 0;
            for ($d = $from->copy(); $d->lte($to); $d->addDay()) {
                if ($d->dayOfWeek !== Carbon::SUNDAY) {
                    $span++;
                }
            }
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
            } else {
                $paid += $span;
            }
        }
        return ['paid' => round($paid, 2), 'unpaid' => round($unpaid, 2)];
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
    private function advanceRecovery(int $employeeId, PayrollPeriod $period): float
    {
        if (!Schema::hasTable('advance_requests')) {
            return 0;
        }
        $rows = DB::table('advance_requests')
            ->where('employee_id', $employeeId)
            ->where('hr_status', 'approved')
            ->whereNotNull('recovery_start')
            ->whereDate('recovery_start', '<=', $period->period_end->toDateString())
            ->get(['amount', 'recovery_start', 'recovery_mode', 'recovery_months', 'monthly_emi']);

        $total = 0.0;
        foreach ($rows as $r) {
            $startCarbon = Carbon::parse($r->recovery_start);
            if ($r->recovery_mode === 'emi') {
                $months = (int) ($r->recovery_months ?: 1);
                $endCarbon = $startCarbon->copy()->addMonthsNoOverflow(max(0, $months - 1))->endOfMonth();
                // EMI due only while the cycle falls inside the schedule.
                if ($period->period_end->lt($startCarbon->copy()->startOfMonth()) || $period->period_start->gt($endCarbon)) {
                    continue;
                }
                $total += (float) ($r->monthly_emi ?: round(((float) $r->amount) / max(1, $months), 2));
            } else {
                // Lumpsum / one-off — recover fully in the start month only.
                if ($startCarbon->year === (int) $period->year && $startCarbon->month === (int) $period->month) {
                    $total += (float) $r->amount;
                }
            }
        }
        return round($total, 2);
    }

    /** Rule 4 — sum of APPROVED overtime adjustments for the cycle. */
    private function approvedOvertimeAmount(int $employeeId, PayrollPeriod $period): float
    {
        return $this->approvedAdjustments($employeeId, $period, ['overtime']);
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
}
