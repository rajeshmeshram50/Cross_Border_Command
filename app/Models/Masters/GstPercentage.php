<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class GstPercentage extends Model
{
    protected $table = 'master_gst_percentage';

    protected $fillable = [
        'client_id',
        'branch_id',
        'percentage',
        'label',
        'status',
        'created_by',
    ];
}
