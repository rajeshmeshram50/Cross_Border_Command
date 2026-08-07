<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\WeekOff;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * On-demand ATTENDANCE test-data generator (run only when you ask, via a curl).
 *
 * For a date range, a client, a branch and a list of employee CODES it fills
 * the attendance section day by day:
 *   - a weekly-off day (per the employee's own WeekOff pattern) → "Weekly Off"
 *   - every other day → the chosen working status (default "Present"), with
 *     matching check-in / check-out punches.
 *
 * Idempotent per employee+day (updateOrInsert; punches are rebuilt). Admins only.
 */
class AttendanceTestController extends Controller
{
    private const IST = 'Asia/Kolkata';
    /** Marks the weekly leaves this tool creates, so re-runs can clear them. */
    private const LEAVE_TAG = 'Attendance test —';

    /**
     * Realistic multi-punch day per status — a list of [time, direction, label].
     * Directions strictly alternate in → out → in → out (the attendance module
     * rejects two same-direction punches in a row). Full days = 6 punches
     * (in · break · lunch · out); short days = 4. No punches for absent/off.
     */
    private function punchPlan(string $status): array
    {
        return match ($status) {
            'Present' => [
                ['09:00', 'in', 'Check In'], ['11:15', 'out', 'Break Out'], ['11:30', 'in', 'Break In'],
                ['13:30', 'out', 'Lunch Out'], ['14:15', 'in', 'Lunch In'], ['18:00', 'out', 'Check Out'],
            ],
            'Overtime' => [
                ['09:00', 'in', 'Check In'], ['11:15', 'out', 'Break Out'], ['11:30', 'in', 'Break In'],
                ['13:30', 'out', 'Lunch Out'], ['14:15', 'in', 'Lunch In'], ['21:00', 'out', 'Check Out'],
            ],
            'Half Day' => [
                ['09:00', 'in', 'Check In'], ['11:15', 'out', 'Break Out'], ['11:30', 'in', 'Break In'], ['13:30', 'out', 'Check Out'],
            ],
            'Late' => [
                ['11:30', 'in', 'Check In'], ['13:30', 'out', 'Lunch Out'], ['14:15', 'in', 'Lunch In'], ['18:30', 'out', 'Check Out'],
            ],
            default => [], // Absent, Leave, Weekly Off — no punches
        };
    }

    public function seed(Request $request)
    {
        $user = $request->user();
        if (!$user || $user->user_type === 'employee') {
            abort(403, 'Only an admin / branch user can generate attendance test data.');
        }

        $data = $request->validate([
            'client_id'        => ['required', 'integer'],
            'branch_id'        => ['required', 'integer'],
            'employee_codes'   => ['required', 'array', 'min:1'],
            'employee_codes.*' => ['string', 'max:40'],
            'start_date'       => ['required', 'date'],
            'end_date'         => ['required', 'date', 'after_or_equal:start_date'],
            // Status applied to WORKING days (off days are always Weekly Off).
            'working_status'   => ['nullable', 'in:Present,Half Day,Late,Overtime,Absent,Leave'],
        ]);

        $clientId = (int) $data['client_id'];
        $branchId = (int) $data['branch_id'];
        $status   = $data['working_status'] ?? 'Present';

        // Tenant guard — non-super-admins are locked to their own scope.
        if ($user->user_type !== 'super_admin') {
            if ($user->client_id && $clientId !== (int) $user->client_id) {
                abort(403, 'Out of your client scope.');
            }
            if ($user->user_type === 'branch_user' && $user->branch_id && $branchId !== (int) $user->branch_id) {
                abort(403, 'Out of your branch scope.');
            }
        }

        $start = Carbon::parse($data['start_date'])->startOfDay();
        $end   = Carbon::parse($data['end_date'])->startOfDay();
        if ($start->diffInDays($end) > 120) {
            return response()->json(['status' => false, 'message' => 'Range too large — keep it within 120 days.'], 422);
        }

        $emps = DB::table('employees')
            ->where('client_id', $clientId)->where('branch_id', $branchId)
            ->whereIn('emp_code', $data['employee_codes'])
            ->whereNull('deleted_at')
            ->get(['id', 'emp_code', 'user_id', 'weekly_off']);
        if ($emps->isEmpty()) {
            return response()->json(['status' => false, 'message' => 'No matching employees for those codes in this client/branch.'], 422);
        }

        $toUtc = fn (string $date, string $time) => Carbon::parse("$date $time", self::IST)->utc()->toDateTimeString();
        $plan  = $this->punchPlan($status);          // punches for a normal working day
        $halfPlan = $this->punchPlan('Half Day');    // 4 punches for the weekly half-day

        // A paid leave type for the weekly full-leave + half-day requests.
        $leaveTypeId = DB::table('master_leave_types')
            ->where('client_id', $clientId)->where('branch_id', $branchId)
            ->whereRaw('LOWER(paid_unpaid) = ?', ['paid'])->orderBy('id')->value('id')
            ?: DB::table('master_leave_types')->where('client_id', $clientId)->orderBy('id')->value('id');

        $out = [];
        foreach ($emps as $e) {
            // Idempotent: clear this tool's own weekly leaves for the employee in range.
            DB::table('leave_requests')
                ->where('employee_id', $e->id)->where('reason', 'like', self::LEAVE_TAG . '%')
                ->whereBetween('from_date', [$start->toDateString(), $end->toDateString()])
                ->delete();

            $worked = 0; $off = 0; $fullLeaves = 0; $halfDays = 0;
            $week = null; $weekWorkIdx = 0;
            for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
                $date = $d->toDateString();
                if (WeekOff::isOff($e->weekly_off, $d)) {
                    $this->writeDay($clientId, $branchId, $e, $date, 'Weekly Off', [], $toUtc);
                    $off++;
                    continue;
                }
                // New ISO week → reset the per-week working-day counter.
                $wk = $d->format('o-W');
                if ($wk !== $week) { $week = $wk; $weekWorkIdx = 0; }
                $weekWorkIdx++;

                if ($weekWorkIdx === 1 && $leaveTypeId) {
                    // 1st working day of the week → FULL-day leave.
                    $this->writeDay($clientId, $branchId, $e, $date, 'Leave', [], $toUtc);
                    $this->createLeave($clientId, $branchId, $e->id, $date, 'full', 1, $leaveTypeId, self::LEAVE_TAG . ' full leave');
                    $fullLeaves++;
                } elseif ($weekWorkIdx === 2 && $leaveTypeId) {
                    // 2nd working day of the week → HALF day.
                    $this->writeDay($clientId, $branchId, $e, $date, 'Half Day', $halfPlan, $toUtc);
                    $this->createLeave($clientId, $branchId, $e->id, $date, 'first_half', 0.5, $leaveTypeId, self::LEAVE_TAG . ' half day');
                    $halfDays++;
                } else {
                    $this->writeDay($clientId, $branchId, $e, $date, $status, $plan, $toUtc);
                    $worked++;
                }
            }
            $out[] = [
                'emp_code' => $e->emp_code, 'weekly_off' => $e->weekly_off,
                'worked_days' => $worked, 'full_leaves' => $fullLeaves, 'half_days' => $halfDays, 'off_days' => $off,
            ];
        }

        return response()->json([
            'status'  => true,
            'message' => "Attendance seeded for {$emps->count()} employee(s) from "
                . $start->format('d M Y') . ' to ' . $end->format('d M Y')
                . " — working days = \"{$status}\" (" . count($plan) . ' punches); plus 1 full-day leave + 1 half-day each week; off days = Weekly Off.',
            'range'   => $start->format('Y-m-d') . ' → ' . $end->format('Y-m-d'),
            'working_status' => $status,
            'punches_per_working_day' => count($plan),
            'employees' => $out,
        ]);
    }

    /** Insert one approved leave request (full or half day). */
    private function createLeave(int $clientId, int $branchId, int $employeeId, string $date, string $dayType, float $days, int $typeId, string $reason): void
    {
        DB::table('leave_requests')->insert([
            'client_id' => $clientId, 'branch_id' => $branchId,
            'employee_id' => $employeeId, 'leave_type_id' => $typeId,
            'from_date' => $date, 'to_date' => $date,
            'days' => $days, 'day_type' => $dayType,
            'reason' => $reason, 'status' => 'Approved',
            'approved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** Upsert one attendance row + rebuild its punches from the plan. */
    private function writeDay(int $clientId, int $branchId, object $e, string $date, string $status, array $plan, callable $toUtc): void
    {
        // First IN / last OUT drive the header check-in/out on the attendance row.
        $cin = null; $cout = null;
        foreach ($plan as [$time, $dir]) {
            $ts = $toUtc($date, $time);
            if ($dir === 'in' && $cin === null) $cin = $ts;
            if ($dir === 'out') $cout = $ts;
        }

        DB::table('attendances')->updateOrInsert(
            ['employee_id' => $e->id, 'attendance_date' => $date],
            [
                'client_id' => $clientId, 'branch_id' => $branchId,
                'user_id' => $e->user_id, 'status' => $status,
                'check_in_at' => $cin, 'check_out_at' => $cout,
                'check_in_method' => $cin ? 'manual' : null,
                'check_out_method' => $cout ? 'manual' : null,
                'updated_at' => now(), 'created_at' => now(),
            ]
        );
        $attId = (int) DB::table('attendances')->where('employee_id', $e->id)->where('attendance_date', $date)->value('id');
        if (!$attId) return;

        DB::table('attendance_punches')->where('attendance_id', $attId)->delete();
        foreach ($plan as [$time, $dir, $label]) {
            DB::table('attendance_punches')->insert([
                'attendance_id' => $attId, 'employee_id' => $e->id,
                'punched_at' => $toUtc($date, $time), 'direction' => $dir, 'label' => $label,
                'method' => 'manual', 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }
}
