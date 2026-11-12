# CredVault Critical Vault — API Documentation

| | |
|---|---|
| **Jira** | GT-109 (parent GT-79 — CredVault Critical Vault Documentation) |
| **Module** | CredVault → Vault Management → Critical Vault |
| **Audience** | Frontend and backend developers, QA automation, integrators |
| **Companion documents** | Functional Documentation · Technical Documentation · Code Walkthrough |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document lists every API call the Critical Vault uses: what to send, what comes back, and every error with its exact message. Use it to build against the API, to write automated tests, or to understand a response seen in the browser. The examples are built field by field from the real response builders (`row()`, `detail()`, `requestRow()`); all names, ids, codes and addresses are fake.

### 1.2 The API in one paragraph

The Critical Vault has **20 endpoints of its own** under `/api/credvault/critical-vault/`: 6 for the credentials, 4 to link the 2-step method in the form, and 10 for the unlock (access requests). It also uses **8 shared CredVault endpoints** — the detail, reveal, events, activity, attachment and sharing calls. A credential is saved with the protection steps switched on; to open it, the caller **raises an access request**, each approver **approves** it, the requester **forwards** it to the manager, enters the **2-step code**, and only then does `reveal` return a secret — until the window ends. The Vault Admin (Branch User) of the credential's branch skips all of it and reads the credential directly.

### 1.3 Key ideas to understand first

| Idea | What it means in the API |
|---|---|
| Vault Admin | The **Branch User** (`user_type = branch_user`) of a branch. Approves the Vault Admin stage for requests raised in their branch; opens their branch's credentials directly |
| Risk level | `low`, `medium`, `high` or `critical` (default `critical`). Every level is saved in the Critical Vault with a **CCRD-** code |
| Protection steps | `lock_admin`, `lock_manager`, `lock_otp` — at least **two** must be `true` |
| Access request | One caller's request to open one credential, numbered **REQ-nnnn**. The steps are copied onto it when it is raised |
| Stage | The step a request is waiting on: `admin`, `manager` or `otp` |
| Window | `duration_minutes` the credential stays open after the last step: 5, 15, 30 or 60 |
| `unlock` | The Access Status object on every credential row (3.2) |
| `access.via` | Why the caller can reach a credential: `owner`, `branch`, `manager`, `hod`, `team`, `branch_critical`, `share` |

---

## 2. Conventions

| Aspect | Value |
|---|---|
| Base path | `/api/credvault` |
| Authentication | `Authorization: Bearer <Sanctum token>` on every route |
| Middleware | `auth:sanctum` → `user.active` → `tenant` → `throttle:credvault` (240 / minute per user) |
| Tighter limits | `credvault-otp` 10 / minute on the three code checks; `credvault-reveal` 60 / minute on reveal |
| Module gate | `can_view` on the `credentials-vault` module, else **403** *"You do not have access to Credentials Vault. Ask your admin to grant it in Permissions."* |
| Ids | `{id}` is numeric |
| Success | `{ "status": true, "data": …, "message"?: … }`; lists add `tabs` and `meta` |
| Refusal | Raised by the controllers: `{ "status": false, "message": "…", "errors"?: { "<field>": ["…"] } }` — `errors` only when a field is named. Form validation: Laravel's `{ "message", "errors" }` (no `status`). Rate limit: 429 `{ "message": "Too Many Attempts." }` with a `Retry-After` header |
| Auth failures | 401 `{ "message": "Unauthenticated." }`; an inactive account gets 401 *Account is no longer active. Please sign in again.*; a login with no company gets 403 *CredVault needs a company account — this login has no tenant.* |
| Route constraints | A non-numeric `{id}`, or an attachment `{key}` outside `[a-z0-9-]{1,40}`, is a plain 404 with no CredVault body |
| Out of reach | A credential or request outside the caller's company or access answers **404** |
| Unexpected failure | **500** *"Could not ‹action›. Nothing was saved — please try again."* (logged) |
| `branch_id` | The browser adds `?branch_id=` to GETs; these endpoints ignore it — the branch comes from the user |

> **Explanation: why 404, not 403.** A caller who cannot reach a credential gets *"Credential not found."*, the same answer as for an id that does not exist. That way the API never confirms that a hidden credential exists.

---

## 3. Endpoint Index

### 3.1 Critical Vault credentials

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/critical-vault/credentials` | List with tabs, search and paging |
| 2 | GET | `/critical-vault/credentials/next-code` | Preview the next CCRD- code |
| 3 | POST | `/critical-vault/credentials` | Add a credential |
| 4 | PUT / POST | `/critical-vault/credentials/{id}` | Edit (POST for multipart) |
| 5 | DELETE | `/critical-vault/credentials/{id}` | Move to the Recycle Bin |
| 6 | GET | `/critical-vault/approvers` | Who approves for the caller |

### 3.2 2-step setup (in the form, before the save)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 7 | POST | `/critical-vault/two-step/google/new` | A new authenticator secret and QR data |
| 8 | POST | `/critical-vault/two-step/google/verify` | Check one app code |
| 9 | POST | `/critical-vault/two-step/email/send` | Email a setup code |
| 10 | POST | `/critical-vault/two-step/email/verify` | Check the setup code, get the token |

### 3.3 The unlock (access requests)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 11 | POST | `/critical-vault/credentials/{id}/access-requests` | Raise a request |
| 12 | GET | `/critical-vault/access-requests` | The request list (Access Request Management) |
| 13 | GET | `/critical-vault/access-requests/{id}` | One request |
| 14 | POST | `/critical-vault/access-requests/{id}/approve` | Approve the stage waiting now |
| 15 | POST | `/critical-vault/access-requests/{id}/reject` | Reject — ends the request |
| 16 | POST | `/critical-vault/access-requests/{id}/raise-manager` | The requester forwards to the manager |
| 17 | POST | `/critical-vault/access-requests/{id}/cancel` | The requester withdraws |
| 18 | POST | `/critical-vault/access-requests/{id}/send-otp` | Gmail method: email the unlock code |
| 19 | POST | `/critical-vault/access-requests/{id}/verify-otp` | Enter the 2-step code |
| 20 | POST | `/critical-vault/access-requests/{id}/lock` | Lock now |

### 3.4 Shared CredVault endpoints the page uses

| # | Method | Endpoint | Used by |
|---|---|---|---|
| 21 | GET | `/meta` | The page and the form |
| 22 | GET | `/credentials/{id}` | The unlock popup and the View drawer |
| 23 | POST | `/credentials/{id}/reveal` | Show / copy a secret |
| 24 | POST | `/credentials/{id}/events` | Drawer opened, Launch, a plain field copied |
| 25 | GET | `/credentials/{id}/activity` | The drawer's Activity tab |
| 26 | GET | `/credentials/{id}/attachments/{key}` | Open an attachment |
| 27 | GET | `/share-recipients` | The Share popup (7.7) |
| 28 | POST | `/credentials/{id}/shares` | Share from the drawer |

---

## 4. Critical Vault Credentials

### 4.1 GET `/critical-vault/credentials`

Any CredVault user. Ends every expired window first (`sweepUnlocks()`).

| Query parameter | Rules |
|---|---|
| `tab` | `all` \| `mine` \| `team` \| `shared` \| `others` — the page uses `all`, `mine` and `others` (*Teams Critical Credentials*) |
| `q` | ≤ 100 characters — matches code, name, username, URL, category, type, risk, strength and owner name |
| `page`, `per_page` | Integers; `per_page` 1–100, default 10 |
| `type`, `group`, `risk`, `department_id`, `member_id`, `member_employee_id` | Optional narrowing filters. A bad member gives 404 *That person is not part of your company.* or 422 *This person has no CredVault login yet, so nothing is shared with them.* |

Rows are ordered by last update, newest first. Unlike the request list (6.3), **the `tabs` counts here follow `q`**.

**Who appears:** the caller's own credentials, ones shared with the caller, the credentials of people the caller is above, the team rules, and **every Critical Vault credential of the caller's branch**.

**200**

```json
{
  "status": true,
  "data": [
    {
      "id": 41, "code": "CCRD-0007", "critical_code": "CCRD-0007", "vault": "critical",
      "type": "bank", "type_label": "Bank Account", "category_group": "Finance & Banking",
      "name": "Treasury Current Account", "url": null, "username": "•••• 4410", "scope": "team",
      "owner": { "id": 12, "name": "Meera Joshi", "initials": "MJ", "is_me": false },
      "department": { "id": 7, "name": "Accounts" },
      "risk": "critical", "strength": "Strong", "strength_level": 4, "has_password": true, "twofa": "yes",
      "two_step": { "method": "google", "label": "Authenticator", "linked": true, "sent_to": null },
      "rotation_days": 90, "next_rotation_due": "2027-01-20T09:14:00+00:00", "rotation_state": "ok",
      "protected": true, "lock_steps": ["admin", "manager", "otp"],
      "access": { "permission": "view", "via": "branch_critical", "shared_by": [] },
      "can": { "reveal": true, "copy": false, "edit": false, "share": false, "delete": false, "remove": false, "edit_protection": false },
      "unlock": {
        "state": "pending", "label": "Vault Admin · Rohan Desai", "stage": "admin", "needs_forward": false,
        "waiting_for": { "name": "Rohan Desai", "role": "Vault Admin" },
        "step": { "number": 1, "of": 3 }, "request_id": 88, "code": "REQ-0031"
      },
      "active_shares": 0,
      "created_at": "2026-10-22T09:14:00+00:00", "updated_at": "2026-10-22T09:14:00+00:00"
    }
  ],
  "tabs": { "all": 9, "mine": 3, "team": 2, "shared": 0, "others": 6, "sharedby": 0 },
  "member": null,
  "meta": { "current_page": 1, "per_page": 10, "total": 9, "last_page": 1 }
}
```

### 4.2 The `unlock` object — the Access Status column

| `state` | Extra keys | Meaning | The list shows |
|---|---|---|---|
| `locked` | `label: "Approval needed"` | No open request | **Locked** · *Approval needed* |
| `pending` | `stage`, `needs_forward`, `waiting_for`, `step`, `request_id`, `code` | Waiting for an approver; with `needs_forward: true` the label is *"Forward to ‹manager›"* | **Pending** · the role and name |
| `progress` | The same keys, `stage: "otp"`, label *"Step n of m · Authenticator"* | Approvals done; the code is left | **In progress** |
| `open` (window) | `label: "Unlocked"`, `request_id`, `expires_at`, `seconds_left`, `total_seconds` | Inside the caller's window | **Unlocked** · *mm:ss left* |
| `open` (direct) | `label: "Open — Vault Admin"`, **no `request_id`** | The caller is the Vault Admin of this credential's branch | **Vault Admin** · *Full access · no approval* |

> **Common misunderstanding.** "`state: open` means anyone can read it." It means open **for this caller**. Tell the two `open` cases apart by `request_id`: with one it is a time-limited window; without one it is the Vault Admin's direct access.

### 4.3 GET `/critical-vault/credentials/next-code`

**200**

```json
{ "status": true, "data": { "vault": "critical", "next_code": "CCRD-0010", "preview": true } }
```

Nothing is reserved; the real code is allocated under a lock when the credential is saved.

### 4.4 POST `/critical-vault/credentials`

JSON, or `multipart/form-data` when files are attached. The type's fields as in My Vault, plus:

| Field | Rules |
|---|---|
| `type` | Required; one of the 25 type keys |
| `name` | Required; 2–150 characters; unique per owner + type (case-insensitive) |
| `risk` | Optional; `low` \| `medium` \| `high` \| `critical`, default `critical` |
| `scope`, `department_id` | `personal` (default) \| `team` + a department the caller may use |
| `fields` | Object of the type's fields; the required ones must be present |
| `lock_admin`, `lock_manager`, `lock_otp` | Booleans; **at least two** `true`; each defaults to `true` on create. On a type with its own 2FA switch (`twofa` / `fields.twofa`, `yes` / `no`, default off) `lock_otp` follows that switch |
| `twofa_method` | `google` \| `email` — required when the 2-step step is on; taken as `google` when `totp_secret` is sent; kept from the stored method on Edit |
| `totp_secret` + `totp_code` | Authenticator: the secret from 5.1 (`^[A-Z2-7]{16,128}$`) and a current 6-digit code |
| `twofa_email` + `email_otp_token` | Gmail: the inbox (≤ 191) and the 40-character token from 5.4 |
| `notes`, `reg_email`, `reg_phone`, `recovery_key`, `rotation_days`, `files[*]`, `attachments[*]` | As in My Vault |

**Request**

```json
{
  "type": "server", "name": "Core Banking Jump Host", "risk": "high", "scope": "team", "department_id": 7,
  "fields": { "host": "10.0.4.20", "username": "opsadmin", "password": "Gx7#pQ2!vL9m" },
  "lock_admin": true, "lock_manager": true, "lock_otp": true,
  "twofa_method": "google", "totp_secret": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", "totp_code": "482913"
}
```

**201** — `message` *"“Core Banking Jump Host” saved to Critical Vault as CCRD-0010."*; `data` = the detail object (7.2).

| Error | Status | Field | Message |
|---|---|---|---|
| Fewer than two steps | 422 | `lock_admin` | `Turn on at least two protection steps for a critical credential.` |
| No 2-step method | 422 | `twofa_method` | `Choose how the 2-step code is received: Google Authenticator or email.` |
| Wrong app code | 422 | `totp_code` | `That code is incorrect or expired. Check your app and try again.` |
| App not linked | 422 | `totp_code` | `Scan the QR code and verify a code to link your authenticator app, or turn 2-step off.` |
| No inbox | 422 | `twofa_email` | `Enter the email address the 2-step codes go to.` |
| Token not verified | 422 | `email_otp_code` | `Verify the code sent to ab•••@example.com first — or send a new one.` |
| Gmail not linked | 422 | `email_otp_code` | `Send a code to ab•••@example.com and verify it to link email 2-step, or turn 2-step off.` |
| Token used up meanwhile | 422 | `email_otp_code` | `The email code has expired. Send a new code and verify it again.` |
| Duplicate name | 422 | `name` | `There is already a Server named “Core Banking Jump Host” in this vault.` |
| Password too weak | 422 | `fields.<secret>` | `… requires a Good or stronger password — use the generate button.` (start of the message trimmed) |
| Unknown / missing type field | 422 | `fields.<key>` | `“key” is not a field of a ‹Type› credential.` / `Enter the ‹Label›.` / `Select the ‹Label›.` / `Upload the ‹Label›.` |

### 4.5 PUT / POST `/critical-vault/credentials/{id}`

The same body; fields left out keep their stored value. Needs **Full** access.

| Error | Status | Message |
|---|---|---|
| Below Full | 403 | `Only the owner, a Vault Admin or someone with Full Access can edit this credential.` |
| Not the owner or the Vault Admin, and a guarded value changes | 403 | `Only the owner or a Vault Admin can change the ‹what›.` |
| Type change | 422 (`type`) | `The type of a credential cannot be changed — add a new one instead.` |
| In My Vault | 404 | `This credential is in the Normal Vault (My Vault) — open it there.` |

‹what› is one of: `2-step verification`, `2-step method`, `2-step email`, `risk level`, `two-factor setting`, `vault`, `team`, `protection steps`, `approvers`.

**200** — `message` *"Credential updated."* (or *"‹n› health issues resolved"*); `data` = the detail object + `health { resolved[], still_open[] }`. A changed `risk` keeps the credential in the Critical Vault with the same CCRD- code.

### 4.6 DELETE `/critical-vault/credentials/{id}`

**200**

```json
{
  "status": true,
  "message": "“Core Banking Jump Host” moved to the Recycle Bin. It can be restored for 30 days — by the Branch Admin.",
  "data": { "id": 52, "vault": "critical", "purges_at": "2026-12-12T10:02:11+00:00" }
}
```

Every open request on the credential is set to `cancelled`.

| Error | Status | Message |
|---|---|---|
| Below Full | 403 | `Only the owner, a Vault Admin or someone with Full Access can delete this credential.` |
| Full, but not the owner or the Vault Admin | 403 | `A critical credential can only be moved to the bin by its owner, a Vault Admin or the Branch Admin.` |
| Reached only through a team share | 409 | `This credential is shared with your whole team. Ask the owner to remove the team share.` |

> **Explanation.** A credential reached through a **personal** share is not binned: the caller's own share ends instead (`data.removed_share: true`, message *"‹name› removed from your vault. The owner's copy is unchanged."*).

### 4.7 GET `/critical-vault/approvers`

Who would approve **the caller's** requests.

**200**

```json
{
  "status": true,
  "data": {
    "admins": [ { "id": 21, "name": "Rohan Desai", "designation": "Branch Manager", "initials": "RD", "role": "Vault Admin" } ],
    "managers": [ { "id": 34, "name": "Kavya Rao", "designation": "Finance Lead", "initials": "KR", "role": "Your reporting manager" } ],
    "defaults": { "admin_user_id": 21, "admin_label": "Rohan Desai", "manager_user_id": 34, "manager_label": "Kavya Rao" }
  }
}
```

| Key | Meaning |
|---|---|
| `admins` | The Vault Admin(s) of the caller's branch |
| Note | The Critical Vault screens do not call this endpoint — the form and the unlock popup read `unlock_plan` (7.2). It is kept for integrations; `q` is accepted and ignored |
| `managers` | The caller's own reporting manager (empty when none is set) |
| `defaults.admin_label` | The single Vault Admin; *"Any Branch Admin"* when there are several; *"No Branch Admin set for your branch"* when there is none |
| `defaults.manager_label` | The manager's name, else *"The requester’s reporting manager"* |

---

## 5. 2-Step Setup

These calls run in the Add / Edit form **before** the save; none of them stores anything on a credential.

### 5.1 POST `/critical-vault/two-step/google/new`

| Field | Rules |
|---|---|
| `label` | ≤ 100; default *"‹code› · ‹name›"* of `credential_id`, else *CredVault* |
| `credential_id` | Optional; resolved inside the caller's company |

**200**

```json
{
  "status": true,
  "data": {
    "method": "google", "credential_id": null, "credential_code": null, "label": "Core Banking Jump Host",
    "secret": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
    "secret_display": "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP",
    "otpauth_uri": "otpauth://totp/Kryptone%3ACore%20Banking%20Jump%20Host?secret=JBSW…&issuer=Kryptone&algorithm=SHA1&digits=6&period=30",
    "qr_image": "data:image/svg+xml;base64,PHN2Zy…",
    "digits": 6, "period": 30,
    "works_with": "Google Authenticator, Microsoft Authenticator, Authy and any TOTP app"
  }
}
```

The form draws its own QR code from `otpauth_uri`.

### 5.2 POST `/critical-vault/two-step/google/verify` · 10 / minute

Body `{ "secret": "…", "code": "482913" }`. **200** — `message` *"Code verified — save the credential to link the app."*, `data { method: "google", verified: true }`.

| Error | Status | Field | Message |
|---|---|---|---|
| Bad secret | 422 | `secret` | `The setup key is not valid — get a new one and scan it again.` |
| Not 6 digits | 422 | `code` | `Enter the 6-digit code shown in your authenticator app.` |
| Wrong code | 422 | `code` | `That code is incorrect or expired. Check your app and try again.` |

### 5.3 POST `/critical-vault/two-step/email/send`

Body `{ "email"?: "…", "label"?: "…" }` (`email` ≤ 191, `label` ≤ 150).

**200**

```json
{
  "status": true, "message": "Code sent to ab•••@example.com.",
  "data": { "method": "email", "token": "<40-character token>", "sent_to": "ab•••@example.com", "expires_in": 600, "resend_in": 30 }
}
```

### 5.4 POST `/critical-vault/two-step/email/verify` · 10 / minute

Body `{ "token": "<40 characters>", "code": "123456" }`. An already-verified token answers 200 again. **200** — `message` *"Email verified — save the credential to link it."*, `data { method, verified: true, token, email, sent_to }`. Send the same `token` as `email_otp_token` on the save; it works once.

| Error | Status | Field | Message |
|---|---|---|---|
| Not 6 digits | 422 | `code` | `Enter the 6-digit code from the email.` |
| Token unknown, another user's, or expired | 410 | `email_otp_code` | `This code has expired. Send a new one.` |
| Wrong code (tries 1–4) | 422 | `email_otp_code` | `Incorrect code. 4 attempts left.` … `Incorrect code. 1 attempt left.` |
| 5th wrong code | 423 | `email_otp_code` | `Too many wrong codes. Send a new code.` |

### 5.5 Email send limits (5.3 and 6.8)

| Case | Status | Message |
|---|---|---|
| Within 30 seconds of the last send — per inbox for setup sends, per request for unlock sends | 429 | `A code was just sent. Wait 30 seconds before asking for another.` |
| More than 10 sends in an hour — per person, setup and unlock sends together | 429 | `Too many codes sent in the last hour. Try again later.` |
| Platform email switched off | 503 | `Email is turned off by the platform admin, so an email code cannot be sent. Use the authenticator app instead.` |
| The mail server failed | 502 | `The code could not be emailed. Please try again.` |

---

## 6. The Unlock — Access Requests

### 6.1 The request object

Every endpoint in this section returns it in `data` — except `send-otp` (`data { sent_to, expires_in, resend_in }`) and the list (an array of them).

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
    "department": "Accounts", "role_line": "Accounts Executive · Accounts", "is_me": true
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
  "can": { "approve": false, "reject": false, "cancel": true, "verify_otp": false, "send_otp": false, "lock": false },
  "created_at": "2026-11-12T08:40:05+00:00"
}
```

| Key | Values |
|---|---|
| `admin` / `manager` / `otp` | `null` when that step is not on the request |
| `manager.status` | `pending` \| `approved` \| `rejected`, or `after_admin` (not forwarded yet), or `not_required` (the Vault Admin rejected) |
| `status` | `pending` \| `approved` (waiting for the code) \| `unlocked` \| `locked` \| `rejected` \| `cancelled` |
| `display_status` | `pending` \| `approved` \| `rejected` \| `cancelled` \| `reset` (locked by 3 wrong codes) |
| `locked_reason` | `expired` \| `manual` \| `otp_failed` |
| `status_label` | e.g. *"Step 2 of 2 · Reporting Manager"*, *"Approved · enter the authenticator code"*, *"Unlocked"*, *"Rejected by Vault Admin"*, *"Cancelled by requester"*, *"Too many wrong codes — request again"* |
| `can.approve` / `can.reject` | The request is pending, the caller is not the requester, and the caller may act on the current stage. At the manager stage it is already `true` for the named manager **before** the forward — check `manager.status === "pending"` before showing the buttons (the server answers 409 until then) |
| `can.cancel` | The caller is the requester and the request is `pending` or `approved` |
| `can.lock` | A live window, and the caller is the requester or the Vault Admin |

### 6.2 POST `/critical-vault/credentials/{id}/access-requests`

Anyone with **View** access or higher on the credential. The steps are copied onto the request now.

| Field | Rules |
|---|---|
| `reason` | ≤ 300. **Required, at least 10 characters, when the Vault Admin step is on**; otherwise optional |
| `duration_minutes` | `5` \| `15` \| `30` \| `60`. Required with the Vault Admin step; otherwise always **5** |

**Request**

```json
{ "reason": "Month-end vendor payment run for October", "duration_minutes": 15 }
```

**201** — `message` *"Request REQ-0031 raised."*, `data` = 6.1. It starts `pending`; without a Vault Admin step it goes straight to the manager (`manager.status = pending`).

The checks run in this order; the first that fails is the answer.

| # | Check | Status | Field | Message |
|---|---|---|---|---|
| 0 | Body validation — `reason` ≤ 300, `duration_minutes` ∈ 5 / 15 / 30 / 60 (runs before everything) | 422 | the field | Laravel's message, e.g. *The selected duration minutes is invalid.* |
| 1 | Not found / in My Vault | 404 | — | `Credential not found.` / `This credential is in the Normal Vault (My Vault) — open it there.` |
| 2 | Use Only | 403 | — | `Your access is Use Only — there is nothing for you to unlock on this credential.` |
| 3 | The caller is the Vault Admin of its branch | 409 | — | `You are the Vault Admin for this branch — open this credential directly.` |
| 4 | Reason too short | 422 | `reason` | `Please give a reason (at least 10 characters).` |
| 5 | No window | 422 | `duration_minutes` | `Choose how long you need access.` |
| 6 | 6 wrong codes in 24 h | 429 | — | `Too many wrong 2-step codes on this credential today. Try again tomorrow, or ask the owner to unlock it with you.` |
| 7 | 2-step method not linked | 409 | — | `2-step verification for this credential has not been linked yet. Ask the owner to link it first.` |
| 8 | No Vault Admin in the caller's branch | 409 | — | `Your branch has no Branch Admin (Vault Admin) to approve this. Ask your administrator to assign one.` |
| 9 | No reporting manager | 409 | — | `You have no reporting manager to approve this. Ask HR to set one, or the owner to change the protection steps.` |
| 10 | An open request already exists | 409 | — | `You already have an open request (REQ-0031) for this credential.` — **with `data` = that request** |
| 11 | Two requests at the same instant | 409 | — | `You already have an open request for this credential.` |

> **Explanation: check 10 returns the request.** The 409 carries the open request in `data`, so the popup can show where it stands instead of an error. The browser uses this to recover from a double click.

### 6.3 GET `/critical-vault/access-requests`

| Query parameter | Rules |
|---|---|
| `tab` | `all` \| `pending` \| `approved` \| `rejected` \| `mine` \| `to_me` |
| `q`, `page`, `per_page` | As in 4.1 |

| Tab | Holds |
|---|---|
| `pending` | Status `pending` |
| `approved` | `approved`, `unlocked` or `locked`, except locked by `otp_failed` |
| `rejected` | Status `rejected` |
| `mine` | Raised by the caller |
| `to_me` | Pending, not the caller's own, and waiting on the caller: a Vault Admin stage that names them, or a forwarded manager stage that names them (excluding requests they already approved as Vault Admin) |
| `all` | Everything visible — the only tab, with `mine`, that shows cancelled requests |

Search matches the request code, the reason, the credential's name / code / category / type, people's names, the requester's department and the window (*15 min*, *1 hour*). `per_page` defaults to 10.

| Caller | Sees |
|---|---|
| The Vault Admin | Requests raised in their branch, plus their own |
| Anyone else | Requests they raised, and requests that name them as an approver |

Response `{ status, data: [request…], tabs, meta }`; the `tabs` counts ignore `q`. The screen itself is documented with Access Request Management.

### 6.4 GET `/critical-vault/access-requests/{id}`

Visible to the requester, the named Vault Admin and manager, and the Vault Admin of the request's branch; anyone else gets **404** *"Access request not found."*

### 6.5 POST `/approve` and `/reject`

Body `{ "note"?: "…" }` (≤ 300). A rejection without a note stores *"Not approved at this time"*.

| Check | Status | Message |
|---|---|---|
| Not pending | 409 | `This request is no longer waiting for approval.` |
| The caller raised it | 403 | `You cannot decide your own request.` |
| Vault Admin stage, the caller may not decide it | 403 | `This request is waiting for Rohan Desai.` (or *the Branch Admin*) |
| Manager stage, not forwarded yet | 409 | `This request has not been forwarded to the reporting manager yet.` |
| Manager stage, the caller is not the manager | 403 | `This request is waiting for Kavya Rao.` |
| No approval stage left | 409 | `This request has no approval waiting.` |

**200** — `message` *"Approved."* / *"Rejected."*

| After an approval, the next stage is | Result |
|---|---|
| `manager` | Stays `pending`; the **requester** is told to forward it (6.6) |
| `otp` | `status = approved`; the requester is told to enter the code |
| none | `status = unlocked`, with `expires_at` |

A rejection sets `status = rejected` and notifies the requester.

### 6.6 POST `/raise-manager`

No body. **200** — `message` *"Forwarded to the reporting manager."*; `manager.status` becomes `pending` and the manager is notified.

| Check | Status | Message |
|---|---|---|
| Not the requester | 403 | `Only the person who raised the request can forward it.` |
| Not pending | 409 | `This request is no longer open.` |
| No manager step | 409 | `This request has no reporting-manager step.` |
| The Vault Admin has not approved | 409 | `The Vault Admin has not approved this yet.` |
| The manager already approved | 409 | `The reporting manager has already approved this.` |
| Already forwarded | 409 | `This request is already with the reporting manager.` |

### 6.7 POST `/cancel`

No body. Only the requester, only while `pending` or `approved`. **200** — *"Request cancelled."*

| Check | Status | Message |
|---|---|---|
| Not the requester | 403 | `Only the person who raised a request can cancel it.` |
| Not open | 409 | `This request is no longer open.` |

### 6.8 POST `/send-otp`

Gmail method only. **200** — `message` *"Code sent to ab•••@example.com."*, `data { sent_to, expires_in: 600, resend_in: 30 }`. A new send replaces the old code.

| Check | Status | Message |
|---|---|---|
| Not the requester | 403 | `Only the person who raised the request can ask for its code.` |
| Not at the code stage | 409 | `This request is not waiting for a 2-step code.` |
| The method is not a linked email method (authenticator, unlinked, or the credential is gone) | 409 | `This credential uses the authenticator app — enter the code it shows.` |

Plus the send limits in 5.5.

### 6.9 POST `/verify-otp` · 10 / minute

Body `{ "code": "482913" }`. **200** — `message` *"Unlocked for 15 min."*, `data` = the request with `status: "unlocked"`, `expires_at`, `seconds_left`.

| Check | Status | Field | Message |
|---|---|---|---|
| Not 6 digits | 422 | `code` | `Enter the 6-digit code.` |
| Not the requester | 403 | — | `Only the person who raised the request can enter its code.` |
| Not at the code stage | 409 | — | `This request is not waiting for a 2-step code.` |
| Method no longer linked | 409 | — | `2-step verification for this credential is no longer linked.` |
| Gmail, no live code (no try used) | 409 | `code` | `No live email code for this request. Press “Send code” to get one.` |
| App code used twice (no try used) | 422 | `code` | `That code was just used. Wait for the next code in your authenticator app.` |
| Wrong code, tries left | 422 | `code` | `Incorrect or expired code. 2 attempts left.` |
| 3rd wrong code | **423** | `code` | `Too many wrong codes — the approvals were reset. Request access again.` |

> **Worth testing.** After the 423, the request is `locked` with `locked_reason: otp_failed`, and a new request starts again from the Vault Admin stage.

### 6.10 POST `/lock`

No body. The requester or the Vault Admin, only while `status = unlocked`. **200** — *"Locked."*

| Check | Status | Message |
|---|---|---|
| Neither the requester nor the Vault Admin | 403 | `Only the requester or a Vault Admin can lock this.` |
| Not unlocked | 409 | `This credential is not unlocked.` |

---

## 7. Shared Endpoints

### 7.1 GET `/meta`

The keys the Critical Vault reads:

```json
{
  "status": true,
  "data": {
    "vaults": [ { "key": "critical", "label": "Critical Vault", "prefix": "CCRD", "risks": ["low", "medium", "high", "critical"], "two_step": "enforced" } ],
    "risks": [ { "key": "low", "label": "Low" }, { "key": "medium", "label": "Medium" }, { "key": "high", "label": "High" }, { "key": "critical", "label": "Critical — needs approval to view" } ],
    "two_step_methods": [
      { "key": "google", "label": "Google Authenticator", "description": "A 6-digit code from Google / Microsoft Authenticator or Authy" },
      { "key": "email", "label": "Email code", "description": "A 6-digit code sent by email", "default_email": "otp@example.com" }
    ],
    "unlock_durations": [5, 15, 30, 60],
    "me": { "id": 57, "name": "Arjun Patil", "is_vault_admin": false, "department_id": 7, "manager_user_id": 34 }
  }
}
```

`me.is_vault_admin` is true for the Vault Admin (Branch User). `types`, `groups`, `permissions` and the rest are also returned.

### 7.2 GET `/credentials/{id}`

The row (4.1) plus `locked`, `updated_by`, and:

| Key | When |
|---|---|
| `unlock_plan` | Always: `steps[] { step, key, label, approver, ready }`, `of`, `durations`, `asks_reason`, `default_minutes` (15 with the Vault Admin step, else 5), `otp_method`, `otp_sent_to` |
| `last_request` | The caller's latest request on it (any status), or `null` |
| `fields`, `recovery`, `notes`, `attachments`, `all_values`, `has_notes` | Only when open for the caller — the Vault Admin, or a live window. With View or higher every value is **in plain text** (`masked: false`); with Use Only, secret fields come back `value: null, masked: true` and there are no `notes`, `all_values` or recovery key |
| `shares`, `protection` | Full access only; `protection { admin, admin_user, manager, manager_user, otp, otp_linked, otp_method, otp_email }` |
| `unlock_plan.steps[].approver` | `{ id, name, initials, role }`; with no Vault Admin in the branch the admin step shows `{ id: null, name: "Any Vault Admin", initials: "VA" }`. `ready` is false only for a manager step with no manager |

A locked credential returns `locked: true` and none of its field values.

### 7.3 POST `/credentials/{id}/reveal` · 60 / minute

Body `{ "action": "reveal" | "copy", "field"?: "<key>" | "recovery_key" }` — `field` defaults to the type's main secret.

**200**

```json
{ "status": true, "data": { "field": "password", "label": "Password", "value": "<the secret>", "hide_after_seconds": 30, "clear_clipboard_after": 30 } }
```

| Check | Status | Message |
|---|---|---|
| Use Only | 403 | `Your access is Use Only — you can sign in with this credential, but not see its secret.` |
| Copy with View only | 403 (`action`) | `Your access lets you view this credential but not copy it.` |
| Locked | **423** + `code: "locked"` | `This credential is locked. Request access and complete every unlock step first.` |
| Not a secret field | 422 (`field`) | `That is not a secret field of this credential.` |
| Nothing stored | 404 (`field`) | `No Password is stored on this credential.` |

Recorded as `reveal` / `copy` at critical severity; the owner is notified when someone else does it.

### 7.4 POST `/credentials/{id}/events`

Records the drawer opening, a Launch, or a plain (non-secret) field copied. **201** *"Recorded."*

| Field | Rules |
|---|---|
| `action` | Required: `view` \| `launch` \| `copy` |
| `field` | Required when `action = copy`; ≤ 40 characters |

| Error | Status | Field | Message |
|---|---|---|---|
| Launch with no website | 422 | `action` | `This credential has no website to launch.` |
| Unknown field | 422 | `field` | `That is not a field of this credential.` |
| A secret field | 422 | `field` | `Copy a secret through /reveal.` |

A `copy` is recorded as `view` (*‹Field› copied*). There is no lock check, so it works on a locked credential too.

### 7.5 GET `/credentials/{id}/activity`

`page`, `per_page` (≤ 100, default 50). The credential's history, newest first: `{ status, data: [event…], meta }`.

```json
{
  "id": 913, "event_id": "EVT-913", "at": "2026-11-12T08:52:10+00:00", "date": "12 Nov 2026", "time": "02:22 PM",
  "actor": { "id": 57, "name": "You", "full_name": "Arjun Patil", "initials": "AP", "role": "Accounts Executive · Accounts", "is_me": true },
  "action": "unlock", "label": "Unlocked", "verb": "unlocked", "severity": "warning", "severity_label": "Warning",
  "credential": { "id": 41, "code": "CCRD-0007", "name": "Treasury Current Account", "risk": "critical", "type": "bank", "vault": "critical" },
  "sentence": "You unlocked Treasury Current Account", "module": "Critical Vault",
  "detail": "Unlocked for 15 min after all checks passed", "ip": "10.0.0.14"
}
```

Old *"All stored values returned by the detail API"* reveal rows are hidden. There is no lock or rank check: any access, even Use Only on a locked credential, can read the history.

### 7.6 GET `/credentials/{id}/attachments/{key}`

Downloads one file. Needs View access **and** the credential open for the caller. Recorded as *Attachment opened: ‹file name›*.

| Check | Status | Message |
|---|---|---|
| Use Only | 403 | `Your access is Use Only — attachments are not included.` |
| Locked | 423 | `This credential is locked. Request access and complete every unlock step first.` |
| Unknown key | 404 | `That attachment does not exist.` |
| File gone | 404 | `The file is missing from storage.` |

### 7.7 GET `/share-recipients`

`q` (≤ 100). Returns `data { users: [{ id, name, email, designation, user_type }], teams: [{ id, name, members }] }` — active users of the caller's branch (not the caller, at most 200) and departments with at least one member.

### 7.8 POST `/credentials/{id}/shares`

Full access. **201** for a new share, **200** when the same recipient's live share is updated.

| Field | Rules |
|---|---|
| `recipient_type` | Required: `user` \| `team` |
| `recipient_id` | Required, integer |
| `permission` | Required: `use` \| `view` \| `copy` \| `full` |
| `duration_days` | `1` \| `7` \| `30` \| `90`; not together with `expires_at` |
| `expires_at` | `Y-m-d`, today or later |
| `reason` | ≤ 500 |

`message` *"Shared with ‹name›."* / *"Share updated for ‹name›."*, plus *"It ends on dd/mm/yyyy, when your own access does."* when the end was capped, plus *"Email sent to ‹n› person(s)."*. `data` = the share row (`id`, `credential`, `recipient`, `permission`, `permission_label`, `expires_at`, `expires { date, left }`, `state`, `status_label`, …) and `mail { status, recipients, sent, failed, copy_to }`.

| Error | Status | Field | Message |
|---|---|---|---|
| Below Full | 403 | — | `Only the owner or someone with Full Access can share this credential.` |
| Full Access on a Critical Vault credential | 422 | `permission` | `A critical credential cannot be shared with Full Access.` |
| No end date on a Critical Vault credential | 422 | `expires_at` | `A critical credential must be shared with an end date.` |
| Unknown or inactive person | 404 | `recipient_id` | `That person is not an active user of your company.` |
| Unknown team | 404 | `recipient_id` | `That team does not exist.` |
| The owner | 422 | `recipient_id` | `That person owns this credential already.` |
| Yourself | 422 | `recipient_id` | `You cannot share a credential with yourself.` |
| Another branch | 422 | `recipient_id` | `‹name› is not in your branch. Share only with people in your branch.` |
| Back to the person who shared it with you | 422 | `recipient_id` | `‹name› shared this credential with you — it can't be shared back to them.` |
| Two shares at the same instant | 409 | — | `This credential was just shared with ‹name›. Refresh and try again.` |

A share sets how much the recipient may do; the recipient still raises an access request to open it.

---

## 8. Error Catalogue

| HTTP | Used for |
|---|---|
| 401 | No / bad token; account no longer active |
| 403 | Module permission, access too low, not the requester, not the approver, a protection change by someone else |
| 404 | Out of the company or out of reach; in My Vault; a request not visible to the caller |
| 409 | State conflicts: Vault Admin opens directly, already open, not forwarded, not waiting, method not linked, no approver |
| 410 | Email setup token expired or unknown |
| 422 | Validation and field refusals; a wrong code with tries left |
| 423 | Reveal or attachment on a locked credential; the 3rd wrong unlock code; the 5th wrong setup code |
| 429 | Rate limits; 6 wrong codes a day; the email send gap and hourly cap |
| 500 | Unexpected failure inside a transaction — nothing saved |
| 502 / 503 | The email code could not be sent / platform email switched off |

---

## 9. Quick Reference — Screen Action → API Call

| Screen action | API call |
|---|---|
| Open the page / change tab / search / page | `GET /critical-vault/credentials?tab=&q=&page=&per_page=` |
| Add Critical Credential — code preview | `GET /critical-vault/credentials/next-code` |
| Link the authenticator app | `POST /critical-vault/two-step/google/new` → `POST …/google/verify` |
| Link Gmail | `POST /critical-vault/two-step/email/send` → `POST …/email/verify` |
| Save (Add / Edit) | `POST /critical-vault/credentials` · `PUT /critical-vault/credentials/{id}` |
| Move to Bin | `DELETE /critical-vault/credentials/{id}` |
| Click "Unlock credential" | `GET /credentials/{id}` (the unlock plan) |
| Send request to ‹approver› | `POST /critical-vault/credentials/{id}/access-requests` |
| Vault Admin / manager approves or rejects | `POST /critical-vault/access-requests/{id}/approve` · `/reject` |
| Send to ‹manager› | `POST /critical-vault/access-requests/{id}/raise-manager` |
| Cancel request | `POST /critical-vault/access-requests/{id}/cancel` |
| Send code / Resend code (Gmail) | `POST /critical-vault/access-requests/{id}/send-otp` |
| Verify & reveal | `POST /critical-vault/access-requests/{id}/verify-otp` |
| Show / hide, Copy a secret | `POST /credentials/{id}/reveal` |
| Lock now | `POST /critical-vault/access-requests/{id}/lock` |
| Full details (View drawer) | `GET /credentials/{id}` · `POST /credentials/{id}/events` · `GET /credentials/{id}/activity` |
| Open an attachment | `GET /credentials/{id}/attachments/{key}` |
| Share | `GET /share-recipients` · `POST /credentials/{id}/shares` |

---

## 10. Known Issues

| # | Issue | Effect |
|---|---|---|
| 1 | The stored status stays `unlocked` until a sweeping call runs (credential list, show, reveal, raise request, request list / detail); `approve`, `reject`, `raise-manager`, `cancel`, `send-otp`, `verify-otp` and `lock` do not sweep | The row's `unlock` and every secret already use `expires_at`, so an ended window opens nothing |
| 2 | `/lock` does not sweep first | An ended, unswept window can still be "locked now" and is stored with `locked_reason = manual` |
| 3 | The 6-wrong-codes cap is a rolling 24 hours over requests created in that time | It is not reset at midnight |
| 4 | `lock_admin_user_id` / `lock_manager_user_id` are accepted but always saved `null` | Sending a different value still counts as an "approvers" change for the 403 check |
| 5 | **Security:** `GET /credentials/{id}` returns every secret in plain text once open, without a `reveal` audit row | The unlock popup and the drawer show and copy secrets without `/reveal`: no 30-second clear, no owner alert, and View-rank viewers can copy |
| 6 | The duplicate-name check runs per owner + type across both vaults | The message says *"in this vault"* |
| 7 | Notifications are best-effort | A `200` does not prove a bell row was written |
| 8 | `GET /credentials/{id}/activity` has no lock or rank check | Use Only viewers can read the history of a locked credential |
| 9 | Email send counters are used before the mail is attempted | A 502 followed by an immediate retry returns 429 |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The Branch User (`user_type = branch_user`) of a branch |
| CCRD- / REQ- | Critical Vault credential codes / access request codes |
| Stage | The step a request waits on: `admin`, `manager`, `otp` |
| Forward | `raise-manager` — the requester sends an admin-approved request to the manager |
| Window | `duration_minutes` from `unlocked_at` to `expires_at` |
| `branch_critical` | The View access everyone in a branch has on its Critical Vault credentials |
| Direct opener | The Vault Admin of the credential's branch — `unlock.state = open` with no `request_id` |
| Envelope | The outer JSON shape: `status`, `message`, `data`, `errors` |
