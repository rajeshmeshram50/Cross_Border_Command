# SEGMENT — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Segment**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: list → create → edit (freeze + cascade) → delete → code allocation → frontend.
File: [ClmSegmentController.php](../../../../app/Http/Controllers/Api/ClmSegmentController.php), [ClmSegmentPage.tsx](../../../../resources/js/pages/clm/compliance/ClmSegmentPage.tsx).

---

## 1. LIST (`index`)

```php
$user = $request->user(); if (!$user) abort(401);

$q = ClmSegment::query()->orderBy('id', 'desc');          // newest first — a fresh add tops the list
MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);
$rows = $q->get();

$usage = $this->usageLabels($rows);                        // ONE query per referencing table, not per row
$rows->each(function ($r) use ($usage) {
    $labels     = $usage[$r->id] ?? [];
    $r->in_use  = !empty($labels);
    $r->used_in = array_values($labels);
});

return ['status'=>true, 'data'=>$rows, 'counts'=>[
    'all'    => $rows->count(),
    'highly' => $rows->where('regulatory_status', REG_HIGHLY)->count(),
    'less'   => $rows->where('regulatory_status', REG_LESS)->count(),
]];
```

### `usageLabels($rows)` — batched reference detection
```php
$ids   = $rows->pluck('id');   $names = $rows->pluck('name');
$idByName = [name => id];

// ── id-based ──
clm_segment_rules  WHERE segment_id IN ($ids)  → 'Segment Rules'
vendors|products|customers  WHERE segment_id IN ($ids) → 'Vendors'|'Products'|'Customers'
master_vendor_directory WHERE segment_id IN (string ids) OR segment_id IN (names)
     → addById() when the value is a numeric id, addByName() otherwise → 'Vendor Directory'

// ── name-based ──
customers.segment · consignees.segment · clm_tnc_library.segment ·
clm_agreement_library.segment   WHERE col IN ($names)
     → 'Customers' | 'Consignees' | 'T&C Library' | 'Agreement Library'
```
Every access is guarded by `Schema::hasTable()` / `Schema::hasColumn()` so a staging DB missing a migration returns an empty label set instead of a 500.

---

## 2. CREATE (`store`)

```php
if (!$user->client_id) → 403 'No tenant context for this user'

validate([
  'name'              => 'required|string|max:255',
  'regulatory_status' => Rule::in(REG_VALUES),      // highly | less
  'buyer_consignee'   => Rule::in(BC_VALUES),       // allowed | not_allowed
  'status'            => nullable Rule::in(STATUSES),
]);

// case-insensitive dupe WITHIN THE CALLER'S SCOPE — siblings may reuse the name
$dupe = ClmSegment::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
if ($dupe->exists())
    → 422 { message, errors: { name: [msg] } }     // errors.name ⇒ renders inline, not as a toast

DB::transaction(fn() => ClmSegment::create([
    'client_id' => $user->client_id,
    'branch_id' => $user->branch_id,               // NULL for client-level users ⇒ shared row
    'code'      => $this->nextCode($user->client_id, $user->branch_id),
    'name'      => trim($name), 'regulatory_status'=>…, 'buyer_consignee'=>…,
    'status'    => $data['status'] ?? STATUS_ACTIVE,
    'created_by'=> $user->id, 'updated_by'=>$user->id,
]));

MasterBundleCache::bump();                          // else the party pickers lag by up to 5 min
→ 201 { status:true, data: row }
```

---

## 3. EDIT (`update`) — the freeze + cascade path

```php
$lookup = ClmSegment::query()->whereKey($id);
MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
$row = $lookup->firstOrFail();                                  // 404 if out of scope
if ($msg = MasterVisibility::hierarchicalDenial($user,$row,'edit')) → 403 $msg

validate(name?, regulatory_status?, buyer_consignee?, status?);   // all `sometimes`

$usedIn = $this->usageLabels(collect([$row]))[$row->id] ?? [];    // computed ONCE

// (a) NAME FREEZE — only a genuine rename is blocked; re-submitting the same value is fine,
//     so a Customer↔Consignee edit that resends the unchanged name still goes through.
if (isset($data['name']) && $data['name'] !== (string)$row->name && $usedIn)
    → 409 { message, errors:{ name:[msg] } }

// (b) TIER FREEZE — compliance structures are built against the tier
if (isset($data['regulatory_status']) && changed && $usedIn)
    → 422 { message, errors:{ regulatory_status:[msg] } }

// (c) rename-to-duplicate guard, scoped, excluding self → 422 errors.name

$oldName = (string) $row->name;
$data['updated_by'] = $user->id;
$row->update($data);

if (name changed, case-insensitively)
    $this->cascadeSegmentRename($row->client_id, $oldName, (string)$row->name);

MasterBundleCache::bump();
→ 200 { data: $row->fresh() }
```

### `cascadeSegmentRename($clientId, $old, $new)`
```php
foreach (['customers','consignees'] as $table) {
    if (!Schema::hasColumn($table,'segment')) continue;
    rows = DB::table($table)
        ->where('client_id',$clientId)->whereNull('deleted_at')
        ->whereNotNull('segment')->where('segment','ilike','%'.$old.'%')   // Postgres ILIKE prefilter
        ->get(['id','segment']);

    foreach (rows as $r) {
        $parts = array_map('trim', explode(',', $r->segment));
        foreach ($parts as $i => $p)
            if (strcasecmp($p, $old) === 0) { $parts[$i] = $new; $changed = true; }   // WHOLE token only
        if ($changed) update segment = implode(', ', non-empty parts);
    }
}
```
`strcasecmp` on the whole comma part is what stops `Rice` from partially rewriting `Rice Bran`. Scoped by **client**, not branch, because a customer in branch A may legitimately carry a segment owned by branch B.

---

## 4. DELETE (`destroy`)

```php
scoped firstOrFail → hierarchicalDenial('delete') → 403

$usedIn = [];
clm_segment_rules.segment_id      → 'Segment Rules'
vendors.segment_id                → 'Vendors'
products.segment_id               → 'Products'
customers.segment_id              → 'Customers'
master_vendor_directory.segment_id == (string)$row->id OR == $row->name → 'Vendor Directory'
customers.segment | consignees.segment | clm_tnc_library.segment |
clm_agreement_library.segment  == $row->name  (exact, case-sensitive)
                                  → 'Customers'|'Consignees'|'T&C Library'|'Agreement Library'

if ($usedIn) → 409 { message: 'This segment is in use by …', used_in: $usedIn }

$row->delete();                       // HARD delete — no soft-delete column
MasterBundleCache::bump();            // else a deleted segment stays selectable until the TTL lapses
```

> `destroy()` re-checks each table individually rather than reusing `usageLabels()`. The two lists must be kept in sync — otherwise the UI would enable a delete the server then refuses (or vice versa).

---

## 5. CODE ALLOCATION (`nextCode`)

```php
DB::table('clients')->where('id',$clientId)->lockForUpdate()->first();
// Postgres refuses FOR UPDATE on aggregates, so we lock the PARENT row instead
// and let UNIQUE(client_id, branch_id, code) be the second guard.

$segQuery = ClmSegment::where('client_id',$clientId);
$branchId === null ? $segQuery->whereNull('branch_id') : $segQuery->where('branch_id',$branchId);
$codes = $segQuery->pluck('code');

foreach ($codes as $c) {
    if (preg_match('/^SG?-(\d+)$/', $c, $m))      // matches SG-007 AND legacy S-007
        $maxN = max($maxN, (int)$m[1]);
    $taken[$c] = true;
}
$n = $maxN;
do { $n++; $code = sprintf('SG-%03d', $n); } while (isset($taken[$code]));
```
`count()+1` would break twice over: the `consolidate_segments_into_clm` migration left gaps, and deletes leave more.

---

## 6. FRONTEND

```tsx
// ClmSegmentPage.tsx
api.get('/clm/segments')                     // branch_id auto-injected by the Axios interceptor
  → setRows(data); setCounts(counts)
tabs: all | highly | less  (counts from the response, not recomputed)
row.in_use → delete button disabled + <Tooltip themed> listing row.used_in
modal: name / regulatory_status / buyer_consignee / status
       name + regulatory_status rendered READ-ONLY when row.in_use
save → api.post|put → bustAllMasterBundles() → refetch
422/409 with errors.<field> → shown inline under that field
```
The same component is mounted at `/master/segments`; both routes render one table over `clm_segments`.

---

## 7. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Batched usage map | `index` | Avoids N×9 queries on a long list |
| `Schema::hasTable/hasColumn` | every usage check | Survives partially-migrated environments |
| Freeze-only-when-referenced | `update` | A brand-new segment stays fully editable |
| Freeze checks server-side | `update` | Read-only inputs can be bypassed |
| `errors.<field>` envelope | store/update | Mirrors Laravel's `unique` rule so the modal renders inline |
| Whole-token rename | `cascadeSegmentRename` | `Rice` ≠ `Rice Bran` |
| MAX+1 then skip-taken | `nextCode` | Gaps from the consolidate migration and deletes |
| `MasterBundleCache::bump()` | all writes | 5-minute per-user picker cache |

---

## 8. NOTES & CAVEATS

- Hard delete; `client_id` cascades from `clients`.
- The rename cascade covers customers + consignees only.
- `SG-NNN` restarts per branch; a client-level creator (`branch_id` NULL) sequences the shared rows.
- A segment stays invisible in the Customer/Consignee/Vendor pickers until its DCP rule holds ≥ 1 document.
- DB is PostgreSQL — `ilike` is used deliberately.

---

*Related documents: SEGMENT_FUNCTIONAL_DOCUMENTATION.md · SEGMENT_TECHNICAL_DOCUMENTATION.md · SEGMENT_API_DOCUMENTATION.md*
