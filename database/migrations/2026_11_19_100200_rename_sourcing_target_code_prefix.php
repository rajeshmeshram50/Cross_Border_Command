<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sourcing target codes are ST-001, not SRC-001 (per the Figma).
 *
 * The generator now emits ST-; this carries the rows created before it over so
 * the tracker does not show two code shapes side by side. The sequence number
 * is kept exactly as it was — only the prefix changes, so SRC-012 becomes
 * ST-012 and nothing is re-numbered. Nothing parses or joins on this string,
 * it is only generated and displayed.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('p2p_sourcing_targets')) {
            return;
        }

        // Soft-deleted rows are rewritten too: the code counter is a count of
        // all rows including trashed ones, so a stale SRC- row would still be
        // visible wherever trashed targets are listed.
        DB::table('p2p_sourcing_targets')
            ->where('code', 'like', 'SRC-%')
            ->update(['code' => DB::raw("CONCAT('ST-', SUBSTRING(code, 5))")]);
    }

    public function down(): void
    {
        if (! Schema::hasTable('p2p_sourcing_targets')) {
            return;
        }

        DB::table('p2p_sourcing_targets')
            ->where('code', 'like', 'ST-%')
            ->update(['code' => DB::raw("CONCAT('SRC-', SUBSTRING(code, 4))")]);
    }
};
