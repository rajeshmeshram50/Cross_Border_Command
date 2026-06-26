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

    /** Local timezone work is measured in, and the hour at which an unclosed
     *  day is auto-checked-out. A forgotten clock-out is capped at 21:00 (9 PM)
     *  local: time worked is counted up to 9 PM and nothing after. */
    private const WORK_TZ = 'Asia/Kolkata';
    private const AUTO_CHECKOUT_HOUR = '21:00:00';

    /**
     * Sum of (out_at − in_at) over every COMPLETED in→out pair, PLUS any open
     * pair (clocked-in but never clocked-out) counted up to an automatic 9 PM
     * check-out.
     *
     * Auto check-out rule for a trailing open 'in':
     *   - boundary = 21:00 (9 PM) local on the row's own date.
     *   - For TODAY the open pair runs to min(now, 21:00) so the live timer
     *     ticks up to 9 PM and then freezes.
     *   - For any PAST day it's just 21:00 — the employee forgot to clock out,
     *     so the day is auto-closed at 9 PM (no phantom hours past 9 PM, and
     *     none of the old "13h to midnight" inflation).
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
     *  The live/open portion is added separately by callers that need it. */
    public function completedWorkedSeconds(): int
    {
        $punches = $this->relationLoaded('punches') ? $this->punches : $this->punches()->get();
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
                $total += max(0, $p->punched_at->getTimestamp() - $openInTs);
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

    /** Epoch boundary an open day is auto-closed at: 21:00 (9 PM) local on the
     *  row's date, or the current moment when that's still before 9 PM today. */
    public function autoCheckoutBoundaryTs(): int
    {
        $rowDate = $this->attendance_date instanceof \Carbon\Carbon
            ? $this->attendance_date->toDateString()
            : (string) $this->attendance_date;
        $cutoffTs   = \Carbon\Carbon::parse($rowDate . ' ' . self::AUTO_CHECKOUT_HOUR, self::WORK_TZ)->getTimestamp();
        $todayLocal = now(self::WORK_TZ)->toDateString();
        if ($rowDate === $todayLocal) {
            return min(now()->getTimestamp(), $cutoffTs);
        }
        return $cutoffTs;
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
