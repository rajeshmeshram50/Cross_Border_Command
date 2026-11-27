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

class PayrollController extends Controller
{
    public function __construct(
        private PayrollService $payroll,
        private \App\Services\PayslipPdfService $pdf,
    ) {}

    private function ctx(Request $request): array
    {
        $user = $request->user();
        return [
            'user_id'   => $user?->id,
            'client_id' => $user?->client_id,
            'branch_id' => $this->effectiveBranchId($request, $user),
        ];
    }

    private function effectiveBranchId(Request $request, $user): ?int
    {
        if (!$user) return null;
        $requested = $request->integer('branch_id') ?: null;

        if ($user->user_type === 'branch_user' && $user->branch_id) {
            return (int) $user->branch_id;
        }
        return $requested ?: ($user->branch_id ?: null);
    }

    private function canManage(Request $request): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin'], true)) return true;
        if ($user->user_type === 'employee') return false;
        $perm = $user->permissions['hr.payroll'] ?? null;
        if (is_array($perm) && (($perm['can_edit'] ?? false) || ($perm['can_approve'] ?? false))) return true;
        return $user->user_type === 'branch_user';
    }

    private function selfOnlyEmployeeId(Request $request): ?int
    {
        $user = $request->user();
        if (!$user || $user->user_type !== 'employee') {
            return null;
        }

        return (int) ($user->employee_id ?? 0);
    }

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

        $end = $period->period_end
            ? ($period->period_end instanceof Carbon
                ? $period->period_end->copy()
                : Carbon::parse($period->period_end))
            : $start->copy()->endOfMonth();

        if ($end->endOfDay()->isFuture()) {
            return response()->json([
                'message' => "Payroll for {$period->label} cannot be processed until the period ends on "
                    . "{$end->format('d M Y')} — attendance for the month is not complete yet.",
            ], 422);
        }

        return null;
    }

    public function cycles(Request $request)
    {
        $ctx = $this->ctx($request);
        $periods = PayrollPeriod::query()
            ->when($ctx['client_id'], fn ($q) => $q->where('client_id', $ctx['client_id']))
            ->when($ctx['branch_id'], fn ($q) => $q->where('branch_id', $ctx['branch_id']))
            ->get()
            ->keyBy(fn ($p) => $p->year . '-' . $p->month);

        $latestRuns = $periods->isEmpty()
            ? collect()
            : PayrollRun::whereIn('payroll_period_id', $periods->pluck('id'))
                ->get()
                ->groupBy('payroll_period_id')
                ->map(fn ($g) => $g->sortByDesc('id')->first());

        $paidRunIds = $latestRuns->isEmpty()
            ? collect()
            : Payslip::whereIn('payroll_run_id', $latestRuns->pluck('id'))
                ->where('status', 'Paid')
                ->distinct()
                ->pluck('payroll_run_id')
                ->flip();

        $out = [];
        $cursor = now()->startOfMonth()->subMonths(11);
        for ($i = 0; $i < 13; $i++) {
            $m = (int) $cursor->month;
            $y = (int) $cursor->year;
            $existing = $periods->get("$y-$m");

            $isFuture = $cursor->copy()->startOfMonth()->isFuture();

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
                'is_future'   => $isFuture,
                'blocked_by'  => null,
                'run_status'  => $existingRun?->status,
                'run_locked'  => (bool) $runLocked,
                'can_reopen'  => (bool) $runLocked
                    && $existingRun->status !== 'paid'
                    && ($existing?->status !== 'locked')
                    && !$paidRunIds->has($existingRun->id),
                'partially_paid' => (bool) $runLocked
                    && $existingRun->status !== 'paid'
                    && $paidRunIds->has($existingRun->id),
                'processable' => !$isFuture && !$runLocked,
            ];
            $cursor->addMonth();
        }
        return response()->json(['data' => $out]);
    }

    private function cycleDisplayStatus(?PayrollPeriod $period, Carbon $cursor, ?PayrollRun $run = null): string
    {
        if ($period) {
            if ($period->status === 'locked' || ($run && $run->status === 'paid')) {
                return 'Completed';
            }
            if ($period->status === 'processing' || ($run && in_array($run->status, ['generated', 'approved']))) return 'In Progress';
            if ($period->attendance_finalized)       return 'In Progress';
        }
        if ($cursor->isFuture() && !$cursor->isSameMonth(now())) return 'Not Started';

        return ($run && $run->status === 'draft') ? 'In Progress' : 'Not Started';
    }

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
        $slips = $slipQ->orderByDesc('payroll_period_id')->orderBy('employee_name')
            ->limit(8000)
            ->with('run')
            ->get();

        $empIds = $slips->pluck('employee_id')->filter()->unique()->values();
        $pfEligible = \App\Models\Employee::whereIn('id', $empIds)
            ->pluck('pf_eligible', 'id');
        $pfStructure = \App\Models\SalaryStructure::whereIn('employee_id', $empIds)
            ->where('status', 'active')
            ->where('pf_applicable', true)
            ->pluck('employee_id')
            ->flip();
        $periodStatus = $periods->pluck('status', 'id');

        $rows = $slips
            ->map(function ($s) use ($labelMap, $pfEligible, $pfStructure, $periodStatus) {
                $pfAppliesNow = (bool) ($pfEligible[$s->employee_id] ?? false)
                    || isset($pfStructure[$s->employee_id]);
                $frozen = !in_array($s->run?->status, ['draft', 'generated'], true)
                    || ($periodStatus[$s->payroll_period_id] ?? null) === 'locked';
                $pfOnSlip = (float) $s->pf_employee > 0;

                $pfNotice = null;
                if ($frozen && $pfAppliesNow && !$pfOnSlip) {
                    $pfNotice = 'PF is applicable now but this cycle was finalized before it was enabled — '
                        . 'PF applies from the next payroll run.';
                } elseif ($frozen && !$pfAppliesNow && $pfOnSlip) {
                    $pfNotice = 'PF has since been turned off — this finalized cycle keeps the PF it was paid with.';
                } elseif (!$frozen && $pfAppliesNow && !$pfOnSlip) {
                    $pfReason = collect($s->exceptions ?? [])
                        ->pluck('reason')
                        ->first(fn ($r) => stripos((string) $r, 'PF') !== false);
                    $pfNotice = $pfReason
                        ?: 'PF is applicable but no PF was deducted — the basic pay for this cycle worked out '
                            . 'to zero. Check the earning components on the salary structure.';
                }

                return [
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
                'pf_stale'         => $pfNotice !== null,
                'pf_notice'        => $pfNotice,
            ];
            })->values();

        return response()->json(['data' => ['cycles' => $cycles, 'rows' => $rows]]);
    }

    private function encId($employeeId): ?string
    {
        if (!$employeeId) return null;
        try {
            return rtrim(strtr(\Illuminate\Support\Facades\Crypt::encryptString((string) $employeeId), '+/', '-_'), '=');
        } catch (\Throwable $e) {
            return null;
        }
    }

    public function index(Request $request)
    {
        [$month, $year] = $this->resolveMonthYear($request);
        $ctx = $this->ctx($request);

        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);
        $run = $period->runs()->latest('id')->first();
        $selfOnly = $this->selfOnlyEmployeeId($request);
        $slips = Payslip::where('payroll_period_id', $period->id)
            ->when($run, fn ($q) => $q->where('payroll_run_id', $run->id))
            ->when($selfOnly !== null, fn ($q) => $q->where('employee_id', $selfOnly))
            ->orderBy('employee_name')
            ->get();

        $openExits = \App\Support\ExitInProgress::employeeIds(
            null,
            $slips->pluck('employee_id')->filter()->map(fn ($id) => (int) $id)->unique()->values()->all(),
        );
        if (!empty($openExits)) {
            $slips = $slips->reject(
                fn ($s) => in_array((int) $s->employee_id, $openExits, true) && $s->status !== 'Paid',
            )->values();
        }

        $pfNotices = $this->pfNoticeMap($slips, $run, $period);
        $structureGross = $this->structureGrossMap($slips, $period);
        $weekOffs = $this->weekOffDaysMap($slips, $period);
        $attDays = $this->attendanceDaysMap($slips, $period);
        $rows = $slips->map(fn ($p) => $this->serializePayslip(
            $p,
            false,
            null,
            $pfNotices[$p->id] ?? null,
            $structureGross[$p->employee_id] ?? null,
            $weekOffs[$p->employee_id] ?? null,
            $attDays[$p->employee_id] ?? null,
        ));

        $pending = collect();
        if ($run && $selfOnly === null) {
            $covered = $slips->pluck('employee_id')->filter()->map(fn ($i) => (int) $i)->all();
            $pending = $this->payroll->eligibleEmployees($period)
                ->reject(fn ($e) => in_array((int) $e->id, $covered, true))
                ->map(fn ($e) => [
                    'employee_id' => $e->id,
                    'empId'       => $e->emp_code ?: ('EMP-' . $e->id),
                    'name'        => trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')) ?: ($e->display_name ?: 'Employee'),
                    'joined_on'   => $e->date_of_joining,
                ])
                ->values();
        }

        return response()->json([
            'data' => [
                'pending_employees' => $pending,
                'period'  => $this->serializePeriod($period, $run),
                'run'     => $run ? $this->serializeRun($run) : null,
                'rows'    => $rows,
                'counts'  => $this->counts($rows),
                'can'     => [
                    'manage' => $this->canManage($request),
                    'export' => $this->canExport($request),
                ],
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
        if ($run && Payslip::where('payroll_run_id', $run->id)->where('status', 'Paid')->exists()) {
            return response()->json(['message' => 'Some employees are already paid in this cycle — pay the remaining held employees instead of reopening.'], 422);
        }

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

    public function sandwichReview(Request $request)
    {
        [$month, $year] = $this->resolveMonthYear($request);
        $ctx    = $this->ctx($request);
        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);

        $start = Carbon::parse($period->period_start)->startOfDay();
        $end   = Carbon::parse($period->period_end)->endOfDay();

        $items = [];
        $selfOnly = $this->selfOnlyEmployeeId($request);
        foreach ($this->payroll->eligibleEmployees($period) as $employee) {
            if ($selfOnly !== null && (int) $employee->id !== $selfOnly) continue;
            if (!\App\Support\SandwichPolicy::appliesTo($employee)) continue;

            $leaves = \App\Models\LeaveRequest::query()
                ->with('leaveType:id,paid_unpaid')
                ->where('employee_id', $employee->id)
                ->where('status', 'Approved')
                ->whereDate('from_date', '<=', $end->toDateString())
                ->whereDate('to_date', '>=', $start->toDateString())
                ->orderBy('from_date')
                ->get();

            foreach ($leaves as $leave) {
                $bd    = $this->payroll->sandwichBreakdown($employee, $leave);
                $extra = $bd['sandwich'];

                $policyTotal = $bd['working'] + $extra;
                $alreadyCharged = (float) $leave->days >= $policyTotal - 0.001;

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
                    'working_days'   => $bd['working'],
                    'sandwich_days'  => $extra,
                    'days_with_policy' => $bd['working'] + $extra,
                    'charged_via'    => $unpaidLeave ? 'lop' : 'balance',
                    'waived'         => (bool) $leave->sandwich_waived,
                    'waiver_reason'  => $leave->sandwich_waiver_reason,
                ];
            }
        }

        return response()->json(['data' => $items]);
    }

    private function visibleExceptions($payslip): array
    {
        return collect((array) ($payslip->exceptions ?? []))
            ->reject(fn ($e) => stripos((string) ($e['reason'] ?? ''), 'probation') !== false)
            ->reject(fn ($e) => stripos((string) ($e['reason'] ?? ''), 'professional tax') !== false)
            ->values()
            ->all();
    }

    public function preflight(Request $request)
    {
        [$month, $year] = $this->resolveMonthYear($request);
        $ctx = $this->ctx($request);
        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);

        $run = $period->runs()->latest('id')->first();
        $selfOnly = $this->selfOnlyEmployeeId($request);
        $eligibleEmployees = $this->payroll->eligibleEmployees($period);
        if ($selfOnly !== null) {
            $eligibleEmployees = $eligibleEmployees
                ->filter(fn ($employee) => (int) $employee->id === $selfOnly)
                ->values();
        }
        if ($run) {
            $slips = Payslip::where('payroll_run_id', $run->id)
                ->when($selfOnly !== null, fn ($q) => $q->where('employee_id', $selfOnly))
                ->get();
        } elseif ($selfOnly !== null) {
            $slips = collect();
        } else {
            $slips = $eligibleEmployees->map(function ($e) use ($period) {
                $data = $this->payroll->computeForEmployee($e, $period);
                return new Payslip($data + ['employee_id' => $e->id]);
            });
        }

        $issues = [];
        $blockedAmount = 0;
        $atRiskAmount = 0;
        foreach ($slips as $s) {
            $ex = $this->visibleExceptions($s);
            if (!collect($ex)->contains(fn ($e) => ($e['type'] ?? null) === 'blocking')) continue;
            $type = 'blocking';
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
                'eligible_count' => $eligibleEmployees->count(),
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

        $unresolved = Payslip::where('payroll_run_id', $run->id)
            ->whereIn('status', ['On Hold'])
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
        if ($run->status === 'paid'
            && \App\Models\Payslip::where('payroll_run_id', $run->id)->where('status', '!=', 'Paid')->doesntExist()) {
            return response()->json(['message' => 'This payroll run is already fully paid.'], 422);
        }

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

    public function fnf(Request $request, int $employeeId)
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
        ]);

        $saved = $this->latestFnf($employee->id);
        $opts = $this->fnfOpts($request, $saved);

        return response()->json([
            'data'  => $this->payroll->computeFnf($employee, $opts),
            'saved' => $saved ? $this->serializeFnf($saved) : null,
        ]);
    }

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

    private function fnfEmployee(Request $request, int $employeeId)
    {
        $user = $request->user();
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You do not have permission to view full-and-final settlements.'], 403);
        }
        $employee = \App\Models\Employee::find($employeeId);
        if (!$employee) {
            return response()->json(['message' => 'Employee not found.'], 404);
        }
        if ($user && $user->user_type !== 'super_admin' && (int) $employee->client_id !== (int) $user->client_id) {
            return response()->json(['message' => 'Employee belongs to another tenant.'], 403);
        }
        if ($user && $user->user_type === 'branch_user' && $user->branch_id
            && $employee->branch_id && (int) $employee->branch_id !== (int) $user->branch_id) {
            return response()->json(['message' => 'Employee belongs to another branch.'], 403);
        }

        $hasExit = \Illuminate\Support\Facades\Schema::hasTable('employee_exits')
            && \Illuminate\Support\Facades\DB::table('employee_exits')->where('employee_id', $employee->id)->exists();
        if (!$hasExit) {
            return response()->json(['message' => 'This employee has no exit record. Initiate the exit before computing a full & final settlement.'], 422);
        }

        return $employee;
    }

    private function latestFnf(int $employeeId): ?\App\Models\FnfSettlement
    {
        return \App\Models\FnfSettlement::where('employee_id', $employeeId)->latest('id')->first();
    }

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

    public function payslip(Request $request, int $id)
    {
        $slip = Payslip::with('run:id,status')->find($id);
        if (!$slip || !$this->ownsRow($request, $slip)) {
            return response()->json(['message' => 'Payslip not found.'], 404);
        }
        $data = $this->serializePayslip($slip, true);
        $data['company'] = $this->pdf->letterhead($slip);
        $data['period_label'] = $this->periodLabelFor($slip);
        $data['notices'] = $this->slipNotices($slip, $data['deductionsBreakup'] ?? []);
        $data['payBasis'] = $this->payBasisNotices($slip);
        $data += $this->salaryVersionFor($slip);
        return response()->json(['data' => $data]);
    }

    private function slipNotices(Payslip $slip, array $deductionLines): array
    {
        $notices = [];

        $emp = $slip->relationLoaded('employee') ? $slip->employee : $slip->employee()->first();
        $activeStructure = $emp
            ? \App\Models\SalaryStructure::where('employee_id', $emp->id)
                ->where('status', 'active')
                ->orderByDesc('version')->orderByDesc('id')
                ->first()
            : null;

        $recordedAnnual  = round((float) ($emp->annual_salary ?? 0), 2);
        $structureAnnual = round((float) ($activeStructure->monthly_gross ?? 0) * 12, 2);
        if ($recordedAnnual > 0 && $structureAnnual > 0
            && abs($recordedAnnual - $structureAnnual) > 12
        ) {
            $notices[] = 'This payslip is calculated from the saved salary structure (₹'
                . number_format($structureAnnual, 0) . '/year). The CTC on the employee record reads ₹'
                . number_format($recordedAnnual, 0) . '/year. Payroll always pays from the structure — '
                . 'open Salary Setup → Revise and save the correct CTC to bring the two back in step.';
        }

        $hasPfLine = collect($deductionLines)->contains(fn ($d) => ($d['code'] ?? null) === 'pf');
        $pfOnSlip = $hasPfLine || (float) $slip->pf_employee > 0;

        $employee = $slip->relationLoaded('employee') ? $slip->employee : $slip->employee()->first();
        $pfStructure = $activeStructure;

        $pfAppliesNow = $employee && (bool) ($pfStructure->pf_applicable ?? false);

        $frozen = !in_array($slip->run?->status, ['draft', 'generated'], true)
            || ($slip->period?->status ?? null) === 'locked';

        if ($frozen && $pfAppliesNow && !$pfOnSlip) {
            $notices[] = 'Provident Fund is applicable for this employee but was not deducted in this cycle — '
                . 'this payslip was finalized before PF was enabled, and a finalized slip is never recomputed. '
                . 'PF will appear from the next payroll run.';
        } elseif ($frozen && !$pfAppliesNow && $pfOnSlip) {
            $notices[] = 'Provident Fund is no longer applicable for this employee, but this cycle was already '
                . 'finalized and keeps the PF it was paid with. No PF is deducted from the next payroll run.';
        }

        return $notices;
    }

    private function payBasisNotices(Payslip $slip): array
    {
        $out = [];

        $working = (float) $slip->working_days;
        $paid    = (float) $slip->paid_days;
        $lopDays = (float) $slip->lop_days;
        $gross   = (float) $slip->gross_earnings;
        $lopAmt  = (float) $slip->lop_amount;

        $num = fn ($v) => rtrim(rtrim(number_format((float) $v, 2, '.', ''), '0'), '.');

        $basis = 'Each component is shown at the rate in force during this pay window. '
            . 'Attendance is not applied to the component lines — absence is charged once, '
            . 'as the Loss of Pay deduction';
        if ($lopDays > 0) {
            $basis .= ' (₹' . number_format($lopAmt, 2) . ' for ' . $num($lopDays)
                . ' of ' . $num($working) . ' working day(s), '
                . 'paid days ' . $num($paid) . ')';
        }
        $basis .= '. Net Pay = Total Earnings ₹' . number_format($gross, 2)
            . ' − Total Deductions ₹' . number_format((float) $slip->total_deductions, 2)
            . ' = ₹' . number_format((float) $slip->net_pay, 2) . '.';
        $out[] = $basis;

        if ($working > 0) {
            $lateLop    = $slip->late_lop_days === null ? null : (float) $slip->late_lop_days;
            $absenceLop = $lateLop === null ? $lopDays : max(0, round($lopDays - $lateLop, 2));

            if (abs(($paid + $absenceLop) - $working) < 0.005) {
                $days = 'Days: working ' . $num($working) . ' = paid ' . $num($paid)
                    . ' + loss of pay ' . $num($absenceLop) . '.';
                if ($lateLop !== null && $lateLop > 0) {
                    $days .= ' A further ' . $num($lateLop) . ' day(s) is charged as loss of pay for late marks'
                        . ' — Paid Days still shows what attendance credited, which is why the two do not net off.';
                }
            } else {
                $proRated = false;
                foreach ((array) ($slip->exceptions ?? []) as $e) {
                    $reason = is_array($e) ? (string) ($e['reason'] ?? '') : '';
                    if (stripos($reason, 'pro-rated') !== false || stripos($reason, 'prorated') !== false) {
                        $proRated = true;
                        break;
                    }
                }
                $settled = in_array(strtolower((string) $slip->status), ['paid', 'approved'], true);

                $days = 'Days recorded: working ' . $num($working) . ', paid ' . $num($paid)
                    . ', loss of pay ' . $num($lopDays) . '.';
                if ($proRated) {
                    $days .= ' Working days cover the whole month while pay covers only the days employed,'
                        . ' so the two are not meant to net off — see the pro-ration note below.';
                } elseif (!$settled) {
                    $days .= ' A cycle that is still open charges loss of pay only up to today, so these settle'
                        . ' when the run is finalized.';
                }
            }
            $calendarDays = $slip->period
                ? (int) Carbon::create((int) $slip->period->year, (int) $slip->period->month, 1)->daysInMonth
                : 0;
            $days .= $calendarDays > 0 && abs($working - $calendarDays) < 0.005
                ? ' Weekly offs are inside this basis: they are paid days and are never docked.'
                : ' Weekly offs are excluded from working days, so they are neither counted nor docked.';
            $out[] = $days;
        }

        $moved = [];
        foreach ((array) ($slip->earnings ?? []) as $c) {
            if (!is_array($c)) {
                continue;
            }
            $monthly = $c['monthly'] ?? null;
            $amount  = $c['amount'] ?? null;
            if ($monthly === null || $amount === null) {
                continue;
            }
            if (round(abs((float) $monthly - (float) $amount), 2) >= 0.01) {
                $moved[] = ($c['label'] ?? 'Component') . ' ₹' . number_format((float) $monthly, 2)
                    . ' → ₹' . number_format((float) $amount, 2);
            }
        }
        if ($moved) {
            $shown = array_slice($moved, 0, 6);
            $more  = count($moved) - count($shown);
            $out[] = 'These components are paid at something other than the salary structure rate '
                . '(structure rate → paid this window): ' . implode(', ', $shown)
                . ($more > 0 ? ', and ' . $more . ' more' : '')
                . '. The reason is stated below — a mid-cycle revision is blended across the rates that were '
                . 'in force, and a join or exit inside the window is pro-rated to the days employed.';
        }

        $present = $slip->present_days === null ? null : (float) $slip->present_days;
        if ($present !== null && $working > 0 && $paid > $present + 0.005) {
            $inProgress = false;
            foreach ((array) ($slip->exceptions ?? []) as $e) {
                if (stripos((string) ($e['reason'] ?? ''), 'still in progress') !== false) {
                    $inProgress = true;
                    break;
                }
            }
            $label   = $this->periodLabelFor($slip);
            $counted = 'Days Present counts only attendance recorded inside ' . $label
                . ' (' . $num($present) . ') — it is never carried over from another month.';
            $out[] = $inProgress
                ? $counted . ' Paid Days (' . $num($paid) . ') is higher because this cycle was generated'
                    . ' while the month was still running: days that have not happened yet cannot be worked,'
                    . ' so they are not charged as loss of pay. Re-run payroll once the month is complete'
                    . ' and both figures settle.'
                : $counted . ' Paid Days (' . $num($paid) . ') is a different count: it also credits approved'
                    . ' leave, holidays and — on the calendar basis — weekly offs, none of which produce a'
                    . ' punch, which is why the two differ.';
        }

        $wanted = ['blended', 'pro-rated', 'prorated', 'Priced on the salary structure',
                   'holiday', 'late mark', 'late marks',
                   'still in progress', 'No attendance recorded'];
        foreach ((array) ($slip->exceptions ?? []) as $e) {
            $reason = (string) ($e['reason'] ?? '');
            if ($reason === '') {
                continue;
            }
            foreach ($wanted as $needle) {
                if (stripos($reason, $needle) !== false) {
                    $out[] = $reason;
                    break;
                }
            }
        }

        return array_values(array_unique($out));
    }

    public function executionHistory(Request $request)
    {
        if (!$this->canManage($request) && !$this->canExport($request)) {
            return response()->json(['message' => 'You are not allowed to view payroll execution history.'], 403);
        }

        $ctx = $this->ctx($request);
        $q = \App\Models\PayrollExecutionLog::query()
            ->when($ctx['client_id'], fn ($x) => $x->where('client_id', $ctx['client_id']))
            ->when($ctx['branch_id'], fn ($x) => $x->where('branch_id', $ctx['branch_id']));

        if ($m = $request->integer('month')) $q->where('month', $m);
        if ($y = $request->integer('year'))  $q->where('year', $y);
        $status = trim((string) $request->input('status', ''));
        if ($search = trim((string) $request->input('search', ''))) {
            $like = '%' . $search . '%';
            $q->where(fn ($w) => $w
                ->where('run_by_name', 'ilike', $like)
                ->orWhere('run_by_employee_code', 'ilike', $like)
                ->orWhere('batch_ref', 'ilike', $like));
        }

        $qNoStatus = clone $q;
        if ($status !== '' && strcasecmp($status, 'All') !== 0) {
            $q->where('status', $status);
        }

        $summary = (clone $q)->reorder()
            ->selectRaw('year, month, period_label, run_by_name, run_by_employee_code, count(*) as runs, max(executed_at) as last_run')
            ->groupBy('year', 'month', 'period_label', 'run_by_name', 'run_by_employee_code')
            ->orderByDesc('year')->orderByDesc('month')
            ->limit(200)
            ->get()
            ->map(fn ($r) => [
                'year'        => (int) $r->year,
                'month'       => (int) $r->month,
                'label'       => $r->period_label ?: trim(($r->month ? date('M', mktime(0, 0, 0, (int) $r->month, 1)) : '') . ' ' . $r->year),
                'run_by'      => $r->run_by_name ?: '—',
                'employee_id' => $r->run_by_employee_code ?: '—',
                'runs'        => (int) $r->runs,
                'last_run'    => $r->last_run,
            ])->values();

        $byStatus = (clone $qNoStatus)->reorder()
            ->select('status', DB::raw('count(*) as n'))
            ->groupBy('status')->pluck('n', 'status');
        $counts = [
            'All'         => (int) $byStatus->sum(),
            'Completed'   => (int) ($byStatus['Completed'] ?? 0),
            'In Progress' => (int) ($byStatus['In Progress'] ?? 0),
            'Failed'      => (int) ($byStatus['Failed'] ?? 0),
        ];

        $perPage = min(200, max(1, (int) $request->input('per_page', 10)));
        $page    = max(1, (int) $request->input('page', 1));
        $total   = (clone $q)->count();

        $rows = $q->orderByDesc('executed_at')->orderByDesc('id')
            ->forPage($page, $perPage)->get()
            ->map(fn ($r) => [
                'id'            => $r->id,
                'run_by'        => $r->run_by_name ?: '—',
                'employee_id'   => $r->run_by_employee_code ?: '—',
                'executed_at'   => optional($r->executed_at)->toIso8601String(),
                'period_label'  => $r->period_label ?: '—',
                'month'         => $r->month,
                'year'          => $r->year,
                'status'        => $r->status,
                'failure_reason' => $r->failure_reason,
                'batch_ref'     => $r->batch_ref,
                'employees_paid' => $r->employees_paid,
                'employees_held' => $r->employees_held,
                'total_amount'  => $r->total_amount !== null ? (float) $r->total_amount : null,
                'executed_by'   => $r->executed_by_user_name,
            ])->values();

        return response()->json([
            'data'    => $rows,
            'total'   => $total,
            'counts'  => $counts,
            'summary' => $summary,
        ]);
    }

    public function employeeCurrentCycle(Request $request, int $employeeId)
    {
        $user = $request->user();
        if ($user && $user->user_type === 'employee'
            && (int) $employeeId !== (int) ($user->employee_id ?? 0)) {
            return response()->json(['message' => 'You can only view your own payroll summary.'], 403);
        }

        $ctx   = $this->ctx($request);
        $today = Carbon::now();
        $start = $today->copy()->startOfMonth();
        $end   = $today->copy()->endOfMonth();

        $period = PayrollPeriod::query()
            ->when($ctx['client_id'], fn ($q) => $q->where('client_id', $ctx['client_id']))
            ->when($ctx['branch_id'], fn ($q) => $q->where('branch_id', $ctx['branch_id']))
            ->where('month', (int) $today->month)
            ->where('year', (int) $today->year)
            ->first();

        $run = $period
            ? PayrollRun::where('payroll_period_id', $period->id)->orderByDesc('id')->first()
            : null;

        $slip = $period
            ? Payslip::where('payroll_period_id', $period->id)
                ->where('employee_id', $employeeId)
                ->orderByDesc('id')
                ->first()
            : null;

        $lastDone = PayrollPeriod::query()
            ->when($ctx['client_id'], fn ($q) => $q->where('client_id', $ctx['client_id']))
            ->when($ctx['branch_id'], fn ($q) => $q->where('branch_id', $ctx['branch_id']))
            ->where(fn ($w) => $w
                ->where('status', 'locked')
                ->orWhereHas('runs', fn ($r) => $r->where('status', 'paid')))
            ->where(fn ($w) => $w
                ->where('year', '<', (int) $today->year)
                ->orWhere(fn ($x) => $x->where('year', (int) $today->year)->where('month', '<=', (int) $today->month)))
            ->orderByDesc('year')->orderByDesc('month')
            ->first();

        $next = $today->copy()->startOfMonth()->addMonth();

        return response()->json(['data' => [
            'month'         => (int) $today->month,
            'year'          => (int) $today->year,
            'label'         => $period?->label ?: $start->format('M Y'),
            'period_start'  => optional($period?->period_start)->toDateString() ?: $start->toDateString(),
            'period_end'    => optional($period?->period_end)->toDateString() ?: $end->toDateString(),
            'range'         => $start->format('d M') . ' – ' . $end->format('d M'),
            'working_days'  => (float) ($period?->working_days ?? $this->payroll->defaultWorkingDays($start, $end)),
            'lop_days'      => (float) ($slip?->lop_days ?? 0),
            'paid_days'     => $slip ? (float) $slip->paid_days : null,
            'has_payslip'   => (bool) $slip,
            'payslip_id'    => $slip?->id,
            'payslip_status' => $slip?->status,
            'status'        => $this->cycleDisplayStatus($period, $start->copy(), $run),
            'run_status'    => $run?->status,
            'next_label'    => $next->format('M Y'),
            'last_processed' => $lastDone ? [
                'label' => $lastDone->label ?: Carbon::create($lastDone->year, $lastDone->month, 1)->format('M Y'),
                'range' => Carbon::create($lastDone->year, $lastDone->month, 1)->format('d M')
                    . ' – ' . Carbon::create($lastDone->year, $lastDone->month, 1)->endOfMonth()->format('d M'),
            ] : null,
        ]]);
    }

    public function employeePayslips(Request $request, int $employeeId)
    {
        $user = $request->user();
        if ($user && $user->user_type === 'employee'
            && (int) $employeeId !== (int) ($user->employee_id ?? 0)) {
            return response()->json(['message' => 'You can only view your own salary history.'], 403);
        }
        $slips = Payslip::with(['run:id,status', 'period:id,label,month,year'])
            ->where('employee_id', $employeeId)
            ->when($user && $user->client_id, fn ($q) => $q->where('client_id', $user->client_id))
            ->when(
                $user && $user->user_type === 'branch_user' && $user->branch_id,
                fn ($q) => $q->where(fn ($w) => $w
                    ->whereNull('branch_id')
                    ->orWhere('branch_id', $user->branch_id)),
            )
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

    public function payslipPdf(Request $request, int $id)
    {
        $slip = Payslip::with('run:id,status')->find($id);
        if (!$slip || !$this->ownsRow($request, $slip)) {
            return response()->json(['message' => 'Payslip not found.'], 404);
        }
        if ($msg = $this->pdfBlockReason($slip)) {
            return response()->json(['message' => $msg], 422);
        }

        $bytes = $this->pdf->render($slip);
        $disposition = $request->boolean('download') ? 'attachment' : 'inline';
        $this->audit($request, 'payslip_pdf', $slip, "Payslip PDF for {$slip->employee_name}");

        return response($bytes, 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => $disposition . '; filename="' . $this->pdf->filename($slip) . '"',
        ]);
    }

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

        $matched = Payslip::where('payroll_period_id', $period->id)
            ->when($run, fn ($q) => $q->where('payroll_run_id', $run->id))
            ->when($request->query('department'), fn ($q, $d) => $q->whereIn('department', array_filter(explode(',', (string) $d))))
            ->when($request->query('status'), fn ($q, $s) => $q->whereIn('status', array_filter(explode(',', (string) $s))))
            ->with('run:id,status')
            ->orderBy('employee_name')
            ->get();

        $slips = $matched->reject(fn ($s) => $this->pdfBlockReason($s) !== null)->values();

        if ($slips->isEmpty()) {
            if ($matched->isNotEmpty()) {
                $held = $matched->count();
                return response()->json([
                    'message' => "None of the {$held} payslip(s) in {$period->label} can be downloaded yet — "
                        . 'every one is On Hold or Pending Review and the payroll has not been approved. '
                        . 'Resolve the issues and regenerate, or approve the run first.',
                ], 422);
            }

            return response()->json(['message' => 'No payslips to download — generate payroll first.'], 422);
        }

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
        if ($msg = $this->pdfBlockReason($slip)) {
            return response()->json(['message' => $msg], 422);
        }

        $result = $this->sendPayslipMail($slip);
        if (!$result['ok']) {
            return response()->json(['message' => $result['message']], 422);
        }
        $this->audit($request, 'email_payslip', $slip, "Payslip emailed to {$slip->employee_name} <{$result['to']}>");

        return response()->json(['message' => "Payslip emailed to {$slip->employee_name} ({$result['to']})."]);
    }

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

        $finalized = $run && ($run->isLocked() || in_array($run->status, ['approved', 'paid'], true));
        if (!$finalized) {
            return response()->json(['message' => 'Approve the payroll before emailing payslips.'], 422);
        }

        $slips = Payslip::where('payroll_run_id', $run->id)
            ->when($request->query('department'), fn ($q, $d) => $q->whereIn('department', array_filter(explode(',', (string) $d))))
            ->when($request->query('status'), fn ($q, $s) => $q->whereIn('status', array_filter(explode(',', (string) $s))))
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

    private function pdfBlockReason(Payslip $slip): ?string
    {
        if (!in_array($slip->status, ['On Hold'], true)) {
            return null;
        }
        if ($this->isFinalSlip($slip)) {
            return null;
        }

        return "Payslip can't be generated while the status is \"{$slip->status}\" and the payroll "
            . 'has not been approved. Resolve the issue and regenerate, or approve the run first.';
    }

    private function periodLabelFor(Payslip $slip): string
    {
        return DB::table('payroll_periods')->where('id', $slip->payroll_period_id)->value('label') ?: now()->format('M Y');
    }

    public function export(Request $request): StreamedResponse
    {
        abort_unless($this->canExport($request), 403, 'You are not allowed to export payroll.');

        [$month, $year] = $this->resolveMonthYear($request);
        $ctx = $this->ctx($request);
        abort_if(empty($ctx['client_id']) && empty($ctx['branch_id']), 422, 'Select a client or branch before exporting payroll.');
        $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);
        $run = $period->runs()->latest('id')->first();

        $branchFilter = (int) $request->query('branch_id') ?: null;
        if ($branchFilter && $ctx['branch_id'] && $branchFilter !== (int) $ctx['branch_id']) {
            abort(403, 'You are not allowed to export payroll for that branch.');
        }

        $q = Payslip::where('payroll_period_id', $period->id)
            ->when($run, fn ($q) => $q->where('payroll_run_id', $run->id))
            ->when($request->query('department'), fn ($q, $d) => $q->whereIn('department', array_filter(explode(',', (string) $d))))
            ->when($request->query('status'), fn ($q, $s) => $q->whereIn('status', array_filter(explode(',', (string) $s))))
            ->when($branchFilter, fn ($q, $b) => $q->where('branch_id', $b))
            ->when($request->query('employee_type'), fn ($q, $t) => $q->where('employee_type', $t))
            ->orderBy('employee_name');

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

    private function findRun(Request $request): ?PayrollRun
    {
        $ctx = $this->ctx($request);
        $id = (int) $request->input('run_id', $request->query('run_id'));
        $run = PayrollRun::with('period')->find($id);
        if (!$run) return null;
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
        if ((int) $slip->client_id !== (int) $user->client_id) return false;
        if ($user->user_type === 'employee') {
            return (int) $slip->employee_id === (int) ($user->employee_id ?? 0);
        }
        if ($user->user_type === 'branch_user' && $user->branch_id
            && $slip->branch_id && (int) $slip->branch_id !== (int) $user->branch_id) {
            return false;
        }
        return true;
    }

    private function canExport(Request $request): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin'], true)) return true;
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
            'notInRun'       => $rows->where('status', 'Not in Run')->count(),
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

    private function attendanceDaysMap($slips, $period): array
    {
        if (!$period || $slips->isEmpty()) {
            return [];
        }

        $start = Carbon::parse($period->period_start)->startOfDay();
        $end   = Carbon::parse($period->period_end)->startOfDay();
        $today = Carbon::today();
        if ($end->gt($today)) $end = $today->copy();
        if ($end->lt($start)) return [];

        $empIds = $slips->pluck('employee_id')->filter()->unique()->values();

        $employees = \App\Models\Employee::withTrashed()
            ->with('branch')
            ->whereIn('id', $empIds)
            ->get(['id', 'weekly_off', 'holiday_group_id', 'client_id', 'branch_id', 'shift', 'date_of_joining']);

        $rowsByEmp = [];
        foreach (\App\Models\Attendance::query()
            ->whereIn('employee_id', $empIds)
            ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])
            ->get(['id', 'employee_id', 'attendance_date', 'status', 'check_in_at', 'check_out_at', 'shift_start', 'shift_end', 'shift_name']) as $r) {
            $rowsByEmp[(int) $r->employee_id][Carbon::parse($r->attendance_date)->toDateString()] = $r;
        }

        $svc = app(\App\Services\PayrollService::class);
        $holidayMemo = [];
        $out = [];

        foreach ($employees as $e) {
            $key = ($e->holiday_group_id ?? 'none') . '|' . ($e->weekly_off ?? '');
            $holidays = $holidayMemo[$key] ??= array_flip(
                $svc->holidayDatesFor($e, $start->copy(), $end->copy()),
            );

            $weeklyOffLabel = (string) ($e->weekly_off ?? '');
            $shiftStart     = $e->resolveShiftWindow()[0];
            $rows           = $rowsByEmp[(int) $e->id] ?? [];
            $joined = $e->date_of_joining
                ? Carbon::parse($e->date_of_joining)->startOfDay()->toDateString()
                : null;

            $absent = 0;
            $holidayWorked = 0;
            for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
                $ds  = $d->toDateString();
                $row = $rows[$ds] ?? null;
                if (!$row && $joined !== null && $ds < $joined) continue;

                $isHoliday = isset($holidays[$ds]);
                $status = \App\Support\AttendanceDayStatus::resolve(
                    $row,
                    \App\Support\WeekOff::isOff($weeklyOffLabel, $d),
                    $shiftStart,
                    $ds,
                    $isHoliday,
                );
                if ($status === 'Absent') $absent++;
                if ($isHoliday && $status !== 'Holiday') $holidayWorked++;
            }
            $out[$e->id] = [
                'absent'        => (float) $absent,
                'holidayTotal'  => (float) count($holidays),
                'holidayWorked' => (float) $holidayWorked,
            ];
        }

        return $out;
    }
    private function weekOffDaysMap($slips, $period): array
    {
        if (!$period || $slips->isEmpty()) {
            return [];
        }
        $employees = \App\Models\Employee::withTrashed()
            ->whereIn('id', $slips->pluck('employee_id')->filter()->unique()->values())
            ->get(['id', 'weekly_off', 'date_of_joining']);

        $start = Carbon::create((int) $period->year, (int) $period->month, 1)->startOfDay();
        $end   = (clone $start)->endOfMonth()->startOfDay();

        $out = [];
        foreach ($employees as $e) {
            $joined = $e->date_of_joining
                ? Carbon::parse($e->date_of_joining)->startOfDay()->toDateString()
                : null;

            $n = 0;
            for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
                $ds = $d->toDateString();
                if ($joined !== null && $ds < $joined) continue;
                if (\App\Support\WeekOff::isOff((string) ($e->weekly_off ?? ''), $d)) $n++;
            }
            $out[$e->id] = $n;
        }
        return $out;
    }

    private function pfNoticeMap($slips, $run, $period): array
    {
        $frozen = !in_array($run?->status, ['draft', 'generated'], true)
            || ($period?->status ?? null) === 'locked';
        if ($slips->isEmpty()) {
            return [];
        }

        $empIds = $slips->pluck('employee_id')->filter()->unique()->values();
        $pfEligible = \App\Models\Employee::whereIn('id', $empIds)->pluck('pf_eligible', 'id');
        $pfStructure = \App\Models\SalaryStructure::whereIn('employee_id', $empIds)
            ->where('status', 'active')
            ->where('pf_applicable', true)
            ->pluck('employee_id')
            ->flip();

        $out = [];
        foreach ($slips as $s) {
            $applies = (bool) ($pfEligible[$s->employee_id] ?? false)
                || isset($pfStructure[$s->employee_id]);
            $onSlip = (float) $s->pf_employee > 0;

            if ($frozen && $applies && !$onSlip) {
                $out[$s->id] = 'PF is applicable now but this cycle was finalized before it was enabled — '
                    . 'PF applies from the next payroll run.';
            } elseif ($frozen && !$applies && $onSlip) {
                $out[$s->id] = 'PF has since been turned off — this finalized cycle keeps the PF it was paid with.';
            } elseif (!$frozen && $applies && !$onSlip) {
                $reason = collect($s->exceptions ?? [])
                    ->pluck('reason')
                    ->first(fn ($r) => stripos((string) $r, 'PF') !== false);
                $out[$s->id] = $reason
                    ?: 'PF is applicable but no PF was deducted — the basic pay for this cycle worked out '
                        . 'to zero. Check the earning components on the salary structure.';
            }
        }

        return $out;
    }

    private function salaryVersionFor(Payslip $slip): array
    {
        $period = $slip->period ?: PayrollPeriod::find($slip->payroll_period_id);
        if (!$period || !$slip->employee_id) {
            return ['salaryVersion' => null, 'salaryVersionFrom' => null, 'salaryVersions' => []];
        }

        $winStart = Carbon::parse($period->period_start
            ?? Carbon::create((int) $period->year, (int) $period->month, 1))->startOfDay();
        $winEnd   = Carbon::parse($period->period_end
            ?? Carbon::create((int) $period->year, (int) $period->month, 1)->endOfMonth())->endOfDay();

        $v = \App\Models\SalaryStructure::versionsInForce((int) $slip->employee_id, $winStart, $winEnd);

        return [
            'salaryVersion'     => $v['version'],
            'salaryVersionFrom' => $v['from'],
            'salaryVersions'    => $v['all'],
        ];
    }
    private function structureGrossMap($slips, $period = null): array
    {
        $empIds = $slips->pluck('employee_id')->filter()->unique()->values();
        if ($empIds->isEmpty()) {
            return [];
        }

        $asOf = $period
            ? Carbon::parse($period->period_end ?? Carbon::create((int) $period->year, (int) $period->month, 1)->endOfMonth())
            : Carbon::now();

        $out = [];
        \App\Models\SalaryStructure::whereIn('employee_id', $empIds)
            ->whereIn('status', ['active', 'superseded'])
            ->whereDate('effective_from', '<=', $asOf)
            ->orderBy('effective_from')
            ->orderBy('version')
            ->orderByRaw("CASE WHEN status = 'active' THEN 1 ELSE 0 END")
            ->orderBy('id')
            ->get(['employee_id', 'monthly_gross'])
            ->each(function ($s) use (&$out) {
                $out[$s->employee_id] = (float) $s->monthly_gross;
            });

        return $out;
    }

    private function serializePayslip(Payslip $p, bool $full = false, ?float $elapsedWorkingDays = null, ?string $pfNotice = null, ?float $structureGross = null, ?int $weekOffDays = null, ?array $attDays = null): array
    {
        $name = $p->employee_name ?: 'Employee';
        $parts = preg_split('/\s+/', trim($name));
        $initials = strtoupper(substr($parts[0] ?? '', 0, 1) . substr(end($parts) ?: '', 0, 1));

        $monthlyLines = collect((array) ($p->earnings ?? []))
            ->filter(fn ($l) => isset($l['monthly']));
        $monthlyGross = $monthlyLines->isEmpty()
            ? ($structureGross !== null && $structureGross > 0 ? round($structureGross, 2) : null)
            : round($monthlyLines->sum(fn ($l) => (float) $l['monthly']), 2);
        $earnedStructure = $monthlyLines->isEmpty()
            ? round((float) ($p->structure_gross ?: $p->gross_earnings), 2)
            : round($monthlyLines->sum(fn ($l) => (float) ($l['amount'] ?? 0)), 2);
        $prorated = $monthlyGross !== null
            && $earnedStructure !== null
            && ($monthlyGross - $earnedStructure) > 1;

        $row = [
            'id'          => (string) $p->id,
            'payslip_id'  => $p->id,
            'empId'       => $p->employee_code ?: ('EMP-' . $p->employee_id),
            'employee_id' => $p->employee_id,
            'encryptedId' => $this->encId($p->employee_id),
            'name'        => $name,
            'initials'    => $initials ?: 'NA',
            'accent'      => $this->accentFor($p->employee_id),
            'department'  => $p->department ?: '—',
            'designation' => $p->designation ?: '—',
            'ctc'         => $monthlyGross ?? (float) $p->gross_earnings,
            'earnings'    => (float) $p->gross_earnings,
            'monthlyGross' => $monthlyGross,
            'prorated'     => $prorated,
            'prorationNote' => $prorated
                ? 'Pro-rated for a mid-cycle join or exit — this cycle pays ₹'
                    . number_format((float) $earnedStructure, 2) . ' of the ₹'
                    . number_format((float) $monthlyGross, 2) . ' monthly salary. '
                    . 'The full structure is on the payslip under "Monthly".'
                : null,
            'deductions'  => (float) $p->total_deductions,
            'netPay'      => (float) $p->net_pay,
            'attendance'  => (float) $p->paid_days,
            'workingDays' => (float) $p->working_days,
            'lop_days'    => (float) $p->lop_days,
            'status'      => $p->status,
            'present'     => (float) $p->present_days,
            'absent'      => $attDays === null ? null : (float) $attDays['absent'],
            'holidayDays'        => $attDays === null ? null : (float) $attDays['holidayTotal'],
            'holidayDaysWorked'  => $attDays === null ? null : (float) $attDays['holidayWorked'],
            'lateMarks'   => (int) $p->late_marks,
            'missingPunch'=> (int) $p->missing_punches,
            'unpaidLeave' => (float) $p->unpaid_leave_days,
            'paidLeave'   => (float) $p->paid_leave_days,
            'attSource'   => $p->att_source,
            'mismatch'    => $p->missing_punches > 0
                ? 'Missing punches'
                : ($p->att_source === 'Review' ? 'Late marks' : null),
            'attMismatch' => $p->att_source === 'Review',
            'pfEmp'       => (float) $p->pf_employee,
            'pfStale'     => $pfNotice !== null,
            'pfNotice'    => $pfNotice,
            'esi'         => (float) $p->esi,
            'pt'          => (float) $p->pt,
            'tds'         => (float) $p->tds,
            'lopDeducted' => (float) $p->lop_amount,
            'advanceRec'  => (float) $p->advance_recovery,
            'holdReason'  => $p->hold_reason,
            'reasons'     => collect($this->visibleExceptions($p))->pluck('reason')->filter()->values()->all(),
            'bankVerified' => (bool) $p->bank_verified,
            'weekOffDays' => $weekOffDays,
        ];

        if ($full) {
            $row['earningsBreakup'] = \App\Support\PayslipLines::reconciledTo(
                \App\Support\PayslipLines::withoutUnfunded($p->earnings ?: []),
                (float) $p->gross_earnings,
            );
            $row['deductionsBreakup'] = $p->deductions ?: [];

            $emp = $p->relationLoaded('employee') ? $p->employee : $p->employee()->first();
            $otApplicable = (bool) $emp?->overtimeApplicable();
            $row['overtimeApplicable'] = $otApplicable;
            $row['overtimeHours']      = (float) ($p->overtime_hours ?? 0);
            $row['overtimeAmount']     = (float) ($p->overtime_amount ?? 0);
            if ($otApplicable) {
                $svc = app(\App\Services\PayrollService::class);

                $otLine = collect(is_array($p->earnings) ? $p->earnings : [])
                    ->first(fn ($l) => ($l['code'] ?? null) === 'overtime' && isset($l['rate']));

                if ($otLine) {
                    $row['overtimeRateName']   = $otLine['rate_name'] ?? null;
                    $row['overtimeMultiplier'] = isset($otLine['multiplier']) ? (float) $otLine['multiplier'] : null;
                    $row['overtimeHourly']     = isset($otLine['hourly']) ? (float) $otLine['hourly'] : null;
                    $row['overtimeRate']       = (float) $otLine['rate'];
                    $row['overtimePricedHours'] = isset($otLine['hours']) ? (float) $otLine['hours'] : null;
                } else {
                    $paidHours  = (float) ($p->overtime_hours ?? 0);
                    $paidAmount = (float) ($p->overtime_amount ?? 0);
                    $row['overtimeRateName']   = null;
                    $row['overtimeMultiplier'] = null;
                    $row['overtimeHourly']     = null;
                    $row['overtimeRate']       = $paidHours > 0 ? round($paidAmount / $paidHours, 2) : null;
                    $row['overtimePricedHours'] = $paidHours > 0 ? $paidHours : null;
                }

                if ($p->period) {
                    $winStart = Carbon::create((int) $p->period->year, (int) $p->period->month, 1)->startOfDay();
                    $winEnd   = (clone $winStart)->endOfMonth()->startOfDay();
                    $detected = $svc->overtimeHoursFromAttendance($emp, $winStart, $winEnd);
                    $row['overtimeDetectedHours'] = (float) $detected['hours'];
                    $row['overtimeDetectedDays']  = (int) $detected['days'];
                }
            }
            $row['exceptions']        = $this->visibleExceptions($p);
            $row['paidDays']          = (float) $p->paid_days;
            $row['weekOffDays'] = $weekOffDays
                ?? ($this->weekOffDaysMap(collect([$p]), $p->period)[$p->employee_id] ?? 0);
            $row['lopDays']           = (float) $p->lop_days;
            $row['perDayRate']        = (float) $p->lop_days > 0
                ? round((float) $p->lop_amount / (float) $p->lop_days, 2)
                : null;
            $salaryOnly = (float) $p->gross_earnings
                - (float) ($p->overtime_amount ?? 0)
                - (float) ($p->bonus_amount ?? 0);
            $row['perDaySalary']      = (float) $p->working_days > 0
                ? round(max(0, $salaryOnly) / (float) $p->working_days, 2)
                : null;
            $row['lateLopDays']       = $p->late_lop_days === null ? null : (float) $p->late_lop_days;
            $row['totalMonthDays']    = $p->period
                ? Carbon::create((int) $p->period->year, (int) $p->period->month, 1)->daysInMonth
                : null;
            $row['bank_verified']     = (bool) $p->bank_verified;
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
        }
    }
}
