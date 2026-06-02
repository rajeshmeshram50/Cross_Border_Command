# Cross_Border_Command — Development Status Sheet

> What is built, what is pending. Module → menu → sub-menu, with status.
> Generated from the live sidebar menu config (`resources/js/constants.ts`) on **2026-06-02**.

**Legend**

| Symbol | Meaning |
|---|---|
| ✅ | Done — built & usable |
| 🟡 | Partial — built but some part pending |
| ⏳ | Pending / Stub — link exists, page not built yet |

---

## 0. Who sees what (Role access)

| Module | Super Admin | Client Admin | Branch User | Employee |
|---|---|---|---|---|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Clients | ✅ | — | — | — |
| Plans / Payments (billing) | ✅ | — | — | — |
| Branches | — | ✅ | — | — |
| My Plan | — | ✅ | — | — |
| Master | ✅ (5 only) | ✅ | ✅ | ✅ |
| HR | — | (URL only) | ✅ | — |
| Sales Matrix | — | (granter) | ✅ | ✅ |
| Central CLM | — | (granter) | ✅ | ✅ |
| Products | — | — | ✅ | ✅ |
| Suppliers | — | — | ✅ | ✅ |
| Clock-In | — | — | — | ✅ |
| Permissions | ✅ | ✅ | ✅ | — |
| Settings | ✅ | — | — | — |
| Profile | ✅ | ✅ | ✅ | ✅ |

> "granter" = the role holds the permission only to cascade it down to branches; the menu does not show for them.
> Super Admin sees only 5 global masters (Organization Types, Countries, States, State Codes, Address Types); the rest are tenant masters.

---

## 1. Platform / Theme — ✅ DONE

| Item | Status |
|---|---|
| Dark mode / Light mode toggle (top bar + sidebar) | ✅ |
| Collapsible sidebar (expand / collapse + floating popout) | ✅ |
| Sidebar grouped menu (parent → group → leaf, with counts) | ✅ |
| Fullscreen toggle | ✅ |
| Notifications bell (icon) | ✅ |
| Profile card in sidebar | ✅ |
| Branch switcher (auto-injects branch_id) | ✅ |
| Idle timeout | ✅ |
| Multi-tenant scoping (Client → Branch → User) | ✅ |

---

## 2. Authentication & Access — ✅ DONE

| Item | Status |
|---|---|
| Email + Password login | ✅ |
| Face recognition login | ✅ |
| Google OAuth login | ✅ |
| Forgot password (OTP → verify → reset) | ✅ |
| Brute-force lockout (5 attempts / 15 min) | ✅ |
| **Permissions** module (grant per-module access) | ✅ |
| **Clients** (super admin manages tenants) | ✅ |
| **Branches** (client admin manages offices) | ✅ |
| **Settings** | ✅ |
| **Profile** | ✅ |

---

## 3. Master Data — ✅ DONE (≈55 masters)

All masters use the generic master engine (list + add/edit/delete + KPIs + "what this does" help).

### 3.1 Identity & Entity (8) — ✅
- ✅ Organization Types
- ✅ Legal Entities
- ✅ Company Details
- ✅ Bank Accounts
- ✅ Departments
- ✅ Roles
- ✅ Designations
- ✅ KPI Master

### 3.2 Geography & Location (6) — ✅
- ✅ Countries
- ✅ States
- ✅ State Codes
- ✅ Address Types
- ✅ Ports of Loading
- ✅ Ports of Discharge

### 3.3 Trade & Commercial (8) — ✅
- ✅ Segments
- ✅ HSN Codes
- ✅ GST Percentages
- ✅ Currencies
- ✅ Units of Measurement (UOM)
- ✅ Packaging Materials
- ✅ Product Conditions
- ✅ Incoterms

### 3.4 Party & Classification (5) — ✅
- ✅ Customer Types
- ✅ Customer Classifications
- ✅ Supplier Types
- ✅ Supplier Behaviour
- ✅ Applicable Parties

### 3.5 Legal & Compliance (5) — ✅
- ✅ License Types
- ✅ Risk Levels
- ✅ Document Types
- ✅ Hazard Classifications
- ✅ Compliance Behaviours

### 3.6 Operations & Support (3) — ✅
- ✅ Assets
- ✅ Asset Categories
- ✅ Expense Categories

### 3.7 P2P Masters (10) — ✅
- ✅ Payment Terms
- ✅ Approval Authority
- ✅ Procurement Category
- ✅ Sourcing Type
- ✅ Deviation Reason
- ✅ Match Exception Type
- ✅ Advance Payment Rules
- ✅ Exchange Rate Log
- ✅ Goods vs Service Flag
- ✅ Supplier Directory

### 3.8 Warehouse Masters (8) — ✅
- ✅ Warehouse Master
- ✅ Zone Master
- ✅ Rack Type Master
- ✅ Temperature Class
- ✅ Rack & Location
- ✅ Shelf / Level
- ✅ Digital Twin
- ✅ Freezer Management

### 3.9 Attendance Master Management (2) — ✅
- ✅ Leave Type Master
- ✅ Leave Plan Master

---

## 4. Sales Matrix — ✅ DONE

### 4.1 Sales Insights & Productivity
- ✅ Sales Analytics
- ✅ Productivity Tracker
- ✅ Procure to Pay (P2P) Summary

### 4.2 Sales Core (Masters)
- ✅ Customers
- ✅ Consignee
- ✅ Lead Acknowledgement Master

### 4.3 Sales Matrix Operations
- ✅ My Workplace
- ✅ Quotation Vs PI History

### 4.4 The 6-Stage Pipeline
| Stage | Status |
|---|---|
| Stage 1 — Inquiry Received | 🟡 pending |
| Stage 2 — Lead Acknowledgement | ✅ |
| Stage 3 — Product Sourcing | ✅ |
| Stage 4 — Price Shared | ✅ |
| Stage 5 — Quotation vs PI | ✅ |
| Stage 6 — Victory (Procurement + Shipment) | ✅ |

---

## 5. Products & Suppliers — ✅ DONE

| Item | Status |
|---|---|
| **Products** catalog (card grid) | ✅ |
| Product step-wise wizard: Core → Sales → Quality → Vendors | ✅ |
| **Suppliers** (Vendors) | ✅ |
| Supplier step-wise wizard: Identity → Contacts → KYC → Products | ✅ |

---

## 6. Central CLM — only 2 clusters built

> Per request, only the two production clusters are listed as built.
> The 3 "Command Center / Operations" clusters are stub pages (⏳).

### 6.1 Compliance & Regulatory — ✅ DONE
- ✅ Segment
- ✅ Authority
- ✅ Quality & Compliance Docs
- ✅ KYC
- ✅ Due Diligence (DD)
- ✅ Trade Licenses

### 6.2 Contract & Document Masters — ✅ DONE
- ✅ Document Control Panel (DCP)
- ✅ Trade Documents
- ✅ Agreements
- ✅ Terms & Conditions
- ✅ Clause Library
- ✅ E-signature flow (Zoho Sign)

### 6.3 Other CLM clusters — ⏳ STUB (not built)
- ⏳ CLM Analytics / Diagnosis View / Resolution Center
- ⏳ Buyer Profile / Supplier Profile (With Shipment ID)
- ⏳ Case to Case / Agreements We Sent / Agreements To Approve (Without Shipment ID)

---

## 7. HRMS — ✅ DONE (Branch user)

### 7.1 HRMS Command Center
- ✅ HRMS Overview
- 🟡 PIP
- 🟡 HR Reports

### 7.2 HR Core
- ✅ Recruitment
- ✅ Employee
- ✅ Employee Onboarding (public token form)
- ✅ Exit Management

### 7.3 Time & Pay Inputs
- 🟡 Payroll
- 🟡 Calculation Master
- ✅ Attendance (face punch, multi-punch)
- ✅ Leave
- ✅ Leave Approvals
- ✅ Expense Management

### 7.4 Document & Evidence
- ✅ Broadcast Centre
- ✅ Document Templates (DOCX merge + signing)
- ✅ Custom Fields
- ✅ Trigger Point Master

### 7.5 Attendance (Employee)
- ✅ Clock-In (face recognition punch screen)

---

## 8. Billing — ✅ DONE

| Item | Role | Status |
|---|---|---|
| Plans | Super Admin | ✅ |
| Payments | Super Admin | ✅ |
| My Plan / Plan selection | Client Admin | ✅ |
| Razorpay subscription + webhook | — | ✅ |
| Plan-expired / module gating | — | ✅ |

---

## 9. Quick summary

| Area | Status |
|---|---|
| Dark/Light mode, sidebar, top bar | ✅ Done |
| Login (password / face / Google) | ✅ Done |
| Clients / Branches / Permissions / Settings | ✅ Done |
| Master Data (≈55 masters) | ✅ Done |
| Sales Matrix (pages + 6 stages) | ✅ Done — Stage 1 pending |
| Products & Suppliers (step wizards) | ✅ Done |
| CLM — Compliance & Regulatory | ✅ Done |
| CLM — Contract & Document Masters | ✅ Done |
| CLM — other clusters | ⏳ Stub |
| HRMS (core, attendance, leave, expense, docs) | ✅ Done |
| HRMS (PIP, Reports, Payroll) | 🟡 Partial |
| Billing (plans, payments, Razorpay) | ✅ Done |
