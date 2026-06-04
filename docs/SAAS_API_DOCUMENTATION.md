# Cross_Border_Command — API Documentation

> Complete REST API reference for the Cross_Border_Command SaaS.
> Source of truth: [routes/api.php](../routes/api.php) (865 lines, single file).
> Audience: QA, integrators, anyone hitting the API directly (Postman / deep-link tests).
>
> _Last updated: 2026-06-04._

---

## 0. How to read this

- **Base URL:** every route below is prefixed with `/api` by Laravel. E.g. `POST /login` is really `POST /api/login`.
- **Local base:** `http://127.0.0.1:8000/api`.
- **Auth:** unless a route is in the **Public** section, you must send `Authorization: Bearer <sanctum_token>`.
- **Branch scoping:** the React Axios client auto-appends `?branch_id=<active branch>` on **every GET**. When testing by hand you can add it manually — but note it is only honoured for roles that can switch branches (super_admin, client_*, main-branch admin). Sub-branch users and employees have it silently ignored (see [Data Visibility](#data-visibility-note)).
- **Response shapes:**
  - Collection → `{ "data": [...], "meta": {...}? }`
  - Single item → `{ "data": {...} }`
  - Validation failure → HTTP **422** `{ "message": "...", "errors": { "field": ["..."] } }`
  - Auth failure → HTTP **401** (frontend wipes token and redirects to `/login`)
  - Tier/permission denial → HTTP **403** with a human-readable `message`

---

## 1. Middleware stack

| Layer | Applies to | Effect |
|---|---|---|
| `auth:sanctum` | everything under the protected group | Rejects missing/invalid bearer token with 401 |
| `user.active` (`EnsureUserActive`) | everything under the protected group | Rejects disabled users |
| `throttle:30,1` | public onboarding routes | 30 req/min/IP brute-force guard on the 64-char token |
| `signed` | public PDF view links | URL signed at email-send time, expires after 60 days; tamper/replay → 403 |

Three route blocks live **outside** Sanctum and authenticate by a **query-string token** instead (so plain `<a download>` links work even when Apache's DocumentRoot isn't `public/`): payment invoice download/view, candidate CV download, expense/advance attachment download.

---

## 2. Public routes (no token)

### Auth
| Method | Path | Controller | Notes |
|---|---|---|---|
| POST | `/login` | AuthController@login | Email + password. Password-history enforced. Brute-force lockout: 5 attempts / 15 min (shared cache key across all 3 login paths, gated by `security.bruteForce` setting). |
| POST | `/login/face` | AuthController@faceLogin | Body carries a 128-d face descriptor. **Login match threshold 0.50** (stricter than attendance's 0.55). |
| POST | `/google-login` | AuthController@googleLogin | Google OAuth; user email must already exist. |
| POST | `/forgot-password/send-otp` | ForgotPasswordController@sendOtp | OTP step 1 |
| POST | `/forgot-password/verify-otp` | ForgotPasswordController@verifyOtp | OTP step 2 |
| POST | `/forgot-password/reset` | ForgotPasswordController@resetPassword | OTP step 3. Old passwords blocked by PasswordHistory. |

### Public onboarding (rate-limited 30/min/IP)
| Method | Path | Controller | Notes |
|---|---|---|---|
| GET | `/onboarding/{token}` | OnboardingController@show | Preview invite. 410 if used/cancelled/expired. |
| POST | `/onboarding/{token}/complete` | OnboardingController@complete | Candidate submits completed profile. |

### Public PDF view (signed, 60-day expiry)
| Method | Path | Controller |
|---|---|---|
| GET | `/sales/quotations/{id}/view` | SalesPdfController@publicViewQuotation |
| GET | `/sales/proforma-invoices/{id}/view` | SalesPdfController@publicViewProformaInvoice |

### Webhook
| Method | Path | Controller | Notes |
|---|---|---|---|
| POST | `/razorpay/webhook` | RazorpayWebhookController@handle | Razorpay calls this; signature-verified inside controller. |

### Query-token routes (outside Sanctum)
| Method | Path | Controller |
|---|---|---|
| GET | `/payments/{payment}/invoice/download` · `/view` | PaymentController |
| GET | `/candidates/{candidate}/cv` | CandidateController@downloadCv |
| GET | `/expense-claims/{id}/attachments/{index}` | ExpenseClaimController@downloadAttachment |
| GET | `/advance-requests/{id}/attachments/{index}` | AdvanceRequestController@downloadAttachment |

---

## 3. Session / account (auth required)

| Method | Path | Purpose |
|---|---|---|
| GET | `/me` | Current user + permissions + client/branch context |
| POST | `/logout` | Revoke current token |
| POST | `/change-password` | In-app password change |
| POST | `/me/branding` | Update personal/tenant branding |
| POST | `/me/profile` | Update own profile |

---

## 4. Dashboard

| Method | Path | Scope |
|---|---|---|
| GET | `/dashboard/admin-stats` | Super-admin cross-client stats |
| GET | `/dashboard/client-stats` | Client-scoped |
| GET | `/dashboard/employee-stats` | Employee self |

---

## 5. Tenancy — Clients & Branches

### Clients
| Method | Path | Purpose |
|---|---|---|
| GET | `/clients/stats` | Counts for the clients dashboard |
| GET | `/clients/form-bundle` | All dropdowns the Client form needs (one round-trip) |
| — | `/clients` (apiResource) | index / store / show / update / destroy |

### Branches
| Method | Path | Purpose |
|---|---|---|
| GET | `/branches/next-code` | Next auto branch code |
| GET | `/branches/form-bundle` | Countries + states + next code |
| — | `/branches` (apiResource) | index / store / show / update / destroy |

> `form-bundle` / `next-code` literal routes are declared **before** the apiResource so they aren't captured as a `{id}`. This pattern repeats across the whole file.

---

## 6. Sales Matrix

The 6-stage opportunity pipeline. (See the Functional doc for what each stage means.)

### Customers (Stage 2 party)
| Method | Path | Purpose |
|---|---|---|
| GET | `/customers/master-bundle` | Dropdowns for Add Customer **and** Add Consignee modals |
| — | `/customers` (apiResource: index/show/store/update/destroy) | Customer CRUD |
| GET/POST | `/customers/{customer}/documents` | DD + Trade Licence docs |
| GET/POST/PUT/DELETE | `/customers/{customer}/documents/{document}` | (POST = file upload, PUT = json-only) |
| GET/POST/PUT/DELETE | `/customers/{customer}/owners[/{owner}]` | Owner-KYC rows |

### Consignees
| Method | Path | Purpose |
|---|---|---|
| — | `/consignees` (apiResource: index/show/store/update/destroy) | Consignee CRUD |
| POST | `/consignees/{consignee}/clone-from-customer` | "Same as Customer" deep-clone of KYC docs + owners. Idempotent — **409** if consignee already has KYC. |
| GET/POST/PUT/DELETE | `/consignees/{consignee}/documents[/{document}]` | DD + Trade Licence docs |
| GET/POST/PUT/DELETE | `/consignees/{consignee}/owners[/{owner}]` | Owner-KYC rows |

### Leads (Stage 1, "My Workplace")
| Method | Path | Purpose |
|---|---|---|
| GET | `/sales/leads` | List / paginate / filter |
| POST | `/sales/leads` | Manual capture (Add New Lead) |
| GET | `/sales/leads/sync/config` | IndiaMart sync config |
| POST | `/sales/leads/sync` | Pull from IndiaMart CRM |
| POST | `/sales/leads/assign` | Assign salesperson |
| POST | `/sales/leads/convert-to-qualified` | Promote |
| GET | `/sales/leads/salespeople` · `/salesperson-summary` · `/filter-options` | Lookups |
| GET/PUT/DELETE | `/sales/leads/{id}` | Show / update / delete |

#### Lead sub-resources (the matrix stage forms)
| Method | Path | Stage | Purpose |
|---|---|---|---|
| POST/PUT | `/sales/leads/{id}/task-manager` | 1 | Task Manager save (multipart attachment) |
| GET/POST | `/sales/leads/{id}/acknowledgements` | 2 | Append-only ACK activity log |
| POST/PUT | `/sales/leads/{id}/whatsapp` | — | WhatsApp status + optional proof |
| GET/POST/PUT/DELETE | `/sales/leads/{id}/products[/{mapping}]` | 3 | Lead ⇄ product mapping |
| PATCH | `/sales/leads/{id}/products/{mapping}/sourcing-status` | 3 | Set sourcing status |
| PATCH | `/sales/leads/{id}/products/{mapping}/mark-sourced` | 3 | Mark sourced |
| POST | `/sales/leads/{id}/products/{mapping}/shared-prices` | 4 | Append price-share |
| GET | `/sales/leads/{id}/shared-prices` | 4 | History |
| GET | `/sales/leads/{id}/products/{mapping}/shared-prices` | 4 | History per product |
| GET | `/sales/shared-prices/{id}/pdf` | 4 | PDF export per entry |
| GET/POST | `/sales/leads/{leadId}/shipment-order` · `/sales/shipment-orders[/{id}]` | 6 | Victory → Shipment Order |

### Lead Acknowledgement Master
| Method | Path |
|---|---|
| GET/POST/PUT/DELETE | `/sales/lead-ack-reasons[/{id}]` (3 buckets: qualified / disqualified / clarity_pending) |

### Quotations
| Method | Path | Purpose |
|---|---|---|
| GET | `/sales/quotations` | List |
| GET | `/sales/quotations/preview-code` | Preview next `QT/YYYY-NN/SEQ` |
| POST/GET/PUT/DELETE | `/sales/quotations[/{id}]` | CRUD |
| POST | `/sales/quotations/{id}/duplicate` | Clone |
| POST | `/sales/quotations/{id}/convert-to-pi` | Convert to Proforma Invoice |

### Proforma Invoices
| Method | Path | Purpose |
|---|---|---|
| GET | `/sales/proforma-invoices` | List |
| GET | `/sales/proforma-invoices/preview-code` | Preview next **`INV/YYYY-NN/SEQ`** code (note: `INV/` prefix, not `PI/`) |
| POST/GET/PUT/DELETE | `/sales/proforma-invoices[/{id}]` | CRUD |
| POST | `/sales/proforma-invoices/from-quotation/{quotationId}` | Build from quotation |
| POST | `/sales/proforma-invoices/{id}/duplicate` | Clone |

### Sales PDFs & email
| Method | Path | Purpose |
|---|---|---|
| POST | `/sales/pi/preview-pdf` | Ad-hoc PI preview from row fields |
| POST | `/sales/quotations/{id}/preview-pdf` | Per-quotation PDF (`signature=1` variant) |
| POST | `/sales/proforma-invoices/{id}/preview-pdf` | Per-PI PDF |
| POST | `/sales/quotations/{id}/email` · `/proforma-invoices/{id}/email` | Email PDF. Body `{ signature?, to? }`. 422 if no recipient. |
| POST | `/sales/quotations/{id}/remind` · `/proforma-invoices/{id}/remind` | Reminder (422 if not emailed yet; increments `reminder_count`) |

### Procurement (Stage 3 → 6)
| Method | Path |
|---|---|
| GET | `/procurements/next-number` |
| GET/POST | `/procurements` |
| GET | `/procurements/{id}` |

### Productivity Tracker (`/sales/todo`)
| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/sales/reminders` | Default = own rows; `?scope=all` = admin view |
| PUT/POST | `/sales/reminders/{id}` | Update (multipart attachment) |
| PATCH | `/sales/reminders/{id}/status` | Status |
| DELETE | `/sales/reminders/{id}` | Delete |
| GET/POST | `/sales/meetings` · `/sales/meetings/next-code` | Meetings |
| PUT/PATCH/DELETE | `/sales/meetings/{id}[/status]` | Update / status / delete |

---

## 7. CLM (Central Legal Module)

### Masters (each a standalone catalogue)
| Method | Path | Master |
|---|---|---|
| GET/POST/PUT/DELETE | `/clm/segments[/{id}]` | Business segments (code `S-001` per tenant) |
| GET/POST/PUT/DELETE | `/clm/authorities[/{id}]` | Authorities (FSSAI, DGFT, BIS…) |
| GET/POST/PUT/DELETE | `/clm/kyc-documents[/{id}]` | KYC catalogue |
| GET/POST/PUT/DELETE | `/clm/dd-documents[/{id}]` | Due Diligence |
| GET/POST/PUT/DELETE | `/clm/trade-licenses[/{id}]` | Trade Licences |
| GET/POST/PUT/DELETE | `/clm/qc-documents[/{id}]` | Quality & Compliance |

### Trade Documents (names + library)
| Method | Path | Purpose |
|---|---|---|
| GET/POST/PUT/DELETE | `/clm/trade-doc-names[/{id}]` | Names catalogue |
| GET/POST | `/clm/trade-doc-library` | Library |
| POST | `/clm/docx-to-html` | Standalone DOCX→HTML preview (no row) |
| POST | `/clm/trade-doc-library/upload-header-logo` | Header logo |
| GET | `/clm/trade-doc-library/for-party/{party}` | Filtered list |
| GET | `/clm/trade-doc-library/{id}/download` | Download DOCX |
| POST | `/clm/trade-doc-library/{id}/upload-docx` | Upload DOCX |
| PUT/DELETE | `/clm/trade-doc-library/{id}` | Update / delete |

### Terms & Conditions / Agreements / Clauses (each: categories/types + library)
| Method | Path |
|---|---|
| GET/POST/PUT/DELETE | `/clm/tnc-categories[/{id}]` · `/clm/tnc-library[/{id}]` |
| GET/POST/PUT/DELETE | `/clm/agreement-types[/{id}]` · `/clm/agreement-library[/{id}]` |
| GET | `/clm/agreement-library/{id}/download` · `/download-pdf` |
| POST | `/clm/agreement-library/{id}/upload-docx` · `/clm/agreement-library/upload-header-logo` |
| GET/POST/PUT/DELETE | `/clm/clause-types[/{id}]` · `/clm/clause-library[/{id}]` |

### Case-to-Case (CTC) Contracts
| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/clm/ctc-contracts` | List / create |
| GET | `/clm/ctc-contracts/sent` · `/to-approve` | The two review queues |
| GET/PUT/DELETE | `/clm/ctc-contracts/{id}` | CRUD |
| POST | `/clm/ctc-contracts/{id}/approve` · `/reject` · `/clarify` · `/respond` | Approval workflow |

### Document Control Panel (segment rules)
| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/segment-rules/bootstrap` | All masters for the Add-Rule modal |
| GET | `/clm/segment-rules/for-segment/{segmentId}` | Rule + referenced KYC/DD/TL/TD/QC rows (pre-populates Stage-2 forms) |
| GET/POST/PUT/DELETE | `/clm/segment-rules[/{id}]` | CRUD |

### Segment-rule reference uploads (Evidence Vault) — polymorphic `{type}` = customer|consignee|supplier
| Method | Path | Purpose |
|---|---|---|
| GET | `/segment-uploads/{type}/{id}/summary` | Docs grouped by category |
| GET | `/segment-uploads/{type}/{id}/vault` | Evidence Vault buckets + KPI counts |
| GET/POST | `/segment-uploads/{type}/{id}` | List / upload |
| DELETE | `/segment-uploads/{type}/{id}/{uploadId}` | Delete |

### Profiles & lead applicability
| Method | Path |
|---|---|
| GET | `/clm/leads/{leadId}/agreement-applicable` · `/clm/buyer-profile` · `/clm/supplier-profile` |

### E-signature (Zoho Sign)
| Method | Path | Purpose |
|---|---|---|
| POST | `/clm/signature-requests/preview` | Render merged PDF without calling Zoho |
| POST | `/clm/signature-requests` | Send |
| GET | `/clm/signature-requests[/{id}]` | List / show |
| POST | `/clm/signature-requests/{id}/remind` · `/recall` | Manage |
| GET | `/clm/signature-requests/{id}/download-file/{index}` · `/view-file/{index}` · `/certificate` | Signed output |
| POST | `/clm/signature-requests/agreement-preview` · `/agreement-send` | Agreement variant |
| POST | `/clm/signature-requests/sales-doc-send` | Sales Matrix Stage-5 Quotation/PI for signing |

> **Race watch:** Zoho's webhook and the frontend's manual status poll can land out of order — status reconciliation must be idempotent.

---

## 8. HRMS

### Employees
| Method | Path | Purpose |
|---|---|---|
| GET | `/employees/next-code` · `/managers` · `/available-assets` · `/check-mobile` | Lookups / uniqueness probe |
| POST | `/employees/onboarding-invite` | Issue + email self-service onboarding link |
| PATCH | `/employees/{id}/restore` | Re-enable soft-deleted |
| DELETE | `/employees/{id}/force` | Permanent delete (Disabled tab only) |
| — | `/employees` (apiResource) | CRUD + auto `EMP-###` + welcome mail |
| GET/POST | `/employees/{employee}/documents` | Stage-2 docs |
| PATCH | `/documents/{document}/verify` · `/reject` | Doc review |
| DELETE | `/documents/{document}` | Delete doc |
| GET/PUT | `/employees/{employee}/exit` | Exit wizard (upsert) |
| GET/POST/PATCH/DELETE | `/employees/{employee}/previous-employments[/{prev}]` | Prior employers |
| GET | `/employees/{slug}/signed-documents` | Per-employee signed docs (id or `EMP-###`) |
| GET | `/employees/{employeeId}/leave-balances` | Profile leave cards |

### Recruitment pipeline
| Method | Path |
|---|---|
| GET/apiResource | `/recruitments/next-code` · `/recruitments` (`REC-###`) |
| GET/apiResource | `/hiring-requests/next-code` · `/hiring-requests` (`HRQ-###`) |
| — | `/candidates` (apiResource) + `/candidates/stats` · `/sample` · `/import` · `/export`; `/recruitments/{recruitment}/candidates/summary`; `PATCH /candidates/{candidate}/status` |

### Attendance & face
| Method | Path | Purpose |
|---|---|---|
| GET | `/face/status` | Enrolment status |
| POST | `/face/register` | Enroll 128-d descriptor (never the raw photo) |
| DELETE | `/face/data` | Revoke |
| GET | `/attendance` · `/attendance/daily-view` · `/attendance/my` · `/attendance/today` | Read views |
| GET | `/attendance/employee/{employeeId}/summary` | Per-employee summary |
| POST | `/attendance/face/clock-in` · `/clock-out` | Punch (match threshold **0.55**) |

> **Invariant:** punch direction alternates strictly (in → out → in…). Two same-direction punches in a row → **422**.

### Leave
| Method | Path | Purpose |
|---|---|---|
| GET/POST/PUT/DELETE | `/leave-plans[/{id}]` | Plan CRUD |
| POST | `/leave-plans/{id}/clone` · `/make-default` | Plan ops |
| POST/DELETE | `/leave-plans/{id}/types[/{typeId}]` · `PUT .../config` | Assign leave types + per-pair Setup |
| POST/DELETE | `/leave-plans/{id}/employees[/{employeeId}]` | Assign employees |
| GET | `/leave-balances` · `/employees/{employeeId}/leave-balances` | Balances |
| GET/POST | `/leave-requests` | Self-service requests |
| GET | `/leave-requests/approvals` · `/colleagues` | HR queue / notify search |
| GET | `/leave-requests/{id}` · `/approvers` | Detail |
| POST | `/leave-requests/{id}/approve` · `/reject` · `/cancel` | Workflow |

### Expenses & advances (two-stage manager → HR/finance)
| Method | Path |
|---|---|
| GET/POST/GET | `/expense-claims[/{id}]` (`?scope=mine\|team\|all`) |
| POST | `/expense-claims/{id}/manager-approve` · `/manager-reject` · `/hr-approve` · `/hr-reject` |
| GET/POST/GET | `/advance-requests[/{id}]` (`?scope=mine\|team\|all`) |
| POST | `/advance-requests/{id}/manager-approve` · `/manager-reject` · `/hr-approve` · `/hr-reject` |

### HR documents
| Method | Path | Purpose |
|---|---|---|
| GET | `/hr-document-templates/stats` · `/next-code` · `/match` | Lookups; `/match` finds Active templates for an employee's category/level |
| POST | `/hr-document-templates/upload-header-logo` · `/{id}/upload-docx` | Uploads |
| GET | `/hr-document-templates/{id}/download` · `/generate` · `/preview` | Render filled DOCX / HTML preview |
| — | `/hr-document-templates` (apiResource) | CRUD |
| GET/POST | `/hr-custom-fields` (+`/stats` · `/known-tokens` · `/validate-tokens`) | User-defined `{{tokens}}` |
| POST/GET | `/hr-generated-documents` (+`/preview` · `/{id}/download`) | One row per template×employee render |
| GET/POST | `/hr-document-signatures` (+ `/inbox`) | Signing-workflow runtime |
| POST | `/hr-document-signatures/{id}/action` · `/reject` · `/cancel` · `/remind` | Signer actions |
| GET | `/hr-document-signatures/{id}/download` · `/download-pdf` | Signed output (after "Completed") |
| POST | `/hr-document-signatures/{id}/email-employee` | Email to subject |

### HR overview, team, announcements, notifications
| Method | Path |
|---|---|
| GET | `/hrms/overview` (KPIs + headcount + trends + joiners) |
| GET | `/my-team/employees` · `/approvals` · `/my-updates` |
| GET/apiResource | `/announcements` (+`/stats` · `/next-code`) |
| GET/POST | `/notifications` · `/unread-count` · `/read-all` · `/{id}/read` |

---

## 9. Procurement masters

### Products (step-wise: Core → Sales → Quality → Vendors)
| Method | Path |
|---|---|
| GET | `/products` · `/products/{id}` · `/products/stats` · `/products/owners` · `/products/master-bundle` · `/products/{id}/vendor-maps` |
| POST | `/products/step/core` |
| PUT | `/products/{id}/step/sales` · `/step/quality` · `/step/vendors` |
| DELETE | `/products/{id}` |

### Vendors (step-wise: Identity → Contacts → KYC → Products)
| Method | Path |
|---|---|
| GET | `/vendors` · `/vendors/{id}` · `/vendors/master-bundle` |
| POST | `/vendors/step/identity` · `/vendors/{id}/step/kyc` · `/step/products` |
| PUT | `/vendors/{id}/step/contacts` |
| DELETE | `/vendors/{id}` |

> Vendor Stage 3 (Trade Documents) is a frontend-only repository view — **no** backend `/step/trade-documents` endpoint.

---

## 10. Masters (generic)

One controller dispatches ~50 master tables by slug.

| Method | Path | Purpose |
|---|---|---|
| GET | `/master-counts` | Active/inactive/total for every master the user can view |
| GET | `/master/{slug}` | List |
| POST | `/master/{slug}` | Create |
| GET | `/master/{slug}/next-code` | Next prefixed code (e.g. `DEPT-001`) |
| GET/PUT/DELETE | `/master/{slug}/{id}` | Show / update / delete |
| — | `/organization-types` (apiResource) | Org types master |

---

## 11. Billing

| Method | Path | Purpose |
|---|---|---|
| — | `/plans` (apiResource) | Plan admin CRUD |
| GET | `/subscription/plans` · `/status` | Tenant-facing |
| POST | `/subscription/create-order` · `/verify-payment` · `/cancel-order` | Razorpay buy flow |
| GET | `/payments/stats` | Stats |
| POST | `/payments/{payment}/send-reminder` | Reminder |
| — | `/payments` (apiResource) | Payment CRUD |
| POST | `/razorpay/webhook` (public) | Automated reconciliation |

---

## 12. Permissions & Settings

### Permissions
| Method | Path | Purpose |
|---|---|---|
| GET | `/modules` | All grantable modules |
| GET | `/permissions/users` | Users the caller may manage (tier-scoped) |
| GET | `/permissions/user/{userId}` | A user's current grants |
| POST | `/permissions/user/{userId}` | Save grants (server forces `can_view=true` on any row with an action flag) |

### Settings
| Method | Path | Purpose |
|---|---|---|
| GET | `/settings` | Read (all auth users — branding/FAQ/Contact render everywhere) |
| PUT | `/settings/{section}` | Update (controller restricts writes to super_admin) |
| POST | `/settings/appearance/asset` | Upload branding asset |

---

## <a id="data-visibility-note"></a>13. Data-visibility note for API testers

Index/list endpoints for Customers, Consignees, Vendors, Products, CLM signature requests and most master data are **not** filtered purely by `client_id`/`branch_id` — they run through the **creator-hierarchy visibility engine** (`App\Support\MasterVisibility`). The same `GET /customers` returns a different row set depending on who's logged in:

| Caller | Sees |
|---|---|
| super_admin | all rows (optionally narrowed by `?branch_id`) |
| client_admin / client_user | all the client's rows + globals |
| **main-branch** branch_user | all the client's rows (every sub-branch + every main-branch employee) |
| **sub-branch** branch_user | globals + client-level + own branch + rows created by the **main-branch admin** — but NOT main-branch employees' rows |
| employee | globals + client-level + **only own rows** + main-branch-admin rows (peer employees hidden from each other) |

Mutate (PUT/DELETE) adds a second gate (`hierarchicalDenial`): own rows always editable; employees can only edit their own rows; otherwise the caller's tier must be ≥ the row's tier (super > client > main-branch > sub-branch). Deep-diving this is the answer to most "why does user X get a 403 / why is the list empty" questions. Full rules in [SAAS_TECHNICAL_DOCUMENTATION.md](SAAS_TECHNICAL_DOCUMENTATION.md#data-visibility) and [SAAS_FUNCTIONAL_DOCUMENTATION.md](SAAS_FUNCTIONAL_DOCUMENTATION.md#data-visibility).

> ⚠️ **Sales Matrix & CLM API endpoints are not yet flag-checked server-side** — the menu/page is hidden on the frontend, but a deep-linked API call isn't blocked. Master data + HR core/documents **are** enforced server-side. Log a separate finding if API-level enforcement matters for a test.
