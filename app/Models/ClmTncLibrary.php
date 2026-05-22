<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ClmTncLibrary extends Model
{
    protected $table = 'clm_tnc_library';

    protected $fillable = [
        'client_id', 'code', 'segment', 'category', 'party', 'content', 'status',
        'created_by', 'updated_by',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
}
