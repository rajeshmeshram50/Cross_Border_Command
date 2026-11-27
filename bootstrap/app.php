<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        attributes: ['middleware' => ['auth:sanctum']],
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'user.active' => \App\Http\Middleware\EnsureUserActive::class,
            'tenant' => \App\Http\Middleware\SetTenantContext::class,
            'tenant.document' => \App\Http\Middleware\SetTenantFromDocument::class,
        ]);

        $middleware->appendToGroup('api', \App\Http\Middleware\ProfileRequest::class);

        $middleware->appendToGroup('api', \App\Http\Middleware\CompressJsonResponse::class);

        $middleware->validateCsrfTokens(except: [
            'iclock/*',
        ]);

        $middleware->trustProxies(
            at: ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
            headers: Illuminate\Http\Request::HEADER_X_FORWARDED_FOR
                | Illuminate\Http\Request::HEADER_X_FORWARDED_HOST
                | Illuminate\Http\Request::HEADER_X_FORWARDED_PORT
                | Illuminate\Http\Request::HEADER_X_FORWARDED_PROTO,
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
    })->create();
