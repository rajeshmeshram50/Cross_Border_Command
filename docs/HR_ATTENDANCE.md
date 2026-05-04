# HR Attendance — Module Guide

How the Attendance page works, what each section is for, and how it connects to the rest of the HR system.

---

## 1. What this page is

The **HR-admin attendance management** page. Page URL: [/hr/attendance](/hr/attendance). Source file: [HrAttendance.tsx](../resources/js/pages/HrAttendance.tsx).

The page is organised into **three top-level tabs** so HR can switch between daily ops and oversight without leaving the page:

| Tab | Purpose |
|-----|---------|
| **Daily View** | Pick any day, scrub through every attendance-tracked employee, drill into a single person's punches/timeline/history. Default landing tab. |
| **Approval Queue** | Every regularization request across the org with manager + HR status side-by-side. Filter, search, drill-in, approve / reject / override. |
| **Reports** | Stub — DAR export, late-comers, missing punch, compliance dashboard (next pass). |

### HR is a supervisor, not the primary approver

In Keka / Darwinbox / GreytHR-style flows, the **reporting manager** is the first approver and the **only approver** in the normal case. **HR's role on this page is oversight + exception handling**:

- See every request company-wide
- Override a manager's decision when there's a dispute
- Raise a regularization on behalf of an employee (e.g., for ex-employees, biometric outage during payroll cutoff)
- Audit the trail
- Configure the policy (next pass)

So the "Approve / Reject" buttons on the Approval Queue are HR's **override / final-sign-off**, not the everyday flow.

### Daily View — two-pane layout

| Pane | Purpose |
|------|---------|
| **Left** — employee list | Pick the employee whose day you want to inspect. Filter pills narrow by status (On Time / Late / Missing / Absent / WFH-OD / Leave). |
| **Right** — selected employee detail | Identity bar, monthly KPIs, today's record card, intraday punch timeline, history (Logs & Requests). |

---

## 2. How it connects to the Employee module

Every field on the Attendance page maps to an existing column on `employees` ([Employee.php](../app/Models/Employee.php)). Nothing new on the employee table is needed:

| Attendance UI element | Employee field |
|----------------------|----------------|
| Name shown on cards / identity bar | `display_name` |
| EMP-ID pill | `emp_code` |
| Department / Designation | `department.name` / `designation.name` |
| Reporting manager (approval routing) | `reporting_manager.display_name` |
| Shift label + shift hours | `shift` |
| Weekly off chip | `weekly_off` |
| Biometric ID chip | `attendance_number` |
| Whether the employee shows up here at all | `attendance_tracking` (boolean) |
| Holiday calendar used to mark holidays | `holiday_list` |

**Filter applied by the API**: `WHERE attendance_tracking = true`. Employees with `attendance_tracking = false` (interns, contractors, founders) never appear here.

---

## 3. What each section does

### 3.1 Header

Title + today's date + two actions:

- **Export DAR** — exports the Daily Attendance Register (all employees, all departments, today). Backend will build a CSV/PDF for payroll/audit.
- **Add Regularization** — opens the Regularization modal (described below). HR can raise on behalf of an employee.

### 3.2 Left pane — employee list

**Filter tabs** (recompute live as data changes):

| Tab | Includes status |
|-----|-----------------|
| All | everything |
| On Time | `Present` |
| Late | `Late`, `Half Day` |
| Missing | `Missing In`, `Missing Out` |
| Absent | `Absent` |
| WFH/OD | `Work From Home`, `On Duty` |
| Leave | `Leave` |

**Search** matches name, EMP-ID, department, designation, biometric number. **Employee card** shows avatar (initials), name, EMP-ID · department, status pill, and first-in time. If a correction is open, a "Correction Pending" sub-pill appears.

### 3.3 Right pane — identity bar

The four chips below the name bar tell HR everything they need to act:

- **Shift**: e.g. *General (09:00 – 18:00)*. Drives the "EXPECTED" hours and the late-mark logic.
- **Weekly Off**: e.g. *Sun*. Days marked as weekly-off don't get exception flags.
- **Biometric ID**: e.g. *B-1042*. Used by the device-import job to map raw punches back to an employee.
- **Manager**: who corrections route to.

### 3.4 Right pane — KPI strip (4 cards)

Month-to-date counters for the **selected** employee:

| KPI | Computed as |
|-----|-------------|
| **Present Days** | count of `daily_attendance` rows in current month with status ∈ {Present, Late, Corrected, On Duty, WFH} |
| **Late Marks** | count of rows with status `Late` *or* `late_minutes > grace_minutes` |
| **Missing Punches** | count of rows with status ∈ {Missing In, Missing Out} |
| **Compliance %** | `(Present Days / working_days_in_month) × 100` |

### 3.5 Right pane — Today's Record card

The headline card for today.

- **Status banner** (top, with colored left border): the day's computed status. Late shows "·  N min late".
- **First In / Last Out / Shift** — three columns. *In Progress* = checked in, hasn't checked out yet.
- **Stats row**: punches captured / minutes worked / minutes expected.
- **Deviation**: `worked − expected` (negative = under-worked, red; positive = OT, green).
- **Exception band** (yellow): tags like *Late Entry*, *Half Day*, *Missing Punch*. Adds the red **PAYROLL AT RISK** flag if the day breaks payroll-eligible thresholds — these are the rows HR must clear before the payroll cutoff.
- **Correction Request strip**: only shown when an open request exists. Shows type, reason, who it's routed to, and Approve / Reject buttons (HR action — once HR approves, the day's status becomes `Corrected` and the daily_attendance row is rewritten).

### 3.6 Right pane — Intraday Punch Timeline

Vertical timeline of every raw `Punch` event for today: time, in/out, source (`BIOMETRIC` / `MANUAL` / `WEB`), worked-since-last-out, post-out break duration. Missing punches show as red entries with a one-click **Regularize** button.

### 3.7 Right pane — Logs & Requests

Tabs for the selected employee's historical view:

- **Attendance Log** — last N days as a table with status, shift, in/out, worked, deviation, exception. The pills above (30 DAYS / MAR / FEB / …) switch the range. *Today this is dummy; backend wires to `GET /attendance/{empId}/logs?from=&to=`.*
- **Regularization Requests** — full request list with status badge for the chosen range.
- **Calendar** — month grid with status colour-coding (next pass).

---

## 4. Regularization — the form and the workflow

### 4.1 What "regularization" means

A correction to a day's attendance because the raw punch data was wrong (employee forgot to punch, biometric was offline, employee was on field-work, etc.). HR doesn't edit `daily_attendance` directly — they go through this workflow so there's an audit trail.

### 4.2 Two modes (Keka-style)

The form starts with a radio choice between two fundamentally different request kinds:

| Mode | When to use | Effect on approval |
|------|------------|---------------------|
| **Add/update time entries** (`adjust`) | The actual punch list is wrong — missing in/out, wrong time, multiple corrections needed | Backend re-writes the day's punches to match the edited list, then re-derives `daily_attendance` |
| **Raise regularization to exempt this day from penalization** (`exempt`) | The punches are right but the day shouldn't trigger late/absent penalty (traffic, internet outage, network issue) | Backend marks the day as `exempted` — late mark / penalty rules skip it |

Most requests are `adjust`. `exempt` is for cases where the employee genuinely couldn't punch and the workday isn't being denied, just the penalty.

### 4.3 Multi-punch editor (`adjust` mode)

The form seeds the editor with the day's existing in/out pairs. Each row has 4 possible states:

| State | What it means | Renders as |
|-------|---------------|-----------|
| `keep` | Original punch, no change | Plain row with green tick |
| `edit` | An existing time was changed | Yellow-tinted row, `is-edited` |
| `add` | A brand-new punch pair added by the requester | Green-tinted row, `is-added` |
| `delete` | An existing punch being removed | Red-tinted row with strike-through, restorable |

The user can:
- **Edit** any time picker → row promotes from `keep` to `edit`
- **Click +Add Log** → adds a new `add` row at the bottom
- **Click −** → marks a `keep`/`edit` row as `delete` (or removes an `add` row entirely)
- **Click ↶ on a deleted row** → restores it to `keep`

This matches the granularity of Keka's editor: a single request can reshape the entire punch list for the day, not just one in/out pair.

### 4.4 Other form fields

| Field | Purpose | Required |
|-------|---------|----------|
| **Selected Date** | Locked at modal open. "Change" button re-opens the prompt. Backend will reject anything before payroll cutoff. | Yes |
| **Mode** | `adjust` / `exempt` radio. | Yes |
| **Work Location** | Multi-select pill picker. Source: preset list (`Baner Office`, `Wakad Office`, `WFH`, `Client Site`, `Field Visit`). Future: `master_work_locations` per client. | Yes (≥1) |
| **Reason** | Free text. Manager and HR see this when deciding. | Yes |

### 4.5 Approval routing

Every request goes through a fixed 3-step flow, displayed in the modal so the requester knows what's coming:

```
1. Employee submits  →  2. Reporting Manager approves  →  3. HR (override on dispute)
```

- Manager comes from `Employee.reporting_manager_id`. If null (e.g. C-suite), the flow auto-skips to HR.
- **Manager is the primary approver in the normal flow.** HR is *not* asked to approve every request — HR only steps in to override or finalise on dispute.
- HR's mutation of `daily_attendance` happens once final approval is locked (manager-approved + HR didn't override, or HR explicitly approved).
- Each step records `approved_at`, `approved_by_user_id`, `comment` so audit can trace who cleared a row.

### 4.6 States

```
Draft → Pending → Manager Approved → (auto-final / HR Approved) → Closed
                                  ↓
                                Rejected (terminal at any step)
                                  ↓
                              HR Override → Approved (final)
```

The Approval Queue surfaces every active state so HR can see manager + HR pillars side-by-side.

## 4.5 Approval Queue tab

The HR oversight view. Shows every regularization request in the org as a row.

### Columns

| Column | What |
|--------|------|
| **Req ID** | `CR-1042` style identifier |
| **Employee** | Name + EMP-ID · Department |
| **Date** | The day being corrected (not when raised) |
| **Mode** | `Punch Edit` / `Penalty Exempt` pill. `HR-raised` sub-pill if HR initiated on behalf |
| **Reason** | Truncated reason text — full text on hover |
| **Manager** | Pill: `Pending` / `Approved` / `Rejected` |
| **HR** | Pill: `Pending` / `Approved` / `Rejected` / `NA` (not yet escalated) |
| **Action** | 👁 drill-in, plus Approve / Reject buttons when status is Pending |

### Filter pills (top-right)

`All / Pending / Approved / Rejected` with live counts.

### Search

Matches employee name, EMP-ID, request ID, reason text.

### HR actions

- **Approve** — finalises the request. Status flips to `Approved`. Backend will mutate `daily_attendance` from the request's punch edits.
- **Reject** — terminal rejection. The day stays as-is.
- **Override** (planned) — HR can approve even if the manager rejected, useful for compliance / legal reasons.

---

## 5. Status codes — the full set

The page uses Indian-HR-standard status codes. Each maps to one display tone (`STATUS_TONE` table in the page):

| Code | Meaning | Counts as |
|------|---------|-----------|
| Present | Punched in within grace, worked > half-day threshold | Present |
| Late | Punched in *after* grace period | Present (but flagged) |
| Half Day | Worked between absent-threshold and half-day-threshold | Half Day (½ Present) |
| Missing In | No first-in punch but expected to work | Pending review |
| Missing Out | First in present, no last-out, day rolled over | Pending review |
| Weekly Off | Day matches employee's `weekly_off` | Off |
| Holiday | Day matches employee's `holiday_list` | Off |
| On Duty | OD-regularized day (field/client visit) | Present |
| Work From Home | WFH-regularized day | Present |
| Absent | No punches and not Off / Holiday / Leave | Absent (LWP) |
| Leave | Approved leave covers the day | depends on leave type (paid/unpaid) |
| Corrected | Day was Regularized through workflow | reflects original or corrected status |

---

## 6. Computed fields & rules (for backend)

These are **not** stored — they're derived nightly by the attendance compute job:

```
late_minutes  = max(0, first_in − shift_start − grace_minutes)
worked_minutes = sum(out_punch − previous_in_punch) − lunch_minutes
deviation = worked_minutes − expected_minutes
status = derive_status(punches, shift, weekly_off, holiday_list, leaves, policy)
```

The compute job runs at ~03:00 daily for the previous day, and on demand whenever a regularization is HR-approved.

---

## 7. Date navigation (review past days)

The header has a **date selector** so HR can step into any past day and review what happened. Three controls:

- **◀ / ▶ arrows** — step one day back / forward (forward disabled when on today).
- **Date pill** — click to open the calendar popup and jump to any date.
- **Today** button — appears only when not on today, jumps back to TODAY in one click.

When the page is on a past day:

- A **"Read-only · past day"** chip shows next to the title.
- The **Today's Record card** retitles to **Day Record** and uses a deterministic per-(employee, date) status (mock now, will pull from `daily_attendance` later).
- The KPI strip / employee list / punch timeline keep showing today's live data — the date navigation specifically targets the **Day Record card** and the **calendar tab**.

This solves the "we check last day and all" use case — HR can audit any past day's attendance without leaving the page.

## 8. Monthly calendar view

The **Calendar** tab on the Logs & Requests card now renders a full month grid for the selected employee:

- Month navigator with **◀ Apr 2026 ▶** prev / next arrows.
- **Status summary strip** above the grid — count of Present / Late / Half Day / WFH / OD / Leave / Absent / Weekly Off for the visible month.
- 7-column grid (Sun–Sat) × 6 rows. Each cell shows the day number plus a coloured status pill.
- **Click any past day** → page's `viewDate` jumps to that date; the Day Record card re-renders for that day. Future days are disabled and faded.
- Cells outside the active month (spillover from prev/next) render faded but stay aligned for a clean rectangle.

The **range pills** above the card (THIS MONTH / MAR / FEB / JAN / DEC / NOV) now actually navigate the calendar — clicking a pill jumps the calendar to that month and switches to the Calendar tab if not already there.

## 9. What's not built yet

- **Backend**. All data is dummy in-page state. APIs to wire later:
  - `GET /api/attendance/daily?date=YYYY-MM-DD&dept=&search=` → employees + that day's row each
  - `GET /api/attendance/{empId}/day?date=` → that day's record + punches + KPIs
  - `GET /api/attendance/{empId}/logs?from=&to=` → daily_attendance rows
  - `GET /api/attendance/{empId}/calendar?month=YYYY-MM` → 30-day status array
  - `POST /api/attendance/correction` → submit regularization
  - `POST /api/attendance/correction/{id}/decide` → manager/HR approve/reject
  - `GET /api/attendance/dar/export?date=` → export DAR
- **Punch source breakdown** — biometric file imports (eSSL/Realtime/Anviz) and mobile-app GPS punches. Manual/web-button punches are easy to wire first.
- **Shift master & Holiday master** — these will live as their own master pages under [/master/shifts](/master/shifts) and [/master/holidays](/master/holidays). Fields on Employee already point at them.
- **Manager & Employee self-service views** — same data, role-filtered. Pulled in once HR-admin view is signed off.

---

## 8. Related modules / dependencies

| Module | What it provides | What attendance does with it |
|--------|------------------|------------------------------|
| [Employee](../resources/js/pages/HrEmployees.tsx) | `attendance_tracking`, `shift`, `weekly_off`, `holiday_list`, `attendance_number`, `reporting_manager_id` | Source of truth for who appears here and how their day is judged |
| Shift master *(future)* | Shift templates, lunch rules | Drives expected hours and grace window |
| Holiday master *(future)* | Holiday calendar per region/client | Auto-marks days as Holiday |
| Leave *(future)* | Approved leave applications | Auto-marks days as Leave |
| Payroll *(future)* | Reads attendance for monthly run | Locks `daily_attendance` rows on payroll close |

---

## 9. Where to look first

| If you need to… | Open |
|----------------|------|
| Tweak the page | [resources/js/pages/HrAttendance.tsx](../resources/js/pages/HrAttendance.tsx) |
| Tweak the visual style | search `att-` in [recruitment.css](../resources/css/recruitment.css) (~410 lines block) |
| Change the regularization form fields / flow | `RegularizationModal` in the same page file |
| Wire to backend | the dummy `buildEmployees()` builder near the top of the page is the only place that fakes data |
