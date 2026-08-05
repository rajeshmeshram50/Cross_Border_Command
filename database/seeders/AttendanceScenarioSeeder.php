<?php

namespace Database\Seeders;

use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Attendance test data for the payroll flow — client 1 / branch 3.
 *
 * Fills 1 Jul → 3 Aug 2026 (Mon–Sat; Sunday = Weekly Off) for the eligible
 * employees, with a spread of scenarios so a payroll run reflects them:
 *   - Full day (Present, 09:00→18:00 IST + punches)
 *   - Overtime logout (late check-out + approved payroll_adjustments OT row)
 *   - Half day (status Half Day → 0.5 present)
 *   - Leave (status Leave + approved PAID leave_requests row)
 *   - Early logout (Present, out 16:00 — informational, no payroll hit)
 *   - Absent (LOP) and Late (3 lates → late-mark LOP)
 *
 * Times are stored UTC (IST − 5:30). Idempotent: clears the window first.
 * Run:  php artisan db:seed --class=AttendanceScenarioSeeder
 */
class AttendanceScenarioSeeder extends Seeder
{
    private int $clientId = 1;
    private int $branchId = 3;
    private string $start = '2026-07-01';
    private string $end   = '2026-09-30';
    /** Months (of $start's year) the seeder covers — used for OT + cleanup. */
    private array $months = [7, 8, 9];

    public function run(): void
    {
        $emps = DB::table('employees')
            ->where('client_id', $this->clientId)
            ->where('branch_id', $this->branchId)
            ->where('status', 'Active')
            ->where('onboarding_stage_completed', '>=', 6)
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->get(['id', 'emp_code', 'user_id', 'overtime']);

        if ($emps->isEmpty()) {
            $this->command->warn('No eligible employees found for client 1 / branch 3.');
            return;
        }

        // Scenario assignment by emp_code (fallback = full day).
        $scenario = [
            'EMP-014' => 'overtime',
            'EMP-019' => 'overtime',
            'EMP-005' => 'halfday',
            'EMP-009' => 'leave',
            'EMP-011' => 'early',
            'EMP-003' => 'absent',
            'EMP-007' => 'late',
        ];

        $empIds = $emps->pluck('id')->all();

        // ── Idempotent cleanup for the window ────────────────────────────
        $dayIds = DB::table('attendances')
            ->whereIn('employee_id', $empIds)
            ->whereBetween('attendance_date', [$this->start, $this->end])
            ->pluck('id');
        if ($dayIds->isNotEmpty()) {
            DB::table('attendance_punches')->whereIn('attendance_id', $dayIds)->delete();
            DB::table('attendances')->whereIn('id', $dayIds)->delete();
        }
        DB::table('leave_requests')
            ->whereIn('employee_id', $empIds)
            ->where('from_date', '>=', $this->start)
            ->where('to_date', '<=', $this->end)
            ->delete();
        DB::table('payroll_adjustments')
            ->whereIn('employee_id', $empIds)
            ->where('type', 'overtime')
            ->whereIn('year', [2026])
            ->whereIn('month', $this->months)
            ->delete();

        // ── Overtime rate master (needed for the OT multiplier) ──────────
        if (!DB::table('master_overtime_rates')->where('rate_name', 'Hourly Pay')->exists()) {
            DB::table('master_overtime_rates')->insert([
                'client_id'  => $this->clientId,
                'branch_id'  => $this->branchId,
                'rate_name'  => 'Hourly Pay',
                'multiplier' => 1.5,
                'description'=> 'Standard 1.5× hourly overtime',
                'status'     => 'Active',
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        // Working days grouped by month (Mon–Sat); Sundays = Weekly Off.
        $allDays = [];
        $workingByMonth = [];
        for ($d = Carbon::parse($this->start); $d->lte(Carbon::parse($this->end)); $d->addDay()) {
            $allDays[] = $d->toDateString();
            if ($d->dayOfWeek !== Carbon::SUNDAY) $workingByMonth[$d->format('Y-m')][] = $d->toDateString();
        }

        $ist = 'Asia/Kolkata';
        $utc = fn (string $date, string $time) => Carbon::parse("$date $time", $ist)->utc()->toDateTimeString();

        $attCount = 0; $punchCount = 0; $leaveCount = 0; $otCount = 0;
        $otHours = [7 => 12, 8 => 8, 9 => 10];

        foreach ($emps as $emp) {
            $mode = $scenario[$emp->emp_code] ?? 'full';
            // Special dates PER MONTH so every month carries the scenario variety.
            $leaveDates = $halfDates = $earlyDates = $absentDates = $lateDates = $otDates = [];
            $leaveBlocks = [];
            foreach ($workingByMonth as $wd) {
                $leaveBlocks[] = array_slice($wd, 8, 3);
                $leaveDates  = array_merge($leaveDates,  array_slice($wd, 8, 3));
                $halfDates   = array_merge($halfDates,   array_slice($wd, 3, 2));
                $earlyDates  = array_merge($earlyDates,  array_slice($wd, 2, 4));
                $absentDates = array_merge($absentDates, array_slice($wd, 5, 2));
                $lateDates   = array_merge($lateDates,   array_slice($wd, 1, 3));
                $otDates     = array_merge($otDates,     array_slice($wd, 0, 6));
            }

            foreach ($allDays as $date) {
                $isSunday = Carbon::parse($date)->dayOfWeek === Carbon::SUNDAY;
                if ($isSunday) {
                    $attCount += $this->insertDay($emp, $date, 'Weekly Off', null, null);
                    continue;
                }

                // Defaults — full present day.
                $status = 'Present';
                $inT = '09:00'; $outT = '18:00';

                if ($mode === 'halfday' && in_array($date, $halfDates, true)) {
                    $status = 'Half Day'; $inT = '09:00'; $outT = '13:30';
                } elseif ($mode === 'leave' && in_array($date, $leaveDates, true)) {
                    $status = 'Leave'; $inT = null; $outT = null;
                } elseif ($mode === 'early' && in_array($date, $earlyDates, true)) {
                    $status = 'Present'; $inT = '09:00'; $outT = '16:00';
                } elseif ($mode === 'absent' && in_array($date, $absentDates, true)) {
                    $status = 'Absent'; $inT = null; $outT = null;
                } elseif ($mode === 'late' && in_array($date, $lateDates, true)) {
                    $status = 'Late'; $inT = '11:30'; $outT = '18:30';
                } elseif ($mode === 'overtime' && in_array($date, $otDates, true)) {
                    $status = 'Present'; $inT = '09:00'; $outT = '21:00';
                }

                $ci = $inT ? $utc($date, $inT) : null;
                $co = $outT ? $utc($date, $outT) : null;
                $attId = $this->insertDayReturnId($emp, $date, $status, $ci, $co);
                $attCount++;

                // Punches for worked days.
                if ($ci) {
                    DB::table('attendance_punches')->insert([
                        'attendance_id' => $attId, 'employee_id' => $emp->id,
                        'punched_at' => $ci, 'direction' => 'in', 'label' => 'Check In',
                        'method' => 'manual', 'created_at' => now(), 'updated_at' => now(),
                    ]);
                    $punchCount++;
                }
                if ($co) {
                    DB::table('attendance_punches')->insert([
                        'attendance_id' => $attId, 'employee_id' => $emp->id,
                        'punched_at' => $co, 'direction' => 'out', 'label' => 'Check Out',
                        'method' => 'manual', 'created_at' => now(), 'updated_at' => now(),
                    ]);
                    $punchCount++;
                }
            }

            // Approved PAID leave request per month for the leave employee.
            if ($mode === 'leave') {
                foreach ($leaveBlocks as $block) {
                    if (empty($block)) continue;
                    DB::table('leave_requests')->insert([
                        'client_id' => $this->clientId, 'branch_id' => $this->branchId,
                        'employee_id' => $emp->id, 'leave_type_id' => 2, // Casual Leave (Paid)
                        'from_date' => $block[0], 'to_date' => end($block),
                        'days' => count($block), 'day_type' => 'full',
                        'reason' => 'Seeded paid leave', 'status' => 'Approved',
                        'approved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
                    ]);
                    $leaveCount++;
                }
            }

            // Approved overtime adjustment for every covered month so it pays.
            if ($mode === 'overtime') {
                foreach ($this->months as $mo) {
                    DB::table('payroll_adjustments')->insert([
                        'client_id' => $this->clientId, 'branch_id' => $this->branchId,
                        'employee_id' => $emp->id, 'month' => $mo, 'year' => 2026,
                        'type' => 'overtime', 'label' => 'Overtime hours',
                        'amount' => 0, 'hours' => $otHours[$mo] ?? 8, 'rate' => null,
                        'status' => 'approved', 'approved_at' => now(),
                        'reason' => 'Seeded overtime', 'created_at' => now(), 'updated_at' => now(),
                    ]);
                    $otCount++;
                }
            }
        }

        $this->command->info("Seeded attendance {$this->start} → {$this->end} for {$emps->count()} employees:");
        $this->command->info("  attendances: {$attCount} · punches: {$punchCount} · leave requests: {$leaveCount} · OT adjustments: {$otCount}");
        $this->command->info('  Scenarios → OT: EMP-014, EMP-019 · Half day: EMP-005 · Leave: EMP-009 · Early: EMP-011 · Absent: EMP-003 · Late: EMP-007 · rest full day.');
    }

    private function insertDayReturnId(object $emp, string $date, string $status, ?string $ci, ?string $co): int
    {
        return (int) DB::table('attendances')->insertGetId([
            'client_id' => $this->clientId, 'branch_id' => $this->branchId,
            'employee_id' => $emp->id, 'user_id' => $emp->user_id,
            'attendance_date' => $date, 'status' => $status,
            'check_in_at' => $ci, 'check_out_at' => $co,
            'check_in_method' => $ci ? 'manual' : null,
            'check_out_method' => $co ? 'manual' : null,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function insertDay(object $emp, string $date, string $status, ?string $ci, ?string $co): int
    {
        $this->insertDayReturnId($emp, $date, $status, $ci, $co);
        return 1;
    }
}
