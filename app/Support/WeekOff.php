<?php

namespace App\Support;

use Carbon\Carbon;

/* Type-hinted against the BASE Carbon\Carbon, not Illuminate\Support\Carbon.
 * Laravel's class EXTENDS this one, so hinting the base accepts both — hinting
 * Laravel's rejects a plain Carbon\Carbon, which is exactly what CarbonPeriod
 * iteration and Carbon\Carbon::parse() hand us. */

/**
 * Weekly-off resolution for a single employee.
 *
 * `employees.weekly_off` stores a LABEL, and every consumer used to re-parse it
 * by scanning for day names — a copy of the same twelve lines lived in both
 * AttendanceController and LeaveRequestController. That approach could only ever
 * express "these weekdays are off"; it had no way to say "the 2nd and 4th
 * Saturday", and any label it failed to understand silently collapsed to Sunday.
 * (Every seeded employee carried the literal label "Week Off Policy", so the
 * whole workforce was quietly running on the Sunday fallback.)
 *
 * This class is the single place that answers "is this date an off day?", and it
 * understands the nth-weekday patterns Indian offices actually use.
 */
final class WeekOff
{
    /** Canonical labels. The employee form's dropdown must offer exactly these. */
    public const SUNDAY_ONLY  = 'Sunday Only';
    public const SAT_SUN      = 'Saturday & Sunday';
    public const ROT_1_3      = 'Rotational — 1st & 3rd Saturday';
    public const ROT_2_4      = 'Rotational — 2nd & 4th Saturday';

    public const OPTIONS = [self::SUNDAY_ONLY, self::SAT_SUN, self::ROT_1_3, self::ROT_2_4];

    /** Is $date a weekly off for an employee on $label? */
    public static function isOff(?string $label, Carbon $date): bool
    {
        $dow = (int) $date->dayOfWeek;                 // 0 = Sunday … 6 = Saturday

        // Sunday is the base off day in every supported pattern.
        if ($dow === Carbon::SUNDAY) return true;
        if ($dow !== Carbon::SATURDAY) return false;   // only Saturday varies

        /* Counted PER MONTH, deliberately — the month resets the rule.
         *
         * A continuous every-other-Saturday cycle was tried and rejected: it
         * never breaks, but the off Saturday drifts, so a "1st & 3rd" employee
         * ends up off on the 2nd and 4th a month later and the label stops
         * describing the policy. The monthly rule keeps the label literally
         * true and gives payroll exactly two off Saturdays every single month.
         *
         * A 5th Saturday follows each pattern's own parity rather than being
         * treated as a special case: the 1st/3rd pattern takes the ODD ones, so
         * a 5th Saturday is off too (1, 3, 5) and the month alternates cleanly
         * off/work/off/work/off. The 2nd/4th pattern takes the EVEN ones, so a
         * 5th Saturday is a working day there — 5 is odd, and the rule is not
         * "every other one from the 2nd". */
        $nth = self::nthWeekdayOfMonth($date);
        return match (self::normalise($label)) {
            self::SAT_SUN => true,
            self::ROT_1_3 => $nth % 2 === 1,           // 1st, 3rd, 5th
            self::ROT_2_4 => $nth % 2 === 0,           // 2nd, 4th
            default       => false,                    // Sunday Only (and unknown labels)
        };
    }

    /**
     * Which occurrence of its weekday this date is within its month — the 2nd
     * Saturday returns 2. Counted from the date itself (day 8-14 is always the
     * 2nd), NOT from calendar week numbers, which drift with the month's start
     * day and are the usual source of "2nd Saturday" bugs.
     */
    public static function nthWeekdayOfMonth(Carbon $date): int
    {
        return (int) ceil($date->day / 7);
    }

    /**
     * Map a stored label onto a canonical one.
     *
     * Legacy values are tolerated rather than rejected: "Sunday", "Sun",
     * "Rotational" and the placeholder "Week Off Policy" all pre-date this
     * class. Anything unrecognised resolves to Sunday-only, which is what the
     * old fallback already did — so behaviour never changes silently for a
     * label this class doesn't know.
     */
    public static function normalise(?string $label): string
    {
        $l = strtolower(trim((string) $label));
        if ($l === '') return self::SUNDAY_ONLY;

        $has1and3 = str_contains($l, '1st') && str_contains($l, '3rd');
        $has2and4 = str_contains($l, '2nd') && str_contains($l, '4th');
        if ($has1and3) return self::ROT_1_3;
        if ($has2and4) return self::ROT_2_4;

        // "Saturday & Sunday", "sat,sun", "Sat & Sun" — both days named, no
        // nth-qualifier, so every Saturday is off.
        if (str_contains($l, 'sat') && str_contains($l, 'sun')) return self::SAT_SUN;

        return self::SUNDAY_ONLY;
    }

    /** Off-day dates (Y-m-d => true) across an inclusive range. */
    public static function datesInRange(?string $label, Carbon $from, Carbon $to): array
    {
        $out = [];
        for ($d = $from->copy()->startOfDay(); $d->lte($to); $d->addDay()) {
            if (self::isOff($label, $d)) $out[$d->toDateString()] = true;
        }
        return $out;
    }
}
