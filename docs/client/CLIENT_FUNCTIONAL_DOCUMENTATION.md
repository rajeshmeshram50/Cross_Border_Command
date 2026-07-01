# CLIENT MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Tenancy → Client (top-level tenant entity)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The Client module is the **super-admin's tenant-management console**. A *Client* is a company that has purchased the SaaS — the top of the tenancy hierarchy **Client → Branch → User**. From this module the platform owner onboards a new tenant, manages its plan and branding, controls its client-admin login, and can deactivate or remove the tenant.

Creating a Client is a **provisioning** action: in one step it also creates the tenant's default **Head Office branch** and its **client-admin user** (who then logs in and runs their own organization).

### 1.2 Business Value

| Benefit | Description |
|---|---|
| Fast onboarding | One form creates the tenant, its Head Office branch, and the admin login |
| Access control | Deactivating a client instantly logs out all its users |
| Branding | Per-tenant logo, favicon and brand colors used across the tenant's UI, emails and PDFs |
| Plan governance | Plan assignment; paid activation is reserved for the billing flow |
| Compliance | GST / PAN captured and validated (India) |
| Recoverability | Deletes are soft-deletes — a tenant and its data can be restored |
| Visibility | KPI dashboard: total / active / inactive clients and plan distribution |

### 1.3 Key Features
- **Client list** with KPI cards, a plan-distribution donut, search and Excel export.
- **Add / Edit client** — a 7-section form covering organization, address, legal, plan, admin credentials, branding and notes.
- **Auto-provisioning** — Head Office branch + client-admin user created with the client.
- **Client profile** — read-only overview with a profile-completeness meter.
- **Branches / Payments views** — per-client read-only lists.
- **Client-admin permissions** — grant the admin module-level access.
- **Settings viewer** — display of the tenant's custom feature-flag settings.
- **Lifecycle controls** — activate / deactivate (token revocation) and soft-delete cascade.

---

## 2. USER ROLES & PERMISSIONS

### 2.1 Who uses this module
| Role | Access to the Client module |
|---|---|
| **Super Admin** | Full — the "Clients" menu is shown only to this role; creates/edits/deletes tenants, can view the admin password |
| Client Admin | **Not** this module — sees their own tenant dashboard, Branches, Master, Permissions, My Plan instead |
| Branch User / Employee | No access |

> **Access note:** restriction to super-admins is enforced by **menu visibility** in the SPA. The API routes themselves are only protected by authentication + active-user checks; there is no server-side role gate on `/clients*`. For a hardened deployment, add a super-admin policy/middleware.

### 2.2 Capability Matrix

| Feature | Super Admin | Client Admin | Others |
|---|---|---|---|
| See "Clients" menu | ✓ | ✗ | ✗ |
| List / search clients | ✓ | ✗ | ✗ |
| Create client (+ HO branch + admin) | ✓ | ✗ | ✗ |
| View client profile | ✓ | ✗ | ✗ |
| Edit client + branding + admin | ✓ | ✗ | ✗ |
| View client-admin plaintext password | ✓ | ✗ | ✗ |
| Manage client-admin permissions | ✓ | ✗ | ✗ |
| View client branches / payments / settings | ✓ | ✗ | ✗ |
| Activate / deactivate client | ✓ | ✗ | ✗ |
| Delete (soft) client | ✓ | ✗ | ✗ |

---

## 3. BUSINESS PROCESS FLOW

### 3.1 Tenant onboarding lifecycle

```
┌───────────────────────────────────────────────────────────────────┐
│                     CLIENT (TENANT) LIFECYCLE                       │
└───────────────────────────────────────────────────────────────────┘
                              START
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 1: OPEN "ADD CLIENT"                                         │
│  • Super-admin → Clients → Add Client                            │
│  • Form loads dropdowns from /clients/form-bundle                │
│    (organization types, plans, countries; cached 5 min)         │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 2: FILL THE 7 SECTIONS                                       │
│  A Organization  B Address  C Legal & Tax  D Plan & Billing       │
│  E Admin Credentials  F Branding  G Notes                         │
│  • Live validation (GST/PAN for India, password strength, …)     │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 3: SAVE (POST /clients, multipart)                          │
│  System, in ONE transaction:                                     │
│   • generates unique_number  (EA + org initials + timestamp)     │
│   • creates the Client        (plan_type forced to FREE)          │
│   • creates the Head Office BRANCH (code = HO, active)            │
│   • creates the CLIENT-ADMIN USER                                │
│       – password stored bcrypt AND encrypted (reversible)        │
│   • stores logo/favicon/profile photo; makes a dark logo variant │
│   • emails Welcome Credentials (contains the admin password)     │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 4: ACTIVATE                                                  │
│  • New clients default to status = INACTIVE                       │
│  • Super-admin edits status → ACTIVE so the admin can log in      │
│  • (Paid plan activation happens separately via billing)         │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 5: MANAGE                                                    │
│  • View profile + completeness meter                             │
│  • Manage client-admin permissions (module matrix)              │
│  • Review branches / payments / settings                        │
│  • Edit organization / branding / admin credentials             │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 6: DEACTIVATE / DELETE                                       │
│  • Set status active → inactive/suspended                        │
│      → ALL that client's Sanctum tokens are revoked (logout)    │
│  • Delete → SOFT-DELETE cascade:                                 │
│      tokens → users → branches → client (all recoverable)       │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 What happens on create (detail)
| Action | Detail |
|---|---|
| Unique number | `EA` + first 2 letters of org name (upper) + `ymdHis` timestamp |
| Plan | `plan_type` **forced to `free`** regardless of input; paid activation via billing only |
| Status | Defaults to `inactive` if not chosen |
| Head Office branch | `<org> — Head Office`, code `HO`, status `active` |
| Client-admin user | `client_admin`; password saved bcrypt **and** reversibly encrypted |
| Branding | Logo / favicon / profile photo saved; a dark-mode logo variant generated |
| Email | Welcome Credentials email (includes plaintext password) — send failure does not fail the create |

### 3.3 What happens on deactivate / delete
| Action | Effect |
|---|---|
| Status `active → inactive/suspended` | All Sanctum tokens for the client's users are deleted → forced logout |
| Delete | Soft-delete cascade: revoke tokens → soft-delete users → soft-delete branches → soft-delete client (recoverable) |
| Plan escalation to `paid` on edit | Silently ignored (handled by billing) |

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Screen: Clients (list)
```
┌───────────────────────────────────────────────────────────────────┐
│  Clients                                     [Export]  [+ Add Client]│
├───────────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ Total    │ │ Active   │ │ Inactive │ │ Plan Distribution ◕   │ │
│  │ Clients  │ │ Clients  │ │ Clients  │ │ (donut by plan)       │ │
│  │   3      │ │   2      │ │   1      │ │ Growth 2 · Free 1     │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘ │
├───────────────────────────────────────────────────────────────────┤
│  [Search organization / id / email…]                              │
│  ┌───────────────────────────────────────────────────────────────┐│
│  │Sr│Organization │Unique ID │Email │Phone│Type│Branches│Plan│…│St││
│  │1 │IGC Group ●  │EAIG2601… │info@…│98…  │Biz │  3     │Grow│…│●│││
│  └───────────────────────────────────────────────────────────────┘│
│  Row actions: View · Edit · Delete · Branches · Permissions ·     │
│               Payments · Settings (Coming Soon)                    │
└───────────────────────────────────────────────────────────────────┘
```
KPI cards: Total / Active / Inactive + a plan-distribution donut. Export builds an XLSX (org, id, email, phone, type, city, state, plan, status, branches, users, created).

### 4.2 Screen: Add / Edit Client (7 sections)
| Section | Fields |
|---|---|
| **A. Organization** | Org Name*, Org Type*, (Sport / Industry conditional), Status*, Email*, Phone*, Website |
| **B. Address** | Street Address*, Country*, State* (cascading), City*, District, Taluka, Pincode |
| **C. Legal & Tax** | GST Number, PAN Number (uppercased; validated for India) |
| **D. Plan & Billing** | Assign Plan*, Plan Type* (free/paid — synced from plan price) |
| **E. Admin Credentials** | Full Name*, Email*, Phone*, Designation, Password (strength meter), Confirm Password, Admin Status* |
| **F. Branding** | Primary Color, Secondary Color, Logo, Favicon, Profile Photo |
| **G. Notes** | Internal Notes |

Validation highlights: org name ≥ 3 chars; email regex; phone 7–15 chars; pincode 6 digits; GST 15-char / PAN 10-char (India only); password ≥ 8 chars with upper + lower + number and matching confirmation. On **edit**, if the admin password is unchanged it is not re-saved (avoids re-hash + a password-changed email).

### 4.3 Screen: Client Profile (view)
Hero (logo/photo, org name, type, location, website, branch & user counts), a **Complete Your Profile** meter (14 tracked fields with missing-field chips), and cards: About, Info, Plan & Billing, Address, Brand Colors, Client Admin, Legal & Tax. Edit buttons jump to the form.

### 4.4 Screen: Client Branches (read-only)
KPI (Total / Active / Total Users) + a table of the client's branches (name, code, type, location, users, status). No create/edit here.

### 4.5 Screen: Client Permissions
Edits the **client-admin user's** module permission matrix (view / add / edit / delete / export / import / approve). Platform-management modules (clients, plans, payments, settings, permissions, org-types) are hidden from the matrix.

### 4.6 Screen: Client Payments (read-only)
KPI (Total Paid / Pending / Transactions / Last Payment) + a table (date, plan, amount, GST, total, method, transaction id, status).

### 4.7 Screen: Client Settings (viewer)
Read-only display of the tenant's custom settings grouped by category (general / security / notifications / appearance / privacy / billing). Boolean settings show Enabled/Disabled; others show the raw value. **No toggles or save here** (display only). Reachable via the settings route; the list "Settings" action currently shows a "Coming Soon" toast.

---

## 5. BUSINESS RULES

| # | Rule | Behaviour |
|---|---|---|
| 1 | Tenant hierarchy | Client → Branch → User; creating a client auto-creates its Head Office branch + admin |
| 2 | Unique number | Auto-generated `EA…` code, unique per client |
| 3 | Plan on create | `plan_type` always stored `free`; paid activation only via billing |
| 4 | Default status | New clients are `inactive` until a super-admin activates them |
| 5 | Branding defaults | Colors default to `#4F46E5` / `#10B981`; logo generates a dark variant |
| 6 | Admin password | Stored bcrypt **and** reversibly encrypted; shown to super-admins; emailed in cleartext |
| 7 | Email uniqueness | Per-tenant — the same email may exist under different clients |
| 8 | GST / PAN | Validated with Indian formats when country = India |
| 9 | Deactivation | `active → inactive/suspended` revokes all the client's login tokens |
| 10 | Deletion | Soft-delete cascade (tokens → users → branches → client); recoverable |
| 11 | Branches are peers | No "main branch" — all branches are equal, isolated peers |
| 12 | Access | Client module is super-admin-only (by menu visibility) |

---

## 6. STATUS MODELS

### 6.1 Client status
| Status | Meaning |
|---|---|
| inactive | Created but not yet enabled; admin cannot use the tenant (default) |
| active | Live; the client-admin and users can log in |
| suspended | Disabled (e.g. non-payment); tokens revoked like inactive |

### 6.2 Client-admin user status
`active` / `inactive` / `pending` — controls whether the admin login is usable.

### 6.3 Plan type
`free` (default) / `paid` (set only through the billing/subscription flow, never through client create/edit).

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Access control | No server-side role gate on `/clients*` — super-admin restriction is menu-only |
| Password security | Admin password is reversibly encrypted, shown to super-admins, and emailed in cleartext |
| Settings | Client Settings screen is display-only; the list "Settings" action is a placeholder |
| Plan expiry | The manual "expires at" field was removed; expiry is now driven server-side by plan duration |
| Tenant scoping | Client list/detail is not `client_id`-scoped (by design for a super-admin console) |

---

*Related documents: CLIENT_TECHNICAL_DOCUMENTATION.md · CLIENT_CODE_WALKTHROUGH.md · CLIENT_API_DOCUMENTATION.md*
