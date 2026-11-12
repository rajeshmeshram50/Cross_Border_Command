# CredVault Critical Vault — Code Walkthrough

| | |
|---|---|
| **Jira** | GT-110 (parent GT-79 — CredVault Critical Vault Documentation) |
| **Module** | CredVault → Vault Management → Critical Vault |
| **Audience** | Developers joining the module, code reviewers, tech leads |
| **Companion documents** | Functional Documentation · Technical Documentation · API Documentation |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document walks through the Critical Vault **code** in the order it runs: a credential is added, someone asks to open it, the approvers decide, the code is entered, the window opens, and the credential locks again. Each section names the function, says what it does and quotes the lines that matter. Read it next to the source. For what the user sees, read the Functional Documentation; for request and response shapes, read the API Documentation.

### 1.2 The walkthrough in one paragraph

The form saves through `persistCredential()` with the vault fixed to `critical`, after `TwoStepController` has proved the 2-step method works. The list comes from `listCredentials()`, where `visibleQuery()` adds every Critical Vault credential of the viewer's branch and `row()` builds the Access Status from `unlockState()`. Clicking **Unlock credential** opens `UnlockModal`, which reads the `unlock_plan` and calls `requestAccess()`. From there the request moves through `decide()`, `raiseManager()` and `verifyOtp()` until `unlock()` sets a window. Every secret then passes `assertUnlocked()`, and `sweepUnlocks()` closes the window when its time is up.

### 1.3 How to read this document

Line numbers drift as the code changes; **function names are stable**, so search for the name. "Base" means `CredVaultController`, which all three Critical Vault controllers extend.

| Callout | Meaning |
|---|---|
| **Explanation** | Why the code is written this way, usually from a comment in the source |
| **Common misunderstanding** | Something a reader of the code often gets wrong |
| **Worth testing** | A path that is easy to break when the code is changed |

### 1.4 Key ideas to understand first

| Idea | What it means in the code |
|---|---|
| Vault Admin | The **Branch User**; `adminBranchOf($u)` returns their branch, `branchAdminIds($branch)` lists them |
| `lockSteps()` | The steps in force on a credential, always in the order `admin` → `manager` → `otp` |
| `currentStage()` | The first step of a request not yet done |
| `[rank, via]` | What `accessMap()` returns per credential — how much, and why |
| `opensDirectly()` | The Vault Admin of the credential's branch: no request, no steps |
| `assertUnlocked()` | The gate in front of every secret |
| `sweepUnlocks()` | Ends every window whose time has passed — there is no scheduler |
| Memo | `$this->memo(key, fn)` caches a value for one HTTP request |

---

## 2. Where the Code Lives

### 2.1 Files

| File | Lines | What it holds |
|---|---|---|
| `app/Http/Controllers/Api/CredVault/CredVaultController.php` | 5,746 | The base: access rules, save, decide, unlock, sweep, serialisers, audit |
| `app/Http/Controllers/Api/CredVault/CriticalVault/CriticalVaultController.php` | 123 | index, next code, store, update, destroy, approvers |
| `app/Http/Controllers/Api/CredVault/CriticalVault/TwoStepController.php` | 127 | Authenticator and Gmail setup |
| `app/Http/Controllers/Api/CredVault/CriticalVault/AccessRequestController.php` | 427 | The unlock requests |
| `app/Models/CredVault/Credential.php` · `AccessRequest.php` | 443 · 95 | The two core models |
| `app/Services/CredVault/Totp.php` · `EmailOtp.php` | 99 · 185 | Authenticator codes · email codes |
| `resources/js/pages/credvault/critical/CriticalVault.tsx` | 249 | The page |
| `resources/js/pages/credvault/critical/UnlockModal.tsx` | 890 | The unlock popup |
| `resources/js/pages/credvault/critical/cvData.ts` | 319 | The data source |
| `resources/js/pages/credvault/form/CredentialForm.tsx` · `ProtectionSection.tsx` | 1,128 · 407 | The form and its protection section |

### 2.2 The life of one credential, and the function that runs at each step

| # | What happens | Function |
|---|---|---|
| 1 | The owner links the 2-step method in the form | `TwoStepController::googleNew/googleVerify` or `emailSend/emailVerify` |
| 2 | The owner saves | `CriticalVaultController::store()` → `persistCredential()` → `twoStepLink()` |
| 3 | Someone opens the list | `index()` → `listCredentials()` → `visibleQuery()` → `accessMap()` → `row()` → `unlockState()` |
| 4 | They click **Unlock credential** and send the request | `UnlockModal.send()` → `requestAccess()` |
| 5 | The Vault Admin approves | `approveRequest()` → `decide()` |
| 6 | The requester forwards to the manager | `UnlockModal.forward()` → `raiseManager()` |
| 7 | The manager approves | `decide()` |
| 8 | The requester enters the code | `UnlockModal.verify()` → `verifyOtp()` → `unlock()` |
| 9 | They reveal a secret | `reveal()` → `assertUnlocked()` |
| 10 | The window ends | `sweepUnlocks()` on the next call, or `lockRequest()` for **Lock now** |

---

## 3. Plumbing Every Endpoint Uses

### 3.1 `tenantUser()` — the module gate

| Check | Result |
|---|---|
| The login has no `client_id` | 403 *CredVault needs a company account — this login has no tenant.* |
| No `can_view` on the `credentials-vault` module | 403 *You do not have access to Credentials Vault…* |

The result is memoised per request (`module:{id}`), so the permission query runs once.

### 3.2 `reject()` and `inTransaction()`

| Function | What it does |
|---|---|
| `reject($message, $field, $status)` | Throws `{ status: false, message, errors? }` — `errors` only when a field is named, so the form shows the message under the right input |
| `inTransaction($action, fn)` | Wraps `DB::transaction`. A `reject()` passes through untouched; any other exception is logged as *CredVault: could not ‹action›* and becomes a clean 500 |

> **Explanation.** A `reject()` inside the closure rolls the transaction back. When a count must survive a refusal — wrong codes — the code **returns** from the closure and refuses **after** the commit (section 8.2).

### 3.3 `sweepUnlocks()` — how windows end

```php
$expired = AccessRequest::where('client_id', $clientId)->where('status', 'unlocked')->where('expires_at', '<=', now())->...->get();
foreach ($expired as $r) {
    $r->update(['status' => 'locked', 'locked_at' => $r->expires_at, 'locked_reason' => 'expired']);
    $this->writeAudit($clientId, $r->requester_id, null, 'lock', $r->credential, 'Unlock window ended — locked again', ...);
}
```

| Point | Detail |
|---|---|
| When it runs | At the top of the list, show, reveal, request list / detail and `requestAccess()` — once per HTTP request (memo `swept:{client}`) |
| `locked_at` | Set to `expires_at`, not now, so the record shows when the window really ended |
| Before a sweep | The row still says `unlocked`; that is why every gate checks `expires_at`, never `status` alone (`isLive()`, `unlockedFor()`) |

> **Common misunderstanding.** "There must be a cron job that locks credentials." There is none. A window ends **lazily**, on the next call — and it is safe because no gate trusts `status` without `expires_at`.

---

## 4. Who Sees a Critical Vault Credential

### 4.1 `visibleQuery($u, true)` — the list base

The Critical Vault list passes `true`, which adds the branch-wide rule to the usual ones:

```php
if ($critBranch) $w->orWhere(fn ($t) => $t->where('vault', 'critical')->where('credvault_credentials.branch_id', $critBranch));
```

So **every** Critical Vault credential of the viewer's branch is listed — personal or team, any owner — on top of the viewer's own, the ones shared with them, the ones of people they are above, and the team rules.

### 4.2 `accessMap()` — what each row may do

| Rule (first match wins) | Result |
|---|---|
| Owner | `[full, owner]` |
| Team scope; the Vault Admin of the owner's or the credential's branch; the owner is not an admin login | `[full, branch]` |
| Team scope; the owner is in the viewer's downline | `[full, manager]` |
| Team scope; the viewer heads the department | `[full, hod]` if the owner is below them, else `[copy, team]` |
| Nothing yet; a Critical Vault credential of the viewer's branch | `[view, branch_critical]` |
| A live share that ranks higher | `[rank, share]` |

> **Explanation: `branch_critical` is only View.** It lets a person list the credential and request an unlock — nothing more. Combined with `assertUnlocked()` (9.2) it is why "everyone in the branch sees it, but the secret opens only through the steps".

### 4.3 `opensDirectly()` — the Vault Admin

```php
$branch = $this->adminBranchOf($u);          // a branch_user's own branch, else null
if ($branch === null) return false;
if ((int) $c->branch_id === $branch) return true;
$ob = $this->memo("ownerbranch:{$c->owner_id}", fn () => (int) (User::whereKey($c->owner_id)->value('branch_id') ?? 0));
return $ob === $branch;
```

It is keyed on the **branch**, not on ownership: the Vault Admin of the credential's branch — or of its owner's branch — opens it without a request.

### 4.4 `findInVault()`

Three checks, in this order: `findCredential(…, RANK_USE)` (404 outside the company or out of reach); then a 404 *"This credential is in the Normal Vault (My Vault) — open it there."* when the vault differs, so a My Vault id never works on a Critical Vault route; then 403 with the caller's message when the rank is below the minimum.

---

## 5. The List — `CriticalVaultController::index()`

### 5.1 `listCredentials($request, 'critical')`

| Step | What happens |
|---|---|
| 1 | Validate the tab and filters; `sweepUnlocks()` |
| 2 | `$base = visibleQuery($u, true)`, then `vault = critical` and the search |
| 3 | Count every tab from clones of the same query — so the counts follow the search box |
| 4 | Fetch the page with `LIGHT_COLUMNS` only — no secret column is ever selected for a list |
| 5 | Once per page: `accessMap()`, `openRequestsFor()` (protected rows only; a live unlock sorts ahead of a pending request), `liveShareCounts()` |
| 6 | `row()` per credential |

### 5.2 `row()` → `unlock`

```php
'unlock' => $steps
    ? ($this->opensDirectly($u, $c) ? ['state' => 'open', 'label' => 'Open — Vault Admin'] : $this->unlockState($req, $steps))
    : null,
```

### 5.3 `unlockState()`

| Condition | State |
|---|---|
| No open request | `locked` — *Approval needed* |
| `isLive()` | `open` with `seconds_left`, `total_seconds`, `expires_at` |
| `currentStage()` is `null` (ended, not swept yet) | `locked` |
| Stage `admin` or `manager` | `pending`, with `waiting_for` the named person |
| Stage `manager` and `manager_status` not yet `pending` | `pending` with `needs_forward: true` — label *Forward to ‹manager›* |
| Stage `otp` | `progress` — *Step n of m · Authenticator* |

`AccessCell` in `CriticalVault.tsx` maps these to the Access Status badges; the **Vault Admin** badge is `open` **without** a `request_id`.

---

## 6. Adding and Editing — `persistCredential()`

`store()` and `update()` both land here with `$vault = 'critical'`.

### 6.1 Risk level

| Value sent | Saved |
|---|---|
| Nothing, on create | `critical` |
| Nothing, on edit | The stored risk is kept |
| `low`, `medium`, `high` or `critical` | That value; the credential stays `vault = critical` with its CCRD- code |

### 6.2 The three steps

```php
$lockAdmin   = $critical && $pick('lock_admin', $creating ? true : $c->lock_admin);
$lockManager = $critical && $pick('lock_manager', $creating ? true : $c->lock_manager);
$lockOtp     = $critical && (Credential::hasTwofaSwitch($type)
    ? $twofa === 'yes'
    : $pick('lock_otp', $creating ? true : $c->lock_otp));
```

| Point | Detail |
|---|---|
| Defaults | On create every step defaults to on |
| Types with their own 2FA switch | Login, Email, Passkey, Bank Account, Crypto Wallet, Password: **the switch is step 3** — `lock_otp` from the request is ignored |
| How many | Fewer than **two** steps on → 422 *Turn on at least two protection steps for a critical credential.* on `lock_admin` |

### 6.3 Approvers are not stored

```php
/* New flow: the form no longer pins a specific approver. Both are
 * resolved when access is requested ... Only the on/off toggles are stored. */
$adminUserId = null;
$managerUserId = null;
```

The form matches this: `CredentialForm` sends `lock_admin_user_id: null` and `lock_manager_user_id: null`, and only when the user may change protection.

### 6.4 `twoStepLink()` — no lock behind a code nobody receives

Called only when the 2-step step is on. Returns `[method, newSecret, email, emailToken]`.

| Method | Accepts | Refuses with |
|---|---|---|
| `google` | A fresh `totp_secret` whose `totp_code` matches **now** (checked again on the server, never trusted from the browser), or the app already linked | *Scan the QR code and verify a code to link your authenticator app, or turn 2-step off.* |
| `email` | A verified `email_otp_token` for exactly this inbox, or the same inbox already linked | *Send a code to … and verify it to link email 2-step, or turn 2-step off.* |

### 6.5 Inside the transaction

```php
if ($emailToken && !EmailOtp::consumeSetup($u, $emailToken, $email)) {
    $this->reject('The email code has expired. Send a new code and verify it again.', 'email_otp_code');
}
```

| Point | Detail |
|---|---|
| One code, one credential | `twoStepLink()` only **peeks** at the token; the save **consumes** it (`Cache::pull`) inside the transaction |
| The code | `nextCode('credvault_credentials', 'CCRD', …)` under a lock on the `clients` row |
| Method columns | Set or cleared together: switching to Gmail nulls `totp_secret` / `totp_linked_at`; switching to the app nulls `twofa_email` |
| Audit | A fresh link is recorded as `totp_linked` — *Authenticator app linked* or *Email 2-step linked · ab•••@…* |

### 6.6 `update()` — the protection guard

```php
[$c, $acc] = $this->findInVault($u, $id, self::VAULT, self::RANK_FULL, 'Only the owner, a Vault Admin or someone with Full Access can edit this credential.');
```

When the caller is neither the owner nor the Vault Admin, `protectionChange()` names the first guarded value the edit would change, and the save is refused with 403 *Only the owner or a Vault Admin can change the ‹what›.*

> **Explanation.** The source's reason: a HOD or a Full share may edit the details, "never what guards them: switching a step off, changing the 2-step method or inbox, or relinking it would let them open it without the approvals." `protectionChange()` lets **unchanged** values pass, so the form can resend the whole body.

### 6.7 `TwoStepController` and `EmailOtp`

| Function | What it does |
|---|---|
| `googleNew()` | `Totp::newSecret()` (20 random bytes → 32 base32 characters) and `Totp::uri()` with issuer **Kryptone** |
| `googleVerify()` | A dry run: `Totp::verify()`; stores nothing |
| `EmailOtp::sendSetup()` | Throttle (30 s per user + inbox, 10 sends an hour), a 6-digit code from `random_int`, the code's **HMAC** in the cache for 10 minutes, mail `CredVaultOtpMail` |
| `EmailOtp::verifySetup()` | Wrong user or missing → 410; mismatch → 422 *Incorrect code. n attempts left.*; the 5th → 423; a match marks the token verified |

Only a keyed hash of any code is ever stored, and only in the cache.

---

## 7. Raising a Request — `AccessRequestController::requestAccess()`

### 7.1 The checks, in order

| # | Code | Refusal |
|---|---|---|
| 1 | Validate `reason` ≤ 300, `duration_minutes` in `DURATIONS` | 422 |
| 2 | `sweepUnlocks()`; `findInVault(…, RANK_VIEW)` | 403 *Your access is Use Only — there is nothing for you to unlock on this credential.* |
| 3 | `opensDirectly()` | 409 *You are the Vault Admin for this branch — open this credential directly.* |
| 4 | `$steps = $c->lockSteps()` — the snapshot | — |
| 5 | Reason and window with the Vault Admin step | 422 on `reason` / `duration_minutes` |
| 6 | The daily code cap — only when the 2-step step is in the snapshot | 429 |
| 7 | `twoStepLinked()` — only when the 2-step step is in the snapshot | 409 |
| 8 | The Vault Admin pool | 409 |
| 9 | `managerOf($u)` | 409 |
| 10 | One open request | 409 with that request in `data` |
| 11 | Create | 409 on the unique-index race |

### 7.2 Reason and window

```php
if ($adminStep && mb_strlen($reason) < 10) $this->reject('Please give a reason (at least 10 characters).', 'reason');
if ($adminStep && empty($d['duration_minutes'])) $this->reject('Choose how long you need access.', 'duration_minutes');
$d['duration_minutes'] = $adminStep ? (int) $d['duration_minutes'] : AccessRequest::DEFAULT_MINUTES;
```

Without a Vault Admin step there is no reason and the window is always 5 minutes.

### 7.3 The daily code cap

```php
AccessRequest::where('credential_id', $c->id)->where('requester_id', $u->id)
    ->where('created_at', '>=', now()->subDay())->sum('otp_attempts') >= self::OTP_DAILY_LIMIT   // 6 → 429
```

> **Explanation.** The source: "The 3-try limit is per request … so wrong codes are also capped per person per credential per day." Without it, a person could raise request after request and keep guessing.

### 7.4 The Vault Admin pool

```php
$pool = array_values(array_diff($this->branchAdminIds($u->branch_id, $u->client_id), [$u->id]));
if (!$pool) $this->reject('Your branch has no Branch Admin (Vault Admin) to approve this. ...', null, 409);
```

The pool is the Vault Admins of the **requester's** branch, minus the requester; the first of the pool is named on the request (`admin_user_id`).

### 7.5 The manager and the create

`managerOf($u)` reads the HR employee record (`reporting_manager_user_id`, else `reporting_manager_id` → that employee's login); none, or the requester themself → 409. Then, in a transaction:

```php
'admin_status'   => $adminStep ? 'pending' : null,
'manager_status' => (!$adminStep && $managerStep) ? 'pending' : null,
'status'         => ($adminStep || $managerStep) ? 'pending' : 'approved',
```

A `QueryException` here is the partial unique index `uq_credvault_req_open` catching a double click, turned into a 409. Then audit `request` and `notifyStage()`.

> **Worth testing.** Double-click **Send request**. Exactly one REQ- must be created. If the second call arrives after the first is saved, it hits check 10 and returns 409 **with** the first request — the popup just reloads. If both arrive at the same instant, the second hits the unique index and returns 409 **without** `data` — the popup then shows the message.

---

## 8. Approvals and the Code

### 8.1 `decide()` — approve and reject share one function

```php
if ($r->status !== 'pending') $this->reject('This request is no longer waiting for approval.', null, 409);
$stage = $r->currentStage();
if ($r->requester_id === $u->id) $this->reject('You cannot decide your own request.', null, 403);
if ($stage === 'admin') { if (!$this->canApproveAdmin($u, $r)) /* 403 waiting for … */ }
elseif ($stage === 'manager') {
    if ($r->manager_status !== 'pending') /* 409 not forwarded yet */;
    if ($r->manager_user_id !== $u->id)   /* 403 waiting for … */;
}
```

The stage's four columns are written generically (`"{$stage}_status"`, `_decided_by`, `_decided_at`, `_note`). Then:

| Outcome | Effect |
|---|---|
| Reject | `status = rejected`, audit `reject`, notify the requester with the note |
| Approve, next is `manager` | Stays `pending`; the requester is told to forward |
| Approve, next is `otp` | `status = approved`; the requester is told to enter the code |
| Approve, nothing left | `unlock()` at once |

`canApproveAdmin()` allows the Vault Admin **named on the request**; only on a request with no named admin may any Vault Admin of the request's branch decide. Because `requestAccess()` always names one — the first of the pool — in practice exactly one person decides the Vault Admin stage.

> **Explanation: one person, two approvals.** The source records it: when the reporting manager is also the Vault Admin, "the same person gives both approvals — two separate, audited actions, by design."

### 8.2 `raiseManager()` — the forward

Requester only; `pending`; a manager step; the Vault Admin stage approved; `manager_status` still `null`. It sets `manager_status = pending`, audits `forward_mgr` and calls `notifyStage()`, which now sees stage `manager` and notifies the manager.

### 8.3 `sendOtp()` — Gmail

Requester only; `status = approved` and `currentStage() === 'otp'`; the credential's method is `email` and linked. `EmailOtp::sendUnlock()` throttles per user + request, keeps the code's HMAC under `credvault:email-otp:unlock:{request id}` for 10 minutes (a new send overwrites it) and mails the credential's `twofa_email`. Audit `otp_sent`.

### 8.4 `verifyOtp()`

Inside a transaction with the request row locked. The secret is read with its own select — the eager load carries display columns only.

```php
if ($cred->twofa_method === 'email') {
    $match = EmailOtp::checkUnlock($r->id, $d['code']);        // null = no live code
    if ($match === null) $this->reject('No live email code for this request. Press “Send code” to get one.', 'code', 409);
} else {
    $step = Totp::matchStep($cred->totp_secret, $d['code']);
    if ($step !== null && !Cache::add("credvault:totp-used:{$cred->id}:{$step}", 1, now()->addMinutes(3))) {
        $this->reject('That code was just used. Wait for the next code in your authenticator app.', 'code');
    }
    $match = $step !== null;
}
```

Neither refusal costs a try: they throw inside the transaction, so nothing is saved. `Totp::matchStep()` accepts ±1 time step, compares with `hash_equals`, and returns the matched step so it can be claimed once per credential.

On a wrong code:

```php
$r->otp_attempts++;
if ($r->otp_attempts >= AccessRequest::MAX_OTP_ATTEMPTS) {
    $r->fill(['status' => 'locked', 'locked_at' => now(), 'locked_reason' => 'otp_failed']);
    EmailOtp::forgetUnlock($r->id);
    // audit otp_failed; notify the owner if the owner is not the requester
}
$r->save();
return [$r, false];
```

The closure **returns** instead of throwing, so the new count is committed; only then does the method throw 422 *Incorrect or expired code. n attempts left.* or 423 *Too many wrong codes — the approvals were reset. Request access again.*

> **Common misunderstanding.** "Approvals reset" does not clear `admin_status` / `manager_status`. The request is **voided**: a `locked` request can never move again, so the requester starts a new one from the first step.

On the right code: `otp_verified_at = now()` and `unlock()`.

---

### 8.5 The helpers behind every request call

| Function | What it does |
|---|---|
| `findRequest($u, $id, $lock)` | Loads the request inside the company. Visible to the requester, the named Vault Admin, the named manager, or anyone `canApproveAdmin()` allows; anyone else gets 404 *Access request not found.* With `$lock` it takes `lockForUpdate()` |
| `requestRow($r, $u)` | Builds the request object: `display_status` (`pending`, `approved`, `rejected`, `cancelled`, `reset`), `status_label`, the three stage blocks and the `can.*` flags (`approve`, `reject`, `cancel`, `verify_otp`, `send_otp`, `lock`) that the popup and Access Request Management read |
| `unlockPlan($c, $u, $steps)` | The approver shown for each step, `ready` (false for a manager step with no manager), `asks_reason`, `default_minutes` (15 with a Vault Admin step, else 5), `otp_method`, the masked `otp_sent_to` |
| `openRequestsFor($u, $ids)` | The caller's open requests for a page of credentials; a live unlock sorts ahead of a pending one |
| `notify()` / `notifyStage()` | Insert bell rows into `notifications` inside the caller's transaction (a failure is only logged). Stage `admin` → the named Vault Admin; stage `manager` → `manager_user_id`. Stage messages link to Access Request Management; decision messages link to the Critical Vault |
| `rejectRequest()` | Calls `decide()` with the note, or *Not approved at this time* when none is given |

---

## 9. The Window

### 9.1 `unlock()`

```php
$r->fill(['status' => 'unlocked', 'unlocked_at' => now(), 'expires_at' => now()->addMinutes($r->duration_minutes)])->save();
```

Audit `unlock` — *Unlocked for ‹n› min after all checks passed* — always inside the caller's transaction.

### 9.2 `assertUnlocked()` — the gate on reveal and attachments

```php
if (!$c->isProtected()) return;
if ($this->opensDirectly($u, $c)) return;
if ($this->unlockedFor($c, $u)) return;      // this requester, status unlocked, expires_at > now
abort(response()->json(['status' => false, 'code' => 'locked', 'message' => 'This credential is locked. ...'], 423));
```

There is no owner shortcut. `unlockedFor()` is keyed on `requester_id`, so one person's unlock opens nothing for anyone else. It runs in `reveal()` and `attachment()`. `detail()` applies the same rule inline (`$open = no steps || opensDirectly() || $req->isLive()`) and, while open, returns every stored value in plain text for View rank or higher.

> **Known problem — security.** Because the detail already carries the plain values, `UnlockModal`'s reveal pane and the View drawer show and copy secrets without calling `reveal()`. Nothing is audited as a reveal or copy, the clipboard is not cleared and the owner is not notified; a View-rank viewer can copy. Fix: mask secrets in `detail()` for Critical Vault credentials and reveal through `reveal()` in both views.

### 9.3 `reveal()`

| Step | What happens |
|---|---|
| 1 | Rank check: View; Copy for `action = copy` |
| 2 | `assertUnlocked()` |
| 3 | Pick the field: the type's main secret by default; `recovery_key` allowed; any other must be marked secret |
| 4 | Audit `reveal` / `copy`, module *Critical Vault*, critical severity |
| 5 | Notify the owner when someone else did it |
| 6 | Return the value with `hide_after_seconds: 30` and `clear_clipboard_after: 30` — the browser enforces both |

### 9.4 `lockRequest()`, `cancelRequest()` and `binCredential()`

| Function | Rule |
|---|---|
| `lockRequest()` | The requester or the Vault Admin; `status === 'unlocked'` → `locked` / `manual` |
| `cancelRequest()` | The requester; `pending` or `approved` → `cancelled`; the email code is forgotten |
| `binCredential()` | Full access, and `via` is `owner` or `branch` (the Vault Admin); soft delete; every open request → `cancelled` — "a binned credential reveals nothing" |

---

## 10. Frontend

### 10.1 `CriticalVault.tsx`

| Piece | What it does |
|---|---|
| `TABS` | `all` → API `all`, `mine` → `mine`, `team` → **`others`** (owned by anyone else) |
| `load()` | `cvData.list(…)`; a sequence ref drops stale responses; an empty page beyond `last_page` steps back |
| `isDirect()` | `unlock.state === 'open' && !unlock.request_id` — the Vault Admin |
| `leftOf()` | `seconds_left − (now − fetchedAt)`; never counts up past the server's figure, so an ended window cannot "reopen" and loop |
| Expiry effect | When a row reaches 0, reload quietly (at once, then every 1.5 s, at most 4 tries) until the server's sweep agrees |
| Poll | Every 15 s while a row is `pending` / `progress` and no popup is open |
| Row button | The Vault Admin → View drawer (eye); every other row → `UnlockModal` (lock / clock / open-lock icon) |

### 10.2 `cvData.ts`

`export const CV_DUMMY = false;` — `cvData` is the `live` object; its `list` calls `cvApi.vaultList(true, …)`. The dummy object (fixed rows, an "act as" approver, any 6 digits accepted) is kept for design work only; `live.decide` is `undefined`, which hides the "act as" panel.

### 10.3 `UnlockModal.tsx` — the stage machine

| Derived value | Rule |
|---|---|
| `steps` | `unlock_plan.steps[].key`, plus a final `done` |
| `live` | `last_request`, only when it is the request behind the current `unlock` and the window has not ended |
| `cur` | `done` when open; else `live.stage`, else `unlock.stage`, else the first step |
| `ended` | Under 1 second left — revealed values are dropped, a toast says *… is locked again*, and it reloads after 1.5 s |

| Action | Call |
|---|---|
| **Send request to ‹name›** | `requestAccess` with `{ reason, duration_minutes }` when `asks_reason`; a 409 that carries `data` just reloads |
| **Send to ‹manager›** | `raiseManager`, shown when `unlock.needs_forward` |
| **Send code** / the automatic first send | `sendOtp` |
| **Verify & reveal** | `verifyOtp`; 423 → reload, 422 → shake and clear the boxes |
| **Lock now** | `lock`, then close |
| Show / Copy | `cvData.reveal`; the hide timer from `hide_after_seconds`; a 423 reloads |

| More mechanics | Detail |
|---|---|
| Gmail auto-send | Reaching the `otp` stage with the Gmail method and `can.send_otp` sends the first code once per request (`autoSent`); the resend wait counts down from `resend_in` |
| `winRef` countdown | The window's end is fixed once in the browser: within 30 s of the grant it starts at `total_seconds − 1`, otherwise it resumes from `seconds_left`; `ended` is measured from that point |
| Popup polling | Reloads every 15 s only while `unlock.state === 'pending'`; calls `onChanged()` whenever `state:stage` changes |
| `onPending` | Marks the list row *Pending* at once, before the list refresh lands |
| "Locked again" toast | Shown only when this popup saw the window open (`sawOpen`) |
| Errors | A refusal on Send request shows as red text in the stage card; a 409 carrying `data` gives an info toast and reloads |

`ViewDrawer` hands over in both directions: when `show()` returns `locked: true` it renders `UnlockModal` instead of the drawer; **Full details** in the popup clears the drawer's data and reloads it; a 423 on reveal or copy reloads the drawer, which brings the popup back.

### 10.5 `OtpDigits.tsx` and the `cvApi` transport

| Piece | What it does |
|---|---|
| `OtpDigits` | Six boxes: auto-advance, Backspace steps back, arrow keys move, pasting a full code fills all six, Enter submits |
| `cvApi` `get()` / `send()` | Go through the shared Axios client with the `/credvault` prefix |
| `CvApiError` | Built from any failure: `status`, `errors`, `code`, `data`; `field(name)` returns the first message for one input |

### 10.4 `ProtectionSection.tsx` and `CredentialForm.tsx`

| Piece | What it does |
|---|---|
| Risk Level | Low, Medium, High or Critical (default Critical); every level saves to `/critical-vault/credentials` and shows the Protection section |
| `ProtectionBody` | The three Required / Off rows; on a type with its own 2FA field, step 3 has no switch and mirrors that field |
| Save guard | Fewer than two steps on → toast *Turn on at least two protection steps for a critical credential* and scroll to the section |
| `AuthBox` | `newAuthenticator` → `verifyAuthenticator`; the save resends `totp_secret` + `totp_code` |
| `TwofaPicker` | `emailSetupSend` → `emailSetupVerify`; the save sends `email_otp_token` |
| `can.edit_protection` false | The form hides the protection section and sends no `scope`, `department_id` or `lock_*` keys. `risk` is still sent when changed (`put('risk', risk)` is outside the `canProtect` block), and the server refuses it with 403 *…change the risk level* |

---

## 11. Business Rules in the Code

| ID | Rule | Where it is kept |
|---|---|---|
| BR-01 | Every Critical Vault credential is `vault = critical` with a CCRD- code, at any risk level | `persistCredential()`, `nextCode()` |
| BR-02 | At least two protection steps | `persistCredential()`, `CredentialForm.tsx` |
| BR-03 | The steps are copied onto the request when it is raised | `requestAccess()` |
| BR-04 | A secret only through the Vault Admin or a live window of this requester | `assertUnlocked()`, `unlockedFor()` |
| BR-05 | No owner shortcut | `assertUnlocked()` |
| BR-06 | Nobody decides their own request | `decide()`, the Vault Admin pool |
| BR-07 | The manager acts only after the forward | `decide()`, `raiseManager()` |
| BR-08 | One open request per person per credential | `uq_credvault_req_open`, `requestAccess()` |
| BR-09 | A wrong-code count survives the refusal | `verifyOtp()` returns, then throws |
| BR-10 | A replayed code or a missing email code costs no try | `verifyOtp()` throws inside the transaction |
| BR-11 | One verified email code links one credential | `consumeSetup()` inside the save |
| BR-12 | An ended window opens nothing, swept or not | `isLive()`, `unlockedFor()` read `expires_at` |
| BR-13 | Only the owner, or the Vault Admin on a team credential of their branch (`via = branch`), change protection or bin it | `update()` + `protectionChange()`, `binCredential()` |

---

## 12. Known Issues

| # | Issue | Effect |
|---|---|---|
| 1 | `lockRequest()` does not sweep first | An ended, unswept request can be "locked now" and is stored as `manual` |
| 2 | `lock_admin_user_id` / `lock_manager_user_id` are always saved `null`, but `requestAccess()`, `protectionChange()` and `detail().protection` still read them | Sending a value still counts as an "approvers" change |
| 3 | `branch_critical` gives View only | After a full unlock such a requester can reveal but not copy; the Vault Admin likewise copies only where their rank is Copy or Full |
| 4 | The daily cap sums `otp_attempts` over requests **created** in the last 24 hours | A rolling window, not a calendar day |
| 5 | **Security:** `GET /credentials/{id}` returns field values in plain text once open (`detail(…, plain: true)`) | The popup and drawer show and copy secrets without `reveal()` (9.2); the docblock on `show()` still says secrets are never sent |
| 6 | The duplicate-name check has no `vault` filter | One owner cannot hold a My Vault and a Critical Vault credential of the same type and name |
| 7 | `approvers()` validates `q` and ignores it | — |
| 8 | `GET /credvault/dev/totp` prints live authenticator codes | Gated by the `local` environment only |

---

## 13. Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The Branch User (`user_type = branch_user`) of a branch |
| Base | `CredVaultController`, which every Critical Vault controller extends |
| Snapshot | The steps copied onto a request as `admin_required`, `manager_required`, `otp_required` |
| Stage | The step a request waits on: `admin`, `manager`, `otp` |
| Forward | `raiseManager()` — the requester sends an admin-approved request to the manager |
| Window | `duration_minutes` from `unlocked_at` to `expires_at` |
| Sweep | `sweepUnlocks()` — locks every window that has ended |
| Direct opener | The Vault Admin of the credential's branch (`opensDirectly()`) |
| `branch_critical` | The View access everyone in a branch has on its Critical Vault credentials |
| Memo | A value cached for one HTTP request by `$this->memo()` |
