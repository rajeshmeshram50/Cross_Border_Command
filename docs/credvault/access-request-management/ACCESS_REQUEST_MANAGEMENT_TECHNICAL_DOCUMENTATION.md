# CredVault Access Request Management — Technical Documentation

| | |
|---|---|
| **Jira** | To be added (parent — CredVault Access Request Management Documentation) |
| **Module** | CredVault → Access Request Management |
| **Audience** | Developers, tech leads, code reviewers, QA automation |
| **Companion documents** | Functional Documentation · API Documentation · Code Walkthrough · Critical Vault Technical Documentation |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document explains how Access Request Management is built: its layers, files, the `credvault_access_requests` table, the model, the endpoints, the visibility and approval rules, and the notifications and audit it writes. It is written for developers who will maintain or extend the page. For what the user sees, read the Functional Documentation. For every request and response, read the API Documentation. The raising side of a request (the unlock popup) is covered in the Critical Vault documents.

### 1.2 The design in one paragraph

Access Request Management is **one React page over one table**, served by the same `AccessRequestController` that runs the Critical Vault unlock. The page lists requests (`GET /access-requests`) and calls four actions on them — **approve**, **reject**, **cancel**, **lock**. Two design decisions shape the module. First, **the steps are copied onto the request** when it is raised (`admin_required`, `manager_required`, `otp_required`, plus the named `admin_user_id` and `manager_user_id`), and `currentStage()` reads only those columns — so a later change to the credential never reroutes a request in flight. Second, **the manager stage is opened by the requester, not by the Vault Admin's approval**: after the Vault Admin approves, `manager_status` stays `null` until the requester calls `raise-manager`, and `decide()` refuses the manager stage until then.

### 1.3 Key ideas to understand first

| Idea | What it means in the code |
|---|---|
| Vault Admin | The **Branch User** (`user_type = branch_user`); `adminBranchOf($u)` returns their branch, `branchAdminIds($branch)` lists the branch's Vault Admins |
| Named approver | Set when the request is raised. `admin_user_id` = the credential's `lock_admin_user_id` when that user is an active Vault Admin of the requester's branch, otherwise the lowest-id active Vault Admin of that branch — never the requester. `manager_user_id` = the credential's `lock_manager_user_id` if set, else the requester's reporting manager from HR (`managerOf()`) |
| Snapshot | `admin_required`, `manager_required`, `otp_required` — the steps in force when the request was raised |
| `currentStage()` | The first step not yet done: `admin`, `manager`, `otp`, or `null` |
| `status` | The stored life of a request: `pending`, `approved`, `unlocked`, `locked`, `rejected`, `cancelled` |
| `display_status` | What the page shows: `pending`, `approved`, `rejected`, `cancelled`, `reset` |
| Open | `pending`, `approved` or `unlocked` — one open request per person per credential |
| Sweep | `sweepUnlocks()` — ends every window whose time has passed, lazily, on the next call |

---

## 2. Architecture

### 2.1 Architecture at a glance

| Layer | Runs on | What it does | Main pieces | Talks to the next layer through |
|---|---|---|---|---|
| **1 · Browser** | React 19 single-page app | Lists requests, polls, shows the countdown, opens the confirmation dialogs | `AccessRequests.tsx`, `arData.ts`, `cvApi.ts`, `shared.tsx` | HTTPS · JSON · `Authorization: Bearer <Sanctum token>` |
| **2 · API** | Laravel 12 on PHP 8.2 | Checks who may see and decide each request, moves it through its stages, writes audit rows and notifications | `AccessRequestController`, `CredVaultController` (base), `AccessRequest` model | Eloquent / SQL · Laravel cache |
| **3 · Data** | PostgreSQL + database cache | Stores the requests; keeps email-code hashes and replay keys for minutes | `credvault_access_requests`, `credvault_audit_logs`, `notifications`, `cache` | — |

### 2.2 Layer 1 — Browser (`resources/js/pages/credvault/`)

| File | Lines | Role |
|---|---|---|
| `requests/AccessRequests.tsx` | 368 | The page: tabs, search, table, approver cells, status cell, actions, dialogs, polling, countdown |
| `requests/arData.ts` | 155 | Data source — `AR_DUMMY = false`, so the live API is used |
| `requests/requests.css` | 241 | Page styles (`.ar-*` cells and buttons, `.arj-*` dialog card) |
| `cvApi.ts` | 419 | Typed client: `requests`, `approve`, `reject`, `cancel`, `lock`; the `AccessRequestRow` type; `CV_ROUTES` |
| `shared.tsx` | 663 | `CvPage`, `CvStrip`, `CvBrief`, `CvTabsRow`, `CvPortal`, `ShimRows`, `EmptyRow`, `useDebounced`, `useNow`, `mmss`, `fmtDate`, `fmtTime` |
| `critical/UnlockModal.tsx` | 890 | Raise, forward, code and Lock now — owned by the Critical Vault page |

### 2.3 Layer 2 — API (`app/`)

| Piece | Lines | Role |
|---|---|---|
| `CriticalVault/AccessRequestController.php` | 427 | `accessRequests`, `accessRequest`, `requestAccess`, `approveRequest`, `rejectRequest`, `raiseManager`, `cancelRequest`, `sendOtp`, `verifyOtp`, `lockRequest` |
| `CredVaultController.php` (base) | 5,746 | `decide`, `unlock`, `sweepUnlocks`, `findRequest`, `requestRow`, `canApproveAdmin`, `branchAdminIds`, `managerOf`, `notify`, `notifyStage`, `userInfo`, `audit`, `nextCode`, `tenantUser`, `reject`, `inTransaction` |
| `Models/CredVault/AccessRequest.php` | 95 | The model |
| `Services/CredVault/EmailOtp.php` · `Totp.php` | 185 · 99 | The 2-step code (used by the unlock popup) |

### 2.4 Layer 3 — Data

| Table / store | Holds |
|---|---|
| `credvault_access_requests` | The requests |
| `credvault_audit_logs` | One row per step (`meta.request_id`) |
| `notifications` | Bell-inbox rows |
| `cache` (database store) | `credvault:email-otp:unlock:{request}` (emailed code hash, 10 min) · `credvault:email-otp:gap:{user}:unlock:{request}` (30 s resend gap) · `credvault:email-otp:hour:{user}` (10 sends per hour, shared with the setup sends) · `credvault:totp-used:{credential}:{step}` (replay guard, 3 min) |

### 2.5 What happens when the page loads and an approver acts

| Step | Call | Server work |
|---|---|---|
| 1 | `GET /critical-vault/access-requests?tab=all&page=1&per_page=10` | `tenantUser()` → validate → `sweepUnlocks()` → visibility base → search → six tab counts → page → `requestRow()` per request |
| 2 | Every 30 s while the browser tab is visible, and on coming back | The same list call, quietly |
| 3 | **Approve** | `POST /access-requests/{id}/approve` → `decide($u, $id, true)` |
| 4 | **Reject** (dialog) | `POST /access-requests/{id}/reject` → `decide($u, $id, false, 'Not approved at this time')` |
| 5 | **Cancel** (dialog) | `POST /access-requests/{id}/cancel` → `cancelRequest()` |
| 6 | **Lock now** (dialog) | `POST /access-requests/{id}/lock` → `lockRequest()` |
| 7 | After each action | A quiet list reload |

---

## 3. Tech Stack

| Layer | Technology | Used for |
|---|---|---|
| Frontend | React 19.2 · TypeScript 6.0 · React Router 7.14 · Axios 1.11 | The page and the API calls |
| Frontend | Velzon theme · Bootstrap 5.3 · `WorklistPager` | The page chrome and the pager |
| Backend | PHP 8.2+ · Laravel 12 · Sanctum 4 | Routing, validation, Eloquent, transactions, tokens |
| Database | PostgreSQL | The table; a CHECK on `status`; a partial unique index for one open request |
| Concurrency | `lockForUpdate()` on the request row; the `clients` row lock in `nextCode()` | Safe decisions and REQ- numbers |
| Codes | `REQ-%04d` per company via `nextCode('credvault_access_requests', 'REQ', client_id)` | Request numbers |
| Notifications | Direct inserts into `notifications` (Laravel database-notification shape) | The bell inbox |
| Rate limits | `credvault` 240/min per user; `credvault-otp` 10/min on `verify-otp` | Abuse protection |

---

## 4. Database Schema

### 4.1 `credvault_access_requests`

| Group | Column | Type | Notes |
|---|---|---|---|
| Key | `id` | bigint PK | |
| Tenancy | `client_id` | unsigned bigint, indexed | |
| Identity | `code` | string(20) | **REQ-0001**, per company |
| Target | `credential_id` | unsigned bigint, indexed | No foreign key; read with trashed credentials |
| Requester | `requester_id` | unsigned bigint, indexed | No foreign key |
| | `reason` | string(300), nullable | Required (≥ 10 characters) only with the Vault Admin step |
| | `duration_minutes` | unsigned smallint | 5, 15, 30 or 60 (always 5 without the Vault Admin step) |
| Vault Admin | `admin_required` | boolean, default false | Snapshot |
| | `admin_user_id` | unsigned bigint, nullable, indexed | The named Vault Admin |
| | `admin_status` | string(10), nullable | `pending` \| `approved` \| `rejected` |
| | `admin_decided_by` · `admin_decided_at` · `admin_note` | bigint · timestamp · string(300), nullable | Who decided, when, the note |
| Manager | `manager_required` | boolean, default false | Snapshot |
| | `manager_user_id` | unsigned bigint, nullable, indexed | The named manager |
| | `manager_status` | string(10), nullable | `null` until forwarded (or `pending` at raise when there is no Vault Admin step) |
| | `manager_decided_by` · `manager_decided_at` · `manager_note` | bigint · timestamp · string(300), nullable | |
| 2-step | `otp_required` | boolean, default false | Snapshot |
| | `otp_verified_at` | timestamp, nullable | |
| | `otp_attempts` | unsigned tinyint, default 0 | Wrong codes on this request |
| Life | `status` | string(10), default `pending` | See 4.3 |
| | `unlocked_at` · `expires_at` · `locked_at` | timestamps, nullable | `expires_at = unlocked_at + duration_minutes` |
| | `locked_reason` | string(20), nullable | `manual` \| `expired` \| `otp_failed` |
| | `created_at`, `updated_at` | timestamps | **No soft deletes** |

### 4.2 Indexes and constraints

| Name / kind | Columns | Purpose |
|---|---|---|
| unique | (`client_id`, `code`) | One REQ- number per company |
| index | (`client_id`, `status`) | The sweep and the tab counts |
| index | `client_id`, `credential_id`, `requester_id`, `admin_user_id`, `manager_user_id` | Visibility and search |
| `credvault_req_status_check` | `status in ('pending','approved','unlocked','locked','rejected','cancelled')` | An out-of-list status fails at the database (created on PostgreSQL only) |
| `uq_credvault_req_open` (partial unique) | (`credential_id`, `requester_id`) `where status in ('pending','approved','unlocked')` | One open request per person per credential — it stops a double click raising two (PostgreSQL only; elsewhere only the pre-insert check in `requestAccess()` guards) |

### 4.3 Status values

| `status` | Set by | Open? |
|---|---|---|
| `pending` | `requestAccess()` (an approval step exists) | Yes |
| `approved` | `decide()` when only the code remains | Yes |
| `unlocked` | `unlock()` | Yes |
| `locked` | `lockRequest()` (`manual`), `sweepUnlocks()` (`expired`), `verifyOtp()` (`otp_failed`) | No |
| `rejected` | `decide()` with approve = false | No |
| `cancelled` | `cancelRequest()`, or `binCredential()` when the credential is moved to the Recycle Bin | No |

### 4.4 Migration

| Migration | Change |
|---|---|
| `database/migrations/credvault/2026_10_30_000003_create_credvault_access_requests_table.php` | Creates the table, the unique and composite indexes, the status CHECK and the partial unique index. Loaded by `AppServiceProvider::boot()`; no later migration alters the table |

---

## 5. Models

### 5.1 `App\Models\CredVault\AccessRequest`

| Member | Value |
|---|---|
| `$table` | `credvault_access_requests` |
| `OPEN` | `['pending', 'approved', 'unlocked']` |
| `STATUSES` | `['pending', 'approved', 'unlocked', 'locked', 'rejected', 'cancelled']` |
| `DURATIONS` | `[5, 15, 30, 60]` |
| `MAX_OTP_ATTEMPTS` | `3` |
| `DEFAULT_MINUTES` | `5` — the window without a Vault Admin step |
| Casts | the three `*_required` → boolean; `otp_attempts`, `duration_minutes` → integer; the timestamps → datetime |

| Method / relation | Behaviour |
|---|---|
| `currentStage()` | `null` unless `status` is `pending` or `approved`; otherwise the first of `admin` (required, not approved), `manager` (required, not approved), `otp` (required, not verified) |
| `isLive()` | `status = unlocked` and `expires_at` in the future |
| `credential()` | Belongs to `Credential`, **with trashed** — requests on binned credentials still show |
| `requester()`, `adminUser()`, `managerUser()` | Belong to `User` on the three user columns |
| `adminDecider()`, `managerDecider()` | Belong to `User` on `*_decided_by` |

### 5.2 Related members

| Model | Member | Role here |
|---|---|---|
| `Credential` | `lockSteps()` | The switched-on steps, in the order `admin`, `manager`, `otp` |
| `Credential` | `twoStepLinked()`, `maskEmail()`, `criticalCode()` | The code stage, the masked inbox, the CCRD- code in each row |
| `AuditLog` | `ACTIONS` | `request` warn, `forward_mgr` info, `approve` info, `reject` critical, `cancel` info, `unlock` critical, `lock` info, `otp_failed` warn, `otp_sent` info |
| `User` | `isBranchUser()` | The Vault Admin test behind `adminBranchOf()` |

---

## 6. API Surface

All under `/api/credvault/critical-vault`. Full contracts are in the API Documentation.

| # | Method | Path | Action | Called by |
|---|---|---|---|---|
| 1 | GET | `/access-requests` | `accessRequests` | **This page** |
| 2 | GET | `/access-requests/{id}` | `accessRequest` | — (integrations) |
| 3 | POST | `/credentials/{id}/access-requests` | `requestAccess` | The unlock popup — its refusals are listed in the Critical Vault Technical Documentation (8.1) |
| 4 | POST | `/access-requests/{id}/approve` | `approveRequest` | **This page** |
| 5 | POST | `/access-requests/{id}/reject` | `rejectRequest` | **This page** |
| 6 | POST | `/access-requests/{id}/raise-manager` | `raiseManager` | The unlock popup |
| 7 | POST | `/access-requests/{id}/cancel` | `cancelRequest` | **This page** and the popup |
| 8 | POST | `/access-requests/{id}/send-otp` | `sendOtp` | The unlock popup |
| 9 | POST | `/access-requests/{id}/verify-otp` | `verifyOtp` · `throttle:credvault-otp` | The unlock popup |
| 10 | POST | `/access-requests/{id}/lock` | `lockRequest` | **This page** and the popup |

Every `{id}` is constrained to digits. The whole group sits under `auth:sanctum` → `user.active` → `tenant` → `throttle:credvault`.

---

## 7. How Access Is Decided

### 7.1 Who sees a request

| Where | Rule |
|---|---|
| The list (`accessRequests`) | Everyone: `requester_id = me` OR `admin_user_id = me` OR `manager_user_id = me`; the Vault Admin additionally sees every request whose requester's `users.branch_id` is their branch |
| One request (`findRequest`) | Me in (`requester_id`, `admin_user_id`, `manager_user_id`) OR `canApproveAdmin(me, r)`; anyone else gets **404** *Access request not found.* |
| Company | Every query is scoped to the caller's `client_id` |

### 7.2 Who decides

| Stage | Rule |
|---|---|
| Vault Admin | `canApproveAdmin($u, $r)`: with `admin_user_id` set, **only that person**; with none set, any active Vault Admin of `requestBranch($r)` (the requester's branch, else the credential's). `requestAccess()` always sets one — the first of the pool |
| Manager | Only `manager_user_id`, and only once `manager_status = pending` (forwarded) |
| Both | Never the requester (`decide()` 403); only while `status = pending` |

> **Explanation: one person, two approvals.** When the requester's manager is also the Vault Admin, the same person decides both stages — two separate, audited actions. `requestRow()` sets `can.approve` at the manager stage for the named manager even when they gave the Vault Admin approval.

### 7.3 Tab predicates

| Tab | Predicate on the visibility base |
|---|---|
| `all` | None |
| `pending` | `status = pending` |
| `approved` | `status in (approved, unlocked, locked)` and (`locked_reason is null` or `!= otp_failed`) |
| `rejected` | `status = rejected` |
| `mine` | `requester_id = me` |
| `to_me` | `status = pending`, not mine, and either (a) the Vault Admin stage is pending and names me, or (b) `manager_status = pending`, `manager_user_id = me`, and `admin_decided_by` is not me |

All six counts are computed on every list call from clones of the **unsearched** base; only the chosen tab's predicate is applied to the searched query. The page shows four tabs; `mine` and `to_me` are returned but not shown.

### 7.4 Search (`q`)

`likeTerm()` lower-cases, escapes `%`, `_`, `\` and wraps the term in `%…%`. It matches `code`, `reason`, the credential's `name` / `code` / `category_group` / `type` (type keys whose label contains the term; trashed credentials included), the requester / named approvers / `admin_decided_by` by user name, the requester by department, and `duration_minutes` from the first number in the term — × 60 when any word in the term **starts with** `h` (regex `\b(h|hr|hrs|hour)`): *1 hour* and *2 hrs* work, *1h* does not, and *HR 30* is read as 30 hours. Because every number is matched, *REQ-0015* also returns the 15-minute requests.

---

## 8. The Engine

### 8.1 `decide()` — approve and reject

Runs in a transaction with the request row locked.

| Step | Rule |
|---|---|
| 1 | `status` must be `pending` — else 409 *This request is no longer waiting for approval.* |
| 2 | Not the requester — else 403 *You cannot decide your own request.* |
| 3 | Stage `admin`: `canApproveAdmin()` — else 403 *This request is waiting for ‹name›.* |
| 4 | Stage `manager`: `manager_status = pending` — else 409 *…not been forwarded…*; caller = `manager_user_id` — else 403 |
| 5 | Write `{stage}_status`, `{stage}_decided_by`, `{stage}_decided_at`, `{stage}_note` |
| 6 | Reject → `status = rejected`, audit `reject` (module *Access Requests*), notify the requester |
| 7 | Approve → audit `approve`; next stage `null` → `unlock()`; next `otp` → `status = approved`; next `manager` → stays `pending` with `manager_status` still `null`, and the requester is told to forward |

### 8.2 The other actions

| Action | Rule |
|---|---|
| `raiseManager()` | Requester only; `pending`; a manager step; the Vault Admin stage approved; `manager_status` still `null` → `pending`; audit `forward_mgr`; `notifyStage()` notifies the manager |
| `cancelRequest()` | Requester only; `pending` or `approved` → `cancelled`; the email code is forgotten; audit `cancel` |
| `lockRequest()` | The requester or the Vault Admin; `status = unlocked` → `locked`, `locked_reason = manual`; audit `lock` |
| `unlock()` | `status = unlocked`, `unlocked_at = now`, `expires_at = now + duration`; audit `unlock` |
| `sweepUnlocks()` | Once per HTTP request per company (memoised): every `unlocked` row with `expires_at <= now` → `locked`, `locked_at = expires_at`, `locked_reason = expired`; audit with the requester as the actor. Run by the request list, one request and raise, and by the Critical Vault credential list, show, reveal and the dashboard; **not** by approve, reject, raise-manager, cancel, send-otp, verify-otp or lock |

### 8.3 `requestRow()` — the response row

| Key | Rule |
|---|---|
| `display_status` | `pending`, `rejected`, `cancelled`, `reset` (locked by `otp_failed`), else `approved` |
| `status_label` | *Step n of m · Vault Admin / Reporting Manager* (approval steps only) while pending; *Approved · enter the authenticator / email code* while `status = approved`; *Unlocked* while the window is live; *Both approvals done* for an ended-but-unswept unlock and every `locked` row except `otp_failed`; *Rejected by Vault Admin / Reporting Manager*; *Cancelled by requester* (also for a bin cancel); *Too many wrong codes — request again* |
| `manager.status` | The stored value, or `not_required` (the Vault Admin rejected) or `after_admin` when it is `null` |
| `requester.role_line` | From `userInfo()`: designation · department, else *Team member* |
| `can.*` | Per viewer: `approve`, `reject`, `cancel`, `verify_otp`, `send_otp`, `lock`. `lock` needs a **live** window (`isLive()`), not just `status = unlocked`. `approve` / `reject` are true for the named manager even before the forward |
| `seconds_left` / `total_seconds` | The live countdown and the window length |

---

## 9. Frontend

### 9.1 State

| State | Purpose |
|---|---|
| `tab`, `q` → `dq` (debounced 350 ms), `page`, `perPage` | The query; `load()` runs again when any changes |
| `rows`, `tabs`, `meta` | The server response |
| `loading`, `error` | Shimmer rows / the error row with **Try again** |
| `fetchedAt` | The base for the countdown |
| `busyIds` (a Set) | A busy flag per row, so two rows can be in flight independently |
| `approving` | The row showing *Approving…* |
| `dialog` | `{ kind: 'reject' \| 'cancel' \| 'lock', row }` |
| `seq` (ref) | Drops the responses of superseded loads |

### 9.2 Behaviour worth knowing

| Behaviour | Detail |
|---|---|
| Polling | `POLL_MS = 30_000`, only while `document.visibilityState === 'visible'`; a quiet reload on `visibilitychange` |
| Countdown | `useNow(anyLive)` ticks only while some row has `seconds_left > 0`; `left()` subtracts the time since `fetchedAt` and never goes above the server's figure |
| After a decision | `decided(id)` clears `can.approve` / `can.reject` on that row at once, before the reload |
| Awaiting forward | Approve / Reject are also disabled while `stage === 'manager' && manager.status === 'after_admin'` |
| Reject | Called **without a note** — the server stores *Not approved at this time* |
| Approve toast | *‹REQ›* *approved · the requester forwards it to the Manager* when `stage === 'admin'` and a manager step exists; else *‹REQ› fully approved* |
| Errors | Any failure → toast (*Could not approve* / *Action failed*) and a quiet reload |

---

## 10. Integrations

### 10.1 Notifications (bell inbox)

`notify()` inserts rows into `notifications` (`type App\Notifications\CredVault`, `notifiable_type App\Models\User`, JSON `data` = `{ module: 'credvault', kind, title, message }` plus `request_id`, `credential_id`, `url` — the `otp_failed` row has no `request_id`) inside the caller's transaction; a failed insert is logged and swallowed.

| Event | To | `kind` | Title |
|---|---|---|---|
| Raised, Vault Admin stage | The named Vault Admin | `access_request` | Access request to approve |
| Raised without a Vault Admin step, or forwarded | `manager_user_id` | `access_request` | Access request to approve |
| Vault Admin approved, manager next | The requester | `access_approved` | Vault Admin approved |
| Approved, code or unlock next | The requester | `access_approved` | Access approved |
| Rejected | The requester | `access_rejected` | Access request rejected |
| 3 wrong codes | The credential owner (if not the requester) | `otp_failed` | Wrong 2-step codes |

Stage notifications link to `/credentials-vault/access-requests`; decision notifications link to `/credentials-vault/critical-vault`. Decisions are **not** emailed.

### 10.2 Audit log and HR

| Integration | How |
|---|---|
| Audit log | `audit()` → `writeAudit()` → `credvault_audit_logs`; module *Critical Vault* (request, cancel, unlock, lock, code) or *Access Requests* (approve, reject, forward) |
| HR | `managerOf()` reads `employees.reporting_manager_user_id`, else the login of `reporting_manager_id`; `userInfo()` reads designation and department for the role line |

---

## 11. Security

| Area | Guarantee |
|---|---|
| Company boundary | Every query filters on the caller's `client_id`; a login with no company gets 403 |
| Module gate | `can_view` on the `credentials-vault` module, else 403 |
| Not found vs forbidden | A request outside the caller's reach reads as **404** |
| Self-approval | Refused in `decide()` and never offered in `can.approve` |
| Races | Approve, reject, raise-manager, cancel, verify-otp and lock read the row with `lockForUpdate()`; the sweep and the bin's bulk cancel do not lock; the partial unique index guards raising |
| Rate limits | `credvault` 240/min per user; `credvault-otp` 10/min on `verify-otp`; email sends 1 per 30 s per request and 10 per hour per user |
| No secrets | No request response carries a secret; `verifyOtp()` reads `totp_secret` with its own query |
| Errors | An unexpected failure inside `inTransaction()` becomes a logged 500 *Could not ‹action›. Nothing was saved — please try again.* |

---

## 12. Business Rules in the Code

| ID | Rule | Where it is kept |
|---|---|---|
| BR-01 | REQ- numbers are per company and never reused | `nextCode()` |
| BR-02 | The steps and the named approvers are fixed when the request is raised | `requestAccess()` |
| BR-03 | The stage is read only from the request's own columns | `currentStage()` |
| BR-04 | Nobody decides their own request | `decide()`, the Vault Admin pool |
| BR-05 | The Vault Admin stage belongs to the Vault Admin named on the request | `canApproveAdmin()` |
| BR-06 | The manager acts only after the forward | `decide()`, `raiseManager()` |
| BR-07 | Only pending requests can be decided | `decide()` |
| BR-08 | One open request per person per credential | `uq_credvault_req_open`, `requestAccess()` |
| BR-09 | Only the requester forwards or cancels; cancel while pending or approved | `raiseManager()`, `cancelRequest()` |
| BR-10 | Lock now only on an unlocked request, by the requester or the Vault Admin | `lockRequest()` |
| BR-11 | Windows end lazily but never open anything late | `sweepUnlocks()`, `isLive()` |
| BR-12 | A request outside the caller's reach is a 404 | `findRequest()` |

---

## 13. Known Issues

| # | Issue | Effect |
|---|---|---|
| 1 | The list shows the Vault Admin every request of their branch, but `findRequest()` does not use the branch rule | A branch request naming **another** Vault Admin is listed, yet `GET /access-requests/{id}` and the actions answer 404 for it |
| 2 | `to_me` excludes manager rows the viewer already approved as Vault Admin, while `decide()` and `can.approve` allow that second approval | The person who is both still sees and decides the request, but not under `to_me` |
| 3 | `requestAccess()` always names one Vault Admin | When the credential names none, only the lowest-id Vault Admin of the branch can decide; `admin.any_admin` is practically always `false` |
| 7 | `can.approve` is true for the named manager before the forward | API clients must also check `manager.status !== 'after_admin'`; the server answers 409 until the forward |
| 8 | A bin move cancels open requests (unlocked ones too) in one bulk update | No per-request audit row, and the rows read *Cancelled by requester* |
| 9 | If the named Vault Admin is deactivated, the notice goes elsewhere but `canApproveAdmin()` still checks the raw `admin_user_id` | Nobody can decide that request; the requester has to cancel and raise a new one |
| 4 | Approve, reject, cancel and lock do not sweep | An ended, unswept window can still be "locked now" and is stored as `manual` |
| 5 | The reject dialog sends no note | The requester always reads *Not approved at this time* |
| 6 | The cancel dialog says *The approvers will no longer see it* | Cancelled requests stay in **All Requests** for approvers too |

---

## 14. Metrics

| Item | Count |
|---|---|
| Routes | 10 (1 with `credvault-otp`) — the page calls 5 of them |
| Controller actions | 10 in `AccessRequestController` |
| Tables owned | 1 (`credvault_access_requests`) |
| Migrations | 1 |
| Stored statuses / display statuses | 6 / 5 |
| Tabs returned / shown | 6 / 4 |
| Audit actions | 9 |
| Notification kinds | 4 |
| Frontend files (page) | 3 (368 + 155 + 241 lines) |
| Dummy data switch | `AR_DUMMY = false` |

---

## 15. Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The Branch User (`user_type = branch_user`) of a branch |
| Named approver | `admin_user_id` / `manager_user_id`, set when the request is raised |
| Snapshot | The `*_required` flags copied from the credential when the request is raised |
| Stage | `admin`, `manager` or `otp` — the step a request waits on |
| Forward | `raise-manager` — the requester opens the manager stage |
| Open | `pending`, `approved` or `unlocked` |
| Reset | `locked` with `locked_reason = otp_failed`, shown as **Reset** |
| Sweep | `sweepUnlocks()` — locks every window that has ended |
