<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement(
            "create index idx_occ_tenant_live on inventory_location_occupancy
             (client_id, branch_id) where status in ('reserved','occupied')"
        );
        DB::statement(
            "create index idx_loc_lock_tenant_live on inventory_location_locks
             (client_id, branch_id) where released_at is null"
        );
    }

    public function down(): void
    {
        DB::statement('drop index if exists idx_occ_tenant_live');
        DB::statement('drop index if exists idx_loc_lock_tenant_live');
    }
};
