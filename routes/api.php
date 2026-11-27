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
use App\Http\Controllers\Api\EmailController;
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
use App\Http\Controllers\Api\CredVault\CredVaultController;
use App\Http\Controllers\Api\CredVault\CriticalVault\AccessRequestController as CvAccessRequestController;
use App\Http\Controllers\Api\CredVault\CriticalVault\CriticalVaultController;
use App\Http\Controllers\Api\CredVault\CriticalVault\TwoStepController as CvTwoStepController;
use App\Http\Controllers\Api\CredVault\NormalVault\NormalVaultController;
use App\Http\Controllers\Api\Inventory\ProductFlagController;
use App\Http\Controllers\Api\Inventory\RackController;
use App\Http\Controllers\Api\Inventory\ShelfController;
use App\Http\Controllers\Api\Inventory\WarehouseController;
use App\Http\Controllers\Api\Inventory\ZoneController;
use App\Http\Controllers\Api\P2p\PoPaymentRequestController;
use App\Http\Controllers\Api\P2p\SpiBoxController;
use App\Http\Controllers\Api\P2p\SpiPutawayAllocationController;
use App\Http\Controllers\Api\P2p\SpiPutawayController;
use App\Http\Controllers\Api\P2p\SpiPutawayTaskController;
use App\Http\Controllers\Api\P2p\SupplierInvoiceController;
use Illuminate\Support\Facades\Route;

Route::middleware('throttle:30,1')->group(function () {
    Route::get ('/onboarding/{token}',          [OnboardingController::class, 'show']);
    Route::post('/onboarding/{token}/complete', [OnboardingController::class, 'complete']);
});

Route::middleware('throttle:20,1')->group(function () {
    Route::post('/login', [AuthController::class, 'login']);
    Route::post('/login/face', [AuthController::class, 'faceLogin']);
    Route::post('/google-login', [AuthController::class, 'googleLogin']);
    Route::post('/forgot-password/send-otp', [ForgotPasswordController::class, 'sendOtp']);
    Route::post('/forgot-password/verify-otp', [ForgotPasswordController::class, 'verifyOtp']);
    Route::post('/forgot-password/reset', [ForgotPasswordController::class, 'resetPassword']);
});
Route::post('/razorpay/webhook', [RazorpayWebhookController::class, 'handle']);

Route::middleware('throttle:60,1')->post('/scan/device-check', [\App\Http\Controllers\Api\ScanDeviceController::class, 'check']);

Route::middleware('throttle:120,1')->prefix('scan/putaway')->group(function () {
    Route::post('/session',         [\App\Http\Controllers\Api\P2p\SpiPutawayScanController::class, 'session']);
    Route::post('/scan',            [\App\Http\Controllers\Api\P2p\SpiPutawayScanController::class, 'scan']);
    Route::get ('/{task}/boxes',    [\App\Http\Controllers\Api\P2p\SpiPutawayScanController::class, 'spiBoxes'])->whereNumber('task');
    Route::get ('/{task}',          [\App\Http\Controllers\Api\P2p\SpiPutawayScanController::class, 'show'])->whereNumber('task');
    Route::post('/{task}/confirm',  [\App\Http\Controllers\Api\P2p\SpiPutawayScanController::class, 'confirm'])->whereNumber('task');
    Route::post('/{task}/complete', [\App\Http\Controllers\Api\P2p\SpiPutawayScanController::class, 'complete'])->whereNumber('task');
    Route::post('/{task}/release',  [\App\Http\Controllers\Api\P2p\SpiPutawayScanController::class, 'release'])->whereNumber('task');
});

Route::get('/sales/quotations/{id}/view',        [SalesPdfController::class, 'publicViewQuotation'])
    ->middleware(['signed', 'tenant.document:quotations'])
    ->name('sales.quotation.view');
Route::get('/sales/proforma-invoices/{id}/view', [SalesPdfController::class, 'publicViewProformaInvoice'])
    ->middleware(['signed', 'tenant.document:proforma_invoices'])
    ->name('sales.pi.view');

Route::get('/announcements/{id}/attachment',     [AnnouncementController::class, 'attachment'])
    ->middleware('signed')
    ->whereNumber('id')
    ->name('announcements.attachment');

Route::get('/dev/mail-preview/{template}', [\App\Http\Controllers\Api\DevToolsController::class, 'mailPreview']);

Route::get('/p2p/spi/sticker-preview', [SpiBoxController::class, 'stickerPreview']);

Route::middleware(['auth:sanctum', 'user.active', 'tenant'])->group(function () {
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/change-password', [AuthController::class, 'changePassword']);
    Route::post('/me/branding', [AuthController::class, 'updateBranding']);
    Route::post('/me/profile', [AuthController::class, 'updateProfile']);

    Route::get('/backup/email/status', [BackupController::class, 'status']);
    Route::post('/backup/email/send',  [BackupController::class, 'send']);

    Route::get('/dashboard/admin-stats',    [DashboardController::class, 'adminStats']);
    Route::get('/dashboard/client-stats',   [DashboardController::class, 'clientStats']);
    Route::get('/dashboard/employee-stats', [DashboardController::class, 'employeeStats']);

    Route::get('/clients/stats', [ClientController::class, 'stats']);

    Route::get('/clients/form-bundle', [ClientController::class, 'formBundle']);
    Route::apiResource('clients', ClientController::class);

    Route::get('/branches/next-code', [BranchController::class, 'nextCode']);

    Route::get('/branch-shifts', [BranchController::class, 'shiftOptions']);

    Route::get('/branch-legal-entities', [BranchController::class, 'legalEntityOptions']);

    Route::get('/clm/ctc-organisations', [BranchController::class, 'ctcOrganisationOptions']);

    Route::get('/branches/form-bundle', [BranchController::class, 'formBundle']);
    Route::apiResource('branches', BranchController::class);

    Route::get('/products/stats',                [ProductController::class, 'stats']);
    Route::get('/products/owners',               [ProductController::class, 'owners']);

    Route::get('/products/master-bundle',        [ProductController::class, 'masterBundle']);
    Route::get('/products',                      [ProductController::class, 'index']);
    Route::get('/products/{id}',                 [ProductController::class, 'show'])->whereNumber('id');
    Route::get('/products/{id}/usage',           [ProductController::class, 'usage'])->whereNumber('id');
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
    Route::get   ('/vendors/{id}/product-mappings',    [\App\Http\Controllers\Api\VendorController::class, 'productMappings'])->whereNumber('id');
    Route::post  ('/vendors/step/identity',            [\App\Http\Controllers\Api\VendorController::class, 'storeIdentity']);
    Route::put   ('/vendors/{id}/step/contacts',       [\App\Http\Controllers\Api\VendorController::class, 'storeContacts'])->whereNumber('id');
    Route::post  ('/vendors/{id}/contacts',            [\App\Http\Controllers\Api\VendorController::class, 'storeContact'])->whereNumber('id');
    Route::put   ('/vendors/{id}/contacts/{contact}',  [\App\Http\Controllers\Api\VendorController::class, 'updateContact'])->whereNumber('id')->whereNumber('contact');
    Route::delete('/vendors/{id}/contacts/{contact}',  [\App\Http\Controllers\Api\VendorController::class, 'destroyContact'])->whereNumber('id')->whereNumber('contact');
    Route::post  ('/vendors/{id}/bank-accounts',           [\App\Http\Controllers\Api\VendorController::class, 'storeBankAccount'])->whereNumber('id');
    Route::put   ('/vendors/{id}/bank-accounts/{bank}',    [\App\Http\Controllers\Api\VendorController::class, 'updateBankAccount'])->whereNumber('id')->whereNumber('bank');
    Route::delete('/vendors/{id}/bank-accounts/{bank}',    [\App\Http\Controllers\Api\VendorController::class, 'destroyBankAccount'])->whereNumber('id')->whereNumber('bank');
    Route::post  ('/vendors/{id}/gst-scrutiny',            [\App\Http\Controllers\Api\VendorController::class, 'storeGstScrutiny'])->whereNumber('id');
    Route::put   ('/vendors/{id}/gst-scrutiny/{gst}',      [\App\Http\Controllers\Api\VendorController::class, 'updateGstScrutiny'])->whereNumber('id')->whereNumber('gst');
    Route::delete('/vendors/{id}/gst-scrutiny/{gst}',      [\App\Http\Controllers\Api\VendorController::class, 'destroyGstScrutiny'])->whereNumber('id')->whereNumber('gst');
    Route::post  ('/vendors/{id}/step/kyc',            [\App\Http\Controllers\Api\VendorController::class, 'storeKyc'])->whereNumber('id');
    Route::post  ('/vendors/{id}/step/products',       [\App\Http\Controllers\Api\VendorController::class, 'storeProducts'])->whereNumber('id');
    Route::get   ('/vendors/{id}/service-mappings',        [\App\Http\Controllers\Api\VendorController::class, 'serviceMappings'])->whereNumber('id');
    Route::post  ('/vendors/{id}/step/services',           [\App\Http\Controllers\Api\VendorController::class, 'storeServices'])->whereNumber('id');
    Route::patch ('/vendors/{id}/service-mappings/{map}',  [\App\Http\Controllers\Api\VendorController::class, 'updateServiceMapping'])->whereNumber('id')->whereNumber('map');
    Route::delete('/vendors/{id}/service-mappings/{map}',  [\App\Http\Controllers\Api\VendorController::class, 'destroyServiceMapping'])->whereNumber('id')->whereNumber('map');
    Route::delete('/vendors/{id}',                     [\App\Http\Controllers\Api\VendorController::class, 'destroy'])->whereNumber('id');

    Route::apiResource('plans', PlanController::class);

    Route::get   ('/customers/master-bundle',          [CustomerController::class, 'masterBundle']);
    Route::get   ('/customers/gst-available',          [CustomerController::class, 'gstAvailable']);
    Route::apiResource('customers', CustomerController::class)
        ->only(['index', 'show', 'store', 'update', 'destroy']);

    Route::get   ('/customers/{customer}/gst-scrutiny',          [CustomerController::class, 'indexGstScrutiny']);
    Route::post  ('/customers/{customer}/gst-scrutiny',          [CustomerController::class, 'storeGstScrutiny']);
    Route::put   ('/customers/{customer}/gst-scrutiny/{gst}',    [CustomerController::class, 'updateGstScrutiny']);
    Route::delete('/customers/{customer}/gst-scrutiny/{gst}',    [CustomerController::class, 'destroyGstScrutiny']);

    Route::get   ('/customers/{customer}/documents',           [\App\Http\Controllers\Api\CustomerDocumentController::class, 'index']);
    Route::post  ('/customers/{customer}/documents',           [\App\Http\Controllers\Api\CustomerDocumentController::class, 'store']);
    Route::get   ('/customers/{customer}/documents/{document}',[\App\Http\Controllers\Api\CustomerDocumentController::class, 'show']);
    Route::post  ('/customers/{customer}/documents/{document}',[\App\Http\Controllers\Api\CustomerDocumentController::class, 'update']);
    Route::put   ('/customers/{customer}/documents/{document}',[\App\Http\Controllers\Api\CustomerDocumentController::class, 'update']);
    Route::delete('/customers/{customer}/documents/{document}',[\App\Http\Controllers\Api\CustomerDocumentController::class, 'destroy']);

    Route::apiResource('consignees', \App\Http\Controllers\Api\ConsigneeController::class)
        ->only(['index', 'show', 'store', 'update', 'destroy']);

    Route::post('/consignees/{consignee}/clone-from-customer',
        [\App\Http\Controllers\Api\ConsigneeController::class, 'cloneFromCustomer']);

    Route::post('/consignees/{consignee}/map-customer',
        [\App\Http\Controllers\Api\ConsigneeController::class, 'mapCustomer']);

    Route::get   ('/consignees/{consignee}/documents',           [\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'index']);
    Route::post  ('/consignees/{consignee}/documents',           [\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'store']);
    Route::get   ('/consignees/{consignee}/documents/{document}',[\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'show']);
    Route::post  ('/consignees/{consignee}/documents/{document}',[\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'update']);
    Route::put   ('/consignees/{consignee}/documents/{document}',[\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'update']);
    Route::delete('/consignees/{consignee}/documents/{document}',[\App\Http\Controllers\Api\ConsigneeDocumentController::class, 'destroy']);

    Route::get   ('/consignees/{consignee}/owners',          [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'index']);
    Route::post  ('/consignees/{consignee}/owners',          [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'store']);
    Route::get   ('/consignees/{consignee}/owners/{owner}',  [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'show']);
    Route::post  ('/consignees/{consignee}/owners/{owner}',  [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'update']);
    Route::put   ('/consignees/{consignee}/owners/{owner}',  [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'update']);
    Route::delete('/consignees/{consignee}/owners/{owner}',  [\App\Http\Controllers\Api\ConsigneeOwnerController::class, 'destroy']);

    Route::get   ('/customers/{customer}/owners',          [\App\Http\Controllers\Api\CustomerOwnerController::class, 'index']);
    Route::post  ('/customers/{customer}/owners',          [\App\Http\Controllers\Api\CustomerOwnerController::class, 'store']);
    Route::get   ('/customers/{customer}/owners/{owner}',  [\App\Http\Controllers\Api\CustomerOwnerController::class, 'show']);
    Route::post  ('/customers/{customer}/owners/{owner}',  [\App\Http\Controllers\Api\CustomerOwnerController::class, 'update']);
    Route::put   ('/customers/{customer}/owners/{owner}',  [\App\Http\Controllers\Api\CustomerOwnerController::class, 'update']);
    Route::delete('/customers/{customer}/owners/{owner}',  [\App\Http\Controllers\Api\CustomerOwnerController::class, 'destroy']);

    Route::get   ('/clm/segments',      [ClmSegmentController::class, 'index']);
    Route::post  ('/clm/segments',      [ClmSegmentController::class, 'store']);
    Route::put   ('/clm/segments/{id}', [ClmSegmentController::class, 'update']);
    Route::delete('/clm/segments/{id}', [ClmSegmentController::class, 'destroy']);

    Route::get   ('/clm/authorities',      [ClmAuthorityController::class, 'index']);
    Route::post  ('/clm/authorities',      [ClmAuthorityController::class, 'store']);
    Route::post  ('/clm/authorities/import', [ClmAuthorityController::class, 'import']);
    Route::put   ('/clm/authorities/{id}', [ClmAuthorityController::class, 'update']);
    Route::delete('/clm/authorities/{id}', [ClmAuthorityController::class, 'destroy']);

    Route::get   ('/clm/kyc-documents',      [ClmKycController::class, 'index']);
    Route::post  ('/clm/kyc-documents',      [ClmKycController::class, 'store']);
    Route::post  ('/clm/kyc-documents/import', [ClmKycController::class, 'import']);
    Route::put   ('/clm/kyc-documents/{id}', [ClmKycController::class, 'update']);
    Route::delete('/clm/kyc-documents/{id}', [ClmKycController::class, 'destroy']);

    Route::get   ('/clm/dd-documents',      [ClmDdController::class, 'index']);
    Route::post  ('/clm/dd-documents',      [ClmDdController::class, 'store']);
    Route::post  ('/clm/dd-documents/import', [ClmDdController::class, 'import']);
    Route::put   ('/clm/dd-documents/{id}', [ClmDdController::class, 'update']);
    Route::delete('/clm/dd-documents/{id}', [ClmDdController::class, 'destroy']);

    Route::get   ('/clm/trade-licenses',      [ClmTradeLicenseController::class, 'index']);
    Route::post  ('/clm/trade-licenses',      [ClmTradeLicenseController::class, 'store']);
    Route::post  ('/clm/trade-licenses/import', [ClmTradeLicenseController::class, 'import']);
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
    Route::post  ('/clm/trade-doc-library/preview-live',      [ClmTradeDocumentController::class, 'previewLive']);
    Route::get   ('/clm/trade-doc-library/for-party/{party}', [ClmTradeDocumentController::class, 'libraryForParty']);

    Route::get   ('/clm/trade-doc-library/{id}',              [ClmTradeDocumentController::class, 'libraryShow'])->whereNumber('id');
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
    Route::get   ('/clm/tnc-global',       [ClmTncController::class, 'globalIndex']);
    Route::put   ('/clm/tnc-global',       [ClmTncController::class, 'globalSave']);

    Route::get   ('/clm/agreement-types',      [ClmAgreementController::class, 'typesIndex']);
    Route::post  ('/clm/agreement-types',      [ClmAgreementController::class, 'typesStore']);
    Route::put   ('/clm/agreement-types/{id}', [ClmAgreementController::class, 'typesUpdate']);
    Route::delete('/clm/agreement-types/{id}', [ClmAgreementController::class, 'typesDestroy']);
    Route::get   ('/clm/agreement-library',      [ClmAgreementController::class, 'libraryIndex']);
    Route::get   ('/clm/agreement-library/for-party/{party}', [ClmAgreementController::class, 'libraryForParty']);
    Route::get   ('/clm/agreement-library/{id}', [ClmAgreementController::class, 'libraryShow'])->whereNumber('id');
    Route::post  ('/clm/agreement-library',      [ClmAgreementController::class, 'libraryStore']);
    Route::post  ('/clm/agreement-library/preview-live', [ClmAgreementController::class, 'previewLive']);
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
    Route::get   ('/p2p/new-suppliers/{supplier}/convert',   [\App\Http\Controllers\Api\P2p\SourcingController::class, 'convertPrefill'])->whereNumber('supplier');
    Route::post  ('/p2p/new-suppliers/{supplier}/convert',   [\App\Http\Controllers\Api\P2p\SourcingController::class, 'convertSupplier'])->whereNumber('supplier');
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
    Route::patch ('/p2p/sourcing-targets/{target}/products/{product}/suppliers/{supplier}/price', [\App\Http\Controllers\Api\P2p\SourcingController::class, 'updateSupplierPrice'])->whereNumber('product')->whereNumber('supplier');

    Route::prefix('p2p/services')->group(function () {
        $svc = \App\Http\Controllers\Api\P2p\ServiceController::class;
        Route::get   ('/master-bundle',               [$svc, 'masterBundle']);
        Route::get   ('/supplier-pool',               [$svc, 'supplierPool']);
        Route::get   ('/stats',                       [$svc, 'stats']);
        Route::get   ('/next-code',                   [$svc, 'nextCodePreview']);
        Route::get   ('/',                            [$svc, 'index']);
        Route::post  ('/step/core',                   [$svc, 'storeCore']);
        Route::get   ('/{id}',                        [$svc, 'show'])->whereNumber('id');
        Route::put   ('/{id}/step/suppliers',         [$svc, 'storeSuppliers'])->whereNumber('id');
        Route::get   ('/{id}/suppliers',              [$svc, 'suppliers'])->whereNumber('id');
        Route::post  ('/{id}/suppliers',              [$svc, 'storeSupplier'])->whereNumber('id');
        Route::patch ('/{id}/suppliers/{map}',        [$svc, 'updateSupplier'])->whereNumber('id')->whereNumber('map');
        Route::patch ('/{id}/suppliers/{map}/status', [$svc, 'updateSupplierStatus'])->whereNumber('id')->whereNumber('map');
        Route::patch ('/{id}/status',                 [$svc, 'updateStatus'])->whereNumber('id');
    });
    Route::prefix('p2p/orders')->group(function () {
        $po  = \App\Http\Controllers\Api\P2p\PurchaseOrderController::class;
        $doc = \App\Http\Controllers\Api\P2p\PurchaseOrderDocumentController::class;
        $ins = \App\Http\Controllers\Api\P2p\PurchaseOrderInspectionController::class;

        $lk = \App\Http\Controllers\Api\P2p\PoLookupController::class;
        Route::get   ('/suppliers',                      [$lk, 'suppliers']);
        Route::get   ('/suppliers/{id}',                 [$lk, 'supplier'])->whereNumber('id');
        Route::get   ('/shipments',                      [$lk, 'shipments']);
        Route::get   ('/next-code',                      [$po, 'nextCode']);
        Route::get   ('/shipments/{shipment}/pi-lines',  [$po, 'piLines'])->whereNumber('shipment');

        Route::get   ('/',                               [$po, 'index']);
        Route::post  ('/',                               [$po, 'store']);
        Route::get   ('/{id}',                           [$po, 'show'])->whereNumber('id');
        Route::put   ('/{id}/stage-1',                   [$po, 'updateStage1'])->whereNumber('id');
        Route::put   ('/{id}/items',                     [$po, 'updateItems'])->whereNumber('id');
        Route::put   ('/{id}/terms',                     [$po, 'updateTerms'])->whereNumber('id');
        Route::get   ('/{id}/qty-history',               [$po, 'qtyHistory'])->whereNumber('id');
        $pay = \App\Http\Controllers\Api\P2p\PoPaymentRequestController::class;
        Route::get   ('/payment-requests',                              [$pay, 'index']);
        Route::get   ('/payment-requests/{req}',                        [$pay, 'show'])->whereNumber('req');
        Route::put   ('/payment-requests/decisions',                    [$pay, 'decideMany']);
        Route::put   ('/payment-requests/{req}/decision',               [$pay, 'decide'])->whereNumber('req');
        Route::get   ('/{po}/payment-requests',                         [$pay, 'forPo'])->whereNumber('po');
        Route::post  ('/{po}/payment-requests',                         [$pay, 'store'])->whereNumber('po');
        Route::put   ('/{po}/tds',                                      [$pay, 'saveTds'])->whereNumber('po');
        Route::get   ('/{po}/payment-requests/{req}/payments',          [$pay, 'payments'])->whereNumber('po')->whereNumber('req');
        Route::post  ('/{po}/payment-requests/{req}/payments',          [$pay, 'storePayment'])->whereNumber('po')->whereNumber('req');
        Route::post  ('/{po}/payment-requests/{req}/payments/{payment}', [$pay, 'updatePayment'])->whereNumber('po')->whereNumber('req')->whereNumber('payment');
        Route::delete('/{po}/payment-requests/{req}/payments/{payment}', [$pay, 'destroyPayment'])->whereNumber('po')->whereNumber('req')->whereNumber('payment');
        Route::post  ('/{po}/payment-requests/{req}/payments/{payment}/zoho-sync', [$pay, 'zohoSyncPayment'])->whereNumber('po')->whereNumber('req')->whereNumber('payment');

        $gap = \App\Http\Controllers\Api\P2p\PoGstApprovalController::class;
        Route::post  ('/{id}/gst-approval/request',      [$gap, 'store'])->whereNumber('id');
        Route::get   ('/gst-approvals/approvers',        [$gap, 'approvers']);
        Route::get   ('/gst-approvals',                  [$gap, 'index']);
        Route::get   ('/gst-approvals/{approval}',       [$gap, 'show'])->whereNumber('approval');
        Route::put   ('/gst-approvals/{approval}',       [$gap, 'decide'])->whereNumber('approval');
        Route::post  ('/{id}/cancel',                    [$po, 'cancel'])->whereNumber('id');
        Route::post  ('/{id}/zoho-sync',                 [$po, 'zohoSync'])->whereNumber('id');
        Route::get   ('/{id}/zoho-tracker',              [$po, 'zohoTracker'])->whereNumber('id');
        Route::get   ('/{id}/proofs',                    [$po, 'proofs'])->whereNumber('id');

        $adr = \App\Http\Controllers\Api\P2p\PoRefundAdjustmentController::class;
        Route::get   ('/refund-adjustments',                               [$adr, 'index']);
        Route::get   ('/refund-adjustments/eligible-pos',                  [$adr, 'eligiblePos']);
        Route::get   ('/refund-adjustments/po/{po}',                       [$adr, 'forPo'])->whereNumber('po');
        Route::post  ('/refund-adjustments',                               [$adr, 'store']);
        Route::get   ('/refund-adjustments/{id}',                          [$adr, 'show'])->whereNumber('id');
        Route::post  ('/refund-adjustments/{id}',                          [$adr, 'update'])->whereNumber('id');
        Route::post  ('/refund-adjustments/{id}/zoho-sync',                [$adr, 'zohoSync'])->whereNumber('id');
        Route::get   ('/refund-adjustments/{id}/pdf',                      [$adr, 'pdf'])->whereNumber('id');
        Route::post  ('/refund-adjustments/{id}/recoveries',               [$adr, 'storeRecovery'])->whereNumber('id');
        Route::post  ('/refund-adjustments/{id}/recoveries/{rec}',         [$adr, 'updateRecovery'])->whereNumber('id')->whereNumber('rec');
        Route::delete('/refund-adjustments/{id}/recoveries/{rec}',         [$adr, 'destroyRecovery'])->whereNumber('id')->whereNumber('rec');
        Route::post  ('/refund-adjustments/{id}/recoveries/{rec}/zoho-sync', [$adr, 'zohoSyncRecovery'])->whereNumber('id')->whereNumber('rec');
        Route::delete('/{id}',                           [$po, 'destroy'])->whereNumber('id');

        Route::get   ('/{po}/documents',                 [$doc, 'index'])->whereNumber('po');
        Route::get   ('/{po}/evidence-vault',            [$doc, 'evidenceVault'])->whereNumber('po');
        Route::post  ('/{po}/documents/needs',           [$doc, 'setNeeds'])->whereNumber('po');
        Route::post  ('/{po}/documents/mark-sent',       [$doc, 'markSent'])->whereNumber('po');
        Route::post  ('/{po}/documents',                 [$doc, 'store'])->whereNumber('po');
        Route::post  ('/{po}/documents/{doc}/file',      [$doc, 'uploadFile'])->whereNumber('po')->whereNumber('doc');
        Route::patch ('/{po}/documents/{doc}/status',    [$doc, 'updateStatus'])->whereNumber('po')->whereNumber('doc');
        Route::get   ('/{po}/documents/{doc}/download',  [$doc, 'download'])->whereNumber('po')->whereNumber('doc');
        Route::post  ('/{po}/documents/sign',                 [$doc, 'sign'])->whereNumber('po');
        Route::post  ('/{po}/documents/email',                [$doc, 'email'])->whereNumber('po');
        Route::post  ('/{po}/documents/{doc}/generate',       [$doc, 'generate'])->whereNumber('po')->whereNumber('doc');
        Route::delete('/{po}/documents/{doc}',           [$doc, 'destroy'])->whereNumber('po')->whereNumber('doc');

        Route::get   ('/{po}/inspection',                [$ins, 'show'])->whereNumber('po');
        Route::post  ('/{po}/inspection/lines/{item}',   [$ins, 'updateLine'])->whereNumber('po')->whereNumber('item');
        Route::delete('/{po}/inspection/lines/{item}/files/{index}', [$ins, 'removeFile'])->whereNumber('po')->whereNumber('item')->whereNumber('index');
        Route::get   ('/{po}/inspection/files/{index}',  [$ins, 'downloadNoteFile'])->whereNumber('po')->whereNumber('index');
        Route::get   ('/{po}/inspection/lines/{item}/files/{index}', [$ins, 'downloadLineFile'])->whereNumber('po')->whereNumber('item')->whereNumber('index');
        Route::post  ('/{po}/inspection/sign-off',       [$ins, 'signOff'])->whereNumber('po');
        Route::post  ('/{po}/inspection/withdraw',       [$ins, 'withdraw'])->whereNumber('po');
    });

    Route::prefix('p2p/spi')->group(function () {
        Route::get   ('/next-code',         [SupplierInvoiceController::class, 'nextCode']);
        Route::get   ('/orders/{po}/lines', [SupplierInvoiceController::class, 'poLines'])->whereNumber('po');

        Route::get   ('/',             [SupplierInvoiceController::class, 'index']);
        Route::post  ('/',             [SupplierInvoiceController::class, 'store']);
        Route::get   ('/{id}',         [SupplierInvoiceController::class, 'show'])->whereNumber('id');
        Route::put   ('/{id}/stage-1', [SupplierInvoiceController::class, 'updateStage1'])->whereNumber('id');
        Route::post  ('/{id}/gst-approval/request', [\App\Http\Controllers\Api\P2p\PoGstApprovalController::class, 'storeForInvoice'])->whereNumber('id');
        Route::get   ('/{id}/gst-approvals',        [\App\Http\Controllers\Api\P2p\PoGstApprovalController::class, 'indexForInvoice'])->whereNumber('id');
        Route::post  ('/{id}/items',   [SupplierInvoiceController::class, 'updateItems'])->whereNumber('id');
        Route::put   ('/{id}/submit',  [SupplierInvoiceController::class, 'submit'])->whereNumber('id');
        Route::delete('/{id}',         [SupplierInvoiceController::class, 'destroy'])->whereNumber('id');

        Route::get   ('/{id}/boxes',               [SpiBoxController::class, 'index'])->whereNumber('id');
        Route::get   ('/{id}/boxes/next-codes',    [SpiBoxController::class, 'nextCodes'])->whereNumber('id');
        Route::get   ('/{id}/packing-summary',     [SpiBoxController::class, 'packingSummary'])->whereNumber('id');
        Route::get   ('/{id}/summary',             [SupplierInvoiceController::class, 'summary'])->whereNumber('id');
        Route::get   ('/{id}/packed-boxes',        [SupplierInvoiceController::class, 'packedBoxes'])->whereNumber('id');
        Route::get   ('/{id}/evidence-vault',      [SupplierInvoiceController::class, 'evidenceVault'])->whereNumber('id');
        Route::get   ('/{id}/boxes/{box}',         [SpiBoxController::class, 'show'])->whereNumber('id')->whereNumber('box');
        Route::post  ('/{id}/boxes',               [SpiBoxController::class, 'store'])->whereNumber('id');
        Route::put   ('/{id}/boxes/{box}',         [SpiBoxController::class, 'update'])->whereNumber('id')->whereNumber('box');
        Route::post  ('/{id}/boxes/{box}',         [SpiBoxController::class, 'update'])->whereNumber('id')->whereNumber('box');
        Route::delete('/{id}/boxes/{box}/attachments/{attachment}', [SpiBoxController::class, 'destroyAttachment'])
            ->whereNumber('id')->whereNumber('box')->whereNumber('attachment');
        Route::put   ('/{id}/stage-3',             [SupplierInvoiceController::class, 'completeStage3'])->whereNumber('id');
        Route::delete('/{id}/boxes/{box}',         [SpiBoxController::class, 'destroy'])->whereNumber('id')->whereNumber('box');
        Route::post  ('/{id}/boxes/{box}/sticker', [SpiBoxController::class, 'printSticker'])->whereNumber('id')->whereNumber('box');
        Route::get   ('/{id}/boxes/{box}/sticker/download', [SpiBoxController::class, 'downloadSticker'])->whereNumber('id')->whereNumber('box');

        Route::get   ('/{id}/putaway',               [SpiPutawayController::class, 'index'])->whereNumber('id');
        Route::put   ('/{id}/storage-type',          [SpiPutawayController::class, 'setStorageType'])->whereNumber('id');
        Route::get   ('/{id}/warehouse-eligibility', [SpiPutawayController::class, 'warehouseEligibility'])->whereNumber('id');
        Route::post  ('/{id}/putaway/scan',          [SpiPutawayController::class, 'scan'])->whereNumber('id');
        Route::put   ('/{id}/putaway/{row}/confirm', [SpiPutawayController::class, 'confirm'])->whereNumber('id')->whereNumber('row');

        Route::get   ('/{id}/putaway/board',         [SpiPutawayAllocationController::class, 'board'])->whereNumber('id');
        Route::get   ('/{id}/putaway/locations',     [SpiPutawayAllocationController::class, 'locations'])->whereNumber('id');
        Route::post  ('/{id}/putaway/assign',        [SpiPutawayAllocationController::class, 'assign'])->whereNumber('id');
        Route::post  ('/{id}/putaway/{row}/confirm-manual', [SpiPutawayAllocationController::class, 'confirmManual'])->whereNumber('id')->whereNumber('row');
        Route::post  ('/{id}/putaway/{row}/scan-task',      [SpiPutawayTaskController::class, 'store'])->whereNumber('id')->whereNumber('row');
        Route::get   ('/{id}/putaway/tasks',                [SpiPutawayTaskController::class, 'index'])->whereNumber('id');
        Route::get   ('/{id}/putaway/boxes/{box}/activity', [SpiPutawayTaskController::class, 'boxActivity'])->whereNumber('id')->whereNumber('box');

        Route::get   ('/{id}/payment-requests', [SupplierInvoiceController::class, 'paymentRequests'])->whereNumber('id');
        Route::put   ('/{id}/tds',                              [PoPaymentRequestController::class, 'saveTdsForSpi'])->whereNumber('id');
        Route::post  ('/{id}/payment-requests',                  [PoPaymentRequestController::class, 'storeFromSpi'])->whereNumber('id');
        Route::post  ('/{id}/payment-requests/{req}/payments',   [PoPaymentRequestController::class, 'storePaymentFromSpi'])
            ->whereNumber('id')->whereNumber('req');
        Route::post  ('/{id}/payment-requests/{req}/payments/{payment}', [PoPaymentRequestController::class, 'updatePaymentFromSpi'])
            ->whereNumber('id')->whereNumber('req')->whereNumber('payment');
        Route::delete('/{id}/payment-requests/{req}/payments/{payment}', [PoPaymentRequestController::class, 'destroyPaymentFromSpi'])
            ->whereNumber('id')->whereNumber('req')->whereNumber('payment');

        Route::post  ('/{id}/zoho-sync',    [SupplierInvoiceController::class, 'zohoSync'])->whereNumber('id');
        Route::get   ('/{id}/zoho-tracker', [SupplierInvoiceController::class, 'zohoTracker'])->whereNumber('id');
    });

    Route::prefix('inventory')->group(function () {
        Route::get   ('/warehouses',               [WarehouseController::class, 'index']);
        Route::get   ('/warehouses/options',       [WarehouseController::class, 'options']);
        Route::get   ('/warehouses/next-code',     [WarehouseController::class, 'nextCode']);
        Route::post  ('/warehouses',               [WarehouseController::class, 'store']);
        Route::get   ('/warehouses/{id}',          [WarehouseController::class, 'show'])->whereNumber('id');
        Route::get   ('/warehouses/{id}/qr',       [WarehouseController::class, 'qrImage'])->whereNumber('id');
        Route::get   ('/warehouses/{id}/card',     [WarehouseController::class, 'card'])->whereNumber('id');
        Route::get   ('/warehouses/{id}/preview',    [WarehouseController::class, 'preview'])->whereNumber('id');
        Route::get   ('/warehouses/{id}/label',    [WarehouseController::class, 'label'])->whereNumber('id');
        Route::post  ('/warehouses/{id}',          [WarehouseController::class, 'update'])->whereNumber('id');
        Route::put   ('/warehouses/{id}/status',   [WarehouseController::class, 'setStatus'])->whereNumber('id');
        Route::delete('/warehouses/{id}',          [WarehouseController::class, 'destroy'])->whereNumber('id');

        Route::get   ('/zones',                    [ZoneController::class, 'index']);
        Route::get   ('/zones/options',            [ZoneController::class, 'options']);
        Route::get   ('/zones/next-code',          [ZoneController::class, 'nextCode']);
        Route::post  ('/zones',                    [ZoneController::class, 'store']);
        Route::get   ('/zones/{id}',               [ZoneController::class, 'show'])->whereNumber('id');
        Route::get   ('/zones/{id}/qr',            [ZoneController::class, 'qrImage'])->whereNumber('id');
        Route::get   ('/zones/{id}/preview',         [ZoneController::class, 'preview'])->whereNumber('id');
        Route::get   ('/zones/{id}/label',         [ZoneController::class, 'label'])->whereNumber('id');
        Route::put   ('/zones/{id}',               [ZoneController::class, 'update'])->whereNumber('id');
        Route::put   ('/zones/{id}/status',        [ZoneController::class, 'setStatus'])->whereNumber('id');
        Route::delete('/zones/{id}',               [ZoneController::class, 'destroy'])->whereNumber('id');

        Route::get   ('/racks',                    [RackController::class, 'index']);
        Route::get   ('/racks/options',            [RackController::class, 'options']);
        Route::get   ('/racks/next-code',          [RackController::class, 'nextCode']);
        Route::post  ('/racks',                    [RackController::class, 'store']);
        Route::get   ('/racks/{id}',               [RackController::class, 'show'])->whereNumber('id');
        Route::get   ('/racks/{id}/qr',            [RackController::class, 'qrImage'])->whereNumber('id');
        Route::get   ('/racks/{id}/preview',         [RackController::class, 'preview'])->whereNumber('id');
        Route::get   ('/racks/{id}/label',         [RackController::class, 'label'])->whereNumber('id');
        Route::put   ('/racks/{id}',               [RackController::class, 'update'])->whereNumber('id');
        Route::put   ('/racks/{id}/status',        [RackController::class, 'setStatus'])->whereNumber('id');
        Route::delete('/racks/{id}',               [RackController::class, 'destroy'])->whereNumber('id');

        Route::get   ('/racks/{rack}/shelves/next-code', [ShelfController::class, 'nextCode'])->whereNumber('rack');
        Route::get   ('/racks/{rack}/shelves',     [ShelfController::class, 'index'])->whereNumber('rack');
        Route::post  ('/racks/{rack}/shelves',     [ShelfController::class, 'store'])->whereNumber('rack');
        Route::get   ('/shelves/{id}',             [ShelfController::class, 'show'])->whereNumber('id');
        Route::get   ('/shelves/{id}/qr',          [ShelfController::class, 'qrImage'])->whereNumber('id');
        Route::get   ('/shelves/{id}/preview',       [ShelfController::class, 'preview'])->whereNumber('id');
        Route::get   ('/shelves/{id}/label',       [ShelfController::class, 'label'])->whereNumber('id');
        Route::put   ('/shelves/{id}',             [ShelfController::class, 'update'])->whereNumber('id');
        Route::put   ('/shelves/{id}/status',      [ShelfController::class, 'setStatus'])->whereNumber('id');
        Route::delete('/shelves/{id}',             [ShelfController::class, 'destroy'])->whereNumber('id');

        Route::get   ('/product-flags',            [ProductFlagController::class, 'index']);
        Route::get   ('/product-flags/options',    [ProductFlagController::class, 'options']);
        Route::get   ('/product-flags/next-code',  [ProductFlagController::class, 'nextCode']);
        Route::post  ('/product-flags',            [ProductFlagController::class, 'store']);
        Route::get   ('/product-flags/{id}',       [ProductFlagController::class, 'show'])->whereNumber('id');
        Route::put   ('/product-flags/{id}',       [ProductFlagController::class, 'update'])->whereNumber('id');
        Route::put   ('/product-flags/{id}/status',[ProductFlagController::class, 'setStatus'])->whereNumber('id');
        Route::delete('/product-flags/{id}',       [ProductFlagController::class, 'destroy'])->whereNumber('id');
    });

    Route::prefix('credvault')->middleware('throttle:credvault')->group(function () {
        Route::get   ('/meta',                              [CredVaultController::class, 'meta']);
        Route::get   ('/dashboard',                         [CredVaultController::class, 'dashboard']);
        Route::get   ('/dev/totp',                          [CredVaultController::class, 'devTotp']);
        Route::post  ('/generate-password',                 [CredVaultController::class, 'generatePassword']);
        Route::get   ('/generate-password/options',         [CredVaultController::class, 'generatorOptions']);

        Route::prefix('normal-vault')->group(function () {
            Route::get   ('/credentials',                   [NormalVaultController::class, 'index']);
            Route::get   ('/credentials/next-code',         [NormalVaultController::class, 'nextCredentialCode']);
            Route::post  ('/credentials',                   [NormalVaultController::class, 'store']);
            Route::put   ('/credentials/{id}',              [NormalVaultController::class, 'update'])->whereNumber('id');
            Route::post  ('/credentials/{id}',              [NormalVaultController::class, 'update'])->whereNumber('id');
            Route::delete('/credentials/{id}',              [NormalVaultController::class, 'destroy'])->whereNumber('id');
        });

        Route::prefix('critical-vault')->group(function () {
            Route::get   ('/credentials',                   [CriticalVaultController::class, 'index']);
            Route::get   ('/credentials/next-code',         [CriticalVaultController::class, 'nextCredentialCode']);
            Route::post  ('/credentials',                   [CriticalVaultController::class, 'store']);
            Route::put   ('/credentials/{id}',              [CriticalVaultController::class, 'update'])->whereNumber('id');
            Route::post  ('/credentials/{id}',              [CriticalVaultController::class, 'update'])->whereNumber('id');
            Route::delete('/credentials/{id}',              [CriticalVaultController::class, 'destroy'])->whereNumber('id');
            Route::get   ('/approvers',                     [CriticalVaultController::class, 'approvers']);

            Route::post  ('/two-step/google/new',           [CvTwoStepController::class, 'googleNew']);
            Route::post  ('/two-step/google/verify',        [CvTwoStepController::class, 'googleVerify'])->middleware('throttle:credvault-otp');
            Route::post  ('/two-step/email/send',           [CvTwoStepController::class, 'emailSend']);
            Route::post  ('/two-step/email/verify',         [CvTwoStepController::class, 'emailVerify'])->middleware('throttle:credvault-otp');

            Route::post  ('/credentials/{id}/access-requests', [CvAccessRequestController::class, 'requestAccess'])->whereNumber('id');
            Route::get   ('/access-requests',               [CvAccessRequestController::class, 'accessRequests']);
            Route::get   ('/access-requests/{id}',          [CvAccessRequestController::class, 'accessRequest'])->whereNumber('id');
            Route::post  ('/access-requests/{id}/approve',  [CvAccessRequestController::class, 'approveRequest'])->whereNumber('id');
            Route::post  ('/access-requests/{id}/raise-manager', [CvAccessRequestController::class, 'raiseManager'])->whereNumber('id');
            Route::post  ('/access-requests/{id}/reject',   [CvAccessRequestController::class, 'rejectRequest'])->whereNumber('id');
            Route::post  ('/access-requests/{id}/cancel',   [CvAccessRequestController::class, 'cancelRequest'])->whereNumber('id');
            Route::post  ('/access-requests/{id}/send-otp', [CvAccessRequestController::class, 'sendOtp'])->whereNumber('id');
            Route::post  ('/access-requests/{id}/verify-otp', [CvAccessRequestController::class, 'verifyOtp'])->whereNumber('id')->middleware('throttle:credvault-otp');
            Route::post  ('/access-requests/{id}/lock',     [CvAccessRequestController::class, 'lockRequest'])->whereNumber('id');
        });

        Route::get   ('/credentials',                       [CredVaultController::class, 'index']);
        Route::get   ('/credentials/{id}',                  [CredVaultController::class, 'show'])->whereNumber('id');
        Route::post  ('/credentials/{id}/reveal',           [CredVaultController::class, 'reveal'])->whereNumber('id')->middleware('throttle:credvault-reveal');
        Route::post  ('/credentials/{id}/events',           [CredVaultController::class, 'logEvent'])->whereNumber('id');
        Route::get   ('/credentials/{id}/activity',         [CredVaultController::class, 'activity'])->whereNumber('id');
        Route::get   ('/credentials/{id}/attachments/{key}',[CredVaultController::class, 'attachment'])->whereNumber('id')->where('key', '[a-z0-9-]{1,40}');

        Route::get   ('/share-recipients',                  [CredVaultController::class, 'shareRecipients']);
        Route::post  ('/credentials/{id}/shares',           [CredVaultController::class, 'share'])->whereNumber('id');
        Route::get   ('/shares',                            [CredVaultController::class, 'sharedByMe']);
        Route::delete('/shares/{id}',                       [CredVaultController::class, 'revokeShare'])->whereNumber('id');

        Route::get   ('/team/departments',                  [CredVaultController::class, 'teamDepartments']);
        Route::get   ('/team/departments/{id}',             [CredVaultController::class, 'teamDepartment'])->whereNumber('id');
        Route::get   ('/team/organisation',                 [CredVaultController::class, 'teamOrganisation']);

        Route::get   ('/health',                            [CredVaultController::class, 'health']);
        Route::get   ('/health/summary',                    [CredVaultController::class, 'healthSummaryView']);
        Route::get   ('/health/attention',                  [CredVaultController::class, 'healthAttention']);

        Route::get   ('/policies',                          [CredVaultController::class, 'policies']);
        Route::put   ('/policies',                          [CredVaultController::class, 'updatePolicies']);
        Route::post  ('/policies/reset',                    [CredVaultController::class, 'resetPolicies']);
        Route::get   ('/policies/history',                  [CredVaultController::class, 'policyHistory']);

        Route::get   ('/audit-logs',                        [CredVaultController::class, 'auditLogs']);
        Route::get   ('/audit-logs/export',                 [CredVaultController::class, 'exportAuditLogs']);

        Route::post  ('/imports/preview',                   [CredVaultController::class, 'importPreview']);
        Route::get   ('/imports/sample',                    [CredVaultController::class, 'importSample']);
        Route::post  ('/imports',                           [CredVaultController::class, 'import']);
        Route::get   ('/imports',                           [CredVaultController::class, 'imports']);
        Route::get   ('/imports/types',                     [CredVaultController::class, 'importTypes']);
        Route::get   ('/imports/{id}',                      [CredVaultController::class, 'importShow'])->whereNumber('id');
        Route::post  ('/backups',                           [CredVaultController::class, 'backup']);
        Route::get   ('/backups',                           [CredVaultController::class, 'backups']);
        Route::get   ('/exports/preview',                   [CredVaultController::class, 'exportPreview']);
        Route::post  ('/exports',                           [CredVaultController::class, 'export']);
        Route::get   ('/exports',                           [CredVaultController::class, 'exports']);

        Route::get   ('/recycle-bin',                       [CredVaultController::class, 'recycleBin']);
        Route::post  ('/recycle-bin/{id}/restore',          [CredVaultController::class, 'restore'])->whereNumber('id');
        Route::delete('/recycle-bin/{id}',                  [CredVaultController::class, 'purge'])->whereNumber('id');
        Route::delete('/recycle-bin',                       [CredVaultController::class, 'emptyBin']);
        Route::get   ('/recycle-bin/retention',             [CredVaultController::class, 'binRetention']);
        Route::put   ('/recycle-bin/retention',             [CredVaultController::class, 'updateBinRetention']);
    });

    Route::get   ('/clm/leads/{leadId}/agreement-applicable',    [ClmAgreementController::class, 'applicableForLead'])->whereNumber('leadId');
    Route::post  ('/clm/leads/{leadId}/doc-needs',               [ClmAgreementController::class, 'setLeadDocNeed'])->whereNumber('leadId');
    Route::get   ('/clm/buyer-profile',                          [ClmBuyerProfileController::class, 'index']);
    Route::get   ('/clm/supplier-profile',                       [ClmSupplierProfileController::class, 'index']);

    Route::get   ('/clm/diagnosis-resolution',                   [ClmDiagnosisResolutionController::class, 'index']);
    Route::post  ('/clm/diagnosis-resolution/escalate',          [ClmDiagnosisResolutionController::class, 'escalate']);
    Route::get   ('/clm/regulatory-defense',                     [ClmRegulatoryDefenseFileController::class, 'index']);
    Route::post  ('/clm/signature-requests/agreement-preview',   [ClmSignatureController::class, 'agreementPreview']);
    Route::post  ('/clm/signature-requests/agreement-send',      [ClmSignatureController::class, 'agreementSend']);

    Route::get   ('/clm/signature-requests/sales-doc-signers',   [ClmSignatureController::class, 'salesDocSigners']);
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
    Route::get   ('/p2p/files/download',                            [\App\Http\Controllers\Api\P2p\P2pFileController::class, 'download']);
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
    Route::get   ('/sales/gst-home-state',                      [QuotationController::class, 'gstHomeState']);
    Route::get   ('/sales/qpi/master-bundle',                   [QuotationController::class, 'qpiMasterBundle']);
    Route::get   ('/sales/qpi/geo-bundle',                      [QuotationController::class, 'qpiGeoBundle']);
    Route::post  ('/sales/quotations',                          [QuotationController::class, 'store']);
    Route::get   ('/sales/quotations/{id}',                     [QuotationController::class, 'show'])->whereNumber('id');
    Route::put   ('/sales/quotations/{id}',                     [QuotationController::class, 'update'])->whereNumber('id');
    Route::delete('/sales/quotations/{id}',                     [QuotationController::class, 'destroy'])->whereNumber('id');
    Route::post  ('/sales/quotations/{id}/duplicate',           [QuotationController::class, 'duplicate'])->whereNumber('id');
    Route::post  ('/sales/quotations/{id}/sync',                [QuotationController::class, 'sync'])->whereNumber('id');
    Route::get   ('/sales/quotations/{id}/zoho-pdf',            [QuotationController::class, 'zohoPdf'])->whereNumber('id');

    Route::get   ('/sales/proforma-invoices',                                   [ProformaInvoiceController::class, 'index']);
    Route::get   ('/sales/proforma-invoices/preview-code',                      [ProformaInvoiceController::class, 'previewCode']);
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

    Route::get   ('/dev-tools/lock-state',                         [\App\Http\Controllers\Api\DevToolsController::class, 'lockState']);
    Route::post  ('/dev-tools/unlock',                             [\App\Http\Controllers\Api\DevToolsController::class, 'unlock']);
    Route::post  ('/dev-tools/lock',                               [\App\Http\Controllers\Api\DevToolsController::class, 'lock']);
    Route::get   ('/dev-tools/profile-targets',                   [\App\Http\Controllers\Api\DevToolsController::class, 'profileTargets']);
    Route::get   ('/dev-tools/api-usage',                          [\App\Http\Controllers\Api\DevToolsController::class, 'apiUsage']);
    Route::get   ('/dev-tools/profile/{id}',                      [\App\Http\Controllers\Api\DevToolsController::class, 'profileDetail']);
    Route::get   ('/dev-tools/zoho/{type}',                       [\App\Http\Controllers\Api\DevToolsController::class, 'zoho'])
        ->whereIn('type', ['items', 'vendors', 'purchase-orders', 'vendor-credits', 'bills', 'payments']);

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
    Route::get   ('/employees/stats',             [EmployeeController::class, 'stats']);
    Route::get   ('/employees/exit-stats',        [EmployeeController::class, 'exitStats']);
    Route::get   ('/employees/onboarding-stats',  [EmployeeController::class, 'onboardingStats']);
    Route::get   ('/employees/onboarding-form-bootstrap', [EmployeeController::class, 'onboardingFormBootstrap']);
    Route::get   ('/employees/department-tree/{departmentId}', [EmployeeController::class, 'departmentOrgTree'])->whereNumber('departmentId');
    Route::get   ('/employees/available-assets',  [EmployeeController::class, 'availableAssets']);

    Route::get   ('/employees/check-mobile',      [EmployeeController::class, 'checkMobile']);
    Route::get   ('/employees/check-email',       [EmployeeController::class, 'checkEmail']);

    Route::post  ('/employees/onboarding-invite', [OnboardingController::class, 'createInvite']);

    Route::patch ('/employees/{id}/restore',      [EmployeeController::class, 'restore']);

    Route::delete('/employees/{id}/force',        [EmployeeController::class, 'forceDestroy']);

    Route::get   ('/employees/{id}/holidays',     [EmployeeController::class, 'holidays']);
    Route::post  ('/employees/{id}/set-password', [EmployeeController::class, 'setPassword']);
    Route::put   ('/employees/{id}/bank-details', [EmployeeController::class, 'updateBankDetails']);
    Route::patch ('/employees/{id}/step',         [EmployeeController::class, 'updateStep']);
    Route::patch ('/employees/{id}/onboarding-progress', [EmployeeController::class, 'updateOnboardingProgress']);
    Route::apiResource('employees', EmployeeController::class);

    Route::get  ('/employees/{employee}/documents', [EmployeeDocumentController::class, 'index']);
    Route::post ('/employees/{employee}/documents', [EmployeeDocumentController::class, 'store']);

    Route::get  ('/employees/{employee}/exit/document-bundle',        [\App\Http\Controllers\Api\ExitDocumentBundleController::class, 'show']);
    Route::get  ('/employees/{employee}/exit/overview',               [\App\Http\Controllers\Api\ExitDocumentBundleController::class, 'overview']);
    Route::get  ('/employees/{employee}/onboarding-doc-set',          [\App\Http\Controllers\Api\HrOnboardingDocSetController::class, 'show']);
    Route::put  ('/employees/{employee}/onboarding-doc-set',          [\App\Http\Controllers\Api\HrOnboardingDocSetController::class, 'save']);
    Route::post ('/employees/{employee}/onboarding-doc-set/finalize', [\App\Http\Controllers\Api\HrOnboardingDocSetController::class, 'finalize']);
    Route::post ('/employees/{employee}/onboarding-doc-set/reopen',   [\App\Http\Controllers\Api\HrOnboardingDocSetController::class, 'reopen']);
    Route::get  ('/documents/{document}/download',  [EmployeeDocumentController::class, 'download']);
    Route::patch('/documents/{document}/verify',    [EmployeeDocumentController::class, 'verify']);
    Route::patch('/documents/{document}/reject',    [EmployeeDocumentController::class, 'reject']);
    Route::delete('/documents/{document}',          [EmployeeDocumentController::class, 'destroy']);

    Route::get('/employees/{employee}/exit', [ExitController::class, 'show']);
    Route::get('/employees/{employee}/exit/fnf-summary', [ExitController::class, 'fnfSummary']);
    Route::post('/employees/{employee}/exit/fnf-attachment', [ExitController::class, 'uploadFnfAttachment']);
    Route::put('/employees/{employee}/exit', [ExitController::class, 'upsert']);

    Route::post('/employees/{employee}/exit/complete', [ExitController::class, 'complete']);
    Route::get ('/employees/{employee}/exit/direct-reports',    [ExitController::class, 'directReports']);
    Route::post('/employees/{employee}/exit/reassign-reports',  [ExitController::class, 'reassignReports']);
    Route::post('/employees/{employee}/rehire', [ExitController::class, 'rehire']);

    Route::get ('/employees/{employee}/notice-payment', [\App\Http\Controllers\Api\ExitNoticePaymentController::class, 'summary']);
    Route::post('/employees/{employee}/notice-payment', [\App\Http\Controllers\Api\ExitNoticePaymentController::class, 'store']);
    Route::post('/employees/{employee}/notice-payment/record', [\App\Http\Controllers\Api\ExitNoticePaymentController::class, 'record']);
    Route::post('/notice-payments/{id}/approve', [\App\Http\Controllers\Api\ExitNoticePaymentController::class, 'approve'])->whereNumber('id');
    Route::post('/notice-payments/{id}/reject',  [\App\Http\Controllers\Api\ExitNoticePaymentController::class, 'reject'])->whereNumber('id');

    Route::get   ('/employees/{employee}/previous-employments', [PreviousEmploymentController::class, 'index']);
    Route::post  ('/employees/{employee}/previous-employments', [PreviousEmploymentController::class, 'store']);
    Route::patch ('/previous-employments/{prev}',               [PreviousEmploymentController::class, 'update']);
    Route::delete('/previous-employments/{prev}',               [PreviousEmploymentController::class, 'destroy']);

    Route::get   ('/recruitments/next-code', [RecruitmentController::class, 'nextCode']);
    Route::get   ('/recruitments/stats',     [RecruitmentController::class, 'stats']);
    Route::get   ('/recruitments/overview',  [\App\Http\Controllers\Api\RecruitmentBundleController::class, 'overview']);
    Route::get   ('/recruitments/linked-hiring-requests', [RecruitmentController::class, 'linkedHiringRequests']);
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
    Route::get   ('/expense-claims/categories',               [ExpenseClaimController::class, 'categories']);
    Route::get   ('/expense-claims/batch-payable',            [ExpenseClaimController::class, 'batchPayable']);
    Route::get   ('/expense-claims/batch-payments',           [ExpenseClaimController::class, 'batchPayments']);
    Route::post  ('/expense-claims/batch-payments/{batchId}/sync-zoho', [ExpenseClaimController::class, 'syncBatchPaymentToZoho']);
    Route::post  ('/expense-claims/batch-pay',                [ExpenseClaimController::class, 'batchPay']);
    Route::post  ('/expense-claims/export-pdf',               [ExpenseClaimController::class, 'exportPdf']);
    Route::post  ('/expense-claims',                          [ExpenseClaimController::class, 'store']);
    Route::get   ('/expense-claims/{id}',                     [ExpenseClaimController::class, 'show']);
    Route::post  ('/expense-claims/{id}/manager-approve',     [ExpenseClaimController::class, 'managerApprove']);
    Route::post  ('/expense-claims/{id}/manager-reject',      [ExpenseClaimController::class, 'managerReject']);
    Route::post  ('/expense-claims/{id}/hr-approve',          [ExpenseClaimController::class, 'hrApprove']);
    Route::post  ('/expense-claims/{id}/hr-reject',           [ExpenseClaimController::class, 'hrReject']);
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
    Route::get   ('/advance-requests/{id}/settlement',          [\App\Http\Controllers\Api\AdvanceRequestController::class, 'settlement']);
    Route::post  ('/advance-requests/{id}/set-deductions',      [\App\Http\Controllers\Api\AdvanceRequestController::class, 'setDeductions']);
    Route::post  ('/advance-requests/{id}/settle',              [\App\Http\Controllers\Api\AdvanceRequestController::class, 'settle']);
    Route::post  ('/advance-requests/{id}/employee-settle',     [\App\Http\Controllers\Api\AdvanceRequestController::class, 'employeeSettle']);
    Route::post  ('/advance-requests/{id}/settle-approve',      [\App\Http\Controllers\Api\AdvanceRequestController::class, 'settleApprove']);
    Route::post  ('/advance-requests/{id}/settle-reject',       [\App\Http\Controllers\Api\AdvanceRequestController::class, 'settleReject']);
    Route::post  ('/advance-requests/payments/{paymentId}/sync-zoho', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'syncPaymentToZoho'])->whereNumber('paymentId');
    Route::post  ('/advance-requests/{id}/raise-reimbursement', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'raiseReimbursement']);
    Route::post  ('/advance-requests/{id}/record-return',       [\App\Http\Controllers\Api\AdvanceRequestController::class, 'recordReturn']);
    Route::post  ('/advance-requests/{id}/return-payments/{index}/approve', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'approveReturnPayment'])->whereNumber('index');
    Route::post  ('/advance-requests/{id}/return-payments/{index}/reject',  [\App\Http\Controllers\Api\AdvanceRequestController::class, 'rejectReturnPayment'])->whereNumber('index');

    if (app()->environment(['local', 'staging'])) {
        Route::post  ('/dev/sandwich-leave',  [\App\Http\Controllers\Api\SandwichTestController::class, 'seed']);
        Route::post  ('/dev/attendance-seed', [\App\Http\Controllers\Api\AttendanceTestController::class, 'seed']);
        Route::post  ('/dev/backdate-joining',[\App\Http\Controllers\Api\EmployeeJoiningTestController::class, 'backdate']);
    }

    Route::get ('/payroll/cycles',              [\App\Http\Controllers\Api\PayrollController::class, 'cycles']);
    Route::get ('/payroll/history',             [\App\Http\Controllers\Api\PayrollController::class, 'history']);
    Route::get ('/payroll/execution-history',   [\App\Http\Controllers\Api\PayrollController::class, 'executionHistory']);
    Route::get ('/payroll/preflight',           [\App\Http\Controllers\Api\PayrollController::class, 'preflight']);
    Route::get ('/payroll/sandwich-review',     [\App\Http\Controllers\Api\PayrollController::class, 'sandwichReview']);
    Route::get ('/payroll/export',              [\App\Http\Controllers\Api\PayrollController::class, 'export']);
    Route::get ('/payroll/payslips/bulk',       [\App\Http\Controllers\Api\PayrollController::class, 'payslipsBulk']);
    Route::post('/payroll/payslips/email',      [\App\Http\Controllers\Api\PayrollController::class, 'emailPayslipsBulk']);
    Route::get ('/payroll/payslip/{id}/pdf',    [\App\Http\Controllers\Api\PayrollController::class, 'payslipPdf'])->whereNumber('id');
    Route::post('/payroll/payslip/{id}/email',  [\App\Http\Controllers\Api\PayrollController::class, 'emailPayslip'])->whereNumber('id');
    Route::get ('/payroll/payslip/{id}',        [\App\Http\Controllers\Api\PayrollController::class, 'payslip'])->whereNumber('id');
    Route::get ('/payroll/employee/{employeeId}/payslips', [\App\Http\Controllers\Api\PayrollController::class, 'employeePayslips'])->whereNumber('employeeId');
    Route::get ('/payroll/employee/{employeeId}/current-cycle', [\App\Http\Controllers\Api\PayrollController::class, 'employeeCurrentCycle'])->whereNumber('employeeId');
    Route::get ('/payroll/fnf/{employeeId}',    [\App\Http\Controllers\Api\PayrollController::class, 'fnf'])->whereNumber('employeeId');
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
    Route::post('/hr-document-templates/preview-live',         [HrDocumentTemplateController::class, 'previewLive']);

    Route::post('/hr-document-templates/upload-header-logo',   [HrDocumentTemplateController::class, 'uploadHeaderLogo']);

    Route::get ('/hr-document-templates/match',                [HrDocumentTemplateController::class, 'matchForEmployee']);
    Route::get ('/hr-document-templates/{id}/download',        [HrDocumentTemplateController::class, 'downloadDocx']);
    Route::get ('/hr-document-templates/{id}/download-pdf',    [HrDocumentTemplateController::class, 'downloadPdf']);

    Route::get ('/hr-document-templates/{id}/generate',        [HrDocumentTemplateController::class, 'generateForEmployee']);

    Route::get ('/hr-document-templates/{id}/preview',         [HrDocumentTemplateController::class, 'previewForEmployee']);
    Route::post('/hr-document-templates/{id}/upload-docx',     [HrDocumentTemplateController::class, 'uploadDocx']);
    Route::get ('/hr-document-templates/{id}/versions',        [HrDocumentTemplateController::class, 'versions']);
    Route::get ('/hr-document-templates/{id}/versions/{versionId}/download', [HrDocumentTemplateController::class, 'downloadVersion']);

    Route::get ('/my-team/employees',                    [MyTeamController::class, 'employees']);
    Route::get ('/my-team/approvals',                    [MyTeamController::class, 'approvals']);
    Route::get ('/my-team/my-updates',                   [MyTeamController::class, 'myUpdates']);

    Route::get ('/hr-document-signatures/inbox',        [HrDocumentSignatureController::class, 'inbox']);
    Route::get ('/hr-document-signatures/preview-signers', [HrDocumentSignatureController::class, 'previewSigners']);
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
    Route::get ('/hr-generated-documents/{id}/download-pdf', [HrGeneratedDocumentController::class, 'downloadPdf']);
    Route::post('/hr-generated-documents',               [HrGeneratedDocumentController::class, 'store']);
    Route::get ('/hr-generated-documents/{id}',          [HrGeneratedDocumentController::class, 'show']);

    Route::get ('/docs-guide',         [DocsGuideController::class, 'index']);
    Route::get ('/docs-guide/content', [DocsGuideController::class, 'show']);
    Route::put ('/docs-guide/content', [DocsGuideController::class, 'update']);

    Route::get   ('/master-counts',           [MasterController::class, 'counts']);
    Route::get   ('/master/bulk',             [MasterController::class, 'bulk']);
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
    Route::post  ('/leave-requests/preview-days',                [LeaveRequestController::class, 'previewDays']);

    Route::get   ('/leave-requests/approvals',                   [LeaveRequestController::class, 'approvals']);

    Route::get   ('/leave-requests/colleagues',                  [LeaveRequestController::class, 'colleagues']);
    Route::get   ('/leave-requests/{id}',                        [LeaveRequestController::class, 'show']);
    Route::get   ('/leave-requests/{id}/approvers',              [LeaveRequestController::class, 'approvers']);
    Route::post  ('/leave-requests/{id}/approve',                [LeaveRequestController::class, 'approve']);
    Route::post  ('/leave-requests/{id}/reject',                 [LeaveRequestController::class, 'reject']);
    Route::post  ('/leave-requests/{id}/cancel',                 [LeaveRequestController::class, 'cancel']);
    Route::post  ('/leave-requests/{id}/hr-view',                [LeaveRequestController::class, 'hrView']);
    Route::post  ('/leave-requests/{id}/sandwich-waiver',        [LeaveRequestController::class, 'sandwichWaiver']);

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

    Route::apiResource('device-terminals', \App\Http\Controllers\Api\DeviceTerminalController::class)
        ->only(['index', 'store', 'update', 'destroy']);

    Route::apiResource('scan-devices', \App\Http\Controllers\Api\ScanDeviceController::class)
        ->only(['index', 'store', 'update', 'destroy']);
    Route::post('/scan-devices/{id}/rotate', [\App\Http\Controllers\Api\ScanDeviceController::class, 'rotate']);
    Route::post('/scan-devices/enroll', [\App\Http\Controllers\Api\ScanDeviceController::class, 'enroll']);

    Route::get ('/putaway/tasks',               [SpiPutawayTaskController::class, 'queue']);
    Route::post('/putaway/tasks/{task}/cancel', [SpiPutawayTaskController::class, 'cancel'])->whereNumber('task');
    Route::get ('/putaway/tasks/{task}', [SpiPutawayTaskController::class, 'show'])->whereNumber('task');
    Route::get ('/putaway/tasks/{task}/activity', [SpiPutawayTaskController::class, 'activity'])->whereNumber('task');

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

Route::get('/expense-claims/batch-payments/{batchId}/proof', [ExpenseClaimController::class, 'batchPaymentProof'])
    ->name('expense-claims.batch-payment-proof');

Route::get('/advance-requests/{id}/attachments/{index}', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'downloadAttachment'])
    ->name('advance-requests.attachment');
Route::get('/advance-requests/payments/{paymentId}/proof', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'paymentProof'])
    ->name('advance-requests.payment-proof');
Route::get('/advance-requests/{id}/settle-proof/{index}', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'settleProof'])
    ->name('advance-requests.settle-proof');
Route::get('/advance-requests/{id}/return-proof/{index}', [\App\Http\Controllers\Api\AdvanceRequestController::class, 'returnProof'])
    ->name('advance-requests.return-proof');
