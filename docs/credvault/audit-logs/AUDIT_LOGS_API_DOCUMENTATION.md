# CredVault Audit Logs — API Documentation

| | |
|---|---|
| **Jira** | GT-117 (parent GT-85 — CredVault Audit Logs Documentation) |
| **Module** | CredVault → Vault Administration & Security → Audit Logs |
| **Audience** | Frontend and backend developers, QA automation, integrators |
| **Companion documents** | Functional Documentation · Technical Documentation · Code Walkthrough |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document lists every API call behind the Audit Logs page: what to send, what comes back, and every error with its exact message. Use it to build against the API, to write automated tests, or to understand a response seen in the browser. The examples follow the real response builders (`eventRow()`, `auditDayGroups()`); all names, ids and addresses are fake.

### 1.2 The API in one paragraph

Audit Logs has **two endpoints**: `GET /audit-logs`, which returns one page of the timeline with its day headings, tab counts and paging, and `GET /audit-logs/export`, which downloads the same view as a CSV (or XLSX) file and records that it did. Both take the same filters — tab, time range, custom dates, the viewer's time zone, an action, a credential and a search — and both return only the rows the caller is allowed to see. Three shared endpoints feed or read the same table: `GET /meta` (the action catalogue), `POST /credentials/{id}/events` (the drawer's own entries) and `GET /credentials/{id}/activity` (one credential's history).

### 1.3 Key ideas to understand first

| Idea | What it means in the API |
|---|---|
| Vault Admin | The **Branch User** of a branch; also sees the entries of their branch's non-admin people |
| Event | One row, shown as **EVT-{id}** |
| `tz` | The viewer's IANA time zone; it decides the calendar days, `date`, `time` and the export times. Default `Asia/Kolkata`; the page always sends the browser's |
| `tab` | `all`, `mine`, `team` (and `alerts`, not shown on the page) |
| `range` | `24h`, `7d`, `30d` (rolling back from now), `all`, or `custom` (calendar days in `tz`) |
| Summary and tabs | Computed over every filter **except** the tab and paging |

---

## 2. Conventions

| Aspect | Value |
|---|---|
| Base path | `/api/credvault` |
| Authentication | `Authorization: Bearer <Sanctum token>` on every route |
| Middleware | `auth:sanctum` → `user.active` → `tenant` → `throttle:credvault` (240 / minute per user) |
| Module gate | `can_view` on the `credentials-vault` module, else **403** *"You do not have access to Credentials Vault. Ask your admin to grant it in Permissions."* |
| Company | Always from the token's user; a login with no company gets **403** *"CredVault needs a company account — this login has no tenant."* |
| `branch_id` | The browser adds `?branch_id=` to GETs; these endpoints **ignore** it — visibility comes from the user |
| Visibility | The caller's own entries; the entries of everyone who reports to them (directly or further down — not their own managers); and every entry on a credential they own (binned ones included). The Vault Admin also sees every user of their branch **except other admin logins**. Automatic (System) entries are visible only when they are on a credential you own |
| Success | `{ "status": true, … }` |
| Refusal | Raised by the controller: `{ "status": false, "message": "…", "errors"?: { "<field>": ["…"] } }`. Form validation: Laravel's `{ "message", "errors" }` (no `status`) |
| Rate limit | 429 `{ "message": "Too Many Attempts." }` |
| Ordering | Newest first: `created_at desc, id desc` |

---

## 3. Endpoint Index

| # | Method | Endpoint | Purpose | Used by |
|---|---|---|---|---|
| 1 | GET | `/audit-logs` | The timeline page: summary, day groups, tab counts | The Audit Logs page |
| 2 | GET | `/audit-logs/export` | Download the same view as CSV or XLSX | **Export Logs** |
| 3 | GET | `/meta` (part) | The action catalogue `audit_actions` | The page (labels, verbs, icon tone) |
| 4 | POST | `/credentials/{id}/events` | Record a view, a website launch or a plain-field copy | The View drawer; the Critical Vault unlock popup |
| 5 | GET | `/credentials/{id}/activity` | One credential's entries | The View drawer → Activity |

Endpoints 1 and 2 are the Audit Logs API; 3–5 are here because they feed or read the same table.

---

## 4. The Timeline

### 4.1 GET `/audit-logs`

Any CredVault user; rows follow the visibility rule in section 2.

| Parameter | Type | Rule | Default | Meaning |
|---|---|---|---|---|
| `tab` | string | `all`, `mine`, `team`, `alerts` | `all` | `mine` = by me; `team` = by anyone else or System; `alerts` = severity `critical` |
| `range` | string | `24h`, `7d`, `30d`, `all`, `custom` | `30d` | The first three are rolling windows back from now |
| `from` | date | `Y-m-d` (validation); a future day is refused by the controller (4.5) | open | Start day (used only with `custom`) |
| `to` | date | `Y-m-d` (validation); a future day is refused by the controller (4.5) | open (today) | End day (used only with `custom`) |
| `tz` | string | A valid time zone (aliases accepted) | `Asia/Kolkata` | The viewer's zone |
| `action` | string | One of the 28 action keys | — | Only this action |
| `credential_id` | integer | ≥ 1 | — | Only this credential |
| `q` | string | ≤ 100 characters | — | Search (4.2) |
| `page` | integer | ≥ 1 | 1 | |
| `per_page` | integer | 1–100 | 15 | The page sends 10 by default (its pager offers 10 / 25 / 50) |

### 4.2 Search (`q`)

Case-insensitive. It matches `detail`, `credential_name`, `credential_code`, `module`, the actor's name, any action whose **label** contains the term (*copied* → `copy`), and the event `id` when the term is `123` or `EVT-123`.

> **Explanation: switching tab changes only the list.** `summary` and `tabs` are computed over every filter except `tab` and paging, so a tab switch changes only `data`, `groups` and `meta`.

**Request**

```
GET /api/credvault/audit-logs?tab=all&range=custom&from=2026-11-10&to=2026-11-12&q=kotak&page=1&per_page=10&tz=Asia/Kolkata
Authorization: Bearer 12|xxxxxxxxxxxxxxxxxxxx
```

**200**

```json
{
  "status": true,
  "summary": {
    "events": 23, "by_me": 4, "team_members": 3, "views_reveals": 11, "copies_exports": 2,
    "access_changes": 6, "security_alerts": 5,
    "most_active": { "user_id": 57, "name": "Priya Sharma", "is_me": false, "label": "Priya Sharma", "events": 12 },
    "range": { "range": "custom", "from": "2026-11-10", "to": "2026-11-12", "tz": "Asia/Kolkata" }
  },
  "data": [
    {
      "id": 1042, "event_id": "EVT-1042",
      "at": "2026-11-12T09:52:07+00:00", "date": "2026-11-12", "time": "15:22", "seconds": "07s",
      "local_at": "2026-11-12T15:22:07+05:30", "chip": "CCRD-0003 · Critical",
      "actor": { "id": 57, "name": "Priya Sharma", "full_name": "Priya Sharma", "initials": "PS", "role": "Executive · Accounts", "is_me": false },
      "action": "reveal", "label": "Password revealed", "verb": "revealed the password of",
      "severity": "critical", "severity_label": "Critical",
      "credential": { "id": 318, "code": "CCRD-0003", "name": "Kotak Vendor Payments A/c", "risk": "critical", "risk_label": "Critical", "type": "bank", "vault": "critical" },
      "sentence": "Priya Sharma revealed the password of Kotak Vendor Payments A/c",
      "target": "CCRD-0003", "module": "Critical Vault", "detail": "Net-Banking Password revealed", "ip": "10.0.4.21"
    },
    {
      "id": 1039, "event_id": "EVT-1039",
      "at": "2026-11-12T09:40:31+00:00", "date": "2026-11-12", "time": "15:10", "seconds": "31s",
      "local_at": "2026-11-12T15:10:31+05:30", "chip": "CCRD-0003 · Critical",
      "actor": { "id": 12, "name": "You", "full_name": "Anil Verma", "initials": "AV", "role": "Branch Manager · Operations", "is_me": true },
      "action": "approve", "label": "Access approved", "verb": "approved access to",
      "severity": "info", "severity_label": "Info",
      "credential": { "id": 318, "code": "CCRD-0003", "name": "Kotak Vendor Payments A/c", "risk": "critical", "risk_label": "Critical", "type": "bank", "vault": "critical" },
      "sentence": "You approved access to Kotak Vendor Payments A/c",
      "target": "CCRD-0003", "module": "Access Requests", "detail": "Vault Admin Anil Verma approved REQ-0021", "ip": "10.0.4.9"
    }
  ],
  "groups": [
    { "date": "2026-11-12", "date_display": "12/11/2026", "label": "Today", "heading": "Today 12/11/2026", "events": 9, "events_label": "9 events" }
  ],
  "tabs": { "all": 23, "mine": 4, "team": 19, "alerts": 5 },
  "meta": { "current_page": 1, "per_page": 10, "total": 23, "last_page": 3 }
}
```

### 4.3 The event row

| Key | Value |
|---|---|
| `id`, `event_id` | The row id and *EVT-{id}* |
| `at`, `local_at` | ISO-8601 in UTC, and in `tz` |
| `date`, `time`, `seconds` | `Y-m-d`, `H:i`, *ss* + `s` — in `tz` |
| `chip` | *‹code› · ‹Risk›*; only *‹code›* once the credential is purged; `null` with no credential |
| `actor` | `{ id, name ("You" for the caller), full_name, initials, role, is_me }`. An automatic action: `{ "id": null, "name": "System", "full_name": "System", "initials": "SY", "role": "CredVault", "is_me": false }` |
| `actor.role` | Designation · department, else *Team member*. If the person's user record no longer exists, `name` and `full_name` are `null` and `role` is *Team member* |
| `action`, `label`, `verb` | The key, and its catalogue label and sentence verb |
| `severity`, `severity_label` | The stored severity and *Info / Warning / Critical* |
| `credential` | `null` for an entry with no credential (import, backup, generator, exports, retention). `risk`, `type` and `vault` are `null` once the credential is purged; `code` and `name` stay |
| `sentence` | *‹actor› ‹verb› ‹credential name or code›* |
| `target` | The credential code, or *Vault settings* |
| `module`, `detail`, `ip` | As stored |

### 4.4 Day groups and summary

| Key | Value |
|---|---|
| `groups[].label` | *Today*, *Yesterday*, or the weekday name (*Tuesday*); `heading` adds the date (*Tuesday, 03/11/2026*) |
| `groups[].events` | The day's count over the **whole** filtered view, not just this page |
| `groups` | Only the days that appear on this page, newest first; `[]` when the page is empty. Any date before yesterday reads as its weekday (*Tuesday, …*), however old |
| `summary.most_active` | `null` when no person has an entry in the view; System rows are ignored; for the caller `label` is *You (‹name›)* and `is_me` is `true` |
| `summary.range` | `from` / `to` exactly as sent (even when `range` is not `custom`), else `null` |
| `summary` | Totals over the filtered view: events, by me, distinct other people, views + reveals, copies + exports, access changes (share, revoke, request, approve, reject), critical events, the most active person. The page does not show it |

### 4.5 Errors

| HTTP | When | `message` |
|---|---|---|
| 403 | No company | *CredVault needs a company account — this login has no tenant.* |
| 403 | No module permission | *You do not have access to Credentials Vault. Ask your admin to grant it in Permissions.* |
| 422 | A bad `tab`, `range`, `action`, `tz`, `from` / `to` format, `credential_id`, a `q` over 100 characters, `page` / `per_page` out of range | Laravel's message, e.g. *The selected range is invalid.* |
| 422 | `from` after today (any range) | *From cannot be in the future.* (`errors.from`) |
| 422 | `to` after today (any range) | *To cannot be in the future.* (`errors.to`) |
| 422 | `range=custom` and `from` > `to` | *From must be on or before To.* (`errors.from`) |

When both `from` and `to` are in the future, only `errors.from` is returned.
| 429 | Over 240 requests a minute | *Too Many Attempts.* |

---

## 5. Export

### 5.1 GET `/audit-logs/export`

Any CredVault user. The file holds exactly the rows the caller would see with the same filters. It takes every parameter of 4.1 except `page` / `per_page`, plus:

| Parameter | Rule | Default |
|---|---|---|
| `format` | `csv`, `xlsx` | `csv` — the page never sends `format`, so the screen always downloads CSV |

| Step | What happens |
|---|---|
| 1 | Reads up to **10,000** rows of the view, newest first |
| 2 | Refuses an empty view |
| 3 | Writes its own entry: action `export`, severity **`info`**, module *Audit Logs*, detail *Audit log exported · ‹n› events*, `meta = { "rows": n, "kind": "audit_log" }` |
| 4 | Returns the file |

**Request**

```
GET /api/credvault/audit-logs/export?tab=mine&range=7d&tz=Asia/Kolkata
Authorization: Bearer 12|xxxxxxxxxxxxxxxxxxxx
```

**200**

```
HTTP/1.1 200 OK
Content-Type: text/csv; charset=UTF-8
Content-Disposition: attachment; filename="credvault-audit-log-my-activity-20261112.csv"
Content-Length: <bytes>
Cache-Control: no-store
X-CredVault-Count: 2
Access-Control-Expose-Headers: Content-Disposition, X-CredVault-Code, X-CredVault-Withheld

Event ID,Date,Time,User,Role,Action,Credential ID,Credential,Risk,Details,Module,Severity,IP
EVT-1039,12/11/2026,15:10:31,Anil Verma,Branch Manager · Operations,Access approved,CCRD-0003,Kotak Vendor Payments A/c,Critical,Vault Admin Anil Verma approved REQ-0021,Access Requests,Info,10.0.4.9
EVT-1031,11/11/2026,11:04:55,Anil Verma,Branch Manager · Operations,Policy changed,,Vault settings,,Retention period for Pune Branch: 30 days → 15 days,Recycle Bin,Warning,10.0.4.9
```

### 5.2 Columns and file

| Column | Source |
|---|---|
| Event ID | *EVT-{id}* |
| Date / Time | `d/m/Y` / `H:i:s` in `tz` |
| User | The actor's name, or *System* — also *System* when the person's user record no longer exists (Role is then blank) |
| Role | The role line, or *CredVault* for System |
| Action | The catalogue label |
| Credential ID | `credential_code` |
| Credential | `credential_name`, or *Vault settings* |
| Risk | The credential's current risk (blank once purged) |
| Details / Module / IP | As stored |
| Severity | *Info* / *Warning* / *Critical* |

The file name is `credvault-audit-log-{tab}-{Ymd}.{format}`, where `{tab}` is `all-activity`, `my-activity`, `team-activity` or `security-alerts`, and the date is today in `tz`. An XLSX has one sheet *Audit Logs* with a frozen header row. The number of rows written is in `X-CredVault-Count`.

### 5.3 Errors

| HTTP | When | `message` |
|---|---|---|
| 403 | No company / no module permission | As 4.5 |
| 422 | Any 4.1 validation failure, or a bad `format` | As 4.5 / *The selected format is invalid.* |
| 422 | A future date, or From after To | As 4.5 |
| 422 | The view has no rows | *There are no events in this view to export.* |
| 429 | Rate limit | *Too Many Attempts.* |

> **Explanation.** A refused download comes back as a JSON blob, not a file. `cvApi`'s `download()` reads it back into a `CvApiError`, so the page can show the message.

---

## 6. Shared Endpoints

### 6.1 GET `/meta` — `audit_actions`

Part of the CredVault meta payload; the page uses it for labels, verbs and the icon tone.

```json
{
  "status": true,
  "data": {
    "audit_actions": [
      { "key": "view", "label": "Viewed", "severity": "info", "verb": "viewed" },
      { "key": "reveal", "label": "Password revealed", "severity": "warn", "verb": "revealed the password of" },
      { "key": "export", "label": "Exported", "severity": "critical", "verb": "exported" }
    ]
  }
}
```

`severity` is the **base** level. Stored rows for reveal, copy and share on a Critical Vault credential are `critical`. All 28 keys are listed in the Technical Documentation, section 5.1.

### 6.2 POST `/credentials/{id}/events`

Anyone who can reach the credential (any access level).

| Field | Rule | Meaning |
|---|---|---|
| `action` | Required: `view` \| `launch` \| `copy` | What happened in the drawer |
| `field` | Required when `action = copy`; ≤ 40 characters | A **non-secret** field key, or `reg_email`, `reg_phone`, `url`, `username` |

| `action` | Entry written | Detail |
|---|---|---|
| `view` | `view` | *Opened credential details* |
| `launch` | `launch` | *Launched ‹url›* |
| `copy` | **`view`** | *‹Field label› copied* (`meta.field`) |

**Request** `{ "action": "copy", "field": "username" }` → **201** `{ "status": true, "message": "Recorded." }`

| HTTP | When | `message` |
|---|---|---|
| 404 | Not in the company, not reachable, or in the Recycle Bin | *Credential not found.* |
| 422 | `launch` on a credential with no website | *This credential has no website to launch.* (`errors.action`) |
| 422 | `field` is not a field of the type | *That is not a field of this credential.* (`errors.field`) |
| 422 | `field` is a secret | *Copy a secret through /reveal.* (`errors.field`) |
| 422 | `copy` without a `field` | Laravel's `required_if` message |

### 6.3 GET `/credentials/{id}/activity`

Anyone who can reach the credential. This is **not** scoped by the audit visibility rule: everyone who can open the credential sees all its entries.

| Parameter | Rule | Default |
|---|---|---|
| `page` | ≥ 1 | 1 |
| `per_page` | 1–100 | 50 |

Returns `{ "status": true, "data": [ ‹event row as in 4.3› ], "meta": { … } }`, ordered by `id desc`. Unlike `/audit-logs`, the times are **always India time** (`Asia/Kolkata`), whatever the viewer's zone — it takes no `tz`. Old `reveal` rows with the detail *All stored values returned by the detail API* are hidden. Errors: 404 *Credential not found.*; 422 for bad paging.

---

## 7. Error Catalogue

| HTTP | Message | Endpoint(s) |
|---|---|---|
| 403 | CredVault needs a company account — this login has no tenant. | All |
| 403 | You do not have access to Credentials Vault. Ask your admin to grant it in Permissions. | All |
| 404 | Credential not found. | events, activity |
| 422 | From cannot be in the future. | audit-logs, export |
| 422 | To cannot be in the future. | audit-logs, export |
| 422 | From must be on or before To. | audit-logs, export |
| 422 | There are no events in this view to export. | export |
| 422 | This credential has no website to launch. | events |
| 422 | That is not a field of this credential. | events |
| 422 | Copy a secret through /reveal. | events |
| 422 | Laravel validation messages (*The selected tab is invalid.* …) | All |
| 429 | Too Many Attempts. | All |

---

## 8. Quick Reference — Screen Action → API Call

| Screen action | API call |
|---|---|
| Open the page (All Activity, 30 days, 10 per page) | `GET /audit-logs?tab=all&range=30d&page=1&per_page=10&tz=…` |
| **My Activity**, **24h** | `GET /audit-logs?tab=mine&range=24h&tz=…` |
| **Custom** → one day | `GET /audit-logs?range=custom&from=2026-11-05&to=2026-11-05&tz=…` |
| Click a credential's name | `GET /audit-logs?credential_id=318&…` |
| Search an event ID, or every copy | `GET /audit-logs?q=EVT-1042` · `GET /audit-logs?q=copied` — finds secret copies (action `copy`) and plain-field copies (stored as `view`, detail *… copied*); `action=copy` finds only the secret ones |
| Critical events only (no tab on screen) | `GET /audit-logs?tab=alerts&range=7d` |
| **Export Logs** | `GET /audit-logs/export?‹the same filters›` |
| Export as Excel (API only) | `GET /audit-logs/export?…&format=xlsx` |

---

## 9. Known Issues

| # | Issue | Effect |
|---|---|---|
| 1 | `per_page` defaults to 15 on the server | The page always sends its own size (10, 25 or 50) |
| 2 | API only: a future `from` / `to` fails even when `range` is not `custom` | There the dates are otherwise ignored; the page sends them only with `custom` |
| 3 | The export is capped at 10,000 rows without a warning | `X-CredVault-Count` gives the number actually written |
| 4 | `X-CredVault-Count` is not in `Access-Control-Expose-Headers` | Cross-origin, the browser cannot read it; the toast falls back to `meta.total` |
| 5 | `summary` is returned but not shown | Extra queries on every load |
| 6 | `tab=alerts` is accepted and counted | The page no longer offers a Security Alerts tab |
| 7 | A plain-field copy is stored as `view` | `?action=copy` finds only secret copies |
| 8 | Entries on a purged credential drop out of the owner's view | Unless the actor is in the owner's own scope |

---

## 10. Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The Branch User (`user_type = branch_user`) of a branch |
| Event | One audit row, *EVT-{id}* |
| `tz` | The viewer's IANA time zone |
| Rolling range | `24h` / `7d` / `30d` — back from the current moment |
| Day group | One day heading with its full-view count |
| Envelope | The outer JSON shape: `status`, `message`, `data`, `errors` |
