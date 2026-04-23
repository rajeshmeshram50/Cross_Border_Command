<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Departments extends Model
{
    protected $table = 'master_departments';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'description',
        'status',
        'created_by',
    ];
}
