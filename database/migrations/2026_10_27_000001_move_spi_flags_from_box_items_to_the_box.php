<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Handling flags belong to the carton, not to each line inside it.
 *
 * The packing screen has only ever offered ONE flag picker per box, and
 * Step3BoxPackaging copied that single list onto every item in the payload —
 * so a three-line carton stored three identical arrays and the box itself
 * stored nothing. "What are this box's flags" had no column to answer from;
 * every reader re-derived it by flattening the items and deduping.
 *
 * p2p_spi_box_items.flags is KEPT, and simply stops being written. Dropping it
 * would make this backfill irreversible, and a genuinely per-line flag is a
 * reasonable thing to want later.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('p2p_spi_boxes', 'flags')) {
            Schema::table('p2p_spi_boxes', function (Blueprint $table) {
                // json, like the column it replaces, so the cast and every
                // reader behave identically.
                $table->json('flags')->nullable()->after('temp_max_c');
            });
        }

        /* Backfill: each box takes the union of its items' flags.
         *
         * A union rather than "the first item's list" because nothing ever
         * enforced that the copies matched — the API accepted per-line flags
         * even though no UI produced them. Taking the union cannot lose a
         * flag that was genuinely set. */
        DB::table('p2p_spi_box_items')
            ->whereNull('deleted_at')
            ->orderBy('box_id')
            ->get(['box_id', 'flags'])
            ->groupBy('box_id')
            ->each(function ($rows, $boxId) {
                $ids = $rows
                    ->flatMap(fn ($r) => (array) json_decode((string) $r->flags, true))
                    ->map(fn ($v) => (int) $v)
                    ->filter()
                    ->unique()
                    ->sort()
                    ->values()
                    ->all();

                if (!$ids) return;

                DB::table('p2p_spi_boxes')->where('id', $boxId)->update([
                    'flags' => json_encode($ids),
                ]);
            });
    }

    public function down(): void
    {
        /* The item column was never cleared, so dropping this one puts the
           data back exactly where the readers used to look. */
        if (Schema::hasColumn('p2p_spi_boxes', 'flags')) {
            Schema::table('p2p_spi_boxes', function (Blueprint $table) {
                $table->dropColumn('flags');
            });
        }
    }
};
