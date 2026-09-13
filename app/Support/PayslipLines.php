<?php

namespace App\Support;

/**
 * Presentation rules for a stored payslip's component lines.
 *
 * A payslip's `earnings` JSON is written once, when the run is generated, and a
 * finalized cycle is never regenerated to tidy up how it reads. Both rules here
 * therefore have to run on READ, so history and new slips look the same.
 *
 * Neither rule changes a stored figure or a total. They decide what the reader
 * is shown, and the engine remains the only thing that decides what is paid.
 */
final class PayslipLines
{
    /**
     * Drop components the salary structure does not fund. (#147)
     *
     * Special Allowance is the residual head — it lands on zero the moment
     * Basic, HRA and HR's own rows use up the whole CTC — so a structure keeps
     * a `special` row worth nothing and the slip printed "Special Allowance
     * ₹0.00" for a component the breakup does not configure.
     *
     * BOTH figures must be zero. A funded component pro-rates to ₹0.00 on a
     * late joiner's slip, and hiding it there would conceal real pay.
     */
    public static function withoutUnfunded(array $lines): array
    {
        return array_values(array_filter($lines, static fn ($l) =>
            round((float) ($l['amount'] ?? 0), 2) != 0.0
            || round((float) ($l['monthly'] ?? 0), 2) != 0.0));
    }

    /**
     * Absorb sub-paisa rounding residue so the lines add up to the total. (#10)
     *
     * Each component is rounded to the paisa on its own while the total is
     * rounded once from the whole, so on a pro-rated cycle the two can differ
     * by a paisa per line: a slip reading 2,820.90 + 1,692.54 + 1,128.36 against
     * a stated Total Earnings of ₹5,641.81 (payslip 925). PayrollService has
     * reconciled this at generation time since #134 — verified exact across a
     * 40-case decimal fuzz — but slips generated before that fix still carry
     * the residue, and a locked cycle cannot be regenerated to correct it.
     *
     * The residue goes to the LARGEST line, where it is proportionally
     * smallest; only the split moves, never the total.
     *
     * A discrepancy bigger than a paisa per line is NOT rounding, and is left
     * exactly as stored: quietly reshaping it would hide a real calculation
     * fault behind a total that always looks right, which is the opposite of
     * what this is for.
     */
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
