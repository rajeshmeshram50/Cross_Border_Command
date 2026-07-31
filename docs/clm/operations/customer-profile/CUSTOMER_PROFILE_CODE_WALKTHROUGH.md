# CUSTOMER PROFILE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · With Shipment ID → **Customer Profile**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
`ClmBuyerProfileController::index()` is one long method that runs in **nine numbered phases**. This trace follows those numbers exactly.
File: [ClmBuyerProfileController.php](../../../../app/Http/Controllers/Api/ClmBuyerProfileController.php).

```php
private const CATS = ['kyc', 'dd', 'tl', 'td'];   // note: NO 'qc'

public function index(Request $request): JsonResponse
{
    $user = $request->user(); if (!$user) abort(401);
    $cid  = (int) ($user->client_id ?? 0);

    $empty = ['buyers'=>[], 'consignees'=>[], 'ws_eq'=>[], 'ws_neq'=>[], 'wos_eq'=>[], 'wos_neq'=>[]];
    if (!$cid) return response()->json(['status'=>true, 'data'=>$empty]);
    …
}
```

---

## 1. SEGMENT MASTERS

```php
$segments = ClmSegment::where('client_id',$cid)->get(['id','name','code','regulatory_status']);
foreach ($segments as $s) {
    $segIdByName[mb_strtolower(trim($s->name))] = (int)$s->id;
    $segRegById[(int)$s->id] = (string)$s->regulatory_status;   // 'highly' | 'less'
}
```

---

## 2. SEGMENT RULES → THE REQUIRED-DOC UNION

```php
/* A segment can carry a Domestic AND an International rule, so key the doc_selections
 * by document_type and let each buyer draw the set that matches its own trade type
 * (India → domestic, else international). `$selForSeg` falls back to the segment's
 * other-type rule when the matching one is absent, so legacy single-type setups
 * never lose docs. */
foreach (ClmSegmentRule::where('client_id',$cid)
           ->get(['segment_id','document_type','doc_selections']) as $r)
    $rulesBySegType[(int)$r->segment_id][(string)$r->document_type] = (array)$r->doc_selections;

$selForSeg = function (int $sid, string $docType) use ($rulesBySegType): array {
    $byType = $rulesBySegType[$sid] ?? [];
    if (isset($byType[$docType])) return $byType[$docType];
    return $byType ? (array) reset($byType) : [];          // ← the fallback
};
```

---

## 3. UPLOADS GROUPED BY OWNER

```php
// "Type#id" → set of "cat::code" — one pass, then O(1) lookups per party
foreach (SegmentDocUpload::where('client_id',$cid)
           ->get(['uploadable_type','uploadable_id','category','doc_code']) as $u)
    $uploadsByOwner[$u->uploadable_type.'#'.$u->uploadable_id][$u->category.'::'.$u->doc_code] = true;
```

---

## 4. APPLICABLE AGREEMENTS + TRADE DOCUMENTS PER SEGMENT

```php
$agreements = ClmAgreementLibrary::where('client_id',$cid)
                ->where('agr_status','Active')->get(['id','segment','regulatory','party']);
foreach ($agreements as $a) $agrPartyById[(int)$a->id] = (string)$a->party;
foreach ($segments as $s) {
    foreach ($agreements as $a) {
        if ((string)$a->regulatory !== (string)$s->regulatory_status) continue;    // TIER equality
        if ($this->csvHasToken($a->segment, $s->name) ||
            $this->csvHasToken($a->segment, $s->code))                             // NAME or CODE
            $agrIdsBySeg[(int)$s->id][] = (int)$a->id;
    }
}

// Active trade-document library matched the SAME way, so a shipment's Trade Docs count
// (its Proforma Invoice + applicable trade docs) mirrors the Evidence Vault instead of
// the empty customer bucket.
$tradeDocs = ClmTradeDocLibrary::where('client_id',$cid)->where('status','active')
                ->get(['id','segment','regulatory','party']);
→ $tdPartyById · $tdIdsBySeg
```

---

## 5. COMPLETED SIGNATURE REQUESTS — THREE INDEXES

```php
// (a) AGREEMENTS, keyed by party AND by lead+side
foreach (ClmSignatureRequest::where('client_id',$cid)
           ->where('document_type', DOC_AGREEMENT)->where('status','completed')
           ->get(['model_name','party_id','lead_id','trade_doc_ids']) as $sr) {
    $party = $sr->model_name === 'Consignee' ? 'Consignee' : 'Customer';
    foreach ((array)$sr->trade_doc_ids as $aid) {
        if ($sr->party_id) $sigByParty[$sr->model_name.'#'.$sr->party_id][(int)$aid] = true;
        if ($sr->lead_id)  $agrSigByLead[(int)$sr->lead_id][$party][(int)$aid]       = true;
    }
}

// (b) TRADE DOCUMENTS, per lead + side, keyed by trade-doc-library id
//     (legacy scalar `trade_doc_id` OR the multi-doc JSON array)
foreach (… DOC_TRADE … status 'completed' …) {
    if (!$sr->lead_id) continue;
    $ids = $sr->trade_doc_ids ?: [$sr->trade_doc_id];
    foreach ((array)$ids as $mid) $tdSigByLead[(int)$sr->lead_id][$party][(int)$mid] = true;
}
```

---

## 6. THE SHARED CLOSURES

```php
// party segment CSV → segment ids (unknown names silently dropped)
$segIdsFromNames = fn(?string $csv) => …;

// Buyer trade type from its primary-address country (India → domestic).
$docTypeForCountry = fn(?string $country) => trim($country) === 'India' ? 'domestic' : 'international';

// Union of required codes across a party's segments, per category
$unionFor = function (array $segIds, string $docType) use ($selForSeg): array {
    $u = ['kyc'=>[], 'dd'=>[], 'tl'=>[], 'td'=>[]];
    foreach ($segIds as $sid) {
        $sel = $selForSeg($sid, $docType);
        foreach (self::CATS as $c)
            foreach (($sel[$c] ?? []) as $code => $req) $u[$c][$code] = true;   // set semantics
    }
    return $u;
};

// d/t per category from the uploads map
$progressFor = function (array $union, string $ownerKey) use ($uploadsByOwner): array {
    $up = $uploadsByOwner[$ownerKey] ?? [];
    foreach (self::CATS as $c) {
        $codes = array_keys($union[$c]);  $d = 0;
        foreach ($codes as $code) if (isset($up[$c.'::'.$code])) $d++;
        $out[$c] = ['d'=>$d, 't'=>count($codes)];
    }
    return $out;
};

$agrIdsForSegments / $tdIdsForSegments  // applicable library ids for a set of segments
$agrProgress($applicableIds, $signedSet) // d = how many are in the completed set

/* Party membership from a doc's party CSV (buyer / consignee), matching the Evidence
 * Vault's partyFlags. EMPTY ⇒ applies to BOTH parties. */
$partyFlags = function (?string $party): array {
    $tokens = lowercased CSV parts;
    $fb = in_array('buyer',$tokens,true);  $fc = in_array('consignee',$tokens,true);
    if (!$fb && !$fc) { $fb = true; $fc = true; }      // ← blank = universal
    return [$fb, $fc];
};

/* Per-party applicable-doc progress: count the applicable library ids whose party
 * covers $side ('buyer'|'consignee'); a doc is "done" when a completed signature for
 * that side exists. Mirrors the vault ratios. */
$docProgress = function (array $ids, array $partyById, array $signedForSide, string $side) { … };

// Regulatory tier label from a set of segment ids: High | Low | Both
$regFor = fn(array $segIds) => …;
```

---

## 7. LEADS, PIs AND SHIPMENTS (all batched)

```php
$leads = Lead::where('client_id',$cid)->whereNotNull('customer_id')
           ->get(['id','opp_code','customer_id','consignee_id','lead_stage_id']);

// Latest non-cancelled PI per lead — orderBy('id') so the LATER id overwrites
foreach (ProformaInvoice::where(client)->whereIn('opp_id',$leadIds)
           ->where('status','!=','cancelled')->orderBy('id')->get(['id','opp_id','code']) as $pi)
    $piByLead[(int)$pi->opp_id] = $pi;

/* Which PIs have a COMPLETED e-signature — the PI is a shipment's first (buyer-side)
 * Trade Document, so a signed PI counts as a signed trade doc (same source of truth
 * the Q/PI list + Evidence Vault use). */
foreach (ClmSignatureRequest::where(client)
           ->where('document_type', DOC_PROFORMA_INVOICE)
           ->whereIn('trade_doc_id',$piIdsForSig)->where('status','completed')
           ->get(['trade_doc_id']) as $sr)
    $piSignedIds[(int)$sr->trade_doc_id] = true;

// Lead → product segment ids, via the lead's latest PI line items
ProformaInvoiceItem::whereIn('proforma_invoice_id',$piIds)->whereNotNull('product_id')
    → $itemsByPi → Product::whereIn('id',$allProductIds)->whereNotNull('segment_id')
    → $segByProduct → $leadSegIds[$leadId] = [segment ids]

// Shipments: which leads have one + per-customer count
foreach (ShipmentOrder::where(client)->orderBy('id')->get(['id','lead_id','shipment_code']) as $so) {
    $shipLeadIds[$lid] = true;
    /* Real shipment_orders.shipment_code (e.g. "SHP-001"), so the txn tables show the
     * SAME id as the Evidence Vault. Latest row wins; legacy rows with a NULL code
     * fall back to the synthetic id. */
    if ($so->shipment_code) $shipCodeByLead[$lid] = $so->shipment_code;
    $shipByCustomer[$cust] = ($shipByCustomer[$cust] ?? 0) + 1;
}
```

---

## 8. BUYERS (customers)

```php
/* Count only DISTINCT consignees (exclude "same as customer" entries) so the list's
 * CONSIGNEES column matches the consignee popup. */
$customers = Customer::query()->forUser($user)                      // ← the ONLY per-user scope
    ->withCount(['consignees as consignees_count' => fn($q) =>
        $q->where(fn($w) => $w->where('same_as_customer',false)->orWhereNull('same_as_customer'))])
    ->with('primaryAddress:id,customer_id,country')
    ->orderBy('id')->get();

foreach ($customers as $c) {
    $segIds = $segIdsFromNames($c->segment);
    $prog   = $progressFor(
                  $unionFor($segIds, $docTypeForCountry(optional($c->primaryAddress)->country)),
                  Customer::class.'#'.$c->id);
    $applic = $agrIdsForSegments($segIds);
    $agr    = $agrProgress($applic, $sigByParty['Customer#'.$c->id] ?? []);

    $buyers[] = [
      'sr'=>$sr, 'id'=>$c->customer_code ?: 'C-'.str_pad($c->id,3,'0',STR_PAD_LEFT),
      'db_id'=>$c->id, 'name'=>$c->company_name,
      'seg'=>[segment names], 'sc'/'sb'=>chip colours,
      'country'=>optional($c->primaryAddress)->country ?: '—',
      'cn'=>$c->consignees_count,
      'kyc'=>$prog['kyc'], 'dd'=>$prog['dd'], 'tl'=>$prog['tl'], 'td'=>$prog['td'],
      'agr'=>$agr, 'ship'=>$shipByCustomer[$c->id] ?? 0,
    ];
}
```

Consignees follow the identical shape, keyed `Consignee#id`, carrying `cid` (the parent customer code) instead of `cn`.

---

## 9. TRANSACTIONS — the four buckets

```php
foreach ($leads as $l) {
    $segIds  = $leadSegIds[(int)$l->id] ?? [];          // from the latest PI's products
    $docType = $docTypeForCountry(customer's country);
    $union   = $unionFor($segIds, $docType);

    // uploads-based kyc/dd/tl/td for the party, agreements + trade docs per side
    $agrIds = $agrIdsForSegments($segIds);
    $tdIds  = $tdIdsForSegments($segIds);
    $agr    = $docProgress($agrIds, $agrPartyById, $agrSigByLead[$lid]['Customer'] ?? [], 'buyer');
    $td     = $docProgress($tdIds,  $tdPartyById,  $tdSigByLead[$lid]['Customer']  ?? [], 'buyer');
    // + a completed PI signature counts toward `td` (piSignedIds)

    $hasShipment       = isset($shipLeadIds[$lid]);
    $buyerEqConsignee  = no distinct consignee OR same_as_customer;

    $bucket = $hasShipment
        ? ($buyerEqConsignee ? 'ws_eq'  : 'ws_neq')
        : ($buyerEqConsignee ? 'wos_eq' : 'wos_neq');

    $$bucket[] = [ 'sr', 'opp'=>$l->opp_code, 'customer', 'consignee'?, 'pi'?,
                   'shp'? => $shipCodeByLead[$lid], 'reg'=>$regFor($segIds),
                   'kyc','dd','tl','td','agr', 'leadId'=>$lid ];
}
```

The `leadId` on each row is what `ClmRegulatoryDefenseFileController::withShipment()` uses to expand a buyer row with every procurement and supplier under that opportunity.

---

## 10. THE ENVELOPE

```php
return response()->json(['status'=>true, 'data'=>[
    'buyers'=>…, 'consignees'=>…,
    'ws_eq'=>…, 'ws_neq'=>…, 'wos_eq'=>…, 'wos_neq'=>…,
]]);
```

### `csvHasToken(?string $csv, string $token): bool`
Whole-entry, case-insensitive comparison of a comma-separated string — the same guard the agreement controller achieves with its comma-boundary `LIKE` patterns, so `Tobacco` never matches `Tobacco Stripping`.

---

## 11. HOW OTHER CONTROLLERS REUSE THIS

```php
// ClmDiagnosisResolutionController — METHOD INJECTION, not an HTTP call
public function index(Request $request,
                      ClmBuyerProfileController $buyer,
                      ClmSupplierProfileController $supplier): JsonResponse
{
    $buyerData    = $buyer->index($request)->getData(true)['data'] ?? [];
    $supplierData = $supplier->index($request)->getData(true)['data'] ?? [];
    …
}
/* "The heavy aggregation (segment rules → required-doc union → upload progress →
 *  agreements) is reused verbatim from the existing profile controllers — they already
 *  scope by client_id / branch_id through forUser(), so tenant isolation is inherited
 *  and there is no duplicated query logic to drift." */

// ClmRegulatoryDefenseFileController — same injection
$b = $buyer->index($request)->getData(true)['data'] ?? [];
$this->withShipment($b, $cid);   // expands ws_eq + ws_neq with procurements + suppliers
```

---

## 12. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Nine numbered phases | `index()` | Every lookup is batched before any row is built |
| Map/set building, then O(1) lookups | phases 1–6 | Avoids N+1 across 13 tables |
| `[segment_id][document_type]` keying + fallback | `$selForSeg` | Domestic/international without breaking legacy setups |
| Set semantics for the union | `$unionFor` | A code required by two segments counts once |
| `partyFlags` blank ⇒ both | `$partyFlags` | Matches the Evidence Vault exactly |
| Signed PI counts as a trade doc | `$piSignedIds` | The PI *is* the first buyer-side trade document |
| Real `shipment_code` preferred | phase 6 | The txn table shows the same id as the vault |
| Method injection for reuse | Diagnosis, RDF | One aggregation, three screens, no drift |

---

## 13. NOTES & CAVEATS

- `CATS` excludes **`qc`** — Quality & Compliance docs are not a scorecard family.
- Most sub-queries are `where('client_id', $cid)`; only the customer roster goes through `forUser($user)`.
- Transaction segments come from the **latest non-cancelled PI only** — a quotation-stage lead reports none.
- Party ↔ segment matching is by **name**; a stale name contributes zero required documents silently.
- No pagination, no cache — the whole tenant is aggregated in memory per request.
- DB is PostgreSQL.

---

*Related documents: CUSTOMER_PROFILE_FUNCTIONAL_DOCUMENTATION.md · CUSTOMER_PROFILE_TECHNICAL_DOCUMENTATION.md · CUSTOMER_PROFILE_API_DOCUMENTATION.md*
