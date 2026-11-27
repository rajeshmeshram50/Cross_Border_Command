<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('employees')
            ->whereNotNull('legal_entity_id')
            ->whereNotNull('branch_id')
            ->update(['legal_entity_id' => DB::raw('branch_id')]);

        DB::table('employees')
            ->whereNotNull('legal_entity_id')
            ->whereNull('branch_id')
            ->update(['legal_entity_id' => null]);
    }

    public function down(): void
    {
        DB::table('employees')->update(['legal_entity_id' => null]);
    }
};
