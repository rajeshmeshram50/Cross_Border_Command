<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Re-prefix supplier (vendor) codes SUP-NN -> S-NNN (zero-padded to 3).
 *
 * vendors.vendor_code is the source of truth shown in Supplier Management.
 * product_vendor_maps.vendor_code is a denormalised DISPLAY copy (the real link
 * is product_vendor_maps.vendor_id), so we refresh its SUP- rows for display
 * consistency but leave the pre-existing legacy V- snapshots untouched.
 *
 * Only ^SUP-\d+$ rows are rewritten, so a re-run (or an already-migrated env)
 * is a no-op. The numeric suffix is preserved (SUP-08 -> S-008).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('vendors')
            ->whereRaw("vendor_code ~ '^SUP-[0-9]+$'")
            ->update(['vendor_code' => DB::raw("'S-' || lpad(regexp_replace(vendor_code, '\\D', '', 'g'), 3, '0')")]);

        DB::table('product_vendor_maps')
            ->whereRaw("vendor_code ~ '^SUP-[0-9]+$'")
            ->update(['vendor_code' => DB::raw("'S-' || lpad(regexp_replace(vendor_code, '\\D', '', 'g'), 3, '0')")]);
    }

    public function down(): void
    {
        DB::table('vendors')
            ->whereRaw("vendor_code ~ '^S-[0-9]+$'")
            ->update(['vendor_code' => DB::raw("'SUP-' || lpad(regexp_replace(vendor_code, '\\D', '', 'g'), 2, '0')")]);

        DB::table('product_vendor_maps')
            ->whereRaw("vendor_code ~ '^S-[0-9]+$'")
            ->update(['vendor_code' => DB::raw("'SUP-' || lpad(regexp_replace(vendor_code, '\\D', '', 'g'), 2, '0')")]);
    }
};
