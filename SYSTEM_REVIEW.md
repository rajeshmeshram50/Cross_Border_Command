   # Cross_Border_Command — System Review & Reference

> Consolidated review notes (2026-06-06). Covers architecture, corrected facts, the full controller map, the database, the BFF question, and the findings/optimization backlog from a deep full-stack review of the Sales Matrix + Zoho Sign flows.

---

## 1. Corrected facts (CLAUDE.md is wrong on these)

Verified against the live system this session:

| # | CLAUDE.md says | Reality | Impact |
|---|---|---|---|
| 1 | DB is **MySQL** (XAMPP) | **PostgreSQL 18.3** (`pgsql`, db `cross_border_command`, 155 tables) | `ilike` & `pg_advisory_xact_lock` in code are valid/active, not bugs |
| 2 | Face login threshold **0.55** | `AuthController::faceLogin` uses **0.50** (attendance *is* 0.55; face dedup is 0.50) | Test cases must use the right threshold per flow |
| 3 | PI codes are **`PI/<FY>/<SEQ>`** | Code emits **`INV/{fy}/{n}`** | Use `INV/` in bug reports |
| 4 | "Zoho posts back" + "webhook-vs-poll race" | **No webhook exists** — status is 100% poll-driven (`?sync=true`) | Real race is poll-vs-poll |
| 5 | ClmBuyerProfile/SupplierProfile are **stubs** | Both are **fully implemented** operational dashboards | — |

---

## 2. Architecture & the BFF question

```
ONE React 19 SPA (resources/js/)
        │  Axios single client (api.ts) — injects Bearer token + branch_id on GETs
        ▼
ONE Laravel 12 API  →  66 controllers (routes/api.php)
        │              auth:sanctum → user.active
        ▼
ONE PostgreSQL DB (155 tables)
```

### Why BFF (Backend-For-Frontend) is NOT applicable here

BFF is for **multiple, structurally-different frontends** each needing differently-shaped data. This system has **exactly one** frontend (the React SPA) against **one** general-purpose API. There is nothing to "shape per client."

Crucially, the benefits a BFF would provide are **already absorbed into the controllers**:
- `CustomerController::show` bundles documents + owners + segment uploads + masters in one response ("eliminates 4 round-trips").
- `SalesLeadController` stamps `can_modify` and flattens creator fields so the SPA doesn't walk relations.
- `prewarmQpiMasters` batch-loads screen masters.

A BFF would be a redundant pass-through that **adds a network hop** — the opposite of what the current load-time problem needs.

**When it would become applicable:** the day a second, differently-shaped client is added (native mobile app, partner/3rd-party portal). Until then, the monolith-API + SPA is the correct, simpler choice.

---

## 3. Controller map (66 controllers)

### Auth & Tenancy
- **AuthController** — login (brute-force lockout 5/15min), `faceLogin` (**0.50**), `googleLogin`, `me`, `changePassword`, `updateProfile`, `updateBranding`, `logout`. Stores password bcrypt + reversible-encrypted copy.
- **ForgotPasswordController** — `sendOtp`→`verifyOtp`→`resetPassword`; 6-digit OTP, 10-min expiry, history block.
- **ClientController** — client CRUD + auto Head-Office branch + client_admin; new clients start `free`.
- **BranchController** — branch CRUD, plan `max_branches` cap, race-safe `BR-###`; deactivate cascades soft-delete.
- **PermissionController** — module grants by role hierarchy; cascades downstream.
- **SettingsController** — super-admin platform config + asset upload; cache-busts on save.
- **OrganizationTypeController**, **DashboardController** (admin/client/employee, 60s cache), **NotificationController**.

### Sales
- **SalesLeadController** — lead backbone, list/filters, IndiaMart sync, stage transitions, products/shared-prices/acks.
- **QuotationController** / **ProformaInvoiceController** — QT/PI CRUD; one-PI-per-opp; mandatory-doc gate; `clients`-row lock + `INV/` codes.
- **SalesPdfController** — DomPDF quotation/PI render + email (currently inline/blocking).
- **SalesTodoController** (reminders/meetings), **LeadAckReasonController**, **ProcurementController**.
- **CustomerController** (tabs fresh/recurring; bundled show), **ConsigneeController** (max 1 "same-as-customer" mirror; cloneFromCustomer = replace).
- **Customer/Consignee Document + Owner** controllers (2MB docs; customer side resyncs mirrors via ConsigneeKycMirror).
- **ShipmentOrderController** — one shipment per opp (unique → 409); tenant-checks lead+PI.

### CLM
- **ClmKyc/Dd/Qc/TradeLicense** — master doc catalogs; delete blocked if referenced.
- **ClmTradeDocumentController** / **ClmAgreementController** — names/types + library tabs; DOCX↔HTML; signed docs lock edit; `applicableForLead`.
- **ClmClauseController** / **ClmTncController** — clause & T&C libraries; CSV segment match; regulatory tier.
- **ClmSegmentController** / **ClmSegmentRuleController** — segments (S-NNN) + DCP rules (one/segment, `doc_selections` JSON M/O).
- **ClmAuthorityController** — regulators (AUTH-NNN).
- **ClmBuyerProfileController** / **ClmSupplierProfileController** — operational pivot dashboards (implemented).
- **CtcContractController** — Case-to-Case contracts; approval workflow; version trail; `{{signature}}` stamp.
- **SegmentDocUploadController** — Evidence Vault polymorphic uploads; `same_as_customer` read-through; `missingMandatoryDocs` powers PI gate.
- **ClmSignatureController** — Zoho Sign: preview/send/agreementSend/salesDocSend/ctcSend, index sync-poll, fetchSignedArtifacts, view/download/certificate, remind/recall.

### HRMS
- **EmployeeController** — lifecycle; `resolveIdParam` (id/emp_code/token); 4-step wizard; asset + login pairing.
- **EmployeeDocument / PreviousEmployment / ExitController / MyTeamController / HrOverviewController**.
- **HrCustomFieldController** (`{{tokens}}`), **HrDocumentTemplateController** (codes per category×role, DOCX), **HrGeneratedDocumentController** (bulk render), **HrDocumentSignatureController** (in-house signing, separate from Zoho).
- **AttendanceController** — multi-punch, strict in/out alternation, face **0.55**.
- **FaceBiometricController** — enroll/revoke, **0.50** dedup.
- **Leave/LeavePlan/ExpenseClaim/AdvanceRequest** — 2-stage manager→HR approvals, query-token attachments.
- **Recruitment/HiringRequest/Candidate/Onboarding** (public 64-char token), **AnnouncementController** (lifecycle auto-promotion).

### Products / Vendors / Billing / Masters
- **ProductController** — step-wise core→sales→quality→vendors.
- **VendorController** — step-wise identity→contacts→kyc→products.
- **PlanController**, **SubscriptionController** (Razorpay order→verify, branch-shrink guard), **PaymentController** (manual + invoice PDF), **RazorpayWebhookController** (signature verify + `lockForUpdate` idempotency + amount-tamper guard).
- **MasterController** — schema-driven CRUD over ~50 models; `{slug}`→model map; system rows locked.
- **DummyItemController** — test scaffold.

---

## 4. Database — 155 tables (PostgreSQL 18.3)

- **Tenancy/core:** clients, branches, users, user_details, permissions, modules, organization_types, platform_settings, client_settings, activity_logs, notifications, sessions, personal_access_tokens, password_histories, password_reset_otps.
- **Sales:** leads, lead_acknowledgements, lead_ack_reasons, lead_products, lead_product_shared_prices, lead_task_managers, quotations(+items), proforma_invoices(+items), procurements(+products), shipment_orders, sales_reminders, sales_meetings.
- **Customers/Consignees:** customers(+addresses/documents/owners), consignees(+addresses/documents/owners).
- **Vendors/Products:** vendors(+addresses/documents/owners/bank_accounts/gst_scrutiny/product_mappings), products, product_qc_records, product_vendor_maps.
- **CLM:** clm_segments, clm_segment_rules, clm_authorities, clm_kyc/dd/qc_documents, clm_trade_licenses, clm_trade_doc_names/library, clm_agreement_types/library, clm_clause_types/library, clm_tnc_categories/library, clm_signature_requests, ctc_contracts, segment_doc_uploads.
- **HRMS:** employees(+documents/exits/onboarding_invites), previous_employments, attendances(+punches), leave_requests, leave_plan_employees/leave_types, expense_claims, advance_requests, recruitments, hiring_requests, candidates, announcements, approval_queue, hr_custom_fields, hr_document_templates, hr_generated_documents, hr_document_signatures.
- **Billing:** plans, plan_modules, payments.
- **Masters:** ~55 `master_*` tables (countries, states, currencies, incoterms, hsn_codes, departments, designations, roles, assets, leave_types, legal_entities, bank_accounts, warehouse/racks/shelves/zones/freezers, risk_levels, …).
- **Infra:** migrations(249), jobs, failed_jobs, job_batches, cache, seeder_runs.

> The `jobs` table has pending rows — the DB queue is in use; ensure `queue:listen` is running.

---

## 5. Findings & optimization backlog (Sales Matrix + Zoho)

### Security (fix first)
- **S1 (High):** `product_id`/`customer_id`/`consignee_id` validated with bare `exists:` (no client_id) → foreign-tenant customer/product can be attached to a lead. Scope `exists` rules to `client_id`.
- **S2 (High):** `salesperson_id`/`assign_id` not tenant-scoped → assign lead to another tenant's user.
- **S4 (Med):** signed-PDF folder keyed by model name only (not client_id) → cross-tenant file exposure via slug match.
- **S5 (Med):** dompdf PHP execution enabled for agreement renders → confirm body sanitized of `<script type="text/php">` (RCE-class if content is lower-trust editable).
- **S6 (Med):** raw Zoho/exception messages returned to client.

### Load time (Stage 5 = ~20 requests to paint)
- **P1 (High):** dynamic-import `xlsx`/`file-saver` (currently eager in Stage5 chunk).
- **P2 (High):** parallelize the 3-hop fetch waterfall (`Promise.allSettled` after header).
- **P3 (High):** dedupe the duplicate customer/consignee vault fetches (parent + Stage5).
- **P4 (High):** first-load `sync=0` + pause the 20s Zoho poll on `document.hidden`.
- **P5 (High):** queue the inline DomPDF render + email (`ShouldQueue`).
- **P6–P11 (Med):** indexed `MAX()` code allocation; trim PI doc-gate queries; narrow `clients` lock; paginate unbounded `->get()`; move 54KB/15KB inline `<style>` to CSS; shared `useLeadProducts` hook.

### Zoho Sign integrity
- **Z1 (High):** orphaned Zoho request if local save fails after submit (signer emailed, no record). Wrap + compensating recall.
- **Z2 (High):** no server-side duplicate-send guard (`supersedePending()` exists but unused).
- **Z3/Z4 (Med):** silent signature mis-placement on role-bind failure; positional doc-id zip assumes Zoho preserves upload order.
- **Z5 (Med):** concurrent polls double-download signed PDFs (`time()` filenames).

### Correctness
- **B1 (High):** lead filter stage map offers stage 8 / mislabels 6 → "Victory" filter matches nothing.
- **B2 (Med):** `nextOppCode` uses `count()+1` → collides with soft-deleted leads.
- **F1 (High):** PriceSharedModal unkeyed fragment in `.map()`.
- **F2 (Med):** ChangeOwnerModal is fully mocked but fires a fake "Owner updated" toast.
- **F3 (Med):** Stage3 dead readiness/flash/blocked-button code.
- **F4 (Med):** Stage3/4 don't `await reloadLead()` before `onNext()`.
- **F5 (Med):** no request cancellation on rapid lead navigation.

---

## 6. Multi-tenant external-integration design (proposed)

### Current state
External APIs (Zoho Sign, Razorpay, Google OAuth, IndiaMart) use **global, single-credential** config — every service reads `config('services.<provider>')` from `.env`. All tenants share one external account per provider. There is **no per-client credential layer**.

This is correct for *platform-owned* services (Razorpay billing — clients pay the platform), but cannot support "each client signs from their own Zoho org / uses their own 3rd-party account."

### The gap
- Cannot give Client A its own Zoho org and Client B a different one.
- Cannot let a client bring their own API account/keys.
- No structured way to add provider variety (e.g. DocuSign vs Zoho) per client.

### Proposed: per-tenant credentials store
A table `tenant_integrations`:

| column | purpose |
|---|---|
| `client_id` | FK → clients |
| `provider` | enum: zoho, razorpay, docusign, … |
| `credentials` | JSON, **encrypted at rest** (Laravel `encrypted` cast) |
| `enabled` | bool |
| `verified_at` | set after a successful test call |

One row per (client × provider). Never expose `credentials` in API responses.

### Proposed: tenant-aware service resolution
Replace constructor-time global config with a per-client factory that falls back to the platform default:
```
ZohoSignService::forClient($clientId)
    → load tenant_integrations row (encrypted creds)
    → if none/disabled → use platform default config('services.zoho')
```
Backward-compatible: clients without their own keys keep using the shared account. Small refactor (factory / scoped container binding); controllers pass the active `client_id`.

### Provider variety (adapter/registry)
For "different customers need different APIs," use a common interface + registry:
```
interface SignatureProvider { preview(); send(); status(); download(); }
   ZohoSignProvider implements SignatureProvider
   DocuSignProvider implements SignatureProvider
Registry::signatureProviderFor($clientId)  // returns the client's active provider
```
Controllers depend on the interface, not on Zoho. Add a provider without touching controllers.

### Access control — "how we resist" (3-level funnel)
All three layers already exist; wire integrations into them:
```
Plan (PlanModule ↔ Module)  →  ClientSetting feature flag  →  Permission (per-user)
   "integration available      "tenant has it enabled"        "this user may configure/use it"
    on this plan tier"
```
- **Plan gate** decides *which tenants can buy* the integration.
- **ClientSetting** is the per-tenant on/off switch.
- **Permission** restricts *which users in the tenant* can touch it.

Any integration (existing or new) plugs into this same funnel.

### Security notes
- Encrypt `credentials` at rest; decrypt only inside the service.
- Validate keys with a test call before `verified_at`.
- Never return raw credentials; mask in the settings UI.
- Per-tenant resolution must derive `client_id` from `auth()->user()`, never the request body (same rule as everywhere else).
