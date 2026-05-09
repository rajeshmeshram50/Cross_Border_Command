<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Confirmation mail dispatched after a successful password reset via the
 * forgot-password OTP flow. Surfaces the NEW password in plaintext so QA /
 * end-users can recover it from the inbox if they didn't write it down — this
 * matches the existing WelcomeCredentialsMail pattern used at signup.
 *
 * Note: emailing a plaintext password is a deliberate product choice here, not
 * an oversight. If/when the policy tightens, drop the $newPassword field and
 * the matching Blade row.
 */
class PasswordChangedMail extends Mailable
{
    use Queueable, SerializesModels;

    public string $userName;
    public string $userEmail;
    public string $newPassword;
    public string $changedAt;
    public string $loginUrl;
    public string $appName;

    public function __construct(string $userName, string $userEmail, string $newPassword)
    {
        $this->userName    = $userName;
        $this->userEmail   = $userEmail;
        $this->newPassword = $newPassword;
        $this->changedAt   = now()->format('M d, Y \· h:i A');
        $this->loginUrl    = config('app.url');
        $this->appName     = config('mail.from.name', 'Cross Border Command');
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "Your Password Was Changed Successfully — {$this->appName}",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.password-changed',
        );
    }
}
