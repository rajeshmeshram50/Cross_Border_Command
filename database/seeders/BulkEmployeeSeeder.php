<?php

namespace Database\Seeders;

use App\Models\Employee;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class BulkEmployeeSeeder extends Seeder
{
    private const CLIENT_ID = 16;
    private const BRANCH_ID = 52;
    private const ONBOARDED = 200;

    private const SEED_DOMAIN = '@seed.mailinator.com';

    private const DEPARTMENT_NAMES = [
        'Sales',
        'Human Resources',
        'Accounts',
        'Logistics',
        'Purchase',
        'IT',
        'Legal',
        'Warehouse',
        'Quality Control',
        'Export-Import',
    ];

    private const LEVELS = [
        ['key' => 'hod',       'designation' => 'Head of Department (HOD)', 'role' => 'Manager',   'count' => 1,  'lpa' => [18.0, 26.0]],
        ['key' => 'lead',      'designation' => 'Team Leader',              'role' => 'Manager',   'count' => 4,  'lpa' => [10.0, 16.0]],
        ['key' => 'executive', 'designation' => 'Executive',                'role' => 'Executive', 'count' => 10, 'lpa' => [6.0,  9.5]],
        ['key' => 'employee',  'designation' => 'Employee',                 'role' => 'Staff',     'count' => 20, 'lpa' => [3.6,  6.0]],
        ['key' => 'intern',    'designation' => 'Intern / Trainee',         'role' => 'Staff',     'count' => 5,  'lpa' => [1.8,  2.4]],
    ];

    private const SHIFTS      = ['General Shift', 'Morning Shift', 'After noon shift'];
    private const WEEKLY_OFFS = ['Sunday Only', 'Saturday & Sunday'];
    private const GENDERS     = ['Male', 'Female'];
    private const BLOOD       = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
    private const BANKS = [
        ['HDFC Bank',           'HDFC'],
        ['ICICI Bank',          'ICIC'],
        ['State Bank of India', 'SBIN'],
        ['Axis Bank',           'UTIB'],
        ['Kotak Mahindra Bank', 'KKBK'],
    ];
    private const SOCIETIES   = ['Sunrise Residency', 'Green Park', 'Lake View Apartments', 'Shanti Nagar'];
    private const LOCALITIES  = ['Baner', 'Balewadi', 'Hinjewadi', 'Kothrud', 'Aundh'];

    private const CITIES = [
        ['Pune', '411045'],
        ['Mumbai', '400001'],
        ['Nashik', '422001'],
        ['Nagpur', '440001'],
        ['Thane', '400601'],
    ];

    private const COUNTRY_NAME      = 'India';
    private const STATE_NAME        = 'Maharashtra';
    private const HOLIDAY_GROUP     = 'Indian Employee';

    private array $departmentIds  = [];
    private array $designationIds = [];
    private array $roleIds        = [];
    private ?int $countryId       = null;
    private ?int $stateId         = null;
    private ?int $holidayGroupId  = null;
    private ?string $internLeavePlan  = null;
    private ?string $regularLeavePlan = null;

    private const FIRST_NAMES = [
        'Aarav',
        'Vivaan',
        'Aditya',
        'Vihaan',
        'Arjun',
        'Sai',
        'Reyansh',
        'Krishna',
        'Ishaan',
        'Rohan',
        'Kabir',
        'Dhruv',
        'Aryan',
        'Yash',
        'Karan',
        'Nikhil',
        'Ananya',
        'Diya',
        'Aadhya',
        'Saanvi',
        'Meera',
        'Riya',
        'Isha',
        'Kavya',
        'Neha',
        'Pooja',
        'Sneha',
        'Trupti',
        'Ritika',
        'Shreya',
        'Priya',
        'Nisha',
    ];
    private const MIDDLE_NAMES = ['Kumar', 'Raj', 'Devi', 'Prasad', 'Anand', 'Bala'];
    private const LAST_NAMES = [
        'Sharma',
        'Patel',
        'Reddy',
        'Nair',
        'Kumar',
        'Singh',
        'Verma',
        'Joshi',
        'Iyer',
        'Menon',
        'Desai',
        'Kulkarni',
        'Deshmukh',
        'Chavan',
        'Pawar',
        'Jadhav',
        'Gupta',
        'Malhotra',
        'Bose',
        'Mehta',
        'Shah',
        'Rao',
        'Naik',
        'Kale',
    ];

    public function run(): void
    {
        mt_srand(20260821);

        $this->resolveMasters();
        $this->removePreviousRun();

        $now     = Carbon::now();
        $nextSeq = $this->nextEmpSeq();
        $index   = 0;
        $created = [];

        foreach (self::LEVELS as $level) {
            $rows = [];
            foreach ($this->departmentIds as $deptId) {
                for ($n = 0; $n < $level['count']; $n++) {
                    $rows[] = $this->buildRow($level, $deptId, $nextSeq + $index, $index, $now, $created);
                    $index++;
                }
            }

            foreach (array_chunk($rows, 100) as $chunk) {
                DB::table('employees')->insert($chunk);
            }

            DB::table('employees')
                ->whereIn('emp_code', array_column($rows, 'emp_code'))
                ->where('branch_id', self::BRANCH_ID)
                ->get(['id', 'emp_code', 'department_id', 'designation_id'])
                ->each(function ($r) use (&$created) {
                    $created[$r->emp_code] = [
                        'id'             => (int) $r->id,
                        'department_id'  => (int) $r->department_id,
                        'designation_id' => (int) $r->designation_id,
                    ];
                });

            $this->seedSalaryStructures($rows, $created, $now);
        }

        $this->command?->info(sprintf(
            'Seeded %d employees into branch %d - %d fully onboarded, %d mid-onboarding, across %d departments, each with a salary structure.',
            $index,
            self::BRANCH_ID,
            self::ONBOARDED,
            $index - self::ONBOARDED,
            count($this->departmentIds),
        ));
    }

    private function resolveMasters(): void
    {
        $missing = [];

        $this->countryId = DB::table('master_countries')->where('name', self::COUNTRY_NAME)->value('id');
        if (!$this->countryId) $missing[] = 'country "' . self::COUNTRY_NAME . '"';

        $this->stateId = DB::table('master_states')
            ->where('name', self::STATE_NAME)
            ->when($this->countryId, fn($q) => $q->where('country_id', $this->countryId))
            ->value('id');
        if (!$this->stateId) $missing[] = 'state "' . self::STATE_NAME . '"';

        foreach (self::DEPARTMENT_NAMES as $name) {
            $id = DB::table('master_departments')->where('name', $name)->value('id');
            if ($id) $this->departmentIds[] = (int) $id;
            else     $missing[] = 'department "' . $name . '"';
        }

        foreach (self::LEVELS as $level) {
            foreach ([['master_designations', 'designation', 'designationIds'], ['master_roles', 'role', 'roleIds']] as [$table, $key, $prop]) {
                $name = $level[$key];
                if (isset($this->{$prop}[$name])) continue;
                $id = DB::table($table)->where('name', $name)->value('id');
                if ($id) $this->{$prop}[$name] = (int) $id;
                else     $missing[] = rtrim($key, 's') . ' "' . $name . '"';
            }
        }

        $this->holidayGroupId = DB::table('holiday_groups')->where('name', self::HOLIDAY_GROUP)->value('id');

        $plans = DB::table('master_leave_plans')
            ->where('branch_id', self::BRANCH_ID)
            ->orderBy('id')
            ->pluck('plan_name', 'id');
        foreach ($plans as $id => $planName) {
            if ($this->internLeavePlan === null && stripos((string) $planName, 'intern') !== false) {
                $this->internLeavePlan = (string) $id;
            } elseif ($this->regularLeavePlan === null) {
                $this->regularLeavePlan = (string) $id;
            }
        }
        $this->internLeavePlan  ??= $this->regularLeavePlan;
        $this->regularLeavePlan ??= $this->internLeavePlan;

        if ($missing) {
            throw new \RuntimeException(
                'BulkEmployeeSeeder cannot run — these master records are missing from this database: '
                    . implode(', ', $missing)
                    . '. Seed the masters first (MasterDataSeeder / GeographySeeder), then re-run.'
            );
        }
    }

    private function removePreviousRun(): void
    {
        $ids = DB::table('employees')
            ->where('branch_id', self::BRANCH_ID)
            ->where('email', 'like', '%' . self::SEED_DOMAIN)
            ->pluck('id');

        if ($ids->isEmpty()) {
            return;
        }

        DB::table('salary_structures')->whereIn('employee_id', $ids)->delete();
        DB::table('employees')->whereIn('id', $ids)->delete();
        $this->command?->warn("Removed {$ids->count()} employees from a previous run of this seeder.");
    }

    private function nextEmpSeq(): int
    {
        $existing = Employee::withTrashed()
            ->where('branch_id', self::BRANCH_ID)
            ->pluck('emp_code')
            ->map(fn($c) => (int) preg_replace('/\D/', '', (string) $c))
            ->filter()
            ->all();

        return ($existing ? max($existing) : 0) + 1;
    }

    private function buildRow(array $level, int $deptId, int $seq, int $index, Carbon $now, array $created): array
    {
        $code      = 'EMP-' . str_pad((string) $seq, 3, '0', STR_PAD_LEFT);
        $first     = self::FIRST_NAMES[array_rand(self::FIRST_NAMES)];
        $last      = self::LAST_NAMES[array_rand(self::LAST_NAMES)];
        $middle    = mt_rand(1, 100) <= 30 ? self::MIDDLE_NAMES[array_rand(self::MIDDLE_NAMES)] : null;
        $onboarded = $index < self::ONBOARDED;

        $maxTenureDays = match ($level['key']) {
            'hod'       => 2200,
            'lead'      => 1600,
            'executive' => 1100,
            'employee'  => 700,
            default     => 240,
        };
        $joined = $now->copy()->subDays(mt_rand(45, $maxTenureDays));
        $born   = $joined->copy()->subYears(mt_rand(23, 55))->subDays(mt_rand(0, 364));

        [$city, $pin] = self::CITIES[array_rand(self::CITIES)];
        [$permCity, $permPin] = mt_rand(1, 100) <= 70
            ? [$city, $pin]
            : self::CITIES[array_rand(self::CITIES)];

        [$bankName, $ifscPrefix] = self::BANKS[array_rand(self::BANKS)];

        $lpa           = $this->randomFloat($level['lpa'][0], $level['lpa'][1]);
        $annual        = round($lpa * 100000, 2);
        $monthlyGross  = round($annual / 12, 2);
        $monthlyBasic  = round($monthlyGross * 0.5, 2);
        $probationMths = $level['key'] === 'intern' ? 0 : (mt_rand(0, 1) ? 3 : 6);
        $noticeDays    = $level['key'] === 'intern' ? 15 : (mt_rand(0, 1) ? 30 : 60);

        return [
            'client_id' => self::CLIENT_ID,
            'branch_id' => self::BRANCH_ID,
            'emp_code'  => $code,

            'first_name'    => $first,
            'middle_name'   => $middle,
            'last_name'     => $last,
            'display_name'  => trim($first . ' ' . ($middle ? $middle . ' ' : '') . $last),
            'gender'        => self::GENDERS[array_rand(self::GENDERS)],
            'date_of_birth' => $born->toDateString(),
            'blood_group'   => self::BLOOD[array_rand(self::BLOOD)],
            'nationality_country_id' => $this->countryId,
            'work_country_id'        => $this->countryId,

            'email'          => strtolower($first . '.' . $last . '.' . $seq) . self::SEED_DOMAIN,
            'official_email' => strtolower($first . '.' . $last . '.' . $seq) . '@igcgroup.in',
            'mobile'         => $this->mobile(),
            'alt_mobile'     => mt_rand(1, 100) <= 40 ? $this->mobile() : null,
            'address_line1'  => mt_rand(1, 400) . ', ' . self::SOCIETIES[array_rand(self::SOCIETIES)],
            'address_line2'  => self::LOCALITIES[array_rand(self::LOCALITIES)],
            'city'           => $city,
            'state_id'       => $this->stateId,
            'country_id'     => $this->countryId,
            'pincode'        => $pin,
            'perm_address_line1' => mt_rand(1, 400) . ', ' . self::SOCIETIES[array_rand(self::SOCIETIES)],
            'perm_address_line2' => self::LOCALITIES[array_rand(self::LOCALITIES)],
            'perm_city'          => $permCity,
            'perm_state_id'      => $this->stateId,
            'perm_country_id'    => $this->countryId,
            'perm_pincode'       => $permPin,

            'department_id'        => $deptId,
            'designation_id'       => $this->designationIds[$level['designation']],
            'primary_role_id'      => $this->roleIds[$level['role']],
            'reporting_manager_id' => $this->managerFor($level['key'], $deptId, $created),
            'date_of_joining'      => $joined->toDateString(),
            'location'             => $city,
            'work_type'            => 'Full-time',
            'employee_type'        => $level['key'] === 'intern' ? 'Intern' : 'Full-time',
            'has_prior_experience' => $level['key'] !== 'intern' && mt_rand(0, 1) === 1,
            'probation_policy'     => $probationMths ? "{$probationMths}-Month Probation" : 'Not Applicable',
            'probation_months'     => $probationMths,
            'probation_end_date'   => $probationMths ? $joined->copy()->addMonths($probationMths)->toDateString() : null,
            'notice_period'        => $noticeDays . ' Days',
            'notice_period_days'   => $noticeDays,

            'attendance_tracking'  => true,
            'shift'                => self::SHIFTS[array_rand(self::SHIFTS)],
            'weekly_off'           => self::WEEKLY_OFFS[array_rand(self::WEEKLY_OFFS)],
            'attendance_number'    => (string) (900000 + $seq),
            'time_tracking'        => 'Web Check-in',
            'penalization_policy'  => 'Standard',
            'overtime'             => $level['key'] === 'hod' ? 'Not applicable' : 'Hourly Pay',
            'expense_policy'       => 'Manager Approval',
            'leave_plan'           => $level['key'] === 'intern' ? $this->internLeavePlan : $this->regularLeavePlan,
            'holiday_list'         => 'Indian Employee',
            'holiday_group_id'     => $this->holidayGroupId,

            'laptop_assigned'     => $level['key'] === 'intern' ? 'No' : 'Yes',
            'mobile_assigned'     => in_array($level['key'], ['hod', 'lead'], true) ? 'Yes' : 'No',
            'mobile_device'       => in_array($level['key'], ['hod', 'lead'], true) ? 'Company Issued' : null,
            'desk_workstation_no' => 'WS-' . str_pad((string) $seq, 3, '0', STR_PAD_LEFT),
            'biometric_status'    => $onboarded ? 'Registered' : 'Not Registered',
            'id_card_status'      => $onboarded ? 'Printed' : 'Not Printed',
            'assets'                 => json_encode([]),
            'other_master_asset_ids' => json_encode([]),
            'ancillary_role_ids'     => json_encode([]),

            'enable_payroll'        => true,
            'pay_group'             => 'Monthly Staff',
            'annual_salary'         => $annual,
            'agreed_ctc_lpa'        => round($lpa, 2),
            'salary_frequency'      => 'monthly',
            'salary_effective_from' => $joined->toDateString(),
            'salary_structure'      => 'Standard',
            'tax_regime'            => mt_rand(1, 100) <= 70 ? 'New' : 'Old',
            'bonus_in_annual'       => mt_rand(0, 1) === 1,
            'detailed_breakup'      => true,
            'salary_payment_mode'   => 'bank',
            'pf_eligible'    => $monthlyBasic <= 15000,
            'pf_type'        => 'statutory',
            'pf_deduction'   => $monthlyBasic <= 15000 ? 'Yes' : 'No',
            'esi_applicable' => $monthlyGross <= 21000 ? 'Yes' : 'No',
            'uan_number'     => (string) mt_rand(100000000000, 999999999999),
            'pan_number'     => $this->pan(),
            'gratuity_nominee_name' => self::FIRST_NAMES[array_rand(self::FIRST_NAMES)] . ' ' . $last,

            'bank_name'           => $bankName,
            'bank_account_number' => (string) mt_rand(10000000000, 99999999999),
            'ifsc_code'           => $ifscPrefix . '0' . str_pad((string) mt_rand(1, 999999), 6, '0', STR_PAD_LEFT),
            'account_holder_name' => trim($first . ' ' . $last),
            'bank_branch'         => $city . ' Main Branch',
            'bank_account_type'   => 'Savings',

            'status' => 'Active',
            'onboarding_stage_completed' => $onboarded ? 6 : mt_rand(0, 5),
            'wizard_step_completed'      => $onboarded ? 4 : mt_rand(0, 3),
            'stage4_completed_at'        => $onboarded ? $joined->copy()->addDays(2) : null,
            'created_at' => $now,
            'updated_at' => $now,
        ];
    }

    private function managerFor(string $levelKey, int $deptId, array $created): ?int
    {
        $pool = match ($levelKey) {
            'hod'                   => [],
            'lead'                  => $this->idsIn($created, $deptId, $this->designationIds['Head of Department (HOD)']),
            'executive', 'employee' => $this->idsIn($created, $deptId, $this->designationIds['Team Leader']),
            'intern'                => $this->idsIn($created, $deptId, $this->designationIds['Executive']),
            default                 => [],
        };

        return $pool ? $pool[array_rand($pool)] : null;
    }

    private function idsIn(array $created, int $deptId, int $designationId): array
    {
        $ids = [];
        foreach ($created as $row) {
            if ($row['department_id'] === $deptId && $row['designation_id'] === $designationId) {
                $ids[] = $row['id'];
            }
        }

        return $ids;
    }

    private function seedSalaryStructures(array $rows, array $created, Carbon $now): void
    {
        $structures = [];

        foreach ($rows as $row) {
            $empId = $created[$row['emp_code']]['id'] ?? null;
            if (!$empId) {
                continue;
            }

            $monthly = round(((float) $row['annual_salary']) / 12, 2);
            $basic   = round($monthly * 0.5, 2);
            $hra     = round($monthly * 0.3, 2);
            $special = round($monthly - $basic - $hra, 2);

            $structures[] = [
                'client_id'   => self::CLIENT_ID,
                'branch_id'   => self::BRANCH_ID,
                'employee_id' => $empId,
                'version'     => 1,
                'effective_from' => $row['date_of_joining'],
                'status'         => 'active',
                'earnings'       => json_encode([
                    ['code' => 'basic',   'label' => 'Basic Salary',         'amount' => $basic],
                    ['code' => 'hra',     'label' => 'House Rent Allowance', 'amount' => $hra],
                    ['code' => 'special', 'label' => 'Special Allowance',    'amount' => $special],
                ]),
                'deductions'      => json_encode([]),
                'monthly_gross'   => $monthly,
                'monthly_ctc'     => $monthly,
                'pf_applicable'   => $basic <= 15000,
                'esi_applicable'  => $monthly <= 21000,
                'pt_applicable'   => true,
                'tds_applicable'  => $monthly > 50000,
                'approval_status' => 'approved',
                'approved_at'     => $now,
                'created_at'      => $now,
                'updated_at'      => $now,
            ];
        }

        foreach (array_chunk($structures, 100) as $chunk) {
            DB::table('salary_structures')->insert($chunk);
        }
    }

    private function randomFloat(float $min, float $max): float
    {
        return $min + (mt_rand(0, 10000) / 10000) * ($max - $min);
    }

    private function mobile(): string
    {
        return (string) mt_rand(7000000000, 9999999999);
    }

    private function pan(): string
    {
        $letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        $out = '';
        for ($i = 0; $i < 5; $i++) {
            $out .= $letters[mt_rand(0, 25)];
        }
        $out .= str_pad((string) mt_rand(0, 9999), 4, '0', STR_PAD_LEFT);

        return $out . $letters[mt_rand(0, 25)];
    }
}
