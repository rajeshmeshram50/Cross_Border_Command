<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Rename Proforma Invoice codes from the legacy "INV/{FY}/{SEQ}" prefix to
 * "PI/{FY}/{SEQ}" so the displayed PI code reads "PI/..." (matches the
 * documented PI/<FY>/<SEQ> convention). Only the prefix changes — the FY and
 * sequence number are preserved, so no collisions and numbering stays intact.
 *
 * REPLACE() targets the leading "INV/" only (the string never recurs later in
 * a code), and works on both MySQL and PostgreSQL.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('proforma_invoices')
            ->where('code', 'like', 'INV/%')
            ->update(['code' => DB::raw("REPLACE(code, 'INV/', 'PI/')")]);
    }

    public function down(): void
    {
        DB::table('proforma_invoices')
            ->where('code', 'like', 'PI/%')
            ->update(['code' => DB::raw("REPLACE(code, 'PI/', 'INV/')")]);
    }
};
