<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class IntegrationSubscription extends Model
{
    protected $fillable = [
        'name', 'provider', 'category',
        'owner_name', 'owner_email',
        'expires_at', 'reminder_days',
        'auto_renew', 'status',
        'amount', 'currency', 'notes',
        'reminders_sent', 'last_reminded_on',
        'created_by',
    ];

    protected $casts = [
        'expires_at'       => 'date',
        'last_reminded_on' => 'date',
        'reminder_days'    => 'array',
        'reminders_sent'   => 'array',
        'auto_renew'       => 'boolean',
        'amount'           => 'decimal:2',
    ];

    public function daysLeft(): int
    {
        return (int) now()->startOfDay()->diffInDays($this->expires_at->copy()->startOfDay(), false);
    }

    public function computedStatus(): string
    {
        if ($this->status === 'cancelled') return 'cancelled';
        return $this->daysLeft() < 0 ? 'expired' : 'active';
    }
}
