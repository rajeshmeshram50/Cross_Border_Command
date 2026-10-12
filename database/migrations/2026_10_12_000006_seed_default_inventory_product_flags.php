<?php

use Database\Seeders\InventoryProductFlagSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · Put the packing screen's three flags in as platform defaults.
 *
 * The rules live in InventoryProductFlagSeeder, which this only calls: the
 * same list has to be reachable two ways — once here, so an existing install
 * gets it on migrate, and on demand afterwards. Two copies of the list would
 * be two things to keep in step, and the one that drifted would be the one
 * nobody ran.
 *
 *   php artisan db:seed --class=InventoryProductFlagSeeder
 *
 * Seeded once at platform level rather than per branch, so "Cold Chain" has
 * ONE id everywhere. The seeder says why that matters; the short version is
 * that a box stores the flag id, and per-branch copies gave the same flag a
 * different id in every branch.
 */
return new class extends Migration
{
    public function up(): void
    {
        (new InventoryProductFlagSeeder())->run();
    }

    public function down(): void
    {
        /* Only the untouched seeds go. A flag someone renamed, re-worded or
           switched off is theirs now, and box items point at these ids —
           deleting one in use would strip the flag off packed cartons with
           nothing to put back. */
        foreach (InventoryProductFlagSeeder::DEFAULTS as $name => $purpose) {
            DB::table('inventory_product_flags')
                // Platform rows only — a tenant's own flag of the same name is
                // theirs and is not this migration's to remove.
                ->whereNull('client_id')
                ->where('flag_name', $name)
                ->where('purpose', $purpose)
                ->where('status', 1)
                ->delete();
        }
    }
};
