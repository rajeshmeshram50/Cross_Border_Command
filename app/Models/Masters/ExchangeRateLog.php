<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class ExchangeRateLog extends Model
{
    protected $table = 'master_exchange_rate_log';

    protected $fillable = [
        'client_id',
        'branch_id',
        'currency_code',
        'currency_name',
        'rate_vs_inr',
        'effective_date',
        'rate_source',
        'status',
        'created_by',
    ];
}
