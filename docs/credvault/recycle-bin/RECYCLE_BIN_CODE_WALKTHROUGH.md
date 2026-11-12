# CredVault Recycle Bin — Code Walkthrough

Jira: **GT-74**. Line numbers are as of this writing; Grep the method name
if they have moved.

## 1. The file map

### Backend

| File | What is in it |
|---|---|
| `app/Http/Controllers/Api/CredVault/CredVaultController.php` | Everything. Two `RECYCLE BIN` banners: the endpoints (~L2587) and the helpers (~L4051) |
| `app/Http/Controllers/Api/CredVault/NormalVault/NormalVaultController.php` | `destroy()` L75 → `binCredential($request, $id, 'normal')` |
| `app/Http/Controllers/Api/CredVault/CriticalVault/CriticalVaultController.php` | `destroy()` L84 → `binCredential($request, $id, 'critical')` |
| `app/Models/CredVault/Credential.php` | `use SoftDeletes`; `VAULTS`, `SCOPES`, `RISKS`; `deleted_by` fillable; `isCriticalVault()` |
| `app/Models/CredVault/Policy.php` | `DEFAULTS['bin_days'=>30,'bin_purge'=>true]`, `OPTIONS['bin_days']`, `binDays()`, `for()` (adds `bin_branch_days`), `forget()` |
| `app/Models/CredVault/AuditLog.php` | `ACTIONS` `bin` / `restore` / `purge` |
| `app/Models/CredVault/CredentialShare.php` | `scopeLive()` — what "a share still works" means |
| `app/Providers/AppServiceProvider.php` | `RateLimiter::for('credvault', …240/min…)` |

Methods in `CredVaultController`:

| Method | Line | Kind |
|---|---|---|
| `binCredential()` | 448 | move to bin (both vaults) |
| `binTabCounts()` | 2590 | the four counts |
| `binSearch()` | 2601 | the search box |
| `recycleBin()` | 2626 | `GET /recycle-bin` |
| `restore()` | 2722 | `POST …/{id}/restore` |
| `purge()` | 2739 | `DELETE …/{id}` |
| `emptyBin()` | 2761 | `DELETE /recycle-bin` |
| `binRetention()` | 2805 | `GET …/retention` |
| `retentionTarget()` | 2842 | which branch a retention call is about |
| `withRetention()` | 2859 | the policy "as it would be" |
| `retentionImpact()` | 2872 | the preview / 409 count |
| `updateBinRetention()` | 2909 | `PUT …/retention` |
| `savePolicies()` | 4005 | company-default writer (shared with Policies) |
| `binQuery()` | 4058 | who sees what |
| `inBranch()` | 4074 | credential-of-branch test |
| `binDenial()` | 4085 | the Critical Vault rule |
| `purgeExpired()` | 4096 | lazy expiry |
| `BIN_BRANCH_SQL` | 4109 | the item's branch, in SQL |
| `wherePastRetention()` | 4116 | past / soon filter |
| `binBranchOfCredential()` | 4135 | the item's branch, in PHP |
| `binBranchFor()` | 4146 | the viewer's branch |
| `binRetentionScope()` | 4154 | `summary.retention_scope` |
| `purgeOne()` | 4165 | the one place a row is erased |
| `adminBranchOf()` | 4950 | Branch Admin test |
| `binAdmin()` | 5001 | client admin or Branch Admin |
| `accessMap()` / `findCredential()` / `findInVault()` | 5116 / 5172 / 5183 | access ranks |
| `isAdmin()` | 5205 | client admin test |
| `tenantUser()` | 5583 | tenant + module gate |
| `reject()` / `inTransaction()` | 5693 / 5706 | refusal shape, 500 wrapper |

### Frontend

| File | What is in it |
|---|---|
| `resources/js/pages/credvault/bin/RecycleBin.tsx` | The page (L32) and `RetentionModal` (L273) |
| `resources/js/pages/credvault/my-vault/BinConfirm.tsx` | Move to Recycle Bin / Remove from your vault popup; used by MyVault, TeamVault, CriticalVault, ViewDrawer |
| `resources/js/pages/credvault/cvApi.ts` | `bin`, `restore`, `purge`, `emptyBin`, `binRetention`, `saveBinRetention` (L397–404), `remove` (L335); types `BinVault`, `BinCounts`, `BinRetention`, `RetentionImpact`, `BinRow` (L236–264) |
| `resources/js/pages/credvault/shared.tsx` | `ConfirmModal` (L434), `ShimRows` (L330), `useDebounced` (L123), `CvPortal` |
| `resources/js/pages/credvault/credvault.css` | `.rbx`, `.rb-*` (~L8450–8770), `.cv-lock`, `.rb-ret__shim*` (~L19027–19115) |
| `resources/js/api.ts` | Axios client; injects `branch_id` on GETs (L129–155) |
| `resources/js/components/App.tsx` | `CvBin` lazy page, route `/credentials-vault/recycle-bin` |
| `resources/js/constants.ts` | menu leaf `cv.recycle_bin` under *Vault Administration & Security* |

### Routes (`routes/api.php`, inside `prefix('credvault')->middleware('throttle:credvault')`)

```php
Route::delete('/credentials/{id}',  [NormalVaultController::class, 'destroy'])   // normal-vault prefix
Route::delete('/credentials/{id}',  [CriticalVaultController::class, 'destroy']) // critical-vault prefix

// Recycle Bin
Route::get   ('/recycle-bin',                       [CredVaultController::class, 'recycleBin']);
Route::post  ('/recycle-bin/{id}/restore',          [CredVaultController::class, 'restore'])->whereNumber('id');
Route::delete('/recycle-bin/{id}',                  [CredVaultController::class, 'purge'])->whereNumber('id');
Route::delete('/recycle-bin',                       [CredVaultController::class, 'emptyBin']);
Route::get   ('/recycle-bin/retention',             [CredVaultController::class, 'binRetention']);
Route::put   ('/recycle-bin/retention',             [CredVaultController::class, 'updateBinRetention']);
```

`/recycle-bin/retention` (GET) is declared after `/recycle-bin`; there is no
`GET /recycle-bin/{id}`, so no ordering trap.

---

## 2. Request flow — move to bin

```
DELETE /credvault/critical-vault/credentials/57
  → CriticalVaultController::destroy → binCredential($r, 57, 'critical')
     1 tenantUser()                     403 no tenant / no module View
     2 findInVault(u, 57, 'critical')
         findCredential → Credential::where(client_id)->find   404 Credential not found.
                        → accessMap([c], u)[id] ?? 404        (no access at all)
         c.vault ≠ 'critical'                                  404 … — open it there.
     3 acc.via === 'share'  → revoke own user shares (tx) → 200 removed_share
                              (none of them user shares)       409 team share
     4 acc.rank < FULL                                         403 Only the owner, a Vault Admin …
     5 critical && via ∉ owner|admin|branch                    403 A critical credential can only …
     6 tx: deleted_by = u; saveQuietly(); delete();
           AccessRequest OPEN → cancelled; audit 'bin'
     7 days = binDays(pol, binBranchOfCredential(c)) → 200 + purges_at
```

The docblock states the two behaviours:

```php
/**
 * DELETE …-vault/credentials/{id}, for either vault — moves to the Recycle Bin. Shares pause while it is there.
 *
 * On a credential someone shared with you it is the prototype's "Remove
 * from your vault?": your own share ends, the credential itself is untouched.
 */
```

and the cancellation is commented:

```php
// Any unlock in progress on it ends — a binned credential reveals nothing.
```

`deleted_by` is written with `saveQuietly()` **before** `delete()` because
`delete()` on a SoftDeletes model only writes `deleted_at`.

---

## 3. Request flow — `GET /recycle-bin`

```
recycleBin()
  1 tenantUser()
  2 tab 'expiring' → 'soon'; validate listRules(all|mine|team|soon) + vault
  3 pol = Policy::for(client)
  4 purged = purgeExpired(client, pol)          ← DELETES, company-wide
  5 vault = f.vault ?? 'normal'; days = binDays(pol, binBranchFor(u))
  6 for normal, critical: q = binQuery(u, v); binSearch(q); counts[v] = binTabCounts
     counts.total = normal + critical
  7 base = binQuery(u, vault)
     next = base->get(id,name,deleted_at,bin_branch) → sortBy(purge date)->first
  8 summary { … can_empty = bin_purge && binAdmin && (normal || branchAdmin) … }
  9 tab filter on base (mine / team / soon); binSearch(base)
 10 paginate (LIGHT_COLUMNS + deleted_at, deleted_by, branch_id, bin_branch)
        with owner:id,name, orderBy deleted_at
 11 deleter names in one query; map rows (days_left, left_pct, urgency, can_*)
```

From the docblock:

```php
/**
 * One retention period covers both vaults, set per branch (Policy::binDays): each item
 * follows its branch's period, and `retention_days` is the viewer's. Critical items can be
 * restored or deleted only by the Branch Admin (`can_restore`, `can_purge`).
 * Expired items are purged first; `purged` says how many went. "expiring" = "soon".
 */
```

Note the order in step 8–9: `summary` is computed on `base` **before** the
tab filter and the search are applied, which is why the cards ignore both.
The counts in step 6 have the search but not the tab — each tab's count is
its own.

`binSearch()` matches people by name through a subquery:

```php
$people = User::where('client_id', $u->client_id)->whereRaw('lower(name) like ?', [$like])->select('id');
…
$w->orWhereIn('owner_id', $people)->orWhereIn('deleted_by', $people);
```

---

## 4. Request flow — restore, purge, empty

### `restore()`

```php
$c = $this->binQuery($u)->find($id) ?? $this->reject('That item is not in your Recycle Bin.', null, 404);
if ($why = $this->binDenial($u, $c)) $this->reject($why, null, 403);

$this->inTransaction('restore the credential', function () use ($c, $u) {
    $c->restore();
    $c->forceFill(['deleted_by' => null, 'updated_by' => $u->id])->saveQuietly();
    $this->audit($u, 'restore', $c, 'Restored from Recycle Bin');
});
```

Shares are not touched in either direction — they were never revoked, so a
live (unexpired) share works again the moment `deleted_at` is null.

### `purge()` — the guard order matters

```
validate confirm (accepted)          422 Confirm that you understand this cannot be undone.
pol.bin_purge                         403 Permanent delete is turned off in CredVault Policies.
binAdmin(u)                           403 Only a Vault Admin … can delete permanently. You can restore it.
binQuery(u)->find(id)                 404 That item is not in your Recycle Bin.
binDenial(u, c)                       403 Only the Branch Admin can restore or delete …
inTransaction → purgeOne(c, u.id, 'Deleted permanently')
```

### `emptyBin()`

```php
$items = $this->binQuery($u, $vault === 'all' ? null : $vault)->get();
if ($items->isEmpty()) $this->reject('The Recycle Bin is already empty.', null, 409);
[$go, $kept] = $items->partition(fn ($c) => $this->binDenial($u, $c) === null);
if ($go->isEmpty()) $this->reject('Only the Branch Admin can delete Critical Vault items in the Recycle Bin.', null, 403);
```

`binDenial()` runs one `users` lookup per Critical item (no memo there), so
a very large Critical bin costs N small queries. Not measured.

### `purgeOne()` — the only eraser

```php
protected function purgeOne(Credential $c, ?int $actorId, string $detail): void
{
    $paths = collect($c->attachments ?? [])->pluck('path')->all();
    $this->writeAudit($c->client_id, $actorId, null, 'purge', $c, $detail, [], 'Recycle Bin');
    CredentialShare::where('credential_id', $c->id)->whereNull('revoked_at')->update(['revoked_at' => now(), 'revoked_by' => $actorId]);
    $c->forceDelete();
    DB::afterCommit(fn () => Storage::disk('local')->delete($paths));
}
```

Audit first (it copies `code` and `name` into the log, which is what keeps
the code from being reissued), files last and only after commit so a rolled
back purge never loses an attachment.

---

## 5. Inside `purgeExpired()` and `wherePastRetention()`

```php
/** Purges everything past retention — both vaults, each item by its branch's period. Returns how many went. */
protected function purgeExpired(int $clientId, array $pol, ?int $actorId = null): int
{
    $old = $this->wherePastRetention(Credential::onlyTrashed()->where('credvault_credentials.client_id', $clientId), $pol)
        ->select('credvault_credentials.*')->selectRaw(self::BIN_BRANCH_SQL . ' as bin_branch')->get();
    foreach ($old as $c) {
        $days = Policy::binDays($pol, $c->bin_branch);
        $this->purgeOne($c, $actorId, "Deleted automatically after {$days} days in the bin");
    }
    return $old->count();
}
```

Three callers:

| Caller | `$pol` | Actor | In a transaction |
|---|---|---|---|
| `recycleBin()` | current | `null` | **no** |
| `savePolicies()` (company period shorter) | the new settings | the admin | yes |
| `updateBinRetention()` branch path (shorter) | re-read after `forget()` | the admin | yes |

`wherePastRetention()`:

```php
/**
 * Narrows $q to binned items past their branch's period — or, with $withinDays, due to
 * go within that many days ("Expiring soon"). A branch without its own period follows
 * the company's.
 */
$cut = fn (int $days) => $withinDays ? now()->subDays($days)->addDays($withinDays) : now()->subDays($days);
$op  = $withinDays ? '<=' : '<';
```

`BIN_BRANCH_SQL` is a correlated subquery, evaluated per row in every
branch arm. Fine at bin sizes; the `(client_id, deleted_at)` index narrows
first.

---

## 6. Inside the retention endpoints

### `retentionTarget()`

```php
/**
 * The branch a retention call is about: a Branch Admin's own (another branch → 403); for a
 * Vault Admin the branch_id sent, or null = the company default. Others: their own branch,
 * read-only. $change: the caller wants to change it.
 */
```

The Branch Admin test runs **before** the client admin test, so the 403 for
another branch also applies to the GET.

### `retentionImpact()` — newly hit only

```php
$next = $this->withRetention($pol, $branch, $days);
// Only what the change newly puts past its period: already-expired items go anyway.
$hit  = fn (Builder $q) => $this->wherePastRetention($q, $next)->whereNotIn('credvault_credentials.id',
    $this->wherePastRetention(Credential::onlyTrashed()->where('credvault_credentials.client_id', $u->client_id), $pol)
        ->select('credvault_credentials.id'));
…
// Every credential the change deletes — the viewer's own bin and other people's — so the confirm lists all of
// them, each marked with whose bin it is in (capped, as a guard on a very large bin).
$items = (clone $all)->with('owner:id,name')->orderBy('deleted_at')->limit(500)->get([...]);
```

`withRetention()` changes only one key, so for a branch target only that
branch's arm of `wherePastRetention()` moves; for the company target only
the "everything else" arm moves. That is how the preview stays scoped
without a branch filter of its own.

### `updateBinRetention()`

```
validate days (in OPTIONS), vault (ignored), branch_id, confirm_purge
binAdmin                                 403
branch = retentionTarget(u, branch_id, change: true)
current = branch ? binDays(pol, branch) : pol.bin_days
days < current && !confirm_purge → n = retentionImpact(…).total; n > 0 → 409 (errors.confirm_purge)
company → savePolicies(['bin_days' => days])          (locks, audits, purges)
branch  → tx: lockForUpdate policy row; settings.bin_branch_days[branch] = days;
              audit 'policy' (module 'Recycle Bin'); Policy::forget; purgeExpired if shorter
```

`Policy::forget()` matters: `Policy::for()` memoises per request
(`private static array $memo`), and the purge must read the **new** period.

---

## 7. Frontend flow

### `RecycleBin()` (L32)

```
state: tab, vault, q → dq (350 ms), page, perPage, reload
effect [tab, vault, dq, page, perPage, reload]
   filter key changed and page ≠ 1 → setPage(1); return     (one fetch, not two)
   cvApi.bin({tab, vault, q: dq, page, per_page})
     → rows, rowsKey = `${tab}|${vault}`, meta, tabs, counts, summary
     → purged > 0 → toast.warning(`${n} item(s) permanently deleted after ${days} days`)
     → over-paged → setPage(last_page)
shimmer = loading && (!rows.length || rowsKey !== `${tab}|${vault}`)
```

The shimmer rule is why switching tab or vault sub-tab blanks the table,
while paging or searching keeps the old rows until the answer lands.

Actions:

| Action | Call | Toast |
|---|---|---|
| Restore | `cvApi.restore(id)` | success `r.message` · error **Could not restore** |
| Delete permanently | `cvApi.purge(id)` → `{confirm:true}` | warning `r.message` · error **Could not delete** |
| Empty Bin | `cvApi.emptyBin(vault)` — **current sub-tab** | warning `r.message` · error **Could not delete** |

The purge / empty `ConfirmModal` does not pass `lockBusy`; its `onClose`
is guarded by `if (!busy)` instead.

### `RetentionModal` (L273)

```
mount → cvApi.binRetention()  (no days; Axios may add branch_id)
   loading = !ret && !loadErr  → shimmer tiles, Save disabled
save():
   locked or d === current → close
   d > current             → commit(false)
   d < current             → GET ?days=d → preview.total > 0 → show Confirm & Delete (warn)
                                          → else commit(false)
commit(confirmPurge):
   PUT {days, vault:'normal', confirm_purge?}
   ok   → toast.success, cvApi.meta(true), onSaved() → page refresh
   409 && !confirmPurge → re-fetch preview → warn   (race: something expired meanwhile)
   else → toast.error('Could not change the period', …)
```

The comment at the shimmer: `// CS-1493: the popup opens before GET /recycle-bin/retention answers — a shimmer until it does.`

### `BinConfirm` (my-vault)

`cvApi.remove(row.id, row.risk === 'critical')` picks the vault route from
the **risk**, not `row.vault`. `{days}` comes from `meta.bin_days`.

---

## 8. Patterns you will see in this code

| Pattern | Why |
|---|---|
| `reject()` throws `HttpResponseException` and returns `never` | Guards read top to bottom with no `return`s; `?? $this->reject(...)` works as an expression |
| `inTransaction('verb phrase', fn)` | All-or-nothing, and the phrase becomes `Could not {verb phrase}. Nothing was saved — please try again.` |
| `binQuery()` reused everywhere | One definition of "your bin" for list, restore, purge, empty, preview, dashboard, policy insights |
| `binDenial()` returns a **string or null** | The same value drives `can_restore`, `locked_reason` and the 403 text |
| `selectRaw(BIN_BRANCH_SQL . ' as bin_branch')` | Each row carries its period branch so PHP can call `binDays()` without N queries |
| `saveQuietly()` / `forceFill()` | Avoid model events and fillable checks for bookkeeping columns (`deleted_by`, `updated_by`) |
| `Policy::for()` + `forget()` | Per-request memo; always `forget()` after writing |
| `DB::afterCommit()` for files | A rollback must not leave a row pointing at a deleted file |
| `array_filter(..., fn ($v) => $v !== null)` on the retention GET | Optional keys are absent, not null — check with `in`, not `=== null` |

---

## 9. Symptom → file

| Symptom | Look at |
|---|---|
| Branch Admin gets 403 binning an employee's Critical credential | `accessMap()` — `branch` (Full) only on `scope = 'team'`; personal critical is `branch_critical` (View). Then `binCredential()` guard 4 |
| Client admin gets 404 binning an employee's personal credential | `accessMap()` — `admin` is team-only; personal = no access → `findCredential()` 404 |
| Manager / HOD gets 403 on a team Critical credential | `binCredential()` — `isCriticalVault() && via ∉ owner|admin|branch` |
| "This credential is in the … Vault — open it there." | `findInVault()`; or `BinConfirm` sent the wrong vault (`risk` vs `vault`) |
| Item vanished from the bin without anyone deleting it | `purgeExpired()` in `recycleBin()`; audit `purge` with no actor, "Deleted automatically after …" |
| Expired item still in DB | Nobody has opened the bin since it expired — there is no scheduler |
| Restore button greyed on a Critical item | `binDenial()` — caller is not the Branch Admin of `branch_id` / owner's branch |
| Delete icon missing | `can_purge` = no denial **and** `bin_purge` **and** `binAdmin()` |
| Empty Bin disabled for client admin on Critical sub-tab | `summary.can_empty` (`normal || branchAdmin`) |
| "Empty Bin" emptied only one vault | `RecycleBin.tsx` sends `vault` of the sub-tab; API default `all` |
| Two rows deleted the same day show different countdowns | Each uses its own branch: `BIN_BRANCH_SQL`, `binDays()`, `bin_branch_days` |
| Cards don't change when searching | `summary` built before `binSearch(base)` in `recycleBin()` |
| Tab badge ≠ sub-tab badge | Tab = `counts.total` (both vaults); sub-tab = `counts[vault]` |
| Retention popup shows a branch for a client admin | Axios `branch_id` injection (`api.ts`) → `retentionTarget()` |
| Retention save says "Nothing changed." | `savePolicies()` diff empty, or branch already had that value |
| 409 on PUT retention | `updateBinRetention()` → `retentionImpact()['total'] > 0` without `confirm_purge` |
| Confirm & Delete lists other people's credentials | By design — `retentionImpact()` comment; `in_my_bin` / `owner` |
| Move-to-bin popup days ≠ toast days | `BinConfirm` uses `meta.bin_days` (viewer); server uses credential's branch |
| Shares didn't come back after restore | Share `expires_at` passed while binned (`CredentialShare::scopeLive`), or the item was purged and re-created |
| Old code number reused | `lastNumber()` — table + `purge` audit codes |
| Popup text about a "fixed" Critical period | Dead branch: `retention_fixed` / `critical.fixed` are always false |
| 500 "Could not … Nothing was saved" | `inTransaction()` — real error is in `storage/logs` as `CredVault: could not {action}` |
