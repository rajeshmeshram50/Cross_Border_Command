<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class SourcingType extends Model
{
    protected $table = 'master_sourcing_type';

    protected $fillable = [
        'client_id',
        'branch_id',
        'type_code',
        'type_name',
        'quotation_required',
        'approval_required',
        'urgency_flag',
        'status',
        'created_by',
    ];
}
