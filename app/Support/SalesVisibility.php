<?php

namespace App\Support;

use App\Models\Employee;
use App\Models\User;

/**
 * Sales-Matrix row visibility by ROLE + reporting hierarchy.
 *
 * On top of the existing client/branch scoping, the Sales Matrix narrows
 * leads (and everything derived from them — quotations, PIs, distribution
 * counts) to what a user is allowed to see based on their seeded sales role
 * and the lead-assignment (`leads.salesperson_id`):
 *
 *   Super Admin / Client Admin            → everything in scope (no narrowing)
 *   Branch Admin (main-branch user)       → everything in the branch
 *   Sales Manager                         → leads assigned to SELF + direct
 *                                           reports, PLUS unassigned leads
 *                                           (so they can distribute them)
 *   Sales Employee / Sales Intern         → ONLY leads assigned to themselves
 *   (no recognised sales role)            → unchanged (no narrowing)
 *
 * "Role" is read from the user's Employee record (`primary_role_id` →
 * master_roles.name). "Reports" are Employees whose
 * `reporting_manager_user_id` points at the manager's user account.
 */
class SalesVisibility
{
    public const ROLE_MANAGER  = 'Sales Manager';
    public const ROLE_EMPLOYEE = 'Sales Employee';
    public const ROLE_INTERN   = 'Sales Intern';

    /**
     * Resolve a user's lead-visibility scope.
     *
     * @return array{0: int[], 1: bool}|null
     *   null               → no narrowing (admin tiers / no sales role)
     *   [$userIds, $unassigned]
     *                      → restrict to salesperson_id IN $userIds
     *                        (plus unassigned rows when $unassigned is true)
     */
    public static function resolveScope(User $user): ?array
    {
        // Admin tiers see everything within the client/branch scope.
        if (in_array($user->user_type, ['super_admin', 'client_admin'], true)) {
            return null;
        }
        // A main-branch user acts as the Branch Admin → full branch.
        if ($user->user_type === 'branch_user' && ($user->branch?->is_main ?? false)) {
            return null;
        }

        $emp = Employee::query()
            ->where('user_id', $user->id)
            ->with('primaryRole:id,name')
            ->first(['id', 'user_id', 'primary_role_id']);

        $role = $emp?->primaryRole?->name;

        if ($role === self::ROLE_MANAGER) {
            // Self + direct reports; include unassigned so the manager can
            // see and distribute leads that aren't yet owned by anyone.
            // Reports are matched primarily by `reporting_manager_id` (the
            // manager's EMPLOYEE id — what the HR form actually saves), with
            // `reporting_manager_user_id` kept as a fallback.
            $reportUserIds = Employee::query()
                ->where(function ($w) use ($emp, $user) {
                    $w->where('reporting_manager_id', $emp->id)
                      ->orWhere('reporting_manager_user_id', $user->id);
                })
                ->whereNotNull('user_id')
                ->pluck('user_id')
                ->all();
            $ids = array_values(array_unique(array_map('intval', array_merge([$user->id], $reportUserIds))));
            return [$ids, true];
        }

        if (in_array($role, [self::ROLE_EMPLOYEE, self::ROLE_INTERN], true)) {
            // Only the leads individually assigned to them.
            return [[(int) $user->id], false];
        }

        // No recognised sales role → leave visibility unchanged.
        return null;
    }

    /** True when the user can BULK-distribute leads (manager and up). Drives
     *  the My Workplace "Assign Leads" / "Lead Distribution" / sync buttons. */
    public static function canDistribute(User $user): bool
    {
        $scope = self::resolveScope($user);
        if ($scope === null) return true;          // admin tiers
        return $scope[1] === true;                 // manager (unassigned access)
    }

    /**
     * Who a user may (re)assign a lead TO — their own reporting chain:
     * themselves, their reporting manager (assign UP), and their direct
     * reports (assign DOWN). Admin tiers return null = anyone in scope.
     *
     * @return int[]|null
     */
    public static function assignableUserIds(User $user): ?array
    {
        // Admin tiers (and non-sales roles) can assign to anyone in scope.
        if (self::resolveScope($user) === null) return null;

        $emp = Employee::query()
            ->where('user_id', $user->id)
            ->first(['id', 'user_id', 'reporting_manager_id', 'reporting_manager_user_id']);

        $ids = [(int) $user->id];                          // self
        // Manager (assign UP): prefer the stored user-id, else resolve the
        // user account from the manager's EMPLOYEE id (what the HR form saves).
        if ($emp?->reporting_manager_user_id) {
            $ids[] = (int) $emp->reporting_manager_user_id;
        } elseif ($emp?->reporting_manager_id) {
            $mgrUserId = Employee::query()
                ->where('id', $emp->reporting_manager_id)
                ->value('user_id');
            if ($mgrUserId) $ids[] = (int) $mgrUserId;
        }
        $reportUserIds = Employee::query()                  // direct reports (down)
            ->where(function ($w) use ($emp, $user) {
                $w->where('reporting_manager_id', $emp->id)
                  ->orWhere('reporting_manager_user_id', $user->id);
            })
            ->whereNotNull('user_id')
            ->pluck('user_id')
            ->all();

        return array_values(array_unique(array_merge($ids, array_map('intval', $reportUserIds))));
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
