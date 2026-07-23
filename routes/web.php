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

// SPA Fallback - serve index.html for all non-API routes
// This enables proper URL routing for React Router
// The route order ensures API routes (handled in api.php) take precedence
Route::view('/{any}', 'welcome')->where('any', '.*');
