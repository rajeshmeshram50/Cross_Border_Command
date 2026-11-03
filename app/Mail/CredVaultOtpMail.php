<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * CredVault · Critical Vault email 2-step code.
 *
 *   purpose setup   linking email 2-step to a credential in the Add / Edit form
 *   purpose unlock  the code step of an access request
 */
class CredVaultOtpMail extends Mailable
{
    use Queueable, SerializesModels;

    public string $requestedAt;

    public function __construct(
        public string $otp,
        public string $purpose,
        public string $requestedBy,
        public ?string $credentialName = null,
        public int $expiryMinutes = 10,
        public array $branding = [],
    ) {
        $this->requestedAt = now('Asia/Kolkata')->format('M d, Y · h:i A');
        $this->branding    = array_filter($branding, fn ($v) => $v !== null);
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->purpose === 'unlock'
            ? 'CredVault unlock code — ' . ($this->credentialName ?? 'critical credential')
            : 'CredVault 2-step verification code');
    }

    public function content(): Content
    {
        return new Content(view: 'emails.credvault-otp', with: array_merge([
            'otp'            => $this->otp,
            'purpose'        => $this->purpose,
            'requestedBy'    => $this->requestedBy,
            'credentialName' => $this->credentialName,
            'expiryMinutes'  => $this->expiryMinutes,
            'requestedAt'    => $this->requestedAt,
        ], $this->branding));
    }
}
