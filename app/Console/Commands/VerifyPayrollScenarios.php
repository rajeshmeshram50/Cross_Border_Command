<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Audits seeded payroll QA data against the scenario sheet.
 *
 * Read-only. Run it after payroll:seed-scenarios to confirm what actually
 * landed, rather than trusting that the seeder said it wrote things:
 *
 *   php artisan payroll:verify-scenarios
 *   php artisan payroll:verify-scenarios --client=2 --branch=6 --month=2026-08
 *
 * Exits non-zero if anything fails, so it can gate a pipeline.
 */
class VerifyPayrollScenarios extends Command
{
    protected $signature = 'payroll:verify-scenarios
        {--client=2      : client_id}
        {--branch=6      : branch_id}
        {--month=2026-08 : YYYY-MM that was seeded}';

    protected $description = 'Check the seeded payroll scenario data against the sheet (read-only)';

    /** emp_code => [name, gross, pf, esi, shift, scenario] — straight from the sheet. */
    private array $sheet = [
        'EMP-004' => ['Anushka Kadam',   33333,  false, false, 'General Shift',    'Correct On Time'],
        'EMP-014' => ['Sakshi Kale',     30000,  false, false, 'Morning Shift',    '4 Days Late 30 min + 30 min Late Out'],
        'EMP-013' => ['Suraj Randhave',  41667,  true,  false, 'Evening Shift',    'Every Day Late 30 min + 9:30 PM Out'],
        'EMP-006' => ['Dhanashri Bhise', 41667,  true,  false, 'General Shift',    '5 Days Leave'],
        'EMP-008' => ['Pallavi Bhuruk',  100000, true,  false, 'General Shift',    'Sandwich + Holiday/Sat/Mon'],
        'EMP-010' => ['Harshada Bhalke', 83333,  false, false, 'Rotational Shift', 'Sandwich - Rotational'],
        'EMP-007' => ['Athrav Patekar',  50000,  true,  false, 'Rotational Shift', 'Sandwich - Sat+Sun policy'],
        'EMP-005' => ['Anjali Patil',    41667,  true,  false, 'Evening Shift',    'OT 1.5x'],
        'EMP-003' => ['Ritika Umbarje',  75000,  true,  true,  'Night Shift',      'OT 2.5x'],
        'EMP-009' => ['Durgesh Urkude',  50000,  true,  true,  'General Shift',    'OT 2x'],
        'EMP-012' => ['Sakshi Kale',     50000,  true,  false, 'Morning Shift',    'Leave 1 - Paid 1'],
        'EMP-011' => ['Omkar Kale',      125000, true,  false, 'General Shift',    'Leave 3 - Paid 2'],
        'EMP-002' => ['Manav Pimparkar', 200000, true,  true,  'General Shift',    'Fri, Sat Paid Leave'],
        'EMP-001' => ['Trupti Pawar',    250000, true,  true,  'General Shift',    'Half Day 5, Paid Half 2'],
    ];

    private int $pass = 0;
    private int $fail = 0;

    private function chk(string $what, bool $ok, string $detail = ''): void
    {
        if ($ok) { $this->pass++; $this->line("  <fg=green>PASS</> $what"); }
        else     { $this->fail++; $this->line("  <fg=red>FAIL</> $what" . ($detail ? "  — $detail" : '')); }
    }

    public function handle(): int
    {
        $client = (int) $this->option('client');
        $branch = (int) $this->option('branch');
        [$y, $m] = array_map('intval', explode('-', (string) $this->option('month')));
        $first = sprintf('%04d-%02d-01', $y, $m);
        $last  = date('Y-m-t', strtotime($first));

        $this->info("Verifying client $client / branch $branch / $first..$last\n");

        // 1. shifts on the branch
        $this->line('<options=bold>Branch shifts</>');
        $shifts = json_decode((string) DB::table('branches')->where('id', $branch)->value('shifts'), true) ?: [];
        $names  = array_column($shifts, 'name');
        foreach (['General Shift', 'Morning Shift', 'Evening Shift', 'Night Shift', 'Rotational Shift'] as $need) {
            $this->chk("shift defined: $need", in_array($need, $names, true), 'have: ' . implode(', ', $names));
        }
        $gen = collect($shifts)->firstWhere('name', 'General Shift');
        $this->chk('General Shift ends 18:30 (not the 06:30 typo)', ($gen['end'] ?? '') === '18:30', 'end=' . ($gen['end'] ?? '?'));

        // 2. holiday
        $this->newLine();
        $this->line('<options=bold>Holiday</>');
        $hol = DB::table('holidays')->where('client_id', $client)
            ->whereBetween('date', [$first, $last])->whereNull('deleted_at')->get(['name', 'date']);
        $this->chk('a holiday exists inside the month', $hol->isNotEmpty(),
            $hol->isEmpty() ? 'none found' : '');
        foreach ($hol as $h) $this->line("       {$h->date} {$h->name}");

        // 3. per employee
        $this->newLine();
        $this->line('<options=bold>Employees</>');
        $rows = [];
        foreach ($this->sheet as $code => [$name, $gross, $pf, $esi, $shift, $scenario]) {
            $e = DB::table('employees')->where('emp_code', $code)
                ->where('client_id', $client)->where('branch_id', $branch)->whereNull('deleted_at')
                ->first(['id', 'display_name', 'shift', 'weekly_off', 'date_of_joining']);
            if (!$e) { $this->chk("$code exists", false); continue; }

            $ss = DB::table('salary_structures')->where('employee_id', $e->id)->whereNull('deleted_at')
                ->orderByDesc('effective_from')->orderByDesc('id')
                ->first(['monthly_gross', 'pf_applicable', 'esi_applicable']);

            $att   = DB::table('attendances')->where('employee_id', $e->id)
                ->whereBetween('attendance_date', [$first, $last])->whereNull('deleted_at');
            $nAtt  = (clone $att)->count();
            $nLate = (clone $att)->where('status', 'Late')->count();
            $nHalf = (clone $att)->where('status', 'Half Day')->count();
            /* Count punches by their PARENT attendance date, not by punched_at.
             *
             * A night shift starts at 22:00 and checks out at 06:00 the NEXT
             * day, so the check-out for the 31st is stamped 1 September. Filtering
             * on punched_at dropped it and reported 49 of 50 for EMP-003 — a
             * false failure on data that was complete. The punch belongs to the
             * day it was worked, which is the attendance row, not the wall clock. */
            $punch = DB::table('attendance_punches as p')
                ->join('attendances as a', 'a.id', '=', 'p.attendance_id')
                ->where('a.employee_id', $e->id)
                ->whereBetween('a.attendance_date', [$first, $last])
                ->whereNull('p.deleted_at')->count();
            $lv    = DB::table('leave_requests')->where('employee_id', $e->id)
                ->where('from_date', '<=', $last)->where('to_date', '>=', $first);
            $nLv   = (clone $lv)->count();
            $dLv   = (float) (clone $lv)->sum('days');

            // overtime = worked minutes beyond the shift window, summed
            $ot = 0.0;
            foreach ((clone $att)->get(['check_in_at', 'check_out_at']) as $a) {
                if (!$a->check_in_at || !$a->check_out_at) continue;
                $mins = (strtotime($a->check_out_at) - strtotime($a->check_in_at)) / 60;
                $ot  += max(0, $mins - 540);              // 9h shift window
            }

            $shiftOk = $e->shift === $shift;
            $dojOk   = $e->date_of_joining < $first;
            $grossOk = $ss && abs((float) $ss->monthly_gross - $gross) < 1;
            $pfOk    = $ss && (bool) $ss->pf_applicable === $pf;
            $esiOk   = $ss && (bool) $ss->esi_applicable === $esi;
            $attOk   = $nAtt > 0;
            $punchOk = $punch === $nAtt * 2;

            $ok = $shiftOk && $dojOk && $grossOk && $pfOk && $esiOk && $attOk && $punchOk;
            $ok ? $this->pass++ : $this->fail++;

            $rows[] = [
                $ok ? '✓' : '✗',
                $code,
                substr($scenario, 0, 30),
                $shiftOk ? $shift : "{$e->shift} ≠ $shift",
                $dojOk ? (string) $e->date_of_joining : "DOJ {$e->date_of_joining} !",
                $grossOk ? number_format($gross) : (($ss->monthly_gross ?? '—') . " ≠ $gross"),
                ($pfOk ? ($pf ? 'PF' : '-') : 'PF!') . '/' . ($esiOk ? ($esi ? 'ESI' : '-') : 'ESI!'),
                $nAtt,
                $punchOk ? $punch : "$punch ≠ " . ($nAtt * 2),
                $nLate ?: '-',
                $nHalf ?: '-',
                round($ot / 60, 1) ?: '-',
                $nLv ? "$nLv ({$dLv}d)" : '-',
            ];
        }

        $this->table(['', 'Code', 'Scenario', 'Shift', 'DOJ', 'Gross', 'PF/ESI',
                      'Att', 'Punch', 'Late', 'Half', 'OT h', 'Leave'], $rows);

        // 4. scenario-specific expectations
        $this->line('<options=bold>Scenario expectations</>');
        $late14 = $this->lateCount($client, $branch, 'EMP-014', $first, $last);
        $this->chk('EMP-014 has exactly 4 late days', $late14 === 4, "got $late14");

        $e13 = $this->empId($client, $branch, 'EMP-013');
        $wk13 = DB::table('attendances')->where('employee_id', $e13)
            ->whereBetween('attendance_date', [$first, $last])->count();
        $late13 = $this->lateCount($client, $branch, 'EMP-013', $first, $last);
        $this->chk('EMP-013 late on every working day', $late13 === $wk13, "$late13 of $wk13");

        $this->chk('EMP-006 has a 5-day leave', $this->leaveDays($client, $branch, 'EMP-006', $first, $last) == 5.0);
        $this->chk('EMP-011 has 3 leave days (2 paid + 1 unpaid)', $this->leaveDays($client, $branch, 'EMP-011', $first, $last) == 3.0);
        $this->chk('EMP-002 has 2 leave days (Fri+Sat)', $this->leaveDays($client, $branch, 'EMP-002', $first, $last) == 2.0);
        $this->chk('EMP-001 has 1.0 leave day across 2 half days',
            $this->leaveDays($client, $branch, 'EMP-001', $first, $last) == 1.0);

        $half = DB::table('attendances')->where('employee_id', $this->empId($client, $branch, 'EMP-001'))
            ->whereBetween('attendance_date', [$first, $last])->where('status', 'Half Day')->count();
        $this->chk('EMP-001 has 5 half days', $half === 5, "got $half");

        foreach (['EMP-008', 'EMP-010', 'EMP-007'] as $code) {
            $n = DB::table('leave_requests')->where('employee_id', $this->empId($client, $branch, $code))
                ->where('from_date', '<=', $last)->where('to_date', '>=', $first)->count();
            $this->chk("$code has 2 leave rows either side of the off days", $n === 2, "got $n");
        }

        $this->newLine();
        $this->line(sprintf('<options=bold>PASS %d   FAIL %d</>', $this->pass, $this->fail));
        return $this->fail === 0 ? 0 : 1;
    }

    private function empId(int $c, int $b, string $code): ?int
    {
        return DB::table('employees')->where('emp_code', $code)->where('client_id', $c)
            ->where('branch_id', $b)->whereNull('deleted_at')->value('id');
    }

    private function lateCount(int $c, int $b, string $code, string $f, string $l): int
    {
        return DB::table('attendances')->where('employee_id', $this->empId($c, $b, $code))
            ->whereBetween('attendance_date', [$f, $l])->where('status', 'Late')->count();
    }

    private function leaveDays(int $c, int $b, string $code, string $f, string $l): float
    {
        return (float) DB::table('leave_requests')->where('employee_id', $this->empId($c, $b, $code))
            ->where('from_date', '<=', $l)->where('to_date', '>=', $f)->sum('days');
    }
}
