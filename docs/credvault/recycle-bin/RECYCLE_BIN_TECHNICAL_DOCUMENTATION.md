# CredVault Recycle Bin — Technical Documentation

Jira: **GT-74**

## 1. Stack

| Layer | What |
|---|---|
| Backend | Laravel 12, one controller for the bin (`CredVaultController`), two thin vault controllers for the delete entry points |
| Database | **PostgreSQL** (`DB::connection()->getDriverName()` → `pgsql`) |
| "In the bin" | Eloquent **SoftDeletes** on `Credential` — `deleted_at` not null. There is no bin table |
| Settings | One JSON document per client in `credvault_policies.settings` |
| Frontend | React 19 + TS, `pages/credvault/bin/RecycleBin.tsx`, `my-vault/BinConfirm.tsx`, client `cvApi.ts` |
| Scheduling | **None.** Expiry is enforced lazily when the bin is opened |
| Rate limit | `throttle:credvault`, 240/min per user, on the whole prefix |

The model docblock says it in one line:

```php
/**
 * CredVault · one stored credential. A soft-deleted row is in the Recycle Bin.
```

---

## 2. Architecture

```
  My Vault / Team Vault / Critical Vault / View drawer
        │  BinConfirm.tsx → cvApi.remove(id, risk === 'critical')
        ▼
  DELETE /credvault/{normal|critical}-vault/credentials/{id}
        │  NormalVaultController / CriticalVaultController ::destroy
        ▼
  CredVaultController::binCredential()
        │  findInVault → accessMap → rank / vault rules
        │  tx: deleted_by, soft delete, cancel AccessRequests, audit 'bin'
        ▼
  ┌────────────── credvault_credentials (deleted_at NOT NULL) ──────────────┐
  │                                                                         │
  │  RecycleBin.tsx                                                         │
  │   ├─ GET  /recycle-bin ──► purgeExpired(client)  ← company-wide, first  │
  │   │                        binQuery(user, vault) + binSearch            │
  │   │                        binTabCounts × 2 vaults, summary, rows       │
  │   ├─ POST /recycle-bin/{id}/restore ──► binQuery → binDenial → restore  │
  │   ├─ DELETE /recycle-bin/{id} ──► bin_purge → binAdmin → binDenial      │
  │   │                               → purgeOne                            │
  │   ├─ DELETE /recycle-bin ──► … partition by binDenial → purgeOne × n    │
  │   └─ RetentionModal                                                     │
  │        ├─ GET /recycle-bin/retention[?days] ──► retentionTarget,        │
  │        │                                        retentionImpact          │
  │        └─ PUT /recycle-bin/retention ──► 409 unless confirm_purge        │
  │                 ├─ company: savePolicies(['bin_days'])  → purgeExpired   │
  │                 └─ branch : settings.bin_branch_days[b] → purgeExpired   │
  └─────────────────────────────────────────────────────────────────────────┘
        purgeOne(): audit 'purge' → revoke shares → forceDelete
                    → afterCommit: delete attachment files from disk 'local'
```

---

## 3. Data model

Columns from the live schema (`Schema::getColumnListing`, PostgreSQL).

### 3.1 `credvault_credentials` (model `App\Models\CredVault\Credential`)

```
id, client_id, branch_id, code, type, category_group, name, scope, owner_id,
department_id, url, username, secret, secret_hash, fields, notes, attachments,
risk, strength, has_password, twofa, rotation_days, password_changed_at,
lock_admin, lock_manager, lock_otp, lock_admin_user_id, lock_manager_user_id,
totp_secret, totp_linked_at, created_by, updated_by, deleted_by, created_at,
updated_at, deleted_at, vault, twofa_method, twofa_email, twofa_linked_at
```

The columns the bin reads or writes:

| Column | Role in the bin |
|---|---|
| `deleted_at` | Not null = in the bin. The clock for retention |
| `deleted_by` | Who binned it. "Deleted by Me" tab; cleared on restore |
| `vault` | `normal` / `critical` (`Credential::VAULTS`) — the sub-tab, and the `binDenial()` test |
| `scope` | `personal` / `team` — "Team Credentials" tab, who sees it |
| `risk` | `low`·`medium`·`high`·`critical`; Critical Vault rows are always `critical` |
| `branch_id` | First choice for the retention branch |
| `owner_id` | Fallback for the retention branch (`users.branch_id`); visibility |
| `attachments` | JSON; each entry's `path` is deleted from disk on purge |
| `code` | `CRD-0001` / `CCRD-0001`; never reused after purge (§4.4) |

Index that serves the bin: `credvault_credentials_client_id_deleted_at_index
(client_id, deleted_at)`. Others present: `(client_id, vault)`,
`(client_id, risk)`, `(client_id, scope, department_id)`, `owner_id`,
`branch_id`, unique `(client_id, code)` — **the unique index includes
binned rows**, which is why a restore can never collide on code.

### 3.2 `credvault_policies` (model `Policy`)

```
id, client_id, settings, updated_by, created_at, updated_at
```

`settings` is cast to `array`. Bin keys inside it:

| Key | Type | Default | Options |
|---|---|---|---|
| `bin_days` | int | 30 | `[7, 15, 30, 60, 90]` |
| `bin_purge` | bool | `true` | — |
| `bin_branch_days` | `{branch_id: days}` | `{}` | each value from the same options |

`bin_branch_days` is **not** in `Policy::DEFAULTS`; `Policy::for()` adds it
explicitly so every policy save carries it through:

```php
// [branch id => days]: the branches with their own Recycle Bin period. Not a policy
// card of its own; kept in the same row and carried through every policy save.
['bin_branch_days' => array_map('intval', $row?->settings['bin_branch_days'] ?? [])]
```

No migration exists or is needed for either key — a missing key reads its
default.

### 3.3 Other tables touched

| Table | Columns | Bin use |
|---|---|---|
| `credvault_shares` | `id, client_id, credential_id, shared_by, recipient_type, recipient_user_id, recipient_department_id, permission, reason, expires_at, revoked_at, revoked_by, created_at, updated_at` | "Remove from your vault" revokes the caller's user shares; `purgeOne()` revokes the rest. Binning does **not** touch them |
| `credvault_audit_logs` | `id, client_id, branch_id, user_id, action, severity, credential_id, credential_code, credential_name, module, detail, meta, ip, user_agent, created_at` | `bin`, `restore`, `purge`, `policy`; `credential_code` of purged rows feeds code allocation |
| `credvault_access_requests` | (not listed here) | open requests on a binned credential → `status = 'cancelled'` |
| `users` | `branch_id`, `user_type` | `BIN_BRANCH_SQL` fallback; role tests |

Audit catalogue (`AuditLog::ACTIONS`): `bin` → *Moved to bin* (warn),
`restore` → *Restored* (info), `purge` → *Deleted permanently* (critical).

---

## 4. The arithmetic

### 4.1 Which period an item follows

```php
/** The branch whose period a binned credential follows: the one it is filed under, else its owner's. */
protected const BIN_BRANCH_SQL = 'coalesce(credvault_credentials.branch_id,
    (select users.branch_id from users where users.id = credvault_credentials.owner_id))';

public static function binDays(array $pol, ?int $branchId = null): int
{
    return (int) ($branchId ? ($pol['bin_branch_days'][$branchId] ?? $pol['bin_days']) : $pol['bin_days']);
}
```

The PHP twin used outside queries is `binBranchOfCredential()`
(`$c->branch_id ?: owner's branch_id`).

### 4.2 Past retention, and "Expiring soon"

`wherePastRetention($q, $pol, $withinDays = 0)` builds one `OR` per branch
that has its own period, plus one for everything else on the company
period:

```
past:     deleted_at <  now − days
soon(7):  deleted_at <= now − days + 7      (i.e. purge date ≤ now + 7 days)

( bin_branch = 3 AND deleted_at < now − 7d )
OR ( bin_branch = 5 AND deleted_at < now − 60d )
OR ( (bin_branch IS NULL OR bin_branch NOT IN (3,5)) AND deleted_at < now − 30d )
```

```php
// Everything else — no branch, or a branch without its own period — on the company's.
```

The `NOT IN` list is built from `array_map('intval', …)` keys, so it is
safe to inline.

### 4.3 Per-row figures (`recycleBin()`)

```php
$total = Policy::binDays($pol, $c->bin_branch);
$purge = $c->deleted_at->copy()->addDays($total);
// Never "0 days": an item still in the bin goes on its last day.
$days  = max(1, (int) ceil(now()->diffInHours($purge, false) / 24));
'left_pct' => (int) round(min($days, $total) / max(1, $total) * 100),
'urgency'  => $days <= 3 ? 'bad' : ($days <= 7 ? 'warn' : 'ok'),
```

`next_deletion` loads every item of the chosen vault (`id, name,
deleted_at, bin_branch`), computes each purge date in PHP and takes the
smallest — ordering by `deleted_at` alone would be wrong across branches
with different periods.

### 4.4 Codes are never reused

```php
/* … The audit log is consulted too, so a code
   once used by a credential since purged is never handed out again. */
```

`lastNumber()` reads `DB::table('credvault_credentials')` (the query
builder ignores SoftDeletes, so binned rows count) and the highest
`credential_code` of `purge` audit rows. Not verified: that audit lookup
orders by `credential_code` as a **string**; past `CRD-9999` the
lexicographic maximum would be wrong. Irrelevant at today's volumes.

---

## 5. Who sees what (`binQuery()`)

```php
/**
 * What the user sees in the bin: theirs, what they binned, team items for a Vault Admin,
 * and — for a Branch Admin — the branch's team items and every Critical Vault item of the
 * branch (a Branch Admin is the one who restores or deletes those). $vault narrows it.
 */
return Credential::onlyTrashed()->where('credvault_credentials.client_id', $u->client_id)
    ->when($vault, fn ($q) => $q->where('vault', $vault))
    ->where(function ($w) use ($u, $admin, $branch) {
        $w->where('owner_id', $u->id)->orWhere('deleted_by', $u->id);
        if ($admin) $w->orWhere('scope', 'team');
        if ($branch) $w->orWhere(fn ($b) => $this->inBranch($b, $u->client_id, $branch)
            ->where(fn ($s) => $s->where('scope', 'team')->orWhere('vault', 'critical')));
    });
```

| Role | Predicate (beyond own / binned-by-me) |
|---|---|
| Client admin (`isAdmin`: `user_type = client_admin`) | `scope = 'team'` — company-wide, both vaults |
| Branch Admin (`adminBranchOf`: `user_type = branch_user` + `branch_id`) | in branch **and** (`scope = team` **or** `vault = critical`) |
| Employee | none |

`binQuery()` is also used by the Dashboard KPI and the Policies insight box
(`policyInsights()`), so a change to it moves those numbers too.

---

## 6. Authorisation

### 6.1 The layers

| Layer | Where | Rule |
|---|---|---|
| Module | `tenantUser()` | client admin, or `permissions.can_view` on module `credentials-vault` |
| Move to bin | `binCredential()` | Full rank; Critical Vault also needs via `owner`/`admin`/`branch` |
| See in bin | `binQuery()` | §5 |
| Restore / delete one | `binDenial()` | Critical Vault → Branch Admin of the item's branch only |
| Delete / empty / change period | `binAdmin()` | client admin **or** Branch Admin |
| Delete / empty | policy | `bin_purge` must be true |

```php
/**
 * The Recycle Bin's Vault Admin: the client admin or a Branch Admin. Only they change the
 * retention period and delete permanently (an item, or Empty Bin); everyone else may only restore.
 */
protected function binAdmin(User $u): bool
```

```php
/**
 * Whether the user may restore or permanently delete a binned item. A Critical Vault item
 * is the Branch Admin's alone — of the branch it belongs to; anything else the user sees
 * in the bin (binQuery) is theirs to restore. null = allowed, else the reason.
 */
```

### 6.2 The asymmetry on personal Critical credentials

Going **in** is governed by `accessMap()`, coming **out** by `binDenial()`,
and they disagree for one case:

| Personal Critical credential of an employee in branch B | Branch Admin of B |
|---|---|
| Access rank (`accessMap`) | `branch_critical` = **View** (only if `credential.branch_id = B`) |
| Move to bin | **403** `Only the owner, a Vault Admin or someone with Full Access can delete this credential.` |
| Seen in bin | ✓ (`vault = critical` and in branch) |
| Restore / delete from bin | ✓ — the **only** person who can |

```php
// Critical Vault: anyone in the branch sees every critical credential
// (personal or team) as View — it lists and opens only through the
// approval steps; the Branch Admin opens it directly. (new flow)
```

The 403 was **observed** when a Branch Admin tried it; the code above is the
reason. Whether that asymmetry is intended is not stated anywhere in code or
tickets read for this document.

### 6.3 Branch membership is tested two ways

| Test | Used by | "Of branch B" means |
|---|---|---|
| `inBranch()` | `binQuery()` | `branch_id = B` **or** owner's branch = B |
| `binDenial()` | restore / purge | same two-way test |
| `BIN_BRANCH_SQL` | the period | `coalesce(branch_id, owner's branch)` — **one** branch |
| `accessMap()` `branch_critical` | move to bin | `branch_id = B` only |

So a credential filed under branch A but owned by someone in branch B is in
**both** Branch Admins' bins and either can restore it, while it follows
**A's** period. Not exercised; follows from the code.

---

## 7. Concurrency

| Race | Guard | Status |
|---|---|---|
| Two retention saves | `Policy::where(...)->lockForUpdate()` inside the transaction (both branch and company paths) | Closed |
| Code allocation after purge | `clients` row lock in `nextCode()` + purge audit lookup | Closed |
| Preview → save: items expire in between | Already-expired items are purged anyway; the 409 counts only newly-hit items | Benign |
| Two users open the bin at the same moment | **None.** Both `purgeExpired()` calls can select the same rows; each writes a `purge` audit row; the second `forceDelete()` affects 0 rows | **Open — worth testing.** Expect duplicate audit entries, no data harm |
| Restore racing a purge of the same item | **None** — no row lock between `find()` and `restore()` | **Open — worth testing.** The restore could answer 200 for a row already gone |
| Partial Empty Bin | One transaction for the batch; files deleted `afterCommit` | Closed |

`purgeExpired()` from `recycleBin()` runs **outside** a transaction: each
`purgeOne()` stands alone, and `DB::afterCommit()` with no open transaction
runs immediately. A failure mid-way leaves the earlier items purged.

---

## 8. Multi-tenancy

- `client_id` comes only from `$request->user()`; `tenantUser()` refuses a
  login with none.
- Every bin query starts `Credential::onlyTrashed()->where('credvault_credentials.client_id', $u->client_id)`.
- `branch_id` on retention is checked against `Branch::where('client_id', …)`
  → 404 for another company's branch; a Branch Admin can only target their own.
- The Axios interceptor (`resources/js/api.ts`) adds `branch_id` from
  `localStorage['cbc_selected_branch_id_<user>']` to **every GET** that does
  not already carry one. `cvApi.get()` goes through that client. The bin
  endpoints ignore it — **except `GET /recycle-bin/retention`**, where
  `retentionTarget()` honours `branch_id` for a client admin.

> **Probable bug (from reading, not exercised).** A client admin with a
> branch selected in the switcher opens Change period: the GET (and the
> `?days=` preview) are answered **for that branch** — the popup says
> "for everyone in {branch}" and shows its period — but
> `cvApi.saveBinRetention()` sends **no** `branch_id` on the PUT, so Save
> changes the **company default**, and the PUT's 409 count is the company's,
> not the previewed branch's. A Branch Admin is unaffected when the stored
> branch is their own (if it were another branch the GET would 403).
> A fix must either send the same `branch_id` on the PUT or keep the
> interceptor off this path: `clean()` in `cvApi.ts` drops `null` / `''`
> params, so the GET cannot opt out by sending an empty `branch_id`, and
> `0` fails `min:1`.

### Where the scope is deliberately wider than the viewer

| Place | Scope | Why |
|---|---|---|
| `purgeExpired()` on `GET /recycle-bin` | the whole company | "Purges everything past retention — both vaults, each item by its branch's period." Expiry is not per viewer |
| `retentionImpact()` `total` / `items` | the target branch (or every branch on the company period) | "Every credential the change deletes — the viewer's own bin and other people's — so the confirm lists all of them" |

The second one is reachable by an **employee** with `GET …/retention?days=`
(read-only target = their branch). It lists names and codes of colleagues'
binned credentials. Not exercised; flagged for review.

---

## 9. External coupling

| What | Where |
|---|---|
| Attachment files | `Storage::disk('local')->delete($paths)` after commit, in `purgeOne()` |
| CredVault Policies | `savePolicies()` is the company-default writer for both screens; `bin_purge` is only set there |
| Access requests | cancelled on bin (`AccessRequest::OPEN` → `cancelled`) |
| Dashboard / Policies insights | reuse `binQuery()` for their bin counts |
| `GET /credvault/meta` | `bin_days: { normal, critical }` = the viewer's branch period (same number twice) — read by `BinConfirm` |

No queue, mail or Zoho involvement.

---

## 10. Where every figure on the screen comes from

| Screen element | Source |
|---|---|
| Strip / hero `{days}` | `summary.retention_days` (viewer's branch period) |
| Five cards | `summary.items / deleted_by_me / expiring_soon / critical / next_deletion` |
| Tab badges | `counts.total[tab]` |
| Vault sub-tab badges | `counts[vault][tab]` |
| Rows | `data[]` |
| Auto-delete cell | `days_left`, `left_pct`, `urgency`, `purges_at` |
| Restore enabled / tooltip | `can_restore`, `locked_reason` |
| Delete icon | `can_purge` |
| Empty Bin enabled / tooltip | `summary.items`, `can_empty`, `purge_allowed`, `is_bin_admin` |
| Retention popup | `GET /recycle-bin/retention` → `[vault].days/options/can_change`, `scope`, `branch.name`, `note` |
| Confirm & Delete list | `GET …/retention?days=` → `preview.items[]` |
| Move-to-bin popup `{days}` | `meta.bin_days.normal|critical`, fallback `meta.policy.bin_days`, fallback 30 |
| Auto-delete toast | `purged`, `summary.retention_days` |

### Derived on the server, never accepted from the client

`deleted_by`, `deleted_at`, every period, `days_left`, `purges_at`,
`can_*`, the branch an item follows, the retention target for a Branch
Admin, `restored_to`. The PUT's `vault` is accepted and ignored.

---

## 11. Frontend internals

| Concern | Implementation |
|---|---|
| Fetch | one `useEffect` on `[tab, vault, dq, page, perPage, reload]`; `on` flag drops stale responses |
| Filter change → page 1 | `lastFilt` ref on `` `${tab}|${vault}|${dq}` ``; if not on page 1 it sets page and returns |
| Shimmer | `loading && (!rows.length || rowsKey !== `${tab}|${vault}`)` — only on tab / sub-tab change or empty table |
| Search debounce | `useDebounced(q)`, 350 ms |
| Over-paged | if `current_page > last_page` it jumps to `last_page` |
| Restore | per-row `Set<number>` so several rows can restore at once, each locked |
| Retention popup shimmer | `loading = !ret && !loadErr` (comment: *CS-1493*) |
| Save lock | `busy` → `.cv-lock` overlay "Saving…"; Cancel disabled |
| Confirm & Delete | `ConfirmModal` with `lockBusy`, `busyLabel="Deleting…"`, children = `.rb-impact` list |
| After a retention save | `cvApi.meta(true)` refreshes `meta.bin_days` for the next Move-to-bin popup |

Styles live in `credvault.css` under `.cvx`: `.rbx` (hero + cards grid),
`.rb-hero*`, `.rb-subtabs/.rb-subtab/.rb-subtab-c`, `.rb-left` with
`--rb-left` colour (`#059669` ok, `--warn #d97706`, `--bad #e11d48`; dark
theme `#fbbf24` / `#fb7185`), `.rb-ret*` and `.rb-ret__shim*`, `.rb-opts`
/ `.rb-opt`, `.rb-impact*`. Note `.rb-sub` is used for **two** things —
the card caption (`.rbx .phx-card__s.rb-sub`) and the sub-tab wrapper
(`.cvx .rb-sub`).

---

## 12. Known drift and dead paths

| Where | What | Truth |
|---|---|---|
| `RecycleBin.tsx` hero / `RetentionModal` | Branches for `retention_fixed` / `critical.fixed` ("This period is fixed.") | Server always sends `false` — dead copy |
| `BinConfirm.tsx` comment | "the Normal Vault's from Policies, the Critical Vault's fixed" | Both are the viewer's branch period |
| `cvApi.ts` `RetentionImpact` comment | "`items` (up to 10) from the user's own bin" | Every affected item, company-scope, cap 500 |
| `BinConfirm` `{days}` | viewer's branch period | Server uses the **credential's** branch; can differ for a Branch Admin or client admin binning someone else's |
| `BinConfirm` endpoint choice | `row.risk === 'critical'` | Correct only because the Critical Vault is always risk critical and the Normal Vault never is |
| Empty Bin | screen sends current sub-tab | API default is `all` |
| Client admin per-branch period | API supports `branch_id` | Screen never sends it |
| Auto-delete toast | "after {viewer's days}" | Purged items may follow other branches' periods |

---

## 13. Things this module does NOT do

- No scheduled purge. An expired item lives on until somebody opens the
  Recycle Bin or shortens the period.
- No bulk restore / bulk delete endpoint — the 2025 sheet lists it as an
  open item; still open.
- No restore-to-another-vault or restore-as-copy.
- No separate Critical Vault retention (removed; one period for both).
- No notification to the owner when a Branch Admin restores or purges
  their Critical credential (not found in the code read).
