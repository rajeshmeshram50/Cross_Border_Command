# CredVault — Normal Vault & Critical Vault: Backend API Sheet

**Scope:** backend only — the APIs of My Vault (Normal Vault) and the Critical Vault, and the Postman collection for them.
**Postman:** [CredVault_Vaults.postman_collection.json](CredVault_Vaults.postman_collection.json) — 14 folders, 252 requests. Each vault has its own folders: **Add · Edit · Get list · Get single · Delete**, with all 25 types in Add, Edit and Get single.
**Last checked:** 03/11/2026:
- **Collection:** 249 / 249 passed (the 3 logins are skipped because the runner uses ready-made tokens).
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
| `POST /critical-vault/two-step/google/new` | A new authenticator secret, with its QR URI |
| `POST /critical-vault/two-step/google/verify` | Check one app code `{ secret, code }` |
| `POST /critical-vault/two-step/email/send` | Mail a setup code `{ email? }` (default php@inhpl.com) and return a `token` |
| `POST /critical-vault/two-step/email/verify` | `{ token, code }`: the token is then good for one save |
| `POST /critical-vault/credentials/{id}/access-requests` | Request an unlock (`reason`, `duration_minutes` when the admin step is on) |
| `GET /critical-vault/access-requests` · `GET …/{id}` | Request list (tabs all \| pending \| approved \| rejected \| mine \| to_me) and detail |
| `POST /critical-vault/access-requests/{id}/approve` · `/reject` · `/cancel` · `/lock` | The decisions, and "Lock now" |
| `POST /critical-vault/access-requests/{id}/send-otp` | Email method: mail the unlock code to the credential's inbox |
| `POST /critical-vault/access-requests/{id}/verify-otp` | `{ code }` → unlocked for the window |

### Generate Password (both vaults use it)

`POST /credvault/generate-password` — nothing is stored. It returns `{ password, bits, level, strength (0–4), meets_policy }` once.

| Mode | Body | Defaults | Limits |
|---|---|---|---|
| Characters | `mode: "chars"`, `length`, `upper`, `lower`, `numbers`, `symbols`, `avoid_ambiguous` | length = the policy's `gen_length`; every set on; symbols = the policy's `gen_symbols`; `avoid_ambiguous` on (drops I O l o 0 1) | length 8–64; at least one set on. Each chosen set appears at least once. |
| Passphrase | `mode: "phrase"`, `words`, `separator`, `capitalize`, `add_number` | 8 words, `-`, capitalized, one digit added | 4–12 words; separator `-` `.` `_` or a space |

**Refusals (422):**
- `upper`: every set off;
- `length`: outside 8–64;
- `words`: outside 4–12;
- `separator`: not one of the four;
- `mode`: unknown.

`meets_policy: false` means the password is below the policy's minimum strength, so a create with it would be refused.

### Strength in the responses

The list rows (`GET …/credentials`) and the single credential (`GET /credentials/{id}`) return strength as a **name**: `"strength": "Strong"`. The names are `Weak`, `Fair`, `Good`, `Strong`, or `null` when the type has no password (e.g. Passkey, ID documents). There is **no percentage** (`strength_pct` was removed). `strength_level` (0–4) is there for sorting.

### Shared by both vaults

`GET /credentials/{id}` (view) · `POST …/reveal` · `POST …/events` · `GET …/activity` · `GET …/attachments/{key}` (download a file)

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
| 05 | **Get single Normal Vault** | 27 | **Get single 01 … 25**, one per type. Each is checked: open, every field of the type returned, secrets masked, strength name. Plus reveal and activity |
| 06 | Delete Normal Vault | 2 | To the Recycle Bin; get single afterwards → 404 |
| 07 | **Add Critical Vault** | 33 | Next CCRD- code; approvers; Google new secret and check; **Add 01 … Add 25** with approvals, Google 2-step and files; refusals: risk high, no method, all steps off, wrong code |
| 08 | **Edit Critical Vault** | 30 | **Edit 01 … Edit 25**: every field plus new files, the lock kept, no new code; rename only; manager step off; risk high → 422; cross-vault ids → 404 both ways |
| 09 | **Get Critical Vault (list)** | 9 | Tabs all / mine / others; search; filters; paging; `?vault=critical` |
| 10 | **Get single Critical Vault** | 26 | **Get single 01 … 25**. Each is checked: locked, the unlock plan, no fields, strength name. Plus reveal while locked → 423 |
| 11 | Delete Critical Vault | 2 | To the Recycle Bin (owner / Vault Admin); get single afterwards → 404 |
| 12 | Email 2-step | 7 | Send, verify, add with email; the same token again → 422; switch an existing credential to email |
| 13 | Unlock | 24 | The full Google unlock and the full email unlock (request → admin → manager → code → reveal → lock), reject, cancel, lists |

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
| The collection, top to bottom | **249 passed, 0 failed** (3 logins skipped: the runner uses ready-made tokens) |
| Every credential read back through the API, both lists and all 50 singles | **513 / 513**: right vault and prefix; strength a name (never a percentage) and equal to the stored level; every field of each Normal credential returned with its edited value; secrets masked; files present; Critical ones locked with an unlock plan and no fields |
| Every saved field compared in the database (decrypted) with its Edit request | All match on the 45 that keep their edited values. The other 5 are changed again by later requests on purpose (a password-only edit and an attachment note, the Critical note's Manager step turned off, and the 2 deleted) |
| Files | 4 attachments on each Attachments-box type (2 from the add, 2 from the edit); the file replaced on each file-field type |

## 5. Data after the test run

The 50 live credentials that the run left, read from `GET /normal-vault/credentials` and `GET /critical-vault/credentials`. The deleted Normal note and Critical outdoor license are in the Recycle Bin. These rows were then removed: the clean-up deletes only rows the run created.

| # | Vault | ID | Name | Category | Group | Username | Risk | Strength | 2FA | Files | Lock steps | 2-step |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Normal | CRD-0001 | Generated login | Login | Logins & Access | ops | Medium | Strong | Not enabled | — | — | — |
| 2 | Normal | CRD-0002 | Login · My Vault (edited) | Login | Logins & Access | finance@inhpl.com | High | Strong | Enabled | 4 (attachments) | — | — |
| 3 | Normal | CRD-0003 | Password · My Vault (edited) | Password | Logins & Access | wiki.owner | High | Strong | Enabled | 4 (attachments) | — | — |
| 4 | Normal | CRD-0004 | Email · My Vault (edited) | Email | Logins & Access | md@inhpl.com | High | Strong | Enabled | 4 (attachments) | — | — |
| 5 | Normal | CRD-0005 | Passkey · My Vault (edited) | Passkey | Logins & Access | inhpl-ops | High | — | Enabled | 4 (attachments) | — | — |
| 6 | Normal | CRD-0006 | TOTP / 2FA Seed · My Vault (edited) | TOTP / 2FA Seed | Logins & Access | admin@inhpl.onmicrosoft.com | High | — | — | 4 (attachments) | — | — |
| 7 | Normal | CRD-0007 | Credit Card · My Vault (edited) | Credit Card | Finance & Banking | INHPL Treasury | High | — | — | 4 (attachments) | — | — |
| 8 | Normal | CRD-0008 | Bank Account · My Vault (edited) | Bank Account | Finance & Banking | •••• 5678 | High | Strong | Enabled | 4 (attachments) | — | — |
| 9 | Normal | CRD-0009 | Crypto Wallet · My Vault (edited) | Crypto Wallet | Finance & Banking | Treasury Ledger (cold) | High | — | Enabled | 4 (attachments) | — | — |
| 10 | Normal | CRD-0010 | Rewards · My Vault (edited) | Rewards | Finance & Banking | MB87654321 | Medium | Strong | — | 4 (attachments) | — | — |
| 11 | Normal | CRD-0011 | API Credentials · My Vault (edited) | API Credentials | Development & IT | Razorpay API | High | — | — | 4 (attachments) | — | — |
| 12 | Normal | CRD-0012 | SSH Key · My Vault (edited) | SSH Key | Development & IT | prod-02.inhpl.com | High | — | — | 4 (attachments) | — | — |
| 13 | Normal | CRD-0013 | Database · My Vault (edited) | Database | Development & IT | erp_ro | High | Strong | — | 4 (attachments) | — | — |
| 14 | Normal | CRD-0014 | Server · My Vault (edited) | Server | Development & IT | Administrator | High | Strong | — | 4 (attachments) | — | — |
| 15 | Normal | CRD-0015 | Certificate · My Vault (edited) | Certificate | Development & IT | portal.inhpl.com | High | Strong | — | 1 (file field) | — | — |
| 16 | Normal | CRD-0016 | Software License · My Vault (edited) | Software License | Development & IT | Adobe Acrobat Pro | High | — | — | 4 (attachments) | — | — |
| 17 | Normal | CRD-0017 | Wireless Router · My Vault (edited) | Wireless Router | Development & IT | INHPL-Guest | High | Strong | — | 4 (attachments) | — | — |
| 18 | Normal | CRD-0018 | Identity · My Vault (edited) | Identity | Identity & Documents | Sai Anand Pawar | High | — | — | 4 (attachments) | — | — |
| 19 | Normal | CRD-0019 | Passport · My Vault (edited) | Passport | Identity & Documents | •••• 4321 | High | — | — | 1 (file field) | — | — |
| 20 | Normal | CRD-0020 | Driver License · My Vault (edited) | Driver License | Identity & Documents | •••• 4321 | High | — | — | 1 (file field) | — | — |
| 21 | Normal | CRD-0021 | SSN / Aadhaar / PAN · My Vault (edited) | SSN / Aadhaar / PAN | Identity & Documents | Sai Anand Pawar | High | — | — | 1 (file field) | — | — |
| 22 | Normal | CRD-0022 | Document · My Vault (edited) | Document | Identity & Documents | AGR-2027-002 | High | — | — | 1 (file field) | — | — |
| 23 | Normal | CRD-0024 | Membership · My Vault (edited) | Membership | Personal & Lifestyle | RW-1102 | Medium | Strong | — | 4 (attachments) | — | — |
| 24 | Normal | CRD-0025 | Medical Record · My Vault (edited) | Medical Record | Personal & Lifestyle | Sai Anand Pawar | High | — | — | 1 (file field) | — | — |
| 25 | Normal | CRD-0026 | Outdoor License · My Vault (edited) | Outdoor License | Personal & Lifestyle | •••• -118 | Medium | — | — | 4 (attachments) | — | — |
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

- The CredVault screens are unchanged and still call the earlier paths (`POST /credentials`, `/authenticator/new`, `/approvers`, `/access-requests`). Those now live under `normal-vault/` and `critical-vault/`, so the screens' add, edit, delete and unlock need the new paths before they work again.
- The server accepts `attachments[]` on any type. The Add form only offers the Attachments box on the 19 types without a file field of their own.
