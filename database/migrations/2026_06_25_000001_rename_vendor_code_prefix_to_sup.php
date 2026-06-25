<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Rename the supplier (vendor) code prefix from "V-" to "SUP-".
 * Only the LEADING "V-" is replaced (anchored ^V-), so "V-08" → "SUP-08"
 * without touching any "V" elsewhere in the value. Idempotent — re-running
 * is a no-op because the WHERE no longer matches once renamed.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("UPDATE vendors SET vendor_code = regexp_replace(vendor_code, '^V-', 'SUP-') WHERE vendor_code LIKE 'V-%'");
    }

    public function down(): void
    {
        DB::statement("UPDATE vendors SET vendor_code = regexp_replace(vendor_code, '^SUP-', 'V-') WHERE vendor_code LIKE 'SUP-%'");
    }
};
