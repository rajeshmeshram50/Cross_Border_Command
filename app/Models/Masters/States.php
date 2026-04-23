<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class States extends Model
{
    protected $table = 'master_states';

    protected $fillable = [
        'client_id',
        'branch_id',
        'country_id',
        'name',
        'status',
        'created_by',
    ];
}
