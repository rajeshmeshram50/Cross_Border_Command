<?php

namespace App\Support;

class BankDetails
{
    public const IFSC_PATTERN    = '/^[A-Z]{4}0[A-Z0-9]{6}$/';
    public const ACCOUNT_PATTERN = '/^\d{6,18}$/';

    public static function normalizeIfsc(?string $ifsc): string
    {
        return strtoupper(trim((string) $ifsc));
    }

    public static function normalizeAccount(?string $account): string
    {
        return preg_replace('/\s+/', '', (string) $account);
    }

    public static function isValid(?string $ifsc, ?string $account): bool
    {
        return (bool) preg_match(self::IFSC_PATTERN, self::normalizeIfsc($ifsc))
            && (bool) preg_match(self::ACCOUNT_PATTERN, self::normalizeAccount($account));
    }
}
