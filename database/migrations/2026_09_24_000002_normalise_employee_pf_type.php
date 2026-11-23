<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('employees')
            || !Schema::hasColumn('employees', 'pf_type')
            || !Schema::hasColumn('employees', 'pf_eligible')) {
            return;
        }

        DB::table('employees')
            ->where('pf_eligible', true)
            ->whereNull('pf_type')
            ->update(['pf_type' => 'statutory']);

        DB::table('employees')
            ->whereNotNull('pf_type')
            ->where(fn ($q) => $q->where('pf_eligible', false)->orWhereNull('pf_eligible'))
            ->update(['pf_type' => null]);
    }

    public function down(): void
    {
    }
};
