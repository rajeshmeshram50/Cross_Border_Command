<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('inventory_racks')
            ->where('code', 'like', 'RK-%')
            ->update(['code' => DB::raw("'RC-' || substring(code from 4)")]);
    }

    public function down(): void
    {
        DB::table('inventory_racks')
            ->where('code', 'like', 'RC-%')
            ->update(['code' => DB::raw("'RK-' || substring(code from 4)")]);
    }
};
