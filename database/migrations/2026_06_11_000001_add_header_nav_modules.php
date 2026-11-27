<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('modules')->where('slug', 'hr')->whereNull('parent_id')
            ->update(['name' => 'HRMS', 'updated_at' => now()]);
        DB::table('modules')->where('slug', 'clm')->whereNull('parent_id')
            ->update(['name' => 'CLM', 'updated_at' => now()]);

        $newModules = [
            ['slug' => 'credentials-vault', 'name' => 'Credentials Vault',           'icon' => 'KeyRound',    'description' => 'Central store for tenant credentials, secrets & access keys', 'sort_order' => 14],
            ['slug' => 'project-navigator', 'name' => 'Project Navigator',           'icon' => 'Compass',     'description' => 'Cross-module project workspace',                              'sort_order' => 15],
            ['slug' => 'p2p',               'name' => 'Procure to Pay (P2P)',        'icon' => 'ShoppingBag', 'description' => 'Procure-to-pay summary & operations',                         'sort_order' => 16],
            ['slug' => 'gts',               'name' => 'GTS (E-Docs)',                'icon' => 'Globe',       'description' => 'Global trade services & electronic trade documents',          'sort_order' => 17],
            ['slug' => 'inventory',         'name' => 'Inventory Management System', 'icon' => 'Boxes',       'description' => 'Stock, warehouse & movement tracking',                        'sort_order' => 18],
        ];

        foreach ($newModules as $mod) {
            if (DB::table('modules')->where('slug', $mod['slug'])->exists()) {
                continue;
            }
            DB::table('modules')->insert([
                'parent_id'    => null,
                'name'         => $mod['name'],
                'slug'         => $mod['slug'],
                'icon'         => $mod['icon'],
                'description'  => $mod['description'],
                'route_name'   => null,
                'route_prefix' => null,
                'sort_order'   => $mod['sort_order'],
                'is_active'    => true,
                'is_default'   => false,
                'created_at'   => now(),
                'updated_at'   => now(),
            ]);
        }
    }

    public function down(): void
    {
        $slugs = ['credentials-vault', 'project-navigator', 'p2p', 'gts', 'inventory'];

        $ids = DB::table('modules')->whereIn('slug', $slugs)->pluck('id');
        if ($ids->isNotEmpty()) {
            DB::table('permissions')->whereIn('module_id', $ids)->delete();
            DB::table('modules')->whereIn('id', $ids)->delete();
        }

        DB::table('modules')->where('slug', 'hr')->whereNull('parent_id')
            ->update(['name' => 'HR', 'updated_at' => now()]);
        DB::table('modules')->where('slug', 'clm')->whereNull('parent_id')
            ->update(['name' => 'Central CLM', 'updated_at' => now()]);
    }
};
