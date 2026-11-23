<?php

namespace App\Support;

use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use App\Models\User;

class SalesVisibility
{
    public const DESIGNATION_DIRECTOR    = 'Director / CEO';
    public const DESIGNATION_MANAGER     = 'Head of Department (HOD)';
    public const DESIGNATION_TEAM_LEADER = 'Team Leader';
    public const DISTRIBUTE_MODULE_SLUG  = 'sales.workplace';

    private static array $tierCache = [];

    private static function tier(User $user): string
    {
        if (isset(self::$tierCache[$user->id])) return self::$tierCache[$user->id];

        $result = 'self';
        if ($user->user_type !== 'employee') {
            $result = 'all';
        } else {
            $designation = self::designationOf($user);
            if (in_array($designation, [self::DESIGNATION_DIRECTOR, self::DESIGNATION_MANAGER], true)) {
                $result = 'all';
            } elseif ($designation === self::DESIGNATION_TEAM_LEADER && self::hasDistributePermission($user)) {
                $result = 'team';
            }
        }

        return self::$tierCache[$user->id] = $result;
    }

    private static function designationOf(User $user): ?string
    {
        return optional(
            Employee::query()
                ->where('user_id', $user->id)
                ->with('designation:id,name')
                ->first(['id', 'user_id', 'designation_id'])
        )->designation?->name;
    }

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

    private static array $reportCache = [];

    public static function reportUserIds(User $user): array
    {
        if (isset(self::$reportCache[$user->id])) return self::$reportCache[$user->id];

        $rows = Employee::query()
            ->when($user->client_id, fn ($q) => $q->where('client_id', $user->client_id))
            ->get(['id', 'user_id', 'reporting_manager_id', 'reporting_manager_user_id']);

        $byManagerEmployee = [];
        $byManagerUser     = [];
        foreach ($rows as $r) {
            if ($r->reporting_manager_id)      $byManagerEmployee[(int) $r->reporting_manager_id][] = $r;
            if ($r->reporting_manager_user_id) $byManagerUser[(int) $r->reporting_manager_user_id][] = $r;
        }

        $myEmployeeId = (int) ($rows->firstWhere('user_id', $user->id)?->id ?? 0);

        $out        = [];
        $seen       = [];
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
                if ($eid === 0 || isset($seen[$eid])) continue;
                $seen[$eid]  = true;
                $frontierE[] = $eid;
                if ($c->user_id) {
                    $out[]       = (int) $c->user_id;
                    $frontierU[] = (int) $c->user_id;
                }
            }
        }

        $out = array_values(array_diff(array_unique($out), [(int) $user->id]));
        return self::$reportCache[$user->id] = $out;
    }

    public static function resolveScope(User $user): ?array
    {
        switch (self::tier($user)) {
            case 'all':
                return null;
            case 'team':
                return [[(int) $user->id], false];
            default:
                return [[(int) $user->id], false];
        }
    }

    public static function canDistribute(User $user): bool
    {
        return true;
    }

    public static function assignableUserIds(User $user): ?array
    {
        return null;
    }

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
            $q->where('branch_id', $branchId);
        }
        return $q->pluck('user_id')->map(fn ($v) => (int) $v)->unique()->values()->all();
    }

    public const CUSTOMER_BOOK_DEPARTMENTS = ['sales', 'legal'];

    private static array $deptIdCache = [];
    private static array $userDeptCache = [];

    public static function pinnedToOwnBranch($user): bool
    {
        return in_array($user->user_type ?? null, ['branch_user', 'employee'], true)
            && !empty($user->branch_id);
    }

    public static function sharesBranchCustomerBook($user): bool
    {
        return self::employeeIsInDepartment($user, self::CUSTOMER_BOOK_DEPARTMENTS);
    }

    public static function isSalesDepartmentEmployee($user): bool
    {
        return self::employeeIsInDepartment($user, ['sales']);
    }

    public static function movedOutOfSales($user): bool
    {
        if (!$user || ($user->user_type ?? null) !== 'employee') return false;

        $userId = (int) $user->id;
        if (!array_key_exists($userId, self::$userDeptCache)) {
            self::$userDeptCache[$userId] = Employee::where('user_id', $userId)->value('department_id');
        }
        $deptId = self::$userDeptCache[$userId];
        if ($deptId === null) return false;

        $salesIds = self::salesDepartmentIds();
        if (empty($salesIds)) return false;
        return !in_array((int) $deptId, $salesIds, true);
    }

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

    public static function salesDepartmentIds(): array
    {
        return self::departmentIdsNamed(['sales']);
    }

    public static function departmentIdsNamed(array $names): array
    {
        $names = array_values(array_unique(array_map(fn ($n) => mb_strtolower((string) $n), $names)));
        sort($names);
        if (empty($names)) {
            return [];
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

    public static function applyToLeads($q, User $user, string $salespersonColumn = 'salesperson_id'): void
    {
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

    public static function applyToLeadsIncludingFormerOwned($q, User $user, string $salespersonColumn = 'salesperson_id', string $idColumn = 'id'): void
    {
        $scope = self::resolveScope($user);
        if ($scope === null) return;
        [$ids, $unassigned] = $scope;
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

    public static function isReadOnlyLead(User $user, ?int $salespersonId): bool
    {
        if (self::movedOutOfSales($user)) return true;
        $scope = self::resolveScope($user);
        if ($scope === null) return false;
        [$ids, $unassigned] = $scope;
        if ($salespersonId !== null && in_array((int) $salespersonId, $ids, true)) return false;
        if ($salespersonId === null && $unassigned) return false;
        return true;
    }

    public static function applyToSalesDocs($q, User $user, string $oppColumn = 'opp_id', string $creatorColumn = 'created_by'): void
    {
        $scope = self::resolveScope($user);
        if ($scope === null) return;
        $q->where(function ($w) use ($user, $oppColumn, $creatorColumn) {
            $w->whereIn($oppColumn, function ($sub) use ($user) {
                $sub->select('id')->from('leads');
                self::applyToLeadsIncludingFormerOwned($sub, $user);
            });
            $w->orWhere(function ($g) use ($user, $oppColumn, $creatorColumn) {
                $g->whereNull($oppColumn)->where($creatorColumn, $user->id);
            });
        });
    }
}
