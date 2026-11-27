<?php

namespace App\Support;

use App\Models\LeaveRequest;
use Illuminate\Support\Carbon;

/**
 * Per-year quota resolution and opening carry-forward balance for a leave type.
 *
 * A leave type's quota can differ per calendar year: config_json.accrual holds a
 * base `yearlyQuota` plus an optional `quotaByYear` map ({ "2026": 12, "2027": 15 }).
 * quotaForYear() resolves the right number for a given year.
 *
 * Year-end rule (config_json.yearEnd.carryForward):
 *   · reset        — nothing carries; each year starts at its own quota (default).
 *   · carry_all    — all of the previous year's leftover carries in.
 *   · carry_capped — leftover carries in, capped at carryForwardCap.
 * Overdraft/extra is a per-year allowance and does NOT carry.
 */
final class LeaveCarry
{
    private const MAX_LOOKBACK_YEARS = 15;

    /** Whether $year has no limit: the whole type is unlimited, or the year is
     *  listed in accrual.unlimitedYears. */
    public static function isUnlimitedYear(array $accrual, int $year): bool
    {
        if (!empty($accrual['unlimited'])) return true;
        $years = $accrual['unlimitedYears'] ?? [];
        if (!is_array($years)) return false;
        foreach ($years as $y) {
            if ((int) $y === $year) return true;
        }
        return false;
    }

    /** The quota configured for $year: quotaByYear[$year] if set, else yearlyQuota. */
    public static function quotaForYear(array $accrual, int $year): float
    {
        $byYear = $accrual['quotaByYear'] ?? null;
        if (is_array($byYear)) {
            $k = (string) $year;
            if (array_key_exists($k, $byYear) && $byYear[$k] !== '' && $byYear[$k] !== null) {
                return (float) $byYear[$k];
            }
        }
        return (float) ($accrual['yearlyQuota'] ?? 0);
    }

    /** Carry-in (opening) balance for $targetYear. 0 for reset / no history. */
    public static function openingFor(
        int $employeeId,
        int $leaveTypeId,
        int $targetYear,
        string $rule,
        float $cap,
        array $accrual,
        ?int $joinYear = null,
    ): float {
        $rule = strtolower(trim($rule));
        if ($rule === '' || $rule === 'reset') return 0.0;

        $usedByYear = LeaveRequest::query()
            ->where('employee_id', $employeeId)
            ->where('leave_type_id', $leaveTypeId)
            ->where('status', 'Approved')
            ->whereDate('from_date', '<', Carbon::create($targetYear, 1, 1)->toDateString())
            ->selectRaw('EXTRACT(YEAR FROM from_date)::int AS y, SUM(days) AS d')
            ->groupBy('y')
            ->get()
            ->pluck('d', 'y')
            ->map(fn ($v) => (float) $v)
            ->all();

        $startYear = $joinYear ?? (empty($usedByYear) ? $targetYear : (int) min(array_keys($usedByYear)));
        $startYear = max((int) $startYear, $targetYear - self::MAX_LOOKBACK_YEARS);

        $carry = 0.0;
        for ($y = $startYear; $y < $targetYear; $y++) {
            $quota = self::quotaForYear($accrual, $y);
            $used = (float) ($usedByYear[$y] ?? 0);
            $leftover = max(0.0, $carry + $quota - $used);
            $carry = $rule === 'carry_all' ? $leftover : min($cap, $leftover); // carry_capped
        }
        return round($carry, 2);
    }
}
