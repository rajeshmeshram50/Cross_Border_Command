<?php

namespace Database\Seeders;

use App\Models\Attendance;
use App\Models\Employee;
use App\Models\SalaryStructure;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

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

        $unpaidTypeId = $this->ensureUnpaidLeaveType($clientId);

        $specs = [
            ['PT-M-HIGH', 'Aarav PT-MaleHigh',  'Male',   14, 50000, true,  null,        'present_full'],
            ['PT-M-MID',  'Vivek PT-MaleMid',   'Male',   14,  9000, false, null,        'late_marks'],
            ['PT-M-LOW',  'Sahil PT-MaleLow',   'Male',   14,  7000, false, null,        'absent'],
            ['PT-F-HIGH', 'Anjali PT-FemHigh',  'Female', 14, 30000, true,  null,        'paid_leave'],
            ['PT-F-LOW',  'Priya PT-FemLow',    'Female', 14, 22000, false, null,        'unpaid_leave', $unpaidTypeId],
            ['PT-PRORATE','Rohit PT-MidJoin',   'Male',   14, 26000, false, 15,          'present_full'],
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

            $this->setSalary($emp, $gross, $pf);

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

        $emp->forceFill(['annual_salary' => round($gross * 12, 2)])->save();
    }

    private function seedAttendanceAndLeave(Employee $emp, Carbon $start, Carbon $end, string $scenario, ?int $unpaidTypeId): void
    {
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

        $leaveDays = [];
        if (in_array($scenario, ['paid_leave', 'unpaid_leave'], true)) {
            $lv = $workStart->copy()->addDays(5);
            while ($lv->dayOfWeek === Carbon::SUNDAY) $lv->addDay();
            $leaveDays = [$lv->toDateString(), $lv->copy()->addDay()->toDateString()];
            $this->insertLeave($emp, $lv, $lv->copy()->addDay(), $scenario, $unpaidTypeId);
        }

        for ($d = $workStart->copy(); $d->lte($end); $d->addDay()) {
            if ($d->dayOfWeek === Carbon::SUNDAY) continue;
            $date = $d->toDateString();
            if (in_array($date, $leaveDays, true)) continue;

            $status = 'Present';
            if ($lateLeft > 0)      { $status = 'Late'; $lateLeft--; }
            elseif ($absentLeft > 0) { $absentLeft--; continue; }
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
