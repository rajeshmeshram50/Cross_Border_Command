<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class DigitalTwin extends Model
{
    protected $table = 'master_digital_twin';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'status',
        'created_by',
    ];
}
