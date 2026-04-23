<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;

class DocumentType extends Model
{
    protected $table = 'master_document_type';

    protected $fillable = [
        'client_id',
        'branch_id',
        'title',
        'applicable_to',
        'is_mandatory',
        'status',
        'created_by',
    ];
}
