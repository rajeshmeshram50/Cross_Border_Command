<?php

namespace App\Mail;

use App\Models\Payment;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class PlanReminderMail extends Mailable
{
    use Queueable, SerializesModels;

    public Payment $payment;
    public int $remainingDays;
    public string $clientName;
    public string $planName;
    public string $expiryDate;

    public function __construct(Payment $payment)
    {
        $this->payment = $payment->load(['client', 'plan']);
        $this->clientName = $payment->client->org_name;
        $this->planName = $payment->plan->name ?? 'Subscription';
        $this->expiryDate = $payment->valid_until
            ? $payment->valid_until->format('d M Y')
            : ($payment->client->plan_expires_at ? $payment->client->plan_expires_at->format('d M Y') : 'N/A');

        $expiry = $payment->valid_until ?? $payment->client->plan_expires_at;
        $this->remainingDays = $expiry ? max(0, (int) now()->diffInDays($expiry, false)) : 0;
    }

    public function envelope(): Envelope
    {
        $status = $this->remainingDays <= 0 ? 'Expired' : "{$this->remainingDays} Days Remaining";
        return new Envelope(
            subject: "Plan Reminder: {$this->planName} — {$status}",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.plan-reminder',
        );
    }
}
