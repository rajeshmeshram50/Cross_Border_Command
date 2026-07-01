# PAYROLL MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Payroll

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose

The Payroll module lets a tenant process a full monthly salary run for its employees — from finalizing attendance, through generating per-employee payslips with statutory deductions, review and approval, to bank disbursement and payslip distribution. It also handles one-off adjustments (overtime/bonus/incentive/deduction), versioned salary structures, and Full & Final settlement for exiting employees.

It is a **cycle-based** engine: one **Payroll Period** per calendar month per branch (or client-wide), each producing one or more **Payroll Runs**, each producing one **Payslip** per eligible employee.

### 1.2 Business Value

| Benefit | Description |
|---|---|
| Compliance | Computes PF, ESI, Professional Tax and honours TDS lines per Indian statutory rules |
| Accuracy | Salary derived from live attendance, approved leave, holidays and versioned salary structures |
| Financial control | LOP, advance recovery, mid-month pro-ration, and a bank-details gate before payout |
| Auditability | Every payroll action written to the activity log; runs are immutable once paid |
| Multi-branch | Per-branch or client-wide runs with strict tenant isolation and per-branch reporting |
| Self-service | Employees view their own payslips and edit their own bank details |

### 1.3 Key Features

- **Cycle dashboard** — 13-month strip with Completed / In Progress / Not Started status per month.
- **Attendance finalization gate** — payroll cannot be generated until attendance is locked for the cycle.
- **Pre-flight check** — a dry-run listing blocking and warning issues before generation.
- **Payroll run** — computes earnings, statutory deductions, LOP and net pay per employee.
- **Four review lenses** — Payroll Processing, Biometric Input, Salary Report, Salary Setup.
- **Approval workflow** — draft → generated → approved → paid, with locking.
- **Disbursement** — cheque/letter or online-transfer mode with a 3-level sign-off and a bank file.
- **Payslips** — per-employee PDF, bulk ZIP, and email (individual or bulk).
- **Salary structures** — versioned; a revision supersedes the previous active version.
- **Adjustments** — overtime, bonus, incentive and ad-hoc deductions, approved before they count.
- **Full & Final** — live settlement calculation for exiting employees.
- **Exports** — streamed CSV, client-side XLSX (current cycle + history).

---

## 2. USER ROLES & PERMISSIONS

### 2.1 Role Definitions

| Role | Description | Responsibilities |
|---|---|---|
| Super Admin | Platform owner | Cross-tenant visibility; all payroll actions |
| Client Admin | Tenant owner | Full payroll across their client and all branches |
| Branch User | Branch-level staff | Payroll for their own branch only (pinned) |
| HR / Payroll Manager | Holds `hr.payroll` permission | Run/approve/pay/export per granted flags (`can_edit`, `can_approve`, `can_export`) |
| Employee | Regular staff | View **own** payslips; edit **own** bank details |

### 2.2 Permission Matrix

| Feature | Super Admin | Client Admin | Branch User | HR (with flag) | Employee |
|---|---|---|---|---|---|
| View cycle dashboard / history | ✓ | ✓ | ✓ (own branch) | ✓ | Own payslips only |
| Finalize attendance | ✓ | ✓ | ✓ | can_edit/can_approve | ✗ |
| Run payroll (generate) | ✓ | ✓ | ✓ | can_edit/can_approve | ✗ |
| Reopen cycle | ✓ | ✓ | ✓ | can_edit/can_approve | ✗ |
| Approve run | ✓ | ✓ | ✓ | can_edit/can_approve | ✗ |
| Pay / disburse | ✓ | ✓ | ✓ | can_edit/can_approve | ✗ |
| View any payslip | ✓ | ✓ | ✓ (own branch) | ✓ | Own only |
| Download payslip PDF | ✓ | ✓ | ✓ | ✓ | Own only |
| Bulk payslip ZIP | ✓ | ✓ | ✓ | can_export/can_edit | ✗ |
| Email payslips | ✓ | ✓ | ✓ | can_manage/can_export | ✗ |
| Export CSV | ✓ | ✓ | ✓ | can_export/can_edit | ✗ |
| Set / revise salary structure | ✓ | ✓ | ✓ | can_edit | ✗ |
| Create adjustments | ✓ | ✓ | ✓ | can_edit | ✗ |
| Full & Final | ✓ | ✓ | ✓ | can_edit/can_approve | ✗ |
| Edit own bank details | ✓ | ✓ | ✓ | ✓ | ✓ (self) |

> `canManage` is `true` for super/client admin and branch user; for other users it requires `hr.payroll` `can_edit` or `can_approve`. `canExport` additionally accepts `can_export`. Employees are always denied management actions and are isolated to their own `employee_id`.

---

## 3. BUSINESS PROCESS FLOW

### 3.1 High-Level Lifecycle

```
┌───────────────────────────────────────────────────────────────────┐
│                       PAYROLL CYCLE LIFECYCLE                       │
└───────────────────────────────────────────────────────────────────┘
                              START
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  SELECT CYCLE (month / year)                                       │
│  • Year dropdown defaults to the CURRENT year                     │
│  • Cycle strip shows Completed / In Progress / Not Started        │
│  • Period auto-created (status = open) on first open              │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 1: FINALIZE ATTENDANCE                    (Rule 1 gate)      │
│  • System shows attendance coverage (how many have punches)      │
│  • "X of Y employees have no attendance" warning if applicable   │
│  • On confirm → period.attendance_finalized = true               │
│  • Payroll CANNOT be generated until this is done                │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 2: PRE-FLIGHT (optional dry-run)                            │
│  • Lists BLOCKING issues (e.g. missing salary structure,         │
│    invalid bank) and WARNINGS (missing punches, LOP, proration)  │
│  • Shows blocked amount and at-risk amount                        │
│  • Fix issues via jump links to Attendance / Employee profile    │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 3: RUN PAYROLL (generate)                 (Rules 5-12)      │
│  • For each eligible employee (Rule 7):                           │
│      resolve active salary structure (Rule 5)                    │
│      pro-rate for mid-month join/exit (Rule 6)                   │
│      apply attendance & leave (Rules 2-3), holidays              │
│      compute PF / ESI / PT / TDS / LOP (Rules 8-9)               │
│      apply approved OT / bonus / adjustments (Rules 4,10)        │
│      recover advances (Rule 11)                                   │
│      gate on bank details (Rule 12)                              │
│  • Payslip status set: Ready | Pending Review | On Hold          │
│  • Run status: draft → generated · period → processing          │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 4: REVIEW (4 tabs)                                          │
│  • Payroll Processing — earnings / deductions / net / status     │
│  • Biometric Input — present / absent / late / missing / source  │
│  • Salary Report — PF / ESI / PT / TDS / LOP / advance           │
│  • Salary Setup — assign / revise missing salary structures      │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 5: APPROVE                                 (Rule 14)        │
│  • Run must have > 0 employees and not be locked                 │
│  • Run status → approved (approved_by / approved_at stamped)     │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 6: PAY / DISBURSE                          (Rules 12,13)    │
│  • Choose mode: Cheque/Letter or Online Transfer                │
│  • Review payment advice / batch                                 │
│  • 3-level sign-off (prepared / verified / approved)            │
│  • Per payslip: valid bank + no blocking → Paid, else On Hold   │
│  • If none held → run = paid, period = LOCKED                   │
│  • If some held → run = approved, period = processing           │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 7: DISTRIBUTE PAYSLIPS                                      │
│  • Download individual PDF, bulk ZIP, or email (single / bulk)  │
│  • On-hold / pending-review slips are excluded from bulk/email  │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  CORRECTIONS?         │
                    │  • Not paid → REOPEN  │  (Rule 15)
                    │  • Paid → next cycle  │
                    └───────────────────────┘

  SIDE FLOW: FULL & FINAL (exiting employee)      (Rule 21)
  • Requires an employee_exits record
  • Final-month salary + leave encashment + dues − recoveries
  • Computed live on request; not persisted
```

### 3.2 Detailed Stage Descriptions

#### Step 1 — Finalize Attendance (Rule 1)
| Aspect | Detail |
|---|---|
| Purpose | Lock the attendance basis so the run is reproducible |
| Pre-condition | Cycle period exists and its start date is not in the future |
| System action | Sets `attendance_finalized`, timestamp and user; reports coverage |
| Guard | Payroll generation is refused until this flag is set |

#### Step 2 — Pre-flight
| Aspect | Detail |
|---|---|
| Purpose | Surface problems before committing a run |
| Blocking issues | Missing salary structure, invalid/missing bank details, zero gross |
| Warnings | Missing punches, LOP from lateness/absence, mid-month pro-ration |
| Output | Per-employee issue list + blocked amount + at-risk amount |

#### Step 3 — Run Payroll
| Aspect | Detail |
|---|---|
| Eligibility (Rule 7) | Excludes Inactive/Resigned/Terminated; requires onboarding stage ≥ 6; excludes future joiners and already-exited staff |
| Regeneration (Rule 13) | Re-running a non-locked cycle wipes and recomputes its payslips |
| Duplicate prevention | DB uniques + cross-run dedup + period row lock |
| Outcome | One payslip per employee, each Ready / Pending Review / On Hold |

#### Step 4 — Review
The four tabs are described in §4.

#### Step 5 — Approve (Rule 14)
| Aspect | Detail |
|---|---|
| Pre-condition | Run exists, is not locked, has > 0 employees |
| Effect | Status → approved; approver + timestamp recorded |

#### Step 6 — Pay / Disburse
| Aspect | Detail |
|---|---|
| Modes | Cheque/Letter · Online Transfer (generates a bank file) |
| Sign-off | Prepared-by / Verified-by / Approved-by (all mandatory) |
| Per-payslip gate (Rule 12) | Net > 0 and valid live bank details and no blocking exception → Paid, else On Hold |
| Cycle lock | All paid → run paid + period **locked**; any held → run stays approved |

#### Step 7 — Distribute Payslips
| Aspect | Detail |
|---|---|
| Individual | PDF download / inline view; email to the employee |
| Bulk | ZIP of PDFs; bulk email — both exclude On Hold / Pending Review |
| Restriction | Provisional (non-final) slips cannot be downloaded or emailed |

#### Corrections (Rule 15)
| Situation | Path |
|---|---|
| Run not yet paid | **Reopen** — reverts run to draft, deletes its payslips, unlocks period |
| Run already paid | Immutable — make changes in the **next** cycle (or via adjustments) |

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Screen: Payroll Dashboard (`HrPayroll.tsx`)

```
┌───────────────────────────────────────────────────────────────────┐
│  Payroll                                                            │
│  [Jun 2026 ▼]     [Run Payroll]   [Export ▼]   [Reopen]           │
├───────────────────────────────────────────────────────────────────┤
│  Cycle History (2026 ▼)                                            │
│  [Jan ✓][Feb ✓][Mar ✓][Apr ✓][May ●][Jun ●][Jul ○] …             │
│   ✓ Completed   ● In Progress   ○ Not Started                     │
├───────────────────────────────────────────────────────────────────┤
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐        │
│  │ Total     │ │ Ready /   │ │ Pending   │ │ On Hold   │        │
│  │ Payroll   │ │ Processed │ │ Review    │ │           │        │
│  │ ₹12,40,000│ │ 18 / 22   │ │ 3         │ │ 1         │        │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘        │
├───────────────────────────────────────────────────────────────────┤
│  [Payroll Processing] [Biometric Input] [Salary Report] [Salary   │
│                                                          Setup]    │
├───────────────────────────────────────────────────────────────────┤
│  [Search…]   [Department ▼]   [Status ▼]                          │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │Sr│Employee     │Emp ID│Dept│Desig│Earnings│Deduct│Net│Att│St│ │
│  │1 │Vaibhav ●    │E-001 │IT  │Dev  │ 45,000 │6,200 │…  │26 │●│ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                              [View] [PDF]         │
└───────────────────────────────────────────────────────────────────┘
```

**Actions:** Run Payroll (opens the pre-flight `PayrollRunModal`); Export (CSV / current XLSX / history XLSX / bulk ZIP / email); Reopen (non-paid cycles); per row View Payslip and Download PDF.

### 4.2 Tab: Payroll Processing
| Column | Meaning |
|---|---|
| Employee / Emp ID / Department / Designation | Identity |
| Earnings / Deductions / Net Pay | Money |
| Att. | **Present days / working days** (attendance record) |
| Status | Ready / Pending Review / On Hold / Paid |
| Action | View payslip · Download PDF |

### 4.3 Tab: Biometric Input
Read-only attendance-sourced view + 5 tiles (Synced, Missing Punch, Mismatch, Paid Leave, Unpaid Leave cases).

| Column | Meaning |
|---|---|
| Present / Absent | Day counts from attendance |
| Late Marks / Missing Punch | Derived flags (3 late = 1 LOP; missing = one-sided punch) |
| Att. Status | Biometric / Review / Manual source |
| Mismatch | "Missing punches" or "Late marks" reason (blank if clean) |

### 4.4 Tab: Salary Report
Statutory breakdown + 5 currency tiles (Total Gross, Net, PF, TDS, LOP).

| Column | Meaning |
|---|---|
| Gross Earnings | Earned gross |
| PF (Emp) / ESI / PT / TDS | Statutory deductions |
| LOP Deducted / Advance Rec. | Adjustments |
| Total Deductions / Net Payable | Totals |
| Payslip | Opens viewer (locked for On Hold / Pending Review) |

### 4.5 Tab: Salary Setup
Roster of employees with monthly-gross and a source badge (Structure / Annual fallback / Not set); per-row **Set Salary** / **Revise** opens `SalaryStructureModal`.

### 4.6 Screen: Payroll Run Modal (pre-flight)
Two phases — **pre-flight** (blocking + warning issue cards with fix links, blocked amount, at-risk amount, export payslips) and **success** (proceed-to-pay). Purely presentational; the dashboard performs the API calls.

### 4.7 Screen: Payment Disbursement Modal
State machine: **mode → advice → approval → success**. Choose Cheque/Letter or Online Transfer, review the batch, capture the 3-level sign-off, then see paid/held counts and the batch reference. Online mode can export a bank file.

### 4.8 Screen: Payslip Viewer Modal
Header (Download PDF / Print / Email), sidebar (Year + Month picker, recent payslips), and a preview (company hero, identity strip, KPI strip, earnings/deductions tables, net-pay banner). Provisional slips block Download/Email.

### 4.9 Screen: Employee Profile → Payroll Tab
- **Payroll Summary** — Payment Information (bank details, with **Edit**), Identity, Address Proof, Statutory cards; View Payslip.
- **Payment Details** — Current Compensation, Payroll Info, and the **Salary Timeline** (revisions with View Breakdown; Revise Salary).

---

## 5. BUSINESS RULES (the 21)

| # | Rule | Behaviour |
|---|---|---|
| 1 | Attendance finalization | Must finalize attendance before generating payroll |
| 2 | Late-mark deduction | 3 late marks = 1 LOP day (warning only, no auto-hold) |
| 3 | Leave salary impact | Paid vs unpaid leave; half-day counts 0.5; working-day basis |
| 4 | Overtime | Counts only when approved |
| 5 | Salary structure | An active structure is mandatory, else the payslip is On Hold |
| 6 | Join/exit pro-ration | Mid-month join/exit pro-rated on a calendar-day basis |
| 7 | Eligibility | Inactive/Resigned/Terminated and future joiners excluded |
| 8 | Provident Fund | 12% of basic capped at ₹15,000, eligible employees only |
| 9 | Professional Tax | State-wise (currently Maharashtra slab hardcoded) |
| 10 | Bonus / incentive | Counts only when approved |
| 11 | Advance recovery | EMI/lumpsum recovery, capped so it never exceeds net |
| 12 | Bank-details gate | Calc always runs; payout/export blocked if bank invalid |
| 13 | Duplicate prevention | DB uniques + cross-run dedup + row lock |
| 14 | Status & locking | draft → generated → approved → paid |
| 15 | Post-approval changes | Only via reopen (non-paid) or the next cycle |
| 16 | Payslip content | Earnings, deductions, gross, net and meta on every slip |
| 17 | Export | Honours filters and is auth-gated |
| 18 | Audit trail | Every payroll action logged |
| 19 | Structure versioning | Revisions supersede; never overwrite |
| 20 | Tenant/branch isolation | Scope derived from the authed user, never the body |
| 21 | Full & Final | Computed live for exits (not persisted) |

**Additional heads not in the original 21:** ESI (0.75% of earned gross ≤ ₹21k), TDS (structure line only — no slab engine), holiday credit, other structure deductions (scaled by earned factor), one-off deduction adjustments (full amount).

---

## 6. STATUS MODELS

### 6.1 Cycle (period) status
`open` → `processing` (after a run) → `locked` (after full payment). Reopen reverts a non-paid cycle to `open`.

### 6.2 Run status
`draft` → `generated` (after run) → `approved` (after approve) → `paid` (after full disbursement).

### 6.3 Payslip status
| Status | Meaning |
|---|---|
| Ready | No issues; ready to pay |
| Pending Review | Warnings present (e.g. missing punches, LOP) |
| On Hold | Blocking issue (no structure / invalid bank / zero gross) |
| Paid | Disbursed |

### 6.4 Attendance source
| Source | Meaning |
|---|---|
| Biometric | Clean attendance-derived figures |
| Review | Flagged (missing punches or late-mark LOP) — needs HR attention |
| Manual | No attendance rows exist for the employee this cycle |

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Professional Tax | Maharashtra slab only; other states not yet modelled |
| TDS | No slab engine — only a structure `tds` line is applied |
| Loan recovery | Not implemented (advances only) |
| Late marks | Warning only — no automatic hold or waiver workflow |
| Full & Final | Computed live, not stored |
| Export filters | Branch / employee-type filters not fully implemented |
| Employee type | No dedicated `employee_type` field for PF/exclusion nuances |

---

*Related documents: PAYROLL_TECHNICAL_DOCUMENTATION.md · PAYROLL_CODE_WALKTHROUGH.md · PAYROLL_API_DOCUMENTATION.md*
