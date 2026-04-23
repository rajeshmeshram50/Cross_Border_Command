<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Designations extends Model
{
    protected $table = 'master_designations';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'description',
        'status',
        'created_by',
    ];
}
