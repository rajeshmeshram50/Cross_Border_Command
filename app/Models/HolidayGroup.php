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
        'client_id', 'branch_id', 'created_by', 'updated_by',
        'code', 'name', 'description', 'status',
    ];

    protected $appends = ['holidays_count'];

    public function holidays(): HasMany
    {
        return $this->hasMany(Holiday::class);
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
        return $this->holidays()->count();
    }
}
