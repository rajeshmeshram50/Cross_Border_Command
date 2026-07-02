# PERMISSION MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Access Control → Permissions (per-user, per-module)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The Permission module controls **what each user can see and do**, module by module. Every grant records seven independent actions — **View, Add, Edit, Delete, Export, Import, Approve** — for one user against one leaf module. A visual **Permission Matrix** lets a higher-tier user hand down a subset of their own access to a lower-tier user, in a strict chain: **Super Admin → Client Admin → Branch User → Employee**.

A user can only grant permissions they themselves hold, and any action automatically implies "View".

### 1.2 Business Value

| Benefit | Description |
|---|---|
| Least privilege | Each user gets exactly the modules/actions they need |
| Delegated administration | Admins grant access to their own reports without platform involvement |
| Safety | Can't-grant-what-you-don't-have + downgrade cascade prevent privilege leaks |
| Consistency | Action-implies-view stops "can edit but not see" states |
| Plan alignment | A plan's unlocked modules seed the client-admin's baseline permissions |

### 1.3 Key Features
- **Permission Matrix** — module tree × 7 action columns, with per-branch/per-column select-all.
- **Grant cascade** — each role grants only to the tier directly below it.
- **Can't-grant-what-you-don't-have** — you can only pass on flags you hold.
- **Action-implies-view** — enabling any action auto-checks View (and locks it).
- **Default modules** — Dashboard/Profile (and Developers) are always granted.
- **Downgrade cascade** — removing an admin's access strips it from their reports too.
- **Menu/page gating** — the SPA hides menus and pages based on `can_view`.

---

## 2. USER ROLES & PERMISSIONS

### 2.1 The grant cascade
| Granter | Can grant to | Notes |
|---|---|---|
| **Super Admin** | Client Admin | All boxes enabled (super-admin bypasses their own permission checks) |
| **Client Admin** | Branch User (and adopts orphan employees) | Only flags the admin holds |
| **Branch User** | Employee (same branch) | Only flags the branch user holds |
| Employee | — | Cannot grant |

### 2.2 Who sees the Permissions screen
The "Permissions" menu is shown to **super_admin, client_admin, branch_user**. Employees are excluded from the menu (their permissions are managed from their profile by a higher tier).

---

## 3. BUSINESS PROCESS FLOW

### 3.1 Granting permissions

```
┌───────────────────────────────────────────────────────────────────┐
│                     PERMISSION GRANT FLOW                           │
└───────────────────────────────────────────────────────────────────┘
                              START
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 1: PICK A USER                                               │
│  • Open Permissions (/permissions) or a user's profile            │
│  • The picker lists only users you may manage (one tier below)    │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 2: LOAD THE MATRIX                                           │
│  • GET /modules → module tree; GET /permissions/user/{id} →       │
│    the target's current grants                                    │
│  • Boxes you can't grant (not in YOUR perms) are disabled         │
│    (grantableBy); super-admin sees all enabled                    │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 3: EDIT                                                      │
│  • Toggle View/Add/Edit/Delete/Export/Import/Approve per module   │
│  • Enabling any action auto-checks (and locks) View               │
│  • Parent rows show on/total and support select-all               │
│  • Default modules (Dashboard/Profile) are always on & locked     │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 4: SAVE  (POST /permissions/user/{id})                      │
│  • Payload = LEAF modules only                                    │
│  • Server: grant-scope check → can't-grant-what-you-don't-have    │
│    → drop parents → replace rows → force can_view on any action   │
│  • If super-admin edits a client-admin → cascade-clear downstream │
│    (strip flags the admin no longer has from branch/employee)     │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 5: EFFECT                                                    │
│  • On the target's next login (or /me refresh) their menus &      │
│    pages reflect the new can_view flags                           │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 The 7 actions
| Action | Meaning |
|---|---|
| View | See the module's menu & pages |
| Add | Create records |
| Edit | Modify records |
| Delete | Remove records |
| Export | Download/export data |
| Import | Bulk import |
| Approve | Approve items in approval flows |

> **Action-implies-view:** any of Add/Edit/Delete/Export/Import/Approve forces View on (and the View checkbox is locked). Enforced in the API, the UI, and a backfill migration.

### 3.3 Where permissions come from
- **Client-admin baseline:** seeded from the client's **plan modules** when a plan is activated (Plan/Payment modules).
- **Employee baseline:** Dashboard + Profile (public onboarding also grants a `master.*` baseline mirroring the granting admin).
- **Everything else:** granted explicitly via the Permission Matrix.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Screen: Permissions (`Permissions.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Permissions                                                        │
│  [Select user ▼]   (only users you can manage)                    │
│  ℹ You can only grant permissions that you have.                  │
├───────────────────────────────────────────────────────────────────┤
│  Module                     │All│View│Add│Edit│Del│Exp│Imp│Appr│  │
│  ▸ Dashboard  (default)     │ ✓ │ ✓  │ ✓ │ ✓  │ ✓ │ ✓ │ ✓ │ ✓  │  │
│  ▾ HRMS         (3/12)      │ ◪ │ …  │…  │…   │…  │…  │…  │…   │  │
│     • Attendance            │   │ ☐  │ ☐ │ ☐  │ ☐ │ ☐ │ ☐ │ ☐  │  │
│     • Payroll               │   │ ☑  │ ☐ │ ☑  │ ☐ │ ☐ │ ☐ │ ☐  │  │
│  Quick actions: Select All · Expand All · [column toggles]        │
│                                                     [Save]         │
└───────────────────────────────────────────────────────────────────┘
```
The matrix is a module tree with 8 checkbox columns (All + 7 actions). Parents show `on/total` and tri-state select-all. `is_default` leaves are locked-on. Deep-link: `/permissions?user=<id>`.

### 4.2 Screen: Employee Permissions (`EmployeePermissions.tsx`)
Same matrix, scoped to one employee (the wrapper resolves the employee → linked user id). Grantable columns limited to the granter's own perms.

### 4.3 Screen: Client Permissions (`ClientPermissions.tsx`)
Super-admin edits a client-admin's matrix (all columns enabled). The client detail response embeds `admin_permissions`, so no extra fetch.

---

## 5. BUSINESS RULES

| # | Rule | Behaviour |
|---|---|---|
| 1 | Grant cascade | super→client_admin, client_admin→branch_user, branch_user→employee |
| 2 | Can't-grant-what-you-don't-have | Granting a flag you lack → 422 |
| 3 | Action-implies-view | Any action true ⇒ can_view true (API + UI + backfill) |
| 4 | Leaf-only | Permissions attach only to leaf modules; parents are grouping nodes |
| 5 | Full replace | Saving replaces all of the target's rows |
| 6 | Default modules | Dashboard/Profile (and Developers) always granted |
| 7 | Downgrade cascade | Super-admin trimming a client-admin strips downstream branch/employee flags |
| 8 | Orphan adoption | A client-admin saving an orphan (client_id null) user adopts it into their tenant |
| 9 | Super-admin bypass | Super-admins are not permission-gated |
| 10 | Hidden modules | Platform modules (clients/plans/payments/settings/permissions/org-types) are not grantable |

---

## 6. STATUS / ENFORCEMENT MODEL

- **Login payload:** the user's `permissions` map (by module slug) is built at login and refreshed via `/me`.
- **Menus & pages:** gated on `perms[slug].can_view` (super-admin sees all; some temporary rollout bypasses for sales/clm/developers).
- **API:** most business endpoints are **not** flag-enforced — the map primarily controls the SPA. (The permission grant endpoints themselves are fully server-checked.)

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Server enforcement | Business APIs are largely not flag-gated; gating is menu/page-level |
| Route guards | No route-level permission guard — direct URLs may still resolve |
| Rollout bypasses | Sales/CLM/Developers currently visible to branch_user/employee regardless of flags |
| Uniqueness | No DB unique on (user, module); relies on delete-then-insert |
| Save atomicity | `savePermissions` delete+insert is not wrapped in a transaction |

---

*Related documents: PERMISSION_TECHNICAL_DOCUMENTATION.md · PERMISSION_CODE_WALKTHROUGH.md · PERMISSION_API_DOCUMENTATION.md*
