<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ClmClauseLibrary extends Model
{
    protected $table = 'clm_clause_library';

    protected $fillable = [
        'client_id', 'branch_id', 'code', 'clause_type', 'name', 'party',
        'clause_status', 'content', 'status',
        'created_by', 'updated_by',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
}
