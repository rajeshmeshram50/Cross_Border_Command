# TERMS & CONDITIONS — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Terms & Conditions**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: categories (and how globals surface) → library create (note blanking + the overlap rule) → update → delete → code allocation.
File: [ClmTncController.php](../../../../app/Http/Controllers/Api/ClmTncController.php).

---

## 1. CATEGORIES TAB

### `categoriesIndex()` — globals merge for free
```php
$user = $request->user(); if (!$user) abort(401);

// The four standard categories are GLOBAL (client_id NULL) and show for every tenant;
// a client's own custom categories are merged on top. Branch-scoped read: branch users
// see globals + client-level rows + their own branch's rows; siblings stay hidden.
$query = ClmTncCategory::query()->orderBy('id');
MasterVisibility::applyReadScope($query, $user, $request->integer('branch_id') ?: null);
$rows = $query->get();

return ['status'=>true, 'data'=>$rows, 'count'=>$rows->count()];
```
No special-casing is needed for the globals: every branch of `applyReadScope` starts with `whereNull('client_id') OR client_id = X`, so the seeded `client_id NULL` rows always come along.

### `categoriesStore()`
```php
if (!$user->client_id) → 403 'No tenant context'
validate(['short_code'=>'required|max:12', 'name'=>'required|max:255']);

DB::transaction(function () use ($user,$data) {
    DB::table('clients')->where('id',$user->client_id)->lockForUpdate()->first();
    $code = $this->nextCode(ClmTncCategory::class, $user->client_id, $user->branch_id, 'DC-');
    return ClmTncCategory::create([
        'client_id'=>$user->client_id,
        'branch_id'=>$user->branch_id,        // branch-owned; NULL for client-level ⇒ shared
        'code'=>$code,
        'short_code'=>strtoupper(trim($data['short_code'])),   // always upper-cased
        'name'=>trim($data['name']),
        'created_by'=>$user->id, 'updated_by'=>$user->id,
    ]);
});
→ 201
```

### `categoriesUpdate()` / `categoriesDestroy()`
```php
scoped whereKey + applyReadScope → firstOrFail → hierarchicalDenial → 403
update: short_code upper-cased, name trimmed
destroy: $row->delete();     // NO in-use guard — unlike agreement types and
                             // trade-document names, a category can be deleted
                             // while library rows still reference its NAME
```

---

## 2. LIBRARY — CREATE (`libraryStore`)

```php
if (!$user->client_id) → 403 'No tenant context'

$data = $request->validate([
    // segment now holds a CSV (one for "highly", many for "less").
    // Debit/Credit Note documents carry NO segment/regulatory/party — they're saved
    // blank (rendered as "—" in the list), so regulatory accepts an empty string and
    // party is no longer required.
    'segment'    => 'nullable|string|max:1024',
    'regulatory' => 'nullable|string|max:16',
    'category'   => 'required|string|max:255',
    'party'      => 'nullable|string|max:255',
    'content'    => 'nullable|string',
]);
```

### Step 1 — note-category blanking
```php
/* Debit/Credit Note documents carry NO segment/regulatory/party. Force them blank HERE
 * (not via the payload): Laravel's ConvertEmptyStringsToNull middleware turns the
 * frontend's '' into null, so the "?? 'General' / 'highly'" fallbacks below would
 * otherwise wrongly backfill them. EMPTY STRING keeps the NOT-NULL columns valid and
 * the list renders "—". Matched by category NAME. */
if ($this->isNoteCategory($data['category'] ?? '')) {
    $data['segment'] = ''; $data['regulatory'] = ''; $data['party'] = '';
}
```
This is a three-way interaction worth keeping in mind when editing any of the pieces:
`ConvertEmptyStringsToNull` ⟶ `'' becomes null` ⟶ `?? 'General'` would backfill ⟶ so the controller re-writes `''` **after** validation.

### Step 2 — the uniqueness rule (CBC #18)
```php
/* One Terms & Conditions entry per (segment, document category) within a branch —
 * e.g. "Tobacco + Proforma Invoice" can exist only once. A row may scope MANY segments
 * (CSV, for "less" regulatory), so any OVERLAP with an existing same-category row is a
 * duplicate. */
if ($dup = $this->findDuplicate($user->client_id, $user->branch_id,
                                $data['category'], $data['segment'] ?? null)) {
    → 422 { message: 'A Terms & Conditions entry already exists for this segment and
                      document category (' . $dup->code . ').',
            errors: { category: ['This segment already has a "…" entry.'] } }
}
```

### Step 3 — persist
```php
DB::transaction(function () use ($user,$data) {
    DB::table('clients')->lockForUpdate();
    $code = $this->nextCode(ClmTncLibrary::class, $user->client_id, $user->branch_id, 'TNC-');
    return ClmTncLibrary::create([
        'client_id'=>…, 'branch_id'=>…, 'code'=>$code,
        // '' preserved (?? only catches null) so note docs stay blank
        'segment'    => $data['segment']    ?? 'General',
        'regulatory' => $data['regulatory'] ?? 'highly',
        'category'   => trim($data['category']),
        'party'      => trim((string)($data['party'] ?? '')),
        'content'    => $data['content'] ?? null,
        'created_by'=>…, 'updated_by'=>…,
    ]);
});
→ 201
```

---

## 3. THE THREE HELPERS

```php
/** Debit/Credit Note documents store no segment / regulatory / party. */
private function isNoteCategory(?string $name): bool
{
    return in_array(mb_strtolower(trim((string)$name)), ['debit note','credit note'], true);
}

/** Normalise a segment CSV to a de-duplicated set of lower-cased tokens. */
private function segmentTokens(?string $csv): array
{
    return array_values(array_unique(array_filter(
        array_map(fn($s) => mb_strtolower(trim($s)), explode(',', (string)$csv)),
        fn($s) => $s !== ''
    )));
}

/** Find an existing T&C row that collides with (segment, category) for the given branch.
 *  Segment is a CSV (many segments for "less" regulatory rows), so a collision is ANY
 *  same-category row whose segment set OVERLAPS the incoming one. Note-category docs
 *  carry no segment, so they're exempt. Scoped to the SAME branch — T&C is
 *  branch-isolated, so the same combo may exist per branch. */
private function findDuplicate($clientId, ?int $branchId, ?string $category,
                               ?string $segmentCsv, $ignoreId = null): ?ClmTncLibrary
{
    $cat = mb_strtolower(trim((string)$category));
    if ($cat === '' || $this->isNoteCategory($category)) return null;   // notes exempt

    $incoming = $this->segmentTokens($segmentCsv);
    if (empty($incoming)) return null;

    $query = ClmTncLibrary::where('client_id',$clientId)
        ->whereRaw('LOWER(TRIM(category)) = ?', [$cat]);
    $branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id',$branchId);
    if ($ignoreId !== null) $query->where('id','!=',$ignoreId);

    foreach ($query->get(['id','code','segment']) as $existing) {
        if (array_intersect($incoming, $this->segmentTokens($existing->segment)))
            return $existing;                      // ← ANY overlap = duplicate
    }
    return null;
}
```

**Worked example**

| Existing | Incoming | Result |
|---|---|---|
| `Quotation` / `"Rice, Wheat"` | `Quotation` / `"Wheat, Barley"` | **422** — `wheat` overlaps |
| `Quotation` / `"Rice"` | `Quotation` / `"Barley"` | OK — disjoint |
| `Quotation` / `"Rice"` | `Proforma Invoice` / `"Rice"` | OK — different category |
| `Debit Note` / `""` | `Debit Note` / `""` | OK — note categories are exempt |

---

## 4. LIBRARY — EDIT (`libraryUpdate`)

```php
scoped whereKey + applyReadScope → firstOrFail → hierarchicalDenial('edit') → 403

$data = validate([... same relaxed rules as libraryStore ...]);
$data['updated_by'] = $user->id;

// Same note-doc blanking (category may be omitted on a partial update,
// so fall back to the row's CURRENT category).
if ($this->isNoteCategory($data['category'] ?? $row->category)) {
    $data['segment'] = ''; $data['regulatory'] = ''; $data['party'] = '';
}

// Re-run the segment+category uniqueness guard against the row's OWN branch,
// ignoring itself. Fall back to the stored values for whichever of
// category/segment this partial update omits. (CBC #18)
$effCategory = $data['category'] ?? $row->category;
$effSegment  = array_key_exists('segment',$data) ? $data['segment'] : $row->segment;
if ($dup = $this->findDuplicate($row->client_id, $row->branch_id,
                                $effCategory, $effSegment, $row->id))
    → 422 { message, errors: { category: [...] } }

$row->update($data);
→ 200 { data: $row->fresh() }
```

Two details that matter: the check uses **the row's own** `client_id` / `branch_id` (not the caller's), and it uses `array_key_exists` rather than `??` for `segment` so an intentional `''` isn't mistaken for "omitted".

---

## 5. LIBRARY — DELETE (`libraryDestroy`)

```php
scoped firstOrFail → hierarchicalDenial('delete') → 403
$row->delete();      // HARD delete, no usage guard
→ 200 { message: 'Deleted' }
```

---

## 6. CODE ALLOCATION (`nextCode`)

```php
/** Allocate the next per-tenant code (DC-NNN / TNC-NNN). Uses MAX(numeric suffix) + 1
 *  rather than count()+1 so a deleted row in the middle of the sequence doesn't make
 *  the next allocation reuse a code that still exists — which throws a unique-constraint
 *  violation on save. Caller must already hold the client row lock; the composite
 *  UNIQUE (client_id, code) is the final guard. */
// Branch-scoped so each branch restarts its own sequence from 001 (DC-001 / TNC-001).
$query = $modelClass::where('client_id',$clientId);
$branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id',$branchId);
$re = '/^' . preg_quote($prefix,'/') . '(\d+)$/';
$maxN = max over $re;
do { $n++; $code = sprintf('%s%03d', $prefix, $n); } while (isset($taken[$code]));
```

---

## 7. FRONTEND

```tsx
// ClmTncPage.tsx
GET /clm/tnc-categories  → globals (client_id NULL) + own rows, merged by applyReadScope
GET /clm/tnc-library     → entries; note rows render "—" for segment / regulatory / party

// ClmTncWizardModal.tsx
category picked → if Debit Note | Credit Note, the segment/regulatory/party step is HIDDEN
                  (the server blanks them anyway — the UI just avoids asking)
segment multi-select → joined into the CSV
422 errors.category → rendered inline on the category field
```

---

## 8. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Globals via `applyReadScope`'s `whereNull('client_id')` | `categoriesIndex` | No special-casing needed for seeded categories |
| Blank with `''`, not `null` | note handling | `ConvertEmptyStringsToNull` + `??` would backfill defaults |
| Set-overlap uniqueness, not string equality | `findDuplicate` | A row may scope many segments |
| Note categories exempt from uniqueness | `findDuplicate` | They carry no segment at all |
| Row's own `client_id`/`branch_id` on update | `libraryUpdate` | The check must follow the row, not the caller |
| `array_key_exists` rather than `??` for `segment` | `libraryUpdate` | `''` is a meaningful value here |
| Client row lock + MAX+1 + skip-taken | `nextCode` | Deletes leave gaps |
| `errors.category` envelope | store/update | Renders inline in the wizard |

---

## 9. NOTES & CAVEATS

- Note-category detection is by **literal name** — renaming "Debit Note" disables the special handling.
- Categories have **no in-use guard**; deleting one leaves library rows pointing at a missing name.
- The uniqueness rule lives in PHP, not the DB — the client row lock is taken only for code allocation, *after* the check, so concurrent saves could theoretically both pass.
- `segment` is a CSV of segment **names**; the segment master treats `clm_tnc_library.segment` as one of its name-based reference tables when blocking a rename or delete.
- Deletes are hard on both tabs.
- DB is PostgreSQL.

---

*Related documents: TERMS_CONDITIONS_FUNCTIONAL_DOCUMENTATION.md · TERMS_CONDITIONS_TECHNICAL_DOCUMENTATION.md · TERMS_CONDITIONS_API_DOCUMENTATION.md*
