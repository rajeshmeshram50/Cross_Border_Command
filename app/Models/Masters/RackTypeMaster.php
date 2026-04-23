<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class RackTypeMaster extends Model
{
    protected $table = 'master_rack_type_master';

    protected $fillable = [
        'client_id',
        'branch_id',
        'type_code',
        'type_name',
        'description',
        'suitable_for',
        'max_load_per_shelf',
        'typical_shelves',
        'status',
        'created_by',
    ];
}
