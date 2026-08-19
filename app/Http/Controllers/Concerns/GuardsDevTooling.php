<?php

namespace App\Http\Controllers\Concerns;

/**
 * Shared gate for the /dev/ test-data endpoints.
 *
 * SandwichTestController, AttendanceTestController and
 * EmployeeJoiningTestController each carried their own copy of the same two
 * checks. Three copies means three places to forget something — which is what
 * happened with the environment guard: the role and tenant checks were correct
 * everywhere, but nothing stopped the endpoints running against production.
 *
 * The routes are already wrapped in an environment check in routes/api.php, so
 * on production they 404 before reaching a controller. This is the second line
 * of defence: if those routes are ever re-registered outside that block, or one
 * of these controllers is reached from a console command or a test, the check
 * still fires. Guards that protect real payroll data should not depend on a
 * caller remembering to wrap them.
 *
 * Split into two methods rather than one because the ordering matters. The role
 * check must run BEFORE validation (an employee gets 403, not a list of
 * validation errors telling them which fields the endpoint takes), and the
 * tenant check must run AFTER it (it needs the validated client_id/branch_id).
 */
trait GuardsDevTooling
{
    /**
     * Environment + role gate. Call FIRST, before validating the request.
     *
     * @param  \App\Models\User|null  $user
     * @param  string  $action  Named in the 403 so the message stays specific
     *                          to the endpoint (e.g. "generate attendance test data").
     */
    protected function guardDevToolAccess($user, string $action): void
    {
        /* These endpoints write fabricated attendance, leave and joining dates
           straight into the live tables that payroll reads. backdate-joining in
           particular rewrites the joining date of every employee in a branch,
           which moves probation, notice period and salary. There is no version
           of production where that is acceptable, so it is a hard 404 rather
           than a 403 — a 403 would confirm the route exists. */
        abort_unless(app()->environment(['local', 'staging']), 404);

        if (!$user || $user->user_type === 'employee') {
            abort(403, "Only an admin / branch user can {$action}.");
        }
    }

    /**
     * Tenant scope gate. Call AFTER validation, with the validated ids.
     *
     * A super-admin may target any tenant; everyone else is held to their own
     * client, and a branch user additionally to their own branch.
     *
     * @param  \App\Models\User  $user
     */
    protected function guardDevToolScope($user, int $clientId, int $branchId): void
    {
        if ($user->user_type === 'super_admin') {
            return;
        }
        if ($user->client_id && $clientId !== (int) $user->client_id) {
            abort(403, 'Out of your client scope.');
        }
        if ($user->user_type === 'branch_user' && $user->branch_id && $branchId !== (int) $user->branch_id) {
            abort(403, 'Out of your branch scope.');
        }
    }
}
