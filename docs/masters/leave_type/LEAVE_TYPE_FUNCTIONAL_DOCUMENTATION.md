# LEAVE TYPE MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Leave Type Master

## DOCUMENT CONTROL

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. Overview

The **Leave Type Master** defines the catalogue of leave categories a tenant offers — Annual Leave, Sick Leave, Compensatory Off, Unpaid Leave, and so on. Each entry carries a human-readable **name**, a broad **type** classification, and a compact **short code** that surfaces on payslips and attendance grids.

It is one of two masters under the **Attendance Master Management** category and is a schema-driven master served by the generic `MasterController` + `MasterPage.tsx` engine.

**HR Leave consumers.** Leave types are the building blocks of the HR Leave module:

| Consumer | How it uses Leave Type |
|---|---|
| **Leave Plan Master** | A plan links one or more leave types (via the `leave_plan_leave_types` pivot) and assigns each a quota/config. |
| **Leave Request** (`LeaveRequest`) | Every leave request references a `leave_type_id`; balances and "used" sums join back to `master_leave_types`. |
| **Payslip / attendance grid** | The short code labels the leave column. |

Because leave requests depend on these rows, a leave type that is already referenced by requests **cannot be deleted** — it must be set Inactive (archived) instead.

---

## 2. Roles & Access

Access is gated by the `master.leave_type` module permission (view / add / edit / delete). `super_admin` bypasses all checks.

| Role | Visibility (tenant scope) |
|---|---|
| Super Admin | All rows across every tenant |
| Client Admin / Client User | Global rows + own client's rows (may narrow via Branch Switcher) |
| Branch User | Globals + client-level rows + own branch rows (sibling branches hidden) |
| Employee | Globals + client-level rows + only rows they created |

Leave Type is **tenant-scoped** — every row belongs to a specific `(client_id, branch_id)`. Edit/delete additionally respects the creator hierarchy: you may always manage your own rows; otherwise the row's tier must be at or below yours.

---

## 3. Fields

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `name` | Leave Name | text | Yes | Regex-validated; must contain at least one letter |
| `description` | Description | textarea | No | Free text |
| `type` | Type | select | Yes | Regular · Incident Based Leave · Unpaid Leave · Compoff |
| `short_code` | Short Code | text | Yes | Normalised to UPPERCASE; letters/numbers only; shown on payslips & rosters |
| `is_sick_medical` | Sick / Medical | select | No | No · Yes (stored as boolean) |
| `paid_unpaid` | Paid / Unpaid | select | No | Paid · Unpaid |
| `gender_restriction` | Gender Restriction | select | No | None · Male · Female |
| `status` | Status | select | Yes | Active · Inactive |

> The React form surfaces a streamlined subset (Leave Name, Type, Short Code, Status); the full field set above is what the API validates and stores.

---

## 4. Business Rules

1. **Uniqueness (uEach).** `name` **and** `short_code` are each independently unique, case-insensitively, within the tenant `(client_id, branch_id)` scope. "Annual Leave" and "annual leave" collide; the same name may recur across different branches.
2. **Short-code normalisation.** `short_code` is upper-cased before validation and storage, so `al` and `AL` are treated as the same value.
3. **Name regex.** `name` allows letters, numbers, spaces and `. , - & ( ) / '` and must contain at least one letter — pure symbols/numbers are rejected.
4. **Short-code regex.** `short_code` allows only letters and numbers (no spaces or special characters).
5. **Tenant-scoped writes.** On create, `client_id`, `branch_id`, and `created_by` are stamped from the authenticated user; a `client_id` in the request body is never trusted for non-super users.
6. **Delete guard.** Deleting a type referenced by any `leave_requests` row is blocked ("Archive it instead"). On a permitted delete, orphaned `leave_plan_leave_types` pivot rows are cleaned up automatically.

---

## 5. Screen

- **Location:** Masters dashboard → *Attendance Master Management* → **Leave Type Master**.
- Standard master list with search (matches text fields), Active/Inactive count pills, and an Add/Edit modal.
- "What to do" guidance: name the leave type, pick a type, set a short code, then activate.

---

## 6. Known Limitations

- The React form does not expose `is_sick_medical`, `paid_unpaid`, or `gender_restriction`; those can only be set via the API even though the schema supports them.
- No auto-generated code — the short code is user-entered (unlike Department/Expense Category which auto-sequence).
- Delete is refused (not soft-archived automatically) when requests reference the type; the user must switch status to Inactive manually.

---

*Related documents: LEAVE_TYPE_TECHNICAL_DOCUMENTATION.md, LEAVE_TYPE_API_DOCUMENTATION.md, LEAVE_TYPE_CODE_WALKTHROUGH.md*
