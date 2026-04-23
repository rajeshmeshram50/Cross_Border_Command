<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TempClassMaster extends Model
{
    protected $table = 'master_temp_class_master';

    protected $fillable = [
        'client_id',
        'branch_id',
        'class_code',
        'class_name',
        'temp_range_min',
        'temp_range_max',
        'description',
        'requires_monitoring',
        'alert_threshold',
        'suitable_products',
        'status',
        'created_by',
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
