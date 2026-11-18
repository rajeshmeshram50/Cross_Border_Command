# CredVault Third-Party Authenticator — Technical Documentation

> How the authenticator-app 2-step on Critical Vault credentials is built, and
> why it is built that way.
> Audience: developers joining CredVault, and whoever has to change it.
>
> _Last updated: 2026-11-12. Schema pulled from the live database with
> `Schema::getColumnListing()` on that date._

---

## 1. Stack

| Concern | Implementation |
|---|---|
| Code generation / check | [app/Services/CredVault/Totp.php](../../../app/Services/CredVault/Totp.php) — hand-written RFC 6238, no package |
| Secret storage | `credvault_credentials.totp_secret`, Laravel `encrypted` cast (APP_KEY), in `$hidden` |
| QR (API) | `chillerlan/php-qrcode`, `QRMarkupSVG`, ECC M → base64 SVG data URI |
| QR (SPA) | `qrcode` (npm) `toString(uri, { type: 'svg' })` from `otpauth_uri` |
| Replay guard | `Cache::add()` on the default cache store (`database` in this project) |
| Rate limits | Named limiters in [AppServiceProvider](../../../app/Providers/AppServiceProvider.php) |
| Audit | `credvault_audit_logs` via `CredVaultController::audit()` |

---

## 2. Architecture

```
   ADD / EDIT FORM (CredentialForm.tsx + ProtectionSection.tsx)
   ───────────────────────────────────────────────────────────
   needAuth && method google && !linked
        │ cvApi.newAuthenticator(label)  ─► POST two-step/google/new
        │                                     Totp::newSecret()  (20 random bytes → base32)
        │                                     Totp::uri(secret, label, 'Kryptone')
        │ ◄── secret, secret_display, otpauth_uri  (+ qr_image, unused by SPA)
        │ QRCode.toString(otpauth_uri) → <AuthBox>
        │ user types 6 digits → cvApi.verifyAuthenticator ─► POST two-step/google/verify
        │                                                     Totp::verify()  — stores nothing
        │ Save → body.twofa_method='google', totp_secret, totp_code
        ▼
   CriticalVaultController::store/update
        protectionChange() gate (owner / Vault Admin only)
        persistCredential()
          lockOtp decided from type's 2FA switch or lock_otp
          twoStepLink() ── Totp::verify(secret, code) again
          transaction: twofa_method, totp_secret (encrypted), totp_linked_at, twofa_linked_at
          audit 'totp_linked'

   UNLOCK (UnlockModal.tsx)
   ────────────────────────
   requestAccess ─► AccessRequestController::requestAccess
        lockSteps() = credential switches ∧ policy (cp_admin, cp_manager, cp_otp)
        otp step: twoStepLinked()? daily wrong-code cap?
        status 'approved' at once when no approval step
   …approvals…
   verifyOtp ─► AccessRequestController::verifyOtp      [throttle credvault-otp]
        transaction:
          Totp::matchStep(secret, code) → step | null
          Cache::add("credvault:totp-used:{cred}:{step}")  — false → replay, no try spent
          wrong → otp_attempts++ ; 3rd → locked/otp_failed, owner notified
          right → otp_verified_at, unlock(): status unlocked, expires_at = now + window
   sweepUnlocks() on every list/show → expired windows → locked/expired
```

---

## 3. The maths

```
secret   = base32(random_bytes(20))                       // 160 bits, 32 chars
T        = floor(unix_time / 30)
HOTP(K,T)= truncate(HMAC_SHA1(K, uint64_be(T))) mod 10^6  // RFC 4226 dynamic truncation
accept c ⇔ ∃ d ∈ [-w, +w] : hash_equals(HOTP(K, T+d), c)
w        = 1  (every environment)  ·  4 (APP_ENV=local only)
```

`matchStep()` returns the matching `T+d` so the caller can claim it. The code
comment on the window:

> *"ONE step in production — the standard RFC 6238 tolerance. Wider in local
> only, where the dev box's clock is deliberately set to a future date and a
> phone authenticator can never sit within 30s of it… Never loosen the
> production check."*

The otpauth URI:

```
otpauth://totp/Kryptone%3A<label>?secret=<B32>&issuer=Kryptone&algorithm=SHA1&digits=6&period=30
```

`decode()` strips anything outside `[A-Za-z2-7]` and upper-cases, so a key typed
with spaces still decodes.

---

## 4. Data model

### 4.1 `credvault_credentials` — the columns this feature owns

`twofa, lock_admin, lock_manager, lock_otp, lock_admin_user_id, lock_manager_user_id, totp_secret, totp_linked_at, vault, twofa_method, twofa_email, twofa_linked_at`

| Column | Notes |
|---|---|
| `vault` | `normal` \| `critical`; check `(vault = 'critical') = (risk = 'critical')` |
| `twofa` | `yes` \| `no` \| `na` — the recorded flag; in the Critical Vault it mirrors the step |
| `lock_otp` | The 2-step step on types without their own switch |
| `twofa_method` | `google` \| `email` \| null; pg check constraint |
| `totp_secret` | **encrypted cast**, hidden from every `toArray()` |
| `totp_linked_at` | Set when a google link is saved — this is what `twoStepLinked()` reads for google |
| `twofa_linked_at` | Set for either method |
| `twofa_email` | Email method only; cleared when the method is google |

Migration: `database/migrations/credvault/2026_11_03_000001_add_vault_and_two_step_to_credvault_credentials.php`.
On the way up it moved critical rows to the Critical Vault, back-filled
`twofa_method = 'google'` for rows already authenticator-locked, and **stripped
every lock and `totp_secret` from Normal Vault rows**.

### 4.2 `credvault_access_requests`

`id, client_id, code, credential_id, requester_id, reason, duration_minutes, admin_required, admin_user_id, admin_status, admin_decided_by, admin_decided_at, admin_note, manager_required, manager_user_id, manager_status, manager_decided_by, manager_decided_at, manager_note, otp_required, otp_verified_at, otp_attempts, status, unlocked_at, expires_at, locked_at, locked_reason, created_at, updated_at`

| Constraint / constant | Value |
|---|---|
| `uq_credvault_req_open` | unique `(credential_id, requester_id) where status in ('pending','approved','unlocked')` |
| `AccessRequest::STATUSES` | `pending, approved, unlocked, locked, rejected, cancelled` |
| `DURATIONS` | 5, 15, 30, 60 |
| `DEFAULT_MINUTES` | 5 (no Vault Admin step) |
| `MAX_OTP_ATTEMPTS` | 3 |
| `locked_reason` | `otp_failed`, `expired`, `manual` |

`otp_required` is **frozen at request time** — turning the policy off later
does not release a request already waiting for a code.

### 4.3 Where the step comes from

```php
// Credential::lockSteps()
'otp' => $p['cp_otp'] && $this->lock_otp,     // policy ∧ credential, Critical Vault only

// Credential::twoStepLinked()
'google' => (bool) $this->totp_linked_at,
'email'  => $this->twofa_linked_at && filled($this->twofa_email),
```

`lock_otp` on a type with its own switch is derived on save:
`$lockOtp = $twofa === 'yes'`.

---

## 5. Save-time verification — `twoStepLink()`

Returns `[method, newSecret, email, emailToken]`.

| Input | Outcome |
|---|---|
| `twofa_method` absent, `totp_secret` present | method = `google` (the form's shape before email existed) |
| google + secret + code that `Totp::verify()`s | `['google', $secret, null, null]` → stored |
| google + secret + bad code | 422 `totp_code` |
| google, no secret, already linked google | `['google', null, …]` → kept |
| google, no secret, not linked | 422 `totp_code` |

Then in the transaction:

```php
$c->twofa_method = $method;
if ($newSecret) {
    $c->forceFill(['totp_secret' => $newSecret, 'totp_linked_at' => now(), 'twofa_linked_at' => now()]);
} elseif ($method !== 'google') {
    $c->forceFill(['totp_secret' => null, 'totp_linked_at' => null]);
}
```

The docblock states the principle: *"the save is refused until its code
matched, so nothing is ever locked behind a code nobody receives."*

**The server keeps no record of secrets it issued.** `google/new` is stateless;
the secret lives in the browser until the save, which accepts any well-formed
base32 secret whose current code the client can produce. Possession is proved;
provenance is not. A client can therefore link a secret it generated itself —
harmless, since only the owner / a Vault Admin can link at all, but worth
knowing.

---

## 6. Unlock-time verification — `verifyOtp()`

Order, all inside `inTransaction()`:

1. `findRequest($u, $id, true)` — the row, locked for update.
2. Requester only → 403.
3. `status === 'approved' && currentStage() === 'otp'` → else 409.
4. Load the credential **with trashed**, selecting `totp_secret` explicitly
   (*"The row's eager load carries display columns only; the secret is read
   here, on purpose."*). Not linked → 409.
5. `Totp::matchStep()`. On a match, `Cache::add("credvault:totp-used:{cred}:{step}", 1, 3 min)`;
   if the key already exists → 422 **without** incrementing.
6. No match → `otp_attempts++`; at 3 → `locked / otp_failed`, `EmailOtp::forgetUnlock()`,
   audit `otp_failed`, notify the owner.
7. Match → `otp_verified_at = now()`, `unlock()`.

The replay key is per **credential**, not per request — the comment: *"a replay
inside its ±30 s window is refused — without costing a try — while a code from
a neighbouring step stays usable."* Two people unlocking the same shared
credential in the same 30 seconds collide: the second must wait for the next
code.

---

## 7. Limits

| Limit | Value | Where | Scope |
|---|---|---|---|
| Group throttle | 240 / min | `credvault` limiter | per user |
| Code checks | **10 / min** | `credvault-otp` limiter on `google/verify`, `email/verify`, `verify-otp` | per user (`cv-otp:<id>`), own bucket |
| Wrong codes per request | 3 → voided | `AccessRequest::MAX_OTP_ATTEMPTS` | per request |
| Wrong codes per day | 6 → 429 on new requests | `CredVaultController::OTP_DAILY_LIMIT`, `sum(otp_attempts)` over 24 h | per person per credential |
| Replay | once per step | cache, 3 min TTL | per credential |

The AppServiceProvider comment on why the limiters are named: *"a plain
throttle:N,1 keys on the user alone — every throttle on a route then shares one
counter, and the tight OTP limit would count the user's ordinary list calls
too."*

Brute force arithmetic: 10⁶ codes, 3 valid at any time (±1 step), 3 tries per
request and 6 per day → ≈ 1.8 × 10⁻⁵ per person per credential per day.

---

## 8. Concurrency

| Race | Guard |
|---|---|
| Double-click raises two requests | Partial unique index `uq_credvault_req_open`; `QueryException` → 409 |
| Two code submits on one request | `findRequest(..., true)` row lock inside the transaction |
| Same code accepted twice | Atomic `Cache::add()` |
| Window ends mid-read | `sweepUnlocks()` on every list / show; `isLive()` checks `expires_at` |
| Policy toggled while a request waits | `otp_required` frozen on the request |

---

## 9. Multi-tenancy

| Path | Scope |
|---|---|
| `google/new` with `credential_id` | `Credential::where('client_id', $u->client_id)` — another tenant's id resolves to `null` |
| `google/verify` | No row touched |
| Save | `findInVault()` — tenant + access rank |
| Request / verify | `AccessRequest::where('client_id', …)` via `findRequest()` |
| `dev/totp` | caller's `client_id` only |

---

## 10. Security posture

| Control | Status |
|---|---|
| Secret encrypted at rest (APP_KEY) | In place — **an APP_KEY leak plus a DB dump yields every secret** |
| Secret never in a response after setup | In place (`$hidden`) |
| Secret in transit once, at setup | Inherent to TOTP — the browser must show it |
| Constant-time compare | In place |
| ±30 s drift in production | In place |
| Replay refused | In place |
| Per-user and per-day caps | In place |
| Owner notified on a voided request | In place |
| `dev/totp` local-only | `abort_unless(environment('local'))` — check `APP_ENV` on every server |
| Branch Admin bypass | By design (`opensDirectly()`) |
| Owner / Vault Admin can re-link or disable without the current code | By design — the recovery path |
| Shared factor | One secret per credential; revoking one person means re-linking for all |

---

## 11. Frontend internals

| Concern | Where |
|---|---|
| Form state | `AuthState` in [ProtectionSection.tsx](../../../resources/js/pages/credvault/form/ProtectionSection.tsx): `secret, display, uri, loading, failed, linkedOnServer, verified, code, error`; `authLinked = linkedOnServer \|\| verified` |
| Fetching a secret | [CredentialForm.tsx](../../../resources/js/pages/credvault/form/CredentialForm.tsx) effect: needs the step, method google, not linked, no secret yet |
| QR | `AuthBox` draws `otpauth_uri` with `qrcode`; `qr_image` from the API is ignored |
| Save body | `twofa_method: 'google', totp_secret, totp_code` (spaces stripped) only when not already linked on the server |
| 422 mapping | `totp_secret` errors are shown on `totp_code`; the form scrolls to `.cp-auth` |
| Read-only | Editing a linked credential shows the method read-only, with **Re-link app** |
| Unlock | [UnlockModal.tsx](../../../resources/js/pages/credvault/critical/UnlockModal.tsx): `verify()` raises the request first when none exists (authenticator-only lock); 423 → reload; 422 → field error + shake |
| Setup pane in the modal | `cvData.otpSetup()` — the real data layer returns `null`, so it never renders outside the prototype dummy |
| Digits | [OtpDigits.tsx](../../../resources/js/pages/credvault/critical/OtpDigits.tsx) — six boxes, `autoComplete="one-time-code"` |

---

## 12. Open technical items

| Item | Detail |
|---|---|
| Stateless issue | `google/new` does not bind the secret to the caller; the save accepts any secret with a valid code (§5) |
| Replay cache on the `database` store | Works, but every successful unlock writes a cache row; a Redis store would be lighter |
| No per-user factor | A leaver who scanned the QR keeps working codes until someone re-links |
| `qr_image` unused by the SPA | Rendered server-side on every `google/new` for API clients only |
| Prototype setup pane | `UnlockModal` still carries a QR setup pane fed by `cvData.otpSetup()`, dead in production |
