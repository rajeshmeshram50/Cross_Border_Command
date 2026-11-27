<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $parentId = DB::table('modules')->where('slug', 'master.operations')->value('id');
        if (!$parentId) return;

        $slug = 'master.expense_category';
        $existingId = DB::table('modules')->where('slug', $slug)->value('id');
        $moduleId = $existingId ?: DB::table('modules')->insertGetId([
            'parent_id'    => $parentId,
            'name'         => 'Expense Categories',
            'slug'         => $slug,
            'icon'         => 'IndianRupee',
            'description'  => 'Classify expenses with monthly & yearly policy limits',
            'route_name'   => null,
            'route_prefix' => null,
            'sort_order'   => 99,
            'is_active'    => true,
            'is_default'   => false,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        $peerModuleId = DB::table('modules')->where('slug', 'master.asset_categories')->value('id');
        if (!$peerModuleId) return;

        $sourceRows = DB::table('permissions')->where('module_id', $peerModuleId)->get();
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
        $id = DB::table('modules')->where('slug', 'master.expense_category')->value('id');
        if ($id) {
            DB::table('permissions')->where('module_id', $id)->delete();
            DB::table('modules')->where('id', $id)->delete();
        }
    }
};
