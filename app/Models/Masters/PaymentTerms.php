<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class PaymentTerms extends Model
{
    protected $table = 'master_payment_terms';

    protected $fillable = [
        'client_id',
        'branch_id',
        'term_code',
        'term_name',
        'credit_days',
        'advance_pct',
        'payment_type',
        'milestone_desc',
        'status',
        'created_by',
    ];
}
