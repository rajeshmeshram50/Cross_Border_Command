<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class ApprovalAuthority extends Model
{
    protected $table = 'master_approval_authority';

    protected $fillable = [
        'client_id',
        'branch_id',
        'role_name',
        'module_scope',
        'min_value',
        'max_value',
        'currency',
        'escalate_to',
        'status',
        'created_by',
    ];
}
