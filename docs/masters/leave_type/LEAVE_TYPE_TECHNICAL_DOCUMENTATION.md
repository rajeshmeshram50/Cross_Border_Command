# LEAVE TYPE MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Leave Type Master

## DOCUMENT CONTROL

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. Model & Table

| Item | Value |
|---|---|
| Slug | `leave_type` |
| Model | `App\Models\Masters\LeaveTypes` |
| Table | `master_leave_types` |
| Soft deletes | Yes (masters convention) |
| Casts | `is_sick_medical` → boolean |
| Relations | `client()`, `branch()`, `creator()` (BelongsTo); `leavePlans()` (BelongsToMany via `leave_plan_leave_types`, withPivot `config_json, quota_summary, eoy_summary, is_setup`) |

Registered in `MasterController::MODELS['leave_type']` and `MasterController::SCHEMAS['leave_type']`.

---

## 2. Schema Spec

| Field | `t` | `r` | Constraints |
|---|---|---|---|
| `name` | text | ✔ | regex `#^(?=.*[A-Za-z])[A-Za-z0-9 .,\-&()'/]+$#`, max 50 |
| `description` | textarea | | string, uncapped |
| `type` | select | ✔ | `Rule::in(Regular, Incident Based Leave, Unpaid Leave, Compoff)` |
| `short_code` | text | ✔ | `normalize: upper`, regex `/^[A-Za-z0-9]+$/`, max 50 |
| `is_sick_medical` | select | | `Rule::in(No, Yes)` → boolean cast |
| `paid_unpaid` | select | | `Rule::in(Paid, Unpaid)` |
| `gender_restriction` | select | | `Rule::in(None, Male, Female)` |
| `status` | select | ✔ | `Rule::in(Active, Inactive)` |

Schema flags: `uEach => [name, short_code]`, `tenantScoped => true`.

**Pattern messages.** `name` → "Leave Type Name cannot contain special characters (only letters, numbers, spaces and . , - & ( ) / ' are allowed)."; `short_code` → "Only letters and numbers are allowed (no spaces or special characters)."

---

## 3. Uniqueness Model

`uEach` — each field enforced independently, case-insensitively, scoped to the row's `(client_id, branch_id)` tuple:

- `name` — checked via `whereRaw('LOWER(name) = LOWER(?)')`.
- `short_code` — normalised to upper first, then checked via `LOWER()` comparison.

No composite key. Nullable/empty values skip the check. `master_leave_types` has no `is_system` column, so the system-seed collision branch does not apply.

---

## 4. Endpoints

| Verb | Path | Purpose |
|---|---|---|
| GET | `/master-counts` | Batch active/inactive/total |
| GET | `/master/leave_type` | List (`?search=`, `?branch_id=`) |
| POST | `/master/leave_type` | Create |
| GET | `/master/leave_type/next-code` | Returns `{code:null}` (no auto-code) |
| GET | `/master/leave_type/{id}` | Show |
| PUT | `/master/leave_type/{id}` | Update |
| DELETE | `/master/leave_type/{id}` | Soft delete (guarded) |

All under `auth:sanctum` + `user.active`.

---

## 5. Special Handling

- **Normalize.** `short_code` upper-cased in `validatePayload()` (`$request->merge()`) before rules run, keeping stored value and uniqueness check canonical.
- **Regex.** Both `name` and `short_code` carry `pattern` + `patternMessage`, wired into Laravel `regex:` rules with custom messages.
- **Delete hook.** `LeaveTypes::booted()` registers a `deleting` listener: throws a `ValidationException` when `leave_requests.leave_type_id` references the row (LV-26), otherwise deletes dangling `leave_plan_leave_types` pivot rows (no FK on that pivot).

---

## 6. Security & Scoping

- `authorizeMaster()` enforces `master.leave_type` permission per action; super admins bypass.
- `applyScope()` → `MasterVisibility::applyReadScope()`: tenant-scoped creator-hierarchy visibility. Employees see globals + client-level + own rows.
- Writes stamp `client_id` / `branch_id` / `created_by` via `resolveOwnership()`; body `client_id` ignored for non-super.
- Edit/delete pass through `MasterVisibility::hierarchicalDenial()` (own-row OK; else row tier ≤ user tier).

---

## 7. Metrics

`/master-counts` computes `total` and `active` in SQL (`status` matched against `active/1/true/yes/enabled`); `inactive = total − active`. Every create/update/delete calls `MasterBundleCache::bump()` so dependent dropdowns refresh.

---

*Related documents: LEAVE_TYPE_FUNCTIONAL_DOCUMENTATION.md, LEAVE_TYPE_API_DOCUMENTATION.md, LEAVE_TYPE_CODE_WALKTHROUGH.md*
