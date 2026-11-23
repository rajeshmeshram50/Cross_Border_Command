<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        $parentId = DB::table('modules')->where('slug', 'hr.time_pay')->value('id');

        $holidayId = DB::table('modules')->where('slug', 'hr.holiday')->value('id');
        if (!$holidayId) {
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
