<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Incoterms extends Model
{
    protected $table = 'master_incoterms';

    protected $fillable = [
        'client_id',
        'branch_id',
        'code',
        'full_name',
        'transport_mode',
        'status',
        'created_by',
    ];
}
