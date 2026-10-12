<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Employee login email changed — sent to BOTH addresses, one message each.
 *
 * The new address gets the confirmation. The OLD address gets the warning,
 * and that one is the point of this mailable: an attacker who reaches an
 * account changes the email first, and if only the new address is told, the
 * real owner learns nothing. The old inbox is the only one still under their
 * control at that moment, so it is told where the mail now goes.
 *
 * Both variants render the same blade; VARIANT_OLD swaps the copy, not the
 * design.
 */
class EmployeeEmailChangedMail extends Mailable
{
    use Queueable, SerializesModels;

    /** Confirmation, sent to the address that now owns the account. */
    public const VARIANT_NEW = 'new';

    /** Security notice, sent to the address that just lost it. */
    public const VARIANT_OLD = 'old';

    public string $changedAt;
    public string $profileUrl;
    public string $appName;
    public array $branding;

    /**
     * @param string      $variant    self::VARIANT_NEW | self::VARIANT_OLD
     * @param string|null $profileUrl SPA profile URL; falls back to the
     *                                configured frontend origin when null, which
     *                                is what a queued job gets.
     * @param array       $branding   Per-tenant overrides from BrandingResolver
     *                                (brandName, logoUrl, supportEmail, …). The
     *                                blade falls back to platform defaults for
     *                                anything omitted.
     * @param string      $branchName The employee's own office, shown in the
     *                                header and footer. BrandingResolver only
     *                                resolves as far as the client, so this is
     *                                passed separately; empty falls back to the
     *                                organisation name.
     */
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
        // Keep empty strings — a caller uses '' to suppress a template default
        // on purpose. Only true nulls are dropped.
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

    /**
     * Everything the blade needs, as a plain array.
     *
     * Public and separate from content() so the design preview can render the
     * same view with the same keys without constructing a mail transport.
     */
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
