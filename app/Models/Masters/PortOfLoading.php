<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class PortOfLoading extends Model
{
    protected $table = 'master_port_of_loading';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'code',
        'address',
        'status',
        'created_by',
    ];
}
