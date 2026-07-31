# KYC — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **KYC**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: list → create → edit → delete → code allocation → downstream consumption.
File: [ClmKycController.php](../../../../app/Http/Controllers/Api/ClmKycController.php).
This controller is the **reference implementation** — `ClmDdController` and `ClmTradeLicenseController` are line-for-line copies with a different prefix, label and `expiry`/`validity` column.

---

## 1. LIST (`index`)

```php
$user = $request->user(); if (!$user) abort(401);

// Branch-scoped read: a branch admin sees its own rows + client-level (shared) rows;
// sibling branches stay hidden (CBC-433/KYC).
$q = ClmKycDocument::query()->orderBy('id');
MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);
$rows = $q->get();

// `authority` stores authority IDS → expose the resolved CURRENT names so the list
// (and any name search) shows live values.
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

> The DCP's `bootstrap()` additionally stamps `authority_list` (the **array** form) on each row. The plain KYC list ships `authority_names` as a joined string; the page's `AuthorityBadges` component consumes the array variant coming from the bootstrap payload.

---

## 2. CREATE (`store`)

```php
if (!$user->client_id) → 403 'No tenant context for this user'

$data = $request->validate([
    'name'      => 'required|string|max:255',
    'authority' => 'required|string|max:2000',      // widened for multi-authority documents
    'expiry'    => 'nullable|string|max:32',
    'status'    => ['nullable', Rule::in(ClmKycDocument::STATUSES)],
]);

// (1) case-insensitive duplicate WITHIN THE CALLER'S SCOPE
$name = trim($data['name']);
$dupe = ClmKycDocument::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
if ($dupe->exists()) throw ValidationException::withMessages([
    'name' => "A KYC document named \"{$name}\" already exists. Pick a different name."]);

// (2) authority: whatever arrived (ids AND/OR names) → canonical comma-joined IDS
$data['authority'] = ClmAuthority::normalizeIds($data['authority'] ?? null, $user->client_id);
if ($data['authority'] === '') throw ValidationException::withMessages([
    'authority' => 'Select at least one valid authority.']);      // unknown tokens are dropped

// (3) persist
DB::transaction(fn() => ClmKycDocument::create([
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

`normalizeIds()` is the important step: the modal may post ids (from the multi-select) or names (from a paste / legacy payload), and the server stores exactly one canonical shape.

---

## 3. EDIT (`update`)

```php
$lookup = ClmKycDocument::query()->whereKey($id);
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
    $clash = ClmKycDocument::query()->where('id','!=',$row->id)
               ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])]);
    MasterVisibility::applyReadScope($clash, $user, $user->branch_id ?: null);
    if ($clash->exists()) throw ValidationException 'Another KYC document named … already exists.';
}

$data['updated_by'] = $user->id;
$row->update($data);
→ 200 { data: $row->fresh() }
```

Note there is **no in-use edit lock** here (unlike segments or clause types). Renaming a KYC document is safe because everything downstream stores the immutable **code**, not the name.

---

## 4. DELETE (`destroy`)

```php
scoped firstOrFail → hierarchicalDenial('delete') → 403

$usedIn = $this->usageCheck($row->code);
if ($usedIn) → 409 {
    message: 'This KYC document is in use by Segment Rules, Segment Doc Uploads.
              Remove or reassign those records before deleting.',
    used_in: $usedIn }

$row->delete();      // HARD delete
→ 200 { status:true, message:'Deleted' }
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

Two notes on this block:
- The `doc_selections` test is a **raw JSON substring match** (`LIKE '%"KYC-003"%'`) — portable across MySQL / Postgres / SQLite, but not structural.
- **Neither query filters `client_id`.** Codes restart per tenant, so tenant B's reference to *their* `KYC-001` will block tenant A's delete of *their* `KYC-001`. `ClmQcController::usageCheck()` is the corrected version — it adds `->where('client_id', $clientId)` to both lookups.

---

## 5. CODE ALLOCATION (`nextCode`)

```php
DB::table('clients')->where('id',$clientId)->lockForUpdate()->first();   // serialise concurrent inserts

// Branch-scoped so each branch restarts from KYC-001 rather than continuing
// another branch's tally. A client-level creator ($branchId null) sequences the shared rows.
$query = ClmKycDocument::where('client_id',$clientId);
$branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id',$branchId);
$codes = $query->pluck('code');

foreach ($codes as $c) {
    if (preg_match('/^KYC-(\d+)$/', $c, $m)) $maxN = max($maxN, (int)$m[1]);
    $taken[$c] = true;
}
$n = $maxN;
do { $n++; $code = sprintf('KYC-%03d', $n); } while (isset($taken[$code]));
```
MAX+1 with skip-taken, never `count()+1` — a delete in the middle of the sequence would otherwise produce a code that still exists and violate `UNIQUE(client_id, branch_id, code)`.

---

## 6. DOWNSTREAM CONSUMPTION

```php
// ClmSegmentRuleController::bootstrap() — the DCP modal's single fetch
$kyc = applyReadScope(ClmKycDocument::query()->orderBy('id'), $user, $branchId)->get();
$authMap = ClmAuthority::idNameMap($cid);
$kyc->each(function ($r) use ($authMap) {
    $r->authority_list = ClmAuthority::displayNamesList($r->authority, $authMap);  // ARRAY
    $r->authority      = ClmAuthority::displayNames($r->authority, $authMap);      // string
});
// order matters: the LIST is computed from the stored ids BEFORE `authority` is overwritten

// the rule then stores only the CODE:
doc_selections['kyc'] = { "KYC-001": "M", "KYC-004": "O" }

// ClmSegmentRuleController::forSegment() — what the party forms read back
$codes = array_keys($rule->doc_selections['kyc'] ?? []);
$rows  = ClmKycDocument::where('client_id',$cid)->whereIn('code',$codes)->get();
each → { id, code, name, status, authority (names), authority_list[], expiry,
         requirement: 'M'|'O' }

// SegmentDocUploadController::store() — the party's actual file
segment_doc_uploads { doc_code:'KYC-003', doc_name: <snapshot>, requirement: <snapshot>,
                      attachment_path, expiry_date }
// doc_name + requirement are SNAPSHOTTED so the Evidence Vault renders what the user SAW,
// even if the rule is edited afterwards
```

---

## 7. FRONTEND

```tsx
// ClmKycPage.tsx
api.get('/clm/kyc-documents')  → rows { authority, authority_names, in_use, used_in }
authority column → <AuthorityBadges list={authority_list} />   // first chip + "+N" popover
row.in_use → delete disabled + <Tooltip themed>{used_in.join(', ')}</Tooltip>

export function KycModal(...)   // ← imported by ClmDcpPage
// lets a user add a missing KYC document from inside the rule-configuration modal;
// the DCP re-fetches /clm/segment-rules/bootstrap afterwards
```

---

## 8. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| `applyReadScope` on every query, including dupe checks | all methods | The uniqueness rule must match the visibility rule |
| `normalizeIds()` on write | store/update | One canonical storage shape regardless of what the client posted |
| `idNameMap()` + `displayNames()` on read | index | Authority renames propagate for free |
| `displayNamesList()` before overwriting `authority` | DCP bootstrap | Names may contain commas |
| Per-row `in_use` mirroring `destroy()` | index | UI disables what the server would refuse |
| `Schema::hasTable/hasColumn` guards | usageCheck | Survives partial migrations |
| Client row lock + MAX+1 + skip-taken | nextCode | Gaps from deletes must not collide |
| Code, not name, stored downstream | rules + uploads | Renaming a KYC document is always safe |

---

## 9. NOTES & CAVEATS

- `usageCheck()` is **not** client-scoped (QC's is) — a cross-tenant false positive can block a delete.
- No edit lock: renames are safe because downstream stores the code.
- Deletes are hard; `client_id` cascades from `clients`.
- `authority` is capped at 2,000 characters.
- `expiry` in this table is a descriptor (`N/A` / `Varies` / `MM/YYYY`); the real per-file date lives on `segment_doc_uploads.expiry_date`.
- DB is PostgreSQL.

---

*Related documents: KYC_FUNCTIONAL_DOCUMENTATION.md · KYC_TECHNICAL_DOCUMENTATION.md · KYC_API_DOCUMENTATION.md*
