# DUE DILIGENCE (DD) — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Due Diligence (DD)**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: list → create → edit → delete → code allocation → downstream consumption.
File: [ClmDdController.php](../../../../app/Http/Controllers/Api/ClmDdController.php).
Structurally identical to `ClmKycController`; the differences are called out in §8.

---

## 1. LIST (`index`)

```php
$user = $request->user(); if (!$user) abort(401);

// Branch-scoped read: own rows + client-level (shared); sibling branches hidden.
$q = ClmDdDocument::query()->orderBy('id');
MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);
$rows = $q->get();

// `authority` stores authority IDS → surface the resolved CURRENT names.
$map = ClmAuthority::idNameMap($user->client_id);
$rows->each(fn ($r) => $r->authority_names = ClmAuthority::displayNames($r->authority, $map));

// Per-row "in use" flags mirroring destroy()'s checks.
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
    'authority' => 'required|string|max:2000',      // multi-authority documents
    'expiry'    => 'nullable|string|max:32',
    'status'    => ['nullable', Rule::in(ClmDdDocument::STATUSES)],
]);

// (1) case-insensitive duplicate WITHIN THE CALLER'S SCOPE
$name = trim($data['name']);
$dupe = ClmDdDocument::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
if ($dupe->exists()) throw ValidationException::withMessages([
    'name' => "A due-diligence document named \"{$name}\" already exists. Pick a different name."]);

// (2) authority: ids AND/OR names → canonical comma-joined IDS; unknown tokens dropped
$data['authority'] = ClmAuthority::normalizeIds($data['authority'] ?? null, $user->client_id);
if ($data['authority'] === '') throw ValidationException::withMessages([
    'authority' => 'Select at least one valid authority.']);

// (3) persist
DB::transaction(fn() => ClmDdDocument::create([
    'client_id'  => $user->client_id,
    'branch_id'  => $user->branch_id,                 // NULL for client-level users ⇒ shared
    'code'       => $this->nextCode($user->client_id, $user->branch_id),
    'name'       => trim($data['name']),
    'authority'  => $data['authority'],
    'expiry'     => $data['expiry'] ?? 'N/A',
    'status'     => $data['status'] ?? STATUS_ACTIVE,
    'created_by' => $user->id, 'updated_by' => $user->id,
]));
→ 201 { status:true, data: row }
```

---

## 3. EDIT (`update`)

```php
$lookup = ClmDdDocument::query()->whereKey($id);
MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
$row = $lookup->firstOrFail();                                    // 404 when out of scope
if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) → 403 $msg

$data = validate([ name?, authority?, expiry?, status? ]);        // all `sometimes|required`

if (isset($data['name']))      $data['name'] = trim($data['name']);
if (isset($data['authority'])) {
    $data['authority'] = ClmAuthority::normalizeIds($data['authority'], $user->client_id);
    if ($data['authority'] === '') throw ValidationException 'Select at least one valid authority.';
}

if (isset($data['name'])) {                                        // rename-to-duplicate guard
    $clash = ClmDdDocument::query()->where('id','!=',$row->id)
               ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])]);
    MasterVisibility::applyReadScope($clash, $user, $user->branch_id ?: null);
    if ($clash->exists()) throw ValidationException
        'Another due-diligence document named … already exists.';
}

$data['updated_by'] = $user->id;
$row->update($data);
→ 200 { data: $row->fresh() }
```

**No in-use edit lock.** Segment rules and vault uploads reference the immutable `code`, so renaming a DD document never orphans anything.

---

## 4. DELETE (`destroy`)

```php
scoped firstOrFail → hierarchicalDenial('delete') → 403

$usedIn = $this->usageCheck($row->code);
if ($usedIn) → 409 {
    message: 'This due-diligence document is in use by Segment Rules, Segment Doc Uploads.
              Remove or reassign those records before deleting.',
    used_in: $usedIn }

$row->delete();     // HARD delete
```

### `usageCheck(?string $code)`
```php
/** Shared usage check — referenced by segment rules (doc_selections JSON)
 *  and by segment_doc_uploads (doc_code). */
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

Two caveats carried over from the shared pattern:
- `doc_selections` is matched as a **raw JSON substring** (`LIKE '%"DD-002"%'`) — portable across engines, but not a structural JSON query.
- **Neither lookup filters `client_id`.** `DD-NNN` codes restart per tenant, so tenant B's rule referencing *their* `DD-001` blocks tenant A from deleting *their* `DD-001`. `ClmQcController::usageCheck()` shows the scoped form.

---

## 5. CODE ALLOCATION (`nextCode`)

```php
DB::table('clients')->where('id',$clientId)->lockForUpdate()->first();

// Branch-scoped so each branch restarts from DD-001 rather than continuing
// another branch's tally. A client-level creator ($branchId null) sequences the shared rows.
$query = ClmDdDocument::where('client_id',$clientId);
$branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id',$branchId);
$codes = $query->pluck('code');

foreach ($codes as $c) {
    if (preg_match('/^DD-(\d+)$/', $c, $m)) $maxN = max($maxN, (int)$m[1]);
    $taken[$c] = true;
}
$n = $maxN;
do { $n++; $code = sprintf('DD-%03d', $n); } while (isset($taken[$code]));
```

---

## 6. DOWNSTREAM CONSUMPTION

```php
// ClmSegmentRuleController::bootstrap()
$dd = applyReadScope(ClmDdDocument::query()->orderBy('id'), $user, $branchId)->get();
$dd->each(function ($r) use ($authMap) {
    $r->authority_list = ClmAuthority::displayNamesList($r->authority, $authMap);  // ARRAY first…
    $r->authority      = ClmAuthority::displayNames($r->authority, $authMap);      // …then overwrite
});

// the rule stores only the CODE
doc_selections['dd'] = { "DD-002": "M", "DD-005": "O" }

// ClmSegmentRuleController::forSegment() — what the party forms read back
$codes = array_keys($rule->doc_selections['dd'] ?? []);
$rows  = ClmDdDocument::where('client_id',$cid)->whereIn('code',$codes)->get();
each → { id, code, name, status, authority (names), authority_list[], expiry, requirement:'M'|'O' }

// SegmentDocUploadController::store()
segment_doc_uploads { category:'dd', doc_code:'DD-002',
                      doc_name:<snapshot>, requirement:<snapshot>,
                      attachment_path, expiry_date }
// the snapshot means the Evidence Vault renders what the user SAW at upload time,
// even if the rule changes afterwards

// ClmBuyerProfileController / ClmSupplierProfileController
// 'dd' is one of the CATS = ['kyc','dd','tl','td'] progress ratios on every scorecard
```

---

## 7. FRONTEND

```tsx
// ClmDdPage.tsx
api.get('/clm/dd-documents')  → rows { authority, authority_names, in_use, used_in }
authority column → <AuthorityBadges list={authority_list} />
row.in_use → delete disabled + <Tooltip themed>{used_in.join(', ')}</Tooltip>

export function DdModal(...)   // ← imported by ClmDcpPage
// add a missing DD document from inside the rule-configuration modal;
// the DCP re-fetches /clm/segment-rules/bootstrap afterwards
```

---

## 8. DIFFERENCES FROM THE KYC CONTROLLER

| Aspect | KYC | DD |
|---|---|---|
| Code prefix | `KYC-` | `DD-` |
| Regex | `/^KYC-(\d+)$/` | `/^DD-(\d+)$/` |
| Duplicate message | "A KYC document named …" | "A due-diligence document named …" |
| Vault category | `kyc` | `dd` |
| Permission slug | `clm.kyc` | `clm.due_diligence` |
| Exported modal | `KycModal` | `DdModal` |

Everything else — scoping, validation shape, authority normalisation, usage check, allocator — is byte-for-byte equivalent.

---

## 9. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| `applyReadScope` on every query, dupe checks included | all methods | Uniqueness must match visibility |
| `normalizeIds()` on write | store/update | One canonical storage shape |
| `idNameMap()` + `displayNames()` on read | index | Authority renames propagate for free |
| `displayNamesList()` computed **before** overwriting `authority` | DCP bootstrap | Names may contain commas |
| Per-row `in_use` mirroring `destroy()` | index | The UI disables what the server would refuse |
| `Schema::hasTable/hasColumn` guards | usageCheck | Survives partial migrations |
| Client row lock + MAX+1 + skip-taken | nextCode | Deletes leave gaps |
| Code, not name, stored downstream | rules + uploads | Renames are always safe |

---

## 10. NOTES & CAVEATS

- `usageCheck()` is **not** client-scoped (QC's is).
- No edit lock; renames are safe by design.
- Deletes are hard; `client_id` cascades from `clients`.
- `authority` is capped at 2,000 characters.
- `expiry` is a descriptor; the real per-file date lives on `segment_doc_uploads.expiry_date`.
- There is no built-in re-verification cadence for DD checks.
- DB is PostgreSQL.

---

*Related documents: DUE_DILIGENCE_FUNCTIONAL_DOCUMENTATION.md · DUE_DILIGENCE_TECHNICAL_DOCUMENTATION.md · DUE_DILIGENCE_API_DOCUMENTATION.md*
