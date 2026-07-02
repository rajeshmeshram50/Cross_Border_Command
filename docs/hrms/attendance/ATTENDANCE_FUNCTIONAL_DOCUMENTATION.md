# ATTENDANCE MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Attendance

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
Attendance captures each employee's working day through **face-recognition punches**. Every tap (Check In, Lunch Out, etc.) is recorded; the system derives present/late/missing status, computes worked hours, and lets HR review a daily console. Employees can request corrections (regularization) which flow to their manager. Attendance is the raw input for Payroll.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Contactless clock-in | Face-based punches with geolocation, no hardware terminal |
| Accurate ledger | Multi-punch model records every in/out with strict alternation |
| Automatic status | Late/missing/present derived from punches + shift rules |
| Fair corrections | Regularization workflow with manager approval |
| Payroll-ready | Present/late/missing feed directly into payslips |

### 1.3 Key features
- **Face clock-in/out** with the 7 labels and live geolocation.
- **Multi-punch day ledger** with strict in→out alternation.
- **Late detection** (shift + 10-min grace) and **9 PM auto-checkout** cap.
- **HR daily-view console** with KPIs, timeline, logs and calendar.
- **Regularization** (adjust punches / exempt a day) with manager approval.
- **Face enrolment** with consent + duplicate protection; revoke wipes biometrics.

---

## 2. ROLES & ACCESS
| Role | Access |
|---|---|
| Employee | Own clock-in (`ClockIn`), own history (`/attendance/my`), raise regularization |
| Reporting Manager | Approve/reject their reports' regularizations |
| Client Admin / Branch User | HR daily-view console (branch users see only their branch), review, approve corrections |
| Super Admin | All, cross-tenant |

Menu visibility is governed by `hr.attendance`; the APIs enforce user-type + tenant scoping.

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                        DAILY ATTENDANCE                            │
└───────────────────────────────────────────────────────────────────┘
   ENROL FACE (once) — consent required; duplicate check (≤0.50)
        │
        ▼
   CLOCK IN (face) — Check In
        │  ← direction must alternate: in → out → in → out
        ├─ Lunch Out (out) → Lunch In (in) → Step Out → Step In → Meeting …
        ▼
   CLOCK OUT (face) — Check Out
        │
        │  match distance ≤ 0.55, else rejected
        ▼
   DAY RECORD: first-in / last-out / worked minutes
        • Present → Late if first-in > shift+10min (default 09:30)
        • Missing punch if only one side of a pair
        • 9 PM auto-checkout cap for a forgotten Check Out
        │
        ▼
   HR REVIEW (daily-view console) → KPIs, timeline, logs, calendar
        │
        ├─ CORRECTION NEEDED → Regularization request
        │       adjust (replace punches) / exempt (no punch change)
        │       → Reporting Manager approves (no self-approval)
        │       → approved adjust replaces the day's punches
        ▼
   PAYROLL: present / late / missing feed the payslip
```

### 3.1 Punch labels (7)
Check In · Step Out · Step In · Lunch Out · Lunch In · Meeting · Check Out. The UI offers labels valid for the current direction (in vs out).

### 3.2 Status derivation
| Status | When |
|---|---|
| Present | Worked, on time |
| Late | First-in > shift start + 10 min |
| Missing In / Missing Out | Only one side of the in/out pair |
| Half Day / On Duty / WFH / Corrected | Special cases |
| Weekly Off / Holiday | Non-working day |
| Absent | Working day with no attendance |
| Leave | Covered by approved leave |

### 3.3 Regularization
An employee (or HR) submits a correction for a date: **adjust** (provide the correct punches) or **exempt** (mark the day without changing punches). It routes to the reporting manager (auto-approved if the manager is missing/self). An approved **adjust** deletes and replaces the day's punches, then recomputes the summary.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Clock-In (`ClockIn.tsx`)
Face capture card, direction/label chips (per `next_direction`), geolocation card (coords + map link), Today's Summary (First In / Last Out / Worked, live-ticking), and the intraday punch timeline. Enrolment modal if the face isn't registered.

### 4.2 HR Attendance console (`HrAttendance.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Attendance — <date>                    [24h] [Regularizations]    │
│  [All|On Time|Late|Missing|Absent|WFH|Leave]  [Search]            │
│  ┌ employee list ┐ ┌ KPI: Present · Late · Missing · Compliance% ┐ │
│  │ (status pills)│ │ Day Record (live timer) + Punch Timeline    │ │
│  └───────────────┘ │ Logs (30d/6mo) + Calendar + Regularize      │ │
└───────────────────────────────────────────────────────────────────┘
```
Read-only for past days; the Regularize button opens the correction modal; an approvals queue is inline.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Face enrolment requires consent; duplicate faces (≤0.50) are rejected |
| 2 | Attendance punch matches at ≤0.55 distance (else rejected) |
| 3 | Punch direction strictly alternates in→out |
| 4 | 7 punch labels; default label by direction |
| 5 | Late = first-in > shift start + 10 min (default 09:30) |
| 6 | Missing punch = a worked day with only one side of the pair |
| 7 | Worked time capped by a 9 PM auto-checkout |
| 8 | Times stored UTC, shown in IST |
| 9 | One attendance row per employee per day |
| 10 | Regularization: no self-approval; adjust replaces the day's punches |
| 11 | Present/late/missing feed Payroll |
| 12 | Branch users see only their own branch |

---

## 6. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Automation | No scheduler — late/missing/auto-checkout are derived at read time |
| Permissions | Attendance APIs are user-type/tenant gated, not per-flag enforced |
| Biometrics | Descriptor stored on the employee (no separate biometric store); never returned |
| Regularization data | `attendance_regularizations` has no DB foreign keys |

---

*Related documents: ATTENDANCE_TECHNICAL_DOCUMENTATION.md · ATTENDANCE_CODE_WALKTHROUGH.md · ATTENDANCE_API_DOCUMENTATION.md*
