<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class GoodsServiceFlag extends Model
{
    protected $table = 'master_goods_service_flag';

    protected $fillable = [
        'client_id',
        'branch_id',
        'flag_code',
        'flag_name',
        'grn_screen',
        'evidence_type',
        'status',
        'created_by',
    ];
}
