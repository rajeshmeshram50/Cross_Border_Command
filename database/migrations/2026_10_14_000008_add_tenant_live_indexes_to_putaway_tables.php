<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · The branch-wide reads get an index that leads with the tenant.
 *
 * Every query against these tables arrives with the tenant filter already on it
 * — BelongsToTenant puts client_id, and usually branch_id, into the WHERE
 * before anything else is asked. The indexes written with the tables lead with
 * a location (shelf_id, zone_id, warehouse_id), which serves the questions
 * asked ABOUT ONE PLACE, and those are the hot path.
 *
 * What had nothing behind it is the question asked about a BRANCH: everything
 * this branch currently has stored, everything it currently holds locked. Those
 * would fall back to the plain warehouse_id index and read every released row
 * in the history to throw it away.
 *
 * Partial, for the same reason as the others: a branch's live rows stay the
 * size of the branch, while its released rows grow forever.
 */
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
        /* The task queue already has (branch_id, status) and a branch belongs
           to one client, so it needs nothing — noted here so the asymmetry
           reads as a decision rather than an omission. */
    }

    public function down(): void
    {
        DB::statement('drop index if exists idx_occ_tenant_live');
        DB::statement('drop index if exists idx_loc_lock_tenant_live');
    }
};
