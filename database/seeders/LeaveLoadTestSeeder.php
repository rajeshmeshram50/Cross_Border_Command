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
    }
}
