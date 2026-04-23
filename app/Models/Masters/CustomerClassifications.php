<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class CustomerClassifications extends Model
{
    protected $table = 'master_customer_classifications';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'credit_limit',
        'payment_terms',
        'status',
        'created_by',
    ];
}
