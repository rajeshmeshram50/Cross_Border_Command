# CredVault Third-Party Authenticator — Code Walkthrough

> Where the code is, and what happens on each request — for a developer with
> the file open, debugging. Read the Technical document first for the why.
>
> _Last updated: 2026-11-12._

---

## 1. The file map

### 1.1 Backend

| File | Role |
|---|---|
| [Totp.php](../../../app/Services/CredVault/Totp.php) | `newSecret()`, `uri()`, `code()`, `verify()`, `matchStep()`, `window()`, `decode()` |
| [TwoStepController.php](../../../app/Http/Controllers/Api/CredVault/CriticalVault/TwoStepController.php) | `googleNew()`, `googleVerify()` (and the email siblings) |
| [CriticalVaultController.php](../../../app/Http/Controllers/Api/CredVault/CriticalVault/CriticalVaultController.php) | `store()`, `update()` — the owner / Vault Admin gate on protection changes |
| [CredVaultController.php](../../../app/Http/Controllers/Api/CredVault/CredVaultController.php) | `persistCredential()`, `twoStepLink()`, `protectionChange()`, `unlock()`, `sweepUnlocks()`, `assertUnlocked()`, `findRequest()`, `opensDirectly()`, `devTotp()`, `OTP_DAILY_LIMIT` |
| [AccessRequestController.php](../../../app/Http/Controllers/Api/CredVault/CriticalVault/AccessRequestController.php) | `requestAccess()`, `verifyOtp()`, `sendOtp()` (refuses the authenticator), `lockRequest()` |
| [Credential.php](../../../app/Models/CredVault/Credential.php) | `TWOFA_METHODS`, casts / `$hidden` for `totp_secret`, `lockSteps()`, `twoStepLinked()`, `hasTwofaSwitch()`, `isProtected()` |
| [AccessRequest.php](../../../app/Models/CredVault/AccessRequest.php) | `MAX_OTP_ATTEMPTS`, `DURATIONS`, `DEFAULT_MINUTES`, `OPEN`, `currentStage()`, `isLive()` |
| [Policy.php](../../../app/Models/CredVault/Policy.php) | `cp_otp`, `cp_max_minutes` defaults and labels |
| [AppServiceProvider.php](../../../app/Providers/AppServiceProvider.php) | `credvault` and `credvault-otp` rate limiters |
| `database/migrations/credvault/2026_11_03_000001_add_vault_and_two_step_to_credvault_credentials.php` | `vault`, `twofa_method`, `twofa_email`, `twofa_linked_at` + checks |
| `database/migrations/credvault/2026_10_30_000003_create_credvault_access_requests_table.php` | requests + `uq_credvault_req_open` |

### 1.2 Frontend

| File | Role |
|---|---|
| [CredentialForm.tsx](../../../resources/js/pages/credvault/form/CredentialForm.tsx) | Owns `auth` state, fetches the secret, calls verify, builds the save body, maps 422s |
| [ProtectionSection.tsx](../../../resources/js/pages/credvault/form/ProtectionSection.tsx) | `AuthState`, `AUTH_EMPTY`, `authLinked`, `AuthBox` (QR + key + digits), `TwofaPicker`, `TwofaCard` |
| [UnlockModal.tsx](../../../resources/js/pages/credvault/critical/UnlockModal.tsx) | The stepper; `verify()` at the Authenticator step |
| [OtpDigits.tsx](../../../resources/js/pages/credvault/critical/OtpDigits.tsx) | Six-box code input |
| [cvApi.ts](../../../resources/js/pages/credvault/cvApi.ts) | `newAuthenticator`, `verifyAuthenticator`, `requestAccess`, `verifyOtp`, `sendOtp` |
| `critical/cvData.ts` | Switches the modal between the prototype dummy and `cvApi`; real `otpSetup()` returns `null` |

### 1.3 Routes — [routes/api.php](../../../routes/api.php)

| Line ~ | Route |
|---|---|
| 755 | `credvault` prefix, `throttle:credvault` |
| 758 | `GET dev/totp` |
| 776–780 | critical-vault credentials CRUD |
| 784–785 | `two-step/google/new`, `two-step/google/verify` (`throttle:credvault-otp`) |
| 790 | `credentials/{id}/access-requests` |
| 797–799 | `send-otp`, `verify-otp` (`throttle:credvault-otp`), `lock` |

---

## 2. Request flow — getting a secret

```
CredentialForm effect
  if (needAuth && method==='google' && !authLinked(auth) && !auth.secret && !auth.loading && !auth.failed)
    cvApi.newAuthenticator(label)
        POST /api/credvault/critical-vault/two-step/google/new
          TwoStepController::googleNew
            tenantUser()
            validate label ≤100, credential_id ≥1
            $secret = Totp::newSecret()                  // random_bytes(20) → base32
            $credential = Credential::where('client_id',…)->find(credential_id)   // or null
            $label = label ?: "{code} · {name}" ?: 'CredVault'
            $uri = Totp::uri($secret, $label)           // issuer 'Kryptone'
            → secret, secret_display, otpauth_uri, qr_image, digits, period, works_with
  setAuth({ secret, display, uri })
  <AuthBox> → QRCode.toString(uri, { type:'svg' })
```

Nothing is written. Refreshing the form loses the secret and asks for a new one.

---

## 3. Request flow — verify, then save

```
AuthBox  [Verify & link]
  cvApi.verifyAuthenticator(auth.secret, c6)
      POST two-step/google/verify   (throttle credvault-otp)
        validate secret ^[A-Z2-7]{16,128}$, code ^\d{6}$
        Totp::verify() ? 200 : 422 'code'
  setAuth({ verified: true })            // code kept in auth.code for the save

[Save]
  body.twofa_method = 'google'; body.totp_secret = auth.secret; body.totp_code = auth.code
      POST /critical-vault/credentials        (or PUT …/{id})
        CriticalVaultController::update
          findInVault(RANK_FULL)
          not owner/admin && protectionChange() → 403
        CredVaultController::persistCredential
          normaliseSwitches · validate (totp_* rules + messages)
          $twofa from the type's switch;  $lockOtp = critical && (switch ? twofa==='yes' : lock_otp)
          no step on at all → 422 'lock_admin'
          [$method, $newSecret, …] = $lockOtp ? twoStepLink($data, $u, $c) : nulls
             google + secret → Totp::verify again → 422 'totp_code' | ['google', $secret]
             google, no secret → kept ? ['google', null] : 422 'totp_code'
          inTransaction:
             … credential fields …
             $c->twofa_method = $method
             $newSecret ? forceFill(totp_secret, totp_linked_at, twofa_linked_at)
                        : method !== 'google' → clear totp_secret, totp_linked_at
             !$method → twofa_linked_at = null
             audit 'totp_linked' "Authenticator app linked" when relinked
```

On 422 the form maps `totp_secret` → `totp_code` (CredentialForm line ~29),
sets `auth.verified = false` with the message, and scrolls to `.cp-auth`.

---

## 4. Request flow — raising the request

```
UnlockModal  → cvData.requestAccess(id, { reason?, duration_minutes? })
    POST /critical-vault/credentials/{id}/access-requests
      AccessRequestController::requestAccess
        sweepUnlocks(client)
        findInVault(critical, RANK_VIEW)        Use Only → refused
        opensDirectly() → 409 (Branch Admin)
        $steps = $c->lockSteps()                 [] → 409 not locked
        admin step → reason ≥10, duration required; else duration = 5
        duration > cp_max_minutes → 422
        otp step && Σ otp_attempts (24 h, this person, this credential) ≥ 6 → 429
        otp step && !twoStepLinked() → 409
        resolve admin / manager approvers
        open request exists → 409 with its row
        inTransaction: AccessRequest::create(status = approvals ? 'pending' : 'approved', otp_required)
                       unique-index violation → 409
                       audit 'request', notifyStage()
```

For an authenticator-only lock the modal does not call this separately — its
`verify()` raises the request and enters the code in one press:

```ts
// An authenticator-only lock has no approval step: the request is raised here, already approved.
let reqId = live?.id;
if (!reqId) reqId = (await cvData.requestAccess(d.id, {})).data.id;
const r = await cvData.verifyOtp(reqId, code);
```

---

## 5. Request flow — entering the code

```
POST /critical-vault/access-requests/{id}/verify-otp { code }   (throttle credvault-otp)
  AccessRequestController::verifyOtp
    validate ^\d{6}$
    inTransaction:
      $r = findRequest($u, $id, true)          // lockForUpdate
      requester only                           403
      status approved && currentStage()=='otp' 409
      $cred = Credential::withTrashed()->find(…, [… 'totp_secret', 'totp_linked_at'])
      !twoStepLinked()                         409
      google:
        $step = Totp::matchStep($cred->totp_secret, $code)
        $step && !Cache::add("credvault:totp-used:{$cred->id}:{$step}", 1, 3 min)
                                               → 422 "That code was just used…"   (no try)
        $match = $step !== null
      !$match: otp_attempts++
               ≥3 → status locked, locked_reason otp_failed, forgetUnlock,
                    audit otp_failed, notify owner (if not the requester)
               save; return [r, false]
      match:   otp_verified_at = now; unlock()  → status unlocked, expires_at
    !ok → 422 "Incorrect or expired code. N attempts left." | 423 "Too many wrong codes…"
    ok  → 200 "Unlocked for N min."
```

Note the 422/423 are thrown **after** the transaction commits, so the
incremented `otp_attempts` (and the lock on the third) are saved.

---

## 6. Inside `Totp`

```php
public static function code(string $secret, ?int $step = null): string
{
    $step ??= intdiv(time(), self::PERIOD);
    $key  = self::decode($secret);
    $msg  = pack('N*', 0) . pack('N*', $step);          // 64-bit big-endian counter
    $hash = hash_hmac('sha1', $msg, $key, true);
    $off  = ord($hash[19]) & 0x0f;                      // dynamic truncation
    $bin  = ((ord($hash[$off]) & 0x7f) << 24) | (ord($hash[$off + 1]) << 16)
          | (ord($hash[$off + 2]) << 8) | ord($hash[$off + 3]);

    return str_pad((string) ($bin % (10 ** self::DIGITS)), self::DIGITS, '0', STR_PAD_LEFT);
}
```

`verify()` is `matchStep() !== null`. Use `matchStep()` whenever a code is
being **spent** — only it gives you the step to claim against replay.

---

## 7. Patterns you will see in this code

| Pattern | Why |
|---|---|
| Verify in setup **and** again on save | The save never trusts an earlier answer |
| `reject($msg, $field, $status)` throws `HttpResponseException` | Refusals pass through `inTransaction()` untouched; `errors` keyed by API field |
| Secret selected explicitly at use | Eager loads carry display columns; `totp_secret` is read only where it is needed |
| `withTrashed()` on the unlock credential read | A request on a binned credential still resolves |
| Named rate limiters | The OTP bucket does not count ordinary list calls |
| Steps frozen on the request | A policy change mid-request cannot skip or add a step |
| Secret held only in React state during setup | Never written to `localStorage`; a reload asks for a new one |

---

## 8. Symptom → file

| Symptom | Look at |
|---|---|
| Every code rejected, phone clock correct | Server clock (`date` on the box); `Totp::window()`; is `APP_ENV` what you think? |
| Codes accepted two minutes late in prod | `APP_ENV=local` on a server — `window()` widens to ±4 and `dev/totp` is live |
| `dev/totp` answers on a server | `CredVaultController::devTotp()` — same `APP_ENV` problem |
| Save refused after "Code verified" | `twoStepLink()` re-verifies; the 30 s window passed between verify and save, or a **new** secret was fetched after verifying (form re-render) |
| "has not been linked yet" on a credential that shows App linked | `twoStepLinked()` reads `totp_linked_at` — check the column, not `twofa_linked_at` |
| Old QR still works after re-link | The save did not carry `totp_secret` — check the body in `CredentialForm` (~line 973) |
| "That code was just used" for two different people | Replay key is per credential per step (§5) — expected on a shared credential |
| Attempts not decreasing | Replay path (no try) or no-live-code path — `verifyOtp()` |
| Request voided but approvals still show | `locked_reason = otp_failed`; the Approved tab excludes it (`accessRequests()` tab filter) |
| 429 on new request | `OTP_DAILY_LIMIT` sum in `requestAccess()` |
| 429 on code entry | `credvault-otp` limiter, 10/min/user |
| Full-Access user can't touch 2-step | `protectionChange()` gate in `CriticalVaultController::update()` — by design |
| Branch Admin never sees the code step | `opensDirectly()` |
| QR in the Unlock modal | `cvData` is in dummy mode — the real `otpSetup()` returns null |
| Secret appears in a response | Check `$hidden` on `Credential` and any new `->get([...])` that names `totp_secret` |

---

## 9. How to extend it

| Change | Touch |
|---|---|
| Per-user authenticators | New table `(user_id, credential_id, secret)`; `twoStepLink()` writes per user; `verifyOtp()` reads the requester's; replay key per user |
| Bind issued secrets to the caller | Cache the secret in `googleNew()` keyed by user + nonce; `twoStepLink()` accepts only that |
| 8-digit or SHA-256 codes | `Totp::DIGITS` / algorithm + the URI parameters — every existing link breaks, so add a per-credential column |
| Recovery codes | New column; accept in `verifyOtp()` before `matchStep()`, burn on use |
| Change the drift window | `Totp::window()` — keep production at 1 |
| Move the replay cache to Redis | `CACHE_STORE`; no code change |
| Change any message | The controller **and** the API document — the wording is a contract |
