<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class NumberingSeries extends Model
{
    protected $table = 'master_numbering_series';

    protected $fillable = [
        'client_id',
        'branch_id',
        'module',
        'prefix',
        'fy_format',
        'next_number',
        'is_locked',
        'status',
        'created_by',
    ];
}
