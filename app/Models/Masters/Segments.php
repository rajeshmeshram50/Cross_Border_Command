<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class Segments extends Model
{
    protected $table = 'master_segments';

    protected $fillable = [
        'client_id',
        'branch_id',
        'title',
        'status',
        'created_by',
    ];
}
