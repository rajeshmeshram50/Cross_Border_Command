# DOCUMENT CONTROL PANEL (DCP) — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Document Control Panel**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: list → bootstrap (the modal's single fetch) → create → edit → delete → `forSegment` (what consumers read) → code allocation → downstream.
File: [ClmSegmentRuleController.php](../../../../app/Http/Controllers/Api/ClmSegmentRuleController.php), [ClmDcpPage.tsx](../../../../resources/js/pages/clm/compliance/ClmDcpPage.tsx).

---

## 1. LIST (`index`)

```php
$user = $request->user(); if (!$user) abort(401);
if (!$user->client_id)
    return ['status'=>true,'data'=>[], 'counts'=>['all'=>0,'highly'=>0,'less'=>0]];

// Branch-scoped read: a branch sees globals + client-level rules + its own branch's
// rules; sibling branches stay hidden. Newest rule FIRST (descending) so the panel
// lists latest-added at the top.
$query = ClmSegmentRule::query()->orderByDesc('id');
MasterVisibility::applyReadScope($query, $user, $request->integer('branch_id') ?: null);
$rows = $query->get();

return ['status'=>true, 'data'=>$rows, 'counts'=>[
    'all'    => $rows->count(),
    'highly' => $rows->where('regulatory_status', REG_HIGHLY)->count(),
    'less'   => $rows->where('regulatory_status', REG_LESS)->count(),
]];
```

No per-row usage flags here — a rule is a configuration, not a referenced entity, so delete is unguarded.

---

## 2. BOOTSTRAP (`bootstrap`) — one call feeds the entire modal

```php
$cid      = $user->client_id;
$branchId = $request->integer('branch_id') ?: null;

// Branch-scoped read for EVERY master. Without this, the SELECT SEGMENT dropdown
// (and the other CLM masters) leaked segments configured by independent sibling
// branches into this branch's DCP setup.
$load = function (string $modelClass) use ($cid, $user, $branchId) {
    if (!$cid) return collect();
    $q = $modelClass::query()->orderBy('id');
    MasterVisibility::applyReadScope($q, $user, $branchId);
    return $q->get();
};

$segments    = $load(ClmSegment::class);
$authorities = $load(ClmAuthority::class);
$kyc         = $load(ClmKycDocument::class);
$dd          = $load(ClmDdDocument::class);
$tl          = $load(ClmTradeLicense::class);
// Trade Documents (td) was removed from the panel — it is no longer a configurable
// category, so it isn't shipped here.
$qc          = $load(ClmQcDocument::class);

// The document masters store the authority by ID; resolve to CURRENT names so the
// DCP table + configure modal display live values.
$authMap = ClmAuthority::idNameMap($cid);

$kyc->each(function ($r) use ($authMap) {
    // Each row also carries `authority_list` — the SAME names as a structured ARRAY —
    // so the AUTHORITIES column can count distinct authorities without splitting the
    // joined string on commas (authority names may themselves contain commas, which
    // would over-count). Compute the array from the original stored IDS BEFORE
    // overwriting the string.
    $r->authority_list = ClmAuthority::displayNamesList($r->authority, $authMap);
    $r->authority      = ClmAuthority::displayNames($r->authority, $authMap);
});
// dd + tl identical; QC reads `issued_by` instead:
$qc->each(function ($r) use ($authMap) {
    $r->authority_list = ClmAuthority::displayNamesList($r->issued_by, $authMap);
    $r->issued_by      = ClmAuthority::displayNames($r->issued_by, $authMap);
});

→ { data: { segments, authorities, kyc, dd, tl, qc } }
```

**Assignment order is the load-bearing detail**: `authority_list` must be computed from the stored ids *before* `authority` is overwritten with the display string.

---

## 3. CREATE (`store`)

```php
if (!$user->client_id) → 403 'No tenant context'

$data = $this->validatePayload($request);

// ONE RULE PER (segment_code, document_type), within the caller's scope
$existingQuery = ClmSegmentRule::query()
    ->where('segment_code', $data['segment_code'])
    ->where('document_type', $data['document_type']);
MasterVisibility::applyReadScope($existingQuery, $user, $user->branch_id ?: null);
if ($existing = $existingQuery->first()) {
    $typeLabel = ucfirst($data['document_type']);
    → 409 { message: "A {$typeLabel} rule already exists for segment {$segment_code}
                      ({$existing->rule_code}). Edit the existing rule instead.",
            existing: $existing }
}

$row = DB::transaction(function () use ($user, $data) {
    DB::table('clients')->where('id',$user->client_id)->lockForUpdate()->first();
    $code    = $this->nextRuleCode($user->client_id);              // SR-NNN, CLIENT-wide
    $segment = ClmSegment::where('client_id',$user->client_id)
                 ->where('code',$data['segment_code'])->first();
    [$mand,$opt] = $this->countSelections($data['doc_selections']);

    return ClmSegmentRule::create([
        'client_id'         => $user->client_id,
        'branch_id'         => $user->branch_id,   // branch-owned; NULL for client-level ⇒ shared
        'segment_id'        => $segment?->id,      // may be null if the code doesn't resolve
        'segment_code'      => $data['segment_code'],   // SNAPSHOT
        'rule_code'         => $code,
        'regulatory_status' => $data['regulatory_status'],
        'document_type'     => $data['document_type'],
        'auths_json'        => $data['auths'] ?? [],
        'doc_selections'    => $data['doc_selections'],
        'mandatory_count'   => $mand,
        'optional_count'    => $opt,
        'created_by'=>$user->id, 'updated_by'=>$user->id,
    ]);
});

// A rule going from 0 → ≥1 documents makes its segment appear in the Customer/
// Consignee/Vendor segment pickers (masterBundle only offers segments whose rule
// has documents). Those bundles are cached per-user server-side, so bump the
// version or the new segment won't show for up to 5 minutes.
MasterBundleCache::bump();
→ 201
```

### `validatePayload()`
```php
$data = $request->validate([
    'segment_code'      => 'required|string|max:16',
    'regulatory_status' => Rule::in(REG_VALUES),            // highly | less
    // Domestic / International is MANDATORY — every rule created or edited from the
    // DCP going forward must be typed so a segment can carry a distinct domestic and
    // international document set.
    'document_type'     => ['required', Rule::in(DOC_TYPE_VALUES)],
    'auths'             => 'nullable|array',  'auths.*' => 'string',
    'doc_selections'      => 'required|array',
    'doc_selections.kyc'  => 'nullable|array',
    'doc_selections.dd'   => 'nullable|array',
    'doc_selections.tl'   => 'nullable|array',
    'doc_selections.qc'   => 'nullable|array',
]);
// Trade Documents (td) was removed from the DCP — never persist it, even if an
// older client still includes it in the payload.
unset($data['doc_selections']['td']);
```
Note the codes inside each category map are **not** existence-checked — a rule can reference a document that is later deleted; `forSegment()` simply returns fewer rows.

### `countSelections()`
```php
foreach (['kyc','dd','tl','qc'] as $cat)
    foreach ($sel[$cat] ?? [] as $v)
        $v === 'M' ? $mand++ : ($v === 'O' ? $opt++ : null);
return [$mand, $opt];
// denormalised so the listing table renders badges without re-parsing the JSON per row
```

---

## 4. EDIT (`update`)

```php
$lookup = ClmSegmentRule::query()->whereKey($id);
MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
$row = $lookup->firstOrFail();
if ($msg = MasterVisibility::hierarchicalDenial($user,$row,'edit')) → 403

$data = $this->validatePayload($request);

// same (segment_code, document_type) clash check, EXCLUDING self
$clashQuery = ClmSegmentRule::query()->whereKeyNot($row->id)
    ->where('segment_code',$data['segment_code'])
    ->where('document_type',$data['document_type']);
MasterVisibility::applyReadScope($clashQuery, $user, $user->branch_id ?: null);
if ($clash = $clashQuery->first()) → 409 { message, existing: $clash }

[$mand,$opt] = $this->countSelections($data['doc_selections']);
$row->update([... 'segment_id' => re-resolved from segment_code ..., $mand, $opt]);

// Editing the doc selections can ADD or REMOVE the segment from the pickers
// (0 ↔ ≥1 documents), so invalidate the cached bundles.
MasterBundleCache::bump();
→ 200 { data: $row->fresh() }
```

---

## 5. DELETE (`destroy`)

```php
scoped firstOrFail → hierarchicalDenial('delete') → 403
$row->delete();                       // HARD delete, NO usage guard
MasterBundleCache::bump();            // removing a rule can drop its segment from the pickers
→ 200 { message: 'Deleted' }
```

---

## 6. WHAT CONSUMERS READ (`forSegment`)

```php
// GET /clm/segment-rules/for-segment/{segmentId}?document_type=domestic|international
//
// Resolves the rule PLUS the full document-master rows its doc_selections references,
// so AddCustomer / AddConsignee / AddVendor can pre-populate Stage 2 without three
// extra fetches.
//
// ALWAYS returns 200 even when no rule exists, so the caller renders an empty Stage 2
// instead of having to swallow a 404.

$ruleQuery = ClmSegmentRule::where('client_id',$cid)->where('segment_id',$segmentId);
if (in_array($request->query('document_type'), DOC_TYPE_VALUES, true))
    $ruleQuery->where('document_type', $reqType);
$rule = $ruleQuery->first();

$authMap = ClmAuthority::idNameMap($cid);

$resolveCat = function (string $cat, string $modelClass) use ($rule,$cid,$authMap) {
    $entries = ($rule?->doc_selections ?? [])[$cat] ?? [];
    if (empty($entries)) return [];
    $codes = array_keys($entries);
    $rows  = $modelClass::where('client_id',$cid)->whereIn('code',$codes)->get();

    return $rows->map(function ($r) use ($entries,$authMap) {
        $base = $r->only(['id','code','name','status']);
        // Optional fields — present on SOME models only. This loop is why TL rows
        // surface `validity` while KYC/DD surface `expiry`, and QC surfaces
        // `purpose` + `doc_type`.
        foreach (['authority','expiry','validity','title','doc_type','purpose','party'] as $opt)
            if (array_key_exists($opt, $r->getAttributes())) $base[$opt] = $r->getAttribute($opt);

        if (isset($base['authority'])) {
            $base['authority_list'] = ClmAuthority::displayNamesList($base['authority'], $authMap);
            $base['authority']      = ClmAuthority::displayNames($base['authority'], $authMap);
        }
        $base['requirement'] = $entries[$r->code] ?? 'O';     // ← the M|O stamp
        return $base;
    })->values();
};

→ { data: { rule, kyc: resolveCat('kyc', ClmKycDocument::class),
                  dd:  resolveCat('dd',  ClmDdDocument::class),
                  tl:  resolveCat('tl',  ClmTradeLicense::class),
                  qc:  resolveCat('qc',  ClmQcDocument::class) } }
// (td removed from the DCP — no longer resolved)
```

---

## 7. CODE ALLOCATION (`nextRuleCode`) — the client-wide exception

```php
/** Allocate the next per-TENANT rule code (SR-NNN). Uses MAX(numeric suffix) + 1
 *  rather than count()+1 so a deleted rule in the middle of the sequence doesn't
 *  make the next allocation reuse a rule_code that still exists — which throws a
 *  unique-constraint violation on save. Caller must already hold the client row lock. */
private function nextRuleCode(int $clientId): string
{
    $codes = ClmSegmentRule::where('client_id', $clientId)->pluck('rule_code')->all();
    //                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ NO branch predicate
    $maxN = max over /^SR-(\d+)$/;
    do { $n++; $code = sprintf('SR-%03d', $n); } while (isset($taken[$code]));
    return $code;
}
```
Every other CLM allocator adds `whereNull('branch_id')` / `where('branch_id', $bid)` so codes restart at 001 per branch. **`SR-NNN` does not** — two branches of one client share one sequence. The unique index is `UNIQUE(client_id, rule_code)`, consistent with that.

---

## 8. DOWNSTREAM CONSUMPTION

```php
// SegmentDocUploadController
resolveDocType($owner,$type)   // party country India ⇒ 'domestic', else 'international'
resolveSegmentIds(...)         // the party's segments
→ rule.doc_selections → required docs → join segment_doc_uploads → X of Y
missingMandatoryDocs()         // the gate other modules call before a downstream action

// ClmBuyerProfileController — keyed by BOTH axes, with a fallback
$rulesBySegType[$segment_id][$document_type] = $doc_selections;
$selForSeg = function (int $sid, string $docType) use ($rulesBySegType): array {
    $byType = $rulesBySegType[$sid] ?? [];
    if (isset($byType[$docType])) return $byType[$docType];
    return $byType ? (array) reset($byType) : [];     // fall back to the OTHER type
};                                                     // so legacy single-type setups keep working

// masterBundle (segment picker)
// only offers segments whose rule holds ≥1 document — the reason every write bumps the cache
```

---

## 9. FRONTEND

```tsx
// ClmDcpPage.tsx
GET /clm/segment-rules            → rows + counts{all,highly,less}
GET /clm/segment-rules/bootstrap  → ONE fetch hydrates the whole 2-stage modal

Stage 1: MasterSelect(segment) · radio(document_type) · MasterMultiSelect(authorities)
Stage 2: 4 panels (kyc/dd/tl/qc), each row = checkbox + M|O toggle

// inline document creation — the compliance pages export their modals
import { KycModal } from './ClmKycPage';
import { DdModal }  from './ClmDdPage';
import { QcModal }  from './ClmQcPage';
import { TlModal }  from './ClmTradeLicensesPage';
// after a save the panel re-fetches /clm/segment-rules/bootstrap

AUTHORITIES column → <AuthorityBadges list={authority_list} />   // never the joined string
ClmDcpFilterModal + countDcpFilters() → the filter badge
save → bustAllMasterBundles() → refetch
```

---

## 10. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| One bootstrap call for the whole modal | `bootstrap()` | No waterfall of six fetches while configuring |
| Branch-scoped master loading | `bootstrap()` | Sibling branches' segments must not leak into the dropdown |
| `authority_list` computed **before** overwriting `authority` | `bootstrap()`, `forSegment()` | Authority names may contain commas |
| Documents referenced by **code**, never id | `doc_selections` | Renaming a document is always safe |
| `segment_code` snapshot alongside `segment_id` | `store()`/`update()` | The rule survives a segment reference change |
| Denormalised M/O counts | `countSelections()` | The list renders badges without re-parsing JSON |
| 409 + `existing` on duplicate | `store()`/`update()` | The UI can offer "edit the existing rule instead" |
| `unset($data['doc_selections']['td'])` | `validatePayload()` | Defensive against older clients |
| `MasterBundleCache::bump()` on every write | store/update/destroy | The picker bundle is cached per user for 5 minutes |
| Always-200 `forSegment()` | consumer read | An empty Stage 2 beats a swallowed 404 |

---

## 11. NOTES & CAVEATS

- **`SR-NNN` is client-wide**, the single exception to CLM's per-branch code convention.
- Document codes inside `doc_selections` are not existence-checked at write time.
- `segment_id` is `nullOnDelete`; the snapshotted `segment_code` is what keeps the rule readable.
- Deletes are hard and unguarded — parties already onboarded keep their uploads but lose the checklist.
- The `td` category is stripped on every write.
- `forSegment()`'s fallback to the other `document_type` can mask a missing domestic/international configuration.
- DB is PostgreSQL; `doc_selections` and `auths_json` are real JSON columns but are matched with `LIKE` substring tests elsewhere for portability.

---

*Related documents: DOCUMENT_CONTROL_PANEL_FUNCTIONAL_DOCUMENTATION.md · DOCUMENT_CONTROL_PANEL_TECHNICAL_DOCUMENTATION.md · DOCUMENT_CONTROL_PANEL_API_DOCUMENTATION.md*
