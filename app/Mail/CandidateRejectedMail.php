<?php

namespace App\Mail;

use App\Models\Candidate;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class CandidateRejectedMail extends Mailable
{
    use Queueable, SerializesModels;

    public Candidate $candidate;
    public string $orgName;
    public ?string $jobTitle;
    public ?string $reason;
    public ?string $notes;
    public string $appName;

    public function __construct(Candidate $candidate, string $orgName, ?string $jobTitle = null, ?string $reason = null, ?string $notes = null)
    {
        $this->candidate = $candidate;
        $this->orgName   = $orgName;
        $this->jobTitle  = $jobTitle;
        $this->reason    = $reason;
        $this->notes     = $notes;
        $this->appName   = config('mail.from.name', 'Cross Border Command');
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "Update on your application — {$this->orgName}",
        );
    }

    public function content(): Content
    {
        return new Content(view: 'emails.candidate-rejected');
    }
}
