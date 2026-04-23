<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Countries extends Model
{
    protected $table = 'master_countries';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'iso_code',
        'status',
        'created_by',
    ];
}
