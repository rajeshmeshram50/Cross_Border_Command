<?php

namespace App\Support;

use App\Models\Masters\StateCodes;
use Illuminate\Support\Facades\DB;

/**
 * Single source of truth for "is this party domestic, and does GST apply?".
 *
 * The rule is one line — India means GST applies, anything else means it
 * doesn't — but it had been re-typed in three places (ConsigneeController's
 * private isDomesticCountry(), AddCustomerModal's isDomesticCountry(), and
 * implicitly in CustomerController's required_if rules). Sales and P2P are
 * about to read `customers.gst_applicable` too, so the rule now lives here
 * and every caller derives from it rather than re-deciding.
 *
 * IMPORTANT: `gst_applicable` is DERIVED, never accepted from a request. The
 * frontend computes it for display, but the controllers overwrite whatever
 * arrives with applicableFor(country) before validating — otherwise the
 * invariant would only hold for saves that came through our own modal.
 */
final class Gst
{
    /** India == domestic. Everything else is international. */
    public const DOMESTIC_COUNTRY = 'India';

    /**
     * A blank/unknown country is NOT domestic. Callers that need to tell
     * "international" apart from "not answered yet" must check the country
     * themselves — this only answers the domestic question.
     */
    public static function isDomestic(?string $country): bool
    {
        return trim((string) $country) === self::DOMESTIC_COUNTRY;
    }

    /** The stored `gst_applicable` value for a party in $country. */
    public static function applicableFor(?string $country): string
    {
        return self::isDomestic($country) ? 'Yes' : 'No';
    }

    /**
     * GST state code for a state NAME (e.g. "Maharashtra" → "27").
     *
     * Matched case-insensitively on the name because addresses store the
     * state as free text, not as an id. Returns null when the master has no
     * code for the state — callers must treat that as "unknown", not "0".
     *
     * Only reads globally-seeded rows (client_id IS NULL): GST state codes
     * are statutory, identical for every tenant, and seeded that way.
     */
    public static function stateCodeFor(?string $stateName): ?string
    {
        $name = trim((string) $stateName);
        if ($name === '') return null;

        /* Explicit join with a ::text cast rather than whereHas('state', …).
         * master_state_codes.state_id is varchar while master_states.id is
         * bigint, and Postgres refuses `varchar = bigint` — the relation's
         * generated subquery throws SQLSTATE[42883]. Every other join against
         * this table in the codebase casts for the same reason. */
        $code = StateCodes::query()
            ->from('master_state_codes as sc')
            ->join('master_states as s', DB::raw('s.id::text'), '=', DB::raw('sc.state_id::text'))
            ->whereNull('sc.client_id')
            ->whereRaw('LOWER(sc.status) = ?', ['active'])
            ->whereRaw('LOWER(s.name) = ?', [mb_strtolower($name)])
            ->value('sc.state_code');

        return $code !== null ? (string) $code : null;
    }

    /**
     * The first two characters of a GSTIN are its state code — 27AADCI…
     * is a Maharashtra registration. Returns null for anything that isn't
     * shaped like a GSTIN, so callers can't mistake garbage for a code.
     */
    public static function stateCodeFromGstin(?string $gstin): ?string
    {
        $v = strtoupper(trim((string) $gstin));
        return preg_match('/^[0-9]{2}/', $v) ? substr($v, 0, 2) : null;
    }
}
