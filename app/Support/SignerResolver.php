<?php

namespace App\Support;

use App\Models\Employee;
use App\Models\User;

final class SignerResolver
{
    public static function resolve(string $roleName, Employee $emp): array
    {
        $r = strtolower(trim($roleName));

        if (str_contains($r, 'reporting')) {
            if ($emp->reporting_manager_id) {
                $mgr = Employee::with(['user', 'designation'])->find($emp->reporting_manager_id);
                if ($mgr) {
                    return [$mgr->resolved_user_id, $mgr->display_name ?? 'Reporting Manager', self::designationOf($mgr)];
                }
            }
            if ($emp->reporting_manager_user_id) {
                $u = User::find($emp->reporting_manager_user_id);
                if ($u) {
                    return [$u->id, $u->name ?: ('Reporting Manager (' . $u->email . ')'), self::designationForUser($u->id)];
                }
            }
            return [null, 'Reporting Manager (unassigned)', null];
        }

        if (str_contains($r, 'employee')) {
            return [$emp->resolved_user_id, $emp->display_name ?? 'Employee', self::designationOf($emp)];
        }

        if (str_contains($r, 'ceo') || str_contains($r, 'client')) {
            $admin = $emp->client_id
                ? User::where('client_id', $emp->client_id)->where('user_type', 'client_admin')->first()
                : null;
            return [
                $admin?->id ?? null,
                $admin?->name ?? 'Client (CEO) (unassigned)',
                $admin ? self::designationForUser($admin->id) : null,
            ];
        }

        return [null, $roleName ?: 'Unassigned', null];
    }

    public static function designationOf(Employee $emp): ?string
    {
        return $emp->designation?->name ?: null;
    }

    public static function designationForUser(int $userId): ?string
    {
        $emp = Employee::with('designation')->where('user_id', $userId)->first();

        return $emp ? self::designationOf($emp) : null;
    }

    public static function name(string $roleName, Employee $emp): string
    {
        return self::resolve($roleName, $emp)[1];
    }
}
