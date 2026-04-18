<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// SPA Fallback - serve index.html for all non-API routes
// This enables proper URL routing for React Router
// The route order ensures API routes (handled in api.php) take precedence
Route::view('/{any}', 'welcome')->where('any', '.*');
