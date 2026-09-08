# EXPENSE MANAGEMENT MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Expense Management

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |
| 2.0 | 2026-09-08 | System | Payment & settlement lifecycle, company advances, returns and reimbursement, batch payment, Zoho sync. Corrected the no-manager rule, bimonthly recovery and receipt rules. |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose

Expense Management lets employees claim reimbursements and request advances, each routed through a two-stage approval (reporting manager → HR/Finance). Approval is only the halfway point: the module then tracks the **money actually moving** — what was sanctioned after deductions, what has been paid, what is still outstanding, and for company advances, what was spent, returned or reimbursed.

### 1.2 Business value

| Benefit | Description |
|---|---|
| Controlled spend | Every claim and advance is manager- then finance-approved |
| Audit-ready | Receipts, payment proofs, codes, timestamps and comments on every record |
| Money actually tracked | Sanctioned vs paid vs outstanding, with partial payments |
| Automatic recovery | Approved self-advances deduct from payroll on schedule, arrears carried |
| Company spend closed out | Employees account for company advances bill by bill |
| Finance efficiency | One consolidated payment can settle many claims |
| Books stay in step | Payments push to Zoho Books |
| Visibility | HR dashboard with KPIs and spend-by-category analytics |

### 1.3 Key features

- **Expense Claims** — category, amount, date, mandatory receipt.
- **Advance Requests** — type, amount, and either a salary-recovery schedule (`self`) or a company-spend mandate (`company`).
- **Two-stage approval** — manager → HR/Finance.
- **Settlement** — sanctioned amount with itemised deductions/additions, then partial payments each with proof.
- **Batch payment** — settle many of an employee's claims in one transaction under one reference.
- **Company-advance settlement** — the employee declares spend bill by bill; the balance is returned or the over-spend reimbursed.
- **Payroll recovery** — EMI, bimonthly or lumpsum, capped at 70 % of net, shortfalls carried forward.
- **My/Team views**, drafts, Excel/PDF/CSV export, and reimbursement advice by email.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Employee | Raise & track own claims/advances; settle their own company advances; return balances |
| Reporting Manager | Approve/reject their reports' claims/advances (Team view) |
| Branch Admin | Acts as reporting manager where none is assigned; approves settlements and confirms return payments |
| HR / Finance | Final approve/reject (`hr.expense` approve); sanction, pay, batch-pay; view all |
| Super Admin | All, cross-tenant; exempt from the self-action blocks |

**Nobody may act on their own money.** An employee cannot approve their own claim, and cannot record the payment for it — that is always the reporting manager or branch user.

---

## 3. BUSINESS PROCESS FLOW

### 3.1 Expense claim

```
   EMPLOYEE raises a claim
     • category, amount, expense date (today back to 30 days), payment method
     • at least one receipt (2 MB per file, 5 MB per claim)
     • blocked before onboarding completes or before the joining date
        ▼
   STAGE 1 — Reporting Manager (or branch admin where none is assigned)
     Approve / Reject  ·  reject needs a reason and closes the claim
        ▼
   STAGE 2 — HR / Finance
     Approve / Reject  ·  may set deductions & additions at this point
        ▼
   APPROVED  → net payable = claim − deductions + additions  (must be > 0)
        ▼
   PAYMENT   • one payment at a time, each with proof, until fully paid
             • or a consolidated BATCH payment across several claims
        ▼
   PAID      → push to Zoho Books → email the reimbursement advice
```

### 3.2 Advance request — two kinds

An advance is raised as either **self** or **company**, and the two behave very differently after approval.

```
                    ADVANCE APPROVED & PAID OUT
                              │
          ┌───────────────────┴────────────────────┐
          ▼                                        ▼
    used_for = SELF                         used_for = COMPANY
    recovered from salary                   spent on the company's behalf
          │                                        │
    EMI / bimonthly / lumpsum              EMPLOYEE SETTLES, bill by bill
    from recovery_start                    declaring up front whether spend is
    capped at 70% of net                   equal / less / more than the advance
    shortfall carried forward                       │
          │                                 BRANCH ADMIN / HR verdict
          ▼                                         │
     fully recovered              ┌─────────────────┼─────────────────┐
                                  ▼                 ▼                 ▼
                              EQUAL             LESS (return)    MORE (reimburse)
                             nothing owed    employee returns    company owes the
                                             the balance —       excess → raises a
                                             direct or payroll   linked EXP-#### claim
                                                   │
                                        each return payment is
                                        confirmed individually;
                                        the return closes only when
                                        every payment is approved
```

### 3.3 Advance recovery in payroll

| Mode | Behaviour |
|---|---|
| EMI | `monthly_emi` (or amount ÷ months) every cycle within the schedule |
| **Bimonthly** | **Every other month**, for the stated number of instalments |
| Lumpsum | Full amount once, in the recovery-start month |

Recovery runs on two streams — the employee repaying an advance (`self`) and returning unused company money via payroll (`return`). Total recovery is capped at **70 % of net-before-recovery**; anything not taken this cycle is **carried forward as arrears** and collected later. The oldest schedule has priority when the cap bites. Loan-type advances report on their own payslip line, separate from other advances. Any outstanding balance is recovered in Full & Final.

> **Changed since v1.0:** bimonthly is genuinely every other month now — it used to behave as a lumpsum.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 HR Expense Management (`HrExpenseManagement.tsx`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Expense Management     [Expense | Advance]      [Batch Pay] [Export ▼]│
│  [Total Claims][Total Amount][Approved][Pending][Rejected]            │
│  Spend by Category (chart)                                            │
│  [All][Pending][Approved][Rejected]           search · date range     │
│  Table → Approve · Reject · Settle · View proofs · Zoho status        │
└──────────────────────────────────────────────────────────────────────┘
```

The KPI tiles, tab badges and category chart describe **every matching claim**, not the rows on screen — the list is paginated and the figures come from the server. Export writes what the filters select, in Excel, CSV or server-rendered PDF.

Advance table columns: Adv ID, Employee, Type, Used For, Reason, Amount, Requested, Recovery Start, Recovery mode, Monthly EMI, Sanctioned, Total Paid, Remaining, Settle Type, Attachments, Status, Action.

### 4.2 Settlement modal (`ExpenseSettlementModal.tsx`)

Sanction the claim (itemised deductions and additions, each needing a reason), then record payments one at a time — amount, category, payment type, expense type, note and a mandatory proof file. Shows the running payment history, the remaining balance and each payment's Zoho state.

### 4.3 Batch payment (`BatchPaymentModal.tsx`)

Pick an employee, tick their approved-unpaid claims, enter one reference number, payment type and a single shared proof. Each claim is paid its **remaining** amount, so partially-paid claims settle correctly.

### 4.4 Employee Expense tab (`ExpenseTab.tsx`)

Hero (Total Claimed / Requested — approved only), Expense/Advance switch, My/Team sub-tabs, filter pills (All/Approved/Rejected/Pending/Drafts), and the raise forms.

- **Claim form:** category, amount, date, project, payment method, vendor, purpose, receipt.
- **Advance form:** type (+ other), used-for, amount, requested date (today), recovery start, recovery mode (EMI shows months and the computed instalment), reason, attachment. Shows the employee's EMI headroom while they type.
- **Settle a company advance:** add bills incrementally, each with amount, reason, method and proof; finalise to lock.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Two-stage approval: manager then HR/Finance |
| 2 | HR verdict is the final `status`; a manager reject closes the record; rejection needs a reason |
| 3 | Codes `EXP-####` / `ADV-####`, allocated per tenant without collision |
| 4 | Claim expense date within the last 30 days and never future; at least one receipt |
| 5 | Receipts: 2 MB per file, 5 MB per claim; PDF/JPG/PNG only |
| 6 | **Where no reporting manager is assigned, the branch admin approves stage 1 explicitly — there is no auto-approval** |
| 7 | Nobody approves or pays their own claim or advance |
| 8 | Claims and advances cannot be raised before onboarding completes, or before the joining date |
| 9 | Advance requested date = today; minimum ₹100; an attachment is required |
| 10 | Recovery starts no earlier than the 1st of next month (this month's payroll may be done) and no later than a year out |
| 11 | Each recovery instalment is at least ₹500, and never more than the advance itself |
| 12 | Net payable (claim − deductions + additions) must be greater than zero; every adjustment needs a reason |
| 13 | A payment can never exceed the remaining balance; each needs a proof document |
| 14 | Company advances are settled bill by bill, then approved by a branch admin/HR before any return or reimbursement |
| 15 | A return closes only when every payment covering the balance has been approved |
| 16 | Payroll recovery is capped at 70 % of net; the shortfall is carried forward |
| 17 | Category monthly/yearly limits are **not** enforced |
| 18 | Reimbursement advice can only be emailed once the claim is fully paid **and** synced to Zoho |
| 19 | Listing everyone's records requires `hr.expense`; owners and managers see their own |

---

## 6. STATUS MODEL

**Approval** — `status`, `manager_status`, `hr_status` each ∈ pending / approved / rejected. The record is decided when HR sets `status`, or a manager reject closes it early.

**Payment** — `settlement_status` ∈ unpaid / partial / paid, driven by `total_paid` against `sanctioned_amount`.

**Company-advance settlement** — `settle_declared_type` ∈ equal / minimum / maximum (declared up front, then locked), resolving to `settle_type` ∈ equal / return / reimburse, with `settle_approval_status` recording the branch admin's verdict.

**Zoho** — `zoho_status` per payment: not synced → synced.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Category limits | Stored on the category master but never enforced |
| EMI headroom at raise time | The 70 % figure shown when raising an advance is **advisory** — an advance above it is still accepted. Payroll applies its own 70 % cap when recovering |
| Advance list | Not paginated (expense claims are) — large tenants load the full list |
| Integrity | No database foreign keys; claims and advances are never soft-deleted, so records are permanent |
| Attachments | Served over public links authenticated by a token in the URL |
| One-time pay-off | Paying an advance off in a single direct payment is built but currently switched off |
| Sorting | List sorting applies to the page on screen, not the whole result set |

---

*Related documents: EXPENSE_TECHNICAL_DOCUMENTATION.md · EXPENSE_CODE_WALKTHROUGH.md · EXPENSE_API_DOCUMENTATION.md*
