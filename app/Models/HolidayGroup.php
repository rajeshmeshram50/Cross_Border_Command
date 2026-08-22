<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class HolidayGroup extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id',
        'branch_id',
        'created_by',
        'updated_by',
        'code',
        'name',
        'description',
        'status',
    ];

    protected $appends = ['holidays_count', 'employees_count'];

    public function holidays(): HasMany
    {
        return $this->hasMany(Holiday::class);
    }

    /** Employees assigned this group as their holiday list. */
    public function employees(): HasMany
    {
        return $this->hasMany(Employee::class, 'holiday_group_id');
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** Number of holidays in this group — drives the count chip in the UI. */
    public function getHolidaysCountAttribute(): int
    {
        return $this->resolveCount('holidays');
    }

    /**
     * Number of employees assigned to this group. Drives the "in use" lock:
     * when > 0 the group (and its holidays) can no longer be edited/deleted,
     * because doing so would silently rewrite the calendar those employees
     * depend on (and that payroll credits against).
     */
    public function getEmployeesCountAttribute(): int
    {
        return $this->resolveCount('employees');
    }
    private function resolveCount(string $relation): int
    {
        $key = $relation . '_count';
        if (array_key_exists($key, $this->attributes)) return (int) $this->attributes[$key];
        if ($this->relationLoaded($relation)) return $this->{$relation}->count();
        return $this->{$relation}()->count();
    }
}
