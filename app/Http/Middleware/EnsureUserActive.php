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

        // NOTE: onboarding-incomplete employees are intentionally NOT blocked
        // here. They must be able to reach the Inbox to sign their pending
        // onboarding documents (blocking them created a deadlock — no login →
        // no signing → onboarding never completes). The SPA restricts them to
        // the Inbox via the `onboarding_pending` flag, and every business
        // module is still permission-gated, which a fresh employee lacks until
        // the branch grants access post-onboarding.

        return $next($request);
    }
}
