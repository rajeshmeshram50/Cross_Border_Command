<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Uom extends Model
{
    protected $table = 'master_uom';

    protected $fillable = [
        'client_id',
        'branch_id',
        'title',
        'short_code',
        'unit_type',
        'status',
        'created_by',
    ];
}
