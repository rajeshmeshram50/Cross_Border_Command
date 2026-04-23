<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class HsnCodes extends Model
{
    protected $table = 'master_hsn_codes';

    protected $fillable = [
        'client_id',
        'branch_id',
        'hsn_code',
        'description',
        'gst_rate',
        'status',
        'created_by',
    ];
}
