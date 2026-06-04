<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Repair: ensure the hr.leave_approvals module exists.
 *
 * The original seeder migration (2026_05_14_000020) creates this leaf only if
 * its parent category hr.time_pay already exists, then bails. But hr.time_pay
 * is created by ModuleSeeder (a seeder run AFTER `migrate`), so on a fresh
 * migrate-then-seed bootstrap the original migration ran while the parent was
 * still absent and silently returned — leaving "Leave Approvals" with no module
 * row. Without it the leaf can never be granted on the Permissions sheet and so
 * never surfaces in any tenant user's sidebar, even though the route + page
 * (/hr/leave-approvals, HrLeaveApprovals) exist.
 *
 * This migration re-runs that logic idempotently now that the seeder has run.
 */
return new class extends Migration
{
    public function up(): void
    {
        $catId = DB::table('modules')->where('slug', 'hr.time_pay')->value('id');
        if (!$catId) return; // parent still absent — nothing we can safely attach to

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

        // Mirror the original intent: anyone who can view Leave should also see
        // Leave Approvals. Copy from hr.leave for users who don't already have a
        // hr.leave_approvals row. can_view is forced on per the action-implies-
        // view rule whenever an action (approve/export) is carried over.
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
        // No-op: the module is a legitimate part of the catalogue; the original
        // 2026_05_14_000020 migration owns its teardown.
    }
};
