# CredVault Third-Party Authenticator — API Documentation

> REST reference for the authenticator-app 2-step on Critical Vault
> credentials (Google Authenticator, Microsoft Authenticator, Authy or any
> RFC 6238 TOTP app): linking the app in the credential form, proving it on
> save, and entering its code to unlock.
> Source of truth: [routes/api.php](../../../routes/api.php) (the `credvault`
> group, ~line 755). The wider CredVault surface is in
> [CREDVAULT_VAULTS_API_SHEET.md](../../CREDVAULT_VAULTS_API_SHEET.md).
> Audience: QA, integrators, anyone testing from Postman or curl.
>
> _Last updated: 2026-11-12._

---

## 0. How to read this

| | |
|---|---|
| Base URL | `{{base}}/api/credvault` |
| Auth | `Authorization: Bearer <sanctum token>`, through `auth:sanctum` → `user.active` → `tenant` |
| Tenant | Always the caller's `client_id`. A user without one is refused by `tenantUser()` |
| Envelope | Success `{ status: true, data, message? }` · refusal `{ status: false, message, errors? }`, with `errors` keyed by the API field |
| Throttles | Whole group `throttle:credvault` = 240/min per user. Code checks add `throttle:credvault-otp` = **10/min per user** (its own bucket) |

The authenticator touches three groups of routes:

| § | When | Routes |
|---|---|---|
| 1 | Setting it up in the form | `two-step/google/new`, `two-step/google/verify` |
| 2 | Saving the credential | `POST` / `PUT critical-vault/credentials[/{id}]` with `totp_secret` + `totp_code` |
| 3 | Unlocking | `credentials/{id}/access-requests`, `access-requests/{id}/verify-otp` |
| 4 | Local testing | `GET dev/totp` |

**Not true:**

- This is **not** a login 2FA. Nobody signs in to Kryptone with it. It guards
  the reveal of one Critical Vault credential.
- The secret belongs to the **credential**, not to a person. Everyone who should
  open that credential scans the same QR.
- The Normal Vault (My Vault / Team Vault) never uses these routes — its
  `twofa` is a recorded yes/no.
- The **TOTP / 2FA Seed** credential *type* (storing another service's seed as
  the secret) is a different feature — see §6.

---

## 1. Setup in the form

Controller: [TwoStepController](../../../app/Http/Controllers/Api/CredVault/CriticalVault/TwoStepController.php).
Nothing is stored on any credential by these two calls.

### 1.1 `POST /critical-vault/two-step/google/new`

A fresh 160-bit secret and everything needed to put it in an app. Asking again
gives a **new** secret — save with the latest one.

| Field | Rule | Meaning |
|---|---|---|
| `label` | nullable, string, max 100 | The account name the app shows |
| `credential_id` | nullable, integer ≥ 1 | When linking to an existing credential; resolved inside the tenant |

Label, in order: `label` → `"<code> · <name>"` of the resolved credential →
`CredVault`.

`200`:

```json
{ "status": true, "data": {
  "method": "google",
  "credential_id": 14,
  "credential_code": "CCRD-0014",
  "label": "CCRD-0014 · AWS root",
  "secret": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  "secret_display": "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP",
  "otpauth_uri": "otpauth://totp/Kryptone%3ACCRD-0014%20%C2%B7%20AWS%20root?secret=JBSW…&issuer=Kryptone&algorithm=SHA1&digits=6&period=30",
  "qr_image": "data:image/svg+xml;base64,…",
  "digits": 6,
  "period": 30,
  "works_with": "Google Authenticator, Microsoft Authenticator, Authy and any TOTP app"
} }
```

| Field | Use |
|---|---|
| `secret` | Send back on verify and on save |
| `secret_display` | The setup key in groups of 4, for "Enter a setup key" |
| `otpauth_uri` | What the QR encodes. Issuer is always **Kryptone** |
| `qr_image` | Ready-made SVG data URI for `<img src>` (Postman: Visualize tab). The SPA ignores it and draws its own QR from `otpauth_uri` |
| `credential_code` | `null` when `credential_id` did not resolve in this tenant |

No throttle beyond the group's.

### 1.2 `POST /critical-vault/two-step/google/verify`

Does the app show the right code? **Stores nothing.** `throttle:credvault-otp`.

| Field | Rule | On failure |
|---|---|---|
| `secret` | required, `^[A-Z2-7]{16,128}$` | `The setup key is not valid — get a new one and scan it again.` |
| `code` | required, `^\d{6}$` | `Enter the 6-digit code shown in your authenticator app.` |

| Status | Body |
|---|---|
| `200` | `{ status:true, message:"Code verified — save the credential to link the app.", data:{ method:"google", verified:true } }` |
| `422` | `That code is incorrect or expired. Check your app and try again.` (field `code`) |

---

## 2. Saving the credential

Controllers: [CriticalVaultController](../../../app/Http/Controllers/Api/CredVault/CriticalVault/CriticalVaultController.php)
`store` / `update` → `CredVaultController::persistCredential()` →
`twoStepLink()`.

| Route | |
|---|---|
| `POST /critical-vault/credentials` | Create |
| `PUT /critical-vault/credentials/{id}` | Update |
| `POST /critical-vault/credentials/{id}` | Update with files (PHP reads no multipart on PUT) |

### 2.1 The 2-step fields

| Field | Rule | Meaning |
|---|---|---|
| `twofa_method` | nullable, `google` \| `email` | Omitted with `totp_secret` present → `google` |
| `totp_secret` | nullable, `^[A-Z2-7]{16,128}$`, `required_with:totp_code` | The secret from §1.1 |
| `totp_code` | nullable, `^\d{6}$`, `required_with:totp_secret` | A code the app shows **now** |
| `lock_otp` | boolean | The 2-step step, on types without their own 2FA switch |
| `twofa` / `fields.twofa` | boolean | The 2-step step, on types that have a 2FA switch (login, email, bank, crypto, passkey, password) |

Whether 2-step is **on** is decided per type: the type's own 2FA switch where
it has one, `lock_otp` otherwise. When it is on, the save **must** prove a
method or be refused.

### 2.2 What the save decides

| Request | Stored credential | Result |
|---|---|---|
| `totp_secret` + matching `totp_code` | new secret, `totp_linked_at` = `twofa_linked_at` = now | linked (re-linked if one existed) |
| `totp_secret` + wrong code | — | `422 That code is incorrect or expired. Check your app and try again.` (`totp_code`) |
| no secret, method `google`, already linked to google | unchanged | kept |
| no secret, method `google`, not linked | — | `422 Scan the QR code and verify a code to link your authenticator app, or turn 2-step off.` (`totp_code`) |
| no method at all, 2-step on | — | `422 Choose how the 2-step code is received: Google Authenticator or email.` (`twofa_method`) |
| method changes to `email` | `totp_secret`, `totp_linked_at` cleared | email path |
| 2-step turned off | method and `twofa_linked_at` cleared | — |
| all three protection steps off | — | `422 Turn on at least one protection step for a critical credential.` (`lock_admin`) |

The code is checked again on save even though §1.2 already passed — the save
does not trust an earlier answer. A code from §1.2 is still inside its window
and passes.

### 2.3 Who may change it

On update, someone with Full Access who is **not** the owner or a Vault Admin
sending any of `totp_secret`, `totp_code`, a different `twofa_method`, or a
change to the lock steps gets:

```
403  Only the owner or a Vault Admin can change the 2-step verification.
```

(`… the 2-step method.` / `… the protection steps.` for the other fields.)

### 2.4 What comes back

The credential detail. For a caller with Full Access it carries:

```json
"protection": {
  "admin": true, "manager": false,
  "otp": true, "otp_linked": true, "otp_method": "google", "otp_email": null,
  "policy": { "admin": true, "manager": true, "otp": true }
}
```

`totp_secret` is **never** in any response — it is an encrypted, hidden column.

---

## 3. Unlocking with the code

Controller: [AccessRequestController](../../../app/Http/Controllers/Api/CredVault/CriticalVault/AccessRequestController.php).

### 3.1 `POST /critical-vault/credentials/{id}/access-requests`

Raises the request. The steps are fixed **now**, from the credential's switches
and the tenant policy.

| Field | Rule |
|---|---|
| `reason` | nullable, max 300 — required (≥ 10 chars) only when the Vault Admin step is on |
| `duration_minutes` | `5` \| `15` \| `30` \| `60` — required only with the Vault Admin step; otherwise **5** |

Authenticator-specific refusals:

| Status | Message |
|---|---|
| `409` | `2-step verification for this credential has not been linked yet. Ask the owner to link it first.` |
| `429` | `Too many wrong 2-step codes on this credential today. Try again tomorrow, or ask the owner to unlock it with you.` (≥ 6 wrong codes by this person on this credential in 24 h) |
| `409` | `This credential is not locked — open it directly.` |
| `409` | `You are the Vault Admin for this branch — open this credential directly.` |
| `409` | `You already have an open request ({code}) for this credential.` (with `data`) |

An **authenticator-only** lock (no approval steps) is created with
`status: "approved"`, already waiting for the code. `201`, message
`Request REQ-… raised.`

### 3.2 The `otp` block on a request

Every request row (`GET /critical-vault/access-requests`, `/{id}`, and the
responses of §3.1 / §3.3) carries:

```json
"otp": { "method": "google", "label": "Authenticator", "sent_to": null,
         "verified_at": null, "attempts_left": 3 },
"stage": "otp", "stage_label": "Authenticator",
"can": { "verify_otp": true, "send_otp": false, … }
```

`can.send_otp` is always `false` for the authenticator — there is nothing to
send. Calling `send-otp` anyway answers
`409 This credential uses the authenticator app — enter the code it shows.`

### 3.3 `POST /critical-vault/access-requests/{id}/verify-otp`

`throttle:credvault-otp`.

| Field | Rule | On failure |
|---|---|---|
| `code` | required, `^\d{6}$` | `Enter the 6-digit code.` |

| Status | Message | Costs a try |
|---|---|---|
| `200` | `Unlocked for {n} min.` + the row (`status: "unlocked"`, `expires_at`, `seconds_left`) | — |
| `403` | `Only the person who raised the request can enter its code.` | no |
| `409` | `This request is not waiting for a 2-step code.` | no |
| `409` | `2-step verification for this credential is no longer linked.` | no |
| `422` | `That code was just used. Wait for the next code in your authenticator app.` (`code`) | **no** |
| `422` | `Incorrect or expired code. 2 attempts left.` / `… 1 attempt left.` (`code`) | yes |
| `423` | `Too many wrong codes — the approvals were reset. Request access again.` (`code`) | the third |
| `429` | throttle — 10 code checks a minute per user | — |

On the third wrong code the request becomes `locked` with
`locked_reason: "otp_failed"`, **every approval on it is lost**, and the
credential's owner is notified (unless the owner made the attempts).

### 3.4 After the unlock

| Route | |
|---|---|
| `POST /critical-vault/access-requests/{id}/lock` | "Lock now" — requester or Vault Admin |
| (automatic) | Any list / show sweeps expired windows to `locked`, `locked_reason: "expired"` |

---

## 4. `GET /dev/totp` — local only

`404` unless `APP_ENV=local`. Returns the **current** code for every
google-linked Critical Vault credential of the caller's client:

```json
{ "status": true,
  "note": "LOCAL dev helper — live 2FA codes, valid ~30s. Never enable outside local.",
  "data": [ { "id": 14, "code": "CCRD-0014", "name": "AWS root", "totp": "492817" } ] }
```

This bypasses the second factor by design. It must never be reachable outside
local.

---

## 5. The code itself

[app/Services/CredVault/Totp.php](../../../app/Services/CredVault/Totp.php)

| Parameter | Value |
|---|---|
| Standard | RFC 6238 (TOTP over RFC 4226 HOTP) |
| Algorithm | HMAC-SHA1 |
| Digits | 6 |
| Period | 30 s |
| Secret | 20 random bytes → 32 base32 characters |
| Accepted drift | ±1 step in every environment except **local**, where it is ±4 |
| Comparison | `hash_equals` (constant time) |
| Replay | A code is accepted **once** per credential per time step (§3.3) |

Any app that accepts an `otpauth://totp/…` URI with these parameters works.

---

## 6. Not this feature: the TOTP / 2FA Seed type

`type: "totp"` is a credential whose **secret is another service's
authenticator seed** (e.g. the AWS console's), with `service`, `account`,
`seed`, `digits`, `period`, `backup` fields. In the Critical Vault the seed
must be base32 — `Enter the base32 setup key from the QR setup.` — in My / Team
Vault it is kept as typed. Kryptone stores it; it does not generate codes from
it. That credential can itself be protected by this feature like any other.

---

## 7. Status-code cheat sheet

| Code | Meaning here |
|---|---|
| `200` | Secret issued · code verified · unlocked |
| `201` | Credential or request created |
| `403` | Not the requester · not the owner / Vault Admin for a protection change |
| `404` | `dev/totp` outside local · credential outside the caller's ranks |
| `409` | Not linked yet · not waiting for a code · wrong method for `send-otp` · open request exists |
| `422` | Validation · wrong code · replayed code |
| `423` | Third wrong code — request voided |
| `429` | 10 code checks/min per user · 6 wrong codes/day per person per credential |

---

## 8. curl, end to end

Needs `oathtool` (or any TOTP tool) to play the phone. On a local box,
`GET /dev/totp` gives the code instead.

```bash
B=http://127.0.0.1:8000/api/credvault
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Accept: application/json')

# 1. A secret for the form
S=$(curl -s "${H[@]}" $B/critical-vault/two-step/google/new -d '{"label":"AWS root"}' | jq -r .data.secret)

# 2. "Scan" it and check one code
curl -s "${H[@]}" $B/critical-vault/two-step/google/verify \
  -d "{\"secret\":\"$S\",\"code\":\"$(oathtool --totp -b $S)\"}"

# 3. Save — authenticator-only lock, so no approvers are needed
ID=$(curl -s "${H[@]}" $B/critical-vault/credentials -d "{
  \"type\":\"login\",\"name\":\"AWS root\",\"fields\":{\"url\":\"https://aws.amazon.com\",\"username\":\"root\",\"password\":\"<strong one>\"},
  \"lock_admin\":false,\"lock_manager\":false,\"twofa\":true,
  \"twofa_method\":\"google\",\"totp_secret\":\"$S\",\"totp_code\":\"$(oathtool --totp -b $S)\"}" | jq -r .data.id)

# 4. Unlock: raise, then the code (the owner is locked out too, so the owner can run this)
R=$(curl -s "${H[@]}" $B/critical-vault/credentials/$ID/access-requests -d '{}' | jq -r .data.id)
curl -s "${H[@]}" $B/critical-vault/access-requests/$R/verify-otp -d "{\"code\":\"$(oathtool --totp -b $S)\"}"

# 5. Replay check: lock it, raise a new request, and send the SAME code within
#    its 30 s step → 422 "That code was just used…", attempts_left unchanged
curl -s "${H[@]}" $B/critical-vault/access-requests/$R/lock -d '{}'
```

Run this as a user who is **not** a Branch Admin of the credential's branch.
A Branch Admin opens it directly and gets `409` on step 4. The Postman collection
[CredVault_Critical_Unlock.postman_collection.json](../../CredVault_Critical_Unlock.postman_collection.json)
covers the same calls.
