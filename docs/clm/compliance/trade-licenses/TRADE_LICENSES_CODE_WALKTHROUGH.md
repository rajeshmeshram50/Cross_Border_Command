# TRADE LICENSES — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Trade Licenses**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: list → create → edit → delete → code allocation → downstream consumption.
File: [ClmTradeLicenseController.php](../../../../app/Http/Controllers/Api/ClmTradeLicenseController.php).
Same CLM master pattern as KYC/DD; the deltas are called out in §8.

---

## 1. LIST (`index`)

```php
$user = $request->user(); if (!$user) abort(401);

// Branch-scoped read: own rows + client-level (shared); siblings hidden (CBC-435).
$q = ClmTradeLicense::query()->orderBy('id');
MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);
$rows = $q->get();

// `authority` stores authority IDS → surface the resolved CURRENT names.
$map = ClmAuthority::idNameMap($user->client_id);
$rows->each(fn ($r) => $r->authority_names = ClmAuthority::displayNames($r->authority, $map));

// Per-row "in use" flags so the UI can disable + explain the delete action
// (mirrors the checks in destroy()).
$rows->each(function ($r) {
    $labels     = $this->usageCheck($r->code);
    $r->in_use  = !empty($labels);
    $r->used_in = array_values($labels);
});

return ['status'=>true, 'data'=>$rows, 'count'=>$rows->count()];
```

---

## 2. CREATE (`store`)

```php
if (!$user->client_id) → 403 'No tenant context for this user'

$data = $request->validate([
    'name'      => 'required|string|max:255',
    'authority' => 'required|string|max:255',    // ← 255, NOT 2000 (KYC/DD were widened, TL wasn't)
    'validity'  => 'nullable|string|max:32',     // ← `validity`, not `expiry`
    'status'    => ['nullable', Rule::in(ClmTradeLicense::STATUSES)],
]);

// (1) case-insensitive duplicate WITHIN THE CALLER'S SCOPE
$name = trim($data['name']);
$dupe = ClmTradeLicense::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
if ($dupe->exists()) {
    $msg = "A trade licence named \"{$name}\" already exists. Pick a different name.";
    // 422 + errors.name so the modal shows it inline under LICENCE NAME
    // (not a global toast) — same shape Laravel's `unique` rule returns.
    return response()->json(['status'=>false, 'message'=>$msg,
                             'errors'=>['name'=>[$msg]]], 422);
}

// (2) authority: ids AND/OR names → canonical comma-joined IDS; unknown tokens dropped
$data['authority'] = ClmAuthority::normalizeIds($data['authority'] ?? null, $user->client_id);
if ($data['authority'] === '') throw ValidationException::withMessages([
    'authority' => 'Select at least one valid authority.']);

// (3) persist
DB::transaction(fn() => ClmTradeLicense::create([
    'client_id'  => $user->client_id,
    'branch_id'  => $user->branch_id,                 // NULL for client-level users ⇒ shared
    'code'       => $this->nextCode($user->client_id, $user->branch_id),
    'name'       => trim($data['name']),
    'authority'  => $data['authority'],
    'validity'   => $data['validity'] ?? 'N/A',
    'status'     => $data['status'] ?? STATUS_ACTIVE,
    'created_by' => $user->id, 'updated_by' => $user->id,
]));
→ 201 { status:true, data: row }
```

Note the two error styles in one method: the name clash is a **hand-built** 422 envelope, the authority failure a **thrown** `ValidationException`. Both surface as HTTP 422 with an `errors` map, so the client handles them identically.

---

## 3. EDIT (`update`)

```php
$lookup = ClmTradeLicense::query()->whereKey($id);
MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
$row = $lookup->firstOrFail();                                    // 404 when out of scope
if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) → 403 $msg

$data = validate([ name?, authority? (max:255), validity?, status? ]);   // all `sometimes|required`

if (isset($data['name']))      $data['name'] = trim($data['name']);
if (isset($data['authority'])) {
    $data['authority'] = ClmAuthority::normalizeIds($data['authority'], $user->client_id);
    if ($data['authority'] === '') throw ValidationException 'Select at least one valid authority.';
}

if (isset($data['name'])) {                                        // rename-to-duplicate guard
    $clash = ClmTradeLicense::query()->where('id','!=',$row->id)
               ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])]);
    MasterVisibility::applyReadScope($clash, $user, $user->branch_id ?: null);
    if ($clash->exists()) → 422 { message, errors: { name: [msg] } }
}

$data['updated_by'] = $user->id;
$row->update($data);
→ 200 { data: $row->fresh() }
```

**No in-use edit lock.** Segment rules and vault uploads reference the immutable `code`, so renaming a licence never orphans anything.

---

## 4. DELETE (`destroy`)

```php
scoped firstOrFail → hierarchicalDenial('delete') → 403

$usedIn = $this->usageCheck($row->code);
if ($usedIn) → 409 {
    message: 'This trade licence is in use by Segment Rules, Segment Doc Uploads.
              Remove or reassign those records before deleting.',
    used_in: $usedIn }

$row->delete();     // HARD delete
```

### `usageCheck(?string $code)`
```php
if (!$code) return [];

if (Schema::hasTable('clm_segment_rules')
 && Schema::hasColumn('clm_segment_rules','doc_selections')
 && DB::table('clm_segment_rules')->where('doc_selections','like','%"'.$code.'"%')->exists())
    $usedIn[] = 'Segment Rules';

if (Schema::hasTable('segment_doc_uploads')
 && Schema::hasColumn('segment_doc_uploads','doc_code')
 && DB::table('segment_doc_uploads')->where('doc_code',$code)->exists())
    $usedIn[] = 'Segment Doc Uploads';
```

- `doc_selections` is matched as a **raw JSON substring** — portable across engines, not a structural JSON query.
- **Neither lookup filters `client_id`.** `TL-NNN` codes restart per tenant, so another tenant's rule referencing *their* `TL-001` blocks your delete of *your* `TL-001`. `ClmQcController::usageCheck()` is the scoped reference implementation.

---

## 5. CODE ALLOCATION (`nextCode`)

```php
DB::table('clients')->where('id',$clientId)->lockForUpdate()->first();

// Branch-scoped so each branch restarts from TL-001 rather than continuing
// another branch's tally. A client-level creator ($branchId null) sequences the shared rows.
$query = ClmTradeLicense::where('client_id',$clientId);
$branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id',$branchId);
$codes = $query->pluck('code');

foreach ($codes as $c) {
    if (preg_match('/^TL-(\d+)$/', $c, $m)) $maxN = max($maxN, (int)$m[1]);
    $taken[$c] = true;
}
$n = $maxN;
do { $n++; $code = sprintf('TL-%03d', $n); } while (isset($taken[$code]));
```

---

## 6. DOWNSTREAM CONSUMPTION

```php
// ClmSegmentRuleController::bootstrap()
$tl = applyReadScope(ClmTradeLicense::query()->orderBy('id'), $user, $branchId)->get();
$tl->each(function ($r) use ($authMap) {
    $r->authority_list = ClmAuthority::displayNamesList($r->authority, $authMap);  // ARRAY first…
    $r->authority      = ClmAuthority::displayNames($r->authority, $authMap);      // …then overwrite
});

// the rule stores only the CODE
doc_selections['tl'] = { "TL-001": "M", "TL-004": "O" }

// ClmSegmentRuleController::forSegment() — what the party forms read back.
// The optional-field loop surfaces `validity` for TL rows (and `expiry` for KYC/DD),
// because it copies whichever of those attributes actually exists on the model.
$codes = array_keys($rule->doc_selections['tl'] ?? []);
$rows  = ClmTradeLicense::where('client_id',$cid)->whereIn('code',$codes)->get();
each → { id, code, name, status, authority (names), authority_list[], validity,
         requirement:'M'|'O' }

// SegmentDocUploadController::store()
segment_doc_uploads { category:'tl', doc_code:'TL-001',
                      doc_name:<snapshot>, requirement:<snapshot>,
                      attachment_path, expiry_date }   // ← the REAL licence expiry lands here

// ClmBuyerProfileController / ClmSupplierProfileController
// 'tl' is one of the CATS = ['kyc','dd','tl','td'] progress ratios on every scorecard
```

---

## 7. FRONTEND

```tsx
// ClmTradeLicensesPage.tsx
api.get('/clm/trade-licenses')  → rows { authority, authority_names, in_use, used_in }
authority column → <AuthorityBadges list={authority_list} />
row.in_use → delete disabled + <Tooltip themed>{used_in.join(', ')}</Tooltip>
422 errors.name → bound to the LICENCE NAME input (inline, not a toast)

export function TlModal(...)   // ← imported by ClmDcpPage
// add a missing licence from inside the rule-configuration modal;
// the DCP re-fetches /clm/segment-rules/bootstrap afterwards
```

---

## 8. DIFFERENCES FROM THE KYC / DD CONTROLLERS

| Aspect | KYC / DD | Trade Licenses |
|---|---|---|
| Date column | `expiry` | **`validity`** |
| `authority` max length | 2000 (widened 2026-06-06) | **255** (never widened) |
| Duplicate-name error | thrown `ValidationException` | **hand-built** `{status,message,errors.name}` 422 |
| Code prefix / regex | `KYC-` / `DD-` | `TL-` |
| Vault category | `kyc` / `dd` | `tl` |
| Permission slug | `clm.kyc` / `clm.due_diligence` | `clm.trade_licenses` |
| Exported modal | `KycModal` / `DdModal` | `TlModal` |

Scoping, authority normalisation, usage checking and code allocation are otherwise identical.

---

## 9. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| `applyReadScope` on every query, dupe checks included | all methods | Uniqueness must match visibility |
| `normalizeIds()` on write | store/update | One canonical storage shape |
| `idNameMap()` + `displayNames()` on read | index | Authority renames propagate for free |
| `displayNamesList()` computed **before** overwriting `authority` | DCP bootstrap | Names may contain commas |
| `errors.<field>` envelope | store/update | Renders inline in the modal |
| Per-row `in_use` mirroring `destroy()` | index | The UI disables what the server would refuse |
| `Schema::hasTable/hasColumn` guards | usageCheck | Survives partial migrations |
| Client row lock + MAX+1 + skip-taken | nextCode | Deletes leave gaps |
| Code, not name, stored downstream | rules + uploads | Renames are always safe |

---

## 10. NOTES & CAVEATS

- `usageCheck()` is **not** client-scoped (QC's is).
- `authority` is capped at **255** characters here — materially tighter than KYC/DD.
- No edit lock; renames are safe by design.
- Deletes are hard; `client_id` cascades from `clients`.
- `validity` is a descriptor; the real licence expiry lives on `segment_doc_uploads.expiry_date`.
- There is no renewal-reminder mechanism in the master.
- DB is PostgreSQL.

---

*Related documents: TRADE_LICENSES_FUNCTIONAL_DOCUMENTATION.md · TRADE_LICENSES_TECHNICAL_DOCUMENTATION.md · TRADE_LICENSES_API_DOCUMENTATION.md*
