<?php

namespace App\Support;

use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;

/**
 * Sales-Matrix row visibility by DESIGNATION + delegated permission.
 *
 * On top of the existing client/branch scoping, the Sales Matrix narrows
 * leads (and everything derived from them — quotations, PIs, distribution
 * counts) to one of three TIERS:
 *
 *   'all'   → Super Admin / Client Admin / Branch Admin (branch_user) /
 *             Designation = Head of Department (HOD, the Sales Manager).
 *             Sees EVERY lead in scope and may distribute to anyone.
 *   'team'  → Designation = Team Leader WHO HAS the delegated distribution
 *             permission (can_edit on Sales Matrix → My Workplace). SEES only
 *             the leads HOD assigned to THEM (not the whole team, not all), but
 *             may DISTRIBUTE those down to their direct reports.
 *   'self'  → Everyone else (incl. a Team Leader without the permission).
 *             Sees ONLY the leads assigned to them; cannot distribute.
 *
 * Designation is read from the Employee record (`designation_id` →
 * master_designations.name). Reports are Employees whose
 * `reporting_manager_id` points at the leader's Employee id (with
 * `reporting_manager_user_id` as a fallback). Department is intentionally NOT
 * enforced here — module access is governed by the Permission grant.
 */
class SalesVisibility
{
    /** Designation that always acts as the Sales Manager (full + distribute). */
    public const DESIGNATION_DIRECTOR    = 'Director / CEO';
    public const DESIGNATION_MANAGER     = 'Head of Department (HOD)';
    /** Designation that MAY distribute to its team when granted the permission. */
    public const DESIGNATION_TEAM_LEADER = 'Team Leader';
    /** Module whose `can_edit` grant delegates distribution to a Team Leader. */
    public const DISTRIBUTE_MODULE_SLUG  = 'sales.workplace';

    /** Per-request memo so resolveScope/canDistribute/assignableUserIds don't
     *  re-query the employee + permission rows on every call. */
    private static array $tierCache = [];

    /**
     * Classify the user into a visibility tier: 'all' | 'team' | 'self'.
     */
    private static function tier(User $user): string
    {
        if (isset(self::$tierCache[$user->id])) return self::$tierCache[$user->id];

        $result = 'self';
        // The designation hierarchy applies ONLY to HR employees (the people
        // who carry a Sales designation). Every other account type — Super
        // Admin, Client Admin, Client User, and the Branch Admin (branch_user)
        // — sees its full scope (designation tiers apply only to employees).
        if ($user->user_type !== 'employee') {
            $result = 'all';
        } else {
            $designation = self::designationOf($user);
            if (in_array($designation, [self::DESIGNATION_DIRECTOR, self::DESIGNATION_MANAGER], true)) {
                $result = 'all';                              // Director/CEO + HOD = full access
            } elseif ($designation === self::DESIGNATION_TEAM_LEADER && self::hasDistributePermission($user)) {
                $result = 'team';                            // delegated Team Leader
            }
        }

        return self::$tierCache[$user->id] = $result;
    }

    /** Designation name for a user's Employee record (null if none). */
    private static function designationOf(User $user): ?string
    {
        return optional(
            Employee::query()
                ->where('user_id', $user->id)
                ->with('designation:id,name')
                ->first(['id', 'user_id', 'designation_id'])
        )->designation?->name;
    }

    /** True when the user holds can_edit on Sales Matrix → My Workplace — the
     *  delegated lead-distribution permission the HOD grants to a Team Leader. */
    private static function hasDistributePermission(User $user): bool
    {
        static $moduleId = null;
        if ($moduleId === null) {
            $moduleId = Module::query()->where('slug', self::DISTRIBUTE_MODULE_SLUG)->value('id') ?: 0;
        }
        if (!$moduleId) return false;

        return Permission::query()
            ->where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where('can_edit', true)
            ->exists();
    }

    /**
     * Resolve a user's lead-visibility scope.
     *
     * @return array{0: int[], 1: bool}|null
     *   null               → no narrowing ('all' tier)
     *   [$userIds, false]  → restrict to salesperson_id IN $userIds
     */
    public static function resolveScope(User $user): ?array
    {
        switch (self::tier($user)) {
            case 'all':
                return null;
            case 'team':
                // A delegated Team Leader SEES only the leads HOD assigned to
                // THEM (not their reports' leads, not all) — they distribute
                // those down via assignableUserIds(), they don't watch the team.
                return [[(int) $user->id], false];
            default:
                return [[(int) $user->id], false];
        }
    }

    /** Lead distribution/assignment is open to EVERY level — anyone in the
     *  Sales Matrix can assign a lead. The DESIGNATION tiers only narrow what a
     *  user SEES (resolveScope), not who they can assign to. Drives the My
     *  Workplace Assign / Lead Distribution / sync buttons. */
    public static function canDistribute(User $user): bool
    {
        return true;
    }

    /**
     * Who a user may (re)assign a lead TO. No hierarchy restriction — every
     * level can assign to ANY Sales-department employee. `null` = no per-user
     * narrowing; the SALES-DEPARTMENT gate (salesDepartmentUserIds + the
     * picker/assign filters) is what limits targets to Sales-department members.
     *
     * @return int[]|null
     */
    public static function assignableUserIds(User $user): ?array
    {
        return null;
    }

    /**
     * User ids of employees in the SALES department (within the given user's
     * client scope). Lead-assignment targets are restricted to this set — a
     * lead can never be handed to someone outside the Sales department.
     * Returns [] when no "Sales" department exists.
     *
     * @return int[]
     */
    public static function salesDepartmentUserIds(User $user, ?int $branchId = null): array
    {
        $deptIds = self::salesDepartmentIds();
        if (empty($deptIds)) return [];

        $q = Employee::query()
            ->whereIn('department_id', $deptIds)
            ->whereNotNull('user_id');
        if ($user->client_id) {
            $q->where('client_id', $user->client_id);
        }
        if ($branchId) {
            $q->where('branch_id', $branchId);   // only this branch's Sales people
        }
        return $q->pluck('user_id')->map(fn ($v) => (int) $v)->unique()->values()->all();
    }

    /** Master-department ids whose name is "Sales" (case-insensitive). Empty
     *  array = no Sales department defined at all. */
    public static function salesDepartmentIds(): array
    {
        return \App\Models\Masters\Departments::query()
            ->whereRaw('LOWER(name) = ?', ['sales'])
            ->pluck('id')
            ->map(fn ($v) => (int) $v)
            ->all();
    }

    /**
     * Narrow a LEADS query (or any query carrying a salesperson column) to
     * the rows the user may see. No-op for admin tiers / non-sales roles.
     */
    public static function applyToLeads($q, User $user, string $salespersonColumn = 'salesperson_id'): void
    {
        $scope = self::resolveScope($user);
        if ($scope === null) return;
        [$ids, $unassigned] = $scope;
        $q->where(function ($w) use ($ids, $unassigned, $salespersonColumn) {
            $w->whereIn($salespersonColumn, $ids);
            if ($unassigned) $w->orWhereNull($salespersonColumn);
        });
    }

    /**
     * Narrow a QUOTATION / PI query: a document is visible when its
     * opportunity's lead is visible to the user, OR (for general no-opp
     * documents) the user created it. No-op for admin tiers.
     */
    public static function applyToSalesDocs($q, User $user, string $oppColumn = 'opp_id', string $creatorColumn = 'created_by'): void
    {
        $scope = self::resolveScope($user);
        if ($scope === null) return;
        $q->where(function ($w) use ($user, $oppColumn, $creatorColumn) {
            // (a) the doc's opportunity is one of the user's visible leads
            $w->whereIn($oppColumn, function ($sub) use ($user) {
                $sub->select('id')->from('leads');
                self::applyToLeads($sub, $user);
            });
            // (b) general no-opp docs the user created themselves
            $w->orWhere(function ($g) use ($user, $oppColumn, $creatorColumn) {
                $g->whereNull($oppColumn)->where($creatorColumn, $user->id);
            });
        });
    }
}
