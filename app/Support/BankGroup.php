<?php

namespace App\Support;

final class BankGroup
{
    public const HDFC  = 'hdfc';
    public const OTHER = 'other';
    public const ALL   = 'all';

    private const HDFC_IFSC_CODE = 'HDFC';

    private const HDFC_NAME_TOKENS = [
        'HDFC',
        'HOUSINGDEVELOPMENTFINANCECORPORATION',
    ];

    public static function isHdfc(?string $bankName, ?string $ifsc): bool
    {
        $code = substr(self::alnum($ifsc), 0, 4);
        if (preg_match('/^[A-Z]{4}$/', $code)) {
            return $code === self::HDFC_IFSC_CODE;
        }

        $name = self::letters($bankName);
        if ($name === '') return false;
        foreach (self::HDFC_NAME_TOKENS as $token) {
            if (str_contains($name, $token)) return true;
        }
        return false;
    }

    public static function of(?string $bankName, ?string $ifsc): string
    {
        return self::isHdfc($bankName, $ifsc) ? self::HDFC : self::OTHER;
    }

    public static function matches(string $filter, string $group): bool
    {
        return $filter === self::ALL || $filter === $group;
    }

    public static function normalize(?string $group): string
    {
        $g = strtolower(trim((string) $group));
        return in_array($g, [self::HDFC, self::OTHER], true) ? $g : self::ALL;
    }

    public static function label(string $group): string
    {
        return match ($group) {
            self::HDFC  => 'HDFC Bank',
            self::OTHER => 'Other Banks',
            default     => 'All Banks',
        };
    }

    public static function batchPrefix(string $group): string
    {
        return match ($group) {
            self::HDFC  => 'HDFC',
            self::OTHER => 'NEFT',
            default     => 'PAY',
        };
    }

    private static function alnum(?string $v): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) $v) ?? '');
    }

    private static function letters(?string $v): string
    {
        return strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $v) ?? '');
    }
}
