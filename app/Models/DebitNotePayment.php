<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One recovered amount against a Debit Note (see the debit_note_payments
 * migration). Always debit-note-scoped; the sum of amounts drives the debit
 * note's total_paid / balance / status.
 */
class DebitNotePayment extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'debit_note_id',
        'amount', 'bank_name', 'reference_no', 'paid_date',
        'attachment_path', 'balance_after', 'status', 'created_by',
    ];

    protected $casts = [
        'paid_date' => 'date',
        'amount' => 'decimal:2',
        'balance_after' => 'decimal:2',
    ];

    protected $appends = ['attachment_url'];

    public function debitNote(): BelongsTo { return $this->belongsTo(DebitNote::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    /** Resolved public URL for the proof-of-payment attachment. */
    public function getAttachmentUrlAttribute(): ?string
    {
        $p = $this->attachment_path;
        return $p ? file_url($p) : null;
    }
}
