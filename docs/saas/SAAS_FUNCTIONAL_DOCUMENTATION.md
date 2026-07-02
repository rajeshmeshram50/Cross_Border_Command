# SAAS PLATFORM — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command · Multi-tenant SaaS ERP for export/import
> Platform-level view: tenants, subscriptions, access, and the tenant lifecycle.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial platform functional documentation |

> For per-entity depth see `docs/client/`, `docs/branch/`, `docs/plan/`, `docs/payment/`, `docs/permission/`, `docs/payroll/`.

---

## 1. PLATFORM OVERVIEW

### 1.1 Purpose
Cross_Border_Command is a **software-as-a-service ERP** sold to export/import companies. Each customer company is a **tenant** (a *Client*) that operates one or more **branches**, each with its own **users**. A tenant subscribes to a **plan**, which unlocks a set of modules, and pays via Razorpay. Within those modules, work is done across five business pillars (Sales, CLM, HRMS, Procurement, Billing), all strictly isolated per tenant and per branch.

### 1.2 Business value

| Benefit | Description |
|---|---|
| Multi-tenant isolation | Every tenant's (and branch's) data is fully separated |
| Self-service onboarding | A client is provisioned with its Head Office branch and admin login in one step |
| Tiered monetization | Plans package features; module gating enforces what a tenant can use |
| Delegated administration | Admins grant scoped permissions down the hierarchy |
| One suite | Sales, compliance, HR, procurement and billing in a single app |
| Branding | Per-tenant and per-branch logos/colours on the UI, emails and PDFs |

### 1.3 The five product pillars
| Pillar | What it does |
|---|---|
| **Sales Matrix** | 6-stage pipeline: lead → quotation → proforma invoice → procurement → shipment |
| **CLM** | Segment-driven compliance: KYC, due diligence, licenses, agreements, e-signature |
| **HRMS** | Employee master, attendance, leave, expenses, recruitment, **payroll** |
| **Procurement & Vendors** | Step-wise vendor/product onboarding |
| **Billing** | Plan subscriptions, module gating, Razorpay payments |

---

## 2. ROLES (platform-wide)

| Role | Who | Scope |
|---|---|---|
| **Super Admin** | Platform operator | Cross-tenant; manages Clients, Plans, Payments; bypasses per-module permissions |
| **Client Admin** | Tenant owner | Full within their client; manages branches, users, permissions; subscribes/pays |
| **Client User** | Client-level staff | Client-wide access (scoped like client-admin for reads) |
| **Branch User** | Branch staff | Their own branch only (siblings hidden); can be granted module actions |
| **Employee** | Individual staff | Peer-isolated to their own records; self-service (profile, payslips, etc.) |

---

## 3. TENANT LIFECYCLE

```
┌───────────────────────────────────────────────────────────────────┐
│                         TENANT LIFECYCLE                            │
└───────────────────────────────────────────────────────────────────┘
                              START
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  1. ONBOARD CLIENT (super-admin)                                  │
│  • Create the Client → auto-creates its Head Office branch + a    │
│    client-admin login; welcome email with credentials            │
│  • New client starts INACTIVE + plan_type=free                   │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  2. ACTIVATE & SUBSCRIBE                                           │
│  • Super-admin activates the client                              │
│  • Client-admin picks a PLAN on "My Plan" and pays (Razorpay)   │
│  • Activation unlocks the plan's modules → seeds the admin's     │
│    permissions + enforces the branch limit                       │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  3. SET UP THE ORG (client-admin)                                 │
│  • Add BRANCHES (each with its own branch-user + letterhead)    │
│  • Add USERS / EMPLOYEES                                         │
│  • Grant PERMISSIONS down the hierarchy (Permission Matrix)     │
│  • Toggle feature flags (ClientSetting) as needed               │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  4. OPERATE (per branch, per user)                                │
│  • Users work across the 5 pillars within their scope           │
│  • BranchSwitcher lets client-admins focus one branch           │
│  • All data isolated by client_id (+ branch_id)                 │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  5. RENEW / EXPIRE                                                 │
│  • On plan expiry: client-admin routed to /my-plan to renew     │
│    branch users walled to /plan-blocked                          │
│  • Deactivating a client/branch revokes tokens + hides data     │
│  • Deleting a client soft-deletes users+branches (recoverable)  │
└───────────────────────────────────────────────────────────────────┘
```

---

## 4. HOW ACCESS IS DECIDED (three layers + scope)

A user can act on something only if **all** of these allow it:

1. **Tenancy scope** — the row belongs to their client (and branch, for branch users).
2. **Role** — their `user_type` tier.
3. **Plan / module gating** — their tenant's plan includes the module.
4. **Feature flag** — the tenant hasn't turned the module off (`ClientSetting`).
5. **Per-user permission** — they hold `can_view` (and the specific action) for the module.

```
Row belongs to my tenant?  ── no ──► hidden (MasterVisibility)
        │ yes
My role tier allows it?     ── no ──► denied
        │ yes
Plan includes the module?   ── no ──► module not available
        │ yes
Tenant enabled the module?  ── no ──► feature flag off
        │ yes
I have can_view / the action?── no ──► menu/page hidden
        │ yes
        ▼   ACTION ALLOWED (in the SPA)
```

> Note: this gating is enforced primarily in the SPA (menus/pages) + at login. Most business API endpoints are not individually flag-checked — see the platform caveats.

---

## 5. SUBSCRIPTION & BILLING (functional)

| Concept | Behaviour |
|---|---|
| Plans | Tiers (Starter/Basic/Pro/Business/Enterprise) with price, limits, trial, and a module set |
| Module gating | A plan unlocks exactly its modules (full/limited); default modules always on |
| Cycles | Monthly / quarterly / yearly (×1/×3/×12); yearly discount; +18% GST |
| Free plan | Zero-total plans activate instantly (no checkout) |
| Checkout | My Plan → Razorpay → verify → activate (client marked active, permissions seeded, branch limit enforced) |
| Invoices | Numbered PDF per payment; view/download; expiry reminders |
| Expiry | Client-admin → My Plan; branch user → /plan-blocked until renewed |
| Limits | `max_branches` enforced on subscribe (extras deactivated); `max_users` stored |

See `docs/plan/` and `docs/payment/` for details.

---

## 6. KEY SCREENS (platform-level)

| Screen | Audience | Purpose |
|---|---|---|
| Clients | Super Admin | Manage tenants (`docs/client/`) |
| Plans | Super Admin | Manage the plan catalogue (`docs/plan/`) |
| Payments / Revenue | Super Admin | All billing (`docs/payment/`) |
| My Plan | Client Admin | Subscribe / renew |
| Branches | Client Admin | Manage offices (`docs/branch/`) |
| Permissions | SA / Client Admin / Branch User | Grant scoped access (`docs/permission/`) |
| Settings | Client Admin | Feature flags & branding |
| Dashboards | All | Role-specific overviews |

---

## 7. PLATFORM BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Tenancy is Client → Branch → User; creating a client auto-provisions its HO branch + admin |
| 2 | `client_id` is derived from the logged-in user, never trusted from the request |
| 3 | Branch users see only their own branch (siblings hidden); employees see only their own records |
| 4 | Branches are equal isolated peers — no "main branch" |
| 5 | Email is unique per tenant (same email allowed across clients) |
| 6 | A plan unlocks modules; feature flags can further disable them per tenant; permissions gate per user |
| 7 | Paid activation happens only through the subscription/checkout flow |
| 8 | Deactivating a client/branch revokes tokens and hides data; deletes are (mostly) soft/recoverable |
| 9 | Any permission action implies View |
| 10 | Super-admins bypass per-module permission checks |

---

## 8. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Server-side gating | Business APIs are largely menu/page-gated, not endpoint-enforced |
| Admin passwords | Reversibly encrypted; visible to super-admins; emailed in cleartext |
| Billing webhook | Disabled locally (blank secret); checkout verify path is authoritative |
| Automation | No scheduler/queue worker; lead sync and mail run on request |
| Role guards | Client/Branch/Plan CRUD rely on menu visibility + in-method ownership, not route middleware |

---

*Related documents: SAAS_TECHNICAL_DOCUMENTATION.md · SAAS_CODE_WALKTHROUGH.md · SAAS_API_DOCUMENTATION.md · and the per-module sets under docs/.*
