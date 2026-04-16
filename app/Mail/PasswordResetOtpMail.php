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

    public function __construct(string $otp, string $userName, string $userEmail, int $expiryMinutes = 10)
    {
        $this->otp = $otp;
        $this->userName = $userName;
        $this->userEmail = $userEmail;
        $this->expiryMinutes = $expiryMinutes;
        $this->requestedAt = now()->format('M d, Y \· h:i A');
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "Your Password Reset Code — Cross Border Command",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.password-reset-otp',
        );
    }
}
