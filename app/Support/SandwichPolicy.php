<?php

namespace App\Support;

use App\Models\Employee;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sandwich Leave Policy.
 *
 * An off-day — a weekly-off or a holiday — is normally free. Under this policy
 * it becomes chargeable leave when the employee was on leave on BOTH sides of
 * it, i.e. the block of off-days is "sandwiched" between two leave days:
 *
 *     Fri     Sat     Sun     Mon
 *     LEAVE   off     off     LEAVE     -> Sat + Sun charged too  (4 days)
 *     LEAVE   off     off     present   -> Sat + Sun free         (1 day)
 *
 * It applies to every leave type; the trigger is the shape of the calendar
 * around the leave, not what kind of leave it is. Whether it runs at all is a
 * per-BRANCH switch (`branches.sandwich_policy`), so every employee posted to
 * that office is covered, joiners included.
 *
 * ── Why the maths lives here and not in a controller ──────────────────────
 * Leave days are sized in two independent places: LeaveRequestController when
 * a request is raised, and PayrollService when a payslip is cut. They must
 * agree — if only one of them knew about sandwiching, the screen would show
 * 3 days while the salary deducted 5. This class is the single answer, exactly
 * as App\Support\WeekOff is the single answer to "is this date an off day?".
 *
 * ── Which request pays for the sandwich ───────────────────────────────────
 * The two leave days can live in separate requests (apply for Friday on
 * Monday, then for Monday on Wednesday), and the off-days between them then
 * belong to neither request's date range. The rule is:
 *
 *     a run of off-days is charged to the leave that covers the day
 *     IMMEDIATELY AFTER the run.
 *
 * That is deterministic and cannot double-charge: exactly one leave can hold
 * the day after any given run. It also means the sandwich is detected when the
 * closing leave is applied for — which is the only moment it can be known.
 */
final class SandwichPolicy
{
    /**
     * How far either side of a leave the scanner will look.
     *
     * Also the safety cap on expanding a run of off-days. A misconfigured
     * weekly-off (or a holiday group covering a whole fortnight) could
     * otherwise make the "keep walking while the next day is off" loops run
     * forever. No genuine off-run comes close to this.
     */
    public const LOOKAROUND_DAYS = 15;

    /** branch_id => bool. Payroll sizes leave for a whole roster in one pass. */
    private static array $branchSwitchCache = [];

    /** Is the policy switched on for the branch this employee is posted to? */
    public static function appliesTo(?Employee $employee): bool
    {
        $branchId = $employee?->branch_id ? (int) $employee->branch_id : null;
        if (!$branchId) {
            return false;
        }
        if (!Schema::hasColumn('branches', 'sandwich_policy')) {
            return false;   // deployed code ahead of the migration
        }
        if (!array_key_exists($branchId, self::$branchSwitchCache)) {
            self::$branchSwitchCache[$branchId] = (bool) DB::table('branches')
                ->where('id', $branchId)
                ->value('sandwich_policy');
        }
        return self::$branchSwitchCache[$branchId];
    }

    /** Drop the memoised branch switches — for tests and long-running workers. */
    public static function flushCache(): void
    {
        self::$branchSwitchCache = [];
    }

    /**
     * Approved leave dates for an employee, as a Y-m-d => true lookup.
     *
     * This is the "was the employee on leave that day?" side of the rule, and
     * it must span other requests — the whole point is that Friday and Monday
     * may have been applied for separately.
     *
     * @param  int|null  $ignoreRequestId  the request being (re)sized, so it is
     *                                     not double-counted against itself
     * @return array<string,true>
     */
    public static function approvedLeaveDates(
        int $employeeId,
        Carbon $from,
        Carbon $to,
        ?int $ignoreRequestId = null,
    ): array {
        if (!Schema::hasTable('leave_requests')) {
            return [];
        }

        // No deleted_at filter: leave_requests is a hard-delete table (the model
        // does not use SoftDeletes and the column does not exist). Both
        // LeaveRequestController and PayrollService query it the same way.
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
            // Clamp to the padded window; a year-long sabbatical must not
            // expand into 365 array entries just to answer 4 lookups.
            if ($s->lt($from)) $s = $from->copy()->startOfDay();
            if ($e->gt($to))   $e = $to->copy()->startOfDay();
            for ($d = $s; $d->lte($e); $d->addDay()) {
                $dates[$d->toDateString()] = true;
            }
        }
        return $dates;
    }

    /**
     * The off-days a leave spanning [from, to] must additionally charge.
     *
     * Pure: no database, no models, no clock. Everything it needs arrives as
     * two predicates, which is what makes the rule testable in isolation and
     * reusable by both the request path and the payroll path.
     *
     * @param  callable(Carbon): bool  $isOff    weekly-off or holiday
     * @param  callable(Carbon): bool  $isLeave  on leave (this request or another approved one)
     * @return string[]  Y-m-d, ascending, no duplicates
     */
    public static function chargeableOffDays(
        Carbon $from,
        Carbon $to,
        callable $isOff,
        callable $isLeave,
    ): array {
        $start = $from->copy()->startOfDay();
        $end   = $to->copy()->startOfDay();
        $hits  = [];

        // (1) The run of off-days ending immediately BEFORE this leave.
        //     It sits wholly outside [from, to] — this is the split-request
        //     case (Friday applied separately, Monday applied separately) and
        //     this leave owns the run because it holds the day after it.
        $before = $start->copy()->subDay();
        if ($isOff($before)) {
            $runStart = self::walkBack($before, $isOff);
            if ($isLeave($runStart->copy()->subDay())) {
                self::collect($hits, $runStart, $before);
            }
        }

        // (2) Runs of off-days INSIDE the range. A run may spill past `to`
        //     (leave ending on a Friday with Sat/Sun beyond it), so it is
        //     expanded to its true extent before the flanking test, then
        //     clipped back to the range when charged — the spill-over belongs
        //     to whichever leave holds the day after it, not to this one.
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

    /** First day of the contiguous off-run that ends at $day. */
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

    /** Last day of the contiguous off-run that starts at $day. */
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

    /** @param array<string,true> $hits */
    private static function collect(array &$hits, Carbon $from, Carbon $to): void
    {
        for ($d = $from->copy(); $d->lte($to); $d->addDay()) {
            $hits[$d->toDateString()] = true;
        }
    }
}
