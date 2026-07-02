# BRANCH MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Tenancy → Branch (a tenant's office)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
A **Branch** is an office/location of a Client — the middle tier of the tenancy hierarchy **Client → Branch → User**. The Branch module lets a **client-admin** set up each office, give it its own **branch-user login**, capture its **legal/letterhead details** (used on Quotation and Proforma-Invoice PDFs), apply per-branch **branding**, and control its lifecycle. A **Branch Switcher** lets the client-admin view the whole application scoped to one branch; branch users are locked to their own branch.

### 1.2 Business Value

| Benefit | Description |
|---|---|
| Multi-location operations | Each office is an isolated peer with its own users, data and reporting |
| Data isolation | Branch users see only their own branch's data (siblings hidden) |
| Compliant documents | Per-branch GST/CIN/IEC/licenses + signature drive letterhead on Quotation/PI PDFs |
| Fast setup | Creating a branch also provisions its login user and emails credentials |
| Branding | Per-branch logo, profile photo and colors (fall back to the client's) |
| Plan governance | Branch count limited by the client's plan |
| Safe lifecycle | Deactivating a branch logs its users out and hides its data; nothing is hard-deleted |

### 1.3 Key Features
- **Branch list** with KPI cards, search and Excel export (including all letterhead fields).
- **Add / Edit branch** — a 6-section form (details, limits, address, legal/letterhead, branch-user credentials, notes).
- **Auto-provisioning** — a branch-user login is created with the branch.
- **Auto branch code** — server-assigned `BR-###` (read-only in the form).
- **Branch profile** — read-only overview with a completeness meter.
- **Branch Switcher** — client-admins scope the app to a branch; branch users are pinned.
- **Lifecycle controls** — activate / deactivate (cascades to users + data) with confirmation.
- **Plan limit** — creation is blocked when the plan's branch limit is reached.

---

## 2. USER ROLES & PERMISSIONS

### 2.1 Who uses this module
| Role | Access |
|---|---|
| **Client Admin** | Full — the "Branches" menu is shown only to this role; creates/edits/deactivates branches, can switch branches, can view a branch-user's password |
| Super Admin | Reaches a client's branches via the Client module (`/clients/:id/branches`, read-only) |
| Branch User | No management access; pinned to their own branch; sees only their branch's data |
| Employee | No access; peer-isolated to their own records |

> **Access note:** the "Branches" menu renders only for `client_admin`. The API enforces tenant ownership in-method (a user can only touch branches under their own client); there is no separate role middleware.

### 2.2 Capability Matrix

| Feature | Client Admin | Super Admin | Branch User | Employee |
|---|---|---|---|---|
| See "Branches" menu | ✓ | via Client module | ✗ | ✗ |
| List / search branches | ✓ | ✓ (per client) | ✗ | ✗ |
| Create branch (+ branch user) | ✓ | — | ✗ | ✗ |
| View branch profile | ✓ | ✓ | own only (data) | ✗ |
| Edit branch + branding + letterhead | ✓ | — | ✗ | ✗ |
| View branch-user plaintext password | owning admin | ✓ | ✗ | ✗ |
| Deactivate / reactivate branch | ✓ | — | ✗ | ✗ |
| Switch active branch | ✓ | ✗ | pinned | ✗ |

---

## 3. BUSINESS PROCESS FLOW

### 3.1 Branch lifecycle

```
┌───────────────────────────────────────────────────────────────────┐
│                        BRANCH LIFECYCLE                             │
└───────────────────────────────────────────────────────────────────┘
                              START
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 1: OPEN "ADD BRANCH"                                         │
│  • Client-admin → Branches → Add Branch                          │
│  • Form loads /branches/form-bundle (countries, states, next    │
│    BR-### code); the code is read-only / server-assigned         │
│  • Plan check: if plan.max_branches reached → 422 "Upgrade Plan" │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 2: FILL THE 6 SECTIONS                                       │
│  A Branch Details (+ logo / profile photo / SIGNATURE / colors)  │
│  B Limits (max users, established date)                          │
│  C Address                                                        │
│  D Legal & Letterhead (GST, GST state code, PAN, CIN, IEC,      │
│     Drug License, PCPNDT, AEO, One-Star File/UDIN)              │
│  E Branch User Credentials (name, email, password)              │
│  F Notes                                                          │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 3: SAVE (POST /branches)                                     │
│  System, in ONE transaction:                                     │
│   • allocates a BR-### code (row-locked, race-safe)              │
│   • creates the Branch                                           │
│   • creates the BRANCH-USER  (user_type = branch_user)          │
│       – password stored bcrypt AND encrypted (reversible)       │
│   • stores logo/profile photo/signature; dark logo variant      │
│   • emails Welcome Credentials (plaintext password); a failure  │
│     is non-fatal and surfaces as mail_warning                   │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 4: OPERATE                                                   │
│  • Branch user logs in (pinned to this branch)                  │
│  • Client-admin can Switch to this branch to work in its scope  │
│  • Letterhead fields render on the branch's Quotation/PI PDFs   │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 5: MANAGE                                                    │
│  • View profile + completeness meter                            │
│  • Edit details / branding / letterhead / branch-user           │
│  • Manage branch users & permissions                            │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 6: DEACTIVATE / REACTIVATE                                   │
│  • Set Status active → inactive (confirmation modal):           │
│      → revoke all branch user tokens (logout)                   │
│      → soft-delete the branch's users + employees (hide data)  │
│      → branch row kept (status = inactive)                      │
│  • Set inactive → active: restores users + employees            │
│  • "Delete" action = the same DEACTIVATE (row never removed)    │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 What happens on create (detail)
| Action | Detail |
|---|---|
| Branch code | Auto `BR-###` (zero-padded, race-safe under a row lock); read-only in the form |
| Plan limit | Blocked with 422 if the client's `plan.max_branches` is reached |
| Country default | `India` if not set; status defaults to `active` |
| Branch-user | `branch_user` pinned to this client + branch; password stored bcrypt **and** reversibly encrypted |
| Files | Logo / profile photo / signature saved (≤2MB each); logo gets a dark variant |
| Email | Welcome Credentials (plaintext password); failure → `mail_warning`, not a hard error |

### 3.3 Deactivate / reactivate (detail)
| Transition | Effect |
|---|---|
| active → inactive | Revoke all branch-user tokens; soft-delete branch users + employees; set branch status `inactive` (row kept) |
| inactive → active | Restore the branch's soft-deleted users + employees |
| "Delete" | Same as deactivate — the branch record is never removed (preserves historical references) |

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Screen: Branches (list)
```
┌───────────────────────────────────────────────────────────────────┐
│  Branches                                    [Export]  [+ Add Branch]│
├───────────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Total    │ │ Active   │ │ Inactive │ │ Total    │            │
│  │ Branches │ │ Branches │ │ Branches │ │ Users    │            │
│  │   3      │ │   3      │ │   0      │ │   14     │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
├───────────────────────────────────────────────────────────────────┤
│  [Search name / code / type / city…]                             │
│  ┌───────────────────────────────────────────────────────────────┐│
│  │Sr│Branch      │Code  │Type │Contact│Email│Phone│Location│Users│St││
│  │1 │Mumbai HQ ● │BR-001│Comp │Ravi   │…    │98…  │Mumbai,MH│ 6  │● ││
│  └───────────────────────────────────────────────────────────────┘│
│  Row actions: View · Edit · Delete(=Deactivate) · Employees ·     │
│               Permissions                                          │
└───────────────────────────────────────────────────────────────────┘
```
KPI cards: Total / Active / Inactive branches + Total Users. Export builds an XLSX including every letterhead/compliance field (GST, GST state code, PAN, CIN, IEC, Drug License, PCPNDT, AEO, One-Star File/UDIN) plus contact/address/users/status. (The Head Office branch is hidden from the list unless explicitly included.)

### 4.2 Screen: Add / Edit Branch (6 sections)
| Section | Fields |
|---|---|
| **A. Branch Details** | Name*, Code (read-only auto `BR-###`), Type (company/division/factory/warehouse), Industry, Contact Person, Status*, Email, Phone, Website, Description, **Logo**, **Profile Photo**, **Authorized Signatory (stamp & signature)**, Primary Color, Secondary Color |
| **B. Limits** | Max Users (0 = unlimited), Established Date |
| **C. Address** | Street Address, Country (cascades State), State, City, District, Taluka, Pincode |
| **D. Legal & Letterhead** | GST Number, PAN Number, Registration Number, GST State Code, CIN, IEC, Drug License, PCPNDT No, AEO Code, One-Star Export House File No, One-Star Export House UDIN No |
| **E. Branch User Credentials** | Full Name*, Email*, Phone, Designation, Password* (strength meter), Confirm Password*, User Status |
| **F. Notes** | Internal Notes |

Validation highlights: name 2–100 chars; email regex; phone country-aware; pincode 6 digits (can't start with 0); GST 15-char / PAN 10-char (India only); the branch-user email must differ from the branch email; password ≥ 8 chars with upper + lower + number and matching confirmation. Setting Status → Inactive triggers a **confirmation modal** (the actual cascade happens on Save). On edit, an unchanged branch-user password is not re-saved (avoids re-hash + email).

### 4.3 Screen: Branch Profile (view)
Hero (photo/logo/initials, name, status pill, users tile), a **Complete Branch Profile** meter (14 tracked fields including the branch user), and cards: About, Info, Contact, Address, Branch User, Description. Edit buttons jump to the form; "Manage" on the Branch User opens the branch's users.

### 4.4 Branch Switcher
- Shown to **client-admins** only (a dropdown of their branches, plus "All Branches").
- Selecting a branch persists it (per-user) and reloads the app so every list refetches under that branch's scope.
- **Branch users are pinned** to their own branch — they see a static branch badge, not a switcher.

### 4.5 Branch Dashboard (branch user)
The `branch_user` (and `client_user`) dashboard shows scoped Sales / Procurement / CLM / Workforce sections plus, when permitted, a Billing block (Total Paid, payment trend chart, recent payments).

---

## 5. BUSINESS RULES

| # | Rule | Behaviour |
|---|---|---|
| 1 | Tenant hierarchy | Client → Branch → User; creating a branch auto-creates its branch-user |
| 2 | Branch code | Auto `BR-###`, server-assigned, race-safe; not editable |
| 3 | Plan limit | Creation blocked when `plan.max_branches` is reached |
| 4 | Equal peers | No "main branch" — all branches are isolated peers (2026-06-20) |
| 5 | Data isolation | Branch users see only globals + client-level + their own branch (siblings hidden) |
| 6 | Branch-user password | Stored bcrypt **and** reversibly encrypted; shown to super-admin / owning client-admin; emailed in cleartext |
| 7 | Email uniqueness | Branch-user email unique per client; must differ from the branch's own email |
| 8 | GST / PAN | Validated with Indian formats when country = India; unique per client |
| 9 | Letterhead | Per-branch legal fields + signature render on Quotation/PI PDFs |
| 10 | Deactivation | active → inactive revokes tokens + soft-deletes users/employees; reactivation restores them |
| 11 | No hard delete | "Delete" only deactivates — the branch row is retained |
| 12 | Switcher | client-admin only; branch users pinned |
| 13 | Access | Branches menu is client-admin only |

---

## 6. STATUS MODELS

### 6.1 Branch status
| Status | Meaning |
|---|---|
| active | Live; its users can log in and see its data (default) |
| inactive | Deactivated; tokens revoked, users/employees hidden, row retained |

### 6.2 Branch-user status
`active` / `inactive` / `pending` — controls whether the branch login is usable.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Access control | No server-side role gate on `/branches*` — client-admin restriction is menu + in-method ownership |
| Password security | Branch-user password is reversibly encrypted, shown to admins, and emailed in cleartext |
| max_users | Stored per branch but **not enforced** at user-creation time (only the plan's branch count is enforced) |
| Delete | There is no true delete — only deactivate; the row is retained |
| Branch code | Not unique at the database level (uniqueness relies on the allocation logic) |

---

*Related documents: BRANCH_TECHNICAL_DOCUMENTATION.md · BRANCH_CODE_WALKTHROUGH.md · BRANCH_API_DOCUMENTATION.md*
