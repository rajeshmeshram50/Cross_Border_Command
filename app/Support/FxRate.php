<?php

namespace App\Support;

/**
 * The one bound on an exchange rate, and the validation rule that applies it.
 *
 * WHY A CEILING AT ALL
 *
 * The rate is a MULTIPLIER on every amount that passes through it, so a typo
 * here does not add a digit — it adds as many digits as the typo is long. A PO
 * of ₹10 lakh entered at a rate of 8,350 instead of 83.50 becomes ₹835 crore
 * without a single amount field looking wrong, and the first thing to notice
 * is Zoho Books refusing the converted figure hours later with a message it
 * never fills in ("out of range value ... contact {0}").
 *
 * WHY 10,000
 *
 * It is the last rate that cannot overflow anything downstream. The amount
 * columns here, and the field Zoho posts the converted figure into, both carry
 * a 14-digit whole part — 99,999,999,999,999. With a billion as the largest
 * realistic foreign amount:
 *
 *     1,000,000,000 x 10,000 = 10,000,000,000,000   (14 digits — fits, 10x spare)
 *     1,000,000,000 x 100,000 = 100,000,000,000,000 (15 digits — refused)
 *
 * So 10,000 is not a guess at "a big rate": it is the point where the guard
 * stops being arithmetically necessary. Every real rate is far below it — the
 * widest in this org's currency master is GBP at 105, and the narrowest is JPY
 * at 0.56 — so the ceiling is ~95x above anything genuine and cannot refuse a
 * rate anyone would actually enter.
 *
 * `gt:0` matters as much as the maximum: a rate of 0 silently zeroes every
 * converted total rather than failing, and zero is never a real rate.
 */
final class FxRate
{
    /** Highest exchange rate any document may carry. */
    public const MAX = 10000;

    /**
     * Validation rules for an exchange-rate field.
     *
     * @param  bool  $required  true where the document is foreign-currency and
     *                          the rate is the thing making it one.
     */
    public static function rules(bool $required = false): array
    {
        return [
            $required ? 'required' : 'nullable',
            'numeric',
            'gt:0',
            'max:' . self::MAX,
        ];
    }

    /** Messages that say what to do, rather than quoting the rule. */
    public static function messages(string $field = 'exchange_rate'): array
    {
        return [
            "{$field}.gt"  => 'Exchange rate must be greater than 0.',
            "{$field}.max" => 'Exchange rate looks wrong — the highest allowed is '
                . number_format(self::MAX) . '. Check for a misplaced decimal.',
        ];
    }
}
