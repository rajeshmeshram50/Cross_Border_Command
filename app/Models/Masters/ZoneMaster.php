<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class ZoneMaster extends Model
{
    protected $table = 'master_zone_master';

    protected $fillable = [
        'client_id',
        'branch_id',
        'zone_id',
        'zone_name',
        'zone_type',
        'warehouse',
        'purpose',
        'cold_chain',
        'hazardous',
        'status',
        'created_by',
    ];
}
