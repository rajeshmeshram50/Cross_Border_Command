<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class ApplicableTypes extends Model
{
    protected $table = 'master_applicable_types';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'party_type',
        'status',
        'created_by',
    ];
}
