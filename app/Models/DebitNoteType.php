<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class DebitNoteType extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'name', 'status', 'created_by', 'updated_by',
    ];
}
