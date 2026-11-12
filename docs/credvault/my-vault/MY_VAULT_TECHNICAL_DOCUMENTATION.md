# CredVault My Vault — Technical Documentation

Jira **GT-73**.

## 1. Stack

| Layer | What |
|---|---|
| Backend | Laravel 12, PHP 8.2, **PostgreSQL** (index and `lower()` SQL assume it) |
| Encryption | Laravel `encrypted` / `encrypted:array` casts under `APP_KEY` |
| Files | Laravel `local` disk (private), `credvault/<client>/<credential>/` |
| Mail | `CredVaultShareMail`, sent **synchronously** (`Mail::send`, not queued) |
| Frontend | React 19 + TypeScript, `resources/js/pages/credvault/` |
| Randomness | Server `random_int()`; browser `crypto.getRandomValues()` |

---

## 2. Architecture

```
  MyVault.tsx ───────────────┬──────────────┬───────────────┬──────────────┐
   tabs · search · pager     │              │               │              │
        │              CredentialTable  ViewDrawer      ShareModal     BinConfirm
        │                    │              │               │              │
        │        CredentialFormModal ─ TypePicker ─ CredentialForm   GeneratorModal
        │                    │                                    (on device,
        ▼                    ▼                                     no API call)
     cvApi.ts  ── axios api.ts (Bearer token; GETs get ?branch_id=) ──┐
                                                                      ▼
  /api/credvault  ── auth:sanctum → user.active → tenant → throttle:credvault
        │
        ├─ normal-vault/*  NormalVaultController  ─ extends ─┐
        │                    index · nextCredentialCode ·    │
        │                    store · update · destroy        │
        └─ credentials/*, shares, share-recipients,          ▼
           meta, generate-password            CredVaultController (5,719 lines)
                                                listCredentials · persistCredential
                                                binCredential · detail · reveal
                                                share · revokeShare · sharedByMe
                                                visibleQuery · accessMap · canFlags
                                                     │
          ┌──────────────────────┬──────────────────┼────────────────┐
          ▼                      ▼                  ▼                ▼
  credvault_credentials   credvault_shares   credvault_audit_logs  notifications
  (both vaults)           (live = unrevoked  (every action)        (bell)
                           and unexpired)
          ▲
          └── Policy::for(client_id)  ← credvault_policies.settings (json)
```

The `branch_id` the axios interceptor adds to GETs is **ignored** by these
endpoints: none of them reads it. Branch scoping comes from the user record.

---

## 3. Data model

Columns from the live schema (`Schema::getColumns`, PostgreSQL).

### 3.1 `credvault_credentials` — `App\Models\CredVault\Credential`

| Column | Type | Null | Default | Note |
|---|---|---|---|---|
| id | bigint | no | seq | |
| client_id | bigint | no | | tenant |
| branch_id | bigint | yes | | creator's branch at save |
| code | varchar(20) | no | | `CRD-0001` / `CCRD-0001` — unique per client |
| vault | varchar(10) | no | `'normal'` | `normal` · `critical` |
| type | varchar(20) | no | | one of 25 |
| category_group | varchar(40) | no | | from the type |
| name | varchar(150) | no | | |
| scope | varchar(10) | no | `'personal'` | `personal` · `team` |
| owner_id | bigint | no | | |
| department_id | bigint | yes | | team scope only |
| url | varchar(500) | yes | | derived: first of url / endpoint / host / domain |
| username | varchar(191) | yes | | derived from the type's id field |
| secret | text | yes | | **encrypted** — the type's main secret |
| secret_hash | varchar(64) | yes | | HMAC-SHA256 under APP_KEY, for reuse detection |
| fields | text | yes | | **encrypted json** — every type field + `_reg_email`, `_reg_phone`, `_recovery_key` |
| notes | text | yes | | **encrypted** — the form's Remark |
| attachments | json | yes | | `[{key, name, size, mime, path, at}]` |
| risk | varchar(10) | no | `'medium'` | |
| strength | smallint | no | `0` | 0 none · 2 Fair · 3 Good · 4 Strong |
| has_password | boolean | no | false | |
| twofa | varchar(3) | no | `'na'` | `yes` · `no` · `na` |
| rotation_days | smallint | yes | | 30 · 60 · 90 · 180 |
| password_changed_at | timestamp | yes | | |
| lock_admin · lock_manager · lock_otp | boolean | no | false | **always false in the Normal Vault** |
| lock_admin_user_id · lock_manager_user_id | bigint | yes | | always null now |
| totp_secret | text | yes | | encrypted; Critical Vault only |
| totp_linked_at · twofa_linked_at | timestamp | yes | | Critical Vault only |
| twofa_method | varchar(10) | yes | | Critical Vault only |
| twofa_email | varchar(191) | yes | | Critical Vault only |
| created_by · updated_by · deleted_by | bigint | yes | | |
| created_at · updated_at · deleted_at | timestamp | yes | | `deleted_at` = in the Recycle Bin |

Indexes: unique `(client_id, code)`; `(client_id, deleted_at)`,
`(client_id, risk)`, `(client_id, scope, department_id)`,
`(client_id, updated_at)`, `(client_id, vault)`; single-column on
`branch_id`, `client_id`, `department_id`, `owner_id`, `secret_hash`.

`$hidden = ['secret', 'secret_hash', 'fields', 'notes', 'totp_secret']` — they
never appear in a `toArray()`.

### 3.2 `credvault_shares` — `CredentialShare`

| Column | Type | Null | Note |
|---|---|---|---|
| id | bigint | no | |
| client_id | bigint | no | |
| credential_id | bigint | no | |
| shared_by | bigint | no | the original sharer; kept on renewal |
| recipient_type | varchar(10) | no | `user` · `team` (CHECK constraint) |
| recipient_user_id | bigint | yes | |
| recipient_department_id | bigint | yes | |
| permission | varchar(10) | no | `use` · `view` · `copy` · `full` (CHECK) |
| reason | varchar(500) | yes | |
| expires_at | timestamp | yes | null = no expiry |
| revoked_at · revoked_by | ts / bigint | yes | never deleted |
| created_at · updated_at | timestamp | yes | |

**The partial unique index** (migration
`2026_10_30_000002_create_credvault_shares_table.php`):

```sql
create unique index uq_credvault_share_live on credvault_shares
 (credential_id, recipient_type, coalesce(recipient_user_id, 0), coalesce(recipient_department_id, 0))
 where revoked_at is null
```

> *"coalesce: Postgres treats NULLs as distinct, which would let two live team
> shares through because recipient_user_id is null on both."*

`Schema::getIndexes()` lists it as `(credential_id, recipient_type)` because
it does not print expressions — read the migration, not the listing.

Note the index keys on `revoked_at is null` only. **An expired but unrevoked
share still occupies the slot**, so the share code matches on
`whereNull('revoked_at')` (not `live()`) and renews it.

### 3.3 Supporting tables

| Table | Columns used here |
|---|---|
| `credvault_policies` | id, client_id (unique), settings json, updated_by, timestamps |
| `credvault_audit_logs` | id, client_id, branch_id, user_id, action, severity, credential_id, credential_code, credential_name, module, detail, meta json, ip, user_agent, created_at (no updated_at) |
| `notifications` | the shared bell table — `type = App\Notifications\CredVault` |

### 3.4 Constants

| Constant | Value | Where |
|---|---|---|
| `Credential::SCOPES` | personal, team | model |
| `Credential::RISKS` | low, medium, high, critical | model |
| `Credential::TWOFA` | yes, no, na | model |
| `Credential::VAULT_PREFIX` | normal → CRD, critical → CCRD | model |
| `Credential::ROTATIONS` | 30, 60, 90, 180 | model |
| `Credential::STRENGTH_LABELS` | 0 '', 1 Weak, 2 Fair, 3 Good, 4 Strong | model |
| `CredentialShare::PERMISSIONS` | use, view, copy, full — *"Ordered weakest first"* | model |
| `RANK_USE..RANK_FULL` | 0..3 | controller |
| `PAGE_SIZE` | 10 | controller |
| `FILE_MAX_KB` | 10240 | controller |
| `MAX_EXTRA_ATTACHMENTS` | 5 | controller |
| `ADMIN_TYPES` | super_admin, client_admin, branch_user | controller |
| `LEVEL_ORDER` | admin 0, hod 1, tl 2, exec 3, emp 4, intern 5 | controller |
| Policy defaults | min_strength 3, rotation_default 90, rotation_warn 15, share_critical true, share_max_days 30, share_reason true, overshare_limit 3, bin_days 30 | `Policy::DEFAULTS` |

---

## 4. Two vaults, one table

`vault` is fixed at creation like `type`. The Normal Vault controller passes
`'normal'` into every shared helper:

| | Normal (My Vault) | Critical |
|---|---|---|
| Code | `CRD-` | `CCRD-` |
| Risk | low · medium · high | critical only |
| 2FA | recorded `yes/no/na` | the unlock's code step |
| Locks | all false | admin / manager / otp |
| `lockSteps()` | `[]` — *"Only the Critical Vault has steps"* | policy-gated steps |
| TOTP seed check | none — *"My / Team Vault keep the key as typed"* | base32 |

`findInVault()` makes the other vault's credentials 404 on the vault-specific
routes; the shared routes (`/credentials/{id}`, reveal, shares…) take either.

### 4.1 Code allocation

```php
/* The next code for a per-client series (CRD-0001, REQ-0001 …), allocated
   under a lock on the client's row so two saves cannot take the same one.
   Must run inside a transaction. The audit log is consulted too, so a code
   once used by a credential since purged is never handed out again. */
protected function nextCode(string $table, string $prefix, int $clientId): string
{
    DB::table('clients')->where('id', $clientId)->lockForUpdate()->value('id');
    return sprintf('%s-%04d', $prefix, $this->lastNumber($table, $prefix, $clientId) + 1);
}
```

`peekCode()` (the form's preview) is the same number **without** the lock.
Soft-deleted rows are still in the table, so their codes count; purged rows are
found through `audit_logs.action = 'purge'`.

---

## 5. Secrets

### 5.1 What is stored where

```
fields (encrypted json) ─┬─ every type field, plain values, incl. the secret
                         ├─ _reg_email · _reg_phone · _recovery_key
secret (encrypted)  ─────┴─ a copy of fields[sec]   ← reveal reads this first
secret_hash ─────────────── hmac(secret)            ← reuse detection
username ────────────────── fields[id], or "•••• 1234" when the id field is secret
url ─────────────────────── fields[url|endpoint|host|domain], first filled
strength / has_password ─── strengthOf(secret), only for password-secret types
```

### 5.2 The strength rule (D34) — identical on both sides

```php
$mixed = preg_match('/\p{L}/u', $pw) && preg_match('/\p{N}/u', $pw) && preg_match('/[^\p{L}\p{N}\s]/u', $pw);
return match (true) { $mixed && $len >= 12 => 4, $mixed && $len >= 8 => 3, default => 2 };
```

`formHelpers.ts::strengthOf()` is the same expression. 1 (Weak) is never
produced: *"Fair is the lowest and counts as weak."*

The policy check runs only when the secret changed:

```php
$changed = $creating || ($sec && array_key_exists($sec, $inputFields) && $secret !== $c->secret);
if ($isPw && $secret !== null && $changed && $strength < $pol['min_strength'] && !$this->importing) …
```

### 5.3 Ways a secret leaves the server

| Route | Gate | Audited by server |
|---|---|---|
| `POST /credentials/{id}/reveal` | rank ≥ view (copy ≥ copy), 60/min | **yes** — `reveal` / `copy` |
| `GET /credentials/{id}` (`detail(..., plain: true)`) | rank ≥ view | **no** |
| Export / backup | other module | yes |

See §9 for why the second one matters.

---

## 6. Visibility and access

Two separate questions, answered by two methods:

```
visibleQuery($u)  →  which rows LIST     (a SQL builder)
accessMap($creds, $u) → [rank, via] per row → what each row may DO
canFlags($c, $acc)    → the buttons
```

**They do not agree, on purpose** — see §6.4.

### 6.1 `visibleQuery()`

```
client_id = mine AND (
     owner_id = me
  OR id IN (live shares to me or my department)
  OR owner_id IN overseenUserIds(me)                ← any scope
  OR [client admin]  scope = 'team'                 ← and stop here
  OR [HOD]           scope = 'team' AND department_id IN headed
  OR [Branch Admin]  scope = 'team' AND owner is a non-admin of my branch
                                    (or credential filed in my branch)
  OR [downline]      scope = 'team' AND owner_id IN downline )
```

`overseenUserIds()`: the client admin → **every user of the company**; a
Branch Admin → non-admin users of the branch; an HOD → users of headed
departments; everyone → their reporting downline.

> *"People this viewer oversees: their whole vault (personal and team) is
> visible, as these are company credentials. Reveal stays gated by accessMap,
> not this list."*

### 6.2 `accessMap()`

```php
if ($c->owner_id === $u->id)  → [FULL, 'owner']
if ($c->scope === 'team'):
    admin                                       → [FULL, 'admin']
    branch admin, owner non-admin of my branch  → [FULL, 'branch']
    owner in my downline                        → [FULL, 'manager']
    department I head:  owner below me          → [FULL, 'hod']
                        otherwise               → [COPY, 'team']
critical + same branch (not client admin)       → [VIEW, 'branch_critical']
a live share ranked higher                      → [rank, 'share']
```

> *"Full Access (edit, share, delete) on a team credential goes to the Vault
> Admin, the Branch Admin of the owner's branch, a manager the owner reports
> to (at any depth) and the HOD of its department — the last three only over
> people below them, never over someone above or at their level (a HOD keeps
> view-and-copy on those in the department)."*

Note: plain team **membership** does **not** give access. The class docblock
says *"copy (2) … or a member of the team it belongs to"*; the code only gives
`team` (Copy) to an HOD over a peer or senior. A department member who is not
HOD and not a manager reaches a colleague's team credential only through a
share. **Worth testing** against the product expectation.

### 6.3 `canFlags()`

```php
'reveal' => rank >= VIEW,  'copy' => rank >= COPY,
'edit'   => rank >= FULL,  'share' => rank >= FULL,
'delete' => rank >= FULL && via !== 'share' && (risk !== 'critical' || via in owner|admin|branch),
'remove' => via === 'share',
'edit_protection' => via in owner|admin,
```

A Full **share** therefore edits and shares, but gets *Remove from your vault*
instead of *Move to Bin* — the UI's bin button and the API's `binCredential()`
agree on that.

### 6.4 Listed but not openable

A downline's or (for the client admin) anyone's **personal** credential is in
`visibleQuery()` through `overseenUserIds()`, but `accessMap()` only grants
rank on `scope = 'team'`. The row comes back with `access: null, can: null`;
the table disables every action except View, and View answers 404
`Credential not found.`

This contradicts the class docblock (*"A personal credential is the owner's
alone; not even a Vault Admin sees it unless it was shared"*): the Vault Admin
does **see** it in the list, with name, URL, username and type. Whether the
list exposure is intended is **not verified — worth raising**.

### 6.5 Who is who

| Role | Test |
|---|---|
| Vault Admin | `isClientAdmin()` only — *"once demoted they stop being a Vault Admin"* |
| Branch Admin | `user_type = 'branch_user'` with a `branch_id` (`adminBranchOf()`) |
| HOD | `master_departments.head` matched by **name** to exactly one active HR employee — *"never the login's own name, which every user can edit on their profile … must not land on a namesake"* |
| Downline | BFS over `employees.reporting_manager_id` / `reporting_manager_user_id`, loops stopped |
| Department | `users.department_id`, else the HR record's |

---

## 7. Sharing internals

### 7.1 Order of checks

`share()`: validate → `findCredential(RANK_FULL)` → cap the end for a
re-sharer → critical rules → policy max → reason → recipient checks → one
transaction (lock the live row, insert or renew, end orphaned shares on a
renewal, audit, bell) → email outside the transaction.

### 7.2 The branch limit (CS-1440 #46)

```php
protected function shareBranchOf(User $u): ?int
{
    if ($this->isAdmin($u)) return null;
    return $u->branch_id ? (int) $u->branch_id : null;
}
```

Used twice, so the list and the save agree: `shareRecipients()` filters users
by it; `share()` refuses a user outside it. **Team shares and the teams list
are not filtered** — a team share reaches the department's members in every
branch. Whether that is intended is **not verified**.

### 7.3 No share-back (commit `8e6d697a`)

`sharedToMeBy($u, $c)` = `[user id => name]` of the people whose live share
reaches `$u` (directly or via `$u`'s department). It is sent in every row as
`access.shared_by`, the popup hides those people, and `share()` refuses them.

### 7.4 Re-shares cannot outlive the re-sharer

```php
/* Someone who holds Full Access through a share cannot pass on more than they have:
   their re-share ends when their own share does (a longer or open-ended pick is
   shortened to that, and the response says so). */
```

`ownShareEnd()` returns the latest end of the user's own live Full shares, or
null if any of them never ends.

### 7.5 Orphaned shares unwind

```php
/* A share passed on by someone other than the owner rides on that person's Full
   Access. Whenever they lose it (revoke, downgrade, removal, the credential turning
   critical) the shares they made end too — repeated until stable, so a chain of
   re-shares unwinds however deep it goes. */
```

Called after revoke, after remove-from-vault, and after a renewal. Capped at 10
rounds. **Nothing calls it when a share simply expires.** The cap in §7.4
normally makes that harmless, but the cap is taken when the re-share is made:
if the sharer's own share had no end then and is later renewed with one, their
earlier re-share keeps its longer end (the renewal's `endOrphanedShares()`
sees the sharer still holding Full and leaves it). Not verified in practice —
worth a test.

---

## 8. Concurrency

| Race | Guard |
|---|---|
| Two saves take the same CRD number | `nextCode()` locks the `clients` row inside the transaction; unique `(client_id, code)` |
| Double-click Save | `savingRef` in the form; the save lock disables the fieldset |
| Two shares to one recipient at once | `lockForUpdate()` on the live row, then `uq_credvault_share_live`; the loser gets 409 `This credential was just shared with <Name>. Refresh and try again.` |
| Two revokes | `lockForUpdate()` + 409 `This share was already revoked.` |
| Slow list responses arriving out of order | `seq` counter in `MyVault.tsx`; an older response is dropped |
| Activity "Load more" vs a refresh | `actSeq` in the drawer |
| Duplicate-name check | **not guarded** — two simultaneous creates with the same name can both pass (no unique index on name) |

Files: stored before the commit; on any failure `inTransaction()` deletes them
(`$cleanup`). Removed files are deleted only after commit
(`DB::afterCommit`).

**Inside the share transaction, `notify()` catches a failed insert.** On
PostgreSQL a failed statement aborts the transaction even when PHP catches it,
so a bell failure could roll back the share at commit. **Not verified —
worth testing** with the notifications table unavailable.

---

## 9. The detail response exposes every secret

`show()` calls `detail($c, $u, $acc, plain: true)`:

```php
/* $plain (the single GET only): every stored value in plain text — passwords
   and secret fields, recovery key, registered email / phone, notes — for anyone
   allowed to reveal (View or higher) … Use Only never sees a secret. */
```

Consequences, from reading the code (**worth testing in the browser**):

1. **No server audit.** `show()`: *"Opening the drawer is logged once by
   logAccess … an actual field reveal is logged by the reveal/copy endpoint.
   No entry here."* The only trace of opening is the `view` event the drawer
   posts itself (`api.event(id, 'view')`). A client that skips it reads every
   secret unrecorded, within the 240/min limit rather than reveal's 60/min.
2. **The drawer may show secrets unmasked.** `ViewDrawer.tsx` masks a field
   only when the API says `masked`; for View+ nothing is masked, so:
   - the Overview secret card and the header Reveal / Copy buttons (which look
     for a masked field) do not render;
   - the Details tab prints the value — the "start hidden" branch is only
     for `crit && f.secret`, i.e. critical credentials;
   - the copy button there calls `copyPlain()` → `POST /events
     {action: copy, field: <secret>}`, which the server refuses with
     `Copy a secret through /reveal.`; the error is swallowed, so **the copy
     happens and nothing is logged**.
3. The Share popup and the Edit form also call `show()` — the edit form needs
   `all_values` to pre-fill — so opening either fetches every secret.

The older `CREDVAULT_VAULTS_API_SHEET.md` says this read is audited as a
`reveal`. It was, once — `activity()` still hides those legacy rows.

---

## 10. Multi-tenancy

- `client_id`, `branch_id`, `owner_id`, `created_by` come from the user;
  `credentialRules()` has no such fields.
- Every query starts `where client_id = $u->client_id`, including the
  subqueries for shares, owners and departments.
- Departments: the tenant's own **plus `client_id IS NULL` platform ones** —
  for team scope and team shares. HOD resolution deliberately uses **only**
  the tenant's own: *"a shared (client_id null) department has one head name
  for every tenant, which would hand HOD rights to a namesake anywhere."*
- Scope deliberately lifted: none across tenants. Inside a tenant the
  client admin is company-wide for sharing (§7.2) and listing (§6.1).
- The axios `branch_id` query parameter is not read by any route here.

---

## 11. Files

| | Type's own file field (`files[<key>]`) | Extra attachments (`attachments[]`) |
|---|---|---|
| Types | cert, passport, driver, govid, document, medical | every type without a file field |
| Extensions | pdf jpg jpeg png pem crt cer pfx | pdf png jpg jpeg webp doc docx xls xlsx csv txt |
| Count | one per field, replaces the old | ≤ 5 in total |
| Key | the field key | `att-` + 8 random chars |
| Size | 10 MB | 10 MB |

Stored on the private `local` disk; served only by
`GET /credentials/{id}/attachments/{key}` (rank ≥ view, audited). The browser
checks size and extension first with the same lists, read from `meta`.

---

## 12. Audit

`audit()` → `credvault_audit_logs`, with IP and user agent. Module:
`Critical Vault` if risk critical, else `Team Vault` for team scope, else
`My Vault`. Severity from `AuditLog::ACTIONS`; `reveal`, `copy`, `share` on a
critical credential are raised to `critical`.

| Action | Written by |
|---|---|
| `create` | `{Type} credential added` |
| `edit` | `Updated: name, risk, …, details, secret` |
| `health_fixed` | one per resolved Password Health issue |
| `reveal` / `copy` | `<Label> revealed` / `copied` |
| `view` | drawer opened (client), plain field copied (client), attachment opened |
| `launch` | `Launched <url>` (client) |
| `share` | the share, and the mail outcome |
| `revoke` | revoke, remove-from-vault, orphaned share ended |
| `bin` | `Moved to Recycle Bin` |
| `generate` | server generator only |

---

## 13. Where every field's data comes from

| Screen element | Endpoint | Source |
|---|---|---|
| Type picker, form fields, options | `GET /meta` → `types`, `groups` | `Credential::TYPES` (constant, not a table) |
| Risk options | `GET /meta` → `risks`, filtered in the form | `Credential::RISKS` |
| Rotation options / default | `GET /meta` → `rotations`, `policy.rotation_default` | `Credential::ROTATIONS`, `credvault_policies` |
| Policy minimum strength | `GET /meta` → `policy.min_strength` | `credvault_policies` |
| Credential ID preview | `GET /normal-vault/credentials/next-code` | `credvault_credentials` + `audit_logs` |
| Owner (Add) | `GET /meta` → `me.name` | `users` |
| Team (`department_id`) | `GET /meta` → `me.department_id` | `users` / `employees` |
| Share With — people | `GET /share-recipients` → `users` | `users` (active, branch) |
| Share With — teams | `GET /share-recipients` → `teams` | `master_departments` + `employees` count |
| Permission cards | `GET /meta` → `permissions` | controller literal |
| Duration buttons | `GET /meta` → `share_durations` | literal, filtered by `policy.share_max_days` |
| Bin retention days | `GET /meta` → `bin_days.normal` | policy, per branch |
| Generator minimum | `GET /meta` → `policy.min_strength` | policy |
| Generator word list | bundled `resources/credvault/eff_large_wordlist.txt?raw` | file |

### 13.1 Derived on the server, never accepted from the client

`client_id`, `branch_id`, `owner_id`, `code`, `vault`, `category_group`,
`url`, `username`, `secret`, `secret_hash`, `strength`, `has_password`,
`password_changed_at`, `twofa` (from the type and switches), every `lock_*`
(false), `created_by`, `updated_by`, `deleted_by`; on a share `client_id`,
`shared_by`; the share's end when capped.

---

## 14. Front / back differences

| Area | Frontend | Backend |
|---|---|---|
| Weak old password on edit | blocks every save | blocks only when the secret changes |
| Risk / 2FA by HOD or Full share | locked (`edit_protection`) | **allowed** — `protectionChange()` is called only by `CriticalVaultController::update` |
| Branch Admin changing risk | locked (owner / admin only) | allowed |
| SSH private key length | ≤ 64 | ≤ 10,000 |
| API key / secret | ≤ 128, no spaces | ≤ 10,000, any |
| Login username | ≥ 3 characters | no minimum |
| Driver / Aadhaar / PAN format | checked | upper-cased only |
| DOB 18+, issue < expiry | checked (My Vault only) | not checked |
| Account number | 9–18 digits | none |
| Share end date | from tomorrow | from today |
| Reason message | `Give a reason (at least 5 characters)` | `Give a reason for sharing (at least 5 characters).` |
| Generator | on device, unaudited | `/generate-password`, audited |
| "No other active users in your branch." | shown to the client admin too | client admin is not branch-limited |

---

## 15. Frontend internals

- **`useCvMeta()`** loads `/meta` once per page (cached promise in `cvApi`);
  every component reads types and policy from it.
- **`inCritical`** in `CredentialForm` = opened from the Critical Vault, or
  editing a credential already critical. My Vault never sets it. Gated on
  `!inCritical`: DOB / issue-expiry pickers, card expiry picker, field-named
  copy toasts, the frozen fields being non-focusable, and the full save lock.
- **`fieldLabels`** on `ViewDrawer` (My Vault, Password Health): field-named
  toasts, Launch for every risk with a High/Critical confirm.
- **`secretLabels`** on `CredentialTable` (My Vault): *Copy `<secret>`*.
- **`lockBusy`** on `BinConfirm` (My Vault, CS-1445): Cancel and × locked
  while the move runs.
- The form builds `FormData` only when a file is attached; booleans become
  `1`/`0`, nested `fields` become `fields[key]`.
- `BinConfirm` picks the vault route from `row.risk === 'critical'`, not
  `row.vault`. Equivalent today because the Normal Vault refuses critical.
