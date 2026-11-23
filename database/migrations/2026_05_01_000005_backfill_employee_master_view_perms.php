<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $masterModuleIds = DB::table('modules')->where('slug', 'like', 'master.%')->pluck('id');
        if ($masterModuleIds->isEmpty()) return;

        $employees = DB::table('users')->where('user_type', 'employee')->get(['id', 'client_id', 'branch_id']);

        $now = now();
        foreach ($employees as $emp) {
            $grantor = DB::table('employees')->where('user_id', $emp->id)->value('created_by');
            if (!$grantor) continue;

            $allowedMasters = DB::table('permissions')
                ->where('user_id', $grantor)
                ->where('can_view', true)
                ->whereIn('module_id', $masterModuleIds)
                ->pluck('module_id')
                ->all();
            if (empty($allowedMasters)) continue;

            $existing = DB::table('permissions')
                ->where('user_id', $emp->id)
                ->whereIn('module_id', $allowedMasters)
                ->pluck('module_id')
                ->all();
            $missing = array_diff($allowedMasters, $existing);
            if (empty($missing)) continue;

            $rows = [];
            foreach ($missing as $moduleId) {
                $rows[] = [
                    'user_id'     => $emp->id,
                    'client_id'   => $emp->client_id,
                    'branch_id'   => $emp->branch_id,
                    'role'        => 'employee',
                    'module_id'   => $moduleId,
                    'can_view'    => true,
                    'can_add'     => false,
                    'can_edit'    => false,
                    'can_delete'  => false,
                    'can_export'  => false,
                    'can_import'  => false,
                    'can_approve' => false,
                    'granted_by'  => $grantor,
                    'created_at'  => $now,
                    'updated_at'  => $now,
                ];
            }
            foreach (array_chunk($rows, 500) as $chunk) {
                DB::table('permissions')->insert($chunk);
            }
        }
    }

    public function down(): void
    {
    }
};
