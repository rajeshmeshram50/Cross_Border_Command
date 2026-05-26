<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class PasswordResetOtpMail extends Mailable
{
    use Queueable, SerializesModels;

    public string $otp;
    public string $userName;
    public string $userEmail;
    public int $expiryMinutes;
    public string $requestedAt;
    public array $branding;

    /**
     * @param  array  $branding  Optional per-tenant overrides. Keys: brandName,
     *                           brandShort, brandTagline, logoUrl, supportEmail,
     *                           supportPhone, websiteUrl, facebookUrl,
     *                           linkedinUrl, twitterUrl, youtubeUrl.
     *                           Any key omitted falls back to the platform default
     *                           defined in the blade template.
     */
    public function __construct(
        string $otp,
        string $userName,
        string $userEmail,
        int $expiryMinutes = 10,
        array $branding = []
    ) {
        $this->otp           = $otp;
        $this->userName      = $userName;
        $this->userEmail     = $userEmail;
        $this->expiryMinutes = $expiryMinutes;
        $this->requestedAt   = now()->format('M d, Y \· h:i A');
        // Keep empty strings — callers use '' to *intentionally suppress* a
        // template default (e.g. client orgs that don't want the IGC-specific
        // "GROUP OF COMPANIES" subline). Only drop true nulls.
        $this->branding      = array_filter($branding, fn ($v) => $v !== null);
    }

    public function envelope(): Envelope
    {
        $brandName = $this->branding['brandName'] ?? 'Cross Border Command';

        return new Envelope(
            subject: "Your Password Reset Code — {$brandName}",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.password-reset-otp',
            with: array_merge([
                'otp'           => $this->otp,
                'userName'      => $this->userName,
                'userEmail'     => $this->userEmail,
                'expiryMinutes' => $this->expiryMinutes,
                'requestedAt'   => $this->requestedAt,
            ], $this->branding),
        );
    }
}
