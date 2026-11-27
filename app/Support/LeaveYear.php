<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * The leave year is the CALENDAR year (Jan 1 – Dec 31). A leave plan's quota is
 * per calendar year, so every used-days / balance computation must scope to the
 * year of the leave's dates — a leave in one year is never charged against
 * another year's quota.
 *
 * Kept as a tiny helper (rather than inlining `whereYear`) so the "which year"
 * rule lives in one place and the year selector can reuse it.
 */
final class LeaveYear
{
    /** The calendar year a leave belongs to (its from_date year). */
    public static function of(Carbon $date): int
    {
        return $date->year;
    }

    /** The current leave year. */
    public static function current(): int
    {
        return Carbon::today()->year;
    }

    /** [startOfYear, endOfYearExclusive] for scoping ranges when needed. */
    public static function bounds(int $year): array
    {
        return [
            Carbon::create($year, 1, 1)->startOfDay(),
            Carbon::create($year, 1, 1)->startOfDay()->addYear(),
        ];
    }

    /** Clamp an arbitrary year input to a sane range for the selector. */
    public static function sanitize($year, int $min = 2000, int $max = 2100): int
    {
        $y = (int) $year;
        if ($y < $min || $y > $max) return self::current();
        return $y;
    }
}
