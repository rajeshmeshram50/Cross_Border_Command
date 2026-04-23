<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class AdvancePaymentRules extends Model
{
    protected $table = 'master_advance_payment_rules';

    protected $fillable = [
        'client_id',
        'branch_id',
        'vendor_type',
        'procurement_cat',
        'max_advance_pct',
        'approval_above',
        'approver_role',
        'attachment_required',
        'status',
        'created_by',
    ];
}
