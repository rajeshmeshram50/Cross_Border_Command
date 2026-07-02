# EMPLOYEE ONBOARDING MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Employee Onboarding

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
Employee Onboarding gets a new hire from invitation to a fully set-up employee. HR sends a secure invite link; the new hire fills their own profile on a public form (creating their record + login); then HR walks the employee through a 6-stage onboarding checklist until activation.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Self-service capture | New hires enter their own details, reducing HR data entry |
| Secure invites | One-time 64-char token links, expiry-controlled, rate-limited |
| Auto provisioning | Completion creates both the employee record and a login |
| Structured setup | A 6-stage checklist ensures documents, assets, payroll and policies are done |
| Progress visibility | `onboarding_stage_completed` drives a profile-completion meter |

### 1.3 Key features
- **Invite generator** (expiry 3/7/15/30 days) with a copyable link + email.
- **Public 3-step self-fill form** with draft autosave.
- **Auto-provisioning** of the employee + login on completion (welcome email with credentials).
- **6-stage HR wizard** (setup → documents → provisioning → payroll → policies → activation).
- **Baseline self-service permissions** granted on completion.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin / Client Admin / Branch User | Create invites; run the 6-stage HR wizard |
| New hire (public) | Fill the token-gated onboarding form (no login required) |
| Employee (post-completion) | Self-service via the Employee module (Dashboard + Profile by default) |

The public form needs no authentication — only a valid, unexpired invite token. Invite creation and the HR wizard are authenticated.

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                      ONBOARDING LIFECYCLE                           │
└───────────────────────────────────────────────────────────────────┘
   HR (HrEmployees → Send Onboarding)
     │  create invite (name, email, dept, join date, expiry)
     │  → 64-char token link emailed (+ copyable URL)
     ▼
┌───────────────────────────────────────────────────────────────────┐
│ NEW HIRE — Public Form (PublicOnboarding, token)                  │
│  Step 1 Basic Info (age ≥ 18) → Step 2 Address → Step 3 Job       │
│  (draft autosaved locally)                                        │
│  Submit → provisions Employee + Login, welcome email w/ creds     │
│  invite → completed                                               │
└───────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────┐
│ HR — 6-Stage Wizard (HrEmployeeOnboarding)                        │
│  1 Employee Onboarding Setup                                      │
│  2 Document Management                                            │
│  3 Provisioning & Asset Setup                                     │
│  4 Payroll & Finance Setup                                        │
│  5 Policies & Agreements                                         │
│  6 Final Verification & Activation → status Active, stage 6       │
│  (onboarding_stage_completed advances; never regresses)          │
└───────────────────────────────────────────────────────────────────┘
```

### 3.1 Invite lifecycle
`pending` → `completed` (on submit) · `expired` (auto when past expiry, on open) · `cancelled` (defined but not wired to an action).

### 3.2 What completion provisions
- A `User` login (`user_type=employee`, active) + a random password.
- An `Employee` row (`EMP-###`, `user_id`, `created_by`=inviter, department/join-date fall back to the invite).
- Baseline permissions (`profile`, `dashboard`, `master.employees` view, plus inherited `master.*` the inviter can view).
- A welcome email with credentials + login URL.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Send Onboarding (invite) — in `HrEmployees.tsx`
Modal: Invitee Name, Email, Department, Expected Joining Date, Expiry (3/7/15/30 days). On success shows the invite URL + toast.

### 4.2 Public Onboarding form (`PublicOnboarding.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  <Org logo>  Welcome — complete your onboarding                    │
│  [ Basic Info ] → [ Address ] → [ Job Details ]                   │
│  Step 1: name, gender, DOB (≥18), nationality, work country,      │
│          mobile                                                    │
│  Step 2: current + permanent address ("same as current")         │
│  Step 3: department, designation, role, legal entity, joining     │
│  [Submit] → "Welcome aboard!" (emp_code shown; creds emailed)     │
└───────────────────────────────────────────────────────────────────┘
```
Draft autosaves locally; invalid/expired links show a single "link unavailable" card.

### 4.3 HR 6-stage tracker (`HrEmployeeOnboarding.tsx`)
Tabs Pending / Completed; KPI cards (Total, In Progress, Completed, Not Initiated, Missing Details); table (Employee, Emp ID, Dept, Designation, Roles, Manager, Profile %, Status, Action). Wizard advances the 6 stages; completed rows open an Evidence Vault.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Invite tokens are 64-char, one-time, expiry 3/7/15/30 days (default 15) |
| 2 | Public routes are rate-limited to 30 req/min/IP |
| 3 | Minimum age 18 (DOB ≤ today − 18y) |
| 4 | New-hire email must be unique within the client (dup-guarded on invite) |
| 5 | Completion provisions employee + login atomically (race-safe) |
| 6 | Onboarding URL only accepts an origin whose host matches config (anti-phishing) |
| 7 | `onboarding_stage_completed` is a high-watermark (0–6) |
| 8 | Welcome/invite emails are best-effort (never block the flow) |
| 9 | Baseline self-service permissions granted on completion |
| 10 | Public form collects profile fields only (no document upload) |

---

## 6. STATUS MODELS

| Entity | Statuses |
|---|---|
| Invite | pending · completed · expired · (cancelled — unused) |
| Onboarding progress | `onboarding_stage_completed` 0–6 (mapped to Not Started / In Progress / Document Pending / … / Completed) |

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Documents | The public form does not collect documents (HR uploads them in Stage 2) |
| Pincode | Public form requires exactly 6 digits; backend allows 4–10 |
| Cancel | Invite `cancelled` status exists but has no endpoint |
| Automation | Emails sent synchronously (no queue worker); expiry auto-marks only on open |
| Split UI | Invite-send is in the Employees screen, not the onboarding tracker |

---

*Related documents: ONBOARDING_TECHNICAL_DOCUMENTATION.md · ONBOARDING_CODE_WALKTHROUGH.md · ONBOARDING_API_DOCUMENTATION.md*
