# Kryptone CredVault — Prototype Understanding Sheet

**Source:** `Kryptone_CredVault_Prototype.html` (repo root) · 6.16 MB · 74,197 lines · read 2026-10-30
**What it is:** a single-file HTML/JS prototype of **CredVault**, a company password manager (personal, team and critical credentials, sharing, approval-gated unlock, health, audit, import/backup). It has no backend; all state lives in memory.

---

## 0. File anatomy

| Lines | Content |
|---|---|
| 1–8 | Head. Fonts: DM Sans + Geist Mono. Title "Kryptone CredVault" |
| 9–26131 | CSS (several `<style>` blocks, incl. `uit-shared-styles`, `cp-style`) |
| 26133–26170 | Body: logout modal, `#app` mount, product filter drawer (leftover) |
| 26171–73849 | **Main script.** Mostly leftover IDIMS P2P / Inventory / Procurement / Supplier code |
| 26516–26614 | `buildCredVault()`: the CredVault mega-menu |
| 26703–26912 | `render()`: top nav, branch switcher, theme/brand/fullscreen, profile, **10 CredVault tabs** |
| **64329–67801** | **CredVault app code**: My Vault … Vault Dashboard, Critical Vault list |
| 67802–70094 | Embedded QR Code Generator library (Kazuhiko Arase, MIT); used for the authenticator QR |
| **70095–70729** | **Critical Access Protection** engine, Critical Vault page shell, Team Vault page, My Vault body |
| 70729–73849 | Leftover: Zone / Rack / Product Flags / Supplier masters |
| 73836–73849 | INIT: `render()`, then a wrapper on `openP2PPage` that highlights the active tab, then `openVaultDashboard()` |
| 74033 | **A second, minified copy** of the same QR library |

**Routing:** every page is `openP2PPage(title)`, which dispatches to a `xxxBody()` builder (router at ~30304–30337).
**Shell:** search box "Search credentials, vaults, owners…" (not wired), CredVault mega-menu button, branch switcher (Inorbvict Healthcare / Agrotech / Vortex, cosmetic), brand/theme toggle, fullscreen, profile, logout modal (logout is a no-op hook).

### Navigation (10 tabs, in order)
Vault Dashboard · Password Health · My Vault · Team Vault · Critical Vault · Access Request Management · CredVault Policies · Import & Recovery · Audit Logs · Recycle Bin

### Mega-menu
- **Quick Actions:** Add Credential, Add Critical Credential, Generate Password, Recycle Bin, Import Bulk Credentials, Download Backup.
- **Vault Analytics:** Dashboard, Password Health.
- **Vault Management:** My, Team, Critical (tagged "Restricted").
- **Vault Administration & Security:** Access Requests, Policies, Import & Recovery, Audit Logs, Recycle Bin.

---

## 1. Core data model

### Credential (`MV_ROWS[]`)
```
{ id:'CRD-0001', type, name, category(type label), group(category group), scope:'personal'|'team',
  owner, shared:bool (shared WITH me), dept, url, username, password (value of the type's secret field),
  strength 0-4, hasPw, twofa:'yes'|'no'|'na', risk:'low'|'medium'|'high'|'critical',
  rotation:''|'30'|'60'|'90'|'180', pwAt, tags(always ''), notes,
  fields{type fields + regEmail/regPhone/rkey}, files[], updated(ISO),
  shares[], log[], lock{admin,manager,twofa,adminName,managerName,secret}, twofaSecret }
```
- **Seed:** `mvSeed()` creates 33 rows covering all 25 types (CRD-0001…0033). 6 are "shared with you". `mvAssignTeamOwners` gives 9 of them to org members. `cvSeedMore()` adds 26 more critical rows (13 mine, 13 team).
- Seed passwords are `'Kr'+random+'!9'` and change on every reload.

### Enums
- **Risk:** low, medium, high, critical. Only critical rows appear in the Critical Vault.
- **Strength:** 0 '' / 1 Weak / 2 Fair / 3 Good / 4 Strong (`MV_STR_LBL`).
  - `mvStrength` gives 1 point each for length ≥8, length ≥12, mixed case, digit, symbol.
  - Score ≤2 → 1, 3 → 2, 4 → 3, 5 → 4. Length <8 is always 1.
- **Share permission:** `use` (launch/autofill, password hidden), `view` (reveal), `copy` (reveal + copy), `full` (edit/share/delete).
- **Scope:** personal, team. **2FA:** yes, no, na.
- **Org levels:** admin, hod, tl, exec, emp, intern.

### 25 credential types in 5 groups
| Group | Types |
|---|---|
| Logins & Access | login, password, email, passkey*, totp* |
| Finance & Banking | card, bank, crypto, rewards |
| Development & IT | api, ssh, database, server, cert*, license, wifi |
| Identity & Documents | identity, passport, driver, govid, document |
| Personal & Lifestyle | note, membership, medical, outdoor |

(* = tagged "New" in the picker.)

---

## 2. My Vault (`openMyVault` 64330 · body 70650)

**Header buttons:** Generate Password, Add Credential. Also a collapsible "What We Are Doing Here" box.

**Tabs (`mvVisible` 65596):**
- All.
- My Credentials: not shared, owner = me. Your own team credentials land here.
- Team Credentials: scope team, not shared, owner ≠ me.
- Shared With Me: `r.shared`.
- Shared By Me: one row per share.

**List columns:** Sr. No | Credential ID | Name (icon + url) | Category (+group) | Username | Owner (You/Team/Personal, or role · dept + "Shared with you") | Risk | Strength bar | 2FA | Last Updated | Action. Sorted by updated descending, 10 per page. Search covers id, name, category, group, username, owner, url, tags.

**Row actions:** Edit · Share · View · Copy Password · Move to Bin.

### 2.1 Add Credential, step 1: type picker (`crdOpenPicker` 64792)
- "What would you like to add?" with search (press `/` to focus), left nav "All types (25)" plus 5 groups with counts, scroll-spy.
- Each tile shows icon, description, default risk and field count.

### 2.2 Add/Edit form (`crdOpenForm` 64964). Sections:
1. **Credential Details:** ID (Auto, `CRD-` + next), **Name***, Category (frozen = type), Owner (frozen = me).
2. **{Type} Details:** see the table below.
3. **Recovery & Proof** (some types, all optional):
   - Registered Email/Phone (phone `^\+?[\d\s()-]{10,16}$`).
   - Secret / Recovery Key (min 4).
   - Attachments: ≤5 files, 10 MB each, pdf/png/jpg/webp/doc/xls/csv/txt. Duplicates skipped.
4. **Security Details:**
   - **Risk*:** low/medium/high/"Critical — needs approval to view". Default comes from the type, or critical when opened from the Critical Vault.
   - Password Rotation: none/30/60/90/180, default `CV_POL.rotDef`=90.
   - 2FA toggle.
   - Remark.
5. **Critical Access Protection:** only for critical credentials. See §6.4.

Footer: add mode shows "Change type" (which discards your input), Close, Save. Edit mode shows a live "N fields changed" counter and Update.

### 2.3 Type-specific fields (`*` = required)
| Type (default risk) | Fields |
|---|---|
| login (medium) | url* · username* · password* |
| password (medium) | url · username* · password* · 2FA toggle |
| note (low) | note* (textarea) |
| document (medium) | docno · issued · expiry · file* |
| card (critical) | holder* · cardno* (secret, ≤19) · issuer · exp* MM/YY · cvv* (secret, ≤4) · pin (secret, ≤6) |
| bank (critical) | bank* · holder* · acno* (secret) · ifsc* (upper, 11) · nbuser · nbpass |
| crypto (critical) | wallet* · address* · seed* (12/24 words, secret) · wpass |
| rewards (low) | program* · member* · password |
| api (high) | service* · endpoint · apikey* · secret* · expiry |
| ssh (high) | host* · username* · passphrase · privkey* (mono textarea) |
| database (high) | engine* (MySQL/PostgreSQL/SQL Server/MongoDB/Oracle/Other) · host* · port* · dbname* · username* · password* |
| server (high) | host* · os (Linux/Windows Server/macOS/Other) · port · username* · password* |
| license (medium) | product* · lkey* (secret) · licto · seats · renewal date |
| wifi (medium) | ssid* · security* (WPA3/WPA2/WPA2-WPA3/WEP/Open) · password* · admin url · admin pass |
| cert (high) | domain* · issuer · expiry* · file* · key pass |
| totp (high) | service* · account* · seed* (base32) · digits (6/8) · period (30/60 s) · backup codes |
| passkey (medium) | url* · username* · device* (YubiKey/Windows Hello/iCloud/Google PM/Android/Other) · created |
| email (high) | email* · provider* (Google Workspace/M365/Zoho Mail/Other) · password* · recovery |
| membership (low) | org* · member* · expiry · portal password |
| identity (medium) | fullname* · dob · phone · email · address |
| passport (high) | fullname* · number* (secret, ≤9) · nationality · issue · expiry* · file |
| driver (medium) | fullname* · number* · state · expiry* · file |
| govid (critical) | idtype* (Aadhaar/PAN/SSN/Voter ID) · number* · name* · file |
| medical (high) | patient* · provider · policy* (secret) · file |
| outdoor (low) | ltype* · number* · issued · expiry* |

### 2.4 Save validation (`crdSave` 65084, plus wrapper at 70443)
- Name and Risk are required; type-required fields too.
- Format checks:
  - URL: domain or IPv4.
  - Email: `x@y.z`.
  - Card number: 12–19 digits, **no Luhn check**.
  - `exp`: MM/YY, **past dates accepted**.
  - CVV: 3–4 digits.
  - IFSC: `^[A-Z]{4}0[A-Z0-9]{6}$`.
  - Port: 1–65535.
- **Policy:** a password below `CV_POL.minStr` (Good) is blocked with "use the generate button".
- **Critical:**
  - If 2FA is on, the authenticator app must be linked.
  - At least one of admin / manager / 2FA must be enabled.
  - Saving writes `r.lock` and `r.twofaSecret`.

### 2.5 Generate Password (`gpOpen` 65178)
- **Characters mode:** length 8–64 (default 20 from policy), Upper / Lower / Numbers / Symbols / Avoid ambiguous. At least one set must stay on.
- **Passphrase mode:** 4–12 words from a 100-word list, Capitalise, Add number, separator `- . _ space`.
- **Entropy and level:** ≥100 bits Very strong, ≥75 Strong, ≥55 Good, ≥40 Fair, otherwise Weak.
- **Use in New Credential** prefills the first password field of the type you pick next.
- The in-form generate button is a separate generator: fixed 16 characters using `crypto.getRandomValues`.

### 2.6 Share Credential (`shOpen` 65234)
- **Recipient:** Individual or Team.
  - People: 6 (Arjun Mehta, Priya Sharma, Rohan Verma, Neha Patel, Vikram Singh, Anita Gupta).
  - Teams: 4 (IT Ops 8, Finance & Accounts 6, Procurement 11, Leadership 4).
  - External sharing is off by policy.
- **Permission:** use / view / copy / full, with a capability grid (sign in, see, copy, edit, re-share, delete).
- **Duration:**
  - Options: 1/7/30/90 days, No expiry, or a custom date (past disabled; ends at 23:59).
  - Filtered by `shareMax` (30 by default, so 1/7/30 are shown).
- **Reason:** required when `shareReason` is on, min 5 characters.
- **Critical credentials:** sharing is blocked if `shareCrit` is off. Otherwise the default permission is `use`, and **Full** and **No expiry** are disabled.
- Record: `{to(name), kind, perm, until, reason, at, revoked?}`.

### 2.7 Shared By Me tab (65647)
- **Columns:** Credential, Shared With, Permission, Shared On, Expires ("N days left", "Nh left", "Expired N days ago", "No expiry"), Reason, Status.
- **Status values:** active, soon (<3 days left), expired, revoked.
- **Row actions:** View · Share again · Revoke. Revoke opens a confirm and sets `revoked`; the row stays visible as Revoked.

### 2.8 View drawer (`vwOpen` 65414 · `vdRender`)
- **Header actions:** Launch, Reveal (auto-hides after **30 s**), Copy secret, Share, Bin.
- **Tabs:**
  - Overview: secret, ID/type/vault/owner, your access, risk, strength, 2FA, rotation + "Next rotation due" (overdue in red, ≤15 days amber).
  - {Type} Details: fields with reveal/copy, plus attachments.
  - Access: owner + active shares.
  - Activity: `r.log` timeline.
- **Logged to `r.log`:** viewed, revealed, copied, launched, attachment opened.
- Locked critical credentials are routed to the unlock modal instead (`cpOpen`).

### 2.9 Delete
- **Own credential:** "Move to Recycle Bin" modal. It explains that shares are paused, the item is restorable for `RB_DAYS`, and gives the purge date; a consent checkbox enables the button. Then `rbMove`.
- **Shared with me:** "Remove from your vault?", which removes the row only.

---

## 3. Team Vault (`openTeamVault` 70543)

- **Header:** Export Credentials.
- **Split 2:8:**
  - **Left, Team Details:**
    - Admin card: "Vault Administrator", 8 depts, 8 HODs.
    - 8 department cards: IT, Sales, HR, Purchase & Procurement, Logistics, Digital Marketing, Accounts, General Admin. Each shows the HOD, member count and a level distribution bar.
    - Clicking a department opens its detail: stats, level chips, and an expandable **org hierarchy tree** (admin → HOD → TL → Exec → Emp → Intern).
    - Clicking a person filters the right pane to "credentials accessible to X".
  - **Right, Credentials:** tabs My Credentials / Team Credentials, search, and the same list as My Vault.
- **Team access rule (`tvcAccess`):** a credential is accessible to the owner, the department HOD, a pseudo-random third of the department members (charcode hash % 3), and share recipients. Admin-level members see everything.
- **Export Credentials popup (`exOpen` 65804):**
  - Category group chips (all on), CSV or JSON, Include notes (on), Include passwords (off).
  - Including passwords needs an "I understand the risk" checkbox.
  - The file is built client-side as `team-vault-credentials-YYYYMMDD.csv|json`.
  - Columns: ID, Name, Type, Category, Website, Username, Owner, Vault, Risk, 2FA, Rotation, Updated, plus Password and Notes when selected.

---

## 4. Password Health (`openPasswordHealth` 66229)

- **Header buttons:** Generate Password, Run Health Check.
- **Summary:**
  - Score ring = healthy credentials / total × 100. Good ≥80, Fair ≥60, otherwise At risk.
  - 5 cards: Checked, With passwords, Open issues, Critical issues, Strong & safe.
- **Tabs:** All Issues · Weak · Reused · 2FA Off · Rotation Due · Over-shared · Resolved.
- **Scope:** every credential not shared with me.

| Check | Rule | Severity |
|---|---|---|
| Weak | strength < `minStr` (3) | critical if the credential is critical or strength = 1, else high |
| Reused | same plaintext on more than one credential | critical if the credential is critical, else high |
| 2FA off | twofa = no and risk in `twofaRisk` (critical, high) | critical |
| Rotation overdue | age (`pwAt`, else `updated`) > `r.rotation` | critical if the credential is critical, else high |
| Rotation due soon | rotation − age ≤ `rotWarn` (15) | medium |
| Over-shared | active shares ≥ `overshare` (3), or a critical credential with any `full` share | high if critical, else medium |

**Fix:**
- An over-shared issue opens Shared By Me.
- Any other issue opens the edit form with a banner and the problem field highlighted.
- After save, `phAfterSave` compares issues before and after and moves fixed ones to **Resolved** (shows when and by whom).

---

## 5. Critical Vault (`openCriticalVault` 67647 · page 70466)

- **Header:** Add Critical Credential (`cvAdd`, which opens the Add form with risk = critical and the protection section).
- **Info box, 4 steps:** Request Access → Get Approval → Unlock for a Limited Time → Auto-Lock & Review.
- **Data:** every `MV_ROWS` row with `risk==='critical'`, given a display ID `CCRD-NNN`.
- **Tabs:** All · My Critical (owner = me) · Teams Critical (owner ≠ me).
- **Columns:** Sr. No | CCRD ID | Name | Category | Username | Owner | Risk | Strength | 2FA | Last Updated | **Access Status** | Action.
- **Access Status:**
  - Unlocked: mm:ss countdown + bar, red under 60 s.
  - Waiting: spinner + Vault Admin / Manager name.
  - "Step k of n".
  - "Approval needed".
  - Refreshed every 1 s.
- **Row actions:** Edit · Lock button (unlock / view request / continue / view) · Move to Bin.

---

## 6. Critical Access Protection: the unlock flow (70095–70464)

### 6.1 Who is locked (`cpLock`)
- **Critical credentials:** steps are **Vault Admin → Manager → Authenticator OTP**, in that fixed order.
  - Each step is on if the global policy (`cpAdmin` / `cpManager` / `cpOtp`) is on **and** the record's `lock.x !== false`.
  - Admins: Sanjay Kulkarni (default) or Meera Iyer. Managers: Priya Sharma, Arjun Mehta, Rohan Verma.
- **Non-critical credentials with a `twofaSecret`:** OTP-only lock.

### 6.2 Flow, in the unlock modal (`cpOpen`)
The modal shows a stepper (Step 1…n, then Reveal) with Previous/Next; you can only go back to stages you've completed.
1. **Vault Admin stage.** The user enters:
   - **Reason*** (10–300 characters, live counter).
   - **Duration:** 5 / 15 / 30 / 60 min, default 15, capped by `cpMaxWin` (60).

   **Send** creates the request `REQ-xxxx` (pending). The user can cancel it.
2. **Admin decision:** approve or reject (the reject reason is fixed text: "Not approved at this time"). After a rejection the user can resend.
3. **Manager stage:** the same request/approve cycle, with the admin's reason and window shown read-only.
4. **OTP stage:** enter a 6-digit TOTP. Digit boxes auto-advance and accept paste.
   - First time: a one-time QR setup (`otpauth://totp/Kryptone:<label>?…SHA1, 6 digits, 30 s`).
   - RFC 6238 is implemented in pure JS (SHA-1, HMAC, base32), with ±1 step of drift allowed.
   - **3 wrong codes wipe all approvals**, and the user starts again from stage 1.
5. **Unlocked:**
   - "Access granted" shows the approval chain, a circular countdown, and fields with reveal/copy (both logged).
   - The window is the admin-chosen minutes; it falls back to 5 min when there is no admin step.
   - Buttons: **Full details** (opens the drawer) and **Lock now**.
6. **Re-lock:** when the timer ends or on Lock now, all state is deleted, and the next reveal starts again from stage 1.

### 6.3 State
- `CP_ST[id] = {admin:{s,reason,mins,at,by,rid,decided,why}, manager:{…}, otpOk, tries, total, until}`. It is in memory only.
- The TOTP secret is per credential (`lock.secret`), or a global per-browser secret in `localStorage kr_cp_totp`.

### 6.4 The form section, "Critical Access Protection"
- 3 rows:
  1. Request access to Vault Admin: toggle + admin picker.
  2. Request approval from Manager: toggle + manager picker.
  3. 2FA via authenticator app: toggle + link box.
- **Link box:**
  - QR + copyable setup key.
  - 3 steps: Open app / Scan / Enter code. Works with Google, Microsoft, Authy and any TOTP app.
  - "Verify & link". A linked app can be re-linked.

---

## 7. Access Request Management (`openAccessRequests` 66041)

- **Purpose:** two-person approval queue (Vault Admin, then Reporting Manager) for unlocking critical credentials.
- **Tabs:** All / Pending / Approved / Rejected (with counts).
- **Search:** ID, credential, requester, reason, dept, approvers.
- **Columns:** Request ID (+time) | Credential (+CCRD) | Requested By (role · dept) | Reason | Access Window | Vault Admin chip | Reporting Manager chip | Status | Action.
  - Status values: "Step 1 of 2 · Vault Admin", "Step 2 of 2 · Manager", "Both approvals done", "Rejected by …".
  - Action: Approve / Reject.
- **Seed:** 22 requests (12 requesters).

| Status | Count |
|---|---|
| Pending | 8 (4 at admin stage, 4 at manager stage) |
| Approved | 8 |
| Rejected | 6 |

  Live requests are merged in from `CP_ST`.
- **Rules:**
  - Admin approval creates the pending manager step.
  - A rejection at either stage ends the request.
  - Status: any reject → rejected; both approved → approved; otherwise pending.
  - The reject modal has **no reason field**.

---

## 8. CredVault Policies (`openPolicies` 66621)

Settings live in `CV_POL` (defaults in `CV_POL_DEF` 66597). The page has a 5-card grid. Each card shows rules, an "Applies to" list, an insight box and live stats. A 6th card is the Change History. A sticky bar offers Discard / **Save Changes**; there is also **Reset to Defaults**.

| Section | Key | Default | Options | Used by |
|---|---|---|---|---|
| Password | minStr | 3 Good | 2/3/4 | Add/Edit save block, Health weak check, import weak flag, Dashboard |
| | rotDef | 90 | 30/60/90/180/None | Add form default, import |
| | rotWarn | 15 | 7/15/30 days | Health "due soon", Dashboard |
| | genLen | 20 | 16/20/24/32 | Generator popup (after Save) |
| | genSym | on | switch | Generator popup |
| Two-Factor | twofaRisk | critical, high | any of 4 risks | Health, Dashboard |
| Sharing | shareCrit | on | switch | Share blocked for critical |
| | shareMax | 30 | 7/30/90/No limit | Share durations and save check |
| | shareReason | on | switch | Share reason required |
| | overshare | 3 | 2/3/5/10 | Health over-shared |
| Critical Access | cpAdmin / cpManager / cpOtp | on/on/on | switches | `cpLock` steps |
| | cpAdminName | Sanjay Kulkarni | CP_ADMINS | default approver |
| | cpMaxWin | 60 | 5/15/30/60 min | unlock duration cap |
| Recycle Bin | binDays | 30 | 7/15/30/60/90 | retention (`RB_DAYS`) |
| | binPurge | on | switch | permanent delete / Empty Bin allowed |

**Save:** each changed key is logged to `POL_LOG {k, from, to, at, by}`, then `polApply()` pushes values to the generator and the Recycle Bin.

---

## 9. Audit Logs (`openAuditLogs` 66820)

- **20 actions (`AL_ACT`) with severity:**
  - view (info), reveal (warn), copy (warn), launch (info), create (info), edit (info), share (warn), revoke (info).
  - request (warn), approve (info), **reject (critical)**, **unlock (critical)**, lock (info).
  - **export (critical)**, bin (warn), restore (info), policy (warn), importx (warn), backup (warn), **backupfail (critical)**.
  - Reveal, copy and share on a critical credential are raised to critical.
- **Event sources:** 72 seeded events, `r.log`, shares/revokes, access requests, Recycle Bin, imports, backups, policy changes.
- **Event shape:** `{id:'EVT-…', at, actor, act, r, detail, src (module), ip, sev}`.
- **Tabs:** All Activity / My Activity / Team Activity / Security Alerts (critical).
- **Range:** 24h / 7d / **30d** (default) / All / Custom (From ≤ To).
- **Summary:** total events; cards for Views & reveals, Copies & exports, Access changes, Security alerts, Most active user.
- **List:** a timeline grouped by day, 15 per page. Each event shows actor, role, severity, detail, credential, module, IP and ID.
- **Export Logs:** CSV of the filtered view, 11 columns, `credvault-audit-log-YYYYMMDD.csv`.

---

## 10. Import & Recovery (`openImportRecovery(tab)` 67018)

### Import tab
- **3-step guide:**
  1. Download a sample (Excel/CSV/JSON).
  2. Fill in the columns name*, url, username, password*, category, notes.
  3. Upload & review. Destination: My Vault · Personal.
- **Accepted formats:** .xlsx, .xls (2003 XML), .csv, .tsv/.txt, .json, .xml. Binary .xls is rejected with a "Save As .xlsx" hint.
  - Hand-written ZIP/XLSX/CSV/JSON/XML parsers.
- **Source auto-detect (label only):** Bitwarden, LastPass, Firefox, KeePass, 1Password, CredVault sample, Chrome/Edge.
- **Column mapping:** automatic, by header aliases. There is no manual mapping UI. A password column plus name or url is required.
- **Row flags:**
  - invalid: no name.
  - nopw: no password.
  - dup: already in My Vault (same name+username or host+username).
  - dupfile: repeated within the file.
  - weak: below minStr.
- **Review panel:**
  - Stats: Rows / Ready / Duplicates / Weak / Can't import.
  - Per-row checkboxes.
  - Duplicates: **Skip** or **Import as copy** (adds the suffix "(imported)").
  - **Import N Credentials** button.
- **Imported rows:** type login (or password when there's no URL), personal, owner me, risk medium, 2FA no, rotation = rotDef.
- **History:** Import ID, date, by, file/source, format, imported/skipped/weak/duplicates.
- **"Try it with sample data"** loads 7 demo rows.

### Backup tab
- **Format:** Excel / CSV / JSON.
- **Scope:** My Vault / Team Vault / All vaults.
- **Include passwords** toggle.
- **Password lock** (min 8 characters + confirm, with a strength meter): the file is wrapped in a ZipCrypto `.zip`.
- **Summary panel:** file preview `credvault-<scope>-backup-YYYYMMDD.<ext>`, a protection banner, your recent downloads, and the **Download Backup** button.
- **Backup history:** ID, date, by, format, scope, items, size, protection, status (failed attempts are logged, e.g. password mismatch).
- **There is no restore-from-backup flow** (see §13).

---

## 11. Recycle Bin (`openRecycleBin` 66458)

- **Item shape:** `{r: full credential, by, at}`. Seeded with 10 items (CRD-901…910), deleted 2–29 days ago.
- **Retention:** `RB_DAYS` = 30. It can be changed (7/15/30/60/90) from the "Change period" button or from Policies. Expired items are purged automatically.
- **Tabs:** All Items / Deleted by Me / Team Credentials / Expiring Soon (≤7 days).
- **Summary:** retention hero + cards for Items, Deleted by me, Expiring soon, Critical items, Next deletion.
- **Columns:**
  - Credential (ID, name, category).
  - Owner, Risk, Deleted By, Deleted On.
  - **Auto-delete In:** days, bar and date. Red at ≤3 days, amber at ≤7.
- **Restore** puts the credential back (re-IDs it on a clash) and logs it.
- **Delete permanently / Empty Bin** both need an "I understand" checkbox, and both are allowed only when `binPurge` is on.

---

## 12. Vault Dashboard (landing page, `openVaultDashboard` 67339)

**Header:** Updated HH:MM, Refresh, Add Credential.

**Vault score:**
```
score = round(passwordHealth% × 0.40 + 2FA% × 0.25 + rotationOnTime% × 0.20 + backup × 0.15)
```
- Level: ≥80 Strong, ≥60 Needs care, otherwise At risk.
- Backup part = recency (50 if the last good backup is under 7 days old, 30 if under 30, else 0) + 50 × the locked share.

**Widgets:**
1. **6 KPI cards, each clickable:**
   - Total credentials (Personal/Team/Shared).
   - Critical credentials (Locked/Unlocked/Open requests).
   - Pending approvals (Admin stage/Manager/Oldest).
   - Password issues (Critical/High/Medium).
   - Active shares (Credentials/Ongoing/End this week).
   - In Recycle Bin (By you/By team/Expiring).
2. **Credentials by type:** bars per group.
3. **Risk level:** donut.
4. **Where credentials live:** Personal/Team/Shared tiles, ownership split, top owners.
5. **Vault activity:** stacked bar chart by severity; 7/14/30 days; average line; busiest day.
6. **Password hygiene:** 3 gauges (Strength, 2FA, Rotation) + breakdown bars.
7. **Needs attention:** up to 10 rules, for example:
   - critical issues, 2FA missing, failed backups;
   - pending requests, rotation, weak, reused, over-shared, unlocked backups;
   - bin items expiring.
8. **Recent activity:** last 10 events.
9. **Credentials by department.**
10. **Backup & Recovery** stats.
11. **Imported Credentials Summary.**

---

## 13. Issues found (prototype bugs & gaps), grouped

### Security / logic (highest impact)
1. **`CP_SKIP_VALIDATION = true` (70097, "TEST MODE").** It turns off:
   - the required reason;
   - **any OTP check: a blank code passes**;
   - the authenticator link check on save;
   - the 3-strike reset.
2. **Approvals are self-simulated.**
   - The requester clicks Approve/Reject inside their own modal; nobody is notified.
   - Access Requests has no actor, role, self-approval or separation-of-duties check. The same user can approve both stages.
3. **Edit / Move to Bin work on locked critical credentials.** Only reveal is gated.
4. **Export has no re-auth, no audit event, and no exclusion of critical credentials.** Critical secrets can be exported in plaintext.
5. **Clipboard is never cleared.** Per-field reveal never auto-hides (only the main secret hides after 30 s).
6. **Backup "encryption" is ZipCrypto,** a weak legacy scheme, yet it is labelled "encrypted". Backups with passwords and no lock are allowed.
7. **Global TOTP secret** stored in `localStorage` for every credential that has no secret of its own.
8. **The "zero-knowledge / encrypted" copy is UI text only.** No encryption exists; everything is in memory and lost on reload.

### Functional bugs
9. **Manager-only lock crashes:** with the admin step off, the manager card reads `st.admin.reason` while `st.admin` is undefined, a TypeError (70256).
10. **Manager-only / OTP-only unlocks always get 5 min,** and the user never picks a window.
11. **The new Add form cannot set scope or tags.** Every new credential is personal, so team credentials can't be created from Add.
12. **`mvFillFields` writes fake sample data** (card 4111…, CVV 123, a seed phrase) into empty fields on View/Edit, including user records.
13. **Seeded requests always route the manager step to Priya Sharma,** not the requester's real manager. The reject reason is hard-coded.
14. **CCRD IDs are positional:** deleting one renumbers the rest.
15. **Shared-with-me rows still show Edit / Share / Bin in the row actions** (the drawer hides them).
16. **Password Health page:**
    - `phNormalise` rewrites seed passwords every time the page opens.
    - "Run Health Check" is only a toast.
17. **Policy changes bypass the log:** changing retention from the Recycle Bin skips `POL_LOG`. Permanent delete and Empty Bin create no audit event.
18. **Import:**
    - The file's `category` is discarded.
    - Nested JSON (Bitwarden `login.*`) is not mapped.
    - The "2,000 rows" limit is not enforced.
    - Weak rows are pre-selected.
19. **No restore-from-backup:** `.zip` is rejected and encrypted zips can't be read. Re-importing a CSV loses type, owner and risk.
20. **Critical Vault "all" tab:** an empty search shows the team empty-state message.
21. **"Step 0 of n · undefined"** is possible when all steps are done but the credential is not yet unlocked.

### Inconsistencies / dead code
22. **Duplicated or dead code:**
    - Two `vwOpen` definitions (the first one is dead).
    - Legacy `mvOpenAddLegacy`.
    - Unused `vdPolicy`/`vdModules`, `polTabsHtml`/`polSummaryHtml`, `phGen`, `polGet`.
    - The category sub-tab bar is built then discarded.
    - The QR library is embedded twice.
23. **Label mismatches:**
    - "Expiring soon — Deleted within 7 days".
    - "6 rule sets" when there are 5.
    - `AL_VERB` is missing import/backup, which render as "updated".
    - "Teams Critical Credentials".
    - The Step 02 copy says "owner or admin" approves, but the flow is admin → manager.
24. **Metric quirks:**
    - The Password-issues KPI counts issues while its ring counts credentials.
    - The Medium bucket includes low.
    - Failed backups are all-time in one card and 30 days in another.
25. **Generators:** the in-form generator ignores `genLen` (fixed 16). `gpOpen` always regenerates. The cert hint says 5 MB but 10 MB is enforced.
26. **Validation that never fires or is missing:** the 2FA-required check can't fail; no Luhn check; no past-date check on expiry.
27. **The 1 s global interval is never cleared** and rebuilds `cvAll()` every tick.
28. **Leftover P2P / Inventory / Supplier code and CSS** make up roughly 85% of the file.

---

## 14. Glossary of key functions

| Area | Functions |
|---|---|
| Pages | `openVaultDashboard`, `openPasswordHealth`, `openMyVault`, `openTeamVault`, `openCriticalVault`, `openAccessRequests`, `openPolicies`, `openImportRecovery(tab)`, `openAuditLogs`, `openRecycleBin` |
| Credential | `mvSeed`, `MV_ROWS`, `mvOpenAdd(id?)`, `crdOpenPicker`, `crdOpenForm`, `crdSave`, `mvDelete`, `mvCopyPw`, `vwOpen` |
| Sharing | `shOpen`, `SH_PEOPLE`, `SH_PERMS`, `sbRevoke` |
| Generator | `gpOpen`, `_gp`, `gpUse` |
| Critical | `cvAll`, `cpLock`, `cpOpen`, `cpSend`, `cpDecide`, `cpVerifyOtp`, `cpFinish`, `cpRelock`, `CP_ST` |
| Requests | `arAll`, `arStatus`, `arStage`, `arDecide`, `arReject` |
| Health | `phIssues`, `phAfterSave`, `PH_FIXED` |
| Policy | `CV_POL`, `CV_POL_DEF`, `polSave`, `polApply` |
| Audit | `AL_ACT`, `alEvents`, `alExport` |
| Import/Backup | `irFile`, `irBuildRows`, `irImport`, `bkCreate`, `IR_HIST`, `BK_HIST` |
| Bin | `RB_ROWS`, `RB_DAYS`, `rbMove`, `rbRestore`, `rbPurge` |
