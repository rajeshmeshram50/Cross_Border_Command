<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use App\Support\ModuleDependencies;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PermissionController extends Controller
{
    private const FLAGS = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];

    private function subordinateUserIds(User $granter): array
    {
        $granterEmpId = $granter->employee_id;

        $frontier = Employee::query()
            ->where('client_id', $granter->client_id)
            ->where(function ($q) use ($granterEmpId, $granter) {
                if ($granterEmpId) $q->where('reporting_manager_id', $granterEmpId);
                $q->orWhere('reporting_manager_user_id', $granter->id);
            })
            ->pluck('id')
            ->all();

        $seen = [];
        for ($depth = 0; $depth < 20 && $frontier !== []; $depth++) {
            $frontier = array_values(array_diff($frontier, $seen));
            if ($frontier === []) break;

            foreach ($frontier as $id) $seen[] = $id;

            $frontier = Employee::query()
                ->where('client_id', $granter->client_id)
                ->whereIn('reporting_manager_id', $frontier)
                ->pluck('id')
                ->all();
        }

        if ($seen === []) return [];

        return User::whereIn('id', Employee::whereIn('id', $seen)->whereNotNull('user_id')->pluck('user_id'))
            ->where('client_id', $granter->client_id)
            ->where('user_type', 'employee')
            ->where('status', 'active')
            ->pluck('id')
            ->all();
    }

    private function delegationDenial(User $granter, array $payload)
    {
        $myPerms = Permission::where('user_id', $granter->id)->get()->keyBy('module_id');

        foreach ($payload as $perm) {
            $myPerm = $myPerms->get($perm['module_id'] ?? null);

            if (!$myPerm) {
                foreach (self::FLAGS as $field) {
                    if ($perm[$field] ?? false) {
                        return response()->json([
                            'message' => 'You cannot grant permissions for modules you don\'t have access to',
                        ], 422);
                    }
                }
                continue;
            }

            foreach (self::FLAGS as $field) {
                if (($perm[$field] ?? false) && !$myPerm->$field) {
                    return response()->json([
                        'message' => "You cannot grant '{$field}' permission that you don't have",
                    ], 422);
                }
            }
        }

        return null;
    }

    private function withDepartments($users)
    {
        if ($users->isEmpty()) return $users;

        $byUser = Employee::query()
            ->whereIn('user_id', $users->pluck('id'))
            ->leftJoin('master_departments as d', 'd.id', '=', 'employees.department_id')
            ->pluck('d.name', 'employees.user_id');

        return $users->each(function ($u) use ($byUser) {
            $u->department = $byUser[$u->id] ?? null;
        });
    }

    public function modules()
    {
        $modules = Module::where('is_active', true)
            ->orderBy('parent_id')
            ->orderBy('sort_order')
            ->get(['id', 'parent_id', 'name', 'slug', 'icon', 'is_default', 'sort_order', 'description']);

        return response()->json($modules);
    }

    public function getUserPermissions(Request $request, $userId)
    {
        $authUser = $request->user();
        $targetUser = User::findOrFail($userId);

        $isPrivilegedGranter = $authUser->isClientAdmin();
        $isSubBranchGranter = $authUser->isBranchUser();
        $subBranchAllowed = $isSubBranchGranter
            && $targetUser->user_type === 'employee'
            && $authUser->client_id === $targetUser->client_id
            && $authUser->branch_id === $targetUser->branch_id;

        $subordinateAllowed = $authUser->isEmployee()
            && $targetUser->user_type === 'employee'
            && $authUser->client_id === $targetUser->client_id
            && in_array((int) $targetUser->id, $this->subordinateUserIds($authUser), true);

        $allowed = $authUser->id === $targetUser->id
            || $authUser->isSuperAdmin()
            || ($isPrivilegedGranter && $authUser->client_id === $targetUser->client_id)
            || ($isPrivilegedGranter && $targetUser->client_id === null)
            || $subBranchAllowed
            || $subordinateAllowed;

        if (!$allowed) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $permissions = Permission::where('user_id', $targetUser->id)
            ->with('module:id,name,slug,icon')
            ->get();

        return response()->json([
            'user' => $targetUser->only(['id', 'name', 'email', 'user_type']),
            'permissions' => $permissions,
        ]);
    }

    public function manageableUsers(Request $request)
    {
        $authUser = $request->user();
        $branchFilter = $request->integer('branch_id') ?: null;

        if ($authUser->isSuperAdmin()) {
            $users = User::where('user_type', 'client_admin')
                ->where('status', 'active')
                ->whereHas('client', fn($q) => $q->where('status', 'active'))
                ->with(['client:id,org_name,status'])
                ->get(['id', 'name', 'email', 'user_type', 'client_id', 'branch_id', 'status']);
        } elseif ($authUser->isClientAdmin()) {
            $query = User::where('client_id', $authUser->client_id)
                ->where('id', '!=', $authUser->id)
                ->whereIn('user_type', ['branch_user', 'employee'])
                ->where('status', 'active')
                ->where(function ($q) {
                    $q->where('user_type', 'employee')
                        ->orWhere(function ($qq) {
                            $qq->where('user_type', 'branch_user')
                                ->whereHas('branch', fn($qb) => $qb->where('status', 'active'));
                        });
                })
                ->with('branch:id,name,status');

            if ($branchFilter !== null) {
                $belongsToClient = \App\Models\Branch::where('id', $branchFilter)
                    ->where('client_id', $authUser->client_id)
                    ->exists();
                if ($belongsToClient) {
                    $query->where('branch_id', $branchFilter);
                }
            }

            $users = $query->get(['id', 'name', 'email', 'user_type', 'client_id', 'branch_id', 'status']);
        } elseif ($authUser->isBranchUser()) {
            $users = User::where('client_id', $authUser->client_id)
                ->where('branch_id', $authUser->branch_id)
                ->where('id', '!=', $authUser->id)
                ->where('user_type', 'employee')
                ->where('status', 'active')
                ->with('branch:id,name,status')
                ->get(['id', 'name', 'email', 'user_type', 'client_id', 'branch_id', 'status']);
            $users = $this->withDepartments($users);
        } elseif ($authUser->isEmployee()) {
            $subordinateIds = $this->subordinateUserIds($authUser);
            $users = $subordinateIds === []
                ? collect()
                : $this->withDepartments(
                    User::whereIn('id', $subordinateIds)
                        ->with('branch:id,name,status')
                        ->get(['id', 'name', 'email', 'user_type', 'client_id', 'branch_id', 'status'])
                );
        } else {
            $users = collect();
        }

        return response()->json($users);
    }

    public function savePermissions(Request $request, $userId)
    {
        $authUser = $request->user();
        $targetUser = User::findOrFail($userId);

        $targetId = (int) $targetUser->id;
        $targetClientId = $targetUser->client_id;
        $targetBranchId = $targetUser->branch_id;
        $targetRole = $targetUser->user_type;
        $grantedById = (int) $authUser->id;

        $request->validate([
            'permissions' => 'required|array',
            'permissions.*.module_id' => 'required|integer',
            'permissions.*.can_view' => 'boolean',
            'permissions.*.can_add' => 'boolean',
            'permissions.*.can_edit' => 'boolean',
            'permissions.*.can_delete' => 'boolean',
            'permissions.*.can_export' => 'boolean',
            'permissions.*.can_import' => 'boolean',
            'permissions.*.can_approve' => 'boolean',
            'permissions.*.is_auto'   => 'boolean',
        ]);

        // Validate every module_id in one query instead of the per-row `exists`
        // rule, which issued a SELECT for each of the 100+ rows the UI sends.
        $moduleIds = collect($request->permissions)->pluck('module_id')->map(fn($v) => (int) $v)->unique();
        $missing = $moduleIds->diff(DB::table('modules')->whereIn('id', $moduleIds)->pluck('id'));
        if ($missing->isNotEmpty()) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'permissions' => ['Unknown module id(s): ' . $missing->implode(', ')],
            ]);
        }

        if ($authUser->isSuperAdmin()) {
            if (!$targetUser->isClientAdmin()) {
                return response()->json([
                    'message' => 'Super admin can only assign permissions to client admins. For branch-user / employee grants, the tenant\'s client_admin owns the Permissions page.',
                ], 403);
            }
        } elseif ($authUser->isClientAdmin()) {
            $manageableTypes = ['branch_user'];

            if (
                $targetUser->client_id === null
                && in_array($targetUser->user_type, $manageableTypes, true)
            ) {
                $targetUser->update([
                    'client_id' => $authUser->client_id,
                    'branch_id' => $authUser->branch_id,
                ]);
                if ($targetUser->user_type === 'employee') {
                    Employee::where('user_id', $targetUser->id)
                        ->whereNull('client_id')
                        ->update([
                            'client_id' => $authUser->client_id,
                            'branch_id' => $authUser->branch_id,
                        ]);
                }
                $targetUser->refresh();
                $targetClientId = $targetUser->client_id;
                $targetBranchId = $targetUser->branch_id;
            }

            $allowed = $targetUser->client_id === $authUser->client_id
                && in_array($targetUser->user_type, $manageableTypes, true)
                && $targetUser->id !== $authUser->id;

            if (!$allowed) {
                return response()->json(['message' => 'You can only assign permissions to users you manage'], 403);
            }

            if ($denial = $this->delegationDenial($authUser, $request->permissions)) {
                return $denial;
            }
        } elseif ($authUser->isBranchUser()) {
            $allowed = $targetUser->user_type === 'employee'
                && $targetUser->client_id === $authUser->client_id
                && $targetUser->branch_id === $authUser->branch_id
                && $targetUser->id !== $authUser->id;

            if (!$allowed) {
                return response()->json([
                    'message' => 'Sub-branch users can only grant permissions to employees in their own branch.',
                ], 403);
            }

            if ($denial = $this->delegationDenial($authUser, $request->permissions)) {
                return $denial;
            }
        } elseif ($authUser->isEmployee()) {
            $allowed = $targetUser->user_type === 'employee'
                && $targetUser->client_id === $authUser->client_id
                && $targetUser->id !== $authUser->id
                && in_array((int) $targetUser->id, $this->subordinateUserIds($authUser), true);

            if (!$allowed) {
                return response()->json([
                    'message' => 'You can only grant permissions to employees who report to you.',
                ], 403);
            }

            if ($denial = $this->delegationDenial($authUser, $request->permissions)) {
                return $denial;
            }
        } else {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $parentIdsWithKids = DB::table('modules')
            ->whereNotNull('parent_id')
            ->distinct()
            ->pluck('parent_id')
            ->toArray();

        [$payload, $autoGranted] = $this->withDependencyGrants($request->permissions, $authUser);

        $count = 0;
        $skippedParents = 0;
        $cascadeAffected = 0;

        DB::transaction(function () use (
            $payload, $parentIdsWithKids, $targetId, $targetClientId, $targetBranchId,
            $targetRole, $grantedById, $authUser, $targetUser, &$count, &$skippedParents, &$cascadeAffected
        ) {
            DB::table('permissions')->where('user_id', $targetId)->delete();

            $toInsert = [];
            foreach ($payload as $perm) {
                if (in_array((int) $perm['module_id'], $parentIdsWithKids, true)) {
                    $skippedParents++;
                    continue;
                }

                $canView = filter_var($perm['can_view'] ?? false, FILTER_VALIDATE_BOOLEAN);
                $canAdd = filter_var($perm['can_add'] ?? false, FILTER_VALIDATE_BOOLEAN);
                $canEdit = filter_var($perm['can_edit'] ?? false, FILTER_VALIDATE_BOOLEAN);
                $canDelete = filter_var($perm['can_delete'] ?? false, FILTER_VALIDATE_BOOLEAN);
                $canExport = filter_var($perm['can_export'] ?? false, FILTER_VALIDATE_BOOLEAN);
                $canImport = filter_var($perm['can_import'] ?? false, FILTER_VALIDATE_BOOLEAN);
                $canApprove = filter_var($perm['can_approve'] ?? false, FILTER_VALIDATE_BOOLEAN);

                if ($canAdd || $canEdit || $canDelete || $canExport || $canImport || $canApprove) {
                    $canView = true;
                }

                $hasAny = $canView || $canAdd || $canEdit || $canDelete || $canExport || $canImport || $canApprove;
                if (!$hasAny) continue;

                $toInsert[] = [
                    'user_id' => $targetId,
                    'client_id' => $targetClientId,
                    'branch_id' => $targetBranchId,
                    'role' => $targetRole,
                    'module_id' => $perm['module_id'],
                    'can_view' => $canView,
                    'can_add' => $canAdd,
                    'can_edit' => $canEdit,
                    'can_delete' => $canDelete,
                    'can_export' => $canExport,
                    'can_import' => $canImport,
                    'can_approve' => $canApprove,
                    'is_auto' => filter_var($perm['is_auto'] ?? false, FILTER_VALIDATE_BOOLEAN),
                    'granted_by' => $grantedById,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
                $count++;
            }

            foreach (array_chunk($toInsert, 200) as $chunk) {
                DB::table('permissions')->insert($chunk);
            }

            if ($authUser->isSuperAdmin() && $targetUser->isClientAdmin() && $targetClientId) {
                $cascadeAffected = $this->cascadeClearDownstream($targetId, $targetClientId);
            }
        });

        $dbCount = DB::table('permissions')->where('user_id', $targetId)->count();

        return response()->json([
            'message' => 'Permissions saved successfully',
            'saved_count' => $count,
            'db_count' => $dbCount,
            'skipped_parent_modules' => $skippedParents,
            'target_user_id' => $targetId,
            'cascade_branch_users_updated' => $cascadeAffected,
            'auto_granted_dependencies' => $autoGranted,
        ]);
    }

    private function withDependencyGrants(array $payload, ?User $granter): array
    {
        $modules = DB::table('modules')->select('id', 'slug')->get();
        $slugById = $modules->pluck('slug', 'id')->all();
        $idBySlug = $modules->pluck('id', 'slug')->all();

        $seedSlugs = [];
        $byModuleId = [];
        foreach ($payload as $perm) {
            $moduleId = (int) ($perm['module_id'] ?? 0);
            $byModuleId[$moduleId] = $perm;
            $slug = $slugById[$moduleId] ?? null;
            if ($slug === null) continue;
            if (filter_var($perm['is_auto'] ?? false, FILTER_VALIDATE_BOOLEAN)) continue;

            foreach (self::FLAGS as $flag) {
                if (filter_var($perm[$flag] ?? false, FILTER_VALIDATE_BOOLEAN)) {
                    $seedSlugs[] = $slug;
                    break;
                }
            }
        }

        $granterPerms = ($granter === null || $granter->isSuperAdmin())
            ? null
            : Permission::where('user_id', $granter->id)->get()->keyBy('module_id');

        $required = $seedSlugs === [] ? [] : ModuleDependencies::resolve($seedSlugs);

        $autoGranted = [];
        foreach ($required as $depSlug) {
            $depId = $idBySlug[$depSlug] ?? null;
            if (!$depId) continue;

            $existing = $byModuleId[$depId] ?? null;
            $isExplicit = $existing !== null
                && !filter_var($existing['is_auto'] ?? false, FILTER_VALIDATE_BOOLEAN);
            if ($isExplicit && filter_var($existing['can_view'] ?? false, FILTER_VALIDATE_BOOLEAN)) continue;

            if ($granterPerms !== null && !($granterPerms->get($depId)?->can_view)) continue;

            $row = $existing ?? ['module_id' => $depId];
            $row['can_view'] = true;
            $row['is_auto'] = true;
            $byModuleId[$depId] = $row;
            $autoGranted[] = $depSlug;
        }

        $requiredIds = [];
        foreach ($required as $depSlug) {
            if (isset($idBySlug[$depSlug])) $requiredIds[$idBySlug[$depSlug]] = true;
        }
        foreach ($byModuleId as $moduleId => $row) {
            if (!filter_var($row['is_auto'] ?? false, FILTER_VALIDATE_BOOLEAN)) continue;
            if (isset($requiredIds[$moduleId])) continue;
            unset($byModuleId[$moduleId]);
        }

        return [array_values($byModuleId), $autoGranted];
    }

    private function cascadeClearDownstream(int $adminUserId, int $clientId): int
    {
        $fields = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];

        $adminPerms = DB::table('permissions')
            ->where('user_id', $adminUserId)
            ->get(['module_id', ...$fields])
            ->keyBy('module_id');

        $branchUserIds = User::where('client_id', $clientId)
            ->whereIn('user_type', ['branch_user', 'employee'])
            ->pluck('id');

        $affected = 0;
        foreach ($branchUserIds as $branchUserId) {
            $rows = DB::table('permissions')->where('user_id', $branchUserId)->get();
            foreach ($rows as $row) {
                $admin = $adminPerms->get($row->module_id);
                $updates = [];
                foreach ($fields as $f) {
                    if ($row->$f && (!$admin || !$admin->$f)) {
                        $updates[$f] = false;
                    }
                }
                if (!empty($updates)) {
                    $updates['updated_at'] = now();
                    DB::table('permissions')
                        ->where('id', $row->id)
                        ->update($updates);
                    $affected++;
                }

                $stillHasAny = collect($fields)->some(fn($f) => array_key_exists($f, $updates) ? $updates[$f] : $row->$f);
                if (!$stillHasAny) {
                    DB::table('permissions')->where('id', $row->id)->delete();
                }
            }
        }
        return $affected;
    }

    public function getDepartmentPermissions(Request $request, $departmentId)
    {
        $authUser = $request->user();
        if (!$authUser) abort(401);

        $perms = \App\Models\DepartmentPermission::query()
            ->where('client_id', $authUser->client_id)
            ->where('department_id', (int) $departmentId)
            ->with('module:id,slug,name')
            ->get();

        return response()->json(['permissions' => $perms]);
    }

    public function saveDepartmentPermissions(Request $request, $departmentId)
    {
        $authUser = $request->user();
        if (!$authUser) abort(401);

        if (!($authUser->isBranchUser() || $authUser->isClientAdmin() || $authUser->isSuperAdmin())) {
            return response()->json(['message' => 'You are not allowed to set department permissions.'], 403);
        }

        $data = $request->validate([
            'permissions' => 'required|array',
            'permissions.*.module_id' => 'required|integer',
            'permissions.*.can_view'    => 'boolean',
            'permissions.*.can_add'     => 'boolean',
            'permissions.*.can_edit'    => 'boolean',
            'permissions.*.can_delete'  => 'boolean',
            'permissions.*.can_export'  => 'boolean',
            'permissions.*.can_import'  => 'boolean',
            'permissions.*.can_approve' => 'boolean',
            'permissions.*.is_auto'   => 'boolean',
        ]);

        // One query to validate module ids, not one SELECT per row (see savePermissions).
        $deptModuleIds = collect($data['permissions'])->pluck('module_id')->map(fn($v) => (int) $v)->unique();
        $deptMissing = $deptModuleIds->diff(DB::table('modules')->whereIn('id', $deptModuleIds)->pluck('id'));
        if ($deptMissing->isNotEmpty()) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'permissions' => ['Unknown module id(s): ' . $deptMissing->implode(', ')],
            ]);
        }

        $clientId  = $authUser->client_id;
        $deptId    = (int) $departmentId;
        $flags     = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];
        $saved     = 0;

        [$deptPayload, $autoGranted] = $this->withDependencyGrants($data['permissions'], null);

        DB::transaction(function () use ($deptPayload, $clientId, $deptId, $flags, $authUser, &$saved) {
            foreach ($deptPayload as $p) {
                $values = [];
                $anyOn = false;
                foreach ($flags as $f) {
                    $values[$f] = (bool) ($p[$f] ?? false);
                    $anyOn = $anyOn || $values[$f];
                }

                if ($anyOn && !$values['can_view']) $values['can_view'] = true;

                $values['is_auto'] = (bool) ($p['is_auto'] ?? false);

                $keys = ['client_id' => $clientId, 'department_id' => $deptId, 'module_id' => (int) $p['module_id']];

                if (!$anyOn) {
                    \App\Models\DepartmentPermission::where($keys)->delete();
                    continue;
                }

                \App\Models\DepartmentPermission::updateOrCreate(
                    $keys,
                    $values + ['granted_by' => $authUser->id],
                );
                $saved++;
            }
        });

        $hodApplied = \App\Support\DepartmentPermissionSync::applyToAllHods($clientId, $deptId, $authUser->id);

        return response()->json([
            'message'        => 'Department permissions saved successfully',
            'saved_count'    => $saved,
            'hod_modules_applied' => $hodApplied,
            'auto_granted_dependencies' => $autoGranted,
        ]);
    }
}
