<?php

namespace App\Mail;

use App\Models\HrDocumentSignature;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Delivers the final, fully-signed document to the subject employee once the
 * signing workflow completes. The DOCX is built on-the-fly from the
 * signature run's frozen `content_html` (which already has every signer's
 * typed signature stitched in) and attached.
 */
class SignedDocumentMail extends Mailable
{
    use Queueable, SerializesModels;

    public HrDocumentSignature $run;
    public string $recipientName;
    public string $orgName;
    public string $appName;
    public string $documentTitle;
    private string $attachmentPath;
    private string $attachmentName;

    public function __construct(
        HrDocumentSignature $run,
        string $attachmentPath,
        string $attachmentName,
        string $recipientName,
        string $orgName,
    ) {
        $this->run            = $run;
        $this->attachmentPath = $attachmentPath;
        $this->attachmentName = $attachmentName;
        $this->recipientName  = $recipientName;
        $this->orgName        = $orgName;
        $this->appName        = config('mail.from.name', 'Cross Border Command');
        $this->documentTitle  = $run->template?->name ?: ($run->code ?: 'Document');
    }

    public function envelope(): Envelope
    {
        $code = $this->run->code ?: ('DOC-' . $this->run->id);
        return new Envelope(
            subject: "Your signed document — {$this->documentTitle} (#{$code})",
        );
    }

    public function content(): Content
    {
        return new Content(view: 'emails.signed-document');
    }

    public function attachments(): array
    {
        if (!is_file($this->attachmentPath)) return [];
        return [
            Attachment::fromPath($this->attachmentPath)->as($this->attachmentName),
        ];
    }
}
