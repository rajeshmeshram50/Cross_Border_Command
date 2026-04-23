<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class AddressTypes extends Model
{
    protected $table = 'master_address_types';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'status',
        'created_by',
    ];
}
