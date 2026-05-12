<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class WelcomeCredentialsMail extends Mailable
{
    use Queueable, SerializesModels;

    public string $userName;
    public string $userEmail;
    public string $password;
    public string $userType;
    public string $orgName;
    public string $loginUrl;
    public string $appName;

    /**
     * @param string|null $loginUrl Pre-resolved SPA login URL. Pass the
     *   result of {@see PasswordChangedMail::resolveLoginUrl()} from the
     *   controller so the "Sign In" button mirrors the origin the admin
     *   triggered this from (localhost in dev, the live host in prod).
     *   When null, falls back to the canonical config-based default —
     *   correct for queued jobs / cron without an HTTP request.
     */
    public function __construct(
        string $userName,
        string $userEmail,
        string $password,
        string $userType,
        string $orgName,
        ?string $loginUrl = null
    ) {
        $this->userName = $userName;
        $this->userEmail = $userEmail;
        $this->password = $password;
        $this->userType = $userType;
        $this->orgName = $orgName;
        // Reuse PasswordChangedMail::defaultLoginUrl() so the welcome mail
        // and the password-changed mail are guaranteed to agree on what
        // "the SPA login URL" means — one place to change if the route
        // ever moves off /login.
        $this->loginUrl = $loginUrl ?: PasswordChangedMail::defaultLoginUrl();
        $this->appName = config('mail.from.name', 'Cross Border Command');
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "Welcome to {$this->appName} — Your Login Credentials",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.welcome-credentials',
        );
    }
}
