<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Company extends Model
{
    protected $table = 'master_company';

    protected $fillable = [
        'client_id',
        'branch_id',
        'company_name',
        'short_code',
        'gstin',
        'pan',
        'cin',
        'iec',
        'email',
        'mobile',
        'city',
        'state',
        'address',
        'status',
        'created_by',
    ];
}
