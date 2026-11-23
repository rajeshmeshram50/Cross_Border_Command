<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Http\Request;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class PasswordChangedMail extends Mailable
{
    use Queueable, SerializesModels;

    public string $userName;
    public string $userEmail;
    public string $newPassword;
    public string $changedAt;
    public string $loginUrl;
    public string $appName;
    public array $branding;

    public function __construct(
        string $userName,
        string $userEmail,
        string $newPassword,
        ?string $loginUrl = null,
        array $branding = []
    ) {
        $this->userName    = $userName;
        $this->userEmail   = $userEmail;
        $this->newPassword = $newPassword;
        $this->changedAt   = now('Asia/Kolkata')->format('M d, Y \· h:i A');
        $this->loginUrl    = $loginUrl ?: self::defaultLoginUrl();
        $this->appName     = $branding['brandName'] ?? config('mail.from.name', 'Cross Border Command');
        $this->branding    = array_filter($branding, fn($v) => $v !== null);
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

    public static function defaultLoginUrl(): string
    {
        $base = config('app.frontend_url') ?: config('app.url') ?: 'http://localhost';
        return rtrim($base, '/') . '/login';
    }

    private static function sanitizeOrigin(?string $url): ?string
    {
        if (!$url) return null;
        $url = trim($url);
        if ($url === '') return null;
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
            with: array_merge([
                'userName'    => $this->userName,
                'userEmail'   => $this->userEmail,
                'newPassword' => '',
                'changedAt'   => $this->changedAt,
                'loginUrl'    => $this->loginUrl,
                'appName'     => $this->appName,
            ], $this->branding),
        );
    }
}
