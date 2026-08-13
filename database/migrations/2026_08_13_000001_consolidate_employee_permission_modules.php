<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Consolidate the three "Employee" permission modules into one.
 *
 * Before: three grantable modules all about employees —
 *   - `employees`         (legacy top-level, gated nothing)
 *   - `master.employees`  (backend-only: gated the /employees API)
 *   - `hr.employee`       (frontend-only: gated the /hr/employees menu + route)
 *
 * After: a single `hr.employee` module gates BOTH the API and the UI. The
 * controllers (EmployeeController / ExitController) now check `hr.employee`,
 * so existing `master.employees` grants must move onto `hr.employee` or those
 * users would 403.
 *
 * Grant migration rules:
 *   - `permissions` (per-user): copy/merge every `master.employees` row onto
 *     `hr.employee`, EXCEPT the auto-provisioned self-service grants (role =
 *     'employee' AND view-only). Those never surfaced a menu before; carrying
 *     them to `hr.employee` would suddenly expose the Employee-management page
 *     to every self-onboarded hire. Their own profile keeps working via
 *     EmployeeController's self-exemption, so nothing is lost.
 *   - `department_permissions` (per-department, admin-configured only): copy/
 *     merge all of them onto `hr.employee`.
 *
 * Finally drop the `employees` and `master.employees` module rows. The
 * permissions / department_permissions FKs are ON DELETE CASCADE, so any
 * remaining (skipped) rows for those modules are removed automatically.
 *
 * Idempotent: safe to re-run — merges union the boolean flags.
 */
return new class extends Migration
{
    private array $flags = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];

    public function up(): void
    {
        $hrEmpId    = DB::table('modules')->where('slug', 'hr.employee')->value('id');
        $masterEmpId = DB::table('modules')->where('slug', 'master.employees')->value('id');
        $legacyId   = DB::table('modules')->where('slug', 'employees')->value('id');

        // No target module → nothing safe to do; leave the tree untouched.
        if (!$hrEmpId) return;

        if ($masterEmpId) {
            // ---- per-user permissions ----
            $rows = DB::table('permissions')->where('module_id', $masterEmpId)->get();
            foreach ($rows as $r) {
                // Skip the auto-provisioned self-service grant (role=employee, view-only).
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

            // ---- per-department permissions (admin-configured only) ----
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

        // Drop the dead modules; CASCADE cleans up any leftover permission rows.
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

    /** Upsert a target row keyed by $matchKeys, OR-ing the boolean flags. */
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
        // Re-create the two module shells so the tree structure returns (grants
        // are not restored — this was a one-way data consolidation).
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
