<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $catId = DB::table('modules')->where('slug', 'hr.time_pay')->value('id');
        if (!$catId) return;

        $slug = 'hr.leave_approvals';
        $moduleId = DB::table('modules')->where('slug', $slug)->value('id');
        if (!$moduleId) {
            $moduleId = DB::table('modules')->insertGetId([
                'parent_id'    => $catId,
                'name'         => 'Leave Approvals',
                'slug'         => $slug,
                'icon'         => 'BadgeCheck',
                'description'  => 'Manager / HR approval queue for pending leave requests.',
                'route_name'   => null,
                'route_prefix' => null,
                'sort_order'   => 5,
                'is_active'    => true,
                'is_default'   => false,
                'created_at'   => now(),
                'updated_at'   => now(),
            ]);
        }

        $donorId = DB::table('modules')->where('slug', 'hr.leave')->value('id');
        if (!$donorId) return;

        $donorRows = DB::table('permissions')->where('module_id', $donorId)->get();
        if ($donorRows->isEmpty()) return;

        $existingUserIds = DB::table('permissions')
            ->where('module_id', $moduleId)
            ->pluck('user_id')->all();
        $skip = array_flip($existingUserIds);

        $now = now();
        $insert = [];
        foreach ($donorRows as $r) {
            if (isset($skip[$r->user_id])) continue;
            $carriesAction = $r->can_export || $r->can_approve;
            $insert[] = [
                'user_id'     => $r->user_id,
                'client_id'   => $r->client_id,
                'branch_id'   => $r->branch_id,
                'role'        => $r->role,
                'module_id'   => $moduleId,
                'can_view'    => $r->can_view || $carriesAction,
                'can_add'     => false,
                'can_edit'    => false,
                'can_delete'  => false,
                'can_export'  => $r->can_export,
                'can_import'  => false,
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
    }
};
