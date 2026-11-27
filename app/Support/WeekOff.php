<?php

namespace App\Support;

use Carbon\Carbon;

final class WeekOff
{
    public const SUNDAY_ONLY  = 'Sunday Only';
    public const SAT_SUN      = 'Saturday & Sunday';
    public const ROT_1_3      = 'Rotational — 1st & 3rd Saturday';
    public const ROT_2_4      = 'Rotational — 2nd & 4th Saturday';

    public const OPTIONS = [self::SUNDAY_ONLY, self::SAT_SUN, self::ROT_1_3, self::ROT_2_4];

    public static function isOff(?string $label, Carbon $date): bool
    {
        $dow = (int) $date->dayOfWeek;

        if ($dow === Carbon::SUNDAY) return true;
        if ($dow !== Carbon::SATURDAY) return false;

        $nth = self::nthWeekdayOfMonth($date);
        return match (self::normalise($label)) {
            self::SAT_SUN => true,
            self::ROT_1_3 => $nth % 2 === 1,
            self::ROT_2_4 => $nth % 2 === 0,
            default       => false,
        };
    }

    public static function nthWeekdayOfMonth(Carbon $date): int
    {
        return (int) ceil($date->day / 7);
    }

    public static function normalise(?string $label): string
    {
        $l = strtolower(trim((string) $label));
        if ($l === '') return self::SUNDAY_ONLY;

        $has1and3 = str_contains($l, '1st') && str_contains($l, '3rd');
        $has2and4 = str_contains($l, '2nd') && str_contains($l, '4th');
        if ($has1and3) return self::ROT_1_3;
        if ($has2and4) return self::ROT_2_4;

        if (str_contains($l, 'sat') && str_contains($l, 'sun')) return self::SAT_SUN;

        return self::SUNDAY_ONLY;
    }

    public static function datesInRange(?string $label, Carbon $from, Carbon $to): array
    {
        $out = [];
        for ($d = $from->copy()->startOfDay(); $d->lte($to); $d->addDay()) {
            if (self::isOff($label, $d)) $out[$d->toDateString()] = true;
        }
        return $out;
    }
}
