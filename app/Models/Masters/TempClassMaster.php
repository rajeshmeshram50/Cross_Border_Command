<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

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
}
