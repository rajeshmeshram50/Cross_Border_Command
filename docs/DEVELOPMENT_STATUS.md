# Cross Border Command — Development Status Report

> Complete start-to-end inventory of every module, page, sub-form, wizard step and functionality.
> Built by reading the live code (controllers + React pages), not assumptions.
> **Generated:** 2026-06-02

**Legend** — ✅ Done · 🟡 Partial · ⏳ Stub / Not Built

---

## 0. Role Access Matrix — who sees what

| Module | Super Admin | Client Admin | Branch User | Employee |
|---|---|---|---|---|
| Dashboard | ✅ Admin | ✅ Client | ✅ Branch | ✅ Employee |
| Clients | ✅ | — | — | — |
| Plans / Payments | ✅ | — | — | — |
| Branches | — | ✅ | — | — |
| My Plan / Plan Selection | — | ✅ | — | — |
| Master Data | ✅ (5 global only) | ✅ | ✅ | ✅ |
| HR | — | URL only | ✅ | — |
| Sales Matrix | — | granter only | ✅ | ✅ |
| Central CLM | — | granter only | ✅ | ✅ |
| Products / Suppliers | — | — | ✅ | ✅ |
| Clock-In | — | — | — | ✅ |
| Permissions | ✅ | ✅ | ✅ | — |
| Settings | ✅ | — | — | — |
| Profile / Inbox | ✅ | ✅ | ✅ | ✅ |

---

# 1. Platform, Theme & Shell — ✅ DONE

## 1.1 Layout Management
| Feature | Status | Notes |
|---|---|---|
| Collapsible Sidebar + floating popout | ✅ | Width 16px↔230px; portal popout submenu when collapsed; auto-opens current page's parent |
| Top Bar (horizontal nav) | ✅ | Dropdown menus, branch switcher, theme toggle, notifications, profile |
| Top Nav (horizontal-only layout) | ✅ | Icon pills + grid dropdowns |
| Layout Toggle (Both / Sidebar / TopNav) | ✅ | 3 modes, persisted in localStorage |
| Responsive mobile handling | ✅ | Mobile overlay + slide-in sidebar < 1024px |
| Breadcrumb strip | ✅ | Home > Current Page |

## 1.2 Theme & Appearance
| Feature | Status | Notes |
|---|---|---|
| **Dark / Light mode toggle** | ✅ | In sidebar footer, top strip, TopNav, Topbar; persisted; syncs `data-bs-theme` |
| Tenant theme override (primary/secondary colors) | ✅ | Per-client/branch colors via CSS vars + auto-contrast text |
| Platform default colors | ✅ | Set by super-admin appearance settings |
| Logo component (6 variants) | ✅ | auth / authHero / sidebar / collapsed / topnav / favicon |
| Dynamic favicon | ✅ | From platform settings |
| Dynamic document title | ✅ | Uses platform_name |

## 1.3 Branch Switching
| Feature | Status | Notes |
|---|---|---|
| Branch switcher (dropdown / badge) | ✅ | Dropdown for client admin; static badge for branch users / employees (locked to own branch) |
| Auto-inject `branch_id` on GETs | ✅ | Axios interceptor; per-call opt-out supported |
| Branch user lock | ✅ | Forced to own branch (every branch is an isolated peer) |
| Full reload on switch | ✅ | Re-fetches all data fresh |

## 1.4 Notifications & Feedback
| Feature | Status | Notes |
|---|---|---|
| Notifications bell | ✅ | Dropdown with sample rows + live `/notifications` endpoint |
| Toast system (4 variants) | ✅ | success/error/warning/info, auto-dismiss 4s |
| Confirm dialog system | ✅ | Async promise-based modal |

## 1.5 Session, Security & Gating
| Feature | Status | Notes |
|---|---|---|
| Idle timeout auto-logout | ✅ | 5-hour timer, gated by Security → sessTimeout |
| 401 auto-logout | ✅ | Clears token, redirects to login |
| Token persistence + Bearer header | ✅ | localStorage `cbc_token` |
| User cache + schema versioning | ✅ | v10 cache invalidation, focus-refresh throttled 60s |
| Plan-expiry check + route gating | ✅ | Bounces to /my-plan or /plan-blocked |
| Menu filtering by plan | ✅ | Hides all but defaults when plan expired |
| Splash loader / loading states | ✅ | First-login splash, profile-resolve spinners |
| Cookie banner | 🟡 | Basic accept-only banner, no detailed preferences |

---

# 2. Authentication & Access Control — ✅ DONE

## 2.1 Login Methods
| Feature | Status | Notes |
|---|---|---|
| Email + Password login | ✅ | Full account/org/branch/onboarding gates; updates last login |
| Face-recognition login | ✅ | 128-d descriptor, **0.50 threshold** (tighter than attendance 0.55) |
| Google OAuth login | ✅ | Verifies id_token, stores google_id |

## 2.2 Security
| Feature | Status | Notes |
|---|---|---|
| Brute-force lockout | ✅ | 5 attempts / 15 min, shared key across all 3 login methods, 429 on lockout |
| Password history | ✅ | Blocks re-use of last 3 passwords |
| Change password (in-app) | ✅ | 8+ chars, confirmation mail |
| Sanctum token handling | ✅ | Prior tokens revoked on login |
| EnsureUserActive middleware | ✅ | Re-validates user/org/branch/onboarding every request |
| Logout | ✅ | Deletes current token |

## 2.3 Forgot Password (OTP flow)
| Feature | Status | Notes |
|---|---|---|
| Send OTP (email) | ✅ | 6-digit, hashed, 10-min expiry, 1s resend cooldown |
| Verify OTP | ✅ | Expiry + attempt cap, returns attempts left |
| Reset password | ✅ | History check, revokes all tokens, confirmation mail |

## 2.4 Account Status Gates
| Feature | Status | Notes |
|---|---|---|
| User active check | ✅ | |
| Client/org active check | ✅ | Walks user→branch→client chain |
| Branch active check | ✅ | |
| Employee onboarding gate | ✅ | Blocks login until onboarding stage ≥ 6 |

## 2.5 Public / Unauthenticated
| Feature | Status | Notes |
|---|---|---|
| Public onboarding (candidate invite) | ✅ | 64-char token, 30 req/min/IP rate limit |
| Signed PDF links (Sales docs) | ✅ | HMAC signed, 60-day expiry, no login |

## 2.6 Frontend Auth & Profile
| Feature | Status | Notes |
|---|---|---|
| AuthContext (login/google/face/logout/refresh) | ✅ | |
| Login page (forms + Google + face modal) | ✅ | |
| Forgot/Verify/Reset pages | ✅ | Strength meter, paste-support OTP boxes |
| `formatUser()` / `me()` endpoint | ✅ | Returns perms, plan, photos, theme colors, inbox count |
| Update profile + branding | ✅ | Photo per role, tenant logo/colors |

---

# 3. Tenancy & Access Management — ✅ DONE

## 3.1 Clients (Super Admin)
| Feature | Status | Notes |
|---|---|---|
| List clients with stats | ✅ | Search, pagination, status filter, plan breakdown |
| Create client | ✅ | Auto unique_number, default Head Office branch, client_admin user, welcome email |
| View client details | ✅ | Admin user + permissions inline, completeness gauge |
| Update client | ✅ | Branding, status (revokes tokens), admin credentials |
| Delete client (soft) | ✅ | Soft-deletes users/branches, revokes tokens |
| Stats + form-bundle cache | ✅ | 5-min server cache |

## 3.2 Branches (Client Admin)
| Feature | Status | Notes |
|---|---|---|
| List / Create / View / Update / Delete | ✅ | Tenant-scoped, hides HO, plan max_branches enforcement |
| Auto branch code (BR-###) | ✅ | Race-safe lockForUpdate |
| Compliance fields (GST/CIN/IEC/drug license/AEO etc.) | ✅ | |
| Status transition cascade | ✅ | inactive soft-deletes users/employees + revokes tokens |
| Branch_user login account | ✅ | Password stored bcrypt + encrypted for read-back |

## 3.3 Users Management
| Feature | Status | Notes |
|---|---|---|
| List manageable users (scoped) | ✅ | Role-aware visibility |
| Users page (per branch) | ✅ | Employees-only filter from Branches→Users |
| User detail resolution | ✅ | |

## 3.4 Permissions Panel (grant + cascade)
| Feature | Status | Notes |
|---|---|---|
| List modules (tree) | ✅ | Parent/child, leaf-only grants |
| Get user permissions | ✅ | Self/super/client/branch scoping |
| Save with cascade | ✅ | Downstream revoke, orphan adoption, 7-bit flag matrix |
| Grant-scope enforcement | ✅ | super→client_admin, client_admin→branch_user, branch_user→own-branch employees |
| 7 permission flags | ✅ | view/add/edit/delete/export/import/approve |
| ClientPermissions + EmployeePermissions pages | ✅ | PermissionMatrix UI, admin-only slugs hidden |

## 3.5 Settings (Super Admin)
| Section | Status | Notes |
|---|---|---|
| General (name/tagline/emails/website) | ✅ | |
| Security (2FA, pwReset, loginNotif, ipWhite, sessTimeout, bruteForce) | ✅ | Boolean toggles |
| Notifications (email/push/planExp/newUser/payAlerts/weeklyReports) | ✅ | |
| Appearance (colors, dark default, logo, favicon upload) | ✅ | |
| Privacy (encrypt, actLog, retention, cookie, policy URL) | ✅ | |
| Help & FAQ (dynamic add/remove) | ✅ | |
| Contact (support email/phone/status page) | ✅ | |
| Client Settings page | 🟡 | Read-only display; no edit form yet |

## 3.6 Profile
| Feature | Status | Notes |
|---|---|---|
| Personal info edit | ✅ | name/phone/designation |
| Profile photo upload + crop | ✅ | Image cropper, 4MB max |
| Password change + strength meter | ✅ | |
| Branding (logo + colors, tenant) | ✅ | |
| Permissions display | ✅ | Read-only |
| Session management | 🟡 | Logout only, no active-session list |

## 3.7 Client / Branch detail views & validation
| Feature | Status | Notes |
|---|---|---|
| ClientView / BranchView (hero + completeness gauge) | ✅ | |
| Email/phone global uniqueness | ✅ | Soft-delete scoped |
| GST/PAN format + uppercase + unique | ✅ | |
| Password / URL / file-upload validation | ✅ | |
| Tenant isolation + session revocation | ✅ | |
| Password encryption read-back | ✅ | super-admin / owning admin only |

---

# 4. Dashboards — ✅ DONE (4 role dashboards)

## 4.1 Admin Dashboard
| Widget | Status |
|---|---|
| 6 KPI cards (clients/active/users/branches/revenue/payments) | ✅ |
| Revenue analytics area chart (6-mo) | ✅ |
| Plan distribution donut | ✅ |
| Client growth bar chart | ✅ |
| Organization-types bar | ✅ |
| Payment health card + user-role pills | ✅ |
| Recent clients list + modal | ✅ |
| Recent payments list + modal | ✅ |
| Revenue report modal | ✅ |
| Top clients by revenue widget | 🟡 (data computed, not rendered) |
| 60s server + sessionStorage cache | ✅ |

## 4.2 Client Dashboard
| Widget | Status |
|---|---|
| Animated plan-status pill | ✅ |
| 6 KPI cards (branches/users/paid/payments/pending/plan days) | ✅ |
| Payment history area chart | ✅ |
| Payment success ring | ✅ |
| Branches list + recent payments | ✅ |
| Team-roles chip row | ✅ |
| Branch filtering + payment gating for branch users | ✅ |

## 4.3 Branch Dashboard (Workforce Analytics)
| Widget | Status |
|---|---|
| Plan status pill | ✅ |
| 8 workforce KPI cards | ✅ |
| Status / Gender pie charts | ✅ |
| Joining-trend bar | ✅ |
| Headcount-by-department horizontal bar | ✅ |
| Top designations list | ✅ |
| Tenure / Age distribution bars | ✅ |
| Upcoming events list | ✅ |
| Billing tiles (conditional, can_view_payments) | ✅ |

## 4.4 Employee Dashboard
| Widget | Status |
|---|---|
| Profile hero card + greeting | ✅ |
| Reporting-manager strip | ✅ |
| Onboarding progress card (conditional) | ✅ |
| Compensation snapshot (conditional) | ✅ |
| 6 KPI cards (claims/approvals/team/days) | ✅ |
| My recent expenses + pending approvals | ✅ |
| Announcements + celebrations | ✅ |
| My Team grid | ✅ |

**Backend / Polish:** admin-stats, client-stats, employee-stats endpoints ✅ · 60s cache ✅ · abort-controller ✅ · animated counters, theme-aware charts, INR formatting, shimmer skeleton ✅

---

# 5. Master Data — ✅ DONE (57 masters, generic engine)

## 5.1 Engine capabilities
| Feature | Status | Notes |
|---|---|---|
| Generic list / search / pagination | ✅ | Full-text across all columns |
| Add / Edit / Delete + confirm | ✅ | |
| Permission gating (view/add/edit/delete/export/import) | ✅ | |
| Hierarchical edit/delete rules | ✅ | Lower rank can't edit higher creator rows |
| System-seeded row protection | ✅ | `is_system` blocks edit/delete |
| Ownership + audit trail | ✅ | created_by + history modal |
| Field types: text/email/number/date/textarea/select/radio | ✅ | min/max, optDesc |
| File upload (accept, maxMb) | ✅ | Old files cleaned on update |
| Reference dropdowns (ref/refL/refLFmt) | ✅ | Self-refs supported |
| Conditional visibility (showWhen) | ✅ | e.g. leave-plan month |
| Auto-derive field (autoDeriveFrom) | ✅ | e.g. UOM Kilogram→KG |
| Sublists (nested child rows) | ✅ | Legal entity → bank accounts |
| Next-code auto-gen API | ✅ | DEPT-001, EXC-01 tenant-scoped |
| Master-counts batch endpoint | ✅ | active/inactive/total per master |
| Per-master filters (designations/roles/departments/kpis) | ✅ | |
| KPI strips | 🟡 | Only legal_entities renders full KPI cards |
| "What this does" help steps | 🟡 | Defined per master; shown in help modal |

## 5.2 The 9 master groups (57 masters)
| Group | Count | Status | Masters |
|---|---|---|---|
| Identity & Entity | 8 | ✅ | Company, Legal Entities, Organization Types, Bank Accounts, Departments, Roles, Designations, KPI Master |
| Geography & Location | 6 | ✅ | Countries, States, State Codes, Address Types, Ports of Loading, Ports of Discharge |
| Trade & Commercial | 8 | ✅ | Segments, HSN Codes, GST %, Currencies, UOM, Packaging, Conditions, Incoterms |
| Party & Classification | 5 | ✅ | Customer Types, Customer Classifications, Supplier Types, Supplier Behaviour, Applicable Parties |
| Legal & Compliance | 5 | ✅ | License Types, Risk Levels, Document Types, Hazard Classifications, Compliance Behaviours |
| Operations & Support | 3 | ✅ | Assets, Asset Categories, Expense Categories |
| P2P Masters | 10 | ✅ | Payment Terms, Approval Authority, Procurement Category, Sourcing Type, Deviation Reason, Match Exception, Advance Payment Rules, Exchange Rate Log, Goods/Service Flag, Supplier Directory |
| Warehouse Masters | 8 | ✅ | Warehouse, Zone, Rack Type, Temp Class, Rack & Location, Shelf/Level, Digital Twin, Freezer |
| Attendance Masters | 2 | ✅ | Leave Type, Leave Plan |
| Document & Evidence | 1 | 🟡 | Trigger Point Master (exists, purpose minimal) |

## 5.3 Validation / backend
Unique fields (uFields/uEach, case-insensitive) ✅ · Tenant-scoped uniqueness ✅ · Required validation ✅ · Normalization (uppercase GST/PAN) ✅ · Pattern validation 🟡 (HSN regex done, not all) · Polymorphic MODELS map (57) ✅ · Dual SCHEMAS ✅ · Visibility scope ✅ · File absorption ✅ · Sublist sync ✅

---

# 6. Sales Matrix — ✅ DONE (Stage 1 partial)

## 6.1 The 6-Stage Pipeline
| Stage | Status | Notes |
|---|---|---|
| **Stage 1 — Inquiry Received** | 🟡 | Opportunity + decision-maker display + task manager panel. Backend attachment storage exists; **frontend file-upload UI not yet wired** |
| **Stage 2 — Lead Acknowledgement** | ✅ | Qualified/Clarity-Pending/Disqualified pills + reason picker; append-only activity report |
| **Stage 3 — Product Sourcing** | ✅ | Product directory tabs, Mark Sourced, Create Procurement modal (PROC-### code) |
| **Stage 4 — Price Shared** | ✅ | Quoted-price submission + shared-price history + PDF (barcode) |
| **Stage 5 — Quotation vs PI** | ✅ | Dual list, Create/Convert modals, email/reminder, signed PDF |
| **Stage 6 — Victory** | ✅ | Confetti + shipment-order modal (SHP-###) + KPI counts |

## 6.2 Core master data
| Feature | Status | Notes |
|---|---|---|
| Customers (full CRUD) | ✅ | Nested address + locations, C-### code, bundle cache |
| Consignees (CRUD + same-as-customer clone + KYC mirror) | ✅ | CN-### code, deep-clone docs/owners |
| Lead Acknowledgement Master | ✅ | qualified/disqualified/clarity buckets |

## 6.3 Operations / docs / productivity
| Feature | Status | Notes |
|---|---|---|
| My Workplace (Lead Worksheet) | ✅ | Search, facets, tabs, bulk assign, CTQ |
| Quotation CRUD + status workflow | ✅ | QT/YYYY-NN/SEQ advisory lock, duplicate, convert-to-PI |
| Proforma Invoice CRUD (with/without shipment) | ✅ | INV/YYYY-NN/SEQ, BT-#### code, one-PI-per-opp rule |
| Quotation/PI PDF (letterhead + barcode + QR) | ✅ | Tax split domestic/international |
| Email & reminder workflows | ✅ | Signed 60-day URLs, reminder gated on first send |
| Procurement CRUD (multipart attachments) | ✅ | Magic-mime validation, cross-lead integrity |
| Sales Reminders (todos) | ✅ | Attachments, status, scope filter |
| Sales Meetings (virtual/physical) | ✅ | M-### / P-### codes |
| Sales Analytics (KPI tiles + lead distribution) | ✅ | Dynamic counts feed from active filters |
| Productivity Tracker | ✅ | Reminders + meetings tabs |
| P2P Summary | ⏳ | No dedicated endpoint found — likely future widget |
| IndiaMart lead sync | ✅ | Bulk create via CRM keys, tenant-gated |
| Codes: OPP-/QT/INV/BT/PROC/C-/CN-/M-/P- | ✅ | Shipment SHP-### referenced but allocation not yet visible (⏳) |

---

# 7. Central CLM — partly built (2 master clusters complete)

## 7.1 Command Center — ⏳ STUB
| Page | Status |
|---|---|
| CLM Analytics | ⏳ ClmStubPage |
| Diagnosis View | ⏳ ClmStubPage |
| Resolution Center | ⏳ ClmStubPage |

## 7.2 Operations — With Shipment ID — ✅ (mock-data dashboards)
| Page | Status | Notes |
|---|---|---|
| Buyer Profile | ✅ | Dashboard with progress bars (KYC/DD/TL/TD/agreements), currently mock data |
| Supplier Profile | ✅ | Same as buyer profile, supplier side |

## 7.3 Operations — Without Shipment ID — ⏳ STUB
| Page | Status |
|---|---|
| Case to Case Contracts | ⏳ ClmStubPage |
| Agreements We Sent | ⏳ ClmStubPage |
| Agreements To Approve | ⏳ ClmStubPage |

## 7.4 Compliance & Regulatory — ✅ DONE
| Page | Status | Notes |
|---|---|---|
| Segment | ✅ | CRUD, S-### code, tabs, regulatory flags |
| Authority | ✅ | Master CRUD, country/state hierarchy |
| Quality & Compliance Docs | ✅ | QC master CRUD |
| KYC | ✅ | KYC document master CRUD |
| Due Diligence (DD) | ✅ | DD checklist master CRUD |
| Trade Licenses | ✅ | License document master CRUD |

## 7.5 Contract & Document Masters — ✅ DONE
| Page | Status | Notes |
|---|---|---|
| Document Control Panel (DCP) | ✅ | Segment-rule engine, M/O toggle matrix |
| Trade Documents | ✅ | Names catalog + rich library + draft editor + Zoho Sign |
| Trade Document Draft wizard | ✅ | 2-step, placeholder + clause insertion, party checkboxes |
| Agreements | ✅ | Types + library, segment mapping |
| Agreement Wizard | ✅ | Step-by-step creation |
| Terms & Conditions | ✅ | Categories + library |
| T&C Wizard | ✅ | |
| Clause Library | ✅ | Types + library, reusable insertion |
| Clause Insert Panel | ✅ | Browse + insert into editors |

## 7.6 Zoho Sign E-Signature — ✅ DONE
Preview PDF ✅ · Send for Signature ✅ · Field placement (x/y/page) ✅ · Send reminder ✅ · Recall ✅ · Download signed PDF ✅ · Completion certificate ✅ · Status tracking ✅ · ZohoSignService integration ✅

**Backend controllers:** Segment, SegmentRule, Authority, KYC, DD, QC, TradeLicense, TradeDocument, Agreement, Clause, TNC — all ✅

---

# 8. HRMS — ✅ Core done (Payroll/PIP/Reports pending)

## 8.1 HRMS Command Center
| Feature | Status | Notes |
|---|---|---|
| HRMS Overview | ✅ | Live KPIs, dept/gender/status breakdowns, 12-mo trends |
| PIP (Performance Improvement Plan) | ⏳ | Full UI mockup, no backend wiring (ComingSoonShell) |
| HR Reports | ⏳ | Menu item exists, **no route in app** — page not built |

## 8.2 HR Core
| Feature | Status | Notes |
|---|---|---|
| Recruitment (job openings + hiring requests) | ✅ | Status/priority/employment filters |
| Candidates | ✅ | Interview pipeline, CV upload |
| Employee Management | ✅ | 50+ fields, soft-delete + restore |
| Employee Onboarding | ✅ | Token invite → self-fill → auto-create employee+user |
| Exit Management | ✅ | Notice/last-day/exit-type/replacement |

## 8.3 Time & Pay Inputs
| Feature | Status | Notes |
|---|---|---|
| Payroll | ⏳ | Elaborate UI mockup, no controller/API (ComingSoonShell) |
| Calculation Master | ⏳ | Rule-engine UI mockup, no controller |
| Attendance | ✅ | Biometric face-punch, multi-punch ledger, 0.55 threshold |
| Face Biometric Registration | ✅ | DPDP consent workflow, enroll/revoke |
| Leave Management | ✅ | 2-stage (manager→HR) approval |
| Leave Approvals | ✅ | Pending queue |
| Expense Management | ✅ | 2-stage approval, receipt upload |
| Advance Request | ✅ | Travel/Salary/Medical, recovery modes |

## 8.4 Document & Evidence
| Feature | Status | Notes |
|---|---|---|
| Broadcast Centre | ✅ | Types/priorities/lifecycle/audience/acknowledgement |
| Document Templates | ✅ | Role-based, auto-code, Web + Word editor, signing workflows |
| Generate Documents | ✅ | Template merge, preview, bulk, HTML→DOCX |
| Document Signature Workflows | ✅ | Sequential/parallel signers, audit trail, inbox |
| Custom Fields | ✅ | Template variables not in employee data |
| Trigger Point Master | ✅ | Onboarding/Offboarding/Event-based triggers |

## 8.5 Additional HR
| Feature | Status | Notes |
|---|---|---|
| My Team | ✅ | Reports list + unified approvals queue |
| Clock-In (employee face punch) | ✅ | In/out with face-match + label |
| Employee Profile | ✅ | Personal/official/contract/beneficiary tabs |
| Employee Permissions | ✅ | Per-employee module access |

---

# 9. Products & Suppliers — ✅ DONE

## 9.1 Product Catalog
| Feature | Status | Notes |
|---|---|---|
| Card grid view (carousel, badges, pills) | ✅ | Amazon/Flipkart-style |
| Product card details | ✅ | P-### code, HSN, UOM, GST, vendor count |
| List view (alternative) | ✅ | |
| Product detail view (ProductView) | ✅ | Gallery + info grid + 4 tabs |
| Vendor mappings table | ✅ | 10-column |
| Status tabs (Active/Inactive) | ✅ | Live counts |
| Sidebar filter drawer (17 panels) | ✅ | |
| Search + quick filters + sort | ✅ | |
| Vendor deep-link filter (?vendor_id) | ✅ | |

## 9.2 Product Wizard (4 steps)
| Step | Status | Notes |
|---|---|---|
| Step 1 Core (info + images) | ✅ | P-### auto-code, draft status |
| Step 2 Sales (pricing + GST) | ✅ | |
| Step 3 Quality (dimensions + QC records) | ✅ | draft→inactive |
| Step 4 Vendors (mappings + activate) | ✅ | →active, mirrors to vendor side |
| Step completion tracking (0–4) | ✅ | Resume on correct tab |

## 9.3 Supplier Catalog
| Feature | Status | Notes |
|---|---|---|
| Supplier list (TanStack table) | ✅ | V-### badge, type pills |
| Status pills + search | ✅ | |
| Row actions (Edit / Map Products / Evidence Vault) | ✅ | |

## 9.4 Supplier Wizard (4 steps + Stage 3 docs)
| Step | Status | Notes |
|---|---|---|
| Step 1 Identity | ✅ | V-### auto-code |
| Step 1 Contacts (address + contacts) | ✅ | |
| Step 2 KYC — Company DD | ✅ | |
| Step 2 KYC — Owner KYC | ✅ | |
| Step 2 KYC — Trade Licenses | ✅ | |
| Step 2 KYC — Bank Accounts | ✅ | |
| Step 2 KYC — GST Scrutiny | ✅ | |
| Step 3 Trade Docs (segment-rule driven) | ✅ | Reference uploads + Zoho Sign workflow |
| Step 4 Products (mappings + activate) | ✅ | Duplicate guard |
| Step completion + resume | ✅ | |

## 9.5 Mapping, documents, vault, scoping
Dual product↔vendor mapping tables (kept in sync) ✅ · vendor_documents / owners / bank / gst tables ✅ · segment_doc_uploads ✅ · QC records ✅ · Evidence Vault modal ✅ (KPI cards 🟡) · Master-bundle caching ✅ · Segment-rule + trade-doc-library resolution ✅ · Creator-hierarchy read/edit scoping ✅ · Branch/employee-only access ✅

---

# 10. Billing & Subscription — ✅ DONE

## 10.1 Backend
| Feature | Status | Notes |
|---|---|---|
| PlanController (CRUD) | ✅ | Slug uniqueness, transactional modules, delete guard |
| SubscriptionController | ✅ | plans/status/create-order/verify/cancel/activate, downgrade cascade |
| PaymentController | ✅ | History, stats, manual record, invoice PDF, reminders |
| RazorpayWebhookController | ✅ | Signature verify, idempotent, amount-mismatch guard |
| RazorpayService | ✅ | Order/verify/webhook signature |
| InvoiceMailer | 🟡 | Sends invoice PDFs, swallows failures |

## 10.2 Frontend
| Page | Status | Notes |
|---|---|---|
| Plans.tsx (admin management) | ✅ | Carousel, delete guard, module badges |
| AddPlan.tsx (create/edit) | ✅ | Live preview, module access-level cycle |
| PlanSelection.tsx (checkout) | ✅ | Billing-cycle toggle, branch-shrink modal, Razorpay |
| Payments.tsx (history) | ✅ | 5 KPIs, export, view modal; Record-Payment button disabled |

## 10.3 Flows & gating
| Feature | Status | Notes |
|---|---|---|
| Plan CRUD | ✅ | |
| Plan modules (4 access levels) | ✅ | full/limited/addon/not_included |
| Subscription select & upgrade | ✅ | Yearly discount + 18% GST |
| Manual payment recording | 🟡 | API exists, frontend button disabled |
| Razorpay integration | ✅ | Paise precision, amount-tamper guard |
| Webhook reconciliation | ✅ | captured/paid→activate, failed→fail |
| Plan expiry & module gating | ✅ | Permission reset per plan_modules |
| **My Plan / Plan Details page** | ⏳ | No dedicated page; status via endpoint, shown inline |
| Invoice generation + emailing | 🟡 | Deferred post-commit, graceful fail |
| Module gating on activation | ✅ | Rebuilds permissions from plan_modules |
| Downstream permission cascade | ✅ | |
| Branch-limit enforcement | ✅ | Deactivates excess, revokes tokens |

**Schema:** plans (21 cols) ✅ · plan_modules ✅ · payments (26 cols) ✅ · clients extensions 🟡

---

# 11. Inbox, Notifications, Announcements, Org Types — ✅ DONE

## 11.1 Inbox (Approvals Hub)
| Feature | Status | Notes |
|---|---|---|
| Document signature inbox | ✅ | Signature pad (Type/Draw/Upload), multi-stage tracking |
| Leave approvals section | ✅ | Manager + HR stages |
| Expense approvals section | ✅ | Manager + HR stages, mandatory rejection comment |
| Personal claim/advance updates (FYI) | ✅ | Read-only verdict feed |
| Multi-section pagination | ✅ | 4 cursor sections |

## 11.2 Notifications (bell icon)
| Feature | Status | Notes |
|---|---|---|
| NotificationController API (4 endpoints) | ✅ | recent/unread-count/read/read-all |
| Notification data model | ✅ | Laravel notifications table, polymorphic |
| Bell-icon dropdown UI | 🟡 | Endpoints done; topbar shows sample rows |

## 11.3 Announcements / Broadcast Centre
| Feature | Status | Notes |
|---|---|---|
| List / Show / Stats API | ✅ | Search, filters, lifecycle auto-refresh |
| Create / Update / Delete API | ✅ | ANN-#### code, attachments, audience caching |
| Announcement model & schema | ✅ | Type/priority/audience/lifecycle/notify channels |
| Email blast (AnnouncementMailer) | ✅ | Recipient resolution + dedup |
| Broadcast Centre UI | ✅ | 5 KPIs, list, per-row actions |
| Create/Edit wizard (4-step modal) | ✅ | Basic/Audience/Notifications/Review |

## 11.4 Organization Types
| Feature | Status | Notes |
|---|---|---|
| API & Controller (CRUD) | ✅ | Super-admin only |
| Data model | ✅ | name/slug/icon/description/status/sort |
| UI (OrganizationTypes.tsx) | ✅ | Search, modal, Remixicon picker |

---

# 12. Overall Project Summary

| # | Module | Status |
|---|---|---|
| 1 | Platform UI, Theme (dark/light), Sidebar, TopNav | ✅ Completed |
| 2 | Authentication & Security | ✅ Completed |
| 3 | Tenancy (Clients/Branches/Users/Permissions/Settings/Profile) | ✅ Completed |
| 4 | Dashboards (Admin/Client/Branch/Employee) | ✅ Completed |
| 5 | Master Data (57 masters, generic engine) | ✅ Completed |
| 6 | Sales Matrix (6 stages + ops) | 🟡 Mostly done — **Stage 1 partial** |
| 7 | CLM — Compliance & Regulatory | ✅ Completed |
| 7 | CLM — Contract & Document Masters | ✅ Completed |
| 7 | CLM — Buyer/Supplier Profile | ✅ (mock data) |
| 7 | CLM — Analytics / Diagnosis / Resolution / Case-to-Case / Agreements Sent / To Approve | ⏳ Stub |
| 8 | HRMS Core (Recruitment/Employee/Onboarding/Exit/Attendance/Leave/Expense/Docs) | ✅ Completed |
| 8 | HRMS — Payroll / Calculation Master / PIP / HR Reports | ⏳ Pending |
| 9 | Products & Suppliers (4-step wizards each) | ✅ Completed |
| 10 | Billing & Subscription (Razorpay) | ✅ Completed (My-Plan page ⏳) |
| 11 | Inbox / Notifications / Announcements / Org Types | ✅ Completed |


## Pending / Not Built (full list)
- **Sales:** Stage 1 file-upload UI · P2P Summary widget · Shipment (SHP-###) allocation
- **CLM:** Analytics, Diagnosis, Resolution Center, Case-to-Case Contracts, Agreements We Sent, Agreements To Approve
- **HRMS:** Payroll, Calculation Master, PIP (UI only), HR Reports (no route)
- **Billing:** My-Plan dedicated page, manual payment-record UI (disabled)
- **Minor:** Client Settings edit form, notification bell dropdown live data, Evidence Vault KPI cards, Cookie banner preferences


