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
        // Shift as it stood on the day this row was worked. (#216)
        'shift_name', 'shift_start', 'shift_end',
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

    /**
     * withTrashed() — attendance outlives employment. (#91)
     *
     * Completing an exit soft-deletes the employee row, and Employee applies
     * the SoftDeletes global scope to this relation too, so a leaver's
     * attendance came back with a NULL employee: the rows were all still
     * there, queried by employee_id and never touched by the soft delete, but
     * every list that renders a name got nothing to render. That is the
     * "records cannot be accessed from Attendance" half of the ticket — the
     * history was not missing, it was unattributed.
     *
     * Auditing a leaver's attendance is the whole point of keeping it, so the
     * relation must reach a trashed employee. Callers that want to EXCLUDE
     * leavers filter on the employment window (see dailyView), which is a
     * different question from whether the name resolves.
     */
    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class)->withTrashed();
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
    /** Public so callers outside the model can ask "what is today, locally?"
     *  against the same clock attendance is recorded on. (#216) */
    public const WORK_TZ = 'Asia/Kolkata';
    /**
     * Minutes after shift start that still count as ON TIME.
     *
     * One number, read by everything that has an opinion about lateness: the
     * roster's Present→Late promotion, the attendance log, the payroll
     * late-mark run that feeds the BR-01 half-day LOP, and the detail panel's
     * "Xm late" caption. It used to be the literal 10 written out in four
     * places plus a fifth copy in the React constants, which is how the detail
     * panel came to call a 7-minute arrival late while the list, the log and
     * the payslip all called it on time (#22). Changing the policy is changing
     * this line.
     */
    public const LATE_GRACE_MINUTES = 10;

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

    /**
     * ["HH:MM" start, "HH:MM" end] that applied ON THIS DAY, or [null, null].
     *
     * The stamped window wins. It is written when the day's first punch creates
     * the row, so it records the shift the employee was actually on, not the one
     * they are on now. Resolving from the employee — which is all this did —
     * meant a shift change rewrote history: reassign someone from General to
     * Night and every past day was suddenly judged against 21:00, turning
     * on-time days into late ones months after the fact. It also let a shift
     * assigned this afternoon govern a day already worked and punched out of.
     *
     * Rows written before the columns existed have no stamp, so they fall back
     * to the old resolution rather than to a guess. (#216)
     */
    public function shiftWindow(): array
    {
        $start = trim((string) ($this->shift_start ?? ''));
        if ($start !== '') {
            return [$start, trim((string) ($this->shift_end ?? '')) ?: null];
        }

        /* A stamped NAME with no times still beats the employee's current
         * shift. (#216)
         *
         * shift_name is written from the employee's shift at punch time, but
         * shift_start comes from resolveShiftWindow(), which returns null when
         * the branch has no definition for that name yet — 8,627 rows here are
         * in exactly that state. Falling straight through to the employee meant
         * those days were judged against whatever shift the employee holds
         * TODAY, which is the history-rewriting this ticket reports, just by a
         * narrower door than the one already closed.
         *
         * Resolve the times for the STAMPED name instead: the row knows which
         * shift it was worked under, so a definition added or corrected later
         * applies to it, while a REASSIGNMENT does not. */
        $name = trim((string) ($this->shift_name ?? ''));
        if ($name !== '') {
            $emp = $this->rowEmployee();
            $branch = $emp?->relationLoaded('branch') ? $emp->getRelation('branch') : null;
            if ($emp && (!$branch || !array_key_exists('shifts', $branch->getAttributes()))) {
                $branch = $emp->branch()->first();
            }
            foreach ((array) ($branch->shifts ?? []) as $s) {
                if (strcasecmp(trim((string) ($s['name'] ?? '')), $name) !== 0) continue;
                $from = self::hhmmOrNull($s['start'] ?? '');
                if ($from) return [$from, self::hhmmOrNull($s['end'] ?? '')];
            }
            /* Named but unresolvable — the day was worked under a shift whose
             * definition is gone. No window is the honest answer; the
             * employee's current one would be a fabrication. */
            return [null, null];
        }

        $emp = $this->rowEmployee();
        return $emp ? $emp->resolveShiftWindow() : [null, null];
    }

    /** The shift NAME this day was worked under — the stamp, else the
     *  employee's current one for rows written before the stamp existed. */
    public function shiftNameForDay(): ?string
    {
        $name = trim((string) ($this->shift_name ?? ''));
        if ($name !== '') return $name;
        $emp = $this->rowEmployee();
        return $emp ? (trim((string) ($emp->shift ?? '')) ?: null) : null;
    }

    /** "9:30" out of "9:30 AM", "09:30-18:30" or a bare value — the same
     *  normalisation Employee::hhmm() applies, so a stamped name resolves to
     *  the identical window the employee would have produced. */
    private static function hhmmOrNull($v): ?string
    {
        return preg_match('/(\d{1,2}:\d{2})/', (string) $v, $m) ? $m[1] : null;
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
