<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Fold already-stored candidate emails to lowercase (CBC #67).
 *
 * Candidate::setEmailAttribute() normalises everything written from now on,
 * but rows captured before it existed keep whatever casing was typed. Without
 * this pass an environment ends up holding both representations, so CSV
 * exports and mail-merge stay inconsistent for the old rows.
 *
 * Safe to re-run: the WHERE makes it a no-op once the rows are folded.
 * Deliberately has no down() — lowercasing is not reversible, the original
 * casing is not recorded anywhere, and restoring it has no value.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('candidates')
            ->whereNotNull('email')
            ->whereRaw('email <> LOWER(email)')
            ->update(['email' => DB::raw('LOWER(email)')]);
    }

    public function down(): void
    {
        // Irreversible by design — see the class docblock.
    }
};
