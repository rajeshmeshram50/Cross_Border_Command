# CredVault My Vault — Code Walkthrough

Jira **GT-73**. Line numbers are as of commit `7f1384f4`; they drift — search
for the method name.

## 1. The file map

### 1.1 Backend

| File | Lines | Role |
|---|---|---|
| `app/Http/Controllers/Api/CredVault/NormalVault/NormalVaultController.php` | 79 | `/normal-vault/*`: index, next-code, store, update, destroy — wrappers with `VAULT = 'normal'` |
| `app/Http/Controllers/Api/CredVault/CredVaultController.php` | 5,719 | Everything shared: list, save, detail, reveal, share, revoke, bin, access rules |
| `app/Models/CredVault/Credential.php` | 443 | `TYPES` (25), enums, `typeDef()`, `strengthOf()`, `hashSecret()`, `lockSteps()` |
| `app/Models/CredVault/CredentialShare.php` | 74 | `PERMISSIONS`, `scopeLive()`, `state()`, `rank()` |
| `app/Models/CredVault/Policy.php` | 170 | `DEFAULTS`, `OPTIONS`, `for()`, `binDays()` |
| `app/Models/CredVault/AuditLog.php` | 82 | `ACTIONS`, `RAISE_ON_CRITICAL`, `VERBS` |
| `app/Services/CredVault/PasswordGenerator.php` | 129 | Server generator (not used by the popup) |
| `app/Mail/CredVaultShareMail.php` | — | The share email |
| `app/Providers/AppServiceProvider.php` | — | Rate limiters `credvault`, `credvault-reveal`; loads `database/migrations/credvault` |
| `database/migrations/credvault/` | 9 files | Tables, the partial unique share index, the strength recompute |
| `config/services.php` | — | `credvault.share_copy_email` (default `php@inhpl.com`) |

### 1.2 Frontend

All under `resources/js/pages/credvault/`.

| File | Lines | Role |
|---|---|---|
| `my-vault/MyVault.tsx` | 279 | The page: tabs, search, pager, Shared By Me table, revoke confirm, URL actions |
| `my-vault/CredentialTable.tsx` | 92 | The credential table — shared with Team and Critical Vault |
| `my-vault/ViewDrawer.tsx` | 561 | The drawer — shared with Team, Critical, Password Health |
| `my-vault/ShareModal.tsx` | 324 | Share popup — shared |
| `my-vault/BinConfirm.tsx` | 104 | Move to bin / remove-from-vault confirm — shared |
| `my-vault/GeneratorModal.tsx` | 229 | Generate Password popup |
| `generator.ts` | 95 | On-device generator (`crypto.getRandomValues`) |
| `form/CredentialFormModal.tsx` | 131 | Loads the detail, then picker or form |
| `form/TypePicker.tsx` | 168 | *What would you like to add?* |
| `form/CredentialForm.tsx` | 1,135 | The form, validation, payload, save |
| `form/formHelpers.ts` | 271 | `strengthOf`, `checkField`, host / domain / phone / email rules |
| `form/ProtectionSection.tsx` | 407 | Critical Vault protection — not rendered in My Vault |
| `form/CrdSelect.tsx`, `ExpiryPicker.tsx` | 33, 115 | Dropdown; card MM/YY picker |
| `cvApi.ts` | 419 | Every call, typed; `CvApiError` |
| `shared.tsx` | 663 | `useCvMeta`, cells, `ConfirmModal`, `copyText`, `CvTabsRow` |

React route: `components/App.tsx:744` → `/credentials-vault/my-vault`. Menu
entry `cv.my_vault` in `constants.ts`; quick actions in
`velzon/Layouts/IdimsHeader.tsx` (`CV_QUICK`).

### 1.3 Routes

`routes/api.php:755` — `Route::prefix('credvault')->middleware('throttle:credvault')`,
inside the `auth:sanctum, user.active, tenant` group at line 163. The
`normal-vault` prefix at ~763; the shared credential routes, sharing and the
generator follow in the same block.

---

## 2. Request flow — list

```
GET /api/credvault/normal-vault/credentials?tab=mine&q=zoho&page=1&per_page=10
  │
  ├─ NormalVaultController::index() → listCredentials($r, 'normal')      :231
  │    ├─ tenantUser()                     ← 403 no tenant / no module view
  │    ├─ validate(listRules + filters)
  │    ├─ sweepUnlocks()                   ← Critical housekeeping; no-op here
  │    ├─ $base = visibleQuery($u)->where('vault','normal')             :4906
  │    ├─ credentialSearch($base, q)                                    :346
  │    ├─ $views = all | mine | team | shared | others   (closures on clones)
  │    ├─ $tabs  = each view ->count()   + sharedby (live, on my creds)
  │    ├─ page = views[tab] select(LIGHT_COLUMNS) with(owner, department)
  │    │          orderByDesc(updated_at, id)->paginate
  │    ├─ accessMap($items, $u)              ← ONE share query for the page
  │    └─ row() per item → access + can (canFlags)
  └─ 200 { data, tabs, member: null, meta }
```

`LIGHT_COLUMNS` keeps `secret`, `fields`, `notes` out of the select — the list
never decrypts anything.

---

## 3. Request flow — create / edit

```
POST /normal-vault/credentials           PUT|POST /normal-vault/credentials/{id}
  │                                        │
  │                                        ├─ findInVault($u,$id,'normal',RANK_FULL, …)  :5183
  │                                        │     404 not visible · 404 other vault · 403 rank
  │                                        ├─ scope / department change → owner|admin|branch only
  ▼                                        ▼
persistCredential($r, $u, $c|null, 'normal')                                    :3324
  ├─ normaliseSwitches()          "yes"/"no" → bool, for twofa and fields.twofa
  ├─ validate(credentialRules($creating))                                        :3256
  ├─ type unchanged on edit
  ├─ $before = singleIssues()     ← Password Health snapshot, edit only
  ├─ validateTypeFields()         merge with stored, required, checkField()      :3572
  ├─ reg_email / reg_phone / recovery_key → fields[_reg_email …]
  ├─ duplicate (owner, type, lower(trim(name)))
  ├─ scope team → teamDepartmentFor()                                            :5397
  ├─ risk: 'critical' refused; default type risk, critical→high
  ├─ strength vs policy, only if the secret changed
  ├─ rotation (password types), twofa yes|no|na
  ├─ locks all false ($critical false); twoStepLink() skipped
  ├─ username (masked if secret id), url (url|endpoint|host|domain)
  └─ inTransaction('save the credential' | 'update the credential'):
        ├─ new Credential(client_id, branch_id, owner_id, created_by,
        │                  code = nextCode(…'CRD'…)   ← clients row LOCKED,
        │                  vault, type)
        ├─ fill(… secret, secret_hash, fields, strength …) ; save()
        ├─ syncAttachments()   files stored; removed ones deleted afterCommit
        ├─ audit create | edit ("Updated: risk, details, secret")
        └─ health_fixed per issue that went away
  → 201 "“…” saved to My Vault as CRD-0042."  /  200 "Credential updated."
```

**The two things to notice:** the code is allocated inside the transaction,
and every identity field comes from `$u`, never from `$data`.

---

## 4. Request flow — open, reveal, copy

```
GET /credentials/{id}
  ├─ findCredential($u, $id)        404 "Credential not found."           :5172
  └─ detail($c, $u, $acc, plain: true)                                    :4471
        row() + fields (PLAIN at View+) + recovery + notes + attachments
        + all_values (View+) + shares/protection (Full)
        — no audit —

ViewDrawer on load:   POST /credentials/{id}/events {action:'view'}   ← the only log of opening
                      GET  /credentials/{id}/activity

POST /credentials/{id}/reveal {action, field?}                 throttle 60/min
  ├─ findCredential(RANK_VIEW, "Your access is Use Only — …")
  ├─ copy && rank < COPY → 403
  ├─ assertUnlocked()               no-op for Normal Vault
  ├─ field = given | def.sec ; must be secret or 'recovery_key'
  ├─ value = secret column (main) | fields[field]
  ├─ audit reveal|copy
  └─ { value, hide_after_seconds: 30, clear_clipboard_after: 30 }
```

The list's Copy button (`MyVault.copyPw`) goes through `/reveal` and is
audited. See §8 for the drawer's Details-tab copy, which is not.

---

## 5. Request flow — share and revoke

```
POST /credentials/{id}/shares                                               :662
  ├─ validate
  ├─ findCredential(RANK_FULL, "Only the owner or someone with Full Access …")
  ├─ $until from expires_at (endOfDay) | duration_days | null
  ├─ via share? → cap $until at ownShareEnd()                              :408
  ├─ critical rules  (never true for a CRD credential)
  ├─ policy share_max_days, share_reason
  ├─ user:  active · not owner · not me · shareBranchOf() · not sharedToMeBy()
  │  team:  clientDepartments() · teamMembers() minus me
  ├─ inTransaction('share the credential'):
  │     match live row (whereNull revoked_at) lockForUpdate → renew or new
  │     save()  ← QueryException (uq_credvault_share_live) → 409
  │     renewed → endOrphanedShares()
  │     audit share ; notify() bell
  ├─ mailShare()  sync, BCC batches of 50, CC copy address, never throws  :798
  └─ 201 new | 200 renewed  { message, data: shareRow + mail }

DELETE /shares/{id}                                                         :968
  ├─ find in tenant → 404 "Share not found."
  ├─ allowed: owner | sharer | team cred & via admin|branch|manager|hod → else 403
  └─ inTransaction: lockForUpdate → 409 if revoked → stamp revoked_at/by
                    audit revoke → endOrphanedShares()
```

---

## 6. Request flow — delete

```
DELETE /normal-vault/credentials/{id} → binCredential($r, $id, 'normal')    :448
  ├─ findInVault($u, $id, 'normal')            any rank
  ├─ via share:
  │     my USER shares on it → none? 409 "…shared with your whole team…"
  │     revoke them · audit revoke · endOrphanedShares()
  │     200 "“…” removed from your vault. The owner's copy is unchanged."
  ├─ rank < FULL → 403
  └─ inTransaction: deleted_by; saveQuietly; delete() (soft)
                    cancel open AccessRequests · audit bin
     200 "“…” moved to the Recycle Bin. It can be restored for N days."
```

---

## 7. Key methods, with their comments

### 7.1 Who may open CredVault at all — `tenantUser()` :5583

```php
/**
 * The signed-in user, provided CredVault is theirs to open: a client admin
 * (the Vault Admin — approvals and policies live here) always, anyone else
 * with view on the Credentials Vault module. Checked once per request.
 */
```

### 7.2 The rank ladder — class docblock :64

```php
 * WHO SEES A CREDENTIAL — the access rank, weakest first:
 *   use (0)  sign in with it, never see it     — a "Use Only" share
 *   view (1) reveal the secret                 — a "View" share
 *   copy (2) reveal and copy                   — a "Copy" share, or a member
 *                                                of the team it belongs to
 *   full (3) edit, share, delete               — the owner, a "Full" share,
 *                                                and on a team credential the
 *                                                department HOD and the Vault Admins
 * A personal credential is the owner's alone; not even a Vault Admin sees it
 * unless it was shared. Anything outside a user's ranks reads as 404.
```

**Two lines of this are out of date.** "Or a member of the team" — plain
membership gives nothing in `accessMap()` today. "Not even a Vault Admin sees
it" — `visibleQuery()` lists it to them (Technical §6.4). Trust `accessMap()`.

### 7.3 Normal Vault risk — `persistCredential()` :3375

```php
if (($data['risk'] ?? null) === 'critical') {
    $this->reject('Critical credentials are added in the Critical Vault, where they get approvals and 2-step verification.', 'risk');
}
// A type that defaults to critical (card, bank, crypto, ID) starts at high here.
$risk = $data['risk'] ?? ($c->risk ?? ($def['risk'] === 'critical' ? 'high' : $def['risk']));
```

### 7.4 Protection is Critical-only — :3398

```php
// Protection — the Critical Vault only. In the Normal Vault 2-step stays a recorded flag.
$lockAdmin   = $critical && $pick('lock_admin', …);
```

### 7.5 The TOTP seed — `checkField()` :3650

```php
// The base32 setup-key check applies to the Critical Vault only; My / Team Vault keep the key as typed.
if (!$critical) return [null, $v];
```

### 7.6 Shared With Me cannot go back — `share()` :714

```php
// Shared With Me: never back to the person who shared it with you.
if (isset($this->sharedToMeBy($u, $c)[$to->id])) $this->reject("{$to->name} shared this credential with you — it can't be shared back to them.", 'recipient_id');
```

### 7.7 The race on a share — :744

```php
try {
    $share->save();
} catch (QueryException $e) {
    // Two clicks raced past the lookup; the partial unique index stopped the second.
    $this->reject("This credential was just shared with {$toName}. Refresh and try again.", null, 409);
}
```

### 7.8 Files after commit — `syncAttachments()` :3709

```php
// Removed files are deleted once the database write cannot fail any more.
DB::afterCommit(fn () => Storage::disk('local')->delete($paths));
```

### 7.9 The error shape — `reject()` :5693

```php
/** The 422 / 403 / 404 / 409 shape the forms read; the field puts the message on the right input. */
```

`CredentialForm.normKey()` maps `files.x` → `fields.x`, `attachments.N` →
`attachments`, `totp_secret` → `totp_code`, so the server's key lands on the
form's input.

---

## 8. Frontend flow

```
MyVault
  ├─ mount: ?action=add → setForm({}) · ?action=generate → setGen(true)
  │         ?tab=… → setTab · ?credential_id=… → Shared By Me filter; params removed
  ├─ effect [tab, dq(350ms), page, perPage, tick, shareCred]  (seq guards stale)
  │     sharedby → cvApi.sharedByMe({q,page,per_page,credential_id})
  │                + cvApi.vaultList(false,{tab:'all',per_page:1})  ← only for the tab counts
  │     else     → cvApi.vaultList(false,{tab,q,page,per_page})
  ├─ Add  → CredentialFormModal → TypePicker → CredentialForm
  │           cvApi.nextCode() (preview) · save → cvApi.create(payload, false)
  ├─ Edit → CredentialFormModal: cvApi.show(id) → can.edit? → form (all_values pre-fill)
  ├─ View → ViewDrawer: show · event('view') · activity
  ├─ Copy → cvApi.reveal(id,'copy') → copyText(value, 30)
  ├─ Share→ ShareModal: show + recipients → cvApi.share
  ├─ Bin  → BinConfirm (lockBusy) → cvApi.remove(id, risk==='critical')
  └─ Generate → GeneratorModal (generator.ts) → onUse → setForm({prefillPassword})
```

In the drawer, a field is treated as secret only if the API sends
`masked: true`:

```ts
const secF = fields.find(f => f.key === T?.sec && f.masked) ?? fields.find(f => f.masked);
const hasSec = !!secF?.has_value;
```

At View+ the API sends nothing masked (Technical §9), so `hasSec` is false for
a My Vault credential; and the Details tab hides plain secrets only for
`crit && f.secret`. **Worth confirming in the browser before relying on the
drawer's reveal flow in a test.**

---

## 9. Patterns you will see in this code

| Pattern | Why |
|---|---|
| `[$c, $acc] = $this->findCredential(...)` | One place decides 404 vs 403; `$acc = [rank, via]` |
| `$this->memo("key:{$u->id}", fn …)` | Department, downline, HOD, admin answers asked many times per request |
| `reject()` throws `HttpResponseException` | A refusal anywhere, even inside a transaction, returns the form's shape |
| `inTransaction('verb phrase', fn, $cleanup)` | All-or-nothing; the phrase becomes the 500 message; stored files cleaned |
| `CredentialShare::live()` | Not revoked and not expired — used for every access decision |
| `whereNull('revoked_at')` (not `live()`) in `share()` | Matches the unique index, which ignores expiry |
| Arrays as type definitions (`TYPES`) | Copied from the prototype's `CRD_TYPES`; `typeDef()` turns them into objects |
| `fields._reg_email` etc. | Recovery extras ride in the encrypted `fields`, not their own columns |
| Comments citing tickets (CS-1437, CS-1456 …) | Each QA round's rule — read them before "simplifying" a check |
| `!inCritical` / `fieldLabels` / `secretLabels` / `lockBusy` props | Shared components with My Vault-only behaviour switched on |

---

## 10. Symptom → file

| Symptom | Look in |
|---|---|
| 403 *CredVault needs a company account* | `tenantUser()` — super admin login |
| 403 *You do not have access to Credentials Vault* | Permissions → module `credentials-vault` `can_view`; `tenantUser()` |
| A credential is listed but every button is greyed and View says *Credential not found.* | Personal credential of an overseen user — `visibleQuery()` vs `accessMap()` (Technical §6.4) |
| Department colleague cannot open a team credential | `accessMap()` — membership alone gives no rank; HOD resolution in `deptHeads()` (name match must be unique) |
| HOD gets Copy, not Full | `accessMap()`: owner is at or above the HOD's level (`levelOfUser()`, `LEVEL_ORDER`) |
| *Critical credentials are added in the Critical Vault…* | `persistCredential()` :3376; the form should not offer Critical — `CredentialForm` risk filter |
| *There is already a … named … in this vault.* though it is in the Critical Vault | duplicate check is not vault-scoped — `persistCredential()` :3361 |
| *Policy requires a Good or stronger password* when editing only the name | the form checks the stored password on every save — `CredentialForm.submit()` `isPw && T.sec` |
| A real SSH key cannot be typed | `formHelpers.ts` `PRIVKEY_MAX = 64` |
| TOTP seed rejected | Only in Critical Vault — `checkField()` `seed`; in My Vault look at the front field max |
| Card number refused | Luhn in `checkField()` (server) and `luhnOk()` (form) |
| Attachment upload refused | `ATTACH_TYPES` / `FIELD_FILE_TYPES` / `FILE_MAX_KB` in the controller; `meta.file_types` on the form |
| *A credential can hold at most 5 attachments.* | `syncAttachments()` counts kept + new `att-*` |
| CRD code skipped a number | `lastNumber()` also reads purged codes from the audit log — by design |
| Share With list is empty | `shareRecipients()` — branch filter (`shareBranchOf()`), active users only; owner / sharers hidden in `ShareModal` `blocked` |
| *… is not in your branch* | `share()` :713, `shareBranchOf()` :5066 |
| *… shared this credential with you — it can't be shared back* | `sharedToMeBy()` :5077 |
| Share ended earlier than picked | re-share cap — `ownShareEnd()`; the toast says *when your own access does* |
| 90 days missing from durations | `meta()` `share_durations` filter — hidden when the policy has no limit |
| Share saved but no email | `mailShare()` `mail.status` (`mail_off` = Settings → notifications off); `Log::warning 'CredVault: share email not sent'` |
| Shared By Me badge ≠ rows in the table | badge = live shares on my credentials (`listCredentials` `tabs.sharedby`); table = all states, mine or made by me (`sharedByMe()`) |
| Revoke 409 | `revokeShare()` — already revoked |
| A re-share vanished | `endOrphanedShares()` after a revoke / downgrade of the re-sharer's share |
| *Remove from your vault* → 409 team share | `binCredential()` — only user shares can be ended by the recipient |
| Bin message days wrong | `Policy::binDays()` + `binBranchOfCredential()` — the credential's branch, else owner's |
| Secret shows unmasked in the drawer / copy not in Activity | `detail(plain: true)` + `ViewDrawer` `fieldValue()` / `copyPlain()` (Technical §9) |
| Copy toast says *Copied to clipboard* not *API Key copied* | `fieldLabels` / `secretLabels` props — My Vault and Password Health only |
| Generated password not in the audit log | the popup uses `generator.ts`, not `/generate-password` |
| 429 on reveal | `credvault-reveal` 60/min in `AppServiceProvider` |
| 500 *Could not save the credential. Nothing was saved* | `inTransaction()` — real error in `laravel.log` as `CredVault: could not …` |
