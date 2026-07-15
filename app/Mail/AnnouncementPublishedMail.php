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
        $attachmentUrl = $this->resolveAttachmentUrl();

        return new Content(
            view: 'emails.announcement-published',
            with: [
                // Public http(s) URL of the attachment when it's an image, so
                // the template can render it inline with a normal <img src>.
                // We deliberately use a real URL (not $message->embed()/cid:)
                // because the in-app /gmail viewer renders the stored HTML in a
                // browser, which can't resolve cid: references. Null for
                // non-image attachments (PDF/DOCX) — those keep the text notice.
                'inlineImageUrl' => $this->isImageAttachment() ? $attachmentUrl : null,
                // Public http(s) URL of the attachment for ANY file type, so the
                // template can render the filename as a clickable open/download
                // link. The in-app /gmail viewer only renders the HTML body (the
                // real MIME attachment isn't reachable there), so without this a
                // PDF/DOCX shows as plain, un-openable text.
                'attachmentUrl' => $attachmentUrl,
            ],
        );
    }

    /**
     * True when the stored attachment is an image we can preview inline.
     */
    private function isImageAttachment(): bool
    {
        $rel = $this->announcement->attachment_path;
        if (!$rel) return false;

        $ext = strtolower(pathinfo($rel, PATHINFO_EXTENSION));
        return in_array($ext, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'], true);
    }

    /**
     * Returns a public URL for the attachment (any file type), or null when
     * there's no attachment or the file is missing on disk. Used BOTH to
     * preview images inline and to turn the filename into a clickable
     * open/download link — the in-app /gmail viewer renders only the HTML
     * body, so the MIME attachment isn't reachable there without this URL.
     */
    private function resolveAttachmentUrl(): ?string
    {
        $rel = $this->announcement->attachment_path;
        if (!$rel) return null;

        $abs = storage_path('app/public/' . ltrim($rel, '/'));
        if (!is_file($abs)) return null;

        // Build a fully-qualified URL via asset() so it includes the app's
        // base path (e.g. /Cross_Border_Command/public). file_url() leans on
        // the public disk's `url` config which is the root-relative "/storage",
        // and that 404s under a subdirectory install + in email clients.
        $normalized = ltrim(str_replace('\\', '/', $rel), '/');
        if (str_starts_with($normalized, 'storage/')) $normalized = substr($normalized, 8);
        if (str_starts_with($normalized, 'public/'))  $normalized = substr($normalized, 7);

        return asset('storage/' . $normalized);
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
