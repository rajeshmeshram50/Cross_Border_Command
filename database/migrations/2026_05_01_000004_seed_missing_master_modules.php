<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Backfill modules + permissions for masters that exist in code/DB but were
 * never registered in the `modules` table. Without these rows the master
 * never appears in the Permissions UI, so client_admins can't grant access
 * to it — the menu item stays hidden even when the user has "all
 * permissions".
 *
 * Currently covers `master.kpis` and `master.legal_entities`. Idempotent on
 * both halves: skips inserts when the module already exists, and skips
 * permission rows that already match (user_id, module_id).
 */
return new class extends Migration
{
    public function up(): void
    {
        $parentId = DB::table('modules')->where('slug', 'master.identity')->value('id');
        if (!$parentId) return;

        $missing = [
            ['slug' => 'master.kpis',           'name' => 'KPIs',           'icon' => 'Target', 'description' => 'KPI catalogue mapped to roles'],
            ['slug' => 'master.legal_entities', 'name' => 'Legal Entities', 'icon' => 'Scale',  'description' => 'Registered legal entities + bank accounts'],
        ];

        foreach ($missing as $row) {
            $existingId = DB::table('modules')->where('slug', $row['slug'])->value('id');
            $moduleId = $existingId ?: DB::table('modules')->insertGetId([
                'parent_id'    => $parentId,
                'name'         => $row['name'],
                'slug'         => $row['slug'],
                'icon'         => $row['icon'],
                'description'  => $row['description'],
                'route_name'   => null,
                'route_prefix' => null,
                'sort_order'   => 99,
                'is_active'    => true,
                'is_default'   => false,
                'created_at'   => now(),
                'updated_at'   => now(),
            ]);

            // Backfill permissions: copy each existing user's flag set from
            // their `master.departments` row (peer master under the same
            // parent). Without this, admins who already had "all permissions"
            // still wouldn't see the new menu items because their permissions
            // map has no entry for the new modules.
            $deptModuleId = DB::table('modules')->where('slug', 'master.departments')->value('id');
            if (!$deptModuleId) continue;

            $sourceRows = DB::table('permissions')->where('module_id', $deptModuleId)->get();
            $existingUserIds = DB::table('permissions')
                ->where('module_id', $moduleId)
                ->pluck('user_id')
                ->all();
            $existingSet = array_flip($existingUserIds);

            $now = now();
            $insert = [];
            foreach ($sourceRows as $r) {
                if (isset($existingSet[$r->user_id])) continue;
                $insert[] = [
                    'user_id'    => $r->user_id,
                    'client_id'  => $r->client_id,
                    'branch_id'  => $r->branch_id,
                    'role'       => $r->role,
                    'module_id'  => $moduleId,
                    'can_view'   => $r->can_view,
                    'can_add'    => $r->can_add,
                    'can_edit'   => $r->can_edit,
                    'can_delete' => $r->can_delete,
                    'can_export' => $r->can_export,
                    'can_import' => $r->can_import,
                    'can_approve' => $r->can_approve,
                    'granted_by' => $r->granted_by,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
            foreach (array_chunk($insert, 500) as $chunk) {
                DB::table('permissions')->insert($chunk);
            }
        }
    }

    public function down(): void
    {
        $slugs = ['master.kpis', 'master.legal_entities'];
        $ids = DB::table('modules')->whereIn('slug', $slugs)->pluck('id');
        if ($ids->isNotEmpty()) {
            DB::table('permissions')->whereIn('module_id', $ids)->delete();
            DB::table('modules')->whereIn('id', $ids)->delete();
        }
    }
};
