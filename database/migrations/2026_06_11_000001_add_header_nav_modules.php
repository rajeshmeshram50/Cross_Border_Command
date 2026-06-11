<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Adds the new top-level header modules to the permission tree on existing
 * installs and renames two existing modules to match the header:
 *
 *   - HR          → HRMS   (slug stays 'hr')
 *   - Central CLM → CLM    (slug stays 'clm')
 *   + Credentials Vault            (slug 'credentials-vault')
 *   + Project Navigator            (slug 'project-navigator')
 *   + Procure to Pay (P2P)         (slug 'p2p')   — promoted from a Sales leaf
 *   + GTS (E-Docs)                 (slug 'gts')
 *   + Inventory Management System  (slug 'inventory')
 *
 * No permission rows are backfilled — the grant flow stays explicit
 * (super_admin → client_admin → branch_user → employee, per
 * PermissionController::savePermissions). Existing users simply see the new
 * modules in the Permissions page; nobody auto-receives access.
 *
 * Fully idempotent — re-running is a no-op for rows that already exist.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1. Rename existing top-levels to match the header labels.
        DB::table('modules')->where('slug', 'hr')->whereNull('parent_id')
            ->update(['name' => 'HRMS', 'updated_at' => now()]);
        DB::table('modules')->where('slug', 'clm')->whereNull('parent_id')
            ->update(['name' => 'CLM', 'updated_at' => now()]);

        // 2. New top-level modules. Page-less for now (the frontend renders a
        //    permission-gated stub); registered here so they appear in the
        //    Permissions matrix and grants cascade downstream.
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

        // Restore the original module names.
        DB::table('modules')->where('slug', 'hr')->whereNull('parent_id')
            ->update(['name' => 'HR', 'updated_at' => now()]);
        DB::table('modules')->where('slug', 'clm')->whereNull('parent_id')
            ->update(['name' => 'Central CLM', 'updated_at' => now()]);
    }
};
