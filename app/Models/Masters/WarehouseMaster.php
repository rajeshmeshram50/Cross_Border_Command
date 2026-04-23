<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

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
}
