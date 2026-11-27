<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->where('is_system', false)
            ->delete();
    }

    public function down(): void
    {
    }
};
