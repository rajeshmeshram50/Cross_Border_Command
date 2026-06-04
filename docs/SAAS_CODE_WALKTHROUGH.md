# Cross_Border_Command — Code Walkthrough Documentation

> A guided tour of the codebase: where everything lives, how a request flows through the files, and which file to open for each feature.
> Audience: engineers + QA who need to find the code behind a behaviour.
>
> _Last updated: 2026-06-04._

---

## 1. Repository layout (top level)

```
Cross_Border_Command/
├─ app/                  Laravel backend (controllers, models, services, support)
├─ routes/api.php        ALL API routes (single 865-line file)
├─ database/migrations/  228 migrations
├─ database/seeders/     7 seeders (no factories)
├─ resources/js/         React 19 + TS SPA
├─ resources/views/      welcome.blade.php (SPA shell) + PDF/email Blade templates
├─ public/build/         Vite build output
├─ config/               Laravel config (filesystems, sanctum, services…)
└─ docs/                 QA + reference docs (this file lives here)
```

---

## 2. Backend (`app/`)

```
app/
├─ Http/
│  ├─ Controllers/Api/    65+ controllers — one per domain (see §6 map)
│  ├─ Middleware/
│  │  └─ EnsureUserActive.php   registered as 'user.active'
│  ├─ Requests/            FormRequest validation classes
│  └─ Resources/           API Resource transformers
├─ Models/                 85+ Eloquent models (top-level + Masters/)
├─ Services/               business services (Razorpay, ZohoSign, …)
├─ Support/                helpers + the visibility engine
│  ├─ MasterVisibility.php  ← creator-hierarchy read scope + mutate gate
│  ├─ Settings.php          tenant setting reads
│  ├─ BrandingResolver.php  per-tenant branding
│  └─ MasterBundleCache.php cached dropdown bundles
├─ Mail/                   Mailable classes
└─ helpers.php             globally autoloaded
```

### 2.1 The request path through the files
For `GET /api/customers`:
1. **[routes/api.php](../routes/api.php)** → matches `Route::apiResource('customers', ...)` inside the `auth:sanctum` + `user.active` group.
2. **app/Http/Middleware/EnsureUserActive.php** → rejects disabled users.
3. **CustomerController@index** → resolves `auth()->user()`, applies `Customer::scopeForUser($user)` which calls **MasterVisibility::applyReadScope()**.
4. The Eloquent builder runs against **PostgreSQL**, returns a paginated collection.
5. An **API Resource** (in `app/Http/Resources/`) shapes the JSON → `{ data, meta }`.

For `PUT /api/customers/{id}`: the controller calls **MasterVisibility::hierarchicalDenial()** before saving; a non-null return → 403.

### 2.2 The visibility engine — read it first
[app/Support/MasterVisibility.php](../app/Support/MasterVisibility.php) is the single most important non-obvious file. Two public methods:
- `applyReadScope(Builder $q, $user, ?int $branchFilter)` — what a list returns.
- `hierarchicalDenial(?User $user, $row, string $action): ?string` — whether an edit/delete is allowed.

It's heavily commented inline. The class header doc-block is the canonical spec for who-sees-what. (Full breakdown in [SAAS_TECHNICAL_DOCUMENTATION.md §3](SAAS_TECHNICAL_DOCUMENTATION.md#data-visibility).)

---

## 3. Frontend (`resources/js/`)

```
resources/js/
├─ app.tsx                entry point
├─ api.ts                 Axios client + interceptors (Bearer token, ?branch_id, 401 handling)
├─ constants.ts           feature flags, role/permission enums
├─ types.ts               TS interfaces
├─ components/            shared UI (App.tsx is the root; PermissionMatrix.tsx etc.)
├─ contexts/              Auth, BranchSwitcher, Settings, Confirm, Toast, Layout, Theme, Variant
├─ pages/
│  ├─ auth/               Login, ForgotPassword, VerifyOTP, ResetPassword
│  ├─ dashboard/          Admin/Client/Branch/Employee dashboards
│  ├─ sales/              Sales Matrix + sub-pages
│  │  └─ matrix/          SalesMatrixDetail (6-stage) + stage components
│  ├─ clm/                CLM pages (some render ClmStubPage)
│  ├─ hrms/               HR pages
│  ├─ employee/           employee profile + sub-views
│  ├─ recruitment/        recruitment pages
│  ├─ employee-onboarding/ onboarding pages
│  ├─ products/  vendors/  procurement masters
│  ├─ client/  branch/    tenancy pages
│  ├─ plan/               billing pages
│  ├─ master/             generic master (MasterPage + masterConfigs)
│  └─ (top-level)         ClockIn, Profile, MyTeam, Inbox, Settings, Payments…
├─ hooks/                 e.g. useChartTheme
├─ utils/                 e.g. resolveFileUrl
└─ velzon/                Velzon admin theme (Redux store lives here — theme only)
```

### 3.1 The Axios client — [api.ts](../resources/js/api.ts)
Every business call goes through this single client. Interceptors:
- **request:** add `Authorization: Bearer <token>` from `localStorage`; on GETs, append `?branch_id=<active>` from `BranchSwitcherContext`.
- **response:** on 401, wipe the token, store the error in `localStorage`, redirect to `/login`.
> Business data does **not** go through Redux — only the Velzon theme uses the store. New features use Context + Axios.

### 3.2 Menu & permission gating — [velzon/Layouts/LayoutMenuData.tsx](../resources/js/velzon/Layouts/LayoutMenuData.tsx)
Builds the sidebar from the user's permission flags (`hasAnyHrView` / `hasAnySalesView` / `hasAnyClmView` + `build*SubItems`). A menu shows only if the user has `can_view` on ≥1 leaf under it. Button gating inside pages reads `user.permissions['<leaf>'].can_edit` etc. The matrix UI is [components/PermissionMatrix.tsx](../resources/js/components/PermissionMatrix.tsx) (action ⇒ view auto-tick + lock).

### 3.3 The 6-stage Sales page — [pages/sales/matrix/SalesMatrixDetail.tsx](../resources/js/pages/sales/matrix/SalesMatrixDetail.tsx)
One page renders all six stage sub-forms; each stage posts to its own `/sales/leads/{id}/...` endpoint (Task Manager, acknowledgements, products, shared-prices, shipment-order). See the route↔stage map in [SAAS_API_DOCUMENTATION.md §6](SAAS_API_DOCUMENTATION.md).

---

## 4. Patterns you'll see everywhere

### 4.1 Literal-segment-before-`{id}` routing
Throughout [routes/api.php](../routes/api.php), static paths (`form-bundle`, `next-code`, `stats`, `sync`, `for-party/{party}`, `sent`, `to-approve`) are declared **before** the `{id}` route and `{id}` is `whereNumber`-constrained, so Laravel doesn't capture the literal word as a numeric id (which would 404/405). When adding a route, follow the same ordering.

### 4.2 Step-wise resources
Products and Vendors each save in independent steps: `POST /products/step/core`, `PUT /products/{id}/step/sales`, etc., each with its own `*_status` column. The frontend step UI ([ProductView.tsx](../resources/js/pages/products/ProductView.tsx), [Vendors.tsx](../resources/js/pages/vendors/Vendors.tsx)) saves one step at a time.

### 4.3 Bundle endpoints
Forms fetch all their dropdowns in one round-trip via `*/master-bundle`, `*/form-bundle`, or `*/bootstrap` endpoints (often cached by `MasterBundleCache`). Reduces N round-trips on modal open.

### 4.4 Multipart + `_method=PUT`
File-upload routes register **both** POST and PUT (`Route::match(['post','put'], ...)`) because PHP can't parse multipart bodies on a real PUT — the frontend sends POST + `_method=PUT`. Seen on lead task-manager, WhatsApp, reminders, document updates.

### 4.5 Query-token download routes
Some downloads (payment invoice, candidate CV, expense/advance attachments) live **outside** Sanctum and auth via a query-string token so plain `<a download>` links work regardless of Apache's DocumentRoot.

### 4.6 Generic master CRUD
`MasterController` dispatches ~50 lookup tables by slug (`/master/{slug}`), declared via [masterConfigs.ts](../resources/js/pages/master/masterConfigs.ts) on the frontend and rendered generically by [MasterPage.tsx](../resources/js/pages/master/MasterPage.tsx).

---

## 5. Where to look — symptom → file

| Symptom / question | Start here |
|---|---|
| "User X can't see / edit row Y" | [app/Support/MasterVisibility.php](../app/Support/MasterVisibility.php) (§3 of Technical doc) |
| "Menu item missing for a user" | LayoutMenuData.tsx + PermissionController@savePermissions + [PERMISSIONS_HIERARCHY.md](PERMISSIONS_HIERARCHY.md) |
| "Button (Edit/Delete) missing on a page" | the page's `user.permissions['<leaf>']` checks |
| "401 / got logged out" | api.ts response interceptor |
| "Wrong branch's data showing" | api.ts request interceptor (`branch_id`) + `applySwitcherBranchFilter` |
| "Quotation/PI number duplicated or skipped" | QuotationController / ProformaInvoiceController code allocation (client row lock) |
| "PI code looks wrong" | it's `INV/YYYY-NN/SEQ` by design, not `PI/` |
| "Attendance punch rejected (422)" | AttendanceController alternation check |
| "Face login/clock-in fails" | thresholds: login 0.50 (AuthController@faceLogin), attendance 0.55 (AttendanceController/FaceBiometricController) |
| "Consignee 'Same as Customer' did nothing / 409" | ConsigneeKycMirror service (idempotent) |
| "Zoho status not updating" | ClmSignatureController + webhook race (idempotency) |
| "DOCX token not replaced" | HrTemplateDocxRenderer / CLM renderers |
| "Onboarding link 410 / rate-limited" | OnboardingController + `throttle:30,1` |
| "Plan blocked / redirect to /my-plan" | SubscriptionController + App.tsx plan guard |

---

## 6. Module → controller → page map

| Domain | Controller(s) | Frontend page(s) |
|---|---|---|
| Auth | AuthController, ForgotPasswordController | auth/Login, ForgotPassword, VerifyOTP, ResetPassword |
| Tenancy | ClientController, BranchController | client/, branch/, UsersPage |
| Customers | CustomerController (+CustomerDocument/Owner) | sales/SalesCustomers |
| Consignees | ConsigneeController (+Document/Owner) | sales/SalesConsignee |
| Leads/Sales | SalesLeadController, LeadAckReasonController, SalesTodoController | sales/SalesLeadWorksheet, SalesLeadAckMaster, matrix/SalesMatrixDetail |
| Quotations/PI | QuotationController, ProformaInvoiceController, SalesPdfController | sales/SalesQPI, matrix/* |
| Procurement | ProcurementController, ShipmentOrderController | sales/SalesP2PSummary |
| Products | ProductController | products/Products, ProductView |
| Vendors | VendorController | vendors/Vendors |
| CLM masters | ClmSegment/SegmentRule/Authority/Kyc/Dd/Qc/TradeLicense/TradeDocument/Agreement/Clause/Tnc Controllers | clm/* (some ClmStubPage) |
| CLM signatures | ClmSignatureController | embedded in agreement/trade-doc pages |
| CLM CTC | CtcContractController | clm/* |
| Employees | EmployeeController, EmployeeDocumentController, PreviousEmploymentController, PermissionController | hrms/HrEmployees, employee/EmployeeProfile, EmployeePermissions |
| Attendance | AttendanceController, FaceBiometricController | ClockIn, hrms/HrAttendance |
| Leave | LeaveRequestController, LeavePlanController | hrms/HrLeave, HrLeavePlans, HrLeaveApprovals |
| Expenses/Advances | ExpenseClaimController, AdvanceRequestController | hrms/HrExpenseManagement |
| Recruitment | RecruitmentController, HiringRequestController, CandidateController | recruitment/HrRecruitment, HrCandidates |
| Onboarding | OnboardingController | PublicOnboarding, employee-onboarding/HrEmployeeOnboarding |
| Exit | ExitController | hrms/HrExitManagement |
| HR docs | HrDocumentTemplate/GeneratedDocument/DocumentSignature/CustomField Controllers | hrms/HrDocumentTemplates, HrCustomFields |
| HR overview/team | HrOverviewController, MyTeamController | hrms/HrOverview, MyTeam |
| Announcements | AnnouncementController, NotificationController | hrms/HrBroadcastCentre, Inbox |
| Billing | PlanController, SubscriptionController, PaymentController, RazorpayWebhookController | plan/Plans, AddPlan, PlanSelection, Payments |
| Masters | MasterController, OrganizationTypeController | MasterDashboard, master/MasterPage, OrganizationTypes |
| Settings | SettingsController | Settings, client/ClientSettings |
| Dashboard | DashboardController | dashboard/Admin/Client/Branch/Employee |

---

## 7. How to add a feature (the idioms to copy)

1. **Backend route:** add to [routes/api.php](../routes/api.php) inside the protected group; declare literal segments before `{id}`; `whereNumber` numeric ids.
2. **Controller:** derive `client_id` from `auth()->user()` (never the body); for list/mutate on visibility-scoped models use `scopeForUser` / `MasterVisibility`.
3. **Tenant safety:** new GET → decide branch-scoped or not, handle missing/zero `branch_id`.
4. **Frontend:** call through [api.ts](../resources/js/api.ts); gate buttons via `user.permissions`; follow the dominant UI pattern of nearby files (reactstrap/Bootstrap over Velzon) rather than introducing a new lib.
5. **No business state in Redux** — use Context + Axios.

> See also: [SAAS_API_DOCUMENTATION.md](SAAS_API_DOCUMENTATION.md) · [SAAS_FUNCTIONAL_DOCUMENTATION.md](SAAS_FUNCTIONAL_DOCUMENTATION.md) · [SAAS_TECHNICAL_DOCUMENTATION.md](SAAS_TECHNICAL_DOCUMENTATION.md)
