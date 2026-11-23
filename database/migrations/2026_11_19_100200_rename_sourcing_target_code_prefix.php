<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('p2p_sourcing_targets')) {
            return;
        }

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
