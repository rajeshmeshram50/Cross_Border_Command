<?php

namespace App\Mail;

use App\Models\Candidate;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class CandidateSelectedMail extends Mailable
{
    use Queueable, SerializesModels;

    public Candidate $candidate;
    public string $orgName;
    public ?string $jobTitle;
    public ?string $notes;
    public string $appName;

    public function __construct(Candidate $candidate, string $orgName, ?string $jobTitle = null, ?string $notes = null)
    {
        $this->candidate = $candidate;
        $this->orgName   = $orgName;
        $this->jobTitle  = $jobTitle;
        $this->notes     = $notes;
        $this->appName   = config('mail.from.name', 'Cross Border Command');
    }

    public function envelope(): Envelope
    {
        $role = $this->jobTitle ? " for {$this->jobTitle}" : '';
        return new Envelope(
            subject: "Congratulations! You've been selected{$role} — {$this->orgName}",
        );
    }

    public function content(): Content
    {
        return new Content(view: 'emails.candidate-selected');
    }
}
