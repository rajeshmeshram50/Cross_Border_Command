# CredVault My Vault — API Documentation

Jira **GT-73**. Covers the endpoints the **My Vault** screen
(`/credentials-vault/my-vault`) calls. Critical Vault, Team Vault, Recycle Bin,
Password Health and Import & Recovery have their own documents; where a route
here is shared with them it is called out.

## 0. How to read this

Base URL `/api`. Every route sits inside

```
Route::middleware(['auth:sanctum', 'user.active', 'tenant'])      routes/api.php:163
  └─ Route::prefix('credvault')->middleware('throttle:credvault')  routes/api.php:755
```

| Controller | Routes |
|---|---|
| `App\Http\Controllers\Api\CredVault\NormalVault\NormalVaultController` | `/credvault/normal-vault/*` — list, next code, create, edit, delete |
| `App\Http\Controllers\Api\CredVault\CredVaultController` | everything else here — meta, detail, reveal, events, activity, attachments, sharing, generator |

`NormalVaultController` **extends** `CredVaultController`; the four write
methods are thin wrappers around `persistCredential()` and `binCredential()`
with `$vault = 'normal'` fixed.

### 0.1 Who may call anything at all

`tenantUser()` runs first in every method:

| Condition | Status | Message |
|---|---|---|
| Login has no `client_id` (super admin) | 403 | `CredVault needs a company account — this login has no tenant.` |
| Not a client admin and no `can_view` on the module `credentials-vault` | 403 | `You do not have access to Credentials Vault. Ask your admin to grant it in Permissions.` |

The client admin always passes. **There is no other role test on any route
below** — what a user may do to a given credential is decided per credential by
the access rank (§0.4).

### 0.2 Response envelope

```json
{ "status": true,  "data": { … }, "message": "…" }
{ "status": false, "message": "…", "errors": { "field": ["…"] } }
```

Lists add `tabs` and `meta: { current_page, per_page, total, last_page }`.
Refusals come from `reject()`; when it names a field the message is repeated in
`errors[field]`, so the form can put it under the right input.

### 0.3 Status codes actually used

| Code | When |
|---|---|
| 200 / 201 | OK / created (a share renewal is 200, a new share 201) |
| 403 | Module access, rank too low for the action, policy forbids |
| 404 | Not found **or out of your reach** — the API never says "exists but not yours" |
| 409 | A race lost, or an action that no longer applies (already revoked, team-only share) |
| 422 | Validation and business rules |
| 423 | `code: "locked"` — Critical Vault only; a Normal Vault credential never returns it |
| 429 | Rate limit (§0.5) |
| 500 | `Could not <action>. Nothing was saved — please try again.` (logged) |

The `<action>` strings are: `save the credential`, `update the credential`,
`move the credential to the bin`, `remove the credential from your vault`,
`share the credential`, `revoke the share`.

### 0.4 The access rank

Every credential-level route resolves `[rank, via]` with `accessMap()`.

| Rank | Name | Gives |
|---|---|---|
| 0 | `use` | Listed, drawer opens, **no secret, no notes, no files** |
| 1 | `view` | + reveal a secret, open attachments |
| 2 | `copy` | + copy a secret |
| 3 | `full` | + edit, share, delete |

`via` is one of `owner`, `admin`, `branch`, `manager`, `hod`, `team`,
`branch_critical`, `share`. How each is reached is in the Technical document
§6. A credential with no rank for the caller reads as **404
`Credential not found.`** everywhere.

### 0.5 Rate limits

Named limiters in `AppServiceProvider::boot()`, keyed per user:

| Limiter | Limit | Applies to |
|---|---|---|
| `credvault` | 240 / min | every route in this document |
| `credvault-reveal` | 60 / min | `POST /credentials/{id}/reveal` (in addition) |

> *"Named, because a plain throttle:N,1 keys on the user alone — every throttle
> on a route then shares one counter … Each name gets its own bucket."*

---

## 1. Lookups

### 1.1 `GET /credvault/meta`

Everything the forms need, in one call. The frontend caches it for the page
(`cvApi.meta()`).

| Key | Content |
|---|---|
| `types[]` | The 25 types from `Credential::typeDef()` — fields, `sec`, `id`, `twofa`, `risk`, `extras` |
| `groups[]` | The 5 picker groups with description, icon, type keys |
| `risks[]` | low · medium · high · critical (`Critical — needs approval to view`) |
| `vaults[]` | `normal`: prefix `CRD`, risks `low, medium, high`, `two_step: recorded` · `critical`: `CCRD`, `critical`, `enforced` |
| `rotations[]` | `null` (No rotation), 30, 60, 90, 180 |
| `permissions[]` | `use` Use Only · `view` View · `copy` Copy · `full` Full Access, with descriptions |
| `share_durations[]` | Filtered by policy — see §5.3 |
| `file_types` | `attachments`, `file_fields`, `max_mb: 10`, `max_attachments: 5` |
| `policy` | The tenant's policy with defaults filled (`Policy::for()`) |
| `bin_days` | `{ normal, critical }` — the viewer's branch retention |
| `me` | `id, name, is_vault_admin, department_id, manager_user_id` |

### 1.2 `GET /credvault/normal-vault/credentials/next-code`

```json
{ "status": true, "data": { "vault": "normal", "next_code": "CRD-0042", "preview": true } }
```

**A preview only — nothing is reserved.** The real code is allocated at save
time under a lock; two people opening the form see the same preview.

### 1.3 `GET /credvault/share-recipients?q=`

| Query | Rule |
|---|---|
| `q` | nullable, string, max 100 — matches user `name` / `email`, team `name` |

```json
{ "data": {
    "users": [{ "id": 7, "name": "…", "email": "…", "designation": "…", "user_type": "employee" }],
    "teams": [{ "id": 3, "name": "Accounts", "members": 6 }] } }
```

- **users**: active logins of the company, never the caller, at most 200,
  ordered by name. **Limited to the caller's branch** unless the caller is the
  client admin (`shareBranchOf()` returns null for them). A caller with no
  `branch_id` is not limited either.
- **teams**: the tenant's departments plus the platform's shared ones
  (`client_id` null), **only those with at least one active HR employee**.
  Teams are **not** branch-limited. `members` counts HR employees
  (`employees.status = 'Active'`), not logins.

---

## 2. List

### 2.1 `GET /credvault/normal-vault/credentials`

`NormalVaultController::index()` → `listCredentials($request, 'normal')`.

| Query | Rule | Meaning |
|---|---|---|
| `tab` | `all` · `mine` · `team` · `shared` · `others` | Default `all`. My Vault sends the first four |
| `q` | ≤ 100 chars | See §2.2 |
| `page` | ≥ 1 | |
| `per_page` | 1–100, default **10** | |
| `risk` | low · medium · high · critical | |
| `type` | one of the 25 keys | |
| `group` | one of the 5 group names | |
| `department_id` | integer | Team side only (`mine` ignores it) |
| `member_id` · `member_employee_id` | integer | Team Vault's hierarchy filter — not used by My Vault |

**`vault` cannot be overridden on this route** — it is fixed to `normal`.

**The tabs** (`listCredentials()`):

| `tab` | Rows |
|---|---|
| `all` | Everything `visibleQuery()` returns for the caller |
| `mine` | `owner_id = me` |
| `team` | (`scope = 'team'` **or** owner is someone I oversee) **and** not mine **and** not shared with me |
| `shared` | Not mine **and** a live share to me or my department |
| `others` | Not mine — Critical Vault's tab; accepted here but unused |

`tabs` carries the count of every tab above **plus `sharedby`** — the live
shares (active + expiring soon) **on credentials I own**, searched with the
Shared By Me search. Counts follow `q`.

**Sort:** `updated_at desc, id desc`. **No sort parameter.**

Each row (`row()`):

```json
{ "id": 12, "code": "CRD-0012", "critical_code": null, "vault": "normal",
  "type": "login", "type_label": "Login", "category_group": "Logins & Access",
  "name": "Zoho Books Admin", "url": "https://books.zoho.in", "username": "admin@…",
  "scope": "personal",
  "owner": { "id": 4, "name": "…", "initials": "AK", "is_me": true },
  "department": null, "risk": "medium",
  "strength": "Strong", "strength_level": 4, "has_password": true, "twofa": "yes",
  "two_step": null, "rotation_days": 90,
  "next_rotation_due": "2027-01-20T…", "rotation_state": "ok",
  "protected": false, "lock_steps": [],
  "access": { "permission": "full", "via": "owner", "shared_by": [] },
  "can": { "reveal": true, "copy": true, "edit": true, "share": true,
           "delete": true, "remove": false, "edit_protection": true },
  "unlock": null, "active_shares": 2,
  "created_at": "…", "updated_at": "…" }
```

- `username` for a type whose id field is secret (account no., passport no.)
  is `•••• ` + the last four characters — set at save time.
- `strength` is `null` when the type has no password (`has_password` false).
- `rotation_state`: `ok` · `soon` (within `rotation_warn` days) · `over` · `null`.
- **`access` and `can` are `null`** for a row the caller can list but has no
  rank on — see the Technical document §6.4.

### 2.2 What `q` matches

`credentialSearch()`: `name`, `code`, `username`, `url`, `category_group`
(case-insensitive contains, `%` and `_` literal); the **type label**; the
**risk word** ("high"); the **strength word** ("weak", "strong" — only rows
with a password); and the **owner's name**.

---

## 3. Create and edit

### 3.1 `POST /credvault/normal-vault/credentials`

JSON, or `multipart/form-data` when files are attached.

### 3.2 `PUT|POST /credvault/normal-vault/credentials/{id}`

Partial: **a field left out keeps its stored value.** `POST` exists because
*"PHP does not read multipart bodies (attachments) on a PUT."*

Guards before the save, in order:

| # | Check | Status | Message |
|---|---|---|---|
| 1 | Credential visible to caller | 404 | `Credential not found.` |
| 2 | It is a Normal Vault credential | 404 | `This credential is in the Critical Vault — open it there.` |
| 3 | Rank ≥ full | 403 | `Only the owner, a Vault Admin or someone with Full Access can edit this credential.` |
| 4 | `scope` changed by someone not owner / admin / branch | 403 | `Only the owner, a Vault Admin or the Branch Admin can change the vault.` |
| 5 | `department_id` changed, same people | 403 | `Only the owner, a Vault Admin or the Branch Admin can change the team.` |

### 3.3 Request fields (`credentialRules()`)

| Field | Rule | Notes |
|---|---|---|
| `type` | required on create, one of 25 | Cannot change on edit (§3.5) |
| `name` | required on create, string 2–150 | |
| `scope` | `personal` · `team` | Default `personal` |
| `department_id` | integer | Needed when `scope = team` |
| `risk` | low · medium · high (`critical` refused) | Default from type, see §3.5 |
| `rotation_days` | null · 30 · 60 · 90 · 180 | Kept only for password-secret types |
| `twofa` | boolean; `"yes"`/`"no"` accepted | `normaliseSwitches()` |
| `notes` | ≤ 5000 | The form calls it **Remark** |
| `fields` | object, keys from the type | Checked by `validateTypeFields()` |
| `fields.twofa` | Password type only — its 2FA toggle | Not stored as a field |
| `reg_email` | `email:rfc`, ≤ 191 | Recovery & Proof |
| `reg_phone` | `/^\+?[\d\s()-]{10,16}$/` | `Enter a phone number of 10 to 16 digits.` |
| `recovery_key` | 4–500 chars | Encrypted with the fields |
| `files[<key>]` | file ≤ 10 MB, `pdf,jpg,jpeg,png,pem,crt,cer,pfx` | `Allowed files: pdf, jpg, jpeg, png, pem, crt, cer, pfx.` |
| `attachments[]` | ≤ 5 files, each ≤ 10 MB, `pdf,png,jpg,jpeg,webp,doc,docx,xls,xlsx,csv,txt` | `Allowed files: pdf, png, jpg, jpeg, webp, doc, docx, xls, xlsx, csv, txt.` |
| `remove_attachments[]` | keys, ≤ 40 chars | |
| `lock_*`, `twofa_method`, `totp_*`, `twofa_email`, `email_otp_token` | accepted | **Ignored in the Normal Vault** — `$critical` is false, so every lock is stored false |

### 3.4 Per-field errors (`validateTypeFields()` / `checkField()`)

Keyed `fields.<key>` (or `files.<key>`).

| Rule | Message |
|---|---|
| Key not in the type | `“<key>” is not a field of a <Type> credential.` |
| Required, empty | `Enter the <Label>.` / `Select the <Label>.` (select) |
| Required file missing | `Upload the <Label>.` |
| Not scalar | `<Label> must be text.` |
| Too long (type `max`, else 10,000 for secret / textarea, 500 otherwise) | `<Label> can be at most <N> characters.` |
| `url` kind | `Enter a valid web address for <Label>.` — a scheme is optional |
| `email` kind | `Enter a valid email for <Label>.` |
| `number` kind (digits, ≤ 9) | `<Label> must be a whole number.` |
| `date` kind (`Y-m-d`) | `<Label> must be a date (YYYY-MM-DD).` |
| `select` kind | `Pick a <Label> from the list.` |
| `tel` kind | `Enter a phone number of 10 to 16 digits.` |
| `cardno` (12–19 digits + Luhn) | `Enter a valid card number.` |
| `exp` | `Enter the expiry as MM/YY.` · `This card has expired.` |
| `cvv` | `CVV is 3 or 4 digits.` |
| `pin` | `PIN is 4 to 6 digits.` |
| `ifsc` | `Enter a valid IFSC (e.g. ICIC0001234).` |
| `port` | `Port must be between 1 and 65535.` |
| `seed` on `crypto` | `A seed phrase has 12 to 24 words.` |
| `seed` on `totp` | **No check in the Normal Vault** — kept as typed |

Normalisation on save: card number stripped of spaces/dashes; IFSC upper-cased;
passport / driver / govid `number` upper-cased; a seed phrase joined by single
spaces.

### 3.5 Business-rule errors on save

| Rule | Field | Message |
|---|---|---|
| Type changed on edit | `type` | `The type of a credential cannot be changed — add a new one instead.` |
| Same owner + type + name (trimmed, case-insensitive) | `name` | `There is already a <Type> named “<name>” in this vault.` |
| `risk = critical` | `risk` | `Critical credentials are added in the Critical Vault, where they get approvals and 2-step verification.` |
| Password secret below policy (only when the secret changed) | `fields.<sec>` | `Policy requires a <Good> or stronger password — use the generate button.` |
| Team scope, no department resolvable | `department_id` | `Pick the team (department) this credential belongs to.` |
| Department not the tenant's / shared | `department_id` | 404 `That department does not exist.` |
| Department not mine / headed / administered | `department_id` | 403 `You can only add team credentials to your own department.` |
| More than 5 extra files after the merge | `attachments` | `A credential can hold at most 5 attachments.` |
| A file under a non-file key | `files.<key>` | `“<key>” is not a file field of this credential.` |

**Default risk:** the type's risk, except that a type whose default is
`critical` (card, bank, crypto, govid) starts at `high` — *"A type that
defaults to critical (card, bank, crypto, ID) starts at high here."*

**The duplicate-name check is not vault-scoped**, although the message says
"in this vault": it matches the owner's credentials of the same type in
either vault (soft-deleted ones excluded).

### 3.6 Response

```json
{ "status": true,
  "message": "“Zoho Books Admin” saved to My Vault as CRD-0042.",
  "data": { …detail (§4.1) } }
```

Create is 201; `Team Vault` replaces `My Vault` when `scope = team`. Edit is 200
with `Credential updated.` or `N health issue(s) resolved`, and `data.health`
`{ resolved[], still_open[] }`.

---

## 4. Detail and the drawer

### 4.1 `GET /credvault/credentials/{id}` — either vault

The row (§2.1) plus:

| Key | When |
|---|---|
| `locked`, `updated_by` | always (`locked` is false for every Normal Vault credential) |
| `fields[]` | `{ key, label, kind, value, masked, secret, has_value }`; file fields carry `attachment_key` |
| `recovery` | `reg_email`, `reg_phone`, `has_recovery_key`, and `recovery_key` at View+ |
| `notes`, `has_notes` | notes only at View+ |
| `attachments[]` | the extra files (not the type's own file field), without `path` |
| `all_values` | View+: every stored value in one flat map |
| `shares[]`, `protection` | Full only |

> **At View and above, this response carries every secret in plain text** —
> passwords, card numbers, CVV, keys, the recovery key. Only a Use Only caller
> gets `masked: true` / `value: null`. The edit form relies on it to pre-fill.
> **The server writes no audit entry for this read** — the code says
> *"Opening the drawer is logged once by logAccess ('Opened credential
> details') … No entry here."* The `view` entry is posted by the client
> (§4.3). The older `CREDVAULT_VAULTS_API_SHEET.md` §"Get single" still says
> each read is logged as a reveal; that is no longer true.

### 4.2 `POST /credvault/credentials/{id}/reveal`

| Field | Rule |
|---|---|
| `action` | required, `reveal` · `copy` |
| `field` | optional, ≤ 40; default the type's main secret; may be any secret field or `recovery_key` |

| Check | Status | Message |
|---|---|---|
| Rank < view | 403 | `Your access is Use Only — you can sign in with this credential, but not see its secret.` |
| `copy` and rank < copy | 403 | `Your access lets you view this credential but not copy it.` |
| Field is not secret | 422 | `That is not a secret field of this credential.` |
| Nothing stored | 404 | `No <Label> is stored on this credential.` |

```json
{ "data": { "field": "password", "label": "Password", "value": "…",
            "hide_after_seconds": 30, "clear_clipboard_after": 30 } }
```

Audited as `reveal` / `copy` (module `My Vault`). Extra throttle 60/min.

### 4.3 `POST /credvault/credentials/{id}/events`

| Field | Rule |
|---|---|
| `action` | `view` · `launch` · `copy` |
| `field` | required when `copy` — a **non-secret** field, or `reg_email`, `reg_phone`, `url`, `username` |

| Check | Message |
|---|---|
| `launch` without a URL | `This credential has no website to launch.` |
| Unknown field | `That is not a field of this credential.` |
| Secret field | `Copy a secret through /reveal.` |

201 `{ "status": true, "message": "Recorded." }`. A `copy` event is stored as
action `view` with detail `<Label> copied`.

### 4.4 `GET /credvault/credentials/{id}/activity?page=&per_page=`

Audit rows for the credential, newest first, `per_page` ≤ 100 (default 50).
Legacy rows with detail `All stored values returned by the detail API` are
hidden.

### 4.5 `GET /credvault/credentials/{id}/attachments/{key}`

Streams one file from the private `local` disk. Rank ≥ view.

| Check | Status | Message |
|---|---|---|
| Use Only | 403 | `Your access is Use Only — attachments are not included.` |
| Unknown key | 404 | `That attachment does not exist.` |
| File gone from disk | 404 | `The file is missing from storage.` |

Audited as `view`, `Attachment opened: <name>`.

---

## 5. Sharing

### 5.1 `POST /credvault/credentials/{id}/shares`

| Field | Rule |
|---|---|
| `recipient_type` | required, `user` · `team` |
| `recipient_id` | required, integer ≥ 1 |
| `permission` | required, `use` · `view` · `copy` · `full` |
| `duration_days` | 1 · 7 · 30 · 90; prohibits `expires_at` |
| `expires_at` | `Y-m-d`, today or later; the share ends at **end of that day** |
| `reason` | ≤ 500 |

Neither `duration_days` nor `expires_at` means **no expiry**.

Checks, in the order the code runs them:

| # | Rule | Status | Message |
|---|---|---|---|
| 1 | Rank ≥ full | 403 | `Only the owner or someone with Full Access can share this credential.` |
| 2 | A re-sharer's end is capped at their own share's end | — | not an error; see response |
| 3 | Critical + policy `share_critical` off | 403 | `Sharing critical credentials is turned off in CredVault Policies.` |
| 4 | Critical + `full` | 422 | `A critical credential cannot be shared with Full Access.` |
| 5 | Critical + no end | 422 | `A critical credential must be shared with an end date.` |
| 6 | Policy max > 0, no end | 422 | `Policy allows shares of up to <N> days — pick an end date.` |
| 7 | End beyond the policy max | 422 | `Policy allows shares of up to <N> days.` |
| 8 | Policy `share_reason`, reason < 5 chars | 422 | `Give a reason for sharing (at least 5 characters).` |
| 9 | User not an active login of the company | 404 | `That person is not an active user of your company.` |
| 10 | User is the owner | 422 | `That person owns this credential already.` |
| 11 | User is the caller | 422 | `You cannot share a credential with yourself.` |
| 12 | User outside caller's branch (not client admin) | 422 | `<Name> is not in your branch. Share only with people in your branch.` |
| 13 | User shared it with the caller | 422 | `<Name> shared this credential with you — it can't be shared back to them.` |
| 14 | Team not the tenant's / shared | 404 | `That team does not exist.` |
| 15 | Two simultaneous shares to one recipient | 409 | `This credential was just shared with <Name>. Refresh and try again.` |

Rules 3–5 apply to `risk = critical`, which **a Normal Vault credential can
never be** — they bite on Critical Vault credentials shared through the same
route. **Rule 12 applies to `user` shares only; team shares are not
branch-checked.**

**Sharing again with the same live recipient renews the share** (permission,
end and reason replaced, original `shared_by` kept): 200 instead of 201.

```json
{ "status": true,
  "message": "Shared with Priya. It ends on 30/11/2026, when your own access does. Email sent to 1 person.",
  "data": { …share row (§5.4), "mail": { "status": "sent", "recipients": 1, "sent": 1, "failed": 0, "copy_to": "php@inhpl.com" } } }
```

`mail.status`: `sent` · `partly_sent` · `failed` · `mail_off` ·
`no_recipients`. **A mail failure never undoes the share.**

### 5.2 Side effects of a share

- Audit `share` (`Shared with <name> · <Perm> until dd/mm/yyyy` or `· no expiry`).
- A bell notification per recipient (the team's members, minus the sharer),
  linking to `/credentials-vault/my-vault`.
- An email — one to a person; BCC batches of 50 for a team — with a CC to
  `CREDVAULT_SHARE_COPY_EMAIL` (default `php@inhpl.com`). Never a secret.
- A second audit `share` with the mail outcome.

### 5.3 Durations offered (`meta.share_durations`)

From `[1, 7, 30, 90, No expiry]`:

| Policy `share_max_days` | Offered |
|---|---|
| `0` (no limit) | 1, 7, 30, No expiry — **90 is hidden** |
| `7` | 1, 7 |
| `30` (default) | 1, 7, 30 |
| `90` | 1, 7, 30, 90 |

Each carries `critical_allowed` (false only for No expiry). The API itself
still accepts `duration_days: 90` and any `expires_at`, subject to §5.1 #6–7.

### 5.4 `GET /credvault/shares` — Shared By Me

Shares **on credentials I own, or that I made**, any vault, any state.

| Query | Rule |
|---|---|
| `tab` | `all` · `active` · `soon` · `expired` · `revoked` |
| `q` | credential ID / name / group / type label, person, team, reason, permission label |
| `credential_id` | one credential |
| `permission` | one or more of `use,view,copy,full` — else `Permission is use, view, copy or full (comma-separated for several).` |
| `recipient_type` + `recipient_id` | without the type: `Say whether recipient_id is a user or a team (recipient_type).` |
| `vault`, `risk`, `type`, `group` | credential filters |
| `shared_from` / `shared_to`, `expires_from` / `expires_to` | `Y-m-d` in `tz` |
| `sort` | `status` (default) · `shared_at` · `expires_at` · `name`; `dir` asc/desc |
| `tz` | IANA zone |
| `page`, `per_page` | default 10 |

States: `revoked` (revoked_at set) · `expired` (end ≤ now) · `soon` (end within
3 days) · `active`. `tabs` = `all, active, soon, expired, revoked, live`
(**counts ignore `q` and the filters**). Default sort: expiring soon, then
active, expired, revoked.

My Vault sends only `q`, `page`, `per_page` and, from Password Health's *Fix*,
`credential_id`. It does not send `tab`, so the table shows every state.

Share row (`shareRow()`): `id`, `sr_no`, `credential{…}`, `recipient{type, id,
name, initials, sub, members, branch}`, `permission`, `permission_label`,
`reason`, `shared_at`, `shared_on{date,time}`, `expires_at`,
`expires{date,left}`, `revoked_at`, `state`, `status_label`,
`can{view, share, revoke}`.

### 5.5 `DELETE /credvault/shares/{id}` — revoke

| Check | Status | Message |
|---|---|---|
| Not in tenant | 404 | `Share not found.` |
| Caller is not owner, sharer, or (team credential) admin / branch / manager / hod | 403 | `Only the owner, the person who shared it, a Vault Admin or a manager above the owner can revoke this share.` |
| Already revoked (checked under row lock) | 409 | `This share was already revoked.` |

200 `{ "message": "Access revoked.", "data": { …share row } }`. The row is kept
(`revoked_at`, `revoked_by`). Shares the revoked person had re-shared end too
(§6 of the Technical document).

---

## 6. Remove

### 6.1 `DELETE /credvault/normal-vault/credentials/{id}`

`binCredential()`. Two behaviours, chosen by how the caller holds it:

**Reached by a share (`via = share`) — "Remove from your vault":**

| Case | Status | Message |
|---|---|---|
| Only a team share reaches me | 409 | `This credential is shared with your whole team. Ask the owner to remove the team share.` |
| My user shares end | 200 | `“<name>” removed from your vault. The owner's copy is unchanged.` — `data.removed_share: true` |

**Anything else — Move to Recycle Bin:**

| Case | Status | Message |
|---|---|---|
| Rank < full | 403 | `Only the owner, a Vault Admin or someone with Full Access can delete this credential.` |
| OK | 200 | `“<name>” moved to the Recycle Bin. It can be restored for <N> days.` |

`data: { id, vault, purges_at }`. `N` is the retention of the credential's
branch (else its owner's branch). Shares are not revoked — *"Shares pause while
it is there"*: a soft-deleted credential drops out of every query.

---

## 7. Generate Password

### 7.1 `GET /credvault/generate-password/options`

Defaults, ranges (length 12–64, words 4–10), separators, symbols, ambiguous
set, `policy_minimum`, `required_on_for_minimum`, `add_number_forced`,
`clipboard_clear_seconds: 30`.

### 7.2 `POST /credvault/generate-password`

| Field | Rule |
|---|---|
| `mode` | `chars` · `phrase` |
| `length` | 12–64 — `Length is 12 to 64 characters.` |
| `upper` `lower` `numbers` `symbols` `avoid_ambiguous` | boolean |
| `words` | 4–10 — `A passphrase has 4 to 10 words.` |
| `separator` | `-` `.` `_` `' '` or `hyphen` `dot` `underscore` `space` |
| `capitalize` `add_number` | boolean |

| Check | Field | Message |
|---|---|---|
| No character set on | `upper` | `Keep at least one character set on` |
| Setting below the policy minimum | `symbols` | `This setting can’t reach the policy minimum (<Good>)` |

Returns `password, level, strength_level, bits, meets_policy, policy_minimum,
settings`. Audited as `generate` — **the action only, never the value**.

> **The My Vault popup does not call this endpoint.** It generates on the
> device (`resources/js/pages/credvault/generator.ts`, `crypto.getRandomValues`)
> with the same rules. The endpoint is kept for Postman and integrations
> (`cvApi.ts`: *"The dialog and ↻ generate on the device"*). A password made in
> the popup is therefore **not** in the audit log.

---

## 8. curl, end to end

```bash
B=https://your-host/api/credvault ; H="Authorization: Bearer $TOKEN"

# 1. lookups
curl -s -H "$H" $B/meta | jq '.data.vaults, .data.share_durations'
curl -s -H "$H" $B/normal-vault/credentials/next-code

# 2. create a Login
curl -s -H "$H" -H 'Content-Type: application/json' -X POST $B/normal-vault/credentials -d '{
  "type":"login","name":"Zoho Books Admin","risk":"medium","rotation_days":90,"twofa":true,
  "fields":{"url":"https://books.zoho.in","username":"admin@example.com","password":"Tq#9vL!m2Rx$8wPz"},
  "reg_email":"accounts@example.com","notes":"Finance team login"}'
ID=…   # data.id from the response

# 3. list, my tab, searched
curl -s -H "$H" "$B/normal-vault/credentials?tab=mine&q=zoho&page=1&per_page=10" | jq '.tabs, .meta'

# 4. open, reveal, copy, log a launch
curl -s -H "$H" $B/credentials/$ID | jq '.data.can, .data.fields'
curl -s -H "$H" -H 'Content-Type: application/json' -X POST $B/credentials/$ID/reveal -d '{"action":"reveal"}'
curl -s -H "$H" -H 'Content-Type: application/json' -X POST $B/credentials/$ID/reveal -d '{"action":"copy","field":"password"}'
curl -s -H "$H" -H 'Content-Type: application/json' -X POST $B/credentials/$ID/events -d '{"action":"launch"}'
curl -s -H "$H" "$B/credentials/$ID/activity?page=1"

# 5. edit — only what changes
curl -s -H "$H" -H 'Content-Type: application/json' -X PUT $B/normal-vault/credentials/$ID -d '{"risk":"high"}'

# 6. share with a colleague in my branch, 7 days
curl -s -H "$H" "$B/share-recipients?q=priya" | jq '.data.users[0]'
curl -s -H "$H" -H 'Content-Type: application/json' -X POST $B/credentials/$ID/shares -d '{
  "recipient_type":"user","recipient_id":7,"permission":"view","duration_days":7,"reason":"Month-end close"}'
SID=…  # data.id

# 7. Shared By Me, then revoke
curl -s -H "$H" "$B/shares?q=zoho" | jq '.tabs, .data[0].state'
curl -s -H "$H" -X DELETE $B/shares/$SID

# 8. move to the Recycle Bin
curl -s -H "$H" -X DELETE $B/normal-vault/credentials/$ID
```
