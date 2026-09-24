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
 * BRANCH SCOPE. Master codes restart per BRANCH (every branch has its own
 * KYC-001), and each branch keeps its own segment rules and its own customers /
 * suppliers. Matching on client + code alone therefore reported a document
 * a branch had only just created as "in use by Segment Rules" whenever a
 * SIBLING branch referenced its own document with the same code — the
 * CLM-master bug reported on the production data (Vortex India's KYC-001…006,
 * DD-001/002, TL-001, QC-001/002, all flagged by Head Office references).
 *
 * So every reference is recorded under the branch it belongs to — a rule's own
 * branch_id, an upload's OWNER's branch_id (segment_doc_uploads carries none of
 * its own) — and a document is matched against:
 *   · a branch-owned document → references in its own branch, plus client-level
 *     (branch-less) references, which every branch can see;
 *   · a client-level document (branch_id null) → references anywhere in the
 *     client, as before, since every branch can use a shared document.
 * Anything whose branch cannot be resolved counts as client-level, so the
 * delete guard only ever errs towards "in use", never towards "free".
 *
 * destroy() uses these same sets, so the list's flag and the delete guard give
 * the same answer.
 */
trait ChecksClmDocUsage
{
    /** Bucket key for a branch id: null (client-level) → 'shared'. */
    protected static function clmBranchKey($branchId): string
    {
        return $branchId === null ? 'shared' : (string) (int) $branchId;
    }

    /**
     * Is `$key` referenced from the scope a row with `$branchId` lives in?
     * `$byBranch` is a [branchKey => [key => true]] map.
     */
    protected static function clmUsageHas(array $byBranch, $branchId, string $key): bool
    {
        if ($branchId === null) {
            foreach ($byBranch as $set) {
                if (isset($set[$key])) return true;
            }
            return false;
        }
        return isset($byBranch[self::clmBranchKey($branchId)][$key])
            || isset($byBranch['shared'][$key]);
    }

    /**
     * Owner tables of segment_doc_uploads, keyed by uploadable_type — the same
     * set SegmentDocUploadController::TYPE_MAP resolves. Each carries branch_id.
     */
    protected static function clmUploadOwnerTables(): array
    {
        return [
            \App\Models\Customer::class  => 'customers',
            \App\Models\Consignee::class => 'consignees',
            \App\Models\Vendor::class    => 'vendors',
            \App\Models\Product::class   => 'products',
        ];
    }

    /**
     * Document CODES referenced by each source, grouped by branch.
     * Shape: ['rules' => [branchKey => [code => true]], 'uploads' => [branchKey => [code => true]]]
     */
    protected function clmDocUsageSets(?int $clientId): array
    {
        $rules = $uploads = [];

        if (Schema::hasTable('clm_segment_rules') && Schema::hasColumn('clm_segment_rules', 'doc_selections')) {
            $q = DB::table('clm_segment_rules');
            if ($clientId) $q->where('client_id', $clientId);

            /* Segment names, so the delete refusal can say WHERE the document is
               used. "In use by Segment Rules" with nothing else to go on reads
               as wrong to whoever is trying to delete it — they have no way to
               find the rule holding it. */
            $segNames = [];
            if (Schema::hasTable('clm_segments')) {
                $sq = DB::table('clm_segments');
                if ($clientId) $sq->where('client_id', $clientId);
                foreach ($sq->get(['id', 'name']) as $s) $segNames[(int) $s->id] = (string) $s->name;
            }

            foreach ($q->get(['branch_id', 'doc_selections', 'segment_id']) as $r) {
                $arr = is_array($r->doc_selections) ? $r->doc_selections : (json_decode((string) $r->doc_selections, true) ?: []);
                $bk  = self::clmBranchKey($r->branch_id);
                /* Shape is { kyc: {CODE: 'M'}, dd: {...}, tl: {...}, qc: {...} }.
                   Every bucket is walked rather than just the caller's own, so
                   one trait serves all four masters and a code filed under an
                   unexpected key is still found — the per-row version matched
                   on `LIKE '%"CODE"%'` across the whole blob, which behaved
                   the same way. */
                $where = $segNames[(int) ($r->segment_id ?? 0)] ?? null;
                foreach ($arr as $bucket) {
                    if (is_array($bucket)) {
                        foreach (array_keys($bucket) as $code) {
                            $code = (string) $code;
                            if (!isset($rules[$bk][$code])) $rules[$bk][$code] = [];
                            if ($where !== null && $where !== '') $rules[$bk][$code][$where] = true;
                        }
                    }
                }
            }
        }

        if (Schema::hasTable('segment_doc_uploads') && Schema::hasColumn('segment_doc_uploads', 'doc_code')) {
            $owners = self::clmUploadOwnerTables();
            foreach ($owners as $class => $table) {
                // LEFT join: an upload whose owner row is gone has no branch to
                // file it under, so it lands in 'shared' rather than vanishing.
                $q = DB::table('segment_doc_uploads as u')
                    ->leftJoin("{$table} as o", 'o.id', '=', 'u.uploadable_id')
                    ->where('u.uploadable_type', $class)
                    ->whereNotNull('u.doc_code')
                    ->distinct();
                if ($clientId) $q->where('u.client_id', $clientId);
                foreach ($q->get(['o.branch_id', 'u.doc_code']) as $r) {
                    $uploads[self::clmBranchKey($r->branch_id)][(string) $r->doc_code] = true;
                }
            }
            // Any other owner type has no known branch — client-level.
            $q = DB::table('segment_doc_uploads')
                ->whereNotIn('uploadable_type', array_keys($owners))
                ->whereNotNull('doc_code')
                ->distinct();
            if ($clientId) $q->where('client_id', $clientId);
            foreach ($q->pluck('doc_code') as $c) $uploads['shared'][(string) $c] = true;
        }

        return ['rules' => $rules, 'uploads' => $uploads];
    }

    /**
     * Human-readable sources this code appears in, for a document owned by
     * `$branchId` (null = client-level). Empty => safe to delete.
     */
    protected function clmDocUsageLabels(array $sets, ?string $code, $branchId): array
    {
        if (!$code) return [];
        $labels = [];
        if (self::clmUsageHas($sets['rules'], $branchId, $code)) {
            $where = self::clmUsageWhere($sets['rules'], $branchId, $code);
            $labels[] = $where ? 'Segment Rules for ' . implode(', ', $where) : 'Segment Rules';
        }
        if (self::clmUsageHas($sets['uploads'], $branchId, $code)) $labels[] = 'Segment Doc Uploads';
        return $labels;
    }

    /**
     * The segment names holding `$code`, at most three and each kept short —
     * a segment name can be hundreds of characters and this lands in a tooltip.
     */
    protected static function clmUsageWhere(array $byBranch, $branchId, string $code): array
    {
        $buckets = $branchId === null
            ? array_values($byBranch)
            : [$byBranch[self::clmBranchKey($branchId)] ?? [], $byBranch['shared'] ?? []];

        $names = [];
        foreach ($buckets as $set) {
            foreach (array_keys(is_array($set[$code] ?? null) ? $set[$code] : []) as $n) {
                $n = (string) $n;
                $names[mb_strlen($n) > 30 ? mb_substr($n, 0, 30) . '…' : $n] = true;
            }
        }

        $names = array_keys($names);
        if (count($names) > 3) {
            $rest  = count($names) - 3;
            $names = array_slice($names, 0, 3);
            $names[] = '+' . $rest . ' more';
        }
        return $names;
    }
}
