<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
