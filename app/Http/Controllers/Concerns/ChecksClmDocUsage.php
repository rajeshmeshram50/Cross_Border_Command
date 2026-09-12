<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Is this document referenced anywhere?" for the CLM document masters
 * (KYC, DD, Trade Licenses, QC), computed ONCE per request.
 *
 * Each of those controllers used to answer it per ROW, inside the index loop:
 * one row meant two existence queries plus four Schema::hasTable/hasColumn
 * calls, and each Schema call is its own hit on information_schema. Twenty
 * rows came to 182 queries and the cost grew with the master — which is what
 * made those pages take ten seconds and more on real data.
 *
 * The referencing tables are small and bounded (segment rules, segment doc
 * uploads), and they do not grow with the master being listed. Reading each
 * one ONCE and matching in memory turns the whole loop into hash lookups, so
 * the query count stops depending on the row count.
 *
 * NOTE ON SCOPE: the per-row version passed each row's own `client_id`, which
 * for a client-level (shared, client_id null) row meant "used by ANY tenant".
 * These sets are scoped to the VIEWING tenant, so a shared row now reports
 * whether THIS client uses it — more useful, and it is only a display flag.
 * The delete guard is unchanged: destroy() still runs its own per-row check
 * with the original semantics, so nothing about deletion safety moves.
 */
trait ChecksClmDocUsage
{
    /**
     * Sets of document CODES referenced by each source.
     * Shape: ['rules' => [code => true], 'uploads' => [code => true]]
     */
    protected function clmDocUsageSets(?int $clientId): array
    {
        $rules = $uploads = [];

        if (Schema::hasTable('clm_segment_rules') && Schema::hasColumn('clm_segment_rules', 'doc_selections')) {
            $q = DB::table('clm_segment_rules');
            if ($clientId) $q->where('client_id', $clientId);
            foreach ($q->pluck('doc_selections') as $j) {
                $arr = is_array($j) ? $j : (json_decode((string) $j, true) ?: []);
                /* Shape is { kyc: {CODE: 'M'}, dd: {...}, tl: {...}, qc: {...} }.
                   Every bucket is walked rather than just the caller's own, so
                   one trait serves all four masters and a code filed under an
                   unexpected key is still found — the per-row version matched
                   on `LIKE '%"CODE"%'` across the whole blob, which behaved
                   the same way. */
                foreach ($arr as $bucket) {
                    if (is_array($bucket)) {
                        foreach (array_keys($bucket) as $code) $rules[(string) $code] = true;
                    }
                }
            }
        }

        if (Schema::hasTable('segment_doc_uploads') && Schema::hasColumn('segment_doc_uploads', 'doc_code')) {
            $q = DB::table('segment_doc_uploads')->whereNotNull('doc_code')->distinct();
            if ($clientId) $q->where('client_id', $clientId);
            foreach ($q->pluck('doc_code') as $c) $uploads[(string) $c] = true;
        }

        return ['rules' => $rules, 'uploads' => $uploads];
    }

    /** Human-readable sources this code appears in. Empty => safe to delete. */
    protected function clmDocUsageLabels(array $sets, ?string $code): array
    {
        if (!$code) return [];
        $labels = [];
        if (isset($sets['rules'][$code]))   $labels[] = 'Segment Rules';
        if (isset($sets['uploads'][$code])) $labels[] = 'Segment Doc Uploads';
        return $labels;
    }
}
