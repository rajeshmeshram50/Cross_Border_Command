# Cross_Border_Command — Functional Documentation

> What the product does, module by module, in business terms — and **exactly who can see/do what**.
> Audience: QA, product, onboarding. Framed "where does this feature live and how do I reproduce it".
>
> _Last updated: 2026-06-04._

---

## 1. The product in one paragraph

Cross_Border_Command is a **multi-tenant SaaS ERP for export/import (cross-border trade) businesses**. One company buys the SaaS (a **Client**), operates several offices (**Branches**), and gives its staff (**Users / Employees**) logins. The app bundles five capabilities: **Sales Matrix** (lead→shipment pipeline), **CLM** (legal/compliance documents), **HRMS** (people lifecycle + attendance), **Procurement & Vendor master**, and **Billing** (Razorpay subscriptions). Almost all data is scoped by `client_id` (and usually `branch_id`), and visibility is governed by a creator-hierarchy engine — see [§3 Data Visibility](#data-visibility), the part most testers get wrong.

---

## 2. Tenancy & roles

### The hierarchy
```
Client (the company that bought the SaaS)
 └── Branch  (their offices — exactly one is the MAIN branch, is_main = true)
       └── User (an employee login within a branch)
```

### Roles (`user_type`)
| Role | Who | Reach |
|---|---|---|
| `super_admin` | Platform owner (you/the vendor) | Across all clients; dedicated `/admin-stats` |
| `client_admin` | The buyer's top admin | Everything inside their client |
| `client_user` | Client-level staff | Everything inside their client |
| `branch_user` (main branch) | Admin of the MAIN branch | Everything inside the client (all sub-branches + all employees) |
| `branch_user` (sub branch) | Admin of a sub-branch | Their branch + reference data the main-branch admin created |
| `employee` | Ordinary staff | Their own rows + reference data (peer-isolated) |

> **Key distinction the docs hammer on:** a `branch_user` in the **main** branch is effectively a client-wide admin; a `branch_user` in a **sub** branch is not. The line between "main branch" and "normal branch" is the single biggest driver of who-sees-what.

### Two authorization layers
1. **Module permissions** (`Permission` model, the *Permissions sheet*): per-user View/Add/Edit/Delete/Export/Import/Approve flags on each leaf module.
2. **Feature flags** (`ClientSetting`): turn whole modules on/off per tenant. Billing plan also gates modules — an expired/missing plan hides all tenant modules and redirects to `/my-plan`.

---

## <a id="data-visibility"></a>3. DATA VISIBILITY — who sees whose data (the core sheet)

This is the part to internalise. Tenant data is **not** scoped by a flat `client_id`/`branch_id` filter. It runs through a **creator-hierarchy engine** (`App\Support\MasterVisibility`) that decides visibility by **who created the row** (`created_by`) combined with where it's stamped. Applies to Customers, Consignees, Vendors, Products, CLM signature requests, and master data (any model with a `scopeForUser` scope).

### 3.1 The tier ladder
```
super_admin (5)  >  client_admin / client_user (4)  >  main-branch user (3)  >  sub-branch user (2)  >  none (0)
```

### 3.2 READ — what each role sees in a list/index

| Logged in as | Globals (client_id = NULL) | Client-level rows (branch_id = NULL) | Own branch rows | Other sub-branch rows | Main-branch ADMIN rows | Main-branch EMPLOYEE rows | Own rows |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **super_admin** | ✅ all clients | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **client_admin / client_user** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **main-branch branch_user** | ✅ | ✅ | ✅ | ✅ (every sub-branch) | ✅ | ✅ | ✅ |
| **sub-branch branch_user** | ✅ | ✅ | ✅ (own only) | ❌ | ✅ (reference data) | ❌ | ✅ |
| **employee** (any branch) | ✅ | ✅ | ❌ (peers hidden) | ❌ | ✅ (reference data) | ❌ | ✅ (only own) |

**Plain-English summary:**
- **Super admin** sees everything across every client. Can narrow with the Branch Switcher.
- **Client admin / client user** see the whole client.
- **Main-branch admin** = client-wide admin: sees every sub-branch's data and every main-branch employee's data.
- **Sub-branch admin** sees their own branch, plus anything the **main-branch admin** created (treated as shared "reference data" that cascades down). They do **not** see sibling sub-branches, and they do **not** see main-branch *employees'* personal rows.
- **Employee** is **peer-isolated**: they see only the rows they personally created, plus globals/client-level rows, plus main-branch-admin reference data. **Two employees in the same branch cannot see each other's rows.**

> Why "main-branch admin rows cascade but main-branch employee rows don't": the main-branch admin's rows are treated as company reference data (e.g. shared customers/products). An individual main-branch employee's records are personal and stay private to them, exactly like any other employee.

### 3.3 WRITE/DELETE — who can edit or delete a row (`hierarchicalDenial`)

A second gate runs on update/delete even when a row is visible:

1. **super_admin** → can mutate anything.
2. **The row's own creator** (`created_by == you`) → always allowed.
3. **employee** → can ONLY mutate rows they created themselves. Even a row their own branch admin created is read-only to them. (403: *"employees can only manage rows they created themselves."*)
4. **Everyone else** → your tier must be **≥ the row's tier**. A sub-branch admin cannot edit a main-branch or client-level row (403: *"it was created by the Main Branch / a Client user / a Super Admin."*).

**Important subtlety (a real bug this prevents):** a row's tier is derived from the row's **own** `client_id`/`branch_id` stamps at create time — *not* from the creator's current branch. So if an employee is later moved from the main branch to a sub-branch, their old main-branch rows stay classified as main-branch rows and don't suddenly become editable by sibling sub-branch users.

### 3.4 Branch Switcher interaction
The Axios client injects `?branch_id=<active>` on GETs. It only narrows results for roles that *can* switch (super_admin, client_*, main-branch admin). For sub-branch users and employees the filter is **silently ignored** — they already have a fixed, narrower scope. A cross-tenant `branch_id` is always dropped.

### 3.5 QA reproduction recipe
To test "why can't user X see/edit row Y":
1. Identify X's `user_type` and whether X's branch is `is_main`.
2. Identify row Y's `created_by`, `client_id`, `branch_id`.
3. Walk the READ table (§3.2) for visibility, then the WRITE rules (§3.3) for edit/delete.
4. Test tenant: **IGC GROUP** (client id 12) is the main local multi-branch test client — logins/branch layout in [IGC_CLIENT.md](IGC_CLIENT.md).

---

## 4. Permissions sheet (menu & button gating)

Each leaf module carries **7 flags**: `can_view`, `can_add`, `can_edit`, `can_delete`, `can_export`, `can_import`, `can_approve`.

**Core rule — action implies view:** granting any action auto-grants (and locks) View. Granting View alone never adds actions. Enforced in three synced places: the Permission Matrix UI, `PermissionController::savePermissions()`, and a one-time backfill migration.

**Menu visibility:** a top-level menu (HR, Sales Matrix, CLM) appears only if the user has `can_view` on at least one leaf beneath it; empty submenu categories drop out; each leaf link needs its own `can_view`. Super-admin sees everything; expired plan hides all tenant modules.

**Who can grant what:**
| Granter | May assign to |
|---|---|
| super_admin | client_admin only |
| client_admin | branch_user only |
| main-branch branch_user | branch_user + employees in their client |
| sub-branch branch_user | employees in their own branch |

A granter can never hand out a flag they don't hold.

> **Backend enforcement reality (for QA expectations):** Master data + HR core/documents enforce flags server-side. **Sales Matrix & CLM are gated only on the frontend menu/page** — the API isn't flag-checked yet, so deep-linking those endpoints bypasses the hidden menu. See [PERMISSIONS_HIERARCHY.md](PERMISSIONS_HIERARCHY.md).

---

## 5. Authentication & session

| Path | How | Notes |
|---|---|---|
| Email + password | `/login` | Password-history check blocks reuse |
| Face | `/login/face` | Browser sends a 128-d descriptor; **login threshold 0.50** |
| Google | `/google-login` | Account must already exist |
| Forgot password | send-otp → verify-otp → reset | Old passwords blocked |

- **Brute-force lockout:** 5 failed attempts / 15 min, shared across all three login paths (one cache key per identity), gated by the `security.bruteForce` setting.
- **Session:** Sanctum token in `localStorage`; no refresh token. On any 401 the frontend wipes the token and bounces to `/login`.
- **Idle timeout:** controlled by `IdleTimeout.tsx`; only fires when the Security → session-timeout toggle is on. (Note: doc/code/UI values have historically disagreed — verify against the live setting before logging a "timeout wrong" bug.)

---

## 6. Sales Matrix — the 6-stage pipeline

A lead becomes an opportunity that moves through six stages on one detail page ([SalesMatrixDetail.tsx](../resources/js/pages/sales/matrix/SalesMatrixDetail.tsx)).

| # | Stage | What the user does | Where |
|---|---|---|---|
| 1 | **Inquiry Received** | Capture lead (manual or IndiaMart sync); Task Manager | Lead Worksheet, `/sales/leads` |
| 2 | **Lead Acknowledgement** | Send ACK email; if not acknowledged, record a reason (qualified / disqualified / clarity_pending) | ACK Master |
| 3 | **Product Sourcing** | Attach products + vendors; set sourcing status; create Procurement | Product Directory |
| 4 | **Price Shared** | Append price-share records (with PDF) to the customer | Shared Prices |
| 5 | **Quotation vs PI** | Create a **Quotation** (`QT/25-26/0042`), convert to **Proforma Invoice** (`INV/25-26/SEQ`) | QPI page |
| 6 | **Victory** | Mark won → downstream Procurement + Shipment Order created | Shipment Order |

### Codes (per-client sequences, allocated under a lock)
| Document | Pattern | Example |
|---|---|---|
| Opportunity / Lead | `OPP-NNNN` | OPP-0042 |
| Quotation | `QT/<FY>/<SEQ>` | QT/25-26/0042 |
| **Proforma Invoice** | **`INV/<FY>/<SEQ>`** | INV/25-26/0007 |
| Shipment | `SHP/...` | — |
> Note: the PI code uses an **`INV/`** prefix (not `PI/`). Codes are allocated under a row lock on the `clients` table (Postgres advisory lock) to prevent race-condition duplicates.

### Customers vs Consignees
A **Customer** (buyer) can have one or more **Consignees** (recipient companies). "Same as Customer" on a consignee deep-clones the customer's KYC docs + owners via `ConsigneeKycMirror` (idempotent — refuses if the consignee already has KYC).

---

## 7. CLM (Central Legal Module)

Compliance documents organised by **business segment** (Tobacco, Rice, Food Grade Ethanol…). The **Document Control Panel (DCP)** defines, per segment + party type (customer/vendor/consignee), which documents are required.

### Catalogues
KYC · Due Diligence (DD) · Quality & Compliance (QC) · Trade Licences · Trade Documents · Agreements · Clauses · Terms & Conditions — each its own master with a names/types tab + a library tab.

### Rule engine
`ClmSegmentRule` links a segment + party type → required document list. When a lead/customer is created under a segment, the engine surfaces missing required docs and pre-populates the Stage-2 document tables. The **Evidence Vault** (`/segment-uploads/...`) shows required-vs-uploaded buckets with KPI counts.

### E-signature (Zoho Sign)
Flow: `preview` → `send` → list/show → `remind`/`recall` → download/view signed file + certificate. Zoho posts back to update status. Used for agreements, trade docs, and Sales-Matrix Stage-5 Quotation/PI signing.
> **Watch:** the webhook and the manual status poll can land out of order — status updates must be idempotent.

### Case-to-Case (CTC) Contracts
Drafting form + three views (list · *Agreements We Sent* · *Agreements To Approve*) with an approve/reject/clarify/respond workflow.

### Still stubs (not built)
Analytics, diagnosis, resolution, buyer/supplier profile, case-to-case extras, agreements-sent/to-approve detail pages may render the placeholder `ClmStubPage`. Don't assume features behind those links work.

---

## 8. HRMS

### Employee lifecycle
Hiring Request (`HRQ-###`) → Recruitment (`REC-###`) → Candidate → **Onboarding** (public token form the candidate self-fills) → Employee master (`EMP-###`, CRUD + documents + permissions) → Exit.

### Attendance
- **Multi-punch model:** an `Attendance` parent row + many `AttendancePunch` rows, each labelled. **7 labels:** Check In · Step Out · Step In · Lunch Out · Lunch In · Meeting · Check Out.
- **Strict alternation:** punches must go in → out → in → out. Two same-direction punches in a row are rejected (**422**). This is a critical invariant.
- Face match for attendance uses threshold **0.55**. Timestamps stored UTC, tenant timezone applied on read.
- Screens: [ClockIn.tsx](../resources/js/pages/ClockIn.tsx) (employee), [HrAttendance.tsx](../resources/js/pages/hrms/HrAttendance.tsx) (HR review).

### Leave
`LeavePlan` (annual/sick/casual; can be assigned to specific employees) → `LeaveRequest` → approval chain. Balances surface on the Employee Profile and a Leave Balances tab.

### Expenses & advances
Both run a two-stage approval: **manager → HR/finance**. The same index serves employee/manager/HR views via `?scope=mine|team|all`.

### Document generation
Template (`HrDocumentTemplate`) → render/merge `{{tokens}}` against the employee (`HrGeneratedDocument`) → signing workflow (`HrDocumentSignature`). Custom per-tenant `{{variables}}` via HR Custom Fields. DOCX merge via `phpoffice/phpword`.

### Other HR
My Team (direct reports + approval queue), Broadcast Centre announcements (+ email), in-app notifications (bell icon).

---

## 9. Procurement masters (step-wise)

- **Products:** 4 steps — Core → Sales → Quality → Vendors, each independently saveable with its own status column.
- **Vendors:** 4 steps — Identity → Contacts → KYC → Products. (Stage-3 "Trade Documents" is a frontend-only view, no backend persistence.)
- A bug in one step's validation must not block the others.

---

## 10. Billing

`Plan` → `PlanModule` → `Module` defines which features a plan unlocks. Clients buy/upgrade via Razorpay (`create-order` → `verify-payment`); manual payments and the automated webhook reconcile state. Expired/missing plan → redirect to `/my-plan` or `/plan-blocked`.

---

## 11. Masters (lookups)

`MasterController` is a schema-driven generic CRUD over ~50 lookup models, declared in [masterConfigs.ts](../resources/js/pages/master/masterConfigs.ts) and rendered by [MasterPage.tsx](../resources/js/pages/master/MasterPage.tsx). Covers Geography, Commerce, Classifications, Finance, Trade, HR, Inventory, and Risk/Rules domains.

---

## 12. Critical business rules QA should never see broken

1. Attendance punch direction alternates strictly (in→out→in…); same-direction repeat → 422.
2. Quotation/PI codes are per-client sequential under a lock — no duplicates, no gaps from races.
3. PI code prefix is `INV/` (not `PI/`).
4. Consignee "Same as Customer" mirror is idempotent (409 on re-clone).
5. Signed PDF links expire after 60 days.
6. Public onboarding rate limit 30/min/IP.
7. Tenant isolation: `client_id` always derived from the logged-in user, never trusted from the request body.
8. Data visibility follows the creator-hierarchy engine (§3), not a flat branch filter.
9. Face thresholds: **login 0.50**, **attendance 0.55**.

---

## 13. Known gaps

- No automated test coverage; no model factories (seeders only).
- Several CLM pages are stubs (§7).
- Sales/CLM API endpoints not yet flag-enforced server-side (§4).
- Mixed UI libraries (reactstrap + Bootstrap 5.3 + Tailwind 4 over the Velzon theme).

> See also: [SAAS_API_DOCUMENTATION.md](SAAS_API_DOCUMENTATION.md) · [SAAS_TECHNICAL_DOCUMENTATION.md](SAAS_TECHNICAL_DOCUMENTATION.md) · [SAAS_CODE_WALKTHROUGH.md](SAAS_CODE_WALKTHROUGH.md) · [PERMISSIONS_HIERARCHY.md](PERMISSIONS_HIERARCHY.md) · [IGC_CLIENT.md](IGC_CLIENT.md)
