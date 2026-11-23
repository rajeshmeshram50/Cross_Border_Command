<?php

namespace App\Support;

final class PayslipLines
{
    public static function withoutUnfunded(array $lines): array
    {
        return array_values(array_filter($lines, static fn ($l) =>
            round((float) ($l['amount'] ?? 0), 2) != 0.0
            || round((float) ($l['monthly'] ?? 0), 2) != 0.0));
    }

    public static function reconciledTo(array $lines, float $total): array
    {
        if (!$lines) {
            return $lines;
        }

        $sum   = round(array_sum(array_map(static fn ($l) => (float) ($l['amount'] ?? 0), $lines)), 2);
        $delta = round($total - $sum, 2);
        if ($delta == 0.0 || abs($delta) > (0.01 * count($lines)) + 0.02) {
            return $lines;
        }

        $biggest = 0;
        foreach ($lines as $i => $l) {
            if (abs((float) ($l['amount'] ?? 0)) > abs((float) ($lines[$biggest]['amount'] ?? 0))) {
                $biggest = $i;
            }
        }
        $lines[$biggest]['amount'] = round((float) ($lines[$biggest]['amount'] ?? 0) + $delta, 2);

        return $lines;
    }
}
