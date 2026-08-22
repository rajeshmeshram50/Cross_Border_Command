<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Queued deliberately.
 *
 * Sent inline, this mail put a full Gmail SMTP conversation inside the HTTP
 * request — TCP, STARTTLS, AUTH, MAIL FROM / RCPT TO / DATA, each its own
 * round trip — which is ~5s the admin spends staring at a spinner for work
 * that has nothing to do with their response. The invite row is already
 * committed by then; the mail is not something the caller needs to wait on.
 *
 * REQUIRES A RUNNING QUEUE WORKER (`php artisan queue:work`). Without one the
 * job sits in the `jobs` table and the candidate never gets the link.
 * See deploy/queue-supervisor.conf.
 */
class OnboardingInviteMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public string $candidateName;
    public string $candidateEmail;
    public string $orgName;
    public string $departmentName;
    public string $expectedJoinDate;
    public int    $expiryDays;
    public string $onboardingUrl;
    public string $appName;

    public function __construct(
        string $candidateName,
        string $candidateEmail,
        string $orgName,
        ?string $departmentName,
        ?string $expectedJoinDate,
        int $expiryDays,
        string $onboardingUrl,
    ) {
        $this->candidateName    = $candidateName;
        $this->candidateEmail   = $candidateEmail;
        $this->orgName          = $orgName;
        $this->departmentName   = $departmentName ?: '—';
        $this->expectedJoinDate = $expectedJoinDate ?: '—';
        $this->expiryDays       = $expiryDays;
        $this->onboardingUrl    = $onboardingUrl;
        $this->appName          = config('mail.from.name', 'Cross Border Command');
    }

    public function envelope(): Envelope
    {
        // Guard against an empty org name so the subject is never a dangling
        // "Complete your onboarding — " (a blank-ish subject hurts deliverability).
        $org = trim($this->orgName);
        return new Envelope(
            subject: $org !== '' ? "Complete your onboarding at {$org}" : 'Complete your onboarding',
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.onboarding-invite',
        );
    }
}
