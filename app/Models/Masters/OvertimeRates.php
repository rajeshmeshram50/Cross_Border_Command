<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OvertimeRates extends Model
{
    protected $table = 'master_overtime_rates';

    protected $fillable = [
        'client_id',
        'branch_id',
        'rate_name',
        'multiplier',
        'description',
        'status',
        'created_by',
    ];

    protected $casts = [
        'multiplier' => 'decimal:2',
    ];

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
}
