# CredVault Import / Export — Technical Documentation

Jira GT-77 · screen **Import & Recovery** · plus the Team Vault Export popup.

## 1. Stack

| Layer | Technology |
|---|---|
| Backend | PHP 8.2, Laravel 12 |
| Database | PostgreSQL (driver confirmed `pgsql` via tinker) |
| Auth | Sanctum bearer → `user.active` → `tenant`, then `throttle:credvault` (240/min/user) |
| Frontend | React 19 + TypeScript, Vite |
| Spreadsheets | **No library.** `VaultFile` reads/writes `.xlsx` with `ZipArchive` + SimpleXML |
| Excel lock | `ExcelLock` — MS-OFFCRYPTO Agile encryption written by hand |
| Import staging | Laravel cache, `Crypt::encrypt`ed, 1800 s |
| File storage | **None.** Files are streamed to the requester; only the record is kept |

---

## 2. Architecture

```
React  pages/credvault/import-recovery/
  ImportRecovery ── tabs + two HistoryCards
     ├─ ImportModal ─▶ ImportCategoryModal ─▶ ImportReviewModal   (veil on the last two)
     └─ BackupModal                                               (veil)
  pages/credvault/team-vault/ExportModal
  │  cvApi.ts (axios /api, Bearer; download() → blob → <a download>)
  ▼
routes/api.php   prefix credvault   (throttle:credvault)
  ▼
CredVaultController
  importTypes · importSample · importPreview ─┬─ importPreviewTyped   (type given)
                                              └─ generic preview      (no type)
  import ─┬─ runTypedImport ─▶ persistCredential()  (the Add form, per row)
          └─ runImport       ─▶ Credential::create() (generic)
  backup · backups · exportPreview · export · exports · imports · importShow
  FILES OUT / IN: fileScope · fileSecret · exportRows · backupRows
                  backupTypeSheets · transferHistory
  ▼
App\Services\CredVault
  ImportTemplate   the 25 sheet layouts, header mapping, samples
  VaultFile        CSV/TSV/JSON/XLSX/XML in · CSV/JSON/XLSX/ZIP out · MAX_ROWS
  ExcelLock        AES-256 Excel password on an .xlsx
  ▼
credvault_transfers (one row per import / export / backup)
credvault_credentials (rows created by an import)
credvault_audit_logs (importx · backup · backupfail · export)
cache: credvault:import:{client}:{user}:{token}   (+ ":running" marker)
```

---

## 3. Data model

### 3.1 `credvault_transfers` — live schema

From `Schema::getColumns()` on the live database:

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | no | sequence | |
| `client_id` | bigint | no | | tenant |
| `kind` | varchar(10) | no | | `import` · `export` · `backup` — **CHECK constraint** on pgsql (`credvault_transfer_kind_check`) |
| `code` | varchar(20) | no | | `IM-0001` / `EX-0001` / `BK-0001` |
| `user_id` | bigint | no | | who ran it (indexed) |
| `scope` | varchar(10) | yes | | `mine` · `team` · `all` |
| `format` | varchar(10) | no | | `xlsx` · `csv` · `tsv` · `json` · `xml` · `sample` |
| `file_name` | varchar(191) | yes | | null on a failed backup |
| `source` | varchar(40) | yes | | "Login sheet", "Bitwarden", "Sample data" … |
| `items` | integer | no | 0 | rows saved / written |
| `skipped` | integer | no | 0 | import: rows in the file − items |
| `weak` | integer | no | 0 | import: saved rows flagged weak |
| `duplicates` | integer | no | 0 | import: `dup` + `dupfile` rows in the file |
| `size_bytes` | bigint | yes | | backup / export body length |
| `include_passwords` | boolean | no | false | |
| `locked` | boolean | no | false | backup only |
| `status` | varchar(10) | no | `'done'` | `done` · `failed` |
| `failure_reason` | varchar(191) | yes | | |
| `created_at` | timestamp(0) | no | CURRENT_TIMESTAMP | **no `updated_at`** (`UPDATED_AT = null`) |
| `credential_type` | varchar(20) | yes | | typed import's category; null for generic |
| `failed` | integer | no | 0 | typed import: rows failed |
| `failed_rows` | json | yes | | `[{row, name, errors:[{field,label,message}]}]`, capped at 500 |

Indexes: `(client_id, code)` **unique**, `(client_id, kind, created_at)`,
`(user_id)`.

The `kind` and `status` enums are **not** PHP enums: `Transfer::KINDS`,
`Transfer::PREFIXES`, `FORMAT_LABELS`, `SCOPE_LABELS` are plain constants.
`status` defaults in **both** the column and `$attributes` — *"Eloquent does
not read the column default back after an insert; say it here too."*

The migration comment on `locked` still says "backup zipped under a
password". **Stale** — since the ExcelLock change a locked backup is an
encrypted `.xlsx`, not a zip.

Migrations: `database/migrations/credvault/2026_10_30_000006_create_credvault_transfers_table.php`,
`2026_11_05_000001_add_type_and_failed_rows_to_credvault_transfers.php`
(loaded by `AppServiceProvider::loadMigrationsFrom()`).

### 3.2 `credvault_credentials` — the columns an import writes

Live column list:

```
id, client_id, branch_id, code, type, category_group, name, scope, owner_id,
department_id, url, username, secret, secret_hash, fields, notes, attachments,
risk, strength, has_password, twofa, rotation_days, password_changed_at,
lock_admin, lock_manager, lock_otp, lock_admin_user_id, lock_manager_user_id,
totp_secret, totp_linked_at, created_by, updated_by, deleted_by, created_at,
updated_at, deleted_at, vault, twofa_method, twofa_email, twofa_linked_at
```

`secret`, `fields`, `notes`, `totp_secret` are encrypted casts.
`secret_hash` is an HMAC under the app key (`Credential::hashSecret()`), used
for reuse detection. Soft deletes (`deleted_at`).

| Path | Writes |
|---|---|
| Typed import | whatever `persistCredential()` writes for a new credential with `vault = normal` |
| Generic import | `client_id, branch_id, code, type (login/password), category_group, name, scope, owner_id, department_id, url, username, secret, secret_hash, fields{url,username,password}, notes ("Category: …\n" + notes), risk=medium, strength, has_password=true, twofa=no, rotation_days=policy default, password_changed_at, created_by, updated_by` |

---

## 4. Codes

```php
nextCode('credvault_transfers', 'IM' | 'BK' | 'EX', $clientId)   // IM-0001
persistCredential → nextCode('credvault_credentials', 'CRD', …)  // CRD-0001
```

```php
/**
 * The next code for a per-client series (CRD-0001, REQ-0001 …), allocated
 * under a lock on the client's row so two saves cannot take the same one.
 * Must run inside a transaction. The audit log is consulted too, so a code
 * once used by a credential since purged is never handed out again.
 */
```

Format `%s-%04d`. The last number is read with `code like 'IM-%' order by id
desc` per client. The purged-code check through the audit log applies to
`credvault_credentials` only; transfers are never deleted, so they need none.

The generic import takes **one** `CRD` code and increments it locally
(`sprintf('CRD-%04d', $n++)`) for every row — safe because the client row lock
is held for the whole transaction.

**Lock duration (inferred, not measured).** Both imports run all rows inside
one outer transaction. The first `nextCode()` takes `lockForUpdate()` on the
`clients` row and holds it until commit — so a 2,000-row typed import holds
the client lock for every row's `persistCredential()`. Every other code
allocation of that client that locks the same row (other CredVault saves,
and per CLAUDE.md §16.3 Quotation / PI numbering) waits meanwhile. The backup
does the same while it builds and encrypts the file (§7).

---

## 5. The import pipeline

### 5.1 Preview → cache → run

```
POST /imports/preview {type,file}
  validate → read sheet → mapHeaders → per row: toPayload, Validator(meta),
  validateTypeFields (importing=true), dup/dupfile/weak
  Cache::put(key, Crypt::encrypt({typed, type, rows[+payload], file_name,
                                  format, source}), 1800)
  → rows without payload, no secret
POST /imports {token, rows[], duplicates}
  Cache::add(key:running, 1, 120)   else 409
  Cache::get(key)                   else 410
  runTypedImport / runImport  (one transaction)
  Cache::forget(key)          ← skipped only if the run THROWS
  finally Cache::forget(key:running)
```

The token is 40 random characters, but the cache key also carries client and
user, so a token is useless to anyone else.

### 5.2 Concurrency

| Race | Guard |
|---|---|
| Double click / two tabs on the same review | `Cache::add` of the `:running` marker — atomic; the loser gets 409. The marker is taken **before** the payload is read (CS fix, test report item 8) |
| A run after a successful run | the payload is forgotten → 410 |
| Two imports taking the same CRD code | `nextCode()` under the client row lock |
| Two backups taking the same BK code | same, plus the unique `(client_id, code)` index |
| Backup ID inside the file ≠ history code | the code is allocated inside the transaction and the file built with it: *"Built inside the transaction below with the code it is recorded under, so the Backup ID in the file always matches the history row."* |
| A slow history page overwriting a newer one (frontend) | `impSeq` / `bkSeq` request ids in `ImportRecovery.tsx` |

**Known inconsistency.** The comment in `import()` reads:

```php
// The preview is spent only once the import commits: a run that imports nothing
// (all skipped, or an error) leaves it, so the person can change options and retry.
```

True for `runImport()`, which ends in `reject('None of the selected rows could
be imported.')`. **Not** true for `runTypedImport()`: when `$items === 0` it
commits a `failed` transfer row and *returns* a 422 response, so the next
line `Cache::forget($cacheKey)` runs and the token is gone.

### 5.3 The `importing` flag

```php
/** Set while an import saves its rows: a weak password is imported (and counted),
    a file the sheet cannot carry is attached later. */
protected bool $importing = false;
```

It changes three things inside the shared form code:

| Where | Effect |
|---|---|
| `persistCredential()` strength check | a password below `min_strength` is **not** refused |
| `validateTypeFields()` file fields | a required file is not demanded — *"An import cannot carry a file: it is attached in the form afterwards."* |
| `persistCredential()` audit | no per-row `create` entry — *"CS-1479: a bulk import logs one "importx" summary entry, not a per-row "credential added""* |

It is set in the preview too, so the preview's verdict matches the run's.

### 5.4 Per-row isolation inside one transaction

```php
$res = DB::transaction(fn () => $this->persistCredential(Request::create('/', 'POST', $p), $u, null, 'normal'));
```

Each row runs in a **savepoint**. A `ValidationException` or
`HttpResponseException` from the form rolls back that row only and becomes a
failed-row entry; the outer transaction continues. Anything else bubbles to
`inTransaction()` → 500 and the whole import rolls back. Rows are saved with a
synthetic `Request`, so they go through the form's own `validate()`.

### 5.5 Duplicates — two definitions

| Path | `dup` means |
|---|---|
| Typed | you **own** a credential of the same **type** and name (lower/trim), in either vault, not soft-deleted |
| Generic | anything in `healthScope()` (owned + team you can see) with the same name + username, or same host + username |

The typed rule mirrors `persistCredential()`'s own refusal ("There is already
a {Label} named “{name}” in this vault."), so a row the preview passes is not
refused at save for that reason — unless it was saved in between.

---

## 6. File scope — what leaves in a backup

```php
/**
 * The credentials an export or backup covers. mine = owned · team = team
 * vault · all = both; never ones that are only shared with the user,
 * and never Critical Vault ones.
 */
protected function fileScope(User $u, string $scope, bool $light = false): Collection
```

1. `visibleQuery($u)` — everything the user can list.
2. `accessMap()` — the best right per credential and *via* (`owner`, `admin`,
   `branch`, `manager`, `hod`, `team`, `branch_critical`, `share`).
3. Drop `via === 'share'` and `via === null`; drop `isCriticalVault()`.
4. `mine` → `owner_id === me`; `team` → `scope === 'team'`; `all` → the rest.

Consequences worth knowing:

- People a user *oversees* have their personal credentials in
  `visibleQuery`, but `accessMap()` gives them no right (`via` null), so they
  are **not** in the backup.
- `accessMap()` lets a share override a team right when the share's rank is
  higher. Such a credential gets `via = 'share'` and is then **dropped** from
  the backup although the user also has it through the team. By reading;
  worth a test.
- `fileScope()` serves **backups only**. The export uses `exportSet()`, which
  has **no** Critical Vault exclusion: the *mine* tab is `owner_id = me` over
  `visibleQuery`, so a user's own CCRD credentials can be exported (the file's
  Vault column reads "Critical"). Their secret is a placeholder only when the
  credential `isProtected()` (lock steps on). By reading; worth a test.

### 6.1 `fileSecret()`

```php
if ($c->isProtected()) return ['[Protected — unlock in CredVault]', true];
if (($c->_rank ?? 0) < self::RANK_COPY) return ['[No copy permission]', true];
```

The second value counts towards `X-CredVault-Withheld`. In the Excel
backup's type tabs a withheld secret is written **empty**, not as the
placeholder (`backupTypeSheets()`: `$open = $withSecrets && !$c->isProtected()`).
Note that the type tabs check only `isProtected()`, not the copy rank, so a
team credential with rank below Copy would have its secret fields written
there. In practice `fileScope()` keeps only `owner`/`admin`/`branch`/
`manager`/`hod`/`team` rights, all of which are Copy or Full, so this does
not occur today.

---

## 7. Backup — the lock

`ExcelLock::encrypt($xlsx, $password)`:

```
MS-OFFCRYPTO Agile Encryption: AES-256-CBC, SHA-512, 100,000 spins
EncryptedPackage = size (8 bytes) + 4096-byte segments, IV per segment
dataIntegrity    = HMAC-SHA512 of the package
result           = an OLE2 Compound File (EncryptionInfo, EncryptedPackage,
                   \x06DataSpaces) — Excel opens it and asks for the password
```

Why not a zip (from the class docblock): *"no zip, which Windows' built-in
extractor cannot open when it is AES-encrypted."* The CredVault API sheet
adds that ZipCrypto "is broken in minutes".

Failures inside `ExcelLock` ("The backup could not be encrypted.", "The
backup is too large to lock.") are `RuntimeException`s inside
`inTransaction()` → logged, and the user gets 500 "Could not record the
backup. Nothing was saved — please try again." No `failed` row is written
(the transaction rolled back).

The reverse direction: `VaultFile` recognises the OLE2 signature
`\xD0\xCF\x11\xE0` on upload and refuses with `OLE2_MESSAGE` — a locked
backup or an old `.xls` cannot be read; the user removes the password first.

### 7.1 Password strength — two implementations

| | Rule |
|---|---|
| Server `Credential::strengthOf()` | letters **and** numbers **and** a non-space symbol: ≥ 12 → 4, ≥ 8 → 3; anything else → 2. Backup requires ≥ 3 |
| Browser `BackupModal.pwScore()` | +1 length ≥ 8, +1 upper **and** lower, +1 digit, +1 any non-alphanumeric (space counts); < 8 caps at 1; ≥ 14 with 3 → 4 |

They disagree (e.g. "Abcdefgh!", "password 1"). The comment on `pwScore`
says only *"A quick 0–4 score for the meter; the API enforces the real
minimum (8 characters)"* — the real minimum is strength Good, not just 8.

### 7.2 Account password — backend only

```php
// backup():
if ($d['include_passwords'] && !$d['lock']) {
    if (!filled($d['account_password'] ?? null)) $this->reject('A backup with readable passwords needs your account password. Or lock the file with a password.', 'account_password');
    if (!Hash::check((string) $d['account_password'], $u->password)) $fail('Account password incorrect', 'account_password');
}
```

`BackupModal.create()` sends `{format, scope, include_passwords, lock}` and,
when locked, the two passwords — never `account_password`. The 422 lands in
`err.message` and is printed in the popup's `.ir-err` line. This is the
documented front/back mismatch.

---

## 8. Multi-tenancy

| Where | Scope |
|---|---|
| Every endpoint | `tenantUser()` → `client_id` from the user; never from the body |
| History | `client_id` + (non-admin or `mine`) `user_id` |
| `importShow` | same, else 404 |
| Cache key | `credvault:import:{client_id}:{user_id}:{token}` |
| Backup / export contents | `visibleQuery()` + `accessMap()` — the viewer's own rights |
| Code allocation | per client (`clients` row lock) |

**Branch.** None of these endpoints read the injected `branch_id` query
parameter. History is client-wide for a Vault Admin, and a Branch Admin who
is not a client admin sees only their own rows. Imported credentials get the
importer's `branch_id` (generic path explicitly; typed path through
`persistCredential()`).

**Scope deliberately lifted:** none. The Vault Admin's wider history is a
role rule (`isAdmin()` = client admin), not a lifted scope.

---

## 9. Where each field's data comes from

| Screen element | Endpoint | Source |
|---|---|---|
| Category dropdown | `GET /imports/types` | `Credential::TYPES` + `ImportTemplate::columns()` |
| "up to N rows" | `GET /imports/types` → `meta.max_rows` | `VaultFile::MAX_ROWS` = 2000 |
| Sample files | `GET /imports/sample` | `ImportTemplate::sampleRows()` / `guideSheet()` |
| Review rows | `POST /imports/preview` | the uploaded sheet, cache |
| Review strength meter levels | client map `STR_LEVEL` | the API sends `Credential::STRENGTH_LABELS` labels |
| Backup vault counts | `GET /backups` → `scopes[]` | `fileScope($u, $s, true)->count()` |
| Backup strength label | `GET /meta` → `strengths` | `Credential::STRENGTH_LABELS` (indexed by the **browser** score) |
| Export category boxes | `GET /exports/preview` → `groups[]` | `exportSet()` grouped by `category_group` |
| History tables | `GET /imports`, `GET /backups` | `credvault_transfers` + `transferRow()` |

## 10. Derived server-side, never accepted from the client

- Every saved value of an imported row — the client sends only row **indexes**.
- `strength`, `secret_hash`, `risk` defaults, `rotation_days` default, codes.
- `items`, `skipped`, `weak`, `duplicates`, `failed`, `size_bytes`.
- The backup's contents (from `fileScope()`), the Backup ID, the file name.
- Whether a secret is withheld.

## 11. External coupling

None beyond the cache and the database. No queue, no mail, no storage disk,
no Zoho. The audit entries (`importx` "Credentials imported" warn, `backup`
"Backup created" warn, `backupfail` "Backup attempt failed" critical,
`export` "Exported" critical — `AuditLog` labels) feed Audit Logs and the
Dashboard ("Failed backup attempts" attention row, backup / import widgets
read `credvault_transfers` directly).

## 12. Discrepancies with the older notes

| Note | Says | Code |
|---|---|---|
| `CREDVAULT_IMPORT_RECOVERY_API_SHEET.md` §3 | preview `expires_in: 900` | `IMPORT_TTL = 1800` |
| same, §3 Step 2 | each row gets a "Credential added" audit entry | suppressed while importing (CS-1479); one `importx` entry |
| `CREDVAULT_TEST_REPORT` / API sheet fix #9 | "A run that imports nothing keeps the preview" | only the generic path; the typed path spends it |
| `CREDVAULT_API_SHEET.md` §174 | import = `POST /imports/preview` (file or `sample`) | the screen uses the typed preview only |
| API sheet smoke test | "Backup locked with a password → .zip downloaded" | an encrypted `.xlsx` |
| Transfers migration | `locked` = "zipped under a password" | ExcelLock |
| API sheet §5 | account password asked for an unlocked backup with passwords | true on the API; the screen no longer has the field |
