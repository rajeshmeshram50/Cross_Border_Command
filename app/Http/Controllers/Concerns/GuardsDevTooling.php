<?php

namespace App\Http\Controllers\Concerns;

trait GuardsDevTooling
{
    protected function guardDevToolAccess($user, string $action): void
    {
        abort_unless(app()->environment(['local', 'staging']), 404);

        if (!$user || $user->user_type === 'employee') {
            abort(403, "Only an admin / branch user can {$action}.");
        }
    }

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
