<?php

namespace App\Support;

use Closure;

class PostalCode
{
    public const DOMESTIC_RE = '/^[0-9]{6}$/';

    public const INTERNATIONAL_RE = '/^[A-Za-z0-9\s\-]+$/';

    public const INTERNATIONAL_MAX = 12;

    public static function rule(Closure $countryResolver): Closure
    {
        return function (string $attribute, $value, Closure $fail) use ($countryResolver) {
            $v = trim((string) $value);
            if ($v === '') return;

            if (Gst::isDomestic($countryResolver($attribute))) {
                if (!preg_match(self::DOMESTIC_RE, $v)) {
                    $fail('PIN Code must be exactly 6 digits.');
                }
                return;
            }

            if (mb_strlen($v) > self::INTERNATIONAL_MAX) {
                $fail('Zip Code must be ' . self::INTERNATIONAL_MAX . ' characters or fewer.');
                return;
            }
            if (!preg_match(self::INTERNATIONAL_RE, $v)) {
                $fail('Zip Code can contain only letters, digits, spaces and hyphens.');
            }
        };
    }

    public static function locationRule(array $payload, string $arrayKey = 'locations'): Closure
    {
        return self::rule(function (string $attribute) use ($payload, $arrayKey) {
            $index = explode('.', $attribute)[1] ?? null;
            return $payload[$arrayKey][$index]['country'] ?? null;
        });
    }
}
