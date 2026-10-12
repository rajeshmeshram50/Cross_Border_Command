<?php

use Database\Seeders\InventoryProductFlagSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · Put the packing screen's three flags into every branch's master.
 *
 * The rules live in InventoryProductFlagSeeder, which this only calls: the
 * same list has to be reachable two ways — once here, so an existing install
 * gets it on migrate, and on demand afterwards, since a branch created later
 * starts with an empty master and needs the seeder run again:
 *
 *   php artisan db:seed --class=InventoryProductFlagSeeder
 *
 * Two copies of the list would be two things to keep in step, and the one that
 * drifted would be the one nobody ran.
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
                ->where('flag_name', $name)
                ->where('purpose', $purpose)
                ->where('status', 1)
                ->delete();
        }
    }
};
