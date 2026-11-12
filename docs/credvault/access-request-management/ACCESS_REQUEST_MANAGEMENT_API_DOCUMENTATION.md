# CredVault Access Request Management — API Documentation

| | |
|---|---|
| **Jira** | To be added (parent — CredVault Access Request Management Documentation) |
| **Module** | CredVault → Access Request Management |
| **Audience** | Frontend and backend developers, QA automation, integrators |
| **Companion documents** | Functional Documentation · Technical Documentation · Code Walkthrough · Critical Vault API Documentation |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document lists every API call behind the Access Request Management page: what to send, what comes back, and every error with its exact message. Use it to build against the API, to write automated tests, or to understand a response seen in the browser. The examples are built field by field from the real response builder (`requestRow()`); all names, ids and codes are fake. The calls that **raise** a request and enter the 2-step code belong to the Critical Vault and are documented in the Critical Vault API Documentation (section 6).

### 1.2 The API in one paragraph

The page uses **five** endpoints under `/api/credvault/critical-vault/`: one list (`GET /access-requests`) and four actions on a request — **approve**, **reject**, **cancel**, **lock**. A sixth, `GET /access-requests/{id}`, returns a single request. Every endpoint returns the same **request object** (section 4), which carries the stage, both approvers with their decisions, the status the page should show, a live countdown, and `can.*` flags that say which buttons the caller may use.

### 1.3 Key ideas to understand first

| Idea | What it means in the API |
|---|---|
| Vault Admin | The **Branch User** (`user_type = branch_user`) of a branch. Decides the Vault Admin stage of requests raised in their branch |
| Named approver | `admin.user` and `manager.user` — set when the request was raised. Only the named Vault Admin decides the Vault Admin stage |
| `stage` | The step the request waits on: `admin`, `manager`, `otp`, or `null` |
| `status` | The stored life: `pending`, `approved` (waiting for the code), `unlocked`, `locked`, `rejected`, `cancelled` |
| `display_status` | What the page shows: `pending`, `approved`, `rejected`, `cancelled`, `reset` |
| `can.*` | The actions the **caller** may take on this request right now |

---

## 2. Conventions

| Aspect | Value |
|---|---|
| Base path | `/api/credvault/critical-vault` |
| Authentication | `Authorization: Bearer <Sanctum token>` on every route |
| Middleware | `auth:sanctum` → `user.active` → `tenant` → `throttle:credvault` (240 / minute per user) |
| Module gate | `can_view` on the `credentials-vault` module, else **403** *"You do not have access to Credentials Vault. Ask your admin to grant it in Permissions."* |
| Ids | `{id}` is numeric; a non-numeric id is a plain 404 |
| Success | `{ "status": true, "message"?: "…", "data": … }`; the list adds `tabs` and `meta` |
| Refusal | Raised by the controller: `{ "status": false, "message": "…", "errors"?: {…} }`. Form validation: Laravel's `{ "message", "errors" }`. Rate limit: 429 `{ "message": "Too Many Attempts." }` |
| Auth failures | 401 `{ "message": "Unauthenticated." }`; an inactive account: 401 *Account is no longer active. Please sign in again.*; a login with no company: 403 *CredVault needs a company account — this login has no tenant.* |
| Out of reach | A request the caller may not see answers **404** *Access request not found.* |
| Unexpected failure | Only the four actions: **500** *Could not approve the request.* / *Could not reject the request.* / *Could not cancel the request.* / *Could not lock the credential.* — each followed by *Nothing was saved — please try again.* (logged) |
| `branch_id` | The browser adds `?branch_id=` to GETs; these endpoints ignore it — visibility comes from the user |

---

## 3. Endpoint Index

| # | Method | Endpoint | Purpose | Called by the page |
|---|---|---|---|---|
| 1 | GET | `/access-requests` | The request list with tabs, search and paging | Yes |
| 2 | GET | `/access-requests/{id}` | One request | No (integrations) |
| 3 | POST | `/access-requests/{id}/approve` | Approve the stage waiting now | Yes — **Approve** |
| 4 | POST | `/access-requests/{id}/reject` | Reject — ends the request | Yes — **Reject Request** |
| 5 | POST | `/access-requests/{id}/cancel` | The requester withdraws | Yes — **Cancel Request** |
| 6 | POST | `/access-requests/{id}/lock` | Lock an unlocked credential now | Yes — **Lock Now** |

> **Explanation: what the page does not call.** Raising a request (`POST /credentials/{id}/access-requests`), the forward (`raise-manager`), and the code calls (`send-otp`, `verify-otp`) are made by the Critical Vault's unlock popup — see the Critical Vault API Documentation, section 6.

---

## 4. The Request Object

Every endpoint returns it — the list as an array in `data`, the others as one object in `data`.

```json
{
  "id": 88, "code": "REQ-0031",
  "credential": {
    "id": 41, "code": "CCRD-0007", "critical_code": "CCRD-0007", "name": "Treasury Current Account",
    "type": "bank", "type_label": "Bank Account", "category_group": "Finance & Banking",
    "risk": "critical", "url": null, "in_bin": false
  },
  "requester": {
    "id": 57, "name": "Arjun Patil", "initials": "AP", "designation": "Accounts Executive",
    "department": "Accounts", "role_line": "Accounts Executive · Accounts", "is_me": false
  },
  "reason": "Month-end vendor payment run for October",
  "duration_minutes": 15, "duration_label": "15 min",
  "admin": { "user": { "id": 21, "name": "Rohan Desai", "initials": "RD" }, "any_admin": false,
             "status": "pending", "decided_at": null, "decided_by": null, "note": null },
  "manager": { "user": { "id": 34, "name": "Kavya Rao", "initials": "KR" },
               "status": "after_admin", "decided_at": null, "decided_by": null, "note": null },
  "otp": { "method": "google", "label": "Authenticator", "sent_to": null, "verified_at": null, "attempts_left": 3 },
  "status": "pending", "display_status": "pending", "status_label": "Step 1 of 2 · Vault Admin",
  "stage": "admin", "stage_label": "Vault Admin", "steps": ["admin", "manager", "otp"],
  "step": { "number": 1, "of": 3, "label": "Vault Admin" },
  "unlocked_at": null, "expires_at": null, "seconds_left": 0, "total_seconds": 900, "locked_reason": null,
  "can": { "approve": true, "reject": true, "cancel": false, "verify_otp": false, "send_otp": false, "lock": false },
  "created_at": "2026-11-12T08:40:05+00:00"
}
```

### 4.1 Keys

| Key | Values |
|---|---|
| `credential` | `null` when the credential no longer exists (the page shows *Deleted credential*); `in_bin: true` when it is in the Recycle Bin |
| `requester.role_line` | Designation · department, else *Team member*; `null` (with `designation` and `department`) when the user no longer exists |
| `reason` | `null` when none was given; required (≥ 10 characters) only when the request has a Vault Admin step |
| `duration_label` | *5 min*, *15 min*, *30 min* or *1 hour* |
| `admin` / `manager` / `otp` | `null` when that step is not on the request |
| `admin.status` | `pending` \| `approved` \| `rejected` |
| `manager.status` | `pending` \| `approved` \| `rejected`, or `after_admin` (the Vault Admin has not approved yet, or the requester has not forwarded — also left on cancelled or reset requests that never reached the manager), or `not_required` (the Vault Admin rejected). **Without a Vault Admin step it is `pending` from the moment the request is raised — there is no forward** |
| `*.decided_by` / `*.decided_at` / `*.note` | Who decided, when, and the note (*Not approved at this time* for a rejection without one) |
| `status` | `pending` \| `approved` \| `unlocked` \| `locked` \| `rejected` \| `cancelled` |
| `display_status` | `pending` \| `approved` (approved, unlocked, or locked by `expired` / `manual`) \| `rejected` \| `cancelled` \| `reset` (locked by `otp_failed`) |
| `locked_reason` | `expired` \| `manual` \| `otp_failed` |
| `seconds_left` / `total_seconds` | The live countdown and the window length, in seconds |
| `stage_label` / `step.label` | *Vault Admin*, *Reporting Manager*, or for the code step *Authenticator* / *Email code*; `step` is `null` when `stage` is `null`. `step.of` counts **every** step, including the code; `status_label` counts only the approval steps |
| `admin.any_admin` | `true` only when no Vault Admin is named; raising always names one, so it is normally `false`. With none named, any Vault Admin of the request's branch may decide |

### 4.2 `status_label`

| `display_status` | `status_label` |
|---|---|
| `pending` | *Step n of m · Vault Admin* / *Step n of m · Reporting Manager* — counting **approval** steps only |
| `approved` | *Approved · enter the authenticator code* / *Approved · enter the email code* · *Unlocked* · *Both approvals done* (window ended or locked early) |
| `rejected` | *Rejected by Vault Admin* / *Rejected by Reporting Manager* |
| `cancelled` | *Cancelled by requester* |
| `reset` | *Too many wrong codes — request again* |

### 4.3 `can.*` — the caller's buttons

| Flag | True when |
|---|---|
| `approve` / `reject` | `status = pending`, the caller is not the requester, and the caller may act on the current stage: the named Vault Admin at the `admin` stage, or the named manager at the `manager` stage |
| `cancel` | The caller is the requester, and `status` is `pending` or `approved` |
| `lock` | A live window, and the caller is the requester or the Vault Admin |
| `verify_otp` / `send_otp` | Used by the unlock popup, not by this page |

> **Common misunderstanding.** "`can.approve` true means the manager can approve now." At the `manager` stage the flag is already true for the named manager **before** the forward. The page also checks `manager.status === "after_admin"` and keeps the buttons greyed out; the server refuses with 409 until the requester forwards.

---

## 5. The List

### 5.1 GET `/access-requests`

| Query parameter | Rules |
|---|---|
| `tab` | `all` (default) \| `pending` \| `approved` \| `rejected` \| `mine` \| `to_me` — the page uses the first four |
| `q` | Optional, ≤ 100 characters (see 5.3) |
| `page`, `per_page` | Optional integers, at least 1; `per_page` at most 100, default 10 |

Runs `sweepUnlocks()` first, so ended windows read `locked`.

**200**

```json
{
  "status": true,
  "data": [ { "id": 88, "code": "REQ-0031", "…": "the request object (section 4)" } ],
  "tabs": { "all": 14, "pending": 3, "approved": 8, "rejected": 2, "mine": 1, "to_me": 2 },
  "meta": { "current_page": 1, "per_page": 10, "total": 14, "last_page": 2 }
}
```

### 5.2 Who appears, and the tabs

| Caller | Sees |
|---|---|
| The Vault Admin | Every request whose **requester** belongs to their branch, plus their own |
| Anyone else | Requests they raised, and requests that name them as the Vault Admin or the manager |

| Tab | Holds |
|---|---|
| `all` | Everything visible, any status |
| `pending` | `status = pending` |
| `approved` | `approved`, `unlocked`, or `locked` except by `otp_failed` |
| `rejected` | `status = rejected` |
| `mine` | Raised by the caller |
| `to_me` | Pending, not the caller's own, and waiting on the caller: a Vault Admin stage naming them, or a forwarded manager stage naming them (excluding requests they already approved as Vault Admin) |

Cancelled and reset requests appear only under `all` (and `mine`). Rows are newest first.

> **Explanation: the counts ignore the search.** `tabs` is always computed on the unsearched list, so the badges show full totals while `data` follows `q`.

### 5.3 Search (`q`)

| Matches | Example |
|---|---|
| Request code | `REQ-0031` |
| Reason | `payment` |
| Credential name, code, category, type | `Treasury`, `CCRD-0007`, `Finance`, `Bank` |
| Requester, named Vault Admin, named manager, or who decided the Vault Admin stage — by name | `Arjun`, `Rohan` |
| Requester's department | `Accounts` |
| Access window | `15`, `15 min`, `1 hour` (a number, × 60 when the term has *h*, *hr*, *hrs* or *hour*) |

| Error | Status | Message |
|---|---|---|
| Unknown `tab` | 422 | Laravel's *The selected tab is invalid.* |
| `per_page` above 100, `page` / `per_page` below 1 | 422 | Laravel's validation message |
| `q` over 100 characters | 422 | *The q field must not be greater than 100 characters.* |

> **Common misunderstanding.** "Searching *REQ-0015* finds one request." The first number in any term is also matched against the window, so *REQ-0015* also returns every 15-minute request. And *1 hour* / *2 hours* count as hours, but *1h* / *1hr* count as 1 minute. Credentials in the Recycle Bin are matched too.

---

## 6. One Request

### 6.1 GET `/access-requests/{id}`

Runs `sweepUnlocks()` first. **200** — `data` = the request object.

| Error | Status | Message |
|---|---|---|
| Not visible to the caller (not the requester, the named Vault Admin, the named manager, or a Vault Admin who may decide it), or another company's | 404 | `Access request not found.` |

---

## 7. Actions

### 7.1 POST `/access-requests/{id}/approve`

Body `{ "note"?: "…" }` (≤ 300; the page sends none). **200** — `message` *"Approved."*, `data` = the updated request.

| After the approval, the next stage is | Result |
|---|---|
| `manager` | Stays `pending`; `manager.status = after_admin` until the requester forwards; the requester is notified *Vault Admin approved* |
| `otp` | `status = approved`; the requester is told *…Enter your authenticator code to open it.* (even for the email method) |
| none | `status = unlocked` with `expires_at`; the requester is told it is unlocked |

### 7.2 POST `/access-requests/{id}/reject`

Body `{ "note"?: "…" }` (≤ 300). Without a note the server stores *Not approved at this time* — the page always sends none. **200** — `message` *"Rejected."*, `status = rejected`; the requester is notified *Access request rejected*.

### 7.3 Errors for approve and reject

| Check (in order) | Status | Message |
|---|---|---|
| Module permission | 403 | `You do not have access to Credentials Vault…` |
| `note` over 300 characters | 422 | Laravel's validation message |
| Not visible to the caller | 404 | `Access request not found.` |
| Not pending | 409 | `This request is no longer waiting for approval.` |
| The caller raised it | 403 | `You cannot decide your own request.` |
| Vault Admin stage, the caller is not the named Vault Admin | 403 | `This request is waiting for Rohan Desai.` (or *the Branch Admin*) |
| Manager stage, not forwarded yet | 409 | `This request has not been forwarded to the reporting manager yet.` |
| Manager stage, the caller is not the named manager | 403 | `This request is waiting for Kavya Rao.` (or *the reporting manager*) |

A request already waiting for the code has `status = approved`, so it fails the second check: 409 *This request is no longer waiting for approval.* The message *This request has no approval waiting.* is a safety branch that cannot normally be reached.

> **Worth testing.** Two Vault Admins of one branch open the same request; only the named one can approve. When one approver acts and another tries a moment later, the second gets 409 *This request is no longer waiting for approval.* if the first approval ended the approvals; if a manager stage follows, they get 409 *…not been forwarded…* or 403 *This request is waiting for ‹name›.* The page shows **Could not approve** (or **Action failed** for Reject, Cancel and Lock) and refreshes.

### 7.4 POST `/access-requests/{id}/cancel`

No body. The requester only, while `pending` or `approved`. **200** — `message` *"Request cancelled."*, `status = cancelled`.

| Check | Status | Message |
|---|---|---|
| Not visible | 404 | `Access request not found.` |
| Not the requester | 403 | `Only the person who raised a request can cancel it.` |
| Not open for cancelling (unlocked, locked, rejected, cancelled) | 409 | `This request is no longer open.` |

### 7.5 POST `/access-requests/{id}/lock`

No body. The requester or the Vault Admin, only while `status = unlocked`. **200** — `message` *"Locked."*, `status = locked`, `locked_reason = manual`.

| Check | Status | Message |
|---|---|---|
| Not visible | 404 | `Access request not found.` |
| Neither the requester nor the Vault Admin | 403 | `Only the requester or a Vault Admin can lock this.` |
| Not unlocked | 409 | `This credential is not unlocked.` |

---

## 8. Error Catalogue

| HTTP | Used for |
|---|---|
| 401 | No / bad token; account no longer active |
| 403 | Module permission; deciding your own request; not the named approver; cancel / lock by someone else |
| 404 | A request the caller may not see; a non-numeric id |
| 409 | Not pending; not forwarded; no approval waiting; not open; not unlocked |
| 422 | Validation (`tab`, `per_page`, `note`) |
| 429 | Rate limit |
| 500 | Unexpected failure inside a transaction — nothing saved |

---

## 9. Quick Reference — Screen Action → API Call

| Screen action | API call |
|---|---|
| Open the page / change tab / search / page | `GET /access-requests?tab=&q=&page=&per_page=` |
| Automatic refresh (every 30 s, and on returning to the tab) | The same call |
| **Approve** | `POST /access-requests/{id}/approve` |
| **Reject** → **Reject Request** | `POST /access-requests/{id}/reject` |
| **Cancel** → **Cancel Request** | `POST /access-requests/{id}/cancel` |
| **Lock now** → **Lock Now** | `POST /access-requests/{id}/lock` |
| **Critical Vault** button | No API call — opens `/credentials-vault/critical-vault` |

---

## 10. Known Issues

| # | Issue | Effect |
|---|---|---|
| 1 | The list shows the Vault Admin every request of their branch, but one request (and the actions) use the named-approver rule | A branch request named to **another** Vault Admin is listed, yet its detail and actions answer 404 / 403 |
| 2 | `can.approve` is true for the named manager before the forward | Clients must also check `manager.status`; the server answers 409 until the forward |
| 3 | `to_me` leaves out manager rows the caller already approved as Vault Admin | The same person can still decide them, but they do not appear under `to_me` |
| 4 | Approve, reject, cancel and lock do not sweep first | An ended, unswept window can still be locked and is stored as `manual` |
| 5 | The page sends reject without a note | The requester always reads *Not approved at this time* |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The Branch User (`user_type = branch_user`) of a branch |
| Named approver | `admin.user` / `manager.user`, set when the request was raised |
| Stage | `admin`, `manager` or `otp` |
| Forward | `raise-manager` — the requester opens the manager stage (Critical Vault) |
| Open | `pending`, `approved` or `unlocked` |
| Reset | A request locked by 3 wrong codes |
| Envelope | The outer JSON shape: `status`, `message`, `data`, `errors` |
