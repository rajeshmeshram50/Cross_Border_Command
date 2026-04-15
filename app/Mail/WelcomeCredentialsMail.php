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

    public function __construct(
        string $userName,
        string $userEmail,
        string $password,
        string $userType,
        string $orgName
    ) {
        $this->userName = $userName;
        $this->userEmail = $userEmail;
        $this->password = $password;
        $this->userType = $userType;
        $this->orgName = $orgName;
        $this->loginUrl = config('app.url');
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
