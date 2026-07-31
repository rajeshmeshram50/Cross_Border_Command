<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Emails a database backup as a gzip-compressed .sql.gz attachment.
 * Sent inline (not queued) so the admin gets an immediate success/failure —
 * this project has no queue worker running by default.
 */
class DatabaseBackupMail extends Mailable
{
    public function __construct(
        public string $databaseName,
        public string $generatedAt,
        public string $senderName,
        public string $gzBytes,
        public string $gzFilename,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "Database Backup — {$this->databaseName} — {$this->generatedAt}",
        );
    }

    public function content(): Content
    {
        $size = number_format(strlen($this->gzBytes) / 1024, 0) . ' KB';

        return new Content(
            htmlString: <<<HTML
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c2531;line-height:1.6">
                    <p>Hello,</p>
                    <p>Attached is a full backup of the <strong>{$this->databaseName}</strong> database,
                    generated on <strong>{$this->generatedAt}</strong>.</p>
                    <p>The attachment is a gzip-compressed PostgreSQL dump
                    (<code>{$this->gzFilename}</code>, {$size}). Restore it with:</p>
                    <pre style="background:#f4f5f7;padding:10px 12px;border-radius:6px;font-size:12px;overflow:auto">gunzip -c {$this->gzFilename} | psql -d your_database</pre>
                    <p style="color:#878a99;font-size:12px">Requested by {$this->senderName}. Please store this file securely — it contains all application data.</p>
                </div>
            HTML,
        );
    }

    /** @return array<int, Attachment> */
    public function attachments(): array
    {
        return [
            Attachment::fromData(fn () => $this->gzBytes, $this->gzFilename)
                ->withMime('application/gzip'),
        ];
    }
}
