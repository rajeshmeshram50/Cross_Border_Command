<?php

use App\Http\Controllers\Api\AnnouncementController;
use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\FaceBiometricController;
use App\Http\Controllers\Api\CandidateController;
use App\Http\Controllers\Api\ClientController;
use App\Http\Controllers\Api\ClmAgreementController;
use App\Http\Controllers\Api\ClmBuyerProfileController;
use App\Http\Controllers\Api\ClmSupplierProfileController;
use App\Http\Controllers\Api\ClmAuthorityController;
use App\Http\Controllers\Api\ClmClauseController;
use App\Http\Controllers\Api\ClmDdController;
use App\Http\Controllers\Api\ClmKycController;
use App\Http\Controllers\Api\ClmQcController;
use App\Http\Controllers\Api\ClmSegmentController;
use App\Http\Controllers\Api\ClmSegmentRuleController;
use App\Http\Controllers\Api\ClmSignatureController;
use App\Http\Controllers\Api\SegmentDocUploadController;
use App\Http\Controllers\Api\ClmTncController;
use App\Http\Controllers\Api\ClmTradeDocumentController;
use App\Http\Controllers\Api\ClmTradeLicenseController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DummyItemController;
use App\Http\Controllers\Api\EmployeeController;
use App\Http\Controllers\Api\EmployeeDocumentController;
use App\Http\Controllers\Api\ExitController;
use App\Http\Controllers\Api\ExpenseClaimController;
use App\Http\Controllers\Api\PreviousEmploymentController;
use App\Http\Controllers\Api\ProcurementController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\HiringRequestController;
use App\Http\Controllers\Api\HrCustomFieldController;
use App\Http\Controllers\Api\HrDocumentSignatureController;
use App\Http\Controllers\Api\HrDocumentTemplateController;
use App\Http\Controllers\Api\HrGeneratedDocumentController;
use App\Http\Controllers\Api\HrOverviewController;
use App\Http\Controllers\Api\LeadAckReasonController;
use App\Http\Controllers\Api\ProformaInvoiceController;
use App\Http\Controllers\Api\QuotationController;
use App\Http\Controllers\Api\SalesLeadController;
use App\Http\Controllers\Api\SalesPdfController;
use App\Http\Controllers\Api\SalesTodoController;
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
//
// Rate-limited per IP so an attacker can't brute-force the 64-char token or
// trigger email/DB churn by spamming the submit endpoint. 30 req/min covers
// a candidate opening the link, filling the form (which fires several GETs
// to repopulate masters) and submitting — well under the limit; only abuse
// scenarios hit it.
Route::middleware('throttle:30,1')->group(function () {
    Route::get ('/onboarding/{token}',          [OnboardingController::class, 'show']);
    Route::post('/onboarding/{token}/complete', [OnboardingController::class, 'complete']);
});

// Public
Route::post('/login', [AuthController::class, 'login']);
Route::post('/login/face', [AuthController::class, 'faceLogin']);
Route::post('/google-login', [AuthController::class, 'googleLogin']);
Route::post('/forgot-password/send-otp', [ForgotPasswordController::class, 'sendOtp']);
Route::post('/forgot-password/verify-otp', [ForgotPasswordController::class, 'verifyOtp']);
Route::post('/forgot-password/reset', [ForgotPasswordController::class, 'resetPassword']);
Route::post('/razorpay/webhook', [RazorpayWebhookController::class, 'handle']);

// Public PDF view links — the "View Quotation" / "View PI" button in
// our outbound customer emails hits these. No app login (the customer
// isn't a user), authenticated via Laravel's `signed` middleware: the
// URL is signed at email-send time and expires after 60 days. Replays
// + URL tampering get 403.
Route::get('/sales/quotations/{id}/view',        [SalesPdfController::class, 'publicViewQuotation'])
    ->middleware('signed')
    ->name('sales.quotation.view');
Route::get('/sales/proforma-invoices/{id}/view', [SalesPdfController::class, 'publicViewProformaInvoice'])
    ->middleware('signed')
    ->name('sales.pi.view');

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
    // Bundle endpoint — returns every dropdown the ClientForm needs in one
    // round-trip. Declared BEFORE apiResource so the literal 'form-bundle'
    // segment isn't captured as a {client} id by show/update/destroy.
    Route::get('/clients/form-bundle', [ClientController::class, 'formBundle']);
    Route::apiResource('clients', ClientController::class);

    // Branches
    Route::get('/branches/next-code', [BranchController::class, 'nextCode']);
    // Bundle endpoint — returns countries + states + next branch code in one
    // round-trip. Declared BEFORE apiResource so the literal 'form-bundle'
    // segment isn't captured as a {branch} id.
    Route::get('/branches/form-bundle', [BranchController::class, 'formBundle']);
    Route::apiResource('branches', BranchController::class);

    // Products — step-wise create/update (Core → Sales → Quality → Vendors)
    Route::get('/products/stats',                [ProductController::class, 'stats']);
    Route::get('/products/owners',               [ProductController::class, 'owners']);
    // Bundle endpoint — returns every master dropdown the Add Product modal
    // needs in one round-trip. Declared BEFORE /products/{id} so the literal
    // 'master-bundle' segment isn't captured as a numeric id.
    Route::get('/products/master-bundle',        [ProductController::class, 'masterBundle']);
    Route::get('/products',                      [ProductController::class, 'index']);
    Route::get('/products/{id}',                 [ProductController::class, 'show'])->whereNumber('id');
    Route::get('/products/{id}/vendor-maps',     [ProductController::class, 'vendorMaps'])->whereNumber('id');
    Route::post('/products/step/core',           [ProductController::class, 'storeCore']);
    Route::put('/products/{id}/step/sales',      [ProductController::class, 'storeSales'])->whereNumber('id');
    Route::put('/products/{id}/step/quality',    [ProductController::class, 'storeQuality'])->whereNumber('id');
    Route::put('/products/{id}/step/vendors',    [ProductController::class, 'storeVendors'])->whereNumber('id');
    Route::delete('/products/{id}',              [ProductController::class, 'destroy'])->whereNumber('id');

    // Vendors — step-wise create/update (Identity → Contacts → KYC → Products).
    // Stage 3 (Trade Documents) is purely a frontend repository view and has
    // no backend persistence, so there's no /step/trade-documents endpoint.
    Route::get   ('/vendors',                          [\App\Http\Controllers\Api\VendorController::class, 'index']);
    // Bundle endpoint — returns every master dropdown the Add Vendor modal
    // needs in one round-trip. Declared BEFORE /vendors/{id} so the literal
    // 'master-bundle' segment isn't captured as a numeric id.
    Route::get   ('/vendors/master-bundle',            [\App\Http\Controllers\Api\VendorController::class, 'masterBundle']);
    Route::get   ('/vendors/{id}',                     [\App\Http\Controllers\Api\VendorController::class, 'show'])->whereNumber('id');
    Route::post  ('/vendors/step/identity',            [\App\Http\Controllers\Api\VendorController::class, 'storeIdentity']);
    Route::put   ('/vendors/{id}/step/contacts',       [\App\Http\Controllers\Api\VendorController::class, 'storeContacts'])->whereNumber('id');
    Route::post  ('/vendors/{id}/step/kyc',            [\App\Http\Controllers\Api\VendorController::class, 'storeKyc'])->whereNumber('id');
    Route::post  ('/vendors/{id}/step/products',       [\App\Http\Controllers\Api\VendorController::class, 'storeProducts'])->whereNumber('id');
    Route::delete('/vendors/{id}',                     [\App\Http\Controllers\Api\VendorController::class, 'destroy'])->whereNumber('id');

    // Plans (admin CRUD)
    Route::apiResource('plans', PlanController::class);

    // Sales Matrix → Customers. Backed by customers + customer_addresses
    // tables; tenant-scoped server-side.
    //
    // Bundle endpoint — returns every master dropdown the Add Customer
    // AND Add Consignee modals need in ONE round-trip. Declared BEFORE
    // the apiResource so the literal 'master-bundle' segment isn't
    // captured as a {customer} id by the show/update/destroy routes.
    Route::get   ('/customers/master-bundle',          [CustomerController::class, 'masterBundle']);
    Route::apiResource('customers', CustomerController::class)
        ->only(['index', 'show', 'store', 'update', 'destroy']);

    // Stage 2 → Company DD + Trade Licence documents nested under the customer.
    Route::get   ('/customers/{customer}/documents',           [\App\Http\Controllers\Api\CustomerDocumentController::class, 'index']);
    Route::post  ('/customers/{customer}/documents',           [\App\Http\Controllers\Api\CustomerDocumentController::class, 'store']);
    Route::get   ('/customers/{customer}/documents/{document}',[\App\Http\Controllers\Api\CustomerDocumentController::class, 'show']);
    Route::post  ('/customers/{customer}/documents/{document}',[\App\Http\Controllers\Api\CustomerDocumentController::class, 'update']);  // POST for file uploads
    Route::put   ('/customers/{customer}/documents/{document}',[\App\Http\Controllers\Api\CustomerDocumentController::class, 'update']);  // PUT for json-only
    Route::delete('/customers/{customer}/documents/{document}',[\App\Http\Controllers\Api\CustomerDocumentController::class, 'destroy']);

    // Sales Matrix → Consignees. Backed by consignees + consignee_addresses
    // tables; tenant-scoped server-side; each consignee belongs to a customer.
    Route::apiResource('consignees', \App\Http\Controllers\Api\ConsigneeController::class)
        ->only(['index', 'show', 'store', 'update', 'destroy']);

    // "Same as Customer" deep-clone — copies the linked customer's
    // Stage 2 KYC docs + owners (including file attachments) onto this
    // consignee. Idempotent (409 if consignee already has KYC).
    Route::post('/consignees/{consignee}/clone-from-customer',
        [\App\Http\Controllers\Api\ConsigneeController::class, 'cloneFromCustomer']);

    // Stage 2 → Company DD + Trade Licence documents nested under the consignee.
    Route::get   ('/consignees/{consignee}/documents',           [\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'index']);
    Route::post  ('/consignees/{consignee}/documents',           [\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'store']);
    Route::get   ('/consignees/{consignee}/documents/{document}',[\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'show']);
    Route::post  ('/consignees/{consignee}/documents/{document}',[\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'update']);  // POST for file uploads
    Route::put   ('/consignees/{consignee}/documents/{document}',[\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'update']);  // PUT for json-only
    Route::delete('/consignees/{consignee}/documents/{document}',[\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'destroy']);

    // Stage 2 → Owner KYC rows nested under the consignee.
    Route::get   ('/consignees/{consignee}/owners',          [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'index']);
    Route::post  ('/consignees/{consignee}/owners',          [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'store']);
    Route::get   ('/consignees/{consignee}/owners/{owner}',  [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'show']);
    Route::post  ('/consignees/{consignee}/owners/{owner}',  [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'update']);  // POST for file uploads
    Route::put   ('/consignees/{consignee}/owners/{owner}',  [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'update']);  // PUT for json-only
    Route::delete('/consignees/{consignee}/owners/{owner}',  [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'destroy']);

    // Stage 2 → Owner KYC rows nested under the customer.
    Route::get   ('/customers/{customer}/owners',          [\App\Http\Controllers\Api\CustomerOwnerController::class, 'index']);
    Route::post  ('/customers/{customer}/owners',          [\App\Http\Controllers\Api\CustomerOwnerController::class, 'store']);
    Route::get   ('/customers/{customer}/owners/{owner}',  [\App\Http\Controllers\Api\CustomerOwnerController::class, 'show']);
    Route::post  ('/customers/{customer}/owners/{owner}',  [\App\Http\Controllers\Api\CustomerOwnerController::class, 'update']);  // POST for file uploads
    Route::put   ('/customers/{customer}/owners/{owner}',  [\App\Http\Controllers\Api\CustomerOwnerController::class, 'update']);  // PUT for json-only
    Route::delete('/customers/{customer}/owners/{owner}',  [\App\Http\Controllers\Api\CustomerOwnerController::class, 'destroy']);

    // Central CLM → Segment master (Tobacco, Rice, Food Grade Ethanol …)
    // with regulatory tier + buyer/consignee rule. Tenant-scoped via
    // client_id; code follows the S-001 sequence per tenant.
    Route::get   ('/clm/segments',      [ClmSegmentController::class, 'index']);
    Route::post  ('/clm/segments',      [ClmSegmentController::class, 'store']);
    Route::put   ('/clm/segments/{id}', [ClmSegmentController::class, 'update']);
    Route::delete('/clm/segments/{id}', [ClmSegmentController::class, 'destroy']);

    // Central CLM → Authority master (FSSAI, DGFT, BIS, …). Referenced by
    // every downstream doc master as a free-text label.
    Route::get   ('/clm/authorities',      [ClmAuthorityController::class, 'index']);
    Route::post  ('/clm/authorities',      [ClmAuthorityController::class, 'store']);
    Route::put   ('/clm/authorities/{id}', [ClmAuthorityController::class, 'update']);
    Route::delete('/clm/authorities/{id}', [ClmAuthorityController::class, 'destroy']);

    // Central CLM → KYC, DD, Trade Licences, Quality & Compliance — each is
    // a standalone catalogue; the Document Control Panel later picks rows
    // from all four to build segment-specific document rules.
    Route::get   ('/clm/kyc-documents',      [ClmKycController::class, 'index']);
    Route::post  ('/clm/kyc-documents',      [ClmKycController::class, 'store']);
    Route::put   ('/clm/kyc-documents/{id}', [ClmKycController::class, 'update']);
    Route::delete('/clm/kyc-documents/{id}', [ClmKycController::class, 'destroy']);

    Route::get   ('/clm/dd-documents',      [ClmDdController::class, 'index']);
    Route::post  ('/clm/dd-documents',      [ClmDdController::class, 'store']);
    Route::put   ('/clm/dd-documents/{id}', [ClmDdController::class, 'update']);
    Route::delete('/clm/dd-documents/{id}', [ClmDdController::class, 'destroy']);

    Route::get   ('/clm/trade-licenses',      [ClmTradeLicenseController::class, 'index']);
    Route::post  ('/clm/trade-licenses',      [ClmTradeLicenseController::class, 'store']);
    Route::put   ('/clm/trade-licenses/{id}', [ClmTradeLicenseController::class, 'update']);
    Route::delete('/clm/trade-licenses/{id}', [ClmTradeLicenseController::class, 'destroy']);

    Route::get   ('/clm/qc-documents',      [ClmQcController::class, 'index']);
    Route::post  ('/clm/qc-documents',      [ClmQcController::class, 'store']);
    Route::put   ('/clm/qc-documents/{id}', [ClmQcController::class, 'update']);
    Route::delete('/clm/qc-documents/{id}', [ClmQcController::class, 'destroy']);

    // Central CLM → Trade Documents (two tabs: names catalogue + library).
    Route::get   ('/clm/trade-doc-names',      [ClmTradeDocumentController::class, 'namesIndex']);
    Route::post  ('/clm/trade-doc-names',      [ClmTradeDocumentController::class, 'namesStore']);
    Route::put   ('/clm/trade-doc-names/{id}', [ClmTradeDocumentController::class, 'namesUpdate']);
    Route::delete('/clm/trade-doc-names/{id}', [ClmTradeDocumentController::class, 'namesDestroy']);
    Route::get   ('/clm/trade-doc-library',                   [ClmTradeDocumentController::class, 'libraryIndex']);
    Route::post  ('/clm/trade-doc-library',                   [ClmTradeDocumentController::class, 'libraryStore']);
    // Standalone DOCX → HTML (no library row) for editors like the CTC draft.
    Route::post  ('/clm/docx-to-html',                        [ClmTradeDocumentController::class, 'docxToHtmlPreview']);
    // Static-path endpoints declared BEFORE `{id}` so Laravel's router
    // doesn't treat `upload-header-logo` / `for-party` as numeric ids
    // and reject the request with 405 against the PUT/DELETE handlers.
    Route::post  ('/clm/trade-doc-library/upload-header-logo',[ClmTradeDocumentController::class, 'uploadHeaderLogo']);
    Route::get   ('/clm/trade-doc-library/for-party/{party}', [ClmTradeDocumentController::class, 'libraryForParty']);
    
    Route::get   ('/clm/trade-doc-library/{id}/download',     [ClmTradeDocumentController::class, 'downloadDocx'])->whereNumber('id');
    Route::post  ('/clm/trade-doc-library/{id}/upload-docx',  [ClmTradeDocumentController::class, 'uploadDocx'])->whereNumber('id');
    Route::put   ('/clm/trade-doc-library/{id}',              [ClmTradeDocumentController::class, 'libraryUpdate'])->whereNumber('id');
    Route::delete('/clm/trade-doc-library/{id}',              [ClmTradeDocumentController::class, 'libraryDestroy'])->whereNumber('id');

    // Central CLM → Trade Documents → Send for Signature (Zoho Sign).
    // The preview endpoint renders the merged PDF without calling Zoho so the
    // wizard's step-3 iframe stays snappy; send + status + reminder + recall +
    // signed-file streaming all live behind the same controller for one
    // tenant-scoping place.
    Route::post  ('/clm/signature-requests/preview',                       [ClmSignatureController::class, 'preview']);
    Route::post  ('/clm/signature-requests',                               [ClmSignatureController::class, 'send']);
    Route::get   ('/clm/signature-requests',                               [ClmSignatureController::class, 'index']);
    Route::get   ('/clm/signature-requests/{id}',                          [ClmSignatureController::class, 'show'])->whereNumber('id');
    Route::post  ('/clm/signature-requests/{id}/remind',                   [ClmSignatureController::class, 'remind'])->whereNumber('id');
    Route::post  ('/clm/signature-requests/{id}/recall',                   [ClmSignatureController::class, 'recall'])->whereNumber('id');
    Route::get   ('/clm/signature-requests/{id}/download-file/{index}',    [ClmSignatureController::class, 'downloadFile'])->whereNumber('id')->whereNumber('index');
    Route::get   ('/clm/signature-requests/{id}/view-file/{index}',        [ClmSignatureController::class, 'viewFile'])->whereNumber('id')->whereNumber('index');
    Route::get   ('/clm/signature-requests/{id}/certificate',              [ClmSignatureController::class, 'viewCertificate'])->whereNumber('id');
    // CTC (Case-to-Case Contract) → Zoho Sign preview / send / status sync.
    Route::post  ('/clm/signature-requests/ctc-preview',                   [ClmSignatureController::class, 'ctcPreview']);
    Route::post  ('/clm/signature-requests/ctc-send',                      [ClmSignatureController::class, 'ctcSend']);
    Route::get   ('/clm/ctc-contracts/{id}/sync-signature',               [ClmSignatureController::class, 'ctcSignatureStatus'])->whereNumber('id');
    Route::post  ('/clm/ctc-contracts/{id}/remind-signing',               [ClmSignatureController::class, 'ctcRemindSigning'])->whereNumber('id');

    // Central CLM → Terms & Conditions (two tabs: categories + library).
    Route::get   ('/clm/tnc-categories',      [ClmTncController::class, 'categoriesIndex']);
    Route::post  ('/clm/tnc-categories',      [ClmTncController::class, 'categoriesStore']);
    Route::put   ('/clm/tnc-categories/{id}', [ClmTncController::class, 'categoriesUpdate']);
    Route::delete('/clm/tnc-categories/{id}', [ClmTncController::class, 'categoriesDestroy']);
    Route::get   ('/clm/tnc-library',      [ClmTncController::class, 'libraryIndex']);
    Route::post  ('/clm/tnc-library',      [ClmTncController::class, 'libraryStore']);
    Route::put   ('/clm/tnc-library/{id}', [ClmTncController::class, 'libraryUpdate']);
    Route::delete('/clm/tnc-library/{id}', [ClmTncController::class, 'libraryDestroy']);

    // Central CLM → Agreements (two tabs: types + library).
    Route::get   ('/clm/agreement-types',      [ClmAgreementController::class, 'typesIndex']);
    Route::post  ('/clm/agreement-types',      [ClmAgreementController::class, 'typesStore']);
    Route::put   ('/clm/agreement-types/{id}', [ClmAgreementController::class, 'typesUpdate']);
    Route::delete('/clm/agreement-types/{id}', [ClmAgreementController::class, 'typesDestroy']);
    Route::get   ('/clm/agreement-library',      [ClmAgreementController::class, 'libraryIndex']);
    Route::post  ('/clm/agreement-library',      [ClmAgreementController::class, 'libraryStore']);
    Route::put   ('/clm/agreement-library/{id}', [ClmAgreementController::class, 'libraryUpdate']);
    Route::delete('/clm/agreement-library/{id}', [ClmAgreementController::class, 'libraryDestroy']);
    Route::get   ('/clm/agreement-library/{id}/download',     [ClmAgreementController::class, 'downloadDocx'])->whereNumber('id');
    Route::get   ('/clm/agreement-library/{id}/download-pdf', [ClmAgreementController::class, 'downloadPdf'])->whereNumber('id');
    Route::post  ('/clm/agreement-library/{id}/upload-docx',  [ClmAgreementController::class, 'uploadDocx'])->whereNumber('id');
    Route::post  ('/clm/agreement-library/upload-header-logo', [ClmAgreementController::class, 'uploadHeaderLogo']);

    /* Case-to-Case (CTC) Contracts — add/drafting form + the three views
     * (list · Agreements We Sent · Agreements To Approve). Static paths are
     * declared before `{id}` (also number-constrained) so /sent and
     * /to-approve aren't swallowed as ids. */
    Route::get   ('/clm/ctc-contracts',              [\App\Http\Controllers\Api\CtcContractController::class, 'index']);
    Route::post  ('/clm/ctc-contracts',              [\App\Http\Controllers\Api\CtcContractController::class, 'store']);
    Route::get   ('/clm/ctc-contracts/sent',         [\App\Http\Controllers\Api\CtcContractController::class, 'sentIndex']);
    Route::get   ('/clm/ctc-contracts/to-approve',   [\App\Http\Controllers\Api\CtcContractController::class, 'toApproveIndex']);
    Route::get   ('/clm/ctc-contracts/approver-candidates', [\App\Http\Controllers\Api\CtcContractController::class, 'approverCandidates']);
    Route::get   ('/clm/ctc-contracts/contact-persons',     [\App\Http\Controllers\Api\CtcContractController::class, 'contactPersons']);
    Route::get   ('/clm/ctc-contracts/{id}',         [\App\Http\Controllers\Api\CtcContractController::class, 'show'])->whereNumber('id');
    Route::put   ('/clm/ctc-contracts/{id}',         [\App\Http\Controllers\Api\CtcContractController::class, 'update'])->whereNumber('id');
    Route::delete('/clm/ctc-contracts/{id}',         [\App\Http\Controllers\Api\CtcContractController::class, 'destroy'])->whereNumber('id');
    Route::post  ('/clm/ctc-contracts/{id}/approve', [\App\Http\Controllers\Api\CtcContractController::class, 'approve'])->whereNumber('id');
    Route::post  ('/clm/ctc-contracts/{id}/reject',  [\App\Http\Controllers\Api\CtcContractController::class, 'reject'])->whereNumber('id');
    Route::post  ('/clm/ctc-contracts/{id}/clarify', [\App\Http\Controllers\Api\CtcContractController::class, 'clarify'])->whereNumber('id');
    Route::post  ('/clm/ctc-contracts/{id}/respond', [\App\Http\Controllers\Api\CtcContractController::class, 'respond'])->whereNumber('id');
    Route::post  ('/clm/ctc-contracts/{id}/resubmit',          [\App\Http\Controllers\Api\CtcContractController::class, 'resubmit'])->whereNumber('id');
    Route::post  ('/clm/ctc-contracts/{id}/send-for-signing',  [\App\Http\Controllers\Api\CtcContractController::class, 'sendForSigning'])->whereNumber('id');
    Route::post  ('/clm/ctc-contracts/{id}/record-signature',  [\App\Http\Controllers\Api\CtcContractController::class, 'recordSignature'])->whereNumber('id');
    Route::post  ('/clm/ctc-contracts/{id}/move-to-repository',[\App\Http\Controllers\Api\CtcContractController::class, 'moveToRepository'])->whereNumber('id');
    Route::get   ('/clm/ctc-contracts/{id}/versions',          [\App\Http\Controllers\Api\CtcContractController::class, 'versions'])->whereNumber('id');
    Route::get   ('/clm/ctc-contracts/{id}/versions/{v}/download', [\App\Http\Controllers\Api\CtcContractController::class, 'downloadVersion'])->whereNumber('id')->whereNumber('v');
    Route::get   ('/clm/leads/{leadId}/agreement-applicable',    [ClmAgreementController::class, 'applicableForLead'])->whereNumber('leadId');
    Route::get   ('/clm/buyer-profile',                          [ClmBuyerProfileController::class, 'index']);
    Route::get   ('/clm/supplier-profile',                       [ClmSupplierProfileController::class, 'index']);
    Route::post  ('/clm/signature-requests/agreement-preview',   [ClmSignatureController::class, 'agreementPreview']);
    Route::post  ('/clm/signature-requests/agreement-send',      [ClmSignatureController::class, 'agreementSend']);
    // Sales Matrix Stage 5 — send a Quotation / Proforma Invoice for e-signature.
    Route::post  ('/clm/signature-requests/sales-doc-send',      [ClmSignatureController::class, 'salesDocSend']);

    // Central CLM → Clause Library (two tabs: types + library).
    Route::get   ('/clm/clause-types',      [ClmClauseController::class, 'typesIndex']);
    Route::post  ('/clm/clause-types',      [ClmClauseController::class, 'typesStore']);
    Route::put   ('/clm/clause-types/{id}', [ClmClauseController::class, 'typesUpdate']);
    Route::delete('/clm/clause-types/{id}', [ClmClauseController::class, 'typesDestroy']);
    Route::get   ('/clm/clause-library',      [ClmClauseController::class, 'libraryIndex']);
    Route::post  ('/clm/clause-library',      [ClmClauseController::class, 'libraryStore']);
    Route::put   ('/clm/clause-library/{id}', [ClmClauseController::class, 'libraryUpdate']);
    Route::delete('/clm/clause-library/{id}', [ClmClauseController::class, 'libraryDestroy']);

    // Central CLM → Document Control Panel · segment rules. /bootstrap
    // returns every master collection the Add-Segment-Rule modal needs in
    // one round-trip. Declared BEFORE /clm/segment-rules/{id} so it isn't
    // captured as an id parameter.
    Route::get   ('/clm/segment-rules/bootstrap', [ClmSegmentRuleController::class, 'bootstrap']);
    // Resolve a segment's rule + the full KYC/DD/TL/TD/QC master rows the rule
    // references, so Customer/Consignee/Supplier Stage 2 forms can pre-populate
    // their document tables in one fetch when the user picks a segment.
    Route::get   ('/clm/segment-rules/for-segment/{segmentId}', [ClmSegmentRuleController::class, 'forSegment'])->whereNumber('segmentId');
    Route::get   ('/clm/segment-rules',           [ClmSegmentRuleController::class, 'index']);
    Route::post  ('/clm/segment-rules',           [ClmSegmentRuleController::class, 'store']);
    Route::put   ('/clm/segment-rules/{id}',      [ClmSegmentRuleController::class, 'update']);
    Route::delete('/clm/segment-rules/{id}',      [ClmSegmentRuleController::class, 'destroy']);

    /* Segment-rule reference uploads — polymorphic across Customer /
     * Consignee / Supplier. {type} is the URL slug (customer | consignee
     * | supplier) and {id} is the owning record's primary key. Returns
     * uploaded-doc rows grouped by category so the Evidence Vault can
     * render its KPI cards + per-tab tables off one fetch. */
    Route::get   ('/segment-uploads/{type}/{id}/summary',          [SegmentDocUploadController::class, 'summary'])->whereNumber('id');
    /* Evidence Vault — single fetch that returns the buckets + KPI
     * counts for the standalone Customer/Consignee/Supplier Vault
     * popup. Built off (segment rule docs) ∪ (actual uploads). */
    Route::get   ('/segment-uploads/{type}/{id}/vault',            [SegmentDocUploadController::class, 'vault'])->whereNumber('id');
    Route::get   ('/segment-uploads/{type}/{id}',                  [SegmentDocUploadController::class, 'index'])->whereNumber('id');
    Route::post  ('/segment-uploads/{type}/{id}',                  [SegmentDocUploadController::class, 'store'])->whereNumber('id');
    Route::delete('/segment-uploads/{type}/{id}/{uploadId}',       [SegmentDocUploadController::class, 'destroy'])->whereNumber('id')->whereNumber('uploadId');

    // Sales Matrix → Lead Acknowledgement Master. Three opportunity buckets
    // (qualified / disqualified / clarity_pending) — controller returns them
    // grouped so the page loads in one round trip. Tenant-scoped by client_id.
    Route::get   ('/sales/lead-ack-reasons',       [LeadAckReasonController::class, 'index']);
    Route::post  ('/sales/lead-ack-reasons',       [LeadAckReasonController::class, 'store']);
    Route::put   ('/sales/lead-ack-reasons/{id}',  [LeadAckReasonController::class, 'update']);
    Route::delete('/sales/lead-ack-reasons/{id}',  [LeadAckReasonController::class, 'destroy']);

    // Sales Matrix → QPI page PDF previews. POST body carries the row fields
    // the frontend already has (piNo, customer, etc.) plus a `withSignature`
    // flag that picks between the two More-Options variants. Returns the PDF
    // inline so the page can preview it in a new tab via blob URL.
    Route::post  ('/sales/pi/preview-pdf',         [SalesPdfController::class, 'previewPi']);

    // Sales Matrix → QUOTATION DOCUMENT PDF preview. Per-quotation variant —
    // loads the real Quotation row (with items + branch + bank + parties) and
    // renders the same Blade template with branch-derived letterhead. The
    // `signature=1` body flag picks the with-signature variant.
    Route::post  ('/sales/quotations/{id}/preview-pdf', [SalesPdfController::class, 'previewQuotation']);

    // Sales Matrix → PROFORMA INVOICE PDF preview. Mirror of the Quotation
    // variant — loads the real PI row, same branch letterhead, same template,
    // labels swap to "PI No / PI Date".
    Route::post  ('/sales/proforma-invoices/{id}/preview-pdf', [SalesPdfController::class, 'previewProformaInvoice']);

    // Sales Matrix → email the PDF to the customer's primary email.
    // Body: { signature?: bool, to?: string } — `to` overrides the
    // customer's email when provided. Returns 422 if no recipient
    // can be resolved so the frontend can prompt the user.
    Route::post  ('/sales/quotations/{id}/email',         [SalesPdfController::class, 'emailQuotation']);
    Route::post  ('/sales/proforma-invoices/{id}/email',  [SalesPdfController::class, 'emailProformaInvoice']);

    // Reminder follow-ups — gated behind the initial email (controller
    // returns 422 if `emailed_at` is still null). Each send increments
    // `reminder_count` and stamps `last_reminded_at` on the row so the
    // UI badge stays in sync without a full reload.
    Route::post  ('/sales/quotations/{id}/remind',        [SalesPdfController::class, 'remindQuotation']);
    Route::post  ('/sales/proforma-invoices/{id}/remind', [SalesPdfController::class, 'remindProformaInvoice']);

    // Sales Matrix → Leads (My Workplace). Three feeders write here:
    //   - POST /sales/leads        manual capture (Add New Lead modal)
    //   - POST /sales/leads/sync   pull from IndiaMart CRM keys
    //   - GET  /sales/leads        list / paginate / filter for the table
    // All tenant-scoped by client_id; sub-branch users see only their branch.
    Route::get   ('/sales/leads',              [SalesLeadController::class, 'index']);
    Route::post  ('/sales/leads',              [SalesLeadController::class, 'store']);
    // Literal-segment routes — all declared BEFORE /sales/leads/{id} so
    // Laravel doesn't try to capture words like 'sync' / 'assign' as the
    // numeric {id}. The whereNumber on {id} is the second defense.
    Route::get   ('/sales/leads/sync/config',     [SalesLeadController::class, 'syncConfig']);
    Route::post  ('/sales/leads/sync',            [SalesLeadController::class, 'syncFromCrm']);
    Route::post  ('/sales/leads/assign',                 [SalesLeadController::class, 'assign']);
    Route::post  ('/sales/leads/convert-to-qualified',   [SalesLeadController::class, 'convertToQualified']);
    Route::get   ('/sales/leads/salespeople',            [SalesLeadController::class, 'salespeople']);
    Route::get   ('/sales/leads/salesperson-summary',    [SalesLeadController::class, 'salespersonSummary']);
    Route::get   ('/sales/leads/filter-options',         [SalesLeadController::class, 'filterOptions']);
    Route::get   ('/sales/leads/{id}',          [SalesLeadController::class, 'show'])->whereNumber('id');
    Route::put   ('/sales/leads/{id}',          [SalesLeadController::class, 'update'])->whereNumber('id');
    Route::delete('/sales/leads/{id}',          [SalesLeadController::class, 'destroy'])->whereNumber('id');

    // Sales Matrix → Quotations. Outgoing-quotation header + line items,
    // backed by the `quotations` / `quotation_items` tables. Code sequence
    // QT/YYYY-NN/SEQ allocated atomically per client per financial year.
    Route::get   ('/sales/quotations',                          [QuotationController::class, 'index']);
    Route::get   ('/sales/quotations/preview-code',             [QuotationController::class, 'previewCode']);
    Route::post  ('/sales/quotations',                          [QuotationController::class, 'store']);
    Route::get   ('/sales/quotations/{id}',                     [QuotationController::class, 'show'])->whereNumber('id');
    Route::put   ('/sales/quotations/{id}',                     [QuotationController::class, 'update'])->whereNumber('id');
    Route::delete('/sales/quotations/{id}',                     [QuotationController::class, 'destroy'])->whereNumber('id');
    Route::post  ('/sales/quotations/{id}/duplicate',           [QuotationController::class, 'duplicate'])->whereNumber('id');
    Route::post  ('/sales/quotations/{id}/convert-to-pi',       [QuotationController::class, 'convertToPi'])->whereNumber('id');

    // Sales Matrix → Proforma Invoices. Mirror of Quotations + BT
    // reference + signature mode + source_quotation_id traceback.
    Route::get   ('/sales/proforma-invoices',                                   [ProformaInvoiceController::class, 'index']);
    Route::get   ('/sales/proforma-invoices/preview-code',                      [ProformaInvoiceController::class, 'previewCode']);
    Route::post  ('/sales/proforma-invoices',                                   [ProformaInvoiceController::class, 'store']);
    // Literal segment before {id} so Laravel doesn't try to capture
    // 'from-quotation' as the numeric id.
    Route::post  ('/sales/proforma-invoices/from-quotation/{quotationId}',      [ProformaInvoiceController::class, 'fromQuotation'])->whereNumber('quotationId');
    Route::get   ('/sales/proforma-invoices/{id}',                              [ProformaInvoiceController::class, 'show'])->whereNumber('id');
    Route::put   ('/sales/proforma-invoices/{id}',                              [ProformaInvoiceController::class, 'update'])->whereNumber('id');
    Route::delete('/sales/proforma-invoices/{id}',                              [ProformaInvoiceController::class, 'destroy'])->whereNumber('id');
    Route::post  ('/sales/proforma-invoices/{id}/duplicate',                    [ProformaInvoiceController::class, 'duplicate'])->whereNumber('id');

    // Sales Matrix → Stage 6 (Victory) → Shipment Order. One per won
    // opportunity. Ported from IDIMS's `bt` (Business Task) module.
    Route::post('/sales/shipment-orders',
        [\App\Http\Controllers\Api\ShipmentOrderController::class, 'store']);
    Route::get ('/sales/shipment-orders/{id}',
        [\App\Http\Controllers\Api\ShipmentOrderController::class, 'show'])->whereNumber('id');
    Route::post('/sales/shipment-orders/{id}',
        [\App\Http\Controllers\Api\ShipmentOrderController::class, 'update'])->whereNumber('id');
    Route::get ('/sales/leads/{leadId}/shipment-order',
        [\App\Http\Controllers\Api\ShipmentOrderController::class, 'getByLead'])->whereNumber('leadId');
    // Stage 1 → Task Manager save (multipart for the optional attachment).
    // POST + _method=PUT-friendly: accepts both POST and PUT since file
    // uploads under PUT can't be parsed by PHP without enableHttpMethodParameterOverride.
    Route::match(['post', 'put'], '/sales/leads/{id}/task-manager',
        [SalesLeadController::class, 'storeTaskManager'])->whereNumber('id');

    // Stage 2 → Lead Acknowledgement activity log (append-only).
    Route::get   ('/sales/leads/{id}/acknowledgements',
        [SalesLeadController::class, 'listAcknowledgements'])->whereNumber('id');
    Route::post  ('/sales/leads/{id}/acknowledgements',
        [SalesLeadController::class, 'storeAcknowledgements'])->whereNumber('id');

    // Matrix action toolbar → WhatsApp status. Multipart so an optional
    // proof screenshot can ride along.
    Route::match(['post', 'put'], '/sales/leads/{id}/whatsapp',
        [SalesLeadController::class, 'updateWhatsApp'])->whereNumber('id');

    // Matrix action toolbar → Product Directory (lead ⇄ product mapping).
    Route::get   ('/sales/leads/{id}/products',
        [SalesLeadController::class, 'listLeadProducts'])->whereNumber('id');
    Route::post  ('/sales/leads/{id}/products',
        [SalesLeadController::class, 'storeLeadProduct'])->whereNumber('id');
    Route::put   ('/sales/leads/{id}/products/{mapping}',
        [SalesLeadController::class, 'updateLeadProduct'])->whereNumber('id')->whereNumber('mapping');
    Route::delete('/sales/leads/{id}/products/{mapping}',
        [SalesLeadController::class, 'destroyLeadProduct'])->whereNumber('id')->whereNumber('mapping');

    // Stage 3 (Product Sourcing) — per-row sourcing status + mark-sourced
    // action. These are the IDIMS "set sourcing_status" + "mark as done"
    // operations on the lead⇄product mapping, scaled down to CBC's model.
    Route::patch('/sales/leads/{id}/products/{mapping}/sourcing-status',
        [SalesLeadController::class, 'updateLeadProductSourcingStatus'])
        ->whereNumber('id')->whereNumber('mapping');
    Route::patch('/sales/leads/{id}/products/{mapping}/mark-sourced',
        [SalesLeadController::class, 'markLeadProductSourced'])
        ->whereNumber('id')->whereNumber('mapping');

    // Stage 4 — Price Shared. Append-only price-share history per
    // (lead, product) plus a PDF export per entry.
    Route::post('/sales/leads/{id}/products/{mapping}/shared-prices',
        [SalesLeadController::class, 'storeSharedPrice'])
        ->whereNumber('id')->whereNumber('mapping');
    Route::get('/sales/leads/{id}/shared-prices',
        [SalesLeadController::class, 'listSharedPrices'])->whereNumber('id');
    Route::get('/sales/leads/{id}/products/{mapping}/shared-prices',
        [SalesLeadController::class, 'listSharedPricesByProduct'])
        ->whereNumber('id')->whereNumber('mapping');
    Route::get('/sales/shared-prices/{id}/pdf',
        [SalesLeadController::class, 'sharedPricePdf'])->whereNumber('id');

    // Stage 3 → Create Procurement modal posts here. Multi-tenant via
    // client_id; see ProcurementController for the body shape.
    Route::get   ('/procurements/next-number', [ProcurementController::class, 'nextNumber']);
    Route::get   ('/procurements',             [ProcurementController::class, 'index']);
    Route::post  ('/procurements',             [ProcurementController::class, 'store']);
    Route::get   ('/procurements/{id}',        [ProcurementController::class, 'show'])->whereNumber('id');

    // Sales Matrix → Productivity Tracker (/sales/todo). Two parallel
    // sub-resources behind one controller — reminders + meetings — with
    // shared scope rules (default = caller's own rows; ?scope=all is the
    // privileged admin path). Attachment uploads on reminders go through
    // multipart/form-data on store + update.
    Route::get   ('/sales/reminders',                 [SalesTodoController::class, 'listReminders']);
    Route::post  ('/sales/reminders',                 [SalesTodoController::class, 'storeReminder']);
    // Reminder update accepts both verbs because attachments arrive as multipart
    // (POST + _method=PUT, since PHP can't parse multipart on PUT) but Laravel's
    // global `enableHttpMethodParameterOverride()` still flips the method to PUT
    // before the router matches. Registering both verbs keeps the route reachable
    // either way.
    Route::match(['put', 'post'], '/sales/reminders/{id}', [SalesTodoController::class, 'updateReminder']);
    Route::patch ('/sales/reminders/{id}/status',     [SalesTodoController::class, 'setReminderStatus']);
    Route::delete('/sales/reminders/{id}',            [SalesTodoController::class, 'destroyReminder']);

    Route::get   ('/sales/meetings',                  [SalesTodoController::class, 'listMeetings']);
    Route::get   ('/sales/meetings/next-code',        [SalesTodoController::class, 'nextMeetingCode']);
    Route::post  ('/sales/meetings',                  [SalesTodoController::class, 'storeMeeting']);
    Route::put   ('/sales/meetings/{id}',             [SalesTodoController::class, 'updateMeeting']);
    Route::patch ('/sales/meetings/{id}/status',      [SalesTodoController::class, 'setMeetingStatus']);
    Route::delete('/sales/meetings/{id}',             [SalesTodoController::class, 'destroyMeeting']);

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
    // Finalise the exit — closes the case, flips employees.status to the
    // terminal value, and disables the login. Moves the row to "Exited".
    Route::post('/employees/{employee}/exit/complete', [ExitController::class, 'complete']);

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

    // Advance Requests — same two-stage manager → HR/Finance flow as
    // expense-claims, only the form payload differs (advance type,
    // recovery schedule, monthly EMI, reason). Scope is selected via
    // ?scope=mine|team|all on the index endpoint.
    Route::get   ('/advance-requests',                          [\App\Http\Controllers\Api\AdvanceRequestController::class, 'index']);
    Route::post  ('/advance-requests',                          [\App\Http\Controllers\Api\AdvanceRequestController::class, 'store']);
    Route::get   ('/advance-requests/{id}',                     [\App\Http\Controllers\Api\AdvanceRequestController::class, 'show']);
    Route::post  ('/advance-requests/{id}/manager-approve',     [\App\Http\Controllers\Api\AdvanceRequestController::class, 'managerApprove']);
    Route::post  ('/advance-requests/{id}/manager-reject',      [\App\Http\Controllers\Api\AdvanceRequestController::class, 'managerReject']);
    Route::post  ('/advance-requests/{id}/hr-approve',          [\App\Http\Controllers\Api\AdvanceRequestController::class, 'hrApprove']);
    Route::post  ('/advance-requests/{id}/hr-reject',           [\App\Http\Controllers\Api\AdvanceRequestController::class, 'hrReject']);

    // ── Payroll engine ──────────────────────────────────────────────────
    // Monthly salary processing: cycle → finalize attendance → preflight →
    // run → approve → pay → payslip/export. Literal segments declared before
    // the {id} payslip route so they aren't captured as ids. See
    // PayrollController for the rule-by-rule breakdown.
    Route::get ('/payroll/cycles',              [\App\Http\Controllers\Api\PayrollController::class, 'cycles']);
    Route::get ('/payroll/history',             [\App\Http\Controllers\Api\PayrollController::class, 'history']);
    Route::get ('/payroll/preflight',           [\App\Http\Controllers\Api\PayrollController::class, 'preflight']);
    Route::get ('/payroll/export',              [\App\Http\Controllers\Api\PayrollController::class, 'export']);
    Route::get ('/payroll/payslips/bulk',       [\App\Http\Controllers\Api\PayrollController::class, 'payslipsBulk']);
    Route::post('/payroll/payslips/email',      [\App\Http\Controllers\Api\PayrollController::class, 'emailPayslipsBulk']);
    Route::get ('/payroll/payslip/{id}/pdf',    [\App\Http\Controllers\Api\PayrollController::class, 'payslipPdf'])->whereNumber('id');
    Route::post('/payroll/payslip/{id}/email',  [\App\Http\Controllers\Api\PayrollController::class, 'emailPayslip'])->whereNumber('id');
    Route::get ('/payroll/payslip/{id}',        [\App\Http\Controllers\Api\PayrollController::class, 'payslip'])->whereNumber('id');
    Route::get ('/payroll/employee/{employeeId}/payslips', [\App\Http\Controllers\Api\PayrollController::class, 'employeePayslips'])->whereNumber('employeeId');
    Route::get ('/payroll/fnf/{employeeId}',    [\App\Http\Controllers\Api\PayrollController::class, 'fnf'])->whereNumber('employeeId');
    Route::get ('/payroll',                      [\App\Http\Controllers\Api\PayrollController::class, 'index']);
    Route::post('/payroll/finalize-attendance', [\App\Http\Controllers\Api\PayrollController::class, 'finalizeAttendance']);
    Route::post('/payroll/run',                  [\App\Http\Controllers\Api\PayrollController::class, 'run']);
    Route::post('/payroll/reopen',               [\App\Http\Controllers\Api\PayrollController::class, 'reopen']);
    Route::post('/payroll/approve',              [\App\Http\Controllers\Api\PayrollController::class, 'approve']);
    Route::post('/payroll/pay',                  [\App\Http\Controllers\Api\PayrollController::class, 'pay']);

    // Proceed-to-Pay disbursement flow (mode → advice/NEFT → 3-level sign-off → initiate).
    Route::post('/payroll/payment/prepare',         [\App\Http\Controllers\Api\PayrollPaymentController::class, 'prepare']);
    Route::get ('/payroll/payment/{id}',            [\App\Http\Controllers\Api\PayrollPaymentController::class, 'show'])->whereNumber('id');
    Route::post('/payroll/payment/{id}/approve',    [\App\Http\Controllers\Api\PayrollPaymentController::class, 'approve'])->whereNumber('id');
    Route::post('/payroll/payment/{id}/initiate',   [\App\Http\Controllers\Api\PayrollPaymentController::class, 'initiate'])->whereNumber('id');
    Route::get ('/payroll/payment/{id}/bank-file',  [\App\Http\Controllers\Api\PayrollPaymentController::class, 'bankFile'])->whereNumber('id');
    Route::get ('/payroll/payment/{id}/audit',      [\App\Http\Controllers\Api\PayrollPaymentController::class, 'auditTrail'])->whereNumber('id');

    // Payroll adjustments — overtime / bonus / incentive / one-off deduction
    // (Rule 4 / 10). Only approved rows affect payroll.
    Route::get   ('/payroll-adjustments',            [\App\Http\Controllers\Api\PayrollAdjustmentController::class, 'index']);
    Route::post  ('/payroll-adjustments',            [\App\Http\Controllers\Api\PayrollAdjustmentController::class, 'store']);
    Route::post  ('/payroll-adjustments/{id}/approve', [\App\Http\Controllers\Api\PayrollAdjustmentController::class, 'approve'])->whereNumber('id');
    Route::post  ('/payroll-adjustments/{id}/reject',  [\App\Http\Controllers\Api\PayrollAdjustmentController::class, 'reject'])->whereNumber('id');
    Route::delete('/payroll-adjustments/{id}',       [\App\Http\Controllers\Api\PayrollAdjustmentController::class, 'destroy'])->whereNumber('id');

    // Versioned salary structures (Rule 5 / 19) — feeds the payroll engine.
    Route::get   ('/salary-structures/employees', [\App\Http\Controllers\Api\SalaryStructureController::class, 'employees']);
    Route::get   ('/salary-structures',      [\App\Http\Controllers\Api\SalaryStructureController::class, 'index']);
    Route::post  ('/salary-structures',      [\App\Http\Controllers\Api\SalaryStructureController::class, 'store']);
    Route::get   ('/salary-structures/{id}', [\App\Http\Controllers\Api\SalaryStructureController::class, 'show'])->whereNumber('id');
    Route::delete('/salary-structures/{id}', [\App\Http\Controllers\Api\SalaryStructureController::class, 'destroy'])->whereNumber('id');

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
    Route::get ('/my-team/my-updates',                   [MyTeamController::class, 'myUpdates']);

    Route::get ('/hr-document-signatures/inbox',        [HrDocumentSignatureController::class, 'inbox']);
    Route::post('/hr-document-signatures/{id}/action',  [HrDocumentSignatureController::class, 'action']);
    Route::post('/hr-document-signatures/{id}/reject',  [HrDocumentSignatureController::class, 'reject']);
    Route::post('/hr-document-signatures/{id}/cancel',  [HrDocumentSignatureController::class, 'cancel']);
    Route::post('/hr-document-signatures/{id}/remind',  [HrDocumentSignatureController::class, 'remind']);
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

// Advance-request attachment download — same query-token pattern so the
// frontend can drop a plain <a target="_blank"> link on each attachment.
Route::get('/advance-requests/{id}/attachments/{index}', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'downloadAttachment'])
    ->name('advance-requests.attachment');

Route::apiResource('dummy-items', DummyItemController::class);
    