<?php

namespace App\Mail;

use App\Models\Announcement;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;

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
        $attachmentUrl = $this->resolveAttachmentUrl();

        return new Content(
            view: 'emails.announcement-published',
            with: [
                'inlineImageUrl' => $this->isImageAttachment() ? $attachmentUrl : null,
                'attachmentUrl' => $attachmentUrl,
            ],
        );
    }

    private function isImageAttachment(): bool
    {
        $rel = $this->announcement->attachment_path;
        if (!$rel) return false;

        $ext = strtolower(pathinfo($rel, PATHINFO_EXTENSION));
        return in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'], true);
    }

    private function normalisedPath(): ?string
    {
        $rel = $this->announcement->attachment_path;
        if (!$rel) return null;
        $norm = ltrim(str_replace('\\', '/', $rel), '/');
        if (str_starts_with($norm, 'storage/')) $norm = substr($norm, 8);
        if (str_starts_with($norm, 'public/'))  $norm = substr($norm, 7);
        return $norm !== '' ? $norm : null;
    }

    private function resolveAttachmentUrl(): ?string
    {
        $norm = $this->normalisedPath();
        if (!$norm || !Storage::disk('public')->exists($norm)) return null;

        return URL::signedRoute('announcements.attachment', ['id' => $this->announcement->id]);
    }

    public function attachments(): array
    {
        $norm = $this->normalisedPath();
        if (!$norm || !Storage::disk('public')->exists($norm)) return [];

        $name = $this->announcement->attachment_original_name ?: basename($norm);
        return [
            Attachment::fromData(fn () => Storage::disk('public')->get($norm), $name),
        ];
    }
}
