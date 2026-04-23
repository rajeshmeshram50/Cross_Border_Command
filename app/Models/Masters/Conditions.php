<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Conditions extends Model
{
    protected $table = 'master_conditions';

    protected $fillable = [
        'client_id',
        'branch_id',
        'title',
        'status',
        'created_by',
    ];
}
