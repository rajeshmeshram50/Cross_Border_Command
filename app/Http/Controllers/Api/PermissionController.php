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
    /** The flags a permission row carries. */
    private const FLAGS = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];

    private function subordinateUserIds(User $granter): array
    {
        $granterEmpId = Employee::where('user_id', $granter->id)->value('id');

        // Level 0: reports of the granter, by either manager column.
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

        // Only subordinates who actually have a login can hold permissions.
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

    /**
     * Attach each employee-login's DEPARTMENT name to the picker payload.
     *
     * The Permissions picker identifies an employee by name + department (the
     * branch is redundant there — a branch user only ever sees their own branch,
     * and an employee only their own reports). Department is what actually tells
     * two same-named rows apart.
     *
     * Resolved through `employees.department_id` → `master_departments`, NOT
     * `users.department_id`: that column points at the legacy `departments`
     * table, which is empty in this schema. The employee row is the source of
     * truth for org placement.
     *
     * @param  \Illuminate\Support\Collection $users
     */
    private function withDepartments($users)
    {
        if ($users->isEmpty()) return $users;

        $byUser = Employee::query()
            ->whereIn('user_id', $users->pluck('id'))
            ->leftJoin('master_departments as d', 'd.id', '=', 'employees.department_id')
            ->pluck('d.name', 'employees.user_id');

        return $users->each(function ($u) use ($byUser) {
            // record" apart from "this payload doesn't carry departments".
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

        // Allow self-read; super admin reads anyone; client admin reads anyone
        // in their client.
        //
        // Orphan target (NULL client_id, e.g. an employee super_admin created
        // without a tenant) is also allowed for client_admin — the HR
        // Employees scope shows orphans to them, so the perms page must load
        // too. The save path then adopts the orphan into the granter's tenant.
        $isPrivilegedGranter = $authUser->isClientAdmin();
        // Branch user can read perms for employees in their own branch only —
        // mirrors the savePermissions scope below.
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
            // Hide client_admins whose organization is inactive/suspended — granting
            // perms to a frozen org is a footgun
            $users = User::where('user_type', 'client_admin')
                ->where('status', 'active')
                ->whereHas('client', fn($q) => $q->where('status', 'active'))
                ->with(['client:id,org_name,status'])
                ->get(['id', 'name', 'email', 'user_type', 'client_id', 'branch_id', 'status']);
        } elseif ($authUser->isClientAdmin()) {
            // Client admin manages every active branch_user/employee in the
            // client (excluding self).
            $query = User::where('client_id', $authUser->client_id)
                ->where('id', '!=', $authUser->id)
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
                ->with('branch:id,name,status');

            // BranchSwitcher narrowing — when user picks a specific branch,
            // limit the picker to users in that branch (validated against the
            // granter's own client to block cross-tenant ids).
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
            'permissions.*.module_id' => 'required|exists:modules,id',
            'permissions.*.can_view' => 'boolean',
            'permissions.*.can_add' => 'boolean',
            'permissions.*.can_edit' => 'boolean',
            'permissions.*.can_delete' => 'boolean',
            'permissions.*.can_export' => 'boolean',
            'permissions.*.can_import' => 'boolean',
            'permissions.*.can_approve' => 'boolean',
        ]);

        /* Authorization — grant scope:
         *   super_admin   → client_admin only
         *   client_admin  → branch_user only  (NOT employees)
         *   branch_user   → employees in same (client_id, branch_id)
         *   employee      → employees in their own reporting sub-tree
         *
         * The employee tier is the delegation rule the tenants asked for: a
         * manager hands out access to their own people, capped at the access
         * they hold themselves. Both halves are enforced below — who (the
         * sub-tree walk) and how much (delegationDenial). */
        if ($authUser->isSuperAdmin()) {
            if (!$targetUser->isClientAdmin()) {
                return response()->json([
                    'message' => 'Super admin can only assign permissions to client admins. For branch-user / employee grants, the tenant\'s client_admin owns the Permissions page.',
                ], 403);
            }
        } elseif ($authUser->isClientAdmin()) {
            // Client admin = branch_user only.
            $manageableTypes = ['branch_user'];

            // Adopt orphan targets (NULL client_id — typically employees that
            // super_admin created without tenant attribution) into the
            // granter's tenant. The HR Employees scope already exposes these
            // orphans to branch users, so we mirror the implicit ownership
            // and clean up the data on first interaction. Without this the
            // ===-comparison below 403's every orphan grant.
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

            // Cannot grant any flag the granter doesn't already have themselves
            if ($denial = $this->delegationDenial($authUser, $request->permissions)) {
                return $denial;
            }
        } elseif ($authUser->isBranchUser()) {
            // Branch user — can only grant to employees in their own
            // (client_id, branch_id). Matches the spec line in the big
            // comment above ("branch_user → employees in same branch").
            // Cannot grant to other branch_users, cannot adopt orphans
            // (that's reserved for the client admin path which is the
            // tenant's HR proxy).
            $allowed = $targetUser->user_type === 'employee'
                && $targetUser->client_id === $authUser->client_id
                && $targetUser->branch_id === $authUser->branch_id
                && $targetUser->id !== $authUser->id;

            if (!$allowed) {
                return response()->json([
                    'message' => 'Sub-branch users can only grant permissions to employees in their own branch.',
                ], 403);
            }

            // Same can't-grant-what-you-don't-have rule as the privileged
            // path above. Without this a sub-branch user could escalate an
            // employee past their own access.
            if ($denial = $this->delegationDenial($authUser, $request->permissions)) {
                return $denial;
            }
        } elseif ($authUser->isEmployee()) {
            /* Employee granter — target must sit under them in the reporting
             * tree. Deliberately NOT "same branch": the tree is the authority,
             * and a manager whose report was moved to another branch still
             * manages that person. Peers and managers are unreachable because
             * the walk only ever descends. */
            $allowed = $targetUser->user_type === 'employee'
                && $targetUser->client_id === $authUser->client_id
                && $targetUser->id !== $authUser->id
                && in_array((int) $targetUser->id, $this->subordinateUserIds($authUser), true);

            if (!$allowed) {
                return response()->json([
                    'message' => 'You can only grant permissions to employees who report to you.',
                ], 403);
            }

            // And never more than they hold themselves — an HRMS-only team
            // lead can hand out HRMS and nothing else.
            if ($denial = $this->delegationDenial($authUser, $request->permissions)) {
                return $denial;
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

        // Pull in the modules the ticked ones can't work without (HRMS
        // dependency matrix — see App\Support\ModuleDependencies).
        [$payload, $autoGranted] = $this->withDependencyGrants($request->permissions, $authUser);

        /* Replace the user's grants atomically. This is a delete-then-insert:
         * without a transaction, a failure part-way through the loop (or a
         * connection drop) leaves the user with a half-written set — or, if it
         * dies on the first insert, with NO permissions at all, locked out of
         * every screen they had. The rows are also collected and inserted in
         * one statement rather than one query per module (a full grant is ~140
         * round-trips otherwise). */
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

                // Action permissions imply visibility. Granting add / edit / delete /
                // export / import / approve on a module MUST also grant can_view:
                // the sidebar menu, the page-access guards, and the controller
                // index() checks all key off can_view, so an "edit-only" row would
                // hide the module entirely and lock the user out of the very page
                // they were given edit rights on. View is the baseline every other
                // action sits on top of. (View granted alone stays view-only.)
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
                    'granted_by' => $grantedById,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
                $count++;
            }

            foreach (array_chunk($toInsert, 200) as $chunk) {
                DB::table('permissions')->insert($chunk);
            }

            // Cascade-clear: when a CLIENT ADMIN updates their OWN permissions,
            // any branch user under their client must lose flags the admin no
            // longer has. Without this, perms previously granted downstream stay
            // live even after the admin's access is revoked — a real
            // privilege-escalation gap. Inside the transaction: the downstream
            // revoke and the grant that triggered it land together or not at all.
            if ($authUser->isSuperAdmin() && $targetUser->isClientAdmin() && $targetClientId) {
                $cascadeAffected = $this->cascadeClearDownstream($targetId, $targetClientId);
            }
        });

        // Verify
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

    /**
     * Expand a permissions payload with the dependency modules the ticked ones
     * need in order to work (HRMS dependency matrix).
     *
     * Only can_view is auto-granted, and only for modules the GRANTER can see
     * themselves — the delegation rule ("never hand out more than you hold")
     * still applies to implicit grants, so a dependency the granter lacks is
     * silently skipped rather than escalating.
     *
     * Returns [expanded payload, list of auto-granted slugs].
     *
     * $granter = null skips the cap entirely (used by the department grid,
     * which is already role-gated and holds no per-module grant of its own).
     */
    private function withDependencyGrants(array $payload, ?User $granter): array
    {
        $modules = DB::table('modules')->select('id', 'slug')->get();
        $slugById = $modules->pluck('slug', 'id')->all();
        $idBySlug = $modules->pluck('id', 'slug')->all();

        // Rows the operator actually asked for — any flag counts as "in use".
        $activeSlugs = [];
        $byModuleId = [];
        foreach ($payload as $perm) {
            $moduleId = (int) ($perm['module_id'] ?? 0);
            $byModuleId[$moduleId] = $perm;

            foreach (self::FLAGS as $flag) {
                if (filter_var($perm[$flag] ?? false, FILTER_VALIDATE_BOOLEAN)) {
                    if (isset($slugById[$moduleId])) $activeSlugs[] = $slugById[$moduleId];
                    break;
                }
            }
        }

        if ($activeSlugs === []) return [$payload, []];

        $granterPerms = ($granter === null || $granter->isSuperAdmin())
            ? null
            : Permission::where('user_id', $granter->id)->get()->keyBy('module_id');

        $autoGranted = [];
        foreach (ModuleDependencies::resolve($activeSlugs) as $depSlug) {
            $depId = $idBySlug[$depSlug] ?? null;
            if (!$depId) continue; // slug not seeded in this deployment — ignore

            // Already granted view by the operator? Nothing to do.
            if (filter_var($byModuleId[$depId]['can_view'] ?? false, FILTER_VALIDATE_BOOLEAN)) continue;

            // Delegation cap: the granter must hold view on it themselves.
            if ($granterPerms !== null && !($granterPerms->get($depId)?->can_view)) continue;

            $row = $byModuleId[$depId] ?? ['module_id' => $depId];
            $row['can_view'] = true;
            $byModuleId[$depId] = $row;
            $autoGranted[] = $depSlug;
        }

        return [array_values($byModuleId), $autoGranted];
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

    /* ─────────────────────────────────────────────────────────────────
     *  DEPARTMENT-WISE PERMISSIONS
     *  Branch users (and client admins) can set module access for a whole
     *  department — the department's baseline access, keyed per
     *  (client, department, module). GET returns the saved grid; POST saves it.
     * ───────────────────────────────────────────────────────────────── */

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

        // Only the branch's director (branch_user), the client admin, or a
        // super admin may configure department permissions.
        if (!($authUser->isBranchUser() || $authUser->isClientAdmin() || $authUser->isSuperAdmin())) {
            return response()->json(['message' => 'You are not allowed to set department permissions.'], 403);
        }

        $data = $request->validate([
            'permissions' => 'required|array',
            'permissions.*.module_id' => 'required|integer|exists:modules,id',
            'permissions.*.can_view'    => 'boolean',
            'permissions.*.can_add'     => 'boolean',
            'permissions.*.can_edit'    => 'boolean',
            'permissions.*.can_delete'  => 'boolean',
            'permissions.*.can_export'  => 'boolean',
            'permissions.*.can_import'  => 'boolean',
            'permissions.*.can_approve' => 'boolean',
        ]);

        $clientId  = $authUser->client_id;
        $deptId    = (int) $departmentId;
        $flags     = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];
        $saved     = 0;

        // Same two invariants as the per-user path: an action implies view, and
        // a module implies view on the modules it depends on. This grid feeds
        // straight into every HOD of the department, so an unexpanded row here
        // would hand out the same half-broken screens the matrix exists to
        // prevent. No delegation cap — this endpoint is role-gated instead.
        [$deptPayload, $autoGranted] = $this->withDependencyGrants($data['permissions'], null);

        DB::transaction(function () use ($deptPayload, $clientId, $deptId, $flags, $authUser, &$saved) {
            foreach ($deptPayload as $p) {
                $values = [];
                $anyOn = false;
                foreach ($flags as $f) {
                    $values[$f] = (bool) ($p[$f] ?? false);
                    $anyOn = $anyOn || $values[$f];
                }

                // Action implies visibility (mirrors savePermissions()).
                if ($anyOn && !$values['can_view']) $values['can_view'] = true;

                $keys = ['client_id' => $clientId, 'department_id' => $deptId, 'module_id' => (int) $p['module_id']];

                if (!$anyOn) {
                    // No flags → remove the row (keeps the table clean, mirrors
                    // the per-user "all-false = delete" behaviour).
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

        // Auto-propagate to the department's HOD(s): the HOD automatically
        // receives exactly these department permissions (overwriting only these
        // modules — direct grants on other modules are preserved).
        $hodApplied = \App\Support\DepartmentPermissionSync::applyToAllHods($clientId, $deptId, $authUser->id);

        return response()->json([
            'message'        => 'Department permissions saved successfully',
            'saved_count'    => $saved,
            'hod_modules_applied' => $hodApplied,
            'auto_granted_dependencies' => $autoGranted,
        ]);
    }
}
