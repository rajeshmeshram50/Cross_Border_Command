# SUPPLIER PROFILE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · With Shipment ID → **Supplier Profile**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
A **single read endpoint** (`ClmSupplierProfileController::index`, ~280 lines) that mirrors `ClmBuyerProfileController` on the procurement side. It owns no table; it joins ten existing ones into ten output collections.

Like its buy-side twin it is a **shared service** — `ClmDiagnosisResolutionController` and `ClmRegulatoryDefenseFileController` method-inject it and call `index()` directly.

### 1.2 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                               │
│  pages/clm/operations/ClmSupplierProfilePage.tsx                      │
│    party-wise + transaction-wise tabs · progress bars · vault link    │
│  pages/clm/command-center/useClmAnalyticsData.ts  (re-uses this feed) │
└──────────────────────────────┬───────────────────────────────────────┘
                                │ GET /api/clm/supplier-profile
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmSupplierProfileController::index()                  │
│   segments        → segNameById · segRegById                          │
│   segment rules   → rulesBySeg[segment_id]        ← SINGLE-TYPE       │
│   uploads         → uploadsByOwner["Vendor#id"]["cat::code"]          │
│   agreements      → agrIdsBySeg (tier + csvHasToken)                  │
│   completed sigs  → sigByParty["Vendor#id"]                           │
│   master_states   → stateNameById                                     │
│   VendorProductMapping → productsByVendor                             │
│   ShipmentOrder   → shipCountByLead · shipIdsByLead                   │
│   Procurement     → procLeadById                                      │
│   ProcurementProduct → leadsByProduct · procurementsByProduct         │
│                                                                       │
│   Closures: unionFor · progressFor · agrProgress ·                    │
│             bucketForType · regFor · csvHasToken                      │
└──────────────────────────────┬───────────────────────────────────────┘
      ClmDiagnosisResolutionController ─┐  method-injected, call index()
      ClmRegulatoryDefenseFileController ┘  and reuse `data` verbatim
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DATA (read-only)                                                     │
│   clm_segments · clm_segment_rules · segment_doc_uploads ·            │
│   clm_agreement_library · clm_signature_requests · vendors ·          │
│   vendor_product_mappings · procurements · procurement_products ·     │
│   shipment_orders · master_states                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmSupplierProfileController.php    ← the whole module
app/Models/  ClmSegment · ClmSegmentRule · SegmentDocUpload ·
             ClmAgreementLibrary · ClmSignatureRequest · Vendor ·
             VendorProductMapping · Procurement · ProcurementProduct · ShipmentOrder
resources/js/pages/clm/operations/ClmSupplierProfilePage.tsx
resources/js/pages/clm/command-center/useClmAnalyticsData.ts
```
No migration — the module creates no tables.

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| Frontend | React 19 · TS · shared CLM operations theme (`useOpsTheme`) |
| Aggregation | Pure PHP over eager-loaded collections — no SQL views, no cache |

---

## 3. DATA MODEL (what it reads)

| Table | Used for |
|---|---|
| `clm_segments` | id→name (segment chip), id→regulatory tier (`reg` pill) |
| `clm_segment_rules` | `doc_selections` keyed by `segment_id` — **no `document_type` dimension** |
| `segment_doc_uploads` | the "done" side of `kyc` / `dd` / `tl` / `td` |
| `clm_agreement_library` | applicable agreements per segment (Active only) |
| `clm_signature_requests` | completed `agreement` requests, keyed `Vendor#id` |
| `vendors` | the roster, with `vendorType` and `primaryAddress.state_id` |
| `master_states` | the STATE column |
| `vendor_product_mappings` | vendor → product ids |
| `procurements` | procurement → lead |
| `procurement_products` | procurement → product ids |
| `shipment_orders` | shipment counts and ids per lead |

Constant: `private const CATS = ['kyc', 'dd', 'tl', 'td'];` — **`qc` is not tracked**.

---

## 4. API ENDPOINT CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get('/clm/supplier-profile', [ClmSupplierProfileController::class, 'index']);
});
```
No query parameters. A user with no `client_id` receives the empty envelope with all ten keys present. Full response shape in **SUPPLIER_PROFILE_API_DOCUMENTATION.md**.

---

## 5. CONTROLLER ANALYSIS

### Phase 1 — segments and rules
```php
$segNameById[$id] = $name;  $segRegById[$id] = 'highly'|'less';

// NOTE: single-type. Unlike the buyer profile, there is no [segment_id][document_type]
// keying here — the last rule read for a segment wins.
foreach (ClmSegmentRule::where('client_id',$cid)->get(['segment_id','doc_selections']) as $r)
    $rulesBySeg[(int)$r->segment_id] = (array) $r->doc_selections;
```

### Phase 2 — uploads and agreements
`$uploadsByOwner["App\Models\Vendor#77"]["kyc::KYC-003"] = true`, then `$agrIdsBySeg` built with a tier equality check plus `csvHasToken()` on the agreement's `segment` CSV (name **or** code).

### Phase 3 — completed agreement signatures
`$sigByParty["Vendor#77"][agreementId] = true`, from `clm_signature_requests` where `document_type = 'agreement'` and `status = 'completed'`.

### Phase 4 — the shipment classification chain
This is the module's distinctive piece:
```php
ShipmentOrder      → $shipCountByLead[lead] , $shipIdsByLead[lead][]
Procurement        → $procLeadById[procurementId] = leadId
ProcurementProduct → $leadsByProduct[productId][leadId]        = true
                     $procurementsByProduct[productId][procId] = true
VendorProductMapping → $productsByVendor[vendorId][] = productId
```
A vendor's leads are the union of `leadsByProduct` over its mapped products; it is "with shipment" if any of those leads appears in `shipCountByLead`.

### Phase 5 — the closures
| Closure | Does |
|---|---|
| `unionFor($segIds)` | Union of required codes across the (single) segment's rule |
| `progressFor($union, $ownerKey)` | `['kyc'=>['d'=>n,'t'=>m], …]` from the uploads map |
| `agrProgress($segIds, $signedSet)` | Applicable agreement ids vs the completed set |
| `bucketForType($vendorTypeName)` | `material` \| `logistic` \| **`services`** (the catch-all) |
| `regFor($segId)` | `'High'` when the segment is `highly`, else `'Low'` |
| `csvHasToken($csv, $token)` | Whole-entry, case-insensitive CSV membership |

### Phase 6 — vendor rows and bucketing
```php
$vendors = Vendor::query()->forUser($user)
    ->with(['vendorType:id,name', 'primaryAddress:id,vendor_id,state_id'])
    ->orderBy('id')->get();
```
Each vendor produces one party-wise row, assigned to a bucket by `bucketForType()` × `$withShipment` — with **services always landing in `wos_svc`**. Each bucket keeps its own `sr` counter.

### Phase 7 — transaction rows
```php
/* Transaction-wise rows: one per (procurement, supplier) where this supplier's product
 * was procured. With/without shipment is decided PER PROCUREMENT by its lead's shipment
 * orders. Services suppliers never carry a shipment (mirrors party-wise). PO / Supplier
 * Tax Invoice have no source field → '—'. */
$txnBase = ['supplier','supId','supDbId','reg','po'=>'—','inv'=>'—','kyc','dd','tl','td','agr'];
$procCode = 'PROC-' . str_pad($procId, 3, '0', STR_PAD_LEFT);
$shpCode  = 'SHP-'  . str_pad($shipIds[0], 3, '0', STR_PAD_LEFT);   // FIRST shipment order id
```
The ratios in `$txnBase` are the **party-level** ones — they are copied, not recomputed per procurement.

---

## 6. FRONTEND

`ClmSupplierProfilePage.tsx` renders the ten collections as party-wise and transaction-wise tab groups using the shared operations theme. Rows drill into `/segment-uploads/vendor/{db_id}/vault`.

`useClmAnalyticsData.ts` fetches this endpoint in parallel with `/clm/buyer-profile`; its `ApiSupTxn` type notes that *"supplier txns are procurement-level — they carry no opportunity id"*.

---

## 7. INTEGRATIONS

| Consumer | How |
|---|---|
| **CLM Analytics** | Fetched in parallel with the buyer profile and reshaped for the dashboards |
| **Diagnosis & Resolution** | Method-injects this controller; the result becomes its `supplier` block |
| **Regulatory Defense File** | `withoutShipment($supplier)` builds the procurement-wise tab from `wos_*` |
| **Evidence Vault** | The drill-down target; shares the "done" definitions |
| **P2P / Procurement** | Supplies the vendor→product→procurement→lead chain this screen walks |

---

## 8. SECURITY & CAVEATS

1. `client_id` is derived from `auth()->user()`; the vendor roster and the vendor-product mapping subquery both go through `Vendor::forUser($user)`.
2. Other sub-queries are `where('client_id', $cid)` — client-wide by design.
3. **`rulesBySeg` is single-type**: `$rulesBySeg[$segment_id] = $r->doc_selections` overwrites, so when a segment has both a domestic and an international rule the **last row read wins**. The buyer profile keys by `[segment_id][document_type]` and falls back deliberately; this controller does not.
4. `PROC-NNN` and `SHP-NNN` are **synthesised from primary keys**, unlike the buyer profile which uses the real `shipment_orders.shipment_code`. The two screens can therefore show different shipment ids for the same shipment.
5. Only `$shipIds[0]` is used for a transaction row's `shpId`, so a lead with several shipment orders shows only the first.
6. Transaction ratios are the vendor's party-level ratios, repeated per procurement.
7. `po` and `inv` are hard-coded `'—'`.
8. No pagination, no cache — the whole tenant is aggregated in memory per request.

---

## 9. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmSupplierProfileController`, ~280 lines) |
| Own tables | 0 |
| Tables read | 11 |
| Endpoints | 1 (GET, no parameters) |
| Output collections | 10 (5 party-wise + 5 transaction-wise) |
| Document families | 5 (`kyc`, `dd`, `tl`, `td`, `agr`) |
| Supplier buckets | 3 (material · logistic · services) |
| Permission slug | `clm.supplier_profile` |
| Downstream consumers | 3 (Analytics, Diagnosis & Resolution, RDF) |
| Test coverage | none automated |

---

*Related documents: SUPPLIER_PROFILE_FUNCTIONAL_DOCUMENTATION.md · SUPPLIER_PROFILE_CODE_WALKTHROUGH.md · SUPPLIER_PROFILE_API_DOCUMENTATION.md*
