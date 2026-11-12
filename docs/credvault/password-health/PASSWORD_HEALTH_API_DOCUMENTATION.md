# CredVault Password Health — API Documentation

> Jira **GT-75**. Read `docs/credvault/README.md` first for how Password Health
> sits between My Vault, the Recycle Bin and Import / Export.

## 0. How to read this

Base URL `/api`. Every route below is in `routes/api.php` under

```
Route::middleware(['auth:sanctum', 'user.active', 'tenant'])      // line 163
  Route::prefix('credvault')->middleware('throttle:credvault')     // line 755
    // Password Health                                             // line 821
    Route::get('/health',           [CredVaultController::class, 'health']);
    Route::get('/health/summary',   [CredVaultController::class, 'healthSummaryView']);
    Route::get('/health/attention', [CredVaultController::class, 'healthAttention']);
```

Controller: `App\Http\Controllers\Api\CredVault\CredVaultController`.

**All three routes are read-only `GET`s.** Password Health stores nothing of its
own: every call recomputes the issues from the credentials and the tenant's
policy. The only write that belongs to this module happens inside a credential
**update** (section 5) — not on these routes.

**Response envelope**

```json
{ "status": true,  "data": …, "tabs": {…}, "meta": {…}, "summary": {…} }
{ "status": false, "message": "…", "errors": { "field": ["…"] } }
```

Validation failures (`$request->validate()`) use Laravel's default shape —
`{ "message": "…", "errors": {…} }` **without** `status` — because the app
registers no custom renderer in `bootstrap/app.php`.

| Status | When |
|---|---|
| `200` | Always, on success |
| `401` | No / expired Sanctum token; `user.active` aborts with `Account is no longer active. Please sign in again.` |
| `403` | No tenant, or no CredVault module grant (section 6) |
| `422` | `tab`, `q`, `page` or `per_page` out of range |
| `429` | More than **240 requests a minute** per user across all CredVault routes (`RateLimiter::for('credvault')` in `AppServiceProvider`) |

**Who may call.** `tenantUser()` admits a client admin always, and anyone else
only with `can_view` on the module slug `credentials-vault` in Permissions.
There is no further role check on these routes: *what* comes back depends on
who is asking (section 1).

**The branch switcher is ignored.** The Axios client adds `?branch_id=` to every
GET; none of the three methods reads it. A Branch Admin's reach comes from
their login, not from the switcher.

---

## 1. Which credentials are checked — the same set on all three routes

`healthScope($u)` = every credential returned by `visibleQuery($u)`, kept only
when `accessMap()` reaches it through one of six routes:

| `via` | Who | Access rank | `can_fix` |
|---|---|---|---|
| `owner` | You own it (personal or team, either vault) | Full | `true` |
| `admin` | Client admin — every **team** credential of the company | Full | `true` |
| `branch` | Branch Admin — team credentials of non-admin owners in their branch | Full | `true` |
| `manager` | Team credentials of anyone below you in the reporting line | Full | `true` |
| `hod` | Team credentials of a department you head, owner below your level | Full | `true` |
| `team` | Same, but the owner is at or above your level | **Copy** | **`false`** |

**Not checked:** credentials that reach you only through a share (`via =
share`), Critical Vault credentials you see only as `branch_critical` (View),
other people's **personal** credentials (accessMap grants nothing on them),
and anything in the Recycle Bin (`SoftDeletes` hides it).

**Checked although it may surprise you:** Critical Vault credentials (`vault =
critical`) that you own or reach through a team route. `healthScope()` does not
filter on `vault`.

```php
/** Credentials the user can fix: owned, or administered (HOD / Vault Admin) — never ones only shared with them. */
protected function healthScope(User $u): Collection
```

The docblock says "can fix", but the `team` route is included and has Copy
rank — that is the only reason `can_fix` is ever `false`.

---

## 2. `GET /credvault/health` — the issue list

One row **per issue** (a credential with two problems gives two rows), plus
the score card, the tab counts and the paging.

### 2.1 Query

| Param | Rule | Fails with (Laravel default) |
|---|---|---|
| `tab` | `nullable`, in `all, weak, reused, twofa, rotation, shared, fixed`; `resolved` is rewritten to `fixed` first | `The selected tab is invalid.` |
| `q` | `nullable`, string, max 100 | `The q field must not be greater than 100 characters.` |
| `page` | `nullable`, integer, min 1 | `The page field must be at least 1.` |
| `per_page` | `nullable`, integer, 1–100; default `PAGE_SIZE = 10` | `The per page field must not be greater than 100.` |

The validation strings are Laravel 12's stock messages; the controller passes
no custom ones for these fields.

### 2.2 Response

```json
{
  "status": true,
  "summary": { … same object as GET /health/summary → data … },
  "data": [ { …issue row… } ],
  "tabs": { "all": 9, "weak": 2, "reused": 2, "twofa": 2, "rotation": 2, "shared": 1, "fixed": 4 },
  "meta": { "current_page": 1, "per_page": 10, "total": 9, "last_page": 1 }
}
```

### 2.3 The issue row

| Field | Type | Notes |
|---|---|---|
| `type` | `weak` · `reused` · `twofa` · `rotation` · `shared` | `HEALTH_TYPES` |
| `severity` | `critical` · `high` · `medium` | **computed by the backend** — see section 4.2; the screen does not show it |
| `issue` | string | the title, section 4.1 |
| `detail` | string | one-line text, section 4.1 |
| `details` | object | structured parts per type, section 4.3 |
| `action` | string | the suggested action, section 4.1 |
| `can_fix` | bool | Full access (rank ≥ `RANK_FULL = 3`) |
| `credential` | object | `issueCredential()`: `id, code, name, type, type_label, category_group, url, risk, scope, owner, strength, strength_label, has_password` |

No secret, hash, username or field value is ever in the row.

### 2.4 Order

`healthIssues()` sorts by severity rank, then credential **code** as a string:

```php
$rank = ['critical' => 0, 'high' => 1, 'medium' => 2];
usort($out, fn ($a, $b) => [$rank[$a['severity']], $a['credential']['code']] <=> [$rank[$b['severity']], $b['credential']['code']]);
```

String order puts `CCRD-…` (Critical Vault) before `CRD-…` at equal severity.
PHP 8's `usort` is stable, so two issues of one credential at the same
severity keep the check order weak → reused → twofa → rotation → shared.

### 2.5 Search

`q` is lower-cased and matched with `str_contains` against **one string** built
from `code, name, type_label, category_group, owner, issue` joined by spaces.
`detail` and `action` are **not** searched. Because the fields are joined, a
term can match across a boundary (`"0004 gmail"` matches code `CRD-0004` +
name `Gmail…`).

### 2.6 Tabs and paging

- **`tabs` follow the search.** Each badge is the number of rows that tab would
  list for the term typed. `summary` does **not** follow the search — it is
  always the whole scope.
- Without a search each type's tab equals that card's `failed`, because one
  credential has at most one issue per type.
- Paging is an in-memory slice of the sorted list. A `page` past the end gives
  `data: []` with the true `last_page`.

### 2.7 The `fixed` tab (API only — the screen no longer has it)

`tabs.fixed` is **always computed**, on every call:

```php
$resolved = AuditLog::where('client_id', $u->client_id)->where('action', 'health_fixed')
    ->where(fn ($w) => $w->where('user_id', $u->id)->orWhereIn('credential_id', $creds->pluck('id')->all()));
```

There is no time limit — it counts every resolution ever logged by you or on a
credential in your scope. With `q`, it matches `credential_name`,
`credential_code` and `detail` with `LIKE` (`%` and `_` escaped).

`?tab=fixed` returns paginated audit rows, newest first:

| Field | From |
|---|---|
| `credential` | the credential's current data (`withTrashed`), or code/name from the log when it has been purged |
| `type`, `severity`, `issue`, `detail` | `meta` of the log entry, as they were when fixed |
| `resolved_at` | `created_at`, ISO 8601 |
| `resolved_by` | `"You"`, or the actor's name |

---

## 3. `GET /credvault/health/summary` — the score card and five cards

No query parameters. Returns `{ "status": true, "data": { …summary… } }`.

### 3.1 The score card

| Field | Formula |
|---|---|
| `total`, `checked` | credentials in scope |
| `failed`, `at_risk`, `attention.total` | distinct credentials with ≥ 1 issue |
| `passed`, `safe` | `total − failed` |
| `score` | `round(passed / total × 100)`; **100 when `total` is 0** |
| `level` | `Good` (≥ 80) · `Fair` (≥ 60) · `At risk` |
| `with_passwords` | credentials with `has_password = true` |
| `open_issues` | issue rows in all |
| `critical_issues` | issue rows with backend severity `critical` |
| `pct.passed`, `pct.failed`, `pct.at_risk`, `pct.safe`, `pct.with_passwords` | of `total` |
| `pct.critical_issues` | of `open_issues` |
| `attention.issues` | = `open_issues` |
| `attention.single` / `attention.multiple` | credentials failing exactly one type / more than one; `single + multiple = failed` |
| `attention.by_type` | `{ weak, reused, twofa, rotation, shared }` = each card's `failed` |
| `attention.label` | `"{failed} need attention"` |
| `attention.note` | `"A credential can have more than one issue, so the five counts add up to more than {failed}."` — or `null` when no credential fails twice |

### 3.2 `cards[]` — always five, in `HEALTH_TYPES` order

| `key` | `label` | `of` (out of) | `sub` |
|---|---|---|---|
| `weak` | `Weak passwords` | credentials with a password | `"{n} of {of} passwords below policy"` |
| `reused` | `Reused passwords` | credentials with a password | `"{n} of {of} share a password"` |
| `twofa` | `Missing 2FA` | `twofa ≠ 'na'` **and** risk in `twofa_risks` | `"{n} of {of} credentials that need 2FA have it off"` |
| `rotation` | `Rotation due` | with a password **and** `rotation_days > 0` | `"{n} of {of} passwords past or near policy age"` |
| `shared` | `Over-shared` | every credential checked | `"{n} of {of} credentials shared too widely"` |

Each card also carries `failed` (n), `passed` (`max(0, of − n)`), `pct`
(`n / of`, 0 when `of` is 0), `issues` (issue rows of that type), `critical`
(of those, backend-critical) and `pct_of_attention` (`n / failed`).

---

## 4. The five checks (`issuesOf`)

### 4.1 Conditions and wording

| `type` | Fires when | `issue` | `detail` | `action` |
|---|---|---|---|---|
| `weak` | `has_password` and `strength < min_strength` | `Weak password` (strength ≤ 2) / `Password below the policy minimum` (strength 3) | `Strength {label} — the policy needs {min label} or stronger` | `Replace with a generated password (20 characters)` |
| `reused` | `has_password`, a `secret_hash`, and another credential **in the same scope** with the same hash | `Password reused` | `Same password as CRD-0003 · Gmail, CRD-0009 · Zoho` | `Change to a unique password` |
| `twofa` | `twofa = 'no'` and risk in `twofa_risks` | `2FA not enabled` | `Password-only sign-in — anyone with the password can get in` | `Enable two-factor authentication` |
| `rotation` (over) | `rotationState = over` | `Rotation overdue` | `{age} days old · Policy {days} days · overdue by {n} days` | `Rotate the password now` |
| `rotation` (soon) | `rotationState = soon` | `Rotation due soon` | `{age} days old · Policy {days} days · due 05 Dec 2026` | `Rotate the password before the due date` |
| `shared` | live shares `≥ overshare_limit`, **or** risk critical with ≥ 1 live Full Access share | `Shared too widely` | `{n} active shares · 2 View · 1 Full Access` | `Review and revoke access that is no longer needed` |

### 4.2 Backend severity

| `type` | `critical` when | otherwise |
|---|---|---|
| `weak` | risk critical **or** strength ≤ 2 (Fair) | `high` |
| `reused` | risk critical | `high` |
| `twofa` | risk critical or high | `high` |
| `rotation` over | risk critical | `high` |
| `rotation` soon | — | always `medium` |
| `shared` | — | `high` if risk critical, else `medium` |

**The screen shows a different, fixed severity per type** — see the Functional
document §6.3. The API's `severity`, the sort order, `critical_issues`,
`cards[].critical` and the attention row's `severity` all use this table.

### 4.3 `details`

| `type` | Keys |
|---|---|
| `weak` | `strength` (int), `strength_label`, `policy_minimum` (label) |
| `reused` | `same_as: [{ id, code, name }]` |
| `twofa` | `risk` |
| `rotation` | `age_days`, `policy_days`, `overdue_days` (0 when due soon), `due_at` (ISO 8601) |
| `shared` | `active_shares`, `by_permission: { use?, view?, copy?, full? }` |

### 4.4 Policy inputs

From `Policy::for($client_id)` — a stored key overrides `Policy::DEFAULTS`:

| Key | Default | Allowed (`OPTIONS`) | Used by |
|---|---|---|---|
| `min_strength` | `3` (Good) | `2, 3, 4` | weak |
| `twofa_risks` | `['critical', 'high']` | any of critical/high/medium/low | twofa, card `of` |
| `rotation_warn` | `15` | `7, 15, 30` | rotation "soon" |
| `overshare_limit` | `3` | `2, 3, 5, 10` | shared |

`rotation_days` is per credential, not policy (`rotation_default = 90` only
pre-fills new credentials).

---

## 5. The Fix response — on `PUT|POST /credvault/{normal|critical}-vault/credentials/{id}`

Not a health route, but it is where a fix is reported. `persistCredential()`
computes the credential's issues before the save and again after it, inside the
transaction; every **type** that disappeared is resolved.

On an **update** only (never on create), `data` carries:

```json
"health": {
  "resolved":   [ { "type": "weak", "severity": "critical", "issue": "Weak password" } ],
  "still_open": [ { "type": "twofa", "severity": "critical", "issue": "2FA not enabled" } ]
}
```

and `message` is `"1 health issue resolved"` / `"2 health issues resolved"`, or
`"Credential updated."` when nothing was resolved. Every resolved issue writes
one audit row: action `health_fixed`, detail `"{issue} — resolved"`, module
`Password Health`, meta `{type, severity, issue, detail}`.

Refusals a Fix will meet on that route (verbatim):

```
Only the owner, a Vault Admin or someone with Full Access can edit this credential.      403
Policy requires a Good or stronger password — use the generate button.                    422 (fields.{secret})
This credential is in the Critical Vault — open it there.                                 404
Turn on at least one protection step for a critical credential.                           422
```

The strength message names the policy minimum (`Good` / `Strong` / `Fair`).

---

## 6. `GET /credvault/health/attention` — one row per credential

| Param | Rule |
|---|---|
| `tab` | `nullable`, in `all, weak, reused, twofa, rotation, shared` — **no `fixed`** |
| `q`, `page`, `per_page` | as on `/health` |

> The method's docblock says `?type=…`; the parameter that is actually read is
> **`tab`**. `?type=weak` is ignored and returns every row.

Row:

| Field | Notes |
|---|---|
| `credential` | as in 2.3 |
| `can_fix` | as in 2.3 |
| `issue_count` | issues of this credential |
| `types` | distinct issue types |
| `severity` | the worst of its issues (backend severity) |
| `issues[]` | `type, severity, issue, detail, details, action` |

Order: worst severity, then most issues, then code. Search covers code, name,
`type_label`, owner and every issue title (**not** `category_group`, unlike
`/health`). `tabs` are counts of **credentials** and follow the search.

**The current screen does not call this route.** It is used by the Postman
collection and tests only.

---

## 7. Error messages you will meet

```
CredVault needs a company account — this login has no tenant.                                   403
You do not have access to Credentials Vault. Ask your admin to grant it in Permissions.           403
The selected tab is invalid.                                                                       422
Account is no longer active. Please sign in again.                                                 401
```

---

## 8. curl quick reference

Read-only, in order. `$T` is a Sanctum token.

```bash
B=http://127.0.0.1:8000/api/credvault

# 1. The score card and the five cards
curl -s -H "Authorization: Bearer $T" -H "Accept: application/json" "$B/health/summary"

# 2. The issue list, first page
curl -s -H "Authorization: Bearer $T" -H "Accept: application/json" "$B/health?tab=all&page=1&per_page=10"

# 3. One tab, with a search — watch `tabs` change and `summary` stay put
curl -s -H "Authorization: Bearer $T" -H "Accept: application/json" "$B/health?tab=weak&q=gmail"

# 4. The resolved log (API only)
curl -s -H "Authorization: Bearer $T" -H "Accept: application/json" "$B/health?tab=resolved"

# 5. One row per failing credential
curl -s -H "Authorization: Bearer $T" -H "Accept: application/json" "$B/health/attention?tab=twofa"

# 6. Refusal: unknown tab → 422
curl -s -H "Authorization: Bearer $T" -H "Accept: application/json" "$B/health/attention?tab=everything"
```

The Postman collection `docs/CredVault_PasswordHealth.postman_collection.json`
("Password Health — score card & cards") covers 1, 5 and 6 per role.
