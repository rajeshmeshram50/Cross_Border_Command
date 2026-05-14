<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Registers the "Trigger Point Master" leaf under HR > Document & Evidence
 * and back-fills permission rows for every user who already has full master
 * access (donor: master.leave_type, another branch-scoped HR master).
 * Mirrors 2026_05_13_000003_seed_master_attendance_modules.php.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Parent — HR > Document & Evidence category. Created by ModuleSeeder
        // already; if missing on a fresh install we silently bail.
        $parentId = DB::table('modules')->where('slug', 'hr.documents')->value('id');
        if (!$parentId) return;

        $slug = 'master.trigger_point';
        $existing = DB::table('modules')->where('slug', $slug)->value('id');

        $moduleId = $existing ?: DB::table('modules')->insertGetId([
            'parent_id'    => $parentId,
            'name'         => 'Trigger Point Master',
            'slug'         => $slug,
            'icon'         => 'Zap',
            'description'  => 'Define lifecycle trigger modules for document generation',
            'route_name'   => null,
            'route_prefix' => null,
            'sort_order'   => 99,
            'is_active'    => true,
            'is_default'   => false,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        // Copy permission rows from a peer master so existing users who
        // already had blanket "all masters" access don't lose visibility on
        // the new leaf. leave_type is a recent, tenant-scoped HR master so
        // its permission set is the closest analogue.
        $donorId = DB::table('modules')->where('slug', 'master.leave_type')->value('id');
        if (!$donorId) return;

        $donorRows = DB::table('permissions')->where('module_id', $donorId)->get();
        if ($donorRows->isEmpty()) return;

        $existingUserIds = DB::table('permissions')
            ->where('module_id', $moduleId)
            ->pluck('user_id')
            ->all();
        $skip = array_flip($existingUserIds);

        $now = now();
        $insert = [];
        foreach ($donorRows as $r) {
            if (isset($skip[$r->user_id])) continue;
            $insert[] = [
                'user_id'     => $r->user_id,
                'client_id'   => $r->client_id,
                'branch_id'   => $r->branch_id,
                'role'        => $r->role,
                'module_id'   => $moduleId,
                'can_view'    => $r->can_view,
                'can_add'     => $r->can_add,
                'can_edit'    => $r->can_edit,
                'can_delete'  => $r->can_delete,
                'can_export'  => $r->can_export,
                'can_import'  => $r->can_import,
                'can_approve' => $r->can_approve,
                'granted_by'  => $r->granted_by,
                'created_at'  => $now,
                'updated_at'  => $now,
            ];
        }
        foreach (array_chunk($insert, 500) as $chunk) {
            DB::table('permissions')->insert($chunk);
        }
    }

    public function down(): void
    {
        $id = DB::table('modules')->where('slug', 'master.trigger_point')->value('id');
        if ($id) {
            DB::table('permissions')->where('module_id', $id)->delete();
            DB::table('modules')->where('id', $id)->delete();
        }
    }
};
