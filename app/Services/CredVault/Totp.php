<?php

namespace App\Services\CredVault;

/**
 * RFC 6238 time-based one-time codes — the authenticator step of Critical
 * Access Protection. SHA-1, 6 digits, 30-second period: what Google and
 * Microsoft Authenticator, Authy and every other TOTP app expect by default.
 */
class Totp
{
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    private const PERIOD   = 30;
    private const DIGITS   = 6;

    /** A fresh 160-bit secret, base32 — 32 characters, as the apps prefer. */
    public static function newSecret(): string
    {
        $bytes = random_bytes(20);
        $bits  = '';
        foreach (str_split($bytes) as $b) $bits .= str_pad(decbin(ord($b)), 8, '0', STR_PAD_LEFT);

        $out = '';
        foreach (str_split($bits, 5) as $chunk) $out .= self::ALPHABET[bindec(str_pad($chunk, 5, '0'))];

        return $out;
    }

    /** otpauth:// URI for the QR code. */
    public static function uri(string $secret, string $label, string $issuer = 'Kryptone'): string
    {
        return 'otpauth://totp/' . rawurlencode($issuer . ':' . $label)
            . '?secret=' . $secret . '&issuer=' . rawurlencode($issuer)
            . '&algorithm=SHA1&digits=' . self::DIGITS . '&period=' . self::PERIOD;
    }

    /** The code for a time step; defaults to now. */
    public static function code(string $secret, ?int $step = null): string
    {
        $step ??= intdiv(time(), self::PERIOD);
        $key  = self::decode($secret);
        $msg  = pack('N*', 0) . pack('N*', $step);
        $hash = hash_hmac('sha1', $msg, $key, true);
        $off  = ord($hash[19]) & 0x0f;
        $bin  = ((ord($hash[$off]) & 0x7f) << 24) | (ord($hash[$off + 1]) << 16)
              | (ord($hash[$off + 2]) << 8) | ord($hash[$off + 3]);

        return str_pad((string) ($bin % (10 ** self::DIGITS)), self::DIGITS, '0', STR_PAD_LEFT);
    }

    /**
     * Whether $code is valid now, allowing one step of clock drift either side.
     * Compared in constant time so a timing attack learns nothing.
     */
    public static function verify(string $secret, string $code): bool
    {
        return self::matchStep($secret, $code) !== null;
    }

    /** The time step $code belongs to (drift ±1), or null — callers store it to refuse a replay. */
    public static function matchStep(string $secret, string $code): ?int
    {
        if (!preg_match('/^\d{6}$/', $code)) return null;

        $now = intdiv(time(), self::PERIOD);
        foreach ([-1, 0, 1] as $drift) {
            if (hash_equals(self::code($secret, $now + $drift), $code)) return $now + $drift;
        }
        return null;
    }

    private static function decode(string $b32): string
    {
        $b32  = strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $b32));
        $bits = '';
        foreach (str_split($b32) as $c) {
            $bits .= str_pad(decbin(strpos(self::ALPHABET, $c)), 5, '0', STR_PAD_LEFT);
        }

        $out = '';
        foreach (str_split($bits, 8) as $byte) {
            if (strlen($byte) === 8) $out .= chr(bindec($byte));
        }
        return $out;
    }
}
