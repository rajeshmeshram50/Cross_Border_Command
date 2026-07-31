# AUTHORITY — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Authority**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: the id↔name bridge → list (in_use sets) → create → rename cascade → delete → code allocation.
Files: [ClmAuthorityController.php](../../../../app/Http/Controllers/Api/ClmAuthorityController.php), [ClmAuthority.php](../../../../app/Models/ClmAuthority.php).

---

## 1. THE BRIDGE (`App\Models\ClmAuthority` statics)

Every CLM document master calls these. They are the only conversion between stored ids and display names.

```php
idNameMap(?int $clientId): array
    foreach (static::where('client_id',$clientId)->get(['id','name']) as $a)
        $map[(string)$a->id] = $a->name;              // ["12" => "FSSAI"]

displayNames(?string $stored, array $idToName): string
    foreach (explode(',', $stored) as $tok)
        $out[] = $idToName[trim($tok)] ?? trim($tok); // UNKNOWN tokens pass through unchanged
    return implode(', ', $out);                       // "FSSAI, DGFT"

displayNamesList(?string $stored, array $idToName): array
    // identical, but returns the ARRAY.
    // MUST be used wherever the consumer counts/iterates: an authority NAME
    // may itself contain commas ("Aadhaar, Passport, Voter ID"), so splitting
    // the joined display string back apart would over-count it as three.

normalizeIds(?string $input, ?int $clientId): string
    $byId   = [id => id];  $byName = [lower(name) => id];
    foreach (explode(',', $input) as $tok)
        $id = $byId[$tok] ?? $byName[lower($tok)] ?? null;
        if ($id !== null) $out[$id] = true;           // de-duplicates by key
    return implode(', ', array_keys($out));           // '' when nothing resolved

storedContainsId(?string $stored, int $id): bool
    foreach (explode(',', $stored) as $tok)
        if (trim($tok) === (string)$id) return true;  // EXACT token — "1" ≠ "12"
```

Consumer contract (identical in KYC / DD / TL / QC):
```php
// write
$data['authority'] = ClmAuthority::normalizeIds($data['authority'] ?? null, $user->client_id);
if ($data['authority'] === '') throw ValidationException::withMessages(
    ['authority' => 'Select at least one valid authority.']);

// read
$map = ClmAuthority::idNameMap($user->client_id);
$rows->each(fn($r) => $r->authority_names = ClmAuthority::displayNames($r->authority, $map));
```

---

## 2. LIST (`index`)

```php
$q = ClmAuthority::query()->orderBy('id');
MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);
$rows = $q->get();

if ($rows->isNotEmpty()) {
    $usedIds   = $this->usedIdSet($user->client_id);     // ids referenced by CLM masters
    $usedNames = $this->usedNameSet($user->client_id);   // names referenced by legacy tables
    $usedCodes = $this->usedCodeSet($user->client_id);   // codes referenced by segment rules
    $rows->each(fn($r) => $r->in_use =
           isset($usedIds[(string)$r->id])
        || isset($usedNames[mb_strtolower(trim($r->name))])
        || isset($usedCodes[(string)$r->code]));
}
return ['status'=>true, 'data'=>$rows, 'count'=>$rows->count()];
```

Three set builders, one pass each — the list stays O(tables), not O(rows × tables):

```php
usedIdSet():    foreach idUsageTables() → pluck(col) → explode(',') → $used[token]=true
                // clm_kyc_documents.authority · clm_dd_documents.authority
                // clm_trade_licenses.authority · clm_qc_documents.issued_by

usedNameSet():  foreach nameUsageTables() → distinct pluck(col) → $used[lower(trim(v))]=true
                // vendor_documents.issuing_authority · customer_documents.issuing_authority
                // vendor_owners.issuing_authority

usedCodeSet():  pluck('auths_json') from clm_segment_rules → json_decode → $used[code]=true
```

`in_use` locks **delete only**. Editing stays open on purpose: CLM masters store the id (rename is free) and the legacy tables are rewritten by the cascade.

---

## 3. CREATE (`store`)

```php
if (!$user->client_id) → 403 'No tenant context for this user'

validate(['name'=>'required|string|max:255',
          'description'=>'required|string|max:500',
          'status'=>nullable Rule::in(STATUSES)]);

// case-insensitive dupe WITHIN THE CALLER'S SCOPE — a sibling branch may reuse the name
$dupe = ClmAuthority::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
if ($dupe->exists()) throw ValidationException::withMessages(
    ['name' => "An authority named \"{$name}\" already exists. Pick a different name."]);

DB::transaction(fn() => ClmAuthority::create([
    'client_id'=>$user->client_id, 'branch_id'=>$user->branch_id,
    'code'=>$this->nextCode($user->client_id, $user->branch_id),
    'name'=>$name, 'description'=>trim($data['description']),
    'status'=>$data['status'] ?? STATUS_ACTIVE,
    'created_by'=>$user->id, 'updated_by'=>$user->id,
]));
→ 201
```

---

## 4. EDIT + RENAME CASCADE (`update`)

```php
scoped whereKey($id) + applyReadScope → firstOrFail
if ($msg = MasterVisibility::hierarchicalDenial($user,$row,'edit')) → 403

validate(name?, description?, status?);   // all `sometimes|required`
trim both strings

if (isset($data['name'])) {
    $clash = ClmAuthority::query()->where('id','!=',$row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])]);
    MasterVisibility::applyReadScope($clash, $user, $user->branch_id ?: null);
    if ($clash->exists()) throw ValidationException 'Another authority named … already exists.';
}

$oldName = $row->name;
DB::transaction(function () use ($row,$data,$oldName) {
    $row->update($data);
    if (array_key_exists('name',$data) && $data['name'] !== $oldName)
        $this->cascadeRename((int)$row->client_id, $oldName, $data['name']);
});
→ 200 { data: $row->fresh() }
```

### `cascadeRename($clientId, $old, $new)`
```php
if ($old === $new) return;
foreach ($this->nameUsageTables() as $t) {                  // the 3 LEGACY name-storing tables
    if (!Schema::hasTable($t['table']) || !Schema::hasColumn($t['table'],$t['col'])) continue;
    $q = DB::table($t['table'])->where($t['col'], $oldName);
    if (Schema::hasColumn($t['table'],'client_id')) $q->where('client_id',$clientId);
    $q->update([$t['col'] => $newName]);
}
// CLM masters (kyc/dd/tl/qc) are NOT touched — they store the id and resolve the name live.
```
Wrapping the update + cascade in one transaction means a partial rename can never persist.

---

## 5. DELETE (`destroy`)

```php
scoped firstOrFail → hierarchicalDenial('delete') → 403

$usedIn = $this->authorityUsage((int)$user->client_id, (int)$row->id, $row->name, $row->code);
if ($usedIn) → 409 { message:'This authority is in use by …', used_in: $usedIn }
$row->delete();
```

### `authorityUsage($clientId, $id, $name, $code)` — the per-row mirror of the three sets
```php
// (1) id-based CLM masters
foreach (idUsageTables() as $t) {
    $q = DB::table($t['table'])->where($t['col'], 'like', '%'.$id.'%');   // cheap PRE-FILTER only
    if (has client_id) $q->where('client_id',$clientId);
    $hit = $q->pluck($t['col'])->contains(fn($v) => ClmAuthority::storedContainsId($v,$id));
    //                                              ^^^ exact TOKEN match — correctness lives here,
    //                                                  the LIKE would match "1" inside "12"
    if ($hit) $usedIn[] = $t['label'];
}

// (2) name-based legacy tables — exact equality, scoped where possible
foreach (nameUsageTables() as $t) { … if ($q->exists()) $usedIn[] = $t['label']; }

// (3) segment rules store the CODE inside a JSON array — substring match keeps this
//     portable across MySQL / Postgres / SQLite
if (clm_segment_rules.auths_json LIKE '%"AUTH-004"%') $usedIn[] = 'Segment Rules';
```

---

## 6. CODE ALLOCATION (`nextCode`)

```php
DB::table('clients')->where('id',$clientId)->lockForUpdate()->first();
$query = ClmAuthority::where('client_id',$clientId);
$branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id',$branchId);
$maxN = max over /^AUTH-(\d+)$/ ;
do { $n++; $code = sprintf('AUTH-%03d',$n); } while (isset($taken[$code]));
```
MAX+1 rather than `count()+1` so a deleted row mid-sequence never makes the next allocation collide with `UNIQUE(client_id, branch_id, code)`.

---

## 7. FRONTEND

```tsx
// ClmAuthorityPage.tsx
api.get('/clm/authorities')  → rows with in_use
row.in_use → delete disabled + tooltip; EDIT stays enabled
modal: name (required) · description (required, ≤500) · status

// AuthorityBadges.tsx — used by KYC / DD / QC / TL lists and the DCP
props: authority_list: string[]      // NEVER the joined string
render: first chip + "+N" popover for the rest
```
That component is the reason every document-list endpoint ships **both** `authority` (display string) and `authority_list` (array).

---

## 8. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Store id, resolve name on read | KYC/DD/TL/QC | Renames propagate for free |
| `displayNamesList()` array form | every consumer that counts | Authority names contain commas |
| `normalizeIds()` accepts names **and** ids | every write path | The UI may post either |
| `storedContainsId()` exact token | usage checks | `1` must not match `12` |
| `LIKE` pre-filter + PHP exact check | `authorityUsage` | Index-friendly *and* correct |
| Rename inside a transaction | `update` | No half-applied cascade |
| `Schema::hasTable/hasColumn` guards | every table touch | Survives partial migrations |
| Edit allowed, delete blocked | `index`/`destroy` | Renames are safe; orphaning references is not |

---

## 9. NOTES & CAVEATS

- `nameUsageTables()` is a hard-coded list of three legacy tables — new name-storing tables must be registered there.
- `auths_json` matching is a raw substring test on the JSON text.
- Deletes are hard; `client_id` cascades from `clients`.
- `status = inactive` is stored but not filtered out of the document-master authority pickers.
- DB is PostgreSQL.

---

*Related documents: AUTHORITY_FUNCTIONAL_DOCUMENTATION.md · AUTHORITY_TECHNICAL_DOCUMENTATION.md · AUTHORITY_API_DOCUMENTATION.md*
