<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * A free-form email composed from the Gmail page's "Compose" box. The body is
 * the user-typed message (plain text or simple HTML); the Blade view wraps it
 * in the same branded shell the system's transactional mails use.
 *
 * Like every other mailable, the send is captured into email_logs by
 * App\Listeners\LogSentEmail — so a composed message appears in the history
 * the moment it goes out.
 */
class ComposedEmail extends Mailable
{
    use Queueable, SerializesModels;

    public string $subjectLine;
    public string $bodyHtml;
    public string $recipientName;
    public string $orgName;
    public string $senderName;
    public string $appName;

    public function __construct(
        string $subjectLine,
        string $bodyHtml,
        string $recipientName = 'there',
        string $orgName = '',
        string $senderName = ''
    ) {
        $this->subjectLine   = $subjectLine;
        $this->bodyHtml      = $bodyHtml;
        $this->recipientName = $recipientName ?: 'there';
        $this->orgName       = $orgName ?: config('mail.from.name', 'Cross Border Command');
        $this->senderName    = $senderName;
        $this->appName       = config('mail.from.name', 'Cross Border Command');
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->subjectLine ?: '(no subject)');
    }

    public function content(): Content
    {
        return new Content(view: 'emails.composed');
    }
}
