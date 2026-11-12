# CredVault Import / Export — Code Walkthrough

Jira GT-77 · screen **Import & Recovery**.

## 1. The file map

### Backend

| File | What is in it |
|---|---|
| `app/Http/Controllers/Api/CredVault/CredVaultController.php` | Section `IMPORT & RECOVERY` (~line 1804): `IMPORT_EXAMPLE`, `IMPORT_COLUMNS`, `importPreview`, `importPreviewTyped`, `import`, `runTypedImport`, `runImport`, `imports`, `importShow`, `importTypes`, `importSample`, `backup`, `backups`, `exportRules`, `exportTab`, `exportSet`, `exportPreview`, `export`, `exports` |
| same, section `FILES OUT / IN` (~line 4174) | `fileScope`, `fileSecret`, `EXPORT_COLUMNS`, `exportRows`, `BACKUP_KEYS`, `backupRows`, `backupTypeSheets`, `transferHistory`, `IMPORT_ALIASES`, `importColumnMap`, `detectSource`, `importCacheKey` |
| same, serialisers / helpers | `transferRow` (~4823), `tenantUser`, `nextCode` / `lastNumber`, `download`, `mime`, `reject`, `inTransaction` (end of file) |
| same, shared form code | `persistCredential` (~3324), `validateTypeFields` (~3572), `checkField`, `credentialRules` — used by the typed import |
| `app/Services/CredVault/ImportTemplate.php` | The 25 sheet layouts: `columns`, `fileFields`, `sheetName`, `typeOfSheet`, `norm`, `mapHeaders`, `toPayload`, `excelDate`, `sampleRows`, `sheet`, `guideSheet` |
| `app/Services/CredVault/VaultFile.php` | `MAX_ROWS = 2000`, OLE2 refusal, `read`, `xlsxSheets`, `readXlsxSheet`, CSV/TSV/JSON/XML readers, `build`, `csv` (+ `safeCell`), `xlsx`, `bundle` |
| `app/Services/CredVault/ExcelLock.php` | `encrypt()` — the Agile-encrypted `.xlsx` |
| `app/Models/CredVault/Transfer.php` | `credvault_transfers`; `KINDS`, `PREFIXES`, `FORMAT_LABELS`, `SCOPE_LABELS` |
| `app/Models/CredVault/Credential.php` | `TYPES`, `GROUPS`, `SCOPES`, `STRENGTH_LABELS`, `strengthOf`, `secretIsPassword`, `typeDef`, `isProtected`, `isCriticalVault`, `hashSecret` |
| `app/Models/CredVault/AuditLog.php` | labels for `importx`, `backup`, `backupfail`, `export` |
| `app/Providers/AppServiceProvider.php` | `throttle:credvault` limiter; loads `database/migrations/credvault` |

### Frontend

| File | What is in it |
|---|---|
| `resources/js/pages/credvault/import-recovery/ImportRecovery.tsx` | The page: tabs, `?tab=` handling, both history loaders, on-page search |
| `…/ImportModal.tsx` | "Import data" guide popup, all-category samples, drop zone |
| `…/ImportCategoryModal.tsx` | "Import by category": types load + shimmer, category select, per-category sample, file check, preview call |
| `…/irReview.ts` | `buildReview()` — splits the preview into Accepted / Discarded |
| `…/ImportReviewModal.tsx` | "Review {Category} import": tabs, strength, Save → `importRun`, 410 handling |
| `…/BackupModal.tsx` | "Download backup": format, scope counts, switches, `pwScore`, `create()` |
| `…/irShared.tsx` | `IR_I` icons, `IrCard`, `HistoryCard` (both tables + pager), `ImportVeil` |
| `resources/js/pages/credvault/cvApi.ts` | `importSample`, `importTypes`, `importPreviewTyped`, `importPreview` (unused), `importRun`, `imports`, `backup`, `backups`, `exportPreview`, `exportRun`, `exports` (unused); `download()` |
| `resources/js/pages/credvault/shared.tsx` | `CvTabsRow` (tabs + autofill-guarded search) |
| `resources/js/pages/credvault/team-vault/ExportModal.tsx` | "Export Credentials" popup |
| `resources/js/pages/credvault/credvault.css` | `.ir-*`, `.ix-*`, `.ir-cat-shim*`, `.cv-lock*`, `.ir-ac-trap`, `.cv-search-form` |

### Routes

`routes/api.php`, inside `Route::prefix('credvault')->middleware('throttle:credvault')`,
block `// Import & Recovery` — eleven lines, see API §1. Frontend route
`/credentials-vault/import-recovery` in `components/App.tsx`.

---

## 2. Request flow — Import by category

```
ImportModal (drop / click) ─ setCat({file})
  └─ ImportCategoryModal
       useEffect → cvApi.importTypes()          GET  /imports/types
       pick(key) / file input → read(f, cat)
         extension check (xlsx|csv) in the browser
         setBusy(true) → <ImportVeil "Checking your … sheet…">
         cvApi.importPreviewTyped(type, f)       POST /imports/preview (multipart)
         → buildReview(cat, preview) → onReviewed
  └─ ImportReviewModal
       save() → cvApi.importRun({token, rows: accepted.map(x => x.index),
                                 duplicates: 'skip'})   POST /imports
         201 → onSaved(message) → ImportRecovery.saved(): close, toast, loadImports(1)
         410 → toast "This review has expired" → onExpired → back to the category popup
```

### 2.1 Server: `importPreview()` → `importPreviewTyped()`

1. `tenantUser()` — 403 without tenant / module view.
2. `if ($request->filled('type')) return $this->importPreviewTyped(...)` —
   the only switch between the two importers.
3. Validate `type` (25 keys) and `file` (`xlsx,csv,tsv,txt`, 5120 KB).
4. `.xlsx`: `VaultFile::xlsxSheets()` (refuses OLE2), find the named tab;
   refuse *"This workbook has no “…” tab"* when the workbook has more than two
   sheets, other type tabs, and not this one. Then `readXlsxSheet()` with a
   matcher: the named tab, else the first that is not "How to fill".
   Otherwise `VaultFile::read()`.
5. `ImportTemplate::mapHeaders()` → refuse when a required column is missing.
6. Per row: `toPayload()` → `Validator::make()` on the meta rules →
   `validateTypeFields()` (with `importing = true`) → flags → notes.
7. Park `{typed, type, rows[+payload], file_name, format, source}` encrypted
   in the cache; return everything except `payload`.

### 2.2 Server: `import()` → `runTypedImport()`

```php
$cacheKey = $this->importCacheKey($u, $d['token']);
if (!Cache::add("{$cacheKey}:running", 1, 120)) $this->reject('This import is already running.', 'token', 409);

try {
    $payload = Cache::get($cacheKey);   // read only once the marker is ours
    if (!$payload) $this->reject('This preview has expired or was already imported. Upload the file again.', 'token', 410);
    …
    $result = !empty($payload['typed']) ? $this->runTypedImport(…) : $this->runImport(…);
    Cache::forget($cacheKey);
} finally {
    Cache::forget("{$cacheKey}:running");
}
```

Inside `runTypedImport()`, in one `inTransaction('import the credentials')`:

1. `importing = true` (reset in `finally`).
2. For each cached row: `failed` → straight to the failed list; not picked →
   skip; duplicate with `skip` → skip; duplicate with `copy` → name +
   " (imported)" (limited to 139 + 11 characters).
3. `DB::transaction(fn () => $this->persistCredential(Request::create('/', 'POST', $p), $u, null, 'normal'))`
   — a savepoint per row; `ValidationException` / `HttpResponseException`
   become failed-row entries.
4. `Transfer::create([... 'code' => nextCode('credvault_transfers', 'IM', …), 'status' => $items ? 'done' : 'failed' ...])`.
5. `audit('importx', …, 'Import & Recovery')`.
6. Response 201 with `imported_codes` + `failed_rows`, or **422 as a returned
   response** (so the token is then forgotten — see Technical §5.2).

---

## 3. Request flow — Download backup

```
BackupModal.create()
  emptyMsg → toast.warning("Can't download an empty backup") and stop
  locked && pw.length < 8 → local error "Choose a password of at least 8 characters."
  cvApi.backup({format, scope, include_passwords, lock, [password, password_confirmation]})
     → download('post', '/backups')   responseType blob → <a download>
  success → toast "{BK-…} · {n} credentials downloaded as {Excel}[ · password locked]"
  failure → JSON read out of the blob → CvApiError; password_confirmation
            message replaced by "The two passwords don’t match. This attempt was recorded."
  either way → onDone() → loadBackups(1)   (failed attempts are history rows too)
```

Server `backup()`, guards in order:

| # | Guard | Kind |
|---|---|---|
| 1 | `validate()` — format, scope, booleans, password 8–128 / confirmation when locked | 422 |
| 2 | lock + not xlsx | `reject` |
| 3 | lock + `strengthOf < 3` | `reject` |
| 4 | lock + mismatch | `$fail` — records BK-… `failed`, then rejects |
| 5 | passwords + no lock + no `account_password` | `reject` |
| 6 | same + wrong password | `$fail` |
| 7 | `fileScope()` empty | `reject` |
| 8 | build rows (`backupRows`, `backupTypeSheets` for xlsx) | |
| 9 | `inTransaction('record the backup')`: `nextCode` → `$build($code)` → `ExcelLock::encrypt` if locked → `Transfer::create` → `audit('backup')` | |
| 10 | `download()` with `X-CredVault-Code/Items/Withheld` | 200 |

The `$fail` closure:

```php
$fail = function (string $why, string $field) use ($u, $d, $fmtLabel, $scopeLabel) {
    $this->inTransaction('record the failed backup', function () use (…) {
        $t = Transfer::create([... 'kind' => 'backup', 'code' => $this->nextCode('credvault_transfers', 'BK', $u->client_id),
            ... 'status' => 'failed', 'failure_reason' => $why]);
        $this->audit($u, 'backupfail', null, "{$t->code} · {$fmtLabel} · {$scopeLabel} · {$why}", …);
    });
    $this->reject($why . '.', $field);
};
```

So a failed attempt **commits** its row and then raises the 422 — the record
survives the refusal. Only guards 4 and 6 use it.

---

## 4. Request flow — Team Vault export

```
TeamVault → <ExportModal selection={{tab, department_id}} loadPreview={tvData.exportPreview}>
  useEffect → GET /exports/preview → groups with count > 0, all ticked
  run() → cvApi.exportRun({tab, department_id?, groups, format:'csv',
                           include_notes:true, include_passwords, [acknowledge, account_password]})
        → POST /exports → exportSet() → exportRows() → VaultFile::build()
        → inTransaction: Transfer EX-… + audit('export', …, 'Team Vault') → download
```

`exportSet()` (team tab):

```php
$q->where('scope', 'team')->where('owner_id', '!=', $u->id)->whereNotIn('credvault_credentials.id', $this->sharedWithMeIds($u));
```

— the team's credentials, not yours, not shared with you. The Team Vault
page passes **no** `q`: *"The table's search must not narrow the export — it
exports the whole tab (or open department)."*

---

## 5. Inside `transferHistory()`

```php
$page = Transfer::where('client_id', $u->client_id)->where('kind', $kind)
    ->when(!$this->isAdmin($u) || ($f['mine'] ?? false), fn ($q) => $q->where('user_id', $u->id))
    ->with('user:id,name')->orderByDesc('id')
    ->paginate($f['per_page'] ?? self::PAGE_SIZE, ['*'], 'page', $f['page'] ?? 1);
$this->userInfo(collect($page->items())->pluck('user_id')->unique()->all());
```

`userInfo()` is called once for the page so every `transferRow()` reads the
role line from the memo. `GET /backups` then appends `scopes` (three
`fileScope(..., true)` calls — each loads the user's whole visible set with
`LIGHT_COLUMNS`, which skips the encrypted columns), `columns` and
`lock_note`.

---

## 6. Inside `VaultFile`

```php
/** An Excel file with a password (a locked backup) or an old .xls — both are OLE2 files, not a zip. */
private const OLE2 = "\xD0\xCF\x11\xE0";
```

`read()` picks a reader by **content first** (`PK` → xlsx) and extension
second, so a renamed file still reads. CSV reading undoes the writer's
formula guard:

```php
// Undo safeCell(): our own CSVs guard =+-@ with a leading apostrophe, which
// would otherwise come back as part of the password.
```

and the writer adds one apostrophe more when one is already there —
*"so the reader's single-apostrophe strip always gives the original value
back."*

---

## 7. Frontend details

| Detail | Where | Why |
|---|---|---|
| `ImportVeil` = `<div class="cv-lock">` over the popup | Category, Review, Backup popups | *"the same as the Add / Edit credential form's saving overlay: it covers the whole popup, so nothing … can change until the request ends."* CSS: *"Save lock — the Customer form's loader in teal"* |
| Close / Cancel / × ignore clicks while `busy` | all three | belt and braces with the veil |
| Opening shimmer `.ir-cat-shim` | `ImportCategoryModal` | shown while `types` is null and no error |
| Search in its own `<form role="search" autoComplete="off">`, `type="search"`, `name="cv-tabs-search"`, `data-lpignore`, `data-1p-ignore` | `CvTabsRow` | *"a browser filling a saved login for a password field elsewhere on the page never reaches into this one."* |
| Hidden `username` input `.ir-ac-trap` + `autoComplete="new-password"` | `BackupModal` form | *"when a saved password is picked for the backup password, the browser fills that login's email in here — not into the page's search box."* |
| `?tab=` effect keyed on `useLocation().key` | `ImportRecovery` | *"so the same quick action re-selects its tab after a manual switch."* |
| `impSeq` / `bkSeq` | `ImportRecovery` | *"One request id per list, so a slow older page can't overwrite a newer one."* |
| Search filters the loaded page only | `ImportRecovery` | the API has no `q` on history |
| `Download` disabled while `n === null` | `BackupModal` | counts not loaded yet; *"CS-1474 / 1475 / 1476: an empty vault says so … instead of a dead button."* |
| `STR_LEVEL` label → level | `ImportReviewModal` | *"The API sends the strength label; the meter needs its level"* |

---

## 8. Patterns you will see in this code

| Pattern | Where | Why |
|---|---|---|
| `tenantUser()` first line | every method | tenant + module view in one memoised check |
| `reject($msg, $field, $status)` | everywhere | one 422/403/404/409/410 shape; the field puts the message on the right input |
| `inTransaction($action, fn)` | every write | all-or-nothing; refusals pass through, anything else is a logged 500 with "Could not {action}. Nothing was saved" |
| Record-then-refuse (`$fail`) | `backup()` | a failed attempt must survive in history |
| Token + encrypted cache | import | the passwords never travel back to the browser; the run names rows by index |
| `Cache::add` marker | `import()` | atomic "already running" guard |
| The Add form reused for rows | `runTypedImport()` | one validator for typed and imported credentials |
| `importing` flag | preview + run | relaxes exactly three form rules (Technical §5.3) |
| `$light` / `LIGHT_COLUMNS` | `fileScope`, `exportSet` | counts without decrypting secrets |
| `X-CredVault-*` headers | file responses | the toast reads code / count / withheld without a second call |
| Prototype names in comments (`irTry`, `bkCreate`, `irDetect`) | throughout | the HTML prototype these screens were ported from |

---

## 9. Symptom → file

| Symptom | Look in |
|---|---|
| Category dropdown empty / "Could not load the categories" | `importTypes()`; `tenantUser()` 403 |
| "… is not a supported file" before any request | `ImportCategoryModal.read()` — `EXTS = ['xlsx','csv']` |
| "The sheet is not a {Label} sheet — missing column…" | `ImportTemplate::mapHeaders()` / `norm()` — header text vs label/key |
| A browser / password-manager CSV is refused | Expected: the screen only runs the typed preview. The alias detection is in `IMPORT_ALIASES` / `detectSource()` (generic path, unused by the UI) |
| "This workbook has no “…” tab" | `importPreviewTyped()` — `$named` / `$other` / `count($sheets) > 2` |
| "This Excel file is password-protected or in the old .xls format…" | `VaultFile::OLE2` — a locked backup or real `.xls` |
| A valid-looking row discarded as duplicate | typed dup rule: same owner + **type** + name, either vault (`$mine` in `importPreviewTyped`) |
| Row fails with a field message | `validateTypeFields()` → `checkField()` |
| Required file missing does not fail the row | by design — `importing` flag in `validateTypeFields()` |
| Weak password imported instead of refused | by design — `importing` in `persistCredential()` |
| Toast "This review has expired" | 410 — TTL 1800 s (`IMPORT_TTL`), or the token was spent |
| Retry after "Nothing was imported…" gets 410 | `runTypedImport()` returns 422 instead of throwing → `Cache::forget` runs |
| "This import is already running." | `:running` cache marker, 120 s |
| Import row shows Imported 0, no reason | `status = failed` is stored but `HistoryCard` has no status/failed column; reason via `GET /imports/{id}` |
| Many activity entries per import expected, one found | CS-1479 — `persistCredential()` skips `create` audit while importing |
| Backup refused "…needs your account password…" from the screen | `BackupModal` never sends `account_password`; `backup()` guard 5 |
| Meter says Good, server says "Use 8+ characters…" | `pwScore()` vs `Credential::strengthOf()` |
| CSV backup cannot be locked | `canLock = fmt === 'xlsx'`; server guard 2 |
| Failed attempt missing from backup history | only guards 4 and 6 use `$fail` |
| Vault cards show their descriptions instead of "{n} credentials", Download disabled | `GET /backups` not loaded or failed → `infoError`, Retry |
| Backup has fewer credentials than My Vault + Team Vault | `fileScope()` drops shared-only (`via share`) and Critical Vault; see the share-override note (Technical §6) |
| Secret column shows "[Protected — unlock in CredVault]" / "[No copy permission]" | `fileSecret()` |
| Type tab of the backup has an empty secret | `backupTypeSheets()` — `$open = $withSecrets && !$c->isProtected()` |
| Locked backup will not open in Excel | `ExcelLock::encrypt()`; a 500 "Could not record the backup" means it threw |
| Backup ID in the file ≠ history code | `$build($code)` inside the `record the backup` transaction |
| Export count differs from the Team Vault table | `exportSet()` — team tab excludes your own and shared-with-you; the table search is not passed |
| Export includes a Critical credential | `exportSet()` has no `isCriticalVault()` filter (unlike `fileScope()`) |
| Export history not on any screen | `cvApi.exports` is unused; rows exist in `credvault_transfers` |
| Wrong / duplicate IM-, BK-, EX- code | `nextCode()` / `lastNumber()` — client row lock, unique `(client_id, code)` |
| Other modules' numbering stalls during a big import | the client row lock is held for the whole import transaction (Technical §4, inferred) |
| History search finds nothing that exists on page 2 | the search filters the loaded page only (`ImportRecovery.tsx`) |
| Browser autofills an email into the search box | `CvTabsRow` form guards; `BackupModal` `.ir-ac-trap` |
| 429 Too Many Requests | `throttle:credvault` — 240/min per user, whole module |
