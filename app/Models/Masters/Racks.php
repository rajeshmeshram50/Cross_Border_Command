<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Racks extends Model
{
    protected $table = 'master_racks';

    protected $fillable = [
        'client_id',
        'branch_id',
        'whType',
        'warehouse',
        'zone',
        'rackName',
        'rackType',
        'rackStatus',
        'tempClass',
        'shelves',
        'maxWeight',
        'maxVolume',
        'created_by',
    ];
}
