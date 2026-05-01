<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Idempotently inserts the `master.employees` module row for existing envs.
 * The full ModuleSeeder also defines this row for fresh installs; this
 * migration just guarantees it exists without re-seeding everything.
 */
return new class extends Migration
{
    public function up(): void
    {
        $exists = DB::table('modules')->where('slug', 'master.employees')->exists();
        if ($exists) return;

        $parentId = DB::table('modules')->where('slug', 'master.identity')->value('id');

        DB::table('modules')->insert([
            'parent_id'    => $parentId,
            'name'         => 'Employees',
            'slug'         => 'master.employees',
            'icon'         => 'Users',
            'description'  => 'Employee master with login provisioning',
            'route_name'   => null,
            'route_prefix' => null,
            // Push to the end of the master.identity group; concrete sort_order
            // value isn't critical because the seeder rewrites these on full reseed.
            'sort_order'   => 99,
            'is_active'    => true,
            'is_default'   => false,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('modules')->where('slug', 'master.employees')->delete();
    }
};
