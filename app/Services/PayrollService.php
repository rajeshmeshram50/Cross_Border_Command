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

class PayrollService
{
    private array $schemaCache = [];

    private array $masterCache = [];

    private function hasTable(string $table): bool
    {
        return $this->schemaCache["t:{$table}"] ??= Schema::hasTable($table);
    }

    private function hasColumn(string $table, string $column): bool
    {
        return $this->schemaCache["c:{$table}.{$column}"]
            ??= ($this->hasTable($table) && Schema::hasColumn($table, $column));
    }

    private const PF_WAGE_CEILING = 25000;
    private const PF_RATE         = 0.12;
    private const ESI_GROSS_LIMIT = 21000;
    private const ESI_RATE        = 0.0075;
    private const DISPLAY_TZ = 'Asia/Kolkata';
    private const DEFAULT_SHIFT_START = '09:30';
    private const DEFAULT_SHIFT_END   = '18:30';
    private const DEFAULT_SHIFT_HOURS = 9.0;
    private const MAX_OT_MINUTES_PER_DAY = 720;

    private array $lastRecoveryBreakdown = [];

    private ?string $lastPtNote = null;

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
            $existing = PayrollPeriod::where($key)->first();
            if ($existing) {
                return $existing;
            }
            throw $e;
        }
    }

    public function reopen(PayrollPeriod $period): void
    {
        DB::transaction(function () use ($period) {
            $run = $period->runs()->latest('id')->first();

            if ($run && $run->status === 'paid') {
                throw new RuntimeException('Paid payroll cannot be reopened — post an adjustment in the next cycle.');
            }

            if ($run && $run->status !== 'paid') {
                Payslip::where('payroll_run_id', $run->id)->forceDelete();
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

    public function recomputeEmployeePayslips(int $employeeId, $effectiveFrom = null): int
    {
        $this->masterCache = [];

        $employee = Employee::find($employeeId);
        if (!$employee) {
            return 0;
        }

        $payslips = Payslip::where('employee_id', $employeeId)
            ->whereHas('run', fn($q) => $q->whereIn('status', ['draft', 'generated']))
            ->when($effectiveFrom, fn($q) => $q->whereHas(
                'run.period',
                fn($pq) => $pq->whereDate('period_end', '>=', $effectiveFrom)
            ))
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
            unset($data['client_id'], $data['branch_id']);
            $slip->fill($data)->save();
            $this->recordRecoveryLedger($period, $employeeId, $this->lastRecoveryBreakdown);
            $updated++;
            $touchedRuns[$slip->payroll_run_id] = $slip->run;
        }

        foreach ($touchedRuns as $run) {
            $this->refreshRunTotals($run);
        }

        return $updated;
    }

    public function disburseRun(PayrollRun $run, ?int $userId): array
    {
        return DB::transaction(function () use ($run, $userId) {
            PayrollRun::whereKey($run->id)->lockForUpdate()->first();

            if (Payslip::where('payroll_run_id', $run->id)->count() === 0) {
                return ['paid' => 0, 'held' => 0];
            }
            $unpaid = Payslip::where('payroll_run_id', $run->id)->where('status', '!=', 'Paid')->get();
            $paid = 0;
            $held = 0;
            foreach ($unpaid as $slip) {
                if ((float) $slip->net_pay <= 0) {
                    continue;
                }
                $emp = Employee::find($slip->employee_id);
                $bankOk = (bool) $emp && \App\Support\BankDetails::isValid(
                    $emp->ifsc_code ?? null,
                    $emp->bank_account_number ?? null,
                );
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

    public function computeFnf(Employee $employee, array $opts = []): array
    {
        $exit = $this->hasTable('employee_exits')
            ? DB::table('employee_exits')->where('employee_id', $employee->id)->first()
            : null;
        $lwd = $exit && $exit->last_working_day ? Carbon::parse($exit->last_working_day) : Carbon::now();

        $ctx = ['client_id' => $employee->client_id, 'branch_id' => $employee->branch_id];
        $period = $this->resolveOrCreatePeriod($ctx, (int) $lwd->month, (int) $lwd->year);

        $slip = $this->computeForEmployee($employee, $period);
        $finalSalaryNet = (float) $slip['net_pay'] + (float) ($slip['advance_recovery'] ?? 0);

        $structure = $this->activeStructure($employee, $lwd);
        $monthlyGross = $structure ? (float) $structure->monthly_gross
            : ($employee->annual_salary ? round((float) $employee->annual_salary / 12, 2) : 0);
        $monthlyBasic = $structure ? (float) $structure->basicAmount()
            : ($employee->annual_salary ? round((float) $employee->annual_salary / 12 * 0.5, 2) : 0);
        $fnfMonthDays = max(1, $period->period_start->diffInDays($period->period_end) + 1);
        $perDay = round($monthlyBasic / $fnfMonthDays, 2);

        $encashDays = max(0, (float) ($opts['leave_encashment_days'] ?? 0));
        $leaveEncashment = round($perDay * $encashDays, 2);
        $noticeRecovery  = max(0, (float) ($opts['notice_recovery_amount'] ?? 0));
        $otherDues       = max(0, (float) ($opts['other_dues'] ?? 0));
        $otherDeductions = max(0, (float) ($opts['other_deductions'] ?? 0));

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

    private function outstandingAdvances(int $employeeId): float
    {
        if (!$this->hasTable('advance_requests')) {
            return 0;
        }
        return (float) DB::table('advance_requests')
            ->where('employee_id', $employeeId)
            ->where('hr_status', 'approved')
            ->sum('amount');
    }

    public function attendanceCoverage(PayrollPeriod $period): array
    {
        $employees = $this->eligibleEmployees($period);
        $total = $employees->count();
        if ($total === 0 || !$this->hasTable('attendances')) {
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

    private function calendarDaysInWindow(Carbon $start, Carbon $end): int
    {
        $days = 0;
        for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
            $days++;
        }
        return $days;
    }

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

    public function defaultWorkingDays(Carbon $start, Carbon $end): int
    {
        $days = 0;
        for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
            if ($d->dayOfWeek !== Carbon::SUNDAY) {
                $days++;
            }
        }
        return $days;
    }

    public function earnedSalaryForExitMonth(Employee $employee, Carbon $lwd, $resignationDate = null): array
    {
        $today  = Carbon::today();
        $effLwd = $lwd->gt($today) ? $today->copy() : $lwd->copy();

        $start = $effLwd->copy()->startOfMonth();
        $end   = $effLwd->copy()->endOfMonth();

        $earlyExit = ProbationGuard::isEarlyExit($employee, $lwd, $resignationDate);

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

        $slip = $this->computeForEmployee($employee, $period, [], [$employee->id => $effLwd->toDateString()]);

        $amount = round((float) $slip['net_pay'] + (float) ($slip['advance_recovery'] ?? 0), 2);

        if ($earlyExit) {
            $tenure = ProbationGuard::tenureDays($employee, $resignationDate ?: $lwd);
            $gross  = round((float) ($slip['gross_earnings'] ?? 0), 2);

            $kept = array_values(array_filter(
                is_array($slip['deductions'] ?? null) ? $slip['deductions'] : [],
                fn($d) => ($d['code'] ?? null) !== 'advance' && round((float) ($d['amount'] ?? 0), 2) !== 0.0,
            ));
            $keptTotal = round(array_sum(array_map(fn($d) => (float) ($d['amount'] ?? 0), $kept)), 2);

            $recovery = round(max(0, $gross - $keptTotal), 2);
            if ($recovery > 0) {
                $kept[] = [
                    'code'   => 'early_exit',
                    'label'  => 'Early Exit Recovery — no salary payable for this cycle',
                    'amount' => $recovery,
                ];
            }

            $note = 'No salary for this cycle — '
                . ($tenure !== null ? "exited on day {$tenure} of joining, within " : 'exited within ')
                . ProbationGuard::EARLY_EXIT_DAYS
                . ' days, so payroll is not processed for this employee. The cycle is shown'
                . ' in full below and recovered in full, settling at zero.';

            $slip['deductions']       = $kept;
            $slip['total_deductions'] = round($keptTotal + $recovery, 2);
            $slip['net_pay']          = 0.0;
            $amount                   = 0.0;
        }

        $ver = \App\Models\SalaryStructure::versionsInForce(
            (int) $employee->id,
            Carbon::parse($period->period_start ?? $start)->startOfDay(),
            Carbon::parse($period->period_end ?? $end)->endOfDay(),
        );

        return [
            'cycle'         => $effLwd->format('F Y'),
            'priced_to'         => $effLwd->toDateString(),
            'last_working_day'  => $lwd->toDateString(),
            'is_provisional'    => $effLwd->lt($lwd),
            'salary_version'      => $ver['version'],
            'salary_version_from' => $ver['from'],
            'salary_versions'     => $ver['all'],
            'monthly_gross' => (float) ($slip['gross_earnings'] ?? 0),
            'month_days'    => (int) $end->day,
            'earned_days'   => (float) ($slip['paid_days'] ?? 0),
            'amount'        => max(0, $amount),
            'early_exit'    => $earlyExit,
            'breakdown'     => [
                'working_days'      => (float) ($slip['working_days'] ?? 0),
                'present_days'      => (float) ($slip['present_days'] ?? 0),
                'paid_days'         => (float) ($slip['paid_days'] ?? 0),
                'weekoff_days'      => (float) ($slip['weekoff_days'] ?? 0),
                'weekoff_paid_days' => (float) ($slip['weekoff_paid_days'] ?? 0),
                'holiday_days'      => (float) ($slip['holiday_days'] ?? 0),
                'lop_days'          => (float) ($slip['lop_days'] ?? 0),
                'paid_leave_days'   => (float) ($slip['paid_leave_days'] ?? 0),
                'unpaid_leave_days' => (float) ($slip['unpaid_leave_days'] ?? 0),
                'overtime_hours'    => (float) ($slip['overtime_hours'] ?? 0),
                'overtime_amount'   => (float) ($slip['overtime_amount'] ?? 0),
                'gross_earnings'    => (float) ($slip['gross_earnings'] ?? 0),
                'structure_gross'   => (float) ($slip['structure_gross'] ?? 0),
                'monthly_gross_full' => (float) ($slip['monthly_gross_full'] ?? 0),
                'monthly_basic_full' => (float) ($slip['monthly_basic_full'] ?? 0),
                'proration'          => (float) ($slip['proration'] ?? 1),
                'active_days'        => (float) ($slip['active_days'] ?? 0),
                'cycle_days'         => (float) ($slip['cycle_days'] ?? 0),
                'structure_components' => $slip['structure_components'] ?? [],
                'extra_earnings'       => $slip['extra_earnings'] ?? [],
                'earned_gross'         => (float) ($slip['earned_gross'] ?? 0),
                'earned_basic'         => (float) ($slip['earned_basic'] ?? 0),
                'earned_factor'        => (float) ($slip['earned_factor'] ?? 0),
                'lop_amount'        => (float) ($slip['lop_amount'] ?? 0),
                'per_day_rate'      => (float) ($slip['lop_per_day'] ?? 0),
                'lop_basis'         => (string) ($slip['lop_basis'] ?? 'basic'),
                'lop_divisor'       => (string) ($slip['lop_divisor'] ?? 'calendar'),
                'lop_divisor_days'  => (float) ($slip['lop_divisor_days'] ?? 0),
                'total_deductions'  => (float) ($slip['total_deductions'] ?? 0),
                'net_pay'           => (float) ($slip['net_pay'] ?? 0),
                'earnings'          => $slip['earnings'] ?? [],
                'deductions'        => $slip['deductions'] ?? [],
            ],
            'note' => $earlyExit ? $note : ('Excluded from the ' . $lwd->format('F Y')
                . ' payroll run — computed here on the same basis and settled in the F&F.'),
        ];
    }

    public function finalizeAttendance(PayrollPeriod $period, ?int $userId): void
    {
        $period->forceFill([
            'attendance_finalized'    => true,
            'attendance_finalized_at' => now(),
            'attendance_finalized_by' => $userId,
        ])->save();
    }

    public function eligibleEmployees(PayrollPeriod $period): Collection
    {
        $q = Employee::query()
            ->with('branch:id,shifts,late_mark_policy,lop_policy,short_hours_policy,sandwich_policy,state')
            ->whereNotIn('status', ['Inactive', 'Resigned', 'Terminated'])
            ->where('onboarding_stage_completed', '>=', 6)
            ->where(function ($w) {
                $w->whereNull('enable_payroll')->orWhere('enable_payroll', true);
            })
            ->where(function ($w) use ($period) {
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

        $ids     = $employees->pluck('id')->all();
        $exits   = $this->exitMap($ids);
        $resigns = $this->resignationMap($ids);
        $openExits = \App\Support\ExitInProgress::employeeIds(null, $ids);
        return $employees->reject(function (Employee $e) use ($exits, $resigns, $period, $openExits) {
            if (in_array((int) $e->id, $openExits, true)) {
                return true;
            }
            $lwd = $exits[$e->id] ?? null;
            if ($lwd && Carbon::parse($lwd)->lte($period->period_end)) {
                return true;
            }
            return ProbationGuard::isEarlyExit($e, $lwd, $resigns[$e->id] ?? null);
        })->values();
    }

    public function payrollExclusions(PayrollPeriod $period): array
    {
        $q = Employee::withTrashed();
        if ($period->client_id) $q->where('client_id', $period->client_id);
        if ($period->branch_id) $q->where('branch_id', $period->branch_id);

        $employees = $q->get();
        $ids       = $employees->pluck('id')->all();
        $exits     = $this->exitMap($ids);
        $resigns   = $this->resignationMap($ids);
        $paidLast  = $this->paidInPreviousPeriod($period, $ids);
        $openExits = \App\Support\ExitInProgress::employeeIds(null, $ids);
        $coveredElsewhere = $this->coveredBySiblingPeriod($period, $ids);
        $out       = [];

        foreach ($employees as $e) {
            $lwd    = $exits[$e->id] ?? null;
            $resign = $resigns[$e->id] ?? null;

            if ($e->date_of_joining && Carbon::parse($e->date_of_joining)->gt($period->period_end)) {
                continue;
            }
            if ($lwd && Carbon::parse($lwd)->lt($period->period_start)) {
                continue;
            }

            $earlyExit = ProbationGuard::isEarlyExit($e, $lwd, $resign);
            $exitedInCycle = $lwd
                && Carbon::parse($lwd)->lte($period->period_end)
                && Carbon::parse($lwd)->gte($period->period_start);

            $exitInProgress = in_array((int) $e->id, $openExits, true);

            $paidElsewhere = in_array((int) $e->id, $coveredElsewhere['ids'], true);

            $halfOnboarded = !$e->trashed() && (int) $e->onboarding_stage_completed < 6;
            $payrollOff = !$e->trashed() && $e->enable_payroll !== null && !$e->enable_payroll;

            $statusGone = !$lwd
                && in_array((string) $e->status, ['Inactive', 'Resigned', 'Terminated'], true)
                && in_array($e->id, $paidLast, true);

            $disabledNoExit = !$lwd && $e->trashed() && in_array($e->id, $paidLast, true);

            if (!$earlyExit && !$exitedInCycle && !$exitInProgress && !$halfOnboarded
                && !$payrollOff && !$statusGone && !$disabledNoExit && !$paidElsewhere) {
                continue;
            }

            $lwdTenure = ProbationGuard::tenureDays($e, $lwd);
            $tenure    = $lwdTenure;
            if ($earlyExit) {
                $found  = array_filter(
                    [ProbationGuard::tenureDays($e, $resign), $lwdTenure],
                    fn($t) => $t !== null,
                );
                $tenure = $found ? min($found) : null;
            }

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
                'last_working_day' => $lwd ? Carbon::parse($lwd)->toDateString() : null,
                'tenure_days'      => $tenure,
                'on_probation'     => $probationLeaver,
                'probation_end'    => $probationEnd?->toDateString(),
                'fnf_amount'       => $fnfAmount,
                'exit_in_progress' => $exitInProgress,
                'paid_elsewhere'   => $paidElsewhere,
                'paid_in_cycle'    => $paidElsewhere
                    ? ($coveredElsewhere['labels'][(int) $e->id] ?? null)
                    : null,
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
                        : ($paidElsewhere
                            ? 'Already included in the ' . $period->label . ' payroll for '
                            . ($coveredElsewhere['labels'][(int) $e->id] ?? 'another payroll cycle')
                            . ' — an employee is only paid once per month, so this run skips them.'
                            . ' Open that cycle to see their payslip.'
                            : ($exitInProgress
                            ? 'Exit in progress'
                            . ($lwd ? ' — last working day ' . Carbon::parse($lwd)->format('j M Y') : ' — last working day not agreed yet')
                            . '. Excluded from payroll processing; salary and dues are settled'
                            . ' through the Full & Final settlement in Exit Management.'
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
                                    . ' settled manually or through Exit Management.')))))))
                    . ($probationLeaver
                        ? ' Left before completing probation (probation ran to '
                        . $probationEnd->format('j M Y') . ') — notice period was not applicable.'
                        : ''),
            ];
        }

        return $out;
    }

    private function coveredBySiblingPeriod(PayrollPeriod $period, array $employeeIds): array
    {
        $empty = ['ids' => [], 'labels' => []];
        if (empty($employeeIds) || !$this->hasTable('payslips') || !$period->client_id) {
            return $empty;
        }

        $siblings = PayrollPeriod::where('client_id', $period->client_id)
            ->where('month', $period->month)
            ->where('year', $period->year)
            ->where('id', '!=', $period->id)
            ->get(['id', 'label', 'branch_id']);
        if ($siblings->isEmpty()) {
            return $empty;
        }

        $branchNames = [];
        $branchIds = $siblings->pluck('branch_id')->filter()->unique()->values()->all();
        if (!empty($branchIds) && $this->hasTable('branches')) {
            $branchNames = DB::table('branches')->whereIn('id', $branchIds)
                ->pluck('name', 'id')->all();
        }

        $rows = Payslip::whereIn('payroll_period_id', $siblings->pluck('id'))
            ->whereIn('employee_id', $employeeIds)
            ->get(['employee_id', 'payroll_period_id']);

        $byPeriod = $siblings->keyBy('id');
        $ids = [];
        $labels = [];
        foreach ($rows as $r) {
            $eid = (int) $r->employee_id;
            $ids[$eid] = $eid;
            $sib = $byPeriod->get($r->payroll_period_id);
            $labels[$eid] = $sib && $sib->branch_id && isset($branchNames[$sib->branch_id])
                ? $branchNames[$sib->branch_id]
                : ($sib->label ?? 'another cycle');
        }

        return ['ids' => array_values($ids), 'labels' => $labels];
    }

    private function resignationMap(array $employeeIds): array
    {
        if (empty($employeeIds) || !$this->hasTable('employee_exits')) {
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

    private function paidInPreviousPeriod(PayrollPeriod $period, array $employeeIds): array
    {
        if (empty($employeeIds) || !$this->hasTable('payslips')) {
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

    private function exitMap(array $employeeIds): array
    {
        if (empty($employeeIds) || !$this->hasTable('employee_exits')) {
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

    public function generate(PayrollPeriod $period, array $ctx): PayrollRun
    {
        $this->masterCache = [];

        if (!$period->attendance_finalized) {
            throw new RuntimeException('Payroll cannot be processed because attendance is not finalized.');
        }
        if ($period->status === 'locked') {
            throw new RuntimeException('This payroll period is locked. Adjustments must go to the next cycle.');
        }

        return DB::transaction(function () use ($period, $ctx) {
            PayrollPeriod::whereKey($period->id)->lockForUpdate()->first();

            $existing = $period->runs()->latest('id')->first();
            if ($existing && $existing->isLocked()) {
                throw new RuntimeException('Payroll for this period is already approved/paid and cannot be regenerated.');
            }

            $employees = $this->eligibleEmployees($period);

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

            if ($employees->isEmpty()) {
                throw new RuntimeException('Payroll cannot be processed because no payroll data is available for the selected month.');
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

            Payslip::where('payroll_run_id', $run->id)->forceDelete();

            $nameCache = $this->masterNameCaches();
            $exitMap = $this->exitMap($employees->pluck('id')->all());

            $totGross = 0;
            $totDed   = 0;
            $totNet   = 0;
            $onHold   = 0;

            foreach ($employees as $employee) {
                $data = $this->computeForEmployee($employee, $period, $nameCache, $exitMap);
                $data['client_id']         = $period->client_id;
                $data['branch_id']         = $employee->branch_id ?: $period->branch_id;
                $data['payroll_run_id']    = $run->id;
                $data['payroll_period_id'] = $period->id;
                $data['employee_id']       = $employee->id;
                $data['created_by']        = $ctx['user_id'] ?? null;

                Payslip::create($data);
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
            'employee_type' => $employee->employee_type,
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
                'info',
                'Mid-cycle join/exit — salary pro-rated to ' . round($proration * 100) . '% of the month.'
            );
        }

        $structure = $this->activeStructure($employee, $winEnd);
        [$gross, $basic, $earnComponents, $structDeductions, $pfApplicable, $esiApplicable, $ptApplicable] =
            $this->resolveCompensation($employee, $structure, $exceptions);

        $structureMonthly = [];
        foreach ($earnComponents as $c) {
            $structureMonthly[(string) ($c['code'] ?? 'comp')] = round((float) ($c['amount'] ?? 0), 2);
        }

        if ($structure) {
            $pending = SalaryStructure::where('employee_id', $employee->id)
                ->where('status', 'active')
                ->whereDate('effective_from', '>', $winEnd)
                ->orderByDesc('effective_from')
                ->first();
            if ($pending) {
                $exceptions = $this->withException(
                    $exceptions,
                    'info',
                    'Priced on the salary structure effective '
                        . Carbon::parse($structure->effective_from)->format('j M Y')
                        . ' (₹' . number_format((float) $structure->monthly_gross, 2) . '/month). '
                        . 'A revision effective ' . Carbon::parse($pending->effective_from)->format('j M Y')
                        . ' (₹' . number_format((float) $pending->monthly_gross, 2) . '/month) is saved on the '
                        . 'employee and applies from that cycle onward.'
                );
            }
        }

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
            $anyStructure = SalaryStructure::where('employee_id', $employee->id)
                ->orderByDesc('effective_from')->orderByDesc('version')
                ->first(['status', 'effective_from', 'monthly_gross']);

            [$holdReason, $detail] = match (true) {
                $anyStructure === null => [
                    'Missing salary structure',
                    ((float) ($employee->annual_salary ?? 0) > 0
                        ? 'No salary structure on file. The annual salary of ₹'
                            . number_format((float) $employee->annual_salary, 2)
                            . ' on the employee record is a total, not a breakup — payroll cannot'
                            . ' decide how it splits into Basic, HRA and allowances.'
                            . ' Save an active salary structure (Compensation → Salary Setup) and regenerate.'
                        : 'No salary structure and no annual salary on file — nothing to pay.'),
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

        $empWorkingDays       = $this->employeeWorkingDays(
            $employee,
            $period->period_start->copy(),
            $period->period_end->copy(),
        );
        $effectiveWorkingDays = (float) $this->calendarDaysInWindow($winStart, $winEnd);

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
        $leave = $this->leaveAggregates($employee, $winStart, $winEnd);
        $holidayDays = $this->holidayAggregates($employee, $winStart, $winEnd);

        $presentDays   = $att['present'];
        $lateMarks     = $att['late'];
        $missingPunch  = $att['missing'];
        $paidLeaveDays = $leave['paid'];
        $unpaidLeaveDays = $leave['unpaid'];

        if ($missingPunch > 0) {
            $exceptions = $this->withException(
                $exceptions,
                'info',
                "{$missingPunch} day(s) with a missing punch — verify attendance before approving."
            );
        }

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
                'info',
                count($shortDays) . " day(s) short of this branch's "
                    . $this->trimNum((float) $shortPolicy['half_day_below']) . "h minimum: {$detail}{$more}."
            );
        }

        $holidaySet   = $this->holidayDateSet($employee, $winStart, $winEnd);
        $workedDates  = $att['worked_dates'] ?? [];
        $paidDates    = $leave['paid_dates'] ?? [];
        $unpaidDates  = $leave['unpaid_dates'] ?? [];
        $weeklyOffLbl = (string) ($employee->weekly_off ?? '');

        $paidDays    = 0.0;
        $overlapDays = 0.0;
        $weekOffPaidDays = 0.0;
        $workedOnWorkingDays = 0.0;
        for ($d = $winStart->copy(); $d->lte($winEnd); $d->addDay()) {
            $isWeekOff = \App\Support\WeekOff::isOff($weeklyOffLbl, $d);
            $ds       = $d->toDateString();
            $worked   = (float) ($workedDates[$ds] ?? 0);
            if (!$isWeekOff) {
                $workedOnWorkingDays += $worked;
            }
            $paidLv   = (float) ($paidDates[$ds] ?? 0);
            $unpaidLv = (float) ($unpaidDates[$ds] ?? 0);
            $holiday  = isset($holidaySet[$ds]) ? 1.0 : 0.0;
            $weekOff  = $isWeekOff ? 1.0 : 0.0;

            $credited = $worked + $paidLv + $holiday + $weekOff;
            $dayCredit = max(0.0, min(1.0 - $unpaidLv, $credited));
            $paidDays += $dayCredit;

            if ($isWeekOff) $weekOffPaidDays += $dayCredit;

            $leaveClaim = $paidLv + $unpaidLv;
            if ($worked > 0 && $leaveClaim > 0 && $worked + $leaveClaim > 1.001) {
                $overlapDays += $worked + $leaveClaim - 1;
            }
        }
        $paidDays    = round(min($effectiveWorkingDays, $paidDays), 2);
        $weekOffPaidDays = round(min($paidDays, $weekOffPaidDays), 2);
        $overlapDays = round($overlapDays, 2);
        if ($overlapDays > 0) {
            $exceptions = $this->withException(
                $exceptions,
                'info',
                "{$overlapDays} day(s) where attendance and an approved leave request cover the same date. "
                    . "The leave request has been taken as the truth for pay — verify the punches before approving."
            );
        }

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
        $lopDays = max(0, round($effectiveWorkingDays - $paidDays, 2));

        $lopToday = Carbon::today();
        if ($winEnd->gt($lopToday)) {
            $elapsedWorkingDays = $winStart->gt($lopToday)
                ? 0.0
                : (float) $this->employeeWorkingDays($employee, $winStart->copy(), $lopToday->copy());
            $cappedLop = max(0, round($elapsedWorkingDays - $paidDays, 2));

            if ($cappedLop < $lopDays) {
                $remaining = round($effectiveWorkingDays - $elapsedWorkingDays, 2);
                $exceptions = $this->withException(
                    $exceptions,
                    'info',
                    "Cycle still in progress — {$remaining} working day(s) of this month have not happened yet "
                        . 'and are not charged as loss of pay. Re-run payroll once the month is complete.'
                );
                $lopDays = $cappedLop;
            }
        }
        $sandwichLop = (float) ($leave['sandwich_lop'] ?? 0);
        if ($sandwichLop > 0) {
            $lopDays = round($lopDays + $sandwichLop, 2);
            $exceptions = $this->withException(
                $exceptions,
                'info',
                "{$sandwichLop} off-day(s) sandwiched inside unpaid leave charged as loss of pay."
            );
        }

        $lateBranch  = $employee->relationLoaded('branch') ? $employee->getRelation('branch') : $employee->branch;
        $latePolicy  = $lateBranch
            ? $lateBranch->lateMarkPolicy()
            : \App\Models\Branch::normalizeLateMarkPolicy(null);
        $absenceLopDays = $lopDays;

        $lateConsecutive = (bool) ($latePolicy['consecutive'] ?? false);
        if ($latePolicy['enabled'] && $lateConsecutive) {
            $ded = \App\Models\Branch::LATE_MARK_DEDUCTIONS[$latePolicy['deduction']];
            $run = 0; $blocks = 0;
            foreach (($att['late_seq'] ?? []) as $isLate) {
                if ($isLate) { $run++; if ($run % $latePolicy['count'] === 0) $blocks++; }
                else { $run = 0; }
            }
            $lateLopDays = $blocks * $ded;
        } else {
            $lateLopDays = \App\Models\Branch::lateMarkLopFor($latePolicy, (int) $lateMarks);
        }
        $lateUnit    = $latePolicy['deduction'] === 'full_day' ? 'full day' : 'half day';
        if ($lateLopDays > 0) {
            $lopDays += $lateLopDays;
            $lateBlock = $latePolicy['count'] === 1 ? 'late mark' : 'late marks';
            $lateMode  = $lateConsecutive ? 'consecutive ' : '';
            $lateDays  = $this->trimNum($lateLopDays);
            $exceptions = $this->withException(
                $exceptions,
                'info',
                "{$lateMarks} late marks → {$lateDays} day" . ($lateLopDays == 1 ? '' : 's') . " LOP "
                    . "(branch rule: every {$latePolicy['count']} {$lateMode}{$lateBlock} = {$lateUnit}; "
                    . "verify hours covered before approving)."
            );
        } elseif ($lateMarks > 0) {
            $exceptions = $this->withException($exceptions, 'info', $latePolicy['enabled']
                ? "{$lateMarks} late mark(s) — under this branch's threshold of {$latePolicy['count']}, no pay deducted."
                : "{$lateMarks} late mark(s) — this branch does not deduct pay for late marks.");
        }
        $lopDays = min($effectiveWorkingDays + $sandwichLop, $lopDays);
        $absenceLopDays = min($effectiveWorkingDays + $sandwichLop, $absenceLopDays);
        $lateLopCharged = max(0, round($lopDays - $absenceLopDays, 2));

        $paidDaysForPay = max(0, round($effectiveWorkingDays - $lopDays, 2));
        $paidDays       = max(0, round($effectiveWorkingDays - $absenceLopDays, 2));

        if ($unpaidLeaveDays > $lopDays + 0.001) {
            $notCharged = round($unpaidLeaveDays - $lopDays, 2);
            $exceptions = $this->withException(
                $exceptions,
                'info',
                "{$notCharged} unpaid-leave day(s) not charged as LOP — the employee is also marked present/paid-leave on those dates. Verify attendance before approving."
            );
        }

        $proratedGross = round($gross * $proration, 2);
        $proratedBasic = round($basic * $proration, 2);

        $totalMonthDays = max(1, $calDays);

        $lopBranch = $employee->relationLoaded('branch') ? $employee->getRelation('branch') : $employee->branch;
        $lopPolicy = $lopBranch
            ? $lopBranch->lopPolicy()
            : \App\Models\Branch::normalizeLopPolicy(null);
        $lopPerDay = \App\Models\Branch::lopPerDayFor(
            $lopPolicy,
            $basic,
            $gross,
            $totalMonthDays,
            (float) $empWorkingDays,
        );
        $earnPerDay = $effectiveWorkingDays > 0
            ? $proratedGross / $effectiveWorkingDays
            : 0.0;
        $lopRateCapped = $earnPerDay > 0 && $lopPerDay > $earnPerDay;
        if ($lopRateCapped) {
            $lopPerDay = round($earnPerDay, 4);
            $exceptions = $this->withException(
                $exceptions,
                'info',
                'Loss of pay charged at this cycle\'s own per-day salary ('
                . number_format($lopPerDay, 2) . '), not the branch rate — a pro-rated cycle earns less per day than the monthly policy assumes.'
            );
        }
        $lopAmount = round($lopPerDay * $lopDays, 2);

        $lopChargedOnGross = ($lopPolicy['basis'] ?? 'basic') === 'gross';
        $lopAmount = min($lopAmount, $lopChargedOnGross ? $proratedGross : $proratedBasic);

        $earnedGross  = round($proratedGross - $lopAmount, 2);
        $earnedFactor = $proratedGross > 0 ? min(1, $earnedGross / $proratedGross) : 0;
        $earnedBasic  = $lopChargedOnGross
            ? round($proratedBasic * $earnedFactor, 2)
            : round(max(0, $proratedBasic - $lopAmount), 2);

        $earnings = [];
        foreach ($earnComponents as $c) {
            $code = (string) ($c['code'] ?? 'comp');
            $full = $structureMonthly[$code] ?? round((float) ($c['amount'] ?? 0), 2);

            if ($full == 0.0 && round((float) ($c['amount'] ?? 0), 2) == 0.0) {
                continue;
            }

            $earnings[] = [
                'code'   => $code,
                'label'  => $c['label'] ?? 'Component',
                'amount' => round(((float) ($c['amount'] ?? 0)) * $proration, 2),
                'monthly' => $full,
            ];
        }

        if ($earnings && $proration < 1) {
            $lineSum = round(array_sum(array_column($earnings, 'amount')), 2);
            $residue = round(round($gross * $proration, 2) - $lineSum, 2);
            if (abs($residue) > 0.001) {
                $biggest = 0;
                foreach ($earnings as $i => $line) {
                    if ((float) $line['amount'] > (float) $earnings[$biggest]['amount']) {
                        $biggest = $i;
                    }
                }
                $earnings[$biggest]['amount'] = round((float) $earnings[$biggest]['amount'] + $residue, 2);
            }
        }
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

            if (!$rate['rate_found'] && $rate['rate_name'] !== null) {
                $exceptions = $this->withException($exceptions, 'info', sprintf(
                    'Overtime rate "%s" is not an active rate in the Overtime Rate master — '
                        . 'overtime paid at 1× hourly instead. Fix the rate or the employee\'s '
                        . 'overtime setting before approving.',
                    $rate['rate_name'],
                ));
            }
        } elseif ($otDetected['hours'] > 0) {
            $exceptions = $this->withException($exceptions, 'info', sprintf(
                'Attendance shows %s OT hr past the %s shift end across %d day(s); %s hr recorded and paid.',
                $this->trimNum($otDetected['hours']),
                $otDetected['shift_end'],
                $otDetected['days'],
                $this->trimNum($ot['hours']),
            ));
        }

        if (($ot['hours'] > 0 || $otDetected['hours'] > 0) && $basic <= 0 && $gross > 0) {
            $exceptions = $this->withException(
                $exceptions,
                'blocking',
                'Overtime hours recorded but this employee has no Basic component — overtime is priced off basic, so it computes to ₹0. Fix the salary structure before paying.'
            );
        }

        if ($otDetected['capped_days'] > 0) {
            $exceptions = $this->withException($exceptions, 'info', sprintf(
                '%d day(s) show more than 12 hr past the shift end — likely a missed punch-out. Verify the attendance; the overtime is capped at 12 hr for those days.',
                $otDetected['capped_days'],
            ));
        }

        $extraEarnings = [];
        foreach ($ot['lines'] as $line) {
            $earnings[] = $line;
            $extraEarnings[] = $line;
        }
        foreach ($this->adjustmentLines($employee->id, $period, ['bonus', 'incentive']) as $line) {
            $earnings[] = $line;
            $extraEarnings[] = $line;
        }

        $overtimeAmount = $ot['amount'];
        $overtimeHours  = $ot['hours'];
        $bonusAmount    = $this->approvedBonusAmount($employee->id, $period);

        $cycleEarnings = round($proratedGross + $overtimeAmount + $bonusAmount, 2);

        $pf  = 0;
        $pfManual = $this->structureDeduction($structDeductions, 'pf');

        $pfDayBasis = $calDays > 0
            ? min(1, max(0, $paidDaysForPay) / $calDays)
            : null;

        if ($pfManual > 0) {
            $pf = $pfDayBasis === null
                ? round($pfManual, 2)
                : round($pfManual * $pfDayBasis, 2);
        } elseif ($pfApplicable && $earnedBasic > 0) {
            $pfEarnedBasic = $pfDayBasis === null
                ? $earnedBasic
                : round($basic * $pfDayBasis, 2);

            $pfCeiling = $pfDayBasis === null
                ? self::PF_WAGE_CEILING
                : round(self::PF_WAGE_CEILING * $pfDayBasis, 2);

            $pfBase = strtolower((string) ($employee->pf_type ?? '')) === 'standard'
                ? $pfEarnedBasic
                : min($pfEarnedBasic, $pfCeiling);
            $pf = round(max(0, $pfBase) * self::PF_RATE, 2);
            if ($this->employmentTypeUnknown($employee)) {
                $exceptions = $this->withException(
                    $exceptions,
                    'info',
                    'No employment type on file — PF charged on the assumption this employee is full-time. '
                        . 'Set Employment Type on the employee record to confirm.'
                );
            }
            if ($structure && $structure->basicIsAssumed()) {
                $exceptions = $this->withException(
                    $exceptions,
                    'info',
                    'No "Basic" earning row on the salary structure — PF was charged on 50% of gross '
                        . '(₹' . number_format($basic, 2) . ') as an assumed basic. '
                        . 'Rename the basic component to "Basic Salary" in Salary Setup so PF is charged on the real figure.'
                );
            }
        } elseif ($pfApplicable && $earnedBasic <= 0 && $earnedGross > 0) {
            $exceptions = $this->withException(
                $exceptions,
                'info',
                'PF is applicable but no PF was deducted — the basic pay for this cycle worked out to zero. '
                    . 'Check the earning components on the salary structure.'
            );
        }
        $esiManual = $this->structureDeduction($structDeductions, 'esi');
        $esi = 0;
        if ($esiManual > 0) {
            $esi = $esiManual;
        } elseif ($esiApplicable && $earnedGross > 0 && $earnedGross <= self::ESI_GROSS_LIMIT) {
            $esi = round($earnedGross * self::ESI_RATE, 2);
        }

        $ptManual = $this->structureDeduction($structDeductions, 'pt');
        $pt = 0;
        if ($ptManual > 0) {
            $pt = $ptManual;
        } elseif ($ptApplicable && $earnedGross > 0) {
            $pt = $this->professionalTax($employee, $gross, $period->month);
        }

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

        $statutoryCodes = ['pf', 'esi', 'pt', 'tds'];
        $other = 0;
        foreach ($structDeductions as $d) {
            $code = strtolower(trim((string) ($d['code'] ?? '')));
            if (in_array($code, $statutoryCodes, true)) {
                continue;
            }
            $label = (string) ($d['label'] ?? '');
            foreach ($statutoryCodes as $sc) {
                if (self::deductionLabelMatches($label, $sc)) {
                    continue 2;
                }
            }
            $other += round(((float) ($d['amount'] ?? 0)) * $earnedFactor, 2);
        }
        $adjDeductions = $this->approvedDeductionAdjustments($employee->id, $period);
        $other += $adjDeductions;

        $netBeforeRecovery = $earnedGross - ($pf + $esi + $pt + $tds + $other);
        $foiCap = round(max(0, $netBeforeRecovery) * 0.70, 2);
        $totalRec   = $this->advanceRecovery($employee->id, $period, $foiCap);
        $loanRec    = $this->recoveredOfKind('loan');
        $advanceRec = round($totalRec - $loanRec, 2);
        $carried = round(array_sum(array_column($this->lastRecoveryBreakdown, 'carried')), 2);
        if ($carried > 0.01) {
            $exceptions = $this->withException(
                $exceptions,
                'info',
                'Advance recovery exceeded the 70% FOI headroom this cycle — ₹'
                    . number_format($carried, 2) . ' carried to the next cycle.'
            );
        }

        $totalDeductions = round($pf + $esi + $pt + $tds + $lopAmount + $advanceRec + $loanRec + $other, 2);
        $netPay = round($earnedGross + $overtimeAmount + $bonusAmount - ($pf + $esi + $pt + $tds + $advanceRec + $loanRec + $other), 2);
        if ($netPay < 0) {
            $exceptions = $this->withException(
                $exceptions,
                'info',
                'Deductions exceeded earned pay — net floored to ₹0; carry the balance to the next cycle.'
            );
            $netPay = 0;
        }
        if ($workedOnWorkingDays <= 0 && $effectiveWorkingDays > 0 && $lopDays > 0) {
            $explained = $unpaidLeaveDays > 0
                && $unpaidLeaveDays + 0.005 >= $effectiveWorkingDays;
            $exceptions = $this->withException(
                $exceptions,
                'info',
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
                'info',
                'Zero net pay — employee was fully absent / on loss-of-pay this cycle. Verify before processing.'
            );
        }

        $deductions = [];
        if ($pt > 0)          $deductions[] = ['code' => 'pt',  'label' => 'Professional Tax', 'amount' => $pt];
        if ($pf > 0)          $deductions[] = ['code' => 'pf',  'label' => 'Provident Fund (12%)', 'amount' => $pf];
        if ($esi > 0)         $deductions[] = ['code' => 'esi', 'label' => 'ESI', 'amount' => $esi];
        if ($tds > 0)         $deductions[] = ['code' => 'tds', 'label' => 'Income Tax (TDS)', 'amount' => $tds];
        if ($lopAmount > 0)   $deductions[] = ['code' => 'lop', 'label' => 'Loss of Pay', 'amount' => $lopAmount];
        if ($advanceRec > 0 || $loanRec > 0) {
            $advLines = array_values(array_filter(
                $this->lastRecoveryBreakdown,
                fn($b) => ($b['recovered'] ?? 0) > 0
            ));
            if (!empty($advLines)) {
                foreach ($advLines as $b) {
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
        $structOther = round($other - $adjDeductions, 2);
        if ($structOther > 0) $deductions[] = ['code' => 'other', 'label' => 'Other Deductions', 'amount' => $structOther];
        foreach ($this->adjustmentLines($employee->id, $period, ['deduction']) as $line) {
            $deductions[] = $line;
        }

        if (!$base['bank_verified']) {
            $exceptions = $this->withException(
                $exceptions,
                'blocking',
                'Bank details missing/invalid — payment blocked until corrected.'
            );
        }

        $hasBlocking = collect($exceptions)->contains(fn($e) => $e['type'] === 'blocking');
        $status = $hasBlocking ? 'On Hold' : 'Ready';

        $attSource = $att['rows'] > 0 ? 'Biometric' : 'Manual';

        return array_merge($base, [
            'working_days'   => $effectiveWorkingDays,
            'present_days'   => $presentDays,
            'paid_days'      => $paidDays,
            'weekoff_days'   => $weekOffDays,
            'weekoff_paid_days' => $weekOffPaidDays,
            'holiday_days'   => $holidayDays,
            'lop_days'       => $lopDays,
            'late_lop_days'  => $lateLopCharged,
            'paid_leave_days'   => $paidLeaveDays,
            'unpaid_leave_days' => $unpaidLeaveDays,
            'late_marks'     => $lateMarks,
            'missing_punches' => $missingPunch,
            'overtime_hours' => $overtimeHours,
            'att_source'     => $attSource,
            'earnings'       => $earnings,
            'deductions'     => $deductions,
            'gross_earnings' => $cycleEarnings,
            'structure_gross' => $proratedGross,
            'monthly_gross_full' => round($gross, 2),
            'monthly_basic_full' => round($basic, 2),
            'proration'          => round($proration, 4),
            'active_days'        => (float) $activeDays,
            'cycle_days'         => (float) $calDays,
            'structure_components' => array_values(array_map(fn($c) => [
                'code'   => $c['code'] ?? 'comp',
                'label'  => $c['label'] ?? 'Component',
                'amount' => round((float) ($c['amount'] ?? 0), 2),
            ], $earnComponents)),
            'extra_earnings' => $extraEarnings,
            'earned_gross'  => $earnedGross,
            'earned_basic'  => $earnedBasic,
            'earned_factor' => round($earnedFactor, 4),
            'lop_per_day'      => $lopPerDay,
            'lop_basis'        => $lopPolicy['basis'],
            'lop_divisor'      => $lopPolicy['divisor'],
            'lop_divisor_days' => $lopRateCapped
                ? (float) max(1, $effectiveWorkingDays)
                : ($lopPolicy['divisor'] === 'working'
                    ? (float) max(1, $empWorkingDays)
                    : (float) max(1, $totalMonthDays)),
            'lop_rate_capped'  => $lopRateCapped,
            'basic'          => $proratedBasic,
            'overtime_amount' => $overtimeAmount,
            'bonus_amount'   => $bonusAmount,
            'pf_employee'    => $pf,
            'esi'            => $esi,
            'pt'             => $pt,
            'tds'            => $tds,
            'lop_amount'     => $lopAmount,
            'advance_recovery' => $advanceRec,
            'loan_recovery'  => $loanRec,
            'other_deductions' => $other,
            'total_deductions' => $totalDeductions,
            'net_pay'        => $netPay,
            'status'         => $status,
            'hold_reason'    => $hasBlocking ? collect($exceptions)->firstWhere('type', 'blocking')['reason'] : null,
            'exceptions'     => $exceptions,
        ]);
    }

    public function activeStructure(Employee $employee, $asOf): ?SalaryStructure
    {
        return SalaryStructure::where('employee_id', $employee->id)
            ->whereIn('status', ['active', 'superseded'])
            ->whereDate('effective_from', '<=', Carbon::parse($asOf))
            ->orderByDesc('effective_from')
            ->orderByDesc('version')
            ->orderByRaw("CASE WHEN status = 'active' THEN 0 ELSE 1 END")
            ->orderByDesc('id')
            ->first();
    }

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
            ->orderByRaw("CASE WHEN status = 'active' THEN 1 ELSE 0 END")
            ->orderBy('id')
            ->get();

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
            $structPf  = (bool) $structure->pf_applicable;
            $structEsi = (bool) $structure->esi_applicable;
            $empPf     = (bool) $employee->pf_eligible;
            $empEsi    = strtolower((string) ($employee->esi_applicable ?? '')) === 'yes';

            if ($empPf && !$structPf) {
                $exceptions = $this->withException(
                    $exceptions,
                    'warning',
                    'PF is marked applicable on the employee record but not on the salary structure in force — no PF deducted. Set PF Applicable in Salary Setup to charge it.'
                );
            }
            if ($empEsi && !$structEsi) {
                $exceptions = $this->withException(
                    $exceptions,
                    'warning',
                    'ESI is marked applicable on the employee record but not on the salary structure in force — no ESI deducted. Set ESI in Salary Setup to charge it.'
                );
            }

            return [
                (float) $structure->monthly_gross,
                (float) $structure->basicAmount(),
                (array) $structure->earnings,
                (array) $structure->deductions,
                $structPf,
                $structEsi,
                (bool) $structure->pt_applicable,
            ];
        }

        return [
            0,
            0,
            [],
            [],
            (bool) $employee->pf_eligible,
            strtolower((string) ($employee->esi_applicable ?? '')) === 'yes',
            true,
        ];
    }

    private function structureDeduction(array $deductions, string $code): float
    {
        foreach ($deductions as $d) {
            if (strtolower(trim((string) ($d['code'] ?? ''))) === $code) {
                return round((float) ($d['amount'] ?? 0), 2);
            }
        }
        foreach ($deductions as $d) {
            if (self::deductionLabelMatches((string) ($d['label'] ?? ''), $code)) {
                return round((float) ($d['amount'] ?? 0), 2);
            }
        }
        return 0;
    }

    private static function deductionLabelMatches(string $label, string $code): bool
    {
        $l = strtolower(trim($label));
        if ($l === '') {
            return false;
        }

        $l = preg_replace('/\s*\((?:[^()]*)\)\s*$/', '', $l);
        $l = preg_replace(
            '/\s*[-–—:]?\s*(employee(\'s)?)?\s*(share|contribution|deduction)?\s*$/',
            '',
            $l,
        );
        $l = preg_replace('/\s*[-–—:]?\s*employee(\'s)?\s*$/', '', $l);
        $l = preg_replace('/^employee(\'s)?\s+/', '', (string) $l);
        $l = trim((string) $l);

        return match ($code) {
            'pf'  => (bool) preg_match('/^(e?pf|provident\s*fund)$/', $l)
                     || (bool) preg_match('/^(e?pf|provident\s*fund)\s+(e?pf|provident\s*fund)$/', $l),
            'esi' => (bool) preg_match('/^(esic?|(employee\s+)?state\s+insurance)$/', $l),
            'pt'  => (bool) preg_match('/^(pt|professional\s*tax|prof\.?\s*tax)$/', $l),
            'tds' => (bool) preg_match('/^(tds|income\s*tax)$/', $l),
            default => false,
        };
    }

    private function employmentTypeUnknown(Employee $employee): bool
    {
        return trim((string) ($employee->employee_type ?? '')) === ''
            && trim((string) ($employee->work_type ?? '')) === '';
    }

    public function holidayDaysFor(Employee $employee, Carbon $start, Carbon $end): float
    {
        return $this->holidayAggregates($employee, $start, $end);
    }

    public function holidayDatesFor(Employee $employee, Carbon $start, Carbon $end): array
    {
        if (!$this->hasTable('holidays')) {
            return [];
        }
        $label = (string) ($employee->weekly_off ?? '');
        $out = [];
        foreach (array_keys($this->holidayDateSet($employee, $start, $end)) as $ds) {
            if (\App\Support\WeekOff::isOff($label, Carbon::parse($ds))) continue;
            $out[] = $ds;
        }
        return $out;
    }

    private function holidayAggregates($employee, Carbon $start, Carbon $end): float
    {
        if (!$this->hasTable('holidays')) {
            return 0.0;
        }
        $count = 0;
        $label = (string) ($employee->weekly_off ?? '');
        foreach (array_keys($this->holidayDateSet($employee, $start, $end)) as $ds) {
            if (\App\Support\WeekOff::isOff($label, Carbon::parse($ds))) continue;
            $count++;
        }

        return (float) $count;
    }

    public function restDayKind(Employee $employee, Carbon $date): ?string
    {
        if (isset($this->holidayDateSet($employee, $date, $date)[$date->toDateString()])) {
            return 'Holiday';
        }

        return \App\Support\WeekOff::isOff((string) ($employee->weekly_off ?? ''), $date)
            ? 'Weekly Off'
            : null;
    }

    private function holidayDateSet($employee, Carbon $start, Carbon $end): array
    {
        if (!$this->hasTable('holidays')) {
            return [];
        }
        $groupId  = $employee->holiday_group_id ?? null;
        $clientId = $employee->client_id ?? null;
        $branchId = $employee->branch_id ?? null;

        $key  = 'hol:' . ($groupId ?? '-') . ':' . ($clientId ?? '-') . ':' . ($branchId ?? '-');
        $rows = $this->masterCache[$key] ??= DB::table('holidays')
            ->whereNull('deleted_at')
            ->where(function ($q) use ($groupId, $clientId, $branchId) {
                $q->where(function ($w) use ($clientId, $branchId) {
                    $w->whereNull('holiday_group_id');
                    $w->where('client_id', $clientId);
                    if ($branchId) {
                        $w->where(fn($b) => $b->whereNull('branch_id')->orWhere('branch_id', $branchId));
                    }
                });
                if ($groupId) {
                    $q->orWhere('holiday_group_id', $groupId);
                }
            })
            ->get(['date', 'is_recurring']);

        $dates = [];
        foreach ($rows as $r) {
            if (!$r->date) continue;
            $d = Carbon::parse($r->date);

            if ($r->is_recurring) {
                foreach (range($start->year, $end->year) as $year) {
                    $anchored = Carbon::create($year, $d->month, $d->day);
                    if ($anchored->gte($start) && $anchored->lte($end)) {
                        $dates[$anchored->toDateString()] = true;
                    }
                }
                continue;
            }

            if ($d->lt($start) || $d->gt($end)) continue;
            $dates[$d->toDateString()] = true;
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
        if (!$this->hasTable('attendances')) {
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
            ->get(['id', 'attendance_date', 'status', 'check_in_at', 'check_out_at', 'shift_start']);

        $shortPolicy   = \App\Models\Branch::normalizeShortHoursPolicy($shortHours ?: null);
        $workedMinutes = $shortPolicy['enabled']
            ? $this->workedMinutesByDate($rows)
            : [];

        $shiftStart = $shiftStart ?: '09:30';

        $present = 0.0;
        $late = 0;
        $missing = 0;
        $workedDates = [];
        $shortDays = [];
        $lateMarkByDate = [];
        foreach ($rows as $r) {
            $status = (string) ($r->status ?? '');
            $hasIn  = !empty($r->check_in_at);
            $hasOut = !empty($r->check_out_at);
            $arrivedLate = false;
            if ($hasIn && in_array(strtolower($status), ['present', 'half day'], true)) {
                $localIn = Carbon::parse($r->check_in_at, 'UTC')->setTimezone(self::DISPLAY_TZ)->format('H:i');
                $dayShift    = trim((string) ($r->shift_start ?? '')) ?: $shiftStart;
                $arrivedLate = $this->minutesBetween($dayShift, $localIn) > \App\Models\Attendance::LATE_GRACE_MINUTES;
            }
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
            }

            if ($worked && $status !== 'Missing In' && $status !== 'Missing Out' && ($hasIn xor $hasOut)) {
                $missing++;
            }

            $credit = round($present - $creditBefore, 2);
            $key    = Carbon::parse($r->attendance_date)->toDateString();
            if ($worked) {
                $lateMarkByDate[$key] = ($status === 'Late') || ($status === 'Half Day' && $arrivedLate);
            }

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
        ksort($lateMarkByDate);
        return [
            'present' => round($present, 2),
            'late' => $late,
            'late_seq' => array_values($lateMarkByDate),
            'missing' => $missing,
            'rows' => $rows->count(),
            'worked_dates' => $workedDates,
            'short_days' => $shortDays,
        ];
    }

    private function workedMinutesByDate($rows): array
    {
        $out = [];
        $ids = [];
        foreach ($rows as $r) {
            $ids[] = $r->id;
        }

        $punchesByAttendance = [];
        if ($ids && $this->hasTable('attendance_punches')) {
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

            $out[$date] = null;
        }

        return $out;
    }

    private function minutesBetween(string $from, string $to): int
    {
        [$fh, $fm] = array_map('intval', explode(':', $from));
        [$th, $tm] = array_map('intval', explode(':', $to));
        return ($th * 60 + $tm) - ($fh * 60 + $fm);
    }

    public function sandwichDaysFor(Employee $employee, $leave): float
    {
        return $this->sandwichBreakdown($employee, $leave)['sandwich'];
    }

    public function sandwichBreakdown(Employee $employee, $leave): array
    {
        if (!\App\Support\SandwichPolicy::appliesTo($employee)) {
            return ['working' => 0.0, 'sandwich' => 0.0, 'dates' => []];
        }

        $from = Carbon::parse($leave->from_date);
        $to   = Carbon::parse($leave->to_date);

        if (($leave->day_type ?? 'full') !== 'full' && $from->isSameDay($to)) {
            return ['working' => 0.5, 'sandwich' => 0.0, 'dates' => []];
        }

        $pad     = \App\Support\SandwichPolicy::LOOKAROUND_DAYS;
        $padFrom = $from->copy()->subDays($pad);
        $padTo   = $to->copy()->addDays($pad);

        $weeklyOffLabel = (string) ($employee->weekly_off ?? '');
        $holidaySet     = $this->holidayDateSet($employee, $padFrom, $padTo);

        $isOff = fn(Carbon $d): bool => \App\Support\WeekOff::isOff($weeklyOffLabel, $d)
            || isset($holidaySet[$d->toDateString()]);

        $approved = \App\Support\SandwichPolicy::approvedLeaveDates((int) $employee->id, $padFrom, $padTo);
        $isLeave  = fn(Carbon $d): bool => isset($approved[$d->copy()->startOfDay()->toDateString()]);

        $working = 0.0;
        for ($d = $from->copy(); $d->lte($to); $d->addDay()) {
            if (!$isOff($d)) $working += 1.0;
        }

        $dates = \App\Support\SandwichPolicy::chargeableOffDays($from, $to, $isOff, $isLeave);

        return [
            'working'  => $working,
            'sandwich' => (float) count($dates),
            'dates'    => $dates,
        ];
    }

    private function leaveAggregates(Employee $employee, Carbon $start, Carbon $end): array
    {
        if (!$this->hasTable('leave_requests')) {
            return ['paid' => 0, 'unpaid' => 0, 'sandwich_lop' => 0, 'paid_dates' => [], 'unpaid_dates' => []];
        }

        $employeeId = $employee->id;
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

        $pad      = \App\Support\SandwichPolicy::LOOKAROUND_DAYS;
        $padStart = $start->copy()->subDays($pad);
        $padEnd   = $end->copy()->addDays($pad);
        $holidaySet = $employee ? $this->holidayDateSet($employee, $padStart, $padEnd) : [];

        $isOff = fn(Carbon $d): bool => \App\Support\WeekOff::isOff($weeklyOffLabel, $d)
            || isset($holidaySet[$d->toDateString()]);

        $sandwichOn = \App\Support\SandwichPolicy::appliesTo($employee);
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
        $sandwichLop = 0.0;
        foreach ($rows as $r) {
            $from = Carbon::parse($r->from_date)->max($start);
            $to   = Carbon::parse($r->to_date)->min($end);
            if ($to->lt($from)) {
                continue;
            }
            $span = 0;
            $spanDates = [];
            for ($d = $from->copy(); $d->lte($to); $d->addDay()) {
                if (!$isOff($d)) {
                    $span++;
                    $spanDates[] = $d->toDateString();
                }
            }

            if ($r->day_type !== 'full' && $from->isSameDay($to)) {
                $span = 0.5;
            }
            if ((float) $r->days > 0 && (float) $r->days < $span) {
                $span = (float) $r->days;
            }
            $per = $spanDates ? round($span / count($spanDates), 2) : 0.0;

            $flag = strtolower((string) ($paidMap[$r->leave_type_id] ?? 'paid'));
            if (in_array($flag, ['unpaid', 'lwp', 'loss of pay', 'loss_of_pay'], true)) {
                $unpaid += $span;
                foreach ($spanDates as $sd) {
                    $unpaidDates[$sd] = round(min(1.0, ($unpaidDates[$sd] ?? 0) + $per), 2);
                }
                if ($sandwichOn && $employee && !$r->sandwich_waived) {
                    foreach ($this->sandwichBreakdown($employee, $r)['dates'] as $sw) {
                        if ($sw >= $windowStart && $sw <= $windowEnd) {
                            $sandwichLop += 1.0;
                        }
                    }
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

    private function leaveTypePaidMap(array $ids): array
    {
        if (empty($ids)) {
            return [];
        }
        foreach (['master_leave_types', 'leave_types'] as $table) {
            if ($this->hasTable($table) && $this->hasColumn($table, 'paid_unpaid')) {
                return DB::table($table)->whereIn('id', $ids)->pluck('paid_unpaid', 'id')->all();
            }
        }
        return [];
    }

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
            $amount = $month === 2 && $row->feb_amount !== null
                ? (float) $row->feb_amount
                : (float) $row->amount;

            return round($amount, 2);
        }

        $this->lastPtNote = "Professional Tax slabs for {$state} do not cover a gross of ₹"
            . number_format($gross, 2) . ' — no PT deducted. Check the bands in Master › PT Slabs.';

        return 0.0;
    }

    private const TDS_SLABS = [
        [400000, 0.00],
        [800000, 0.05],
        [1200000, 0.10],
        [1600000, 0.15],
        [2000000, 0.20],
        [2400000, 0.25],
        [PHP_INT_MAX, 0.30],
    ];

    private const TDS_STANDARD_DEDUCTION = 75000;

    private const TDS_REBATE_CEILING = 1200000;

    private const TDS_CESS_RATE = 0.04;

    private ?string $lastTdsNote = null;

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

        if ($taxable <= self::TDS_REBATE_CEILING) {
            $tax = 0.0;
        }
        if ($tax <= 0) {
            return 0.0;
        }

        $annualTds = round($tax * (1 + self::TDS_CESS_RATE), 2);

        $monthsElapsed  = ((int) $period->month >= 4) ? ((int) $period->month - 3) : ((int) $period->month + 9);
        $monthsRemaining = max(1, 12 - $monthsElapsed + 1);

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

    private function tdsPaidThisFinancialYear(int $employeeId, PayrollPeriod $period): float
    {
        $fyStartYear = ((int) $period->month >= 4) ? (int) $period->year : (int) $period->year - 1;

        return (float) Payslip::query()
            ->where('employee_id', $employeeId)
            ->whereHas('period', function ($q) use ($fyStartYear, $period) {
                $q->where(function ($q2) use ($fyStartYear) {
                    $q2->where('year', $fyStartYear)->where('month', '>=', 4);
                })->orWhere(function ($q2) use ($fyStartYear) {
                    $q2->where('year', $fyStartYear + 1)->where('month', '<=', 3);
                });
                $q->where('id', '!=', $period->id);
            })
            ->sum('tds');
    }

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

    private function ptSlabsFor(Employee $employee, ?string $state): array
    {
        if ($state === null || !$this->hasTable('master_pt_slabs')) {
            return [];
        }

        $ck = "pt:{$state}:{$employee->client_id}:{$employee->branch_id}";
        if (array_key_exists($ck, $this->masterCache)) {
            return $this->masterCache[$ck];
        }

        $rows = DB::table('master_pt_slabs')
            ->whereRaw('LOWER(state) = ?', [mb_strtolower($state)])
            ->where(fn($q) => $q->whereNull('client_id')->orWhere('client_id', $employee->client_id))
            ->where(fn($q) => $q->whereNull('branch_id')->orWhere('branch_id', $employee->branch_id))
            ->whereRaw('LOWER(status) = ?', ['active'])
            ->orderBy('min_gross')
            ->get(['client_id', 'gender', 'min_gross', 'max_gross', 'amount', 'feb_amount'])
            ->all();

        $own = array_values(array_filter($rows, fn($r) => $r->client_id !== null));

        return $this->masterCache[$ck] = ($own !== [] ? $own : $rows);
    }

    private function workState(Employee $employee): ?string
    {
        $branch = $employee->relationLoaded('branch') ? $employee->getRelation('branch') : $employee->branch;
        $state = $branch?->state;
        if (is_string($state) && trim($state) !== '') {
            return trim($state);
        }

        if ($employee->state_id && $this->hasTable('master_states')) {
            $name = DB::table('master_states')->where('id', $employee->state_id)->value('name');
            if (is_string($name) && trim($name) !== '') {
                return trim($name);
            }
        }

        return null;
    }

    private function advanceRecovery(int $employeeId, PayrollPeriod $period, float $cap = INF): float
    {
        $this->lastRecoveryBreakdown = [];
        if (!$this->hasTable('advance_requests')) {
            return 0;
        }
        $hasLedger = $this->hasTable('advance_recovery_ledger');
        $room  = max(0.0, $cap);
        $total = 0.0;

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
                'amount'     => (float) ($r->sanctioned_amount ?? $r->amount),
                'advance_no' => $r->advance_no,
                'kind'       => $this->recoveryKind($r->advance_type),
                'label'      => ($this->recoveryKind($r->advance_type) === 'loan' ? 'Loan Recovery – ' : 'Advance Recovery – ')
                    . $type . ($r->advance_no ? ' (' . $r->advance_no . ')' : ''),
            ];
        }

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
                'kind'       => 'advance',
                'label'      => 'Advance Return – ' . $type . ($r->advance_no ? ' (' . $r->advance_no . ')' : ''),
            ];
        }

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
                continue;
            }
            $monthIndex = $start->diffInMonths($period->period_end->copy()->startOfMonth());

            $normalDue = $this->scheduledDueForCycle($s['mode'], $monthIndex, $s['months'], $s['emi'], $amount);

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

            $outstanding = round($amount - $recoveredBefore, 2);
            $due = round(min($normalDue + $arrears, max(0.0, $outstanding)), 2);
            if ($due <= 0.0) {
                continue;
            }

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

    private function scheduledDueForCycle(?string $mode, int $monthIndex, int $months, float $emi, float $amount): float
    {
        if ($monthIndex < 0) {
            return 0.0;
        }
        $hasEmi = in_array($mode, ['emi', 'bimonthly'], true) && ($emi > 0 || $months > 0);
        if (!$hasEmi) {
            return $monthIndex === 0 ? $amount : 0.0;
        }
        $n   = max(1, $months);
        $per = $emi > 0 ? $emi : round($amount / $n, 2);
        if ($mode === 'bimonthly') {
            if ($monthIndex % 2 !== 0) {
                return 0.0;
            }
            return intdiv($monthIndex, 2) < $n ? $per : 0.0;
        }
        return $monthIndex < $n ? $per : 0.0;
    }

    private function recoveryKind(?string $advanceType): string
    {
        return str_contains(strtolower((string) $advanceType), 'loan') ? 'loan' : 'advance';
    }

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

    private function advanceTypeLabel(?string $type, ?string $other): string
    {
        $t = trim((string) ($type === 'Other' ? ($other ?: 'Advance') : ($type ?: 'Advance')));
        return $t !== '' ? $t : 'Advance';
    }

    private function recordRecoveryLedger(PayrollPeriod $period, int $employeeId, array $breakdown): void
    {
        if (empty($breakdown) || !$this->hasTable('advance_recovery_ledger')) {
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
            $minutes += 24 * 60;
        }
        return $minutes > 0 ? round($minutes / 60, 2) : self::DEFAULT_SHIFT_HOURS;
    }

    private function overtimeMultiplier(Employee $employee): array
    {
        $name = trim((string) ($employee->overtime ?? ''));
        $unset = $name === '' || strcasecmp($name, 'Not Applicable') === 0;
        $none  = ['name' => $unset ? null : $name, 'multiplier' => 1.0, 'found' => false];

        if ($unset || !$this->hasTable('master_overtime_rates')) {
            return $none;
        }

        $row = DB::table('master_overtime_rates')
            ->whereRaw('LOWER(rate_name) = ?', [mb_strtolower($name)])
            ->where(fn($q) => $q->whereNull('client_id')->orWhere('client_id', $employee->client_id))
            ->where(fn($q) => $q->whereNull('branch_id')->orWhere('branch_id', $employee->branch_id))
            ->whereRaw('LOWER(status) = ?', ['active'])
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

    public function overtimeRate(Employee $employee, float $base, float $workingDays): array
    {
        $shiftHours = $this->shiftHours($employee);
        $days       = $workingDays > 0 ? $workingDays : 1.0;
        $base       = max(0.0, $base);
        $hourly     = round($shiftHours > 0 ? $base / $days / $shiftHours : 0.0, 2);
        $policy     = $this->overtimeMultiplier($employee);

        return [
            'rate_name'      => $policy['name'],
            'multiplier'     => $policy['multiplier'],
            'rate_found'     => $policy['found'],
            'base'           => round($base, 2),
            'basis'          => 'basic',
            'working_days'   => $days,
            'shift_hours'    => $shiftHours,
            'hourly'         => $hourly,
            'effective_rate'       => round($hourly * $policy['multiplier'], 2),
            'effective_rate_exact' => $hourly * $policy['multiplier'],
        ];
    }

    public function overtimeHoursFromAttendance(Employee $employee, Carbon $start, Carbon $end): array
    {
        [$shiftStart, $shiftEnd] = $employee->resolveShiftWindow();
        $shiftStart = $shiftStart ?: self::DEFAULT_SHIFT_START;
        $shiftEnd   = $shiftEnd   ?: self::DEFAULT_SHIFT_END;
        $overnight  = $this->minutesBetween($shiftStart, $shiftEnd) <= 0;

        $blank = [
            'hours' => 0.0,
            'days' => 0,
            'capped_days' => 0,
            'shift_end' => $shiftEnd,
            'applicable' => $employee->overtimeApplicable(),
            'detail' => []
        ];
        if (!$employee->overtimeApplicable() || !$this->hasTable('attendances')) {
            return $blank;
        }

        $rows = DB::table('attendances')
            ->where('employee_id', $employee->id)
            ->whereNull('deleted_at')
            ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])
            ->whereNotNull('check_out_at')
            ->orderBy('attendance_date')
            ->get(['attendance_date', 'status', 'check_in_at', 'check_out_at', 'shift_start', 'shift_end']);

        $restDays = $this->holidayDateSet($employee, $start, $end);
        $weeklyOff = (string) ($employee->weekly_off ?? '');

        $minutes = 0;
        $days    = 0;
        $capped  = 0;
        $detail  = [];

        foreach ($rows as $r) {
            $status = strtolower(trim((string) ($r->status ?? '')));
            if (in_array($status, ['absent', 'leave', 'weekly off', 'holiday'], true)) {
                continue;
            }

            $date = substr((string) $r->attendance_date, 0, 10);

            $dayShiftStart = trim((string) ($r->shift_start ?? '')) ?: $shiftStart;
            $dayShiftEnd   = trim((string) ($r->shift_end   ?? '')) ?: $shiftEnd;
            $dayOvernight  = $this->minutesBetween($dayShiftStart, $dayShiftEnd) <= 0;

            $isRestDay = isset($restDays[$date])
                || \App\Support\WeekOff::isOff($weeklyOff, Carbon::parse($date));
            if ($isRestDay) {
                if (empty($r->check_in_at)) {
                    continue;
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
                    'shift_end' => $dayShiftEnd,
                    'rest_day'  => true,
                    'punch_out' => $out->format('H:i'),
                    'minutes'   => $mins,
                    'hours'     => round($mins / 60, 2),
                ];
                continue;
            }

            $endAt = Carbon::parse($date . ' ' . $dayShiftEnd, self::DISPLAY_TZ);
            if ($dayOvernight) {
                $endAt->addDay();
            }
            $out  = Carbon::parse($r->check_out_at, 'UTC')->setTimezone(self::DISPLAY_TZ);
            $mins = intdiv($out->getTimestamp() - $endAt->getTimestamp(), 60);

            if ($mins <= 0) {
                continue;
            }
            $nextShiftStart = Carbon::parse($date . ' ' . $dayShiftStart, self::DISPLAY_TZ)->addDay();
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
                'shift_end' => $dayShiftEnd,
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
            'applicable'     => $detected['applicable'],
            'detected_hours' => $detected['hours'],
            'days'           => $detected['days'],
            'capped_days'    => $detected['capped_days'],
            'detail'         => $detected['detail'],
            'rate'           => $rate,
            'amount'         => round($detected['hours'] * $rate['effective_rate_exact'], 2),
        ];
    }

    public function overtimeRateForMonth(Employee $employee, int $month, int $year): array
    {
        $start = Carbon::create($year, $month, 1)->startOfDay();
        $end   = (clone $start)->endOfMonth()->startOfDay();

        $workingDays = PayrollPeriod::query()
            ->where('month', $month)
            ->where('year', $year)
            ->when($employee->client_id, fn($q) => $q->where('client_id', $employee->client_id))
            ->when($employee->branch_id, fn($q) => $q->where(fn($w) => $w->whereNull('branch_id')->orWhere('branch_id', $employee->branch_id)))
            ->orderByRaw('branch_id IS NULL')
            ->value('working_days');

        $exceptions = [];
        $structure  = $this->activeStructure($employee, $end);
        [, $basic] = $this->resolveCompensation($employee, $structure, $exceptions);

        return $this->overtimeRate(
            $employee,
            (float) $basic,
            (float) ($workingDays ?: $this->defaultWorkingDays($start, $end)),
        );
    }

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
                $rowRate   = $override ?? $rate['effective_rate_exact'];
                $rowAmount = round($rowHours * $rowRate, 2);
                $hours    += $rowHours;
                if ($override === null) {
                    $usedDerivedRate = true;
                }
            } else {
                $rowAmount = round((float) $r->amount, 2);
            }

            $amount += $rowAmount;
            $lines[] = [
                'code'   => 'overtime',
                'label'  => $r->label ?: 'Overtime',
                'amount' => $rowAmount,
            ] + ($rowHours > 0 ? [
                'hours'      => $rowHours,
                'rate'       => round($override ?? $rate['effective_rate_exact'], 2),
                'hourly'     => $override === null ? $rate['hourly'] : null,
                'multiplier' => $override === null ? $rate['multiplier'] : null,
                'rate_name'  => $override === null && $rate['rate_found'] ? $rate['rate_name'] : null,
            ] : []);
        }

        $amount = round($amount, 2);

        if ($usedDerivedRate) {
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
                $exceptions[] = ['type' => 'info', 'reason' => $rate['rate_name']
                    ? "Overtime rate \"{$rate['rate_name']}\" is not an Active rate in Master › Overtime (OT) — overtime paid at 1× hourly. Verify before approving."
                    : 'Overtime hours recorded but no Overtime (OT) rate is assigned to this employee — paid at 1× hourly. Assign a rate in the employee\'s Leave & Attendance step.'];
            }
        }

        return ['hours' => round($hours, 2), 'amount' => $amount, 'lines' => $lines, 'exceptions' => $exceptions];
    }

    private function approvedOvertimeRows(int $employeeId, PayrollPeriod $period): array
    {
        if (!$this->hasTable('payroll_adjustments')) {
            return [];
        }
        return DB::table('payroll_adjustments')
            ->where('employee_id', $employeeId)
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

    private function approvedBonusAmount(int $employeeId, PayrollPeriod $period): float
    {
        return $this->approvedAdjustments($employeeId, $period, ['bonus', 'incentive']);
    }

    private function approvedDeductionAdjustments(int $employeeId, PayrollPeriod $period): float
    {
        return $this->approvedAdjustments($employeeId, $period, ['deduction']);
    }

    private function approvedAdjustments(int $employeeId, PayrollPeriod $period, array $types): float
    {
        if (!$this->hasTable('payroll_adjustments')) {
            return 0;
        }
        return (float) DB::table('payroll_adjustments')
            ->where('employee_id', $employeeId)
            ->when($period->client_id, fn($q) => $q->where('client_id', $period->client_id))
            ->when($period->branch_id, fn($q) => $q->where(fn($w) => $w->whereNull('branch_id')->orWhere('branch_id', $period->branch_id)))
            ->where('month', (int) $period->month)
            ->where('year', (int) $period->year)
            ->where('status', 'approved')
            ->whereIn('type', $types)
            ->whereNull('deleted_at')
            ->sum('amount');
    }

    private function adjustmentLines(int $employeeId, PayrollPeriod $period, array $types): array
    {
        if (!$this->hasTable('payroll_adjustments')) {
            return [];
        }
        return DB::table('payroll_adjustments')
            ->where('employee_id', $employeeId)
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

    private function masterNameCaches(): array
    {
        $departments = [];
        $designations = [];
        foreach ([['master_departments', 'departments'], ['master_designations', 'designations']] as [$table, $key]) {
            if ($this->hasTable($table) && $this->hasColumn($table, 'name')) {
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

    private function trimNum(float $n): string
    {
        $s = number_format($n, 2);
        return str_contains($s, '.') ? rtrim(rtrim($s, '0'), '.') : $s;
    }
}
