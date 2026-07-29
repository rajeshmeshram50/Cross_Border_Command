<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// Public (no-auth) stamp-paper PDF download. Query params override the
// defaults: ?amount=100&words=ONE+HUNDRED&hindi=...  Must sit ABOVE the
// SPA catch-all below or the fallback view would swallow it.
Route::get('/stamp-paper/download', function (\Illuminate\Http\Request $request) {
    return \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.stamp-paper', [
        'amount'      => $request->query('amount', 100),
        'amountWords' => $request->query('words', 'ONE HUNDRED'),
        'amountHindi' => $request->query('hindi', 'एक सौ रुपये'),
        'content'     => '',
    ])->download('stamp-paper.pdf');
});

// Short public onboarding link. The emailed/shared link is /o/{slug}; this
// expands it to the full SPA route /onboarding/{64-char-token}, keeping the
// long token as the real credential. Throttled (30/min/IP, matching the
// onboarding API — CLAUDE.md rule #6) so the short slug can't be brute-forced.
// MUST sit above the SPA catch-all below or the fallback view would swallow it.
Route::get('/o/{slug}', function (string $slug) {
    $invite = \App\Models\EmployeeOnboardingInvite::where('slug', $slug)->first();
    abort_if(!$invite, 404);
    // Redirect on the same host the visitor hit (preserves scheme/host/port);
    // invite state (expired / used / cancelled) is surfaced by the SPA + API.
    return redirect('/onboarding/' . $invite->token);
})->middleware('throttle:30,1')->where('slug', '[A-Za-z0-9]+');

// ── eSSL / ZKTeco biometric terminal push endpoints (ADMS / iclock) ──────────
// The device hard-codes the /iclock/* path at the WEB ROOT (not /api) and
// cannot send a Sanctum or CSRF token, so these are public — CSRF-exempt in
// bootstrap/app.php — and guarded by the device Serial (SN) → device_terminals
// registry inside the controller. MUST sit above the SPA catch-all below or the
// fallback view would swallow them. See docs/ESSL_ATTENDANCE_INTEGRATION.md §17.
// Rate-limited so a misbehaving/hostile source can't flood the public path.
// A real terminal polls ~every 30s and pushes a handful of rows per punch, so
// 120/min/IP is generous headroom.
Route::middleware('throttle:120,1')->group(function () {
    Route::match(['get', 'post'], '/iclock/cdata',      [\App\Http\Controllers\Api\EsslDeviceController::class, 'cdata']);
    Route::get                   ('/iclock/getrequest', [\App\Http\Controllers\Api\EsslDeviceController::class, 'getrequest']);
    Route::post                  ('/iclock/devicecmd',  [\App\Http\Controllers\Api\EsslDeviceController::class, 'devicecmd']);
});

// SPA Fallback - serve index.html for all non-API routes
// This enables proper URL routing for React Router
// The route order ensures API routes (handled in api.php) take precedence
Route::view('/{any}', 'welcome')->where('any', '.*');
