<?php

use Database\Seeders\InventoryProductFlagSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · One Cold Chain, not one per branch.
 *
 * 2026_10_12_000006 seeded the three flags into EVERY branch, which gave the
 * same flag a different id in each one. A box stores the flag id, so that is
 * not a cosmetic difference: a screen that fetched the flags for the wrong
 * branch wrote an id the box's own branch had never heard of, and the
 * cold-chain guard could not find it — the temperature range was then refused
 * on a carton the packer had marked.
 *
 * They move to platform level instead: client_id and branch_id both null, one
 * row per flag, visible to every tenant and editable by none of them.
 *
 * ONLY UNTOUCHED COPIES ARE REMOVED — same name, same purpose, still active,
 * and not named by any box item's `flags`. A flag someone renamed, re-worded,
 * switched off or packed a carton against is theirs and stays exactly where it
 * is; it simply sits beside the shared one. Nothing is remapped, because
 * rewriting an id a carton already carries is how a packed box quietly changes
 * what it says.
 */
return new class extends Migration
{
    public function up(): void
    {
        // The platform rows first, so nothing is without a flag in between.
        (new InventoryProductFlagSeeder())->run();

        /* Every flag id any box item still points at. The column is a json
           array, so the ids are read out and flattened rather than joined. */
        $inUse = DB::table('p2p_spi_box_items')
            ->whereNotNull('flags')
            ->pluck('flags')
            ->flatMap(fn ($v) => json_decode((string) $v, true) ?: [])
            ->map(fn ($v) => (int) $v)
            ->unique()
            ->all();

        foreach (InventoryProductFlagSeeder::DEFAULTS as $name => $purpose) {
            DB::table('inventory_product_flags')
                ->whereNotNull('client_id')      // never the new platform rows
                ->where('flag_name', $name)
                ->where('purpose', $purpose)     // untouched wording
                ->where('status', 1)             // not switched off by anyone
                ->when($inUse, fn ($q) => $q->whereNotIn('id', $inUse))
                ->delete();
        }
    }

    public function down(): void
    {
        /* Not reversible in any useful sense: the per-branch rows are gone and
           re-creating them would hand out NEW ids, which is the problem this
           migration exists to remove. The platform rows stay — they are
           harmless, and 000006's own down() removes them. */
    }
};
