# CredVault Third-Party Authenticator — Functional Documentation

> What the authenticator-app step does, the rules it enforces, and what each
> screen shows — without reading code.
> Audience: QA, BA, support, Vault Admins.
> Companion documents: API · Technical · Code Walkthrough (same folder).
>
> _Last updated: 2026-11-12._

---

## 1. The feature in one paragraph

A credential in the **Critical Vault** can be locked behind a 6-digit code from
an ordinary authenticator app on a phone — Google Authenticator, Microsoft
Authenticator, Authy, or any app that reads a standard TOTP QR code. The owner
links the app once, while adding or editing the credential, by scanning a QR
code and typing back one code. From then on, nobody can see that credential's
password — the owner included — until they raise an access request, pass any
approvals, and type the code the app is showing at that moment. The credential
then stays open for the chosen window (5 minutes to 1 hour) and locks itself
again.

---

## 2. What it is, and what it is not

| It is | It is not |
|---|---|
| A lock on **one credential** in the Critical Vault | A login 2FA for Kryptone |
| Shared by everyone who opens that credential — one QR per credential | A personal factor per user |
| One of two 2-step methods. The other is an emailed code | Available in My Vault / Team Vault — there, "2FA" is only a yes/no that is recorded |
| Step 3 of up to three steps: Vault Admin → Reporting Manager → code | A replacement for the approvals — they still run first when they are on |

> **Not to be confused with the "TOTP / 2FA Seed" credential type.** That type
> *stores* another service's authenticator seed as a secret. This feature
> *protects* a credential with Kryptone's own code.

---

## 3. Where it lives

| Screen | Path | Who |
|---|---|---|
| Add / Edit credential → **Protection** → step 3, and **Two-factor authentication on Kryptone** | Credentials Vault → Critical Vault → Add / Edit | Owner, Vault Admin |
| **Unlock** modal → *Authenticator* step | Critical Vault → a locked credential → lock icon / Open | Anyone who can view it |
| **Access Request Management** | Critical Vault → Access Requests | Requesters, Vault Admins, managers |
| **Policies** → *Authenticator OTP* | Credentials Vault → Policies | Company admin |
| **Audit Logs** | Credentials Vault → Audit Logs | Admins |

---

## 4. Roles and access

| Action | Who |
|---|---|
| Link, re-link or switch off the authenticator | The credential's **owner** or a **Vault Admin**. Someone with Full Access but neither of those is refused: *"Only the owner or a Vault Admin can change the 2-step verification."* |
| Enter the code to unlock | Only the person who **raised** the request |
| Skip the whole lock | A **Branch Admin** of the credential's branch (or the owner's branch) opens it directly — no request, no code |
| Turn the step off for the whole company | The company admin, via the *Authenticator OTP* policy |

---

## 5. Linking the app (Add / Edit credential)

### 5.1 When the box appears

In the Critical Vault form, the **2-step** step is on by default. On types with
their own 2FA switch (Login, Email, Bank, Crypto, Passkey, Password) that
switch is the step; on every other type it is the Protection step 3 toggle.
With it on, the form asks **"How should Kryptone ask for the code? Choose
one"**: **Authenticator app** or **Gmail**.

### 5.2 The authenticator box

| Element | What it shows |
|---|---|
| Title | **Link your authenticator app** · *Works with any authenticator app* |
| Step 1 | *Open your authenticator app* — tap **+** or **Add account** |
| Step 2 | *Scan this QR code* — or choose "Enter a setup key" and type the key |
| Step 3 | *Enter the 6-digit code* — the app shows a new code for **Kryptone** every 30 seconds |
| Setup key | The key in groups of four, with a copy button |
| Team note | *Shared with a team? Scan this QR code on the phone of everyone who should be able to open this credential.* |
| Verify card | Six digit boxes and **Verify & link** · *Codes refresh every 30 seconds* |

In the app the account reads **Kryptone: CCRD-0014 · AWS root** (or
*Kryptone: CredVault* for a credential not saved yet).

### 5.3 Rules

1. **The app must be proved before the save.** Verify & link checks one code;
   then the **save checks it again**. Without a matching code the save is
   refused: *"Scan the QR code and verify a code to link your authenticator
   app, or turn 2-step off."*
2. A wrong or old code: *"That code is incorrect or expired. Check your app and
   try again."*
3. Once verified the box reads **Authenticator app linked** — *the app is
   linked to this credential when you save.* Nothing is linked until the save.
4. Opening the form again gives a **new** QR. Only the one that was verified
   and saved counts.
5. **Re-link app** replaces the secret on save. **Every phone that scanned the
   old QR stops working** and must scan the new one.
6. Switching the method to Gmail, or switching 2-step off, removes the
   authenticator link.
7. A critical credential needs at least one protection step: *"Turn on at least
   one protection step for a critical credential."*

---

## 6. Unlocking with the code

### 6.1 The flow

```
 Open a locked credential
        │
        ▼
 Request access ─── reason (≥10 chars) + window (5/15/30/60 min)
        │            only when the Vault Admin step is on; otherwise 5 min, no reason
        ▼
 Vault Admin approves ─► (forward) ─► Reporting Manager approves      [if those steps are on]
        │
        ▼
 Authenticator step ── "Verify with your authenticator app"
        │                Enter your OTP · 6 digits · Codes refresh every 30 seconds
        ▼
 Unlocked for N min ─► password revealed ─► Lock now, or the window ends ─► locked
```

When the credential has **only** the authenticator step, the modal goes
straight to the code; the request is raised and approved in the same click.

### 6.2 Rules

1. The code must be the one the app shows **now**. A code from the previous or
   next 30 seconds is also accepted, to allow for a phone clock slightly off.
2. **A code works once.** Typing the same code again within its 30 seconds:
   *"That code was just used. Wait for the next code in your authenticator
   app."* This does **not** cost an attempt.
3. **Three wrong codes on one request void it** — *"Too many wrong codes — the
   approvals were reset. Request access again."* Every approval on that
   request is lost, and the credential's owner is notified *"Wrong 2-step
   codes"*.
4. Before that, each wrong code says how many are left: *"Incorrect or expired
   code. 2 attempts left."*
5. **Six wrong codes in 24 hours** by one person on one credential block new
   requests until tomorrow: *"Too many wrong 2-step codes on this credential
   today. Try again tomorrow, or ask the owner to unlock it with you."*
6. A credential whose app was never linked cannot be requested: *"2-step
   verification for this credential has not been linked yet. Ask the owner to
   link it first."*
7. The window cannot exceed the policy's **Maximum unlock window** (default
   1 hour).
8. When the window ends the credential locks on its own; **Lock now** ends it
   early (requester or Vault Admin).

---

## 7. Policy

Credentials Vault → Policies → **Critical** section:

| Policy | Default | Effect on this feature |
|---|---|---|
| **Authenticator OTP** — *Step 3 — a 6-digit code from an authenticator app is needed before reveal.* | On | Off = no credential in the company asks for the code, whatever its own switch says (applies to the email method too) |
| **Maximum unlock window** | 1 hour | Longest window a requester can pick |
| Vault Admin approval / Reporting Manager approval | On | Whether steps 1–2 run before the code |

Turning the policy off does not delete any link; turning it back on re-arms
every linked credential.

---

## 8. What is recorded

| Audit entry | When |
|---|---|
| *Authenticator app linked* (`totp_linked`) | A save that linked or re-linked the app |
| *Access requested for N min — reason* | Request raised |
| *3 wrong 2-step codes — approvals reset* (`otp_failed`) | Third wrong code |
| *Unlocked for N min after all checks passed* | Correct code |
| *Credential locked again* / *Unlock window ended — locked again* | Lock now / window over |

The secret itself is never shown in any list, detail, audit or export.

---

## 9. Business rules QA should never see broken

1. A Critical Vault credential with the step on **cannot be saved** without a
   code that matched its secret.
2. Its password is hidden from **everyone, owner included**, until an unlock.
3. Only the requester can enter the code for their request.
4. A correct code unlocks only after every approval step on that request.
5. The same code cannot unlock twice.
6. The third wrong code voids the request and its approvals.
7. Six wrong codes in a day stop that person raising requests on that credential.
8. A replayed code does not use up an attempt.
9. Re-linking makes the old QR useless.
10. Only the owner or a Vault Admin can change or remove the link.
11. Turning off the company policy removes the step everywhere at once.
12. The unlock ends on its own when the window runs out.
13. My Vault / Team Vault never asks for a code.

---

## 10. Statuses

### The link (on the credential)

| Shown | Meaning |
|---|---|
| **Scan to link** / *Not linked yet* | Step on, no verified app |
| **App linked** | Verified and saved |

### The request (at the code step)

| Status | Shown |
|---|---|
| `approved`, stage `otp` | *Waiting for the authenticator code* / *Approved · enter the authenticator code* |
| `unlocked` | Revealed, with the countdown |
| `locked` — `otp_failed` | *Too many wrong authenticator codes on REQ-… — the approvals were reset* |
| `locked` — `expired` / `manual` | Window over / Lock now |
| `cancelled` | Withdrawn by the requester |

---

## 11. Known behaviours (do not raise as bugs)

| Behaviour | Why |
|---|---|
| A Branch Admin of the credential's branch is never asked for the code | They open it directly, by design |
| The owner or a Vault Admin can re-link, or switch the step off, **without** the current code | Editing a credential needs no unlock. This is what makes a lost phone recoverable — and it means the code protects against everyone *except* those two roles |
| The whole team shares one authenticator entry | The secret belongs to the credential |
| Local dev accepts codes up to two minutes off | Deliberate, for the dev box's shifted clock — production allows 30 seconds |
| Local dev has a `dev/totp` helper that shows live codes | Returns 404 on every server |
| The Unlock modal never shows a QR in production | Linking happens only in the form; the setup pane is a prototype leftover that the live data layer turns off |

---

## 12. Quick troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every code is "incorrect or expired" | Phone clock wrong | Turn on automatic time on the phone; Google Authenticator → *Time correction for codes* |
| Worked yesterday, not today | Someone re-linked the app | Scan the new QR from the owner |
| Nobody else on the team can unlock | Only the owner scanned the QR | Re-link and have everyone scan before saving, or share the setup key |
| "has not been linked yet" | Step on, link never saved (e.g. an old row) | Owner edits the credential and links the app |
| "That code was just used" | Same code typed twice | Wait for the next code |
| "Too many … today" | 6 wrong codes in 24 h | Wait, or the owner / a Vault Admin opens it |
| Lost phone | The authenticator held the only copy | Owner or Vault Admin re-links with a new phone; the old entry is then dead |
