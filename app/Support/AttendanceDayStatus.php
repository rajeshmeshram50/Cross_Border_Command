<?php

namespace App\Support;

use App\Models\Attendance;

/**
 * What status does ONE day read as, for ONE employee?
 *
 * Lifted VERBATIM out of AttendanceController so Payroll can ask the same
 * question instead of answering it a second time. That duplication is the bug
 * this class exists to prevent: the Biometric Input table used to reconstruct
 * its Absent column by subtraction — scheduled days minus present minus
 * holidays — which is a second model of the month maintained by hand, and it
 * drifted from the calendar twice in opposite directions (CBC #8 inflated it
 * with holidays, QA #55 deflated it with holidays the employee had worked).
 *
 * Nothing here is new. AttendanceController::resolveDayStatus() and
 * workedARestDay() now delegate to these methods, so the calendar behaves
 * exactly as it did; the only change is that payroll can reach them too.
 *
 * Deliberately pure — it takes a row and three facts about the day and returns
 * a string. No queries, no request state, so a caller is free to drive it over
 * a whole month for a whole run without a query per day.
 */
class AttendanceDayStatus
{
    /** Timezone every stored UTC punch is read back in. */
    public const DISPLAY_TZ = 'Asia/Kolkata';

    /**
     * Resolve the day, in strict precedence order:
     *
     *   1. a stored status wins (with the two adjustments below)
     *   2. no row + weekly off  → 'Weekly Off'
     *   3. no row + holiday     → 'Holiday'
     *   4. otherwise            → 'Absent'
     *
     * So 'Absent' means a scheduled day with nothing recorded against it and
     * no reason for there being nothing — which is exactly the question the
     * Biometric Input screen is asking before payroll is run.
     */
    public static function resolve(
        ?Attendance $row,
        bool $weeklyOff,
        ?string $shiftStart,
        string $date,
        bool $isHoliday = false,
    ): string {
        if ($row && !empty($row->status)) {
            $stored = (string) $row->status;

            /* Working a rest day beats the rest-day label. (#89)
             *
             * A stored 'Holiday' / 'Weekly Off' is not always a statement that
             * the employee was off — it is sometimes just what the row was
             * STAMPED with when it was created. AttendanceRegularization's
             * exemption path seeds a new row from PayrollService::restDayKind(),
             * which returns 'Holiday' on a holiday, and AttendancePunchService
             * reuses an existing row without touching its status. So once such
             * a row exists, later punches attach to it and the day keeps
             * reading "Holiday" while the Attendance Log lists the punches
             * right next to it — the contradiction in the report.
             *
             * If the row carries real attendance, the person worked; say so.
             * Only a rest-day label is overridden, and only when there is a
             * punch to justify it, so a genuine holiday with no attendance is
             * untouched.
             *
             * Falls THROUGH to the Late promotion below rather than returning
             * 'Present' outright. An earlier revision returned early, reasoning
             * that a closed day has no shift to be late against and that Late
             * would feed the LOP deduction — the second half of which is simply
             * wrong: the late-mark KPI and payroll both count the STORED status
             * (see the MTD loop in dailyView), never this resolved one, so
             * returning Present suppressed nothing. It only hid a late arrival
             * the Attendance Log was reporting two rows away, and #90 asks for
             * "Present/Worked (or Late, if applicable)". */
            if (self::workedARestDay($stored, $row)) {
                $stored = 'Present';
            }

            // Auto-promote Present → Late based on the local first-in, using
            // the one grace figure every layer reads (#22).
            if (strcasecmp($stored, 'Present') === 0 && $row->check_in_at && $shiftStart) {
                // The shift THIS day was worked under, not the employee's
                // current one — see Attendance::shiftWindow(). (#216)
                $dayShiftStart = $row->shiftWindow()[0] ?: $shiftStart;
                $localIn = $row->check_in_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i');
                $late = self::minutesBetween($dayShiftStart, $localIn);
                if ($late > Attendance::LATE_GRACE_MINUTES) return 'Late';
            }
            return $stored;
        }
        if ($weeklyOff) return 'Weekly Off';
        /* A company holiday is not an absence. (#86)
         *
         * With no attendance row this fell straight through to 'Absent', so a
         * holiday only started reading as one once a regularization CREATED a
         * row for the day — the status appeared to depend on paperwork rather
         * than on the calendar. Nobody has to be regularized onto a day the
         * company was closed.
         *
         * Checked after the stored status, so an employee who genuinely worked
         * the holiday keeps their Present/Late reading, and after the weekly
         * off, so a holiday landing on someone's off-day still reads as their
         * off-day. Only the "no row, working day" case changes — which is the
         * one that was wrong. */
        if ($isHoliday) return 'Holiday';
        // Future dates with no attendance row default to Absent rather than
        // pretending the day is already "Present". The SPA's date picker
        // shouldn't be in the future in practice, but if the user navigates
        // there we don't want to claim attendance that hasn't happened.
        return 'Absent';
    }

    /**
     * A stored 'Holiday' / 'Weekly Off' is not proof the employee was off; it
     * is sometimes just what the row was stamped with when it was created (see
     * PayrollService::restDayKind via the regularization path), and
     * AttendancePunchService reuses an existing row without revisiting its
     * status. A punch on the row settles the question.
     */
    public static function workedARestDay(?string $status, ?Attendance $row): bool
    {
        if (!$row || $status === null) return false;
        if (!in_array(strtolower(trim($status)), ['holiday', 'weekly off'], true)) return false;

        return (bool) $row->check_in_at
            || ($row->relationLoaded('punches') && $row->punches->isNotEmpty());
    }

    /** Minutes from $from ("HH:MM") to $to ("HH:MM"); negative if $to earlier. */
    private static function minutesBetween(string $from, string $to): int
    {
        [$fh, $fm] = array_map('intval', explode(':', $from));
        [$th, $tm] = array_map('intval', explode(':', $to));
        return ($th * 60 + $tm) - ($fh * 60 + $fm);
    }
}
