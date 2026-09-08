# LEAVE MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Leave
>
> Payloads below were captured against a live tenant, not written from the schema.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |
| 2.0 | 2026-09-08 | System | Real captured responses, `/approvals` paging + tab counts + server-side filters, sandwich waiver, approvers popover, balance ledger shapes, plan lock/clone endpoints, the full 422 catalogue. |

---

## 1. CONVENTIONS

| Aspect | Value |
|---|---|
| Base path | `/api` |
| Auth | `Authorization: Bearer <sanctum_token>` on every route |
| Middleware | `auth:sanctum` → `user.active` |
| Branch | Axios injects `?branch_id=<active>` on GETs. **A `branch_user`'s own branch is forced server-side regardless** |
| Permissions | `hr.leave`, `hr.leave_approvals` |
| Content type | `application/json` — **no multipart routes**; `attachment_path` is a string |
| Envelope | `{ "data": … }` on almost everything |
| Errors | `422` `{message}` or `{message, errors:{…}}`; `403` authorisation; `404` out of scope |

---

## 2. ENDPOINT INDEX

### 2.1 Leave requests

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/leave-requests` | One employee's history |
| 2 | POST | `/leave-requests` | Apply |
| 3 | GET | `/leave-requests/approvals` | The HR / approver queue |
| 4 | GET | `/leave-requests/colleagues` | Employee search for the Notify picker |
| 5 | GET | `/leave-requests/{id}` | One request |
| 6 | GET | `/leave-requests/{id}/approvers` | Approval timeline |
| 7 | POST | `/leave-requests/{id}/approve` | Approve the current level |
| 8 | POST | `/leave-requests/{id}/reject` | Reject (terminal) |
| 9 | POST | `/leave-requests/{id}/cancel` | Cancel a Pending request |
| 10 | POST | `/leave-requests/{id}/hr-view` | Mark HR-viewed |
| 11 | POST | `/leave-requests/{id}/sandwich-waiver` | Waive / re-apply the sandwich policy |

### 2.2 Leave plans

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 12-16 | GET/POST/GET/PUT/DELETE | `/leave-plans[/{id}]` | Plan CRUD |
| 17 | POST | `/leave-plans/{id}/clone` | Clone (born editable) |
| 18 | POST | `/leave-plans/{id}/make-default` | Set the branch default |
| 19 | POST | `/leave-plans/{id}/types` | Replace the attached type set |
| 20 | DELETE | `/leave-plans/{id}/types/{typeId}` | Detach a type |
| 21 | PUT | `/leave-plans/{id}/types/{typeId}/config` | Save one wizard section |
| 22 | POST | `/leave-plans/{id}/employees` | Assign employees |
| 23 | DELETE | `/leave-plans/{id}/employees/{employeeId}` | Unassign |
| 24 | GET | `/leave-balances` | Roster balance matrix |
| 25 | GET | `/employees/{employeeId}/leave-balances` | One employee's ledger |

---

## 3. LEAVE REQUESTS

### 3.1 GET `/leave-requests`

One employee's history. `employee_id` optional — defaults to the caller's own employee row. Cross-tenant ids return **404**.

| Query param | Notes |
|---|---|
| `employee_id` | Admin viewing a profile |
| `status` | `Pending` \| `Approved` \| `Rejected` \| `Cancelled` |

Returns `{"data": [...]}`, ordered by `from_date` descending, **not paginated**. Each row eager-loads `leaveType`, `leavePlan`, `coverPerson`, `approver`.

### 3.2 POST `/leave-requests`

```json
{
  "employee_id": 18,
  "leave_type_id": 3,
  "from_date": "2027-01-11",
  "to_date": "2027-01-12",
  "day_type": "full",
  "reason": "Family function",
  "notify": { "employee_ids": [7, 12] },
  "handover_required": true,
  "cover_person_id": 7,
  "handover_notes": "Priya covers the month-end close",
  "critical_tasks": "GST filing on the 20th",
  "avail_on_call": true,
  "emergency_number": "9876543210"
}
```

| Field | Rules |
|---|---|
| `employee_id` | Optional. **Only `super_admin` / `client_admin` may file on behalf** — a `branch_user` gets 403 |
| `leave_type_id` | Required; must exist **in the caller's tenant** (or be a global row) |
| `from_date` | Required; not in the past, not before the joining date |
| `to_date` | Required; `>= from_date`, at most **one year** ahead |
| `day_type` | `full` \| `first_half` \| `second_half`; halves need a single date and a type that allows them |
| `reason` | ≤ 2000 |
| `notify.employee_ids[]` | Must be employees of the same tenant |
| `cover_person_id` | Same tenant |
| `handover_notes`, `critical_tasks` | ≤ 5000 |
| `attachment_path` | ≤ 1024 — a **string**; there is no upload endpoint here |

**`201`** returns `{"data": {…}}` with `days`, `status`, `approval_chain` and `current_approval_level` already populated. If every chain level was skipped by rule, `status` is `Approved` and `approver_comment` reads *"Auto-approved — every chain level was skipped by rule"*.

### 3.3 GET `/leave-requests/approvals`

The HR / approver queue. **`status` defaults to `Pending`** — omitting it does not mean "all".

| Query param | Notes |
|---|---|
| `status` | Defaults to `Pending` |
| `per_page` | **Opt-in paging**, clamped 1..200. Absent → the whole set |
| `page` | 1-based |
| `with_counts` | `1` adds the tab-count block |
| `search` | Employee first/last/display name or `emp_code` |
| `leave_type` | Matched on the type **name** |
| `department` | Matched on the department **name** |
| `payroll` | `Paid` \| `Unpaid` |
| `on_leave_on` | `YYYY-MM-DD` — requests straddling that day |
| `branch_id` | Honoured for client-level roles; **forced to their own branch for a `branch_user`** |

```
GET /api/leave-requests/approvals?status=Approved&with_counts=1&per_page=1
```

```json
{
  "data": [
    {
      "id": 4,
      "client_id": 2, "branch_id": 6,
      "employee_id": 18, "leave_type_id": 2, "leave_plan_id": 2,
      "from_date": "2026-09-01T00:00:00.000000Z",
      "to_date": "2026-09-01T00:00:00.000000Z",
      "days": "0.50",
      "day_type": "second_half",
      "reason": null,
      "attachment_path": null,
      "notify": { "employee_ids": [] },
      "handover_required": false,
      "cover_person_id": null,
      "status": "Approved",
      "approved_by": 14,
      "approved_at": "2026-09-01T11:22:16.000000Z",
      "approver_comment": null,
      "approval_chain": [
        {
          "level": 1,
          "approver_kind": "reporting_manager",
          "approver_role": null,
          "approver_user_id": null,
          "approver_employee_id": 7,
          "approver_label": null,
          "skip_if": null,
          "status": "Approved",
          "acted_by": 14,
          "acted_at": "2026-09-01T11:22:16.551028Z",
          "comment": null
        }
      ],
      "current_approval_level": 1,
      "hr_viewed_at": null, "hr_viewed_by": null,
      "notice_extension_days": null,
      "sandwich_waived": false,
      "sandwich_waived_by": null,
      "sandwich_waived_at": null,
      "sandwich_waiver_reason": null,
      "rm_unavailable": false,
      "can_act_now": false,
      "employee": {
        "id": 18, "emp_code": "EMP-015",
        "display_name": "Priya Anil Deshmukh",
        "department": { "id": 2, "name": "Human Resources" },
        "reporting_manager": { "id": 7, "display_name": "Anushka Kadam" },
        "reporting_manager_user": null
      },
      "leave_type": {
        "id": 2, "name": "Sick Leave", "short_code": "SL",
        "type": "Incident Based Leave", "paid_unpaid": "Paid"
      }
    }
  ],
  "total": 2,
  "page": 1,
  "per_page": 1,
  "counts": { "All": 4, "Pending": 0, "Approved": 2, "Rejected": 2, "Cancelled": 0 }
}
```

Two computed fields matter to the UI:

- **`can_act_now`** — whether *this* caller may act on the current level right now. The single source of truth for enabling the buttons; the API enforces the same rule.
- **`rm_unavailable`** — the reporting manager is on approved leave, disabled or unassigned, so HR may step in.

`counts` is computed with every filter applied **except** status, which is what a tab strip means. Without `per_page`, `per_page` echoes the total.

### 3.4 GET `/leave-requests/{id}/approvers`

```json
{
  "data": [
    {
      "level": 1,
      "role": "Reporting manager",
      "kind": "reporting_manager",
      "employee_id": 7,
      "name": "Anushka Kadam",
      "email": "anushka@mailinator.com",
      "status": "Approved",
      "acted_at": "2026-09-01T11:22:16.551028Z",
      "comment": null,
      "is_current": false
    }
  ]
}
```

### 3.5 POST `/leave-requests/{id}/approve` · `/reject`

```json
{ "comment": "Approved — cover arranged." }
```

Both take an optional `comment` and act on the **current level only**.

```json
{
  "data": { "...": "the refreshed request" },
  "notice_extension": { "days": 2, "last_working_day": "28 Feb 2027" }
}
```

`notice_extension` is `null` unless a final approval of **unpaid leave during notice** pushed the last working day out.

Refusals:

| Situation | Response |
|---|---|
| Already decided | `422` `Leave request is already Approved.` |
| HR acting before the manager | `403` `You cannot act on this leave request yet — it is awaiting approval from the reporting manager before HR can act.` |
| Approving your own | `403` `You cannot approve your own leave request.` |

A **reject is terminal**: every downstream level is marked `Skipped` so nothing is left showing Pending.

### 3.6 POST `/leave-requests/{id}/cancel`

Requester or HR, `Pending` only. Reverts any notice extension, notifies the current approver, recomputes payslips. Returns `{"data": {…}}`.

### 3.7 POST `/leave-requests/{id}/sandwich-waiver`

```json
{ "waived": true, "reason": "Bereavement — genuine emergency" }
```

| Field | Rules |
|---|---|
| `waived` | Required boolean — `false` re-applies the policy and clears the waiver columns |
| `reason` | Optional, ≤ 255 |

Restricted to `super_admin` / `client_admin` / `branch_user`.

```json
{
  "data": { "...": "the re-sized request" },
  "days_before": 4,
  "days_after": 2,
  "message": "Sandwich policy waived — leave re-sized to 2 day(s)."
}
```

Re-applying returns *"Sandwich policy re-applied — leave re-sized to N day(s)."* Draft payslips are recomputed either way.

| Situation | Response |
|---|---|
| Not HR/admin | `403` `Only HR or an administrator can waive the sandwich policy.` |
| Branch does not run the policy | `422` `This employee's branch does not run the sandwich leave policy.` |

### 3.8 GET `/leave-requests/colleagues`

A lightweight employee search for the Notify picker, open to **any** authenticated user and scoped to their own client. It exists because `/employees` requires `master.employees.can_view`, an HR-only permission, so a regular employee's search there silently 403s. Returns `id`, `name`, `emp_code`, `designation`, `photo_url`.

---

## 4. LEAVE PLANS

### 4.1 GET `/leave-plans`

```json
{
  "data": [
    {
      "id": 2,
      "client_id": 2, "branch_id": 6,
      "plan_name": "Leave Plan For HOD",
      "calendar_year": null,
      "from_month_type": "If Joining",
      "from_month": null,
      "status": "Active",
      "description": null,
      "is_default": false,
      "policy_explanation_mode": "System",
      "policy_doc_path": null,
      "unlocked": false,
      "employees_count": 22,
      "leave_types_count": 4,
      "setup_complete": true,
      "client": { "id": 2, "org_name": "Inorbvict Group of Companies" },
      "branch": { "id": 6, "name": "Inorbvict Healthcare India Private Limited" }
    }
  ]
}
```

`setup_complete && !unlocked` is exactly the condition under which every setup write is refused.

### 4.2 PUT `/leave-plans/{id}/types/{typeId}/config`

```json
{
  "config": {
    "accrual":  { "unlimited": false, "yearlyQuota": 12,
                  "employeeOverdraft": { "enabled": true, "days": 1 } },
    "leaveApp": { "allowHalfDay": true, "maxPerMonth": { "enabled": true, "days": 3 } },
    "approval": { "chain": [ { "kind": "reporting_manager", "skip_if": { "days_lt": 2 } } ] }
  },
  "quota_summary": "12 days / year",
  "finalize": false
}
```

| Field | Rules |
|---|---|
| `config` | Required. **Stored whole** — sections without validation rules are preserved |
| `config.accrual.yearlyQuota` | 0..365 |
| `config.accrual.attendanceDaysWorked` | 0..31, only when `accrual.mode = attendance` |
| `config.accrual.employeeOverdraft.days` | 0..365 |
| `config.yearEnd.carryForwardCap` | 0..365 — **stored but never applied** |
| `finalize` | `false` on intermediate sections; `true` (the default) marks the type set up |

Locked plan → `422` `This leave plan is fully set up and locked. To change it, clone it into a new plan and edit that.`

### 4.3 POST `/leave-plans/{id}/clone`

```json
{ "plan_name": "Leave Plan For HOD (Copy)" }
```

`201`. Copies attached types **and their config**; copies **no employees**; sets `is_default = false` and `unlocked = true` so the copy is editable until its next completing save.

### 4.4 DELETE `/leave-plans/{id}`

| Situation | Response |
|---|---|
| Default plan | `422` `Cannot delete the default leave plan. Set another plan as default first.` |
| In-flight requests | `422` `Cannot delete this plan — 2 active (pending/approved) leave request(s) still reference it. Resolve or reassign them first.` |
| Otherwise | `{"data": {"deleted": true}}` — both pivots cascade |

### 4.5 GET `/employees/{employeeId}/leave-balances`

```json
{
  "data": {
    "employee": {
      "id": 18, "name": "Priya Anil Deshmukh",
      "department": "Human Resources",
      "plan_id": 2, "plan_name": "Leave Plan For HOD"
    },
    "types": [
      {
        "leave_type_id": 3,
        "name": "Casual Leave", "short_code": "CL",
        "category": "Regular", "paid_unpaid": "Paid",
        "quota": 12,
        "accrued": 12,
        "extra": 1,
        "used": 0,
        "available": 13,
        "unlimited": false,
        "allow_half_day": true,
        "transactions": [
          {
            "date": "01 Jan 2026",
            "change": "+ 12",
            "balance": 12,
            "reason": "Annual leave quota granted for the year.",
            "kind": "accrual"
          }
        ]
      }
    ]
  }
}
```

`accrued === quota` always — the full entitlement is granted at the plan-year start. `extra` is the overdraft shown as a separate allowance; it does not inflate `accrued`. An employee with no plan gets `{"employee": {...,"plan_id":null}, "types": []}`, not an error.

> **`available` here counts only Approved days**, while the raise-time check subtracts Approved **and Pending**. A pending request therefore does not reduce the number on this screen but does reduce what can be applied for.

Cross-tenant `employeeId` → `403` `You do not have access to this employee.`

### 4.6 GET `/leave-balances`

The roster matrix behind the Leave Balances tab.

```json
{
  "data": {
    "columns": [
      { "leave_type_id": 3, "name": "Casual Leave", "short_code": "CL",
        "category": "Regular", "paid_unpaid": "Paid" }
    ],
    "employees": [
      {
        "id": 4, "emp_code": "EMP-001", "name": "Trupti Pawar",
        "department": "Human Resources",
        "designation": "Head of Department (HOD)",
        "location": "Pune, India",
        "plan_id": 2, "plan_name": "Leave Plan For HOD",
        "balances": [
          { "leave_type_id": 3, "applies": true, "unlimited": false,
            "quota": 12, "used": 0, "available": 13 }
        ]
      }
    ],
    "filters": {
      "departments": ["Accounts", "Human Resources", "Legal", "Sales", "Software Developement"],
      "locations": ["Pune, India"]
    }
  }
}
```

`columns` is the union of every leave type any in-scope plan has attached; `applies: false` marks a type that is not in that employee's own plan. `filters` supplies the dropdown options so the UI needs no second request.

---

## 5. ERROR CATALOGUE

Captured live unless marked otherwise.

| Scenario | Status | Message |
|---|---|---|
| Branch user files on behalf | 403 | `You can only raise a leave request for yourself.` |
| Approving an already-decided request | 422 | `Leave request is already Approved.` |
| Setup write on a locked plan | 422 | `This leave plan is fully set up and locked. To change it, clone it into a new plan and edit that.` |
| Deleting a plan with live requests | 422 | `Cannot delete this plan — 2 active (pending/approved) leave request(s) still reference it. Resolve or reassign them first.` |
| Backdated leave | 422 | `You cannot apply for leave in the past. Pick a date from tomorrow onward.` |
| Before joining | 422 | `You cannot apply for leave before your joining date (2027-01-15).` |
| Today, not second half | 422 | `Leave for today can only be applied for the second half of the day.` |
| Half-day across days | 422 | `Half-day requests are only valid for a single calendar day. …` |
| Half-day on a type that forbids it | 422 | `This leave type does not allow half-day leave.` |
| Overlapping request | 422 | `You already have a Pending leave request for … Cancel it before applying for overlapping dates.` |
| No plan assigned | 422 | `You are not assigned to a leave plan yet. Please contact HR.` |
| Type not in the plan | 422 | `The selected leave type is not part of your assigned leave plan.` |
| Over balance | 422 | `Not enough leave balance — only 3 day(s) available for this leave type, but you requested 5.` |
| Monthly cap | 422 | `Monthly limit reached — this leave type allows at most 3 day(s) per month. …` |
| On probation | 422 | `You are on probation and cannot apply for leave. Leave can be applied from …` |
| Paid leave during notice | 422 | `You are serving your notice period…, so paid leave cannot be applied for. You may apply for unpaid leave…` |
| HR acting out of turn | 403 | `You cannot act on this leave request yet — it is awaiting approval from the reporting manager before HR can act.` |
| Approving your own | 403 | `You cannot approve your own leave request.` |
| Sandwich waiver by non-HR | 403 | `Only HR or an administrator can waive the sandwich policy.` |
| Sandwich waiver, branch off | 422 | `This employee's branch does not run the sandwich leave policy.` |
| Cross-tenant balances | 403 | `You do not have access to this employee.` |
| Cross-tenant history | 404 | *(no body — deliberate, no information leak)* |

---

## 6. QUICK REFERENCE

```bash
# ── Policy setup ────────────────────────────────────────────────
POST /api/leave-plans                         {"plan_name":"Staff Plan", …}
POST /api/leave-plans/{id}/types              {"leave_type_ids":[2,3,4]}
PUT  /api/leave-plans/{id}/types/3/config     {"config":{…},"finalize":false}   # section 1
PUT  /api/leave-plans/{id}/types/3/config     {"config":{…},"finalize":true}    # last section
POST /api/leave-plans/{id}/employees          {"employee_ids":[4,18]}
# plan is now LOCKED — to change it:
POST /api/leave-plans/{id}/clone              {"plan_name":"Staff Plan v2"}

# ── Applying ────────────────────────────────────────────────────
GET  /api/leave-requests/colleagues?search=pri            # notify picker
GET  /api/employees/18/leave-balances                     # what's available
POST /api/leave-requests                      {"leave_type_id":3,
                                               "from_date":"2027-01-11",
                                               "to_date":"2027-01-12"}

# ── Deciding ────────────────────────────────────────────────────
GET  /api/leave-requests/approvals?status=Pending&with_counts=1&per_page=25
GET  /api/leave-requests/4/approvers                      # timeline popover
POST /api/leave-requests/4/approve            {"comment":"OK"}
POST /api/leave-requests/4/sandwich-waiver    {"waived":true,"reason":"emergency"}

# ── Employee self-service ───────────────────────────────────────
GET  /api/leave-requests?status=Pending
POST /api/leave-requests/4/cancel
```

---

## 7. NOTES & CAVEATS

| # | Note |
|---|---|
| 1 | `/approvals` defaults `status` to **Pending** — omitting it is not "all" |
| 2 | `/approvals` pages only when `per_page` is sent; otherwise the whole set is returned and `per_page` echoes the total |
| 3 | `counts` requires `with_counts=1` and is computed with every filter **except** status |
| 4 | A `branch_user`'s `branch_id` is forced server-side; sending another branch has no effect |
| 5 | `available` on the balances endpoint counts Approved only; the raise-time check also subtracts **Pending** |
| 6 | `config.yearEnd.carryForwardCap` is validated and stored but never applied — no year-end process exists |
| 7 | `attachment_path` is an unverified string; this module has no upload endpoint |
| 8 | `GET /leave-requests` is not paginated |
| 9 | `leave_type` and `department` filters match on **name**, not id |
| 10 | Cross-tenant reads answer 404 (history) or 403 (balances) — the two differ by design |
| 11 | Filing on behalf is `super_admin` / `client_admin` only; a `branch_user` is refused |
| 12 | Notifications are best-effort; a `200` does not guarantee an email went out |

---

*Related documents: LEAVE_FUNCTIONAL_DOCUMENTATION.md · LEAVE_TECHNICAL_DOCUMENTATION.md · LEAVE_CODE_WALKTHROUGH.md*
