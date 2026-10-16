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
            // Tenant (client/branch) for the request — read by the BelongsToTenant model scope.
            'tenant' => \App\Http\Middleware\SetTenantContext::class,
            'tenant.document' => \App\Http\Middleware\SetTenantFromDocument::class,
        ]);

        // Dev Tools → Load Testing. Inert unless the caller sends X-Profile: 1,
        // and hard-disabled outside local/staging, so it costs normal traffic
        // nothing. Appended to the api group so it wraps the whole stack and
        // therefore counts the queries auth and tenant checks make too.
        $middleware->appendToGroup('api', \App\Http\Middleware\ProfileRequest::class);

        // eSSL / ZKTeco terminals POST to /iclock/* over plain HTTP and cannot
        // carry a CSRF token — exempt the device push path (it is tenant-guarded
        // by device Serial in EsslDeviceController). See ESSL doc §17.
        $middleware->validateCsrfTokens(except: [
            'iclock/*',
        ]);

        /* Behind a TLS terminator, believe the forwarded headers.
         *
         * Without this Laravel reads the scheme off the connection it can
         * see — plain HTTP from the proxy — and builds every absolute URL as
         * http:// on the HTTPS port. Assets 404, and anything signed is
         * signed against the wrong URL, so it fails validation on the way
         * back in.
         *
         * Only private ranges are trusted: these headers are forgeable, and a
         * request that reached us from the internet has no business claiming
         * to be anything other than what it is. */
        $middleware->trustProxies(
            at: ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
            headers: Illuminate\Http\Request::HEADER_X_FORWARDED_FOR
                | Illuminate\Http\Request::HEADER_X_FORWARDED_HOST
                | Illuminate\Http\Request::HEADER_X_FORWARDED_PORT
                | Illuminate\Http\Request::HEADER_X_FORWARDED_PROTO,
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
