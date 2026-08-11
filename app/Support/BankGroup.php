<?php

namespace App\Support;

/**
 * Splits a payroll disbursement into the two batches a company actually files
 * with its bank: employees who bank with HDFC (same-bank / internal transfer,
 * no NEFT charge, settles immediately) and everyone else (outbound NEFT).
 *
 * The whole point of this class is that the "is this HDFC?" question is asked
 * in exactly ONE place. The bank column on a payslip is free text typed by HR
 * ("HDFC", "hdfc bank", "H.D.F.C. Bank Ltd"), so matching it ad-hoc at each
 * call site is how a batch quietly ends up short a few employees.
 */
final class BankGroup
{
    public const HDFC  = 'hdfc';
    public const OTHER = 'other';
    public const ALL   = 'all';

    /** IFSC bank code allocated to HDFC Bank Ltd. */
    private const HDFC_IFSC_CODE = 'HDFC';

    /**
     * Name spellings that mean HDFC once punctuation and spacing are stripped.
     * Matched as substrings, so "HDFC BANK LTD", "hdfc-bank" and "H.D.F.C."
     * all collapse onto the first token.
     */
    private const HDFC_NAME_TOKENS = [
        'HDFC',
        'HOUSINGDEVELOPMENTFINANCECORPORATION',
    ];

    /**
     * Is this employee an HDFC account holder?
     *
     * The IFSC wins whenever it carries a usable bank code — it is the actual
     * routing key the bank settles on, so an IFSC of SBIN0001234 is a State
     * Bank account no matter what someone typed in the bank-name box. Only a
     * missing or malformed IFSC falls back to the free-text name.
     */
    public static function isHdfc(?string $bankName, ?string $ifsc): bool
    {
        $code = substr(self::alnum($ifsc), 0, 4);
        // A plausible 4-letter bank code is trusted outright; anything shorter
        // or numeric is a typo/placeholder and must not silently answer "other".
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

    /** Which batch this employee belongs to. */
    public static function of(?string $bankName, ?string $ifsc): string
    {
        return self::isHdfc($bankName, $ifsc) ? self::HDFC : self::OTHER;
    }

    /** Does a row in $group belong in a batch prepared for $filter? */
    public static function matches(string $filter, string $group): bool
    {
        return $filter === self::ALL || $filter === $group;
    }

    /** Normalize a user-supplied group, defaulting to "everyone". */
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

    /** Batch-reference prefix — HDFC settles internally, others go out by NEFT. */
    public static function batchPrefix(string $group): string
    {
        return match ($group) {
            self::HDFC  => 'HDFC',
            self::OTHER => 'NEFT',
            default     => 'PAY',
        };
    }

    /** Uppercase A–Z + 0–9 only. */
    private static function alnum(?string $v): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) $v) ?? '');
    }

    /** Uppercase A–Z only — drops the dots/spaces in "H.D.F.C. Bank". */
    private static function letters(?string $v): string
    {
        return strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $v) ?? '');
    }
}
