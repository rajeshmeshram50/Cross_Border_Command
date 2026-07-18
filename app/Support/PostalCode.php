<?php

namespace App\Support;

use Closure;

/**
 * Postal-code rules, shared by Customer and Consignee.
 *
 * The rule is COUNTRY-DEPENDENT, matching the shipment module verbatim
 * (CreateShipmentOrderModal + ShipmentOrderController) so the same address
 * validates identically wherever it is entered:
 *
 *   India         → exactly 6 digits          ("411001")
 *   Everywhere    → letters, digits, spaces
 *   else            and hyphens, max 12       ("SL7 1TB", "K1A 0B1")
 *
 * This replaced a single `^[A-Za-z0-9]{3,10}$` rule that applied everywhere,
 * which was wrong in both directions: it accepted a 5-digit Indian PIN and
 * rejected legitimate foreign codes that contain a space or hyphen.
 *
 * Kept as a validator FACTORY rather than a plain regex because the rule can
 * only be chosen once the sibling `country` value is known, which Laravel
 * exposes to closure rules but not to string rules.
 */
class PostalCode
{
    /** India's 6-digit PIN. */
    public const DOMESTIC_RE = '/^[0-9]{6}$/';

    /** Everything else — letters, digits, spaces, hyphens. */
    public const INTERNATIONAL_RE = '/^[A-Za-z0-9\s\-]+$/';

    public const INTERNATIONAL_MAX = 12;

    /**
     * Build the closure rule for a pin field.
     *
     * $countryResolver defers reading the country until validation runs, so
     * callers can pull it from wherever it lives in their payload (a fixed
     * key for the primary address, an indexed one for each location row).
     *
     * Blank passes: the field is `nullable` at every call site, and the
     * frontend already nulls anything that fails its own copy of this rule.
     */
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

    /**
     * Rule for `locations.*.pin`, where the country lives on the SAME row.
     * Laravel passes the resolved attribute name ("locations.3.pin"), so the
     * row index is read back out of it rather than tracked separately.
     */
    public static function locationRule(array $payload, string $arrayKey = 'locations'): Closure
    {
        return self::rule(function (string $attribute) use ($payload, $arrayKey) {
            $index = explode('.', $attribute)[1] ?? null;
            return $payload[$arrayKey][$index]['country'] ?? null;
        });
    }
}
