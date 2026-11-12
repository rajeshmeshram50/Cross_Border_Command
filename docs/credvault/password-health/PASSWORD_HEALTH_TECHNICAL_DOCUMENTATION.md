# CredVault Password Health — Technical Documentation

> Jira **GT-75**. Routes and payloads: the API document. Behaviour on screen:
> the Functional document. This one is how it is built and why.

## 1. Stack

| Layer | Technology |
|---|---|
| Backend | PHP 8.2, Laravel 12, Carbon 3 (`nesbot/carbon 3.14.2`) |
| Database | PostgreSQL (`DB_CONNECTION=pgsql`) |
| Auth | Sanctum bearer token → `user.active` → `tenant` → `throttle:credvault` |
| Frontend | React 19 + TypeScript, Vite |
| Generator | in-browser (`resources/js/pages/credvault/generator.ts`) — no server call |

---

## 2. Architecture

```
PasswordHealth.tsx  (/credentials-vault/password-health)
  │  cvApi.health({tab,q,page,per_page})  →  GET /api/credvault/health
  │  (branch_id is injected by api.ts on every GET — and ignored here)
  ▼
CredVaultController::health()
  ├─ tenantUser()            403 if no client / no module grant
  ├─ validate listRules()    tab ∈ all|weak|reused|twofa|rotation|shared|fixed
  ├─ Policy::for(client)     DEFAULTS ⊕ stored settings, memoised per request
  ├─ healthScope($u)         visibleQuery → accessMap → keep 6 "vias"
  ├─ healthIssues()          one shares query; issuesOf() per credential; sort
  ├─ search / tabs / slice   in memory
  ├─ tabs.fixed              AuditLog count (action = health_fixed)
  └─ healthSummary()         score, level, cards — always the whole scope
  ▼
{ status, summary, data, tabs, meta }

Fix ──► CredentialFormModal ──► PUT /credvault/{normal|critical}-vault/credentials/{id}
          persistCredential(): singleIssues() before ─► save ─► singleIssues() after
          diff by type → audit health_fixed → data.health {resolved, still_open}
```

**Nothing is persisted by Password Health.** There is no issues table, no job,
no cache. Every request recomputes from the credential rows, the live shares
and the policy. The only persistent trace is the `health_fixed` audit row
written by a credential update.

---

## 3. Data model — only the columns Password Health reads

Column lists from the live schema (`Schema::getColumnListing()`, PostgreSQL,
12 Nov 2026).

### 3.1 `credvault_credentials` (model `Credential`, `SoftDeletes`)

Full listing: `id, client_id, branch_id, code, type, category_group, name,
scope, owner_id, department_id, url, username, secret, secret_hash, fields,
notes, attachments, risk, strength, has_password, twofa, rotation_days,
password_changed_at, lock_admin, lock_manager, lock_otp, lock_admin_user_id,
lock_manager_user_id, totp_secret, totp_linked_at, created_by, updated_by,
deleted_by, created_at, updated_at, deleted_at, vault, twofa_method,
twofa_email, twofa_linked_at`.

Read by the health pass (via `LIGHT_COLUMNS` — **never `secret`, `fields`,
`notes` or `totp_secret`**):

| Column | Type | Used for |
|---|---|---|
| `client_id` | bigint | tenant scope |
| `branch_id` | bigint null | Branch Admin reach (`accessMap`) |
| `code` | varchar(20) | display, sort, search |
| `vault` | varchar(10) `normal`/`critical` | not filtered — both vaults are checked |
| `type`, `category_group`, `name`, `url` | | display, search |
| `scope` | `personal`/`team` | reach (only team is reachable by others) |
| `owner_id`, `department_id` | | reach |
| `risk` | `low`/`medium`/`high`/`critical` | severity, 2FA requirement, over-share rule |
| `strength` | tinyint 0–4 | **weak** — stored at save, compared at read |
| `has_password` | bool | gate for weak / reused / rotation |
| `secret_hash` | varchar(64), indexed | **reused** |
| `twofa` | `yes`/`no`/`na` | **twofa** |
| `rotation_days` | smallint null | **rotation** |
| `password_changed_at` | timestamp null | rotation age |
| `updated_at` | timestamp | rotation age fallback |
| `deleted_at` | timestamp null | bin items excluded by the global scope |

### 3.2 `credvault_shares` (model `CredentialShare`)

Listing: `id, client_id, credential_id, shared_by, recipient_type,
recipient_user_id, recipient_department_id, permission, reason, expires_at,
revoked_at, revoked_by, created_at, updated_at`.

Read: `credential_id`, `permission` (`use, view, copy, full`), and the `live()`
scope — `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`.

### 3.3 `credvault_policies` (model `Policy`)

Listing: `id, client_id, settings, updated_by, created_at, updated_at`. One row
per client; `settings` is JSON. *"a key the row does not hold reads its
default, so new settings need no migration."* Keys read here:
`min_strength`, `twofa_risks`, `rotation_warn`, `overshare_limit`.

### 3.4 `credvault_audit_logs` (model `AuditLog`)

Listing: `id, client_id, branch_id, user_id, action, severity, credential_id,
credential_code, credential_name, module, detail, meta, ip, user_agent,
created_at`.

Read for `tabs.fixed` and `?tab=fixed`; **written** by a credential update:
`action = 'health_fixed'` (label "Health issue resolved", severity `info`),
`module = 'Password Health'`, `detail = "{issue} — resolved"`, `meta = {type,
severity, issue, detail}`.

---

## 4. Scope — which rows enter the pass

```php
protected function healthScope(User $u): Collection
{
    $all = $this->visibleQuery($u)->select(self::LIGHT_COLUMNS)->with('owner:id,name')->get();
    $acc = $this->accessMap($all, $u);

    return $all->filter(fn ($c) => in_array($acc[$c->id][1] ?? null, ['owner', 'admin', 'branch', 'manager', 'hod', 'team'], true))
        ->each(fn ($c) => $c->setAttribute('_rank', $acc[$c->id][0]))->values();
}
```

`visibleQuery()` is called **without** `$branchCritical`, so the "every
critical credential of my branch" clause is off. `accessMap()` returns `[rank,
via]`; only `share` and `branch_critical` are dropped. The rank is kept on the
model as `_rank` to compute `can_fix`:

```php
// Fixing means editing; a team member's copy access cannot.
'can_fix'    => ($c->_rank ?? self::RANK_FULL) >= self::RANK_FULL,
```

**Known scope facts**

| Fact | Consequence |
|---|---|
| `vault` is not filtered | Critical Vault credentials are checked (also stated in `docs/credvault/README.md` §6 rule 6) |
| `accessMap` grants nothing on someone else's personal credential | personal credentials of overseen people are never checked, even though `visibleQuery` lists them |
| `team` via has `RANK_COPY` | the only source of `can_fix = false` |
| The Dashboard's hygiene card filters `via !== 'share'` instead of this whitelist | it would also count a credential reached only as `branch_critical`; in practice `visibleQuery` without `$branchCritical` rarely returns one. *Not verified with data.* |

The same scope is reused by `policyInsights()` (the Policies screen's live
numbers) and by Import duplicate detection (`importPreview`, line ~1868).

---

## 5. The checks, as code

### 5.1 Strength — `Credential::strengthOf()`

```php
$mixed = preg_match('/\p{L}/u', $pw) && preg_match('/\p{N}/u', $pw) && preg_match('/[^\p{L}\p{N}\s]/u', $pw);
$len   = mb_strlen($pw);
return match (true) { $mixed && $len >= 12 => 4, $mixed && $len >= 8 => 3, default => 2 };
```

`STRENGTH_LABELS = [0 => '', 1 => 'Weak', 2 => 'Fair', 3 => 'Good', 4 =>
'Strong']` — *"1 (Weak) is no longer given — Fair is the lowest and counts as
weak."* Strength is computed and stored on save (`persistCredential`); the
migration `2026_11_04_000001_recompute_credvault_password_strength` recomputed
every stored value when the D34 rule replaced the old 5-point meter.

**Consequence:** a stored password always has strength 2, 3 or 4. With
`min_strength = 2` the weak check can never fire; with `3`, only Fair fires
(`Weak password`); with `4`, Good fires as `Password below the policy minimum`.

### 5.2 Reuse — `secret_hash`

```php
/** HMAC under the app key: equal secrets match, the hash alone reveals nothing. */
public static function hashSecret(?string $secret): ?string
{
    if ($secret === null || $secret === '') return null;
    return hash_hmac('sha256', $secret, (string) config('app.key'));
}
```

`healthIssues()` groups the scope by hash once:

```php
$byHash = $creds->filter(fn ($c) => $c->has_password && $c->secret_hash)->groupBy('secret_hash');
```

- The hash is written for every type with a main secret, but reuse only counts
  rows with `has_password` — so an API key equal to a password is not "reuse".
- Reuse crosses **types** and **owners**, but never leaves the viewer's scope.
- **Rotating `APP_KEY` silently breaks reuse detection** (old hashes no longer
  match new ones) as well as decryption of every secret. There is no rehash job.

### 5.3 2FA

`twofa === 'no' && in_array($c->risk, $pol['twofa_risks'], true)`. In the
Critical Vault, a type without its own switch stores `twofa = lockOtp ? 'yes'
: 'na'` (line ~3406), so it can never be `no` and never fires.

### 5.4 Rotation — `rotationState()`

```php
if (!$c->has_password || !$c->rotation_days) return ['state' => null, 'due' => null, 'age' => null];

$since = $c->password_changed_at ?? $c->updated_at ?? now();
$age   = (int) $since->diffInDays(now());
$due   = $since->copy()->addDays($c->rotation_days);
$state = $age > $c->rotation_days ? 'over' : ($c->rotation_days - $age <= $pol['rotation_warn'] ? 'soon' : 'ok');
```

- Carbon 3's `diffInDays()` returns a float; the cast truncates to whole days.
- The `updated_at` fallback means a legacy row with no `password_changed_at`
  has its age reset by **any** edit. New rows set `password_changed_at` on
  create and whenever the secret changes (`if ($changed && filled($secret))`).
- `rotationState()` is also used by the list rows (`row()`) and the dashboard.

### 5.5 Over-share — `shareBreakdown()`

```php
/** [credential_id => [permission => live shares]] in one query. */
CredentialShare::live()->whereIn('credential_id', $ids)
    ->selectRaw('credential_id, permission, count(*) as n')->groupBy('credential_id', 'permission')->get()
```

Fires on `array_sum($shares) >= overshare_limit` or `risk = critical && full >
0`. One query for the whole scope.

### 5.6 Severity and sort

Severity per check is in the API document §4.2. Sort: `SEVERITY_RANK`
(`critical 0, high 1, medium 2`), then `code` as a string. `healthIssues()`
declares its own `$rank` literal with the same values instead of using the
constant.

### 5.7 The docblock is out of date

```php
/**
 * The prototype's six checks (phIssues), with its wording. …
 */
protected function issuesOf(…)
```

There are **five** checks (rotation has two states). The `health()` docblock
also still lists `fixed` as a tab, which is true of the API, not the screen.

---

## 6. The score — `healthSummary()`

```php
$total   = $creds->count();
$risky   = $issues->pluck('credential.id')->unique();
$failed  = $risky->count();
$passed  = $total - $failed;
$score   = $total ? (int) round($passed / $total * 100) : 100;
…
'level'  => $score >= 80 ? 'Good' : ($score >= 60 ? 'Fair' : 'At risk'),
```

Card denominators (`of`), quoted from the method's docblock:

```
weak, reused   — credentials with a password
twofa          — credentials whose risk level the policy requires 2FA for (2FA not "N/A")
rotation       — credentials with a password and a rotation period
shared         — every credential checked
```

*"A credential can fail several checks, so the five add up to more than
`failed`; `attention.multiple` is how many fail more than one."*

The summary is passed the **unfiltered** issue collection, so it never follows
`q` or `tab`. The screen recomputes the level from `score` with the same
thresholds rather than reading `level`.

---

## 7. The Fix diff — inside `persistCredential()`

```php
$scopeIds = $creating ? [] : $this->healthScope($u)->pluck('id')->all();
$before = $creating ? [] : $this->singleIssues($c, $pol, $scopeIds);
…  // inside the transaction, after $c->save()
// Password Health → Resolved: every issue this save made go away.
$open = $creating ? [] : $this->singleIssues($c, $pol, $scopeIds);
foreach ($before as $issue) {
    if (in_array($issue['type'], array_column($open, 'type'), true)) continue;
    $resolved[] = $issue;
    $this->audit($u, 'health_fixed', $c, $issue['issue'] . ' — resolved', […], 'Password Health');
}
```

`singleIssues()` — *"its reuse read against the same vaults the Health list
checks — so a save resolves exactly what the list showed."* It queries
`secret_hash` matches with `->when($scopeIds, …)->limit(10)`.

| Detail | Effect |
|---|---|
| Compared **by type** | `Rotation due soon` → `Rotation overdue` is still open |
| `before` computed **outside** the transaction | a concurrent edit between the two reads can mis-attribute a resolution; harmless (an extra or missing audit row) |
| `->when($scopeIds, …)` | if the editor's scope is empty (Full Access only through a share), reuse is checked against the **whole client**. Only `type/severity/issue` reach the response, so no names leak, but it can report "Password reused" for a credential whose twin the editor cannot see. *Edge case, not tested.* |
| `limit(10)` | the save's reuse list is capped; the type is all that matters for the diff |
| create | `before = open = []`, no `health` key, no audit |

The response:

```php
if (!$creating) {
    // The Fix flow's toast: "N health issues resolved" or "Saved — the issue is still open".
    $body['health'] = [ 'resolved' => …, 'still_open' => … ];
}
```

This runs on **every** update from any screen (My Vault, Team Vault, Critical
Vault), not only when the form was opened from Password Health. Only the
Health page reads it.

---

## 8. Concurrency

The three health routes are pure reads: no locks, no writes. The only race is
the before/after window in §7. Two people fixing the same credential at once
both get a correct `still_open` for their own save; the second may log nothing
as resolved because the first already removed the issue.

---

## 9. Multi-tenancy

| Where | How |
|---|---|
| `client_id` | `tenantUser()` → `$u->client_id`; every query (`visibleQuery`, `AuditLog`, `singleIssues`) filters on it |
| `branch_id` | never read from the request; Branch Admin reach comes from `adminBranchOf($u)` |
| Scope deliberately wider than "mine" | client admin, Branch Admin, manager, HOD routes — so a reviewer can fix team credentials they are answerable for |
| Scope deliberately narrower than "visible" | `share` and `branch_critical` excluded — *"never ones only shared with them"* |

---

## 10. Performance

Every `/health` call loads the whole scope (light columns), runs one share
query, one audit `count`, and builds every issue in PHP — then slices a page.
For a client admin this is every team credential of the company. Typing in the
search box issues one call per debounce (350 ms). The old API sheet recorded
15–20 ms per call on test data; *not re-measured for this document.*

---

## 11. Frontend internals

| Piece | Detail |
|---|---|
| State | `tab, q (debounced), page, perPage, rows, tabs, summary, meta`; `seq` ref discards stale responses |
| Load | one `cvApi.health()` per change of tab / search / page / page size; `load(true)` after a save reloads without the shimmer |
| `SEV_BY_TYPE` | `{ weak: 'critical', reused: 'high', twofa: 'medium', rotation: 'critical', shared: 'medium' }` — overrides `x.severity` |
| Card numbers | `cards[].failed` / `of` / `pct` / `sub` from the API; fall-backs to `tabs[k]` and computed lines exist "for an older API" |
| Alignment | `credvault.css` "Password Health table": centre by default; columns 3, 4, 5, 7, 8 left. The comment still says "Suggested Action / Resolved On" |
| Scan race | `scan()` treats a `null` from `load()` as failure — a response superseded by a newer request (tab clicked mid-scan) shows "Health check failed" though nothing failed |
| Unused | `PH_I.fixed` icon (now only on the empty state and explainer); `HealthIssue.resolved_at/resolved_by` |

---

## 12. Where every field's data comes from

| On screen | Endpoint | Source |
|---|---|---|
| Score ring, level, healthy line, "need attention" | `GET /health` → `summary` | `healthSummary()` over `credvault_credentials` |
| Five cards | `summary.cards[]` | same |
| Tab badges | `tabs` | in-memory count after search |
| Rows | `data[]` | `issuesOf()` + `issueCredential()` |
| Type icon on the row | `GET /credvault/meta` (`useCvMeta().typeOf`) | `Credential::TYPES` |
| Reused "same as" pills | `details.same_as` | same-hash credentials in scope |
| Over-shared counts | `details.by_permission` | `credvault_shares` live rows |
| Generator policy minimum | `meta.policy.min_strength` | `credvault_policies` |

### Derived on the server, never accepted from the client

Strength, `has_password`, `secret_hash`, `password_changed_at`, every issue,
severity, `can_fix`, and `health.resolved/still_open`.

---

## 13. Things this module does NOT do

- No stored issue state, snooze, or acknowledgement.
- No background or scheduled scan — "Run Health Check" is a re-GET.
- No per-branch view — the branch switcher is ignored.
- No exclusion of Critical Vault credentials (it currently includes them).
- No use of `/health/attention` or the `fixed` tab by the current screen.
