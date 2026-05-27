# Cross_Border_Command — AI Context Sheet

> A single-file project briefing for AI assistants. Read this end-to-end before doing any work in this repo.

---

## 1. What this product is

**Cross_Border_Command** is a multi-tenant SaaS ERP for export/import (cross-border trade) businesses. It bundles five major capabilities into one app:

1. **Sales Matrix** — lead → quotation → proforma invoice → procurement → shipment, modelled as a 6-stage opportunity pipeline.
2. **CLM (Central Legal Module)** — segment-driven compliance: KYC, due diligence, trade licenses, agreements, T&C, clauses, and e-signature via Zoho Sign.
3. **HRMS** — employee master, attendance (face-recognition), leave, expenses, recruitment, onboarding, exit, DOCX document generation.
4. **Procurement & Vendor master** — step-wise vendor and product onboarding (identity → contacts → KYC → products / core → sales → quality → vendors).
5. **Billing** — Razorpay-backed plan subscriptions, module gating, webhook reconciliation.

**Tenancy hierarchy:** `Client` (the company that bought the SaaS) → `Branch` (their offices) → `User` (employees within a branch). Almost every business table carries `client_id` and most also `branch_id`; data is scoped accordingly throughout the API.

**Primary users:** export/import companies operating multiple branches; their salespeople, legal/compliance staff, HR, and finance.

---

## 2. Tech stack (exact)

### Backend
- **PHP 8.2+**, **Laravel 12** (`laravel/framework: ^12.0` — note: not 11)
- **Laravel Sanctum 4** for token auth
- **MySQL** (via XAMPP locally)
- Key packages: `barryvdh/laravel-dompdf` (PDFs), `phpoffice/phpword` (DOCX), `razorpay/razorpay`, `google/apiclient`, `chillerlan/php-qrcode`, `milon/barcode`, `league/flysystem-azure-blob-storage`
- **PHPUnit 11** (tests scaffolded but no real coverage)

### Frontend
- **React 19** + **TypeScript 6**, built with **Vite 7**
- **React Router 7**, **Redux Toolkit 2** (used for Velzon theme/UI state only — business data goes through Context + Axios)
- **Bootstrap 5.3 + reactstrap** + **Tailwind CSS 4** (mixed; Velzon admin template is the base)
- **TipTap 3** rich text editor (for CLM document/agreement composition)
- **face-api.js 0.22** (browser-side face descriptor extraction for attendance/login)
- **Recharts 3** for charts, **@tanstack/react-table 8** for grids, **xlsx** for exports, **pdfjs-dist** for PDF preview, **sweetalert2** for confirms

### Dev
- Composer script `composer dev` runs `artisan serve` + `queue:listen` + `pail` (log tail) + `npm run dev` together via `concurrently`.
- `npm run build` outputs to `resources/dist/`.

---

## 3. Architecture at a glance

```
   ┌──────────────────────────────────────────────────────────┐
   │   React 19 SPA (resources/js/)                           │
   │   - AuthContext, BranchSwitcherContext, SettingsContext  │
   │   - Axios client at resources/js/api.ts                  │
   │     · injects Authorization: Bearer <sanctum_token>      │
   │     · auto-injects ?branch_id=<active> on GETs           │
   │     · 401 → force logout, store error in localStorage    │
   └────────────────────────┬─────────────────────────────────┘
                            │  HTTPS / JSON
                            ▼
   ┌──────────────────────────────────────────────────────────┐
   │   Laravel 12 API (routes/api.php → app/Http/...)         │
   │   Middleware: auth:sanctum → user.active (EnsureUserActive) │
   │   Controllers scope queries by client_id / branch_id.     │
   │   Services: RazorpayService, ZohoSignService,             │
   │             IndiaMartLeadSyncService, ConsigneeKycMirror, │
   │             HrTemplateDocxRenderer, AnnouncementMailer,   │
   │             InvoiceMailer, BrandingResolver               │
   └────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
   ┌──────────────────────────────────────────────────────────┐
   │   MySQL (228 migrations)                                  │
   │   Storage: local public disk + Azure Blob (flysystem)     │
   │   Queue: database (artisan queue:listen)                  │
   └──────────────────────────────────────────────────────────┘

   External:
   - Razorpay  (subscription billing + webhook)
   - Zoho Sign (e-signature for agreements/trade docs)
   - Google OAuth (login)
   - IndiaMart  (inbound CRM lead sync)
```

### Request lifecycle (typical authenticated GET)
1. React component fires `api.get('/customers')`.
2. Axios interceptor adds `Authorization: Bearer <token>` (from `localStorage`) and `?branch_id=<active>` from `BranchSwitcherContext`.
3. Laravel routes through `auth:sanctum` → `user.active` middleware.
4. Controller resolves `auth()->user()`, derives `client_id` (always) and `branch_id` (when relevant), scopes the Eloquent query.
5. Response JSON is consumed; on `401` the Axios response interceptor wipes the token and redirects to `/login`.

---

## 4. Authentication & session

Three login paths, all returning the same Sanctum token:

| Path | Endpoint | Notes |
|---|---|---|
| Email + password | `POST /api/login` | Standard. Password history check enforced via `PasswordHistory` trait. |
| Face recognition | `POST /api/login/face` | Frontend sends 128-d face descriptor (`face-api.js`); server matches against `face_biometrics` table. **Threshold 0.55** (stricter than face-api.js default 0.6). |
| Google OAuth | `POST /api/google-login` | Uses `google/apiclient`; user must already exist with matching email. |

**Forgot password:** OTP flow — `send-otp` → `verify-otp` → `reset`. Old passwords blocked by `PasswordHistory`.

**Session model:** Sanctum tokens stored in `localStorage`. **Idle timeout 30 min** enforced by `IdleTimeout.tsx`. There is NO refresh token — token lives until logout or 401.

**Public PDF links** (`/api/sales/quotations/{id}/view`, `/api/sales/proforma-invoices/{id}/view`) use Laravel's `signed` middleware; URLs are generated at email-send time and **expire after 60 days**.

**Public onboarding** (`/api/onboarding/{token}` GET + `/complete` POST) is token-gated and **rate-limited to 30 req/min per IP** to prevent token brute-force.

**Authorization:** there are two layers:
- `Permission` model: per-user module grants (`PermissionController`).
- `ClientSetting` feature flags: gate whole modules on/off per tenant (`SettingsContext` on frontend).

---

## 5. Multi-tenancy rules

- Every business table has `client_id`. Most also have `branch_id`.
- The Axios interceptor injects `branch_id` from `BranchSwitcherContext` on **all GET requests**.
- Controllers MUST scope by `client_id` derived from the authenticated user; never trust a `client_id` from the request body.
- Super-admins (root tier) can see across clients via dedicated `/admin-stats` endpoints; client-admins are scoped to their own client; branch users to their branch.
- `BrandingResolver` service produces per-tenant logo/colors for emails and PDFs.

---

## 6. The Sales Matrix (the heart of the product)

A "lead" becomes an "opportunity" that moves through 6 stages, each with its own sub-form on the same detail page.

### Stages
| # | Stage | What happens |
|---|---|---|
| 1 | **Inquiry Received** | Lead captured (manual entry or IndiaMart sync via `IndiaMartLeadSyncService`). |
| 2 | **Lead Acknowledgement** | Send ACK email; if not acknowledged, capture reason via `LeadAckReason`. |
| 3 | **Product Sourcing** | Attach products + vendors; `LeadProduct` rows + `LeadProductSharedPrice`. |
| 4 | **Price Shared** | Shared pricing records sent to customer. |
| 5 | **Quotation vs PI** | Create `Quotation` (code `QT/YYYY-NN/SEQ`, financial year). Convert to `ProformaInvoice` (code `PI/YYYY-NN/SEQ`). |
| 6 | **Victory** | Mark won; downstream `Procurement` + `ShipmentOrder` created. |

### Files
- Backend: [SalesLeadController.php](app/Http/Controllers/Api/SalesLeadController.php), [QuotationController.php](app/Http/Controllers/Api/QuotationController.php), [ProformaInvoiceController.php](app/Http/Controllers/Api/ProformaInvoiceController.php), [ProcurementController.php](app/Http/Controllers/Api/ProcurementController.php), [SalesPdfController.php](app/Http/Controllers/Api/SalesPdfController.php), [SalesTodoController.php](app/Http/Controllers/Api/SalesTodoController.php), [LeadAckReasonController.php](app/Http/Controllers/Api/LeadAckReasonController.php)
- Models: `Lead`, `LeadAcknowledgement`, `LeadProduct`, `LeadProductSharedPrice`, `LeadTaskManager`, `Quotation`, `QuotationItem`, `ProformaInvoice`, `ProformaInvoiceItem`, `Procurement`, `ProcurementProduct`, `ShipmentOrder`, `SalesMeeting`, `SalesReminder`
- Frontend: [SalesMatrixDetail.tsx](resources/js/pages/sales/matrix/SalesMatrixDetail.tsx) (the 6-stage view), [SalesLeadWorksheet.tsx](resources/js/pages/sales/SalesLeadWorksheet.tsx), [SalesLeadsDetails.tsx](resources/js/pages/sales/SalesLeadsDetails.tsx), [SalesLeadAckMaster.tsx](resources/js/pages/sales/SalesLeadAckMaster.tsx)

### Codes
- Quotation: `QT/<FY 2-digit>-<2-digit>/<SEQ>` (e.g. `QT/25-26/0042`), allocated under a per-client row lock to prevent races.
- Proforma Invoice: `PI/<FY>/<SEQ>` (same pattern).

### Customers vs Consignees
A `Customer` (buyer entity) can have one or more `Consignee` (recipient companies). `ConsigneeController::cloneFromCustomer()` uses `ConsigneeKycMirror` service to deep-copy KYC docs/owners — be careful not to break the mirror logic when editing either side.

### Active porting work
The HTML prototype `SalesMatrix_v4_9` is being ported page-by-page into the React app. **3 done** (Customers, Consignee, LeadAckMaster); **12 pending** starting with Lead Worksheet. For port tasks: pick the fullest faithful implementation and proceed; do not ask scope/design questions.

---

## 7. CLM (Central Legal Module)

Compliance documents are organized by **business segment** (Tobacco, Rice, Food Grade Ethanol, etc.). Each segment has rules — defined in the **DCP (Document Control Panel)** — about which documents are required for each party type (customer / vendor / consignee).

### Document catalogues (one controller each)
- **KYC** — Know-Your-Customer documents ([ClmKycController.php](app/Http/Controllers/Api/ClmKycController.php))
- **DD** — Due Diligence ([ClmDdController.php](app/Http/Controllers/Api/ClmDdController.php))
- **QC** — Quality Compliance ([ClmQcController.php](app/Http/Controllers/Api/ClmQcController.php))
- **Trade Licenses** — Export/import licenses ([ClmTradeLicenseController.php](app/Http/Controllers/Api/ClmTradeLicenseController.php))
- **Trade Documents** — DOCX templates + library ([ClmTradeDocumentController.php](app/Http/Controllers/Api/ClmTradeDocumentController.php))
- **Agreements** — Agreement templates + library ([ClmAgreementController.php](app/Http/Controllers/Api/ClmAgreementController.php))
- **Clauses** — Reusable clauses ([ClmClauseController.php](app/Http/Controllers/Api/ClmClauseController.php))
- **TNCs** — Terms & Conditions library ([ClmTncController.php](app/Http/Controllers/Api/ClmTncController.php))

### Rule engine
- `ClmSegmentRule` rows link a segment + party type → required document list.
- `ClmSegmentRuleController` powers the DCP UI ([ClmDcpPage.tsx](resources/js/pages/clm/ClmDcpPage.tsx)).
- When a lead/customer is created under a segment, the engine surfaces missing required docs.

### E-signature flow
- `ClmSignatureController` wraps `ZohoSignService`.
- Endpoints: `preview` → `send` → `index/show` → `remind` / `recall` → `downloadFile` / `viewFile` / `viewCertificate`.
- Zoho posts back to update `clm_signature_requests.status`.
- **Watch out:** there is a race between Zoho's webhook and the frontend's manual status poll — order-of-operations bugs surface here.

### Authorities
`ClmAuthorityController` is the master for regulatory bodies (FSSAI, DGFT, BIS, etc.).

### Stub pages (NOT YET BUILT)
Several CLM frontend pages still render [ClmStubPage.tsx](resources/js/pages/clm/ClmStubPage.tsx): analytics, diagnosis, resolution, buyer profile, supplier profile, case-to-case, agreements-sent, agreements-to-approve. Don't assume features behind these links work.

---

## 8. HRMS

### Employee lifecycle
1. **Hiring Request** → `HiringRequestController` (req approval)
2. **Recruitment** → `RecruitmentController` (campaign + sourcing)
3. **Candidate** → `CandidateController` (interview pipeline)
4. **Onboarding** → public token form ([OnboardingController.php](app/Http/Controllers/Api/OnboardingController.php) + `EmployeeOnboardingInvite`); candidate self-fills profile + documents
5. **Employee master** → `EmployeeController` (CRUD + documents + permissions); `EmployeeController::resolveIdParam()` accepts numeric id, employee_code, or invite token
6. **Exit** → `ExitController` + `EmployeeExit`, `PreviousEmployment`

### Attendance
- **Multi-punch model**: `Attendance` (parent) + `AttendancePunch` (each tap, labelled Check In / Lunch Out / Lunch In / Check Out / etc.).
- Punch **direction must alternate strictly** — server rejects two same-direction punches in a row. Critical invariant.
- Face match uses `FaceBiometricController` (enroll + match), same 0.55 threshold as login.
- Frontend: [ClockIn.tsx](resources/js/pages/ClockIn.tsx) (the user-facing clock-in screen), [HrAttendance.tsx](resources/js/pages/hrms/HrAttendance.tsx) (HR review).
- Timestamps stored UTC; tenant timezone applied on read.

### Leave
- `LeavePlan` (annual/sick/casual definitions, optionally assigned to specific employees) → `LeaveRequest` (request) → approval chain via `LeaveRequestController`.
- Frontend: [HrLeave.tsx](resources/js/pages/hrms/HrLeave.tsx), [HrLeavePlans.tsx](resources/js/pages/hrms/HrLeavePlans.tsx), [HrLeaveApprovals.tsx](resources/js/pages/hrms/HrLeaveApprovals.tsx).

### Expenses & advances
- `ExpenseClaimController`, `AdvanceRequestController`; categories from `Masters\ExpenseCategories`.
- Frontend: [HrExpenseManagement.tsx](resources/js/pages/hrms/HrExpenseManagement.tsx).

### Document generation
- `HrDocumentTemplateController` (template CRUD) → `HrGeneratedDocumentController` (merge & render) → `HrDocumentSignatureController` (capture signature).
- `HrTemplateDocxRenderer` service does the DOCX placeholder merge (`phpoffice/phpword`).
- Custom fields per tenant via `HrCustomFieldController`.

### Other HR
- `MyTeamController` — direct reports of logged-in user.
- `AnnouncementController` + `AnnouncementMailer` — company-wide broadcasts + email.

---

## 9. Procurement masters

### Products (step-wise)
- 4 steps: **core → sales → quality → vendors**. Each is its own endpoint, e.g. `POST /products/step/core`, `PUT /products/{id}/step/sales`.
- Each step has its own status column (`core_status`, `sales_status`, `quality_status`, `vendors_status`).
- Frontend: [ProductView.tsx](resources/js/pages/products/ProductView.tsx) drives the step UI.

### Vendors (step-wise)
- 4 steps: **identity → contacts → KYC → products**. Same status-column pattern.
- Frontend: [Vendors.tsx](resources/js/pages/vendors/Vendors.tsx).

### Why step-wise matters
Each step is independently saveable and validatable. A bug in one step's validation must not block the others.

---

## 10. Billing

- `Plan` defines tiers; `PlanModule` joins plans to `Module` records (i.e. which features the plan unlocks).
- `SubscriptionController` handles plan selection/upgrade; `PaymentController` records manual payments; `RazorpayWebhookController` handles automated webhook callbacks.
- Expired or missing plans redirect users to `/my-plan` or `/plan-blocked` (enforced frontend-side in `App.tsx`).
- Frontend: [Plans.tsx](resources/js/pages/plan/Plans.tsx), [AddPlan.tsx](resources/js/pages/plan/AddPlan.tsx), [PlanSelection.tsx](resources/js/pages/plan/PlanSelection.tsx), [Payments.tsx](resources/js/pages/Payments.tsx).

---

## 11. Masters (lookups)

`MasterController` is a schema-driven generic CRUD endpoint backed by ~50 models in `app/Models/Masters/`. The frontend uses [masterConfigs.ts](resources/js/pages/master/masterConfigs.ts) to declare each master's columns/fields, and [MasterPage.tsx](resources/js/pages/master/MasterPage.tsx) renders the UI generically.

Domains covered:
- **Geography:** Countries, States
- **Commerce:** Currencies, Uom, PaymentTerms
- **Classifications:** CustomerTypes, CustomerClassifications, VendorTypes
- **Finance:** Companies, BankAccounts, LegalEntities
- **Trade:** Incoterms, PortOfLoading, PortOfDischarge, PackagingMaterial, Conditions
- **HR:** Departments, Roles, Designations, Kpis, Assets, LeaveTypes, ExpenseCategories
- **Inventory:** Warehouse, Racks, Shelves, Zones, Freezers
- **Risk/Rules:** RiskLevels, DocumentType, TriggerPoints, AdvancePaymentRules

---

## 12. Directory layout

### Backend (`app/`)
```
app/
├─ Http/
│  ├─ Controllers/Api/        65 controllers (see §13 module map)
│  ├─ Middleware/
│  │  └─ EnsureUserActive.php (registered as 'user.active')
│  ├─ Requests/                FormRequest classes
│  └─ Resources/               API Resource transformers
├─ Models/                     85+ models (top-level + Masters/)
├─ Services/                   RazorpayService, ZohoSignService,
│                              IndiaMartLeadSyncService,
│                              ConsigneeKycMirror,
│                              HrTemplateDocxRenderer,
│                              AnnouncementMailer, InvoiceMailer,
│                              BrandingResolver
├─ Support/                    helpers, traits (PasswordHistory, etc.)
├─ Mail/                       Mailable classes
└─ helpers.php                 globally autoloaded
```

### Frontend (`resources/js/`)
```
resources/js/
├─ app.tsx                     entry point
├─ api.ts                      Axios client + interceptors
├─ constants.ts                feature flags, role/permission enums
├─ types.ts                    TS interfaces
├─ components/                 shared UI (App.tsx is the root)
├─ contexts/                   Auth, BranchSwitcher, Settings,
│                              Confirm, Toast, Layout, Theme, Variant
├─ pages/
│  ├─ auth/                    Login, ForgotPassword, etc.
│  ├─ dashboard/               role-specific dashboards
│  ├─ sales/                   Sales Matrix + sub-pages
│  │  └─ matrix/               SalesMatrixDetail + stage components
│  ├─ clm/                     CLM module pages (some are stubs)
│  ├─ hrms/                    HR pages
│  ├─ employee/                employee profile + sub-views
│  ├─ recruitment/             recruitment pages
│  ├─ employee-onboarding/     onboarding pages
│  ├─ products/                product master + step views
│  ├─ vendors/                 vendor master
│  ├─ client/  branch/         tenancy pages
│  ├─ plan/                    billing/plan pages
│  ├─ master/                  generic master (MasterPage + configs)
│  └─ (top-level)              ClockIn, Profile, MyTeam, Inbox,
│                              Settings, Payments, OrganizationTypes
├─ hooks/                      e.g. useChartTheme
├─ utils/                      e.g. resolveFileUrl
└─ velzon/                     Velzon admin theme (Redux store here)
```

### Root-level docs (read these for deep dives)
- [README.md](README.md), [QA_ONBOARDING.md](QA_ONBOARDING.md), [DATABASE_DESIGN.md](DATABASE_DESIGN.md), [BRANCH_SWITCHER.md](BRANCH_SWITCHER.md), [BUG_FIXES.md](BUG_FIXES.md), [BUG_VERIFICATION.md](BUG_VERIFICATION.md), [HR_MENU_PERMISSIONS.md](HR_MENU_PERMISSIONS.md), [GOOGLE_SIGNIN_SETUP.md](GOOGLE_SIGNIN_SETUP.md), [RAZORPAY_INTEGRATION.md](RAZORPAY_INTEGRATION.md), [PROJECT_FUNCTIONALITY_OVERVIEW.md](PROJECT_FUNCTIONALITY_OVERVIEW.md)

---

## 13. Module → file map (quick reference)

| Domain | Controllers | Frontend page(s) |
|---|---|---|
| Auth | [AuthController](app/Http/Controllers/Api/AuthController.php), [ForgotPasswordController](app/Http/Controllers/Api/ForgotPasswordController.php) | [Login.tsx](resources/js/pages/auth/Login.tsx), [ForgotPassword.tsx](resources/js/pages/auth/ForgotPassword.tsx), [VerifyOTP.tsx](resources/js/pages/auth/VerifyOTP.tsx), [ResetPassword.tsx](resources/js/pages/auth/ResetPassword.tsx) |
| Tenancy | [ClientController](app/Http/Controllers/Api/ClientController.php), [BranchController](app/Http/Controllers/Api/BranchController.php) | [pages/client/](resources/js/pages/client/), [pages/branch/](resources/js/pages/branch/), [UsersPage.tsx](resources/js/pages/UsersPage.tsx) |
| Customers | [CustomerController](app/Http/Controllers/Api/CustomerController.php) | [SalesCustomers.tsx](resources/js/pages/sales/SalesCustomers.tsx) |
| Consignees | (in `Api/`) `ConsigneeController` | [SalesConsignee.tsx](resources/js/pages/sales/SalesConsignee.tsx) |
| Leads / Sales | [SalesLeadController](app/Http/Controllers/Api/SalesLeadController.php), [LeadAckReasonController](app/Http/Controllers/Api/LeadAckReasonController.php), [SalesTodoController](app/Http/Controllers/Api/SalesTodoController.php) | [SalesLeadWorksheet.tsx](resources/js/pages/sales/SalesLeadWorksheet.tsx), [SalesLeadAckMaster.tsx](resources/js/pages/sales/SalesLeadAckMaster.tsx), [SalesLeadsDetails.tsx](resources/js/pages/sales/SalesLeadsDetails.tsx), [SalesMatrixDetail.tsx](resources/js/pages/sales/matrix/SalesMatrixDetail.tsx) |
| Quotations / PI | [QuotationController](app/Http/Controllers/Api/QuotationController.php), [ProformaInvoiceController](app/Http/Controllers/Api/ProformaInvoiceController.php), [SalesPdfController](app/Http/Controllers/Api/SalesPdfController.php) | [SalesQPI.tsx](resources/js/pages/sales/SalesQPI.tsx), stage components in [pages/sales/matrix/](resources/js/pages/sales/matrix/) |
| Procurement | [ProcurementController](app/Http/Controllers/Api/ProcurementController.php) | [SalesP2PSummary.tsx](resources/js/pages/sales/SalesP2PSummary.tsx) |
| Products | [ProductController](app/Http/Controllers/Api/ProductController.php) | [Products.tsx](resources/js/pages/products/Products.tsx), [ProductView.tsx](resources/js/pages/products/ProductView.tsx) |
| Vendors | `VendorController` (in `Api/`) | [Vendors.tsx](resources/js/pages/vendors/Vendors.tsx) |
| CLM segments | [ClmSegmentController](app/Http/Controllers/Api/ClmSegmentController.php), [ClmSegmentRuleController](app/Http/Controllers/Api/ClmSegmentRuleController.php) | [ClmSegmentPage.tsx](resources/js/pages/clm/ClmSegmentPage.tsx), [ClmDcpPage.tsx](resources/js/pages/clm/ClmDcpPage.tsx) |
| CLM authorities | [ClmAuthorityController](app/Http/Controllers/Api/ClmAuthorityController.php) | [ClmAuthorityPage.tsx](resources/js/pages/clm/ClmAuthorityPage.tsx) |
| CLM KYC/DD/QC/TL | [ClmKycController](app/Http/Controllers/Api/ClmKycController.php), [ClmDdController](app/Http/Controllers/Api/ClmDdController.php), [ClmQcController](app/Http/Controllers/Api/ClmQcController.php), [ClmTradeLicenseController](app/Http/Controllers/Api/ClmTradeLicenseController.php) | [ClmKycPage.tsx](resources/js/pages/clm/ClmKycPage.tsx), [ClmDdPage.tsx](resources/js/pages/clm/ClmDdPage.tsx), [ClmQcPage.tsx](resources/js/pages/clm/ClmQcPage.tsx), [ClmTradeLicensesPage.tsx](resources/js/pages/clm/ClmTradeLicensesPage.tsx) |
| CLM trade docs | [ClmTradeDocumentController](app/Http/Controllers/Api/ClmTradeDocumentController.php) | [ClmTradeDocumentsPage.tsx](resources/js/pages/clm/ClmTradeDocumentsPage.tsx) |
| CLM agreements | [ClmAgreementController](app/Http/Controllers/Api/ClmAgreementController.php) | [ClmAgreementsPage.tsx](resources/js/pages/clm/ClmAgreementsPage.tsx) |
| CLM clauses | [ClmClauseController](app/Http/Controllers/Api/ClmClauseController.php) | [ClmClauseLibraryPage.tsx](resources/js/pages/clm/ClmClauseLibraryPage.tsx) |
| CLM TNC | [ClmTncController](app/Http/Controllers/Api/ClmTncController.php) | [ClmTncPage.tsx](resources/js/pages/clm/ClmTncPage.tsx) |
| CLM signatures | [ClmSignatureController](app/Http/Controllers/Api/ClmSignatureController.php) | (embedded in agreement / trade-doc pages) |
| Employees | [EmployeeController](app/Http/Controllers/Api/EmployeeController.php), [EmployeeDocumentController](app/Http/Controllers/Api/EmployeeDocumentController.php), [PreviousEmploymentController](app/Http/Controllers/Api/PreviousEmploymentController.php), [PermissionController](app/Http/Controllers/Api/PermissionController.php) | [HrEmployees.tsx](resources/js/pages/hrms/HrEmployees.tsx), [EmployeeProfile.tsx](resources/js/pages/employee/EmployeeProfile.tsx), [EmployeePermissions.tsx](resources/js/pages/employee/EmployeePermissions.tsx) |
| Attendance | [AttendanceController](app/Http/Controllers/Api/AttendanceController.php), [FaceBiometricController](app/Http/Controllers/Api/FaceBiometricController.php) | [ClockIn.tsx](resources/js/pages/ClockIn.tsx), [HrAttendance.tsx](resources/js/pages/hrms/HrAttendance.tsx) |
| Leave | [LeaveRequestController](app/Http/Controllers/Api/LeaveRequestController.php), [LeavePlanController](app/Http/Controllers/Api/LeavePlanController.php) | [HrLeave.tsx](resources/js/pages/hrms/HrLeave.tsx), [HrLeavePlans.tsx](resources/js/pages/hrms/HrLeavePlans.tsx), [HrLeaveApprovals.tsx](resources/js/pages/hrms/HrLeaveApprovals.tsx) |
| Expenses | [ExpenseClaimController](app/Http/Controllers/Api/ExpenseClaimController.php) | [HrExpenseManagement.tsx](resources/js/pages/hrms/HrExpenseManagement.tsx) |
| Recruitment | [RecruitmentController](app/Http/Controllers/Api/RecruitmentController.php), [HiringRequestController](app/Http/Controllers/Api/HiringRequestController.php), [CandidateController](app/Http/Controllers/Api/CandidateController.php) | [HrRecruitment.tsx](resources/js/pages/recruitment/HrRecruitment.tsx), [HrCandidates.tsx](resources/js/pages/recruitment/HrCandidates.tsx) |
| Onboarding (public) | [OnboardingController](app/Http/Controllers/Api/OnboardingController.php) | [PublicOnboarding.tsx](resources/js/pages/PublicOnboarding.tsx), [HrEmployeeOnboarding.tsx](resources/js/pages/employee-onboarding/HrEmployeeOnboarding.tsx) |
| Exit | [ExitController](app/Http/Controllers/Api/ExitController.php) | [HrExitManagement.tsx](resources/js/pages/hrms/HrExitManagement.tsx) |
| HR docs | [HrDocumentTemplateController](app/Http/Controllers/Api/HrDocumentTemplateController.php), [HrGeneratedDocumentController](app/Http/Controllers/Api/HrGeneratedDocumentController.php), [HrDocumentSignatureController](app/Http/Controllers/Api/HrDocumentSignatureController.php), [HrCustomFieldController](app/Http/Controllers/Api/HrCustomFieldController.php) | [HrDocumentTemplates.tsx](resources/js/pages/hrms/HrDocumentTemplates.tsx), [HrCustomFields.tsx](resources/js/pages/hrms/HrCustomFields.tsx) |
| HR overview / team | [HrOverviewController](app/Http/Controllers/Api/HrOverviewController.php), [MyTeamController](app/Http/Controllers/Api/MyTeamController.php) | [HrOverview.tsx](resources/js/pages/hrms/HrOverview.tsx), [MyTeam.tsx](resources/js/pages/MyTeam.tsx) |
| Announcements | [AnnouncementController](app/Http/Controllers/Api/AnnouncementController.php), [NotificationController](app/Http/Controllers/Api/NotificationController.php) | [HrBroadcastCentre.tsx](resources/js/pages/hrms/HrBroadcastCentre.tsx), [Inbox.tsx](resources/js/pages/Inbox.tsx) |
| Billing | [PlanController](app/Http/Controllers/Api/PlanController.php), [SubscriptionController](app/Http/Controllers/Api/SubscriptionController.php), [PaymentController](app/Http/Controllers/Api/PaymentController.php), [RazorpayWebhookController](app/Http/Controllers/Api/RazorpayWebhookController.php) | [Plans.tsx](resources/js/pages/plan/Plans.tsx), [AddPlan.tsx](resources/js/pages/plan/AddPlan.tsx), [PlanSelection.tsx](resources/js/pages/plan/PlanSelection.tsx), [Payments.tsx](resources/js/pages/Payments.tsx) |
| Masters | [MasterController](app/Http/Controllers/Api/MasterController.php), [OrganizationTypeController](app/Http/Controllers/Api/OrganizationTypeController.php) | [MasterDashboard.tsx](resources/js/pages/MasterDashboard.tsx), [MasterPage.tsx](resources/js/pages/master/MasterPage.tsx), [OrganizationTypes.tsx](resources/js/pages/OrganizationTypes.tsx) |
| Settings | [SettingsController](app/Http/Controllers/Api/SettingsController.php) | [Settings.tsx](resources/js/pages/Settings.tsx), [ClientSettings.tsx](resources/js/pages/client/ClientSettings.tsx) |
| Dashboard | [DashboardController](app/Http/Controllers/Api/DashboardController.php) | [AdminDashboard.tsx](resources/js/pages/dashboard/AdminDashboard.tsx), [ClientDashboard.tsx](resources/js/pages/dashboard/ClientDashboard.tsx), [BranchDashboard.tsx](resources/js/pages/dashboard/BranchDashboard.tsx), [EmployeeDashboard.tsx](resources/js/pages/dashboard/EmployeeDashboard.tsx) |

---

## 14. API conventions

- All API routes are in [routes/api.php](routes/api.php) (single file). Prefix `/api` is added by Laravel.
- Public routes are explicitly listed at the top of the file; everything else sits under `Route::middleware(['auth:sanctum', 'user.active'])->group(...)`.
- Most resources use `Route::apiResource('xxx', XxxController::class)` plus extra verbs for non-CRUD ops (`/duplicate`, `/convert-to-pi`, `/approve`, `/reject`, `/sync-from-crm`, etc.).
- Nested resources (documents, owners, addresses) are scoped under their parent: `/customers/{id}/documents`, `/customers/{id}/owners`.
- Step-wise endpoints follow `POST|PUT /<resource>/step/<step-name>` (`/products/step/core`, `/vendors/step/identity`).
- Generic master CRUD: `GET|POST|PUT|DELETE /master/{key}[...]` driven by `MasterController`.
- Response shape: typically `{ data: ..., meta?: ... }` for collections, `{ data: ... }` for items, `{ message: ..., errors?: {...} }` for failures.
- Validation errors return HTTP 422 with `errors` keyed by field — frontend forms expect this shape.

---

## 15. Database conventions

- Migration count: **228** (under [database/migrations/](database/migrations/)).
- Domain groupings (rough): core/tenancy (~15), masters (~50), HR/employees (~25), attendance/leave (~10), sales/customers/consignees (~25), products/vendors (~15), CLM (~25), billing (~10), HR docs (~10), the rest are fixes/indexes/cleanups.
- Multi-tenant scoping: most tables have `client_id` (FK to `clients`), many also have `branch_id` (FK to `branches`).
- Soft deletes used on most business tables (`deleted_at`).
- Document storage: file paths stored as `/storage/...` and resolved to absolute URLs on the frontend via `utils/resolveFileUrl.ts`. Azure Blob is configured as an alternative disk.
- Seeders: `DatabaseSeeder`, `GeographySeeder`, `LeaveSeeder`, `MasterDataSeeder`, `ModuleSeeder`, `OrganizationTypeSeeder`, `PlanSeeder`. **No model factories** exist.

---

## 16. Critical business rules (don't break these)

1. **Face match threshold is 0.55** (stricter than face-api.js default 0.6). Enforced server-side in `FaceBiometricController` AND in `AuthController::faceLogin`.
2. **Attendance punch direction alternates strictly** — `in → out → in → out`. Two consecutive same-direction punches must be rejected.
3. **Quotation/PI codes are per-client sequential** — allocated under a row lock on the `clients` table to prevent races. Never bypass the lock.
4. **Customer → Consignee mirror** — `ConsigneeKycMirror` deep-clones KYC docs; if you edit either model's schema, update the mirror.
5. **Signed PDF URLs expire after 60 days** — generated at email-send time; do not regenerate without notifying the customer.
6. **Public onboarding rate limit: 30 req/min/IP** — don't lower this; it's the only thing protecting the 64-char token from brute-force.
7. **Idle timeout: 30 min** in `IdleTimeout.tsx`.
8. **Branch switcher auto-injection** — Axios injects `branch_id` on GETs. When writing new GET endpoints, decide explicitly whether they're branch-scoped or not, and handle a missing/zero `branch_id` correctly.
9. **Tenant isolation** — never trust `client_id` from request body; always derive from `auth()->user()`.
10. **DOCX template placeholders** — `HrTemplateDocxRenderer` and CLM agreement/trade-doc renderers replace `{{placeholder}}` tokens. Special chars, line breaks, and tables are known fragile areas.

---

## 17. External integrations

| Service | Purpose | Code |
|---|---|---|
| Razorpay | Subscription billing | `app/Services/RazorpayService.php`, [RazorpayWebhookController.php](app/Http/Controllers/Api/RazorpayWebhookController.php); see [RAZORPAY_INTEGRATION.md](RAZORPAY_INTEGRATION.md) |
| Zoho Sign | E-signature | `app/Services/ZohoSignService.php`, [ClmSignatureController.php](app/Http/Controllers/Api/ClmSignatureController.php) |
| Google OAuth | Login | `google/apiclient`; [AuthController::googleLogin](app/Http/Controllers/Api/AuthController.php); see [GOOGLE_SIGNIN_SETUP.md](GOOGLE_SIGNIN_SETUP.md) |
| IndiaMart | Inbound CRM lead sync | `app/Services/IndiaMartLeadSyncService.php` (called from `SalesLeadController::syncFromCrm`) |
| Azure Blob | File storage | `league/flysystem-azure-blob-storage`; configured in `config/filesystems.php` |
| face-api.js | Browser-side face descriptors | Loaded in [ClockIn.tsx](resources/js/pages/ClockIn.tsx) and login |
| TipTap | Rich text editor for CLM content | Used in CLM agreement/clause/T&C composition |
| dompdf / phpword | PDF/DOCX generation | Used by `SalesPdfController`, `HrTemplateDocxRenderer`, CLM controllers |

---

## 18. Local development

### One-time setup
```powershell
composer install
copy .env.example .env
php artisan key:generate
php artisan migrate --seed
npm install
npm run build
```

### Run dev (one terminal)
```powershell
composer dev
```
Spawns `php artisan serve`, `queue:listen`, `pail` (log tail), and `vite` together. The composer script uses `npx concurrently`.

### Run dev (manual / separate terminals)
```powershell
php artisan serve            # http://127.0.0.1:8000 (API)
php artisan queue:listen     # async jobs
npm run dev                  # http://127.0.0.1:5173 (Vite)
```

### Tests
```powershell
php artisan test
```
Tests folder is scaffolded but empty — only example stubs exist.

---

## 19. Known gaps & gotchas

- **No real test coverage** — neither PHPUnit nor any frontend test runner is wired in. Don't claim a change is "tested" unless you've manually exercised it.
- **No model factories** — only seeders. Generating test data requires seeders or manual SQL.
- **Several CLM pages are stubs** ([ClmStubPage.tsx](resources/js/pages/clm/ClmStubPage.tsx)): analytics, diagnosis, resolution, buyer/supplier profiles, case-to-case, agreements-sent, agreements-to-approve.
- **Sales Matrix port in progress** — `SalesMatrix_v4_9` HTML prototype is being ported page-by-page; 3 of 15 done. For port tasks, pick the fullest faithful implementation and proceed without surfacing scope options.
- **Mixed UI libraries** — reactstrap + Bootstrap 5.3 + Tailwind 4 coexist. Velzon is the source theme. New components should follow the dominant pattern in nearby files rather than introduce a new approach.
- **Redux is for theme only** — business state goes through Context + Axios calls. Don't add business slices to the Velzon store.
- **Branch switcher edge case** — the Axios interceptor injects `branch_id` on all GETs. Nested routes occasionally need to opt out; check existing patterns before assuming.
- **Quotation/PI conversion** — when converting a quotation to a PI, items + costing are copied. Edits to a quotation after conversion must not orphan items.
- **Zoho Sign webhook race** — webhook and manual status poll can land out-of-order; signature status reconciliation needs to be idempotent.

---

## 20. Conventions for AI assistants working in this repo

1. **Don't push directly to shared branches.** Commit locally only; wait for the user to say "push" before `git push` or opening a PR.
2. **For port tasks** (HTML prototype → React), pick the fullest faithful implementation and proceed. Don't ask scope/A-or-B questions; don't surface design forks even for bugs encountered mid-port.
3. **The user is a QA engineer**, not a regular developer — they primarily log bugs and don't usually want code-level deep-dives unless asked. Frame explanations from a "where does this feature live and how do I reproduce it" angle when possible.
4. **Multi-tenant safety first** — any new query, controller, or component must respect `client_id` / `branch_id` scoping.
5. **Prefer editing existing files** over creating new ones. Don't add documentation files unless asked.
6. **Don't bypass middleware or hooks** to "make it work." Investigate root causes.
7. **PowerShell is the local shell** — use PowerShell syntax (`$env:VAR`, `$null`, backtick continuation). Bash is also available.

---

*Last updated: 2026-05-27. Regenerate by re-running the codebase survey if the structure shifts materially.*
