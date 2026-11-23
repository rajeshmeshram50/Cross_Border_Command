<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

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
