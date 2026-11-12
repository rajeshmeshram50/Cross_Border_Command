# CredVault Team Vault — Technical Documentation

| | |
|---|---|
| **Jira** | GT-100 (parent GT-76 — CredVault Team Vault Documentation) |
| **Module** | CredVault → Vault Management → Team Vault |
| **Audience** | Developers, tech leads, code reviewers, QA automation |
| **Companion documents** | Functional Documentation · API Documentation · Code Walkthrough |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document explains how the Team Vault is built: its layers, files, database tables, models, endpoints and the rules that decide who sees what. It is written for developers who will maintain or extend the page. For what the user sees, read the Functional Documentation. For every request and response, read the API Documentation.

### 1.2 The design in one paragraph

The Team Vault is a **read-mostly view over the Normal Vault**. It has no table and no controller of its own. The credential list is the same `listCredentials()` endpoint My Vault uses, called with `tab=team|mine` and two Team-side filters (`department_id`, `member_employee_id`). The left pane reads three endpoints built from the **HR tables**, not from CredVault tables. Everything else — drawer, reveal, share, edit, bin and export — is a shared CredVault endpoint. **Access is never stored**: it is worked out on every request from the HR reporting line, the department head and the user type. Only shares are stored.

### 1.3 Key ideas to understand first

| Idea | What it means in the code |
|---|---|
| `scope` | `personal` or `team` on `credvault_credentials`. Only `team` rows give rights to anyone but the owner. |
| `department_id` | The department a team credential is filed under (`master_departments.id`). |
| Vault Admin | The **Branch User** (`user_type = branch_user`). `isAdmin()` is true for them, for **their own branch only**. |
| `visibleQuery()` | Decides **which rows are listed** for a viewer. |
| `accessMap()` | Decides **how much the viewer may do** on each listed row — a `[rank, via]` pair. |
| rank | `use` < `view` < `copy` < `full` (`RANK_USE` 0 … `RANK_FULL` 3). |
| via | *Why* the viewer has that rank: `owner`, `branch`, `manager`, `hod`, `team`, `share`. |
| Overseen users | The people a viewer is above: their downline, their branch (Vault Admin), and their headed departments (HOD). |
| Live share | A `credvault_shares` row that is neither revoked nor expired (`CredentialShare::live()`). |

---

## 2. Architecture

### 2.1 The three layers

Every request goes from the browser to Laravel, and from Laravel to PostgreSQL.

**Layer 1 — Client (React 19, `resources/js/pages/credvault/`)**

| Component | Lines | Role |
|---|---|---|
| `team-vault/TeamVault.tsx` | 262 | The page: header strip, brief panel, two-pane split, overlays |
| `team-vault/TeamDetails.tsx` | 319 | Left pane: departments → hierarchy tree → person pick |
| `team-vault/ExportModal.tsx` | 263 | Export Credentials popup (CSV) |
| `team-vault/tvData.ts` | 247 | Data-source switch: live API or dummy organisation (`TV_DUMMY`) |
| `team-vault/tvShared.ts` | 162 | Levels, icons, `buildHierarchy`, `ownBranch` |
| Shared components | — | `CredentialTable`, `ViewDrawer`, `ShareModal`, `BinConfirm`, `CredentialFormModal`, `UnlockModal` |
| `cvApi.ts` | 419 | Typed API client and response types |

> ▼ HTTPS · Bearer token · JSON (a file blob for the export)

**Layer 2 — Application (Laravel 12)**

| Component | Lines | Role |
|---|---|---|
| `routes/api.php` | — | Prefix `credvault`, throttle `credvault` (240 / min per user) |
| `NormalVaultController` | 79 | `index` · `store` · `update` · `destroy` — extends the base controller |
| `CredVaultController` — list | 5,746 (whole file) | `listCredentials` · `memberFilter` · `credentialSearch` |
| `CredVaultController` — team pane | | `teamDepartments` · `teamDepartment` · `teamOrganisation` · `hierarchy` |
| `CredVaultController` — drawer | | `show` · `reveal` · `logEvent` · `activity` · `attachment` · `share` (`revokeShare` is called from My Vault only) |
| `CredVaultController` — write | | `exportPreview` · `export` · `binCredential` · `persistCredential` |
| `CredVaultController` — access model | | `visibleQuery` · `accessMap` · `overseenUserIds` · `managesMember` · `downlineIds` · `headedDepts` · `deptHeads` · `levelOf` · `levelOfUser` |

> ▼ Eloquent · SQL

**Layer 3 — Data (PostgreSQL)**

| Table | Holds |
|---|---|
| `credvault_credentials` | The credentials — `scope` (personal / team), `department_id`, `vault` |
| `credvault_shares` | Shares to a user or a team, with permission and expiry |
| `credvault_audit_logs` | Every action, append-only |
| `credvault_transfers` | One record per import, export or backup (the file itself is never stored) |
| `credvault_policies` | Legacy table — CredVault uses fixed values; the row now only keeps each branch's Recycle Bin period (`bin_branch_days`) |
| HR tables | `employees`, `users`, `master_departments`, `master_designations`, employee exits |

### 2.2 Module structure

| Folder | File | Lines | Purpose |
|---|---|---|---|
| `resources/js/pages/credvault/team-vault/` | `TeamVault.tsx` | 262 | The page |
| | `TeamDetails.tsx` | 319 | Left pane |
| | `ExportModal.tsx` | 263 | Export popup |
| | `tvData.ts` | 247 | `TV_DUMMY` switch, dummy organisation |
| | `tvShared.ts` | 162 | `Level`, `LV_ORDER`, `buildHierarchy`, `ownBranch`, `buildBranch` |
| | `teamVault.css` | 21 | Page styles |
| `resources/js/pages/credvault/my-vault/` | `CredentialTable` · `ViewDrawer` · `ShareModal` · `BinConfirm` | — | Shared |
| `resources/js/pages/credvault/form/` | `CredentialFormModal` · `CredentialForm` | — | Shared |
| `resources/js/pages/credvault/critical/` | `UnlockModal` | — | Shared |
| `resources/js/pages/credvault/` | `shared.tsx` · `cvApi.ts` | — | Shared UI kit and API client |
| `app/Http/Controllers/Api/CredVault/` | `CredVaultController.php` | 5,746 | Base controller |
| | `NormalVault/NormalVaultController.php` | 79 | Normal Vault routes |
| `app/Models/CredVault/` | `Credential` · `CredentialShare` · `Policy` (fixed defaults + per-branch bin period) · `AuditLog` · `Transfer` | — | Models |
| `database/migrations/credvault/` | 10 migrations | — | See 4.6 |

Route: `/credentials-vault/team-vault` → lazy `CvTeamVault` in `resources/js/components/App.tsx`.

### 2.3 What happens when the page loads

| Step | Where | What happens |
|---|---|---|
| 1 | `TeamVault.tsx` | Mounts on the **Team Credentials** tab and calls `GET /normal-vault/credentials?tab=team` |
| 2 | `routes/api.php` | `auth:sanctum` → `user.active` → `tenant` → `throttle:credvault` |
| 3 | `listCredentials()` | Builds the visible set (`visibleQuery`), applies the tab rule, counts every tab, pages the rows |
| 4 | `accessMap()` | Gives each row its `[rank, via]`; `row()` turns that into `access` and `can` |
| 5 | `TeamDetails.tsx` | Calls `GET /team/departments` (and, for a scoped viewer, `GET /team/organisation` once) |
| 6 | React | Renders the cards and the table; buttons are enabled from `row.can` |

> **Explanation: why there is no "team members" table.** Who may see a team credential follows the HR org chart. Storing it would go stale every time HR changes a reporting line or a department head. So `visibleQuery()` and `accessMap()` recompute it on every request, and HR stays the single source of truth.

---

## 3. Technology Stack

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · **PostgreSQL** (CLAUDE.md says MySQL; the CHECK constraints and partial index below are Postgres-only) · Sanctum |
| Secrets | Eloquent `encrypted` casts on `secret`, `notes`, `totp_secret`; `encrypted:array` on `fields` |
| Search | `lower(coalesce(col,'')) like ?` with `%` / `_` escaped (`likeTerm`) |
| Rate limits | `credvault` 240/min, `credvault-reveal` 60/min, `credvault-otp` 10/min — per user (`AppServiceProvider`) |
| Files | CSV (or JSON) built in memory by `App\Services\CredVault\VaultFile` and returned as a download — never stored |
| Mail | `CredVaultShareMail`, sent best-effort; failures reported in `mail`, never undo a share |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) · `WorklistPager` |
| Dummy data | `TV_DUMMY` in `tvData.ts` — **currently `false`** (live API) |

---

## 4. Database Schema

### 4.1 `credvault_credentials`

| Group | Columns |
|---|---|
| Tenancy | `client_id` (indexed), `branch_id` (nullable, indexed) |
| Identity | `code` (20), `vault` (`normal`\|`critical`, default `normal`), `type` (20), `category_group` (40), `name` (150) |
| Team | **`scope`** (`personal`\|`team`, default `personal`), `owner_id` (indexed), **`department_id`** (nullable, indexed — `master_departments.id`) |
| Display | `url` (500), `username` (191) |
| Secret | `secret` (text, encrypted), `secret_hash` (64, indexed), `fields` (text, encrypted JSON), `notes` (text, encrypted), `attachments` (json) |
| Health | `risk` (default `medium`), `strength` (0..4), `has_password`, `twofa` (`yes`\|`no`\|`na`), `rotation_days`, `password_changed_at` |
| Critical only | `lock_admin`, `lock_manager`, `lock_otp`, `lock_admin_user_id`, `lock_manager_user_id`, `totp_secret`, `totp_linked_at`, `twofa_method`, `twofa_email`, `twofa_linked_at` |
| Audit | `created_by`, `updated_by`, `deleted_by`, timestamps, `deleted_at` (soft delete = Recycle Bin) |

Indexes: unique `(client_id, code)`; `(client_id, risk)`; **`(client_id, scope, department_id)`**; `(client_id, updated_at)`; `(client_id, deleted_at)`; `(client_id, vault)`.

Postgres CHECKs: `scope in ('personal','team')`, `risk in (…)`, `twofa in ('yes','no','na')`, `strength between 0 and 4`, `vault in ('normal','critical')`, `twofa_method is null or in ('google','email')`, and `vault = 'critical' or risk <> 'critical'` (relaxed on 12 Nov 2026) — a Normal Vault row can never be Critical risk; a Critical Vault row may be any risk.

> **Explanation.** The last CHECK means a Normal Vault (Team Vault) row can **never** be at Critical risk. A critical credential always lives in the Critical Vault.

### 4.2 `credvault_shares`

| Column | Purpose |
|---|---|
| `client_id`, `credential_id`, `shared_by` | Indexed |
| `recipient_type` | `user` \| `team` (CHECK) |
| `recipient_user_id` / `recipient_department_id` | One of the two, by type (both indexed) |
| `permission` | `use` \| `view` \| `copy` \| `full` (CHECK) |
| `reason` | ≤ 500 |
| `expires_at` | Null = no expiry in the schema; in practice every share ends within 30 days (shares are capped at 30 days). Expiry is a date, not a job |
| `revoked_at`, `revoked_by` | A revoke stamps these; the row is never deleted |

Indexes: `(client_id, shared_by, revoked_at)`; Postgres partial unique **`uq_credvault_share_live`** on `(credential_id, recipient_type, coalesce(recipient_user_id,0), coalesce(recipient_department_id,0)) where revoked_at is null` — one live share per credential and recipient.

### 4.3 `credvault_audit_logs`

`client_id`, `branch_id`, `user_id`, `action` (20), `severity` (`info`\|`warn`\|`critical`), `credential_id`, `credential_code`, `credential_name` (copied at write time), `module` (40), `detail` (500), `meta` (json), `ip`, `user_agent`, `created_at`. Append-only. Indexes `(client_id, created_at)`, `(client_id, action, created_at)`, `(client_id, severity, created_at)`.

### 4.4 `credvault_transfers`

One row per export: `kind` (`export`), `code` (`EX-nnnn`, unique per client), `user_id`, `scope` (`mine`\|`team`), `format`, `file_name`, `items`, `size_bytes`, `include_passwords`, `created_at`. Later added: `credential_type`, `failed`, `failed_rows` (imports only).

### 4.5 HR tables read by the tree

| Table | Columns used |
|---|---|
| `employees` | `id`, `user_id`, `emp_code`, `first_name`, `middle_name`, `last_name`, `display_name`, `department_id`, `designation_id`, `branch_id`, `reporting_manager_id`, `reporting_manager_user_id`, `status`, `onboarding_stage_completed` |
| `users` | `id`, `user_type`, `branch_id`, `department_id`, `employee_code`, `designation`, `status` |
| `master_departments` | `id`, `client_id` (null = platform-shared), `name`, `head` (a **name**, not an id) |
| `master_designations` | `name` → level |
| employee exit relation | `exit_case_status`, `final_employee_status`, `rehired_at` |

> **Common misunderstanding.** "`master_departments.head` is a user id." It is a **name**. `deptHeads()` matches it to exactly one Active employee; a name that matches nobody, or several people, gives the department no HOD.

### 4.6 Migration history (`database/migrations/credvault/`)

| Migration | Change |
|---|---|
| `2026_10_30_000001_create_credvault_credentials_table` | Table, indexes, CHECKs |
| `2026_10_30_000002_create_credvault_shares_table` | Shares + partial unique live index |
| `2026_10_30_000003_create_credvault_access_requests_table` | Critical Vault only |
| `2026_10_30_000004_create_credvault_policies_table` | Created the settings table (legacy — the values are now fixed) |
| `2026_10_30_000005_create_credvault_audit_logs_table` | Audit log |
| `2026_10_30_000006_create_credvault_transfers_table` | Import / export / backup history |
| `2026_11_03_000001_add_vault_and_two_step_to_credvault_credentials` | `vault`, 2-step columns; existing critical rows moved to the Critical Vault and recoded `CCRD-`; normal rows lose their locks |
| `2026_11_04_000001_recompute_credvault_password_strength` | Data fix |
| `2026_11_05_000001_add_type_and_failed_rows_to_credvault_transfers` | Typed import columns |
| `2026_11_12_000001_relax_credvault_vault_risk_check` | The Critical Vault may hold any risk; a critical risk may still live only in the Critical Vault |

---

## 5. Models

| Model | Table | Team Vault relevance |
|---|---|---|
| `Credential` | `credvault_credentials` | `SCOPES`, `VAULT_PREFIX` (`CRD` / `CCRD`), `TYPES` (25), `GROUPS` (5), `STRENGTH_LABELS`; `$hidden` keeps every secret column out of `toArray()`; `lockSteps()` returns `[]` for a normal-vault row, so `isProtected()` is always false here; relations `owner`, `department`, `shares` |
| `CredentialShare` | `credvault_shares` | `RECIPIENTS`, `PERMISSIONS` (weakest first — the index is the rank); `scopeLive()` (not revoked, not expired); `state()`; `rank()`; `credential()` includes trashed |
| `Policy` | `credvault_policies` | Fixed rules: shares last at most 30 days (the Share popup offers only 1, 7 or 30 days, no *No expiry*); a reason of at least 5 characters is required; critical credentials may be shared; the Recycle Bin keeps items 30 days unless the branch set its own period (`binDays()`) |
| `AuditLog` | `credvault_audit_logs` | `ACTIONS`, `RAISE_ON_CRITICAL` |
| `Transfer` | `credvault_transfers` | `PREFIXES` (`EX`), `SCOPE_LABELS` (`team` → *Team Vault*) |
| `Employee` | `employees` | `resolved_user_id` accessor: `user_id`, else the login whose `employee_code` = `emp_code` |

---

## 6. API Surface

All under `/api/credvault`, middleware `auth:sanctum` → `user.active` → `tenant` → `throttle:credvault`. Full request and response shapes are in the API Documentation.

| # | Method | Path | Handler | Used by |
|---|---|---|---|---|
| 1 | GET | `/normal-vault/credentials` | `NormalVaultController::index` → `listCredentials(…, 'normal')` | List, tabs, person filter |
| 2 | GET | `/team/departments` | `teamDepartments` | Department cards |
| 3 | GET | `/team/departments/{id}` | `teamDepartment` → `hierarchy()` | Department tree |
| 4 | GET | `/team/organisation` | `teamOrganisation` → `hierarchy(null)` | **View all**; scoped viewers' trim source |
| 5 | GET | `/credentials/{id}` | `show` | Drawer, form, share popup |
| 6 | POST | `/credentials/{id}/reveal` | `reveal` (throttle 60/min) | Reveal / Copy Password |
| 7 | POST | `/credentials/{id}/events` | `logEvent` | Drawer opened, Launch |
| 8 | GET | `/credentials/{id}/activity` | `activity` | Drawer Activity tab |
| 9 | GET | `/share-recipients` | `shareRecipients` | Share popup pickers |
| 10 | POST | `/credentials/{id}/shares` | `share` | Share Credential |
| 11 | GET | `/credentials/{id}/attachments/{key}` | `attachment` | Drawer — open an attachment |
| 12 | PUT/POST | `/normal-vault/credentials/{id}` | `NormalVaultController::update` → `persistCredential` | Edit |
| 13 | DELETE | `/normal-vault/credentials/{id}` | `NormalVaultController::destroy` → `binCredential` | Move to Bin / Remove |
| 14 | GET | `/exports/preview` | `exportPreview` | Export category counts |
| 15 | POST | `/exports` | `export` | CSV download |
| 16 | GET | `/meta` | `meta` | Types, permissions, durations, bin days (cached client-side) |

---

## 7. How Access Is Decided

### 7.1 The visibility helpers

| Helper | Returns | Rule |
|---|---|---|
| `isAdmin` | bool | True for the **Vault Admin** — the Branch User (`branch_user`), for their own branch (memoised) |
| `adminBranchOf` | ?int | The branch the Vault Admin runs |
| `downlineIds` | user ids | Every login below the user in HR, by `reporting_manager_id`, or — when that is empty — by `reporting_manager_user_id`, any depth, loop-safe |
| `headedDepts` | dept ids | Departments whose `head` name resolves to this login (`deptHeads`) |
| `deptHeads` | dept → user | `head` matched to exactly one **Active** employee's display / first-last / first-middle-last name; tenant-own departments only |
| `overseenUserIds` | user ids | Downline + (Vault Admin) the non-admin users of their branch + (HOD) the users of headed departments |
| `managesMember` | bool | Vault Admin of the member's branch, HOD of the member's department, or the member is in the downline; never self |
| `visibleQuery` | Builder | Own + shared-with-me + owned by an overseen user (any scope) + (Vault Admin) team credentials of their branch + (HOD) team credentials of headed departments + downline team credentials |
| `accessMap` | id → [rank, via] | See 7.2 |

### 7.2 `accessMap()` — the rank of each row

The rules are checked **top to bottom**; the first one that matches gives the rank. A share can then only **raise** it.

| Condition (checked in this order) | Access given (`rank`, `via`) |
|---|---|
| The viewer owns the credential | `full`, `owner` |
| **Team credential** — the viewer is the Vault Admin (Branch User), the owner is not an admin type, and the owner's branch or the credential's branch is the viewer's branch | `full`, `branch` |
| **Team credential** — the owner is in the viewer's downline | `full`, `manager` |
| **Team credential** — the viewer heads the credential's department | `full`, `hod` if the owner is below the viewer, otherwise `copy`, `team` |
| Critical Vault credential of the same branch (not used on this page) | `view`, `branch_critical` |
| A live share to the viewer or the viewer's department | Replaces the above when its rank is higher — `rank`, `share` |
| None of the above | No access — *"Credential not found."* (404) |

"Below" compares `LEVEL_ORDER` (`admin 0, hod 1, tl 2, exec 3, emp 4, intern 5`). `levelOfUser()` returns `admin` for every administrator login (`ADMIN_TYPES`), so an administrator's credential is never "below" anyone. Heading a department makes the viewer an HOD whatever the designation.

> **Explanation: why 404 and not 403.** A credential the viewer cannot reach answers *"Credential not found."* (404). A 403 would confirm that the id exists, which would let someone probe ids one by one.

> **Common misunderstanding.** "A personal credential listed in my Team tab means I can open it." No. `visibleQuery()` lists an overseen user's personal credentials, but `accessMap()` grants nothing on personal scope, so those rows come back with `access: null` and open as 404.

### 7.3 `listCredentials()` — the Team Vault tabs

1. Validates `tab` (`all|mine|team|shared|others`), `q` ≤ 100, `page`, `per_page` 1..100, `department_id`, `member_id`, `member_employee_id`.
2. `memberFilter()` resolves the person; with a member, `memberShareIds` = live shares to them or their department.
3. If the viewer `managesMember()`, the base becomes the member's **whole** set (owned or shared to them, any scope); otherwise `visibleQuery()`.
4. `credentialSearch()` — name, code, username, url, category group, type label, risk word, strength word (password types only), owner name.
5. `teamSide` adds `department_id` and, for a non-overseen member, the member restriction.
6. **`team` tab**: with a member — `teamSide` as is; without — `scope = team` OR owner overseen, **minus own, minus shared-with-me**. **`mine` tab**: `base` where `owner_id = viewer`.
7. Every tab is counted; `tabs.sharedby` is added. Rows are ordered `updated_at desc, id desc` and built by `row()` with `accessMap`, open requests and live share counts.

> **Common misunderstanding.** "Credentials shared with me are missing — the team tab is broken." Step 6 removes them on purpose (`whereNotIn($sharedIds)`). They are listed in My Vault → Shared With Me.

---

## 8. The Tree Endpoints — `hierarchy()`

| Rule | Detail |
|---|---|
| Who is included | `onTeam()`: `status = Active`, `onboarding_stage_completed >= 6`, no finished exit (Closed / Exited, not rehired) |
| Vault Admin | Narrowed to `employees.branch_id` of their branch; with no branch on file `teamBranchOf()` returns `0`, matching nobody |
| Reporting link | `manager_employee_id` is kept only when the manager is inside the returned set; otherwise the member is a root |
| Level | `levelOf()` maps the designation; `counts.admin` = the branch's Vault Admin(s) |
| Tree | `hierarchyTree()` builds nested nodes (cycle-safe). The organisation view inserts a `department` node per department between the admin root and its people |

---

## 9. Sharing, Export and Writes

### 9.1 `share()` / `revokeShare()`

- Validation first, then **Full Access** is required.
- The end date is required and may be at most 30 days away; a reason of at least 5 characters is required. A user recipient must be active, not the owner, not yourself, **in your branch** (`shareBranchOf`), and not the person who shared it with you; a team recipient is a department the tenant may use (its own or a platform-shared one).
- Someone holding Full Access through a share has their re-share end date capped at their own share's end.
- `endOrphanedShares()` runs only when an existing share is renewed (and on revoke). A new share answers **201**, a renewal **200**.
- A row lock finds the live share to update; the partial unique index turns a race into 409.
- `endOrphanedShares()` (up to 10 rounds) ends re-shares whose sharer no longer holds Full Access.
- Revoke is allowed for the owner, the sharer, or — on a team credential — a viewer reaching it as `branch`, `manager` or `hod`.

### 9.2 `exportPreview()` / `export()`

- `exportSet()` = `visibleQuery()` + the tab rule (`mine`: owner = viewer; `team`: scope team, not own, not shared-with-me, optional department) + search, ordered by `code`.
- `export()` checks the account password with `Hash::check` — only when `include_passwords = true`, which also requires `acknowledge`. `format` accepts `csv` or `json` (the page always sends CSV); notes are blank for protected rows; an empty selection is 422 on `groups`. It writes rows with `EXPORT_COLUMNS` (+ *Password / Secret*, *Notes*), records a `Transfer` (`EX-nnnn`) and an `export` audit row.
- The file is built in memory and returned with `Content-Length` and the headers `X-CredVault-Code`, `X-CredVault-Count` and `X-CredVault-Withheld`.

### 9.3 Writes from the page

| Method | Rule |
|---|---|
| `NormalVaultController::update` | Needs Full Access. A viewer who is not the `owner` or the Vault Admin (`branch`) may not change `scope` or `department_id` (403) |
| `persistCredential` | Normal Vault refuses `risk = critical`; `teamDepartmentFor()` limits a team write to the user's own department or one they head; the Vault Admin may use any tenant or platform department. An edit that keeps the current department always passes; with none given it defaults to the user's own department |
| `binCredential` | Via `share`: ends the viewer's own user shares (409 when only a team share exists); else Full Access, soft delete, audit `bin` |

---

## 10. Frontend

### 10.1 `TeamVault.tsx`

| State | Purpose |
|---|---|
| `dept` (`OpenDept`) | Open department, or `{key:'admin'}` for the organisation |
| `member` (`TreeNode`) | Picked person; sent as `member_employee_id` only on the team tab |
| `tab` | `team` (default) \| `mine` |
| `q` → `dq` | Search, debounced 350 ms |
| `page`, `pageSize` | 1, 10 |
| `seq` ref | Drops stale list responses |
| `overlay` | `view` \| `form` \| `share` \| `bin` \| `unlock` \| `export` |

A 422 on `member_employee_id` becomes the empty-state text, not an error toast. A 423 on Copy opens `UnlockModal`. `useFillToFoot` sets `--tv-h` (min 620 px).

### 10.2 `TeamDetails.tsx` and `tvShared.ts`

- `seesEveryone(user_type)` — the Vault Admin (`branch_user`) and `super_admin`. Everyone else is `scoped`.
- **Scoped:** loads `/team/organisation` once; `ownBranch()` keeps the viewer's member row (matched by `user_id`) and everyone under them; department cards are recounted from that set; the tree comes from `buildBranch()` with the viewer at the root.
- **Vault Admin:** `/team/departments/{id}` or `/team/organisation`, then `buildHierarchy()` with the Vault Admin on top; a reporting loop lifts the hidden member to a root.

### 10.3 `tvData.ts`

`tvData = TV_DUMMY ? dummy : live`. With `TV_DUMMY = false` every call is the live API. In dummy mode the page shows a *"Design preview"* toast for any action except Edit, Share and Export.

---

## 11. Integrations

| Integration | Use |
|---|---|
| HRMS | Departments, designations, reporting line, onboarding stage, exits — the whole tree and the manager / HOD rights |
| Permissions | Module slug `credentials-vault`, `can_view` |
| Notifications | Bell rows (`App\Notifications\CredVault`, kind `shared`) to the share recipient(s) |
| Mail | `CredVaultShareMail`; team shares in BCC batches of 50; CC copy address from `services.credvault.share_copy_email` |
| Branding | `BrandingResolver::forUser()` on the share email |
| Recycle Bin | `binCredential` → retention is the branch's own period if set, otherwise 30 days |

---

## 12. Security and Known Issues

### 12.1 Security guarantees

| # | Guarantee |
|---|---|
| 1 | Secrets never appear in a list. The drawer (`show`) returns plain values only to View+ ranks; `reveal` is the audited way out. |
| 2 | Out-of-reach credentials return 404, not 403, so ids cannot be probed. |
| 3 | Every query is scoped by the viewer's `client_id` (`tenant` middleware + `tenantUser()`). |
| 4 | A Normal Vault row can never be Critical risk (Postgres CHECK). |

### 12.2 Known issues

| # | Issue | Effect |
|---|---|---|
| 1 | `/team/organisation` returns every on-team employee (name, designation, department, reporting link) to **any** CredVault user | The "me and below" view is trimmed in the browser only |
| 2 | `visibleQuery()` lists an overseen user's **personal** credentials, but `accessMap()` grants nothing on personal scope | Rows show with `access: null` / `can: null` and open as 404 |
| 3 | With a person picked by an overseer, the `mine` tab count is computed on the person's set | The **My Credentials** badge is wrong while the filter is on |
| 4 | `ExportModal` sends no `vault`, so `exportSet()` (which uses `visibleQuery()` with no vault) is not limited to the Normal Vault | The Team Credentials export can include Critical Vault team credentials that the list does not show (their secrets are withheld only while an unlock step guards them, or when the viewer is below Copy) |
| 5 | `levelOf()` matches the substring `hod` | Any designation containing those letters (e.g. *Methods Engineer*) maps to HOD |
| 6 | `reveal` logs module *My Vault* for every non-protected credential; `export` logs module *Team Vault* even for a `mine` export | Wrong module label in the Audit Log |
| 7 | `X-CredVault-Count` is missing from `Access-Control-Expose-Headers` | The export count toast works only on a same-origin setup |
| 8 | The page has no Add button; the form opens only for Edit (it receives `scope="team"`) | A team credential can be created only through `POST /normal-vault/credentials` with `scope: team`; the import API accepts `scope` too, but the Import screen never sends it |
| 9a | **Metadata leak through the person filter** | When `managesMember()` is true, the base skips `visibleQuery()` and lists every credential the person owns **or that is shared to them or their department** — so an overseer sees the names, usernames and URLs of credentials they cannot open (`access: null`) |
| 9b | The export's team set differs from the Team tab | The list includes overseen people's personal credentials; `exportSet()` keeps only `scope = team` — the export count can be lower than the badge |
| 9c | The scoped tree follows only `manager_employee_id` (`reporting_manager_id`) | A manager linked only by `reporting_manager_user_id` gets list rights but a short or empty tree (*Nobody reports to you…*) |

---

## 13. Metrics

| Metric | Value |
|---|---|
| Team Vault frontend files | 5 TS/TSX + 1 CSS (1,274 lines) |
| Shared frontend pieces used | 7 (table, drawer, share, bin, form, unlock, cvApi) |
| Endpoints called | 16 |
| Team-only endpoints | 3 |
| Tables written | 3 (`credvault_credentials`, `credvault_shares`, `credvault_audit_logs`) + `credvault_transfers` on export + `notifications` (bell) on share |
| Access ranks | 4 |
| Hierarchy levels | 6 |
| Default page size | 10 (max 100) |

---

## 14. Glossary

| Term | Meaning |
|---|---|
| Vault Admin | The Branch User (`user_type = branch_user`), for their own branch |
| HOD | The employee whose name matches a department's `head`, exactly once |
| Downline | Everyone who reports to a person in HR, directly or indirectly |
| Overseen user | Someone the viewer is above (downline, branch, headed department) |
| rank / via | The access level of a row, and the reason for it (`accessMap()`) |
| Live share | A share that is neither revoked nor expired |
| Team side | The list query after the Team filters (`department_id`, member) |
