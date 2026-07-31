# QUALITY & COMPLIANCE DOCS (QC) — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Quality & Compliance Docs**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: list (+tab counts) → create → edit → delete (the **client-scoped** usage check) → code allocation → downstream consumption.
File: [ClmQcController.php](../../../../app/Http/Controllers/Api/ClmQcController.php).

---

## 1. LIST (`index`)

```php
$user = $request->user(); if (!$user) abort(401);

// Branch-scoped read: own rows + client-level (shared); siblings hidden (CBC-432).
$q = ClmQcDocument::query()->orderBy('id');
MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);
$rows = $q->get();

// `issued_by` stores authority IDS → expose the resolved CURRENT names.
$map = ClmAuthority::idNameMap($user->client_id);
$rows->each(fn ($r) => $r->issued_by_names = ClmAuthority::displayNames($r->issued_by, $map));

// Per-row "in use" flags mirroring destroy()'s checks — note the CLIENT id is passed in.
$rows->each(function ($r) use ($user) {
    $labels     = $this->usageCheck($user->client_id, $r->code, $r->name);
    $r->in_use  = !empty($labels);
    $r->used_in = array_values($labels);
});

return ['status'=>true, 'data'=>$rows, 'counts'=>[
    'all'  => $rows->count(),
    'cert' => $rows->where('doc_type', TYPE_CERT)->count(),
    'comp' => $rows->where('doc_type', TYPE_COMP)->count(),
]];
```

The `counts` object drives the page's three tabs directly — the frontend never recomputes them.

---

## 2. CREATE (`store`)

```php
if (!$user->client_id) → 403 'No tenant context for this user'

$data = $request->validate([
    'name'         => 'required|string|max:255',
    'purpose'      => 'required|string|max:500',      // ← required, unlike the other catalogues
    'issued_by'    => 'required|string|max:255',      // ← the authority column is named issued_by
    'doc_type'     => ['nullable', Rule::in(ClmQcDocument::TYPES)],   // cert | comp
    'qa_params'    => 'nullable|string|max:256',
    'min_criteria' => 'nullable|string|max:256',
    'status'       => ['nullable', Rule::in(ClmQcDocument::STATUSES)],
]);

// (1) case-insensitive duplicate WITHIN THE CALLER'S SCOPE
$name = trim($data['name']);
$dupe = ClmQcDocument::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
MasterVisibility::applyReadScope($dupe, $user, $user->branch_id ?: null);
if ($dupe->exists()) {
    $msg = "A QC document named \"{$name}\" already exists. Pick a different name.";
    // 422 + errors.name so the modal shows it inline under QC CERTIFICATE NAME
    // (not a global toast) — same shape Laravel's `unique` rule returns.
    return response()->json(['status'=>false,'message'=>$msg,'errors'=>['name'=>[$msg]]], 422);
}

// (2) issuing authority: ids AND/OR names → canonical comma-joined IDS
$data['issued_by'] = ClmAuthority::normalizeIds($data['issued_by'] ?? null, $user->client_id);
if ($data['issued_by'] === '') throw ValidationException::withMessages([
    'issued_by' => 'Select a valid authority.']);

// (3) persist
DB::transaction(fn() => ClmQcDocument::create([
    'client_id'    => $user->client_id,
    'branch_id'    => $user->branch_id,               // NULL for client-level users ⇒ shared
    'code'         => $this->nextCode($user->client_id, $user->branch_id),
    'name'         => trim($data['name']),
    'purpose'      => trim($data['purpose']),
    'issued_by'    => $data['issued_by'],
    'doc_type'     => $data['doc_type'] ?? TYPE_CERT,     // default: formal certificate
    'qa_params'    => $data['qa_params']    ?? null,
    'min_criteria' => $data['min_criteria'] ?? null,
    'status'       => $data['status'] ?? STATUS_ACTIVE,
    'created_by'   => $user->id, 'updated_by' => $user->id,
]));
→ 201 { status:true, data: row }
```

---

## 3. EDIT (`update`)

```php
$lookup = ClmQcDocument::query()->whereKey($id);
MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
$row = $lookup->firstOrFail();                                    // 404 when out of scope
if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) → 403 $msg

$data = validate([ name?, purpose?, issued_by?, doc_type?, qa_params?, min_criteria?, status? ]);

foreach (['name','purpose'] as $k) if (isset($data[$k])) $data[$k] = trim($data[$k]);

if (isset($data['issued_by'])) {
    $data['issued_by'] = ClmAuthority::normalizeIds($data['issued_by'], $user->client_id);
    if ($data['issued_by'] === '') throw ValidationException 'Select a valid authority.';
}

if (isset($data['name'])) {                                        // rename-to-duplicate guard
    $clash = ClmQcDocument::query()->where('id','!=',$row->id)
               ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])]);
    MasterVisibility::applyReadScope($clash, $user, $user->branch_id ?: null);
    if ($clash->exists()) → 422 { message, errors: { name: [msg] } }
}

$data['updated_by'] = $user->id;
$row->update($data);
→ 200 { data: $row->fresh() }
```

**No in-use edit lock** — but note a real consequence here that does not exist for KYC/DD/TL: `product_qc_records.qc_name` references this row **by name**, and nothing cascades a rename. Renaming a QC entry silently detaches it from existing product QC records.

---

## 4. DELETE (`destroy`) — the correctly scoped usage check

```php
scoped firstOrFail → hierarchicalDenial('delete') → 403

$usedIn = $this->usageCheck($user->client_id, $row->code, $row->name);
if ($usedIn) → 409 {
    message: 'This QC document is in use by Segment Rules, Product QC Records.
              Remove or reassign those records before deleting.',
    used_in: $usedIn }

$row->delete();     // HARD delete
```

### `usageCheck(int $clientId, ?string $code, ?string $name)`
```php
/** QC docs are referenced by code (segment rules JSON + segment doc uploads)
 *  AND by name (product_qc_records.qc_name free-text).
 *
 *  Codes (QC-001, …) are allocated PER CLIENT, so every tenant has a "QC-001".
 *  The usage lookups MUST be scoped to this client's rows — otherwise a freshly
 *  created QC-001 falsely matches another tenant's reference to their own QC-001
 *  and the delete is wrongly blocked. */

if ($code && clm_segment_rules
        ->where('client_id', $clientId)                       // ← THE SCOPE
        ->where('doc_selections','like','%"'.$code.'"%')->exists())
    $usedIn[] = 'Segment Rules';

if ($code && segment_doc_uploads
        ->where('client_id', $clientId)                       // ← THE SCOPE
        ->where('doc_code', $code)->exists())
    $usedIn[] = 'Segment Doc Uploads';

// product_qc_records has NO client_id — scope through its product.
if ($name && product_qc_records
        ->join('products','products.id','=','product_qc_records.product_id')
        ->where('products.client_id', $clientId)              // ← THE SCOPE, via join
        ->where('product_qc_records.qc_name', $name)->exists())
    $usedIn[] = 'Product QC Records';
```

This is the **reference implementation**. `ClmKycController`, `ClmDdController` and `ClmTradeLicenseController` run the same two code lookups without the `client_id` predicate, which is why a foreign tenant's `KYC-001` / `DD-001` / `TL-001` reference can block your delete.

---

## 5. CODE ALLOCATION (`nextCode`)

```php
DB::table('clients')->where('id',$clientId)->lockForUpdate()->first();

// Branch-scoped so each branch restarts from QC-001 rather than continuing
// another branch's tally. A client-level creator ($branchId null) sequences the shared rows.
$query = ClmQcDocument::where('client_id',$clientId);
$branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id',$branchId);
$codes = $query->pluck('code');

foreach ($codes as $c) {
    if (preg_match('/^QC-(\d+)$/', $c, $m)) $maxN = max($maxN, (int)$m[1]);
    $taken[$c] = true;
}
$n = $maxN;
do { $n++; $code = sprintf('QC-%03d', $n); } while (isset($taken[$code]));
```

---

## 6. DOWNSTREAM CONSUMPTION

```php
// ClmSegmentRuleController::bootstrap() — note QC uses `issued_by`, not `authority`
$qc = applyReadScope(ClmQcDocument::query()->orderBy('id'), $user, $branchId)->get();
$qc->each(function ($r) use ($authMap) {
    $r->authority_list = ClmAuthority::displayNamesList($r->issued_by, $authMap);  // ARRAY first…
    $r->issued_by      = ClmAuthority::displayNames($r->issued_by, $authMap);      // …then overwrite
});

// the rule stores only the CODE
doc_selections['qc'] = { "QC-003": "M", "QC-007": "O" }

// ClmSegmentRuleController::forSegment()
$codes = array_keys($rule->doc_selections['qc'] ?? []);
$rows  = ClmQcDocument::where('client_id',$cid)->whereIn('code',$codes)->get();
// the optional-field loop copies whichever attributes exist, so QC rows surface
// `purpose` and `doc_type` alongside the shared { id, code, name, status, requirement }

// SegmentDocUploadController::store()
segment_doc_uploads { category:'qc', doc_code:'QC-003',
                      doc_name:<snapshot>, requirement:<snapshot>,
                      attachment_path, expiry_date }   // ← the REAL certificate expiry lands here

// Product master — the ONLY name-based link among the four catalogues
product_qc_records { product_id, qc_name: 'ISO 9001', … }
// no client_id of its own; tenancy is resolved by joining products
```

---

## 7. FRONTEND

```tsx
// ClmQcPage.tsx
api.get('/clm/qc-documents') → { data, counts:{all,cert,comp} }
tabs render straight off `counts` — never recomputed client-side
issued-by column → <AuthorityBadges list={authority_list} />
row.in_use → delete disabled + <Tooltip themed>{used_in.join(', ')}</Tooltip>
422 errors.name → bound to the QC CERTIFICATE NAME input (inline, not a toast)

export function QcModal(...)   // ← imported by ClmDcpPage
// fields: name · purpose · issued_by · doc_type(cert|comp) · qa_params · min_criteria · status
// the DCP re-fetches /clm/segment-rules/bootstrap after a save
```

---

## 8. DIFFERENCES FROM THE OTHER THREE CATALOGUES

| Aspect | KYC / DD / TL | QC |
|---|---|---|
| Authority column | `authority` | **`issued_by`** |
| Resolved-name field | `authority_names` | **`issued_by_names`** |
| Date descriptor | `expiry` / `validity` | **none** |
| Extra fields | — | `purpose` (required), `doc_type`, `qa_params`, `min_criteria` |
| Response counts | `count` (a number) | **`counts{all,cert,comp}`** |
| Usage check | **not** client-scoped | **client-scoped** (3 lookups) |
| Name-based reference | none | `product_qc_records.qc_name` |
| Code prefix | `KYC-` / `DD-` / `TL-` | `QC-` |

---

## 9. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| `applyReadScope` on every query, dupe checks included | all methods | Uniqueness must match visibility |
| `normalizeIds()` on write | store/update | One canonical storage shape |
| `idNameMap()` + `displayNames()` on read | index | Authority renames propagate for free |
| `displayNamesList()` computed **before** overwriting `issued_by` | DCP bootstrap | Names may contain commas |
| **`client_id` in every usage lookup** | usageCheck | Codes repeat per tenant |
| Join through `products` for tenancy | usageCheck | `product_qc_records` has no `client_id` |
| `errors.<field>` envelope | store/update | Renders inline in the modal |
| Client row lock + MAX+1 + skip-taken | nextCode | Deletes leave gaps |
| Counts computed server-side | index | Tabs stay consistent with the scoped result set |

---

## 10. NOTES & CAVEATS

- QC's `usageCheck()` is the **correct, client-scoped** version — copy this shape when fixing KYC / DD / TL.
- The **name-based** product link has no rename cascade: renaming a QC entry detaches existing `product_qc_records`.
- `issued_by` is capped at 255 characters.
- `qa_params` / `min_criteria` are `text` columns validated at 256 characters.
- No expiry descriptor in the master; certificate expiry lives on `segment_doc_uploads.expiry_date`.
- Deletes are hard; `client_id` cascades from `clients`.
- DB is PostgreSQL.

---

*Related documents: QUALITY_COMPLIANCE_DOCS_FUNCTIONAL_DOCUMENTATION.md · QUALITY_COMPLIANCE_DOCS_TECHNICAL_DOCUMENTATION.md · QUALITY_COMPLIANCE_DOCS_API_DOCUMENTATION.md*
