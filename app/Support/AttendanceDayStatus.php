<?php

namespace App\Support;

use App\Models\Attendance;

class AttendanceDayStatus
{
    public const DISPLAY_TZ = 'Asia/Kolkata';

    public static function resolve(
        ?Attendance $row,
        bool $weeklyOff,
        ?string $shiftStart,
        string $date,
        bool $isHoliday = false,
    ): string {
        if ($row && !empty($row->status)) {
            $stored = (string) $row->status;

            if (self::workedARestDay($stored, $row)) {
                $stored = 'Present';
            }

            if (strcasecmp($stored, 'Present') === 0 && $row->check_in_at && $shiftStart) {
                $dayShiftStart = $row->shiftWindow()[0] ?: $shiftStart;
                $localIn = $row->check_in_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i');
                $late = self::minutesBetween($dayShiftStart, $localIn);
                if ($late > Attendance::LATE_GRACE_MINUTES) return 'Late';
            }
            return $stored;
        }
        if ($weeklyOff) return 'Weekly Off';
        if ($isHoliday) return 'Holiday';
        return 'Absent';
    }

    public static function workedARestDay(?string $status, ?Attendance $row): bool
    {
        if (!$row || $status === null) return false;
        if (!in_array(strtolower(trim($status)), ['holiday', 'weekly off'], true)) return false;

        return (bool) $row->check_in_at
            || ($row->relationLoaded('punches') && $row->punches->isNotEmpty());
    }

    private static function minutesBetween(string $from, string $to): int
    {
        [$fh, $fm] = array_map('intval', explode(':', $from));
        [$th, $tm] = array_map('intval', explode(':', $to));
        return ($th * 60 + $tm) - ($fh * 60 + $fm);
    }
}
