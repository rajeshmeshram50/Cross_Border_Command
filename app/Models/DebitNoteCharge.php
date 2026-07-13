<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DebitNoteCharge extends Model
{
    protected $fillable = [
        'debit_note_id', 'type', 'amount', 'note', 'line_no',
    ];

    public function debitNote(): BelongsTo { return $this->belongsTo(DebitNote::class); }
}
