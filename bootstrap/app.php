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
    // Private broadcast channels (Reverb) — the /broadcasting/auth route is
    // Sanctum-guarded so SPA bearer tokens authorise channel subscriptions.
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        attributes: ['middleware' => ['auth:sanctum']],
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Re-validate user/tenant status after Sanctum auth on every request,
        // so disabled employees / inactive tenants can't keep using a token
        // that was issued before they were deactivated.
        $middleware->alias([
            'user.active' => \App\Http\Middleware\EnsureUserActive::class,
        ]);

        // eSSL / ZKTeco terminals POST to /iclock/* over plain HTTP and cannot
        // carry a CSRF token — exempt the device push path (it is tenant-guarded
        // by device Serial in EsslDeviceController). See ESSL doc §17.
        $middleware->validateCsrfTokens(except: [
            'iclock/*',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
