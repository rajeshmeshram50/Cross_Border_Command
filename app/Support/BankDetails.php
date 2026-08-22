<?php

namespace App\Support;

/**
 * The one definition of "these bank details are payable".
 *
 * Two places decide whether an employee can be paid: the payment ADVICE
 * (PayrollPaymentController::buildAdvice, which Finance signs off) and the
 * DISBURSEMENT itself (PayrollService::disburseRun, which marks the payslip
 * Paid or holds it). They had drifted apart — the advice accepted any non-empty
 * account number and IFSC, while disbursement validated their format — so a
 * typo'd IFSC was counted as payable in the advice total and then held at
 * initiate. The signed-off batch total did not match what left the bank.
 *
 * Both now call this, so the advice's "Ready" set is the set that actually pays.
 *
 * Formats:
 *   IFSC    — 4 letters, then a 0, then 6 alphanumerics (RBI format).
 *   Account — 6 to 18 digits, whitespace ignored (HR often pastes it spaced).
 */
class BankDetails
{
    public const IFSC_PATTERN    = '/^[A-Z]{4}0[A-Z0-9]{6}$/';
    public const ACCOUNT_PATTERN = '/^\d{6,18}$/';

    /** Normalised IFSC — trimmed and upper-cased, '' when absent. */
    public static function normalizeIfsc(?string $ifsc): string
    {
        return strtoupper(trim((string) $ifsc));
    }

    /** Normalised account number — all whitespace stripped, '' when absent. */
    public static function normalizeAccount(?string $account): string
    {
        return preg_replace('/\s+/', '', (string) $account);
    }

    /** True only when BOTH the IFSC and the account number are well-formed. */
    public static function isValid(?string $ifsc, ?string $account): bool
    {
        return (bool) preg_match(self::IFSC_PATTERN, self::normalizeIfsc($ifsc))
            && (bool) preg_match(self::ACCOUNT_PATTERN, self::normalizeAccount($account));
    }
}
