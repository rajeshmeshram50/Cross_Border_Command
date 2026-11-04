<?php

namespace App\Services\CredVault;

use App\Mail\CredVaultOtpMail;
use App\Models\CredVault\AccessRequest;
use App\Models\CredVault\Credential;
use App\Models\User;
use App\Support\BrandingResolver;
use App\Support\Settings;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * The Critical Vault's email 2-step: a 6-digit code mailed to the credential's
 * 2-step inbox (php@inhpl.com unless the owner picks another).
 *
 *   setup   the Add / Edit form links email 2-step: send → verify → the save
 *           consumes the verified token. Nothing is stored until it matches.
 *   unlock  the code step of an access request: sent to the credential's inbox,
 *           checked once by verify-otp (wrong tries count on the request).
 *
 * Only a keyed hash of a code is kept, in the cache, for 10 minutes.
 */
class EmailOtp
{
    public const TTL_MINUTES    = 10;
    public const SETUP_TRIES    = 5;
    public const RESEND_SECONDS = 30;
    public const SENDS_PER_HOUR = 10;

    public static function defaultInbox(): string
    {
        return (string) config('services.credvault.otp_email', 'react_dev@inhpl.com');
    }

    /** @return array{token:string, sent_to:string, expires_in:int, resend_in:int} */
    public static function sendSetup(User $u, string $email, ?string $credentialName): array
    {
        $email = Str::lower(trim($email));
        self::throttle($u, "setup:{$email}");

        $code  = self::code();
        $token = Str::random(40);
        Cache::put(self::setupKey($token), [
            'user_id' => $u->id,
            'client_id' => $u->client_id,
            'email' => $email,
            'hash' => self::hash($code),
            'tries' => 0,
            'verified' => false,
        ], now()->addMinutes(self::TTL_MINUTES));

        self::mail($email, new CredVaultOtpMail($code, 'setup', $u->name, $credentialName, self::TTL_MINUTES, BrandingResolver::forUser($u)));

        return ['token' => $token, 'sent_to' => Credential::maskEmail($email), 'expires_in' => self::TTL_MINUTES * 60, 'resend_in' => self::RESEND_SECONDS];
    }

    /** Checks a setup code. A match marks the token verified for the save; 5 misses end it. */
    public static function verifySetup(User $u, string $token, string $code): array
    {
        $key = self::setupKey($token);
        $s   = Cache::get($key);
        if (!$s || $s['user_id'] !== $u->id) self::fail('This code has expired. Send a new one.', 'email_otp_code', 410);
        if ($s['verified']) return ['sent_to' => Credential::maskEmail($s['email']), 'email' => $s['email']];

        if (!hash_equals($s['hash'], self::hash($code))) {
            $s['tries']++;
            $left = self::SETUP_TRIES - $s['tries'];
            if ($left <= 0) {
                Cache::forget($key);
                self::fail('Too many wrong codes. Send a new code.', 'email_otp_code', 423);
            }
            Cache::put($key, $s, now()->addMinutes(self::TTL_MINUTES));
            self::fail("Incorrect code. {$left} attempt" . ($left === 1 ? '' : 's') . ' left.', 'email_otp_code');
        }

        $s['verified'] = true;
        Cache::put($key, $s, now()->addMinutes(self::TTL_MINUTES));

        return ['sent_to' => Credential::maskEmail($s['email']), 'email' => $s['email']];
    }

    /** The save takes a verified token for this exact inbox; it is good once. */
    public static function consumeSetup(User $u, string $token, string $email): bool
    {
        $s = Cache::pull(self::setupKey($token));

        return $s && $s['verified'] && $s['user_id'] === $u->id && $s['email'] === Str::lower(trim($email));
    }

    /** A verified setup token, read without using it up (the save checks before it writes). */
    public static function setupVerified(User $u, string $token, string $email): bool
    {
        $s = Cache::get(self::setupKey($token));

        return $s && $s['verified'] && $s['user_id'] === $u->id && $s['email'] === Str::lower(trim($email));
    }

    /** Mails the unlock code of a request waiting on its code step. */
    public static function sendUnlock(AccessRequest $r, Credential $c, User $u): array
    {
        self::throttle($u, "unlock:{$r->id}");

        $code = self::code();
        Cache::put(self::unlockKey($r->id), ['hash' => self::hash($code)], now()->addMinutes(self::TTL_MINUTES));
        self::mail($c->twofa_email, new CredVaultOtpMail($code, 'unlock', $u->name, $c->name, self::TTL_MINUTES, BrandingResolver::forUser($u)));

        return ['sent_to' => Credential::maskEmail($c->twofa_email), 'expires_in' => self::TTL_MINUTES * 60, 'resend_in' => self::RESEND_SECONDS];
    }

    /** null: no live code was sent; true / false: the code matched or not. A match is used up. */
    public static function checkUnlock(int $requestId, string $code): ?bool
    {
        $s = Cache::get(self::unlockKey($requestId));
        if (!$s) return null;
        if (!hash_equals($s['hash'], self::hash($code))) return false;
        Cache::forget(self::unlockKey($requestId));

        return true;
    }

    public static function forgetUnlock(int $requestId): void
    {
        Cache::forget(self::unlockKey($requestId));
    }

    /** One send per 30 s per target, and 10 an hour per person. */
    private static function throttle(User $u, string $target): void
    {
        if (!Cache::add("credvault:email-otp:gap:{$u->id}:{$target}", 1, now()->addSeconds(self::RESEND_SECONDS))) {
            self::fail('A code was just sent. Wait ' . self::RESEND_SECONDS . ' seconds before asking for another.', null, 429);
        }
        $hour = "credvault:email-otp:hour:{$u->id}";
        Cache::add($hour, 0, now()->addHour());
        if (Cache::increment($hour) > self::SENDS_PER_HOUR) {
            self::fail('Too many codes sent in the last hour. Try again later.', null, 429);
        }
    }

    private static function mail(string $to, CredVaultOtpMail $mail): void
    {
        if (!Settings::shouldSendMail()) {
            self::fail('Email is turned off by the platform admin, so an email code cannot be sent. Use the authenticator app instead.', null, 503);
        }
        try {
            Mail::to($to)->send($mail);
        } catch (\Throwable $e) {
            Log::error('CredVault: email 2-step code not sent', ['to' => $to, 'error' => $e->getMessage()]);
            self::fail('The code could not be emailed. Please try again.', null, 502);
        }
    }

    private static function code(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    private static function hash(string $code): string
    {
        return hash_hmac('sha256', $code, (string) config('app.key'));
    }

    private static function setupKey(string $token): string
    {
        return 'credvault:email-otp:setup:' . hash('sha256', $token);
    }

    private static function unlockKey(int $requestId): string
    {
        return "credvault:email-otp:unlock:{$requestId}";
    }

    private static function fail(string $message, ?string $field = null, int $status = 422): never
    {
        throw new HttpResponseException(response()->json(array_filter([
            'status'  => false,
            'message' => $message,
            'errors'  => $field ? [$field => [$message]] : null,
        ], fn($v) => $v !== null), $status));
    }
}
