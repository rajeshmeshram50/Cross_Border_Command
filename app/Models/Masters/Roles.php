<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Roles extends Model
{
    protected $table = 'master_roles';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'status',
        'created_by',
    ];
}
