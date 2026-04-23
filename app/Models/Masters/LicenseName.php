<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class LicenseName extends Model
{
    protected $table = 'master_license_name';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'license_code',
        'issuing_authority',
        'validity_months',
        'status',
        'created_by',
    ];
}
