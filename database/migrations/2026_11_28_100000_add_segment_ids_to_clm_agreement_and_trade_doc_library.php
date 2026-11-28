<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Agreement and Trade Document libraries: store the segment ids next to the
 * segment text, like clm_tnc_library already does.
 *
 * The `segment` text is left exactly as it is. Ids are resolved branch-wise
 * (same rule as App\Support\LibrarySegments::idsFor):
 *   - a row with a branch looks at that branch's segments + client-wide ones
 *     (no branch); a row without a branch looks at all the client's segments;
 *   - every name (or code) in the text must resolve to exactly ONE segment in
 *     that scope, otherwise the row keeps segment_ids NULL and goes on
 *     matching by name exactly as before.
 * Safe to run twice; down() only drops the new column.
 */
return new class extends Migration {
    private const TABLES = ['clm_agreement_library', 'clm_trade_doc_library'];

    public function up(): void
    {
        foreach (self::TABLES as $table) {
            if (!Schema::hasTable($table)) continue;
            if (!Schema::hasColumn($table, 'segment_ids')) {
                Schema::table($table, fn (Blueprint $t) => $t->json('segment_ids')->nullable()->after('segment'));
            }
        }
        if (!Schema::hasTable('clm_segments')) return;

        foreach (self::TABLES as $table) {
            if (!Schema::hasTable($table)) continue;

            DB::table($table)->whereNull('segment_ids')
                ->whereNotNull('segment')->where('segment', '<>', '')
                ->select('id', 'client_id', 'branch_id', 'segment')
                ->orderBy('id')
                ->chunkById(500, function ($rows) use ($table) {
                    foreach ($rows as $row) {
                        $tokens = [];
                        foreach (explode(',', (string) $row->segment) as $t) {
                            $t = mb_strtolower(trim($t));
                            if ($t !== '' && !in_array($t, $tokens, true)) $tokens[] = $t;
                        }
                        if (!$tokens || !$row->client_id) continue;

                        $segments = DB::table('clm_segments')
                            ->where('client_id', $row->client_id)
                            ->when($row->branch_id, fn ($q) => $q->where(fn ($w) => $w->where('branch_id', $row->branch_id)->orWhereNull('branch_id')))
                            ->where(function ($q) use ($tokens) {
                                $q->whereIn(DB::raw('LOWER(TRIM(name))'), $tokens)
                                  ->orWhereIn(DB::raw('LOWER(TRIM(code))'), $tokens);
                            })
                            ->orderBy('id')
                            ->get(['id', 'name', 'code']);

                        // Every name must resolve to exactly one segment, else keep NULL.
                        $ids = [];
                        foreach ($tokens as $t) {
                            $hits = $segments->filter(fn ($s) => mb_strtolower(trim((string) $s->name)) === $t
                                || mb_strtolower(trim((string) $s->code)) === $t);
                            if ($hits->count() !== 1) { $ids = []; break; }
                            $id = (int) $hits->first()->id;
                            if (!in_array($id, $ids, true)) $ids[] = $id;
                        }

                        if ($ids) {
                            DB::table($table)->where('id', $row->id)->update(['segment_ids' => json_encode($ids)]);
                        }
                    }
                });
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table) {
            if (Schema::hasTable($table) && Schema::hasColumn($table, 'segment_ids')) {
                Schema::table($table, fn (Blueprint $t) => $t->dropColumn('segment_ids'));
            }
        }
    }
};
