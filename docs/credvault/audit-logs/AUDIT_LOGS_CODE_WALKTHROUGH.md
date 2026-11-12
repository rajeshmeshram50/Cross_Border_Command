# CredVault Audit Logs — Code Walkthrough

| | |
|---|---|
| **Jira** | GT-118 (parent GT-85 — CredVault Audit Logs Documentation) |
| **Module** | CredVault → Vault Administration & Security → Audit Logs |
| **Audience** | Developers joining the module, code reviewers, tech leads |
| **Companion documents** | Functional Documentation · Technical Documentation · API Documentation |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document walks through the Audit Logs **code** in the order it runs: an action writes an entry, the reader decides who may see it, the page loads and groups it by day, and the export downloads it. Each section names the function, says what it does and quotes the lines that matter. Read it next to the source. For what the user sees, read the Functional Documentation; for request and response shapes, read the API Documentation.

### 1.2 The walkthrough in one paragraph

Any CredVault action calls `audit()`, which fills the actor and the module and hands over to `writeAudit()`; that picks the severity (raising reveal, copy and share on a Critical Vault credential to critical), copies the credential's code and name in, and saves the row. The page, `AuditLogs.tsx`, builds its filters, calls `cvApi.audit()` with the browser's time zone, and the server's `auditLogs()` runs `auditQuery()` — the viewer's visible rows plus the filters — to count the tabs, page the timeline, shape each row with `eventRow()` and head each day with `auditDayGroups()`. **Export Logs** sends the same filters to `exportAuditLogs()`, which writes the file and records an entry of its own.

### 1.3 How to read this document

Line numbers drift as the code changes; **function names are stable**, so search for the name. "Base" means `CredVaultController`, which every CredVault controller extends.

| Callout | Meaning |
|---|---|
| **Explanation** | Why the code is written this way, usually from a comment in the source |
| **Common misunderstanding** | Something a reader of the code often gets wrong |
| **Worth testing** | A path that is easy to break when the code is changed |

### 1.4 Key ideas to understand first

| Idea | What it means in the code |
|---|---|
| Vault Admin | The **Branch User**; `adminBranchOf($u)` returns their branch |
| `audit()` / `writeAudit()` | The writer — every action goes through them |
| `auditQuery()` | The reader's base — every list, count, day group and export starts here |
| `AuditLog::ACTIONS` | The catalogue: `key => [label, base severity]` |
| `RAISE_ON_CRITICAL` | `reveal`, `copy`, `share` — saved as `critical` on a Critical Vault credential |
| `tz` | The viewer's time zone, from `Intl.DateTimeFormat()`; default `Asia/Kolkata` |
| Memo | `$this->memo(key, fn)` — a per-request cache (`downlineIds`, `userInfo`, the module check) |

---

## 2. Where the Code Lives

### 2.1 Files

| File | Lines | What it holds |
|---|---|---|
| `app/Http/Controllers/Api/CredVault/CredVaultController.php` | 5,746 | The writer, the reader, the export, `eventRow`, `userInfo` |
| `app/Http/Controllers/Api/CredVault/CriticalVault/AccessRequestController.php` | 427 | 6 more `audit()` calls |
| `app/Models/CredVault/AuditLog.php` | 82 | The model and the catalogue |
| `database/migrations/credvault/2026_10_30_000005_create_credvault_audit_logs_table.php` | — | The table |
| `resources/js/pages/credvault/audit/AuditLogs.tsx` · `audit.css` | 334 · 405 | The page and its styles |
| `resources/js/pages/credvault/cvApi.ts` · `shared.tsx` | 419 · 663 | The API client, the shared UI |

### 2.2 The flows, and the function that runs at each step

| # | Flow | Entry point |
|---|---|---|
| 1 | Every call | `tenantUser()`, `reject()`, `inTransaction()`, `memo()` |
| 2 | Writing an entry | `audit()` → `writeAudit()` |
| 3 | Who sees what | `auditQuery()` |
| 4 | Loading the page | `AuditLogs` → `cvApi.audit()` → `auditLogs()` |
| 5 | Shaping a row | `eventRows()` → `eventRow()` → `userInfo()` |
| 6 | Day headings | `auditDayGroups()` and the page's grouping |
| 7 | Exporting | `exportLogs()` → `cvApi.auditExport()` → `exportAuditLogs()` |
| 8 | Writers worth knowing | import, reveal, drawer events, unlock expiry, purge |

---

## 3. Every Call — the Plumbing

| Function | What it does |
|---|---|
| `tenantUser($request)` | No `client_id` → 403 *CredVault needs a company account — this login has no tenant.* Then, memoised per user, a `Permission` row with `can_view` on the `credentials-vault` module — else 403 *You do not have access to Credentials Vault…* |
| `reject($message, $field = null, $status = 422)` | Throws `{ status: false, message, errors? }`; with a field, `errors = { field: [message] }`. The date checks and the empty-export check use it |
| `inTransaction($action, $work)` | Wraps `DB::transaction()`. A refusal passes through; anything else is logged and becomes a 500 *Could not ‹action›. Nothing was saved — please try again.* |
| `memo($key, $fn)` | A per-request cache: `down:{id}` (`downlineIds`), `tree:{client}` (the reporting tree), `module:{id}` (the module check). `userInfo` and `swept:{client}` write to the same `$this->memo` array directly |

> **Explanation: a refused action normally leaves no entry.** An audit row written inside `inTransaction()` rolls back with the rest of the work, so a failed action records nothing. Three exceptions commit their entry and then refuse: `backupfail` (its own transaction before `reject()`), `otp_failed` (committed inside `verifyOtp()`, then 423), and a typed import with zero rows (Known Issue 4).

---

## 4. Writing an Entry

### 4.1 `audit($u, $action, $c = null, $detail = null, $meta = [], $module = null)`

| Step | What happens |
|---|---|
| 1 | Takes `client_id`, `id` and `branch_id` from the actor |
| 2 | When the caller gives no module, picks it from the credential (table below) |
| 3 | Calls `writeAudit()` with no severity override |

| Credential | Module |
|---|---|
| A Critical Vault credential | *Critical Vault* |
| A team credential | *Team Vault* |
| Otherwise | *My Vault* |
| No credential | `null` |

### 4.2 `writeAudit($clientId, $userId, $branchId, $action, $c, $detail, $meta, $module, $severity = null)`

```php
$severity ??= AuditLog::ACTIONS[$action][1] ?? 'info';
if ($c && /* a Critical Vault credential */ && in_array($action, AuditLog::RAISE_ON_CRITICAL, true)) $severity = 'critical';
AuditLog::create([ ... ]);
```

| Column | Value |
|---|---|
| `credential_id`, `credential_code` | From `$c`, or `null` |
| `credential_name` | `Str::limit($c->name, 150, '')` |
| `detail` | `Str::limit($detail, 500, '')`; empty → `null` |
| `meta` | `$meta ?: null` |
| `ip` | `request()?->ip()` |
| `user_agent` | `Str::limit(userAgent, 255, '')` |
| `created_at` | `now()` (UTC) |

The raise to `critical` wins even over an explicit override. Three callers use `writeAudit()` directly because they need what `audit()` cannot give:

| Caller | Why |
|---|---|
| `exportAuditLogs()` | Severity override `info` |
| `sweepUnlocks()` | The actor is the requester, not the signed-in user; `branch_id = null` |
| `purgeOne()` | The actor may be `null` (System); module *Recycle Bin* |

---

## 5. Who Sees What — `auditQuery($u, $f)`

### 5.1 The scope

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

| Piece | Meaning |
|---|---|
| `$people` | The viewer plus `downlineIds()` — the HR reporting tree below them at any depth (`employees.reporting_manager_id` / `reporting_manager_user_id`), loops cut by a `seen` set |
| Owned credentials | Every row on a credential the viewer owns — trashed credentials included |
| `$branch` | For the Vault Admin: every non-admin user of their branch |

> **Explanation.** The source comment: *"Your team's activity, as the vaults define the team: your reporting line, and for a Branch Admin every person of the branch below them — plus events on credentials you own."*

### 5.2 The filters, in order

| Step | Code | Rule |
|---|---|---|
| 1 | `$today = now($tz)->toDateString()` | `from` or `to` later than today → 422 *From / To cannot be in the future.* — for **every** range |
| 2 | `match ($f['range'] ?? '30d')` | `24h` / `7d` / `30d` → `created_at >= now()->subDay() / subDays(7) / subDays(30)`; `custom` → `Carbon::parse($from, $tz)->startOfDay()->utc()` and `…->endOfDay()->utc()`, each only when given; `all` → nothing |
| 3 | Custom with both ends | `from > to` → 422 *From must be on or before To.* |
| 4 | `match ($f['tab'] ?? 'all')` | `mine` → `user_id = me`; `team` → `user_id IS NULL OR user_id != me`; `alerts` → `severity = 'critical'` |
| 5 | `action`, `credential_id` | Equality |
| 6 | `q` | See 5.3 |

### 5.3 The search

```php
$like    = $this->likeTerm($term);
$t       = mb_strtolower(trim($term));
$actions = collect(AuditLog::ACTIONS)->filter(fn ($a) => str_contains(mb_strtolower($a[0]), $t))->keys()->all();
$eventId = preg_match('/^(evt-)?(\d+)$/i', $t, $m) ? (int) $m[2] : null;
```

One `where` group: `lower(coalesce(detail,''))`, `credential_name`, `credential_code`, `module` like `$like`; `user_id IN` the company's users whose name is like; `action IN $actions` (labels containing the term, so *copied* finds `copy`); `id = $eventId` for *123* or *EVT-123*.

The same builder serves the page, the export, the day groups and the dashboard.

> **Worth testing.** Search *EVT-1042* and *1042*: both must include event 1042 (*1042* may also return events whose code or detail contains 1042). Search *copied*: every *Password copied* entry must appear, though the word is only in the label.

---

## 6. Loading the Page

### 6.1 `AuditLogs.tsx` — state and filters

| Piece | Rule |
|---|---|
| Defaults | `tab = 'all'`, `range = '30d'`, `perPage = PER_PAGE` (10) |
| From the URL | `action` read once from `?action=`; `credId` / `credLabel` from `?credential_id=` / `?credential=` |
| `actions` | A `Map` of `meta.audit_actions` by key, from `useCvMeta()` |
| `filters` | `{ tab, range, from / to (only when range === 'custom'), action, credential_id, q: dq }` |
| Search | `useDebounced(q.trim())` — 350 ms; the input has `maxLength={100}` to match the API's `q` limit |
| Tabs | `TABS` = All / My / Team Activity — *"No Security Alerts tab on this page (removed on request); the API's tab=alerts is untouched"* |
| `CustomRange` | Opens on today–today, `maxDate = today`, and refuses From > To on the client before Apply (*"From" must be on or before "To".*) |

### 6.2 Paging without an extra effect

```ts
const fkey = JSON.stringify({ ...filters, perPage });   // a new filter or page size starts again at page 1
const [pg, setPg] = useState({ key: fkey, page: 1 });
const page = pg.key === fkey ? pg.page : 1;
```

When any filter changes, `pg.key` no longer matches, so the page reads as 1 — without a separate "reset the page" effect.

### 6.3 `load()`

```ts
const my = ++seq.current;
const r = await cvApi.audit({ ...filters, page, per_page: perPage });
if (my !== seq.current) return;
setRows(r.data); setApiGroups(r.groups ?? []); setTabs(r.tabs ?? {}); setPm(r.meta);
if (r.meta && page > r.meta.last_page && r.meta.last_page >= 1) setPage(r.meta.last_page);
```

A stale answer is dropped; a page past the last one steps back; a failure stores the message and clears the rows. `cvApi.audit()` adds `tz: viewerTz()` (`Intl.DateTimeFormat().resolvedOptions().timeZone`).

### 6.4 `auditLogs()` — the server

| Step | Code |
|---|---|
| 1 | `tenantUser()`; `validate(auditRules(), auditMessages())` — `listRules(['all','mine','team','alerts'])` + `range`, `from`, `to` (`date_format:Y-m-d`), `tz` (`timezone:all_with_bc`), `action` (catalogue keys), `credential_id` |
| 2 | `$f['tz'] ??= 'Asia/Kolkata'` (`AUDIT_TZ`) |
| 3 | `$ranged = auditQuery($u, $f without tab, page, per_page)` |
| 4 | `summary` — one `selectRaw` over `$ranged` (events, by me, views + reveals, copies + exports, access changes, critical, distinct other people) + the most active person (*You (Name)* when it is the viewer) |
| 5 | `tabs` — four `count()` calls on clones of `$ranged` |
| 6 | The page — `auditQuery($u, $f)->with('user:id,name,user_type')->orderByDesc('created_at')->orderByDesc('id')->paginate($f['per_page'] ?? 15, …)` |
| 7 | `eventRows()`, then the response `{ status, summary, data, groups: auditDayGroups(…), tabs, meta }` |

> **Common misunderstanding.** "A tab switch changes the counts." The counts come from `$ranged`, which has **no** tab, so they stay; only the list (`data`, `groups`, `meta`) changes.

---

## 7. Shaping a Row

### 7.1 `eventRows()` and `eventRow()`

| Step | What happens |
|---|---|
| 1 | One `Credential::withTrashed()->whereIn(id)` read for `id, risk, type, vault`, keyed by id |
| 2 | `userInfo()` primed for every actor on the page |
| 3 | Per row: `$local = created_at` in `tz` |
| 4 | `actor` — `name` is *You* for the viewer, else the user's name; `initials()` from the first and last word; `role` from `userInfo()` (default *Team member*). For `user_id = null`: *System* / *SY* / *CredVault* |
| 5 | `label` / `verb` from `ACTIONS` / `VERBS`, falling back to the raw key |
| 6 | `credential` only when `credential_id` is set; `risk`, `type`, `vault` are `null` only after the credential is **purged** (binned credentials still supply them, via `withTrashed()`) |
| 6a | Also returned: `date`, `time`, `seconds`, `local_at`, `chip` — the page groups by `e.date` and shows `e.time` / `e.seconds` |
| 7 | `sentence` = actor + verb + credential name (or code); `target` = the code, or *Vault settings* |

### 7.2 `userInfo($ids)`

Batch-loads users, their `Employee` rows (with designation) and departments for ids not yet cached. `role_line` is *‹designation› · ‹department›*, trimmed, or *Team member* when neither is known. A deleted user is cached as `[]` and falls back to *Team member*.

### 7.3 The page's row

| Piece | Code |
|---|---|
| Icon | `ACT_ICON[e.action] ?? IC.view`, coloured by the **catalogue** severity (`alh-node--{a.severity}`) |
| Card tone | `alh-it--{e.severity}` — the **stored** severity |
| Sentence | `<b>{actor.name}</b> {e.verb \|\| a.verb \|\| 'updated'}`, then the credential name as a clickable link |
| Click on the name | `pickCred(e)` → `credId = credential.id`, `credLabel = "name · code"` |
| Pill | `severity_label`, else `SEV_FALLBACK` |
| Detail | A toggle only when `detail !== label`; `toggle(id)` adds or removes the id in `open` |
| Footer | *code · Risk* or `target`; the module; the IP; `event_id` |

---

## 8. Day Headings

### 8.1 `auditDayGroups($u, $f, $dates)`

```php
$day = "to_char((credvault_audit_logs.created_at AT TIME ZONE 'UTC') AT TIME ZONE ?, 'YYYY-MM-DD')";
$counts = $this->auditQuery($u, $f)->selectRaw("{$day} as d, count(*) as n", [$tz])
    ->whereRaw("{$day} in (...)", array_merge([$tz], $dates))->groupBy('d')->pluck('n', 'd');
```

For each date on this page: `date`, `date_display` (*d/m/Y*), `label` (*Today* / *Yesterday* / the weekday), `heading`, `events`, `events_label`. Because the count runs over the whole filtered view, a day split across two pages shows the same full total on both.

### 8.2 Grouping on the page

Rows are walked in order; a new group starts whenever the day (the API's `date`, or a browser-formatted day as a fallback) changes. With an API group the label (`label`), date (`date_display`) and count (`events`) come from it — `heading` is returned but unused; without one the page uses `dayLbl(e.at)` and counts the rows on this page.

> **Explanation.** The source comment: *"keyed by the day itself — two 'Tuesday's never merge."*

---

## 9. Exporting

### 9.1 `exportLogs()` — the page

| Step | What happens |
|---|---|
| 1 | `pm.total` is 0 → `toast.warning('No events to export for this view')` |
| 2 | `exporting = true` — the button reads *Exporting…*; it is disabled while exporting **and** while the list is loading |
| 3 | `cvApi.auditExport(filters)` — the same filters as the list, no page, no `format` |
| 4 | Success → `n = x-credvault-count` (else `pm.total`); `toast.success('‹n› events exported as CSV', file name)`; `load()` so the new `export` entry shows |
| 5 | A 422 → `toast.warning(message)`; anything else → `toast.error('Export failed', message)` |

`download()` asks for a blob, reads the file name from `Content-Disposition`, clicks a temporary `<a download>`, and on an error whose body is a blob parses the JSON inside back into a `CvApiError`.

### 9.2 `exportAuditLogs()` — the server

| Step | Code |
|---|---|
| 1 | `tenantUser()`; `validate(auditRules() + format in csv \| xlsx)`; `tz` default; `$fmt = format ?? 'csv'` |
| 2 | `auditQuery($u, $f)->with('user:id,name')->orderByDesc('created_at')->orderByDesc('id')->limit(10000)->get()` |
| 3 | Empty → `reject('There are no events in this view to export.', null, 422)` |
| 4 | `userInfo()` for all actors; one `Credential::withTrashed()` read for the risk |
| 5 | Map the 13 columns; times via `created_at->copy()->setTimezone($tz)` |
| 6 | `VaultFile::xlsx(…)` (sheet *Audit Logs*, frozen header) or `VaultFile::build($cols, $data, 'csv')` |
| 7 | `writeAudit(…, 'export', null, 'Audit log exported · ‹n› events', ['rows' => n, 'kind' => 'audit_log'], 'Audit Logs', 'info')` |
| 8 | `download($body, "credvault-audit-log-{all-activity|my-activity|team-activity|security-alerts}-{Ymd in tz}.{fmt}", …, ['X-CredVault-Count' => n])` |

> **Explanation.** The source comment: *"The log leaving the system is itself on the record (as info — it carries no secret)."*

---

## 10. Writers Worth Knowing

| Flow | Method | Entry |
|---|---|---|
| Bulk import (CS-1479) | `runTypedImport()` sets `$this->importing = true` around the row loop; `persistCredential()` skips `create` while it is set. The untyped `runImport()` creates rows directly and never wrote `create` | **One** `importx`: *‹IM-code› · ‹n› ‹type› credentials imported[ · ‹k› failed]* (typed) / *… credentials imported from ‹source›* (untyped) |
| Reveal / copy | `reveal()` | `reveal` / `copy` with *‹Label› revealed / copied* and `meta.field` — the value is returned, never logged. It sets the module itself: `isProtected() ? 'Critical Vault' : 'My Vault'`, so a team-credential reveal reads *My Vault* |
| Add / Edit | `persistCredential()` | `create` (*‹Type› credential added*), `edit` (*Updated: …*), `totp_linked`, `health_fixed` |
| Attachment | `attachment()` | `view` with *Attachment opened: ‹name›* |
| Drawer events | `logEvent()` | `view` (*Opened credential details*), `launch` (*Launched ‹url›*), a plain-field copy stored as **`view`** (*‹Field› copied*) |
| Unlock expiry | `sweepUnlocks()` | `lock` under the requester, *Unlock window ended — locked again* — run by the credential lists, show, reveal, the dashboard and the access-request endpoints, not by `auditLogs()` |
| Purge | `purgeOne()` | `purge` written **before** `forceDelete()`, so the code and name are captured. Automatic: *Deleted automatically after ‹n› days in the bin* — by System from the bin list or the dashboard sweep, or by the admin when a shorter retention triggers it. Manual: *Deleted permanently* (`purge()`) / *Deleted permanently (Empty Bin)* (`emptyBin()`) by the user |
| Share / renew / email | `share()`, `mailShare()` | `share` (*Shared with X · View until dd/mm/yyyy*), and a **second** `share` from `mailShare()` after the transaction (*Share email to X: n sent*) — both raised to critical on a Critical Vault credential. Nothing is written when there are no recipients or mail is off |
| Revoke | `revokeShare()`, `binCredential()`, `endOrphanedShares()` | `revoke` |
| Bin / restore | `binCredential()`, `restore()` | `bin` / `restore` |
| Branch retention | `updateBinRetention()` | `policy` *Retention period for ‹Branch›: ‹a› days → ‹b› days*, module *Recycle Bin* |
| Backups | `backup()` | `backup`, or `backupfail` (committed, then refused) |
| Credential export | `export()` | `export`, module *Team Vault* |
| Generator | `generatePassword()` | `generate` *Password generated · 20 characters* |
| Access requests | `AccessRequestController`, `decide()`, `unlock()` | `request`, `forward_mgr`, `approve`, `reject`, `cancel`, `otp_sent`, `otp_failed`, `unlock`, `lock` |

> **Worth testing.** Import 10 credentials: exactly **one** *Credentials imported* entry must appear, and no *Credential added* entries.

---

## 11. Business Rules in the Code

| ID | Rule | Where it is kept |
|---|---|---|
| BR-01 | Every action writes through one writer | `audit()` / `writeAudit()` |
| BR-02 | Reveal, copy and share on a Critical Vault credential are critical | `writeAudit()`, `RAISE_ON_CRITICAL` |
| BR-03 | The credential's code and name are copied in | `writeAudit()` |
| BR-04 | A rolled-back action leaves no entry | `inTransaction()` |
| BR-05 | The viewer sees their own, their reporting line's and their owned credentials' entries; the Vault Admin also their branch's non-admin people | `auditQuery()` |
| BR-06 | Counts follow the filters but not the tab | `auditLogs()` — `$ranged` |
| BR-07 | A filter change goes back to page 1 | `fkey` / `pg` in the page |
| BR-08 | Day totals cover every page | `auditDayGroups()` |
| BR-09 | The export is the current view, at most 10,000 rows, and is recorded | `exportAuditLogs()` |
| BR-10 | One entry per import | `$this->importing` |
| BR-11 | A purge entry is written before the row is deleted | `purgeOne()` |

---

## 12. Known Issues

| # | Issue | Effect |
|---|---|---|
| 1 | No immutability guard on `AuditLog` | Only convention keeps rows unchanged; the 2026-11-03 migration is the one code path that updated rows |
| 2 | Owner scope and purges | `withTrashed()` cannot see force-deleted rows; after a purge the owner loses entries by people outside their own scope, including the System `purge` entry |
| 3 | The credential export always says *Team Vault* | Even for a My Vault export |
| 4 | `runTypedImport()` with nothing imported still commits an `importx` entry | *0 … credentials imported* is recorded, then a 422; the detail prints the raw type key (`login`) |
| 5 | `auditMessages()` maps `before_or_equal`, which no rule uses | The future-date check is the manual `reject()` |
| 6 | `X-CredVault-Count` is missing from `Access-Control-Expose-Headers` | Cross-origin, the toast falls back to `meta.total` |
| 7 | `ACT_ICON` lacks `forward_mgr`, `otp_sent`, `generate` | They show the eye icon |
| 8 | `summary` costs three queries per load | The page does not show it |
| 9 | `activity()` hides legacy reveal rows; `auditQuery()` does not | Old *All stored values returned by the detail API* rows still show on the page |
| 10 | The share-email detail stores the copy-to address unmasked | `ip` is also shown and exported |

---

## 13. Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The Branch User (`user_type = branch_user`) of a branch |
| Base | `CredVaultController` |
| Writer / reader | `audit()` + `writeAudit()` / `auditQuery()` + `auditLogs()` + `exportAuditLogs()` |
| `$ranged` | `auditQuery()` without the tab and paging — the base of the counts |
| Catalogue | `AuditLog::ACTIONS` |
| `tz` | The viewer's time zone |
| Memo | A value cached for one HTTP request |
