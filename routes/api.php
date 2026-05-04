<?php

use App\Http\Controllers\Api\AnnouncementController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\CandidateController;
use App\Http\Controllers\Api\ClientController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DummyItemController;
use App\Http\Controllers\Api\EmployeeController;
use App\Http\Controllers\Api\EmployeeDocumentController;
use App\Http\Controllers\Api\ExitController;
use App\Http\Controllers\Api\ExpenseClaimController;
use App\Http\Controllers\Api\PreviousEmploymentController;
use App\Http\Controllers\Api\HiringRequestController;
use App\Http\Controllers\Api\MasterController;
use App\Http\Controllers\Api\OnboardingController;
use App\Http\Controllers\Api\OrganizationTypeController;
use App\Http\Controllers\Api\PlanController;
use App\Http\Controllers\Api\PermissionController;
use App\Http\Controllers\Api\RecruitmentController;
use App\Http\Controllers\Api\ForgotPasswordController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\RazorpayWebhookController;
use App\Http\Controllers\Api\SubscriptionController;
use Illuminate\Support\Facades\Route;

// Public — onboarding flow. Token is the only auth: GET previews the invite,
// POST submits the candidate's completed form. Both fail with 410 if the
// invite has been used / cancelled / expired.
Route::get ('/onboarding/{token}',          [OnboardingController::class, 'show']);
Route::post('/onboarding/{token}/complete', [OnboardingController::class, 'complete']);

// Public
Route::post('/login', [AuthController::class, 'login']);
Route::post('/google-login', [AuthController::class, 'googleLogin']);
Route::post('/forgot-password/send-otp', [ForgotPasswordController::class, 'sendOtp']);
Route::post('/forgot-password/verify-otp', [ForgotPasswordController::class, 'verifyOtp']);
Route::post('/forgot-password/reset', [ForgotPasswordController::class, 'resetPassword']);
Route::post('/razorpay/webhook', [RazorpayWebhookController::class, 'handle']);

// Protected
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/change-password', [AuthController::class, 'changePassword']);
    Route::post('/me/branding', [AuthController::class, 'updateBranding']);

    // Dashboard
    Route::get('/dashboard/admin-stats', [DashboardController::class, 'adminStats']);
    Route::get('/dashboard/client-stats', [DashboardController::class, 'clientStats']);

    // Clients
    Route::get('/clients/stats', [ClientController::class, 'stats']);
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
    // Employees — full CRUD + auto-numbered EMP-### + welcome-mail provisioning.
    // Declared BEFORE the generic /master/{slug} routes so apiResource params
    // resolve cleanly.
    Route::get   ('/employees/next-code',         [EmployeeController::class, 'nextCode']);
    Route::get   ('/employees/managers',          [EmployeeController::class, 'managers']);
    Route::get   ('/employees/available-assets',  [EmployeeController::class, 'availableAssets']);
    // Admin issues a self-service onboarding invite + emails the link.
    Route::post  ('/employees/onboarding-invite', [OnboardingController::class, 'createInvite']);
    // Re-enable a soft-deleted employee (inverse of DELETE /employees/{id}).
    Route::patch ('/employees/{id}/restore',      [EmployeeController::class, 'restore']);
    Route::apiResource('employees', EmployeeController::class);

    // Stage 2 — Document Management. List + upload are nested under the
    // employee; verify/reject/delete address documents directly by id.
    Route::get  ('/employees/{employee}/documents', [EmployeeDocumentController::class, 'index']);
    Route::post ('/employees/{employee}/documents', [EmployeeDocumentController::class, 'store']);
    Route::patch('/documents/{document}/verify',    [EmployeeDocumentController::class, 'verify']);
    Route::patch('/documents/{document}/reject',    [EmployeeDocumentController::class, 'reject']);
    Route::delete('/documents/{document}',          [EmployeeDocumentController::class, 'destroy']);

    // Exit Process — Stage 1 currently. One row per employee; the
    // controller upserts on PUT so the SPA can save partial drafts as
    // the admin works through the wizard.
    Route::get('/employees/{employee}/exit', [ExitController::class, 'show']);
    Route::put('/employees/{employee}/exit', [ExitController::class, 'upsert']);

    // Previous Employment Companies — one row per company the candidate
    // worked at before. Per-company doc uploads use the
    // `prev_<id>_<docKey>` namespace via the existing employee_documents
    // endpoints.
    Route::get   ('/employees/{employee}/previous-employments', [PreviousEmploymentController::class, 'index']);
    Route::post  ('/employees/{employee}/previous-employments', [PreviousEmploymentController::class, 'store']);
    Route::patch ('/previous-employments/{prev}',               [PreviousEmploymentController::class, 'update']);
    Route::delete('/previous-employments/{prev}',               [PreviousEmploymentController::class, 'destroy']);

    // Recruitments — full CRUD + auto-numbered REC-### scoped per tenant.
    // Declared BEFORE the generic /master/{slug} routes so apiResource params
    // resolve cleanly (mirrors the employees registration above).
    Route::get   ('/recruitments/next-code', [RecruitmentController::class, 'nextCode']);
    Route::apiResource('recruitments', RecruitmentController::class);

    // Hiring requests — internal "raise hiring need" form, gets HR review
    // before recruitment opens an actual REC requisition. Auto-numbered
    // HRQ-### per tenant.
    Route::get   ('/hiring-requests/next-code', [HiringRequestController::class, 'nextCode']);
    Route::apiResource('hiring-requests', HiringRequestController::class);

    // Candidates — applicants linked to a recruitment requisition. CV
    // uploads go via multipart/form-data on store/update.
    Route::get  ('/recruitments/{recruitment}/candidates/summary', [CandidateController::class, 'recruitmentSummary']);
    Route::patch('/candidates/{candidate}/status',                 [CandidateController::class, 'updateStatus']);
    // Bulk operations + stats — declared BEFORE apiResource so the literal
    // paths /sample, /import, /export, /stats aren't captured as `{candidate}` ids.
    Route::get ('/candidates/stats',  [CandidateController::class, 'stats']);
    Route::get ('/candidates/sample', [CandidateController::class, 'sample']);
    Route::post('/candidates/import', [CandidateController::class, 'import']);
    Route::get ('/candidates/export', [CandidateController::class, 'export']);
    Route::apiResource('candidates', CandidateController::class);

    // Expense Claims — two-stage approval workflow (manager → HR/finance).
    // Scope is selected via ?scope=mine|team|all on the index endpoint so the
    // same controller serves the employee, manager, and HR list views.
    Route::get   ('/expense-claims',                          [ExpenseClaimController::class, 'index']);
    Route::post  ('/expense-claims',                          [ExpenseClaimController::class, 'store']);
    Route::get   ('/expense-claims/{id}',                     [ExpenseClaimController::class, 'show']);
    Route::post  ('/expense-claims/{id}/manager-approve',     [ExpenseClaimController::class, 'managerApprove']);
    Route::post  ('/expense-claims/{id}/manager-reject',      [ExpenseClaimController::class, 'managerReject']);
    Route::post  ('/expense-claims/{id}/hr-approve',          [ExpenseClaimController::class, 'hrApprove']);
    Route::post  ('/expense-claims/{id}/hr-reject',           [ExpenseClaimController::class, 'hrReject']);

    // Broadcast Centre announcements — company-wide announcements with
    // audience targeting, scheduling and acknowledgement tracking. Stats /
    // next-code declared BEFORE apiResource so they aren't captured as ids.
    Route::get('/announcements/stats',     [AnnouncementController::class, 'stats']);
    Route::get('/announcements/next-code', [AnnouncementController::class, 'nextCode']);
    Route::apiResource('announcements', AnnouncementController::class);

    Route::get   ('/master/{slug}',           [MasterController::class, 'list']);
    Route::post  ('/master/{slug}',           [MasterController::class, 'store']);
    // Next auto-generated code for masters that use a prefixed sequence (e.g. DEPT-001).
    // Must be declared BEFORE `/master/{slug}/{id}` so `next-code` isn't captured as an id.
    Route::get   ('/master/{slug}/next-code', [MasterController::class, 'nextCode']);
    Route::get   ('/master/{slug}/{id}',      [MasterController::class, 'show']);
    Route::put   ('/master/{slug}/{id}',    [MasterController::class, 'update']);
    Route::delete('/master/{slug}/{id}',    [MasterController::class, 'destroy']);

    // Subscription (client buy plan via Razorpay)
    Route::get('/subscription/plans', [SubscriptionController::class, 'plans']);
    Route::get('/subscription/status', [SubscriptionController::class, 'status']);
    Route::post('/subscription/create-order', [SubscriptionController::class, 'createOrder']);
    Route::post('/subscription/verify-payment', [SubscriptionController::class, 'verifyPayment']);
    Route::post('/subscription/cancel-order', [SubscriptionController::class, 'cancelOrder']);

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

// Candidate CV download — query-token auth so plain <a download> works
// regardless of whether Apache's DocumentRoot is public/ (the storage
// symlink isn't reliable in XAMPP setups).
Route::get('/candidates/{candidate}/cv', [CandidateController::class, 'downloadCv'])
    ->name('candidates.cv');

Route::apiResource('dummy-items', DummyItemController::class);
