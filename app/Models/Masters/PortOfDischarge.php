<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class PortOfDischarge extends Model
{
    protected $table = 'master_port_of_discharge';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'code',
        'country_id',
        'city',
        'status',
        'created_by',
    ];
}
