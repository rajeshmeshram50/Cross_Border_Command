# CredVault Import / Export — API Documentation

Jira GT-77. The screen is **Import & Recovery**
(`/credentials-vault/import-recovery`); the Export popup lives on **Team Vault**.

## 0. How to read this

Base URL `/api`. Every route below sits in the group
`auth:sanctum` → `user.active` → `tenant`, then the CredVault prefix group
`credvault` with `throttle:credvault` (240 requests a minute **per user**,
its own bucket — see `AppServiceProvider::boot()`).

Prefix for this module: **`/api/credvault`**
Controller: `App\Http\Controllers\Api\CredVault\CredVaultController`
(section `IMPORT & RECOVERY`, plus `FILES OUT / IN` helpers)

**Access.** Every method starts with `tenantUser()`:

| Condition | Result |
|---|---|
| Login has no `client_id` | `403` "CredVault needs a company account — this login has no tenant." |
| Not a client admin and no `can_view` on module `credentials-vault` | `403` "You do not have access to Credentials Vault. Ask your admin to grant it in Permissions." |

There is no further role check on these routes. The **Vault Admin** (a
client admin, `isAdmin()`) differs only in what the history lists return
(everyone's rows instead of their own) and in what `fileScope()` can see.

**Response envelope**

```json
{ "status": true,  "data": { … } }
{ "status": false, "message": "…", "errors": { "field": ["…"] } }
```

Refusals go through `reject()`, which puts the message on one field so the
form can show it under the right input. `errors` is omitted when no field is
named.

| Status | Used for |
|---|---|
| `200` | Reads, previews, every file download |
| `201` | An import that saved at least one row |
| `403` | No tenant / no module access |
| `404` | `GET /imports/{id}` not found |
| `409` | The same import token is already running |
| `410` | The import token expired or was already spent |
| `422` | Validation and business refusals (and a typed import that saved nothing) |
| `500` | "Could not {action}. Nothing was saved — please try again." (`inTransaction`) |

**File responses** (`sample`, `backups` POST, `exports` POST) are raw bodies
with `Content-Disposition: attachment; filename="…"`, `Cache-Control:
no-store`, and `Access-Control-Expose-Headers: Content-Disposition,
X-CredVault-Code, X-CredVault-Withheld`. A refused download still answers
JSON; the frontend reads it back out of the blob (`cvApi.ts download()`).

> **There is no `importRun` or `importPreviewTyped` route.** Those are names
> in the frontend (`cvApi.importRun`, `cvApi.importPreviewTyped`) and, for the
> second, a protected controller method. The routes are
> `POST /imports/preview` (typed when `type` is sent) and `POST /imports`.

---

## 1. Route list

Verified against `routes/api.php` (block commented `// Import & Recovery`).

| # | Method · Path | Controller method | Called by the screen? |
|---|---|---|---|
| 1 | `GET /imports/types` | `importTypes` | Yes — Import by category |
| 2 | `GET /imports/sample` | `importSample` | Yes — both import popups |
| 3 | `POST /imports/preview` | `importPreview` → `importPreviewTyped` when `type` is filled | Yes — with `type` only |
| 4 | `POST /imports` | `import` → `runTypedImport` / `runImport` | Yes — typed only |
| 5 | `GET /imports` | `imports` → `transferHistory('import')` | Yes — import history |
| 6 | `GET /imports/{id}` | `importShow` | **No** (API only) |
| 7 | `POST /backups` | `backup` | Yes — Download backup |
| 8 | `GET /backups` | `backups` | Yes — backup history + popup data |
| 9 | `GET /exports/preview` | `exportPreview` | Yes — Team Vault Export popup |
| 10 | `POST /exports` | `export` | Yes — Team Vault Export popup |
| 11 | `GET /exports` | `exports` → `transferHistory('export')` | **No** (API only) |

The **generic (any-type) import** is still live on routes 2–4: a preview
without `type`, `sample: true`, `layout=simple` / `format=json` samples, and
the `runImport()` branch of `POST /imports`. `cvApi.importPreview()` exists in
the frontend but **nothing calls it** (Grep across `resources/js`). Treat it
as an API-only path.

---

## 2. Categories and samples

### 2.1 `GET /imports/types`

The 25 categories (`Credential::TYPES`, in that order).

```json
{ "status": true,
  "data": [ { "key": "login", "label": "Login", "group": "Logins & Access", "icon": "…",
              "sheet": "Login",
              "columns": [ { "key": "credential_name", "header": "Credential Name *",
                             "label": "Credential Name", "required": true, "kind": "text",
                             "options": null, "hint": "2 to 150 characters, unique for this type in your vault" }, … ],
              "attach_later": [ { "key": "…", "label": "…", "required": true } ] }, … ],
  "meta": { "formats": { "xlsx": "Excel", "csv": "CSV" }, "max_rows": 2000, "max_mb": 5 } }
```

`sheet` is the type label made safe for an Excel tab
(`ImportTemplate::sheetName()`: 31 characters, `/ \ ? * [ ] :` → `-`), so
"TOTP / 2FA Seed" is the tab **"TOTP - 2FA Seed"**. `attach_later` lists the
form's `file` fields — a sheet cannot carry a file.

### 2.2 `GET /imports/sample`

| Query | Rule | Meaning |
|---|---|---|
| `format` | `csv` · `json` · `xlsx`, default `xlsx` | |
| `type` | one of the 25 keys | One category only |
| `layout` | `types` (default) · `simple` | `simple` = the older any-type sample |

Failure: `type` not a key → `422` "Choose one of the 25 credential types."

| Request | File |
|---|---|
| `format=xlsx` | `credvault-import-sample.xlsx` — 25 type tabs + "How to fill" |
| `format=xlsx&type=login` | `credvault-import-sample-login.xlsx` — the tab + "How to fill" |
| `format=csv&type=card` | `credvault-import-sample-card.csv` |
| `format=csv` | `credvault-import-sample-csv.zip` — `01-login.csv` … `25-….csv` + `how-to-fill.csv` |
| `layout=simple` or `format=json` | `credvault-import-sample.{fmt}` — columns `name, url, username, password, category, notes` |

Every type sample holds two example rows that pass every check of the
form (`ImportTemplate::sampleRows()`). Header `X-CredVault-Sheets` carries
the tab / file count for the xlsx and the zip.

---

## 3. Import by category (the live screen flow)

### 3.1 `POST /imports/preview` — multipart `type`, `file`

Nothing is saved. Every row is checked as the type's **Add form** checks it.

| Field | Rule | Message on failure |
|---|---|---|
| `type` | required, one of the 25 keys | "Choose one of the 25 credential types." |
| `file` | required | "Choose a file to import." |
| `file` | extensions `xlsx, csv, tsv, txt` | "Upload the Excel (.xlsx) or CSV sheet of this category — download the sample to see the layout." |
| `file` | max 5120 KB | Laravel default: "The file field must not be greater than 5120 kilobytes." |

> **An empty `type` is not a typed request.** `importPreview()` branches on
> `$request->filled('type')`, so a request without `type` runs the *generic*
> preview (§5) and fails there — typically with "The file needs a password
> column and a name or URL column. Download the sample to see the layout." —
> never with a "type is required" message.

**Refusals after the upload is accepted** (all `422`, field `file`):

| When | Message (verbatim) |
|---|---|
| OLE2 file — a locked backup or an old `.xls` | "This Excel file is password-protected or in the old .xls format. Open it in Excel (with the backup password if it is a locked backup), remove the password under File > Info > Protect Workbook > Encrypt with Password, and Save As .xlsx — then upload again." |
| Not a readable zip | "The Excel file could not be opened." |
| Workbook has more than 2 sheets, other type tabs, but none for this type | "This workbook has no “{Sheet}” tab. Pick the category of the tab you filled, or upload that tab's sheet." |
| More than 2,000 data rows (xlsx) | "The sheet has {n} rows. Import up to 2000 at a time." |
| More than 2,000 data rows (csv / tsv) | "The file has {n} rows. Import up to 2000 at a time." |
| No data rows | "The sheet has no rows to import. Add one credential per row under the header." |
| A required column is missing | "The sheet is not a {Label} sheet — missing column(s): {Header *, …}. Download the sample for this category and keep its header row." |

Which tab is read in an `.xlsx`: the tab named for the type (by label, key or
sheet name, case and spacing ignored); otherwise the first tab that is not
"How to fill".

**Per-row checks** (a failing row is not a refusal — it comes back
`status: "failed"` with every reason):

| Column | Rule | Message |
|---|---|---|
| Credential Name | required, 2–150 | "Enter the Credential Name." · "The Credential Name needs at least 2 characters." |
| Risk | `low` · `medium` · `high` (case-insensitive) | "Risk is Low, Medium or High." |
| Rotation (days) | 30 · 60 · 90 · 180 | "Rotation is 30, 60, 90 or 180 days." |
| Registered Email | `email:rfc` | "Enter a valid Registered Email." |
| Registered Phone | `^\+?[\d\s()-]{10,16}$` | "Enter a phone number of 10 to 16 digits." |
| Recovery Key | 4–500 | Laravel default `min` / `max` |
| Notes | ≤ 5000 | Laravel default `max` |
| Any form field | `validateTypeFields()` / `checkField()` | e.g. "Enter a valid card number." · "Enter the expiry as MM/YY." · "This card has expired." · "CVV is 3 or 4 digits." · "Enter a valid IFSC (e.g. ICIC0001234)." · "A seed phrase has 12 to 24 words." · "Enter a valid web address for {Label}." · "Pick a {Label} from the list." · "Enter the {Label}." / "Select the {Label}." |

Required **file** fields are not checked (the `importing` flag); the valid
row gets a note instead: "Attach the {Label} in the form after the import."

**Flags on a valid row**

| Flag | Meaning |
|---|---|
| `dup` | You already **own** a credential of this type with this name (case-insensitive, trimmed). `dup_of` names it |
| `dupfile` | The name repeats in this file and is not already `dup` |
| `weak` | The type's secret is a password and its strength is below the policy `min_strength` (default 3 = Good). Still importable |

`selected` = valid and neither `dup` nor `dupfile`.

**Response `200`**

```json
{ "status": true, "data": {
  "token": "…40 chars…", "expires_in": 1800,
  "type": "card", "type_label": "Credit Card",
  "file_name": "cards.csv", "sheet": null, "format": "csv", "format_label": "CSV",
  "columns": { "matched": { "credential_name": "Credential Name *", … }, "ignored": ["Extra"] },
  "stats": { "rows": 5, "valid": 1, "failed": 4, "duplicates": 0, "weak": 0, "selected": 1 },
  "rows": [ { "index": 0, "row": 2, "name": "…", "status": "valid", "errors": [],
              "flags": [], "notes": [], "strength": null, "dup_of": null, "selected": true }, … ],
  "failed": [ { "row": 3, "name": "…", "errors": [ { "field": "cardno", "label": "Card Number",
                "message": "Enter a valid card number." } ] } ] } }
```

- `row` is the **sheet row**: header = row 1, so the first credential is row 2.
- `strength` is a **label** (`"Fair"`, `"Good"`, `"Strong"`) or `null` when the
  type's secret is not a password.
- **No secret is returned.** The parsed rows (with their values) are
  encrypted (`Crypt::encrypt`) and parked in the cache for `IMPORT_TTL` =
  **1800 s** under `credvault:import:{client}:{user}:{token}`.
- `.txt` uploads are recorded as format `tsv`.

### 3.2 `POST /imports` — run the import

```json
{ "token": "…", "rows": [0, 2, 3], "duplicates": "skip" }
```

| Field | Rule |
|---|---|
| `token` | required, string, exactly 40 |
| `rows` | required array, 1 – 2000 items; each an integer ≥ 0, distinct (`index` values) |
| `duplicates` | required, `skip` · `copy` |
| `scope` | optional `personal` (default) · `team` |
| `department_id` | optional integer; used only with `scope=team` (`teamDepartmentFor()`) |

The screen always sends `duplicates: "skip"`, the accepted indexes, and no
`scope` — so every screen import lands in **My Vault · Personal**.

| Status | Body |
|---|---|
| `409` | "This import is already running." (field `token`) — a second call while the first holds the 120 s running marker |
| `410` | "This preview has expired or was already imported. Upload the file again." (field `token`) |
| `201` | Saved ≥ 1 row |
| `422` | Saved nothing (see below) |

Each picked valid row is saved through `persistCredential()` — the same code,
encryption, strength, risk, rotation and duplicate checks as a credential
typed into the Add form. A row the form still refuses (for example "There is
already a {Label} named “{name}” in this vault.") is added to the failed list.
With `duplicates: "copy"` a duplicate is saved as "{name} (imported)".

**`201` body**

```json
{ "status": true,
  "message": "3 Credit Card credentials imported to My Vault · 1 failed — see the failed list · 1 with weak passwords — see Password Health.",
  "data": { …TransferRow…, "imported_codes": ["CRD-0141", …], "failed_rows": [ … ] } }
```

**`422` body** — returned as a normal response, not through `reject()`, so
there is **no `errors` key**:

```json
{ "status": false, "message": "Nothing was imported — every picked row failed. See the failed list.",
  "data": { …TransferRow (status "failed")…, "imported_codes": [], "failed_rows": [ … ] } }
```

> **The typed 422 spends the token.** The code comment says *"The preview is
> spent only once the import commits: a run that imports nothing … leaves
> it"*, but `runTypedImport()` returns a response instead of throwing, so
> `Cache::forget($cacheKey)` runs. A retry gets `410`. Only the generic
> `runImport()` path (which throws "None of the selected rows could be
> imported.") keeps the token. Found by reading; worth a test.

The same `422` message is also returned when every picked row was a
duplicate and `duplicates` was `skip` — the wording says "failed" although
nothing failed. The screen never sends duplicate rows, so it does not meet it.

---

## 4. History

### 4.1 `GET /imports` · `GET /backups` · `GET /exports`

| Query | Rule |
|---|---|
| `page` | integer ≥ 1, default 1 |
| `per_page` | 1 – 100, default 10 (`PAGE_SIZE`) |
| `mine` | boolean — only your own rows |

There is **no search parameter**. Rows are `orderByDesc('id')`. A Vault Admin
sees every row of the client; anyone else (or `mine=1`) sees only rows where
`user_id` is theirs.

```json
{ "status": true, "records": 12,
  "data": [ { "sr_no": 1, "id": 41, "code": "IM-0012", "kind": "import",
              "scope": "mine", "scope_label": "My Vault", "format": "xlsx", "format_label": "Excel",
              "file_name": "login.xlsx", "source": "Login sheet", "source_line": "Login sheet · into My Vault",
              "type": "login", "type_label": "Login",
              "items": 2, "skipped": 1, "weak": 0, "duplicates": 1, "failed": 0,
              "size_bytes": null, "size_label": null, "include_passwords": false, "locked": false,
              "protection": null, "status": "done", "status_label": "Imported", "failure_reason": null,
              "by": "…", "by_id": 7, "by_me": true, "by_display": "You", "by_initials": "AK",
              "by_role": "…", "at": "2026-11-12T09:14:03+00:00" } ],
  "meta": { "current_page": 1, "per_page": 10, "total": 12, "last_page": 2 } }
```

`status_label`: `Failed` when failed, else `Imported` (import) or
`Downloaded` (backup, export). `protection` is set for backups only:
"Password locked" / "Not locked".

`GET /backups` adds what the Download backup popup needs:

```json
"scopes":  [ { "scope": "mine", "label": "My Vault", "count": 14 },
             { "scope": "team", "label": "Team Vault", "count": 6 },
             { "scope": "all",  "label": "All vaults", "count": 20 } ],
"columns": { "with_passwords": ["Name","Type","Category","Website","Username","Password","Owner","Vault","Risk","2FA","Rotation","Notes","Updated"],
             "without_passwords": [ …same without "Password"… ] },
"lock_note": "Locked with Excel’s own password (AES-256) — Excel asks for it when the file opens. Only Excel backups can be locked."
```

### 4.2 `GET /imports/{id}`

One import with its stored failed list (`failed_rows`, at most 500).
Not found / not yours (non-admin) → `404` "Import not found."

---

## 5. Generic (any-type) import — API only

`POST /imports/preview` without `type`: multipart `file`, or `{ "sample": true }`.

| Field | Rule | Message |
|---|---|---|
| `file` | required unless `sample` | "Choose a file to import." |
| `file` | extensions `xlsx, xls, csv, tsv, txt, json, xml`; ≤ 5120 KB | "Upload an Excel (.xlsx), CSV, TSV, JSON or Excel XML file." |
| (rows) | ≥ 1 | "The file has no rows to import." |
| (headers) | a password column and a name or URL column | "The file needs a password column and a name or URL column. Download the sample to see the layout." |

Headers are matched through `IMPORT_ALIASES` (Chrome/Edge, Firefox,
LastPass, 1Password, Bitwarden, KeePass names); the source is named by
`detectSource()`. Flags: `invalid` (no name), `nopw`, `dup` (against
everything in `healthScope()` — owned and team), `dupfile`, `weak`. The run
(`POST /imports` with this token) creates the rows directly with
`Credential::create()` — type `login` if a URL is present, else `password`,
risk `medium` — **not** through the Add form. Its success message always says
"… imported to My Vault", whatever the `scope`.

---

## 6. Download backup — `POST /backups`

| Field | Rule | Message on failure |
|---|---|---|
| `format` | required, `csv` · `json` · `xlsx` | Laravel default `in` |
| `scope` | required, `mine` · `team` · `all` | Laravel default `in` |
| `include_passwords` | required boolean | |
| `lock` | required boolean | |
| `password` | when `lock`: required, 8–128 | "Set a password for the backup file, or turn the lock off." · "Use 8+ characters with letters, numbers & symbols for the backup password." |
| `password_confirmation` | when `lock`: required | Laravel default: "The password confirmation field is required." |
| `account_password` | nullable string — see the order below | |

**Checks, in order** (all `422`):

| # | Condition | Message | Recorded in history? |
|---|---|---|---|
| 1 | `lock` and format not `xlsx` | "A CSV file cannot hold a password. Choose Excel to lock the backup, or turn the lock off." (JSON: "A JSON file …") — field `lock` | No |
| 2 | `lock` and `strengthOf(password) < 3` | "Use 8+ characters with letters, numbers & symbols for the backup password." — field `password` | No |
| 3 | `lock` and confirmation differs | "Passwords did not match." — field `password_confirmation` | **Yes** — `BK-` row, `failed` |
| 4 | `include_passwords`, not locked, no `account_password` | "A backup with readable passwords needs your account password. Or lock the file with a password." — field `account_password` | No |
| 5 | same, wrong `account_password` | "Account password incorrect." — field `account_password` | **Yes** |
| 6 | `fileScope()` is empty | "There are no credentials in this vault to back up." — field `scope` | No |

> **The screen has no account-password field.** The Download backup popup
> sends `account_password` never. So *Include passwords* on + *Password lock*
> off (or CSV, which forces the lock off) always ends at check 4 and shows the
> backend message above. Only the API can complete an unlocked backup with
> passwords.

**Success `200`** — the file itself:

| | |
|---|---|
| Name | `credvault-{scope}-backup-{Ymd}.{format}` |
| Headers | `X-CredVault-Code` (BK-…), `X-CredVault-Items`, `X-CredVault-Withheld` |
| Locked | the `.xlsx` encrypted by `ExcelLock::encrypt()` — still named `.xlsx`, `Content-Type` spreadsheetml |

What is in the file is described in the Functional document §6.4.

---

## 7. Export (Team Vault) — `GET /exports/preview`, `POST /exports`

Shared selection rules (`exportRules()`):

| Field | Rule |
|---|---|
| `tab` | `mine` (My Credentials) · `team` (Team Credentials) |
| `scope` | older name of the tab: `team` · `personal` · `mine` |
| `department_id` | integer (team tab) |
| `vault` · `risk` · `type` | `Credential::VAULTS` · `RISKS` · the 25 keys |
| `q` | ≤ 100 |
| `groups[]` | distinct, in `Credential::GROUPS` |

### 7.1 `GET /exports/preview`

```json
{ "status": true, "data": { "tab": "team", "scope": "team", "filters": { … },
  "total": 9, "selected": 9,
  "groups": [ { "group": "Logins & Access", "count": 5, "selected": true }, … ],
  "protected": 1, "tabs": { "mine": 14, "team": 9 },
  "columns": { "always": ["Sr. No", "Credential ID", …, "Last Updated"],
               "with_passwords": "Password / Secret", "with_notes": "Notes" } } }
```

### 7.2 `POST /exports`

| Field | Rule | Message |
|---|---|---|
| `format` | required `csv` · `json` | |
| `include_notes` | boolean, default true | |
| `include_passwords` | required boolean | |
| `acknowledge` | accepted, when passwords | "Confirm you understand the risk of exporting readable passwords." |
| `account_password` | required, when passwords | "Enter your account password to export readable passwords." |
| (check) | password hash | "Your account password is incorrect." |
| (check) | no `tab` and no `scope` | "Choose what to export: tab mine (My Credentials) or team (Team Credentials)." |
| (check) | nothing selected | "No credentials match this selection." (field `groups`) |

Success: file `my-credentials-{Ymd}.{fmt}` or `team-credentials-{Ymd}.{fmt}`,
headers `X-CredVault-Code` (EX-…), `X-CredVault-Count`,
`X-CredVault-Withheld`. A refused export writes **no** history row (unlike a
backup's checks 3 and 5).

---

## 8. curl, end to end

Read-only calls first; the last three write a `credvault_transfers` row (and,
for the import, credentials). Run them only against a test tenant.

```bash
B=http://127.0.0.1:8000/api/credvault
H="Authorization: Bearer $TOKEN"

# 1. categories and a sample
curl -s -H "$H" "$B/imports/types" | jq '.meta'
curl -s -H "$H" -OJ "$B/imports/sample?format=xlsx&type=login"

# 2. preview one category's sheet (nothing saved)
curl -s -H "$H" -F type=login -F file=@credvault-import-sample-login.xlsx \
     "$B/imports/preview" | tee prev.json | jq '.data.stats'
TOK=$(jq -r '.data.token' prev.json)
ROWS=$(jq -c '[.data.rows[] | select(.selected) | .index]' prev.json)

# 3. run it (writes credentials + IM- row)
curl -s -H "$H" -H 'Content-Type: application/json' \
     -d "{\"token\":\"$TOK\",\"rows\":$ROWS,\"duplicates\":\"skip\"}" "$B/imports" | jq '.message'

# 4. history
curl -s -H "$H" "$B/imports?per_page=5" | jq '.data[] | {code, items, skipped, failed}'
curl -s -H "$H" "$B/backups" | jq '.scopes'

# 5. locked Excel backup (writes BK- row)
curl -s -H "$H" -H 'Content-Type: application/json' -OJ -D - \
     -d '{"format":"xlsx","scope":"mine","include_passwords":true,"lock":true,
          "password":"Vault#Backup26","password_confirmation":"Vault#Backup26"}' "$B/backups"

# 6. team export, no passwords (writes EX- row)
curl -s -H "$H" -H 'Content-Type: application/json' -OJ \
     -d '{"tab":"team","format":"csv","include_passwords":false}' "$B/exports"
```

Postman: `docs/CredVault_ImportRecovery.postman_collection.json` (folders
00–05) and `docs/CredVault_Export.postman_collection.json`. These curl lines
were written from the code and **not executed** for this document.
