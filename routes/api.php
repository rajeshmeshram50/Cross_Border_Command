<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\ClientController;
use App\Http\Controllers\Api\DummyItemController;
use Illuminate\Support\Facades\Route;

// Public
Route::post('/login', [AuthController::class, 'login']);

// Protected
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/logout', [AuthController::class, 'logout']);

    // Clients (super_admin)
    Route::apiResource('clients', ClientController::class);

    // Branches (client_admin + super_admin)
    Route::apiResource('branches', BranchController::class);
});

Route::apiResource('dummy-items', DummyItemController::class);
