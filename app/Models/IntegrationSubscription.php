<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A single tracked third-party subscription / integration (Zoho Sign, Razorpay,
 * Azure, a domain, an SSL cert, an API plan…). Global — not tenant-scoped.
 *
 * The reminder engine lives in the SendSubscriptionExpiryReminders command; this
 * model just holds the data plus a couple of derived helpers it uses.
 */
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

    /** Whole days until expiry (negative once past due). */
    public function daysLeft(): int
    {
        // startOfDay on both sides so the count is by calendar day, not by the
        // wall-clock moment the command happens to run.
        return (int) now()->startOfDay()->diffInDays($this->expires_at->copy()->startOfDay(), false);
    }

    /** Convenience label mirrored by the UI badge. */
    public function computedStatus(): string
    {
        if ($this->status === 'cancelled') return 'cancelled';
        return $this->daysLeft() < 0 ? 'expired' : 'active';
    }
}
