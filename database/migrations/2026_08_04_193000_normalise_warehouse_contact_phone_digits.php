<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Warehouse Master: normalise contact_phone to digits only.
 *
 * Contact Phone now validates as 7-15 digits (no "+", spaces or symbols). Every
 * seeded row stored "+91 98100 0000N", which fails that rule — so opening ANY
 * existing warehouse to edit an unrelated field (say City) would have been
 * blocked by a validation error on a field the user never touched.
 *
 * Stripping the separators is lossless: "+91 98100 00001" → "919810000001",
 * the same number, still dialable. A value that does NOT land inside 7-15
 * digits after stripping is left exactly as it was — better to keep an odd
 * value than to silently rewrite it into something wrong.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (DB::table('master_warehouse_master')->get(['id', 'contact_phone']) as $row) {
            $raw = trim((string) $row->contact_phone);
            if ($raw === '') continue;
            if (preg_match('/^[0-9]{7,15}$/', $raw)) continue;      // already clean

            $digits = preg_replace('/\D/', '', $raw);
            if (!preg_match('/^[0-9]{7,15}$/', (string) $digits)) continue;   // can't fix safely

            DB::table('master_warehouse_master')->where('id', $row->id)
                ->update(['contact_phone' => $digits]);
        }
    }

    public function down(): void
    {
        // Irreversible by design: the original separator formatting isn't stored
        // anywhere, and the digits themselves are unchanged, so there is nothing
        // meaningful to restore.
    }
};
