<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class OnboardingInviteMail extends Mailable
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
        return new Envelope(
            subject: "Complete your onboarding — {$this->orgName}",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.onboarding-invite',
        );
    }
}
