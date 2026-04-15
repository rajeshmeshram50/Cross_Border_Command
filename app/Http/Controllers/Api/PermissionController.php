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
            ->orderBy('sort_order')
            ->get(['id', 'name', 'slug', 'icon', 'is_default', 'sort_order']);

        return response()->json($modules);
    }

    public function getUserPermissions(Request $request, $userId)
    {
        $authUser = $request->user();
        $targetUser = User::findOrFail($userId);

        if (!$authUser->isSuperAdmin() && $authUser->client_id !== $targetUser->client_id) {
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
            $users = User::whereIn('user_type', ['client_admin', 'branch_user'])
                ->with(['client:id,org_name', 'branch:id,name'])
                ->get(['id', 'name', 'email', 'user_type', 'client_id', 'branch_id', 'status']);
        } elseif ($authUser->isClientAdmin()) {
            $users = User::where('client_id', $authUser->client_id)
                ->where('user_type', 'branch_user')
                ->with('branch:id,name')
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
        } elseif ($authUser->isClientAdmin()) {
            if ($targetUser->client_id !== $authUser->client_id || $targetUser->user_type !== 'branch_user') {
                return response()->json(['message' => 'You can only assign permissions to branch users in your organization'], 403);
            }

            $myPerms = Permission::where('user_id', $authUser->id)->get()->keyBy('module_id');

            foreach ($request->permissions as $perm) {
                $myPerm = $myPerms->get($perm['module_id']);
                if (!$myPerm) {
                    if (($perm['can_view'] ?? false) || ($perm['can_add'] ?? false) ||
                        ($perm['can_edit'] ?? false) || ($perm['can_delete'] ?? false)) {
                        return response()->json([
                            'message' => 'You cannot grant permissions for modules you don\'t have access to',
                        ], 422);
                    }
                    continue;
                }

                $fields = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];
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

        // Delete old and insert new — using raw IDs, not model objects
        DB::table('permissions')->where('user_id', $targetId)->delete();

        $count = 0;
        foreach ($request->permissions as $perm) {
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

        // Verify
        $dbCount = DB::table('permissions')->where('user_id', $targetId)->count();

        return response()->json([
            'message' => 'Permissions saved successfully',
            'saved_count' => $count,
            'db_count' => $dbCount,
            'target_user_id' => $targetId,
        ]);
    }
}
