<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

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
