<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class LeaveLoadTestSeeder extends Seeder
{
    private const SEED_TAG = '[LOADTEST]';

    private const CLIENT_ID = 2;
    private const BRANCH_ID = 6;
    private const ACTOR_USER_ID = 10;

    private const ROWS = 1000;

    private const PLAN_ROWS = 60;

    private const CHUNK = 250;

    public function run(): void
    {
        $employeeIds = DB::table('employees')
            ->where('client_id', self::CLIENT_ID)
            ->where('branch_id', self::BRANCH_ID)
            ->whereNull('deleted_at')
            ->pluck('id')
            ->all();

        $leaveTypeIds = DB::table('master_leave_types')
            ->where('client_id', self::CLIENT_ID)
            ->pluck('id')
            ->all();

        $leavePlanIds = DB::table('master_leave_plans')
            ->where('client_id', self::CLIENT_ID)
            ->pluck('id')
            ->all();

        if (!$employeeIds || !$leaveTypeIds) {
            $this->command->error(sprintf(
                'Nothing to seed against: %d employees, %d leave types for client %d / branch %d.',
                count($employeeIds), count($leaveTypeIds), self::CLIENT_ID, self::BRANCH_ID,
            ));
            return;
        }

        $already = DB::table('leave_requests')
            ->where('reason', 'like', self::SEED_TAG . '%')
            ->count();
        if ($already > 0) {
            $this->command->warn("Skipping leave requests: {$already} already tagged " . self::SEED_TAG . '.');
            $this->command->warn('  Delete them first if you want a fresh set.');
            $this->seedPlans($employeeIds, $leaveTypeIds);
            return;
        }

        $statuses = array_merge(
            array_fill(0, 30, 'Pending'),
            array_fill(0, 50, 'Approved'),
            array_fill(0, 14, 'Rejected'),
            array_fill(0, 6,  'Cancelled'),
        );

        $dayTypes = ['full', 'full', 'full', 'full', 'first_half', 'second_half'];
        $reasons  = [
            'Family function', 'Medical appointment', 'Personal work', 'Fever',
            'Travel', 'Household emergency', 'Exam', 'Wedding in family',
            'Child care', 'Vehicle breakdown',
        ];

        $now  = now();
        $rows = [];
        $made = 0;

        for ($i = 0; $i < self::ROWS; $i++) {
            $from = (clone $now)->subDays(random_int(0, 730));

            $dayType = $dayTypes[array_rand($dayTypes)];
            $span = $dayType === 'full' ? random_int(0, 4) : 0;
            $to   = (clone $from)->addDays($span);
            $days = $dayType === 'full' ? $span + 1 : 0.5;

            $status     = $statuses[array_rand($statuses)];
            $decided    = in_array($status, ['Approved', 'Rejected'], true);
            $employeeId = $employeeIds[array_rand($employeeIds)];

            $coverPool  = array_values(array_diff($employeeIds, [$employeeId]));
            $handover   = (bool) random_int(0, 1);

            $rows[] = [
                'client_id'         => self::CLIENT_ID,
                'branch_id'         => self::BRANCH_ID,
                'employee_id'       => $employeeId,
                'leave_type_id'     => $leaveTypeIds[array_rand($leaveTypeIds)],
                'leave_plan_id'     => $leavePlanIds ? $leavePlanIds[array_rand($leavePlanIds)] : null,

                'from_date'         => $from->toDateString(),
                'to_date'           => $to->toDateString(),
                'days'              => $days,
                'day_type'          => $dayType,

                'reason'            => self::SEED_TAG . ' ' . $reasons[array_rand($reasons)],
                'notify'            => json_encode(['manager' => true, 'hr' => (bool) random_int(0, 1), 'employee_ids' => []]),

                'handover_required' => $handover,
                'cover_person_id'   => $handover && $coverPool ? $coverPool[array_rand($coverPool)] : null,
                'handover_notes'    => $handover ? self::SEED_TAG . ' Handover notes for load testing.' : null,
                'avail_on_call'     => (bool) random_int(0, 1),

                'status'            => $status,
                'approved_by'       => $decided ? self::ACTOR_USER_ID : null,
                'approved_at'       => $decided ? (clone $from)->subDays(random_int(1, 5)) : null,
                'approver_comment'  => $status === 'Rejected' ? self::SEED_TAG . ' Not enough cover that week.' : null,

                'created_by'        => self::ACTOR_USER_ID,
                'created_at'        => (clone $from)->subDays(random_int(1, 20)),
                'updated_at'        => $now,
            ];

            if (count($rows) >= self::CHUNK) {
                DB::table('leave_requests')->insert($rows);
                $made += count($rows);
                $rows = [];
                $this->command->info("  seeded {$made} / " . self::ROWS);
            }
        }

        if ($rows) {
            DB::table('leave_requests')->insert($rows);
            $made += count($rows);
        }

        $this->command->info("Done. {$made} leave requests for client " . self::CLIENT_ID . ' / branch ' . self::BRANCH_ID . '.');
        $this->command->info("Remove them with: reason LIKE '" . self::SEED_TAG . "%'");

        $this->seedPlans($employeeIds, $leaveTypeIds);
    }

    private function seedPlans(array $employeeIds, array $leaveTypeIds): void
    {
        $already = DB::table('master_leave_plans')
            ->where('description', 'like', self::SEED_TAG . '%')
            ->count();
        if ($already > 0) {
            $this->command->warn("Skipping leave plans: {$already} already tagged " . self::SEED_TAG . '.');
            return;
        }

        $template = DB::table('leave_plan_leave_types')
            ->whereNotNull('config_json')
            ->value('config_json');

        $names = ['Standard', 'Executive', 'Field Staff', 'Probation', 'Contract',
                  'Intern', 'Sales Team', 'Night Shift', 'Support Desk', 'Warehouse'];
        $years = [2024, 2025, 2026];

        $taken = DB::table('leave_plan_employees')->pluck('employee_id')->all();
        $pool  = array_values(array_diff($employeeIds, $taken));
        shuffle($pool);

        $planIds = [];
        foreach (range(1, self::PLAN_ROWS) as $i) {
            $name = $names[($i - 1) % count($names)] . ' Leave Plan ' . $years[($i - 1) % count($years)] . " #{$i}";

            $planId = DB::table('master_leave_plans')->insertGetId([
                'client_id'    => self::CLIENT_ID,
                'branch_id'    => self::BRANCH_ID,
                'plan_name'    => $name,
                'description'  => self::SEED_TAG . ' generated for load testing',
                'status'       => $i % 7 === 0 ? 'Inactive' : 'Active',
                'from_month_type' => $i % 2 === 0 ? 'If Joining' : 'Calendar',
                'from_month'      => $i % 2 === 0 ? null : ['January', 'April', 'July'][$i % 3],
                'calendar_year'   => $i % 2 === 0 ? null : $years[($i - 1) % count($years)],
                'is_default'   => false,
                'policy_explanation_mode' => 'System',
                'unlocked'     => false,
                'created_by'   => self::ACTOR_USER_ID,
                'created_at'   => now()->subDays(random_int(0, 400)),
                'updated_at'   => now(),
            ]);
            $planIds[] = $planId;

            $types = $leaveTypeIds;
            shuffle($types);
            foreach (array_slice($types, 0, random_int(2, min(4, count($types)))) as $typeId) {
                $quota  = [6, 10, 12, 15, 18, 24][array_rand([6, 10, 12, 15, 18, 24])];
                $config = null;
                if ($template) {
                    $decoded = json_decode($template, true);
                    if (isset($decoded['accrual']['yearlyQuota'])) {
                        $decoded['accrual']['yearlyQuota'] = $quota;
                    }
                    $config = json_encode($decoded);
                }
                DB::table('leave_plan_leave_types')->insert([
                    'leave_plan_id' => $planId,
                    'leave_type_id' => $typeId,
                    'config_json'   => $config,
                    'quota_summary' => "{$quota} days/year",
                    'eoy_summary'   => 'Reset to zero',
                    'is_setup'      => $config !== null,
                    'created_at'    => now(),
                    'updated_at'    => now(),
                ]);
            }

            foreach (array_splice($pool, 0, random_int(1, 3)) as $empId) {
                DB::table('leave_plan_employees')->insert([
                    'leave_plan_id' => $planId,
                    'employee_id'   => $empId,
                    'assigned_at'   => now(),
                    'assigned_by'   => self::ACTOR_USER_ID,
                    'created_at'    => now(),
                    'updated_at'    => now(),
                ]);
            }
        }

        $this->command->info('Done. ' . count($planIds) . ' leave plans (with types + assignees).');
        $this->command->info("Remove them with: description LIKE '" . self::SEED_TAG . "%'");
    }
}
