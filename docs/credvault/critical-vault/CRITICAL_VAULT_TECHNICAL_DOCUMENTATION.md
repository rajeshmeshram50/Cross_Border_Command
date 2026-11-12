# CredVault Critical Vault — Technical Documentation

| | |
|---|---|
| **Jira** | GT-108 (parent GT-79 — CredVault Critical Vault Documentation) |
| **Module** | CredVault → Vault Management → Critical Vault |
| **Audience** | Developers, tech leads, code reviewers, QA automation |
| **Companion documents** | Functional Documentation · API Documentation · Code Walkthrough |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document explains how the Critical Vault is built: its layers, files, database tables, models, endpoints, the unlock engine and the rules that decide who may open what. It is written for developers who will maintain or extend the module. For what the user sees, read the Functional Documentation. For every request and response, read the API Documentation.

### 1.2 The design in one paragraph

The Critical Vault is **three thin controllers on top of the shared `CredVaultController`**. `CriticalVaultController` handles the credentials (list, next code, add, edit, bin), `TwoStepController` links the 2-step method in the form before a save, and `AccessRequestController` runs the unlock (raise, approve / reject, forward, cancel, send / verify the code, lock now). Credentials live in the **same table as My Vault**, told apart by `vault = 'critical'`, with their own **CCRD-** code series. A credential stores only **which steps are on**; the **approvers are resolved when a request is raised** — the Vault Admin (Branch User) of the requester's branch and the requester's own reporting manager. The steps are **copied onto the request**, so a later change of protection never changes a request in flight. Access is never stored: the request row is the only thing that opens a secret, and only while its window is live.

### 1.3 Key ideas to understand first

| Idea | What it means in the code |
|---|---|
| `vault` | `normal` or `critical` on `credvault_credentials`. Every Critical Vault route pins `vault = critical` |
| CCRD- | The Critical Vault's code series (`Credential::VAULT_PREFIX['critical']`), separate from My Vault's CRD- |
| Risk level | `low`, `medium`, `high` or `critical` — any level may live in the Critical Vault (default `critical`); it never moves the credential |
| Protection steps | `lock_admin`, `lock_manager`, `lock_otp` on the credential. At least **two** must be on |
| `lockSteps()` | The steps in force, always in the order `admin` → `manager` → `otp` |
| Vault Admin | The **Branch User** (`user_type = branch_user`) of a branch. `adminBranchOf($u)` returns their branch; `branchAdminIds($branch)` lists them |
| `opensDirectly()` | True for the Vault Admin of the credential's branch: no request, no steps |
| Access request | A `credvault_access_requests` row: the steps copied as `*_required`, each stage's status, the window, the code attempts |
| `currentStage()` | The first step of a request that is not done yet — `admin`, `manager`, `otp` or `null` |
| `assertUnlocked()` | The gate in front of every secret: Vault Admin, or a live unlock of this requester, else **423** |
| rank / via | As in the rest of CredVault: `use` < `view` < `copy` < `full`, and why (`owner`, `branch`, `manager`, `hod`, `team`, `branch_critical`, `share`) |

---

## 2. Architecture

### 2.1 Architecture at a glance

The Critical Vault has three layers and one outside service. Each request travels down the table and the answer comes back up.

| Layer | Runs on | What it does | Main pieces | Talks to the next layer through |
|---|---|---|---|---|
| **1 · Browser** | React 19 single-page app | Shows the list, the form, the unlock popup and the drawer; keeps the countdown and polling | `CriticalVault.tsx`, `UnlockModal.tsx`, `CredentialForm.tsx`, `ProtectionSection.tsx`, `ViewDrawer.tsx`, `cvApi.ts` | HTTPS · JSON (multipart when files are attached) · `Authorization: Bearer <Sanctum token>` |
| **2 · API** | Laravel 12 on PHP 8.2 | Checks who the user is, decides what they may see and do, runs the unlock steps, writes the audit trail | Middleware chain, `CriticalVaultController`, `TwoStepController`, `AccessRequestController`, `CredVaultController` (base), `Totp`, `EmailOtp` | Eloquent / SQL · Laravel cache |
| **3 · Data** | PostgreSQL + database cache | Stores credentials (secrets encrypted), requests, shares, audit rows; keeps email codes and replay keys for minutes | `credvault_credentials`, `credvault_access_requests`, `credvault_shares`, `credvault_audit_logs`, `notifications`, `cache` | — |
| **Outside** | SMTP mail server | Delivers the Gmail 6-digit codes | `CredVaultOtpMail` | Called by `EmailOtp` from layer 2 |

### 2.2 Layer 1 — Browser (`resources/js/pages/credvault/`)

| File | Lines | Role |
|---|---|---|
| `critical/CriticalVault.tsx` | 249 | The page: tabs, search, Access Status column, row actions, polling |
| `critical/UnlockModal.tsx` | 890 | The unlock stepper: request → wait → forward → code → reveal |
| `critical/OtpDigits.tsx` | 55 | The six digit boxes |
| `critical/cvData.ts` | 319 | Data source (`CV_DUMMY = false` → live API) |
| `form/CredentialFormModal.tsx` | 131 | Loads the credential for Edit and hosts the form |
| `form/CredentialForm.tsx` | 1,128 | The Add / Edit form, risk level, save |
| `form/ProtectionSection.tsx` | 407 | The 3 protection steps, the authenticator box, the Gmail picker |
| `my-vault/ViewDrawer.tsx` | 561 | Credential details; shows the unlock popup while locked |
| `my-vault/CredentialTable.tsx` | 92 | The shared table, with the extra Access Status column |
| `cvApi.ts` | 419 | Typed API client and response types |

### 2.3 Layer 2 — API (`app/`)

| Piece | Lines | Role |
|---|---|---|
| `routes/api.php` | — | Group `credvault/critical-vault/*` and the shared `credvault/*` routes |
| `CriticalVault\CriticalVaultController` | 123 | List, next code, store, update, destroy, approvers |
| `CriticalVault\TwoStepController` | 127 | Authenticator and Gmail setup, before the save |
| `CriticalVault\AccessRequestController` | 427 | The unlock requests |
| `CredVaultController` (base of all three) | 5,746 | Access rules, save, decide, unlock, sweep, serialisers, audit, notifications, codes |
| `Services\CredVault\Totp` | 99 | Authenticator codes (RFC 6238) |
| `Services\CredVault\EmailOtp` | 185 | Email codes, kept as a hash in the cache |
| `Models\CredVault\Credential`, `AccessRequest` | 443, 95 | The two core models |

### 2.4 Layer 3 — Data

| Table / store | Holds |
|---|---|
| `credvault_credentials` | Every credential; Critical Vault rows have `vault = critical` |
| `credvault_access_requests` | Unlock requests — many per credential, one open per person |
| `credvault_shares` | Shares of a credential |
| `credvault_audit_logs` | Every action, append-only |
| `notifications` | Bell-inbox rows |
| `cache` (database store) | Email-code hashes, authenticator replay keys, send throttles |

### 2.5 The path of one request

What happens, in order, when the browser calls a Critical Vault endpoint:

| # | Where | What happens | When it stops the request |
|---|---|---|---|
| 1 | `cvApi.ts` | Adds the Bearer token, prefixes `/api/credvault` | — |
| 2 | `auth:sanctum` | Finds the user from the token | No / bad token → 401 |
| 3 | `user.active` | Checks the account is still active | Inactive → 401 *Account is no longer active. Please sign in again.* |
| 4 | `tenant` | Binds the user's company | — |
| 5 | `throttle:*` | Counts the call against its rate limit | Over the limit → 429 |
| 6 | `tenantUser()` — the first line of every controller method | Checks the login has a company and the CredVault module permission | No company → 403 *CredVault needs a company account…*; no permission → 403 |
| 7 | Controller | Validates the input | Bad input → 422 (Laravel's `{ message, errors }`) |
| 8 | `sweepUnlocks()` | Locks every window that has ended | — |
| 9 | `findInVault()` / `accessMap()` | Finds the credential inside the company and works out the caller's rank | Out of reach → 404; rank too low → 403 |
| 10 | `assertUnlocked()` | For a secret: the Vault Admin, or a live window of this caller | Locked → 423 |
| 11 | Work + `audit()` | Does the work inside `inTransaction()` and writes the audit row | Conflict → 409; any unexpected failure → logged 500 *Could not ‹action›. Nothing was saved — please try again.* |
| 12 | Response | `{ status, message, data }` back to the browser | — |

### 2.6 What happens when the page loads

| Step | Call | Server work |
|---|---|---|
| 1 | `GET /meta` | Types, risk levels, durations, 2-step methods, the current user |
| 2 | `GET /critical-vault/credentials?tab=all&page=1&per_page=10` | `sweepUnlocks()` → `listCredentials($r, 'critical')` → `visibleQuery($u, true)` → `accessMap()` → `openRequestsFor()` → `row()` per credential |
| 3 | Every 15 s while a row is *Pending* / *In progress* | The same list call, quietly |

### 2.7 What happens on an unlock (Vault Admin + Manager + 2-step)

| Step | Who | Call | Server work |
|---|---|---|---|
| 1 | Requester | `GET /credentials/{id}` | `detail()` with `unlock_plan` (steps, approvers, durations) |
| 2 | Requester | `POST /critical-vault/credentials/{id}/access-requests` | Validate → resolve the Vault Admin and the manager → create `REQ-` → audit → notify the Vault Admin |
| 3 | Vault Admin | `POST /critical-vault/access-requests/{id}/approve` | `decide()` → `admin_status = approved` → tell the requester to forward |
| 4 | Requester | `POST …/raise-manager` | `manager_status = pending` → notify the manager |
| 5 | Manager | `POST …/approve` | `decide()` → `status = approved` (code next) |
| 6 | Requester | `POST …/send-otp` (Gmail only) | Mail a code; its hash is kept 10 minutes |
| 7 | Requester | `POST …/verify-otp` | Check the code → `unlock()` → `status = unlocked`, `expires_at = now + window` |
| 8 | Requester | `POST /credentials/{id}/reveal` | `assertUnlocked()` → return one value, audit, notify the owner |
| 9 | — | Any later call | `sweepUnlocks()` locks the window once it has ended |

---

## 3. Tech Stack

### 3.1 Frontend

| Technology | Version | Used for |
|---|---|---|
| React | 19.2 | The page, the form, the popups |
| TypeScript | 6.0 | Typed components and the typed API client (`cvApi.ts`) |
| Vite | 7.0 | Build and dev server; output in `public/build/` |
| React Router | 7.14 | The route `/credentials-vault/critical-vault` and `?action=add` |
| Axios | 1.11 | HTTP calls; adds the Bearer token |
| `qrcode` (npm) | 1.5 | Draws the authenticator QR code in the browser from `otpauth_uri` |
| Bootstrap · reactstrap | 5.3 · 9.2 | The Velzon admin theme the page sits in |
| Page CSS | — | `unlock.css` and the shared CredVault styles |

### 3.2 Backend

| Technology | Version | Used for |
|---|---|---|
| PHP | 8.2+ | Runtime |
| Laravel | 12 | Routing, validation, Eloquent, transactions, cache, mail |
| Laravel Sanctum | 4 | Bearer-token authentication |
| Eloquent `encrypted` casts | — | `secret`, `notes`, `totp_secret` encrypted; `fields` as `encrypted:array` |
| HMAC-SHA256 under `app.key` | — | `secret_hash`, to find a reused password without decrypting |
| `Totp` service | — | RFC 6238 authenticator codes: SHA-1, 6 digits, 30-second steps, issuer **Kryptone**; accepts ±1 step of clock drift (±4 in `local`); a used step is claimed in the cache for 3 minutes so a code works once |
| `EmailOtp` service | — | 6-digit email codes; only a keyed hash is cached, for 10 minutes |
| Laravel rate limiters | — | `credvault` 240/min, `credvault-otp` 10/min, `credvault-reveal` 60/min |

### 3.3 Data and infrastructure

| Technology | Used for |
|---|---|
| PostgreSQL | All tables; CHECK constraints for the allowed values; a partial unique index for one open request |
| Laravel cache (database store) | Email-code hashes, authenticator replay keys, email send throttles |
| Row locks (`lockForUpdate()`) | The request row while it is decided, forwarded, verified or locked; the `clients` row while a CCRD- / REQ- code is allocated |
| SMTP mail | Sending the Gmail codes, branded per company by `BrandingResolver` |
| Bell notifications | Rows inserted into `notifications` |

---

## 4. Database Schema

### 4.1 `credvault_credentials` — Critical Vault rows

| Group | Columns |
|---|---|
| Tenancy | `client_id` (indexed), `branch_id` nullable (indexed) — from the creator's branch |
| Identity | `code` string(20) **CCRD-nnnn**, `vault` = `critical`, `type` string(20), `category_group` string(40), `name` string(150) |
| Ownership | `scope` `personal` \| `team`, `owner_id` (indexed), `department_id` nullable |
| Display | `url` string(500), `username` string(191) |
| Secrets (encrypted, hidden) | `secret`, `fields` (JSON), `notes`, `totp_secret` |
| Fingerprint | `secret_hash` string(64), indexed, hidden |
| Files | `attachments` json `[{key, name, size, mime, path, at}]` |
| Health | `risk` `low` \| `medium` \| `high` \| `critical`, `strength` 0..4, `has_password`, `twofa` `yes` \| `no` \| `na`, `rotation_days`, `password_changed_at` |
| **Protection** | `lock_admin`, `lock_manager`, `lock_otp` (bool) — at least two `true`; on create all three default to `true`. `lock_admin_user_id`, `lock_manager_user_id` (nullable) — every save writes `null`, but `requestAccess()`, `protectionChange()` and `detail().protection` still read them |
| **2-step link** | `twofa_method` `google` \| `email`, `twofa_email` string(191), `twofa_linked_at`, `totp_linked_at` |
| Audit | `created_by`, `updated_by`, `deleted_by`, timestamps, **soft deletes** (`deleted_at` = in the Recycle Bin) |

**Indexes:** `unique(client_id, code)`; `(client_id, risk)`; `(client_id, scope, department_id)`; `(client_id, updated_at)`; `(client_id, deleted_at)`; `(client_id, vault)`.

**PostgreSQL CHECK constraints:**

| Constraint | Rule |
|---|---|
| `credvault_cred_scope_check` | `scope in ('personal','team')` |
| `credvault_cred_risk_check` | `risk in ('low','medium','high','critical')` |
| `credvault_cred_twofa_check` | `twofa in ('yes','no','na')` |
| `credvault_cred_strength_check` | `strength between 0 and 4` |
| `credvault_cred_vault_check` | `vault in ('normal','critical')` |
| `credvault_cred_twofa_method_check` | `twofa_method is null or in ('google','email')` |
| `credvault_cred_vault_risk_check` | `vault = 'critical' or risk <> 'critical'` — a Critical Vault row may be **any** risk; a Critical risk may live only in the Critical Vault (relaxed on 12 Nov 2026) |

### 4.2 `credvault_access_requests`

| Group | Columns |
|---|---|
| Tenancy / id | `client_id` (indexed), `code` string(20) **REQ-nnnn** per client |
| Links | `credential_id` (indexed), `requester_id` (indexed) |
| Ask | `reason` string(300) nullable, `duration_minutes` smallint |
| Vault Admin stage | `admin_required`, `admin_user_id` (indexed), `admin_status`, `admin_decided_by`, `admin_decided_at`, `admin_note` string(300) |
| Manager stage | `manager_required`, `manager_user_id` (indexed), `manager_status`, `manager_decided_by`, `manager_decided_at`, `manager_note` string(300) |
| Code stage | `otp_required`, `otp_verified_at`, `otp_attempts` tinyint default 0 |
| Life | `status` default `pending`, `unlocked_at`, `expires_at`, `locked_at`, `locked_reason` `manual` \| `expired` \| `otp_failed` |
| Audit | timestamps — **no soft deletes** |

**Indexes:** `unique(client_id, code)`; `(client_id, status)`; plus the single-column indexes above.

| PostgreSQL object | Definition |
|---|---|
| `credvault_req_status_check` | `status in ('pending','approved','unlocked','locked','rejected','cancelled')` |
| `uq_credvault_req_open` | Partial unique index on `(credential_id, requester_id) where status in ('pending','approved','unlocked')` — one open request per person per credential; it is what stops a double click raising two requests |

> **Explanation: `manager_status` starts as `null`.** With a Vault Admin step, `manager_status` stays `null` until the requester forwards the request (`raise-manager`), and only then becomes `pending`. Without a Vault Admin step it is `pending` from the start. `unlockState()` reads that `null` as *needs_forward*.

### 4.3 Migrations

All in `database/migrations/credvault/`, loaded by `AppServiceProvider::boot()`.

| Migration | What it adds |
|---|---|
| `2026_10_30_000001` | `credvault_credentials` with the protection columns and 4 CHECKs |
| `2026_10_30_000002` | `credvault_shares` |
| `2026_10_30_000003` | `credvault_access_requests`, the status CHECK and `uq_credvault_req_open` |
| `2026_10_30_000005` | `credvault_audit_logs` |
| `2026_11_03_000001` | `vault`, `twofa_method`, `twofa_email`, `twofa_linked_at`; the `(client_id, vault)` index; moves `risk = critical` rows into the Critical Vault and re-codes them `CCRD-` (also rewriting `credential_code` in the audit logs); clears the locks, `totp_secret` and `totp_linked_at` on normal rows; the vault and 2-step method CHECKs |
| `2026_11_04_000001` | Recomputes `strength` |
| `2026_11_12_000001` | Relaxes `credvault_cred_vault_risk_check` so the Critical Vault can hold Low, Medium and High credentials |

---

## 5. Models

### 5.1 `Credential` (`app/Models/CredVault/Credential.php`, 443 lines)

| Item | Value |
|---|---|
| Constants | `VAULTS`, `VAULT_PREFIX` (`CRD` / `CCRD`), `TWOFA_METHODS` (`google`, `email`), `TYPES` (25 types), `RISKS`, `SCOPES` |
| Hidden | `secret`, `secret_hash`, `fields`, `notes`, `totp_secret` |
| `lockSteps()` | `[]` outside the Critical Vault; otherwise the subset of `admin`, `manager`, `otp` whose switch is on, in that fixed order |
| `isCriticalVault()` | `vault === 'critical'` |
| `isProtected()` | `lockSteps() !== []` |
| `twoStepLinked()` | `google` → `totp_linked_at` set; `email` → `twofa_linked_at` set and `twofa_email` filled |
| `maskEmail()` | First two characters + `•••@` + domain |
| `hasTwofaSwitch($type)` | True for types with their own 2FA switch (Login, Email, Passkey, Bank Account, Crypto Wallet, Password); on those the switch **is** step 3 |
| `criticalCode()` | The CCRD- code shown in the list |
| Relations | `owner`, `department`, `shares`, `accessRequests` |

### 5.2 `AccessRequest` (`app/Models/CredVault/AccessRequest.php`, 95 lines)

| Item | Value |
|---|---|
| `OPEN` | `pending`, `approved`, `unlocked` |
| `STATUSES` | `pending`, `approved`, `unlocked`, `locked`, `rejected`, `cancelled` |
| `DURATIONS` | 5, 15, 30, 60 |
| `MAX_OTP_ATTEMPTS` | 3 |
| `DEFAULT_MINUTES` | 5 — the window when there is no Vault Admin step |
| `currentStage()` | `admin` until `admin_status = approved`; then `manager` until `manager_status = approved`; then `otp` until `otp_verified_at`; `null` for any status but `pending` / `approved` |
| `isLive()` | `status = unlocked` and `expires_at` in the future |
| Relations | `credential` (with trashed), `requester`, `adminUser`, `managerUser`, `adminDecider`, `managerDecider` |

### 5.3 `AuditLog` and `CredentialShare`

| Model | What matters here |
|---|---|
| `AuditLog` | Append-only (`UPDATED_AT = null`). `RAISE_ON_CRITICAL` = `reveal`, `copy`, `share` — logged at `critical` severity on a Critical Vault credential |
| `CredentialShare` | `PERMISSIONS` `use` < `view` < `copy` < `full`; `live()` scope; `rank()` maps a permission to `RANK_*` |

---

## 6. API Surface

All under `/api/credvault`. Full payloads are in the API Documentation.

### 6.1 Credentials and 2-step setup — 10 routes

| # | Method | Endpoint | Controller method |
|---|---|---|---|
| 1 | GET | `/critical-vault/credentials` | `index` → `listCredentials(…, 'critical')` |
| 2 | GET | `/critical-vault/credentials/next-code` | `nextCredentialCode` (declared before `/{id}`) |
| 3 | POST | `/critical-vault/credentials` | `store` → `persistCredential(…, 'critical')` |
| 4 | PUT / POST | `/critical-vault/credentials/{id}` | `update` (POST because PHP reads no multipart PUT) |
| 5 | DELETE | `/critical-vault/credentials/{id}` | `destroy` → `binCredential` |
| 6 | GET | `/critical-vault/approvers` | `approvers` |
| 7 | POST | `/critical-vault/two-step/google/new` | `googleNew` |
| 8 | POST | `/critical-vault/two-step/google/verify` | `googleVerify` · `throttle:credvault-otp` |
| 9 | POST | `/critical-vault/two-step/email/send` | `emailSend` |
| 10 | POST | `/critical-vault/two-step/email/verify` | `emailVerify` · `throttle:credvault-otp` |

### 6.2 The unlock — 10 routes

| # | Method | Endpoint | Controller method |
|---|---|---|---|
| 1 | POST | `/critical-vault/credentials/{id}/access-requests` | `requestAccess` |
| 2 | GET | `/critical-vault/access-requests` | `accessRequests` |
| 3 | GET | `/critical-vault/access-requests/{id}` | `accessRequest` |
| 4 | POST | `/critical-vault/access-requests/{id}/approve` | `approveRequest` → `decide()` |
| 5 | POST | `/critical-vault/access-requests/{id}/reject` | `rejectRequest` → `decide()` |
| 6 | POST | `/critical-vault/access-requests/{id}/raise-manager` | `raiseManager` |
| 7 | POST | `/critical-vault/access-requests/{id}/cancel` | `cancelRequest` |
| 8 | POST | `/critical-vault/access-requests/{id}/send-otp` | `sendOtp` |
| 9 | POST | `/critical-vault/access-requests/{id}/verify-otp` | `verifyOtp` · `throttle:credvault-otp` |
| 10 | POST | `/critical-vault/access-requests/{id}/lock` | `lockRequest` |

### 6.3 Shared endpoints the page depends on

| Method | Endpoint | Used for |
|---|---|---|
| GET | `/meta` | Types, risk levels, durations, 2-step methods, the current user |
| GET | `/credentials/{id}` | The View drawer and the unlock popup (`detail()` + `unlock_plan`) |
| POST | `/credentials/{id}/reveal` | Reveal or copy one secret — audited at critical severity, owner notified — `throttle:credvault-reveal` |
| POST | `/credentials/{id}/events` | Drawer opened, Launch, a plain field copied |
| GET | `/credentials/{id}/activity` | The drawer's Activity tab |
| GET | `/credentials/{id}/attachments/{key}` | Open an attachment (needs the unlock) |
| GET / POST | `/share-recipients`, `/credentials/{id}/shares` | Share from the drawer |

### 6.4 Rate limiters (`AppServiceProvider::boot`)

| Name | Limit | Key | Applied to |
|---|---|---|---|
| `credvault` | 240 / minute | `cv:<user id or IP>` | The whole `credvault` prefix |
| `credvault-otp` | 10 / minute | `cv-otp:<user id or IP>` | `google/verify`, `email/verify`, `verify-otp` |
| `credvault-reveal` | 60 / minute | `cv-reveal:<user id or IP>` | `/credentials/{id}/reveal` |

Each name has its own bucket, so ordinary list calls never use up the code allowance.

---

## 7. How Access Is Decided

### 7.1 Who sees a row — `visibleQuery($u, true)`

A Critical Vault row is listed when **any** line is true:

| # | Condition | Who it covers |
|---|---|---|
| 1 | `owner_id = me` | The owner |
| 2 | `id in sharedWithMeIds(me)` | A live share to me or my department |
| 3 | `vault = critical` and `branch_id = my branch` | **Everyone in the branch** — the Critical Vault's branch-wide rule |
| 4 | `owner_id in overseenUserIds(me)` | People I am above: my downline in HR; for the Vault Admin, the non-admin people of their branch; for an HOD, the people of the departments they head |
| 5 | Team scope, owner is a non-admin of my branch | The Vault Admin (Branch User) |
| 6 | Team scope, department I head | The HOD |
| 7 | Team scope, owner in my downline | A manager |

### 7.2 How much — `accessMap()`

The first rule that matches wins; a live share replaces it only when its rank is higher.

| # | Rule | `[rank, via]` |
|---|---|---|
| 1 | I own it | `[full, owner]` |
| 2 | Team scope; I am the Vault Admin of the owner's or the credential's branch; the owner is not an admin login | `[full, branch]` |
| 3 | Team scope; the owner is in my downline | `[full, manager]` |
| 4 | Team scope in a department I head; the owner is below me | `[full, hod]` |
| 5 | Team scope in a department I head; the owner is not below me | `[copy, team]` |
| 6 | A Critical Vault credential of my branch | `[view, branch_critical]` |
| 7 | A live share to me or my department | `[share rank, share]` if higher |

> **Explanation: rank is not the unlock.** `accessMap()` decides what a person may do **once the credential is open**. Whether it is open is a separate check, `assertUnlocked()` (7.4). A Full-rank owner still needs an unlocked request; a View-rank branch colleague may unlock and reveal, but not copy.

### 7.3 The Vault Admin — `adminBranchOf()`, `opensDirectly()`, `branchAdminIds()`

| Helper | What it does |
|---|---|
| `adminBranchOf($u)` | The branch of a `branch_user` with a `branch_id`, else `null` |
| `opensDirectly($u, $c)` | True when the credential's `branch_id` — or its owner's branch — is `adminBranchOf($u)` |
| `branchAdminIds($branch, $client)` | Active `branch_user` logins of that branch, ordered by id, memoised |
| `canApproveAdmin($u, $r)` | When the request names a Vault Admin (`admin_user_id`), **only that person**. Only on a request with no named admin may any Vault Admin of the request's branch decide (`requestBranch()` = the requester's branch, else the credential's). `requestAccess()` always names one — the first of the pool — so in practice one person decides |

`row()` sends `unlock: { state: 'open', label: 'Open — Vault Admin' }` with **no** `request_id` for a direct opener; the page reads "open with no request" as the Vault Admin case.

### 7.4 The gate — `assertUnlocked($c, $u)`

| Case | Result |
|---|---|
| The credential has no steps (not protected) | Pass |
| `opensDirectly($u, $c)` | Pass |
| `unlockedFor($c, $u)` — a request of **this** requester with `status = unlocked` and `expires_at > now` | Pass |
| Anything else | **423** `{ code: 'locked', message: 'This credential is locked. Request access and complete every unlock step first.' }` |

It runs in `reveal()` and `attachment()`. `detail()` applies the same rule **inline** (`$open = no steps || opensDirectly() || a live request`): while locked it returns the summary and the unlock plan only; while open it returns every stored value **in plain text** (`fields[].value`, `recovery`, `all_values`) for View rank or higher.

> **Known problem — security.** Because `GET /credentials/{id}` returns plain values once open, the unlock popup and the View drawer show and copy secrets without calling `/reveal`. Those views write no `reveal` / `copy` audit row, do not clear the clipboard after 30 s and do not notify the owner; a View-rank viewer can copy. Only the drawer's separate `POST /events {action: view}` is recorded. Fix: return secrets masked from `detail()` for Critical Vault credentials and make both views reveal through `/reveal`.

> **Common misunderstanding.** "The owner can always open their own credential." There is no owner branch in `assertUnlocked()`: the owner raises a request like anyone else. Only `opensDirectly()` skips the steps.

---

## 8. The Unlock Engine

### 8.1 `requestAccess()` — raising a request

| Step | Check / work | Refusal |
|---|---|---|
| 0 | Validate `reason` ≤ 300 and `duration_minutes` ∈ 5 / 15 / 30 / 60 — before anything else | 422 (Laravel's message) |
| 1 | `sweepUnlocks()`; `findInVault(…, 'critical', RANK_VIEW)` | 403 *Your access is Use Only — there is nothing for you to unlock on this credential.* |
| 2 | `opensDirectly()` | 409 *You are the Vault Admin for this branch — open this credential directly.* |
| 3 | `$steps = $c->lockSteps()` — **copied** into `admin_required`, `manager_required`, `otp_required` | — |
| 4 | With the Vault Admin step: reason ≥ 10 characters and a `duration_minutes` in `DURATIONS`; without it the window is `DEFAULT_MINUTES` (5) | 422 on `reason` / `duration_minutes` |
| 5 | Daily cap: `sum(otp_attempts)` of this person's requests for this credential created in the last 24 h ≥ `OTP_DAILY_LIMIT` (6) | 429 |
| 6 | 2-step step on and `twoStepLinked()` false | 409 |
| 7 | Vault Admin pool = `branchAdminIds(requester's branch) − requester`; empty → refused; `admin_user_id` = the first of the pool | 409 *Your branch has no Branch Admin (Vault Admin)…* |
| 8 | Manager = `managerOf($u)`; empty or the requester → refused | 409 *You have no reporting manager…* |
| 9 | An open request of this person for this credential | 409 with that request in `data` |
| 10 | In a transaction: create `REQ-nnnn`; `status = pending` (or `approved` when there is no approval step); audit `request`; `notifyStage()` | A race on `uq_credvault_req_open` → 409 |

### 8.2 `decide()` — approve or reject

| Step | Rule |
|---|---|
| 1 | `findRequest(…, lock: true)` inside a transaction; `status` must be `pending` |
| 2 | The requester may never decide (403 *You cannot decide your own request.*) |
| 3 | Stage `admin`: `canApproveAdmin()`; stage `manager`: `manager_status` must be `pending` (forwarded) and the caller must be `manager_user_id` |
| 4 | Fill `{stage}_status`, `{stage}_decided_by`, `{stage}_decided_at`, `{stage}_note` |
| 5 | Reject → `status = rejected`, audit, notify the requester (note defaults to *Not approved at this time*) |
| 6 | Approve → audit; next stage `null` → `unlock()`; next `otp` → `status = approved`; next `manager` → notify the **requester** to forward |

> **Explanation: one person, two approvals.** When the requester's reporting manager is also the Vault Admin, the same person approves both stages. The source records this as deliberate: two separate, audited actions, not two people.

### 8.3 `raiseManager()` — the forward

Only the requester; `status = pending`; the request has a manager step; the Vault Admin stage is approved; `manager_status` is still `null`. Then `manager_status = pending`, audit `forward_mgr` (module *Access Requests*) and `notifyStage()` — which now notifies the manager.

### 8.4 The code — `sendOtp()` and `verifyOtp()`

| Item | `sendOtp()` (Gmail only) | `verifyOtp()` |
|---|---|---|
| Who | The requester | The requester |
| State | `status = approved` and `currentStage() = otp` | Same |
| Work | `EmailOtp::sendUnlock()` — 6 digits, hash in the cache for 10 min, one send per 30 s per request, 10 per hour per person | Authenticator: `Totp::matchStep()`, then `Cache::add("credvault:totp-used:{cred}:{step}")` so a code works once. Gmail: `EmailOtp::checkUnlock()`, deleted on match |
| Wrong code | — | `otp_attempts++`; at 3 → `status = locked`, `locked_reason = otp_failed`, email code forgotten, owner notified |
| Right code | — | `otp_verified_at = now` → `unlock()` |

> **Explanation: the error is thrown after the commit.** A wrong code returns 422 (*n attempts left*) or 423 (*approvals reset*) **after** the transaction has saved `otp_attempts`. Throwing inside the transaction would roll the counter back and give unlimited tries.

> **Worth testing.** A replayed authenticator code and an email code that was never sent are refused **without** costing a try.

### 8.5 `unlock()`, `sweepUnlocks()`, `lockRequest()`

| Function | Work |
|---|---|
| `unlock($r, $actor)` | `status = unlocked`, `unlocked_at = now`, `expires_at = now + duration_minutes`; audit `unlock` |
| `sweepUnlocks($clientId)` | Once per HTTP request (memoised): every `unlocked` row with `expires_at <= now` → `locked`, `locked_reason = expired`; audit *Unlock window ended — locked again* |
| `lockRequest()` | The requester or the Vault Admin; `status` must be `unlocked`; → `locked`, `locked_reason = manual` |
| `cancelRequest()` | The requester; `status` `pending` or `approved`; → `cancelled`; the email code is forgotten |

> **Explanation: there is no scheduler.** Windows end lazily: `sweepUnlocks()` runs at the top of the list, show, reveal and request endpoints. Even before the sweep, `assertUnlocked()` checks `expires_at > now`, so an ended window never returns a secret.

### 8.6 `unlockPlan()` and `unlockState()`

| Function | Returns |
|---|---|
| `unlockPlan($c, $u, $steps)` | One entry per step with its approver (the requester's Vault Admin, or *Any Vault Admin*; the requester's manager), `durations` (5, 15, 30, 60), `asks_reason`, `default_minutes` (15 with a Vault Admin step, else 5), `otp_method`, the masked `otp_sent_to` |
| `unlockState($r, $steps)` | The Access Status cell: `open` (with `seconds_left`, `total_seconds`), `pending` (with `waiting_for`, `needs_forward`), `progress` (the code step), or `locked` |

---

### 8.7 Who can reach a request — `findRequest()` and the request list

| Function | Rule |
|---|---|
| `findRequest($u, $id, $lock)` | Inside the company; visible to the requester, the named Vault Admin, the named manager, or anyone `canApproveAdmin()` allows — anyone else gets **404** *Access request not found.* With `$lock` it takes `lockForUpdate()` (decide, forward, cancel, verify, lock) |
| `accessRequests()` | The Vault Admin sees every request raised by a person of their branch; everyone else the requests they raised or that name them. Tabs `all`, `pending`, `approved` (approved / unlocked / locked except `otp_failed`), `rejected`, `mine`, `to_me`. The tab counts ignore the search; the list follows it |

---

## 9. Saving a Credential — `persistCredential(…, 'critical')`

| Step | Rule |
|---|---|
| 1 | Validate the type's fields; refuse a type change on edit |
| 2 | Duplicate name per owner + type — across **both** vaults (the message still says *in this vault*) |
| 3 | Risk: `low`, `medium`, `high` or `critical`, default `critical`; the credential stays `vault = critical` |
| 4 | Protection: `lock_admin`, `lock_manager`, `lock_otp`; on a type with its own 2FA switch, `lock_otp` follows that switch. **Fewer than two on → 422** *Turn on at least two protection steps for a critical credential.* |
| 5 | `twoStepLink()` — Authenticator: a fresh `totp_secret` with a matching `totp_code`; Gmail: an `email_otp_token` verified for the same inbox — unless the same method is already linked |
| 6 | In a transaction: CCRD- code from `nextCode()` (locks the `clients` row and also reads purged codes from the audit log, so a CCRD- number is never reused), save, consume the email token, audit `create` / `edit` (and `totp_linked`) |

### 9.1 Edit — `update()` and `protectionChange()`

`findInVault(…, RANK_FULL)`. When the caller is not the owner or the Vault Admin, `protectionChange()` names the first guarded thing the edit would change, and the save is refused with 403 *Only the owner or a Vault Admin can change the ‹what›.*

| ‹what› | Request field |
|---|---|
| 2-step verification | `totp_secret`, `totp_code`, `email_otp_token` |
| 2-step method / 2-step email | `twofa_method`, `twofa_email` |
| risk level | `risk` |
| two-factor setting | `twofa`, `fields.twofa` |
| vault / team | `scope`, `department_id` |
| protection steps | `lock_admin`, `lock_manager`, `lock_otp` |
| approvers | `lock_admin_user_id`, `lock_manager_user_id` |

### 9.2 Bin — `binCredential()`

Full Access and `via` = `owner` or `branch` (the Vault Admin), else 403. Then `deleted_by`, soft delete, **every open request on the credential → `cancelled`**, audit `bin`. The message gives the branch's retention days.

### 9.3 2-step setup — `TwoStepController`

| Method | Notes |
|---|---|
| `googleNew` | New 32-character base32 secret and an `otpauth://` URI with issuer **Kryptone** |
| `googleVerify` | `secret` must match `^[A-Z2-7]{16,128}$`; checks one code; stores nothing |
| `emailSend` | Sends a setup code; returns a 40-character token |
| `emailVerify` | 5 tries per code; a match marks the token verified for the save |

---

## 10. Frontend

### 10.1 Files

| File | Role |
|---|---|
| `critical/CriticalVault.tsx` | Tabs `all` / `mine` / `team` (API `others`), search, `AccessCell`, `lockAction()`, polling, overlays |
| `critical/UnlockModal.tsx` | The stepper built from `unlock_plan.steps` + a final Reveal; request card, waiting card, forward, code pane, reveal pane with the ring timer |
| `critical/OtpDigits.tsx` | Six inputs: auto-advance, Backspace, arrows, paste, Enter |
| `critical/cvData.ts` | `cvData = CV_DUMMY ? dummy : live`; `CV_DUMMY = false` |
| `form/ProtectionSection.tsx` | `ProtectionBody` (3 steps), `AuthBox` (QR, key, verify), `TwofaPicker` (app or Gmail) |
| `form/CredentialForm.tsx` | Risk level, fields, protection, save to `/critical-vault/credentials` |
| `my-vault/ViewDrawer.tsx` | Renders `UnlockModal` while `locked` |

### 10.2 Behaviour worth knowing

| Behaviour | Where |
|---|---|
| A response from an older load is dropped (`seq.current` in `CriticalVault.tsx`, `loadSeq.current` in `UnlockModal.tsx`) | Both |
| 15-second poll while a row is pending / in progress, paused while a popup is open | `CriticalVault.tsx` |
| Countdown = `seconds_left` minus the time since the fetch; never counts up past the server's figure | `CriticalVault.tsx` `leftOf` |
| At zero the row reads *Locked* and the list reloads (up to 4 tries) | `CriticalVault.tsx` `expired` effect |
| The popup polls `show()` every 15 s while `unlock.state = pending` | `UnlockModal.tsx` |
| The window end is fixed once in the browser, so a fresh grant shows its full length | `UnlockModal.tsx` `winRef` |
| The first Gmail code is sent automatically when the code stage opens | `UnlockModal.tsx` effect on `cur === 'otp'` |
| A revealed value hides after `hide_after_seconds`; a copy passes `clear_clipboard_after` | `UnlockModal.tsx`, `ViewDrawer.tsx` |
| A 423 from reveal reloads the credential (it locked meanwhile) | Both |
| `onPending()` marks the row *Pending* at once, before the list refresh lands | `CriticalVault.tsx` ↔ `UnlockModal.tsx` |

---

## 11. Integrations

### 11.1 Email

`EmailOtp::mail()` refuses with **503** when platform email is off (*Email is turned off by the platform admin…*) and **502** when the send throws (logged as *CredVault: email 2-step code not sent*). The mail is `CredVaultOtpMail`, branded per tenant by `BrandingResolver::forUser()`.

### 11.2 Notifications (bell inbox)

| Kind | Sent to | When |
|---|---|---|
| `access_request` | The Vault Admin named on the request (the requester's branch) | Request raised with a Vault Admin step |
| `access_request` | The requester's manager | Forwarded, or raised without a Vault Admin step |
| `access_approved` | The requester | Each approval |
| `access_rejected` | The requester | A rejection |
| `otp_failed` | The owner (if not the requester) | The 3rd wrong code |
| `critical_revealed` | The owner (if not the viewer) | A reveal or copy |

### 11.3 Audit log

| Action | Written by | Module |
|---|---|---|
| `create`, `edit`, `totp_linked` | `persistCredential` | Critical Vault |
| `request` | `requestAccess` | Critical Vault |
| `approve`, `reject` | `decide` | Access Requests |
| `forward_mgr` | `raiseManager` | Access Requests |
| `cancel`, `otp_sent`, `otp_failed`, `unlock`, `lock` | The unlock methods, `unlock()`, `sweepUnlocks()` | Critical Vault |
| `reveal`, `copy` | `reveal` — severity raised to `critical` | Critical Vault |
| `bin` | `binCredential` | Critical Vault |

---

## 12. Security

| Area | Guarantee |
|---|---|
| Tenant isolation | Every query is scoped to `$u->client_id`; a credential or request out of reach reads as **404** |
| Module gate | `tenantUser()` — `can_view` on the `credentials-vault` module, else 403 |
| Secrets | Hidden from `toArray()`. Plain values leave through `/reveal` (audited, owner notified) **and** through `GET /credentials/{id}` while open (not audited as a reveal — see the security Known problem in 7.4) |
| Local test helper | `GET /credvault/dev/totp` returns the live authenticator codes of the company's credentials; it answers 404 unless `APP_ENV=local`. It bypasses 2-step and must never be enabled outside local |
| Critical sharing | A Critical Vault credential cannot be shared with Full Access and needs an end date; a share is logged at critical severity |
| Owner not exempt | `assertUnlocked()` has no owner shortcut |
| Vault Admin | `opensDirectly()` skips the steps by role, for their own branch; copy still needs Copy rank |
| Self-approval | `decide()` refuses the requester; the Vault Admin pool removes the requester |
| Replay | Authenticator step claimed atomically in the cache; email code deleted on match |
| Brute force | 3 wrong codes per request; 6 per credential per rolling 24 h; 10 verify calls per minute; 5 setup-code tries |
| One open request | Pre-check **and** the partial unique index `uq_credvault_req_open` |
| Steps in flight | Copied onto the request; a later protection change cannot weaken it |
| Backups | A CredVault backup never contains Critical Vault credentials (`isCriticalVault()` is filtered out) |

---

## 13. Business Rules in the Code

| ID | Rule | Where it is kept |
|---|---|---|
| BR-01 | Every Critical Vault credential is `vault = critical` with a CCRD- code, at any risk level | `persistCredential()`, `nextCode()` |
| BR-02 | At least two protection steps | `persistCredential()`, `CredentialForm.tsx` |
| BR-03 | The steps run `admin` → `manager` → `otp` | `lockSteps()`, `currentStage()` |
| BR-04 | The steps are copied onto the request | `requestAccess()` → `*_required` |
| BR-05 | A secret only through the Vault Admin or a live window | `assertUnlocked()` |
| BR-06 | Nobody decides their own request | `decide()`, the admin pool |
| BR-07 | The Vault Admin step belongs to the requester's branch | `requestAccess()`, `canApproveAdmin()` |
| BR-08 | The manager acts only after the forward | `decide()`, `raiseManager()` |
| BR-09 | One open request per person per credential | `uq_credvault_req_open`, `requestAccess()` |
| BR-10 | 3 wrong codes reset the request; 6 per day block new ones | `verifyOtp()`, `requestAccess()` |
| BR-11 | Windows end even without a sweep | `assertUnlocked()` reads `expires_at` |
| BR-12 | Only the owner, or the Vault Admin on a team credential of their branch (`via = branch`), change protection or bin it | `update()` + `protectionChange()`, `binCredential()` |
| BR-13 | Binning cancels open requests | `binCredential()` |

---

## 14. Metrics

| Metric | Value |
|---|---|
| Controllers | 3 Critical Vault controllers (677 lines) on the 5,746-line base |
| Services | 2 (`Totp`, `EmailOtp`) |
| API routes | 20 under `critical-vault/*` (10 credential + 2-step, 10 unlock) + the shared ones |
| Rate limiters | 3 (`credvault` 240/min, `credvault-otp` 10/min, `credvault-reveal` 60/min) |
| Core tables | 2 (`credvault_credentials`, `credvault_access_requests`) + shares and audit logs |
| Request statuses | 6 |
| Frontend | 10 files in 2.2, plus `unlock.css` (575 lines) |
| Dummy data switch | `CV_DUMMY = false` |
| Automated tests | None |

---

## 15. Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The Branch User (`user_type = branch_user`) of a branch |
| CCRD- / REQ- | Critical Vault credential codes / access request codes |
| Protection steps | `lock_admin`, `lock_manager`, `lock_otp` |
| Stage | One step of a request: `admin`, `manager`, `otp` |
| Forward | `raise-manager` — the requester sends an admin-approved request to the manager |
| Window | `duration_minutes` from `unlocked_at` to `expires_at` |
| Sweep | `sweepUnlocks()` — locks every window that has ended |
| Direct opener | The Vault Admin of the credential's branch (`opensDirectly()`) |
| `branch_critical` | The View rank everyone in a branch has on its Critical Vault credentials |
