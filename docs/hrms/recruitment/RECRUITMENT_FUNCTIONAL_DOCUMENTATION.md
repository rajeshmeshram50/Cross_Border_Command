# RECRUITMENT MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Recruitment

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
Recruitment manages hiring end-to-end before an employee exists: a manager raises a **Hiring Request**, HR approves and converts it into an open **Recruitment** (requisition), and applicants flow through a **Candidate** pipeline until Selected/Offered. Selected candidates are then onboarded via the Employee/Onboarding modules.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Structured demand | Managers formally request headcount with justification |
| Approval trail | Requests move through Draft → Submitted → Approved with notifications |
| Requisition tracking | Open recruitments track openings, deadlines and progress |
| Applicant pipeline | Candidates progress through clear stages with CV and referral capture |
| Bulk intake | CSV/XLSX import of candidate shortlists |
| Guardrails | Completion requires enough selected candidates; selection capped at openings |

### 1.3 Key features
- **Hiring Requests** with a multi-section form (Basics / Hiring Need / Role Details) and Draft vs Submit.
- **Convert** a hiring request into a recruitment (prefilled, linked).
- **Recruitments** list with status tabs and KPIs.
- **Candidate pipeline** (8 stages) with CV upload, referral, and bulk import/export.
- **Notifications** on request submit and candidate selection/rejection.
- **Lazy lifecycle** — recruitments expire past deadline; stale requests auto-reject.

---

## 2. ROLES & ACCESS

Gated by **`hr.recruitment`** (view/add/edit/delete). Super-admins bypass. For Hiring Requests and Recruitments, **reporting managers** get implicit access (so managers can raise/track requests for their team). Candidate management requires the explicit permission (only super-admin bypasses).

| Role | Access |
|---|---|
| Super Admin | All, cross-tenant |
| Client Admin / Branch User with `hr.recruitment` | Full within scope |
| Reporting Manager | Hiring Requests & Recruitments (implicit) |
| Others | Per permission grant |

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                       RECRUITMENT FUNNEL                            │
└───────────────────────────────────────────────────────────────────┘
   MANAGER
     │  Raise Hiring Request (Draft → Submit)
     ▼
┌───────────────────────────────────────────────────────────────────┐
│ HIRING REQUEST                                                     │
│  Draft → Submitted → Under Review → Approved (/ Sent Back / Reject)│
│  • notifies the requester's manager on submit                     │
│  • auto-Rejected if target join date passes unconverted           │
└───────────────────────────────┬───────────────────────────────────┘
                                 │  Convert (prefill + link)
                                 ▼
┌───────────────────────────────────────────────────────────────────┐
│ RECRUITMENT (requisition)                                         │
│  In Progress → Completed (/ Cancelled / Expired)                  │
│  • openings, deadline, hiring manager, assigned HR                │
│  • auto-Expired past deadline                                     │
│  • Completed only when Selected candidates ≥ openings             │
└───────────────────────────────┬───────────────────────────────────┘
                                 │  add candidates
                                 ▼
┌───────────────────────────────────────────────────────────────────┐
│ CANDIDATES (pipeline)                                             │
│  Applied → Shortlisted → In Interview → Final Interview →         │
│  Selected → Offered  (or Rejected / On Hold)                      │
│  • CV upload · referral · bulk import                            │
│  • Selected capped at openings                                    │
│  • emails on Selected / Rejected                                 │
└───────────────────────────────┬───────────────────────────────────┘
                                 │  Selected
                                 ▼
                     Employee / Onboarding modules
```

### 3.1 Hiring request → recruitment (convert)
"Create Recruitment" from an approved request prefills the recruitment form (role, department, openings, etc.) and, on save, stores `hiring_request_id` to link them (feeds the "Converted" KPI).

### 3.2 Candidate intake
Add manually (with CV) or **import** a CSV/XLSX (only rows marked "Final Round Selected"/"Selected" are accepted; duplicates by email/mobile are skipped). Export honours the current filters.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Recruitment dashboard (`HrRecruitment.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Recruitment            [Raise Request] [Requests] [+ Create]     │
│  [In Progress | Completed | Cancelled | Expired]   [Search]       │
│  Sr│REC ID│Job Title│Dept│Desig│Emp Type│Openings│Exp│Mode│Prio│  │
│  HM│HR│Start│Deadline│Action(Edit/View Candidates/Complete/Cancel)│
└───────────────────────────────────────────────────────────────────┘
```
Hiring-request modals: Raise Request (3 sections), Requests List (pending/created/rejected), View/Reject, Create Recruitment (convert).

### 4.2 Candidate management (`HrCandidates.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Candidates — <Recruitment>        [Import] [Export] [+ Add]      │
│  [Total][In Interview][Selected][Rejected]                        │
│  [Final Round Selected | Selected | Rejected]   [Search]          │
│  Sr│Name│Email│Mobile│Exp│Cur Sal│Expected│Notice│Source│CV│St│Act│
│  Actions: Edit · Mark Selected · Mark Rejected                    │
└───────────────────────────────────────────────────────────────────┘
```
Candidate form sections: Basic Details, Compensation, Source (referral), CV attachment, Status. Add/Import disabled when the recruitment is closed.

---

## 5. STATUS MODELS

| Entity | Statuses |
|---|---|
| Hiring Request | Draft · Submitted · Under Review · Approved · Sent Back · Rejected |
| Recruitment | In Progress · Completed · Cancelled · Expired |
| Candidate | Applied · Shortlisted · In Interview · Final Interview · Selected · Offered · Rejected · On Hold |

---

## 6. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Codes auto-allocated: `HRQ-###`, `REC-###` (candidates have no code) |
| 2 | Reporting managers get implicit access to requests & recruitments |
| 3 | Recruitment can't be Completed until Selected candidates ≥ openings |
| 4 | Candidate can't be Selected beyond the number of openings |
| 5 | Candidates can't be added to a closed/expired recruitment |
| 6 | Duplicate guards on requests, recruitments and candidates |
| 7 | Lazy lifecycle: recruitments expire past deadline; stale requests auto-reject |
| 8 | Notifications on request submit and candidate select/reject |
| 9 | Import accepts only "Final Round Selected"/"Selected" rows; skips duplicates |
| 10 | All records soft-delete; deletion guarded by creator hierarchy |

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| CV size copy | Inline error says "10 MB" but the real cap is 2 MB |
| Export label | Button says XLSX but the file is CSV |
| Lifecycle | Expiry/auto-reject only run on list load (no scheduler) |
| Candidate perms | Candidate management needs the explicit permission (no manager implicit access) |

---

*Related documents: RECRUITMENT_TECHNICAL_DOCUMENTATION.md · RECRUITMENT_CODE_WALKTHROUGH.md · RECRUITMENT_API_DOCUMENTATION.md*
