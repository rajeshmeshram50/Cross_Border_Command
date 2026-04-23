<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Freezers extends Model
{
    protected $table = 'master_freezers';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'warehouse',
        'capacity',
        'status',
        'created_by',
    ];
}
