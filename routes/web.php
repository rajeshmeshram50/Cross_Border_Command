<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/stamp-paper/download', function (\Illuminate\Http\Request $request) {
    return \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.stamp-paper', [
        'amount'      => $request->query('amount', 100),
        'amountWords' => $request->query('words', 'ONE HUNDRED'),
        'amountHindi' => $request->query('hindi', 'एक सौ रुपये'),
        'content'     => '',
    ])->download('stamp-paper.pdf');
});

Route::get('/o/{slug}', function (string $slug) {
    $invite = \App\Models\EmployeeOnboardingInvite::where('slug', $slug)->first();
    abort_if(!$invite, 404);
    return redirect('/onboarding/' . $invite->token);
})->middleware('throttle:30,1')->where('slug', '[A-Za-z0-9]+');

Route::middleware('throttle:120,1')->group(function () {
    Route::match(['get', 'post'], '/iclock/cdata',      [\App\Http\Controllers\Api\EsslDeviceController::class, 'cdata']);
    Route::get                   ('/iclock/getrequest', [\App\Http\Controllers\Api\EsslDeviceController::class, 'getrequest']);
    Route::post                  ('/iclock/devicecmd',  [\App\Http\Controllers\Api\EsslDeviceController::class, 'devicecmd']);
});

Route::get('/build/{path}', fn () => abort(404))->where('path', '.*');

Route::get('/privacy', fn () => view('legal.privacy', [
    'updated' => '6 October 2026',
    'contact' => config('legal.contact_email'),
]));
Route::get('/terms', fn () => view('legal.terms', [
    'updated' => '6 October 2026',
    'contact' => config('legal.contact_email'),
]));

Route::view('/{any}', 'welcome')->where('any', '.*');
