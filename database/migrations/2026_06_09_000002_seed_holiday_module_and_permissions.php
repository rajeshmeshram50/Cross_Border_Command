<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Register the `hr.holiday` permission module (under the HR "Time & Pay
 * Inputs" category) and backfill permissions for users already provisioned
 * before it existed.
 *
 * Strategy: clone each user's `hr.leave` flag set onto a fresh `hr.holiday`
 * row — Holiday lives in the same HR category, so anyone who can see Leave
 * should see the Holiday calendar too. Skips users who already have a row.
 * Idempotent (ModuleSeeder also seeds the module for fresh installs).
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        // 1. Ensure the module exists, nested under hr.time_pay.
        $parentId = DB::table('modules')->where('slug', 'hr.time_pay')->value('id');

        $holidayId = DB::table('modules')->where('slug', 'hr.holiday')->value('id');
        if (!$holidayId) {
            // Place it right after Leave in the category ordering.
            $leaveSort = DB::table('modules')->where('slug', 'hr.leave')->value('sort_order');
            $holidayId = DB::table('modules')->insertGetId([
                'parent_id'   => $parentId,
                'name'        => 'Holiday',
                'slug'        => 'hr.holiday',
                'icon'        => 'CalendarDays',
                'description' => 'Company holiday calendar',
                'sort_order'  => ($leaveSort ?: 3) + 1,
                'is_active'   => true,
                'is_default'  => false,
                'created_at'  => $now,
                'updated_at'  => $now,
            ]);
        }

        // 2. Backfill permissions from hr.leave.
        $leaveModuleId = DB::table('modules')->where('slug', 'hr.leave')->value('id');
        if (!$leaveModuleId) return;

        $sourceRows = DB::table('permissions')->where('module_id', $leaveModuleId)->get();
        $existingSet = array_flip(
            DB::table('permissions')->where('module_id', $holidayId)->pluck('user_id')->all()
        );

        $insert = [];
        foreach ($sourceRows as $r) {
            if (isset($existingSet[$r->user_id])) continue;
            $insert[] = [
                'user_id'     => $r->user_id,
                'client_id'   => $r->client_id,
                'branch_id'   => $r->branch_id,
                'role'        => $r->role,
                'module_id'   => $holidayId,
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
        $id = DB::table('modules')->where('slug', 'hr.holiday')->value('id');
        if (!$id) return;
        DB::table('permissions')->where('module_id', $id)->delete();
        DB::table('modules')->where('id', $id)->delete();
    }
};
