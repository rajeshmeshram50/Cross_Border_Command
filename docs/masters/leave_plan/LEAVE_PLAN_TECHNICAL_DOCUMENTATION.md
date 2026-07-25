# LEAVE PLAN MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Leave Plan Master

## DOCUMENT CONTROL

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. Model & Table

| Item | Value |
|---|---|
| Slug | `leave_plan` |
| Model | `App\Models\Masters\LeavePlans` |
| Table | `master_leave_plans` |
| Soft deletes | Yes (masters convention) |
| Casts | `is_default` → boolean, `unlocked` → boolean |
| Relations | `client()`, `branch()`, `creator()` (BelongsTo); `leaveTypes()` (BelongsToMany via `leave_plan_leave_types`); `planTypeRows()` (HasMany `LeavePlanLeaveType`); `employees()` (BelongsToMany via `leave_plan_employees`, withPivot `assigned_at, assigned_by`) |

Registered in `MasterController::MODELS['leave_plan']` and `SCHEMAS['leave_plan']`.

---

## 2. Schema Spec

| Field | `t` | `r` | Constraints |
|---|---|---|---|
| `plan_name` | text | ✔ | string, max 50 |
| `description` | textarea | | string, uncapped |
| `from_month_type` | select | ✔ | `Rule::in(Calendar, If Joining)` |
| `from_month` | select | | `Rule::in(January … December)`, nullable |
| `calendar_year` | text | | string, max 50 |
| `policy_explanation_mode` | select | | `Rule::in(System, Custom)` |
| `policy_doc_path` | text | | string, max 50 |
| `is_default` | select | | `Rule::in(No, Yes)` → boolean cast |
| `status` | select | ✔ | `Rule::in(Active, Inactive)` |

Schema flags: `uFields => [plan_name]`, `tenantScoped => true`. No regex/normalize on any field.

---

## 3. Uniqueness Model

`uFields => ['plan_name']` — single text field. Because `plan_name` is a text type it is **promoted to a case-insensitive** check (`singleTextUFields`): `whereRaw('LOWER(plan_name) = LOWER(?)')`, scoped to the row's `(client_id, branch_id)` tuple, ignoring self on update. No composite key; no `is_system` column, so the system-seed collision branch does not apply.

---

## 4. Endpoints

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master-counts` | Batch active/inactive/total |
| GET | `/master/leave_plan` | List (`?search=`, `?branch_id=`) |
| POST | `/master/leave_plan` | Create |
| GET | `/master/leave_plan/next-code` | Returns `{code:null}` |
| GET | `/master/leave_plan/{id}` | Show |
| PUT | `/master/leave_plan/{id}` | Update |
| DELETE | `/master/leave_plan/{id}` | Soft delete |

All under `auth:sanctum` + `user.active`.

---

## 5. Special Handling

- **showWhen (frontend).** `masterConfigs.ts` marks `from_month` with `showWhen: { field: 'from_month_type', equals: 'Calendar' }`, so the month picker renders only under the *Calendar* mode. `from_month_type` renders as a radio group with `optDesc` helper text. This is a UI-layer rule — the backend schema keeps `from_month` nullable and does not conditionally require it.
- Otherwise a **standard schema-driven master** — no normalize, regex, upload, or sublist handling. There is no delete hook on the model (unlike Leave Type).

---

## 6. Security & Scoping

- `authorizeMaster()` enforces `master.leave_plan` per action; super admins bypass.
- `applyScope()` → `MasterVisibility::applyReadScope()`: tenant-scoped creator-hierarchy visibility; `?branch_id=` honoured only for switcher roles.
- Writes stamp `client_id` / `branch_id` / `created_by` via `resolveOwnership()`; body `client_id` ignored for non-super.
- Edit/delete gated by `MasterVisibility::hierarchicalDenial()` (own row OK; else row tier ≤ user tier, 403 otherwise).

---

## 7. Metrics

`/master-counts` computes `total` + `active` in SQL (status matched against `active/1/true/yes/enabled`); `inactive = total − active`. Every write calls `MasterBundleCache::bump()` so dependent dropdowns (employee setup, HR Leave) refresh.

---

*Related documents: LEAVE_PLAN_FUNCTIONAL_DOCUMENTATION.md, LEAVE_PLAN_API_DOCUMENTATION.md, LEAVE_PLAN_CODE_WALKTHROUGH.md*
