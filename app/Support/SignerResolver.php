<?php

namespace App\Support;

use App\Models\Employee;
use App\Models\User;

/**
 * Turns a workflow signer ROLE ("Employee", "Reporting Manager", "Client (CEO)")
 * into the real person it means for a given employee.
 *
 * This lived as a private method on HrDocumentSignatureController, which is
 * where documents are SENT. The generate/preview path needed the same answer —
 * {{Signer1Name}} was resolving to the role label, so a preview read "Employee"
 * where the employee's own name belonged — and copying the rules into a second
 * controller is how two screens end up naming different people for the same
 * document. One implementation, both callers.
 */
final class SignerResolver
{
    /**
     * @return array{0: int|null, 1: string}  [user_id, display name]
     */
    public static function resolve(string $roleName, Employee $emp): array
    {
        $r = strtolower(trim($roleName));

        if (str_contains($r, 'reporting')) {
            /* Two paths — employees.reporting_manager_id points to an Employee
             * row (the common case), but reporting_manager_user_id points to a
             * User when the manager is a Branch User / client admin with no
             * employee record. Try the Employee path first, then the User one.
             * Without the fallback a Branch-User manager surfaced as
             * "(unassigned)" on every signature workflow. */
            if ($emp->reporting_manager_id) {
                $mgr = Employee::with('user')->find($emp->reporting_manager_id);
                if ($mgr) {
                    return [$mgr->user_id ?? null, $mgr->display_name ?? 'Reporting Manager'];
                }
            }
            if ($emp->reporting_manager_user_id) {
                $u = User::find($emp->reporting_manager_user_id);
                if ($u) {
                    return [$u->id, $u->name ?: ('Reporting Manager (' . $u->email . ')')];
                }
            }
            return [null, 'Reporting Manager (unassigned)'];
        }

        if (str_contains($r, 'employee')) {
            return [$emp->user_id ?? null, $emp->display_name ?? 'Employee'];
        }

        if (str_contains($r, 'ceo') || str_contains($r, 'client')) {
            // First client_admin in this client stands in for the CEO.
            $admin = $emp->client_id
                ? User::where('client_id', $emp->client_id)->where('user_type', 'client_admin')->first()
                : null;
            return [$admin?->id ?? null, $admin?->name ?? 'Client (CEO) (unassigned)'];
        }

        return [null, $roleName ?: 'Unassigned'];
    }

    /** Just the name — for the render path, which has no use for the user id. */
    public static function name(string $roleName, Employee $emp): string
    {
        return self::resolve($roleName, $emp)[1];
    }
}
