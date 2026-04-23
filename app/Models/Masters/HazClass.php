<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class HazClass extends Model
{
    protected $table = 'master_haz_class';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'haz_code',
        'packing_group',
        'status',
        'created_by',
    ];
}
