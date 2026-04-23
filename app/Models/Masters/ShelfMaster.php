<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class ShelfMaster extends Model
{
    protected $table = 'master_shelf_master';

    protected $fillable = [
        'client_id',
        'branch_id',
        'rack_ref',
        'shelf_name',
        'level_no',
        'shelf_type',
        'max_weight',
        'status',
        'created_by',
    ];
}
