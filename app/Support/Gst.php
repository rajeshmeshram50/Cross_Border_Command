<?php

namespace App\Support;

use App\Models\Branch;
use App\Models\Masters\StateCodes;
use Illuminate\Support\Facades\Auth;
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

    /** Maharashtra — assumed home state when a branch has no GSTIN on file. */
    public const DEFAULT_HOME_STATE_CODE = '27';

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


    public static function stateCodeFor(?string $stateName, $user = null): ?string
    {
        $name = trim((string) $stateName);
        if ($name === '') return null;

        $user     = $user ?: Auth::user();
        $clientId = $user?->client_id ?? optional($user?->branch)->client_id;
        $branchId = $user?->branch_id;

        /* Explicit join with a ::text cast rather than whereHas('state', …).
         * master_state_codes.state_id is varchar while master_states.id is
         * bigint, and Postgres refuses `varchar = bigint` — the relation's
         * generated subquery throws SQLSTATE[42883]. Every other join against
         * this table in the codebase casts for the same reason. */
        $code = StateCodes::query()
            ->from('master_state_codes as sc')
            ->join('master_states as s', DB::raw('s.id::text'), '=', DB::raw('sc.state_id::text'))
            ->whereRaw('LOWER(sc.status) = ?', ['active'])
            ->whereRaw('LOWER(s.name) = ?', [mb_strtolower($name)])
            /* Visible = the statutory globals, plus this tenant's own rows.
             * Mirrors MasterVisibility::applyBranchScope, hand-written here
             * because that helper writes unqualified column names and this
             * query is aliased + joined, which would make `client_id`
             * ambiguous to Postgres. */
            ->where(function ($w) use ($clientId, $branchId) {
                $w->whereNull('sc.client_id');
                if ($clientId !== null) {
                    $w->orWhere(function ($ww) use ($clientId, $branchId) {
                        $ww->where('sc.client_id', $clientId)
                            ->where(function ($wb) use ($branchId) {
                                $wb->whereNull('sc.branch_id');
                                if ($branchId !== null) $wb->orWhere('sc.branch_id', $branchId);
                            });
                    });
                }
            })
            // Global > client-level > branch-level. Keep in step with
            // StateCodes::scopeStatutoryFirst().
            ->orderByRaw('CASE WHEN sc.client_id IS NULL THEN 0 WHEN sc.branch_id IS NULL THEN 1 ELSE 2 END')
            ->orderBy('sc.id')
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

    /**
     * OUR OWN registered GST state code, for a branch.
     *
     * This is the other half of place-of-supply: a sale is intra-state
     * (CGST + SGST) when the buyer's state code equals this, and inter-state
     * (IGST) when it doesn't. Prefers the branch's explicit `gst_state_code`,
     * then derives it from the branch GSTIN.
     *
     * Falls back to Maharashtra when the branch has neither on file — matching
     * PurchaseOrderController/SupplierPurchaseInvoiceController, which each
     * carry their own copy of this rule and default the same way. Those two
     * predate this helper and still have private versions; new callers should
     * use this one.
     */
    public static function homeStateCode(?int $branchId): string
    {
        $branch = $branchId ? Branch::find($branchId) : null;
        $code = trim((string) (optional($branch)->gst_state_code ?: ''));
        if ($code === '') {
            $code = (string) (self::stateCodeFromGstin(optional($branch)->gst_number) ?? '');
        }

        return $code !== '' ? $code : self::DEFAULT_HOME_STATE_CODE;
    }
}
