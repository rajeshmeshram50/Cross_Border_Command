<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class ProcurementCategory extends Model
{
    protected $table = 'master_procurement_category';

    protected $fillable = [
        'client_id',
        'branch_id',
        'cat_code',
        'cat_name',
        'match_logic',
        'grn_required',
        'gst_applicable',
        'status',
        'created_by',
    ];
}
