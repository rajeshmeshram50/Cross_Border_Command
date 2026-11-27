<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private array $flags = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];

    public function up(): void
    {
        $hrEmpId    = DB::table('modules')->where('slug', 'hr.employee')->value('id');
        $masterEmpId = DB::table('modules')->where('slug', 'master.employees')->value('id');
        $legacyId   = DB::table('modules')->where('slug', 'employees')->value('id');

        if (!$hrEmpId) return;

        if ($masterEmpId) {
            $rows = DB::table('permissions')->where('module_id', $masterEmpId)->get();
            foreach ($rows as $r) {
                if ($this->isSelfServiceViewOnly($r)) continue;
                $this->mergePermission('permissions', $r, $hrEmpId, [
                    'user_id'    => $r->user_id,
                    'module_id'  => $hrEmpId,
                ], [
                    'client_id'  => $r->client_id,
                    'branch_id'  => $r->branch_id,
                    'role'       => $r->role,
                    'granted_by' => $r->granted_by,
                ]);
            }

            if (DB::getSchemaBuilder()->hasTable('department_permissions')) {
                $deptRows = DB::table('department_permissions')->where('module_id', $masterEmpId)->get();
                foreach ($deptRows as $r) {
                    $this->mergePermission('department_permissions', $r, $hrEmpId, [
                        'client_id'     => $r->client_id,
                        'department_id' => $r->department_id,
                        'module_id'     => $hrEmpId,
                    ], []);
                }
            }
        }

        if ($masterEmpId) DB::table('modules')->where('id', $masterEmpId)->delete();
        if ($legacyId)    DB::table('modules')->where('id', $legacyId)->delete();
    }

    private function isSelfServiceViewOnly(object $r): bool
    {
        if (($r->role ?? null) !== 'employee') return false;
        if (!($r->can_view ?? false)) return false;
        foreach (['can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'] as $f) {
            if ($r->{$f} ?? false) return false;
        }
        return true;
    }

    private function mergePermission(string $table, object $src, int $targetModuleId, array $matchKeys, array $insertExtra): void
    {
        $existing = DB::table($table)->where($matchKeys)->first();
        $now = now();
        if ($existing) {
            $update = ['updated_at' => $now];
            foreach ($this->flags as $f) {
                $update[$f] = (bool) ($existing->{$f} ?? false) || (bool) ($src->{$f} ?? false);
            }
            DB::table($table)->where('id', $existing->id)->update($update);
            return;
        }
        $insert = $matchKeys + $insertExtra + ['created_at' => $now, 'updated_at' => $now];
        foreach ($this->flags as $f) {
            $insert[$f] = (bool) ($src->{$f} ?? false);
        }
        DB::table($table)->insert($insert);
    }

    public function down(): void
    {
        $master = DB::table('modules')->where('slug', 'master')->first();
        $identity = DB::table('modules')->where('slug', 'master.identity')->first();

        if (!DB::table('modules')->where('slug', 'employees')->exists()) {
            DB::table('modules')->insert([
                'name' => 'Employees', 'slug' => 'employees', 'icon' => 'UserCheck',
                'parent_id' => null, 'sort_order' => 4, 'is_default' => false, 'is_active' => true,
                'description' => 'Employee management', 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        if ($identity && !DB::table('modules')->where('slug', 'master.employees')->exists()) {
            DB::table('modules')->insert([
                'name' => 'Employees', 'slug' => 'master.employees', 'icon' => 'Users',
                'parent_id' => $identity->id, 'sort_order' => 7, 'is_default' => false, 'is_active' => true,
                'description' => 'Employee master with login provisioning', 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }
};
