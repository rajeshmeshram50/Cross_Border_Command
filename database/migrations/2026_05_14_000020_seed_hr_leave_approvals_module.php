<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Registers the hr.leave_approvals leaf under the existing hr.time_pay
 * category so the manager / HR Leave Approvals page surfaces in the menu.
 * Permission rows are copied from hr.leave (its closest sibling) so any
 * existing user with Leave access automatically sees the new Approvals
 * entry without HR having to manually toggle a permission.
 */
return new class extends Migration
{
    public function up(): void
    {
        $catId = DB::table('modules')->where('slug', 'hr.time_pay')->value('id');
        if (!$catId) return;

        $slug = 'hr.leave_approvals';
        $existing = DB::table('modules')->where('slug', $slug)->value('id');
        $moduleId = $existing ?: DB::table('modules')->insertGetId([
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

        // Copy permission rows from hr.leave (every user who can view
        // Leave should also be able to view Leave Approvals — the
        // controller enforces who can actually act on a request).
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
            $insert[] = [
                'user_id'     => $r->user_id,
                'client_id'   => $r->client_id,
                'branch_id'   => $r->branch_id,
                'role'        => $r->role,
                'module_id'   => $moduleId,
                'can_view'    => $r->can_view,
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
        $id = DB::table('modules')->where('slug', 'hr.leave_approvals')->value('id');
        if ($id) {
            DB::table('permissions')->where('module_id', $id)->delete();
            DB::table('modules')->where('id', $id)->delete();
        }
    }
};
