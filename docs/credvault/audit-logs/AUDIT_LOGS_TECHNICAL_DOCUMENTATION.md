# CredVault Audit Logs — Technical Documentation

| | |
|---|---|
| **Jira** | GT-116 (parent GT-85 — CredVault Audit Logs Documentation) |
| **Module** | CredVault → Vault Administration & Security → Audit Logs |
| **Audience** | Developers, tech leads, code reviewers, QA automation |
| **Companion documents** | Functional Documentation · API Documentation · Code Walkthrough |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document explains how Audit Logs is built: the one append-only table, the writer every CredVault action calls, the reader behind the page and the export, the visibility rules, and the frontend. It is written for developers who will maintain or extend the module, or add a new action to the log. For what the user sees, read the Functional Documentation. For every request and response, read the API Documentation.

### 1.2 The design in one paragraph

Audit Logs is **one append-only table, one writer and one reader**, all in the shared `CredVaultController`. Every CredVault action calls `audit()` → `writeAudit()` (34 call sites), which saves one row with the actor, the action, the credential's code and name **copied in**, the module, a detail line, the severity, the IP and the browser. The page reads through `auditQuery()` — the viewer's visible rows plus the filters — served by `auditLogs()` (the timeline) and `exportAuditLogs()` (the CSV / XLSX download). Four decisions shape it: the credential is **denormalised** (no foreign keys, so an entry survives a force-delete); the severity is **stored**, not computed; visibility follows the **reporting line and the branch**, not the vault rules; and times are **UTC in the table and local on the way out**.

### 1.3 Key ideas to understand first

| Idea | What it means in the code |
|---|---|
| Vault Admin | The **Branch User**; `adminBranchOf($u)` returns their branch |
| Writer | `audit()` fills the actor from the user; `writeAudit()` saves the row |
| Reader | `auditQuery($u, $f)` — the scoped, filtered query every read starts from |
| Catalogue | `AuditLog::ACTIONS` — 28 keys, each `[label, base severity]`; `VERBS` for the sentence |
| Raised severity | `reveal`, `copy`, `share` on a Critical Vault credential are saved as `critical` (`RAISE_ON_CRITICAL`) |
| Denormalised | `credential_code` and `credential_name` are copied at write time |
| `tz` | The viewer's time zone, sent by the browser; default `Asia/Kolkata` |

---

## 2. Architecture

### 2.1 Architecture at a glance

| Layer | Runs on | What it does | Main pieces | Talks to the next layer through |
|---|---|---|---|---|
| **1 · Browser** | React 19 single-page app | Tabs, ranges, search, the day-grouped timeline, the export download | `AuditLogs.tsx`, `audit.css`, `cvApi.ts`, `shared.tsx` | HTTPS · JSON (a file blob for the export) · `Authorization: Bearer <Sanctum token>` |
| **2 · API** | Laravel 12 on PHP 8.2 | Scopes the rows to the viewer, filters, groups by day, builds each event, writes the export file | `CredVaultController` (`auditLogs`, `exportAuditLogs`, `auditQuery`, `eventRows`, `auditDayGroups`, `audit`, `writeAudit`), `AuditLog` | Eloquent / SQL |
| **3 · Data** | PostgreSQL | The append-only log; users and HR for names, roles and the reporting line | `credvault_audit_logs`, `users`, `employees` | — |

### 2.2 Layer 1 — Browser (`resources/js/pages/credvault/`)

| File | Lines | Role |
|---|---|---|
| `audit/AuditLogs.tsx` | 334 | The page, and `CustomRange` (the From / To popup) |
| `audit/audit.css` | 405 | Timeline (`.alh-*`, `.alh2-*`), tools (`.al-range`, `.al-cust`, `.al-pop`), severity tones, dark mode |
| `cvApi.ts` | 419 | `cvApi.audit()` / `cvApi.auditExport()` — both add `tz: viewerTz()`; `AuditEvent`, `AuditGroup`; `download()` |
| `shared.tsx` | 663 | `CvPage`, `CvStrip`, `StripBtn`, `CvCard`, `CvTabsRow`, `useCvMeta`, `useDebounced` (350 ms) |
| `components/ui/WorklistPager` · `MasterDatePicker` | — | The pager and the date pickers |

### 2.3 Layer 2 — API (`app/`)

| Piece | Lines | Role |
|---|---|---|
| `routes/api.php` | — | `GET /credvault/audit-logs` → `auditLogs`; `GET /credvault/audit-logs/export` → `exportAuditLogs` |
| `CredVaultController.php` — reader | 5,746 (whole file) | `auditRules`, `auditMessages`, `auditQuery`, `auditLogs`, `auditDayGroups`, `exportAuditLogs`, `eventRows`, `eventRow`, `userInfo`, `downlineIds`, `adminBranchOf` |
| `CredVaultController.php` — writer | | `audit()`, `writeAudit()` — called from 28 places in this file |
| `CriticalVault/AccessRequestController.php` | 427 | 6 more `audit()` calls — it extends `CredVaultController`, which is where `audit()` comes from |
| `Models/CredVault/AuditLog.php` | 82 | The model and the action catalogue |

### 2.4 Layer 3 — Data

| Table | Holds |
|---|---|
| `credvault_audit_logs` | Every CredVault action — append-only, no foreign keys. Also read by `lastNumber()`: the highest code in `purge` rows, so a deleted CRD- / CCRD- number is never reused |
| `users` | The actor's name, user type and branch |
| `employees`, master designations and departments | The role line and the reporting tree |
| `credvault_credentials` (with trashed) | The live risk, type and vault of an entry's credential |

### 2.5 What happens when the page loads

| Step | Call | Server work |
|---|---|---|
| 1 | `GET /credvault/meta` | Serves the catalogue as `audit_actions: [{ key, label, severity, verb }]` |
| 2 | `GET /credvault/audit-logs?tab=all&range=30d&page=1&per_page=10&tz=…` | `tenantUser()` → validate → `auditQuery()` without the tab → summary and four tab counts → the page with the tab → `eventRows()` → `auditDayGroups()` |
| 3 | Any filter or page change | The same call; the page goes back to page 1 when a filter changes |
| 4 | **Export Logs** | `GET /credvault/audit-logs/export?…` → the file, plus a new `export` row |

---

## 3. Tech Stack

| Layer | Technology | Used for |
|---|---|---|
| Frontend | React 19.2 · TypeScript 6.0 · React Router 7.14 (`useSearchParams`) · Axios 1.11 | The page, the URL filters, the calls |
| Frontend | Velzon theme · `WorklistPager` · `MasterDatePicker` | The chrome, the pager, the date pickers |
| Backend | PHP 8.2+ · Laravel 12 · Sanctum 4 | Routing, validation, Eloquent, tokens |
| Database | PostgreSQL | The table; day bucketing with `to_char((created_at AT TIME ZONE 'UTC') AT TIME ZONE ?, 'YYYY-MM-DD')` |
| Search | `lower(coalesce(col, '')) like ?` with `%`, `_`, `\` escaped (`likeTerm()`) | Case-insensitive search |
| Export | `VaultFile::build($cols, $data, 'csv')` / `VaultFile::xlsx([...])` | The CSV and XLSX files |
| Rate limit | `throttle:credvault` — 240 / minute per user | Both endpoints |
| Dummy data | **None** — the page always calls the live API | |

---

## 4. Database Schema

### 4.1 `credvault_audit_logs`

| Group | Column | Type | Notes |
|---|---|---|---|
| Key | `id` | bigint PK | Shown as **EVT-{id}** |
| Tenancy | `client_id` | unsigned bigint, not null | Every read filters on it |
| Tenancy | `branch_id` | unsigned bigint, nullable | The **actor's** branch at write time; `null` for the expiry `lock` and every `purge`; never read |
| Actor | `user_id` | unsigned bigint, nullable, indexed | `null` = **System** — only `purge` rows with no actor. The expiry `lock` from `sweepUnlocks()` carries the **requester** |
| What | `action` | varchar(20) | One of the 28 catalogue keys; no database constraint |
| What | `severity` | varchar(10), default `info` | `info` \| `warn` \| `critical` |
| Target | `credential_id` | unsigned bigint, nullable, indexed | No foreign key; survives a force-delete |
| Target | `credential_code` | varchar(20), nullable | Copied at write time (`CRD-0001`, `CCRD-0001`) |
| Target | `credential_name` | varchar(150), nullable | Copied, cut to 150 |
| Context | `module` | varchar(40), nullable | `My Vault`, `Team Vault`, `Critical Vault`, `Access Requests`, `Recycle Bin`, `Import & Recovery`, `Password Health`, `Generate Password`, `Audit Logs` |
| Context | `detail` | varchar(500), nullable | Cut to 500 |
| Context | `meta` | json, nullable | Structured extras (`request_id`, `share_id`, `field`, `transfer`, …); `null` when empty |
| Origin | `ip` | varchar(45), nullable | `request()->ip()` |
| Origin | `user_agent` | varchar(255), nullable | Cut to 255; stored, never returned |
| Time | `created_at` | timestamp, default current | UTC. **No** `updated_at` |

### 4.2 Indexes

| Index | Columns | Serves |
|---|---|---|
| PK | `id` | Event-ID search, tie-break ordering |
| single | `user_id` | Actor scoping, the `mine` tab |
| single | `credential_id` | Owned-credential scoping, the credential filter, the drawer's Activity tab |
| composite | `client_id, created_at` | The range filter and the ordering |
| composite | `client_id, action, created_at` | The `action` filter, the Health "resolved" list |
| composite | `client_id, severity, created_at` | The `alerts` tab, severity sums |

The search columns (`detail`, `credential_name`, `credential_code`, `module`) have no index; search scans within the company and the range.

### 4.3 Migrations

| Migration | Effect |
|---|---|
| `2026_10_30_000005_create_credvault_audit_logs_table` | Creates the table and the indexes (guarded by `Schema::hasTable`) |
| `2026_11_03_000001_add_vault_and_two_step_to_credvault_credentials` | When critical rows were renumbered **CCRD-**, it **updated** `credential_code` on their existing audit rows — the only code that ever updates this table |

Both live in `database/migrations/credvault/`, loaded by `AppServiceProvider::loadMigrationsFrom()`.

---

## 5. The Model — `App\Models\CredVault\AuditLog` (82 lines)

| Member | Value |
|---|---|
| `$table` | `credvault_audit_logs` |
| `UPDATED_AT` | `null` — only `created_at` is written |
| `$fillable` | `client_id, branch_id, user_id, action, severity, credential_id, credential_code, credential_name, module, detail, meta, ip, user_agent, created_at` |
| `$casts` | `meta` → array, `created_at` → datetime |
| `user()` | `belongsTo(User::class, 'user_id')` |
| `ACTIONS` | `key => [label, base severity]` — 28 entries (5.1) |
| `RAISE_ON_CRITICAL` | `['reveal', 'copy', 'share']` |
| `VERBS` | `key => sentence verb` |
| `SEVERITY_LABELS` | `info => Info`, `warn => Warning`, `critical => Critical` |

> **Explanation: append-only by convention.** The class comment says *"Append-only — created, never updated"*, but nothing enforces it — no `updating` / `deleting` guard and no database trigger. It holds because no code path calls `update()` or `delete()` on the model.

### 5.1 The action catalogue

| Key | Label | Base | Verb |
|---|---|---|---|
| `view` | Viewed | info | viewed |
| `reveal` | Password revealed | warn | revealed the password of |
| `copy` | Password copied | warn | copied the password of |
| `launch` | Website launched | info | launched the website of |
| `create` | Credential added | info | added |
| `edit` | Credential updated | info | updated |
| `share` | Shared | warn | shared |
| `revoke` | Access revoked | info | revoked access to |
| `request` | Access requested | warn | requested access to |
| `forward_mgr` | Forwarded to manager | info | forwarded to the manager |
| `approve` | Access approved | info | approved access to |
| `reject` | Access rejected | critical | rejected access to |
| `cancel` | Request cancelled | info | cancelled the access request for |
| `unlock` | Critical unlocked | critical | unlocked |
| `lock` | Locked again | info | locked |
| `otp_failed` | Wrong 2-step code | warn | entered wrong 2-step codes for |
| `otp_sent` | Email code sent | info | had an email code sent for |
| `export` | Exported | critical | exported |
| `bin` | Moved to bin | warn | moved to the recycle bin |
| `restore` | Restored | info | restored |
| `purge` | Deleted permanently | critical | permanently deleted |
| `policy` | Policy changed | warn | changed a CredVault policy — written today for a branch's Recycle Bin retention change |
| `importx` | Credentials imported | warn | imported credentials |
| `backup` | Backup created | warn | downloaded a backup |
| `backupfail` | Backup attempt failed | critical | attempted a backup |
| `health_fixed` | Health issue resolved | info | resolved a health issue on |
| `totp_linked` | 2-step linked | info | linked 2-step verification to |
| `generate` | Password generated | info | generated a password |

---

## 6. API Surface

| Method | Path | Action | Purpose |
|---|---|---|---|
| GET | `/api/credvault/audit-logs` | `auditLogs` | The timeline: `summary`, `data`, `groups`, `tabs`, `meta` |
| GET | `/api/credvault/audit-logs/export` | `exportAuditLogs` | The same view as CSV (default) or XLSX, at most 10,000 rows |

Related routes that read or write the table:

| Method | Path | Action | Relation |
|---|---|---|---|
| GET | `/api/credvault/meta` | `meta` | Serves `audit_actions` from the `ACTIONS` constant (does not touch the table) |
| POST | `/api/credvault/credentials/{id}/events` | `logEvent` | Browser-reported `view` / `launch` / plain-field copy |
| GET | `/api/credvault/credentials/{id}/activity` | `activity` | One credential's entries for the View drawer — filtered only on `client_id` + `credential_id` after `findCredential()`, not through `auditQuery()`; times always in `Asia/Kolkata` (no `tz`) |
| GET | `/api/credvault/dashboard` | `dashboard` | The daily severity chart and the 10 latest entries, through `auditQuery()` |
| GET | `/api/credvault/health` | `health` | `action = 'health_fixed'` entries (Resolved) |

Both audit endpoints sit under `auth:sanctum` → `user.active` → `tenant` → `throttle:credvault`. Full detail: the API Documentation.

---

## 7. How Visibility Is Decided — `auditQuery()`

### 7.1 Who sees which rows

```php
$q = AuditLog::where('client_id', $u->client_id);
$people = array_merge([$u->id], $this->downlineIds($u));
$branch = $this->adminBranchOf($u);
$q->where(function ($w) use ($u, $people, $branch) {
    $w->whereIn('user_id', $people)
      ->orWhereIn('credential_id', Credential::withTrashed()->where('client_id', $u->client_id)->where('owner_id', $u->id)->select('id'));
    if ($branch) $w->orWhereIn('user_id', User::where('client_id', $u->client_id)->where('branch_id', $branch)->whereNotIn('user_type', self::ADMIN_TYPES)->select('id'));
});
```

| Viewer | Rows |
|---|---|
| Everyone | Their own (`user_id = me`), their reporting line at any depth (`downlineIds()`), and every row on a credential they own (trashed included) |
| The Vault Admin, additionally | Rows by every **non-admin** user of their branch (`user_type` not in `ADMIN_TYPES`) |

`downlineIds()` walks the HR reporting tree (`employees.reporting_manager_id` / `reporting_manager_user_id`) at any depth and stops on a loop.

### 7.2 Filters

| Filter | Clause |
|---|---|
| `range=24h` / `7d` / `30d` (default) | `created_at >= now() - 1 / 7 / 30 days` — rolling |
| `range=all` | No lower bound |
| `range=custom` | `from` → `>= startOfDay(from, tz)` in UTC; `to` → `<= endOfDay(to, tz)` in UTC; either end may be open |
| A future date | `from` or `to` later than today in `tz` → 422 (checked for **any** range) |
| From after To | Only with `range=custom` → 422 on `from` |
| `tab=mine` | `user_id = me` |
| `tab=team` | `user_id IS NULL OR user_id <> me` |
| `tab=alerts` | `severity = 'critical'` (not shown on the page) |
| `action` | `action = ?` (a catalogue key) |
| `credential_id` | `credential_id = ?` |
| `q` | OR of: `detail`, `credential_name`, `credential_code`, `module` like; the actor's name like; any action whose **label** contains the term; `id =` when the term is `123` or `EVT-123` |

---

## 8. The Reader

### 8.1 `auditLogs()` — the page

| Step | Detail |
|---|---|
| 1 | `tenantUser()` → validate `auditRules()` → `tz` defaults to `Asia/Kolkata` |
| 2 | `$ranged` = `auditQuery()` **without** `tab`, `page`, `per_page` — so the range, the search, `action` and `credential_id` all apply |
| 3 | `summary` — one aggregate over `$ranged` (total, by me, views + reveals, copies + exports, access changes, critical, distinct other actors) plus the most active person |
| 4 | `tabs` — `all`, `mine`, `team`, `alerts`, each counted on `$ranged` |
| 5 | The page — `auditQuery($f)` with the tab, ordered `created_at desc, id desc`, `paginate(per_page ?? 15)` (the page sends 10) |
| 6 | `eventRows()` — one credential read (trashed included) and one `userInfo()` batch for the page |
| 7 | `groups` — `auditDayGroups()` counts each day on this page over the **full** filtered view |

### 8.2 `eventRow()` — one entry

| Key | Source |
|---|---|
| `id`, `event_id` | `id`, `'EVT-' . id` |
| `at`, `local_at` | ISO-8601 UTC; ISO-8601 in `tz` |
| `date`, `time`, `seconds` | `Y-m-d`, `H:i`, `s` + `"s"`, in `tz` |
| `chip` | `"{code} · {Risk}"` when a credential is set |
| `actor` | `{ id, name ('You' for self), full_name, initials, role, is_me }`; System = `{ null, 'System', 'System', 'SY', 'CredVault', false }` |
| `action`, `label`, `verb` | The key and its catalogue label and verb |
| `severity`, `severity_label` | The stored severity and its label |
| `credential` | `{ id, code, name, risk, risk_label, type, vault }` whenever a credential is set. `risk`, `type`, `vault` come from the live or trashed row and are `null` once it is purged; the chip then shows the code only |
| `sentence` | `"{actor} {verb} {credential name or code}"` |
| `target` | The credential code, or *Vault settings* |
| `module`, `detail`, `ip` | As stored |

`role` comes from `userInfo()`: designation · department, else *Team member*.

### 8.3 `exportAuditLogs()`

The same validation plus `format` (`csv` \| `xlsx`, default `csv`). It reads up to 10,000 rows newest first, refuses an empty set with 422 *There are no events in this view to export.*, maps 13 columns, then **writes its own `export` row** (severity overridden to `info`, module *Audit Logs*, `meta = { rows, kind: 'audit_log' }`) before returning the file. The file name is `credvault-audit-log-{all-activity|my-activity|team-activity|security-alerts}-{Ymd in tz}.{fmt}`; the row count is in `X-CredVault-Count`.

---

## 9. The Writer

| Method | Behaviour |
|---|---|
| `audit($u, $action, $c = null, $detail = null, $meta = [], $module = null)` | Fills `client_id`, `user_id`, `branch_id` from `$u`. The module defaults to the credential's vault — *Critical Vault* for a Critical Vault credential, else *Team Vault* for a team credential, else *My Vault*; `null` with no credential |
| `writeAudit($clientId, $userId, $branchId, $action, $c, $detail, $meta, $module, $severity = null)` | Severity = override ?? catalogue ?? `info`, raised to `critical` for `RAISE_ON_CRITICAL` on a Critical Vault credential; cuts the name (150), detail (500), user agent (255); empty `meta` → `null`; `AuditLog::create()` |

> **Explanation: a rolled-back action leaves no entry.** Writes run inside the caller's transaction, so if the action fails and rolls back, its entry disappears with it. Three places commit **before** refusing, so their entries survive the refusal: the failed-backup branch of `backup()`, the lockout branch of `verifyOtp()` (written once, on the 3rd wrong code — earlier wrong codes are not logged), and a typed import where every row failed (`runTypedImport()`).

### 9.1 Who writes to the log

| Writer | Actions | Module |
|---|---|---|
| View drawer (`logEvent`, `attachment`) | `view`, `launch` | The credential's vault |
| Reveal / copy (`reveal`) | `reveal`, `copy` | `isProtected() ? 'Critical Vault' : 'My Vault'` — every Critical Vault credential (always protected) is *Critical Vault*; team credentials read *My Vault* |
| Add / Edit form (`persistCredential`) | `create` (skipped during an import), `edit`, `totp_linked`, `health_fixed` | The credential's vault; *Password Health* for `health_fixed` |
| Sharing (`share`, the share email, `revokeShare`, a recipient's bin, `endOrphanedShares`) | `share`, `revoke` | The credential's vault. One share writes **two** `share` rows — `share()` inside its transaction, `mailShare()` after the commit — both raised to critical on a Critical Vault credential |
| Access requests (`AccessRequestController`) | `request`, `forward_mgr`, `cancel`, `otp_sent`, `otp_failed`, `lock` | *Critical Vault*; *Access Requests* for `forward_mgr` |
| Decisions and unlock (`decide`, `unlock`, `sweepUnlocks`) | `approve`, `reject`, `unlock`, `lock` | *Access Requests*; *Critical Vault* |
| Recycle Bin (`binCredential`, `restore`, `purgeOne`, a branch's retention change) | `bin`, `restore`, `purge`, `policy` | The credential's vault; *Recycle Bin* |
| Import & Recovery (`runTypedImport`, `runImport`, `backup`, `export`) | `importx`, `backup`, `backupfail`, `export` | *Import & Recovery*; *Team Vault* for `export` |
| Generator (`generatePassword`) | `generate` | *Generate Password* |
| Audit export (`exportAuditLogs`) | `export` (info) | *Audit Logs* |

`TwoStepController` writes nothing itself; a link is recorded as `totp_linked` when the credential is saved.

> **Explanation: one entry per import (CS-1479).** `persistCredential()` used to write `create` for every imported row on top of the run's `importx` summary. It now checks `if (!$this->importing)` before the `create` audit; `$this->importing` is set around the per-row loop in `runTypedImport()`.

---

## 10. Frontend

### 10.1 State

| State | Purpose |
|---|---|
| `tab`, `range`, `from`, `to`, `q` → `dq` | The query; `from` / `to` are sent only when `range === 'custom'` |
| `action` | Read once from `?action=`; no control changes it |
| `credId`, `credLabel` | From `?credential_id=` / `?credential=`, or a click on a credential name |
| `perPage`, `pg` | `pg.key` holds the filter key, so any filter change goes back to page 1 |
| `rows`, `apiGroups`, `tabs`, `pm` | The server response (`summary` is received but not used) |
| `loading`, `err` | Shimmer rows / the error panel with **Try again** |
| `open` (a Set) | Expanded detail lines |
| `exporting`, `pop` | The export busy flag; the custom-range popup |
| `seq` (ref) | Drops the responses of superseded loads |

### 10.2 Behaviour worth knowing

| Behaviour | Detail |
|---|---|
| Last page | The page clamps to `last_page` when the current page runs past it |
| Day headings | Rows are grouped by `e.date`, with the heading and count from `groups[]`; without `groups` it falls back to the browser's day label and this page's rows |
| Icon vs pill | The icon and the action-label tag use the catalogue severity (`meta.audit_actions`); the card and the severity pill use the stored `e.severity` |
| Export | `auditExport(filters)` with no `format`, so the screen always gets CSV; then a reload, so the new `export` row appears |
| Search length | `maxLength={100}` on the input — the API refuses `q` over 100 with 422 |
| No alerts tab | *Security Alerts* was removed from `TABS`; the API still accepts `tab=alerts` and returns its count |

---

## 11. Security

| Area | Guarantee |
|---|---|
| Company boundary | Every query starts `AuditLog::where('client_id', $u->client_id)`; a login with no company gets 403 |
| Module gate | `can_view` on the `credentials-vault` module, else 403 |
| `branch_id` param | The browser adds `?branch_id=` to GETs; both endpoints ignore it |
| No secrets | `reveal` / `copy` record the field key only; `generate` records the mode and the length (or word count), never the password |
| Personal data | `ip` and `user_agent` are stored; `ip` is returned and exported, `user_agent` never leaves the database. `otp_sent` masks the address; the share-email detail contains the **unmasked** copy-to address |
| Immutability | By convention — no model guard, trigger or revoked `UPDATE` |
| Retention | None — no job, setting or endpoint prunes the table |
| Export size | A hard cap of 10,000 rows; older rows are silently left out |

---

## 12. Business Rules in the Code

| ID | Rule | Where it is kept |
|---|---|---|
| BR-01 | Entries are never edited or deleted | No `update()` / `delete()` path on `AuditLog` |
| BR-02 | Every read is inside one company | `auditQuery()` |
| BR-03 | The viewer sees their own, their reporting line's and their owned credentials' entries; the Vault Admin also their branch's non-admin people | `auditQuery()` |
| BR-04 | Reveal, copy and share on a Critical Vault credential are saved as critical | `writeAudit()`, `RAISE_ON_CRITICAL` |
| BR-05 | No secret value is ever written | `reveal()`, `generatePassword()` |
| BR-06 | The credential's code and name are copied in | `writeAudit()` |
| BR-07 | Counts and summary follow the range and the search; only the tab narrows the list | `auditLogs()` — `$ranged` without the tab |
| BR-08 | Day totals cover every page | `auditDayGroups()` |
| BR-09 | Custom dates are the viewer's calendar days; no future dates; From ≤ To | `auditQuery()` |
| BR-10 | The export is the current view, newest first, at most 10,000 rows, and is itself recorded | `exportAuditLogs()` |
| BR-11 | One entry per import run | `persistCredential()` — `$this->importing` |

---

## 13. Known Issues

| # | Issue | Effect |
|---|---|---|
| 1 | Purged credentials leave the owner's view | The owned-credential branch uses `withTrashed()`; after `forceDelete()` the row is gone, so entries on it by people outside the owner's scope — including the System `purge` row — disappear for the owner |
| 2 | Expiry `lock` rows are written lazily | `sweepUnlocks()` runs from the vault lists, show, reveal, the dashboard and the access-request endpoints — not from `auditLogs()` |
| 3 | The credential export always records module *Team Vault* | Even for a My Vault export |
| 4 | A failed typed import is still recorded as imported | `runTypedImport()` writes `importx` (*0 … credentials imported*) inside a committed transaction, then answers 422 |
| 5 | Field copies are stored as `view` | `logEvent` maps `action=copy` to `view`, so the `copies_exports` summary does not count them |
| 6 | Legacy reveal rows | `activity()` hides `reveal` rows with detail *All stored values returned by the detail API*; the audit page does not |
| 7 | `auditMessages()` defines `before_or_equal` messages no rule uses | The future-date check is the manual `reject()` in `auditQuery()` |
| 8 | `X-CredVault-Count` is not in `Access-Control-Expose-Headers` | Cross-origin, the toast falls back to `meta.total` |
| 9 | `ACT_ICON` has no icon for `forward_mgr`, `otp_sent`, `generate` | They show the eye icon |
| 10a | `otp_sent` rows have no credential code | `sendOtp()` loads the credential without `code`, so `credential_code` is null — the chip and the export's Credential ID are blank |
| 10b | One share writes two `share` rows | Both count toward the critical count on a Critical Vault credential |
| 10 | Secrets shown or copied in the unlocked Critical Vault popup and drawer are not recorded | Those views read plain values from the detail call instead of `/reveal` (see the Critical Vault Technical Documentation) |

---

## 14. Metrics

| Item | Count |
|---|---|
| Audit routes | 2 |
| Related routes serving or reading audit data | 5 (`/meta` serves the catalogue only) |
| Write call sites | 34 (28 in `CredVaultController`, 6 in `AccessRequestController`) |
| Action keys | 28 |
| Severities | 3 |
| Tabs returned / shown | 4 / 3 |
| Range options | 5 |
| Export columns / row cap | 13 / 10,000 |
| Table columns / indexes | 15 / 6 |
| Migrations | 1 create + 1 data rewrite |
| Frontend files (page) | 2 (334 + 405 lines) |

---

## 15. Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The Branch User (`user_type = branch_user`) of a branch |
| Entry / event | One `credvault_audit_logs` row, shown as EVT-{id} |
| Writer / reader | `audit()` + `writeAudit()` / `auditQuery()` + `auditLogs()` + `exportAuditLogs()` |
| Catalogue | `AuditLog::ACTIONS` |
| Base severity | The catalogue's severity for an action, before the critical raise |
| Denormalised | The credential's code and name copied into the row |
| `tz` | The viewer's time zone |
