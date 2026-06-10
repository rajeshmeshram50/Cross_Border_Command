<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Holiday extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'holiday_group_id', 'created_by', 'updated_by',
        'code',
        'name', 'date', 'type', 'is_recurring', 'description',
    ];

    protected $casts = [
        // Y-m-d so the API always emits a clean date the <input type="date">
        // and the frontend formatDate() can consume without a time component.
        'date'         => 'date:Y-m-d',
        'is_recurring' => 'boolean',
    ];

    public function group(): BelongsTo
    {
        return $this->belongsTo(HolidayGroup::class, 'holiday_group_id');
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

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
