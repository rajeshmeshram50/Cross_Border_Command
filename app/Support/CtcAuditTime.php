<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * Display-timezone conversion for a CTC agreement's audit trail (versions /
 * clarifications / approvers).
 *
 * Those timestamps are stored PRE-FORMATTED in UTC — `now()->format('d M Y H:i')`
 * at write time (CtcContractController::pushVersion, ClmSignatureController::
 * ctcPushVersion) — and shifted to the display timezone on read.
 *
 * Why this lives here instead of in a controller: BOTH
 * CtcContractController::show() and ClmSignatureController::ctcSignatureStatus()
 * feed the SAME Review Timeline — the SPA polls one or the other depending on
 * whether a Zoho request is live. When the two controllers each kept their own
 * hand-maintained copy of this logic, only one got the UTC→IST fix, so the
 * timeline's times jumped by 5:30 as the poll switched endpoints (CBC-574). The
 * old copies carried a "keep these two in sync" comment; this is that single
 * copy, so they cannot drift again.
 *
 * DISPLAY ONLY. Convert AFTER any save() — never before — or the IST string is
 * persisted and the next read shifts it a second time.
 */
class CtcAuditTime
{
    /** Same convention as AttendanceController::DISPLAY_TZ. */
    public const DISPLAY_TZ = 'Asia/Kolkata';

    /**
     * Convert one stored UTC string. Date-only strings stay date-only; strings
     * carrying a time get shifted. Returns the input unchanged on parse failure.
     */
    public static function str(?string $s): string
    {
        if ($s === null || $s === '' || $s === '—') return $s ?? '—';
        try {
            $hasTime = (bool) preg_match('/\d{1,2}:\d{2}/', $s);
            $c = Carbon::parse($s, 'UTC')->setTimezone(self::DISPLAY_TZ);
            return $hasTime ? $c->format('d M Y H:i') : $c->format('d M Y');
        } catch (\Throwable $e) {
            return $s;
        }
    }

    /** Convert the date / acted_at / response_date fields in a list of entries. */
    public static function entries($arr): array
    {
        return array_map(function ($e) {
            if (is_array($e)) {
                foreach (['date', 'acted_at', 'response_date'] as $k) {
                    if (!empty($e[$k])) $e[$k] = self::str($e[$k]);
                }
            }
            return $e;
        }, array_values($arr ?? []));
    }
}
