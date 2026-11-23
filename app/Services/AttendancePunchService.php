<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\AttendancePunch;
use App\Models\Employee;
use Illuminate\Database\QueryException;

class AttendancePunchService
{
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
            [$shiftStart, $shiftEnd] = $employee->resolveShiftWindow();

            return Attendance::create([
                'client_id'       => $employee->client_id,
                'branch_id'       => $employee->branch_id,
                'user_id'         => $employee->user_id,
                'employee_id'     => $employee->id,
                'attendance_date' => $date,
                'status'          => 'Present',
                'shift_name'      => trim((string) ($employee->shift ?? '')) ?: null,
                'shift_start'     => $shiftStart,
                'shift_end'       => $shiftEnd,
            ]);
        } catch (QueryException $e) {
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

    public function nextDirection(Attendance $attendance): string
    {
        $last = AttendancePunch::where('attendance_id', $attendance->id)
            ->orderByDesc('punched_at')->orderByDesc('id')->first();

        return !$last ? 'in' : ($last->direction === 'in' ? 'out' : 'in');
    }

    public function appendPunch(Attendance $attendance, Employee $employee, array $attrs): AttendancePunch
    {
        $punch = AttendancePunch::create(array_merge([
            'attendance_id' => $attendance->id,
            'employee_id'   => $employee->id,
        ], $attrs));

        $this->recomputeDay($attendance);

        return $punch;
    }

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
