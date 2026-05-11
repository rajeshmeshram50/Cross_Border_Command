# Cross_Border_Command — Email Functionality Overview

> One-stop reference for every email the platform sends: count, triggers, recipients, gating, and edge cases.

---

## At a glance

| # | Mailable | Trigger count | Primary recipient | Master gate | Per-category gate |
|---|---|---|---|---|---|
| 1 | `WelcomeCredentialsMail` | **4 trigger sites** | New user (admin / branch_user / employee) | `emailNotif` | `newUser` |
| 2 | `OnboardingInviteMail` | 1 trigger site | Candidate being onboarded | `emailNotif` | `newUser` |
| 3 | `PasswordResetOtpMail` | 1 trigger site | User who clicked Forgot Password | `emailNotif` | — (transactional) |
| 4 | `PasswordChangedMail` | **4 trigger sites** | User whose password just changed | `emailNotif` | — (transactional) |
| 5 | `PaymentInvoiceMail` | 1 trigger site (3 entry paths) | Client.email + client_admin.email | `emailNotif` | `payAlerts` |
| 6 | `PlanReminderMail` | 1 trigger site | Client.email + client_admin.email | `emailNotif` | `planExp` |
| 7 | `HiringRequestCreatedMail` | 1 trigger site | Creator's reporting manager | `emailNotif` | — (master only) |
| | **TOTAL** | **13 dispatch sites · 7 mailables** | | | |

All mails are dispatched **synchronously** via `Mail::to(...)->send(...)`. Failures are caught and logged (`Log::warning` / `Log::error`) — they NEVER roll back the underlying action that triggered them.

---

## 1. WelcomeCredentialsMail

**Subject**: `Welcome to {appName} — Your Login Credentials`
**Carries**: new user's name, email, **plaintext password**, user_type, org name, login URL.

### Triggered when…

| # | Trigger | File | Recipient | Gate |
|---|---|---|---|---|
| 1.1 | Super admin creates a Client (`POST /api/clients`) | [ClientController.php:232](app/Http/Controllers/Api/ClientController.php#L232) | New client_admin's email | `newUser` |
| 1.2 | Client admin creates a Branch (`POST /api/branches`) | [BranchController.php:250](app/Http/Controllers/Api/BranchController.php#L250) | New branch_user's email | `newUser` |
| 1.3 | HR creates an Employee (`POST /api/employees`) | [EmployeeController.php:374](app/Http/Controllers/Api/EmployeeController.php#L374) | New employee's email | `newUser` |
| 1.4 | Candidate completes onboarding form (`POST /api/onboarding/{token}/complete`) | [OnboardingController.php:255](app/Http/Controllers/Api/OnboardingController.php#L255) | Candidate's email | `newUser` |

### Edge cases
- Plaintext password is captured from the request **before** `Hash::make()` so the mail can echo it.
- If SMTP fails, the user/client/employee row is still saved — only the mail is missed.
- If `Settings → Notifications → New User Registration` is OFF, no welcome mail goes out regardless of who creates whom.

---

## 2. OnboardingInviteMail

**Subject**: New hire onboarding invite (token link)
**Carries**: candidate name, org name, department, target join date, expiry-in-days, token URL.

### Triggered when…

| Trigger | File | Recipient | Gate |
|---|---|---|---|
| Admin issues a self-service onboarding invite (`POST /api/employees/onboarding-invite`) | [OnboardingController.php:102](app/Http/Controllers/Api/OnboardingController.php#L102) | Candidate (`invitee_email`) | `newUser` |

### Edge cases
- Email contains a tokenised URL like `https://app.cbc.com/onboarding/{token}` that takes the candidate to the public form.
- Expiry is configurable (3 / 7 / 15 / 30 days). After expiry the token is rejected with 410.
- Reissuing an invite for the same email creates a new token; the old one is no longer usable.

---

## 3. PasswordResetOtpMail

**Subject**: `Your Password Reset Code — Cross Border Command`
**Carries**: 6-digit OTP, user's name, expiry minutes (10), requested-at timestamp.

### Triggered when…

| Trigger | File | Recipient | Gate |
|---|---|---|---|
| User clicks Forgot Password and submits email (`POST /api/forgot-password/send-otp`) | [ForgotPasswordController.php:89](app/Http/Controllers/Api/ForgotPasswordController.php#L89) | User's email **+ CC to `php@inhpl.com`** | `emailNotif` (master only) |

### Edge cases
- **CC'd to `php@inhpl.com`** — internal monitoring so dev team can see OTPs flowing.
- 120-second **cooldown** between sends (returns 429).
- Maximum 5 failed verify attempts before the OTP is invalidated.
- OTP expires 10 minutes after send.
- If master `emailNotif` is OFF, returns **503** instead of mailing — the user can't recover their password until email is re-enabled.

---

## 4. PasswordChangedMail

**Subject**: `Your Password Was Changed Successfully — {appName}`
**Carries**: user name, email, **plaintext new password** (so the user can recover it from their inbox), timestamp, login URL.

### Triggered when…

| # | Trigger | File | Recipient | Gate |
|---|---|---|---|---|
| 4.1 | Forgot-password OTP flow completes (`POST /api/forgot-password/reset`) | [ForgotPasswordController.php:249](app/Http/Controllers/Api/ForgotPasswordController.php#L249) | User who just reset their password | `emailNotif` |
| 4.2 | Logged-in user changes own password (`POST /api/change-password`) | [AuthController.php:220](app/Http/Controllers/Api/AuthController.php#L220) | Self | `emailNotif` |
| 4.3 | Client admin updates a branch user's password (`PUT /api/branches/{id}` with `user_password`) | [BranchController.php:455](app/Http/Controllers/Api/BranchController.php#L455) | The branch user whose password was rotated | `emailNotif` |
| 4.4 | Super admin updates a client admin's password (`PUT /api/clients/{id}` with `admin_password`) | [ClientController.php:401](app/Http/Controllers/Api/ClientController.php#L401) | The client admin whose password was rotated | `emailNotif` |

### Edge cases
- Mail only fires if a password was **actually changed** (the controllers check `$passwordChanged`). If the admin saves the form without touching the password field, no mail goes out.
- Plaintext password is included — deliberate UX choice matching `WelcomeCredentialsMail`. If your security policy ever forbids this, drop the `$newPassword` field from the mailable and template.

---

## 5. PaymentInvoiceMail

**Subject**: `Payment Invoice #{invoice_number} — Cross Border Command`
**Carries**: invoice data + **PDF attachment** (auto-generated via DomPDF).

### Triggered when…

| # | Trigger | File | Recipient | Gate |
|---|---|---|---|---|
| 5.1 | Super admin manually records a successful payment (`POST /api/payments` with `status=success`) | [PaymentController.php → InvoiceMailer](app/Services/InvoiceMailer.php#L71) | `client.email` + `client_admin.email` (deduped) | `payAlerts` |
| 5.2 | Razorpay payment verified after customer self-checkout (`POST /api/subscription/verify-payment`) | Same `InvoiceMailer` | Same | `payAlerts` |
| 5.3 | Razorpay async webhook (`POST /api/razorpay/webhook`) | Same `InvoiceMailer` | Same | `payAlerts` |

All three paths route through the **`InvoiceMailer` service** (single source of truth — previously only path 5.1 was wired, so customer payments via Razorpay never got invoices; fixed earlier in this codebase).

### Edge cases
- The 1.6 MB PDF attachment is **too large for Mailinator's free public inbox** (~100 KB filter). Test in real Gmail/Outlook.
- If client has no email set, mail is **skipped with a log warning**; PDF still generated on disk.
- If PDF generation fails, the mail body still goes out (without attachment).
- Idempotent — Razorpay webhook firing twice for the same payment doesn't send two mails (status check returns early).

---

## 6. PlanReminderMail

**Subject**: Plan-expiry reminder
**Carries**: plan name, valid_until date, current usage.

### Triggered when…

| Trigger | File | Recipient | Gate |
|---|---|---|---|
| Super admin clicks "Send Reminder" on the Payments page (`POST /api/payments/{id}/send-reminder`) | [PaymentController.php:190](app/Http/Controllers/Api/PaymentController.php#L190) | `client.email` + `client_admin.email` (deduped) | `planExp` |

### Edge cases
- Endpoint is super_admin only.
- Returns **422** if the client has no email; returns **503** if `planExp` toggle is OFF.

---

## 7. HiringRequestCreatedMail *(newly added)*

**Subject**: `New Hiring Request #{HRQ-code} from {creator} — {appName}`
**Carries**: request code, title, role, department, openings, employment type, urgency, target join date, business justification.

### Triggered when…

| Trigger | File | Recipient | Gate |
|---|---|---|---|
| Employee submits a Hiring Request (`POST /api/hiring-requests`) | [HiringRequestController.php:184](app/Http/Controllers/Api/HiringRequestController.php#L184) | Creator's **reporting manager** | `emailNotif` (master only) |

### Edge cases
- Resolution chain: `auth user → Employee.user_id → Employee.reporting_manager_id → Manager Employee → manager.email` (falls back to `manager.user.email`).
- Silently no-ops if:
  - Creator has no Employee row (e.g. a client_admin filed it directly)
  - Creator's Employee has no `reporting_manager_id`
  - Manager has no email anywhere
- SMTP failure is caught and logged; the hiring request itself still saves.

---

## Settings toggles that gate emails

Located in **Settings → Notifications** (super_admin only).

| Toggle | Code | Effect when OFF |
|---|---|---|
| Email Notifications (master) | `emailNotif` | **ZERO emails** dispatched platform-wide — OTP, welcome, invoice, password change, hiring request, all of them |
| Push Notifications | `pushNotif` | Currently no platform-pushed notifications use this; reserved for future use |
| Plan Expiry Alerts | `planExp` | `PlanReminderMail` blocked |
| New User Registration | `newUser` | `WelcomeCredentialsMail` (4 sites) + `OnboardingInviteMail` blocked |
| Payment Alerts | `payAlerts` | `PaymentInvoiceMail` blocked (all 3 paths) |
| Weekly Reports | `weeklyReports` | Reserved — no current implementation |

**Master + category logic** (in `Settings::shouldSendMail()`):
- Master OFF → blocks everything, regardless of category state.
- Master ON + category OFF → blocks that specific category.
- Master ON + category ON → mail flows.
- Transactional sends (OTP, password-changed, hiring request) check **only the master** — they don't have per-category toggles because they're auth-critical.

---

## Mail driver / SMTP

| Setting | Value |
|---|---|
| MAIL_MAILER | `smtp` |
| MAIL_HOST | `smtp.gmail.com` |
| MAIL_PORT | `587` (STARTTLS) |
| MAIL_FROM_ADDRESS | `php@inhpl.com` |
| MAIL_FROM_NAME | `Cross Border Command` |
| Encryption | STARTTLS (Symfony Mailer auto-negotiates on 587) |
| Queue | **Synchronous** — `Mail::to(...)->send(...)` blocks the request (~20s for invoice mail with PDF). Consider queueing via `implements ShouldQueue` if you start hitting web-server timeouts. |

---

## Failure & retry behaviour

| Failure mode | Behaviour |
|---|---|
| SMTP timeout / 5xx | Caught in `try/catch`; logged at WARNING; underlying action (user create, password reset, hiring request submit) still succeeds |
| Recipient address invalid | Same — Mail throws → caught → logged |
| Master `emailNotif` OFF | Mail never attempted; for OTP and PlanReminder the endpoint returns 503 with a clear message |
| Per-category toggle OFF | Mail never attempted (controller skips dispatch entirely) |
| PDF generation fails (invoice only) | Mail body still sent without attachment; error logged |
| Mailinator size limit | Mailinator silently drops >100 KB mails — affects only invoice mails to mailinator addresses (use real Gmail for QA) |

---

## Recipient resolution rules

| Mailable | Resolution |
|---|---|
| `WelcomeCredentialsMail` | The email field from the create request (`admin_email` / `user_email` / `email`) |
| `OnboardingInviteMail` | `invite.invitee_email` |
| `PasswordResetOtpMail` | The email the user typed into Forgot Password + CC to `php@inhpl.com` |
| `PasswordChangedMail` | `user->email` — read post-update so a simultaneous email change goes to the new mailbox |
| `PaymentInvoiceMail` | `client.email` (always) + `client_admin.email` (only if different) — deduped |
| `PlanReminderMail` | Same as PaymentInvoiceMail |
| `HiringRequestCreatedMail` | `manager.email` (preferred) → `manager.user.email` (fallback) |

---

## Diagnostic checklist

When an email isn't arriving:

1. **Check the master switch** — Settings → Notifications → Email Notifications ON?
2. **Check the per-category toggle** — the specific category for that mail type ON?
3. **Tail `storage/logs/laravel.log`** — look for `mail failed` warnings (each dispatch site logs its specific source: "Branch welcome mail failed", "Password-changed confirmation mail failed (client admin update)", etc.)
4. **Check the Gmail "Sent" folder** of `php@inhpl.com` — if it's there, SMTP delivered; the problem is downstream (recipient inbox filtering)
5. **For invoice mails**: check `storage/app/invoices/{invoice_number}.pdf` was generated; if missing, PDF gen failed before mail dispatch
6. **For Mailinator addresses**: 1.6 MB invoice PDFs are silently dropped; use real Gmail
7. **For OTP**: if master is OFF, the endpoint returns 503 — frontend should show "Email is disabled by platform admin"

---

## Email volume estimate (per active user lifecycle)

| Event | Emails sent |
|---|---|
| Tenant signup (client_admin created) | 1 (welcome) |
| Branch added | 1 (welcome to branch user) |
| Employee added via HR | 1 (welcome) |
| Employee added via onboarding | 2 (invite + welcome) |
| User forgot password | 2 (OTP + password-changed confirmation) |
| User self-changes password | 1 (confirmation) |
| Admin rotates user's password | 1 (confirmation to that user) |
| Customer pays for a plan | 1 invoice (with PDF) |
| Admin sends plan reminder | 1 |
| Employee files a hiring request | 1 (to manager) |

For a busy multi-tenant deployment with **50 clients × 5 branches × 20 employees**, expect roughly:
- ~5,000 lifetime emails for setup (welcome + onboarding)
- ~10-50 password change emails / day (active users)
- ~50-200 invoice emails / month (depending on billing cycle)
- ~10-30 hiring request emails / day (depending on hiring volume)

---

**End of email overview.** File location: [docs/EMAIL_OVERVIEW.md](docs/EMAIL_OVERVIEW.md).
