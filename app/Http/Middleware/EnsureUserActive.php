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

        // effectiveClient() walks user.client_id first, then falls back to
        // user.branch.client_id — needed because branch_user / employee rows
        // often carry only branch_id, so a direct user.client lookup misses
        // the parent org and an inactive client wouldn't lock them out.
        $effectiveClient = $user->effectiveClient();

        $userInactive   = $user->status !== 'active';
        $clientInactive = $effectiveClient && $effectiveClient->status !== 'active';
        $branchInactive = $user->branch_id && $user->branch && $user->branch->status !== 'active';

        if ($userInactive || $clientInactive || $branchInactive) {
            $user->tokens()->delete();
            abort(401, 'Account is no longer active. Please sign in again.');
        }

        // Onboarding gate — an employee whose onboarding isn't fully complete
        // (onboarding_stage_completed = 6) must not retain access, even with a
        // token issued BEFORE the login-level gate existed. We wipe the token
        // and 401 so the SPA force-logs-them-out on their next request. Only
        // users linked to an Employee row are affected (admins / branch users
        // have no Employee.user_id link, so the lookup misses and they pass).
        // A NULL stage is treated as 0 (incomplete). One indexed lookup per
        // request — cheap, and only for accounts that have an employee row.
        $emp = \App\Models\Employee::where('user_id', $user->id)
            ->first(['id', 'onboarding_stage_completed']);
        if ($emp && (int) ($emp->onboarding_stage_completed ?? 0) < 6) {
            $user->tokens()->delete();
            abort(401, 'Your onboarding is not complete yet. You can sign in once HR finishes your onboarding.');
        }

        return $next($request);
    }
}
