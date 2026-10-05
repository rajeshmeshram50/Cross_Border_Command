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

    /** Per-request memo: user id => user ids of everyone below them. */
    private static array $reportCache = [];

    /**
     * Every user id that reports to this user, however far down.
     *
     * A reporting manager could not see the leads their own people created:
     * the tiers above answer "what is this person's designation", and a manager
     * whose designation is not Director/HOD landed on 'self' like anyone else,
     * so their team's work was invisible to them. Designation and line
     * management are different questions — an Executive with three juniors
     * under them is still their manager. (QA #65)
     *
     * Walked transitively, so a manager two levels up sees the whole branch of
     * the tree beneath them rather than only their direct reports. A manager is
     * named either by Employee id (`reporting_manager_id`) or by login user id
     * (`reporting_manager_user_id`, used when the manager is a Branch User
     * rather than an employee), so both are followed.
     *
     * @return int[]
     */
    public static function reportUserIds(User $user): array
    {
        if (isset(self::$reportCache[$user->id])) return self::$reportCache[$user->id];

        $rows = Employee::query()
            ->when($user->client_id, fn ($q) => $q->where('client_id', $user->client_id))
            ->get(['id', 'user_id', 'reporting_manager_id', 'reporting_manager_user_id']);

        // Children indexed by whichever handle their manager is recorded under.
        $byManagerEmployee = [];
        $byManagerUser     = [];
        foreach ($rows as $r) {
            if ($r->reporting_manager_id)      $byManagerEmployee[(int) $r->reporting_manager_id][] = $r;
            if ($r->reporting_manager_user_id) $byManagerUser[(int) $r->reporting_manager_user_id][] = $r;
        }

        $myEmployeeId = (int) ($rows->firstWhere('user_id', $user->id)?->id ?? 0);

        $out        = [];
        $seen       = [];                       // employee ids already walked — also the cycle guard
        $frontierE  = $myEmployeeId ? [$myEmployeeId] : [];
        $frontierU  = [(int) $user->id];

        while ($frontierE || $frontierU) {
            $children = [];
            foreach ($frontierE as $eid) foreach ($byManagerEmployee[$eid] ?? [] as $c) $children[] = $c;
            foreach ($frontierU as $uid) foreach ($byManagerUser[$uid] ?? [] as $c) $children[] = $c;

            $frontierE = [];
            $frontierU = [];
            foreach ($children as $c) {
                $eid = (int) $c->id;
                /* A tree the data allows to be cyclic — somebody set two people
                   as each other's manager — would otherwise loop forever. */
                if ($eid === 0 || isset($seen[$eid])) continue;
                $seen[$eid]  = true;
                $frontierE[] = $eid;
                if ($c->user_id) {
                    $out[]       = (int) $c->user_id;
                    $frontierU[] = (int) $c->user_id;
                }
            }
        }

        // Never report yourself as your own subordinate.
        $out = array_values(array_diff(array_unique($out), [(int) $user->id]));
        return self::$reportCache[$user->id] = $out;
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

    /**
     * Departments whose employees share the WHOLE branch's customer /
     * consignee book instead of seeing only the rows they created.
     *
     * Sales owns the book. Legal reads it: the CLM work — KYC, due diligence,
     * segment document checks, agreements — is all done AGAINST a customer, so
     * a Legal employee who cannot see the customer cannot do their job. They
     * were landing on an empty Customers list at every designation, because
     * peer-isolation hid every row (Legal creates none, so "own rows" = none)
     * even when the admin had granted them the sales.customers permission.
     *
     * Membership here only widens WHAT IS VISIBLE. Whether a member may add /
     * edit / delete is still the Permission grant on the module — the same gate
     * that already governs the Sales team.
     */
    public const CUSTOMER_BOOK_DEPARTMENTS = ['sales', 'legal'];

    /** Per-request memo: lower-cased department name list => master ids. */
    private static array $deptIdCache = [];
    /** Per-request memo: user id => their employee record's department_id. */
    private static array $userDeptCache = [];

    /**
     * True when this account is confined to ONE branch — its own.
     *
     * Only the client-level roles (Super Admin, Client Admin, Client User)
     * work across branches; they carry the BranchSwitcher and pick what they
     * are looking at. A Branch Admin (branch_user) and an EMPLOYEE each belong
     * to exactly one branch and get no switcher at all (BRANCH_SWITCHER.md
     * §2), so their rows are pinned here, server-side, instead of trusting the
     * branch_id the client happens to send.
     *
     * Employees were missing from this test, and it only showed on the
     * accounts that escape the designation narrowing: an employee whose
     * designation is Director/CEO or HOD resolves to the 'all' tier, which
     * returns no salesperson filter, so nothing at all was left to scope them
     * and they read every branch's leads in the tenant. The branch_id the SPA
     * injects could not cover for it either — BranchSwitcherContext stores a
     * branch only for branch_user, so an employee's GETs carry no branch_id.
     *
     * An account holding no branch_id is deliberately NOT pinned: reading that
     * as "branch NULL only" would empty the screen for it rather than protect
     * anything.
     */
    public static function pinnedToOwnBranch($user): bool
    {
        return in_array($user->user_type ?? null, ['branch_user', 'employee'], true)
            && !empty($user->branch_id);
    }

    /**
     * True when the user is an EMPLOYEE in a department that shares the branch
     * customer / consignee book (see CUSTOMER_BOOK_DEPARTMENTS). Every other
     * account type keeps the standard creator-hierarchy visibility.
     */
    public static function sharesBranchCustomerBook($user): bool
    {
        return self::employeeIsInDepartment($user, self::CUSTOMER_BOOK_DEPARTMENTS);
    }

    /**
     * True when the user is an EMPLOYEE whose department is Sales. Narrower
     * than sharesBranchCustomerBook() — this one answers "is this a member of
     * the Sales team?", which is what lead assignment keys off.
     */
    public static function isSalesDepartmentEmployee($user): bool
    {
        return self::employeeIsInDepartment($user, ['sales']);
    }

    /**
     * True when this user is an EMPLOYEE who has been posted to a department
     * that is not Sales — the state behind QA #25, where a lead assigned before
     * the transfer stayed editable afterwards.
     *
     * Deliberately narrow on both sides. Only employees are tested: every other
     * account type (Super Admin, Client Admin, Client User, Branch Admin) has
     * no department and must not be swept up by this. And an employee with NO
     * department recorded is left alone rather than treated as "not Sales" —
     * an incomplete record is not a transfer, and locking those people out of
     * their own leads would be a bug of its own.
     */
    public static function movedOutOfSales($user): bool
    {
        if (!$user || ($user->user_type ?? null) !== 'employee') return false;

        $userId = (int) $user->id;
        if (!array_key_exists($userId, self::$userDeptCache)) {
            self::$userDeptCache[$userId] = Employee::where('user_id', $userId)->value('department_id');
        }
        $deptId = self::$userDeptCache[$userId];
        if ($deptId === null) return false;              // no department on file — not a transfer

        $salesIds = self::salesDepartmentIds();
        if (empty($salesIds)) return false;              // no Sales department defined at all
        return !in_array((int) $deptId, $salesIds, true);
    }

    /** Is this user an employee posted to one of the named departments? */
    private static function employeeIsInDepartment($user, array $names): bool
    {
        if (!$user || ($user->user_type ?? null) !== 'employee') {
            return false;
        }
        $deptIds = self::departmentIdsNamed($names);
        if (empty($deptIds)) {
            return false;
        }
        $userId = (int) $user->id;
        if (!array_key_exists($userId, self::$userDeptCache)) {
            self::$userDeptCache[$userId] = Employee::where('user_id', $userId)->value('department_id');
        }
        $deptId = self::$userDeptCache[$userId];
        return $deptId !== null && in_array((int) $deptId, $deptIds, true);
    }

    /** Master-department ids whose name is "Sales" (case-insensitive). Empty
     *  array = no Sales department defined at all. */
    public static function salesDepartmentIds(): array
    {
        return self::departmentIdsNamed(['sales']);
    }

    /** Master-department ids matching any of the given names (case-insensitive).
     *  Names that don't exist are simply absent from the result. */
    public static function departmentIdsNamed(array $names): array
    {
        $names = array_values(array_unique(array_map(fn ($n) => mb_strtolower((string) $n), $names)));
        sort($names);
        if (empty($names)) {
            return [];   // an empty IN () is a SQL syntax error, not "match none"
        }
        $key = implode('|', $names);
        if (isset(self::$deptIdCache[$key])) {
            return self::$deptIdCache[$key];
        }

        $placeholders = implode(',', array_fill(0, count($names), '?'));
        return self::$deptIdCache[$key] = \App\Models\Masters\Departments::query()
            ->whereRaw("LOWER(name) IN ({$placeholders})", $names)
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
        /* Moved out of Sales → nothing is editable any more.
         *
         * Leads already assigned to an employee stayed fully editable after
         * that employee was transferred to another department: the assignment
         * is a row on the lead, and nothing re-checked whether the person it
         * names is still on the Sales team. They keep SEEING their leads — the
         * read path below leaves them in place, flagged read-only, so handover
         * and history are not lost — but a non-Sales employee may no longer
         * change one. (QA #25) */
        if (self::movedOutOfSales($user)) {
            $q->whereRaw('1 = 0');
            return;
        }
        $scope = self::resolveScope($user);
        if ($scope === null) return;
        [$ids, $unassigned] = $scope;
        $q->where(function ($w) use ($ids, $unassigned, $salespersonColumn) {
            $w->whereIn($salespersonColumn, $ids);
            if ($unassigned) $w->orWhereNull($salespersonColumn);
        });
    }

    /**
     * Like applyToLeads(), but ALSO keeps leads that were reassigned AWAY from
     * this user visible — in READ-ONLY mode. A former owner should still see a
     * transferred lead so they can track its history/progress instead of it
     * vanishing from their list (QA #63). "Former owner" = any
     * lead_assignment_histories row whose previous_user_id is this user.
     *
     * VIEW-ONLY: this is used only by the leads list + detail read paths. The
     * edit/reassign/delete endpoints keep using applyToLeads() (owner-scoped),
     * so this widens what a user can SEE, never what they can change. No-op for
     * unrestricted tiers (they already see everything).
     */
    public static function applyToLeadsIncludingFormerOwned($q, User $user, string $salespersonColumn = 'salesperson_id', string $idColumn = 'id'): void
    {
        $scope = self::resolveScope($user);
        if ($scope === null) return;
        [$ids, $unassigned] = $scope;
        /* A manager's own people's leads, by either handle: the report may be
           the lead's salesperson, or merely the one who created it before it
           was handed on. The report says "leads created by", and an employee's
           lead is normally both, so matching either covers it. (QA #65)
           Read-only, like a former-owned lead — isReadOnlyLead() keys on the
           owner scope above, which these ids deliberately stay out of, so this
           widens what a manager can SEE and never what they can change. */
        $reports = self::reportUserIds($user);
        $q->where(function ($w) use ($ids, $unassigned, $salespersonColumn, $user, $idColumn, $reports) {
            $w->whereIn($salespersonColumn, $ids);
            if ($unassigned) $w->orWhereNull($salespersonColumn);
            $w->orWhereIn($idColumn, function ($sub) use ($user) {
                $sub->select('lead_id')->from('lead_assignment_histories')
                    ->where('previous_user_id', $user->id);
            });
            if ($reports) {
                $w->orWhereIn($salespersonColumn, $reports);
                $w->orWhereIn('created_by', $reports);
            }
        });
    }

    /**
     * True when a lead is only VISIBLE to this user (via former ownership) but
     * NOT in their editable scope — i.e. it should render read-only. Drives the
     * `read_only` flag on the list/detail response (QA #63).
     */
    public static function isReadOnlyLead(User $user, ?int $salespersonId): bool
    {
        // An employee no longer posted to Sales reads every lead, owns none.
        if (self::movedOutOfSales($user)) return true;
        $scope = self::resolveScope($user);
        if ($scope === null) return false;              // unrestricted tier → can edit
        [$ids, $unassigned] = $scope;
        if ($salespersonId !== null && in_array((int) $salespersonId, $ids, true)) return false;
        if ($salespersonId === null && $unassigned) return false;
        return true;                                    // visible but not owned → read-only
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
            /* (a) the doc's opportunity is one of the user's visible leads.
               The READ scope, not the owner scope: a manager who can open a
               report's lead but finds its quotations and PIs missing has been
               shown half a deal. (QA #65) */
            $w->whereIn($oppColumn, function ($sub) use ($user) {
                $sub->select('id')->from('leads');
                self::applyToLeadsIncludingFormerOwned($sub, $user);
            });
            // (b) general no-opp docs the user created themselves
            $w->orWhere(function ($g) use ($user, $oppColumn, $creatorColumn) {
                $g->whereNull($oppColumn)->where($creatorColumn, $user->id);
            });
        });
    }
}
