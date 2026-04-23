<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class DeviationReason extends Model
{
    protected $table = 'master_deviation_reason';

    protected $fillable = [
        'client_id',
        'branch_id',
        'reason_code',
        'reason_name',
        'module',
        'attachment_required',
        'requires_approval',
        'status',
        'created_by',
    ];
}
