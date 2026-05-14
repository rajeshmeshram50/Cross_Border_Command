<?php

use App\Http\Controllers\Api\AnnouncementController;
use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\FaceBiometricController;
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
use App\Http\Controllers\Api\HrCustomFieldController;
use App\Http\Controllers\Api\HrDocumentSignatureController;
use App\Http\Controllers\Api\HrDocumentTemplateController;
use App\Http\Controllers\Api\HrGeneratedDocumentController;
use App\Http\Controllers\Api\HrOverviewController;
use App\Http\Controllers\Api\LeavePlanController;
use App\Http\Controllers\Api\LeaveRequestController;
use App\Http\Controllers\Api\MasterController;
use App\Http\Controllers\Api\MyTeamController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\OnboardingController;
use App\Http\Controllers\Api\OrganizationTypeController;
use App\Http\Controllers\Api\PlanController;
use App\Http\Controllers\Api\PermissionController;
use App\Http\Controllers\Api\RecruitmentController;
use App\Http\Controllers\Api\ForgotPasswordController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\RazorpayWebhookController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\SubscriptionController;
use Illuminate\Support\Facades\Route;

// Public — onboarding flow. Token is the only auth: GET previews the invite,
// POST submits the candidate's completed form. Both fail with 410 if the
// invite has been used / cancelled / expired.
Route::get ('/onboarding/{token}',          [OnboardingController::class, 'show']);
Route::post('/onboarding/{token}/complete', [OnboardingController::class, 'complete']);

// Public
Route::post('/login', [AuthController::class, 'login']);
Route::post('/login/face', [AuthController::class, 'faceLogin']);
Route::post('/google-login', [AuthController::class, 'googleLogin']);
Route::post('/forgot-password/send-otp', [ForgotPasswordController::class, 'sendOtp']);
Route::post('/forgot-password/verify-otp', [ForgotPasswordController::class, 'verifyOtp']);
Route::post('/forgot-password/reset', [ForgotPasswordController::class, 'resetPassword']);
Route::post('/razorpay/webhook', [RazorpayWebhookController::class, 'handle']);

// Protected
Route::middleware(['auth:sanctum', 'user.active'])->group(function () {
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/change-password', [AuthController::class, 'changePassword']);
    Route::post('/me/branding', [AuthController::class, 'updateBranding']);
    Route::post('/me/profile', [AuthController::class, 'updateProfile']);

    // Dashboard
    Route::get('/dashboard/admin-stats',    [DashboardController::class, 'adminStats']);
    Route::get('/dashboard/client-stats',   [DashboardController::class, 'clientStats']);
    Route::get('/dashboard/employee-stats', [DashboardController::class, 'employeeStats']);

    // Clients
    Route::get('/clients/stats', [ClientController::class, 'stats']);
    Route::apiResource('clients', ClientController::class);

    // Branches
    Route::get('/branches/next-code', [BranchController::class, 'nextCode']);
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
    // HRMS Overview — one aggregate endpoint feeding /hr/overview dashboard
    // (KPIs + headcount breakdowns + 12-month trends + recent/upcoming joiners).
    Route::get   ('/hrms/overview',               [HrOverviewController::class, 'index']);

    Route::get   ('/employees/next-code',         [EmployeeController::class, 'nextCode']);
    Route::get   ('/employees/managers',          [EmployeeController::class, 'managers']);
    Route::get   ('/employees/available-assets',  [EmployeeController::class, 'availableAssets']);
    // Lightweight uniqueness probe — frontend fires this on blur of the
    // Mobile field so the user sees a duplicate error before clicking Next.
    Route::get   ('/employees/check-mobile',      [EmployeeController::class, 'checkMobile']);
    // Admin issues a self-service onboarding invite + emails the link.
    Route::post  ('/employees/onboarding-invite', [OnboardingController::class, 'createInvite']);
    // Re-enable a soft-deleted employee (inverse of DELETE /employees/{id}).
    Route::patch ('/employees/{id}/restore',      [EmployeeController::class, 'restore']);
    // Permanently remove a soft-deleted employee. Only callable from the
    // Disabled tab — the controller refuses if the row is still trashed=false.
    Route::delete('/employees/{id}/force',        [EmployeeController::class, 'forceDestroy']);
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

    // HR Document Templates — role-based document templates with lifecycle
    // triggers (sourced from master_trigger_points), signing workflows, and
    // optional MS Word DOCX round-trip. Stats / next-code declared BEFORE
    // apiResource so the literal segments aren't captured as ids.
    Route::get ('/hr-document-templates/stats',                [HrDocumentTemplateController::class, 'stats']);
    Route::get ('/hr-document-templates/next-code',            [HrDocumentTemplateController::class, 'nextCode']);
    // Header logo upload is template-agnostic — it stages the file under the
    // tenant's doc_templates/logos folder and the path travels along in the
    // main save payload under header_config.logo_path. No template id required
    // so the wizard can attach a logo before the first save.
    Route::post('/hr-document-templates/upload-header-logo',   [HrDocumentTemplateController::class, 'uploadHeaderLogo']);
    // Onboarding-aware lookup: returns Active templates whose
    // (employee_category, role_type) match the given employee's
    // (department-mapped-category, designation.level).
    Route::get ('/hr-document-templates/match',                [HrDocumentTemplateController::class, 'matchForEmployee']);
    Route::get ('/hr-document-templates/{id}/download',        [HrDocumentTemplateController::class, 'downloadDocx']);
    // Resolves {{Tokens}} against the employee's data and streams the filled DOCX.
    Route::get ('/hr-document-templates/{id}/generate',        [HrDocumentTemplateController::class, 'generateForEmployee']);
    // SPA-friendly preview: returns resolved HTML + header/footer JSON for
    // an in-modal page-style preview (no DOCX round-trip).
    Route::get ('/hr-document-templates/{id}/preview',         [HrDocumentTemplateController::class, 'previewForEmployee']);
    Route::post('/hr-document-templates/{id}/upload-docx',     [HrDocumentTemplateController::class, 'uploadDocx']);

    // Document signing workflow runtime — one row per "send" of a template
    // against an employee. Inbox surfaces signature tasks where the current
    // user is the next signer. Declare /inbox BEFORE apiResource so the
    // literal segment doesn't get captured as an id.
    // My Team — profile-dropdown destination for anyone who manages people.
    // Returns the visible employees + unified approval queue (currently doc
    // signatures only; expense / leave plug in later).
    Route::get ('/my-team/employees',                    [MyTeamController::class, 'employees']);
    Route::get ('/my-team/approvals',                    [MyTeamController::class, 'approvals']);

    Route::get ('/hr-document-signatures/inbox',        [HrDocumentSignatureController::class, 'inbox']);
    Route::post('/hr-document-signatures/{id}/action',  [HrDocumentSignatureController::class, 'action']);
    Route::post('/hr-document-signatures/{id}/reject',  [HrDocumentSignatureController::class, 'reject']);
    Route::post('/hr-document-signatures/{id}/cancel',  [HrDocumentSignatureController::class, 'cancel']);
    // Final-output paths — download the signed DOCX or email it to the
    // subject employee. Both work only after the workflow reaches
    // 'Completed' (the controller guards the email path; download stays
    // permissive so admins can grab a snapshot mid-flow if needed).
    Route::get ('/hr-document-signatures/{id}/download',       [HrDocumentSignatureController::class, 'downloadSigned']);
    Route::get ('/hr-document-signatures/{id}/download-pdf',   [HrDocumentSignatureController::class, 'downloadSignedPdf']);
    Route::post('/hr-document-signatures/{id}/email-employee', [HrDocumentSignatureController::class, 'emailToEmployee']);
    // Per-employee signed-documents list. Accepts numeric id OR emp_code as
    // the {slug} so the Employee Profile (which only has the EMP-### slug)
    // doesn't have to resolve the row first. Defaults to status=Completed.
    Route::get ('/employees/{slug}/signed-documents',          [HrDocumentSignatureController::class, 'forEmployee'])
        ->where('slug', '[A-Za-z0-9_-]+');
    Route::get ('/hr-document-signatures',              [HrDocumentSignatureController::class, 'index']);
    Route::post('/hr-document-signatures',              [HrDocumentSignatureController::class, 'store']);
    Route::get ('/hr-document-signatures/{id}',         [HrDocumentSignatureController::class, 'show']);
    Route::apiResource('hr-document-templates', HrDocumentTemplateController::class)
        ->parameters(['hr-document-templates' => 'id']);

    // HR Custom Fields — user-defined {{variables}} that document templates
    // reference but the employee dataset doesn't provide. Stats + editor
    // integration endpoints declared BEFORE apiResource so the literal path
    // segments aren't captured as ids.
    Route::get ('/hr-custom-fields/stats',           [HrCustomFieldController::class, 'stats']);
    Route::get ('/hr-custom-fields/known-tokens',    [HrCustomFieldController::class, 'knownTokens']);
    Route::post('/hr-custom-fields/validate-tokens', [HrCustomFieldController::class, 'validateTokens']);
    Route::apiResource('hr-custom-fields', HrCustomFieldController::class)
        ->parameters(['hr-custom-fields' => 'id']);

    // HR Generated Documents — one row per (template × employee) render.
    // Powers the 3-step "Generate Document" wizard launched from a template
    // row. Preview returns rendered HTML without persisting; store bulk-
    // creates rows; downloadDocx streams the rendered output as a .docx.
    Route::post('/hr-generated-documents/preview',       [HrGeneratedDocumentController::class, 'preview']);
    Route::get ('/hr-generated-documents/{id}/download', [HrGeneratedDocumentController::class, 'downloadDocx']);
    Route::post('/hr-generated-documents',               [HrGeneratedDocumentController::class, 'store']);
    Route::get ('/hr-generated-documents/{id}',          [HrGeneratedDocumentController::class, 'show']);

    // Batch counts for the Master dashboard — one round-trip returns
    // active/inactive/total for every master the user can view.
    // Declared BEFORE `/master/{slug}` so the literal segment doesn't get
    // captured as a slug.
    Route::get   ('/master-counts',           [MasterController::class, 'counts']);
    Route::get   ('/master/{slug}',           [MasterController::class, 'list']);
    Route::post  ('/master/{slug}',           [MasterController::class, 'store']);
    // Next auto-generated code for masters that use a prefixed sequence (e.g. DEPT-001).
    // Must be declared BEFORE `/master/{slug}/{id}` so `next-code` isn't captured as an id.
    Route::get   ('/master/{slug}/next-code', [MasterController::class, 'nextCode']);
    Route::get   ('/master/{slug}/{id}',      [MasterController::class, 'show']);
    Route::put   ('/master/{slug}/{id}',    [MasterController::class, 'update']);
    Route::delete('/master/{slug}/{id}',    [MasterController::class, 'destroy']);

    // Leave Plans — Keka-style plan flow. Plan-level CRUD lives here
    // (not under /master) because each plan owns assigned leave types
    // (with per-pair Setup config) and assigned employees.
    Route::get   ('/leave-plans',                                [LeavePlanController::class, 'index']);
    Route::post  ('/leave-plans',                                [LeavePlanController::class, 'store']);
    Route::get   ('/leave-plans/{id}',                           [LeavePlanController::class, 'show']);
    Route::put   ('/leave-plans/{id}',                           [LeavePlanController::class, 'update']);
    Route::delete('/leave-plans/{id}',                           [LeavePlanController::class, 'destroy']);
    Route::post  ('/leave-plans/{id}/clone',                     [LeavePlanController::class, 'clone']);
    Route::post  ('/leave-plans/{id}/make-default',              [LeavePlanController::class, 'makeDefault']);
    Route::post  ('/leave-plans/{id}/types',                     [LeavePlanController::class, 'assignTypes']);
    Route::delete('/leave-plans/{id}/types/{typeId}',            [LeavePlanController::class, 'removeType']);
    Route::put   ('/leave-plans/{id}/types/{typeId}/config',     [LeavePlanController::class, 'saveTypeConfig']);
    Route::post  ('/leave-plans/{id}/employees',                 [LeavePlanController::class, 'assignEmployees']);
    Route::delete('/leave-plans/{id}/employees/{employeeId}',    [LeavePlanController::class, 'removeEmployee']);
    // Aggregated read for the Leave Balances tab — every employee in scope
    // with their plan's leave-type quotas. Optional filters: department_id,
    // location, search.
    Route::get   ('/leave-balances',                             [LeavePlanController::class, 'leaveBalances']);

    // Leave Requests — employee self-service. Index returns the signed-in
    // employee's own requests (or the explicit ?employee_id= for HR view).
    Route::get   ('/leave-requests',                             [LeaveRequestController::class, 'index']);
    Route::post  ('/leave-requests',                             [LeaveRequestController::class, 'store']);
    // /approvals MUST be declared BEFORE /{id} so the literal segment
    // doesn't get captured as an id parameter.
    Route::get   ('/leave-requests/approvals',                   [LeaveRequestController::class, 'approvals']);
    // Same ordering reason — lightweight colleague search for the Notify
    // field of the Request Leave drawer (no HR permission required).
    Route::get   ('/leave-requests/colleagues',                  [LeaveRequestController::class, 'colleagues']);
    Route::get   ('/leave-requests/{id}',                        [LeaveRequestController::class, 'show']);
    Route::get   ('/leave-requests/{id}/approvers',              [LeaveRequestController::class, 'approvers']);
    Route::post  ('/leave-requests/{id}/approve',                [LeaveRequestController::class, 'approve']);
    Route::post  ('/leave-requests/{id}/reject',                 [LeaveRequestController::class, 'reject']);
    Route::post  ('/leave-requests/{id}/cancel',                 [LeaveRequestController::class, 'cancel']);

    // In-app notifications — drives the bell-icon dropdown in the topbar.
    // Backed by Laravel's notifications table; rows are written by every
    // notification class that includes 'database' in its via() array.
    Route::get   ('/notifications',                              [NotificationController::class, 'index']);
    Route::get   ('/notifications/unread-count',                 [NotificationController::class, 'unreadCount']);
    Route::post  ('/notifications/read-all',                     [NotificationController::class, 'markAllRead']);
    Route::post  ('/notifications/{id}/read',                    [NotificationController::class, 'markRead']);

    // Per-employee balance summary — drives the Leave tab cards on the
    // Employee Profile page (donut + ledger per assigned leave type).
    Route::get   ('/employees/{employeeId}/leave-balances',      [LeavePlanController::class, 'employeeBalances']);

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

    // Face Biometric — employee opts in to face-based attendance. Stores a
    // 128-d descriptor produced by face-api.js in the browser; never the
    // raw photo. Self-service by default; admins can manage another
    // employee's enrolment by passing ?employee_id= in the same tenant.
    Route::get   ('/face/status',   [FaceBiometricController::class, 'status']);
    Route::post  ('/face/register', [FaceBiometricController::class, 'register']);
    Route::delete('/face/data',     [FaceBiometricController::class, 'revoke']);

    // Attendance — face-driven clock-in / clock-out + read endpoints.
    // /attendance       → HR / admin tenant-scoped list
    // /attendance/my    → signed-in employee's own history
    // /attendance/today → today's row for the signed-in employee
    Route::get ('/attendance',                                 [AttendanceController::class, 'index']);
    Route::get ('/attendance/daily-view',                      [AttendanceController::class, 'dailyView']);
    Route::get ('/attendance/my',                              [AttendanceController::class, 'my']);
    Route::get ('/attendance/today',                           [AttendanceController::class, 'today']);
    Route::get ('/attendance/employee/{employeeId}/summary',   [AttendanceController::class, 'employeeSummary']);
    Route::post('/attendance/face/clock-in',                   [AttendanceController::class, 'faceClockIn']);
    Route::post('/attendance/face/clock-out',                  [AttendanceController::class, 'faceClockOut']);

    // Permissions
    Route::get('/modules', [PermissionController::class, 'modules']);
    Route::get('/permissions/users', [PermissionController::class, 'manageableUsers']);
    Route::get('/permissions/user/{userId}', [PermissionController::class, 'getUserPermissions']);
    Route::post('/permissions/user/{userId}', [PermissionController::class, 'savePermissions']);

    // Platform Settings — read for all authenticated users (Contact Us, FAQs,
    // branding render in every layout); writes restricted to super_admin
    // inside the controller itself, not at the route level, so the same
    // routes work for everyone but only the granted user can persist.
    Route::get ('/settings',                          [SettingsController::class, 'index']);
    Route::put ('/settings/{section}',                [SettingsController::class, 'update']);
    Route::post('/settings/appearance/asset',         [SettingsController::class, 'uploadAsset']);
});

// Invoice routes (auth via query token, outside sanctum middleware)
Route::get('/payments/{payment}/invoice/download', [PaymentController::class, 'downloadInvoice']);
Route::get('/payments/{payment}/invoice/view', [PaymentController::class, 'viewInvoice']);

// Candidate CV download — query-token auth so plain <a download> works
// regardless of whether Apache's DocumentRoot is public/ (the storage
// symlink isn't reliable in XAMPP setups).
Route::get('/candidates/{candidate}/cv', [CandidateController::class, 'downloadCv'])
    ->name('candidates.cv');

// Expense-claim attachment download — same query-token pattern as the
// candidate CV route above. Uses the Laravel route instead of /storage/...
// so file links resolve regardless of whether Apache points at public/.
Route::get('/expense-claims/{id}/attachments/{index}', [ExpenseClaimController::class, 'downloadAttachment'])
    ->name('expense-claims.attachment');

Route::apiResource('dummy-items', DummyItemController::class);
