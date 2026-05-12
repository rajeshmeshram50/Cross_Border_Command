<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One row per tap on the face-attendance terminal. Multiple per day, strictly
 * alternating direction (the controller enforces in→out→in→out…). The parent
 * Attendance row holds the daily roll-up.
 */
class AttendancePunch extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'attendance_id', 'employee_id',
        'punched_at', 'direction', 'label', 'method',
        'match_distance', 'ip', 'lat', 'lng', 'notes',
    ];

    protected $casts = [
        'punched_at'     => 'datetime',
        'match_distance' => 'float',
        'lat'            => 'float',
        'lng'            => 'float',
    ];

    public function attendance(): BelongsTo
    {
        return $this->belongsTo(Attendance::class);
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
