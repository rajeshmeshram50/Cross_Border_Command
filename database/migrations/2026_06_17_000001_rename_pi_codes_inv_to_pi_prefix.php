<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

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
