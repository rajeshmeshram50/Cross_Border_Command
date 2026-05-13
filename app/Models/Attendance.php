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

    /**
     * Sum of (out_at − in_at) over every paired punch in the day. Open pairs
     * (clocked-in but not yet out) count up to "now" ONLY when the row is
     * for today's local date so the UI can show a live-ticking total while
     * the user is still on the clock.
     *
     * For PAST rows with an unclosed in (forgotten clock-out), the accessor
     * caps the open pair at the end of that calendar day — otherwise every
     * read accumulated another full day of phantom "worked" time and a
     * 5-hour shift from a week ago reported 5d + 5h.
     *
     * Returned in SECONDS; the SPA formats to "9h 02m".
     */
    public function getTotalWorkedSecondsAttribute(): int
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
        if ($openInTs !== null) {
            // "now" boundary for the open-in pair — for today's row this is
            // the literal now(); for past rows the punch was abandoned, so
            // cap at end-of-day in the display tz to keep the value sane.
            $tz = 'Asia/Kolkata';
            $todayLocal = now($tz)->toDateString();
            $rowDate = $this->attendance_date instanceof \Carbon\Carbon
                ? $this->attendance_date->toDateString()
                : (string) $this->attendance_date;

            if ($rowDate === $todayLocal) {
                $boundaryTs = now()->getTimestamp();
            } else {
                // 23:59:59 in display-tz on the row's date.
                $boundaryTs = \Carbon\Carbon::parse($rowDate . ' 23:59:59', $tz)->getTimestamp();
            }
            $total += max(0, $boundaryTs - $openInTs);
        }
        return (int) $total;
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
