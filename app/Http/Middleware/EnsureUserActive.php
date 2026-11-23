<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserActive
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user) {
            return $next($request);
        }

        $effectiveClient = $user->effectiveClient();

        $userInactive   = $user->status !== 'active';
        $clientInactive = $effectiveClient && $effectiveClient->status !== 'active';
        $branchInactive = $user->branch_id && $user->branch && $user->branch->status !== 'active';

        if ($userInactive || $clientInactive || $branchInactive) {
            $user->tokens()->delete();
            abort(401, 'Account is no longer active. Please sign in again.');
        }

        return $next($request);
    }
}
