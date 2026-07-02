# EMPLOYEE MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Employee Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The Employee module is the single source of truth for every staff member — personal details, job/org placement, roles, documents, assets, compensation, biometrics and lifecycle status. Creating an employee also creates their **login**. The module drives self-service (own profile, holidays, bank details) and feeds Attendance, Leave, Payroll and Exit.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Master data | One authoritative employee record used across all HR modules |
| Login provisioning | Each employee gets a paired login automatically |
| Self-service | Employees view their own profile/holidays and edit their own bank details |
| Multi-role | Employees can hold a primary + multiple ancillary roles |
| Lifecycle control | Active → probation/leave/notice → resigned/terminated, with safe deactivation |
| Compliance | Document upload/verify workflow + previous-employment background records |

### 1.3 Key features
- **4-step Add/Edit wizard** (Personal → Job → Work/Assets → Compensation).
- **Employee list** with KPI cards, search, Active/Disabled tabs, Excel export.
- **Tabbed profile** (Profile, Job, Attendance, Vault, Payroll, Expense, Leave, Holidays, Hiring).
- **Documents** — upload, verify, reject, download (per document key).
- **Assets** — assign laptop/mobile/other from the asset master.
- **Face registration** — biometric enrolment for attendance/login.
- **Self-service bank edit** and password change.
- **Soft delete / restore / force delete** with hierarchy guards.

---

## 2. ROLES & ACCESS

Gated by the **`master.employees`** permission (view/add/edit/delete). Super-admins bypass.

| Role | Access |
|---|---|
| Super Admin | All employees, cross-tenant |
| Client Admin / Branch User with `master.employees` | Employees in their scope (branch users see only their branch) |
| Employee | **Self-service only** — view own profile/holidays, edit own bank details, change own password |

New hires are granted only **Dashboard + Profile** view by default; anything else must be granted via Permissions.

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                       EMPLOYEE LIFECYCLE                            │
└───────────────────────────────────────────────────────────────────┘
   CREATE (HR wizard) or ONBOARDING (public form)
        │  → employee row + paired login (user_type=employee)
        │  → emp_code allocated · self-service permissions seeded
        ▼
   ONBOARDING PROGRESS (onboarding_stage_completed 0→6)
        │  (see Employee Onboarding module)
        ▼
   ACTIVE OPERATION
        • profile maintained (HR + self-service)
        • documents uploaded & verified
        • assets assigned · face registered
        • roles/manager/compensation updated
        │
        ├─ status transitions: Active ↔ Probation / On Leave / Notice Period
        │
        ▼
   OFFBOARD (Exit module) → Resigned / Terminated
        • login disabled + tokens revoked
        • excluded from regular payroll → Full & Final
        │
        ▼
   DISABLE / RESTORE
        • soft delete (recoverable) · restore · force delete (disabled only)
```

### 3.1 Create (4-step wizard)
| Step | Captures |
|---|---|
| 1. Personal & Identity | Name, gender, DOB, contact, nationality, addresses |
| 2. Job & Org | Department, designation, primary + ancillary roles, work type, reporting manager, probation/notice, legal entity |
| 3. Work Details | Leave plan, holiday group, shift, weekly off, asset assignment |
| 4. Compensation | Payroll enablement, salary, PF/ESI/PT, detailed breakup |

On save, the employee **and its login** are created in one transaction; the welcome email fires once the wizard reaches step ≥ 4.

### 3.2 Documents
Upload against a document key → status `uploaded` → HR marks `verified` or `rejected` (with reason). Re-upload after soft delete reuses the slot. Files ≤ 2 MB (pdf/jpg/jpeg/png/webp).

### 3.3 Self-service (employee's own record)
- View own profile & holiday calendar (no `master.employees` grant needed).
- Edit own bank details (`PUT /employees/{id}/bank-details`).
- Change own password.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Employee list (`HrEmployees.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Employees                          [Send Onboarding] [+ Add]      │
│  [Total][Active][Disabled][Onboarding Completed][New Joiners]      │
├───────────────────────────────────────────────────────────────────┤
│  [Active | Disabled]   [Search]   [Department ▼]                  │
│  Sr│Employee│Emp ID│Dept│Desig│Role│Anc.Role│Manager│Profile%│Onb│Act│
│  Actions: View · Edit · Assets · Face · Disable/Enable · Force-del │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 Employee profile (`EmployeeProfile.tsx`)
Tabbed: **Profile Details · Job Details · Attendance · Evidence Vault · Payroll Details · Expense Details · Leave · Holidays · Hiring Requests** (Hiring shown for managers/admins on their own profile). Includes payslip viewer, salary structure/breakdown, expense/advance claims, password change, photo cropper, face registration.

### 4.3 Documents & assets
Per-employee document grid (upload/verify/reject/download) and an Assign Assets modal (laptop/mobile/other from the asset master, excluding already-booked assets).

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Creating an employee provisions a paired login (`user_type=employee`) |
| 2 | `emp_code` is auto-allocated (`EMP-###`), unique per client |
| 3 | Email is unique **per client** (not global); changing it forces password reset + token revoke |
| 4 | Multi-role: one primary + multiple ancillary roles (`ancillary_role_ids`) |
| 5 | Branch-user cap: creation blocked when the branch's `max_users` is reached |
| 6 | Mobile duplicates are guarded (PII-safe probe) |
| 7 | Self-service: an employee can view own profile/holidays + edit own bank details without the module grant |
| 8 | Soft delete disables login + revokes tokens; force delete only on already-disabled rows |
| 9 | `onboarding_stage_completed` is a high-watermark (never decreases) |
| 10 | Face descriptor is never returned in API responses |
| 11 | Editing a payroll-relevant field recomputes the employee's payslips (non-locked runs) |

---

## 6. STATUS MODEL

| Status | Meaning |
|---|---|
| Active | Normal (default) |
| Probation | Under probation |
| On Leave | Temporarily away |
| Notice Period | Serving notice (exit in progress) |
| Inactive | Deactivated (login disabled) |
| Resigned / Terminated | Exited (from the Exit module) |

Disabled = soft-deleted OR status Inactive/Resigned/Terminated.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Documents/prev-employment | Gated by tenant only (no `master.employees` permission check) |
| Multi-role legacy | `ancillary_role_id` (single) kept as a fallback alongside the JSON array |
| Force delete | Keeps the linked user row (revokes tokens) rather than removing it |
| Public onboarding | Collects profile fields only (no document upload in the public form) |

---

*Related documents: EMPLOYEE_TECHNICAL_DOCUMENTATION.md · EMPLOYEE_CODE_WALKTHROUGH.md · EMPLOYEE_API_DOCUMENTATION.md*
