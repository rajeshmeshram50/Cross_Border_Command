<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Backfill `master.employees` permissions for users who were already
 * provisioned before that module existed.
 *
 * Strategy: copy each user's flag set from their `master.departments` row
 * (peer module under "Identity & Entity") onto a fresh `master.employees`
 * row. Skips users who already have one. Idempotent.
 */
return new class extends Migration
{
    public function up(): void
    {
        $employeesId   = DB::table('modules')->where('slug', 'master.employees')->value('id');
        $departmentsId = DB::table('modules')->where('slug', 'master.departments')->value('id');
        if (!$employeesId || !$departmentsId) return;

        $sourceRows = DB::table('permissions')->where('module_id', $departmentsId)->get();
        $existingUserIds = DB::table('permissions')
            ->where('module_id', $employeesId)
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
                'module_id'  => $employeesId,
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
        if (!empty($insert)) {
            // Chunk inserts to keep memory bounded on large tenant counts.
            foreach (array_chunk($insert, 500) as $chunk) {
                DB::table('permissions')->insert($chunk);
            }
        }
    }

    public function down(): void
    {
        $id = DB::table('modules')->where('slug', 'master.employees')->value('id');
        if (!$id) return;
        DB::table('permissions')->where('module_id', $id)->delete();
    }
};
