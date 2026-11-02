# CredVault — Build, API & Test Sheet

**Module:** CredVault, the company password manager.
**Source of truth:** `Kryptone_CredVault_Prototype.html`. A functional summary is in [CREDVAULT_PROTOTYPE_SHEET.md](CREDVAULT_PROTOTYPE_SHEET.md).
**Postman:** [CredVault.postman_collection.json](CredVault.postman_collection.json) — 11 folders, 131 requests, all 51 routes.
**Last checked:** 31/10/2026. Nothing is committed yet.

---

## 1. Status at a glance

| Area | Status |
|---|---|
| Backend API | **Done.** 51 endpoints under `/api/credvault`, in one controller. 6 tables with **no foreign keys** (user rule). |
| Frontend | **Done.** All 10 prototype screens plus the Add / Edit popup, at `/credentials-vault/*`, with a CredVault mega-menu in the header. |
| Design match | Every screen was compared line by line with the prototype. Gaps were fixed; deliberate differences are listed in §7. |
| Access control | Module permission, tenant isolation, access ranks and the critical unlock chain are enforced on the server (§3). |
| Code review | Round 1: 3 independent reviewers covered backend, frontend and wiring, **36 findings**. Round 2: a fresh reviewer re-checked every fix, **10 more findings**. The final browser pass added 2 more. **All 48 are fixed and retested** (§9). |
| Tests | Backend suite **138 / 138**. Security regressions **26 / 26**. Postman run **125 / 125** (6 skipped). Browser page loads **20 / 20**. Browser workflows **26 / 26**. Restricted users and phone width **19 / 19** (§8). |
| Type-check and build | `tsc`: 0 errors in CredVault. `vite build` succeeds. |
| Open items | Small enhancements only (§10). None of them blocks use. |

---

## 2. Where the code lives

**Backend**

| Part | Path |
|---|---|
| Controller (all 51 endpoints) | `app/Http/Controllers/Api/CredVault/CredVaultController.php` |
| Models | `app/Models/CredVault/` — `Credential`, `CredentialShare`, `AccessRequest`, `Policy`, `AuditLog`, `Transfer` |
| Services | `app/Services/CredVault/Totp.php` (RFC 6238), `VaultFile.php` (CSV / XLSX / JSON read and write, AES-256 zip lock) |
| Migrations | `database/migrations/credvault/` (6 tables), loaded by `loadMigrationsFrom` in `AppServiceProvider` |
| Routes | The CredVault block in `routes/api.php` |
| Rate limiters | `AppServiceProvider`: `credvault` 240/min, `credvault-reveal` 60/min, `credvault-otp` 10/min (per user) |

**Frontend** — `resources/js/pages/credvault/`

| Screen | Route | Folder |
|---|---|---|
| Vault Dashboard | `/credentials-vault/dashboard` | `dashboard/` (page, widgets, hand-drawn SVG charts) |
| Password Health | `/credentials-vault/password-health` | `health/` |
| My Vault | `/credentials-vault/my-vault` | `my-vault/` (page, table, View drawer, Share, Generator, Bin confirm) |
| Team Vault | `/credentials-vault/team-vault` | `team-vault/` (page, department tree, Export popup) |
| Critical Vault | `/credentials-vault/critical-vault` | `critical/` (page, Unlock modal, OTP boxes) |
| Access Requests | `/credentials-vault/access-requests` | `requests/` |
| Policies | `/credentials-vault/policies` | `policies/` |
| Import & Recovery | `/credentials-vault/import-recovery` | `import-recovery/` (Import tab, Backup tab, history) |
| Audit Logs | `/credentials-vault/audit-logs` | `audit/` |
| Recycle Bin | `/credentials-vault/recycle-bin` | `bin/` |
| Add / Edit Credential | popup, opened from the screens | `form/` (type picker, form, Critical Access Protection, authenticator QR) |

**Shared files:**
- `cvApi.ts` — typed client for all 51 endpoints.
- `shared.tsx` — layout, cells, popups and helpers.
- `cvIcons.ts` — the prototype's icons.
- `credvault.css` — the prototype's CSS, rule for rule, scoped under `.cvx` so it doesn't clash with Velzon.
- `credvault-app.css` — the base rules the prototype set on `<body>`.

**Wiring:**
- `components/App.tsx` — lazy routes.
- `utils/routeAccess.ts` — the route guard.
- `utils/routePrefetch.ts` — route prefetching.
- `constants.ts` — `CREDVAULT_GROUPS`.
- `velzon/Layouts/IdimsHeader.tsx` — the CredVault mega-menu with its Quick Actions.

---

## 3. Who can do what

| Rule | How it is enforced |
|---|---|
| **Who can open CredVault** | Client admins always. Everyone else needs **Credentials Vault → View** in Permissions (module `credentials-vault`, id 22). Checked by the route guard, by the header menu, and by the server on every call (403 otherwise). |
| **Tenant isolation** | Every query is scoped to the user's `client_id`. Ids in a request are looked up inside the tenant. A login with no company is refused. |
| **Vault Admin** | An active client admin. The policy's "default Vault Admin" names one of them, and stops counting as soon as that person is no longer a client admin. |
| **Access ranks** | Use < View < Copy < Full. Owners and Vault Admins (on team credentials) have Full. A HOD has Full on their department's team vault. Shares give the rank they name. |
| **HOD** | Taken from `master_departments.head` on the company's **own** departments, and matched to exactly one **active HR employee** and their login. The login's own name is never used, because every user can edit it on their profile. A shared (global) department's head gives no rights, since one name can't stand for a person in every company. |
| **Personal credentials** | The owner's alone, unless shared. Vault Admins don't see them. |
| **Protection changes** | Only the owner or a Vault Admin can change risk, 2FA, the authenticator, vault, team, protection steps or approvers. A HOD or a Full share can edit the other details. |
| **Sharing** | Policy limits apply (maximum days, reason, critical sharing). Critical credentials are never shared with Full and always need an end date. A re-share ends no later than the sharer's own share: a longer pick is shortened, and the toast says so. When someone loses Full Access (revoke, downgrade, removing it from their vault, or the credential turning critical), the shares they passed on end too, however deep the chain goes. A renewal keeps the original sharer. When a credential becomes critical, its live shares are tightened (§7). |
| **Use Only** | Can launch the credential, but never sees secrets or notes. |
| **Critical unlock** | The steps are Vault Admin → Reporting Manager → authenticator code, as the credential and policy set them. Nobody approves their own request, and one person can't give both approvals. Each request allows 3 wrong codes. Each person gets 6 wrong codes per credential per day, after which the owner is notified. A code works once: a replay is refused without costing a try. If the named Vault Admin stops being an admin, their requests go to any Vault Admin, so nothing gets stuck. |
| **Rate limits** | 240 calls a minute per user overall, 60 a minute on reveal, 10 a minute on the code check. |

---

## 4. How to run and test

1. Run `php artisan migrate` (this includes the `credvault` folder).
2. Give the users who need it **Credentials Vault → View** in Permissions. Client admins don't need it.
3. **API (Postman):** import the collection and fill in its variables:
   - `baseUrl`;
   - an employee's `email` / `password`;
   - a client admin's `adminEmail` / `adminPassword`;
   - that employee's reporting manager's `managerEmail` / `managerPassword`;
   - `recipientUserId`.

   Run **00 · Setup**, then the folders in order. Ids are passed along automatically, and the pre-request scripts compute the authenticator codes.
4. **Browser:** run `npm run build` (or `npm run dev`), open the app and use the **CredVault** menu.

### Response shape
- **Success:** `{ status: true, data, tabs?, meta?, summary? }`
- **Refusal:** `{ status: false, message, errors? }` — `errors` is keyed by field.

| Code | Meaning |
|---|---|
| 401 | Not logged in |
| 403 | Not allowed |
| 404 | Not found, or out of your reach |
| 409 | State conflict |
| 410 | Import token used or expired |
| 422 | Validation failed |
| 423 | Credential locked |
| 429 | Rate limit |


---

## 5. Screen → API map (every prototype element and the field that feeds it)

**My Vault**

| Prototype element | API |
|---|---|
| Tabs All / My / Team / Shared With Me / Shared By Me + counts | `GET /credentials?tab=all\|mine\|team\|shared` → `tabs.*`, `tabs.sharedby`; `GET /shares` |
| Columns: ID + date · Name + url · Category + group · Username · Owner + badge · Risk · Strength bar · 2FA · Last Updated | row `code`, `created_at`, `name`, `url`, `type_label`, `category_group`, `username`, `owner{name,initials,is_me}`, `scope`, `access.via`, `risk`, `strength_pct`, `strength_label`, `twofa`, `updated_at` |
| Row actions Edit / Share / View / Copy / Bin | row `can.edit/share/reveal/copy/delete/remove` |
| Add: type picker (25 tiles, 5 groups, description, risk, field count, New) | `GET /meta` → `types[]`, `groups[]` |
| Add form: every field, placeholder, options, span, required | `types[].fields[]` |
| Recovery & Proof, attachments | `types[].extras`, `file_types` |
| Security: risk, rotation, 2FA, remark | `risks[]`, `rotations[]`, `twofa`, `notes` |
| Critical Access Protection + link app | `GET /approvers`, `POST /authenticator/new`, save with `totp_secret` + `totp_code` |
| View drawer tabs Overview / Details / Access / Activity | `GET /credentials/{id}` (`fields`, `recovery`, `notes`, `attachments`, `shares`, `protection`), `GET …/activity` |
| Reveal / copy / launch / field copied | `POST …/reveal`, `POST …/events` |
| Move to Bin / Remove from your vault | `DELETE /credentials/{id}` (`purges_at`; `removed_share`) |
| Generate Password | `POST /generate-password` |
| Share popup | `GET /share-recipients`, `meta.permissions`, `meta.share_durations`, `POST …/shares` |
| Shared By Me columns + status + Revoke | `GET /shares` (`recipient.sub`, `permission_label`, `expires_at`, `reason`, `state`), `DELETE /shares/{id}` |

**Team Vault**

| Prototype element | API |
|---|---|
| Admin card | `GET /team/departments` → `admin` (admins, members, departments, hods, levels) |
| Department cards (HOD, members, level bar) | `departments[]` (`hod`, `members`, `levels[]`) |
| Department detail + hierarchy | `GET /team/departments/{id}` (`stats`, `levels`, `members[]` with `level`, `manager_employee_id`) |
| "View all" organisation | `GET /team/organisation` |
| Member filter chip | `GET /credentials?member_id=` (or `member_employee_id`) → `member` |
| Export popup | `GET /exports/preview`, `POST /exports` |

**Critical Vault & Access**

| Prototype element | API |
|---|---|
| Tabs All / My / Teams' | `GET /credentials?risk=critical&tab=all\|mine\|others` |
| Credential ID CCRD-… | row `critical_code` |
| Access Status cell | row `unlock{state,label,waiting_for,step,seconds_left,total_seconds}` |
| Unlock modal stepper + approver chips | detail `unlock_plan.steps[]`, `last_request` |
| Request form (reason, window) | `unlock_plan.asks_reason`, `durations`; `POST …/access-requests` |
| Waiting box, cancel | `GET /access-requests/{id}`, `POST …/cancel` |
| OTP pane, 3 tries | `POST …/verify-otp` (`otp.attempts_left`) |
| Reveal pane + countdown + Lock now | `POST …/reveal`, `seconds_left`, `POST …/lock` |
| Access Request Management tabs, columns, Approve / Reject | `GET /access-requests` (`requester.role_line`, `admin`/`manager` chips with `decided_by`, `display_status`, `status_label`, `can`), `POST …/approve\|reject` |

**Password Health, Policies, Audit, Import & Recovery, Bin, Dashboard**

| Prototype element | API |
|---|---|
| Health ring + 5 cards | `GET /health` → `summary` (incl. `safe`, `pct`) |
| Health tabs + rows + Fix | `tabs`, `data[]` (`issue`, `severity`, `detail`, `details`, `action`, `credential`, `can_fix`); edit response `health` |
| Policy cards, rules, insight boxes, live stats, change history | `GET /policies` (`sections`, `rules`, `labels`, `insights`, `history`, `warnings`); `PUT /policies`; `POST /policies/reset`; `GET /policies/history` |
| Audit hero + 5 cards, tabs, ranges, timeline, export | `GET /audit-logs` (`summary`, `tabs`, `data[]` with `verb`, `actor.role`), `GET /audit-logs/export` |
| Import guide, upload, sample, review, history | `GET /imports/sample`, `POST /imports/preview` (file or `sample`), `POST /imports`, `GET /imports` |
| Backup form, scope counts, columns, history | `GET /backups` (`scopes`, `columns`, `lock_note`), `POST /backups` |
| Recycle Bin hero + cards, tabs, columns, retention | `GET /recycle-bin` (`summary`, `purged`), restore / purge / empty; retention via `PUT /policies {bin_days}` |
| Dashboard: score, 6 KPIs, by type, risk, where, activity, hygiene, attention, recent, departments, backups, imports | `GET /dashboard?range=&tz=` |

---

## 6. Endpoint list (51)

| Area | Endpoints |
|---|---|
| Setup | `GET meta` · `GET approvers` · `POST authenticator/new` · `POST generate-password` · `GET dashboard` |
| Credentials | `GET credentials` · `GET credentials/next-code` · `POST credentials` · `GET/PUT/POST/DELETE credentials/{id}` · `POST …/reveal` · `POST …/events` · `GET …/activity` · `GET …/attachments/{key}` |
| Sharing | `GET share-recipients` · `POST credentials/{id}/shares` · `GET shares` · `DELETE shares/{id}` |
| Team | `GET team/departments` · `GET team/departments/{id}` · `GET team/organisation` |
| Access | `POST credentials/{id}/access-requests` · `GET access-requests` · `GET access-requests/{id}` · `POST …/approve` · `POST …/reject` · `POST …/cancel` · `POST …/verify-otp` · `POST …/lock` |
| Health | `GET health` |
| Policies | `GET policies` · `PUT policies` · `POST policies/reset` · `GET policies/history` |
| Audit | `GET audit-logs` · `GET audit-logs/export` |
| Import & Recovery | `GET imports/sample` · `POST imports/preview` · `POST imports` · `GET imports` · `POST backups` · `GET backups` · `GET exports/preview` · `POST exports` · `GET exports` |
| Bin | `GET recycle-bin` · `POST recycle-bin/{id}/restore` · `DELETE recycle-bin/{id}` · `DELETE recycle-bin` |

**Rate limits:**
- 240 / min per user across CredVault
- 60 / min on reveal
- 10 / min on the OTP check

---

## 7. Deliberate differences from the prototype

The prototype is a single-browser demo, and some of its behaviour cannot be safe on a real server. These differences are kept on purpose.

| Prototype | API | Why |
|---|---|---|
| Approve / Reject buttons sit in the requester's own modal ("Prototype · act as") | Only the real approver of the current stage can act. Nobody approves their own request, and one person cannot give both approvals | It is an approval in name only otherwise |
| The OTP test-mode switch accepts any code | The code is verified (RFC 6238, ±30 s); 3 wrong codes void the request | Security |
| Anyone with access can edit protection, edit or delete a locked critical credential | Only the owner or a Vault Admin | Security |
| Personal credentials are visible to admins in the Team view | A personal credential is the owner's alone unless shared | Privacy |
| The export popup has only an "I understand the risk" checkbox | Exporting readable passwords also asks for the account password | The file is plain text |
| Backups and exports write every password | Secrets of protected (critical / 2FA-locked) credentials are written as "[Protected — unlock in CredVault]" | They open through an unlock, not a file |
| ZipCrypto backup lock; "opens in Windows & 7-Zip" | AES-256; opens with 7-Zip / WinRAR (`lock_note`) | ZipCrypto is broken in minutes |
| Exporting the audit log is not logged | It is logged (severity info) | The log of the log |
| Delete just happens | Permanent delete needs `confirm: true` | Server-side guard for an irreversible action |
| Same name twice is allowed | One owner cannot have two credentials of the same type with the same name | Prevents duplicate insertion |
| Card number, expiry and seed are not validated | Luhn check, expiry not in the past, 12–24 words, base32 TOTP seed | Server-side validation |
| CCRD numbers are positions (they renumber on delete) | `critical_code` = "C" + the stable CRD code | Stable IDs |
| The Manager stage needs a separate "Send request" click | The manager is notified automatically when the admin approves | Same result, one step fewer |
| Cancel at the Manager stage keeps the admin approval | Cancel ends the whole request | Simpler audit trail; start again cleanly |
| The HOD is a person record | `master_departments.head` is a name, matched to exactly one active HR employee and that employee's login (never the login's own editable name) | The HR master stores names; a login name can be changed by its user |
| Re-sharing has no limit | A re-share ends no later than the sharer's own share. Revoking a Full share also ends the shares it passed on. | Access cannot outlive its source. |
| Raising a credential to critical leaves its shares as they are | Live shares are tightened to the critical rules: no Full Access, an end date (the policy maximum, or 30 days), or removed if critical sharing is off. | The critical rules apply to existing access, not only new shares. |
| Wrong codes are limited per request only | Also 6 wrong codes per person per credential per day. A code works only once. The owner is told when a request is voided. | Stops guessing across new requests, and replay. |
| Notes are shown at every access level | Use Only gets no notes (`has_notes` says whether any exist). | Notes are encrypted like a secret. |

---

## 8. Test results

### End-to-end suite — 138 / 138 passed

The suite ran over real HTTP, starting from an empty vault, with four real users of client 1: Vault Admin #2, requester #33, their manager #35, and team member #29. Besides status codes, it checks the fields the screens read:

- **Labels:** type labels, field labels, kinds, placeholders and Recovery & Proof extras.
- **Linking:** link-before-save (no app, wrong code, linked).
- **Masked IDs:** `•••• 7890`.
- **List behaviour:**
  - tab counts ignore search;
  - search by category label and owner;
  - per-row `can` flags.
- **Unlock flow:**
  - the unlock plan names "Any Vault Admin" and the requester's real manager;
  - list cell states pending → progress → open;
  - requester role line;
  - the decider's name;
  - "Step 1 of 2 · Vault Admin";
  - reject without a note uses the default reason;
  - a manager-only lock needs no reason and gets 5 minutes.
- **Health:** prototype wording, `safe` = checked − at risk, Fix response "1 health issue resolved", Fixed tab with search.
- **Sharing:** member counts, permission-label search, exact credential filter, revoke returns the row, notifications.
- **Team Vault:** levels, organisation view, open member filter, "mine" unaffected.
- **Export:** prototype CSV header, bare JSON array.
- **Policies:**
  - catalogue, "Applies to" and readable history;
  - a re-ordered 2FA list is no change;
  - all checks off is allowed with a warning, and the card then opens.
- **Generator:** no ambiguous characters, 8-word default.
- **Import:**
  - Bitwarden detection, Ready = no flags, weak pre-selected, `dup_of` with name, skipped / duplicates counts;
  - sample data;
  - the "How to fill" sheet.
- **Backup:**
  - scope counts;
  - the default works without the account password;
  - AES-256;
  - prototype headers, About sheet, password present, critical secret withheld.
- **Bin:** `soon` alias, `can_change_retention`, search by deleter, days ≥ 1.
- **Audit:** summary ignores tab and search, verb / role / risk, search by event ID and by action label, open-ended range, CSV ISO date and severity label.
- **Dashboard:** for all four users, with `tz`; the score equals the prototype formula on whole factors; attention sub-lines; department members; the Team KPI split adds up.

### Postman collection run — 125 / 125 passed, 6 skipped

A script ran the collection top to bottom the way Postman would, with the same variables, computed OTP codes and real files for the multipart requests. Every one of the 51 routes is in the collection.

Skipped:
- the 3 logins — they need real passwords;
- "Export with passwords" and "Backup with passwords, not locked" — they need the real account password; their refusal paths are tested;
- "Remove from my vault" — needs the recipient's login.

### Timings — server side, framework boot excluded

| Endpoint | Time | Queries |
|---|---|---|
| meta | 6–8 ms | 7 |
| dashboard | 50–61 ms | 38 |
| credentials list | 20–30 ms | 16–22 |
| health | 15–20 ms | 13 |
| shares / requests / bin | 12–16 ms | 12–15 |
| audit logs | 23–39 ms | 21 |
| team departments / one department | 15–24 ms | 12 |
| team organisation (432 employees) | 74–81 ms | 11 |
| policies | 33–34 ms | 23 |
| backups / export preview | 14–32 ms | 12–21 |
| approvers / recipients | 12–16 ms | 9–11 |

Query counts stay flat as lists grow: shares, access and requests are loaded per page in batches, with no per-row queries.

### Module permission and tenant checks — 11 / 11 passed (31/10/2026)

Every endpoint now also checks the **Credentials Vault** module permission (module `credentials-vault`, id 22). A client admin always passes, since they are the Vault Admin. Any other user needs `can_view` on that module, set in Permissions.

| Check | Result |
|---|---|
| Employee with no grant → `/meta`, `/credentials` | 403 |
| Login with no company (super admin) → list / show / reveal / delete | 403 |
| Colleague in the same company opening or revealing someone's personal credential | 403 / 404 |
| Owner revealing their own credential | 200, correct value |
| Non-admin changing policies | 403 |

The end-to-end suite (138 / 138) and the collection run (125 / 125, 6 skipped) were re-run with the permission check on, and both still pass. All test data, tokens, notifications and temporary grants were removed afterwards.

### Security regression checks — 26 / 26 passed

These checks were added for the review fixes in §9 and run against the real API:

| Area | What was checked |
|---|---|
| HOD | Renaming yourself to the HOD's name gives no HOD access. A global department named after an employee gives no HOD access. The real HR head of the company's own department does get HOD access. |
| Protection | A Full share can't lower the risk, toggle 2FA or relink the authenticator (403). It can rename the credential, with risk sent unchanged (200). |
| Re-share | A 30-day re-share on a 7-day share is shortened to the sharer's end date, and the message says so. Revoking the sharer's Full share ends what they passed on. A two-level chain unwinds completely. |
| Raise to critical | An existing Full share becomes Copy with an end date. |
| Notes | Use Only gets no notes, and `has_notes` is true. The owner still sees the notes. |
| Code (OTP) | The first use unlocks. The same code again is refused ("just used") without costing a try. After 6 wrong codes a new request is refused (429). The owner is notified. |
| Import | A run that imports nothing keeps the preview, and the retry works. The preview is spent once it imports. |
| Audit | A custom range ending "today" in IST, sent with the `Asia/Calcutta` alias → 200. A future date → 422. |
| Backup | The Backup ID inside the file equals the recorded code. |

### Frontend checks
- **Types:** `tsc --noEmit` reports 0 errors in CredVault. The 3 errors in `IdimsHeader.tsx` were there before this work.
- **Build:** `vite build` succeeds, and each screen is its own lazy-loaded chunk.
- **API contract:** every call in `cvApi.ts` was matched against `route:list` — 51 of 51.
- **Browser (headless Chrome, real logins, real API):**
  - All 10 screens load for the Vault Admin (#2) and for an employee (#33): 20 page loads, with no JavaScript errors and no failed calls.
  - **26 / 26 workflows passed:**

| Area | What was clicked through |
|---|---|
| My Vault | Add (type picker → Login form → save); empty-form field errors; View drawer (Reveal shows the password, tabs); Copy (the clipboard holds the password); Share; Shared By Me; Generator → Use in New Credential (form prefilled); Edit → Update; Move to Bin → gone; Recycle Bin → Restore |
| Critical unlock, start to end | Add Critical Credential with the authenticator (setup key → code → Verify & link → save) → locked row → Unlock → request with a reason → **Vault Admin approves** (#2) → **Reporting Manager approves** (#35) → the requester enters the code → "Access granted" → reveal shows the secret |
| Team Vault | Add with Vault = Team; open a department tree; Export popup → CSV downloaded |
| Import & Recovery | Sample data → review (duplicates and weak rows flagged) → Import as copy; Backup locked with a password → .zip downloaded |
| Audit Logs | Search → CSV export downloaded |
| Policies | Change a rule → Save → Reset to Defaults |
| Password Health | Fix opens the edit form |
| Dashboard | Admin and employee views, plus the 30-day range |
| Header | CredVault mega-menu → the "Generate Password" quick action opens the generator on My Vault |

### Restricted users and phone width (browser) — 19 / 19 passed

| Who | What was checked |
|---|---|
| Employee with **no** CredVault permission | No CredVault item in the header. Typing the URL doesn't open the screen. No page errors. |
| **Use Only** recipient | Row Copy is disabled. The drawer offers no working Reveal and never shows the password or the notes. |
| **View** recipient | Row Copy, Edit and Share are disabled, and so is the drawer's Copy Password. Reveal shows the password. Notes are visible. |
| Non-admin on **Policies** | Read-only note shown, no Reset button, every rule control disabled. |
| **Phone width** (390 px) | None of the 10 screens scrolls sideways. |

All test data, tokens, notifications and temporary permission grants were removed after every run.

---

## 9. Bugs found in the final checks — all fixed

**Found in the browser run (5):**
1. **The Dashboard failed for users in India.** Chrome sends the timezone as `Asia/Calcutta`, an old alias that `timezone:all` rejects. Fixed: `timezone:all_with_bc`.
2. **The View drawer's title was unreadable.** Bootstrap's reboot gives every heading a dark colour. Fixed: `.cvx h1–h6 { color: inherit }`.
3. **Bootstrap margins leaked into the prototype markup.** Fixed: the prototype's own `*{margin:0;padding:0}` reset now applies inside `.cvx`.
4. **Critical Vault "All" tab** showed the "No team critical credentials" empty state. This came from the prototype; it now reads correctly per tab.
5. **Notification links** pointed to `/credvault/...`. Fixed: they now go to `/credentials-vault/...`.

**Found by the code review — backend (13):**

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | Critical | HOD rights came from matching the login's **own editable name** with the department head. Anyone could rename themselves and get Full access to a team vault. | The head is matched to one active HR employee and their login; an ambiguous match names nobody. |
| 2 | High | A HOD or a Full-share holder could lower the risk, turn 2FA off or relink the authenticator, then reveal without approvals. | Only the owner or a Vault Admin can change risk, 2FA, the authenticator, vault, team, steps or approvers. Unchanged values pass. |
| 3 | High | The authenticator code could be guessed by raising request after request, 3 tries each. | 6 wrong codes per person per credential per day, then 429. The owner is notified. |
| 4 | Medium | A re-share could outlive the sharer's own share. | Capped at the sharer's own end date, and revoked with it. |
| 5 | Medium | Making a credential critical left Full or no-expiry shares in place. | Shares are tightened (or removed when critical sharing is off). |
| 6 | Medium | Use Only recipients received the encrypted notes. | Notes need View or higher; `has_notes` is added. |
| 7 | Medium | The policy's named Vault Admin kept admin powers after being demoted. | Only active client admins count. |
| 8 | Medium | Audit custom ranges used UTC days, so IST users got "To cannot be in the future" before 05:30. | Ranges use the viewer's timezone (`tz`). |
| 9 | Medium | An import run that imported nothing used up the preview token. | The token is spent only after a successful import. A marker stops two runs at once. |
| 10 | Low | A code could be replayed within its 90-second window. | The last accepted time step is remembered per credential. |
| 11 | Low | The access-request list ran an N+1 query on requester details. | Loaded in one batch. |
| 12 | Low | The Backup ID inside the file could differ from the recorded code. | The code is allocated first, then the file is built with it. |
| 13 | Low | The CSV formula guard (`'` before `= + - @`) came back inside imported passwords. | Import removes it. |

The "Failed backup attempts" attention row also now opens the Backup tab.

**Found by the code review — frontend (23):**
- **Saving / data safety:**
  - Lowering bin retention on Policies purged items with no warning. It now asks first, and so does Reset.
  - Editing a critical credential stored the policy-filtered protection steps permanently. The raw steps are now sent, and only when they change.
  - Double-clicking Save could create a credential twice.
  - Edits made while Policies was saving were lost.
  - Esc in a dropdown closed the whole form. A changed form now asks before closing.
- **Secrets:**
  - The clipboard often wasn't cleared after a copy, because reading it from a timer fails when the window isn't focused. It is now cleared without reading it back, and retried on focus.
  - Reopening the drawer quickly could show the previous credential's revealed value. Drawers are now keyed by id and their timers cleared.
  - A re-revealed field in the Unlock modal hid itself early.
- **Stale or stuck screens:**
  - Access Requests and Password Health could stay on the loading shimmer for good.
  - The Critical Vault row could stick on "Unlocked 00:00".
  - The form could spin forever after a temporary `/meta` failure. It now shows the error with "Try again".
  - Late responses could overwrite newer ones in the Unlock modal, the drawer's Activity tab and the Import & Recovery history.
  - My Vault showed an empty page after deleting the last row on the last page.
- **Flows:**
  - "Full details" from a locked credential closed everything.
  - The authenticator code checked in the browser could have expired by the time Save was clicked. The form now asks for a fresh one.
  - Import let users tick duplicate rows in Skip mode, and the server then rejected them.
  - Header quick actions didn't switch tabs on Import & Recovery.
  - Changing tab or search on Bin page 2 or later lost the "auto-deleted" toast.
  - Restore and Approve could be clicked twice.
  - The Access Requests countdown could jump up.
  - Two Dashboard links landed on the wrong tab.
  - The Backup button was dead when its info failed to load, with no reason shown.

**Found by the second review of the fixes, plus the final browser pass (12):**

| # | Defect | Fix |
|---|---|---|
| 1 | The Audit Logs summary left out `tz`, so a custom range could still 422 for IST users, and its counts used UTC days. | The summary query now gets `tz` too. |
| 2 | A request naming an admin who was later demoted could never be approved. The form also pre-picked that ex-admin and then failed to save. | A named admin who is no longer an admin means "any Vault Admin": in decide, "Awaiting my approval", notifications, the approvers default and the unlock plan. |
| 3 | The form let a HOD or Full-share editor change risk or 2FA, and the server then refused (403). | Those controls are now locked, with "Only the owner or a Vault Admin can change this." |
| 4 | The replay guard could block another person's valid code, and counted a replay as a wrong try. | Claimed atomically per credential and time step. A replay gets a clear "just used" message and costs nothing. |
| 5 | The re-share cascade missed team shares, downgrades, "remove from my vault", the switch to critical, and chains deeper than one level. A renewal also overwrote who shared it. | One cascade helper runs in all of those places, repeating until stable, and a renewal keeps the original sharer. |
| 6 | A global department's head name could make a namesake HOD in any company. | HODs resolve only for the company's own departments. |
| 7 | The CSV guard's apostrophe strip changed real values such as `'=x`. | The writer adds one more apostrophe in front of existing ones, so the round trip is exact (tested). |
| 8 | Two imports of the same preview at once could both run. | The running marker is taken before the preview is read. |
| 9 | The Unlock modal told the list about each change twice. | It now reports through the state change only. |
| 10 | The form's X and Close buttons skipped the "discard changes?" check. | All four ways to close now ask. |
| 11 | Disabled buttons in the View drawer and the header strip looked clickable, because the prototype never disabled them. | Given a disabled style (scoped to CredVault). |
| 12 | A re-share by someone whose own share ends in 1 day, set to "1 day", was refused because it overshot by milliseconds. | A longer pick is shortened to the sharer's end date, and the toast says so. |

---

## 10. Open items (suggestions, none blocking)

1. **Audit Logs:** filters by severity and by user, and an XLSX export.
2. **Import:** a password field for encrypted vault files.
3. **Recycle Bin:** bulk restore and purge endpoints. Bulk actions currently loop over the single-item calls.
4. **Add / Edit form:** a server "check code" call, so a wrong authenticator code is caught before Save on non-HTTPS sites.
5. **Frontend types:** a type colour in `TypeDef`, and real TypeScript types for the dashboard and policies responses.
6. **Credential tags:** the prototype mentions them, but neither the API nor the form has them.
7. **Critical downgrade:** a Vault Admin can still lower a team credential's risk without approval. Decide whether that needs a second person or an owner notice.
8. **HOD data:** all 10 departments in the local data are global (`client_id` null), and none of their heads matches an HR employee. So nobody is a HOD there. To use HOD rights, give each company its own departments with `head` set to a real employee name, or better, store the head as an employee id.

---

## Appendix A — Design-check change log (what the line-by-line prototype comparison changed)

The four reviewers compared every column, card, filter, tab, form field, option list, default, label and message on each screen with what the API returns and accepts. Below is what was wrong and is now fixed.

### Add / Edit Credential
- **25 types:** 10 type labels and about 45 field labels now match the prototype word for word (Credit Card, Wireless Router, SSN / Aadhaar / PAN, Cardholder Name, IFSC Code, Valid Till …).
- **Field kinds now match:**
  - Secure Note is a text area.
  - SSH private key and TOTP backup codes are secret text areas.
  - Identity address is a single line.
  - The Password type keeps its own **2FA toggle field**, so the tile reads 4 fields.
- `/meta` now serves everything the picker and form draw: placeholders, icons, column span, uppercase, "New" badge, per-type descriptions, group descriptions, which Recovery & Proof extras each type gets, and the allowed file types.
- **2FA follows the prototype.** On a type with a 2FA switch, turning it on *is* the authenticator lock. The app is **linked inside the form before saving**: `POST /authenticator/new` gives the QR code, and the save sends that secret plus one code. Saving is refused until it links ("Scan the QR code and verify a code to link your authenticator app, or turn 2FA off."). Before, a credential could be saved with an unlinked app, and nobody could ever open it.
- `twofa` accepts `yes` / `no` as well as true / false.
- "Turn on at least one protection step" now checks the toggles, as the prototype does.
- **Approver pickers:** `GET /approvers` lists Vault Admins and managers with the form's defaults.
- **File types are split as in the prototype:** type file fields take pdf / jpg / png / pem / crt / cer / pfx; extra attachments take pdf / png / jpg / webp / doc(x) / xls(x) / csv / txt.
- URLs with a query string, `ftp://` and `localhost` are accepted.
- A secret ID (account, passport or licence number) shows in lists as `•••• 1234`.

### My Vault, View drawer, Sharing
- **List:**
  - Every row carries `can` flags: reveal, copy, edit, share, delete, remove, edit_protection.
  - Every row carries `active_shares`, owner initials and `critical_code` (CCRD-…).
- **Tab counts ignore the search box**, as in the prototype; `tabs.sharedby` gives the Shared By Me badge.
- **Search covers** ID, name, username, url, category (the type *label*), group and **owner name**.
- **Team tab** excludes credentials that are only shared with you.
- **Drawer:**
  - Type file fields appear as rows; `updated_by` is included.
  - **Copying a plain field** (username, registered email) is logged ("Field copied").
  - The Activity tab is open to every access level and is paged.
- **Critical reveal or copy by someone else notifies the owner**, as the drawer's warning says.
- **Share:**
  - Durations follow the popup: a policy limit hides "No expiry", and no limit hides 90 days.
  - Permission descriptions match.
  - Team recipients show "Team · N members".
- **Shared By Me:**
  - Shows the credential's date.
  - Search also covers category and permission label.
  - Has an exact `credential_id` filter, used by Password Health "Fix".
  - Also lists shares you made on credentials you administer.
  - Revoke returns the updated row.

### Team Vault
- **Levels:** each member carries a level (HOD / Team Lead / Executive / Employee / Intern, read from the HR designation), and departments carry per-level counts for the distribution bar.
- **Organisation view:** `GET /team/organisation` serves the admin card's "View all" tree.
- **Member filter:**
  - Open to anyone. It only narrows what you can already see.
  - Accepts a tree node (`member_employee_id`), not only a login.
  - Leaves the "My Credentials" tab alone.
- Member counts include active employees only.
- **Export popup:** `GET /exports/preview` gives the per-category counts and total before download.
- **Export file:** the prototype's columns (no Department column, raw risk value), bare JSON array, and `X-CredVault-Count` header.

### Critical Vault & Access Requests
- **Access Status cell** uses the prototype's states and labels:

| State | Label |
|---|---|
| `open` | countdown |
| `pending` | "Vault Admin · Sanjay" |
| `progress` | "Step 3 of 3 · Authenticator" |
| `locked` | "Approval needed" |

- **Drawer for a locked credential:**
  - Shows the **unlock plan**: each step, who answers it ("Any Vault Admin", your reporting manager by name), the allowed windows, and whether a reason is asked.
  - Shows the **last request**, including a rejected one with who decided and why.
- **Request row:**
  - Requester role and department.
  - Who decided each stage (`decided_by` with name).
  - `any_admin`.
  - The critical code and type label.
  - The prototype's three statuses (`display_status`) with labels such as "Step 1 of 2 · Vault Admin".
- **Request rules:**
  - The reason and window are asked only on the Vault Admin stage, as in the prototype. With that step off, no reason is needed and the window is 5 minutes.
  - **Reject without a note** works; the note reads "Not approved at this time".
  - The reason message reads "Please give a reason (at least 10 characters)."
- **Request list:**
  - Newest first.
  - Search covers category, the requester's department and both approvers.
  - Counts ignore the search box.

### Password Health
- **Issue labels and suggested actions are the prototype's text:**
  - "Password strength only fair", "Password reused", "2FA not enabled"
  - "Replace with a 16+ character generated password", "Rotate the password now" …
- **Details are structured:** strength %, the reused-with list, age / policy / overdue / due date, shares by permission.
- **Issue rows** carry the credential's type label, url, strength and `can_fix`.
- **"Strong & safe"** = credentials with no open issue (`safe`), plus card percentages.
- **Tabs and search:** the tab key is `fixed` (`resolved` still works). Search covers category, and also works on the Fixed tab.
- **Fixed rows** carry the credential's current data.
- **The edit response** says which issues were resolved or are still open — the Fix flow's toast.

### Policies
- **Catalogue:** `GET /policies` now serves the prototype's rule catalogue — 5 sections with titles and subtitles, 17 rules with label, description, "Applies to" list, control type and option labels. It also serves readable values ("Good", "Every 90 days", "1 hour", "No limit") and the change-history stats (total / today / people).
- **Saving:** 2FA risk levels are stored critical → low and compared as a set, so an unchanged save logs nothing. Turning every critical check off is allowed, with the prototype's warning.
- **History:**
  - Shows readable from/to values, the area, and "You".
  - Policy events read "Minimum password strength: Good → Strong" under module "CredVault Policies".
- **Live stats:** the missing ones were added — rotation due, active shares, shares on critical, over-shared, in required levels, bin expiring, critical in bin, and the risk of the most-shared credentials.

### Audit Logs
- **Summary and tab counts follow the time range only**, as in the prototype.
- **Cards:**
  - "Copies & exports" = copy + export.
  - "Access changes" = share / revoke / request / approve / reject.
  - "team members" excludes you.
- **Rows** carry the verb, severity label, the actor's role ("Vault Administrator", "Executive · Accounts"), and the credential's risk and type.
- **Search** matches the event ID ("EVT-123") and the action label ("Password copied").
- **Custom range** may leave From or To open.
- **CSV:** ISO date, "Info / Warning / Critical", "Vault settings".

### Import & Recovery
- **Import:**
  - Column aliases are the prototype's IR_ALIAS list, and source detection uses its order. An unknown source reads "<format> file".
  - The "Ready" count means no flags.
  - Weak rows are pre-selected and duplicates are not.
  - A row is only "repeated in file" if it isn't already a duplicate.
  - Duplicate matching covers your team vault too.
- **History:** skipped = rows not imported, and duplicates = every duplicate in the file. Format and scope come with labels, and `by_me` / role are included.
- **Sample data:**
  - **"Try it with sample data"** works (`{sample: true}`).
  - The sample file has the prototype's rows and, in Excel, the **"How to fill"** sheet.
- **Backup file:**
  - The prototype's columns: Name, Type, Category, Website, Username, [Password], Owner, Vault, Risk, 2FA, Rotation, Notes, Updated.
  - Its values: Off / —, "N days", "dd Mon yyyy".
  - An Excel **"About"** sheet.
  - JSON wrapped with id, date, author and vault.
- **Backup form:** the default (passwords on, locked) **no longer asks for an account password**. `GET /backups` gives each scope's credential count and the column list.
- **History status** is `done` / `failed`.

### Recycle Bin
- **Tab key:** `soon` (`expiring` still works).
- **Days left** never reads 0.
- **Search** covers owner and deleter names.
- **The list response** says how many items were auto-purged (`purged`, for the toast) and whether you may change retention (`can_change_retention`).

### Dashboard
- **Score:** each factor is rounded first, and an empty factor counts 0 — the prototype's formula.
- **Team KPI** excludes shared-with-you.
- **Ongoing shares** = live shares minus those ending this week.
- **Departments** list every department with people, counting personal credentials by the owner's department.
- **Backups and imports** are counted over all history.
- **Added fields:** total requests, bin expiring, the previous period's events plus change % and busiest day, last backup code and items, import people, department member counts, attention sub-lines, top 3 types.
- **Activity days** are bucketed in the viewer's timezone (`?tz=`).

### Generator
- Prototype defaults: avoid-ambiguous on, which removes I O l o 0 1; 8 words; the prototype's word list; one Numbers switch for both modes.
