<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Segments were stored by NAME; two segments may now share a name (Less / Highly
// Regulated), so the IDs become the source of truth. `segment` stays, derived from the IDs.
return new class extends Migration {
    public function up(): void
    {
        foreach (['customers', 'consignees'] as $table) {
            if (!Schema::hasTable($table) || Schema::hasColumn($table, 'segment_ids')) continue;
            Schema::table($table, function (Blueprint $t) {
                $t->json('segment_ids')->nullable()->after('segment');
            });
        }

        $this->backfill('customers');
        $this->backfill('consignees');
    }

    public function down(): void
    {
        foreach (['customers', 'consignees'] as $table) {
            if (Schema::hasTable($table) && Schema::hasColumn($table, 'segment_ids')) {
                Schema::table($table, fn (Blueprint $t) => $t->dropColumn('segment_ids'));
            }
        }
    }

    /** Resolve each stored name to a segment id; a name held by two segments takes the older one. */
    private function backfill(string $table): void
    {
        if (!Schema::hasTable($table) || !Schema::hasTable('clm_segments')) return;

        DB::table($table)->whereNotNull('segment')->where('segment', '<>', '')
            ->select('id', 'client_id', 'branch_id', 'segment')
            ->orderBy('id')
            ->chunkById(500, function ($rows) use ($table) {
                foreach ($rows as $row) {
                    $ids = [];
                    foreach (array_filter(array_map('trim', explode(',', (string) $row->segment))) as $name) {
                        $id = DB::table('clm_segments')
                            ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower($name)])
                            ->where(fn ($q) => $q->where('client_id', $row->client_id)->orWhereNull('client_id'))
                            // Same branch first, then client-level, then the oldest row.
                            ->orderByRaw('CASE WHEN branch_id = ? THEN 0 WHEN branch_id IS NULL THEN 1 ELSE 2 END', [$row->branch_id])
                            ->orderBy('id')
                            ->value('id');
                        if ($id && !in_array((int) $id, $ids, true)) $ids[] = (int) $id;
                    }
                    DB::table($table)->where('id', $row->id)->update(['segment_ids' => $ids ? json_encode($ids) : null]);
                }
            });
    }
};
