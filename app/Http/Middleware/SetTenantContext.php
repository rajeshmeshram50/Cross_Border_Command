<?php

namespace App\Http\Middleware;

use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

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
