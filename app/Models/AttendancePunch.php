<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class AttendancePunch extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'attendance_id', 'employee_id',
        'punched_at', 'direction', 'label', 'method',
        'match_distance', 'ip', 'lat', 'lng', 'notes',
        'device_serial', 'device_user_id', 'raw_status',
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
        return $this->belongsTo(Employee::class)->withTrashed();
    }
}
