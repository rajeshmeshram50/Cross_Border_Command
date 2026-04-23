<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Assets extends Model
{
    protected $table = 'master_assets';

    protected $fillable = [
        'client_id',
        'branch_id',
        'asset_name',
        'asset_number',
        'asset_type_id',
        'assign_date',
        'status',
        'created_by',
    ];
}
