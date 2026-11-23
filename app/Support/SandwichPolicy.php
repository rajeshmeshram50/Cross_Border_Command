<?php

namespace App\Support;

use App\Models\Employee;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class SandwichPolicy
{
    public const LOOKAROUND_DAYS = 15;

    private static array $branchSwitchCache = [];

    public static function appliesTo(?Employee $employee): bool
    {
        $branchId = $employee?->branch_id ? (int) $employee->branch_id : null;
        if (!$branchId) {
            return false;
        }
        if (!Schema::hasColumn('branches', 'sandwich_policy')) {
            return false;
        }
        if (!array_key_exists($branchId, self::$branchSwitchCache)) {
            self::$branchSwitchCache[$branchId] = (bool) DB::table('branches')
                ->where('id', $branchId)
                ->value('sandwich_policy');
        }
        return self::$branchSwitchCache[$branchId];
    }

    public static function flushCache(): void
    {
        self::$branchSwitchCache = [];
    }

    public static function approvedLeaveDates(
        int $employeeId,
        Carbon $from,
        Carbon $to,
        ?int $ignoreRequestId = null,
    ): array {
        if (!Schema::hasTable('leave_requests')) {
            return [];
        }

        $rows = DB::table('leave_requests')
            ->where('employee_id', $employeeId)
            ->where('status', 'Approved')
            ->whereDate('from_date', '<=', $to->toDateString())
            ->whereDate('to_date', '>=', $from->toDateString())
            ->when($ignoreRequestId, fn ($q) => $q->where('id', '!=', $ignoreRequestId))
            ->get(['from_date', 'to_date']);

        $dates = [];
        foreach ($rows as $r) {
            $s = Carbon::parse($r->from_date)->startOfDay();
            $e = Carbon::parse($r->to_date)->startOfDay();
            if ($s->lt($from)) $s = $from->copy()->startOfDay();
            if ($e->gt($to))   $e = $to->copy()->startOfDay();
            for ($d = $s; $d->lte($e); $d->addDay()) {
                $dates[$d->toDateString()] = true;
            }
        }
        return $dates;
    }

    public static function chargeableOffDays(
        Carbon $from,
        Carbon $to,
        callable $isOff,
        callable $isLeave,
    ): array {
        $start = $from->copy()->startOfDay();
        $end   = $to->copy()->startOfDay();
        $hits  = [];

        $before = $start->copy()->subDay();
        if ($isOff($before)) {
            $runStart = self::walkBack($before, $isOff);
            if ($isLeave($runStart->copy()->subDay())) {
                self::collect($hits, $runStart, $before);
            }
        }

        $cursor = $start->copy();
        while ($cursor->lte($end)) {
            if (!$isOff($cursor)) {
                $cursor->addDay();
                continue;
            }
            $runEnd = self::walkForward($cursor, $isOff);
            $flankedBefore = $isLeave($cursor->copy()->subDay());
            $flankedAfter  = $isLeave($runEnd->copy()->addDay());
            if ($flankedBefore && $flankedAfter) {
                self::collect(
                    $hits,
                    $cursor->copy(),
                    $runEnd->lt($end) ? $runEnd : $end,
                );
            }
            $cursor = $runEnd->copy()->addDay();
        }

        $out = array_keys($hits);
        sort($out);
        return $out;
    }

    private static function walkBack(Carbon $day, callable $isOff): Carbon
    {
        $cur = $day->copy();
        for ($i = 0; $i < self::LOOKAROUND_DAYS; $i++) {
            $prev = $cur->copy()->subDay();
            if (!$isOff($prev)) break;
            $cur = $prev;
        }
        return $cur;
    }

    private static function walkForward(Carbon $day, callable $isOff): Carbon
    {
        $cur = $day->copy();
        for ($i = 0; $i < self::LOOKAROUND_DAYS; $i++) {
            $next = $cur->copy()->addDay();
            if (!$isOff($next)) break;
            $cur = $next;
        }
        return $cur;
    }

    private static function collect(array &$hits, Carbon $from, Carbon $to): void
    {
        for ($d = $from->copy(); $d->lte($to); $d->addDay()) {
            $hits[$d->toDateString()] = true;
        }
    }
}
