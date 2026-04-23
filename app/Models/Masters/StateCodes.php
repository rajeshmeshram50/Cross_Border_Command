<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class StateCodes extends Model
{
    protected $table = 'master_state_codes';

    protected $fillable = [
        'client_id',
        'branch_id',
        'state_id',
        'state_code',
        'status',
        'created_by',
    ];
}
