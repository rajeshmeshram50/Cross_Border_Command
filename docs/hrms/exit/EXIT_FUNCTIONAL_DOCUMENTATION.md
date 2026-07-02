# EXIT MANAGEMENT MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Exit Management (employee offboarding)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
Exit Management handles **employee offboarding** end to end: capturing the exit type and dates, running clearances and asset handover, generating and signing exit documents, and finally deactivating the employee. Completion cleanly hands the employee off to Payroll for Full & Final settlement and disables their login.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Controlled offboarding | A gated 4-stage wizard ensures nothing is skipped before an exit is closed |
| Clean deactivation | Completion flips status, disables the login and revokes tokens in one step |
| Compliance | Clearances, asset returns and signed exit documents are recorded per employee |
| Payroll handoff | The exit's last working day drives Full & Final settlement |
| Reversible | An exit can be undone by re-activating the employee (no destructive delete) |

### 1.3 Key features
- **4-stage wizard** with per-stage gates.
- **Auto notice-period** calculation (last working day derived/validated from the employee's notice days).
- **Clearances** (Manager, IT, Admin, Finance, Legal) + **asset handover** tracking.
- **Exit documents** generated from HR templates and sent for signature.
- **Final validation checklist** + HR sign-off before closure.
- **Farewell email** on completion.
- **Evidence Vault** for all exit-related documents.

---

## 2. ROLES & ACCESS

Exit Management is gated by the **`master.employees`** permission (`can_edit`) — there is no separate exit permission. Super-admins bypass. Within a tenant, the actor must belong to the same client as the employee.

| Role | Access |
|---|---|
| Super Admin | Any employee's exit (cross-tenant) |
| Client Admin / Branch User with `master.employees` edit | Exits within their scope |
| Employee | No exit-management access (self-service is elsewhere) |

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                        EXIT LIFECYCLE (4 stages)                    │
└───────────────────────────────────────────────────────────────────┘
   Employee (Active, fully onboarded)
        │  Initiate Exit
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ STAGE 1 — Exit Initiation & Approval                              │
│  • Exit Type (Resignation/Termination/Retirement/End of Contract/ │
│    Absconding/Other) · Initiated By · Reason                       │
│  • Notice Start Date → Notice End auto = start + notice-period days│
│  • Last Working Day (must be ≥ notice-end, in the future)          │
│  • Reporting Manager · Business Impact · Replacement Required      │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ STAGE 2 — Clearance & Handover                                     │
│  • Asset Handover: each assigned asset → Handed Over / Pending /  │
│    Not Returned                                                    │
│  • 5 Clearances (Manager · IT · Admin · Finance · Legal) →        │
│    Approved / Pending / Rejected  (ALL must be Approved to advance)│
│  • Handover Notes                                                  │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ STAGE 3 — Exit Documents Management                               │
│  • Match exit-trigger HR templates for this employee              │
│  • Preview / generate DOCX · send for signature · remind ·       │
│    download signed PDF                                             │
│  • Every matched doc must reach "Completed"                       │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ STAGE 4 — Final Deactivation & Closure                           │
│  • Final validation checklist (all ticked)                        │
│  • Employee Status · HR Final Sign-off = Approved                 │
│  • COMPLETE EXIT →                                                 │
│      exit_case_status=Closed, current_stage=4, completed_at=now   │
│      employees.status = Resigned | Terminated                     │
│      user.status = inactive + tokens revoked                      │
│      farewell email (best-effort)                                 │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
   Employee → "Exited" bucket → Payroll Full & Final
   (reopen by re-activating the employee)
```

### 3.1 Completion gates (all enforced before "Complete Exit")
1. Last working day has arrived (`≤ today`).
2. Reporting manager not disabled/exited.
3. Every assigned asset = Handed Over.
4. Every matched exit document = Completed.
5. Every clearance = Approved.
6. Every final-validation checkbox ticked.
7. HR final sign-off = Approved.

### 3.2 Exit type → employee status
| Exit type | Resulting `employees.status` |
|---|---|
| Termination, Absconding | **Terminated** |
| Resignation, Retirement, End of Contract, Other | **Resigned** |

(The status enum has no Retired/Exited value, so Retirement maps to Resigned.)

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Exit Management Hub (`HrExitManagement.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Exit Management                                                    │
│  [Total] [Active] [Exit in Progress] [Exited] [Missing Details]   │
├───────────────────────────────────────────────────────────────────┤
│  [Active | In Progress | Exited]   [Search]                       │
│  ┌───────────────────────────────────────────────────────────────┐│
│  │Sr│Employee│Emp ID│Dept│Desig│Role│Anc.Role│Manager│Readiness│St│Act││
│  └───────────────────────────────────────────────────────────────┘│
│  Actions: Initiate Exit / Continue / Evidence Vault              │
└───────────────────────────────────────────────────────────────────┘
```
Only fully-onboarded employees (`onboarding_stage_completed >= 6`) appear. Exit Readiness is a progress bar across the stages.

### 4.2 Exit Process Modal (the wizard)
Four stages (§3). Stage 1 auto-derives the notice-period end date (read-only) and validates the last working day. Stage 2 blocks until all 5 clearances are Approved. Stage 3 integrates HR document generation + e-signature. Stage 4 shows either "Ready to close" or a blocker list.

### 4.3 Exit Checklist Modal (reference only)
A static 6-stage checklist filtered by designation level / IT vs non-IT. **This is reference material, not the process** — the operative wizard has 4 stages.

### 4.4 Evidence Vault Modal
Three tabs: employee documents, organizational (onboarding-trigger) templates, and exit (exit-trigger) templates + signing runs.

---

## 5. STATUS MODELS

### 5.1 Exit case status (`exit_case_status`)
`Open` (default) → `Closed` (set by completion).

### 5.2 Frontend bucket (derived)
| Bucket | When |
|---|---|
| Exited | `exit_case_status=Closed` OR `completed_at` set OR employee status ∈ {Resigned, Terminated} |
| Exit In Progress | any exit data present (exit_type/dates/current_stage≥1) or status "Notice Period" |
| Missing Details | no email/department/designation |
| Active | otherwise |

### 5.3 Employee status after completion
`Resigned` or `Terminated`; login `user.status=inactive`, tokens revoked.

---

## 6. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | One exit record per employee |
| 2 | Only fully-onboarded employees can be exited |
| 3 | Last working day must be ≥ notice-period end and reached before closure |
| 4 | All clearances Approved + all assets Handed Over + all exit docs Completed before closure |
| 5 | HR final sign-off = Approved before closure |
| 6 | Completion sets Resigned/Terminated, disables login, revokes tokens |
| 7 | Completed exits are auto-excluded from regular payroll |
| 8 | Full & Final requires an exit record and uses its last working day |
| 9 | Exit is reversible (re-activate the employee) |
| 10 | Access is gated by `master.employees` edit + same-tenant |

---

## 7. INTEGRATION WITH PAYROLL

- Regular payroll **excludes** employees with status Inactive/Resigned/Terminated, and anyone whose exit `last_working_day` is before the period start.
- **Full & Final** (`/payroll/fnf/{employeeId}`) refuses to compute unless an exit record exists, and uses the exit's `last_working_day` as the settlement date. See `docs/payroll/`.

---

## 8. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Stage count | UI reference text says "6 stages"; the real process is 4 |
| Permission | No dedicated exit permission (uses `master.employees`) |
| Data integrity | `employee_exits` has no DB foreign keys (incl. reporting manager) |
| Status enum | No Retired/Exited value (Retirement → Resigned) |
| Farewell email | Best-effort to the personal email; never blocks completion |

---

*Related documents: EXIT_TECHNICAL_DOCUMENTATION.md · EXIT_CODE_WALKTHROUGH.md · EXIT_API_DOCUMENTATION.md*
