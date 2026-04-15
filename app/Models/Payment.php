<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payment extends Model
{
    protected $fillable = [
        'client_id',
        'plan_id',
        'txn_id',
        'order_id',
        'amount',
        'gst',
        'discount',
        'total',
        'currency',
        'method',
        'card_info',
        'gateway',
        'billing_cycle',
        'valid_from',
        'valid_until',
        'auto_renew',
        'status',
        'refund_amount',
        'refund_reason',
        'refunded_at',
        'invoice_number',
        'invoice_path',
        'gateway_response',
        'notes',
        'processed_by',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'gst' => 'decimal:2',
            'discount' => 'decimal:2',
            'total' => 'decimal:2',
            'refund_amount' => 'decimal:2',
            'valid_from' => 'date',
            'valid_until' => 'date',
            'refunded_at' => 'datetime',
            'auto_renew' => 'boolean',
            'gateway_response' => 'array',
        ];
    }

    // ── Relationships ──

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }

    public function processedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'processed_by');
    }

    // ── Helpers ──

    public function isSuccess(): bool
    {
        return $this->status === 'success';
    }

    public function isExpired(): bool
    {
        return $this->valid_until && $this->valid_until->isPast();
    }
}
