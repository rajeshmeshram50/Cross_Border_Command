<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class CustomerTypes extends Model
{
    protected $table = 'master_customer_types';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'gst_applicable',
        'status',
        'created_by',
    ];
}
