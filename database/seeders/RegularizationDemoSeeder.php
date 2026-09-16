<?php

namespace Database\Seeders;

use App\Models\AttendanceRegularization;
use App\Models\Employee;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

/**
 * Demo attendance-regularization requests for the HR → Regularization Requests
 * queue and its read-only detail popup (QA).
 *
 * Seeds one row per shape the screen has to render, so every tab, every badge
 * and every branch of the detail modal can be exercised without hand-filing
 * requests through the employee form:
 *
 *   Pending      — level 1 waiting; a second one with level 1 already approved
 *                  (two-level chain, so "· current" shows on level 2)
 *   Approved     — decided directly (approved_by set), decided through the
 *                  chain (approved_by NULL — exercises the name fallback), and
 *                  auto-approved with an EMPTY chain
 *   Rejected     — with an approver comment
 *   Cancelled    — withdrawn by the employee
 *   Edge cases   — an exempt day (no punches at all), a ~1,200-character reason
 *                  (the Reason panel must scroll on its own), a forgotten
 *                  check-out (punch with no `out`), a day with no original
 *                  punches, and multiple work locations
 *
 * Rows are written directly rather than through the controller on purpose: the
 * filing guards (future date, payroll lock, overlap, no-op correction) would
 * reject most of these shapes, and it is the READ path being exercised here.
 *
 *   php artisan db:seed --class=RegularizationDemoSeeder
 *   REG_CLIENT_ID=12 php artisan db:seed --class=RegularizationDemoSeeder
 *
 * Re-runnable: every seeded reason carries a marker and the seeder clears its
 * own previous rows before writing new ones.
 */
class RegularizationDemoSeeder extends Seeder
{
    /** Appended to every seeded reason so a re-run can clean up after itself. */
    private const MARKER = ' [demo]';

    public function run(): void
    {
        $clientId = (int) (env('REG_CLIENT_ID') ?: 0);

        $employees = Employee::query()
            ->when($clientId, fn ($q) => $q->where('client_id', $clientId))
            ->orderBy('id')
            ->get();

        if ($employees->count() < 2) {
            $this->command?->warn('Need at least two employees'
                . ($clientId ? " under client #{$clientId}" : '') . ' — nothing seeded.');
            return;
        }

        // The first employee doubles as the approver in every chain; the rest
        // raise the requests, so no row is routed back to the person who filed it.
        $approver = $employees->first();
        $staff    = $employees->slice(1)->values();
        $clientId = (int) $approver->client_id;

        $removed = AttendanceRegularization::where('client_id', $clientId)
            ->where('reason', 'like', '%' . self::MARKER)
            ->delete();
        if ($removed) {
            $this->command?->info("Cleared {$removed} previously seeded demo request(s).");
        }

        $longReason = 'Client visit at the Bhiwandi warehouse ran over. '
            . str_repeat('The stock count could not be closed before the gate shut, so the team '
                . 'stayed on to finish the tally and the device was never tapped on the way out. '
                . 'Raising this so the day is not marked as a half day. ', 6);

        $rows = [
            // ── Pending, level 1 waiting ──────────────────────────────────
            [
                'days'     => 2,
                'mode'     => 'adjust',
                'type'     => 'Forgot to Punch',
                'punches'  => [['in' => '09:30', 'out' => '18:30']],
                'original' => '09:34 – —',
                'reason'   => 'Forgot to tap out — left straight for the client meeting.',
                'status'   => 'Pending',
                'levels'   => [['status' => 'Pending']],
                'current'  => 1,
            ],
            // ── Pending at level 2 of a two-level chain ───────────────────
            [
                'days'     => 3,
                'mode'     => 'adjust',
                'type'     => 'Missed Punch',
                'punches'  => [['in' => '09:30', 'out' => '13:00'], ['in' => '14:00', 'out' => '18:30']],
                'original' => '09:30 – 13:02',
                'reason'   => 'Lunch punches did not register on the device.',
                'status'   => 'Pending',
                'levels'   => [
                    ['status' => 'Approved', 'role' => 'Reporting Manager', 'comment' => 'Confirmed with the team.', 'acted' => 1],
                    ['status' => 'Pending',  'role' => 'HR'],
                ],
                'current'  => 2,
            ],
            // ── Long reason — the Reason panel must scroll on its own ─────
            [
                'days'      => 4,
                'mode'      => 'adjust',
                'type'      => 'Forgot to Punch',
                'punches'   => [['in' => '09:30', 'out' => '18:30']],
                'original'  => '09:28 – —',
                'reason'    => $longReason,
                'status'    => 'Pending',
                'levels'    => [['status' => 'Pending']],
                'current'   => 1,
                'locations' => ['Bhiwandi Warehouse', 'Client site — Andheri'],
            ],
            // ── Approved directly (approved_by set) ───────────────────────
            [
                'days'     => 6,
                'mode'     => 'adjust',
                'type'     => 'Forgot to Punch',
                'punches'  => [['in' => '09:30', 'out' => '18:30']],
                'original' => '— – 18:31',
                'reason'   => 'Entered through the back gate; the morning tap was missed.',
                'status'   => 'Approved',
                'levels'   => [['status' => 'Approved', 'acted' => 5, 'comment' => 'Verified against the gate register.']],
                'current'  => 2,
                'decided'  => true,
                'comment'  => 'Approved — gate register matches.',
            ],
            // ── Approved through the chain, approved_by NULL ──────────────
            //    The modal must still name the approver, read from the chain.
            [
                'days'     => 8,
                'mode'     => 'adjust',
                'type'     => 'Missed Punch',
                'punches'  => [['in' => '09:30', 'out' => '18:30']],
                'original' => 'No punches (absent)',
                'reason'   => 'Was on site all day; the device was not reachable.',
                'status'   => 'Approved',
                'levels'   => [['status' => 'Approved', 'acted' => 7]],
                'current'  => 2,
            ],
            // ── Auto-approved with an EMPTY chain ─────────────────────────
            //    The modal shows "No approver assigned — auto-approved."
            [
                'days'     => 9,
                'mode'     => 'adjust',
                'type'     => 'Forgot to Punch',
                'punches'  => [['in' => '10:00', 'out' => '18:30']],
                'original' => '10:07 – —',
                'reason'   => 'No reporting manager assigned at the time of filing.',
                'status'   => 'Approved',
                'levels'   => [],
                'current'  => 1,
                'comment'  => 'Auto-approved — no reporting manager assigned to act',
            ],
            // ── Exempt day — carries no punches at all ────────────────────
            [
                'days'      => 11,
                'mode'      => 'exempt',
                'type'      => 'On Duty (OD)',
                'punches'   => [],
                'original'  => 'Status was: Absent',
                'reason'    => 'Full-day customer audit at the Nhava Sheva port office.',
                'status'    => 'Approved',
                'levels'    => [['status' => 'Approved', 'acted' => 10]],
                'current'   => 2,
                'decided'   => true,
                'locations' => ['Nhava Sheva Port Office'],
            ],
            // ── Forgotten check-out — a punch with an IN and no OUT ───────
            [
                'days'     => 12,
                'mode'     => 'adjust',
                'type'     => 'Forgot to Punch',
                'punches'  => [['in' => '09:30', 'out' => null]],
                'original' => 'No punches (absent)',
                'reason'   => 'Tapped in at reception, then left for the dispatch yard.',
                'status'   => 'Rejected',
                'levels'   => [['status' => 'Rejected', 'acted' => 11, 'comment' => 'No dispatch entry for that day.']],
                'current'  => 1,
                'decided'  => true,
                'comment'  => 'Rejected — the yard log does not show this visit.',
            ],
            // ── Rejected, longer approver comment ─────────────────────────
            [
                'days'     => 14,
                'mode'     => 'adjust',
                'type'     => 'Missed Punch',
                'punches'  => [['in' => '09:30', 'out' => '18:30']],
                'original' => '11:15 – 18:30',
                'reason'   => 'Traffic on the expressway; started from home at 08:00.',
                'status'   => 'Rejected',
                'levels'   => [['status' => 'Rejected', 'acted' => 13]],
                'current'  => 1,
                'decided'  => true,
                'comment'  => 'A late arrival is not a missed punch — the 11:15 tap stands.',
            ],
            // ── Cancelled by the employee ─────────────────────────────────
            [
                'days'     => 16,
                'mode'     => 'adjust',
                'type'     => 'Forgot to Punch',
                'punches'  => [['in' => '09:30', 'out' => '18:30']],
                'original' => '09:31 – 18:29',
                'reason'   => 'Raised by mistake — the day was already correct.',
                'status'   => 'Cancelled',
                'levels'   => [['status' => 'Cancelled']],
                'current'  => 1,
            ],
        ];

        $made = 0;
        foreach ($rows as $i => $spec) {
            $employee = $staff[$i % $staff->count()];

            AttendanceRegularization::create([
                'client_id'              => $employee->client_id,
                'branch_id'              => $employee->branch_id,
                'employee_id'            => $employee->id,
                'attendance_id'          => null,
                'regularization_date'    => Carbon::today()->subDays($spec['days'])->toDateString(),
                'mode'                   => $spec['mode'],
                'type'                   => $spec['type'],
                'work_locations'         => $spec['locations'] ?? [],
                'punches'                => $spec['punches'],
                'base_punches'           => $spec['mode'] === 'adjust' ? [] : null,
                // original_summary is what the queue prints under "Original
                // punches" and what the modal's "Before" chips are read from.
                'original_summary'       => $spec['original'],
                'reason'                 => $spec['reason'] . self::MARKER,
                'status'                 => $spec['status'],
                'approval_chain'         => $this->chain($spec['levels'], $approver),
                'current_approval_level' => $spec['current'],
                'approved_by'            => !empty($spec['decided']) ? $approver->user_id : null,
                'approved_at'            => in_array($spec['status'], ['Approved', 'Rejected'], true)
                    ? Carbon::today()->subDays(max(0, $spec['days'] - 1))->setTime(17, 40)
                    : null,
                'approver_comment'       => $spec['comment'] ?? null,
                'created_by'             => $employee->user_id,
                'created_at'             => Carbon::today()->subDays($spec['days'])->setTime(19, 5),
                'updated_at'             => Carbon::today()->subDays(max(0, $spec['days'] - 1))->setTime(17, 40),
            ]);
            $made++;
        }

        $this->command?->info("Seeded {$made} demo regularization request(s) for client #{$clientId}"
            . ' — approver: ' . trim($approver->first_name . ' ' . $approver->last_name) . '.');
    }

    /** Build an approval_chain in the same shape snapshotApprovalChain() writes. */
    private function chain(array $levels, Employee $approver): array
    {
        $out = [];
        foreach ($levels as $i => $lvl) {
            $acted = $lvl['acted'] ?? null;
            $out[] = [
                'level'                => $i + 1,
                'approver_kind'        => $i === 0 ? 'reporting_manager' : 'hr',
                'approver_role'        => $lvl['role'] ?? 'Reporting Manager',
                'approver_user_id'     => $approver->user_id,
                'approver_employee_id' => $approver->id,
                'approver_label'       => null,
                'status'               => $lvl['status'],
                'acted_by'             => $acted ? $approver->user_id : null,
                'acted_at'             => $acted
                    ? Carbon::today()->subDays($acted)->setTime(17, 40)->toDateTimeString()
                    : null,
                'comment'              => $lvl['comment'] ?? null,
            ];
        }

        return $out;
    }
}
