<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Http\Request;
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

    /**
     * @param string|null $loginUrl Pre-resolved SPA login URL. Pass the result
     *   of {@see self::resolveLoginUrl()} so the "Sign In" button points at
     *   the same origin the user just acted from (localhost in dev, the live
     *   host in production). When null, falls back to `APP_FRONTEND_URL`/
     *   `APP_URL` from config — which is correct for queued jobs that run
     *   without an HTTP request.
     */
    public function __construct(string $userName, string $userEmail, string $newPassword, ?string $loginUrl = null)
    {
        $this->userName    = $userName;
        $this->userEmail   = $userEmail;
        $this->newPassword = $newPassword;
        $this->changedAt   = now()->format('M d, Y \· h:i A');
        $this->loginUrl    = $loginUrl ?: self::defaultLoginUrl();
        $this->appName     = config('mail.from.name', 'Cross Border Command');
    }

   
    public static function resolveLoginUrl(Request $request): string
    {
        $candidates = array_filter([
            $request->input('app_origin'),
            $request->headers->get('Origin'),
            $request->headers->get('Referer'),
        ]);

        foreach ($candidates as $candidate) {
            $origin = self::sanitizeOrigin($candidate);
            if ($origin !== null) return $origin . '/login';
        }
        return self::defaultLoginUrl();
    }

    /** Last-resort URL when no request context is available (queued jobs). */
    public static function defaultLoginUrl(): string
    {
        $base = config('app.frontend_url') ?: config('app.url') ?: 'http://localhost';
        return rtrim($base, '/') . '/login';
    }

    /**
     * Normalize an Origin/Referer string into a `scheme://host[:port]` root.
     * Returns null for anything that isn't a syntactically valid http(s) URL,
     * so a malformed `Referer` header (or a frontend that sends garbage) can
     * never compose a broken href in the email.
     */
    private static function sanitizeOrigin(?string $url): ?string
    {
        if (!$url) return null;
        $url = trim($url);
        if ($url === '') return null;
        // Trim trailing slash and any path before parsing — we only want the
        // origin, never `/login` or `/dashboard` that leaked from a Referer.
        $parsed = parse_url($url);
        if (!is_array($parsed) || empty($parsed['scheme']) || empty($parsed['host'])) return null;
        if (!in_array($parsed['scheme'], ['http', 'https'], true)) return null;
        $port = !empty($parsed['port']) ? ':' . $parsed['port'] : '';
        return $parsed['scheme'] . '://' . $parsed['host'] . $port;
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
