<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DebitNoteItem extends Model
{
    protected $fillable = [
        'debit_note_id', 'product_id', 'product_code', 'product_name', 'hsn_code',
        'qty_po', 'qty_spi', 'debit_qty', 'rate',
        'gst_pct', 'cgst_pct', 'sgst_pct', 'igst_pct',
        'cgst_amount', 'sgst_amount', 'igst_amount', 'cost', 'line_no',
    ];

    public function debitNote(): BelongsTo { return $this->belongsTo(DebitNote::class); }
}
