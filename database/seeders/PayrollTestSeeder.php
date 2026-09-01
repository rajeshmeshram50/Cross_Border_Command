<?php

namespace Database\Seeders;

use App\Models\Attendance;
use App\Models\Employee;
use App\Models\SalaryStructure;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Seeds realistic attendance + leave + salary scenarios for ONE test client so
 * payroll can be exercised against every rule — including the male/female
 * Professional-Tax slabs (Rule 9).
 *
 *   php artisan db:seed --class=PayrollTestSeeder
 *
 * Idempotent: re-running wipes the test month's attendance/leave/structures
 * for the target employees and re-seeds them. Target client is the first
 * client that already has employees (defaults to client 1).
 */
class PayrollTestSeeder extends Seeder
{
    public function run(): void
    {
        $clientId = (int) (Employee::query()->whereNotNull('client_id')->value('client_id') ?? 1);
        $branchId = (int) (Employee::where('client_id', $clientId)->value('branch_id') ?? 0) ?: null;

        $period = Carbon::now()->startOfMonth();
        $start  = $period->copy()->startOfMonth();
        $end    = $period->copy()->endOfMonth();

        $this->command?->info("Seeding payroll test data for client {$clientId}, {$start->format('M Y')}");

        // ── 1. Ensure an Unpaid leave type exists (for the unpaid-leave case) ──
        $unpaidTypeId = $this->ensureUnpaidLeaveType($clientId);

        // ── 2. Test employees — covers every PT slab + scenario ──────────────
        // gross drives the PT slab; gender flips the male/female rule.
        $specs = [
            // code,           name,               gender,  state, gross, pf,  joining,  scenario
            ['PT-M-HIGH', 'Aarav PT-MaleHigh',  'Male',   14, 50000, true,  null,        'present_full'],
            ['PT-M-MID',  'Vivek PT-MaleMid',   'Male',   14,  9000, false, null,        'late_marks'],   // 7501-10000 -> 175
            ['PT-M-LOW',  'Sahil PT-MaleLow',   'Male',   14,  7000, false, null,        'absent'],       // <=7500 -> 0
            ['PT-F-HIGH', 'Anjali PT-FemHigh',  'Female', 14, 30000, true,  null,        'paid_leave'],   // >25000 -> 200
            ['PT-F-LOW',  'Priya PT-FemLow',    'Female', 14, 22000, false, null,        'unpaid_leave', $unpaidTypeId], // <=25000 -> 0 (exempt)
            ['PT-PRORATE','Rohit PT-MidJoin',   'Male',   14, 26000, false, 15,          'present_full'], // joined 15th -> pro-rata
        ];

        foreach ($specs as $s) {
            [$code, $name, $gender, $stateId, $gross, $pf, $joinDay, $scenario] = array_pad($s, 9, null);
            $unpaidId = $s[8] ?? null;

            $parts = explode(' ', $name, 2);
            $doj = $joinDay ? $start->copy()->day($joinDay) : $start->copy()->subMonths(3);

            $emp = Employee::updateOrCreate(
                ['emp_code' => $code, 'client_id' => $clientId],
                [
                    'branch_id'           => $branchId,
                    'first_name'          => $parts[0],
                    'last_name'           => $parts[1] ?? '',
                    'gender'              => $gender,
                    'state_id'            => $stateId,
                    'status'              => 'Active',
                    'work_type'           => 'Full-time',
                    'date_of_joining'     => $doj->toDateString(),
                    'pf_eligible'         => $pf,
                    'bank_account_number' => '9000' . str_pad((string) random_int(1, 999999), 6, '0', STR_PAD_LEFT),
                    'ifsc_code'           => 'HDFC0001234',
                    'official_email'      => strtolower(str_replace(' ', '.', $name)) . '@example.com',
                ]
            );

            // Salary structure (50/30/20 split) — supersede any active one.
            $this->setSalary($emp, $gross, $pf);

            // Attendance + leave for the scenario.
            $this->seedAttendanceAndLeave($emp, $start, $end, $scenario, $unpaidId);
        }

        $this->command?->info('Done. Run payroll for ' . $start->format('M Y') . ' to verify.');
    }

    private function ensureUnpaidLeaveType(int $clientId): ?int
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable('master_leave_types')) return null;
        $existing = DB::table('master_leave_types')
            ->where('client_id', $clientId)
            ->whereRaw('LOWER(paid_unpaid) = ?', ['unpaid'])
            ->value('id');
        if ($existing) return (int) $existing;

        $cols = ['client_id' => $clientId, 'name' => 'Unpaid Leave', 'paid_unpaid' => 'Unpaid', 'created_at' => now(), 'updated_at' => now()];
        if (\Illuminate\Support\Facades\Schema::hasColumn('master_leave_types', 'short_code')) $cols['short_code'] = 'LWP';
        if (\Illuminate\Support\Facades\Schema::hasColumn('master_leave_types', 'status')) $cols['status'] = 'Active';
        return (int) DB::table('master_leave_types')->insertGetId($cols);
    }

    private function setSalary(Employee $emp, float $gross, bool $pf): void
    {
        /* Read the outgoing version BEFORE superseding it, and bump. This
         * superseded first and then hard-coded `version => 1`, so every re-run
         * of the seeder added another row at version 1 — this database carries
         * employees with seven of them, and PayrollService::activeStructure()
         * has had to tie-break on id ever since to pick the right one. The
         * controller path (SalaryStructureController::store) has always done
         * it in this order; the seeder is now consistent with it. (#133) */
        $prev = SalaryStructure::where('employee_id', $emp->id)
            ->where('status', 'active')
            ->orderByDesc('version')
            ->first();
        $version = $prev ? (int) $prev->version + 1 : 1;
        SalaryStructure::where('employee_id', $emp->id)->where('status', 'active')->update(['status' => 'superseded']);
        $basic = round($gross * 0.5);
        $hra = round($gross * 0.3);
        $special = $gross - $basic - $hra;
        SalaryStructure::create([
            'client_id' => $emp->client_id, 'branch_id' => $emp->branch_id, 'employee_id' => $emp->id,
            'version' => $version, 'effective_from' => Carbon::now()->startOfYear()->toDateString(), 'status' => 'active',
            'earnings' => [
                ['code' => 'basic', 'label' => 'Basic Salary', 'amount' => $basic],
                ['code' => 'hra', 'label' => 'House Rent Allowance', 'amount' => $hra],
                ['code' => 'special', 'label' => 'Special Allowance', 'amount' => $special],
            ],
            'deductions' => [],
            'monthly_gross' => $gross, 'monthly_ctc' => $gross,
            'pf_applicable' => $pf, 'esi_applicable' => $gross <= 21000, 'pt_applicable' => true,
            'approval_status' => 'approved', 'approved_at' => now(),
        ]);

        /* Keep the employee's own CTC in step with the structure, the way
         * SalaryStructureController::store() does. Without this the seeded
         * accounts opened Stage 4 – Compensation showing an annual_salary that
         * had nothing to do with the gross payroll actually pays from, which
         * reads on screen as the payslip ignoring the salary structure. (#133) */
        $emp->forceFill(['annual_salary' => round($gross * 12, 2)])->save();
    }

    private function seedAttendanceAndLeave(Employee $emp, Carbon $start, Carbon $end, string $scenario, ?int $unpaidTypeId): void
    {
        // Clean the test month for this employee first (idempotent).
        Attendance::where('employee_id', $emp->id)
            ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])->forceDelete();
        if (\Illuminate\Support\Facades\Schema::hasTable('leave_requests')) {
            DB::table('leave_requests')->where('employee_id', $emp->id)
                ->whereBetween('from_date', [$start->toDateString(), $end->toDateString()])->delete();
        }

        $joining = $emp->date_of_joining ? Carbon::parse($emp->date_of_joining) : $start;
        $workStart = $joining->greaterThan($start) ? $joining->copy() : $start->copy();

        $lateLeft = $scenario === 'late_marks' ? 3 : 0;
        $absentLeft = $scenario === 'absent' ? 2 : 0;
        $halfLeft = $scenario === 'paid_leave' ? 1 : 0;

        // Leave window (2 days) for leave scenarios.
        $leaveDays = [];
        if (in_array($scenario, ['paid_leave', 'unpaid_leave'], true)) {
            $lv = $workStart->copy()->addDays(5);
            while ($lv->dayOfWeek === Carbon::SUNDAY) $lv->addDay();
            $leaveDays = [$lv->toDateString(), $lv->copy()->addDay()->toDateString()];
            $this->insertLeave($emp, $lv, $lv->copy()->addDay(), $scenario, $unpaidTypeId);
        }

        for ($d = $workStart->copy(); $d->lte($end); $d->addDay()) {
            if ($d->dayOfWeek === Carbon::SUNDAY) continue;            // weekly off
            $date = $d->toDateString();
            if (in_array($date, $leaveDays, true)) continue;          // on leave, no attendance row

            $status = 'Present';
            if ($lateLeft > 0)      { $status = 'Late'; $lateLeft--; }
            elseif ($absentLeft > 0) { $absentLeft--; continue; }     // absent = no row
            elseif ($halfLeft > 0)   { $status = 'Half Day'; $halfLeft--; }

            Attendance::create([
                'client_id' => $emp->client_id, 'branch_id' => $emp->branch_id,
                'employee_id' => $emp->id, 'attendance_date' => $date, 'status' => $status,
            ]);
        }
    }

    private function insertLeave(Employee $emp, Carbon $from, Carbon $to, string $scenario, ?int $unpaidTypeId): void
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable('leave_requests')) return;
        $paidTypeId = DB::table('master_leave_types')->whereRaw('LOWER(paid_unpaid) = ?', ['paid'])->value('id');
        $typeId = $scenario === 'unpaid_leave' ? ($unpaidTypeId ?: $paidTypeId) : $paidTypeId;
        if (!$typeId) return;

        DB::table('leave_requests')->insert([
            'client_id' => $emp->client_id, 'branch_id' => $emp->branch_id, 'employee_id' => $emp->id,
            'leave_type_id' => $typeId, 'from_date' => $from->toDateString(), 'to_date' => $to->toDateString(),
            'days' => 2, 'day_type' => 'full', 'status' => 'Approved',
            'reason' => 'Test ' . $scenario, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}
