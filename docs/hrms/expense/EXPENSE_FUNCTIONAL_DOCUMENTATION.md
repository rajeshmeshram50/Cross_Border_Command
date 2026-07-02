# EXPENSE MANAGEMENT MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Expense Management

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
Expense Management lets employees claim reimbursements and request advances, each routed through a two-stage approval (reporting manager → HR/Finance). Approved advances are recovered from salary via Payroll.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Controlled spend | Every claim/advance is manager- then finance-approved |
| Audit-ready | Receipts, codes, timestamps and comments on every record |
| Automatic recovery | Approved advances deduct from payroll on schedule |
| Visibility | HR dashboard with KPIs and spend-by-category analytics |
| Self-service | Employees raise and track their own claims/advances |

### 1.3 Key features
- **Expense Claims** (category, amount, date, mandatory receipt).
- **Advance Requests** (type, amount, recovery schedule EMI/lumpsum).
- **Two-stage approval** (manager → HR/Finance).
- **Payroll recovery** of approved advances (capped to net).
- **My/Team views**, drafts, and Excel/PDF/CSV export.

---

## 2. ROLES & ACCESS
| Role | Access |
|---|---|
| Employee | Raise & track own claims/advances (My) |
| Reporting Manager | Approve/reject their reports' claims/advances (Team) |
| HR / Finance | Final approve/reject (needs `hr.expense` approve); view all |
| Super Admin | All, cross-tenant |

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                    CLAIM / ADVANCE LIFECYCLE                        │
└───────────────────────────────────────────────────────────────────┘
   EMPLOYEE raises
     • Claim: category, amount, expense date (≤30 days back), receipt (required)
     • Advance: type, amount, recovery start + mode (EMI/lumpsum), reason
        │  (auto-approved at manager stage if no reporting manager)
        ▼
   STAGE 1 — Reporting Manager: Approve / Reject (reject closes it)
        │
        ▼
   STAGE 2 — HR / Finance: Approve / Reject (final status)
        │
        ▼
   APPROVED
     • Claim → reimbursement (recorded)
     • Advance → Payroll recovery per schedule (capped to net)
```

### 3.1 Advance recovery
| Mode | Behaviour in payroll |
|---|---|
| EMI | `monthly_emi` (or amount/months) each cycle within the schedule |
| Lumpsum | full amount once, in the recovery-start month |
| Bimonthly | (currently behaves as lumpsum) |

Recovery is capped so it never drives net pay negative; the outstanding is fully recovered in Full & Final.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 HR Expense Management (`HrExpenseManagement.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Expense Management        [Expense | Advance]   [Export ▼]        │
│  [Total Claims][Total Amount][Approved][Pending][Rejected]        │
│  Spend by Category (chart)                                         │
│  Table (claim/advance rows) → Manager/HR Approve · Reject         │
└───────────────────────────────────────────────────────────────────┘
```
Advance table columns: Adv ID, Employee, Type, Reason, Amount, Requested, Recovery Start, Recovery (mode), Monthly EMI, Attachments, Status, Action.

### 4.2 Employee Expense tab
Hero (Total Claimed / Requested — approved only), Expense/Advance switch, My/Team sub-tabs, filter pills (All/Approved/Rejected/Pending/Drafts), "Raise New Claim" / "New Advance Request". Claim form: category, amount, date, project, payment method, vendor, purpose, receipt. Advance form: type (+ other), amount, requested date (today), recovery start, recovery mode (EMI shows months + computed EMI), reason.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Two-stage approval: manager then HR/Finance |
| 2 | HR verdict is the final `status`; manager reject closes the claim |
| 3 | Codes `EXP-####` / `ADV-####` (auto) |
| 4 | Claim expense date within the last 30 days; receipt mandatory |
| 5 | Advance requested date = today; EMI mode needs months |
| 6 | Auto-approve the manager stage when the employee has no reporting manager |
| 7 | Approved advances recover from payroll (capped to net) |
| 8 | Category monthly/yearly limits are not enforced |
| 9 | Bimonthly recovery currently behaves as lumpsum |
| 10 | Own/manager can act on their rows; listing all needs `hr.expense` |

---

## 6. STATUS MODEL
`status`, `manager_status`, `hr_status` each ∈ **pending / approved / rejected**. A claim/advance is done when `hr_status` (or a manager reject) sets the top-level `status`.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Category limits | Stored but not enforced |
| Bimonthly | Treated as a single lump-sum recovery |
| Integrity | No DB foreign keys / soft deletes; claims keep an employee-name snapshot |
| Attachments | Served via public routes authenticated by a `?token=` |

---

*Related documents: EXPENSE_TECHNICAL_DOCUMENTATION.md · EXPENSE_CODE_WALKTHROUGH.md · EXPENSE_API_DOCUMENTATION.md*
