<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class ComposedEmail extends Mailable
{
    use Queueable, SerializesModels;

    public string $subjectLine;
    public string $bodyHtml;
    public string $recipientName;
    public string $orgName;
    public string $senderName;
    public string $appName;
    public array $attachmentList;

    public function __construct(
        string $subjectLine,
        string $bodyHtml,
        string $recipientName = 'there',
        string $orgName = '',
        string $senderName = '',
        array $attachmentList = []
    ) {
        $this->subjectLine    = $subjectLine;
        $this->bodyHtml       = $bodyHtml;
        $this->recipientName  = $recipientName ?: 'there';
        $this->orgName        = $orgName ?: config('mail.from.name', 'Cross Border Command');
        $this->senderName     = $senderName;
        $this->appName        = config('mail.from.name', 'Cross Border Command');
        $this->attachmentList = $attachmentList;
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->subjectLine ?: '(no subject)');
    }

    public function content(): Content
    {
        return new Content(view: 'emails.composed');
    }

    public function attachments(): array
    {
        return collect($this->attachmentList)
            ->filter(fn ($a) => !empty($a['path']) && is_file($a['path']))
            ->map(fn ($a) => Attachment::fromPath($a['path'])
                ->as($a['name'] ?? 'attachment')
                ->withMime($a['mime'] ?? 'application/octet-stream'))
            ->values()
            ->all();
    }
}
