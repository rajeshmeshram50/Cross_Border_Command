<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class BankAccounts extends Model
{
    protected $table = 'master_bank_accounts';

    protected $fillable = [
        'client_id',
        'branch_id',
        'bank_name',
        'account_holder',
        'account_number',
        'ifsc_code',
        'branch_name',
        'city',
        'swift_code',
        'ad_code',
        'is_primary',
        'status',
        'created_by',
    ];
}
