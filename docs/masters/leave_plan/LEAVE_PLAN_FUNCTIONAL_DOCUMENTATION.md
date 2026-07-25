# LEAVE PLAN MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Leave Plan Master

## DOCUMENT CONTROL

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. Overview

The **Leave Plan Master** defines named leave policies that bundle a set of leave types with a calendar-year rule. A plan answers two questions: *which leave categories apply* and *when does the leave year start* — either a fixed calendar month, or each employee's joining anniversary.

It is the second master under **Attendance Master Management** and is served by the schema-driven `MasterController` + `MasterPage.tsx` engine.

**HR Leave consumers.** A leave plan sits at the top of the HR Leave chain:

| Consumer | How it uses Leave Plan |
|---|---|
| **Leave Type Master** | A plan links leave types via the `leave_plan_leave_types` pivot, each with a quota/config (`config_json`, `quota_summary`, `eoy_summary`). |
| **Employee assignment** | Employees are attached to a plan via `leave_plan_employees` (`assigned_at`, `assigned_by`). |
| **Leave Request → approvals** | An employee's assigned plan governs the balances a `LeaveRequest` draws against and the approval chain. |

---

## 2. Roles & Access

Gated by the `master.leave_plan` module permission (view / add / edit / delete). `super_admin` bypasses.

| Role | Visibility (tenant scope) |
|---|---|
| Super Admin | All rows |
| Client Admin / Client User | Globals + own client's rows (may narrow via Branch Switcher) |
| Branch User | Globals + client-level rows + own branch rows |
| Employee | Globals + client-level rows + only own rows |

Leave Plan is **tenant-scoped** — every row is stamped to a `(client_id, branch_id)`. Edit/delete follows the creator hierarchy (own rows always allowed; otherwise row tier ≤ user tier).

---

## 3. Fields

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `plan_name` | Leave Plan Name | text | Yes | Unique per tenant |
| `description` | Description | textarea | No | Short note |
| `from_month_type` | Calendar year mode | select / radio | Yes | Calendar · If Joining |
| `from_month` | Starts from month | select | Conditional | Only when mode = Calendar |
| `calendar_year` | Calendar Year | text | No | API-only |
| `policy_explanation_mode` | Policy Mode | select | No | System · Custom (API-only) |
| `policy_doc_path` | Policy Document | text | No | Stored doc path (API-only) |
| `is_default` | Default Plan | select | No | No · Yes (boolean) |
| `status` | Status | select | Yes | Active · Inactive |

---

## 4. Business Rules

1. **Uniqueness (uFields).** `plan_name` is unique within the tenant `(client_id, branch_id)` scope. Because it is a single text field, the check is **case-insensitive** ("Default Plan" and "default plan" collide). The same name may recur across different branches.
2. **Conditional field (showWhen).** `from_month` appears — and is expected — **only when `from_month_type = Calendar`**. Under *If Joining*, the leave year tracks each employee's joining date, so no month is picked.
3. **Calendar modes.** *Calendar* starts the leave year on a chosen month; *If Joining* starts it on the employee's joining date and ends on their work anniversary.
4. **Tenant-scoped writes.** `client_id`, `branch_id`, `created_by` are stamped from the authenticated user; body `client_id` is never trusted for non-super users.
5. **Default flag.** `is_default` marks the plan pre-selected during employee setup (stored as boolean).

---

## 5. Screen

- **Location:** Masters dashboard → *Attendance Master Management* → **Leave Plan Master**.
- Standard list with search, count pills, and an Add/Edit modal.
- The mode field renders as a radio group with descriptive helper text; the "Starts from month" picker is shown conditionally.
- "What to do": name the plan, add a description, choose start mode, then activate.

---

## 6. Known Limitations

- The React form exposes only `plan_name`, `description`, `from_month_type`, `from_month`, `status`. `calendar_year`, `policy_explanation_mode`, `policy_doc_path`, and `is_default` are API-only via this generic master endpoint (they are typically managed in the fuller HR Leave Plans configuration UI).
- `from_month` is not enforced server-side as required when mode = Calendar — the conditional requirement is a frontend (`showWhen`) rule; the schema marks it nullable.
- No auto-generated code and no per-plan uniqueness beyond `plan_name`.

---

*Related documents: LEAVE_PLAN_TECHNICAL_DOCUMENTATION.md, LEAVE_PLAN_API_DOCUMENTATION.md, LEAVE_PLAN_CODE_WALKTHROUGH.md*
