<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class AssetCategories extends Model
{
    protected $table = 'master_asset_categories';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'depreciation_rate',
        'useful_life_years',
        'status',
        'created_by',
    ];
}
