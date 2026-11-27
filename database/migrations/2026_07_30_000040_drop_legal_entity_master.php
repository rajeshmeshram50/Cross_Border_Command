<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('master_legal_entity_banks');
        Schema::dropIfExists('master_legal_entities');

        $moduleIds = DB::table('modules')->where('slug', 'master.legal_entities')->pluck('id');
        if ($moduleIds->isEmpty()) {
            return;
        }

        DB::table('permissions')->whereIn('module_id', $moduleIds)->delete();
        if (Schema::hasTable('plan_modules')) {
            DB::table('plan_modules')->whereIn('module_id', $moduleIds)->delete();
        }
        DB::table('modules')->whereIn('id', $moduleIds)->delete();
    }

    public function down(): void
    {
    }
};
