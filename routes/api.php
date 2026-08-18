<?php

use App\Http\Controllers\Api\AnnouncementController;
use App\Http\Controllers\Api\AttendanceController;
use App\Http\Controllers\Api\AttendanceRegularizationController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\FaceBiometricController;
use App\Http\Controllers\Api\CandidateController;
use App\Http\Controllers\Api\ClientController;
use App\Http\Controllers\Api\ClmAgreementController;
use App\Http\Controllers\Api\ClmBuyerProfileController;
use App\Http\Controllers\Api\ClmSupplierProfileController;
use App\Http\Controllers\Api\ClmDiagnosisResolutionController;
use App\Http\Controllers\Api\ClmRegulatoryDefenseFileController;
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
use App\Http\Controllers\Api\BackupController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DummyItemController;
use App\Http\Controllers\Api\EmailController;
use App\Http\Controllers\Api\EmployeeController;
use App\Http\Controllers\Api\EmployeeDocumentController;
use App\Http\Controllers\Api\ExitController;
use App\Http\Controllers\Api\ExpenseClaimController;
use App\Http\Controllers\Api\PreviousEmploymentController;
use App\Http\Controllers\Api\ProcurementController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\PurchaseOrderController;
use App\Http\Controllers\Api\PoPaymentController;
use App\Http\Controllers\Api\SpiPaymentController;
use App\Http\Controllers\Api\SupplierPurchaseInvoiceController;
use App\Http\Controllers\Api\DebitNoteController;
use App\Http\Controllers\Api\DebitNotePaymentController;
use App\Http\Controllers\Api\DebitNoteTypeController;
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
use App\Http\Controllers\Api\DocsGuideController;
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


Route::middleware('throttle:30,1')->group(function () {
    Route::get ('/onboarding/{token}',          [OnboardingController::class, 'show']);
    Route::post('/onboarding/{token}/complete', [OnboardingController::class, 'complete']);
});

// Public — auth surface is IP-throttled to blunt online brute-force/credential-
// stuffing (the per-email lockout is a settings-gated in-app backstop only).
Route::middleware('throttle:20,1')->group(function () {
    Route::post('/login', [AuthController::class, 'login']);
    Route::post('/login/face', [AuthController::class, 'faceLogin']);
    Route::post('/google-login', [AuthController::class, 'googleLogin']);
    Route::post('/forgot-password/send-otp', [ForgotPasswordController::class, 'sendOtp']);
    Route::post('/forgot-password/verify-otp', [ForgotPasswordController::class, 'verifyOtp']);
    Route::post('/forgot-password/reset', [ForgotPasswordController::class, 'resetPassword']);
});
Route::post('/razorpay/webhook', [RazorpayWebhookController::class, 'handle']);

// One-off attendance backfill tool — now requires an authenticated user (was
// unauthenticated + a source-committed ?key=, i.e. a public cross-tenant write).
Route::match(['get', 'post'], '/tools/attendance-backfill', [\App\Http\Controllers\Api\AttendanceBackfillController::class, 'run'])
    ->middleware(['auth:sanctum', 'user.active']);


Route::get('/sales/quotations/{id}/view',        [SalesPdfController::class, 'publicViewQuotation'])
    ->middleware('signed')
    ->name('sales.quotation.view');
Route::get('/sales/proforma-invoices/{id}/view', [SalesPdfController::class, 'publicViewProformaInvoice'])
    ->middleware('signed')
    ->name('sales.pi.view');
Route::get('/p2p/purchase-orders/{id}/view',     [SalesPdfController::class, 'publicViewPurchaseOrder'])
    ->middleware('signed')
    ->whereNumber('id')
    ->name('p2p.po.view');
Route::get('/p2p/debit-notes/{id}/view',         [SalesPdfController::class, 'publicViewDebitNote'])
    ->middleware('signed')
    ->whereNumber('id')
    ->name('p2p.dn.view');

// Broadcast (announcement) email attachment — streamed through the app so the
// link in the emailed announcement works on BOTH local and Azure (public or
// private container) without the recipient being logged in. Signed = tamper-proof.
Route::get('/announcements/{id}/attachment',     [AnnouncementController::class, 'attachment'])
    ->middleware('signed')
    ->whereNumber('id')
    ->name('announcements.attachment');

// Protected
Route::middleware(['auth:sanctum', 'user.active'])->group(function () {
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/change-password', [AuthController::class, 'changePassword']);
    Route::post('/me/branding', [AuthController::class, 'updateBranding']);
    Route::post('/me/profile', [AuthController::class, 'updateProfile']);

    // Database backup email (super-admin only)
    Route::get('/backup/email/status', [BackupController::class, 'status']);
    Route::post('/backup/email/send',  [BackupController::class, 'send']);

    // Dashboard
    Route::get('/dashboard/admin-stats',    [DashboardController::class, 'adminStats']);
    Route::get('/dashboard/client-stats',   [DashboardController::class, 'clientStats']);
    Route::get('/dashboard/employee-stats', [DashboardController::class, 'employeeStats']);

    // Clients
    Route::get('/clients/stats', [ClientController::class, 'stats']);

    Route::get('/clients/form-bundle', [ClientController::class, 'formBundle']);
    Route::apiResource('clients', ClientController::class);

    Route::get('/branches/next-code', [BranchController::class, 'nextCode']);

    // Work shifts for the active branch (BranchSwitcher injects ?branch_id) —
    // feeds the Employee form's Shift dropdown.
    Route::get('/branch-shifts', [BranchController::class, 'shiftOptions']);

    // Legal-entity options (= the client's branches, since a branch holds the
    // GST/PAN/CIN and bank accounts) for the Employee + Onboarding forms.
    Route::get('/branch-legal-entities', [BranchController::class, 'legalEntityOptions']);

    // "Our Organisation" options for the CLM Case-to-Case form = the client's
    // branches. A branch login sees the OTHER branches of its client (not
    // itself); an employee / client-admin login sees ALL the client's branches.
    Route::get('/clm/ctc-organisations', [BranchController::class, 'ctcOrganisationOptions']);

    Route::get('/branches/form-bundle', [BranchController::class, 'formBundle']);
    Route::apiResource('branches', BranchController::class);

    Route::get('/products/stats',                [ProductController::class, 'stats']);
    Route::get('/products/owners',               [ProductController::class, 'owners']);
    
    Route::get('/products/master-bundle',        [ProductController::class, 'masterBundle']);
    Route::get('/products',                      [ProductController::class, 'index']);
    Route::get('/products/{id}',                 [ProductController::class, 'show'])->whereNumber('id');
    Route::get('/products/{id}/vendor-maps',     [ProductController::class, 'vendorMaps'])->whereNumber('id');
    Route::patch('/products/{id}/vendor-maps/{mapId}', [ProductController::class, 'updateVendorMapPrice'])->whereNumber('id')->whereNumber('mapId');
    Route::delete('/products/{id}/vendor-maps/{mapId}', [ProductController::class, 'destroyVendorMap'])->whereNumber('id')->whereNumber('mapId');
    Route::post('/products/step/core',           [ProductController::class, 'storeCore']);
    Route::put('/products/{id}/step/sales',      [ProductController::class, 'storeSales'])->whereNumber('id');
    Route::put('/products/{id}/step/quality',    [ProductController::class, 'storeQuality'])->whereNumber('id');
    Route::put('/products/{id}/step/vendors',    [ProductController::class, 'storeVendors'])->whereNumber('id');
    Route::delete('/products/{id}',              [ProductController::class, 'destroy'])->whereNumber('id');


    Route::get   ('/vendors',                          [\App\Http\Controllers\Api\VendorController::class, 'index']);
  
    Route::get   ('/vendors/master-bundle',            [\App\Http\Controllers\Api\VendorController::class, 'masterBundle']);
    Route::get   ('/vendors/{id}',                     [\App\Http\Controllers\Api\VendorController::class, 'show'])->whereNumber('id');
    Route::post  ('/vendors/step/identity',            [\App\Http\Controllers\Api\VendorController::class, 'storeIdentity']);
    Route::put   ('/vendors/{id}/step/contacts',       [\App\Http\Controllers\Api\VendorController::class, 'storeContacts'])->whereNumber('id');
    // Additional contact persons — independent CRUD (primary row excluded).
    Route::post  ('/vendors/{id}/contacts',            [\App\Http\Controllers\Api\VendorController::class, 'storeContact'])->whereNumber('id');
    Route::put   ('/vendors/{id}/contacts/{contact}',  [\App\Http\Controllers\Api\VendorController::class, 'updateContact'])->whereNumber('id')->whereNumber('contact');
    Route::delete('/vendors/{id}/contacts/{contact}',  [\App\Http\Controllers\Api\VendorController::class, 'destroyContact'])->whereNumber('id')->whereNumber('contact');
    // Bank Accounts — independent CRUD (KYC sub-tab).
    Route::post  ('/vendors/{id}/bank-accounts',           [\App\Http\Controllers\Api\VendorController::class, 'storeBankAccount'])->whereNumber('id');
    Route::put   ('/vendors/{id}/bank-accounts/{bank}',    [\App\Http\Controllers\Api\VendorController::class, 'updateBankAccount'])->whereNumber('id')->whereNumber('bank');
    Route::delete('/vendors/{id}/bank-accounts/{bank}',    [\App\Http\Controllers\Api\VendorController::class, 'destroyBankAccount'])->whereNumber('id')->whereNumber('bank');
    // GST Scrutiny — independent CRUD (KYC sub-tab).
    Route::post  ('/vendors/{id}/gst-scrutiny',            [\App\Http\Controllers\Api\VendorController::class, 'storeGstScrutiny'])->whereNumber('id');
    Route::put   ('/vendors/{id}/gst-scrutiny/{gst}',      [\App\Http\Controllers\Api\VendorController::class, 'updateGstScrutiny'])->whereNumber('id')->whereNumber('gst');
    Route::delete('/vendors/{id}/gst-scrutiny/{gst}',      [\App\Http\Controllers\Api\VendorController::class, 'destroyGstScrutiny'])->whereNumber('id')->whereNumber('gst');
    Route::post  ('/vendors/{id}/step/kyc',            [\App\Http\Controllers\Api\VendorController::class, 'storeKyc'])->whereNumber('id');
    Route::post  ('/vendors/{id}/step/products',       [\App\Http\Controllers\Api\VendorController::class, 'storeProducts'])->whereNumber('id');
    Route::delete('/vendors/{id}',                     [\App\Http\Controllers\Api\VendorController::class, 'destroy'])->whereNumber('id');

    Route::apiResource('plans', PlanController::class);

    
    Route::get   ('/customers/master-bundle',          [CustomerController::class, 'masterBundle']);
    // Live GSTIN duplicate check for the customer form. MUST stay above the
    // apiResource below, or `/customers/{customer}` would swallow it.
    Route::get   ('/customers/gst-available',          [CustomerController::class, 'gstAvailable']);
    Route::apiResource('customers', CustomerController::class)
        ->only(['index', 'show', 'store', 'update', 'destroy']);

    // GST Scrutiny (domestic customers) — each row persists on its own,
    // mirroring the vendor gst-scrutiny endpoints.
    Route::get   ('/customers/{customer}/gst-scrutiny',          [CustomerController::class, 'indexGstScrutiny']);
    Route::post  ('/customers/{customer}/gst-scrutiny',          [CustomerController::class, 'storeGstScrutiny']);
    Route::put   ('/customers/{customer}/gst-scrutiny/{gst}',    [CustomerController::class, 'updateGstScrutiny']);
    Route::delete('/customers/{customer}/gst-scrutiny/{gst}',    [CustomerController::class, 'destroyGstScrutiny']);


    Route::get   ('/customers/{customer}/documents',           [\App\Http\Controllers\Api\CustomerDocumentController::class, 'index']);
    Route::post  ('/customers/{customer}/documents',           [\App\Http\Controllers\Api\CustomerDocumentController::class, 'store']);
    Route::get   ('/customers/{customer}/documents/{document}',[\App\Http\Controllers\Api\CustomerDocumentController::class, 'show']);
    Route::post  ('/customers/{customer}/documents/{document}',[\App\Http\Controllers\Api\CustomerDocumentController::class, 'update']);  // POST for file uploads
    Route::put   ('/customers/{customer}/documents/{document}',[\App\Http\Controllers\Api\CustomerDocumentController::class, 'update']);  // PUT for json-only
    Route::delete('/customers/{customer}/documents/{document}',[\App\Http\Controllers\Api\CustomerDocumentController::class, 'destroy']);


    Route::apiResource('consignees', \App\Http\Controllers\Api\ConsigneeController::class)
        ->only(['index', 'show', 'store', 'update', 'destroy']);

  
    Route::post('/consignees/{consignee}/clone-from-customer',
        [\App\Http\Controllers\Api\ConsigneeController::class, 'cloneFromCustomer']);

    // Map an existing consignee to a customer (many-to-many) + merge segments.
    Route::post('/consignees/{consignee}/map-customer',
        [\App\Http\Controllers\Api\ConsigneeController::class, 'mapCustomer']);

    Route::get   ('/consignees/{consignee}/documents',           [\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'index']);
    Route::post  ('/consignees/{consignee}/documents',           [\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'store']);
    Route::get   ('/consignees/{consignee}/documents/{document}',[\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'show']);
    Route::post  ('/consignees/{consignee}/documents/{document}',[\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'update']);  // POST for file uploads
    Route::put   ('/consignees/{consignee}/documents/{document}',[\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'update']);  // PUT for json-only
    Route::delete('/consignees/{consignee}/documents/{document}',[\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'destroy']);

  
    Route::get   ('/consignees/{consignee}/owners',          [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'index']);
    Route::post  ('/consignees/{consignee}/owners',          [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'store']);
    Route::get   ('/consignees/{consignee}/owners/{owner}',  [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'show']);
    Route::post  ('/consignees/{consignee}/owners/{owner}',  [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'update']);  // POST for file uploads
    Route::put   ('/consignees/{consignee}/owners/{owner}',  [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'update']);  // PUT for json-only
    Route::delete('/consignees/{consignee}/owners/{owner}',  [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'destroy']);

   
    Route::get   ('/customers/{customer}/owners',          [\App\Http\Controllers\Api\CustomerOwnerController::class, 'index']);
    Route::post  ('/customers/{customer}/owners',          [\App\Http\Controllers\Api\CustomerOwnerController::class, 'store']);
    Route::get   ('/customers/{customer}/owners/{owner}',  [\App\Http\Controllers\Api\CustomerOwnerController::class, 'show']);
    Route::post  ('/customers/{customer}/owners/{owner}',  [\App\Http\Controllers\Api\CustomerOwnerController::class, 'update']);  // POST for file uploads
    Route::put   ('/customers/{customer}/owners/{owner}',  [\App\Http\Controllers\Api\CustomerOwnerController::class, 'update']);  // PUT for json-only
    Route::delete('/customers/{customer}/owners/{owner}',  [\App\Http\Controllers\Api\CustomerOwnerController::class, 'destroy']);


    Route::get   ('/clm/segments',      [ClmSegmentController::class, 'index']);
    Route::post  ('/clm/segments',      [ClmSegmentController::class, 'store']);
    Route::put   ('/clm/segments/{id}', [ClmSegmentController::class, 'update']);
    Route::delete('/clm/segments/{id}', [ClmSegmentController::class, 'destroy']);

    Route::get   ('/clm/authorities',      [ClmAuthorityController::class, 'index']);
    Route::post  ('/clm/authorities',      [ClmAuthorityController::class, 'store']);
    Route::put   ('/clm/authorities/{id}', [ClmAuthorityController::class, 'update']);
    Route::delete('/clm/authorities/{id}', [ClmAuthorityController::class, 'destroy']);


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


    Route::get   ('/clm/trade-doc-names',      [ClmTradeDocumentController::class, 'namesIndex']);
    Route::post  ('/clm/trade-doc-names',      [ClmTradeDocumentController::class, 'namesStore']);
    Route::put   ('/clm/trade-doc-names/{id}', [ClmTradeDocumentController::class, 'namesUpdate']);
    Route::delete('/clm/trade-doc-names/{id}', [ClmTradeDocumentController::class, 'namesDestroy']);
    Route::get   ('/clm/trade-doc-library',                   [ClmTradeDocumentController::class, 'libraryIndex']);
    Route::post  ('/clm/trade-doc-library',                   [ClmTradeDocumentController::class, 'libraryStore']);

    Route::post  ('/clm/docx-to-html',                        [ClmTradeDocumentController::class, 'docxToHtmlPreview']);

    Route::post  ('/clm/trade-doc-library/upload-header-logo',[ClmTradeDocumentController::class, 'uploadHeaderLogo']);
    Route::get   ('/clm/trade-doc-library/for-party/{party}', [ClmTradeDocumentController::class, 'libraryForParty']);
    
    Route::get   ('/clm/trade-doc-library/{id}/download',     [ClmTradeDocumentController::class, 'downloadDocx'])->whereNumber('id');
    Route::get   ('/clm/trade-doc-library/{id}/download-pdf', [ClmTradeDocumentController::class, 'downloadPdf'])->whereNumber('id');
    Route::post  ('/clm/trade-doc-library/{id}/upload-docx',  [ClmTradeDocumentController::class, 'uploadDocx'])->whereNumber('id');
    Route::put   ('/clm/trade-doc-library/{id}',              [ClmTradeDocumentController::class, 'libraryUpdate'])->whereNumber('id');
    Route::delete('/clm/trade-doc-library/{id}',              [ClmTradeDocumentController::class, 'libraryDestroy'])->whereNumber('id');


    Route::post  ('/clm/signature-requests/preview',                       [ClmSignatureController::class, 'preview']);
    Route::post  ('/clm/signature-requests',                               [ClmSignatureController::class, 'send']);
    Route::get   ('/clm/signature-requests',                               [ClmSignatureController::class, 'index']);
    Route::get   ('/clm/signature-requests/{id}',                          [ClmSignatureController::class, 'show'])->whereNumber('id');
    Route::post  ('/clm/signature-requests/{id}/remind',                   [ClmSignatureController::class, 'remind'])->whereNumber('id');
    Route::post  ('/clm/signature-requests/{id}/recall',                   [ClmSignatureController::class, 'recall'])->whereNumber('id');
    Route::get   ('/clm/signature-requests/{id}/download-file/{index}',    [ClmSignatureController::class, 'downloadFile'])->whereNumber('id')->whereNumber('index');
    Route::get   ('/clm/signature-requests/{id}/view-file/{index}',        [ClmSignatureController::class, 'viewFile'])->whereNumber('id')->whereNumber('index');
    Route::get   ('/clm/signature-requests/{id}/certificate',              [ClmSignatureController::class, 'viewCertificate'])->whereNumber('id');
    Route::get   ('/clm/signature-requests/{id}/declined-file',            [ClmSignatureController::class, 'declinedFile'])->whereNumber('id');

    Route::post  ('/clm/signature-requests/ctc-preview',                   [ClmSignatureController::class, 'ctcPreview']);
    Route::post  ('/clm/signature-requests/ctc-send',                      [ClmSignatureController::class, 'ctcSend']);
    Route::get   ('/clm/ctc-contracts/{id}/sync-signature',               [ClmSignatureController::class, 'ctcSignatureStatus'])->whereNumber('id');
    Route::post  ('/clm/ctc-contracts/{id}/remind-signing',               [ClmSignatureController::class, 'ctcRemindSigning'])->whereNumber('id');

 
    Route::get   ('/clm/tnc-categories',      [ClmTncController::class, 'categoriesIndex']);
    Route::post  ('/clm/tnc-categories',      [ClmTncController::class, 'categoriesStore']);
    Route::put   ('/clm/tnc-categories/{id}', [ClmTncController::class, 'categoriesUpdate']);
    Route::delete('/clm/tnc-categories/{id}', [ClmTncController::class, 'categoriesDestroy']);
    Route::get   ('/clm/tnc-library',      [ClmTncController::class, 'libraryIndex']);
    Route::post  ('/clm/tnc-library',      [ClmTncController::class, 'libraryStore']);
    Route::put   ('/clm/tnc-library/{id}', [ClmTncController::class, 'libraryUpdate']);
    Route::delete('/clm/tnc-library/{id}', [ClmTncController::class, 'libraryDestroy']);

    
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

   
    Route::get   ('/clm/ctc-contracts',              [\App\Http\Controllers\Api\CtcContractController::class, 'index']);
    Route::post  ('/clm/ctc-contracts',              [\App\Http\Controllers\Api\CtcContractController::class, 'store']);
    Route::get   ('/clm/ctc-contracts/sent',         [\App\Http\Controllers\Api\CtcContractController::class, 'sentIndex']);
    Route::get   ('/clm/ctc-contracts/to-approve',   [\App\Http\Controllers\Api\CtcContractController::class, 'toApproveIndex']);
    Route::get   ('/clm/ctc-contracts/approver-candidates', [\App\Http\Controllers\Api\CtcContractController::class, 'approverCandidates']);
    Route::get   ('/clm/ctc-contracts/contact-persons',     [\App\Http\Controllers\Api\CtcContractController::class, 'contactPersons']);
    Route::get   ('/clm/ctc-contracts/placeholder-values',  [\App\Http\Controllers\Api\CtcContractController::class, 'placeholderValues']);
    // Live-preview render of the current (unsaved) draft HTML → inline PDF for
    // the draft editor's preview panel. Literal path, so it must sit before /{id}.
    Route::post  ('/clm/ctc-contracts/preview-live',        [\App\Http\Controllers\Api\CtcContractController::class, 'previewLive']);
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


    Route::get   ('/p2p/products',      [\App\Http\Controllers\Api\P2p\SourcingController::class, 'products']);
    Route::get   ('/p2p/team-members',  [\App\Http\Controllers\Api\P2p\SourcingController::class, 'teamMembers']);
    Route::get   ('/p2p/suppliers',     [\App\Http\Controllers\Api\P2p\SourcingController::class, 'suppliers']);
    Route::get   ('/p2p/new-suppliers', [\App\Http\Controllers\Api\P2p\SourcingController::class, 'newSuppliers']);
    Route::get   ('/p2p/new-suppliers/{supplier}/sourcings', [\App\Http\Controllers\Api\P2p\SourcingController::class, 'supplierSourcings'])->whereNumber('supplier');
    Route::get   ('/p2p/form-masters',  [\App\Http\Controllers\Api\P2p\SourcingController::class, 'formMasters']);
    Route::post  ('/p2p/upload',        [\App\Http\Controllers\Api\P2p\SourcingController::class, 'upload']);
    Route::get   ('/p2p/clarity/download', [\App\Http\Controllers\Api\P2p\SourcingController::class, 'downloadClarity']);
    Route::get   ('/p2p/sourcing-targets',          [\App\Http\Controllers\Api\P2p\SourcingController::class, 'index']);
    Route::get   ('/p2p/sourcing-targets/next-code',[\App\Http\Controllers\Api\P2p\SourcingController::class, 'nextCode']);
    Route::post  ('/p2p/sourcing-targets',          [\App\Http\Controllers\Api\P2p\SourcingController::class, 'store']);
    Route::get   ('/p2p/sourcing-targets/{target}', [\App\Http\Controllers\Api\P2p\SourcingController::class, 'show']);
    Route::put   ('/p2p/sourcing-targets/{target}', [\App\Http\Controllers\Api\P2p\SourcingController::class, 'update']);
    Route::get   ('/p2p/sourcing-targets/{target}/report', [\App\Http\Controllers\Api\P2p\SourcingController::class, 'report']);
    Route::patch ('/p2p/sourcing-targets/{target}/products/{product}/status',    [\App\Http\Controllers\Api\P2p\SourcingController::class, 'setProductStatus'])->whereNumber('product');
    Route::put   ('/p2p/sourcing-targets/{target}/products/{product}/clarity',   [\App\Http\Controllers\Api\P2p\SourcingController::class, 'updateProductClarity'])->whereNumber('product');
    Route::get   ('/p2p/sourcing-targets/{target}/products/{product}/suppliers', [\App\Http\Controllers\Api\P2p\SourcingController::class, 'mappedSuppliers'])->whereNumber('product');
    Route::post  ('/p2p/sourcing-targets/{target}/products/{product}/suppliers', [\App\Http\Controllers\Api\P2p\SourcingController::class, 'mapSupplier'])->whereNumber('product');
    Route::put   ('/p2p/sourcing-targets/{target}/products/{product}/suppliers/{supplier}', [\App\Http\Controllers\Api\P2p\SourcingController::class, 'updateSupplier'])->whereNumber('product')->whereNumber('supplier');
    Route::get   ('/clm/leads/{leadId}/agreement-applicable',    [ClmAgreementController::class, 'applicableForLead'])->whereNumber('leadId');
    // Per-deal "is this document needed?" answers for the trade-doc / agreement popup.
    Route::post  ('/clm/leads/{leadId}/doc-needs',               [ClmAgreementController::class, 'setLeadDocNeed'])->whereNumber('leadId');
    Route::get   ('/clm/buyer-profile',                          [ClmBuyerProfileController::class, 'index']);
    Route::get   ('/clm/supplier-profile',                       [ClmSupplierProfileController::class, 'index']);

    Route::get   ('/clm/diagnosis-resolution',                   [ClmDiagnosisResolutionController::class, 'index']);
    Route::post  ('/clm/diagnosis-resolution/escalate',          [ClmDiagnosisResolutionController::class, 'escalate']);
    Route::get   ('/clm/regulatory-defense',                     [ClmRegulatoryDefenseFileController::class, 'index']);
    Route::post  ('/clm/signature-requests/agreement-preview',   [ClmSignatureController::class, 'agreementPreview']);
    Route::post  ('/clm/signature-requests/agreement-send',      [ClmSignatureController::class, 'agreementSend']);

    Route::post  ('/clm/signature-requests/sales-doc-send',      [ClmSignatureController::class, 'salesDocSend']);


    Route::get   ('/clm/clause-types',      [ClmClauseController::class, 'typesIndex']);
    Route::post  ('/clm/clause-types',      [ClmClauseController::class, 'typesStore']);
    Route::put   ('/clm/clause-types/{id}', [ClmClauseController::class, 'typesUpdate']);
    Route::delete('/clm/clause-types/{id}', [ClmClauseController::class, 'typesDestroy']);
    Route::get   ('/clm/clause-library',      [ClmClauseController::class, 'libraryIndex']);
    Route::post  ('/clm/clause-library',      [ClmClauseController::class, 'libraryStore']);
    Route::put   ('/clm/clause-library/{id}', [ClmClauseController::class, 'libraryUpdate']);
    Route::delete('/clm/clause-library/{id}', [ClmClauseController::class, 'libraryDestroy']);


    Route::get   ('/clm/segment-rules/bootstrap', [ClmSegmentRuleController::class, 'bootstrap']);

    Route::get   ('/clm/segment-rules/for-segment/{segmentId}', [ClmSegmentRuleController::class, 'forSegment'])->whereNumber('segmentId');
    Route::get   ('/clm/segment-rules',           [ClmSegmentRuleController::class, 'index']);
    Route::post  ('/clm/segment-rules',           [ClmSegmentRuleController::class, 'store']);
    Route::put   ('/clm/segment-rules/{id}',      [ClmSegmentRuleController::class, 'update']);
    Route::delete('/clm/segment-rules/{id}',      [ClmSegmentRuleController::class, 'destroy']);


    Route::get   ('/segment-uploads/download',                     [SegmentDocUploadController::class, 'download']);
    Route::get   ('/segment-uploads/{type}/{id}/summary',          [SegmentDocUploadController::class, 'summary'])->whereNumber('id');
    
    Route::get   ('/segment-uploads/{type}/{id}/vault',            [SegmentDocUploadController::class, 'vault'])->whereNumber('id');
    Route::get   ('/segment-uploads/{type}/{id}',                  [SegmentDocUploadController::class, 'index'])->whereNumber('id');
    Route::post  ('/segment-uploads/{type}/{id}',                  [SegmentDocUploadController::class, 'store'])->whereNumber('id');
    Route::delete('/segment-uploads/{type}/{id}/{uploadId}',       [SegmentDocUploadController::class, 'destroy'])->whereNumber('id')->whereNumber('uploadId');


    Route::get   ('/sales/lead-ack-reasons',       [LeadAckReasonController::class, 'index']);
    Route::post  ('/sales/lead-ack-reasons',       [LeadAckReasonController::class, 'store']);
    Route::put   ('/sales/lead-ack-reasons/{id}',  [LeadAckReasonController::class, 'update']);
    Route::delete('/sales/lead-ack-reasons/{id}',  [LeadAckReasonController::class, 'destroy']);

    
    Route::post  ('/sales/pi/preview-pdf',         [SalesPdfController::class, 'previewPi']);

    Route::post  ('/sales/quotations/{id}/preview-pdf', [SalesPdfController::class, 'previewQuotation']);

    Route::post  ('/sales/proforma-invoices/{id}/preview-pdf', [SalesPdfController::class, 'previewProformaInvoice']);

    
    Route::post  ('/sales/quotations/{id}/email',         [SalesPdfController::class, 'emailQuotation']);
    Route::post  ('/sales/proforma-invoices/{id}/email',  [SalesPdfController::class, 'emailProformaInvoice']);


    Route::post  ('/sales/quotations/{id}/remind',        [SalesPdfController::class, 'remindQuotation']);
    Route::post  ('/sales/proforma-invoices/{id}/remind', [SalesPdfController::class, 'remindProformaInvoice']);


    Route::get   ('/sales/leads',              [SalesLeadController::class, 'index']);
    Route::post  ('/sales/leads',              [SalesLeadController::class, 'store']);

    Route::get   ('/sales/leads/sync/config',     [SalesLeadController::class, 'syncConfig']);
    Route::post  ('/sales/leads/sync',            [SalesLeadController::class, 'syncFromCrm']);
    Route::post  ('/sales/leads/assign',                 [SalesLeadController::class, 'assign']);
    Route::post  ('/sales/leads/convert-to-qualified',   [SalesLeadController::class, 'convertToQualified']);
    Route::get   ('/sales/leads/salespeople',            [SalesLeadController::class, 'salespeople']);
    Route::get   ('/sales/leads/salesperson-summary',    [SalesLeadController::class, 'salespersonSummary']);
    Route::get   ('/sales/leads/filter-options',         [SalesLeadController::class, 'filterOptions']);
    Route::get   ('/sales/leads/{id}/activity', [SalesLeadController::class, 'activity'])->whereNumber('id');
    Route::get   ('/sales/leads/{id}',          [SalesLeadController::class, 'show'])->whereNumber('id');
    Route::put   ('/sales/leads/{id}',          [SalesLeadController::class, 'update'])->whereNumber('id');
    Route::delete('/sales/leads/{id}',          [SalesLeadController::class, 'destroy'])->whereNumber('id');


    Route::get   ('/sales/quotations',                          [QuotationController::class, 'index']);
    Route::get   ('/sales/quotations/preview-code',             [QuotationController::class, 'previewCode']);
    // Our own GST state code — drives the Domestic CGST+SGST vs IGST split on
    // both the Quotation and the PI form (shared, hence the neutral path).
    Route::get   ('/sales/gst-home-state',                      [QuotationController::class, 'gstHomeState']);
    Route::post  ('/sales/quotations',                          [QuotationController::class, 'store']);
    Route::get   ('/sales/quotations/{id}',                     [QuotationController::class, 'show'])->whereNumber('id');
    Route::put   ('/sales/quotations/{id}',                     [QuotationController::class, 'update'])->whereNumber('id');
    Route::delete('/sales/quotations/{id}',                     [QuotationController::class, 'destroy'])->whereNumber('id');
    Route::post  ('/sales/quotations/{id}/duplicate',           [QuotationController::class, 'duplicate'])->whereNumber('id');
    // convert-to-pi removed: it was a stub that flipped the quotation to
    // "converted" WITHOUT creating a PI and then locked the record, stranding it.
    // The real, wired path is POST /sales/proforma-invoices/from-quotation/{id}.
    Route::post  ('/sales/quotations/{id}/sync',                [QuotationController::class, 'sync'])->whereNumber('id');
    Route::get   ('/sales/quotations/{id}/zoho-pdf',            [QuotationController::class, 'zohoPdf'])->whereNumber('id');

    
    Route::get   ('/sales/proforma-invoices',                                   [ProformaInvoiceController::class, 'index']);
    Route::get   ('/sales/proforma-invoices/preview-code',                      [ProformaInvoiceController::class, 'previewCode']);
    // Pre-flight DCP check for the Create-PI wizard's Step 1 → Step 2 gate.
    Route::get   ('/sales/proforma-invoices/party-docs-check',                  [ProformaInvoiceController::class, 'partyDocsCheck']);
    Route::post  ('/sales/proforma-invoices',                                   [ProformaInvoiceController::class, 'store']);
   
    Route::post  ('/sales/proforma-invoices/from-quotation/{quotationId}',      [ProformaInvoiceController::class, 'fromQuotation'])->whereNumber('quotationId');
    Route::get   ('/sales/proforma-invoices/{id}',                              [ProformaInvoiceController::class, 'show'])->whereNumber('id');
    Route::put   ('/sales/proforma-invoices/{id}',                              [ProformaInvoiceController::class, 'update'])->whereNumber('id');
    Route::delete('/sales/proforma-invoices/{id}',                              [ProformaInvoiceController::class, 'destroy'])->whereNumber('id');
    Route::post  ('/sales/proforma-invoices/{id}/duplicate',                    [ProformaInvoiceController::class, 'duplicate'])->whereNumber('id');
    Route::post  ('/sales/proforma-invoices/{id}/sync',                         [ProformaInvoiceController::class, 'sync'])->whereNumber('id');
    Route::get   ('/sales/proforma-invoices/{id}/zoho-pdf',                     [ProformaInvoiceController::class, 'zohoPdf'])->whereNumber('id');

    
    Route::get ('/sales/shipment-orders/next-code',
        [\App\Http\Controllers\Api\ShipmentOrderController::class, 'nextCode']);
   
    Route::get ('/sales/shipment-orders',
        [\App\Http\Controllers\Api\ShipmentOrderController::class, 'index']);
    Route::post('/sales/shipment-orders',
        [\App\Http\Controllers\Api\ShipmentOrderController::class, 'store']);
    Route::get ('/sales/shipment-orders/{id}',
        [\App\Http\Controllers\Api\ShipmentOrderController::class, 'show'])->whereNumber('id');
    Route::post('/sales/shipment-orders/{id}',
        [\App\Http\Controllers\Api\ShipmentOrderController::class, 'update'])->whereNumber('id');
    Route::get ('/sales/leads/{leadId}/shipment-order',
        [\App\Http\Controllers\Api\ShipmentOrderController::class, 'getByLead'])->whereNumber('leadId');

    Route::match(['post', 'put'], '/sales/leads/{id}/task-manager',
        [SalesLeadController::class, 'storeTaskManager'])->whereNumber('id');

    Route::get   ('/sales/leads/{id}/acknowledgements',
        [SalesLeadController::class, 'listAcknowledgements'])->whereNumber('id');
    Route::post  ('/sales/leads/{id}/acknowledgements',
        [SalesLeadController::class, 'storeAcknowledgements'])->whereNumber('id');

    Route::match(['post', 'put'], '/sales/leads/{id}/whatsapp',
        [SalesLeadController::class, 'updateWhatsApp'])->whereNumber('id');


    Route::get   ('/sales/leads/{id}/products',
        [SalesLeadController::class, 'listLeadProducts'])->whereNumber('id');
    Route::post  ('/sales/leads/{id}/products',
        [SalesLeadController::class, 'storeLeadProduct'])->whereNumber('id');
    Route::put   ('/sales/leads/{id}/products/{mapping}',
        [SalesLeadController::class, 'updateLeadProduct'])->whereNumber('id')->whereNumber('mapping');
    Route::delete('/sales/leads/{id}/products/{mapping}',
        [SalesLeadController::class, 'destroyLeadProduct'])->whereNumber('id')->whereNumber('mapping');

    Route::patch('/sales/leads/{id}/products/{mapping}/sourcing-status',
        [SalesLeadController::class, 'updateLeadProductSourcingStatus'])
        ->whereNumber('id')->whereNumber('mapping');
    Route::patch('/sales/leads/{id}/products/{mapping}/mark-sourced',
        [SalesLeadController::class, 'markLeadProductSourced'])
        ->whereNumber('id')->whereNumber('mapping');

    Route::post('/sales/leads/{id}/products/{mapping}/shared-prices',
        [SalesLeadController::class, 'storeSharedPrice'])
        ->whereNumber('id')->whereNumber('mapping');
    Route::get('/sales/leads/{id}/shared-prices',
        [SalesLeadController::class, 'listSharedPrices'])->whereNumber('id');
    Route::get('/sales/leads/{id}/products/{mapping}/shared-prices',
        [SalesLeadController::class, 'listSharedPricesByProduct'])
        ->whereNumber('id')->whereNumber('mapping');
    Route::get('/sales/shared-prices/{id}/pdf',
        [SalesPdfController::class, 'sharedPriceQuotation'])->whereNumber('id');


    Route::get   ('/procurements/next-number', [ProcurementController::class, 'nextNumber']);
    Route::get   ('/procurements',             [ProcurementController::class, 'index']);
    Route::post  ('/procurements',             [ProcurementController::class, 'store']);
    Route::get   ('/procurements/{id}',        [ProcurementController::class, 'show'])->whereNumber('id');

    // ── Purchase Orders (P2P) ──
    Route::get   ('/p2p/purchase-orders/preview-code',            [PurchaseOrderController::class, 'previewCode']);
    Route::post  ('/p2p/purchase-orders/preview-pdf',             [PurchaseOrderController::class, 'previewPdf']);
    Route::get   ('/p2p/purchase-orders/suppliers',               [PurchaseOrderController::class, 'suppliers']);
    Route::get   ('/p2p/purchase-orders/suppliers/{id}',          [PurchaseOrderController::class, 'supplier'])->whereNumber('id');
    Route::get   ('/p2p/purchase-orders/suppliers/{id}/trade-documents', [PurchaseOrderController::class, 'supplierTradeDocs'])->whereNumber('id');
    Route::get   ('/p2p/purchase-orders/shipments',               [PurchaseOrderController::class, 'shipments']);
    Route::get   ('/p2p/purchase-orders/shipments/{id}/pi-products', [PurchaseOrderController::class, 'shipmentPiProducts'])->whereNumber('id');
    Route::get   ('/p2p/purchase-orders',                         [PurchaseOrderController::class, 'index']);
    Route::post  ('/p2p/purchase-orders',                         [PurchaseOrderController::class, 'store']);
    Route::get   ('/p2p/purchase-orders/{id}',                    [PurchaseOrderController::class, 'show'])->whereNumber('id');
    Route::put   ('/p2p/purchase-orders/{id}',                    [PurchaseOrderController::class, 'update'])->whereNumber('id');
    Route::delete('/p2p/purchase-orders/{id}',                    [PurchaseOrderController::class, 'destroy'])->whereNumber('id');
    Route::post  ('/p2p/purchase-orders/{id}/sync',               [PurchaseOrderController::class, 'sync'])->whereNumber('id');
    Route::post  ('/p2p/purchase-orders/{id}/sync-payment',       [PurchaseOrderController::class, 'syncPayment'])->whereNumber('id');

    // Dev Tools — read-only Zoho Books data inspector (admin-only; gated inside).
    Route::get   ('/dev-tools/zoho/{type}',                       [\App\Http\Controllers\Api\DevToolsController::class, 'zoho'])
        ->whereIn('type', ['items', 'vendors', 'purchase-orders', 'vendor-credits', 'bills', 'payments']);
    Route::get   ('/p2p/purchase-orders/{id}/attachment-status',  [PurchaseOrderController::class, 'attachmentStatus'])->whereNumber('id');
    Route::post  ('/p2p/purchase-orders/{id}/reattach',           [PurchaseOrderController::class, 'reattach'])->whereNumber('id');
    Route::post  ('/p2p/purchase-orders/{id}/send-for-signature', [PurchaseOrderController::class, 'sendForSignature'])->whereNumber('id');
    Route::get   ('/p2p/purchase-orders/{id}/zoho-pdf',           [PurchaseOrderController::class, 'zohoPdf'])->whereNumber('id');
    Route::post  ('/p2p/purchase-orders/{id}/email',              [SalesPdfController::class, 'emailPurchaseOrder'])->whereNumber('id');
    Route::get   ('/p2p/purchase-orders/{id}/pdf',                [SalesPdfController::class, 'viewPurchaseOrderPdf'])->whereNumber('id');
    // Payment Summary Against PO — payments always subtract from the PO balance,
    // reachable from both the PO and SPI screens.
    Route::get   ('/p2p/purchase-orders/{po}/payment-summary',     [PoPaymentController::class, 'summary'])->whereNumber('po');
    Route::post  ('/p2p/purchase-orders/{po}/payment-summary/tds', [PoPaymentController::class, 'saveTds'])->whereNumber('po');
    Route::post  ('/p2p/purchase-orders/{po}/payments',            [PoPaymentController::class, 'store'])->whereNumber('po');
    Route::delete('/p2p/purchase-orders/{po}/payments/{payment}',  [PoPaymentController::class, 'destroy'])->whereNumber('po')->whereNumber('payment');

    // ── Supplier Purchase Invoices (P2P) ──
    Route::get   ('/p2p/supplier-purchase-invoices/preview-code',        [SupplierPurchaseInvoiceController::class, 'previewCode']);
    Route::get   ('/p2p/supplier-purchase-invoices/purchase-orders',     [SupplierPurchaseInvoiceController::class, 'purchaseOrders']);
    Route::get   ('/p2p/supplier-purchase-invoices/purchase-orders/{id}',[SupplierPurchaseInvoiceController::class, 'purchaseOrder'])->whereNumber('id');
    Route::get   ('/p2p/supplier-purchase-invoices/suppliers',           [SupplierPurchaseInvoiceController::class, 'suppliers']);
    Route::get   ('/p2p/supplier-purchase-invoices/suppliers/{id}',       [SupplierPurchaseInvoiceController::class, 'supplier'])->whereNumber('id');
    Route::post  ('/p2p/supplier-purchase-invoices/upload',              [SupplierPurchaseInvoiceController::class, 'upload']);
    Route::get   ('/p2p/supplier-purchase-invoices/download',            [SupplierPurchaseInvoiceController::class, 'download']);
    Route::get   ('/p2p/supplier-purchase-invoices',                     [SupplierPurchaseInvoiceController::class, 'index']);
    Route::post  ('/p2p/supplier-purchase-invoices',                     [SupplierPurchaseInvoiceController::class, 'store']);
    Route::get   ('/p2p/supplier-purchase-invoices/{id}',                [SupplierPurchaseInvoiceController::class, 'show'])->whereNumber('id');
    Route::put   ('/p2p/supplier-purchase-invoices/{id}',                [SupplierPurchaseInvoiceController::class, 'update'])->whereNumber('id');
    Route::delete('/p2p/supplier-purchase-invoices/{id}',                [SupplierPurchaseInvoiceController::class, 'destroy'])->whereNumber('id');
    Route::post  ('/p2p/supplier-purchase-invoices/{id}/sync',           [SupplierPurchaseInvoiceController::class, 'sync'])->whereNumber('id');
    Route::post  ('/p2p/supplier-purchase-invoices/{id}/sync-payment',   [SupplierPurchaseInvoiceController::class, 'syncPayment'])->whereNumber('id');
    Route::post  ('/p2p/supplier-purchase-invoices/{id}/sync-attachment',[SupplierPurchaseInvoiceController::class, 'syncAttachment'])->whereNumber('id');
    Route::get   ('/p2p/supplier-purchase-invoices/{id}/zoho-pdf',        [SupplierPurchaseInvoiceController::class, 'zohoPdf'])->whereNumber('id');
    // Direct-SPI payments ("Payment Summary Against SPI") — mirrors the PO flow.
    Route::get   ('/p2p/supplier-purchase-invoices/{spi}/payment-summary',     [SpiPaymentController::class, 'summary'])->whereNumber('spi');
    Route::post  ('/p2p/supplier-purchase-invoices/{spi}/payment-summary/tds', [SpiPaymentController::class, 'saveTds'])->whereNumber('spi');
    Route::post  ('/p2p/supplier-purchase-invoices/{spi}/payments',            [SpiPaymentController::class, 'store'])->whereNumber('spi');
    Route::delete('/p2p/supplier-purchase-invoices/{spi}/payments/{payment}',  [SpiPaymentController::class, 'destroy'])->whereNumber('spi')->whereNumber('payment');

    // ── Debit Note Types (P2P master lookup) ──
    Route::get   ('/p2p/debit-note-types',        [DebitNoteTypeController::class, 'index']);
    Route::post  ('/p2p/debit-note-types',        [DebitNoteTypeController::class, 'store']);
    Route::put   ('/p2p/debit-note-types/{id}',   [DebitNoteTypeController::class, 'update'])->whereNumber('id');
    Route::delete('/p2p/debit-note-types/{id}',   [DebitNoteTypeController::class, 'destroy'])->whereNumber('id');

    // ── Debit Notes (P2P) ──
    Route::get   ('/p2p/debit-notes/preview-code',                       [DebitNoteController::class, 'previewCode']);
    Route::get   ('/p2p/debit-notes/supplier-purchase-invoices',        [DebitNoteController::class, 'supplierPurchaseInvoices']);
    Route::get   ('/p2p/debit-notes/supplier-purchase-invoices/{id}',   [DebitNoteController::class, 'supplierPurchaseInvoice'])->whereNumber('id');
    Route::get   ('/p2p/debit-notes',                                   [DebitNoteController::class, 'index']);
    Route::post  ('/p2p/debit-notes',                                   [DebitNoteController::class, 'store']);
    Route::get   ('/p2p/debit-notes/{id}',                              [DebitNoteController::class, 'show'])->whereNumber('id');
    Route::get   ('/p2p/debit-notes/{id}/pdf',                          [SalesPdfController::class, 'viewDebitNotePdf'])->whereNumber('id');
    Route::post  ('/p2p/debit-notes/{id}/email',                        [SalesPdfController::class, 'emailDebitNote'])->whereNumber('id');
    Route::put   ('/p2p/debit-notes/{id}',                              [DebitNoteController::class, 'update'])->whereNumber('id');
    Route::delete('/p2p/debit-notes/{id}',                             [DebitNoteController::class, 'destroy'])->whereNumber('id');
    Route::post  ('/p2p/debit-notes/{id}/sync',                         [DebitNoteController::class, 'sync'])->whereNumber('id');
    Route::get   ('/p2p/debit-notes/{id}/attachment-status',            [DebitNoteController::class, 'attachmentStatus'])->whereNumber('id');
    Route::post  ('/p2p/debit-notes/{id}/reattach',                     [DebitNoteController::class, 'reattach'])->whereNumber('id');
    Route::get   ('/p2p/debit-notes/{id}/zoho-pdf',                     [DebitNoteController::class, 'zohoPdf'])->whereNumber('id');
    // Payment Recovery against a debit note — recovered amounts subtract from the
    // DN balance and drive its Unpaid → Partially/Fully Paid / Overdue status.
    Route::get   ('/p2p/debit-notes/{dn}/payment-summary',              [DebitNotePaymentController::class, 'summary'])->whereNumber('dn');
    Route::post  ('/p2p/debit-notes/{dn}/payments',                     [DebitNotePaymentController::class, 'store'])->whereNumber('dn');
    Route::delete('/p2p/debit-notes/{dn}/payments/{payment}',           [DebitNotePaymentController::class, 'destroy'])->whereNumber('dn')->whereNumber('payment');


    Route::get   ('/sales/reminders',                 [SalesTodoController::class, 'listReminders']);
    Route::post  ('/sales/reminders',                 [SalesTodoController::class, 'storeReminder']);
 
    Route::match(['put', 'post'], '/sales/reminders/{id}', [SalesTodoController::class, 'updateReminder']);
    Route::patch ('/sales/reminders/{id}/status',     [SalesTodoController::class, 'setReminderStatus']);
    Route::delete('/sales/reminders/{id}',            [SalesTodoController::class, 'destroyReminder']);

    Route::get   ('/sales/meetings',                  [SalesTodoController::class, 'listMeetings']);
    Route::get   ('/sales/meetings/next-code',        [SalesTodoController::class, 'nextMeetingCode']);
    Route::post  ('/sales/meetings',                  [SalesTodoController::class, 'storeMeeting']);
    Route::put   ('/sales/meetings/{id}',             [SalesTodoController::class, 'updateMeeting']);
    Route::patch ('/sales/meetings/{id}/status',      [SalesTodoController::class, 'setMeetingStatus']);
    Route::delete('/sales/meetings/{id}',             [SalesTodoController::class, 'destroyMeeting']);


    Route::apiResource('organization-types', OrganizationTypeController::class)
        ->parameters(['organization-types' => 'organizationType']);

   
    Route::get   ('/hrms/overview',               [HrOverviewController::class, 'index']);

    Route::get   ('/employees/next-code',         [EmployeeController::class, 'nextCode']);
    Route::get   ('/employees/managers',          [EmployeeController::class, 'managers']);
    // Ahead of apiResource below — otherwise "stats" is read as an {employee} id.
    Route::get   ('/employees/stats',             [EmployeeController::class, 'stats']);
    Route::get   ('/employees/department-tree/{departmentId}', [EmployeeController::class, 'departmentOrgTree'])->whereNumber('departmentId');
    Route::get   ('/employees/available-assets',  [EmployeeController::class, 'availableAssets']);

    Route::get   ('/employees/check-mobile',      [EmployeeController::class, 'checkMobile']);

    Route::post  ('/employees/onboarding-invite', [OnboardingController::class, 'createInvite']);

    Route::patch ('/employees/{id}/restore',      [EmployeeController::class, 'restore']);

    Route::delete('/employees/{id}/force',        [EmployeeController::class, 'forceDestroy']);

    Route::get   ('/employees/{id}/holidays',     [EmployeeController::class, 'holidays']);
    Route::post  ('/employees/{id}/set-password', [EmployeeController::class, 'setPassword']);
    Route::put   ('/employees/{id}/bank-details', [EmployeeController::class, 'updateBankDetails']);
    Route::apiResource('employees', EmployeeController::class);


    Route::get  ('/employees/{employee}/documents', [EmployeeDocumentController::class, 'index']);
    Route::post ('/employees/{employee}/documents', [EmployeeDocumentController::class, 'store']);
    Route::get  ('/documents/{document}/download',  [EmployeeDocumentController::class, 'download']);
    Route::patch('/documents/{document}/verify',    [EmployeeDocumentController::class, 'verify']);
    Route::patch('/documents/{document}/reject',    [EmployeeDocumentController::class, 'reject']);
    Route::delete('/documents/{document}',          [EmployeeDocumentController::class, 'destroy']);

  
    Route::get('/employees/{employee}/exit', [ExitController::class, 'show']);
    // Outstanding advances / claims / earned salary feeding the F&F stage.
    Route::get('/employees/{employee}/exit/fnf-summary', [ExitController::class, 'fnfSummary']);
    // Mandatory F&F document — required before the settlement can be paid.
    Route::post('/employees/{employee}/exit/fnf-attachment', [ExitController::class, 'uploadFnfAttachment']);
    Route::put('/employees/{employee}/exit', [ExitController::class, 'upsert']);
    
    Route::post('/employees/{employee}/exit/complete', [ExitController::class, 'complete']);
    /* Reporting-manager dependency — an employee who still manages people can't
       be deactivated, so the closure stage lists their reports and reassigns
       them before Complete Exit is allowed. */
    Route::get ('/employees/{employee}/exit/direct-reports',    [ExitController::class, 'directReports']);
    Route::post('/employees/{employee}/exit/reassign-reports',  [ExitController::class, 'reassignReports']);
    // Bring an exited employee back (standard resignations only).
    Route::post('/employees/{employee}/rehire', [ExitController::class, 'rehire']);

    /* Notice-period recovery paid BY the employee (resignation without notice).
       The employee raises it from their Payroll Details tab; HR verifies it on
       the exit wizard's Notice Period Payment stage. */
    Route::get ('/employees/{employee}/notice-payment', [\App\Http\Controllers\Api\ExitNoticePaymentController::class, 'summary']);
    Route::post('/employees/{employee}/notice-payment', [\App\Http\Controllers\Api\ExitNoticePaymentController::class, 'store']);
    // HR records a payment that arrived another way — same row shape, so it
    // also shows in the employee's own Payment Details tab.
    Route::post('/employees/{employee}/notice-payment/record', [\App\Http\Controllers\Api\ExitNoticePaymentController::class, 'record']);
    Route::post('/notice-payments/{id}/approve', [\App\Http\Controllers\Api\ExitNoticePaymentController::class, 'approve'])->whereNumber('id');
    Route::post('/notice-payments/{id}/reject',  [\App\Http\Controllers\Api\ExitNoticePaymentController::class, 'reject'])->whereNumber('id');


    Route::get   ('/employees/{employee}/previous-employments', [PreviousEmploymentController::class, 'index']);
    Route::post  ('/employees/{employee}/previous-employments', [PreviousEmploymentController::class, 'store']);
    Route::patch ('/previous-employments/{prev}',               [PreviousEmploymentController::class, 'update']);
    Route::delete('/previous-employments/{prev}',               [PreviousEmploymentController::class, 'destroy']);

    Route::get   ('/recruitments/next-code', [RecruitmentController::class, 'nextCode']);
    Route::apiResource('recruitments', RecruitmentController::class);

   
    Route::get   ('/hiring-requests/next-code', [HiringRequestController::class, 'nextCode']);
    Route::apiResource('hiring-requests', HiringRequestController::class);


    Route::get  ('/recruitments/{recruitment}/candidates/summary', [CandidateController::class, 'recruitmentSummary']);
    Route::patch('/candidates/{candidate}/status',                 [CandidateController::class, 'updateStatus']);

    Route::get ('/candidates/stats',  [CandidateController::class, 'stats']);
    Route::get ('/candidates/sample', [CandidateController::class, 'sample']);
    Route::post('/candidates/import', [CandidateController::class, 'import']);
    Route::get ('/candidates/export', [CandidateController::class, 'export']);
    Route::apiResource('candidates', CandidateController::class);

    Route::get   ('/expense-claims',                          [ExpenseClaimController::class, 'index']);
    // Active expense categories for the raise-claim form — branch-scoped so an
    // employee sees their branch's categories (the generic /master endpoint
    // peer-isolates employees to globals + client-level + own rows). Declared
    // before the {id} route so "categories" isn't captured as an id.
    Route::get   ('/expense-claims/categories',               [ExpenseClaimController::class, 'categories']);
    // Consolidated (batch) payment — static paths BEFORE the {id} route.
    Route::get   ('/expense-claims/batch-payable',            [ExpenseClaimController::class, 'batchPayable']);
    Route::get   ('/expense-claims/batch-payments',           [ExpenseClaimController::class, 'batchPayments']);
    // NOTE: the batch-payment proof file link is a plain browser navigation
    // (opens in a new tab) so it carries no Authorization header. Its route
    // lives OUTSIDE this auth:sanctum group with the other file-download
    // routes and authenticates via ?token= — see below near the other
    // expense-claim file routes. Keeping it here would 500 with
    // "Route [login] not defined".
    Route::post  ('/expense-claims/batch-payments/{batchId}/sync-zoho', [ExpenseClaimController::class, 'syncBatchPaymentToZoho']);
    Route::post  ('/expense-claims/batch-pay',                [ExpenseClaimController::class, 'batchPay']);
    Route::post  ('/expense-claims',                          [ExpenseClaimController::class, 'store']);
    Route::get   ('/expense-claims/{id}',                     [ExpenseClaimController::class, 'show']);
    Route::post  ('/expense-claims/{id}/manager-approve',     [ExpenseClaimController::class, 'managerApprove']);
    Route::post  ('/expense-claims/{id}/manager-reject',      [ExpenseClaimController::class, 'managerReject']);
    Route::post  ('/expense-claims/{id}/hr-approve',          [ExpenseClaimController::class, 'hrApprove']);
    Route::post  ('/expense-claims/{id}/hr-reject',           [ExpenseClaimController::class, 'hrReject']);
    // Post-approval settlement (Record Payment) — supports partial payments.
    Route::get   ('/expense-claims/{id}/settlement',          [ExpenseClaimController::class, 'settlement']);
    Route::post  ('/expense-claims/{id}/set-deductions',      [ExpenseClaimController::class, 'setDeductions']);
    Route::post  ('/expense-claims/{id}/settle',              [ExpenseClaimController::class, 'settle']);
    Route::post  ('/expense-claims/payments/{paymentId}/sync-zoho', [ExpenseClaimController::class, 'syncPaymentToZoho']);
    Route::post  ('/expense-claims/{id}/email-reimbursement',  [ExpenseClaimController::class, 'emailReimbursement']);


    Route::get   ('/advance-requests/emi-info',                 [\App\Http\Controllers\Api\AdvanceRequestController::class, 'emiInfo']);
    Route::get   ('/advance-requests',                          [\App\Http\Controllers\Api\AdvanceRequestController::class, 'index']);
    Route::post  ('/advance-requests',                          [\App\Http\Controllers\Api\AdvanceRequestController::class, 'store']);
    Route::get   ('/advance-requests/{id}',                     [\App\Http\Controllers\Api\AdvanceRequestController::class, 'show']);
    Route::post  ('/advance-requests/{id}/manager-approve',     [\App\Http\Controllers\Api\AdvanceRequestController::class, 'managerApprove']);
    Route::post  ('/advance-requests/{id}/manager-reject',      [\App\Http\Controllers\Api\AdvanceRequestController::class, 'managerReject']);
    Route::post  ('/advance-requests/{id}/hr-approve',          [\App\Http\Controllers\Api\AdvanceRequestController::class, 'hrApprove']);
    Route::post  ('/advance-requests/{id}/hr-reject',           [\App\Http\Controllers\Api\AdvanceRequestController::class, 'hrReject']);
    // Settlement (post-approval payout) — mirrors expense-claim settlement.
    Route::get   ('/advance-requests/{id}/settlement',          [\App\Http\Controllers\Api\AdvanceRequestController::class, 'settlement']);
    Route::post  ('/advance-requests/{id}/set-deductions',      [\App\Http\Controllers\Api\AdvanceRequestController::class, 'setDeductions']);
    Route::post  ('/advance-requests/{id}/settle',              [\App\Http\Controllers\Api\AdvanceRequestController::class, 'settle']);
    Route::post  ('/advance-requests/{id}/employee-settle',     [\App\Http\Controllers\Api\AdvanceRequestController::class, 'employeeSettle']);
    Route::post  ('/advance-requests/{id}/settle-approve',      [\App\Http\Controllers\Api\AdvanceRequestController::class, 'settleApprove']);
    Route::post  ('/advance-requests/{id}/settle-reject',       [\App\Http\Controllers\Api\AdvanceRequestController::class, 'settleReject']);
    Route::post  ('/advance-requests/payments/{paymentId}/sync-zoho', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'syncPaymentToZoho'])->whereNumber('paymentId');
    Route::post  ('/advance-requests/{id}/raise-reimbursement', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'raiseReimbursement']);
    Route::post  ('/advance-requests/{id}/record-return',       [\App\Http\Controllers\Api\AdvanceRequestController::class, 'recordReturn']);
    // DISABLED (kept for later re-enable) — one-time DIRECT recovery pay-off.
    // Uncomment this route + the recovery-payment-proof route below, and flip
    // ONETIME_PAYOFF_ENABLED in ExpenseSettlementModal.tsx, to turn it back on.
    // Route::post  ('/advance-requests/{id}/recover-onetime',     [\App\Http\Controllers\Api\AdvanceRequestController::class, 'recoverOnetime']);
    // Branch admin / HR confirm (or reject) each employee return payment — the
    // return only closes once every payment covering the balance is approved.
    Route::post  ('/advance-requests/{id}/return-payments/{index}/approve', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'approveReturnPayment'])->whereNumber('index');
    Route::post  ('/advance-requests/{id}/return-payments/{index}/reject',  [\App\Http\Controllers\Api\AdvanceRequestController::class, 'rejectReturnPayment'])->whereNumber('index');

    /* On-demand test-data generators (admins only) — run via curl when needed.
     *
     * NEVER REGISTERED OUTSIDE local / staging. Each controller already checks
     * role, client and branch scope correctly, but none of that stops a real
     * admin running them against live data — and these write FABRICATED rows
     * that payroll then reads: seeded attendance and leave feed the salary
     * calculation, and backdate-joining rewrites joining dates, which move
     * probation, notice period and leave accrual for everyone it touches.
     *
     * Guarded HERE rather than inside the three controllers so a fourth /dev/
     * endpoint added later inherits the protection instead of having to
     * remember it. On production the routes simply do not exist — a request
     * gets a plain 404, revealing nothing about what the path would have done. */
    if (app()->environment(['local', 'staging'])) {
        Route::post  ('/dev/sandwich-leave',  [\App\Http\Controllers\Api\SandwichTestController::class, 'seed']);
        Route::post  ('/dev/attendance-seed', [\App\Http\Controllers\Api\AttendanceTestController::class, 'seed']);
        Route::post  ('/dev/backdate-joining',[\App\Http\Controllers\Api\EmployeeJoiningTestController::class, 'backdate']);
    }


    Route::get ('/payroll/cycles',              [\App\Http\Controllers\Api\PayrollController::class, 'cycles']);
    Route::get ('/payroll/history',             [\App\Http\Controllers\Api\PayrollController::class, 'history']);
    Route::get ('/payroll/preflight',           [\App\Http\Controllers\Api\PayrollController::class, 'preflight']);
    // Leaves in the cycle inflated by the Sandwich Leave Policy — the payroll
    // screen's review list. Waiving still goes through the leave endpoint.
    Route::get ('/payroll/sandwich-review',     [\App\Http\Controllers\Api\PayrollController::class, 'sandwichReview']);
    Route::get ('/payroll/export',              [\App\Http\Controllers\Api\PayrollController::class, 'export']);
    Route::get ('/payroll/payslips/bulk',       [\App\Http\Controllers\Api\PayrollController::class, 'payslipsBulk']);
    Route::post('/payroll/payslips/email',      [\App\Http\Controllers\Api\PayrollController::class, 'emailPayslipsBulk']);
    Route::get ('/payroll/payslip/{id}/pdf',    [\App\Http\Controllers\Api\PayrollController::class, 'payslipPdf'])->whereNumber('id');
    Route::post('/payroll/payslip/{id}/email',  [\App\Http\Controllers\Api\PayrollController::class, 'emailPayslip'])->whereNumber('id');
    Route::get ('/payroll/payslip/{id}',        [\App\Http\Controllers\Api\PayrollController::class, 'payslip'])->whereNumber('id');
    Route::get ('/payroll/employee/{employeeId}/payslips', [\App\Http\Controllers\Api\PayrollController::class, 'employeePayslips'])->whereNumber('employeeId');
    Route::get ('/payroll/fnf/{employeeId}',    [\App\Http\Controllers\Api\PayrollController::class, 'fnf'])->whereNumber('employeeId');
    // Rule 21 — the settlement is a saved document, not just a live preview.
    Route::post('/payroll/fnf/{employeeId}',        [\App\Http\Controllers\Api\PayrollController::class, 'fnfSave'])->whereNumber('employeeId');
    Route::post('/payroll/fnf/{employeeId}/status', [\App\Http\Controllers\Api\PayrollController::class, 'fnfStatus'])->whereNumber('employeeId');
    Route::get ('/payroll',                      [\App\Http\Controllers\Api\PayrollController::class, 'index']);
    Route::post('/payroll/finalize-attendance', [\App\Http\Controllers\Api\PayrollController::class, 'finalizeAttendance']);
    Route::post('/payroll/run',                  [\App\Http\Controllers\Api\PayrollController::class, 'run']);
    Route::post('/payroll/reopen',               [\App\Http\Controllers\Api\PayrollController::class, 'reopen']);
    Route::post('/payroll/approve',              [\App\Http\Controllers\Api\PayrollController::class, 'approve']);
    Route::post('/payroll/pay',                  [\App\Http\Controllers\Api\PayrollController::class, 'pay']);

    Route::post('/payroll/payment/prepare',         [\App\Http\Controllers\Api\PayrollPaymentController::class, 'prepare']);
    Route::get ('/payroll/payment/{id}',            [\App\Http\Controllers\Api\PayrollPaymentController::class, 'show'])->whereNumber('id');
    Route::post('/payroll/payment/{id}/approve',    [\App\Http\Controllers\Api\PayrollPaymentController::class, 'approve'])->whereNumber('id');
    Route::post('/payroll/payment/{id}/initiate',   [\App\Http\Controllers\Api\PayrollPaymentController::class, 'initiate'])->whereNumber('id');
    Route::get ('/payroll/payment/{id}/bank-file',  [\App\Http\Controllers\Api\PayrollPaymentController::class, 'bankFile'])->whereNumber('id');
    Route::get ('/payroll/payment/{id}/audit',      [\App\Http\Controllers\Api\PayrollPaymentController::class, 'auditTrail'])->whereNumber('id');

    Route::get   ('/payroll-adjustments',            [\App\Http\Controllers\Api\PayrollAdjustmentController::class, 'index']);
    // Overtime detected from attendance (worked past the shift end) + the rate
    // it would be paid at. Read-only preview — declared before the {id} routes.
    Route::get   ('/payroll-adjustments/overtime-preview', [\App\Http\Controllers\Api\PayrollAdjustmentController::class, 'overtimePreview']);
    Route::post  ('/payroll-adjustments',            [\App\Http\Controllers\Api\PayrollAdjustmentController::class, 'store']);
    Route::post  ('/payroll-adjustments/{id}/approve', [\App\Http\Controllers\Api\PayrollAdjustmentController::class, 'approve'])->whereNumber('id');
    Route::post  ('/payroll-adjustments/{id}/reject',  [\App\Http\Controllers\Api\PayrollAdjustmentController::class, 'reject'])->whereNumber('id');
    Route::delete('/payroll-adjustments/{id}',       [\App\Http\Controllers\Api\PayrollAdjustmentController::class, 'destroy'])->whereNumber('id');

   
    Route::get   ('/salary-structures/employees', [\App\Http\Controllers\Api\SalaryStructureController::class, 'employees']);
    Route::get   ('/salary-structures',      [\App\Http\Controllers\Api\SalaryStructureController::class, 'index']);
    Route::post  ('/salary-structures',      [\App\Http\Controllers\Api\SalaryStructureController::class, 'store']);
    Route::get   ('/salary-structures/{id}', [\App\Http\Controllers\Api\SalaryStructureController::class, 'show'])->whereNumber('id');
    Route::delete('/salary-structures/{id}', [\App\Http\Controllers\Api\SalaryStructureController::class, 'destroy'])->whereNumber('id');

    Route::get('/announcements/stats',     [AnnouncementController::class, 'stats']);
    Route::get('/announcements/next-code', [AnnouncementController::class, 'nextCode']);
    Route::apiResource('announcements', AnnouncementController::class);

    Route::apiResource('holiday-groups', \App\Http\Controllers\Api\HolidayGroupController::class);
    Route::get ('/holidays/my',     [\App\Http\Controllers\Api\HolidayController::class, 'my']);
    Route::post('/holidays/import', [\App\Http\Controllers\Api\HolidayController::class, 'import']);
    Route::apiResource('holidays', \App\Http\Controllers\Api\HolidayController::class);


    Route::get ('/hr-document-templates/stats',                [HrDocumentTemplateController::class, 'stats']);
    Route::get ('/hr-document-templates/next-code',            [HrDocumentTemplateController::class, 'nextCode']);
    Route::get ('/hr-document-templates/last-branding',        [HrDocumentTemplateController::class, 'lastBranding']);

    Route::post('/hr-document-templates/upload-header-logo',   [HrDocumentTemplateController::class, 'uploadHeaderLogo']);

    Route::get ('/hr-document-templates/match',                [HrDocumentTemplateController::class, 'matchForEmployee']);
    Route::get ('/hr-document-templates/{id}/download',        [HrDocumentTemplateController::class, 'downloadDocx']);

    Route::get ('/hr-document-templates/{id}/generate',        [HrDocumentTemplateController::class, 'generateForEmployee']);

    Route::get ('/hr-document-templates/{id}/preview',         [HrDocumentTemplateController::class, 'previewForEmployee']);
    Route::post('/hr-document-templates/{id}/upload-docx',     [HrDocumentTemplateController::class, 'uploadDocx']);

    Route::get ('/my-team/employees',                    [MyTeamController::class, 'employees']);
    Route::get ('/my-team/approvals',                    [MyTeamController::class, 'approvals']);
    Route::get ('/my-team/my-updates',                   [MyTeamController::class, 'myUpdates']);

    Route::get ('/hr-document-signatures/inbox',        [HrDocumentSignatureController::class, 'inbox']);
    Route::post('/hr-document-signatures/{id}/action',  [HrDocumentSignatureController::class, 'action']);
    Route::post('/hr-document-signatures/{id}/reject',  [HrDocumentSignatureController::class, 'reject']);
    Route::post('/hr-document-signatures/{id}/cancel',  [HrDocumentSignatureController::class, 'cancel']);
    Route::post('/hr-document-signatures/{id}/remind',  [HrDocumentSignatureController::class, 'remind']);

    Route::get ('/hr-document-signatures/{id}/download',       [HrDocumentSignatureController::class, 'downloadSigned']);
    Route::get ('/hr-document-signatures/{id}/download-pdf',   [HrDocumentSignatureController::class, 'downloadSignedPdf']);
    Route::post('/hr-document-signatures/{id}/email-employee', [HrDocumentSignatureController::class, 'emailToEmployee']);

    Route::get ('/employees/{slug}/signed-documents',          [HrDocumentSignatureController::class, 'forEmployee'])
        ->where('slug', '[A-Za-z0-9_-]+');
    Route::get ('/hr-document-signatures',              [HrDocumentSignatureController::class, 'index']);
    Route::post('/hr-document-signatures',              [HrDocumentSignatureController::class, 'store']);
    Route::get ('/hr-document-signatures/{id}',         [HrDocumentSignatureController::class, 'show']);
    Route::apiResource('hr-document-templates', HrDocumentTemplateController::class)
        ->parameters(['hr-document-templates' => 'id']);

    Route::get ('/hr-custom-fields/stats',           [HrCustomFieldController::class, 'stats']);
    Route::get ('/hr-custom-fields/known-tokens',    [HrCustomFieldController::class, 'knownTokens']);
    Route::post('/hr-custom-fields/validate-tokens', [HrCustomFieldController::class, 'validateTokens']);
    Route::apiResource('hr-custom-fields', HrCustomFieldController::class)
        ->parameters(['hr-custom-fields' => 'id']);


    Route::get ('/hr-generated-documents',               [HrGeneratedDocumentController::class, 'index']);
    Route::post('/hr-generated-documents/preview',       [HrGeneratedDocumentController::class, 'preview']);
    Route::get ('/hr-generated-documents/{id}/download', [HrGeneratedDocumentController::class, 'downloadDocx']);
    // PDF alongside DOCX — the DOCX is the editable copy, the PDF is the one
    // that looks identical in every reader (see downloadPdf's note on VML).
    Route::get ('/hr-generated-documents/{id}/download-pdf', [HrGeneratedDocumentController::class, 'downloadPdf']);
    Route::post('/hr-generated-documents',               [HrGeneratedDocumentController::class, 'store']);
    Route::get ('/hr-generated-documents/{id}',          [HrGeneratedDocumentController::class, 'show']);

    // Documentation guide (docs/*). Same for every role, so no permission gate —
    // any signed-in user can read and edit the sheets.
    Route::get ('/docs-guide',         [DocsGuideController::class, 'index']);
    Route::get ('/docs-guide/content', [DocsGuideController::class, 'show']);
    Route::put ('/docs-guide/content', [DocsGuideController::class, 'update']);

    Route::get   ('/master-counts',           [MasterController::class, 'counts']);
    Route::get   ('/master/{slug}',           [MasterController::class, 'list']);
    Route::post  ('/master/{slug}',           [MasterController::class, 'store']);

    Route::get   ('/master/{slug}/next-code', [MasterController::class, 'nextCode']);
    Route::get   ('/master/{slug}/{id}',      [MasterController::class, 'show']);
    Route::put   ('/master/{slug}/{id}',    [MasterController::class, 'update']);
    Route::delete('/master/{slug}/{id}',    [MasterController::class, 'destroy']);


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

    Route::get   ('/leave-balances',                             [LeavePlanController::class, 'leaveBalances']);

   
    Route::get   ('/leave-requests',                             [LeaveRequestController::class, 'index']);
    Route::post  ('/leave-requests',                             [LeaveRequestController::class, 'store']);

    Route::get   ('/leave-requests/approvals',                   [LeaveRequestController::class, 'approvals']);

    Route::get   ('/leave-requests/colleagues',                  [LeaveRequestController::class, 'colleagues']);
    Route::get   ('/leave-requests/{id}',                        [LeaveRequestController::class, 'show']);
    Route::get   ('/leave-requests/{id}/approvers',              [LeaveRequestController::class, 'approvers']);
    Route::post  ('/leave-requests/{id}/approve',                [LeaveRequestController::class, 'approve']);
    Route::post  ('/leave-requests/{id}/reject',                 [LeaveRequestController::class, 'reject']);
    Route::post  ('/leave-requests/{id}/cancel',                 [LeaveRequestController::class, 'cancel']);
    Route::post  ('/leave-requests/{id}/hr-view',                [LeaveRequestController::class, 'hrView']);
    // Sandwich Leave Policy waiver for one leave (emergency / genuine case).
    // Written from BOTH the leave approval screen and the payroll run screen —
    // one endpoint so the two can never hold different answers.
    Route::post  ('/leave-requests/{id}/sandwich-waiver',        [LeaveRequestController::class, 'sandwichWaiver']);

    // Attendance regularization (correct a past day) — mirrors leave-requests.
    Route::get   ('/regularizations',                            [AttendanceRegularizationController::class, 'index']);
    Route::post  ('/regularizations',                            [AttendanceRegularizationController::class, 'store']);
    Route::get   ('/regularizations/approvals',                  [AttendanceRegularizationController::class, 'approvals']);
    Route::get   ('/regularizations/{id}',                       [AttendanceRegularizationController::class, 'show']);
    Route::get   ('/regularizations/{id}/approvers',             [AttendanceRegularizationController::class, 'approvers']);
    Route::post  ('/regularizations/{id}/approve',               [AttendanceRegularizationController::class, 'approve']);
    Route::post  ('/regularizations/{id}/reject',                [AttendanceRegularizationController::class, 'reject']);
    Route::post  ('/regularizations/{id}/cancel',                [AttendanceRegularizationController::class, 'cancel']);

    Route::get   ('/notifications',                              [NotificationController::class, 'index']);
    Route::get   ('/notifications/unread-count',                 [NotificationController::class, 'unreadCount']);
    Route::post  ('/notifications/read-all',                     [NotificationController::class, 'markAllRead']);
    Route::post  ('/notifications/{id}/read',                    [NotificationController::class, 'markRead']);


    Route::get   ('/emails',                                     [EmailController::class, 'index']);
    Route::get   ('/emails/stats',                              [EmailController::class, 'stats']);
    Route::get   ('/emails/recipients',                         [EmailController::class, 'recipients']);
    Route::post  ('/emails/bulk',                               [EmailController::class, 'bulk']);
    Route::get   ('/emails/{id}',                               [EmailController::class, 'show']);
    Route::post  ('/emails',                                     [EmailController::class, 'store']);

  
    Route::get   ('/employees/{employeeId}/leave-balances',      [LeavePlanController::class, 'employeeBalances']);

   
    Route::get('/subscription/plans', [SubscriptionController::class, 'plans']);
    Route::get('/subscription/status', [SubscriptionController::class, 'status']);
    Route::post('/subscription/create-order', [SubscriptionController::class, 'createOrder']);
    Route::post('/subscription/verify-payment', [SubscriptionController::class, 'verifyPayment']);
    Route::post('/subscription/cancel-order', [SubscriptionController::class, 'cancelOrder']);


    Route::get('/payments/stats', [PaymentController::class, 'stats']);
    Route::post('/payments/{payment}/send-reminder', [PaymentController::class, 'sendReminder']);
    Route::apiResource('payments', PaymentController::class);

    Route::get   ('/face/status',   [FaceBiometricController::class, 'status']);
    Route::post  ('/face/register', [FaceBiometricController::class, 'register']);
    Route::delete('/face/data',     [FaceBiometricController::class, 'revoke']);

  
    Route::get ('/attendance',                                 [AttendanceController::class, 'index']);
    Route::get ('/attendance/daily-view',                      [AttendanceController::class, 'dailyView']);
    Route::get ('/attendance/my',                              [AttendanceController::class, 'my']);
    Route::get ('/attendance/today',                           [AttendanceController::class, 'today']);
    Route::get ('/attendance/employee/{employeeId}/summary',   [AttendanceController::class, 'employeeSummary']);
    Route::post('/attendance/face/clock-in',                   [AttendanceController::class, 'faceClockIn']);
    Route::post('/attendance/face/clock-out',                  [AttendanceController::class, 'faceClockOut']);
    Route::post('/attendance/import',                          [AttendanceController::class, 'import']);

    // Biometric terminal registry (eSSL / ZKTeco). The device push path itself
    // is public (/iclock/* in routes/web.php); this manages which serials are
    // trusted and which tenant/branch they map to.
    Route::apiResource('device-terminals', \App\Http\Controllers\Api\DeviceTerminalController::class)
        ->only(['index', 'store', 'update', 'destroy']);


    Route::get('/modules', [PermissionController::class, 'modules']);
    Route::get('/permissions/users', [PermissionController::class, 'manageableUsers']);
    Route::get('/permissions/user/{userId}', [PermissionController::class, 'getUserPermissions']);
    Route::post('/permissions/user/{userId}', [PermissionController::class, 'savePermissions']);
    Route::get('/permissions/department/{departmentId}', [PermissionController::class, 'getDepartmentPermissions']);
    Route::post('/permissions/department/{departmentId}', [PermissionController::class, 'saveDepartmentPermissions']);

   
    Route::get ('/settings',                          [SettingsController::class, 'index']);
    Route::put ('/settings/{section}',                [SettingsController::class, 'update']);
    Route::post('/settings/appearance/asset',         [SettingsController::class, 'uploadAsset']);
});


Route::get('/payments/{payment}/invoice/download', [PaymentController::class, 'downloadInvoice']);
Route::get('/payments/{payment}/invoice/view', [PaymentController::class, 'viewInvoice']);


Route::get('/candidates/{candidate}/cv', [CandidateController::class, 'downloadCv'])
    ->name('candidates.cv');


Route::get('/expense-claims/{id}/attachments/{index}', [ExpenseClaimController::class, 'downloadAttachment'])
    ->name('expense-claims.attachment');

Route::get('/expense-claims/payments/{paymentId}/proof', [ExpenseClaimController::class, 'downloadPaymentProof'])
    ->name('expense-claims.payment-proof');

// Batch-payment proof — opened as a new-tab link, so it authenticates via
// ?token= inside the controller (batchPaymentProof) rather than the
// auth:sanctum middleware. Must stay outside the authenticated group.
Route::get('/expense-claims/batch-payments/{batchId}/proof', [ExpenseClaimController::class, 'batchPaymentProof'])
    ->name('expense-claims.batch-payment-proof');


Route::get('/advance-requests/{id}/attachments/{index}', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'downloadAttachment'])
    ->name('advance-requests.attachment');
Route::get('/advance-requests/payments/{paymentId}/proof', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'paymentProof'])
    ->name('advance-requests.payment-proof');
Route::get('/advance-requests/{id}/settle-proof/{index}', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'settleProof'])
    ->name('advance-requests.settle-proof');
// DISABLED (kept for later re-enable) — proof server for one-time recovery pay-offs.
// Route::get('/advance-requests/{id}/recovery-payment-proof/{index}', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'recoveryPaymentProof'])
//     ->name('advance-requests.recovery-payment-proof');
Route::get('/advance-requests/{id}/return-proof/{index}', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'returnProof'])
    ->name('advance-requests.return-proof');

// SECURITY: the public unauthenticated `dummy-items` CRUD scaffold was removed
// (it exposed read/create/update/delete with no auth or tenant scope). It is not
// referenced by the frontend. Re-add behind auth:sanctum if a test fixture needs it.
