<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\ClientController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DummyItemController;
use App\Http\Controllers\Api\MasterController;
use App\Http\Controllers\Api\OrganizationTypeController;
use App\Http\Controllers\Api\PlanController;
use App\Http\Controllers\Api\PermissionController;
use App\Http\Controllers\Api\ForgotPasswordController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\SubscriptionController;
use Illuminate\Support\Facades\Route;

// Public
Route::post('/login', [AuthController::class, 'login']);
Route::post('/forgot-password/send-otp', [ForgotPasswordController::class, 'sendOtp']);
Route::post('/forgot-password/verify-otp', [ForgotPasswordController::class, 'verifyOtp']);
Route::post('/forgot-password/reset', [ForgotPasswordController::class, 'resetPassword']);

// Protected
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/change-password', [AuthController::class, 'changePassword']);

    // Dashboard
    Route::get('/dashboard/admin-stats', [DashboardController::class, 'adminStats']);
    Route::get('/dashboard/client-stats', [DashboardController::class, 'clientStats']);

    // Clients
    Route::apiResource('clients', ClientController::class);

    // Branches
    Route::apiResource('branches', BranchController::class);

    // Plans (admin CRUD)
    Route::apiResource('plans', PlanController::class);

    // Organization Types (master data — super admin manages; all auth users can list)
    Route::apiResource('organization-types', OrganizationTypeController::class)
        ->parameters(['organization-types' => 'organizationType']);

    // Generic Master APIs — one set of routes dispatches 50 master tables by slug.
    // GET    /api/master/{slug}          list
    // POST   /api/master/{slug}          create
    // GET    /api/master/{slug}/{id}     show
    // PUT    /api/master/{slug}/{id}     update
    // DELETE /api/master/{slug}/{id}     delete
    Route::get   ('/master/{slug}',         [MasterController::class, 'list']);
    Route::post  ('/master/{slug}',         [MasterController::class, 'store']);
    Route::get   ('/master/{slug}/{id}',    [MasterController::class, 'show']);
    Route::put   ('/master/{slug}/{id}',    [MasterController::class, 'update']);
    Route::delete('/master/{slug}/{id}',    [MasterController::class, 'destroy']);

    // Subscription (client buy plan)
    Route::get('/subscription/plans', [SubscriptionController::class, 'plans']);
    Route::get('/subscription/status', [SubscriptionController::class, 'status']);
    Route::post('/subscription/subscribe', [SubscriptionController::class, 'subscribe']);

    // Payments
    Route::get('/payments/stats', [PaymentController::class, 'stats']);
    Route::post('/payments/{payment}/send-reminder', [PaymentController::class, 'sendReminder']);
    Route::apiResource('payments', PaymentController::class);

    // Permissions
    Route::get('/modules', [PermissionController::class, 'modules']);
    Route::get('/permissions/users', [PermissionController::class, 'manageableUsers']);
    Route::get('/permissions/user/{userId}', [PermissionController::class, 'getUserPermissions']);
    Route::post('/permissions/user/{userId}', [PermissionController::class, 'savePermissions']);
});

// Invoice routes (auth via query token, outside sanctum middleware)
Route::get('/payments/{payment}/invoice/download', [PaymentController::class, 'downloadInvoice']);
Route::get('/payments/{payment}/invoice/view', [PaymentController::class, 'viewInvoice']);

Route::apiResource('dummy-items', DummyItemController::class);
