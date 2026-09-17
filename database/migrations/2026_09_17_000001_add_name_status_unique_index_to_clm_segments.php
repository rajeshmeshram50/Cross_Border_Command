<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// One segment per name + regulatory status per client/branch; "Sugar" may exist once as Less and once as Highly.
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('clm_segments') || DB::getDriverName() !== 'pgsql') return;

        DB::statement(
            'CREATE UNIQUE INDEX IF NOT EXISTS clm_segments_client_branch_name_status_unique
             ON clm_segments (client_id, COALESCE(branch_id, 0), LOWER(TRIM(name)), regulatory_status)'
        );
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') return;

        DB::statement('DROP INDEX IF EXISTS clm_segments_client_branch_name_status_unique');
    }
};
