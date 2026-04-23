<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WarehouseMaster extends Model
{
    protected $table = 'master_warehouse_master';

    protected $fillable = [
        'client_id',
        'branch_id',
        'wh_id',
        'wh_name',
        'wh_type',
        'city',
        'state',
        'pincode',
        'contact_person',
        'contact_phone',
        'area_sqft',
        'address',
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
