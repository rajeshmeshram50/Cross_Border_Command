<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class PackagingMaterial extends Model
{
    protected $table = 'master_packaging_material';

    protected $fillable = [
        'client_id',
        'branch_id',
        'title',
        'material_type',
        'status',
        'created_by',
    ];
}
