<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Seeds the 14 payroll QA scenarios for a branch and month.
 *
 * Run it ON THE SERVER. It uses the app's own database connection, so there
 * are no credentials in this file and no cross-internet round trips — seeding
 * from a laptop meant ~1,000 statements over a 250 ms link, which timed out
 * halfway through more than once.
 *
 * Idempotent: it clears the target month for these employees before writing,
 * so running it twice reproduces the same state rather than doubling it.
 * Everything is bounded by client + branch + month; nothing else is touched.
 *
 *   php artisan payroll:seed-scenarios                 # dry run, prints the plan
 *   php artisan payroll:seed-scenarios --apply
 *   php artisan payroll:seed-scenarios --apply --client=2 --branch=6 --month=2026-08
 */
class SeedPayrollScenarios extends Command
{
    protected $signature = 'payroll:seed-scenarios
        {--apply           : Write. Without this the command only prints the plan}
        {--client=2        : client_id}
        {--branch=6        : branch_id}
        {--month=2026-08   : YYYY-MM to seed}';

    protected $description = 'Seed the 14 payroll QA scenarios (attendance, punches, leave, shifts, holiday) for a branch + month';

    /** Shift windows. General is corrected from the stored 09:30–06:30 typo. */
    private array $shifts = [
        ['name' => 'General Shift',    'start' => '09:30', 'end' => '18:30'],
        ['name' => 'Morning Shift',    'start' => '07:00', 'end' => '16:00'],
        ['name' => 'Evening Shift',    'start' => '13:00', 'end' => '21:00'],
        ['name' => 'Night Shift',      'start' => '22:00', 'end' => '06:00'],
        ['name' => 'Rotational Shift', 'start' => '09:30', 'end' => '18:30'],
    ];

    /** [emp_code, scenario, shift, weekly_off] — weekly_off is chosen to make
     *  the scenario reproducible; scenarios 5-7 are ABOUT that pattern. */
    private array $spec = [
        ['EMP-004', 'Correct On Time',                               'General Shift',    'Sunday Only'],
        ['EMP-014', '4 Days Late 30 min + 30 min Late Out',          'Morning Shift',    'Sunday Only'],
        ['EMP-013', 'Every Day Late 30 min + 9:30 PM Out',           'Evening Shift',    'Sunday Only'],
        ['EMP-006', '5 Days Leave',                                  'General Shift',    'Sunday Only'],
        ['EMP-008', 'Sandwich Leave + Holiday/Saturday/Monday',      'General Shift',    'Sunday Only'],
        ['EMP-010', 'Sandwich Leave - Rotational Shift',             'Rotational Shift', 'Rotational — 2nd & 4th Saturday'],
        ['EMP-007', 'Sandwich Leave - Saturday + Sunday Policy',     'Rotational Shift', 'Saturday & Sunday'],
        ['EMP-005', 'Overtime - Time and a Half',                    'Evening Shift',    'Sunday Only'],
        ['EMP-003', 'Overtime - Double Time and a Half',             'Night Shift',      'Sunday Only'],
        ['EMP-009', 'Overtime - Double Time',                        'General Shift',    'Sunday Only'],
        ['EMP-012', 'Leave 1 - Paid 1',                              'Morning Shift',    'Sunday Only'],
        ['EMP-011', 'Leave 3 - Paid 2',                              'General Shift',    'Sunday Only'],
        ['EMP-002', 'Fri, Sat Paid Leave',                           'General Shift',    'Sunday Only'],
        ['EMP-001', 'Half Day - 5, Paid Half Day - 2',               'General Shift',    'Sunday Only'],
    ];

    public function handle(): int
    {
        $apply  = (bool) $this->option('apply');
        $client = (int) $this->option('client');
        $branch = (int) $this->option('branch');
        [$y, $m] = array_map('intval', explode('-', (string) $this->option('month')));

        $first = sprintf('%04d-%02d-01', $y, $m);
        $last  = date('Y-m-t', strtotime($first));
        $this->info(($apply ? 'APPLY' : 'DRY RUN') . " — client $client / branch $branch / $first..$last");

        $win = [];
        foreach ($this->shifts as $s) $win[$s['name']] = [$s['start'], $s['end']];

        // Resolve employees
        $emp = [];
        foreach ($this->spec as [$code, , , ]) {
            $r = DB::table('employees')->where('emp_code', $code)
                ->where('client_id', $client)->where('branch_id', $branch)
                ->whereNull('deleted_at')->first(['id', 'user_id', 'display_name']);
            if (!$r) { $this->error("$code not found in client $client / branch $branch"); return 1; }
            $emp[$code] = $r;
        }

        // A company holiday inside the month, needed by the sandwich scenario.
        $holiday = ['date' => sprintf('%04d-%02d-15', $y, $m), 'name' => 'Independence Day'];

        [$plans, $leaves] = $this->buildPlans($win, $first, $last, $holiday['date']);

        $this->table(['Code', 'Scenario', 'Shift', 'Weekly off', 'Days', 'Leave'],
            array_map(fn($s) => [$s[0], $s[1], $s[2], $s[3], count($plans[$s[0]]), count($leaves[$s[0]])], $this->spec));

        $nA = array_sum(array_map('count', $plans));
        $this->line("attendance rows: $nA   punches: " . ($nA * 2) . "   leave: " . array_sum(array_map('count', $leaves)));

        if (!$apply) { $this->comment('Dry run. Re-run with --apply to write.'); return 0; }

        DB::transaction(function () use ($client, $branch, $first, $last, $emp, $plans, $leaves, $holiday) {
            DB::table('branches')->where('id', $branch)->where('client_id', $client)
                ->update(['shifts' => json_encode($this->shifts), 'updated_at' => now()]);

            foreach ($this->spec as [$code, , $shift, $wo]) {
                DB::table('employees')->where('id', $emp[$code]->id)->update([
                    'shift' => $shift, 'weekly_off' => $wo,
                    // Joining date sat on the LAST day of the month, which would
                    // put the whole period before employment and blank it.
                    'date_of_joining' => sprintf('%04d-01-01', (int) substr($first, 0, 4)),
                    'attendance_tracking' => true, 'updated_at' => now(),
                ]);
            }

            $hg = DB::table('holiday_groups')->where('client_id', $client)->where('branch_id', $branch)->value('id');
            DB::table('holidays')->where('client_id', $client)->whereDate('date', $holiday['date'])->delete();
            DB::table('holidays')->insert([
                'client_id' => $client, 'branch_id' => $branch, 'name' => $holiday['name'],
                'date' => $holiday['date'], 'type' => 'Public', 'is_recurring' => false,
                'holiday_group_id' => $hg, 'created_at' => now(), 'updated_at' => now(),
            ]);

            $ids = array_map(fn($e) => $e->id, $emp);
            DB::table('attendance_punches')->whereIn('attendance_id', function ($q) use ($client, $branch, $ids, $first, $last) {
                $q->from('attendances')->select('id')->where('client_id', $client)->where('branch_id', $branch)
                  ->whereIn('employee_id', $ids)->whereBetween('attendance_date', [$first, $last]);
            })->delete();
            DB::table('attendances')->where('client_id', $client)->where('branch_id', $branch)
                ->whereIn('employee_id', $ids)->whereBetween('attendance_date', [$first, $last])->delete();
            DB::table('leave_requests')->where('client_id', $client)->where('branch_id', $branch)
                ->whereIn('employee_id', $ids)->where('from_date', '<=', $last)->where('to_date', '>=', $first)->delete();

            // Attendance, batched.
            $rows = [];
            foreach ($this->spec as [$code, , , ]) {
                foreach ($plans[$code] as $iso => $d) {
                    $outDay = $d['out'] < $d['in'] ? date('Y-m-d', strtotime("$iso +1 day")) : $iso;
                    $rows[] = [
                        'client_id' => $client, 'branch_id' => $branch,
                        'employee_id' => $emp[$code]->id, 'user_id' => $emp[$code]->user_id,
                        'attendance_date' => $iso,
                        'check_in_at' => "$iso {$d['in']}:00", 'check_out_at' => "$outDay {$d['out']}:00",
                        'check_in_method' => 'manual', 'check_out_method' => 'manual',
                        'status' => $d['status'], 'created_at' => now(), 'updated_at' => now(),
                    ];
                }
            }
            foreach (array_chunk($rows, 200) as $c) DB::table('attendances')->insert($c);

            // Punches, matched back by (employee, date) rather than insert order.
            $map = DB::table('attendances')->where('client_id', $client)->where('branch_id', $branch)
                ->whereIn('employee_id', $ids)->whereBetween('attendance_date', [$first, $last])
                ->get(['id', 'employee_id', 'attendance_date', 'check_in_at', 'check_out_at']);
            $punch = [];
            foreach ($map as $a) {
                $punch[] = ['attendance_id' => $a->id, 'employee_id' => $a->employee_id, 'punched_at' => $a->check_in_at,
                            'direction' => 'in',  'label' => 'Check In',  'method' => 'manual', 'created_at' => now(), 'updated_at' => now()];
                $punch[] = ['attendance_id' => $a->id, 'employee_id' => $a->employee_id, 'punched_at' => $a->check_out_at,
                            'direction' => 'out', 'label' => 'Check Out', 'method' => 'manual', 'created_at' => now(), 'updated_at' => now()];
            }
            foreach (array_chunk($punch, 300) as $c) DB::table('attendance_punches')->insert($c);

            $lrows = [];
            foreach ($this->spec as [$code, $scenario, , ]) {
                foreach ($leaves[$code] as [$from, $to, $days, $dayType, $typeId]) {
                    $lrows[] = ['client_id' => $client, 'branch_id' => $branch, 'employee_id' => $emp[$code]->id,
                        'leave_type_id' => $typeId, 'from_date' => $from, 'to_date' => $to, 'days' => $days,
                        'day_type' => $dayType, 'reason' => "QA scenario: $scenario", 'status' => 'Approved',
                        'approved_at' => now(), 'created_at' => now(), 'updated_at' => now()];
                }
            }
            if ($lrows) DB::table('leave_requests')->insert($lrows);

            $this->info('✓ shifts, employees, holiday, ' . count($rows) . ' attendance, '
                . count($punch) . ' punches, ' . count($lrows) . ' leave');
        });

        $this->info('Done.');
        return 0;
    }

    /** Weekly-off test mirroring App\Support\WeekOff. */
    private function isOff(string $pattern, string $iso): bool
    {
        $dow = (int) date('w', strtotime($iso));
        if ($dow === 0) return true;
        if ($dow !== 6) return false;
        $nth = (int) ceil((int) date('j', strtotime($iso)) / 7);
        if (str_contains($pattern, 'Saturday & Sunday')) return true;
        if (str_contains($pattern, '2nd') && str_contains($pattern, '4th')) return $nth % 2 === 0;
        if (str_contains($pattern, '1st') && str_contains($pattern, '3rd')) return $nth % 2 === 1;
        return false;
    }

    /** @return array{0: array<string,array>, 1: array<string,array>} */
    private function buildPlans(array $win, string $first, string $last, string $holiday): array
    {
        $all = [];
        for ($d = strtotime($first); $d <= strtotime($last); $d = strtotime('+1 day', $d)) $all[] = date('Y-m-d', $d);

        $plans = []; $leaves = [];
        foreach ($this->spec as [$code, , $shift, $wo]) {
            [$s, $e] = $win[$shift];
            $wd = array_values(array_filter($all, fn($iso) => !$this->isOff($wo, $iso) && $iso !== $holiday));
            $plan = []; $lv = [];
            foreach ($wd as $iso) $plan[$iso] = ['in' => $s, 'out' => $e, 'status' => 'Present'];
            $add = fn(string $t, int $n) => date('H:i', strtotime("$t +$n minutes"));

            $ym = substr($first, 0, 7);
            $day = fn(int $n) => sprintf('%s-%02d', $ym, $n);

            switch ($code) {
                case 'EMP-014':
                    foreach (array_slice($wd, 0, 4) as $iso) $plan[$iso] = ['in' => $add($s, 30), 'out' => $add($e, 30), 'status' => 'Late'];
                    break;
                case 'EMP-013':
                    foreach ($wd as $iso) $plan[$iso] = ['in' => $add($s, 30), 'out' => '21:30', 'status' => 'Late'];
                    break;
                case 'EMP-006':
                    $f = array_slice($wd, 4, 5);
                    foreach ($f as $iso) unset($plan[$iso]);
                    $lv[] = [reset($f), end($f), count($f), 'full', 3];
                    break;
                case 'EMP-008':
                    foreach ([$day(22), $day(24)] as $iso) { unset($plan[$iso]); $lv[] = [$iso, $iso, 1, 'full', 3]; }
                    break;
                case 'EMP-010':
                case 'EMP-007':
                    foreach ([$day(7), $day(10)] as $iso) { unset($plan[$iso]); $lv[] = [$iso, $iso, 1, 'full', 3]; }
                    break;
                case 'EMP-005':
                    foreach (array_slice($wd, 0, 5) as $iso) $plan[$iso] = ['in' => $s, 'out' => $add($e, 120), 'status' => 'Present'];
                    break;
                case 'EMP-003':
                    foreach (array_slice($wd, 0, 5) as $iso) $plan[$iso] = ['in' => $s, 'out' => $add($e, 240), 'status' => 'Present'];
                    break;
                case 'EMP-009':
                    foreach (array_slice($wd, 0, 5) as $iso) $plan[$iso] = ['in' => $s, 'out' => $add($e, 180), 'status' => 'Present'];
                    break;
                case 'EMP-012':
                    $o = $wd[5]; unset($plan[$o]); $lv[] = [$o, $o, 1, 'full', 3];
                    break;
                case 'EMP-011':
                    $t3 = array_slice($wd, 5, 3);
                    foreach ($t3 as $iso) unset($plan[$iso]);
                    $lv[] = [$t3[0], $t3[1], 2, 'full', 3];   // paid
                    $lv[] = [$t3[2], $t3[2], 1, 'full', 5];   // unpaid
                    break;
                case 'EMP-002':
                    foreach ([$day(7), $day(8)] as $iso) unset($plan[$iso]);
                    $lv[] = [$day(7), $day(8), 2, 'full', 3];
                    break;
                case 'EMP-001':
                    foreach (array_slice($wd, 0, 5) as $i => $iso) {
                        $plan[$iso] = ['in' => $s, 'out' => $add($s, 240), 'status' => 'Half Day'];
                        if ($i < 2) $lv[] = [$iso, $iso, 0.5, 'second_half', 3];
                    }
                    break;
            }
            $plans[$code] = $plan; $leaves[$code] = $lv;
        }
        return [$plans, $leaves];
    }
}
