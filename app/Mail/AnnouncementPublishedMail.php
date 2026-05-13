<?php

namespace App\Mail;

use App\Models\Announcement;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;


class AnnouncementPublishedMail extends Mailable
{
    use Queueable, SerializesModels;

    public Announcement $announcement;
    public string $recipientName;
    public string $publisherName;
    public string $orgName;
    public string $appName;

    public function __construct(
        Announcement $announcement,
        string $recipientName,
        string $publisherName,
        string $orgName
    ) {
        $this->announcement  = $announcement;
        $this->recipientName = $recipientName;
        $this->publisherName = $publisherName;
        $this->orgName       = $orgName;
        $this->appName       = config('mail.from.name', 'Cross Border Command');
    }

    public function envelope(): Envelope
    {
        $code  = $this->announcement->code ?: ('ANN-' . $this->announcement->id);
        $title = $this->announcement->title ?: 'Announcement';
        $tag   = strtoupper((string) ($this->announcement->priority ?: 'Normal'));
        $tagPrefix = $tag === 'NORMAL' ? '' : "[{$tag}] ";
        return new Envelope(
            subject: "{$tagPrefix}{$title} (#{$code}) — {$this->orgName}",
        );
    }

    public function content(): Content
    {
        return new Content(view: 'emails.announcement-published');
    }

    public function attachments(): array
    {
        $rel = $this->announcement->attachment_path;
        if (!$rel) return [];

        $abs = storage_path('app/public/' . ltrim($rel, '/'));
        if (!is_file($abs)) return [];

        $att = Attachment::fromPath($abs);
        if ($this->announcement->attachment_original_name) {
            $att = $att->as($this->announcement->attachment_original_name);
        }
        return [$att];
    }
}
