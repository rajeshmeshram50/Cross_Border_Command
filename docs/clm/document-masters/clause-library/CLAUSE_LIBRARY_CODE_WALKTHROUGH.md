# CLAUSE LIBRARY — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Clause Library**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: types (usage COUNT + edit lock) → clauses (CTC text-search usage + delete lock) → the two helpers → insertion → code allocation.
File: [ClmClauseController.php](../../../../app/Http/Controllers/Api/ClmClauseController.php).

---

## 1. TYPES TAB

### `typesIndex()` — usage as a grouped COUNT
```php
if (!$user->client_id) return ['status'=>true,'data'=>[],'count'=>0];

$branchFilter = $request->integer('branch_id') ?: null;
$typeQuery = ClmClauseType::query()->orderBy('id');
MasterVisibility::applyReadScope($typeQuery, $user, $branchFilter);
$rows = $typeQuery->get();

/* Usage map: how many Clause Library entries reference each type. The library links to
 * a type by NAME (no FK), so we match case-insensitively. Drives the "can't edit an
 * in-use type" guard on the client. Scope the usage count the same way so a branch only
 * counts library rows it can actually see. */
$usageQuery = ClmClauseLibrary::query();
MasterVisibility::applyReadScope($usageQuery, $user, $branchFilter);
$usage = $usageQuery->selectRaw('LOWER(clause_type) as t, COUNT(*) as c')
                    ->groupBy(DB::raw('LOWER(clause_type)'))
                    ->pluck('c','t');
$rows->each(fn($row) => $row->in_use = (int)($usage[mb_strtolower($row->name)] ?? 0));
```

### `typesStore()`
```php
/* Description is no longer required — the redesigned Clause Type modal collects only
 * the name. Old payloads with description still work; new ones can send empty or omit. */
$request->merge(['name' => trim((string)$request->input('name'))]);
$data = validate(['name'=>['required','string','max:100'], 'description'=>'nullable|max:500']);

// Reject duplicate names within the creator's own scope (case-insensitive). Scoped via
// MasterVisibility so the same name can exist in different branches.
$dupQuery = ClmClauseType::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
MasterVisibility::applyReadScope($dupQuery, $user, $user->branch_id ?: null);
if ($dupQuery->exists()) → 409 'A clause type with this name already exists.'

DB::transaction(fn() => ClmClauseType::create([
    'client_id'=>…, 'branch_id'=>$user->branch_id,
    'code'=>$this->nextCode(ClmClauseType::class, $cid, $bid, 'CLT'),   // note: no trailing '-'
    'name'=>trim($data['name']), 'description'=>trim($data['description'] ?? ''), …
]));
→ 201
```

### `typesUpdate()` — the in-use **edit** lock
```php
scoped firstOrFail → hierarchicalDenial('edit') → 403
// "A branch user can VIEW shared client-level types but not manage them."

/* Block editing while the Clause Library still references this type — the library links
 * to it by NAME, so renaming would orphan those clauses. The user must reassign/remove
 * those clauses first. */
$inUse = ClmClauseLibrary::where('client_id', $user->client_id)      // ← CLIENT-wide,
           ->whereRaw('LOWER(clause_type) = ?', [mb_strtolower($row->name)])
           ->count();                                                //   not applyReadScope
if ($inUse > 0) → 409 "This clause type is used by {$inUse} clause(s) in the Clause Library,
                       so it can't be edited. Remove or reassign those clauses first."

$data = validate([ name?, description? ]);
// rename-to-duplicate guard — ALSO client-wide, so it is stricter than typesStore()'s
if (ClmClauseType::where('client_id',$cid)->where('id','!=',$row->id)
      ->whereRaw('LOWER(name) = ?', [...])->exists())
    → 409 'A clause type with this name already exists.'

$row->update($data);
```

### `typesDestroy()` — **no** in-use guard
```php
scoped firstOrFail → hierarchicalDenial('delete') → 403
$row->delete();     // ← asymmetric with typesUpdate(): a type CAN be deleted while
                    //   clauses still reference its name
```

---

## 2. LIBRARY TAB

### `libraryIndex()` — best-effort CTC usage detection
```php
$query = ClmClauseLibrary::query()->orderBy('id');
MasterVisibility::applyReadScope($query, $user, $request->integer('branch_id') ?: null);
$rows = $query->get();

/* Best-effort "used in a CTC agreement" flag. Clauses are COPIED into an agreement's
 * draft as `<h3>Name</h3>…` (see ClmClauseInsertPanel), NOT linked by FK — so we detect
 * usage by looking for that heading in every CTC contract's current content + saved
 * versions. Drives the client-side "can't delete a clause that's used in a CTC" guard. */
$haystacks = $this->ctcHaystacks((int)$user->client_id);
$rows->each(function ($row) use ($haystacks) {
    $needle = $this->clauseNeedle((string)$row->name);
    $row->in_use = 0;
    foreach ($haystacks as $h)
        if ($needle !== '' && mb_strpos($h,$needle) !== false) { $row->in_use = 1; break; }
});
```

### `libraryStore()`
```php
/* Party is no longer required — the redesigned Add Clause modal collects only
 * clause_type + name + content. Backward compatible: old payloads with party still work. */
$request->merge(['name' => trim((string)$request->input('name'))]);
$data = validate([
    'clause_type'   => 'required|string|max:255',   // the TYPE NAME string
    'name'          => ['required','string','max:255'],
    'party'         => 'nullable|string|max:255',
    'clause_status' => 'nullable|string|max:32',
    'content'       => 'nullable|string',
]);

// Reject duplicate clause names within the creator's own scope (case-insensitive).
$dupQuery = ClmClauseLibrary::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
MasterVisibility::applyReadScope($dupQuery, $user, $user->branch_id ?: null);
if ($dupQuery->exists()) → 409 'A clause with this name already exists.'

DB::transaction(fn() => ClmClauseLibrary::create([
    'client_id'=>…, 'branch_id'=>$user->branch_id,
    'code'=>$this->nextCode(ClmClauseLibrary::class, $cid, $bid, 'CL'),
    'clause_type'=>trim($data['clause_type']), 'name'=>trim($data['name']),
    'party'=>trim($data['party'] ?? ''),
    'clause_status'=>$data['clause_status'] ?? 'Active',
    'content'=>$data['content'] ?? null, …
]));
→ 201
```

### `libraryUpdate()` — no edit lock
```php
scoped firstOrFail → hierarchicalDenial('edit') → 403
// "Branch users may view shared client-level clauses but not edit them."

$data = validate([ clause_type?, name?, party?, clause_status?, content? ]);

// rename-to-duplicate guard — client-wide (stricter than libraryStore()'s scope check)
if (isset($data['name']) && ClmClauseLibrary::where('client_id',$cid)
        ->where('id','!=',$row->id)
        ->whereRaw('LOWER(name) = ?', [mb_strtolower(trim($data['name']))])->exists())
    → 409 'A clause with this name already exists.'

$row->update($data);
```
Editing a clause is **always** allowed. Since clauses are copied into documents, an edit never affects an existing draft — which is exactly why there is no lock here, and why a rename silently breaks the usage detection for earlier insertions.

### `libraryDestroy()` — the CTC delete lock
```php
scoped firstOrFail → hierarchicalDenial('delete') → 403

// Block deletion of a clause that has been inserted into any CTC agreement
// (same best-effort heading match as libraryIndex's in_use flag).
$needle = $this->clauseNeedle((string)$row->name);
if ($needle !== '')
    foreach ($this->ctcHaystacks((int)$user->client_id) as $h)
        if (mb_strpos($h,$needle) !== false)
            → 409 'This clause is used in one or more CTC agreements and cannot be deleted.'

$row->delete();
```

---

## 3. THE TWO HELPERS

```php
/** Lower-cased content of every CTC contract (current draft + each version), used to
 *  detect whether a library clause has been inserted into any CTC. */
private function ctcHaystacks(int $clientId): array
{
    return CtcContract::where('client_id',$clientId)->get(['content','versions'])
        ->map(function ($c) {
            $parts = [(string)$c->content];
            foreach ((array)($c->versions ?? []) as $v) $parts[] = (string)($v['content'] ?? '');
            return mb_strtolower(implode("\n", $parts));
        })->all();
}

/** The heading a clause is inserted with — `<h3>Name</h3>`, lower-cased. */
private function clauseNeedle(string $name): string
{
    $name = trim($name);
    return $name === '' ? '' : mb_strtolower('<h3>' . e($name) . '</h3>');
}
```

Three things to note:
1. **`e()` is required.** The insert panel HTML-escapes the name, so `Force Majeure & Acts of God` is written as `<h3>Force Majeure &amp; Acts of God</h3>`. Dropping `e()` would break the match for any clause containing `&`, `<` or `>`.
2. **Versions are searched too** — a clause inserted, then removed from the current draft, still counts as used because it survives in an earlier version snapshot.
3. **Cost.** `ctcHaystacks()` loads every CTC contract's content *and* every version into memory. It runs once per `libraryIndex()` (not per row) and once per `libraryDestroy()`, but on a tenant with many long contracts this is the heaviest read in the module.

### What is *not* searched
Agreements (`clm_agreement_library.content`) and trade documents (`clm_trade_doc_library.content`) also receive inserted clauses, but neither is included in the haystack — so a clause used only there reports `in_use = 0` and can be deleted.

---

## 4. INSERTION (`ClmClauseInsertPanel.tsx`)

```tsx
// mounted inside the Agreement wizard, the Trade Document draft editor and the CTC form
onInsert(clause) => editor.insertHTML(`<h3>${escapeHtml(clause.name)}</h3>${clause.content}`)
// ↑ this exact shape is what clauseNeedle() looks for
```
The clause becomes a **copy** in the document body. Later library edits do not propagate — which gives a signed contract stable wording, at the cost of making usage detection textual.

---

## 5. CODE ALLOCATION (`nextCode`)

```php
/** Allocate the next sequential code (e.g. CL-005 / CLT-005) for a client + branch.
 *  Branch-scoped so each branch restarts its own sequence from 001 rather than
 *  continuing another branch's tally. A client-level creator ($branchId null)
 *  sequences the shared rows. Uses max-existing + skip-taken rather than count()+1,
 *  so deleting a middle row never makes the next code collide with an existing one.
 *  Runs under a row lock on the client to serialise concurrent inserts. */
DB::table('clients')->where('id',$clientId)->lockForUpdate()->first();
$query = $model::where('client_id',$clientId);
$branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id',$branchId);
$maxN = max over '/^' . preg_quote($prefix,'/') . '-(\d+)$/';    // note the '-' in the REGEX
do { $n++; $code = sprintf('%s-%03d', $prefix, $n); } while (isset($taken[$code]));
```
Unlike the other CLM controllers, the prefix here is passed **without** a trailing hyphen (`'CL'`, `'CLT'`) — the regex and the format string supply it.

---

## 6. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Grouped `COUNT(*)` over `LOWER(clause_type)` | `typesIndex` | The library links by name, not FK |
| Usage query scoped like the list | `typesIndex` | A branch counts only rows it can see |
| In-use **edit** lock on types | `typesUpdate` | Renaming would orphan clauses |
| Text-search usage on clauses | `libraryIndex` / `libraryDestroy` | Clauses are copied, not referenced |
| `e()` inside the needle | `clauseNeedle` | The insert panel escapes the name |
| Versions included in the haystack | `ctcHaystacks` | A removed clause still lives in history |
| Client row lock + MAX+1 + skip-taken | `nextCode` | Deletes leave gaps |
| Scope-relative dupe on create, client-wide on rename | store vs update | An inconsistency worth knowing about |

---

## 7. NOTES & CAVEATS

- **`typesDestroy()` has no in-use guard**, although `typesUpdate()` does — a type can be deleted while clauses reference its name.
- Usage detection covers **CTC contracts only**; agreements and trade documents are not searched.
- Renaming a clause changes the needle, so earlier insertions stop registering as in use.
- The rename-clash checks in `typesUpdate()` and `libraryUpdate()` are **client-wide**, while the create-time dupe checks are **scope-relative** — the update path is therefore stricter.
- `ctcHaystacks()` is an in-memory full scan of CTC content; watch it on large tenants.
- Deletes are hard on both tabs; there is no version history for clauses.
- DB is PostgreSQL.

---

*Related documents: CLAUSE_LIBRARY_FUNCTIONAL_DOCUMENTATION.md · CLAUSE_LIBRARY_TECHNICAL_DOCUMENTATION.md · CLAUSE_LIBRARY_API_DOCUMENTATION.md*
