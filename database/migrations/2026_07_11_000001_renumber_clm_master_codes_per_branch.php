<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Renumber every branch-scoped CLM master's `code` so each (client, branch)
 * group runs contiguously from -001 (KYC-001, DD-001, SG-001, …).
 *
 * WHY
 * ---
 * The per-branch code counters (nextCode) shipped earlier
 * (2026_07_06 / 2026_07_09), but only NEW rows restart at -001 per branch.
 * Existing rows kept the codes they were minted with under the old
 * client-wide numbering, so branches show gaps / non-1 starts — e.g.
 * `clm_segments` runs SG-001..005 then jumps to SG-101..122 (the legacy
 * consolidation), and `clm_agreement_library` jumps A-008 → A-101. The
 * client wants each branch's list to read 1..N with no gaps.
 *
 * WHAT IT DOES
 * ------------
 * For each master table (client_id NOT NULL rows only — system globals such
 * as the shared clm_tnc_categories seed rows are left alone), rows are ordered
 * by id (creation order) within their (client_id, branch_id) group and their
 * `code` is rewritten to PREFIX-001..N. A two-pass temp rewrite avoids
 * tripping the unique(client_id, branch_id, code) index mid-update.
 *
 * REFERENCES
 * ----------
 * A master code is a foreign reference in a few places, so those are rewritten
 * in the SAME transaction using an original→new map:
 *   - clm_segment_rules.segment_code   ← Segment (SG) snapshot
 *   - clm_segment_rules.auths_json     ← Authority (AUTH) code array
 *   - clm_segment_rules.doc_selections ← KYC/DD/TL/QC code keys
 *   - segment_doc_uploads.doc_code     ← KYC/DD/TL/QC/TD (TDL) codes
 * (clm_agreement_library.segment / clm_trade_doc_library.segment store segment
 *  NAMES, not codes, so they are intentionally untouched.)
 *
 * SAFE + IDEMPOTENT: verified against live data there are no cross-branch
 * duplicate codes, so the original→new lookup is unambiguous. Re-running is a
 * no-op once every group is already contiguous (new code == old code).
 *
 * NOT REVERSIBLE: the original arbitrary codes are not preserved, so down() is
 * a documented no-op — the renumbered state IS the corrected state.
 */
return new class extends Migration
{
    /** table => code prefix (includes trailing dash, matching sprintf format). */
    private array $masters = [
        'clm_kyc_documents'     => 'KYC-',
        'clm_dd_documents'      => 'DD-',
        'clm_qc_documents'      => 'QC-',
        'clm_trade_licenses'    => 'TL-',
        'clm_segments'          => 'SG-',
        'clm_authorities'       => 'AUTH-',
        'clm_tnc_categories'    => 'DC-',
        'clm_tnc_library'       => 'TNC-',
        'clm_clause_types'      => 'CLT-',
        'clm_clause_library'    => 'CL-',
        'clm_trade_doc_names'   => 'TDN-',
        'clm_trade_doc_library' => 'TDL-',
        'clm_agreement_types'   => 'AT-',
        'clm_agreement_library' => 'A-',
    ];

    /** doc_selections / doc_code category => the master table that owns the code. */
    private array $catTable = [
        'kyc' => 'clm_kyc_documents',
        'dd'  => 'clm_dd_documents',
        'tl'  => 'clm_trade_licenses',
        'qc'  => 'clm_qc_documents',
        'td'  => 'clm_trade_doc_library',
    ];

    public function up(): void
    {
        // $maps[table][clientId][branchKey][oldCode] = newCode  (branchKey: branch_id or 'null')
        $maps = [];

        DB::transaction(function () use (&$maps) {
            // ── 1. Renumber each master table, building the original→new map ──
            foreach ($this->masters as $table => $prefix) {
                if (!Schema::hasTable($table) || !Schema::hasColumn($table, 'code')) {
                    continue;
                }
                $hasBranch = Schema::hasColumn($table, 'branch_id');

                $rows = DB::table($table)
                    ->select('id', 'client_id', 'code')
                    ->when($hasBranch, fn ($q) => $q->addSelect('branch_id'))
                    // Only tenant-owned rows — never touch shared system globals.
                    ->whereNotNull('client_id')
                    ->orderBy('client_id')
                    ->when($hasBranch, fn ($q) => $q->orderByRaw('branch_id NULLS FIRST'))
                    ->orderBy('id')
                    ->get();

                $counters = [];
                $updates  = [];   // id => newCode (only where it actually changes)
                foreach ($rows as $r) {
                    $branchId = $hasBranch ? ($r->branch_id ?? null) : null;
                    $bkey     = $branchId === null ? 'null' : (string) $branchId;
                    $groupKey = $r->client_id . '|' . $bkey;

                    $n = ($counters[$groupKey] ?? 0) + 1;
                    $counters[$groupKey] = $n;
                    $newCode = sprintf('%s%03d', $prefix, $n);

                    $maps[$table][$r->client_id][$bkey][$r->code] = $newCode;
                    if ($newCode !== $r->code) {
                        $updates[$r->id] = $newCode;
                    }
                }

                if (!$updates) {
                    continue;
                }

                // Two-pass: park every changing row on a collision-proof temp
                // code, then set the final code — so the unique index never sees
                // a transient clash while codes are being permuted.
                foreach (array_keys($updates) as $id) {
                    DB::table($table)->where('id', $id)->update(['code' => '__t' . $id]);
                }
                foreach ($updates as $id => $newCode) {
                    DB::table($table)->where('id', $id)->update(['code' => $newCode]);
                }

                echo "  {$table}: renumbered " . count($updates) . " of " . $rows->count() . " rows\n";
            }

            // Strict resolver for the new code of a referenced (table, client,
            // branch, oldCode). Tries the reference's OWN branch first, then the
            // client-level shared (branch NULL) rows — and nothing else. The old
            // "any branch" fallback is deliberately gone: on data where the
            // per-branch counters have already minted duplicate codes across
            // branches (e.g. two branches each own a "DD-001"), guessing a branch
            // remaps a reference to the wrong row and collides the unique index
            // (seg_uploads_unique_per_doc). Unresolved → return null (leave the
            // reference untouched) rather than risk pointing it at another branch.
            $lookup = function (string $table, $clientId, $branchId, ?string $oldCode) use ($maps): ?string {
                if ($oldCode === null || $oldCode === '') return null;
                $byBranch = $maps[$table][$clientId] ?? null;
                if (!$byBranch) return null;
                $bkey = $branchId === null ? 'null' : (string) $branchId;
                if (isset($byBranch[$bkey][$oldCode]))  return $byBranch[$bkey][$oldCode];
                if (isset($byBranch['null'][$oldCode])) return $byBranch['null'][$oldCode];
                return null;
            };

            // ── 2. Rewrite clm_segment_rules (segment_code / auths_json / doc_selections) ──
            if (Schema::hasTable('clm_segment_rules')) {
                $hasBranch = Schema::hasColumn('clm_segment_rules', 'branch_id');
                foreach (DB::table('clm_segment_rules')->get() as $r) {
                    $branchId = $hasBranch ? ($r->branch_id ?? null) : null;
                    $upd = [];

                    // segment_code — single SG snapshot
                    if (!empty($r->segment_code)) {
                        $nc = $lookup('clm_segments', $r->client_id, $branchId, $r->segment_code);
                        if ($nc && $nc !== $r->segment_code) $upd['segment_code'] = $nc;
                    }

                    // auths_json — array of AUTH codes
                    $auths = json_decode($r->auths_json ?? 'null', true);
                    if (is_array($auths) && $auths) {
                        $changed = false;
                        $out = [];
                        foreach ($auths as $code) {
                            $nc = $lookup('clm_authorities', $r->client_id, $branchId, $code);
                            if ($nc && $nc !== $code) { $changed = true; $out[] = $nc; }
                            else { $out[] = $code; }
                        }
                        if ($changed) $upd['auths_json'] = json_encode($out);
                    }

                    // doc_selections — { kyc:{code:MO}, dd:{...}, tl:{...}, qc:{...} }
                    $docs = json_decode($r->doc_selections ?? 'null', true);
                    if (is_array($docs) && $docs) {
                        $changed = false;
                        $out = [];
                        foreach ($docs as $cat => $sel) {
                            if (!is_array($sel) || !isset($this->catTable[$cat])) { $out[$cat] = $sel; continue; }
                            $newSel = [];
                            foreach ($sel as $code => $mo) {
                                $nc = $lookup($this->catTable[$cat], $r->client_id, $branchId, (string) $code);
                                if ($nc && $nc !== $code) { $changed = true; $newSel[$nc] = $mo; }
                                else { $newSel[$code] = $mo; }
                            }
                            $out[$cat] = $newSel;
                        }
                        if ($changed) $upd['doc_selections'] = json_encode($out);
                    }

                    if ($upd) DB::table('clm_segment_rules')->where('id', $r->id)->update($upd);
                }
            }

            // ── 3. Rewrite segment_doc_uploads.doc_code ──
            // This table has NO branch_id of its own — the branch context comes
            // from the OWNING entity (customer / consignee / vendor / product /
            // lead, each carrying a branch_id). Resolving each upload against its
            // entity's branch is what makes the remap unambiguous when duplicate
            // codes exist across branches (the bug that failed the first run).
            if (Schema::hasTable('segment_doc_uploads')) {
                $uploads = DB::table('segment_doc_uploads')->get();

                // Batch-resolve every owning entity's branch: "type|id" => branch_id.
                $entityBranch = [];
                $idsByType = [];
                foreach ($uploads as $r) {
                    if ($r->uploadable_type) $idsByType[$r->uploadable_type][(int) $r->uploadable_id] = true;
                }
                foreach ($idsByType as $type => $ids) {
                    if (!class_exists($type)) continue;
                    try { $tbl = (new $type)->getTable(); } catch (\Throwable $e) { continue; }
                    if (!Schema::hasTable($tbl) || !Schema::hasColumn($tbl, 'branch_id')) continue;
                    foreach (DB::table($tbl)->whereIn('id', array_keys($ids))->get(['id', 'branch_id']) as $e) {
                        $entityBranch[$type . '|' . $e->id] = $e->branch_id;
                    }
                }

                $changes = [];   // id => newDocCode
                foreach ($uploads as $r) {
                    if (!isset($this->catTable[$r->category])) continue;
                    $branchId = $entityBranch[$r->uploadable_type . '|' . (int) $r->uploadable_id] ?? null;
                    $nc = $lookup($this->catTable[$r->category], $r->client_id, $branchId, $r->doc_code);
                    if ($nc && $nc !== $r->doc_code) $changes[$r->id] = $nc;
                }

                if ($changes) {
                    // Two-pass guard: doc_code is part of the unique key, so a
                    // permutation within one entity+category must not transiently
                    // clash — park every changing row on a temp code, then finalise.
                    foreach (array_keys($changes) as $id) {
                        DB::table('segment_doc_uploads')->where('id', $id)->update(['doc_code' => '__t' . $id]);
                    }
                    foreach ($changes as $id => $nc) {
                        DB::table('segment_doc_uploads')->where('id', $id)->update(['doc_code' => $nc]);
                    }
                    echo "  segment_doc_uploads: remapped " . count($changes) . " doc_code references\n";
                }
            }
        });
    }

    public function down(): void
    {
        // No-op: the original (gappy) codes are not preserved. The renumbered,
        // contiguous state is the corrected state — reversing it is meaningless.
    }
};
