<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\AttendancePunch;
use App\Models\Employee;
use Illuminate\Database\QueryException;

/**
 * Shared attendance-punch mechanics, extracted from AttendanceController so the
 * in-app face clock-in AND the eSSL device-import path apply IDENTICAL rules:
 *
 *   - one Attendance row per (employee, date), created on the first punch;
 *   - direction alternates strictly in → out → in → out — RE-DERIVED across the
 *     whole day in time order after every change, so a punch that arrives out of
 *     chronological order (device import / backfill landing before existing
 *     punches) can never corrupt the sequence;
 *   - the parent daily summary is recomputed from the (re-derived) punches.
 *
 * The face path layers face-match + HTTP-422 rejection on top of this; the
 * device path layers tenant mapping + timezone normalisation. Both funnel
 * through here so the timeline can never diverge.
 *
 * See docs/ESSL_ATTENDANCE_INTEGRATION.md §6 (Phase 0), §13.
 */
class AttendancePunchService
{
    /**
     * Find (optionally locking) or create the employee's attendance row for a
     * given calendar date.
     *
     * Robust against two edge cases the plain first()+create() had:
     *  - a SOFT-DELETED row still occupies the (employee, date) unique slot (the
     *    index is not partial) → we restore+reuse it instead of 500-ing;
     *  - the FIRST punch of a day can't be serialised by lockForUpdate (nothing
     *    to lock yet), so two concurrent first-punches race → we catch the unique
     *    violation and re-resolve instead of 500-ing.
     */
    public function findOrCreateDay(Employee $employee, string $date, bool $lock = true): Attendance
    {
        $attendance = $this->lookupDay($employee->id, $date, $lock);

        if ($attendance) {
            if ($attendance->trashed()) {
                $attendance->restore();
            }
            return $attendance;
        }

        try {
            return Attendance::create([
                'client_id'       => $employee->client_id,
                'branch_id'       => $employee->branch_id,
                'user_id'         => $employee->user_id,
                'employee_id'     => $employee->id,
                'attendance_date' => $date,
                'status'          => 'Present',
            ]);
        } catch (QueryException $e) {
            // Lost the create race (or a trashed row exists) — re-resolve.
            $existing = $this->lookupDay($employee->id, $date, $lock);
            if (!$existing) {
                throw $e;
            }
            if ($existing->trashed()) {
                $existing->restore();
            }
            return $existing;
        }
    }

    private function lookupDay(int $employeeId, string $date, bool $lock): ?Attendance
    {
        $query = Attendance::withTrashed()
            ->where('employee_id', $employeeId)
            ->whereDate('attendance_date', $date);

        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->first();
    }

    /**
     * The direction the NEXT punch must take, resolved from server-side
     * history: no punches → 'in'; otherwise the opposite of the last punch.
     * Used by the real-time face path for its 422 alternation guard.
     */
    public function nextDirection(Attendance $attendance): string
    {
        $last = AttendancePunch::where('attendance_id', $attendance->id)
            ->orderByDesc('punched_at')->orderByDesc('id')->first();

        return !$last ? 'in' : ($last->direction === 'in' ? 'out' : 'in');
    }

    /**
     * Append a punch, then re-derive + refresh the whole day so the sequence is
     * always correct regardless of insertion order.
     *
     * @param  array  $attrs  direction, label, method, punched_at (required)
     *                        + optional match_distance, ip, lat, lng,
     *                        device_serial, device_user_id, raw_status, notes
     */
    public function appendPunch(Attendance $attendance, Employee $employee, array $attrs): AttendancePunch
    {
        $punch = AttendancePunch::create(array_merge([
            'attendance_id' => $attendance->id,
            'employee_id'   => $employee->id,
        ], $attrs));

        $this->recomputeDay($attendance);

        return $punch;
    }

    /**
     * Re-derive EVERY punch's direction + label from strict time order (even =
     * in, odd = out), then refresh the summary. This is the single source of
     * truth for the in→out alternation invariant — callers that bulk-insert
     * punches (the importer) call this once after inserting a day's punches.
     */
    public function recomputeDay(Attendance $attendance): void
    {
        $punches = AttendancePunch::where('attendance_id', $attendance->id)
            ->orderBy('punched_at')->orderBy('id')->get();

        foreach ($punches as $i => $p) {
            $dir   = $i % 2 === 0 ? 'in' : 'out';
            $label = $dir === 'in' ? 'Check In' : 'Check Out';
            if ($p->direction !== $dir || $p->label !== $label) {
                $p->forceFill(['direction' => $dir, 'label' => $label])->save();
            }
        }

        $this->recomputeSummary($attendance, $punches);
    }

    /**
     * Rewrite the parent row's cached check-in/out from the (re-derived) punches:
     * first 'in' is the check-in; the check-out is the last 'out' ONLY when the
     * day is closed (ends on an 'out') — while the last punch is an open 'in' the
     * employee is still clocked in, so check_out_at stays null.
     *
     * @param  \Illuminate\Support\Collection|null  $punches  time-ordered punches (re-fetched if null)
     */
    public function recomputeSummary(Attendance $attendance, $punches = null): void
    {
        $punches ??= AttendancePunch::where('attendance_id', $attendance->id)
            ->orderBy('punched_at')->orderBy('id')->get();

        $firstIn  = $punches->firstWhere('direction', 'in');
        $endsOpen = $punches->isNotEmpty() && $punches->last()->direction === 'in';
        $lastOut  = $endsOpen ? null : $punches->last(fn ($p) => $p->direction === 'out');

        $attendance->update([
            'check_in_at'              => $firstIn?->punched_at,
            'check_in_method'          => $firstIn?->method,
            'check_in_match_distance'  => $firstIn?->match_distance,
            'check_in_ip'              => $firstIn?->ip,
            'check_in_lat'             => $firstIn?->lat,
            'check_in_lng'             => $firstIn?->lng,
            'check_out_at'             => $lastOut?->punched_at,
            'check_out_method'         => $lastOut?->method,
            'check_out_match_distance' => $lastOut?->match_distance,
            'check_out_ip'             => $lastOut?->ip,
            'check_out_lat'            => $lastOut?->lat,
            'check_out_lng'            => $lastOut?->lng,
        ]);
    }
}
