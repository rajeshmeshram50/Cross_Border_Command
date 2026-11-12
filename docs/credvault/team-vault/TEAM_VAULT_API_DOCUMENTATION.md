# CredVault Team Vault — API Documentation

| | |
|---|---|
| **Jira** | GT-103 (parent GT-76 — CredVault Team Vault Documentation) |
| **Module** | CredVault → Vault Management → Team Vault |
| **Audience** | Frontend and backend developers, QA (API and Postman testing), integrators |
| **Companion documents** | Functional Documentation · Technical Documentation · Code Walkthrough |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document lists every API call the Team Vault page makes: what to send, what comes back, and every error with its exact message. Use it to build or test the page, or to call the endpoints from Postman. The response examples follow the real response builders (`row()`, `hierarchy()`, `shareRow()`, `exportPreview()`); the values are illustrative.

### 1.2 The API in one paragraph

The Team Vault has **six endpoints of its own** — the credential list, three hierarchy endpoints and two export endpoints — and **reuses ten shared CredVault endpoints** for the drawer, reveal, share, edit and bin. All of them live under `/api/credvault`, need a Sanctum token, and are scoped to the caller's company. A list row never carries a secret; secrets leave the server only through `reveal`, which is audited.

### 1.3 Key ideas to understand first

| Idea | What it means |
|---|---|
| Success envelope | `{ "status": true, "data": …, … }` |
| Refusal envelope | `{ "status": false, "message": "…", "errors"?: { "<field>": ["…"] } }` |
| 404 = no access | A credential the caller cannot reach answers *"Credential not found."* — the same as one that does not exist |
| `access` | The caller's `{ permission, via }` on a row: how much they may do, and why |
| `can` | Ready-made yes/no flags for the buttons: `reveal`, `copy`, `edit`, `share`, `delete`, `remove`, `edit_protection` |
| Vault Admin | The Branch User of a branch. Their rights cover **their own branch only**. |

---

## 2. Conventions

| Aspect | Value |
|---|---|
| Base path | `/api/credvault` |
| Auth | `Authorization: Bearer <sanctum_token>` on every route |
| Middleware | `auth:sanctum` → `user.active` → `tenant` → `throttle:credvault` (240 requests / minute / user) |
| Extra throttle | `POST /credentials/{id}/reveal` — `throttle:credvault-reveal` (60 / minute / user) |
| Module gate | The caller needs `can_view` on the module `credentials-vault` |
| Tenancy | Every query is scoped to the caller's `client_id`; nothing is taken from the body |
| Branch | Axios adds `?branch_id=` on GETs; these endpoints **ignore it**. The Vault Admin is narrowed by their own `users.branch_id` |
| Validation (Laravel) | `422` `{ "message": "…", "errors": { … } }` |

> **Explanation: why `branch_id` is ignored.** The branch a person may see comes from **who they are**, not from what the browser sends. Trusting a `branch_id` from the request would let anyone read another branch by changing one number.

---

## 3. Endpoint Index

### 3.1 Team Vault's own endpoints

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/normal-vault/credentials` | The list, tabs and person filter |
| 2 | GET | `/team/departments` | Admin card + department cards |
| 3 | GET | `/team/departments/{id}` | One department's hierarchy |
| 4 | GET | `/team/organisation` | Every department's hierarchy |
| 5 | GET | `/exports/preview` | Export popup counts |
| 6 | POST | `/exports` | CSV download |

### 3.2 Shared endpoints the page calls

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 7 | GET | `/credentials/{id}` | View drawer / form / share popup |
| 8 | POST | `/credentials/{id}/reveal` | Reveal or copy a secret |
| 9 | POST | `/credentials/{id}/events` | Drawer opened, site launched |
| 10 | GET | `/credentials/{id}/activity` | Drawer Activity tab |
| 11 | GET | `/share-recipients` | People and teams for the Share popup |
| 12 | POST | `/credentials/{id}/shares` | Share / renew |
| 13 | GET | `/credentials/{id}/attachments/{key}` | Open an attachment in the drawer |
| 14 | PUT / POST | `/normal-vault/credentials/{id}` | Edit (POST for multipart) |
| 15 | DELETE | `/normal-vault/credentials/{id}` | Move to Bin / Remove from your vault |
| 16 | GET | `/meta` | Types, permissions, share durations, bin days |

> **Explanation: what the page does not call.** Revoking a share (`DELETE /shares/{id}`) is done from **My Vault → Shared By Me**, not from the Team Vault. The Add-credential calls (`POST /normal-vault/credentials`, `GET …/next-code`) and the 2-step setup calls belong to My Vault and the Critical Vault; the Team Vault opens the form for **Edit** only.

---

## 4. The Credential List

### 4.1 GET `/normal-vault/credentials`

**Who can call:** anyone with the module. The vault is fixed to `normal`.

**Query parameters**

| Param | Rule | Notes |
|---|---|---|
| `tab` | `all` \| `mine` \| `team` \| `shared` \| `others` | Team Vault sends `team` or `mine`; default `all` |
| `q` | string ≤ 100 | ID, name, username, url, category, type label, risk word, strength word, owner name |
| `page` | int ≥ 1 | |
| `per_page` | int 1..100 | Default 10 |
| `department_id` | int ≥ 1 | Team side only — `mine` ignores it |
| `member_employee_id` | int ≥ 1 | A tree node (`employees.id`) |
| `member_id` | int ≥ 1 | A login (`users.id`) — alternative to the above |
| `risk`, `type`, `group` | enums | Not sent by Team Vault |

**Request**

```http
GET /api/credvault/normal-vault/credentials?tab=team&department_id=7&page=1&per_page=10
```

**Response — 200**

```json
{
  "status": true,
  "data": [
    {
      "id": 412,
      "code": "CRD-0042",
      "critical_code": null,
      "vault": "normal",
      "type": "login",
      "type_label": "Login",
      "category_group": "Logins & Access",
      "name": "GST Portal",
      "url": "https://www.gst.gov.in",
      "username": "acme_gst",
      "scope": "team",
      "owner": { "id": 58, "name": "Kiran Rao", "initials": "KR", "is_me": false },
      "department": { "id": 7, "name": "Accounts" },
      "risk": "high",
      "strength": "Good",
      "strength_level": 3,
      "has_password": true,
      "twofa": "no",
      "two_step": null,
      "rotation_days": 90,
      "next_rotation_due": "2027-01-20T09:12:00+00:00",
      "rotation_state": "ok",
      "protected": false,
      "lock_steps": [],
      "access": { "permission": "full", "via": "manager" },
      "can": { "reveal": true, "copy": true, "edit": true, "share": true, "delete": true, "remove": false, "edit_protection": false },
      "unlock": null,
      "active_shares": 2,
      "created_at": "2026-10-22T09:12:00+00:00",
      "updated_at": "2026-11-10T14:03:00+00:00"
    }
  ],
  "tabs": { "all": 18, "mine": 4, "team": 11, "shared": 3, "others": 14, "sharedby": 2 },
  "member": null,
  "meta": { "current_page": 1, "per_page": 10, "total": 11, "last_page": 2 }
}
```

With a person picked, `member` is `{ "id": 61, "name": "Asha Pillai", "designation": "Senior Executive" }`.

**Response fields worth knowing**

| Field | Notes |
|---|---|
| `access` | `null` when the caller has no rank on that row (see Known issue 2) |
| `access.via` | `owner` \| `branch` \| `manager` \| `hod` \| `team` \| `share` |
| `can.delete` | Full Access and not via `share` |
| `can.remove` | Via `share` — "Remove from your vault" |
| `can.edit_protection` | Via `owner`, or the Vault Admin (`branch`) |
| `tabs` | Every tab counted with the same search; `sharedby` = live shares on credentials the caller owns |

> **Common misunderstanding.** "`tab=team` should include what was shared with me." It does not: the team tab removes credentials shared with the caller. They come back under `tab=shared` (My Vault → Shared With Me). The exception: with a person picked (`member_id` / `member_employee_id`), `team` returns that person's set unchanged — including credentials shared with the caller, any scope.

**Errors**

| Status | When | Message |
|---|---|---|
| 404 | `member_employee_id` not an employee of the tenant | *That person is not part of your company.* (`errors.member_employee_id`) |
| 422 | The employee has no login | *This person has no CredVault login yet, so nothing is shared with them.* (`errors.member_employee_id`) |
| 404 | `member_id` not a user of the tenant | *That person is not part of your company.* (`errors.member_id`) |
| 422 | Bad `tab`, `per_page` > 100, etc. | Laravel validation |

---

## 5. The Team Hierarchy

### 5.1 GET `/team/departments`

**Who can call:** anyone with the module. The Vault Admin's counts cover their branch only.

| Query param | Rule |
|---|---|
| `q` | string ≤ 100 — department name or HOD name |

**Response — 200**

```json
{
  "status": true,
  "data": {
    "admin": {
      "admins": [ { "id": 2, "name": "Meera Iyer", "initials": "MI", "role": "Vault Administrator" } ],
      "members": 43,
      "departments": 6,
      "hods": 5,
      "levels": [
        { "level": "admin", "label": "Admin", "count": 1 },
        { "level": "hod", "label": "HOD", "count": 5 },
        { "level": "tl", "label": "Team Lead", "count": 8 },
        { "level": "emp", "label": "Employee", "count": 29 }
      ]
    },
    "departments": [
      {
        "id": 7,
        "name": "Accounts",
        "hod": { "id": 58, "name": "Kiran Rao", "initials": "KR", "role": "HOD" },
        "members": 9,
        "levels": [ { "level": "hod", "label": "HOD", "count": 1 }, { "level": "emp", "label": "Employee", "count": 8 } ],
        "credentials": 12,
        "critical_credentials": 0
      }
    ]
  }
}
```

| Rule | Detail |
|---|---|
| Departments listed | Tenant-own and platform-shared departments that have on-team employees **or** team credentials |
| `hod.id` | The login the head name resolves to; `null` when it matches nobody or more than one employee |
| `hod` | `null` when the department has no head name |
| `admin.admins` | The branch's Vault Admin(s) — the Branch User(s) |
| `admin.members` | Sum of every level count, including `admin` |
| `levels` | Only levels with a count > 0 |

### 5.2 GET `/team/departments/{id}`

**Response — 200**

```json
{
  "status": true,
  "data": {
    "department": { "id": 7, "name": "Accounts", "hod": { "id": 58, "name": "Kiran Rao", "initials": "KR", "role": "HOD" } },
    "stats": { "members": 9, "levels": 3, "teams": 1, "departments": 1, "hods": 1, "credentials": 12, "critical_credentials": 0 },
    "levels": [ { "level": "admin", "label": "Admin", "count": 1 }, { "level": "hod", "label": "HOD", "count": 1 }, { "level": "emp", "label": "Employee", "count": 8 } ],
    "members": [
      {
        "employee_id": 301,
        "user_id": 58,
        "name": "Kiran Rao",
        "initials": "KR",
        "designation": "Head of Department",
        "level": "hod",
        "level_label": "HOD",
        "department": { "id": 7, "name": "Accounts" },
        "manager_employee_id": null,
        "manager_user_id": null
      }
    ],
    "tree": {
      "type": "admin", "user_id": 2, "name": "Meera Iyer", "initials": "MI", "designation": "Vault Administrator",
      "level": "admin", "level_label": "Admin", "children_count": 1, "team_size": 9,
      "children": [
        { "type": "member", "employee_id": 301, "user_id": 58, "name": "Kiran Rao", "initials": "KR",
          "designation": "Head of Department", "level": "hod", "level_label": "HOD",
          "department": { "id": 7, "name": "Accounts" }, "children_count": 2, "team_size": 8, "children": [] }
      ]
    }
  }
}
```

| Field | Notes |
|---|---|
| `members[].manager_employee_id` | Set only when the manager is in the same returned set |
| `members[].user_id` | `employees.user_id`, else the login with the same `employee_code`; `null` = no login |
| `stats.levels` | Number of distinct levels **including** `admin` |
| `stats.teams` | Team Lead count |
| `tree` | The page builds its own tree from `members`; `tree` is not read by the frontend |

| Status | When | Message |
|---|---|---|
| 404 | Department not tenant-own or shared | *Department not found.* |

### 5.3 GET `/team/organisation`

Same shape as 5.2 with `"department": null`, every department's members, `stats.departments` = distinct departments among members, and `tree.children` = one `type: "department"` node per department (`department_id`, `name`, `initials`, `members`, `children_count`, `team_size`, `children`).

> **Explanation.** A scoped viewer (not the Vault Admin) calls this once and the page keeps only "me and everyone below me" from it — see Known issue 1.

---

## 6. Export

### 6.1 GET `/exports/preview`

| Query param | Rule |
|---|---|
| `tab` | `mine` \| `team` (or legacy `scope` `team` \| `personal` \| `mine`) |
| `department_id` | int ≥ 1 — team tab only |
| `vault`, `risk`, `type` | enums — not sent by Team Vault |
| `q` | string ≤ 100 — not sent by Team Vault |
| `groups[]` | distinct, each one of the 5 category groups |

**Response — 200**

```json
{
  "status": true,
  "data": {
    "tab": "team",
    "scope": "team",
    "filters": { "department_id": 7 },
    "total": 12,
    "selected": 12,
    "groups": [
      { "group": "Logins & Access", "count": 8, "selected": true },
      { "group": "Finance & Banking", "count": 3, "selected": true },
      { "group": "Development & IT", "count": 1, "selected": true },
      { "group": "Identity & Documents", "count": 0, "selected": true },
      { "group": "Personal & Lifestyle", "count": 0, "selected": true }
    ],
    "protected": 0,
    "tabs": { "mine": 4, "team": 12 },
    "columns": { "always": ["Sr. No", "Credential ID", "Created On", "Credential Name", "Website / App", "Type", "Category", "Username", "Owner", "Access", "Department", "Vault", "Risk", "Strength", "2FA", "Rotation (days)", "Last Updated"], "with_passwords": "Password / Secret", "with_notes": "Notes" }
  }
}
```

The popup hides groups with `count = 0`.

### 6.2 POST `/exports`

**Request**

```json
{
  "tab": "team",
  "department_id": 7,
  "groups": ["Logins & Access", "Finance & Banking"],
  "format": "csv",
  "include_notes": true,
  "include_passwords": true,
  "acknowledge": true,
  "account_password": "••••••••"
}
```

| Field | Rule |
|---|---|
| `tab` / `scope` | One of them is required |
| `format` | Required: `csv` \| `json` (the popup sends `csv`) |
| `include_notes` | Boolean, default `true` |
| `include_passwords` | Required boolean |
| `acknowledge` | Must be accepted when `include_passwords` is true |
| `account_password` | Required when `include_passwords` is true; checked against the login password |

**Response — 200:** the file (`text/csv; charset=UTF-8`), `Content-Disposition: attachment; filename="team-credentials-20261112.csv"` (`my-credentials-…` for `mine`), headers `X-CredVault-Code: EX-0007`, `X-CredVault-Count`, `X-CredVault-Withheld`, `Cache-Control: no-store`.

**Errors**

| Status | When | Message |
|---|---|---|
| 422 | No tick | *Confirm you understand the risk of exporting readable passwords.* (Laravel validation: `{ message, errors.acknowledge }`, no `status`) |
| 422 | No password | *Enter your account password to export readable passwords.* (Laravel validation: `errors.account_password`) |
| 422 | Wrong password | *Your account password is incorrect.* (`errors.account_password`) |
| 422 | Neither `tab` nor `scope` | *Choose what to export: tab mine (My Credentials) or team (Team Credentials).* (`errors.tab`). The preview, by contrast, falls back to `team` with no error |
| 422 | Nothing selected | *No credentials match this selection.* (`errors.groups`) |
| 500 | Transfer row failed | *Could not record the export. Nothing was saved — please try again.* |

> **Explanation.** A refused download comes back as a JSON blob, not a file. `cvApi.download()` reads it back into a `CvApiError`, so the popup can show the message.

---

## 7. Shared Credential Endpoints

### 7.1 GET `/credentials/{id}`

The detail: every `row()` field plus `locked`, `updated_by`, `fields[]`, `recovery`, `notes` (View+ only), `has_notes`, `attachments`, `all_values` (View+), and for Full Access `shares[]` and `protection`. Errors: 404 *Credential not found.*

### 7.2 POST `/credentials/{id}/reveal`

| Field | Rule |
|---|---|
| `action` | Required: `reveal` \| `copy` |
| `field` | Optional ≤ 40 — default the type's main secret; `recovery_key` allowed |

**Response — 200**

```json
{ "status": true, "data": { "field": "password", "label": "Password", "value": "Xq7#pL2v!mR9", "hide_after_seconds": 30, "clear_clipboard_after": 30 } }
```

| Status | When | Message |
|---|---|---|
| 403 | Use Only | *Your access is Use Only — you can sign in with this credential, but not see its secret.* |
| 403 | View but `copy` asked | *Your access lets you view this credential but not copy it.* (`errors.action`) |
| 423 | Protected and locked (Critical Vault only) | *This credential is locked. Request access and complete every unlock step first.* |
| 422 | Field not secret | *That is not a secret field of this credential.* (`errors.field`) |
| 404 | Empty | *No ‹Label› is stored on this credential.* (`errors.field`) |

The checks run in this order (after 404 *Credential not found.*).
| 429 | Over 60 / minute | Laravel throttle |

### 7.3 POST `/credentials/{id}/events`

`{ "action": "view" | "launch" | "copy", "field"? }` — `field` (≤ 40) is required when `action = copy` → **201** `{ "status": true, "message": "Recorded." }`. A `copy` is written to the log as action `view`.

| Status | When | Message |
|---|---|---|
| 422 | `launch` without a URL | *This credential has no website to launch.* (`errors.action`) |
| 422 | `field` is not a field of the type | *That is not a field of this credential.* (`errors.field`) |
| 422 | `field` is a secret | *Copy a secret through /reveal.* (`errors.field`) |

### 7.4 GET `/credentials/{id}/activity`

`page`, `per_page` ≤ 100 (default 50). Returns `{ status, data: AuditEvent[], meta }`, newest first.

### 7.5 GET `/share-recipients`

`q` ≤ 100. Returns `data.users` — up to 200 active users of the **caller's branch** (not the caller), searched by name / email, as `{ id, name, email, designation, user_type }` — and `data.teams` — the company's and platform departments with at least one Active employee, searched by name, as `{ id, name, members }` (`members` counts Active **employees**, not logins).

### 7.6 POST `/credentials/{id}/shares`

**Request**

```json
{ "recipient_type": "team", "recipient_id": 7, "permission": "copy", "duration_days": 7, "reason": "Month-end GST filing" }
```

| Field | Rule |
|---|---|
| `recipient_type` | Required: `user` \| `team` |
| `recipient_id` | Required int ≥ 1 |
| `permission` | Required: `use` \| `view` \| `copy` \| `full` |
| `duration_days` | `1` \| `7` \| `30` \| `90`; prohibits `expires_at` |
| `expires_at` | `Y-m-d`, today or later |
| `reason` | ≤ 500; **always required**, at least 5 characters after trimming |

**Response — 201** (new) / **200** (renewed)

```json
{
  "status": true,
  "message": "Shared with Accounts. Email sent to 8 people.",
  "data": {
    "id": 93,
    "credential": { "id": 412, "code": "CRD-0042", "vault": null, "name": "GST Portal", "type": "login", "type_label": "Login", "category_group": "Logins & Access", "risk": "high", "url": "https://www.gst.gov.in", "username": null, "created_on": null, "updated_at": "2026-11-10T14:03:00+00:00" },
    "recipient": { "type": "team", "id": 7, "name": "Accounts", "initials": "A", "members": 9, "sub": "Team · 9 members", "branch": null },
    "permission": "copy",
    "permission_label": "Copy",
    "reason": "Month-end GST filing",
    "shared_at": "2026-11-12T10:20:00+00:00",
    "shared_on": { "date": "12/11/2026", "time": "10:20" },
    "updated_at": "2026-11-12T10:20:00+00:00",
    "expires_at": "2026-11-19T10:20:00+00:00",
    "expires": { "date": "19/11/2026", "left": "7 days left" },
    "revoked_at": null,
    "state": "active",
    "status_label": "Active",
    "can": null,
    "mail": { "status": "sent", "recipients": 8, "sent": 8, "failed": 0, "copy_to": null }
  }
}
```

| Status | When | Message |
|---|---|---|
| 403 | Below Full Access | *Only the owner or someone with Full Access can share this credential.* |
| 422 | No end date — shares are capped at 30 days, so `duration_days` or `expires_at` must be sent | *Policy allows shares of up to 30 days — pick an end date.* (the server's wording) |
| 422 | End date more than 30 days from today — including `duration_days: 90`, which passes validation but is refused here | *Policy allows shares of up to 30 days.* (the server's wording) |
| 422 | Reason too short | *Give a reason for sharing (at least 5 characters).* |
| 404 | User not active / not in tenant | *That person is not an active user of your company.* |
| 422 | Recipient is the owner | *That person owns this credential already.* |
| 422 | Recipient is the caller | *You cannot share a credential with yourself.* |
| 404 | Department not found | *That team does not exist.* |
| 409 | Double-click race | *This credential was just shared with ‹name›. Refresh and try again.* |
| 422 | Recipient outside the caller's branch | *‹name› is not in your branch. Share only with people in your branch.* (`errors.recipient_id`) |
| 422 | Sharing back to the person who shared it with you | *‹name› shared this credential with you — it can't be shared back to them.* |
| 500 | Unexpected failure | *Could not share the credential. Nothing was saved — please try again.* |

A renewal answers **200** *Share updated for ‹name›.* `mail.status` is `sent`, `partly_sent`, `failed`, `no_recipients` or `mail_off`. `expires_at` ends at 23:59:59 of that day; `duration_days` counts from now.

> **Explanation.** When the sharer holds Full Access only through their own share, the message adds *"It ends on dd/mm/yyyy, when your own access does."* — a re-share can never outlive the re-sharer's access.

### 7.7 GET `/credentials/{id}/attachments/{key}`

**Who can call:** anyone with **View** access or above on the credential. Called by the **Open** button on an attachment in the drawer's Details tab.

| Param | Rule |
|---|---|
| `id` | The credential id (number) |
| `key` | The attachment's key from the detail response: `a-z`, `0-9`, `-`, 1–40 characters |

**Response — 200:** the file itself, as a download with its original file name. Every open is written to the Audit Log as *"Attachment opened: ‹file name›"*.

| Status | When | Message |
|---|---|---|
| 403 | Use Only access | *Your access is Use Only — attachments are not included.* |
| 423 | Locked (Critical Vault only) — checked before the key | *This credential is locked. …* |
| 404 | No such key on the credential | *That attachment does not exist.* |
| 404 | The file is gone from storage | *The file is missing from storage.* |
| 404 | No access at all | *Credential not found.* |

### 7.8 PUT / POST `/normal-vault/credentials/{id}`

Partial update; fields left out keep their value. Rules are `credentialRules(false)` (name 2..150, `scope` `personal|team`, `department_id`, `risk`, `rotation_days` 30/60/90/180, `notes` ≤ 5000, `fields`, attachments …).

| Status | When | Message |
|---|---|---|
| 404 | Not reachable | *Credential not found.* |
| 404 | A Critical Vault credential | *This credential is in the Critical Vault — open it there.* |
| 403 | Below Full Access | *Only the owner, a Vault Admin or someone with Full Access can edit this credential.* |
| 403 | Caller who is not the owner or the Vault Admin changes the scope | *Only the owner, a Vault Admin or the Branch Admin can change the vault.* |
| 403 | Same, changes the department | *Only the owner, a Vault Admin or the Branch Admin can change the team.* |
| 422 | `risk: critical` | *Critical credentials are added in the Critical Vault, where they get approvals and 2-step verification.* |
| 403 | Department not the caller's | *You can only add team credentials to your own department.* (`errors.department_id`) |
| 422 | No department on a team credential | *Pick the team (department) this credential belongs to.* (`errors.department_id`) |
| 404 | Unknown department | *That department does not exist.* (`errors.department_id`) |
| 422 | Duplicate name — checked per owner + type across **both** vaults | *There is already a ‹Type› named “‹name›” in this vault.* |
| 500 | Unexpected failure | *Could not update the credential. Nothing was saved — please try again.* |
| 422 | Type change | *The type of a credential cannot be changed — add a new one instead.* |

The checks run in the order listed. **Response — 200** `{ "status": true, "message": "Credential updated.", "data": { …detail…, "health": { "resolved": [], "still_open": [] } } }` — the message is *‹n› health issue(s) resolved* when the edit fixed Password Health issues.

### 7.9 DELETE `/normal-vault/credentials/{id}`

| Case | Response |
|---|---|
| Moved to bin | **200** *"“GST Portal” moved to the Recycle Bin. It can be restored for 30 days."*, `data` `{ id, vault, purges_at }` |
| Shared to the caller as a user | **200** *"“GST Portal” removed from your vault. The owner's copy is unchanged."*, `data` `{ id, removed_share: true }` |
| Shared only to the caller's team | **409** *This credential is shared with your whole team. Ask the owner to remove the team share.* |
| Below Full Access | **403** *Only the owner, a Vault Admin or someone with Full Access can delete this credential.* |
| A Critical Vault credential | **404** *This credential is in the Critical Vault — open it there.* |
| Unexpected failure | **500** *Could not move the credential to the bin. Nothing was saved — please try again.* |

The share-removal path runs **before** the Full Access check, so even a Use Only share recipient can remove a credential from their own vault. The day count is the credential's branch retention period, else 30.

---

## 8. Error Catalogue

| Status | Source | Typical message |
|---|---|---|
| 401 | Sanctum | *Unauthenticated.* |
| 401 | `user.active` | *Account is no longer active. Please sign in again.* (also deletes the caller's tokens) |
| 403 | `tenantUser` | *CredVault needs a company account — this login has no tenant.* |
| 403 | `tenantUser` | *You do not have access to Credentials Vault. Ask your admin to grant it in Permissions.* |
| 404 | `findCredential` | *Credential not found.* |
| 404 | `findInVault` | *This credential is in the Critical Vault — open it there.* |
| 409 | share / revoke / bin | Race or state conflicts (above) |
| 422 | `reject()` | `{status:false, message, errors:{field:[message]}}` |
| 422 | `validate()` | Laravel `{message, errors}` |
| 423 | `assertUnlocked` | `code: "locked"` — never for a Normal Vault row |
| 429 | throttles | 240 / 60 per minute |
| 500 | `inTransaction` | *Could not ‹action›. Nothing was saved — please try again.* |

---

## 9. Quick Reference — Screen Action → API Call

| Screen action | Call |
|---|---|
| Open the page | `GET /team/departments` + `GET /normal-vault/credentials?tab=team&page=1&per_page=10` (+ `GET /team/organisation` for a scoped viewer) |
| Open a department | `GET /team/departments/{id}` + the list with `department_id` |
| **View all** | `GET /team/organisation` |
| Pick a person | The list with `tab=team&member_employee_id=` |
| Switch tab / search / page | The list with `tab`, `q`, `page`, `per_page` |
| View | `GET /credentials/{id}` + `POST …/events {action:view}` + `GET …/activity` |
| Copy Password | `POST …/reveal {action:copy}` |
| Open an attachment (drawer) | `GET /credentials/{id}/attachments/{key}` |
| Edit | `GET /credentials/{id}` → `PUT /normal-vault/credentials/{id}` |
| Share | `GET /credentials/{id}` + `GET /share-recipients` → `POST …/shares` |
| Move to Bin | `DELETE /normal-vault/credentials/{id}` |
| Export | `GET /exports/preview?tab=&department_id=` → `POST /exports` |

---

## 10. Known Issues

| # | Issue | Effect |
|---|---|---|
| 1 | `/team/*` returns the whole organisation to any CredVault user; only the Vault Admin is narrowed to their branch | The "me and below" view is trimmed in `TeamDetails.tsx` only |
| 2 | `visibleQuery()` lists credentials of any scope owned by an overseen user, but `accessMap()` grants nothing on a personal credential | Those rows have `access` and `can` `null`, and `GET /credentials/{id}` on them returns 404 |
| 3 | When the caller oversees the picked person, the base query is the person's set | `tabs.mine` counts the caller's credentials inside that set, not the caller's real total |
| 4 | The export set has no vault filter, and its `team` rule is `scope = team` only | Critical Vault team credentials can be included (secrets withheld only while an unlock step guards them, or the caller is below Copy); overseen users' non-team credentials in the list are not exported |
| 5 | `X-CredVault-Count` is not in `Access-Control-Expose-Headers` (`Content-Disposition, X-CredVault-Code, X-CredVault-Withheld`) | Readable only same-origin |

Other notes:

- Share email copies go to `services.credvault.share_copy_email` when set.
- `/meta.share_durations` is always **1, 7 and 30 days** — *No expiry* and *90 days* are never offered, because shares are capped at 30 days.

---

## 11. Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The Branch User (`user_type = branch_user`), for their own branch |
| `access.via` | Why the caller has access: `owner`, `branch` (Vault Admin), `manager`, `hod`, `team`, `share` |
| Live share | A share that is neither revoked nor expired |
| Tree node | One person in the hierarchy; `employee_id` is what the person filter sends |
| Envelope | The outer JSON shape: `status`, `message`, `data`, `errors` |
