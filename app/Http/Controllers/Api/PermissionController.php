<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PermissionController extends Controller
{
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

        // Allow self-read; super admin reads anyone; client admin reads anyone in
        // their client; main branch user reads anyone in their own branch.
        $allowed = $authUser->id === $targetUser->id
            || $authUser->isSuperAdmin()
            || ($authUser->isClientAdmin() && $authUser->client_id === $targetUser->client_id)
            || ($authUser->isMainBranchUser()
                && $authUser->client_id === $targetUser->client_id
                && $authUser->branch_id === $targetUser->branch_id);

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

        if ($authUser->isSuperAdmin()) {
            // Hide client_admins whose organization is inactive/suspended — granting
            // perms to a frozen org is a footgun
            $users = User::where('user_type', 'client_admin')
                ->where('status', 'active')
                ->whereHas('client', fn($q) => $q->where('status', 'active'))
                ->with(['client:id,org_name,status'])
                ->get(['id', 'name', 'email', 'user_type', 'client_id', 'branch_id', 'status']);
        } elseif ($authUser->isClientAdmin()) {
            // Client admin can manage both branch_users (whose branch is active)
            // AND employees under their client. Employees don't always carry a
            // branch_id, so we don't gate them on branch.status.
            $users = User::where('client_id', $authUser->client_id)
                ->whereIn('user_type', ['branch_user', 'employee'])
                ->where('status', 'active')
                ->where(function ($q) {
                    // branch_user must have an active branch; employees pass through.
                    $q->where('user_type', 'employee')
                      ->orWhere(function ($qq) {
                          $qq->where('user_type', 'branch_user')
                             ->whereHas('branch', fn($qb) => $qb->where('status', 'active'));
                      });
                })
                ->with('branch:id,name,status')
                ->get(['id', 'name', 'email', 'user_type', 'client_id', 'branch_id', 'status']);
        } elseif ($authUser->isMainBranchUser()) {
            // Main-branch user can manage permissions for OTHER active users in
            // their own branch (excluding themselves) — branch_users and any
            // employees stamped with the same branch.
            $users = User::where('client_id', $authUser->client_id)
                ->where('branch_id', $authUser->branch_id)
                ->where('id', '!=', $authUser->id)
                ->whereIn('user_type', ['branch_user', 'employee'])
                ->where('status', 'active')
                ->with('branch:id,name,status')
                ->get(['id', 'name', 'email', 'user_type', 'client_id', 'branch_id', 'status']);
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
            'permissions.*.module_id' => 'required|exists:modules,id',
            'permissions.*.can_view' => 'boolean',
            'permissions.*.can_add' => 'boolean',
            'permissions.*.can_edit' => 'boolean',
            'permissions.*.can_delete' => 'boolean',
            'permissions.*.can_export' => 'boolean',
            'permissions.*.can_import' => 'boolean',
            'permissions.*.can_approve' => 'boolean',
        ]);

        // Authorization
        if ($authUser->isSuperAdmin()) {
            if ($targetUser->isSuperAdmin()) {
                return response()->json(['message' => 'Cannot assign permissions to super admin'], 403);
            }
        } elseif ($authUser->isClientAdmin() || $authUser->isMainBranchUser()) {
            // Client admin grants to any branch_user OR employee under their
            // client. Main branch user grants to branch_users / employees in
            // their own branch (not themselves).
            $manageableTypes = ['branch_user', 'employee'];
            $allowed = $authUser->isClientAdmin()
                ? ($targetUser->client_id === $authUser->client_id
                    && in_array($targetUser->user_type, $manageableTypes, true))
                : ($targetUser->client_id === $authUser->client_id
                    && $targetUser->branch_id === $authUser->branch_id
                    && in_array($targetUser->user_type, $manageableTypes, true)
                    && $targetUser->id !== $authUser->id);

            if (!$allowed) {
                return response()->json(['message' => 'You can only assign permissions to users you manage'], 403);
            }

            // Cannot grant any flag the granter doesn't already have themselves
            $myPerms = Permission::where('user_id', $authUser->id)->get()->keyBy('module_id');
            $fields = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];

            foreach ($request->permissions as $perm) {
                $myPerm = $myPerms->get($perm['module_id']);

                if (!$myPerm) {
                    foreach ($fields as $field) {
                        if ($perm[$field] ?? false) {
                            return response()->json([
                                'message' => 'You cannot grant permissions for modules you don\'t have access to',
                            ], 422);
                        }
                    }
                    continue;
                }

                foreach ($fields as $field) {
                    if (($perm[$field] ?? false) && !$myPerm->$field) {
                        return response()->json([
                            'message' => "You cannot grant '{$field}' permission that you don't have",
                        ], 422);
                    }
                }
            }
        } else {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Only allow permissions on LEAF modules (parents exist only for grouping).
        // A leaf = module with no children.
        $parentIdsWithKids = DB::table('modules')
            ->whereNotNull('parent_id')
            ->distinct()
            ->pluck('parent_id')
            ->toArray();

        // Delete old and insert new — using raw IDs, not model objects
        DB::table('permissions')->where('user_id', $targetId)->delete();

        $count = 0;
        $skippedParents = 0;
        foreach ($request->permissions as $perm) {
            // Skip any payload pointing at a parent/group module
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

            $hasAny = $canView || $canAdd || $canEdit || $canDelete || $canExport || $canImport || $canApprove;
            if (!$hasAny) continue;

            DB::table('permissions')->insert([
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
                'granted_by' => $grantedById,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $count++;
        }

        // Cascade-clear: when a CLIENT ADMIN updates their OWN permissions, any
        // branch user under their client must lose flags the admin no longer has.
        // Without this, perms previously granted downstream stay live even after
        // the admin's access is revoked — a real privilege-escalation gap.
        $cascadeAffected = 0;
        if ($authUser->isSuperAdmin() && $targetUser->isClientAdmin() && $targetClientId) {
            $cascadeAffected = $this->cascadeClearDownstream($targetId, $targetClientId);
        }

        // Verify
        $dbCount = DB::table('permissions')->where('user_id', $targetId)->count();

        return response()->json([
            'message' => 'Permissions saved successfully',
            'saved_count' => $count,
            'db_count' => $dbCount,
            'skipped_parent_modules' => $skippedParents,
            'target_user_id' => $targetId,
            'cascade_branch_users_updated' => $cascadeAffected,
        ]);
    }

    /**
     * For every branch_user under $clientId, downgrade any flag they currently
     * have to false if the client_admin ($adminUserId) no longer has it. This is
     * the cascade that keeps "client_admin perm removed → branch users lose it
     * too" consistent. Returns the number of branch_user rows touched.
     */
    private function cascadeClearDownstream(int $adminUserId, int $clientId): int
    {
        $fields = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];

        // Map module_id → admin's current flag set (post-save)
        $adminPerms = DB::table('permissions')
            ->where('user_id', $adminUserId)
            ->get(['module_id', ...$fields])
            ->keyBy('module_id');

        // Cascade applies to BOTH branch users and employees under this client
        // — both are granted by the admin, so both must be downgraded if the
        // admin's flags shrink.
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
                    // Branch user has the flag, admin doesn't → strip it
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

                // If every flag is now false, delete the row entirely
                $stillHasAny = collect($fields)->some(fn($f) => array_key_exists($f, $updates) ? $updates[$f] : $row->$f);
                if (!$stillHasAny) {
                    DB::table('permissions')->where('id', $row->id)->delete();
                }
            }
        }
        return $affected;
    }
}
