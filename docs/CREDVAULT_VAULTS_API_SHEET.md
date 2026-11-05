# CredVault — Normal Vault & Critical Vault: Backend API Sheet

**Scope:** backend only — the APIs of My Vault (Normal Vault) and the Critical Vault, and the Postman collection for them.
**Postman:** [CredVault_Vaults.postman_collection.json](CredVault_Vaults.postman_collection.json) — 16 folders, 315 requests. Team Vault alone: [CredVault_TeamVault.postman_collection.json](CredVault_TeamVault.postman_collection.json) (29 requests, with Export). Export alone: [CredVault_Export.postman_collection.json](CredVault_Export.postman_collection.json) (18 requests). Each vault has its own folders: **Add · Edit · Get list · Get single · Delete**, with all 25 types in Add, Edit and Get single. Plus **Team Vault** (departments, hierarchy, team credentials) and **Share with email** to a person or a team.
**Last checked:** 03/11/2026:
- **Collection:** 311 / 311 passed (Team Vault alone 25 / 25, Export alone 14 / 14) (the 3 logins are skipped because the runner uses ready-made tokens).
- **Share email:** 19 / 19 checks, plus the Bcc check (§2, Share).
- **Shared By Me** (filters and rows) and the php@inhpl.com copy: 34 / 34.
- **Team Vault** (departments, hierarchy tree, team credentials): 22 / 22.
- **Export Credentials** (tab + filters, counts = the table's tabs, file columns): 23 / 23.
- **⚠ Real SMTP is failing:** Gmail rejects the `.env` login for dev@inhpl.com ("535 Username and Password not accepted"), so **no email leaves the app** until `MAIL_PASSWORD` is replaced with a valid Google app password (§6).
- **API read-back:** 513 / 513 checks on every credential, list and single.
- **Database:** every saved field checked against the request.

Nothing is committed.

---

## 1. Two vaults, one table

Both vaults store into `credvault_credentials`; the `vault` column tells them apart.

| | Normal Vault (My Vault / Team Vault) | Critical Vault |
|---|---|---|
| Routes | `/api/credvault/normal-vault/*` | `/api/credvault/critical-vault/*` |
| Controller | `Api/CredVault/NormalVault/NormalVaultController` | `Api/CredVault/CriticalVault/CriticalVaultController`, `TwoStepController`, `AccessRequestController` |
| IDs | **CRD-0001, CRD-0002 …** | **CCRD-0001, CCRD-0002 …** — a separate counter |
| Risk | low / medium / high. A type that defaults to critical starts at high. `critical` → 422. | Always `critical`. Any other risk → 422. |
| 2-step | `twofa` yes / no is **only recorded**: no link and no unlock | Enforced. `twofa_method` is `google` or `email`, verified before the save and asked on every unlock |
| Approvals | none | Vault Admin → Reporting Manager → 2-step code |

Each vault has the same 25 forms (§3). A credential never moves between vaults: an id sent to the other vault's route → 404.

---

## 2. Endpoints

### Normal Vault

| Method & path | What it does |
|---|---|
| `GET /normal-vault/credentials` | List. Query: `tab` (all \| mine \| team \| shared \| others), `q`, `type`, `group`, `risk`, `department_id`, `member_id`, `page`, `per_page` |
| `GET /normal-vault/credentials/next-code` | Next CRD- ID (a preview) |
| `POST /normal-vault/credentials` | Create (JSON, or multipart when files go with it) |
| `PUT /normal-vault/credentials/{id}` | Edit, partial: a field left out keeps its value |
| `POST /normal-vault/credentials/{id}` | Edit with files (multipart — PHP reads no multipart body on a PUT) |
| `DELETE /normal-vault/credentials/{id}` | To the Recycle Bin, or "remove from my vault" on a share |

### Critical Vault

| Method & path | What it does |
|---|---|
| `GET /critical-vault/credentials` | List. Tabs all \| mine \| others |
| `GET /critical-vault/credentials/next-code` | Next CCRD- ID (a preview) |
| `POST /critical-vault/credentials` | Create, with the protection steps and the 2-step proof |
| `PUT / POST /critical-vault/credentials/{id}` | Edit. Only the owner or a Vault Admin may change the steps, approvers, method or inbox |
| `DELETE /critical-vault/credentials/{id}` | To the Recycle Bin (owner or Vault Admin only) |
| `GET /critical-vault/approvers` | The Vault Admin and manager pickers, with defaults |
| `POST /critical-vault/two-step/google/new` | A new authenticator secret: `qr_image` (the QR to scan, an SVG data URI ready for `<img src>`; in Postman, the response's **Visualize** tab shows it), `otpauth_uri`, `secret` and `secret_display` (the setup key). Each call gives a new secret, so save with the latest one |
| `POST /critical-vault/two-step/google/verify` | Check one app code `{ secret, code }` |
| `POST /critical-vault/two-step/email/send` | Mail a setup code `{ email? }` (default php@inhpl.com) and return a `token` |
| `POST /critical-vault/two-step/email/verify` | `{ token, code }`: the token is then good for one save |
| `POST /critical-vault/credentials/{id}/access-requests` | Request an unlock (`reason`, `duration_minutes` when the admin step is on) |
| `GET /critical-vault/access-requests` · `GET …/{id}` | Request list (tabs all \| pending \| approved \| rejected \| mine \| to_me) and detail |
| `POST /critical-vault/access-requests/{id}/approve` · `/reject` · `/cancel` · `/lock` | The decisions, and "Lock now" |
| `POST /critical-vault/access-requests/{id}/send-otp` | Email method: mail the unlock code to the credential's inbox |
| `POST /critical-vault/access-requests/{id}/verify-otp` | `{ code }` → unlocked for the window |

### Generate Password (both vaults use it)

Per the R&D sheet *Generate Password — R&D and Specification* (CS-1430 … CS-1433).

- `POST /credvault/generate-password` makes one value. Nothing is stored, and the audit log records only "Password generated", never the value.
- The Generate Password dialog and the ↻ button in password fields use this same method and the same defaults.
- `GET /credvault/generate-password/options` returns what the dialog offers: defaults, ranges, separators (by name), the policy minimum, and whether a digit is forced.

**Response:**

```
{ password, level: "Fair" | "Good" | "Strong", strength_level: 2–4, bits, meets_policy, policy_minimum, settings }
```

- `level` follows the **D34 strength criteria**, the one rule for every password in CredVault (see below).
- `bits` is only a hint (e.g. ~122 for the default 20 characters, ~81 for 6 words). No score or percentage is shown (D5).

| Mode | Body | Defaults | Limits |
|---|---|---|---|
| Characters | `mode: "chars"`, `length`, `upper`, `lower`, `numbers`, `symbols`, `avoid_ambiguous` | 20; every set on; `avoid_ambiguous` on (drops I O l o 0 1) | length **12–64**; at least one set on. Each chosen set appears at least once; the rest are picked from all chosen sets and shuffled (Fisher–Yates). |
| Passphrase | `mode: "phrase"`, `words`, `separator`, `capitalize`, `add_number` | **6 words** from the **EFF long list (7,776 words)**, `hyphen`, capitalised, one digit | 4–10 words. Separator by name: `hyphen` · `dot` · `underscore` · `space` (the characters `-` `.` `_` also work). |

**Generator rules:**
- **Random source:** every pick is `random_int()`, PHP's CSPRNG. It draws by rejection sampling, so every character and every word is exactly equally likely (GP-R1, GP-R2).
- **Passphrase digit:** a digit is always added when the policy minimum is Good or Strong, even with `add_number: false` (`settings.add_number_forced: true`).
- **Passphrase separator:** a hyphen, dot or underscore counts as the special character. With `space`, one symbol is added to a random word. So every passphrase is Strong.
- **Sending a space:** send `"space"`, not `" "`. The server trims a bare space away before reading it, and the default hyphen is used.
- **Generator settings:** `gen_length` and `gen_symbols` are **no longer policies** (D32). The generator's own defaults apply, and the Policies API no longer lists them.

**Refusals (422), with the sheet's messages:**

| Field | When | Message |
|---|---|---|
| `upper` | every set off (GP-V01) | Keep at least one character set on |
| `symbols` | a Characters setting that can't reach the policy minimum, e.g. no symbols or no numbers when the minimum is Good (GP-V03) | This setting can’t reach the policy minimum (Good) |
| `length` | outside 12–64 (GP-V02) | Length is 12 to 64 characters. |
| `words` | outside 4–10 | A passphrase has 4 to 10 words. |
| `separator` · `mode` | not one of the allowed values | The selected … is invalid. |

**Saving below the minimum (GP-V08):** a typed or edited password below the policy minimum is refused on save with "Policy requires a Good or stronger password — use the generate button". The server re-checks every save.

### Password strength criteria (D34): one rule everywhere

| Level | A password is at this level when | Example |
|---|---|---|
| **Fair** (counts as weak) | under 8 characters, or only letters, or only numbers, or letters + numbers with no special character | `zoho2026` · `12345678` · `Password` |
| **Good** | 8 or more characters with letters, numbers and at least one special character | `Zoho@2026` |
| **Strong** | 12 or more characters with letters, numbers and a special character | `Zoho@Books#2026` |

- A space is not a special character.
- The rule applies to generated, typed, imported and edited passwords.
- The migration `2026_11_04_000001_recompute_credvault_password_strength` recalculated the stored strength of existing credentials. "Weak" is no longer produced.
- In Password Health, a password below the minimum reads "Weak password" (Fair) or "Password below the policy minimum" (Good under a Strong minimum), with no score.

### Get single — every stored value, in plain text

`GET /credvault/credentials/{id}` (either vault) returns **everything the credential stores, in plain text**: every field of the type (passwords, PINs, CVV, account numbers, keys, seeds — nothing masked), the recovery details including the **recovery key**, the notes and the files. `all_values` repeats every value in one flat map.

```json
"fields": [
  { "key": "acno",   "label": "Account Number",       "kind": "secret",   "value": "001234567890",         "secret": true, "masked": false, "has_value": true },
  { "key": "nbpass", "label": "Net-banking Password", "kind": "password", "value": "Ic!ciNet-2026#Strong", "secret": true, "masked": false, "has_value": true },
  …
],
"recovery": { "reg_email": "accounts@inhpl.com", "reg_phone": "+91 98200 11223", "has_recovery_key": true, "recovery_key": "RECOVERY-7Q2K-9XZM" },
"notes": "Treasury account — PIN with Accounts",
"all_values": { "bank": "ICICI Bank", "holder": "INHPL", "acno": "001234567890", "ifsc": "ICIC0001234", "nbuser": "inhpl.corp",
                "nbpass": "Ic!ciNet-2026#Strong", "reg_email": "accounts@inhpl.com", "reg_phone": "+91 98200 11223",
                "recovery_key": "RECOVERY-7Q2K-9XZM", "notes": "Treasury account — PIN with Accounts" }
```

**Who gets the values:**

| Caller / state | What the single GET returns |
|---|---|
| Owner, Vault Admin, HOD, or a **View / Copy / Full** share | Everything, in plain text, plus `all_values` |
| A **Use Only** share | The fields without their secret values, no `all_values`, no notes — "sign in without seeing the password" |
| A **Critical Vault** credential **while locked** | The summary and the unlock plan only: no fields, no values |
| The same credential **after its unlock** (approvals + 2-step) | Everything, in plain text, until the window closes |

**Notes:**
- **Audit:** each read that returns the values is written to the audit log as a **reveal** ("All stored values returned by the detail API", with the field list).
- **Not returned:** the credential's own 2-step secret (the Google Authenticator key that guards the unlock) is never returned. It is the lock, not the credential's data.
- **Create and edit responses** still don't echo secrets back; read them with the single GET.

### Team Vault — departments, hierarchy, team credentials

| Screen part | Endpoint | What it returns |
|---|---|---|
| **Team Details** pane: the admin card and the department cards | `GET /credvault/team/departments?q=` | `admin`: `admins[]` (name, initials, role "Vault Administrator"), `members`, `departments`, `hods`, `levels[]` (the level bar). `departments[]`: `id`, `name`, `hod` { name, initials, role "HOD", id }, `members`, `levels[]`, `credentials`, `critical_credentials`. `q` searches department and HOD names. |
| **Department** view (back arrow, members / levels / teams, the level chips, Team Hierarchy) | `GET /credvault/team/departments/{id}` | `department` { id, name, hod }; `stats` { members, levels, teams, hods, credentials, critical_credentials }; `levels[]` = the chips, **Admin first** (1 Admin · HOD · TL · Executive · Employee · Intern); `members[]` flat; `tree` (below). Unknown id → 404. |
| Admin card → **View all** | `GET /credvault/team/organisation` | The same for every department; in `tree` each department is a node under the Admin. |
| The table: **My Credentials** / **Team Credentials** | `GET /credvault/normal-vault/credentials?tab=mine\|team&department_id=&member_employee_id=&q=&page=&per_page=` | The credential rows (code + date, name + url, type and group, username, owner + "Team" / "Shared with you" badge, risk, strength name, 2FA, last updated) and `tabs` { mine, team, … }. `member_employee_id` (a member in the tree) lists what that person can open; `GET /credentials?…&vault=critical` lists the critical ones. |
| Add a team credential | `POST /credvault/normal-vault/credentials` with `scope: "team"` | Goes to your own team; `department_id` only for your own team, or one you head or administer (another → 403) |

The **hierarchy tree** is ready to draw. Every node has its own type and children, the "2 ▾" badge is `children_count`, and `team_size` counts everyone below the node:

```json
"tree": {
  "type": "admin", "user_id": 2, "name": "Rajesh Healthcare", "initials": "RH", "designation": "Vault Administrator", "level": "admin",
  "children_count": 1, "team_size": 14,
  "children": [
    { "type": "member", "employee_id": 101, "user_id": 14, "name": "Arjun Mehta", "initials": "AM", "designation": "Head of IT",
      "level": "hod", "level_label": "HOD", "department": { "id": 6, "name": "IT" }, "children_count": 2, "team_size": 13,
      "children": [ { "type": "member", "name": "Rohan Verma", "level": "tl", "children_count": 2, "children": [ … ] }, … ] }
  ]
}
```

**How the tree is built:**
- **Placement:** each member sits under their reporting manager. A member whose manager is outside the department hangs from the Admin.
- **Order:** children are sorted by level (HOD → TL → Executive → Employee → Intern), then by name.
- **Organisation view:** a node `{ "type": "department", "name", "members", … }` sits between the Admin and that department's people.

### Export Credentials — My or Team, filtered, every table column

The **Export Credentials** popup. **The key `tab` comes first:**
- `mine` — My Credentials;
- `team` — Team Credentials: your team's credentials that aren't yours and aren't shared with you.

The same filters as the table follow, so **the counts in the popup equal the tab badges in the table**.

| Request | What it does |
|---|---|
| `GET /credvault/exports/preview?tab=&department_id=&vault=&risk=&type=&q=&groups[]=` | The popup before the download: `total`, `selected` (the "20 of 41"), `groups[]` — one per category box with `count` and `selected` — `protected`, `tabs` { mine, team } (the table's badges), and `columns` |
| `POST /credvault/exports` | The file. Body: `tab` (**required**: `mine` \| `team`), `department_id` (Team), `vault`, `risk`, `type`, `q`, `groups[]` (the ticked categories; none = all), `format` `csv` \| `json`, `include_notes`, `include_passwords` (+ `acknowledge: true` and `account_password`) |
| `GET /credvault/exports` | Export history (EX-… codes) |

| Key | Values | Popup / table |
|---|---|---|
| `tab` | `mine` \| `team` (the old `scope` = `personal` \| `team` still works) | My Credentials / Team Credentials |
| `department_id` | the selected team (Team tab only) | "Credentials shared within the selected team" |
| `vault` · `risk` · `type` · `q` | as the table's filters and search | the table |
| `groups[]` | Logins & Access · Finance & Banking · Development & IT · Identity & Documents · Personal & Lifestyle | What to export (Select all / Clear all) |
| `format` | `csv` (Excel / Sheets) \| `json` (an array, one object per row, the same keys) | File format |
| `include_notes` | true / false | Include notes |
| `include_passwords` | true / false: needs `acknowledge: true` ("I understand the risk…") **and** your `account_password` | Include passwords + the risk box |

**The file's columns** — every column of the table, in its order, then the optional two:

`Sr. No · Credential ID · Created On · Credential Name · Website / App · Type · Category · Username · Owner · Access (Personal / Team / Shared with you) · Department · Vault (Normal / Critical) · Risk · Strength · 2FA · Rotation (days) · Last Updated · [Password / Secret] · [Notes]`

**The response** is the file itself (download): `team-credentials-YYYYMMDD.csv` or `my-credentials-YYYYMMDD.csv`, with these headers:
- `X-CredVault-Code` (EX-…);
- `X-CredVault-Count` (rows);
- `X-CredVault-Withheld` — secrets not written: a locked critical credential reads "[Protected — unlock in CredVault]", and a share without copy rights "[No copy permission]".

Each export is audit-logged and listed in the history.

**Refusals (422):**
- no `tab`;
- nothing matches the selection;
- passwords without `acknowledge`, or with a wrong `account_password`;
- an unknown category or format.

### Strength in the responses

The list rows (`GET …/credentials`) and the single credential (`GET /credentials/{id}`) return strength as a **name**: `"strength": "Strong"`. The names are `Fair`, `Good`, `Strong` (the D34 criteria; Fair counts as weak), or `null` when the type has no password (e.g. Passkey, ID documents). There is **no percentage** (`strength_pct` was removed). `strength_level` (0–4) is there for sorting.

### Share — with an email to the person or the team

`POST /credvault/credentials/{id}/shares` — the **Share Credential** popup, for either vault. Needs Full Access on the credential.

| Field | Values | Popup |
|---|---|---|
| `recipient_type` | `user` \| `team` | Individual / Team |
| `recipient_id` | a user id, or a department id | Share with (from `GET /share-recipients`: `users[]`, and `teams[]` with member counts) |
| `permission` | `use` \| `view` \| `copy` \| `full` | Use Only · View · Copy · Full Access |
| `duration_days` *or* `expires_at` | 1 \| 7 \| 30 (\| 90) · or a date `Y-m-d` | 1 day · 7 days · 30 days · Pick an end date |
| `reason` | 5–500 characters (required by the default policy) | Reason for sharing |

**Rules:**
- **Policy maximum:** 30 days by default; a longer one → 422. Without a policy maximum, a share may have no end date.
- **Critical credentials:**
  - never shared with Full Access (422);
  - always need an end date;
  - can't be shared at all if the policy turns critical sharing off (403).
- **Re-share:** someone with a Full share can re-share, but never beyond their own end date.
- **Same recipient again:** sharing again renews the live share (200 instead of 201) and sends a "Share updated" email.

**Who gets the email:**

| Shared with | Email |
|---|---|
| A person | One email, to that person, greeting them by name |
| A team | Every active login in that department (by the user's department, or their HR record's) **except the sharer**. One email in **Bcc**, in batches of 50, so members don't see each other's addresses. Members also get the bell notification. |
| Always | A **copy (Cc) to php@inhpl.com** on every share email: on the person's email, and once on a team email. Set by `CREDVAULT_SHARE_COPY_EMAIL` in `.env` (default php@inhpl.com; empty = no copy). |

**What the email shows** (the popup's details, never a secret):
- **Subject:** "{sharer} shared “{credential}” ({code}) with you" (or "with your team {team}"), with a "Share updated:" prefix on a renewal.
- **The credential:** name, CRD- / CCRD- ID, type, username or host (masked when it is a secret id), group and risk badge.
- **Team shares:** the team name and its member count.
- **Permission:** with its description.
- **What you can do:** the popup's six ticks and crosses. Use Only gives sign in; View adds see the password; Copy adds copy it; Full Access adds edit, re-share and delete.
- **Access until:** "{Permission} access until dd/mm/yyyy, then revoked automatically", or no end date.
- **The reason**, who shared it (and their designation) and when, plus an **Open in CredVault** button (My Vault).
- **Critical credentials:** a note that opening it needs the unlock approvals.

**The response** adds `data.mail`:

```json
"mail": { "status": "sent", "recipients": 6, "sent": 6, "failed": 0, "copy_to": "php@inhpl.com" }
```

| `status` | Meaning |
|---|---|
| `sent` | Every email went out |
| `partly_sent` / `failed` | Some or all failed: logged, and the share still stands |
| `mail_off` | Email is turned off by the platform admin |
| `no_recipients` | Nobody with a valid email to send to |

The message adds "Email sent to N people.", and the audit log gets "Share email to {recipient}: N sent".

Related endpoints:
- `GET /credvault/share-recipients?q=` — who it can be shared with.
- `GET /credvault/shares` — Shared By Me (below).
- `GET /normal-vault/credentials?tab=shared` — Shared With Me.
- `DELETE /credvault/shares/{id}` — revoke; again → 409.

### Shared By Me — `GET /credvault/shares`

Every share on a credential you own, or that you made. The tab counts (`tabs`) ignore the search and the filters.

| Query | Values |
|---|---|
| `tab` | `all` \| `active` \| `soon` (expiring within 3 days) \| `expired` \| `revoked` |
| `q` | credential ID / name / group / type, a person, a team, the reason, a permission label |
| `credential_id` | one credential |
| `permission` | `use` \| `view` \| `copy` \| `full`, or several: `view,copy` |
| `recipient_type` + `recipient_id` | `user` or `team`, and optionally one person or team (`recipient_id` needs `recipient_type`) |
| `vault` · `risk` · `type` · `group` | the credential's vault, risk, type key, group |
| `shared_from` · `shared_to` | the share date, `Y-m-d`, in `tz` |
| `expires_from` · `expires_to` | the expiry date, `Y-m-d`, in `tz` |
| `sort` · `dir` | `status` (default: expiring soon first, then active, expired, revoked) \| `shared_at` \| `expires_at` \| `name`; `asc` \| `desc` |
| `tz` | the viewer's timezone for the dates shown and the date filters |
| `page` · `per_page` | paging, 10 a page by default |

**Refusals (422):**
- an unknown permission;
- `recipient_id` without `recipient_type`;
- a `…_to` date before its `…_from` date;
- a bad date or timezone.

**Response:**
- `{ data: [rows], tabs: {all, active, soon, expired, revoked, live}, filters: {the ones applied}, meta: {current_page, per_page, total, last_page} }`;
- `live` = active + soon, for the "Shared By Me" badge.

Each row is the table's line, ready to show:

```json
{
  "sr_no": 1,
  "id": 41,
  "credential": { "id": 5, "code": "CRD-0005", "vault": "normal", "name": "GST Portal", "type": "login", "type_label": "Login",
                  "category_group": "Logins & Access", "risk": "high", "url": "https://gst.gov.in", "username": "inhpl", "created_on": "29/10/2026" },
  "recipient": { "type": "user", "id": 35, "name": "Neha Patel", "initials": "NP", "sub": "Finance Controller" },
  "permission": "copy", "permission_label": "Copy",
  "shared_at": "2026-10-28T05:39:00+00:00", "shared_on": { "date": "28/10/2026", "time": "11:09" },
  "expires_at": "2026-11-04T05:39:00+00:00", "expires": { "date": "04/11/2026", "left": "19h left" },
  "reason": "GST return filing for October",
  "state": "soon", "status_label": "Expiring soon",
  "can": { "view": true, "share": true, "revoke": true }
}
```

**The cells:**
- **Team row:** `recipient` is `{ "type": "team", "name": "IT Operations", "initials": "IO", "members": 8, "sub": "Team · 8 members" }`.
- **`expires.left`:** `"19h left"` under a day, `"7 days left"`, `"No expiry"`, `"Expired"`, or `"Revoked"`.
- **`status_label`:** Active · Expiring soon · Expired · Revoked.
- **`can`** drives the row's View / Share / Revoke buttons. Revoke is only possible on a live share.

### Shared by both vaults

`GET /credentials/{id}` (view) · `POST …/reveal` · `POST …/events` · `GET …/activity` · `GET …/attachments/{key}` (download a file)

### Recycle Bin — 4 tabs × Normal / Critical

The Recycle Bin screen. The Postman collection **"Recycle Bin"** holds only these APIs: [CredVault_RecycleBin.postman_collection.json](CredVault_RecycleBin.postman_collection.json), 6 folders and 45 requests:
- 00 Setup (3 logins);
- 01 Prepare (moves 3 Normal and 2 Critical items to the bin);
- 02 `GET /recycle-bin`;
- 03 `GET | PUT /recycle-bin/retention`;
- 04 restore / delete one item;
- 05 Empty Bin.

To use it, fill `email`/`password` (an employee), `branchEmail`/`branchPassword` (that employee's Branch Admin) and `adminEmail`/`adminPassword` (a client admin), then run the folders in order.

| Request | What it does |
|---|---|
| `GET /credvault/recycle-bin?vault=normal\|critical&tab=all\|mine\|team\|soon&q=&page=&per_page=` | The list, the counts and the cards |
| `POST /credvault/recycle-bin/{id}/restore` | Back to its vault: My Vault, Team Vault or Critical Vault |
| `DELETE /credvault/recycle-bin/{id}` `{ confirm: true }` | Delete one item for good |
| `DELETE /credvault/recycle-bin` `{ confirm: true, vault?: all\|normal\|critical }` | **Empty Bin.** `all` (the default) empties **both vaults in one call** |
| `GET /credvault/recycle-bin/retention` | The Change period popup: Normal's period and options, Critical's fixed period |
| `PUT /credvault/recycle-bin/retention` `{ days: 7\|15\|30\|60\|90, vault?: normal }` | Change the **Normal Vault** period (Vault Admins) |

**Tabs.** There are four tabs: All Items, Deleted by Me, Team Credentials and Expiring Soon. Each has a Normal Vault and a Critical Vault sub-tab, and `vault` (default `normal`) picks the sub-tab. Expiring Soon means 7 days or less left. **Every badge comes back in one call, and the counts follow the search box:**

```
"tabs":   { "all": 2, "mine": 2, "team": 0, "soon": 1 },              ← the chosen vault
"counts": { "normal":   { "all": 2, "mine": 2, "team": 0, "soon": 1 },
            "critical": { "all": 1, "mine": 1, "team": 0, "soon": 0 },
            "total":    { "all": 3, "mine": 3, "team": 0, "soon": 1 } }
```

**`summary`.** The cards, for the chosen vault:
- `retention_days`;
- `retention_fixed` (true for Critical);
- `can_change_retention` (Normal and Vault Admin only);
- `retention_options` (empty for Critical);
- `items`, `deleted_by_me`, `expiring_soon`, `critical`;
- `next_deletion { name, at, days }`;
- `purge_allowed`, `can_empty`.

**Rows (`data[]`).** Each row has:
- `sr_no`, `code`, `vault`, `name`, `type_label`, `category_group`, `url`, `scope` / `scope_label`, `risk`;
- `owner { name, initials }`, `deleted_by { name ("You"), initials }`, `deleted_at`;
- `purges_at`, `days_left`, `left_pct`, `urgency` (ok · warn · bad);
- **`can_restore`**, **`can_purge`**, and `locked_reason` when the user may not act.

**Rules**

| Rule | Normal Vault | Critical Vault |
|---|---|---|
| Retention period | The Vault Admin chooses it with Change period: 7 · 15 · 30 · 60 · 90 days. A shorter period deletes the items already past it, right away. | **Fixed 30 days.** No Change period is offered; `PUT …/retention` with `vault: critical` → 422 "…its period cannot be changed." |
| Who sees an item | Its owner, whoever binned it, the Vault Admin (team items), and the Branch Admin (the branch's team items) | The same, and the **Branch Admin sees every Critical item of the branch** |
| Restore / delete | Whoever sees it | **The Branch Admin of the item's branch only.** Anyone else gets 403 "Only the Branch Admin can restore or delete Critical Vault items in the Recycle Bin." |
| Empty Bin (`vault: all`) | Everything the caller sees | The Branch Admin's: every Critical item of the branch. For anyone else, critical items are left and counted in `skipped.critical`. |

**Empty Bin response:**

```
{ "deleted": { "normal": 2, "critical": 1, "total": 3 }, "skipped": { "critical": 0, "reason": null } }
```

- Emptying an empty bin → 409.
- Emptying only Critical as someone who isn't the Branch Admin → 403.
- No `confirm` → 422.
- When permanent delete is off in Policies, deleting and emptying → 403.
- Moving a credential to the bin returns its vault and its own period, and for a critical credential says "restorable by the Branch Admin".

**Tested (05/11/2026):**
- **Rules:** 42/42 checks. These covered the counts for both vaults, the Expiring Soon tab, the search, each person's view (employee, the Branch Admins of two branches, the Vault Admin), restore and delete per person, retention (a shorter Normal period deletes old Normal items but not a 25-day-old Critical one), and Empty Bin per person.
- **Collection:** 42/42 requests (the 3 logins are done in-process), all inside a transaction that was rolled back, so no data changed.

---

## 3. The 25 types — payload of each create

The same fields in both vaults, under `fields[…]`. The columns:
- **Files:** what the multipart body carries.
- **Extras:** the Recovery & Proof fields, sent top-level.
- **Normal risk:** the starting risk in the Normal Vault.
- **Critical 2-step key:** what turns 2-step on in the Critical Vault.

| # | Type | Group | Required `fields` | Optional `fields` | Files | Extras | Normal risk | Critical 2-step key |
|---|---|---|---|---|---|---|---|---|
| 1 | Login (`login`) | Logins & Access | `url`, `username`, `password` | — | `attachments[0..4]` — up to 5 | `reg_email`, `reg_phone`, `recovery_key` | medium | `twofa: true` (the type's 2FA switch) |
| 2 | Password (`password`) | Logins & Access | `username`, `password` | `url` | `attachments[0..4]` — up to 5 | `reg_email`, `reg_phone`, `recovery_key` | medium | `fields.twofa: "yes"` |
| 3 | Email (`email`) | Logins & Access | `email`, `provider` (Google Workspace · Microsoft 365 · Zoho Mail · Other), `password` | `recovery` | `attachments[0..4]` — up to 5 | `reg_phone`, `recovery_key` | high | `twofa: true` (the type's 2FA switch) |
| 4 | Passkey (`passkey`) | Logins & Access | `url`, `username`, `device` (Security key (YubiKey) · Windows Hello · iCloud Keychain · Google Password Manager · Android device · Other) | `created` | `attachments[0..4]` — up to 5 | `reg_email`, `reg_phone`, `recovery_key` | medium | `twofa: true` (the type's 2FA switch) |
| 5 | TOTP / 2FA Seed (`totp`) | Logins & Access | `service`, `account`, `seed` | `digits` (6 digits · 8 digits), `period` (30 seconds · 60 seconds), `backup` | `attachments[0..4]` — up to 5 | `reg_email`, `reg_phone` | high | `lock_otp: true` |
| 6 | Credit Card (`card`) | Finance & Banking | `holder`, `cardno`, `exp`, `cvv` | `issuer`, `pin` | `attachments[0..4]` — up to 5 | `reg_email`, `reg_phone` | high | `lock_otp: true` |
| 7 | Bank Account (`bank`) | Finance & Banking | `bank`, `holder`, `acno`, `ifsc` | `nbuser`, `nbpass` | `attachments[0..4]` — up to 5 | `reg_email`, `reg_phone`, `recovery_key` | high | `twofa: true` (the type's 2FA switch) |
| 8 | Crypto Wallet (`crypto`) | Finance & Banking | `wallet`, `address`, `seed` | `wpass` | `attachments[0..4]` — up to 5 | `reg_email`, `reg_phone` | high | `twofa: true` (the type's 2FA switch) |
| 9 | Rewards (`rewards`) | Finance & Banking | `program`, `member` | `password` | `attachments[0..4]` — up to 5 | `reg_email`, `reg_phone`, `recovery_key` | low | `lock_otp: true` |
| 10 | API Credentials (`api`) | Development & IT | `service`, `apikey`, `secret` | `endpoint`, `expiry` | `attachments[0..4]` — up to 5 | `reg_email`, `reg_phone` | high | `lock_otp: true` |
| 11 | SSH Key (`ssh`) | Development & IT | `host`, `username`, `privkey` | `passphrase` | `attachments[0..4]` — up to 5 | — | high | `lock_otp: true` |
| 12 | Database (`database`) | Development & IT | `engine` (MySQL · PostgreSQL · SQL Server · MongoDB · Oracle · Other), `host`, `port`, `dbname`, `username`, `password` | — | `attachments[0..4]` — up to 5 | — | high | `lock_otp: true` |
| 13 | Server (`server`) | Development & IT | `host`, `username`, `password` | `os` (Linux · Windows Server · macOS · Other), `port` | `attachments[0..4]` — up to 5 | — | high | `lock_otp: true` |
| 14 | Certificate (`cert`) | Development & IT | `domain`, `expiry` | `issuer`, `kpass` | `files[file]` — Certificate File (required) | `reg_email`, `reg_phone` | high | `lock_otp: true` |
| 15 | Software License (`license`) | Development & IT | `product`, `lkey` | `licto`, `seats`, `expiry` | `attachments[0..4]` — up to 5 | `reg_email`, `reg_phone` | medium | `lock_otp: true` |
| 16 | Wireless Router (`wifi`) | Development & IT | `ssid`, `security` (WPA3 · WPA2 · WPA2/WPA3 · WEP · Open), `password` | `admin`, `apass` | `attachments[0..4]` — up to 5 | — | medium | `lock_otp: true` |
| 17 | Identity (`identity`) | Identity & Documents | `fullname` | `dob`, `phone`, `email`, `address` | `attachments[0..4]` — up to 5 | — | medium | `lock_otp: true` |
| 18 | Passport (`passport`) | Identity & Documents | `fullname`, `number`, `expiry` | `nationality`, `issue` | `files[file]` — Passport Scan (optional) | — | high | `lock_otp: true` |
| 19 | Driver License (`driver`) | Identity & Documents | `fullname`, `number`, `expiry` | `state` | `files[file]` — License Scan (optional) | — | medium | `lock_otp: true` |
| 20 | SSN / Aadhaar / PAN (`govid`) | Identity & Documents | `idtype` (Aadhaar · PAN · SSN · Voter ID), `number`, `name` | — | `files[file]` — ID Scan (optional) | `reg_email`, `reg_phone` | high | `lock_otp: true` |
| 21 | Document (`document`) | Identity & Documents | — | `docno`, `issued`, `expiry` | `files[file]` — Attachment (required) | — | medium | `lock_otp: true` |
| 22 | Secure Note (`note`) | Personal & Lifestyle | `note` | — | `attachments[0..4]` — up to 5 | — | low | `lock_otp: true` |
| 23 | Membership (`membership`) | Personal & Lifestyle | `org`, `member` | `expiry`, `password` | `attachments[0..4]` — up to 5 | `reg_email`, `reg_phone`, `recovery_key` | low | `lock_otp: true` |
| 24 | Medical Record (`medical`) | Personal & Lifestyle | `patient`, `policy` | `provider` | `files[file]` — Report / Policy File (optional) | `reg_email`, `reg_phone` | high | `lock_otp: true` |
| 25 | Outdoor License (`outdoor`) | Personal & Lifestyle | `ltype`, `number`, `expiry` | `issued` | `attachments[0..4]` — up to 5 | — | low | `lock_otp: true` |

**On every type:**
- **Fields:**
  - top-level `type` and `name` (required, 2–150 characters);
  - optional `notes` (up to 5,000);
  - `scope` (`personal` \| `team`) and `department_id` (team only);
  - `rotation_days` (30 / 60 / 90 / 180) when the main secret is a password.
- **Values the server checks:**
  - card number (Luhn) and expiry (MM/YY, not past);
  - CVV (3–4 digits) and PIN (4–6 digits);
  - IFSC;
  - port (1–65535);
  - TOTP seed (base32) and crypto seed (12–24 words);
  - dates (YYYY-MM-DD);
  - select values (from the list above);
  - URL, email and phone (10–16 digits).
- **Password strength:** a password weaker than the policy minimum is refused (422).

### Edit — the 25 types (every field, form-data)

The Edit request of each type sends **the same body as its create**: every field of the type with new values, the Recovery & Proof extras, notes, risk and scope, and new files. It goes as **form-data**, so images and documents are updated in the same call.

| | Normal Vault | Critical Vault |
|---|---|---|
| Request | `POST /normal-vault/credentials/{id}` (form-data) | `POST /critical-vault/credentials/{id}` (form-data) |
| Why POST | PHP reads no form-data body on a PUT. `PUT` works for a JSON-only edit with no files. | The same |
| Body | `name`, `risk` (low–high), `scope`, `notes`, `fields[<key>]` for **every** field of the type, `reg_email` / `reg_phone` / `recovery_key` where the type has them, `twofa`, `rotation_days`, and the files | The same, with `risk=critical`, plus `lock_admin`, `lock_manager` and `lock_otp` sent unchanged |
| Files | `attachments[0]`, `attachments[1]` (up to 5 in all) are **added** to the stored ones · `files[file]` **replaces** the stored file | The same |
| Removing a file | `PUT … { "remove_attachments": ["att-…"] }` (or the same key in the form-data) | The same |

The **fields** each type's Edit sends, all with new values:

| Type | `fields[…]` sent |
|---|---|
| Login | `url`, `username`, `password` |
| Password | `url`, `username`, `password`, `twofa` |
| Email | `email`, `provider`, `password`, `recovery` |
| Passkey | `url`, `username`, `device`, `created` |
| TOTP / 2FA Seed | `service`, `account`, `seed`, `digits`, `period`, `backup` |
| Credit Card | `holder`, `cardno`, `issuer`, `exp`, `cvv`, `pin` |
| Bank Account | `bank`, `holder`, `acno`, `ifsc`, `nbuser`, `nbpass` |
| Rewards | `program`, `member`, `password` |
| API Credentials | `service`, `endpoint`, `apikey`, `secret`, `expiry` |
| Database | `engine`, `host`, `port`, `dbname`, `username`, `password` |
| Server | `host`, `os`, `port`, `username`, `password` |
| Certificate | `domain`, `issuer`, `expiry`, `kpass` |
| Software License | `product`, `lkey`, `licto`, `seats`, `expiry` |
| Wireless Router | `ssid`, `security`, `password`, `admin`, `apass` |
| Identity | `fullname`, `dob`, `phone`, `email`, `address` |
| Passport | `fullname`, `number`, `nationality`, `issue`, `expiry` |
| Driver License | `fullname`, `number`, `state`, `expiry` |
| SSN / Aadhaar / PAN | `idtype`, `number`, `name` |
| Document | `docno`, `issued`, `expiry` |
| Secure Note | `note` |
| Membership | `org`, `member`, `expiry`, `password` |
| Medical Record | `patient`, `provider`, `policy` |
| Outdoor License | `ltype`, `number`, `issued`, `expiry` |

**Partial edits work too:** a field left out keeps its value, and a secret left out is never needed again. `type` and `vault` can't change.

**Critical Vault edits:**
- **Details:** changing every detail field keeps the 2-step link, with no new code needed: send `lock_*` unchanged. The steps stay `admin, manager, otp`.
- **Protection:** changing the steps, approvers, 2-step method or inbox is for the owner or a Vault Admin only (403 for anyone else). Switching the method needs a fresh proof: `totp_secret` + `totp_code`, or `twofa_email` + `email_otp_token`.
- **Risk:** sending a risk other than critical → 422.

**Normal Vault edits:** a risk of `critical` → 422. A HOD or Full share may edit everything except moving the scope or team (403).

### Files on a create or edit

| | Attachments box (19 types) | Own file field (6 types) |
|---|---|---|
| Types | every type above with `attachments[0..4]` | Certificate, Document (**required**); Passport, Driver License, SSN / Aadhaar / PAN, Medical Record (optional) |
| Key | `attachments[0]` … `attachments[4]` | `files[file]` |
| Allowed | pdf, png, jpg, jpeg, webp, doc, docx, xls, xlsx, csv, txt | pdf, jpg, jpeg, png, pem, crt, cer, pfx |
| Limit | 5 files, 10 MB each | 1 file, 10 MB |
| Edit | `POST …/credentials/{id}` with more `attachments[n]` adds to them; `PUT … { "remove_attachments": ["att-xxxxxxxx"] }` removes one | a new `files[file]` replaces the stored one |
| Download | `GET /credentials/{id}/attachments/{key}` — `key` is `att-…` for an attachment, `file` for the type's file field | |

Files are stored on the private disk under `credvault/<client>/<credential>/` and are served only through the download endpoint. A create returns the list in `data.attachments` (key, name, size, mime), never the path.

### Example — Normal Vault, Login (multipart)

```
POST /api/credvault/normal-vault/credentials
type=login
name=Zoho Books Admin
risk=medium
scope=personal
twofa=1
rotation_days=90
notes=Accounts team
fields[url]=https://books.zoho.in
fields[username]=accounts@inhpl.com
fields[password]=Zb!Accounts-2026#Strong
reg_email=accounts@inhpl.com
reg_phone=+91 98200 11223
recovery_key=RECOVERY-7Q2K-9XZM
attachments[0]=<file: invoice.pdf>
attachments[1]=<file: screenshot.png>
→ 201  data.code = "CRD-0001", data.vault = "normal", data.lock_steps = [], data.attachments = [2 files]
```

### Example — Critical Vault, Server, Google 2-step (multipart)

```
POST /api/credvault/critical-vault/credentials
type=server
name=Production root
risk=critical
fields[host]=10.0.0.15
fields[os]=Linux
fields[port]=22
fields[username]=root
fields[password]=R00t!Server-2026#Strong
lock_admin=1
lock_manager=1
lock_otp=1
twofa_method=google
totp_secret=<from two-step/google/new>
totp_code=<6 digits from the app>
attachments[0]=<file: access-approval.pdf>
→ 201  data.code = "CCRD-0001", data.lock_steps = ["admin","manager","otp"], data.two_step = { method: "google", linked: true }
```

**With the email method instead:**
- Replace the last two lines with:
  - `twofa_method=email`
  - `twofa_email=php@inhpl.com`
  - `email_otp_token=<token from two-step/email/send, verified by email/verify>`
- A token links one credential, once.

**Refusals (422, keyed by field):**

| Field | When |
|---|---|
| `risk` | The wrong risk for the vault |
| `fields.<key>` / `files.file` | A missing or invalid value |
| `attachments` | More than 5 files |
| `attachments.N` | A disallowed type, or over 10 MB |
| `twofa_method` | 2-step on with no method |
| `totp_code` | A wrong app code |
| `email_otp_code` | An unverified or used email token |
| `lock_admin` | Every step off |
| `name` | A duplicate name |

---

## 4. The Postman collection

| # | Folder | Requests | What it covers |
|---|---|---|---|
| 00 | Setup | 4 | 3 logins (requester, Vault Admin, manager), meta |
| 01 | Generate Password | 19 | Characters and passphrase modes, the 6 refusals, use it in an add, rotate it |
| 02 | **Add Normal Vault** | 28 | Next CRD- code; **Add 01 … Add 25**, one per type, form-data with files; risk critical → 422; missing field → 422 |
| 03 | **Edit Normal Vault** | 30 | **Edit 01 … Edit 25**: every field with a new value plus new files (form-data POST); add an attachment, download it, remove it; a JSON-only PUT; risk critical → 422 |
| 04 | **Get Normal Vault (list)** | 11 | Tabs all / mine / team / shared / others; search; filter by type, group and risk; paging; the shared list with `?vault=normal`. Every row is checked: vault, strength name, no percentage |
| 05 | **Get single Normal Vault** | 27 | **Get single 01 … 25**, one per type. Each is checked: open, every field of the type returned **in plain text** (none masked) with `all_values`, strength name. Plus reveal and activity |
| 06 | Delete Normal Vault | 2 | To the Recycle Bin; get single afterwards → 404 |
| 07 | **Add Critical Vault** | 33 | Next CCRD- code; approvers; Google new secret and check; **Add 01 … Add 25** with approvals, Google 2-step and files; refusals: risk high, no method, all steps off, wrong code |
| 08 | **Edit Critical Vault** | 30 | **Edit 01 … Edit 25**: every field plus new files, the lock kept, no new code; rename only; manager step off; risk high → 422; cross-vault ids → 404 both ways |
| 09 | **Get Critical Vault (list)** | 9 | Tabs all / mine / others; search; filters; paging; `?vault=critical` |
| 10 | **Get single Critical Vault** | 26 | **Get single 01 … 25**. Each is checked: locked, the unlock plan, no fields and no values, strength name. Plus reveal while locked → 423 |
| 11 | Delete Critical Vault | 2 | To the Recycle Bin (owner / Vault Admin); get single afterwards → 404 |
| 12 | **Team Vault** | 24 | Departments (admin card + department cards) and search; one department (stats, the Admin chip first, members, tree); unknown department → 404; organisation (View all); add a team credential; table: My Credentials, Team Credentials for a department, search, a member's credentials, critical team credentials; **Export**: a colleague's team credential; popup counts for My, for Team, with categories ticked; files: Team CSV, two categories, JSON with filters, My CSV, with passwords; refusals: not acknowledged, wrong account password, no tab; history |
| 13 | **Share — person or team, with email** | 38 | Recipients and search; Individual View 7 days (email to 1); renew as Copy 30 days ("Share updated" email); **Team Use Only 30 days (email to every member)**; Full Access with an `expires_at` date; Critical View 1 day; refusals: Full on critical, no reason, beyond the policy maximum; **Shared By Me: all 5 tabs, search, credential, permission (one / several), teams, one person, one team, vault, risk, type, group, shared-on and expires ranges, combined filters, 3 sorts, paging, 2 refusals**; Shared With Me; revoke, revoke again → 409 |
| 14 | Email 2-step | 7 | Send, verify, add with email; the same token again → 422; switch an existing credential to email |
| 15 | Unlock | 24 | The full Google unlock and the full email unlock (request → admin → manager → code → reveal → lock), reject, cancel, lists |

**How to run it:**
1. Fill `baseUrl`, `email` / `password`, `adminEmail` / `adminPassword`, `managerEmail` / `managerPassword`.
2. Run the folders in order (00 → 13). Ids are saved as `normal_<type>_id` / `critical_<type>_id` and used by the later Edit, Get and Delete folders.
3. **Files — one-time Postman setting.** Every file row already points at a sample file in `docs/postman-samples/`: `credvault-sample.pdf` for `files[file]` and `attachments[0]`, `credvault-sample.png` for `attachments[1]`. Postman reads files only from its working directory, so do one of these:
   - **Settings → General → Working directory:** set it to `C:/xampp/htdocs/Cross_Border_Command/docs/postman-samples`; or
   - **Settings → General:** turn on **"Allow reading files outside working directory"**.

   To send your own image or document instead, click the file cell and pick it.
   - *"Error: EISDIR: illegal operation on a directory, read"* means a file row has no file. That happened with the earlier export, where the rows were empty. Re-import the collection, or pick a file in each ticked file row (or untick the row).
4. For email, paste the 6-digit code from `otpInbox` (php@inhpl.com) into `emailOtpCode`.

### Result (03/11/2026, real HTTP, test rows only)

| Check | Result |
|---|---|
| The collection, top to bottom | **310 passed, 0 failed** (3 logins skipped: the runner uses ready-made tokens) |
| Share emails, read back from the mail log | **19 / 19**: one email to the person; subject with sharer, credential and code; View with its description; the six can-do ticks match the permission; the end date; reason, risk, username and greeting; the open link; **no password**; renewal sends "Share updated" with Copy; a team share sends one email for all 6 members with "your team Export-Import (7 members)"; Use Only shows only sign in; bell notifications for all recipients; each email in the audit log; a critical share notes the unlock approvals and hides the account number; a refused share sends nothing |
| Team Bcc, in-process (`Mail::fake`) | Bcc = exactly the 6 team members, the sharer excluded; `mail.sent = 6` |
| Shared By Me + the copy | **34 / 34**: `copy_to` php@inhpl.com, and Cc php@inhpl.com on all 5 share emails (person and team); the row cells (sr_no, code, url, created_on, vault, recipient name / initials / designation / team members, permission label, shared_on date and time, `expires.left` "24h left" / "7 days left", status labels, `can`, revoked rows can't be revoked); expiring soon first; tab counts; every filter (permission one and several, team, one person, vault, risk, type, group, 3 tabs, shared-on and expires ranges, search, combined); sort by expiry and by name; paging; echoed filters; 3 refusals |
| Get single in plain text | **14 / 14**: the owner gets every value (password, account number, recovery key, registered email and phone, notes) and an exact `all_values`; secret fields come back with `secret: true, masked: false`; the read is in the audit log as a reveal; create and edit responses carry no secret; a View share sees everything; a Use Only share sees no secret, no `all_values`, no notes; a locked critical credential shows no fields and no values, and after the unlock the password in plain text; the 2-step secret is never returned |
| Team Vault | **22 / 22**: the admin card (Vault Admin, members = the level bar total, departments, HODs); department cards (HOD name, initials and role, members = their level bar, credential counts) and search; the department view (stats, the Admin chip first, the tree rooted at the Vault Admin with **every member exactly once** and every `children_count` / `team_size` right, a manager holding their reports); 404; the organisation (department nodes, every member once); a team credential shows under Team Credentials for another member with tab counts and the full row, under My Credentials for its owner, in the member filter, in search, and in the department's count |
| Export Credentials | **23 / 23**: popup counts equal the table's My and Team tab counts (and the department); 5 categories add up to the total; ticked categories give the selected count; the old `scope=personal` key still works; the Team CSV has as many rows as the popup said, every table column in order, a team row with its values as the table shows them (type, category, username, owner, Access "Team", department, vault, strength, notes, created date), Sr. No 1…n, no password column unless asked; the category filter; search + JSON; the type filter; the My export (owner only, Access "Personal", the my- file name); 4 refusals; the history. (An export *with* passwords needs a real account password, so it's left for Postman.) |
| Real SMTP (one email to php@inhpl.com) | **Failed: Gmail refused the login** — see §6 |
| Every credential read back through the API, both lists and all 50 singles | **590 / 590**: right vault and prefix; every field of each Normal credential in plain text and equal to `all_values`; strength a name (never a percentage) and equal to the stored level; every field of each Normal credential returned with its edited value; secrets masked; files present; Critical ones locked with an unlock plan and no fields |
| Every saved field compared in the database (decrypted) with its Edit request | All match on the 45 that keep their edited values. The other 5 are changed again by later requests on purpose (a password-only edit and an attachment note, the Critical note's Manager step turned off, and the 2 deleted) |
| Files | 4 attachments on each Attachments-box type (2 from the add, 2 from the edit); the file replaced on each file-field type |

## 5. Data after the test run

The 50 live credentials that the run left, read from `GET /normal-vault/credentials` and `GET /critical-vault/credentials`. The deleted Normal note and Critical outdoor license are in the Recycle Bin. These rows were then removed: the clean-up deletes only rows the run created.

| # | Vault | ID | Name | Category | Group | Username | Risk | Strength | 2FA | Files | Lock steps | 2-step |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Normal | CRD-0028 | Generated login | Login | Logins & Access | ops | Medium | Strong | Not enabled | — | — | — |
| 2 | Normal | CRD-0029 | Login · My Vault (edited) | Login | Logins & Access | finance@inhpl.com | High | Strong | Enabled | 4 (attachments) | — | — |
| 3 | Normal | CRD-0030 | Password · My Vault (edited) | Password | Logins & Access | wiki.owner | High | Strong | Enabled | 4 (attachments) | — | — |
| 4 | Normal | CRD-0031 | Email · My Vault (edited) | Email | Logins & Access | md@inhpl.com | High | Strong | Enabled | 4 (attachments) | — | — |
| 5 | Normal | CRD-0032 | Passkey · My Vault (edited) | Passkey | Logins & Access | inhpl-ops | High | — | Enabled | 4 (attachments) | — | — |
| 6 | Normal | CRD-0033 | TOTP / 2FA Seed · My Vault (edited) | TOTP / 2FA Seed | Logins & Access | admin@inhpl.onmicrosoft.com | High | — | — | 4 (attachments) | — | — |
| 7 | Normal | CRD-0034 | Credit Card · My Vault (edited) | Credit Card | Finance & Banking | INHPL Treasury | High | — | — | 4 (attachments) | — | — |
| 8 | Normal | CRD-0035 | Bank Account · My Vault (edited) | Bank Account | Finance & Banking | •••• 5678 | High | Strong | Enabled | 4 (attachments) | — | — |
| 9 | Normal | CRD-0036 | Crypto Wallet · My Vault (edited) | Crypto Wallet | Finance & Banking | Treasury Ledger (cold) | High | — | Enabled | 4 (attachments) | — | — |
| 10 | Normal | CRD-0037 | Rewards · My Vault (edited) | Rewards | Finance & Banking | MB87654321 | Medium | Strong | — | 4 (attachments) | — | — |
| 11 | Normal | CRD-0038 | API Credentials · My Vault (edited) | API Credentials | Development & IT | Razorpay API | High | — | — | 4 (attachments) | — | — |
| 12 | Normal | CRD-0039 | SSH Key · My Vault (edited) | SSH Key | Development & IT | prod-02.inhpl.com | High | — | — | 4 (attachments) | — | — |
| 13 | Normal | CRD-0040 | Database · My Vault (edited) | Database | Development & IT | erp_ro | High | Strong | — | 4 (attachments) | — | — |
| 14 | Normal | CRD-0041 | Server · My Vault (edited) | Server | Development & IT | Administrator | High | Strong | — | 4 (attachments) | — | — |
| 15 | Normal | CRD-0042 | Certificate · My Vault (edited) | Certificate | Development & IT | portal.inhpl.com | High | Strong | — | 1 (file field) | — | — |
| 16 | Normal | CRD-0043 | Software License · My Vault (edited) | Software License | Development & IT | Adobe Acrobat Pro | High | — | — | 4 (attachments) | — | — |
| 17 | Normal | CRD-0044 | Wireless Router · My Vault (edited) | Wireless Router | Development & IT | INHPL-Guest | High | Strong | — | 4 (attachments) | — | — |
| 18 | Normal | CRD-0045 | Identity · My Vault (edited) | Identity | Identity & Documents | Sai Anand Pawar | High | — | — | 4 (attachments) | — | — |
| 19 | Normal | CRD-0046 | Passport · My Vault (edited) | Passport | Identity & Documents | •••• 4321 | High | — | — | 1 (file field) | — | — |
| 20 | Normal | CRD-0047 | Driver License · My Vault (edited) | Driver License | Identity & Documents | •••• 4321 | High | — | — | 1 (file field) | — | — |
| 21 | Normal | CRD-0048 | SSN / Aadhaar / PAN · My Vault (edited) | SSN / Aadhaar / PAN | Identity & Documents | Sai Anand Pawar | High | — | — | 1 (file field) | — | — |
| 22 | Normal | CRD-0049 | Document · My Vault (edited) | Document | Identity & Documents | AGR-2027-002 | High | — | — | 1 (file field) | — | — |
| 23 | Normal | CRD-0051 | Membership · My Vault (edited) | Membership | Personal & Lifestyle | RW-1102 | Medium | Strong | — | 4 (attachments) | — | — |
| 24 | Normal | CRD-0052 | Medical Record · My Vault (edited) | Medical Record | Personal & Lifestyle | Sai Anand Pawar | High | — | — | 1 (file field) | — | — |
| 25 | Normal | CRD-0053 | Outdoor License · My Vault (edited) | Outdoor License | Personal & Lifestyle | •••• -118 | Medium | — | — | 4 (attachments) | — | — |
| 26 | Critical | CCRD-0001 | Login · Critical (edited) | Login | Logins & Access | finance@inhpl.com | Critical | Strong | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 27 | Critical | CCRD-0002 | Password · Critical (edited) | Password | Logins & Access | wiki.owner | Critical | Strong | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 28 | Critical | CCRD-0003 | Email · Critical (edited) | Email | Logins & Access | md@inhpl.com | Critical | Strong | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 29 | Critical | CCRD-0004 | Passkey · Critical (edited) | Passkey | Logins & Access | inhpl-ops | Critical | — | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 30 | Critical | CCRD-0005 | TOTP / 2FA Seed · Critical (edited) | TOTP / 2FA Seed | Logins & Access | admin@inhpl.onmicrosoft.com | Critical | — | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 31 | Critical | CCRD-0006 | Credit Card · Critical (edited) | Credit Card | Finance & Banking | INHPL Treasury | Critical | — | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 32 | Critical | CCRD-0007 | Bank Account · Critical (edited) | Bank Account | Finance & Banking | •••• 5678 | Critical | Strong | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 33 | Critical | CCRD-0008 | Crypto Wallet · Critical (edited) | Crypto Wallet | Finance & Banking | Treasury Ledger (cold) | Critical | — | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 34 | Critical | CCRD-0009 | Rewards · Critical (edited) | Rewards | Finance & Banking | MB87654321 | Critical | Strong | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 35 | Critical | CCRD-0010 | API Credentials · Critical (edited) | API Credentials | Development & IT | Razorpay API | Critical | — | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 36 | Critical | CCRD-0011 | SSH Key · Critical (edited) | SSH Key | Development & IT | prod-02.inhpl.com | Critical | — | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 37 | Critical | CCRD-0012 | Database · Critical (edited) | Database | Development & IT | erp_ro | Critical | Strong | Enabled | 4 (attachments) | admin, manager, otp | Email code (linked) |
| 38 | Critical | CCRD-0013 | Server · renamed | Server | Development & IT | Administrator | Critical | Strong | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 39 | Critical | CCRD-0014 | Certificate · Critical (edited) | Certificate | Development & IT | portal.inhpl.com | Critical | Strong | Enabled | 1 (file field) | admin, manager, otp | Authenticator (linked) |
| 40 | Critical | CCRD-0015 | Software License · Critical (edited) | Software License | Development & IT | Adobe Acrobat Pro | Critical | — | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 41 | Critical | CCRD-0016 | Wireless Router · Critical (edited) | Wireless Router | Development & IT | INHPL-Guest | Critical | Strong | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 42 | Critical | CCRD-0017 | Identity · Critical (edited) | Identity | Identity & Documents | Sai Anand Pawar | Critical | — | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 43 | Critical | CCRD-0018 | Passport · Critical (edited) | Passport | Identity & Documents | •••• 4321 | Critical | — | Enabled | 1 (file field) | admin, manager, otp | Authenticator (linked) |
| 44 | Critical | CCRD-0019 | Driver License · Critical (edited) | Driver License | Identity & Documents | •••• 4321 | Critical | — | Enabled | 1 (file field) | admin, manager, otp | Authenticator (linked) |
| 45 | Critical | CCRD-0020 | SSN / Aadhaar / PAN · Critical (edited) | SSN / Aadhaar / PAN | Identity & Documents | Sai Anand Pawar | Critical | — | Enabled | 1 (file field) | admin, manager, otp | Authenticator (linked) |
| 46 | Critical | CCRD-0021 | Document · Critical (edited) | Document | Identity & Documents | AGR-2027-002 | Critical | — | Enabled | 1 (file field) | admin, manager, otp | Authenticator (linked) |
| 47 | Critical | CCRD-0022 | Secure Note · Critical (edited) | Secure Note | Personal & Lifestyle | — | Critical | — | Enabled | 4 (attachments) | admin, otp | Authenticator (linked) |
| 48 | Critical | CCRD-0023 | Membership · Critical (edited) | Membership | Personal & Lifestyle | RW-1102 | Critical | Strong | Enabled | 4 (attachments) | admin, manager, otp | Authenticator (linked) |
| 49 | Critical | CCRD-0024 | Medical Record · Critical (edited) | Medical Record | Personal & Lifestyle | Sai Anand Pawar | Critical | — | Enabled | 1 (file field) | admin, manager, otp | Authenticator (linked) |
| 50 | Critical | CCRD-0026 | Treasury server · email | Server | Development & IT | root | Critical | Strong | Enabled | — | admin, manager, otp | Email code (linked) |

## 6. Notes

- **Email is not going out — fix the SMTP password.** A real send through the app's mailer (`MAIL_MAILER=smtp`, host smtp.gmail.com, user dev@inhpl.com) failed on 03/11/2026: *"535-5.7.8 Username and Password not accepted"*. Every email the app sends — share emails, 2-step codes, password-reset codes — fails the same way until `MAIL_PASSWORD` in `.env` is replaced:
  1. Create a new Google **app password** for dev@inhpl.com (the account needs 2-Step Verification on).
  2. Put it in `.env` as `MAIL_PASSWORD`.
  3. Run `php artisan config:clear`.

  The Gmail module's email history marks a mail "sent" when it is handed to the mailer, so that list can look fine while the SMTP login fails.

- The CredVault screens are unchanged and still call the earlier paths (`POST /credentials`, `/authenticator/new`, `/approvers`, `/access-requests`). Those now live under `normal-vault/` and `critical-vault/`, so the screens' add, edit, delete and unlock need the new paths before they work again.
- The server accepts `attachments[]` on any type. The Add form only offers the Attachments box on the 19 types without a file field of their own.
