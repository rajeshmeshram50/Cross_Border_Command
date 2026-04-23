<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class RiskLevels extends Model
{
    protected $table = 'master_risk_levels';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'description',
        'action_required',
        'status',
        'created_by',
    ];
}
