<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class VendorTypes extends Model
{
    protected $table = 'master_vendor_types';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'description',
        'status',
        'created_by',
    ];
}
