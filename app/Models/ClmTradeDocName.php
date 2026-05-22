<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ClmTradeDocName extends Model
{
    protected $fillable = [
        'client_id', 'code', 'name', 'status',
        'created_by', 'updated_by',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
}
