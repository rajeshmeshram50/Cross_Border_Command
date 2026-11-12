# CredVault Recycle Bin — API Documentation

Jira: **GT-74**

## 0. How to read this

Base URL `/api`. Every route below sits behind `auth:sanctum` + `user.active`
and the named limiter `throttle:credvault` (**240 requests / minute per
user**, `AppServiceProvider::boot()`). The tenant is always the logged-in
user's `client_id`; nothing in a request body can choose another company.

Prefix for this module: **`/api/credvault`**

| Route group | Controller |
|---|---|
| `recycle-bin*` (6 routes) | `App\Http\Controllers\Api\CredVault\CredVaultController` |
| `normal-vault/credentials/{id}` DELETE | `…\CredVault\NormalVault\NormalVaultController::destroy` |
| `critical-vault/credentials/{id}` DELETE | `…\CredVault\CriticalVault\CriticalVaultController::destroy` |

Both `destroy()` methods are one line: `return $this->binCredential($request,
$id, self::VAULT);` — the logic lives in `CredVaultController`.

**Response envelope**

```json
{ "status": true,  "message": "…", "data": { … } }
{ "status": false, "message": "…", "errors": { "field": ["…"] } }
```

`errors` appears only when the refusal names a field (`reject($message,
$field, $status)`); most refusals here pass `null` and carry only `message`.

**Status codes actually used**

| Code | When |
|---|---|
| 200 | Success — including "Nothing changed." on the retention PUT |
| 403 | Not allowed: module permission, role, Critical Vault rule, policy off |
| 404 | Not in your bin / not found / other vault / branch not in company |
| 409 | Bin already empty; team share can't be removed; retention needs confirm |
| 422 | Validation (`tab`, `vault`, `days`, `confirm`, …) |
| 500 | `Could not {action}. Nothing was saved — please try again.` |

**Two refusals every route can give** (from `tenantUser()`):

```
403  CredVault needs a company account — this login has no tenant.
403  You do not have access to Credentials Vault. Ask your admin to grant it in Permissions.
```

The second applies to anyone who is not a client admin and has no
`can_view` permission on the module with slug `credentials-vault`.

> **`GET /recycle-bin` is not read-only.** Before it lists anything it
> permanently deletes every binned credential of the company that is past
> its retention period (§2.1). Do not point a monitoring probe or a smoke
> test at it on a database whose bin you want to keep.

### Roles used in this document

| Term | Who in code | Test |
|---|---|---|
| Client admin / Vault Admin | `isAdmin()` | `user_type === 'client_admin'` |
| Branch Admin | `adminBranchOf()` ≠ null | `user_type === 'branch_user'` with a `branch_id` |
| Bin Admin | `binAdmin()` | client admin **or** Branch Admin |
| Employee | everyone else with module access | — |

---

## 1. Moving a credential to the bin

| Method | Path |
|---|---|
| DELETE | `/credvault/normal-vault/credentials/{id}` |
| DELETE | `/credvault/critical-vault/credentials/{id}` |

No body. `{id}` is numeric (`whereNumber`). The **old shared route
`DELETE /credvault/credentials/{id}` no longer exists** — the 2025 sheet
still lists it.

### 1.1 Guards, in order

| # | Check | Result on failure |
|---|---|---|
| 1 | Credential of this client, and the user has some access to it | 404 `Credential not found.` |
| 2 | It is in the vault of the route | 404 `This credential is in the Critical Vault — open it there.` / `This credential is in the Normal Vault (My Vault) — open it there.` |
| 3 | Access comes from a share → "remove from your vault" branch (§1.3) | — |
| 4 | Access rank is Full | 403 `Only the owner, a Vault Admin or someone with Full Access can delete this credential.` |
| 5 | Critical Vault: access is `owner`, `admin` or `branch` | 403 `A critical credential can only be moved to the bin by its owner, a Vault Admin or the Branch Admin.` |

Who has Full access (`accessMap()`): the owner always; on a **team**
credential the client admin (`admin`), the Branch Admin of the owner's or
the credential's branch (`branch`, owner not an admin type), a manager above
the owner (`manager`), or the department HOD over someone below them
(`hod`); or a Full share (`share`).

> **Observed behaviour, explained by the code.** A Branch Admin trying to bin
> an employee's **personal** Critical credential got **403**. `accessMap()`
> grants `branch` (Full) only on `scope = 'team'`; on a personal Critical
> credential of the branch the Branch Admin gets `branch_critical`, which is
> **View** (rank 1), so guard 4 fires with
> `Only the owner, a Vault Admin or someone with Full Access can delete this credential.`
> (If the credential's own `branch_id` is null, guard 1 fires instead → 404.)
> Yet once such an item **is** in the bin, the same Branch Admin is the only
> person who can restore or permanently delete it (§3). Which of the two 403
> texts the observation saw was not recorded; the code says the first.

### 1.2 Success — moved to the bin

```json
{ "status": true,
  "message": "“Gmail admin” moved to the Recycle Bin. It can be restored for 30 days.",
  "data": { "id": 41, "vault": "normal", "purges_at": "2026-12-12T10:04:11+00:00" } }
```

For a Critical Vault credential the message ends
`… It can be restored for 30 days — by the Branch Admin.`

`days` is the period of the **credential's** branch
(`binBranchOfCredential()`: its `branch_id`, else its owner's branch), not
the caller's. Inside one transaction: `deleted_by` is set, the row is
soft-deleted, every open access request on it becomes `cancelled`, and an
audit row `bin` / "Moved to Recycle Bin" is written. Shares are **not**
revoked — they stop working because the credential is invisible, and come
back on restore if they have not expired.

On an unexpected failure: 500
`Could not move the credential to the bin. Nothing was saved — please try again.`

### 1.3 Success — removed from your vault (shared credential)

When your access is a share, the credential itself is untouched; your own
user shares on it are revoked.

```json
{ "status": true,
  "message": "“Gmail admin” removed from your vault. The owner's copy is unchanged.",
  "data": { "id": 41, "removed_share": true } }
```

If the only share reaching you is a **team** share:

```
409  This credential is shared with your whole team. Ask the owner to remove the team share.
```

---

## 2. The bin list

### 2.1 `GET /credvault/recycle-bin`

| Query | Rule | Default |
|---|---|---|
| `vault` | `nullable`, in `normal`, `critical` | `normal` |
| `tab` | `nullable`, in `all`, `mine`, `team`, `soon` (`expiring` is rewritten to `soon` first) | `all` |
| `q` | `nullable`, string, max 100 | — |
| `page` | `nullable`, integer, min 1 | 1 |
| `per_page` | `nullable`, integer, 1–100 | 10 (`PAGE_SIZE`) |

Validation failures use Laravel's default texts, e.g.
`The selected vault is invalid.` (Postman "Unknown vault (422)" sends
`vault=both`).

**Side effect, before anything else is read:**
`purgeExpired($u->client_id, $pol)` — every expired binned credential of
**the whole company**, both vaults, every branch, is force-deleted with
`actor = null` and the audit detail
`Deleted automatically after {days} days in the bin`. The count comes back
as `purged`. Validation runs first, so a 422 purges nothing.

**What the user sees** is `binQuery()`:

| Viewer | Sees in the bin |
|---|---|
| Anyone | items they own, and items they binned (`deleted_by`) |
| Client admin | + every **team** item of the company (both vaults) |
| Branch Admin | + team items of their branch, + **every Critical Vault item** of their branch (personal or team) |

"Of the branch" (`inBranch()`) = the credential's `branch_id` is the branch,
**or** its owner's `users.branch_id` is.

**Tabs**

| Key | Label | Filter |
|---|---|---|
| `all` | All Items | none |
| `mine` | Deleted by Me | `deleted_by = me` |
| `team` | Team Credentials | `scope = 'team'` |
| `soon` | Expiring Soon | purges within 7 days (`wherePastRetention($q, $pol, 7)`) |

**The search** (`binSearch()`) matches, case-insensitively, `name`, `code`,
`category_group`, the type label, and the **name of the owner or of the
person who binned it**. Every count in `tabs` and `counts` follows the
search; the `summary` cards do **not**.

**Response**

```json
{
  "status": true,
  "purged": 0,
  "summary": {
    "vault": "normal",
    "retention_days": 30,
    "retention_scope": { "branch": { "id": 3, "name": "Pune" }, "source": "company", "applies": "both" },
    "retention_fixed": false,
    "can_change_retention": true,
    "retention_options": [7, 15, 30, 60, 90],
    "purge_allowed": true,
    "is_bin_admin": true,
    "can_empty": true,
    "critical_actions": "branch_admin",
    "items": 4, "deleted_by_me": 2, "expiring_soon": 1, "critical": 0,
    "next_deletion": { "name": "Old FTP", "at": "2026-11-15T09:00:00+00:00", "days": 3 }
  },
  "data": [ { …row… } ],
  "tabs":   { "all": 4, "mine": 2, "team": 1, "soon": 1 },
  "counts": { "normal":   { "all": 4, "mine": 2, "team": 1, "soon": 1 },
              "critical": { "all": 1, "mine": 0, "team": 0, "soon": 0 },
              "total":    { "all": 5, "mine": 2, "team": 1, "soon": 1 } },
  "meta":   { "current_page": 1, "per_page": 10, "total": 4, "last_page": 1 }
}
```

| `summary` field | Meaning |
|---|---|
| `retention_days` | The **viewer's** period (`binBranchFor()`): Branch Admin's branch, an employee's branch, `null` → company for the client admin |
| `retention_scope.source` | `branch` when that branch has its own period, else `company` |
| `retention_fixed` | Always `false`. Kept for the screen; nothing is fixed any more |
| `can_change_retention`, `is_bin_admin` | `binAdmin()` |
| `purge_allowed` | Policy `bin_purge` |
| `can_empty` | `bin_purge` **and** bin admin **and** (`vault = normal` **or** caller is a Branch Admin) |
| `critical_actions` | `branch_admin` when the caller is a Branch Admin, else `none` |
| `items`, `deleted_by_me`, `expiring_soon` | Counts for the chosen vault, **unsearched** |
| `critical` | Items with `risk = 'critical'` in the chosen vault |
| `next_deletion` | The item in the chosen vault with the earliest purge date, by each item's own period |

**One row of `data[]`**

| Field | Meaning |
|---|---|
| `sr_no` | Position across pages |
| `id`, `code`, `vault`, `name`, `type`, `type_label`, `category_group`, `url` | The credential |
| `scope`, `scope_label` | `personal`/`team`, `Personal`/`Team` |
| `risk` | `low`·`medium`·`high`·`critical` |
| `owner` | `{ id, name, initials, is_me }` |
| `deleted_by` | `{ id, name, initials }`; `name` is `"You"` when it was the caller |
| `deleted_at` | ISO-8601 |
| `retention_days` | The period of **this item's** branch |
| `branch_id` | That branch (`BIN_BRANCH_SQL`), or null |
| `purges_at` | `deleted_at + retention_days` |
| `days_left` | `max(1, ceil(hours left / 24))` — **never 0** |
| `left_pct` | `round(min(days_left, retention_days) / retention_days × 100)` |
| `urgency` | `bad` when `days_left ≤ 3`, `warn` when `≤ 7`, else `ok` |
| `can_restore` | `binDenial()` is null |
| `can_purge` | `can_restore` **and** `bin_purge` **and** bin admin |
| `locked_reason` | The `binDenial()` text, else null |

Rows are ordered by `deleted_at` ascending (oldest first).

---

## 3. Restore and permanent delete

### 3.0 The Critical Vault rule (`binDenial()`)

Anything a user can see in the bin is theirs to restore, **except** a
Critical Vault item, which only the **Branch Admin of the item's branch**
(its `branch_id`, or its owner's branch) may restore or delete. Anyone else:

```
403  Only the Branch Admin can restore or delete Critical Vault items in the Recycle Bin.
```

That includes the client admin and the item's own owner.

### 3.1 `POST /credvault/recycle-bin/{id}/restore`

No body.

| # | Check | Failure |
|---|---|---|
| 1 | `{id}` is in the caller's `binQuery()` | 404 `That item is not in your Recycle Bin.` |
| 2 | `binDenial()` | 403 (§3.0) |

Transaction: `restore()`, `deleted_by = null`, `updated_by = caller`, audit
`restore` / "Restored from Recycle Bin".

```json
{ "status": true, "message": "“Old FTP” restored to Team Vault.",
  "data": { "id": 12, "vault": "normal", "restored_to": "Team Vault" } }
```

`restored_to` is `Critical Vault` (vault critical), else `Team Vault` (scope
team), else `My Vault`. 500 text:
`Could not restore the credential. Nothing was saved — please try again.`

### 3.2 `DELETE /credvault/recycle-bin/{id}`

| Body | Rule | Message |
|---|---|---|
| `confirm` | `accepted` (`true`, `1`, `"yes"`, `"on"`) | `Confirm that you understand this cannot be undone.` |

| # | Check | Failure |
|---|---|---|
| 1 | `confirm` accepted | 422 (above) |
| 2 | Policy `bin_purge` is on | 403 `Permanent delete is turned off in CredVault Policies.` |
| 3 | Caller is a bin admin | 403 `Only a Vault Admin (the client admin or a Branch Admin) can delete permanently. You can restore it.` |
| 4 | In the caller's bin | 404 `That item is not in your Recycle Bin.` |
| 5 | `binDenial()` | 403 (§3.0) |

Because check 3 comes before check 4, an employee gets the 403 even for an
id that does not exist.

```json
{ "status": true, "message": "“Old FTP” deleted permanently.", "data": { "id": 12, "vault": "normal" } }
```

`purgeOne()` writes audit `purge` / "Deleted permanently" (module "Recycle
Bin"), revokes remaining shares, force-deletes the row and, after commit,
deletes its attachment files. 500 text:
`Could not delete the credential permanently. Nothing was saved — please try again.`

### 3.3 `DELETE /credvault/recycle-bin` — Empty Bin

| Body | Rule | Default |
|---|---|---|
| `confirm` | `accepted` — `Confirm that you understand this cannot be undone.` | — |
| `vault` | `nullable`, in `normal`, `critical`, `all` | `all` |

| # | Check | Failure |
|---|---|---|
| 1 | Validation | 422 |
| 2 | `bin_purge` on | 403 `Permanent delete is turned off in CredVault Policies.` |
| 3 | Bin admin | 403 `Only a Vault Admin (the client admin or a Branch Admin) can empty the Recycle Bin.` |
| 4 | Something in the caller's bin for that vault | 409 `The Recycle Bin is already empty.` |
| 5 | At least one item passes `binDenial()` | 403 `Only the Branch Admin can delete Critical Vault items in the Recycle Bin.` |

Items that fail `binDenial()` are **kept** and counted, not an error:

```json
{ "status": true,
  "message": "3 items deleted permanently · 1 Critical Vault item left for the Branch Admin.",
  "data": { "vault": "all",
            "deleted": { "normal": 3, "critical": 0, "total": 3 },
            "skipped": { "critical": 1, "reason": "Only the Branch Admin can delete Critical Vault items." } } }
```

With nothing skipped the message is `N item(s) deleted permanently.` and
`skipped.reason` is null. Each item's audit detail is
`Deleted permanently (Empty Bin)`. One transaction for the whole batch;
500 text `Could not empty the Recycle Bin. Nothing was saved — please try again.`

> The **API default is `all`**, but the screen always sends the sub-tab it
> is on (`normal` or `critical`). A script calling without `vault` empties
> both vaults.

---

## 4. Retention period

One period covers **both vaults**. It is stored per branch
(`settings.bin_branch_days[branch_id]`), falling back to the company period
(`settings.bin_days`, default **30**). Allowed values:
`Policy::OPTIONS['bin_days'] = [7, 15, 30, 60, 90]`.

### 4.1 Which branch a call is about (`retentionTarget()`)

| Caller | `branch_id` sent | Target |
|---|---|---|
| Branch Admin | none or their own | their branch |
| Branch Admin | another branch | 403 `A Branch Admin can set the retention period of their own branch only.` (field `branch_id`) — **on GET too** |
| Client admin | none | `null` = the company default |
| Client admin | a branch of the company | that branch |
| Client admin | any other branch | 404 `That branch is not part of your company.` (field `branch_id`) |
| Employee, GET | ignored | their own branch (read-only) |
| Employee, PUT | — | 403 (see §4.3) |

> The SPA's Axios client adds the branch switcher's `branch_id` to every
> GET, so from the screen a client admin with a branch selected gets **that
> branch** on the GET — while the screen's PUT sends no `branch_id` and
> changes the company default. See Technical §8 (probable bug, not
> exercised).

### 4.2 `GET /credvault/recycle-bin/retention`

| Query | Rule | Message |
|---|---|---|
| `days` | `nullable`, integer, in 7/15/30/60/90 | `Choose 7, 15, 30, 60 or 90 days.` |
| `branch_id` | `nullable`, integer, min 1 | — |

```json
{ "status": true, "data": {
  "days": 30, "applies_to": "both", "scope": "branch",
  "branch": { "id": 3, "name": "Pune", "source": "company" },
  "company_days": 30, "options": [7, 15, 30, 60, 90], "can_change": true,
  "normal":   { "days": 30, "options": [7, 15, 30, 60, 90], "can_change": true, "fixed": false },
  "critical": { "days": 30, "options": [7, 15, 30, 60, 90], "can_change": true, "fixed": false },
  "branches": [ { "id": 3, "name": "Pune", "days": 30, "source": "company" } ],
  "note": "One period for My Vault and Critical Vault. Items already older than the new period are deleted right away.",
  "preview": { … only with ?days= … } } }
```

Null keys are removed (`array_filter`): `branch` is absent for the company
target, `branches` is present for the client admin only, `preview` only
with `days`. This GET **does not purge**.

**`preview`** (`retentionImpact()`) — what that period would delete
*right away*, counting only items the change newly puts past their period
(already-expired items are excluded: they go anyway):

| Field | Meaning |
|---|---|
| `days`, `branch_id` | As asked |
| `total` | Affected items, company-wide, in the target's scope |
| `visible_total` | How many of those are in the caller's own bin view |
| `items[]` | **Every** affected item, oldest first, capped at 500: `id, code, name, type, risk, vault, deleted_at, days_in_bin, in_my_bin, owner` |

`owner` is `"You"` for the caller's own items. `in_my_bin: false` marks
another person's bin; the screen prints "{owner}'s bin" for those.

> Not verified by running: an **employee** may call this with `?days=7` —
> the target is their branch and `items[]` lists other people's binned
> credentials of that branch by name and code. Nothing in the method limits
> the preview to bin admins. Worth a security review.

### 4.3 `PUT /credvault/recycle-bin/retention`

| Body | Rule | Message on failure |
|---|---|---|
| `days` | required, integer, in 7/15/30/60/90 | `Choose 7, 15, 30, 60 or 90 days.` (`in`); Laravel default for required/integer |
| `vault` | `nullable`, in `normal`, `critical` | **accepted and ignored** — one period covers both |
| `branch_id` | `nullable`, integer, min 1 | §4.1 |
| `confirm_purge` | `sometimes`, boolean | — |

| # | Check | Failure |
|---|---|---|
| 1 | Validation | 422 |
| 2 | Bin admin | 403 `Only a Vault Admin (the client admin or a Branch Admin) can change the retention period.` |
| 3 | Target (§4.1) | 403 / 404 |
| 4 | Shorter than current, no `confirm_purge`, and it would delete ≥ 1 item | 409 (below) |

```
409  3 credentials in the Recycle Bin are older than 7 days and will be deleted permanently. Confirm to continue.
409  1 credential in the Recycle Bin is older than 7 days and will be deleted permanently. Confirm to continue.
```

The 409 carries `errors.confirm_purge`. `n` is the preview's company-wide
`total`, not the caller's `visible_total`.

**Success**

```json
{ "status": true,
  "message": "Retention set to 7 days for Pune, for My Vault and Critical Vault · 2 items past the new period deleted.",
  "data": { "days": 7, "applies_to": "both", "scope": "branch", "branch_id": 3, "purged": 2 } }
```

`{where}` is `for {branch name}` (or `for branch #{id}` if the name is
missing) or `as the company default`. When nothing changed the message is
`Nothing changed.` and `purged` is 0.

| Target | How it is saved | 500 text |
|---|---|---|
| Company | `savePolicies(['bin_days' => …])` — the same path as CredVault Policies; purges when the new company period is shorter | `Could not save the policies. Nothing was saved — please try again.` |
| Branch | Row locked, `bin_branch_days[branch] = days`, audit `Retention period {where}: {from} days → {to} days` (module Recycle Bin), purge when shorter | `Could not save the retention period. Nothing was saved — please try again.` |

Branch path: "changed" means the branch had no own period yet **or** it
differed. Setting a branch to the company value therefore still pins it.

> **Also changes the period:** `PUT /credvault/policies { bin_days }` (client
> admin only, CredVault Policies screen) sets the company default and purges
> on a shorter value, without the 409 confirm step. Out of scope here; listed
> because it is a second writer of the same key.

---

## 5. Error messages you will meet

| Status | Message |
|---|---|
| 403 | `CredVault needs a company account — this login has no tenant.` |
| 403 | `You do not have access to Credentials Vault. Ask your admin to grant it in Permissions.` |
| 404 | `Credential not found.` |
| 404 | `This credential is in the Critical Vault — open it there.` |
| 404 | `This credential is in the Normal Vault (My Vault) — open it there.` |
| 409 | `This credential is shared with your whole team. Ask the owner to remove the team share.` |
| 403 | `Only the owner, a Vault Admin or someone with Full Access can delete this credential.` |
| 403 | `A critical credential can only be moved to the bin by its owner, a Vault Admin or the Branch Admin.` |
| 404 | `That item is not in your Recycle Bin.` |
| 403 | `Only the Branch Admin can restore or delete Critical Vault items in the Recycle Bin.` |
| 422 | `Confirm that you understand this cannot be undone.` |
| 403 | `Permanent delete is turned off in CredVault Policies.` |
| 403 | `Only a Vault Admin (the client admin or a Branch Admin) can delete permanently. You can restore it.` |
| 403 | `Only a Vault Admin (the client admin or a Branch Admin) can empty the Recycle Bin.` |
| 409 | `The Recycle Bin is already empty.` |
| 403 | `Only the Branch Admin can delete Critical Vault items in the Recycle Bin.` |
| 422 | `Choose 7, 15, 30, 60 or 90 days.` |
| 403 | `A Branch Admin can set the retention period of their own branch only.` |
| 404 | `That branch is not part of your company.` |
| 403 | `Only a Vault Admin (the client admin or a Branch Admin) can change the retention period.` |
| 409 | `{n} credential(s) in the Recycle Bin is/are older than {days} days and will be deleted permanently. Confirm to continue.` |
| 500 | `Could not {action}. Nothing was saved — please try again.` |

The success messages use typographic quotes `“ ”` around the credential
name and an em dash `—`; match them byte for byte in tests.

---

## 6. curl quick reference

Runs top to bottom. `$T` is a Sanctum token; `$B` the Branch Admin's.
Step 4 **purges expired items** — run it only where that is acceptable.

```bash
API=http://127.0.0.1:8000/api/credvault

# 1. Bin a Normal Vault credential, then a Critical one
curl -X DELETE $API/normal-vault/credentials/41   -H "Authorization: Bearer $T" -H "Accept: application/json"
curl -X DELETE $API/critical-vault/credentials/57 -H "Authorization: Bearer $T" -H "Accept: application/json"

# 2. Retention as the viewer sees it, then a preview of 7 days
curl "$API/recycle-bin/retention"        -H "Authorization: Bearer $B" -H "Accept: application/json"
curl "$API/recycle-bin/retention?days=7" -H "Authorization: Bearer $B" -H "Accept: application/json"

# 3. Change the branch period (409 first if it would delete anything)
curl -X PUT $API/recycle-bin/retention -H "Authorization: Bearer $B" \
     -H "Accept: application/json" -H "Content-Type: application/json" \
     -d '{"days":60}'

# 4. The list — Critical sub-tab, Expiring Soon, searched  (PURGES EXPIRED)
curl "$API/recycle-bin?vault=critical&tab=soon&q=ftp&per_page=50" \
     -H "Authorization: Bearer $B" -H "Accept: application/json"

# 5. Restore (Branch Admin for a Critical item)
curl -X POST $API/recycle-bin/57/restore -H "Authorization: Bearer $B" -H "Accept: application/json"

# 6. Delete one for good, then empty the Normal Vault bin
curl -X DELETE $API/recycle-bin/41 -H "Authorization: Bearer $B" \
     -H "Accept: application/json" -H "Content-Type: application/json" -d '{"confirm":true}'
curl -X DELETE $API/recycle-bin    -H "Authorization: Bearer $B" \
     -H "Accept: application/json" -H "Content-Type: application/json" -d '{"confirm":true,"vault":"normal"}'
```

The Postman collection `docs/CredVault_RecycleBin.postman_collection.json`
runs the same story with three logins (employee, Branch Admin, client
admin) in folders 00–05.
