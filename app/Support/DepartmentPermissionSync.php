<?php

namespace App\Support;

use App\Models\DepartmentPermission;
use App\Models\Employee;
use App\Models\Masters\Designations;
use App\Models\Permission;
use App\Models\User;

/**
 * Propagates department-level module permissions onto the department's HOD.
 *
 * Flow: a Branch User sets department permissions → the department's HOD(s)
 * automatically receive those exact permissions (overwriting only the modules
 * in the department set; the HOD's other/direct grants are left untouched, so
 * a Branch User's direct grant to an employee coexists). The HOD then
 * re-distributes a subset to their team.
 */
class DepartmentPermissionSync
{
    private const FLAGS = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];

    /** All designation ids that mean "Head of Department (HOD)". */
    public static function hodDesignationIds(): array
    {
        $hodName = SalesVisibility::DESIGNATION_MANAGER; // 'Head of Department (HOD)'
        return Designations::query()
            ->where(function ($q) use ($hodName) {
                $q->whereRaw('LOWER(name) = ?',  [strtolower($hodName)])
                  ->orWhereRaw('LOWER(level) = ?', [strtolower($hodName)]);
            })
            ->pluck('id')->map(fn ($v) => (int) $v)->all();
    }

    /** User ids of the HOD employee(s) of a department (optionally one branch). */
    public static function hodUserIds(?int $clientId, int $departmentId, ?int $branchId = null): array
    {
        return Employee::query()
            ->where('client_id', $clientId)
            ->where('department_id', $departmentId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->whereIn('designation_id', self::hodDesignationIds())
            ->whereNotNull('user_id')
            ->pluck('user_id')->map(fn ($v) => (int) $v)->unique()->all();
    }

    /**
     * Overwrite a HOD user's permissions for exactly the modules in their
     * department's saved set. Modules outside the department set are untouched.
     * Returns the number of modules applied.
     */
    public static function applyToHodUser(User $hodUser, int $departmentId, ?int $grantedById): int
    {
        $clientId  = $hodUser->client_id;
        $deptPerms = DepartmentPermission::where('client_id', $clientId)
            ->where('department_id', $departmentId)
            ->get();
        if ($deptPerms->isEmpty()) {
            return 0;
        }

        $applied = 0;
        foreach ($deptPerms as $dp) {
            $vals = [];
            foreach (self::FLAGS as $f) {
                $vals[$f] = (bool) $dp->$f;
            }
            // Action permissions imply visibility (same rule as the per-user save).
            if ($vals['can_add'] || $vals['can_edit'] || $vals['can_delete']
                || $vals['can_export'] || $vals['can_import'] || $vals['can_approve']) {
                $vals['can_view'] = true;
            }

            $hasAny = in_array(true, $vals, true);
            if (!$hasAny) {
                Permission::where('user_id', $hodUser->id)->where('module_id', $dp->module_id)->delete();
                continue;
            }

            Permission::updateOrCreate(
                ['user_id' => $hodUser->id, 'module_id' => $dp->module_id],
                $vals + [
                    'client_id'  => $clientId,
                    'branch_id'  => $hodUser->branch_id,
                    'role'       => $hodUser->user_type,
                    'granted_by' => $grantedById,
                ],
            );
            $applied++;
        }

        return $applied;
    }

    /**
     * Apply the department's permissions onto every HOD of that department
     * (all branches). Called after a Branch User saves department permissions.
     */
    public static function applyToAllHods(?int $clientId, int $departmentId, ?int $grantedById): int
    {
        $total = 0;
        foreach (self::hodUserIds($clientId, $departmentId) as $uid) {
            $u = User::find($uid);
            if ($u) {
                $total += self::applyToHodUser($u, $departmentId, $grantedById);
            }
        }
        return $total;
    }
}
