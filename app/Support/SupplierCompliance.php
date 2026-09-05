<?php

namespace App\Support;

use App\Models\ClmAgreementLibrary;
use App\Models\ClmSegment;
use App\Models\ClmSegmentRule;
use App\Models\ClmSignatureRequest;
use App\Models\SegmentDocUpload;
use App\Models\Vendor;
use Illuminate\Support\Carbon;

/**
 * Is a supplier's mandatory document set complete and unexpired?
 *
 * Compliance used to be a value someone PICKED from the Compliance Behaviour
 * master — ten states, typed in by hand, and stale the moment a document
 * lapsed. It is now DERIVED, so it cannot disagree with the documents it is
 * meant to describe. Two values only: Compliant / Non Compliant.
 *
 * A supplier is Compliant when, for its own segments:
 *
 *   • every MANDATORY doc in KYC, Due Diligence, Trade Licences and Trade
 *     Documents has a file uploaded against it, and
 *   • no uploaded file's expiry date has passed, and
 *   • every applicable Supplier-party Agreement has a COMPLETED signature.
 *
 * Optional docs are ignored — that is what "mandatory document set" means, and
 * it matches the CLM card's own "X of Y" counter, which has always counted
 * requirement === 'M' only.
 *
 * WHAT COUNTS AS NOTHING TO CHECK: a supplier whose segments carry no rules
 * has no mandatory set, so there is nothing it can fail. It reads Compliant.
 * The alternative — Non Compliant until someone writes a DCP rule — would
 * report a red pill for every supplier in a tenant that has not set the module
 * up yet, which says nothing about the supplier.
 *
 * BULK BY DESIGN. This backs a paginated list AND its facet counts, so it is
 * never called per row: give it every id at once and it answers in a fixed
 * number of queries regardless of how many suppliers are asked about.
 */
class SupplierCompliance
{
    public const COMPLIANT     = 'Compliant';
    public const NON_COMPLIANT = 'Non Compliant';

    /** Upload-backed buckets. Agreements are signature-backed and handled apart. */
    private const DOC_CATEGORIES = ['kyc', 'dd', 'tl', 'td'];

    /**
     * @param  array<int>  $vendorIds
     * @return array<int, string>  vendor id => Compliant | Non Compliant
     */
    public static function statuses(array $vendorIds, int $clientId): array
    {
        $vendorIds = array_values(array_unique(array_map('intval', $vendorIds)));
        if (empty($vendorIds) || !$clientId) return [];

        $today = Carbon::today();

        /* 1. Each supplier's segments and trade type. The pivot is the real
              answer (a supplier can carry several segments); vendors.segment_id
              is the legacy scalar and only fills in when the pivot is empty. */
        $vendors = Vendor::query()
            ->whereIn('id', $vendorIds)
            ->with(['segments:id', 'primaryAddress:id,vendor_id,country_id', 'primaryAddress.country:id,name'])
            ->get(['id', 'segment_id']);

        $segIdsByVendor = [];
        $docTypeByVendor = [];
        foreach ($vendors as $v) {
            $ids = $v->segments->pluck('id')->map(fn ($x) => (int) $x)->unique()->values()->all();
            if (empty($ids) && $v->segment_id) $ids = [(int) $v->segment_id];
            $segIdsByVendor[$v->id] = $ids;

            $country = optional(optional($v->primaryAddress)->country)->name;
            $docTypeByVendor[$v->id] = trim((string) $country) === 'India' ? 'domestic' : 'international';
        }

        /* 2. Every rule for the tenant, indexed by segment then document type.
              One query for all of them — the alternative is a query per
              supplier, which is what makes a derived column tempting. */
        $rulesBySegment = [];
        foreach (ClmSegmentRule::where('client_id', $clientId)->get() as $rule) {
            $rulesBySegment[(int) $rule->segment_id][] = $rule;
        }

        /* 3. Uploads for all the suppliers at once, keyed the way the check
              asks for them: vendor => "category::code" => expiry. */
        $uploadsByVendor = [];
        SegmentDocUpload::query()
            ->where('uploadable_type', Vendor::class)
            ->whereIn('uploadable_id', $vendorIds)
            ->get(['uploadable_id', 'category', 'doc_code', 'expiry_date'])
            ->each(function ($u) use (&$uploadsByVendor) {
                $uploadsByVendor[(int) $u->uploadable_id][$u->category . '::' . $u->doc_code] = $u->expiry_date;
            });

        /* 4. Agreements: the applicable Supplier-party library rows per segment,
              plus each supplier's completed signatures. Both loaded whole and
              matched in PHP — the library is small and the segment match is a
              CSV LIKE that would otherwise be a query per segment. */
        $allSegIds = collect($segIdsByVendor)->flatten()->unique()->values()->all();
        $agreementsBySegment = self::agreementLibrary($clientId, $allSegIds);
        $signedByVendor      = self::signedAgreements($clientId, $vendorIds);

        /* 5. Evaluate. Every supplier asked about gets an answer, including any
              whose row was not returned above (deleted mid-request). */
        $out = [];
        foreach ($vendorIds as $vid) {
            $out[$vid] = self::evaluate(
                $segIdsByVendor[$vid] ?? [],
                $docTypeByVendor[$vid] ?? 'international',
                $rulesBySegment,
                $uploadsByVendor[$vid] ?? [],
                $agreementsBySegment,
                $signedByVendor[$vid] ?? [],
                $today
            );
        }
        return $out;
    }

    /** Convenience for a single supplier — still one call, not a loop. */
    public static function status(int $vendorId, int $clientId): string
    {
        return self::statuses([$vendorId], $clientId)[$vendorId] ?? self::COMPLIANT;
    }

    private static function evaluate(
        array $segIds,
        string $docType,
        array $rulesBySegment,
        array $uploads,
        array $agreementsBySegment,
        array $signed,
        Carbon $today
    ): string {
        /* Mandatory codes per category, unioned across the supplier's segments.
           One rule per segment: the one matching the supplier's trade type, or
           whatever the segment has when it carries only the other type — a
           supplier must not lose its documents because its segment was written
           before the domestic/international split. */
        $mandatory = [];
        foreach ($segIds as $sid) {
            $rules = $rulesBySegment[$sid] ?? [];
            if (empty($rules)) continue;
            $rule = null;
            foreach ($rules as $r) { if ($r->document_type === $docType) { $rule = $r; break; } }
            $rule = $rule ?? $rules[0];

            $sel = $rule->doc_selections ?? [];
            foreach (self::DOC_CATEGORIES as $cat) {
                $entries = $sel[$cat] ?? [];
                if (!is_array($entries)) continue;
                foreach ($entries as $code => $req) {
                    if ($req === 'M') $mandatory[$cat . '::' . $code] = true;
                }
            }
        }

        // Every mandatory doc needs a file, and that file must not have lapsed.
        foreach (array_keys($mandatory) as $key) {
            if (!array_key_exists($key, $uploads)) return self::NON_COMPLIANT;
            $expiry = $uploads[$key];
            if ($expiry && Carbon::parse($expiry)->lt($today)) return self::NON_COMPLIANT;
        }

        /* An OPTIONAL doc that was uploaded and has since expired also fails.
           Expiry is about the evidence on file, not about whether the DCP asked
           for it: a lapsed licence sitting in the vault is not a clean supplier
           just because the rule marked it optional. */
        foreach ($uploads as $expiry) {
            if ($expiry && Carbon::parse($expiry)->lt($today)) return self::NON_COMPLIANT;
        }

        /* Applicable agreements must be signed, and that signature still in
           date. Expiry lives on the SIGNATURE, not the library row — the
           library defines the agreement, the request is the executed copy. */
        foreach ($segIds as $sid) {
            foreach ($agreementsBySegment[$sid] ?? [] as $agrId) {
                if (!array_key_exists($agrId, $signed)) return self::NON_COMPLIANT;
                $exp = $signed[$agrId];
                if ($exp && Carbon::parse($exp)->lt($today)) return self::NON_COMPLIANT;
            }
        }

        return self::COMPLIANT;
    }

    /**
     * Supplier-applicable agreement library rows, grouped by the segment they
     * belong to.
     *
     * @return array<int, array<int>>  segment id => agreement library ids
     */
    private static function agreementLibrary(int $clientId, array $segIds): array
    {
        if (empty($segIds)) return [];

        $segments = ClmSegment::where('client_id', $clientId)->whereIn('id', $segIds)->get();
        if ($segments->isEmpty()) return [];

        $library = ClmAgreementLibrary::where('client_id', $clientId)
            ->where('agr_status', 'Active')
            ->get();
        if ($library->isEmpty()) return [];

        $bySegment = [];
        foreach ($segments as $seg) {
            $ids = [];
            foreach ($library as $row) {
                if ((string) $row->regulatory !== (string) $seg->regulatory_status) continue;
                if (!self::segmentMatches($row->segment, $seg->name, $seg->code)) continue;
                if (!self::supplierApplicable($row->party)) continue;
                $ids[] = (int) $row->id;
            }
            $bySegment[(int) $seg->id] = $ids;
        }
        return $bySegment;
    }

    /**
     * The library stores its segments as a CSV of names or codes, so membership
     * is a token match rather than an FK. Mirrors the LIKE ladder in
     * SegmentDocUploadController::matchSegmentLibrary(), done in PHP because
     * this runs once for the whole library instead of once per segment.
     */
    private static function segmentMatches(?string $csv, ?string $name, ?string $code): bool
    {
        $tokens = array_filter(array_map(fn ($t) => strtolower(trim($t)), explode(',', (string) $csv)));
        foreach ([$name, $code] as $needle) {
            $needle = strtolower(trim((string) $needle));
            if ($needle !== '' && in_array($needle, $tokens, true)) return true;
        }
        return false;
    }

    /**
     * A blank party means "every party". A doc that names parties but none of
     * them is a Supplier does not apply here. Mirrors
     * SegmentDocUploadController::supplierApplicable().
     */
    private static function supplierApplicable(?string $party): bool
    {
        $tokens = array_filter(array_map(fn ($t) => strtolower(trim($t)), explode(',', (string) $party)));
        if (empty($tokens)) return true;
        foreach ($tokens as $t) {
            if ($t === 'supplier' || str_starts_with($t, 'supplier')) return true;
        }
        return false;
    }

    /**
     * Agreement library ids each supplier has a COMPLETED signature for. An
     * agreement signed on ANY of the supplier's deals counts as done, which is
     * the same rule the Evidence Vault applies.
     *
     * @return array<int, array<int, mixed>>  vendor id => [agreement id => signature expiry]
     */
    private static function signedAgreements(int $clientId, array $vendorIds): array
    {
        $rows = ClmSignatureRequest::query()
            ->where('client_id', $clientId)
            ->where('model_name', 'Vendor')
            ->where('document_type', ClmSignatureRequest::DOC_AGREEMENT)
            ->where('status', 'completed')
            // party_id, not model_id: model_name says WHICH table, party_id the row.
            ->whereIn('party_id', $vendorIds)
            ->orderBy('id')                       // later request wins on a re-sign
            ->get(['id', 'party_id', 'trade_doc_id', 'trade_doc_ids', 'expiry_date']);

        $out = [];
        foreach ($rows as $r) {
            $ids = is_array($r->trade_doc_ids) && $r->trade_doc_ids ? $r->trade_doc_ids : [$r->trade_doc_id];
            foreach ((array) $ids as $id) {
                $id = (int) $id;
                if ($id) $out[(int) $r->party_id][$id] = $r->expiry_date;
            }
        }
        return $out;
    }
}
