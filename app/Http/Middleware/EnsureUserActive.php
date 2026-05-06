<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Re-validate user.status on every authenticated request.
 *
 * Sanctum tokens stay valid until explicitly revoked, so without this guard
 * an employee whose login is disabled mid-session could keep using their
 * existing token until logout. We also force a token wipe so the SPA
 * receives a 401 and falls back to the login screen, where the existing
 * `$user->status !== 'active'` check in AuthController takes over.
 *
 * The same gate also catches client / branch deactivations — if either the
 * tenant or its parent is no longer active, we treat the session as dead.
 */
class EnsureUserActive
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user) {
            return $next($request);
        }

        $userInactive   = $user->status !== 'active';
        $clientInactive = $user->client_id && $user->client && $user->client->status !== 'active';
        $branchInactive = $user->branch_id && $user->branch && $user->branch->status !== 'active';

        if ($userInactive || $clientInactive || $branchInactive) {
            $user->tokens()->delete();
            abort(401, 'Account is no longer active. Please sign in again.');
        }

        return $next($request);
    }
}
