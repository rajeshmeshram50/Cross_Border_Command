<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Currencies extends Model
{
    protected $table = 'master_currencies';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'code',
        'symbol',
        'exchange_rate',
        'status',
        'created_by',
    ];
}
