# SUPPLIER PROFILE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · With Shipment ID → **Supplier Profile**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
`ClmSupplierProfileController::index()` is one long method: build every lookup map, then walk the vendors once. This trace follows that order.
File: [ClmSupplierProfileController.php](../../../../app/Http/Controllers/Api/ClmSupplierProfileController.php).

```php
private const CATS = ['kyc', 'dd', 'tl', 'td'];   // note: NO 'qc'

public function index(Request $request): JsonResponse
{
    $user = $request->user(); if (!$user) abort(401);
    $cid  = (int) ($user->client_id ?? 0);

    $empty = ['ws_mat'=>[], 'ws_logi'=>[], 'wos_svc'=>[], 'wos_mat'=>[], 'wos_logi'=>[],
              'txn_ws_mat'=>[], 'txn_ws_logi'=>[], 'txn_wos_svc'=>[],
              'txn_wos_mat'=>[], 'txn_wos_logi'=>[]];
    if (!$cid) return response()->json(['status'=>true, 'data'=>$empty]);
    …
}
```

---

## 1. SEGMENTS AND RULES

```php
$segments = ClmSegment::where('client_id',$cid)->get(['id','name','code','regulatory_status']);
foreach ($segments as $s) {
    $segNameById[(int)$s->id] = (string)$s->name;
    $segRegById[(int)$s->id]  = (string)$s->regulatory_status;
}

/* Segment rules → required-doc union per segment. */
foreach (ClmSegmentRule::where('client_id',$cid)->get(['segment_id','doc_selections']) as $r)
    $rulesBySeg[(int)$r->segment_id] = is_array($r->doc_selections) ? $r->doc_selections : [];
```

> **Single-type keying.** The buyer profile stores `$rulesBySegType[$sid][$document_type]` and picks the one matching the party's country. Here the assignment is flat — so when a segment holds **both** a domestic and an international rule, **the last row read wins**. Suppliers have no domestic/international distinction on this screen.

---

## 2. UPLOADS AND AGREEMENTS

```php
/* Uploaded docs grouped by owner: "Type#id" → set of "cat::code". */
foreach (SegmentDocUpload::where('client_id',$cid)
           ->get(['uploadable_type','uploadable_id','category','doc_code']) as $u)
    $uploadsByOwner[$u->uploadable_type.'#'.$u->uploadable_id][$u->category.'::'.$u->doc_code] = true;

/* Active agreements + applicability per segment id. */
$agreements = ClmAgreementLibrary::where('client_id',$cid)
                ->where('agr_status','Active')->get(['id','segment','regulatory']);
foreach ($segments as $s) {
    foreach ($agreements as $a) {
        if ((string)$a->regulatory !== (string)$s->regulatory_status) continue;   // TIER equality
        if ($this->csvHasToken($a->segment, $s->name) ||
            $this->csvHasToken($a->segment, $s->code))                            // NAME or CODE
            $agrIdsBySeg[(int)$s->id][] = (int)$a->id;
    }
}

/* Completed AGREEMENT signature requests, keyed by party. */
foreach (ClmSignatureRequest::where('client_id',$cid)
           ->where('document_type', DOC_AGREEMENT)->where('status','completed')
           ->get(['model_name','party_id','trade_doc_ids']) as $sr)
    foreach ((array)$sr->trade_doc_ids as $aid)
        if ($sr->party_id) $sigByParty[$sr->model_name.'#'.$sr->party_id][(int)$aid] = true;
```

Note there is **no trade-doc signature index** here — unlike the buyer profile, `td` progress comes only from uploads.

---

## 3. THE STATE COLUMN

```php
/* State id → name (for the supplier's State column). */
$stateNameById = DB::table('master_states')->pluck('name','id')->all();
```

---

## 4. THE SHIPMENT CLASSIFICATION CHAIN

This is the module's distinctive piece — four maps that connect a vendor to a shipment.

```php
/* Vendor → product ids (VendorProductMapping). */
foreach (VendorProductMapping::query()
           ->whereIn('vendor_id', Vendor::query()->forUser($user)->select('id'))   // ← scoped subquery
           ->get(['vendor_id','product_id']) as $m)
    $productsByVendor[(int)$m->vendor_id][] = (int)$m->product_id;

/* Shipment classification chain: leads with a shipment → product ids procured on those
 * leads → "shipped products"; plus a per-product shipment-count so we can roll a count
 * up to each vendor. */
foreach (ShipmentOrder::where('client_id',$cid)->get(['id','lead_id']) as $so) {
    $shipCountByLead[$lid] = ($shipCountByLead[$lid] ?? 0) + 1;
    $shipIdsByLead[$lid][] = (int)$so->id;            // transaction-wise
}

$procLeadById = Procurement::where('client_id',$cid)->pluck('lead_id','id')->all();

foreach (ProcurementProduct::whereIn('procurement_id', array_keys($procLeadById))
           ->whereNotNull('product_id')->get(['procurement_id','product_id']) as $pp) {
    $lead = (int)($procLeadById[(int)$pp->procurement_id] ?? 0);
    if ($lead) $leadsByProduct[(int)$pp->product_id][$lead] = true;      // party-wise
    $procurementsByProduct[(int)$pp->product_id][(int)$pp->procurement_id] = true;  // txn-wise
}
```

Reading it the other way round:
```
vendor ──productsByVendor──▶ product ──leadsByProduct──▶ lead ──shipCountByLead──▶ shipments
                                    └──procurementsByProduct──▶ procurement (txn rows)
```

---

## 5. THE CLOSURES

```php
// Union of required codes across the vendor's (single) segment
$unionFor = function (array $segIds) use ($rulesBySeg): array {
    $u = ['kyc'=>[], 'dd'=>[], 'tl'=>[], 'td'=>[]];
    foreach ($segIds as $sid)
        foreach (self::CATS as $c)
            foreach (($rulesBySeg[$sid][$c] ?? []) as $code => $req) $u[$c][$code] = true;
    return $u;
};

// d/t per category from the uploads map
$progressFor = function (array $union, string $ownerKey) use ($uploadsByOwner): array { … };

// applicable agreements for the segment set vs the completed-signature set
$agrProgress = function (array $segIds, array $signedSet) use ($agrIdsBySeg): array {
    foreach ($segIds as $sid) foreach ($agrIdsBySeg[$sid] ?? [] as $aid) $applic[$aid] = true;
    $ids = array_keys($applic);
    foreach ($ids as $aid) if (isset($signedSet[$aid])) $d++;
    return ['d'=>$d, 't'=>count($ids)];
};

/** Map a supplier-type name → one of the three buckets. */
$bucketForType = function (?string $name): string {
    $n = mb_strtolower(trim((string)$name));
    if ($n === 'material') return 'material';
    if ($n === 'logistic' || $n === 'logistics') return 'logistic';
    return 'services';        // ← Tech / Advisory / Risk Services + ANYTHING ELSE
};

/** Segment regulatory tier → the Reg. Status pill used by the transaction-wise tables
 *  ('highly' → High, everything else → Low). */
$regFor = fn(int $segId) => mb_strtolower($segRegById[$segId] ?? '') === 'highly' ? 'High' : 'Low';
```

---

## 6. THE VENDOR LOOP — PARTY-WISE ROWS

```php
$vendors = Vendor::query()->forUser($user)
    ->with(['vendorType:id,name', 'primaryAddress:id,vendor_id,state_id'])
    ->orderBy('id')->get();

$counters = ['ws_mat'=>0,'ws_logi'=>0,'wos_svc'=>0,'wos_mat'=>0,'wos_logi'=>0];

foreach ($vendors as $v) {
    $segId  = (int)($v->segment_id ?? 0);
    $segIds = $segId ? [$segId] : [];                       // ← a vendor has ONE segment
    $prog   = $progressFor($unionFor($segIds), Vendor::class.'#'.$v->id);
    $agr    = $agrProgress($segIds, $sigByParty['Vendor#'.$v->id] ?? []);

    // Shipment roll-up across this vendor's mapped products
    foreach ($productsByVendor[$v->id] ?? [] as $pid)
        foreach (array_keys($leadsByProduct[$pid] ?? []) as $lid) $vendorLeads[$lid] = true;
    foreach (array_keys($vendorLeads) as $lid)
        if (isset($shipCountByLead[$lid])) { $withShipment = true; $ship += $shipCountByLead[$lid]; }

    $row = [
      'id'    => $v->vendor_code ?: 'S-'.str_pad($v->id,3,'0',STR_PAD_LEFT),
      'db_id' => (int)$v->id,
      'name'  => $v->company_name,
      'seg'   => $segId ? ($segNameById[$segId] ?? '—') : '—',
      'sc'/'sb'/'sc2' => chip colours,
      'state' => $stateNameById[optional($v->primaryAddress)->state_id] ?? '—',
      'kyc'=>$prog['kyc'], 'dd'=>$prog['dd'], 'tl'=>$prog['tl'], 'td'=>$prog['td'],
      'agr'=>$agr, 'ship'=>$ship,
    ];

    $bucket = $bucketForType(optional($v->vendorType)->name);
    if      ($bucket === 'services') { $row['sr'] = ++$counters['wos_svc']; $out['wos_svc'][] = $row; }
    elseif  ($bucket === 'material') { $withShipment ? ws_mat : wos_mat }
    else                             { $withShipment ? ws_logi : wos_logi }
    //      ^ SERVICES never carries a shipment — it always lands in wos_svc
}
```

---

## 7. THE VENDOR LOOP — TRANSACTION-WISE ROWS

```php
/* Transaction-wise rows: one per (procurement, supplier) where this supplier's product
 * was procured. With/without shipment is decided PER-PROCUREMENT by its lead's shipment
 * orders. Services suppliers never carry a shipment (mirrors party-wise). PO / Supplier
 * Tax Invoice have no source field → '—'. */
foreach ($productsByVendor[$v->id] ?? [] as $pid)
    foreach (array_keys($procurementsByProduct[$pid] ?? []) as $procId) $vendorProcs[$procId] = true;

$txnBase = [
    'supplier'=>$v->company_name, 'supId'=>$row['id'], 'supDbId'=>(int)$v->id,
    'reg'=>$regFor($segId),
    'po'=>'—', 'inv'=>'—',                          // ← hard-coded, no source field yet
    'kyc'=>$prog['kyc'], 'dd'=>$prog['dd'], 'tl'=>$prog['tl'], 'td'=>$prog['td'], 'agr'=>$agr,
];  // ↑ the PARTY-level ratios, COPIED — they are not recomputed per procurement

foreach (array_keys($vendorProcs) as $procId) {
    $lead     = (int)($procLeadById[$procId] ?? 0);
    $shipIds  = $shipIdsByLead[$lead] ?? [];
    $hasShip  = !empty($shipIds);
    $procCode = 'PROC-' . str_pad($procId, 3, '0', STR_PAD_LEFT);      // SYNTHESISED from the PK

    if ($bucket === 'services')       → txn_wos_svc  (+ procId)
    elseif ($bucket === 'material')   → $hasShip ? txn_ws_mat  : txn_wos_mat
    else                              → $hasShip ? txn_ws_logi : txn_wos_logi

    // when with-shipment:
    $shpCode = 'SHP-' . str_pad($shipIds[0], 3, '0', STR_PAD_LEFT);    // ← only the FIRST id
}
```

Two things to notice:
- `PROC-NNN` and `SHP-NNN` are **synthesised from primary keys**. The buyer profile uses the real `shipment_orders.shipment_code`, so the two screens can display different ids for the same shipment.
- Only `$shipIds[0]` is used, so a lead with several shipment orders surfaces just the first.

---

## 8. THE ENVELOPE

```php
return response()->json(['status'=>true, 'data'=>$out]);
// $out = ws_mat · ws_logi · wos_svc · wos_mat · wos_logi
//      + txn_ws_mat · txn_ws_logi · txn_wos_svc · txn_wos_mat · txn_wos_logi
```

### `csvHasToken(?string $csv, string $token): bool`
```php
/** Case-insensitive token membership in a comma-separated string. */
foreach (explode(',', $csv) as $part)
    if (mb_strtolower(trim($part)) === $token) return true;
```
Whole-entry comparison, so `Rice` never matches `Rice Bran`.

---

## 9. HOW OTHER CONTROLLERS REUSE THIS

```php
// ClmDiagnosisResolutionController — METHOD INJECTION, not an HTTP call
public function index(Request $request,
                      ClmBuyerProfileController $buyer,
                      ClmSupplierProfileController $supplier): JsonResponse
{
    $supplierData = $supplier->index($request)->getData(true)['data'] ?? [];
    …
}

// ClmRegulatoryDefenseFileController
$s = $supplier->index($request)->getData(true)['data'] ?? [];
$this->withoutShipment($s);     // procurement-wise supplier records + compliance
```

---

## 10. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Build every map first, then walk vendors once | `index()` | Avoids N+1 across 11 tables |
| Scoped subquery inside the mapping lookup | `productsByVendor` | `Vendor::forUser($user)->select('id')` keeps the join tenant-safe |
| Product → lead → shipment chain | phase 4 | A supplier has no direct shipment link |
| Services is the **catch-all** bucket | `bucketForType` | Any unrecognised vendor type is Services |
| Services never "with shipment" | vendor loop | Consistent between party-wise and transaction-wise |
| Party-level ratios copied into txn rows | `$txnBase` | Cheap, but repeats the same numbers per procurement |
| Per-bucket `sr` counters | vendor loop | Each tab numbers its own rows from 1 |
| Method injection for reuse | Diagnosis, RDF | One aggregation, three screens |

---

## 11. NOTES & CAVEATS

- **`$rulesBySeg` is single-type** — a segment with both a domestic and an international rule keeps whichever was read last.
- `CATS` excludes **`qc`**.
- `td` progress comes only from uploads — there is no trade-doc signature index here (the buyer profile has one).
- `PROC-NNN` / `SHP-NNN` are synthesised from primary keys, not stored codes.
- Only the first shipment order id of a lead is shown on a transaction row.
- `po` and `inv` are hard-coded `'—'`.
- Transaction ratios are the vendor's party-level ratios, repeated.
- No pagination, no cache — the whole tenant is aggregated in memory per request.
- DB is PostgreSQL.

---

*Related documents: SUPPLIER_PROFILE_FUNCTIONAL_DOCUMENTATION.md · SUPPLIER_PROFILE_TECHNICAL_DOCUMENTATION.md · SUPPLIER_PROFILE_API_DOCUMENTATION.md*
