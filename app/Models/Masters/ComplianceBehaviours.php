<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class ComplianceBehaviours extends Model
{
    protected $table = 'master_compliance_behaviours';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'action_required',
        'status',
        'created_by',
    ];
}
