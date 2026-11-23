<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

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
