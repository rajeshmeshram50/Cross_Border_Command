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

// SPA Fallback - serve index.html for all non-API routes
// This enables proper URL routing for React Router
// The route order ensures API routes (handled in api.php) take precedence
Route::view('/{any}', 'welcome')->where('any', '.*');
