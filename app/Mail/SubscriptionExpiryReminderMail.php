<?php

namespace App\Mail;

use App\Models\IntegrationSubscription;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * "Your <service> subscription renews in N days" reminder, sent to the service
 * owner by the SendSubscriptionExpiryReminders command. Queued so a slow SMTP
 * round trip never blocks the scheduled run.
 */
class SubscriptionExpiryReminderMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public string $serviceName;
    public string $provider;
    public string $ownerName;
    public string $expiresOn;      // formatted date
    public int    $daysLeft;
    public bool   $expired;
    public ?string $amount;        // formatted "INR 12,000" or null
    public string $notes;
    public string $appName;

    public function __construct(IntegrationSubscription $sub, int $daysLeft)
    {
        $this->serviceName = $sub->name;
        $this->provider    = $sub->provider ?: '';
        $this->ownerName   = $sub->owner_name ?: 'there';
        $this->expiresOn   = $sub->expires_at->format('d M Y');
        $this->daysLeft    = $daysLeft;
        $this->expired     = $daysLeft < 0;
        $this->amount      = $sub->amount !== null ? trim(($sub->currency ?: 'INR') . ' ' . number_format((float) $sub->amount, 2)) : null;
        $this->notes       = $sub->notes ?: '';
        $this->appName     = config('mail.from.name', 'Cross Border Command');
    }

    public function envelope(): Envelope
    {
        $subject = $this->expired
            ? "Action needed: {$this->serviceName} has expired"
            : ($this->daysLeft === 0
                ? "Today: {$this->serviceName} subscription expires"
                : "Reminder: {$this->serviceName} renews in {$this->daysLeft} day" . ($this->daysLeft === 1 ? '' : 's'));

        return new Envelope(subject: $subject);
    }

    public function content(): Content
    {
        return new Content(view: 'emails.subscription-expiry-reminder');
    }
}
