<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class EmployeeEmailChangedMail extends Mailable
{
    use Queueable, SerializesModels;

    public const VARIANT_NEW = 'new';

    public const VARIANT_OLD = 'old';

    public string $changedAt;
    public string $profileUrl;
    public string $appName;
    public array $branding;

    public function __construct(
        public string $employeeName,
        public string $oldEmail,
        public string $newEmail,
        public string $variant = self::VARIANT_NEW,
        ?string $profileUrl = null,
        array $branding = [],
        public string $branchName = '',
    ) {
        $this->changedAt  = now('Asia/Kolkata')->format('d M Y, h:i A');
        $this->profileUrl = $profileUrl ?: self::defaultProfileUrl();
        $this->appName    = $branding['brandName'] ?? config('mail.from.name', 'Cross Border Command');
        $this->branding   = array_filter($branding, fn ($v) => $v !== null);
    }

    public static function defaultProfileUrl(): string
    {
        $base = config('app.frontend_url') ?: config('app.url') ?: 'http://localhost';

        return rtrim($base, '/') . '/profile';
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: $this->variant === self::VARIANT_OLD
                ? "Your Email Address Was Changed — {$this->appName}"
                : "Your Email Has Been Updated Successfully — {$this->appName}",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.employee-email-changed',
            with: array_merge($this->data(), $this->branding),
        );
    }

    public function data(): array
    {
        return [
            'employeeName' => $this->employeeName,
            'oldEmail'     => $this->oldEmail,
            'newEmail'     => $this->newEmail,
            'variant'      => $this->variant,
            'changedAt'    => $this->changedAt,
            'profileUrl'   => $this->profileUrl,
            'appName'      => $this->appName,
            'branchName'   => $this->branchName,
        ];
    }
}
