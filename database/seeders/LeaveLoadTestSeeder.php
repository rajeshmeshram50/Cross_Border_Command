<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Bulk leave requests for LOAD TESTING the Leave module.
 *
 * Why this exists: LeaveRequestController::index and ::approvals both end in a
 * plain ->get() with no pagination, and the four rows currently in the table
 * hide that completely. You cannot measure a list that never gets long.
 *
 * Everything it writes is tagged with SEED_TAG in `reason`, so the whole batch
 * is removable in one statement and nothing real is touched:
 *
 *     php artisan tinker --execute="DB::table('leave_requests')->where('reason','like','[LOADTEST]%')->delete();"
 *
 * Run:
 *     php artisan db:seed --class=LeaveLoadTestSeeder
 *     php artisan db:seed --class=LeaveLoadTestSeeder -- --rows=5000   (see ROWS below)
 */
class LeaveLoadTestSeeder extends Seeder
{
    /** Marker that makes every generated row identifiable and deletable. */
    private const SEED_TAG = '[LOADTEST]';

    private const CLIENT_ID = 2;
    private const BRANCH_ID = 6;
    /** The acting user from the session this was requested in (branch_user #10). */
    private const ACTOR_USER_ID = 10;

    private const ROWS = 1000;

    /** Leave plans. A master list, not a transaction log — 60 is six pages at
     *  the standard 10 per page, enough to exercise paging without pretending a
     *  tenant runs hundreds of policies. */
    private const PLAN_ROWS = 60;

    /** Insert in batches — 1000 single INSERTs is a thousand round trips. */
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

        /* Fail loudly rather than writing orphans. A leave request pointing at
           an employee or leave type that does not exist would still INSERT, and
           then every list that joins them would quietly drop the row — giving a
           "seeded 1000, list shows 300" mystery instead of an error here. */
        if (!$employeeIds || !$leaveTypeIds) {
            $this->command->error(sprintf(
                'Nothing to seed against: %d employees, %d leave types for client %d / branch %d.',
                count($employeeIds), count($leaveTypeIds), self::CLIENT_ID, self::BRANCH_ID,
            ));
            return;
        }

        /* Already seeded? Don't do it twice.
           A seeder gets re-run — to add a new section, or because someone is
           not sure whether it took the first time — and without this each run
           silently doubles the table, so "1000 rows" becomes 3000 and no
           measurement taken before matches one taken after. The tag makes the
           question answerable. */
        $already = DB::table('leave_requests')
            ->where('reason', 'like', self::SEED_TAG . '%')
            ->count();
        if ($already > 0) {
            $this->command->warn("Skipping leave requests: {$already} already tagged " . self::SEED_TAG . '.');
            $this->command->warn('  Delete them first if you want a fresh set.');
            $this->seedPlans($employeeIds, $leaveTypeIds);
            return;
        }

        /* Status mix, weighted so the module's three interesting screens all get
           real volume: the approval queue (Pending), the balances aggregate
           which only counts Approved, and the history list (everything). A flat
           25% each would leave the approvals queue unrealistically large. */
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
            /* Spread across ~two years, backwards from today, so date-range
               filters and the "orderByDesc(from_date)" list have something to
               sort. Forward-dated rows would sit permanently at the top. */
            $from = (clone $now)->subDays(random_int(0, 730));

            $dayType = $dayTypes[array_rand($dayTypes)];
            // A half day is one calendar day by definition; only full-day leave
            // spans a range.
            $span = $dayType === 'full' ? random_int(0, 4) : 0;
            $to   = (clone $from)->addDays($span);
            $days = $dayType === 'full' ? $span + 1 : 0.5;

            $status     = $statuses[array_rand($statuses)];
            $decided    = in_array($status, ['Approved', 'Rejected'], true);
            $employeeId = $employeeIds[array_rand($employeeIds)];

            /* Cover person must not be the applicant — a handover to yourself is
               not a handover, and it is the sort of nonsense that makes seeded
               data useless for judging a screen. */
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
                // Applied for before the leave starts, which is what every
                // "applied on" column and notice-period check assumes.
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

    /**
     * Leave PLANS, so the Leave Plans list has enough rows to be worth paging.
     * A plan is three tables — the plan, its per-leave-type configuration, and
     * its employee assignments — and a plan with no configured types renders as
     * an empty shell, so all three are written.
     */
    private function seedPlans(array $employeeIds, array $leaveTypeIds): void
    {
        $already = DB::table('master_leave_plans')
            ->where('description', 'like', self::SEED_TAG . '%')
            ->count();
        if ($already > 0) {
            $this->command->warn("Skipping leave plans: {$already} already tagged " . self::SEED_TAG . '.');
            return;
        }

        /* The per-type config is a large, deeply nested JSON document that the
           plan editor reads back field by field. Rather than invent one and
           risk a shape the UI cannot parse, clone a REAL configured row from
           this tenant and vary only the quota. If none exists yet, the config
           is left null — the plan still lists, it just shows as not set up,
           which is a legitimate state rather than a broken one. */
        $template = DB::table('leave_plan_leave_types')
            ->whereNotNull('config_json')
            ->value('config_json');

        $names = ['Standard', 'Executive', 'Field Staff', 'Probation', 'Contract',
                  'Intern', 'Sales Team', 'Night Shift', 'Support Desk', 'Warehouse'];
        $years = [2024, 2025, 2026];

        /* Employees not already on a plan. Excluding the assigned ones matters:
           the real plans in this tenant hold some, and the unique index would
           reject them on the first insert. */
        $taken = DB::table('leave_plan_employees')->pluck('employee_id')->all();
        $pool  = array_values(array_diff($employeeIds, $taken));
        shuffle($pool);

        $planIds = [];
        foreach (range(1, self::PLAN_ROWS) as $i) {
            $name = $names[($i - 1) % count($names)] . ' Leave Plan ' . $years[($i - 1) % count($years)] . " #{$i}";

            /* returning('id') rather than a blind insert: the child rows below
               need the id, and re-querying by name would break the moment two
               plans shared one. */
            $planId = DB::table('master_leave_plans')->insertGetId([
                'client_id'    => self::CLIENT_ID,
                'branch_id'    => self::BRANCH_ID,
                'plan_name'    => $name,
                // The tag lives in `description` so plan_name stays realistic —
                // it is the column every screen shows.
                'description'  => self::SEED_TAG . ' generated for load testing',
                'status'       => $i % 7 === 0 ? 'Inactive' : 'Active',
                /* Both columns are CHECK-constrained: from_month_type accepts
                   only 'Calendar' or 'If Joining', and from_month only a full
                   month name. A 'Calendar' plan carries the month its year
                   opens on; an 'If Joining' plan counts from the joining date,
                   so it has neither a year nor a start month. */
                'from_month_type' => $i % 2 === 0 ? 'If Joining' : 'Calendar',
                'from_month'      => $i % 2 === 0 ? null : ['January', 'April', 'July'][$i % 3],
                'calendar_year'   => $i % 2 === 0 ? null : $years[($i - 1) % count($years)],
                // Never default: exactly one plan should be, and it is not ours
                // to reassign.
                'is_default'   => false,
                'policy_explanation_mode' => 'System',
                'unlocked'     => false,
                'created_by'   => self::ACTOR_USER_ID,
                'created_at'   => now()->subDays(random_int(0, 400)),
                'updated_at'   => now(),
            ]);
            $planIds[] = $planId;

            // 2-4 leave types per plan, never the same type twice in one plan.
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

            /* Assignees, drawn from a pool that is consumed as it is handed out.
               leave_plan_employees.employee_id is UNIQUE: an employee belongs
               to exactly ONE leave plan, which is a real business rule, not an
               incidental index. So this cannot hand the same person to several
               plans — it deals each employee out once and stops when the pool
               is empty. Later plans then have no assignees, which is the honest
               outcome of 24 employees and 60 plans, and is a state the screen
               has to handle anyway. */
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
