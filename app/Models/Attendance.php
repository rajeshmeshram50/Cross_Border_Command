<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Daily attendance row — one per (employee, date). Holds first-in / last-out
 * as a denormalised summary so list queries stay cheap; the actual punch
 * timeline lives in the `attendance_punches` child table.
 *
 * `total_worked_seconds` and `next_direction` accessors are appended to JSON
 * so the SPA can render the timeline without re-deriving anything client-side.
 */
class Attendance extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'employee_id', 'user_id',
        'attendance_date',
        'check_in_at', 'check_out_at',
        'check_in_method', 'check_out_method',
        'check_in_match_distance', 'check_out_match_distance',
        'check_in_ip', 'check_out_ip',
        'check_in_lat', 'check_in_lng', 'check_out_lat', 'check_out_lng',
        'status', 'notes',
    ];

    protected $casts = [
        'attendance_date'           => 'date',
        'check_in_at'               => 'datetime',
        'check_out_at'              => 'datetime',
        'check_in_match_distance'   => 'float',
        'check_out_match_distance'  => 'float',
        'check_in_lat'              => 'float',
        'check_in_lng'              => 'float',
        'check_out_lat'             => 'float',
        'check_out_lng'             => 'float',
    ];

    protected $appends = ['total_worked_seconds', 'next_direction', 'punches_count'];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function punches(): HasMany
    {
        return $this->hasMany(AttendancePunch::class)->orderBy('punched_at');
    }

    /** Local timezone work is measured in. */
    private const WORK_TZ = 'Asia/Kolkata';
    /** Grace after the employee's shift ends before an unclosed day is
     *  auto-checked-out. A morning shift of 08:00–14:00 auto-closes at 15:00. */
    private const AUTO_CHECKOUT_GRACE_MINUTES = 60;
    /** Fallback cut-off for an employee with no resolvable shift window (no
     *  shift assigned, or a name that matches nothing in the branch's Shift
     *  Details). Keeps the old fixed 9 PM behaviour for those rows. */
    private const AUTO_CHECKOUT_HOUR = '21:00:00';
    /** Office default window used on the OVERTIME path when the employee's
     *  shift carries no parseable timing — mirrors AttendanceController and
     *  PayrollService so the shift end overtime is measured from is the same
     *  18:30 everywhere. (The non-OT path keeps its own 21:00 fallback above.) */
    private const DEFAULT_SHIFT_START = '09:30';
    private const DEFAULT_SHIFT_END   = '18:30';

    /**
     * Sum of (out_at − in_at) over every COMPLETED in→out pair, PLUS any open
     * pair (clocked-in but never clocked-out) counted up to an automatic
     * check-out one hour after the employee's shift ends.
     *
     * Auto check-out rule for a trailing open 'in':
     *   - boundary = shift end + 1h local on the row's own date (21:00 when the
     *     employee has no resolvable shift).
     *   - For TODAY the open pair runs to min(now, boundary) so the live timer
     *     ticks up to the auto-checkout and then freezes.
     *   - For any PAST day it's just the boundary — the employee forgot to
     *     clock out, so the day is auto-closed there (no phantom hours after,
     *     and none of the old "13h to midnight" inflation).
     *   - EXCEPT when the employee is overtime-applicable: there is no
     *     auto-checkout for them, so the open pair keeps running (that's the
     *     overtime accruing) until the next shift starts. Reaching the next
     *     shift start with the day still open forfeits the overtime and the
     *     day falls back to the shift end. See autoCheckoutBoundaryTs().
     *
     * Returned in SECONDS; the SPA formats to "9h 02m".
     */
    public function getTotalWorkedSecondsAttribute(): int
    {
        $total = $this->completedWorkedSeconds();
        $openInTs = $this->openInTimestamp();
        if ($openInTs !== null) {
            $total += max(0, $this->autoCheckoutBoundaryTs() - $openInTs);
        }
        return (int) $total;
    }

    /** Seconds from COMPLETED in→out pairs only — request-time-independent.
     *  The live/open portion is added separately by callers that need it.
     *
     *  A pair whose out-punch lands at or after the employee's NEXT shift start
     *  is a forgotten check-out, not a 25-hour day: it's closed at the shift
     *  end, the same place an unclosed day lands (and the same rule that voids
     *  that day's overtime). A punch-out any time before the next shift start
     *  is taken at face value — including a genuine late/overnight one. */
    public function completedWorkedSeconds(): int
    {
        $punches = $this->relationLoaded('punches') ? $this->punches : $this->punches()->get();
        $rowDate = $this->rowDateString();
        $nextShiftTs = $this->nextShiftStartTs($rowDate);
        $shiftEndTs  = $this->shiftEndTs($rowDate);
        $total = 0;
        $openInTs = null;
        // Use raw UNIX timestamps for the delta — Carbon 3's diffInSeconds
        // is SIGNED ($a->diffInSeconds($b) returns $b - $a), so the obvious
        // `$out->diffInSeconds($in)` flips negative. Working in epoch seconds
        // sidesteps that gotcha entirely.
        foreach ($punches as $p) {
            if ($p->direction === 'in') {
                $openInTs = $p->punched_at->getTimestamp();
            } elseif ($openInTs !== null) {
                $outTs = $p->punched_at->getTimestamp();
                if ($outTs >= $nextShiftTs) {
                    $outTs = $shiftEndTs;
                }
                $total += max(0, $outTs - $openInTs);
                $openInTs = null;
            }
        }
        return (int) $total;
    }

    /** Epoch timestamp of a trailing OPEN 'in' (clocked-in, not yet out), or
     *  null when the day is fully paired. Relies on the strict in/out punch
     *  alternation the controller enforces, so the last punch being 'in' means
     *  the day is open. */
    public function openInTimestamp(): ?int
    {
        $punches = $this->relationLoaded('punches') ? $this->punches : $this->punches()->get();
        $last = $punches->last();
        if ($last && $last->direction === 'in' && $last->punched_at) {
            return $last->punched_at->getTimestamp();
        }
        return null;
    }

    /**
     * Epoch boundary an open day (clocked-in, never clocked-out) is counted to.
     *
     * - Still before the cut-off → the current moment, so the day ticks live.
     * - Cut-off passed, overtime NOT applicable → the cut-off (shift end + 1h).
     * - Cut-off passed, overtime applicable → the SHIFT END. The employee ran
     *   past their shift and then never punched out before the next shift
     *   started, so the overtime is forfeited (business rule) and the day is
     *   worth its shift hours, nothing more.
     */
    public function autoCheckoutBoundaryTs(): int
    {
        $rowDate  = $this->rowDateString();
        $cutoffTs = $this->autoCheckoutCutoffTs($rowDate);
        $nowTs    = now()->getTimestamp();

        if ($nowTs < $cutoffTs) {
            return $nowTs;
        }
        return $this->overtimeApplicable() ? $this->shiftEndTs($rowDate) : $cutoffTs;
    }

    /**
     * Cut-off instant an open punch stops accruing at on $rowDate.
     *
     * Overtime NOT applicable — shift end + AUTO_CHECKOUT_GRACE_MINUTES. An
     * employee who forgets to clock out shouldn't accrue hours to a blanket
     * 9 PM: an 08:00–14:00 morning shift closes at 15:00, a 12:00–20:00 shift
     * at 21:00. A shift whose end is at or before its start crosses midnight
     * (e.g. 20:00–04:00), so the end lands on the FOLLOWING day before the
     * grace is added.
     *
     * Overtime APPLICABLE — there is no auto-logout at all. Time past the shift
     * end IS the overtime, so the day stays open right up to the employee's
     * NEXT shift start (same shift time, next day). Reaching that without a
     * punch-out means the day is never closed properly and the overtime drops
     * (see autoCheckoutBoundaryTs / overtimeSecondsForDay).
     */
    public function autoCheckoutCutoffTs(string $rowDate): int
    {
        if ($this->overtimeApplicable()) {
            return $this->nextShiftStartTs($rowDate);
        }

        [, $end] = $this->shiftWindow();

        if ($end) {
            return \Carbon\Carbon::createFromTimestamp($this->shiftEndTs($rowDate), self::WORK_TZ)
                ->addMinutes(self::AUTO_CHECKOUT_GRACE_MINUTES)
                ->getTimestamp();
        }

        return \Carbon\Carbon::parse($rowDate . ' ' . self::AUTO_CHECKOUT_HOUR, self::WORK_TZ)->getTimestamp();
    }

    /**
     * Overtime SECONDS credited for this row's date — time on the clock past
     * the shift end, for employees the employee master marks overtime-applicable.
     *
     * Rules (mirrored by PayrollService::overtimeHoursFromAttendance):
     *  - Overtime not applicable → always 0.
     *  - Overtime starts the moment the shift ENDS, regardless of how late the
     *    employee arrived — a late arrival doesn't push the overtime start out.
     *  - Still clocked in → live/provisional: counted up to now. It is NOT
     *    banked; failing to punch out before the next shift starts drops it.
     *  - Punched out → punch-out minus shift end, but only when that punch-out
     *    landed BEFORE the next shift start.
     */
    public function overtimeSecondsForDay(): int
    {
        if (!$this->overtimeApplicable()) {
            return 0;
        }

        $rowDate    = $this->rowDateString();
        $shiftEndTs = $this->shiftEndTs($rowDate);
        $cutoffTs   = $this->autoCheckoutCutoffTs($rowDate);   // next shift start
        $openInTs   = $this->openInTimestamp();

        if ($openInTs !== null) {
            $nowTs = now()->getTimestamp();
            if ($nowTs >= $cutoffTs) {
                return 0;   // never punched out before the next shift — forfeited
            }
            return (int) max(0, $nowTs - max($shiftEndTs, $openInTs));
        }

        $punches = $this->relationLoaded('punches') ? $this->punches : $this->punches()->get();
        $lastOut = $punches->last(fn ($p) => $p->direction === 'out' && $p->punched_at);
        if (!$lastOut) {
            return 0;
        }
        $outTs = $lastOut->punched_at->getTimestamp();
        if ($outTs >= $cutoffTs) {
            return 0;   // punched out only after the next shift had started
        }
        return (int) max(0, $outTs - $shiftEndTs);
    }

    /** Does the employee behind this row have overtime turned on? */
    public function overtimeApplicable(): bool
    {
        return (bool) $this->rowEmployee()?->overtimeApplicable();
    }

    /** Epoch instant this row's shift ENDS — the moment overtime starts.
     *  An end at/before the start means the shift crosses midnight, so it lands
     *  on the following day. Falls back to the 18:30 office default. */
    public function shiftEndTs(string $rowDate): int
    {
        [$start, $end] = $this->shiftWindow();
        $endC = \Carbon\Carbon::parse($rowDate . ' ' . ($end ?: self::DEFAULT_SHIFT_END), self::WORK_TZ);
        if ($start) {
            $startC = \Carbon\Carbon::parse($rowDate . ' ' . $start, self::WORK_TZ);
            if ($endC->lessThanOrEqualTo($startC)) {
                $endC->addDay();   // overnight shift — ends the next morning
            }
        }
        return $endC->getTimestamp();
    }

    /** Epoch instant the employee's NEXT shift starts after $rowDate — the
     *  deadline for punching out. Same shift time, one day on. Falls back to
     *  the 09:30 office default. */
    public function nextShiftStartTs(string $rowDate): int
    {
        [$start] = $this->shiftWindow();
        return \Carbon\Carbon::parse($rowDate . ' ' . ($start ?: self::DEFAULT_SHIFT_START), self::WORK_TZ)
            ->addDay()
            ->getTimestamp();
    }

    /** ["HH:MM" start, "HH:MM" end] for this row's employee, or [null, null]. */
    private function shiftWindow(): array
    {
        $emp = $this->rowEmployee();
        return $emp ? $emp->resolveShiftWindow() : [null, null];
    }

    /** The row's employee, preferring an already-loaded relation (list
     *  endpoints setRelation() it to avoid an N+1). A lazy load is cached onto
     *  the relation, so the several helpers that need it on one row — shift
     *  window, overtime flag, cut-off — cost at most one query between them. */
    private function rowEmployee(): ?Employee
    {
        if (!$this->relationLoaded('employee')) {
            $this->setRelation('employee', $this->employee()->first());
        }
        return $this->getRelation('employee');
    }

    /** This row's attendance_date as "Y-m-d". */
    private function rowDateString(): string
    {
        return $this->attendance_date instanceof \Carbon\Carbon
            ? $this->attendance_date->toDateString()
            : substr((string) $this->attendance_date, 0, 10);
    }

    /**
     * Which direction the NEXT tap should record. 'in' when the day has no
     * punches yet OR the last punch was 'out'; 'out' when the last punch was
     * 'in'. The SPA uses this to decide whether to show "Clock In" or
     * "Clock Out" on the action button.
     */
    public function getNextDirectionAttribute(): string
    {
        $last = $this->relationLoaded('punches')
            ? $this->punches->last()
            : $this->punches()->orderByDesc('punched_at')->first();
        if (!$last) return 'in';
        return $last->direction === 'in' ? 'out' : 'in';
    }

    public function getPunchesCountAttribute(): int
    {
        return $this->relationLoaded('punches') ? $this->punches->count() : $this->punches()->count();
    }
}
