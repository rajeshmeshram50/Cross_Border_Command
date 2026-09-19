<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// T&C rows matched products by segment NAME; a name can belong to a Less and a Highly
// segment, so the resolved ids (name + tier + branch) become what the PI/PO fetch matches.
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('clm_tnc_library')) return;
        if (!Schema::hasColumn('clm_tnc_library', 'segment_ids')) {
            Schema::table('clm_tnc_library', fn (Blueprint $t) => $t->json('segment_ids')->nullable()->after('segment'));
        }
        if (!Schema::hasTable('clm_segments')) return;

        DB::table('clm_tnc_library')->whereNotNull('segment')->where('segment', '<>', '')
            ->select('id', 'client_id', 'branch_id', 'segment', 'regulatory')
            ->orderBy('id')
            ->chunkById(500, function ($rows) {
                foreach ($rows as $row) {
                    $tier = mb_strtolower(trim((string) $row->regulatory));
                    $ids = [];
                    foreach (array_filter(array_map('trim', explode(',', (string) $row->segment))) as $name) {
                        $q = DB::table('clm_segments')
                            ->whereRaw('LOWER(TRIM(name)) = ?', [mb_strtolower($name)])
                            ->where(fn ($w) => $w->where('client_id', $row->client_id)->orWhereNull('client_id'));
                        if ($tier !== '') $q->whereRaw('LOWER(TRIM(regulatory_status)) = ?', [$tier]);
                        $id = $q->orderByRaw('CASE WHEN branch_id = ? THEN 0 WHEN branch_id IS NULL THEN 1 ELSE 2 END', [$row->branch_id])
                            ->orderBy('id')->value('id');
                        if ($id && !in_array((int) $id, $ids, true)) $ids[] = (int) $id;
                    }
                    DB::table('clm_tnc_library')->where('id', $row->id)->update(['segment_ids' => $ids ? json_encode($ids) : null]);
                }
            });
    }

    public function down(): void
    {
        if (Schema::hasTable('clm_tnc_library') && Schema::hasColumn('clm_tnc_library', 'segment_ids')) {
            Schema::table('clm_tnc_library', fn (Blueprint $t) => $t->dropColumn('segment_ids'));
        }
    }
};
