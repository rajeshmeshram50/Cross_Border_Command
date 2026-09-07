# Cross_Border_Command — Technical Project Summary

> **Audience:** senior developer / AI assistant doing architecture and development planning.
> **Generated:** 2026-09-05, from a direct survey of the working tree, the live PostgreSQL
> schema, and the deployment configs in `deploy/`.
> **Secrets policy:** no credential, key, token or `.env` value appears in this document.
> Where a value would be sensitive it is written `[REDACTED]`. Only configuration *key names*
> and non-secret driver names are listed.

---

## 0. How to read this document

Numbers in this report were **measured**, not estimated. Where a claim comes from a
document rather than from code it is marked *(doc claim — unverified)*. Several
statements in the repo's own `CLAUDE.md` are **wrong** and are corrected here; those
corrections are flagged **[CORRECTS CLAUDE.md]** so you do not plan against stale facts.

---

## 1. PROJECT OVERVIEW

| Field | Value |
|---|---|
| **Project name** | Cross_Border_Command (deployed as `cbc.idims.in`) |
| **Purpose** | Multi-tenant SaaS ERP for cross-border trade (export/import) businesses. One app covering Sales pipeline, Legal/Compliance (CLM), HRMS + Payroll, Procure-to-Pay, and subscription Billing. |
| **Frontend** | React 19 + TypeScript 6, Vite 7, React Router 7, Redux Toolkit 2 (theme state only), Bootstrap 5.3 + reactstrap + Tailwind 4 (mixed), Velzon admin template |
| **Backend** | PHP 8.2+, Laravel 12, Sanctum 4 token auth, Laravel Reverb 1.10 (WebSockets) |
| **Database** | **PostgreSQL** on port 5432 — **[CORRECTS CLAUDE.md]** which says MySQL/XAMPP. `DB_CONNECTION=pgsql`. This matters: PG advisory locks, `ILIKE`, strict GROUP BY and different JSON operators all actually apply. |
| **Major third-party services** | Razorpay (billing), Zoho Sign (e-signature), **Zoho Books (live PO/invoice sync)**, Google OAuth (login), IndiaMart (inbound lead sync), Azure Blob (storage), eSSL/ZKTeco biometric terminals (attendance push), SMTP mail |
| **Deployment** | Self-managed Linux VM at `/var/www/html/Cross_Border_Command`, Supervisor-managed queue + Reverb, Cloudflare in front for DNS/TLS |

### Measured size

| Metric | Count |
|---|---|
| API controllers | 100 (95 in `Api/`, plus `Api/P2p/`) |
| Eloquent models | 178 |
| Services | 15 |
| Migrations | **446** — **[CORRECTS CLAUDE.md]** (says 228) |
| API route declarations | 659 |
| Frontend TS/TSX files | 479 |
| Frontend LOC | ~311,600 |
| Backend LOC (`app/`) | ~109,500 |
| DB tables (live) | 195 |
| Foreign keys (live) | 272 |
| Indexes (live) | 783 |
| Registered permission modules | **172** |

---

## 2. PROJECT STRUCTURE

### Frontend (`resources/js/`)

```
app.tsx                 entry point
api.ts                  Axios client + interceptors (auth token, branch_id, 401 handling)
constants.ts            feature flags, role/permission enums
types.ts                shared TS interfaces
components/             shared UI; App.tsx is the router root
contexts/               Auth, BranchSwitcher, Settings, Confirm, Toast, Layout, Theme, Variant
hooks/  utils/          useChartTheme, resolveFileUrl, etc.
velzon/                 Velzon admin theme (Redux store lives here — theme only)
pages/
  auth/ dashboard/      login + 4 role dashboards
  sales/                opportunity-pipeline/, core-masters/ (customer, consignee)
  clm/                  operations/, document-masters/  (CtcRichEditor + CtcLivePreview live here)
  hrms/                 attendance, leave, payroll, exit, doc-templates/
  employee/ recruitment/ employee-onboarding/
  p2p/                  p2p-master-management/, purchase, supplier
  products/ vendors/ client/ branch/ plan/ master/
```

### Backend (`app/`)

```
Http/Controllers/Api/       100 controllers
Http/Controllers/Concerns/  shared traits — HandlesDocxHtmlRoundtrip (DOCX/HTML round-trip)
Http/Middleware/            EnsureUserActive ('user.active'), ProfileRequest (opt-in profiler)
Http/Requests/              FormRequest validation
Http/Resources/             API resource transformers
Models/                     178 models (top-level + Models/Masters/)
Services/                   15 (see below)
Support/                    27 helper/policy classes — the real business-rule layer
Console/Commands/           4 artisan commands
Jobs/                       3 (all Zoho document attachment)
Listeners/                  1 (LogSentEmail)
Mail/                       19 mailables
```

### Key services (`app/Services/`)

`AttendancePunchService`, `EsslAttendanceImporter`, `PayrollService`, `PayslipPdfService`,
`HrTemplateDocxRenderer`, `ZohoSignService`, `ZohoBooksService`, `RazorpayService`,
`IndiaMartLeadSyncService`, `ConsigneeKycMirror`, `PoTncResolver`, `InvoiceMailer`,
`AnnouncementMailer`, `DatabaseBackupService`, `LogoDarkVariantGenerator`.

### Key `app/Support/` policy classes (easy to miss, high leverage)

`MasterVisibility` (the data-scoping engine), `ModuleDependencies` (permission dependency
graph), `SalesVisibility`, `ClmMasterAccess`, `SegmentGuard`, `ProbationGuard`,
`NoticePeriodGuard`, `OnboardingGuard`, `ExitInProgress`, `SandwichPolicy`, `WeekOff`,
`PositionHierarchy`, `DocumentNumber`, `SignerResolver`, `Gst`, `BankDetails`,
`MasterBundleCache`, `ApiUsageScanner`.

### Routes

| File | Contents |
|---|---|
| `routes/api.php` | 659 route declarations — one flat file. Public block at top, everything else under `['auth:sanctum','user.active']` |
| `routes/web.php` | SPA catch-all + **public `/iclock/*` biometric device endpoints** |
| `routes/channels.php` | one private broadcast channel: `clm.approvals.{clientId}` |
| `routes/console.php` | scheduler definitions |

**Public (unauthenticated) API surface — the whole list:**
`/onboarding/{token}` (GET + `/complete`, throttle 30/min) ·
`/login`, `/login/face`, `/google-login`, `/forgot-password/{send-otp,verify-otp,reset}` (throttle 20/min) ·
`/razorpay/webhook` · four `signed`-middleware PDF viewers (quotation, PI, PO, debit note) ·
`/announcements/{id}/attachment` · `/iclock/*` (throttle 120/min, guarded by device serial).

### Important configuration files

`bootstrap/app.php` (middleware aliases, CSRF exemptions, Reverb wiring), `config/dompdf.php`,
`config/filesystems.php`, `config/logging.php`, `config/sanctum.php`, `vite.config.ts`,
`deploy/queue-supervisor.conf`, `deploy/reverb-supervisor.conf`.

### Queue / cron / background

| Item | Reality |
|---|---|
| Queue driver | `database` (no Redis — `REDIS_*` keys exist but `CACHE_STORE` / `QUEUE_CONNECTION` / `SESSION_DRIVER` are all `database`) |
| Queue worker | Supervisor config **exists** (`deploy/queue-supervisor.conf`, 2 procs, `--tries=3 --max-time=3600`). **Locally there are 4 rows sitting in `jobs` and 0 in `failed_jobs` — i.e. nothing is draining them.** Verify it is actually RUNNING in production. |
| Queued jobs | Only 3 job classes, all Zoho attachment (`AttachPoDocumentToZoho`, `AttachSpiDocumentToZoho`, `AttachDebitNoteDocumentToZoho`). Mail is largely sent **inline**. |
| Scheduler | `hr:send-probation-emails` daily 09:40; `backup:email` daily 02:00. Requires an OS cron running `schedule:run` — confirm it exists. |
| WebSockets | Laravel Reverb on port 8085 under Supervisor; only used for CLM approvals so far. `BROADCAST_CONNECTION=log` locally. |
| IndiaMart lead sync | **Manual** (`SalesLeadController::syncFromCrm`), not scheduled. |
| Zoho Sign status | **Poll-only — there is no Zoho webhook route.** Status advances on `index`/`show` reads plus a frontend `setInterval`. **[CORRECTS CLAUDE.md]** which describes a "webhook race". |

---

## 3. MODULES

172 modules are registered in the `modules` table and drive both the menu and the permission
matrix. Grouped:

| Group | What it does |
|---|---|
| **Sales Matrix** (`sales.*`, 19 modules) | 6-stage opportunity pipeline: Inquiry → Acknowledgement → Product Sourcing → Price Shared → Quotation/PI → Victory. Customers, Consignees, lead distribution, enquiries, workplace, sign tracker, analytics. |
| **CLM** (`clm.*`, 25 modules) | Segment-driven compliance. Catalogues: KYC, Due Diligence, QC, Trade Licenses, Trade Documents, Agreements, Clauses, T&C. DCP rule engine (`ClmSegmentRule`) decides required docs per segment × party type. Zoho Sign e-signature. Regulatory Defense File, Diagnosis & Resolution. |
| **HRMS** (`hr.*`, 26 modules) | Full lifecycle: Hiring Request → Recruitment → Candidate → Onboarding (public token form) → Employee master → PIP → Exit. Attendance (face + eSSL device + manual + regularization), Leave (plans, requests, approvals), Holiday, Expense & Advances, Broadcast Centre, Document Templates + generation + signature, Custom Fields, HR Reports. |
| **Payroll** (`hr.payroll`) | Salary structures → payroll cycles → runs → payslips → disbursement + Full-and-Final. **Missing from CLAUDE.md's module map entirely.** |
| **P2P / Procure-to-Pay** (`p2p.*`, 15 modules) | Supplier & product management (step-wise onboarding), bulk + case-to-case sourcing, Purchase Order, Supplier Purchase Invoice, Debit Note, payments, P2P analytics, **live Zoho Books sync**. |
| **Masters** (`master.*`, ~60 modules) | Schema-driven generic CRUD (`MasterController` + `masterConfigs.ts`) over ~50 lookup models: geography, commerce, classifications, finance, trade, HR, inventory/warehouse, risk & rules, overtime rates. |
| **Billing** (`plans`, `payments`) | Razorpay plans/subscriptions, module gating, webhook reconciliation, manual payments. |
| **Tenancy & Admin** | Clients, Branches, Users, Permissions, Settings, Profile, Credentials Vault, Project Navigator, **Dev Tools** (load-testing/profiling UI). |
| **Other** | GTS (E-Docs), Inventory Management, Shipment 360 / Operations, Dashboard (4 role variants). |

**Known stubs:** several CLM pages still render `ClmStubPage.tsx` (analytics, buyer/supplier
profile, case-to-case, agreements-sent, agreements-to-approve). Do not assume those work.

---

## 4. MODULE DEPENDENCIES

The dependency graph is **codified**, not folklore — see `app/Support/ModuleDependencies.php`
(mirrored to the frontend in `moduleDependencies.ts`). Granting a module auto-grants
`can_view` on its feeders.

```
Client ──> Branch ──> User ──> Permission
                        │
                        └──> Employee (hr.employee)
                                │
   Masters (departments, roles, designations, shifts, leave types, holiday groups)
       │                        │
       ▼                        ▼
  Recruitment ──> Candidate ──> Onboarding ──> Employee ──> PIP ──> Exit
                                                  │                  │
                                                  ├──> Attendance ───┤  (eSSL device / face / manual)
                                                  │       │          │
                                                  │       ▼          ▼
                                                  ├──> Leave ──> Leave Approvals
                                                  ├──> Holiday / WeekOff
                                                  ├──> Expense + Advance
                                                  └──> Salary Structure
                                                          │
        Attendance + Leave + Holiday + Expense + Advance ─┴──> PAYROLL ──> Payslip ──> Disbursement / FnF

Segment (CLM) ──> DCP rules ──> {KYC, DD, QC, Trade License} ──> Customer / Vendor / Consignee
                                          │
Customer ──> Consignee (ConsigneeKycMirror deep-copies KYC)
   │
   ▼
Lead ──> LeadProduct + SharedPrice ──> Quotation ──> Proforma Invoice ──> Victory
                                            │              │
                                            │              └──> Procurement ──> ShipmentOrder
                                            ▼
                        Clause Library + T&C + Agreement templates ──> Zoho Sign

Vendor ──> Product ──> Sourcing ──> Purchase Order ──> SPI ──> Debit Note ──> PO/SPI Payment
                                          └──────────> Zoho Books (live push)

Plan ──> PlanModule ──> Module ──> Permission gating ──> every screen above
```

**Critical chain to remember:** `Employee → Attendance → Leave → Payroll`. Payroll reads a
**stored snapshot** of attendance columns on the payslip, not live attendance — so
regenerating a run is required after any attendance correction.

---

## 5. DATABASE

- **Type:** PostgreSQL (`pgsql`, port 5432). 195 tables, 272 FKs, 783 indexes.
- **Migrations:** 446 files. A large share are patch/fix/index migrations layered on earlier
  ones — schema archaeology is expensive.

### Important tables

**Tenancy:** `clients`, `branches`, `users`, `permissions` (540 rows locally), `modules`, `plans`, `plan_modules`, `payments`, `subscriptions`
**HR:** `employees`, `employee_documents`, `previous_employments`, `hiring_requests`, `candidates`, `employee_onboarding_invites`, `employee_exits`
**Time:** `attendances` (parent), `attendance_punches` (per-tap), `attendance_regularizations`, `leave_plans`, `leave_requests`, `holidays`, `holiday_groups`, `device_terminals`
**Payroll:** `salary_structures`, `payroll_cycles`, `payroll_runs`, `payslips`, `payroll_adjustments`, `payroll_payments`
**Sales:** `leads`, `lead_products`, `lead_product_shared_prices`, `lead_task_managers`, `quotations`, `quotation_items`, `proforma_invoices`, `proforma_invoice_items`, `customers`, `consignees`, `procurements`, `shipment_orders`, `sales_meetings`
**CLM:** `clm_segments`, `clm_segment_rules`, `clm_kyc*`, `clm_dd*`, `clm_qc*`, `clm_trade_licenses`, `clm_trade_documents`, `clm_agreements*`, `clm_clauses`, `clm_tncs`, `clm_signature_requests`, `ctc_contracts`
**P2P:** `vendors`, `products`, `p2p_sourcing_products`, `purchase_orders`, `supplier_purchase_invoices`, `debit_notes`, `*_payments`
**Infra:** `jobs`, `failed_jobs`, `cache`, `sessions`, `personal_access_tokens`, `notifications`

### Multi-tenancy columns (measured)

| Column | Tables carrying it |
|---|---|
| `client_id` | **144** |
| `branch_id` | **133** |
| `deleted_at` (soft deletes) | **57 only** — i.e. ~140 tables hard-delete |
| Indexes mentioning `client_id` | 219 |

### Main relationships

`clients 1─n branches 1─n users 1─1 employees` ·
`employees 1─n attendances 1─n attendance_punches` ·
`leads 1─n quotations 1─n quotation_items` · `quotations 1─n proforma_invoices` ·
`customers 1─n consignees` · `vendors n─n products` ·
`payroll_runs 1─n payslips` · `plans n─n modules` via `plan_modules`.

### Foreign-key gaps

272 FKs across 195 tables is thin. Prior audits found **masters, payroll and several HR tables
carry no DB-level FKs at all** — referential integrity is enforced in PHP only. Consequence:
orphan rows are possible, and a bad delete will not be blocked by the database.

### High-traffic / growth tables

`attendance_punches` and `attendances` (grow per employee per day, and the eSSL device pushes
continuously) · `notifications` · `sessions` · `cache` · `jobs` · `personal_access_tokens`
(tokens never expire — see Security) · `leads` (IndiaMart sync) · `payslips`.

Local counts are tiny (487 attendances, 681 punches, 340 leads, 30 customers, 13 employees), so
**no production load characteristics can be inferred from this dataset** — plan a real load test.

### Likely DB performance problems

1. **`applyScope()` is duplicated across ~17 controllers** instead of a global scope or trait — inconsistent scoping and no single place to optimise.
2. Only **17 `paginate()` calls versus 262 `->get()`** in controllers — most list endpoints return the whole table.
3. Missing composite indexes for the real access pattern `(client_id, branch_id, <date>)` on attendance/leads.
4. Hard deletes on most of the sales pipeline (no `deleted_at`) — no recovery, and cascading orphans.
5. `cache`, `sessions`, `jobs` all in Postgres — every cache read is a DB round trip.

---

## 6. API

### Groups

`/api/login|login/face|google-login|forgot-password/*` · `/api/clients|branches|users|permissions` ·
`/api/master/{key}` (generic) · `/api/sales/*` (leads, quotations, proforma-invoices, todo, pdf) ·
`/api/customers|consignees` (+ nested `/documents`, `/owners`) · `/api/clm/*` (segments, rules,
kyc, dd, qc, trade-licenses, trade-docs, agreements, clauses, tnc, signatures) ·
`/api/employees|attendance|leave-requests|leave-plans|expense-claims|advance-requests|payroll|exit` ·
`/api/hr-document-templates|hr-generated-documents|hr-custom-fields` ·
`/api/p2p/*` (sourcing, purchase-orders, spi, debit-notes, payments) ·
`/api/plans|subscriptions|payments|razorpay/webhook` · `/api/dev-tools/*` · `/iclock/*` (web root).

Conventions: `apiResource` + extra verbs (`/duplicate`, `/convert-to-pi`, `/approve`, `/reject`,
`/sync-from-crm`); step-wise `POST|PUT /<resource>/step/<step>`; 422 with `errors` keyed by field.

### Authentication

Three paths, all issuing the same Sanctum token: email+password, face descriptor
(`face-api.js` 128-d, matched server-side), Google OAuth. Token stored in `localStorage`.
**No refresh token.** OTP reset flow (`send-otp` → `verify-otp` → `reset`) with password-history
enforcement. Brute-force lockout: 5 attempts / 15 min on a shared cache key across all three
login paths — **gated by a `security.bruteForce` setting that defaults OFF**.

> **[CORRECTS CLAUDE.md]** Face threshold is **0.50 for login**, 0.55 for attendance — not 0.55 everywhere.
> **[CORRECTS CLAUDE.md]** Idle timeout is not 30 min; the code value is hours and only fires if the Security → session-timeout toggle is on.
> **[CORRECTS CLAUDE.md]** Proforma Invoice codes use the **`INV/`** prefix, not `PI/`. Quotation `QT/` is correct.

### Authorization

Two independent layers:

1. **`Permission`** — per-user, per-module `can_view / can_add / can_edit / can_delete`. Any
   action flag implies `can_view` (enforced in UI, API and a backfill). Dependencies
   auto-granted via `ModuleDependencies`.
2. **`ClientSetting` feature flags** — gate whole modules per tenant.

Plus **`MasterVisibility::scopeForUser()`** — a creator-hierarchy data-scoping engine. Note: the
"main branch" concept was **removed** (2026-06-20); branches are now equal isolated peers and the
branch switcher is **client-admin only**.

### External APIs

Razorpay, Zoho Sign, **Zoho Books** (org id `[REDACTED]`, live PO push), Google OAuth,
IndiaMart (3 tenant keys, all `[REDACTED]`), Azure Blob, SMTP.

### Heavy / slow endpoints (identified)

- `GET /attendance/employee/{id}/summary` — builds a full month per employee, resolving shift windows, holidays, leave sets, punches and segments per day.
- `POST /hr-document-templates/preview-live` and the CLM `preview-live` triple — synchronous dompdf render per debounce.
- `SalesPdfController` (2,794 LOC) — PDF composition inline in the request.
- `PayrollController::generate` (2,345 LOC) — whole-cycle generation, previously flagged as running **without a lock**.
- `EmployeeController` (4,101 LOC) and `ClmSignatureController` (3,806 LOC) — the two largest; both do multi-entity assembly per request.

---

## 7. CLOUD / LIVE ENVIRONMENT

| Layer | Reality |
|---|---|
| **Host** | Self-managed Linux VM, app root `/var/www/html/Cross_Border_Command`, run as **root** in both Supervisor configs |
| **Domain / TLS** | `cbc.idims.in`; TLS via **Cloudflare** (free plan, nameserver delegation) per `docs/GO_LIVE_HTTPS.md`. HTTPS was mandatory because browsers refuse camera access on plain HTTP (face attendance). |
| **Frontend deploy** | Not separately hosted. `npm run build` → Vite → **`public/build/`** (**[CORRECTS CLAUDE.md]** which says `resources/dist/`), served by the same web server through the SPA blade view. Current build output ≈ **33 MB** on disk. |
| **Backend deploy** | Laravel served by the web server on the same box (nginx/apache — not pinned in-repo). No Docker, no Procfile, **no CI/CD config anywhere** (`.github/`, `.gitlab-ci.yml`, `Jenkinsfile` all absent). Deploys are manual. |
| **Database** | PostgreSQL, port 5432. Backups via the `backup:email` artisan command using `PG_DUMP_PATH`, emailed to `BACKUP_EMAIL_RECIPIENTS` (daily 02:00). |
| **Storage** | Local `public` disk by default (`FILESYSTEM_DISK=local`); Azure Blob configured as an alternative disk. Files stored as `/storage/...` paths, resolved client-side by `resolveFileUrl.ts`. |
| **Queue workers** | Supervisor `queue-worker` ×2, `--tries=3 --max-time=3600`, hourly recycle. Config exists in-repo; **must be verified as RUNNING** — if it is not, queued mail silently never sends while the API still returns success. |
| **WebSockets** | Supervisor `reverb` on `0.0.0.0:8085`. |
| **Cron** | Requires OS-level `schedule:run` every minute. Not represented in the repo — **verify on the box**. |
| **Reverse proxy** | Cloudflare → web server. No nginx/apache config committed. |
| **CI/CD** | **None.** |
| **Monitoring / logging** | Laravel `stack`/`single` file logs in `storage/logs/`, plus `queue-worker.log` and `reverb.log`. `LogSentEmail` listener records outbound mail. `ProfileRequest` middleware gives opt-in per-request SQL profiling (local/staging only). Health endpoint `/up`. **No APM, no error tracker (Sentry etc.), no uptime monitor, no metrics.** |

---

## 8. PERFORMANCE

### Measured signals

| Signal | Count | Reading |
|---|---|---|
| `->with(` in controllers | 153 | eager loading is used, but unevenly |
| `->load(` | 88 | lazy-eager after the fact |
| `->get()` in controllers | 262 | unbounded fetches |
| `paginate(` | 17 | **only ~6% of list endpoints paginate** |
| `Cache::` usages | 85 | some caching, all on the DB cache store |
| `DB::transaction` | 137 | good transactional discipline |
| `lockForUpdate` | 62 | row locks used for code sequences |
| `dispatch(` | 2 | **almost nothing is queued** |
| `->chunk(` | 1 | bulk operations load everything into memory |
| `React.lazy` | 119 | code-splitting **is** in place |
| `: any` in TS | 1,765 | weak typing surface |

### Problems

1. **N+1 risk is structural, not incidental** — `applyScope()` duplicated ×17 means each controller decides its own eager-loading. Use `X-Profile: 1` (see §12) to get the query count per endpoint; that header exists precisely for this.
2. **Unbounded list responses** — 262 `->get()` vs 17 `paginate()`. With 3 clients and 30 customers this is invisible; at 100 tenants it is the first thing to fall over.
3. **Synchronous PDF/DOCX generation** — dompdf and PhpWord run inside the request. Measured: a template PDF render is 0.23–0.42s for 10–200 paragraphs, but a template containing an unreachable **remote image** stalled the request for up to 60s (dompdf inherited PHP's `default_socket_timeout`; now capped at 5s in `config/dompdf.php`).
4. **Mail is sent inline** — only 2 `dispatch()` calls exist. SMTP latency is charged to the user's request.
5. **Cache/session/queue all on PostgreSQL** — no Redis. Every cache hit is a query; the `jobs` table is polled.
6. **Frontend weight** — 33 MB build output; single files of 8,847 / 8,519 / 7,571 LOC (`HrEmployeeOnboarding`, `AddConsigneeModal`, `SalesQPI`). `React.lazy` helps routing but these monoliths still dominate their chunks.
7. **Memory/CPU** — `previewLive` raises `memory_limit` to 512M and `set_time_limit(60)` per call; concurrent previews multiply that. Payroll generation and PDF export are the CPU spikes.

### Queue opportunities (highest value first)

All outbound mail · PDF/DOCX generation and delivery · payroll run generation · eSSL bulk
import · IndiaMart lead sync · Zoho Books push (already partly queued).

---

## 9. SECURITY

### Current architecture

- **Authentication:** Sanctum bearer tokens in `localStorage`; 3 login paths; OTP password reset with history checks; brute-force lockout (5/15 min, shared key) **defaulting to OFF**.
- **Authorization:** `Permission` matrix (172 modules × 4 flags) + `ClientSetting` feature flags + `MasterVisibility` creator-hierarchy scoping + guard classes in `app/Support/`.
- **Multi-tenancy:** `client_id` on 144 tables, `branch_id` on 133; controllers derive `client_id` from `auth()->user()`, never the request body.
- **API security:** `auth:sanctum` → `user.active` (re-validates user/tenant on every request, so deactivation takes effect immediately). Auth endpoints throttled 20/min, onboarding 30/min, device push 120/min. Signed URLs for public PDF views. CSRF exempted only for `/iclock/*`.
- **File security:** documents on the public disk, referenced by path; Azure available.
- **Dev endpoints:** `/dev/*` seeding routes are wrapped in `app()->environment(['local','staging'])` so they 404 in production — good pattern. The previously-public `dummy-items` CRUD scaffold **has been removed**.

### Risks (ordered)

1. **CRITICAL — reversible password storage.** `users.password_encrypted` holds tenant-admin passwords via `Crypt::encryptString`, and `ClientController::show` returns `password_plain`. Access is now restricted to `user_type === 'super_admin'`, but the design means **anyone holding `APP_KEY` plus a DB dump recovers real passwords in cleartext** — and the daily `backup:email` mails a `pg_dump` off the server.
2. **HIGH — tokens never expire.** No Sanctum expiry, no refresh, stored in `localStorage` (XSS-reachable). A stolen token is valid indefinitely.
3. **HIGH — brute-force protection defaults OFF.** The lockout exists but is gated behind a per-tenant setting.
4. **HIGH — `APP_DEBUG=true`** in the inspected environment. If that reaches production, stack traces and config leak on every 500.
5. **HIGH — biometric device endpoints are public**, authenticated only by a device serial in the request body. Serials are guessable/observable; throttling is the only other control.
6. **MEDIUM — OTP brute-force** on the password-reset flow, plus a user-enumeration oracle in `send-otp`.
7. **MEDIUM — no DB-level FKs** across masters/payroll/HR: authorization bugs become silent data corruption rather than constraint violations.
8. **MEDIUM — Supervisor runs the worker and Reverb as `root`.**
9. **MEDIUM — hard deletes** on ~140 tables: no audit trail, no recovery.
10. **MEDIUM — file access control** relies on unguessable paths on a public disk rather than an authorization check per download.

---

## 10. VIRTUAL EMPLOYEE / AI AGENT

### Suitable modules (high value, low blast radius)

| Module | Why it fits |
|---|---|
| **HR Overview / Reports** | Read-only aggregation; natural-language questions map cleanly onto existing summary endpoints. |
| **Attendance queries** | "Who is late this week", "show open days" — `AttendanceController` already returns structured day rows with `dayOpen`, `status`, `deviation`. |
| **Leave balance & policy Q&A** | `LeavePlan` + `LeaveRequest` are well-modelled; answers are deterministic. |
| **Sales pipeline status** | Lead/quotation/PI stage reporting — read-only, high demand. |
| **CLM document-requirement lookup** | The DCP rule engine already answers "what docs does segment X need for a vendor" deterministically; the agent only has to phrase it. |
| **Master data lookup** | `MasterController` is schema-driven — one generic tool covers ~60 masters. |
| **Document drafting assist** | Template placeholder filling via `HrTemplateDocxRenderer` — draft only, never send. |

### APIs that make good AI tools

**Read:** `/hr-overview/*`, `/attendance/employee/{id}/summary`, `/attendance/daily-view`,
`/leave-requests` (index), `/master/{key}`, `/sales/leads` (index/show), `/clm/segment-rules`,
`/employees` (index/show, **field-filtered**), `/p2p/purchase-orders` (index).

**Write (only with the controls below):** create a lead, create a to-do/reminder, draft a
quotation, raise a leave request **for the caller**, draft an announcement.

### Read-only (never let the agent write)

Payroll of any kind · payslips · salary structures · permissions · plans/billing ·
clients/branches/users · face biometrics · device terminals · CLM signature send/recall ·
anything touching Zoho Books or Razorpay.

### Require in-app confirmation (user sees the exact payload, then clicks)

Creating or editing a lead, customer, consignee, vendor or product · drafting a quotation or PI ·
raising leave/expense/advance on one's own behalf · uploading a document · sending an announcement.

### Require human approval by a second, authorised person

Any approval/rejection (leave, expense, advance, hiring, agreement) · payroll generate, finalise
or disburse · issuing or sending anything for e-signature · creating or modifying permissions ·
anything that emails a customer or vendor · any Zoho Books push · any deletion.

### Data the AI must never access directly

`users.password_encrypted` / `password_plain` (anywhere) · `personal_access_tokens` ·
`face_biometrics` descriptors · salary structures and payslip amounts for anyone other than the
requesting user · `.env` / config · other tenants' rows under any circumstance · raw
`employee_documents` file contents (KYC, ID scans) · Razorpay/Zoho credentials · the database
backup mailbox.

---

## 11. REAL-WORLD TESTING

**Normal** — full lead → quotation → PI → procurement → shipment run; hire → onboard → attend →
leave → payroll → exit; vendor onboarding through all 4 steps; a CLM agreement drafted, sent for
signature, signed; a Razorpay plan purchase.

**Negative** — clock in twice in a row (must be rejected: strict in→out alternation); punch before
the employee's joining date; PI from a quotation edited after conversion; leave request
overlapping an approved one; expense claim over policy; a DOCX template whose company name
contains `&`, `<`, `>` (previously produced an unopenable file).

**Security** — call every `/dev/*` route in production (must 404); replay a Razorpay webhook;
POST `/iclock/cdata` with a forged serial; request another tenant's PDF via a `signed` URL;
brute-force `send-otp`; reuse a Sanctum token after the user is deactivated (must fail via
`user.active`); attempt `password_plain` retrieval as a non-super-admin.

**Permission** — a user with only `can_view` attempting each write verb; grant a module and verify
its feeder modules auto-gain `can_view`; revoke mid-session and confirm the next request is
refused; confirm CLM menu items are permission-gated.

**Multi-tenant** — the same email registered under two clients (now allowed; login must show the
org picker); a branch user attempting to switch branches (must be blocked — switcher is
client-admin only); `forSegment`-style lookups leaking across branches; consignee KYC mirror
copying across tenants.

**Large-data** — 5,000 employees × 30 days through `employee/{id}/summary` and payroll generate;
50,000 leads on the pipeline list (unpaginated `->get()` — expect failure); a 200-page document
through `preview-live`; eSSL pushing a backlog of thousands of punches.

**API failure** — Zoho Books token expired mid-sync; Zoho Sign unreachable while polling; Razorpay
webhook with a bad signature (note: `RAZORPAY_WEBHOOK_SECRET` is blank locally, so the webhook
rejects — use the checkout verify path for local billing QA); SMTP down with mail sent inline;
dompdf fetching an unreachable remote image.

**Duplicate requests** — double-click Submit on quotation/PI creation (per-client sequence under
row lock — verify no gap and no duplicate); the same punch pushed twice by the device; a payment
posted twice; a leave approved by two managers simultaneously.

**Concurrent users** — two payroll runs for the same cycle at once (previously lock-free); two
users editing the same lead; simultaneous quotation numbering across branches; queue worker
restarted mid-job.

---

## 12. DEBUGGING — tracing a request end to end

```
User action (browser)
  └─ React page → resources/js/api.ts  (Axios)
       · attaches Authorization: Bearer <token> from localStorage
       · injects ?branch_id=<active> on GETs from BranchSwitcherContext
       · on 401 → wipes token, redirects /login, stores error in localStorage
  └─ HTTP → routes/api.php
       · auth:sanctum          → token → user
       · user.active           → re-checks user + tenant status
       · ProfileRequest        → only if X-Profile: 1
  └─ Controller  → app/Support/* guards → MasterVisibility::scopeForUser()
  └─ Eloquent → PostgreSQL
  └─ JSON response
```

### What exists today

- **Per-request SQL profiler** — send header `X-Profile: 1` and read back `X-Profile-Total-Ms`,
  `X-Profile-Query-Ms`, `X-Profile-Queries` (**the N+1 signal**), `X-Profile-Memory-Kb`,
  `X-Profile-Id`. Fetch the full statement list via `GET /api/dev-tools/profile/{id}`.
  `X-Profile-Rollback: 1` wraps the request in a transaction that is always rolled back, so
  **Add/Edit/Delete can be profiled safely**. Surfaced under Dev Tools → Load Testing.
  Local/staging only.
- `GET /api/dev-tools/api-usage` (`ApiUsageScanner`) — route inventory/usage.
- Laravel file logs, `queue-worker.log`, `reverb.log`; `LogSentEmail` records outbound mail.
- Health endpoint `/up`.

### What is missing

No correlation/request ID threaded through frontend → backend → logs. No structured (JSON)
logging. No APM or distributed tracing. No error tracker. No slow-query log surfaced. No audit
log of who changed what — and with ~140 tables hard-deleting, deletions leave no trace. No
uptime or queue-depth alerting: if the worker dies, mail silently stops.

**Minimum to add before an AI agent:** a request ID generated in `api.ts`, echoed by middleware
into every log line and into the agent's own trace; plus an append-only `agent_actions` table.

---

## 13. PRODUCTION RISKS OF ADDING A VIRTUAL EMPLOYEE

1. **Tenant leakage.** Scoping lives in 17 duplicated `applyScope()` implementations plus `MasterVisibility`. An agent composing queries outside a controller can trivially cross `client_id`. This is the single biggest risk.
2. **Credential exposure.** `password_plain` is reachable through a normal API response. An agent with a super-admin token summarising "client details" could surface real passwords into a chat log.
3. **Unbounded reads.** With 262 unpaginated `->get()` endpoints, one agent question can pull an entire table into a prompt — cost, latency and a mass data-egress event in one.
4. **Irreversible writes.** ~140 tables hard-delete; no audit trail. An agent mistake cannot be undone or even reconstructed.
5. **Financial/legal side effects.** Zoho Books push, Razorpay and Zoho Sign send are all one API call away. An agent that "helpfully" sends an agreement for signature has created a legal document.
6. **Payroll correctness.** Payslips read a stored attendance snapshot; an agent that edits attendance without triggering regeneration silently produces wrong pay.
7. **Permission model bypass.** Permissions are enforced per-controller. An agent calling internal services directly inherits nothing.
8. **Load amplification.** Synchronous PDF/DOCX and inline SMTP mean an agent loop can saturate PHP workers; there is no Redis, no rate limit on authenticated routes, and no autoscaling.
9. **Prompt injection through tenant data.** Lead notes, announcements, customer names and uploaded documents are attacker-influenced text that will land in the model's context.
10. **No observability.** Nothing today can answer "what did the agent do at 14:32 and which rows changed".

---

## 14. RECOMMENDED ARCHITECTURE FOR THE VIRTUAL EMPLOYEE

**Principle: the agent is an API client, never a code path inside the monolith.**

```
                    ┌──────────────────────────────────────────┐
   React SPA  ────► │  Agent Service (separate process)        │
   (chat panel)     │  · LLM orchestration + tool registry     │
                    │  · per-tenant rate limit + token budget  │
                    │  · prompt-injection guards               │
                    └──────────────┬───────────────────────────┘
                                   │  HTTPS, Sanctum token of the ACTING USER
                                   │  + X-Request-Id + X-Agent-Session
                                   ▼
                    ┌──────────────────────────────────────────┐
   Laravel  ──────► │  /api/agent/* — thin allowlisted facade  │
                    │  · agent.tool middleware                 │
                    │    - re-checks Permission + MasterVisibility
                    │    - forces pagination caps              │
                    │    - strips sensitive fields             │
                    │    - writes agent_actions audit row      │
                    └──────────────┬───────────────────────────┘
                                   ▼
                     existing controllers / services (UNCHANGED)
```

### Non-negotiables

1. **The agent acts as the user, never as a service account.** It carries that user's Sanctum
   token so every existing permission and scope check applies unchanged. No new god-role.
2. **Allowlist, don't expose.** A hand-written `/api/agent/*` facade wrapping ~15–25 endpoints.
   Never point the agent at the 659-route surface.
3. **A response filter that strips by default** — `password*`, `*_encrypted`, `token`, biometric
   descriptors, salary fields — applied centrally, so a future controller change cannot leak a
   new field into a prompt.
4. **Hard pagination caps** in the facade (e.g. 100 rows, 50 KB) regardless of what the
   underlying endpoint does.
5. **Three-tier write model** — *read* (immediate) · *confirm* (payload shown in the SPA, user
   clicks) · *approve* (a second authorised human), per §10. Enforce the tier **server-side** in
   the facade, not in the prompt.
6. **`agent_actions` append-only audit table**: session id, user, tenant, tool, params, response
   digest, tier, approver, timestamp. This is also the rollback record.
7. **Phase it.** Phase 1 read-only HR + Sales queries behind a feature flag for one pilot tenant.
   Phase 2 confirm-tier drafting. Phase 3 approval-gated writes. Do not start at Phase 3.
8. **Prerequisites before Phase 1:** fix `password_plain` exposure; add token expiry; turn
   brute-force protection on by default; set `APP_DEBUG=false` in production; confirm the queue
   worker and cron are actually running; add request-ID logging.

---

## 15. QUESTIONS FOR MANAGEMENT / CEO

1. Which tenant is the pilot, and are they contractually informed that an AI will process their trade, HR and payroll data?
2. Is customer/employee data allowed to leave our infrastructure to a third-party LLM provider — and does any client contract or DPA forbid it?
3. What is the acceptable monthly token/inference spend, and who owns that budget line?
4. Is the Virtual Employee allowed to take *any* write action in year one, or is read-only acceptable for the first release?
5. Who is legally accountable when the agent gets something wrong — a wrong payslip, a wrongly sent agreement, a missed compliance document?
6. Which single module ships first? (Recommendation: HR/attendance queries — highest question volume, lowest blast radius.)
7. Are we permitted to schedule the downtime needed to fix reversible password storage, which will force tenant admins to reset passwords?
8. Can we get budget and a maintenance window for Redis, a queue-worker health monitor and an error tracker — the agent multiplies existing load?
9. Should the agent be available to all roles, or only to client-admins and HR/managers in v1?
10. What is the retention policy for agent conversation logs, given they will contain employee PII?
11. Do we need on-premise/self-hosted inference for any tenant, or is a hosted API acceptable for all?
12. Who signs off the approval tier — can we reuse the existing hierarchy (`PositionHierarchy`) or does the business want a new one?
13. What is the support model when the agent gives a wrong answer — who triages, against what SLA?
14. Is there appetite to pause new feature development for one sprint to add audit logging and pagination caps first?
15. What does success look like in 90 days — deflected support tickets, hours saved, faster lead response? Pick one measurable target before we build.

---

## A. CURRENT ARCHITECTURE SUMMARY

A single Laravel 12 monolith (100 controllers, 178 models, ~109k LOC) exposing 659 API routes to
a React 19 SPA (~312k LOC, 479 files), backed by PostgreSQL (195 tables, 446 migrations).
Multi-tenancy is column-based (`client_id` on 144 tables, `branch_id` on 133) enforced in
application code, not by the database. Auth is Sanctum bearer tokens with three login paths
(password, face, Google). Authorization is a 172-module × 4-flag permission matrix plus a
creator-hierarchy visibility engine plus per-tenant feature flags. Background work is minimal:
`database` queue, 3 job classes, 2 scheduled commands, Supervisor-managed worker and Reverb.
Deployment is a manual push to a single Linux VM behind Cloudflare, with no CI/CD and no APM.
The codebase is feature-rich and unusually well-commented — most non-obvious decisions are
explained inline — but it has no automated test coverage.

## B. MAJOR PROBLEMS

1. Reversible password storage with an API path that returns cleartext.
2. Sanctum tokens that never expire, held in `localStorage`.
3. Tenant scoping duplicated across ~17 controllers with no shared trait or global scope.
4. Only 17 of ~279 list endpoints paginate.
5. No automated tests of any kind, and no CI to run them.
6. Referential integrity largely absent at the DB level (272 FKs / 195 tables; masters, payroll and parts of HR have none).
7. Synchronous PDF/DOCX generation and inline SMTP inside web requests.
8. No observability: no APM, no error tracker, no audit log, no correlation IDs, no queue-depth alerting.
9. Frontend monoliths (8.8k / 8.5k / 7.6k LOC single files) and 1,765 `any` types.
10. Manual deploys with no rollback path; worker/cron liveness unverifiable from the repo.

## C. RECOMMENDED SOLUTIONS

| Problem | Fix | Effort |
|---|---|---|
| Password reversibility | Delete `password_encrypted` + `password_plain`; replace "show admin password" with an admin-triggered reset link | M |
| Token lifetime | Set Sanctum expiry + refresh; move to httpOnly cookie if feasible | M |
| Duplicated scoping | Extract one `BelongsToTenant` trait / global scope; delete the 17 copies | M |
| Unbounded reads | Default pagination in a base controller; cap page size centrally | M |
| No tests | Start with characterisation tests on payroll, attendance alternation and quotation numbering — the three with real money/compliance exposure | L |
| FK gaps | Add FKs incrementally per domain, starting with payroll and HR | L |
| Sync PDF/mail | Move to queue jobs; the worker already exists | S–M |
| Observability | Request-ID middleware + JSON logs + Sentry + queue-depth alert | S |
| Frontend size | Split the top 10 files; they are already lazy-loaded, so this is contained | M |
| Deploys | A minimal GitHub Actions pipeline: build, migrate, `supervisorctl restart` | S |

## D. VIRTUAL EMPLOYEE INTEGRATION PLAN

- **Phase 0 — prerequisites (must precede any agent work):** fix password exposure; add token
  expiry; `APP_DEBUG=false`; brute-force on by default; verify queue worker + cron are running;
  add request-ID logging and the `agent_actions` table.
- **Phase 1 — read-only pilot (one tenant, feature-flagged):** `/api/agent/*` facade over ~10
  read endpoints (HR overview, attendance summary, leave balance, lead status, master lookup).
  Central field-stripping and pagination caps. Measure answer accuracy and cost.
- **Phase 2 — confirm-tier drafting:** create lead / to-do / draft quotation / draft
  announcement — each rendered in the SPA for the user to approve before it is sent.
- **Phase 3 — approval-gated writes:** leave and expense submission on the user's own behalf;
  document drafting. Payroll, billing, e-signature, permissions and deletes stay out of scope
  indefinitely.
- **Throughout:** the agent acts as the user with their token; nothing bypasses `Permission` or
  `MasterVisibility`; every call writes an audit row.

## E. TOP 10 RISKS

1. Cross-tenant data leakage through agent-composed queries.
2. Cleartext tenant-admin passwords reaching a chat transcript or LLM provider.
3. Unbounded reads causing mass data egress and runaway inference cost.
4. Irreversible writes with no audit trail (~140 hard-deleting tables).
5. Unintended legal/financial acts (Zoho Sign send, Zoho Books push, Razorpay).
6. Incorrect payroll from attendance edits without regeneration.
7. Prompt injection via tenant-supplied text (leads, announcements, documents).
8. Load amplification against synchronous PDF/mail with no Redis and no autoscaling.
9. Regressions in a ~420k-LOC codebase with zero automated tests.
10. Inability to investigate incidents — no APM, no correlation IDs, no audit log.

## F. TOP 10 DEVELOPER MEETING POINTS

1. Agree the agent is an external API client on the user's own token — no service account, no in-process calls.
2. Agree the allowlisted `/api/agent/*` facade and fix its initial endpoint list.
3. Agree the three write tiers (read / confirm / approve) and enforce them server-side.
4. Decide the sensitive-field strip list and put it in one place.
5. Extract the tenant-scoping trait before the agent ships — this is the leak-prevention move.
6. Set global pagination caps and decide the default page size.
7. Design `agent_actions` (schema, retention, who can read it).
8. Add request-ID propagation from `api.ts` through to the logs.
9. Decide what moves to the queue first: mail, PDF, or payroll.
10. Agree a test baseline: which three flows get characterisation tests before Phase 1.

---

*Compiled from a direct survey of the working tree, the live PostgreSQL schema, `deploy/` and
`docs/`. Counts are measured. Deployment specifics marked "verify on the box" could not be
confirmed from the repository alone. No secrets, credentials or personal data are included.*
