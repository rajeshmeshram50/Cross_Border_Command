<?php

namespace Database\Seeders;

use App\Models\Branch;
use App\Models\Employee;
use App\Models\Masters\LeavePlanLeaveType;
use App\Models\Masters\LeavePlans;
use App\Models\Masters\LeaveTypes;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Opt-in seeder that hydrates the leave module with realistic test data:
 *   - 7 leave types (catalog)
 *   - 2 leave plans (Default + Executives)
 *   - Types assigned to both plans with a worked-out Setup config on a few
 *   - Up to 10 existing employees auto-assigned to the default plan
 *
 * Idempotent: re-running won't duplicate rows; it'll only fill what's missing.
 *
 * Run with:
 *   php artisan db:seed --class=LeaveSeeder
 *
 * Not wired into DatabaseSeeder so a fresh `migrate --seed` doesn't pollute
 * production data — QA runs this on demand.
 */
class LeaveSeeder extends Seeder
{
    public function run(): void
    {
        // Pick a branch to seed under. Prefer the first branch that already
        // has employees (so the Leave Balances tab has rows to render after
        // we assign them to the seeded plan). Fall back to the first branch
        // in the DB if none have employees yet.
        $branchWithEmployees = Branch::query()
            ->whereExists(function ($q) {
                $q->select(DB::raw(1))
                  ->from('employees')
                  ->whereColumn('employees.branch_id', 'branches.id');
            })
            ->orderBy('id')
            ->first();
        $branch = $branchWithEmployees ?: Branch::query()->orderBy('id')->first();
        if (!$branch) {
            $this->command?->warn('No branches in DB yet — skipping LeaveSeeder.');
            return;
        }
        $clientId = $branch->client_id;
        $branchId = $branch->id;

        $this->command?->info("Seeding leave data into client_id={$clientId}, branch_id={$branchId} (\"{$branch->name}\")");
        if (!$branchWithEmployees) {
            $this->command?->warn(' • This branch has 0 employees — Leave Balances tab will be empty until you create employees and re-run this seeder, or assign them via the Plan -> Employees flow.');
        }

        // ────────────────────────────────────────────────────────────────
        // 1. Leave Type catalog
        // ────────────────────────────────────────────────────────────────
        $catalog = [
            ['name' => 'Sick Leave',           'short_code' => 'SL',   'type' => 'Regular',              'paid_unpaid' => 'Paid',   'is_sick_medical' => true,  'gender_restriction' => 'None'],
            ['name' => 'Casual Leave',         'short_code' => 'CL',   'type' => 'Regular',              'paid_unpaid' => 'Paid',   'is_sick_medical' => false, 'gender_restriction' => 'None'],
            ['name' => 'Paid Leave',           'short_code' => 'PL',   'type' => 'Regular',              'paid_unpaid' => 'Paid',   'is_sick_medical' => false, 'gender_restriction' => 'None'],
            ['name' => 'Floater Leave',        'short_code' => 'FL',   'type' => 'Incident Based Leave', 'paid_unpaid' => 'Paid',   'is_sick_medical' => false, 'gender_restriction' => 'None'],
            ['name' => 'Maternity Leave',      'short_code' => 'ML',   'type' => 'Incident Based Leave', 'paid_unpaid' => 'Paid',   'is_sick_medical' => true,  'gender_restriction' => 'Female'],
            ['name' => 'Comp Off',             'short_code' => 'CO',   'type' => 'Compoff',              'paid_unpaid' => 'Paid',   'is_sick_medical' => false, 'gender_restriction' => 'None'],
            ['name' => 'Loss of Pay',          'short_code' => 'LOP',  'type' => 'Unpaid Leave',         'paid_unpaid' => 'Unpaid', 'is_sick_medical' => false, 'gender_restriction' => 'None'],
        ];

        $typeIdByCode = [];
        foreach ($catalog as $row) {
            $type = LeaveTypes::firstOrCreate(
                [
                    'branch_id' => $branchId,
                    'short_code' => $row['short_code'],
                ],
                array_merge($row, [
                    'client_id' => $clientId,
                    'status' => 'Active',
                ])
            );
            $typeIdByCode[$row['short_code']] = $type->id;
        }
        $this->command?->info(' • Leave types: ' . count($typeIdByCode) . ' present');

        // ────────────────────────────────────────────────────────────────
        // 2. Leave Plans
        // ────────────────────────────────────────────────────────────────
        $defaultPlan = LeavePlans::firstOrCreate(
            ['branch_id' => $branchId, 'plan_name' => 'Default Leave Policy'],
            [
                'client_id' => $clientId,
                'description' => 'Standard plan applied to new joiners.',
                'from_month_type' => 'Calendar',
                'from_month' => 'April',
                'calendar_year' => (string) date('Y'),
                'policy_explanation_mode' => 'System',
                'status' => 'Active',
                'is_default' => true,
            ]
        );
        $execPlan = LeavePlans::firstOrCreate(
            ['branch_id' => $branchId, 'plan_name' => 'Executives Leave Plan'],
            [
                'client_id' => $clientId,
                'description' => 'Enhanced quotas for senior employees.',
                'from_month_type' => 'Calendar',
                'from_month' => 'January',
                'calendar_year' => (string) date('Y'),
                'policy_explanation_mode' => 'System',
                'status' => 'Active',
                'is_default' => false,
            ]
        );
        $this->command?->info(' • Leave plans: 2 present (Default, Executives)');

        // ────────────────────────────────────────────────────────────────
        // 3. Assign types to plans (+ Setup config on a few so the
        //    Configuration table doesn't show all "Not Setup")
        // ────────────────────────────────────────────────────────────────
        $configFor = function (int $yearlyQuota, string $carryForward, int $cap = 0): array {
            return [
                'accrual' => [
                    'unit' => 'days',
                    'unlimited' => false,
                    'yearlyQuota' => $yearlyQuota,
                    'mode' => 'periodic',
                    'frequency' => 'monthly',
                    'dayOfMonth' => 1,
                    'variesEachMonth' => false,
                    'leaveExpires' => ['enabled' => false, 'unit' => 'day', 'days' => 0],
                    'restrictByAttendance' => false,
                    'noAccrualIfOnLeaveFor' => ['enabled' => false, 'days' => 30],
                    'noAccrualIfBalanceExceeds' => ['enabled' => false, 'days' => 20],
                    'noAccrualIfJoiningAfter' => ['enabled' => false, 'day' => 4],
                    'managersCanGrantExtra' => true,
                    'employeeOverdraft' => ['enabled' => false, 'days' => 1],
                    'accrueByTenure' => false,
                ],
                'leaveApp' => [
                    'allowHalfDay' => true,
                    'priorNoticeNeeded' => false,
                    'limitBackdated' => true,
                    'backdatedWithin' => ['enabled' => true, 'days' => 25],
                    'backdatedBefore' => ['enabled' => false, 'day' => 1],
                    'roundBalances' => ['enabled' => false, 'direction' => '', 'unit' => ''],
                    'commentMandatory' => true,
                    'preventSelfApply' => false,
                    'attachmentsAfter' => ['enabled' => false, 'days' => 0],
                    'earliestApply' => ['enabled' => false, 'days' => 0],
                    'cannotUseSameYear' => false,
                    'preventFutureExpected' => true,
                    'minIfBalanceMore' => ['enabled' => false, 'balance' => 0, 'minDays' => 0],
                ],
                'approval' => [
                    'required' => true,
                    'approverRole' => 'reporting_manager',
                    'autoApproveIfMissing' => false,
                    'doNotEmailEveryRequest' => false,
                ],
                'yearEnd' => [
                    'encashmentAllowed' => false,
                    'carryForward' => $carryForward, // 'reset' | 'carry_capped' | 'carry_all'
                    'carryForwardCap' => $cap,
                    'carriedExpiresIn' => ['enabled' => false, 'days' => 90],
                    'expiryUnchanged' => true,
                    'applyForNextYear' => false,
                ],
                'probation' => [
                    'prorateFirstMonth' => ['enabled' => true, 'basis' => 'date'],
                    'accrueDuringProbation' => false,
                    'afterProbationStart' => 'immediate',
                    'waitingDays' => 10,
                    'prorateAfterProbationBasis' => 'date',
                    'newJoinersAfter' => ['enabled' => true, 'days' => 0, 'basis' => 'joining_date'],
                    'maxDuringProbation' => ['enabled' => false, 'days' => 0],
                ],
                'noticePeriod' => [
                    'prorateOnExit' => false,
                    'noticeExtension' => ['enabled' => true, 'times' => 0],
                ],
            ];
        };

        $eoyLabel = function (string $cf, int $cap): string {
            if ($cf === 'reset') return 'Reset to zero';
            if ($cf === 'carry_all') return 'Carry all forward';
            return "Carry up to {$cap}";
        };

        // (plan, type, quota, carry-forward mode, cap)
        $assignments = [
            // Default plan
            [$defaultPlan->id, 'SL',  12, 'carry_capped', 5,  true],
            [$defaultPlan->id, 'CL',  8,  'reset',        0,  true],
            [$defaultPlan->id, 'PL',  15, 'carry_capped', 10, true],
            [$defaultPlan->id, 'LOP', 0,  'reset',        0,  false], // unconfigured to show "Not Setup"
            [$defaultPlan->id, 'FL',  2,  'reset',        0,  true],
            // Executives plan — higher quotas
            [$execPlan->id,    'SL',  20, 'carry_capped', 10, true],
            [$execPlan->id,    'CL',  12, 'reset',        0,  true],
            [$execPlan->id,    'PL',  25, 'carry_all',    0,  true],
            [$execPlan->id,    'CO',  0,  'reset',        0,  false],
            [$execPlan->id,    'ML',  90, 'reset',        0,  true],
        ];

        foreach ($assignments as [$planId, $code, $quota, $cf, $cap, $isSetup]) {
            $typeId = $typeIdByCode[$code] ?? null;
            if (!$typeId) continue;
            $config = $isSetup ? $configFor($quota, $cf, $cap) : null;
            LeavePlanLeaveType::updateOrCreate(
                ['leave_plan_id' => $planId, 'leave_type_id' => $typeId],
                [
                    'config_json' => $config,
                    'quota_summary' => $isSetup ? "{$quota} days/year" : null,
                    'eoy_summary' => $isSetup ? $eoyLabel($cf, $cap) : null,
                    'is_setup' => $isSetup,
                ]
            );
        }
        $this->command?->info(' • Plan-type assignments: ' . count($assignments) . ' present (8 with full Setup, 2 left "Not Setup")');

        // ────────────────────────────────────────────────────────────────
        // 4. Assign existing employees to the default plan so the
        //    Leave Balances tab has rows to render.
        // ────────────────────────────────────────────────────────────────
        $employees = Employee::query()
            ->where('branch_id', $branchId)
            ->orderBy('id')
            ->limit(10)
            ->get();

        $count = 0;
        foreach ($employees as $emp) {
            $exists = DB::table('leave_plan_employees')
                ->where('employee_id', $emp->id)
                ->exists();
            if ($exists) continue;
            DB::table('leave_plan_employees')->insert([
                'leave_plan_id' => $defaultPlan->id,
                'employee_id'   => $emp->id,
                'assigned_at'   => now(),
                'assigned_by'   => null,
                'created_at'    => now(),
                'updated_at'    => now(),
            ]);
            $count++;
        }
        $this->command?->info(" • Employee assignments: {$count} new (existing untouched)");

        $this->command?->info('LeaveSeeder finished.');
    }
}
