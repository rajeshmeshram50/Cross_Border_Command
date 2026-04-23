<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class VendorDirectory extends Model
{
    protected $table = 'master_vendor_directory';

    protected $fillable = [
        'client_id',
        'branch_id',
        'vendor_company_name',
        'contact_person',
        'mobile_number',
        'email_id',
        'segment_id',
        'address',
        'country',
        'state',
        'city',
        'mapping_mode',
        'status',
        'created_by',
    ];
}
