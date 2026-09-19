<?php

namespace App\Http\Middleware;

use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sets the request tenant from the logged-in user. A browser-sent branch_id is
 * ignored on purpose — users only work in their own branch.
 */
class SetTenantContext
{
    public function handle(Request $request, Closure $next): Response
    {
        TenantContext::fromUser($request->user());
        try {
            return $next($request);
        } finally {
            TenantContext::clear();
        }
    }
}
