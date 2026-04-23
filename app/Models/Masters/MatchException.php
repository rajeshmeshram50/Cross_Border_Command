<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class MatchException extends Model
{
    protected $table = 'master_match_exception';

    protected $fillable = [
        'client_id',
        'branch_id',
        'exc_code',
        'exc_name',
        'tolerance_pct',
        'blocks_payment',
        'resolver_role',
        'status',
        'created_by',
    ];
}
