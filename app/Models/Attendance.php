<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

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

    public const WORK_TZ = 'Asia/Kolkata';
    public const LATE_GRACE_MINUTES = 0;

    private const AUTO_CHECKOUT_GRACE_MINUTES = 60;
    private const AUTO_CHECKOUT_HOUR = '21:00:00';
    private const DEFAULT_SHIFT_START = '09:30';
    private const DEFAULT_SHIFT_END   = '18:30';

    public function getTotalWorkedSecondsAttribute(): int
    {
        $total = $this->completedWorkedSeconds();
        $openInTs = $this->openInTimestamp();
        if ($openInTs !== null) {
            $total += max(0, $this->autoCheckoutBoundaryTs() - $openInTs);
        }
        return (int) $total;
    }

    public function completedWorkedSeconds(): int
    {
        $punches = $this->relationLoaded('punches') ? $this->punches : $this->punches()->get();
        $rowDate = $this->rowDateString();
        $nextShiftTs = $this->nextShiftStartTs($rowDate);
        $shiftEndTs  = $this->shiftEndTs($rowDate);
        $total = 0;
        $openInTs = null;
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

    public function openInTimestamp(): ?int
    {
        $punches = $this->relationLoaded('punches') ? $this->punches : $this->punches()->get();
        $last = $punches->last();
        if ($last && $last->direction === 'in' && $last->punched_at) {
            return $last->punched_at->getTimestamp();
        }
        return null;
    }

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

    public function overtimeSecondsForDay(): int
    {
        if (!$this->overtimeApplicable()) {
            return 0;
        }

        $rowDate    = $this->rowDateString();
        $shiftEndTs = $this->shiftEndTs($rowDate);
        $cutoffTs   = $this->autoCheckoutCutoffTs($rowDate);
        $openInTs   = $this->openInTimestamp();

        if ($openInTs !== null) {
            $nowTs = now()->getTimestamp();
            if ($nowTs >= $cutoffTs) {
                return 0;
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
            return 0;
        }
        return (int) max(0, $outTs - $shiftEndTs);
    }

    public function overtimeApplicable(): bool
    {
        return (bool) $this->rowEmployee()?->overtimeApplicable();
    }

    public function shiftEndTs(string $rowDate): int
    {
        [$start, $end] = $this->shiftWindow();
        $endC = \Carbon\Carbon::parse($rowDate . ' ' . ($end ?: self::DEFAULT_SHIFT_END), self::WORK_TZ);
        if ($start) {
            $startC = \Carbon\Carbon::parse($rowDate . ' ' . $start, self::WORK_TZ);
            if ($endC->lessThanOrEqualTo($startC)) {
                $endC->addDay();
            }
        }
        return $endC->getTimestamp();
    }

    public function nextShiftStartTs(string $rowDate): int
    {
        [$start] = $this->shiftWindow();
        return \Carbon\Carbon::parse($rowDate . ' ' . ($start ?: self::DEFAULT_SHIFT_START), self::WORK_TZ)
            ->addDay()
            ->getTimestamp();
    }

    public function shiftWindow(): array
    {
        $start = trim((string) ($this->shift_start ?? ''));
        if ($start !== '') {
            return [$start, trim((string) ($this->shift_end ?? '')) ?: null];
        }

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
            return [null, null];
        }

        $emp = $this->rowEmployee();
        return $emp ? $emp->resolveShiftWindow() : [null, null];
    }

    public function shiftNameForDay(): ?string
    {
        $name = trim((string) ($this->shift_name ?? ''));
        if ($name !== '') return $name;
        $emp = $this->rowEmployee();
        return $emp ? (trim((string) ($emp->shift ?? '')) ?: null) : null;
    }

    private static function hhmmOrNull($v): ?string
    {
        return preg_match('/(\d{1,2}:\d{2})/', (string) $v, $m) ? $m[1] : null;
    }

    private function rowEmployee(): ?Employee
    {
        if (!$this->relationLoaded('employee')) {
            $this->setRelation('employee', $this->employee()->first());
        }
        return $this->getRelation('employee');
    }

    private function rowDateString(): string
    {
        return $this->attendance_date instanceof \Carbon\Carbon
            ? $this->attendance_date->toDateString()
            : substr((string) $this->attendance_date, 0, 10);
    }

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
