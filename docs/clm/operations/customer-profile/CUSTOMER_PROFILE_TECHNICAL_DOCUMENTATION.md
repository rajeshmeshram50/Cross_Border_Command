# CUSTOMER PROFILE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · With Shipment ID → **Customer Profile**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
A **single read endpoint** (`ClmBuyerProfileController::index`, ~500 lines) that performs the module's largest aggregation. It owns no table of its own; it joins nine existing ones into six output collections.

It is also a **shared service**: `ClmDiagnosisResolutionController` and `ClmRegulatoryDefenseFileController` both method-inject this controller and call `index()` directly, so tenant scoping and the aggregation logic are inherited rather than duplicated.

### 1.2 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                               │
│  pages/clm/operations/ClmBuyerProfilePage.tsx                         │
│    6 tabs · progress bars · drill-down to the Evidence Vault          │
│  pages/clm/command-center/useClmAnalyticsData.ts  (re-uses this feed) │
└──────────────────────────────┬───────────────────────────────────────┘
                                │ GET /api/clm/buyer-profile
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmBuyerProfileController::index()                     │
│   1 segments        → segIdByName · segRegById                        │
│   2 segment rules   → rulesBySegType[segment_id][document_type]       │
│   3 uploads         → uploadsByOwner["Model#id"]["cat::code"]         │
│   4 agreements      → agrIdsBySeg · agrPartyById                      │
│     trade docs      → tdIdsBySeg  · tdPartyById                       │
│   5 completed sigs  → sigByParty · agrSigByLead · tdSigByLead          │
│   6 leads/PIs/ships → piByLead · leadSegIds · shipCodeByLead ·         │
│                       piSignedIds · shipByCustomer                    │
│   7 buyers  8 consignees  9 transactions → ws_eq/ws_neq/wos_eq/wos_neq│
│                                                                       │
│  Shared closures: segIdsFromNames · docTypeForCountry · unionFor ·    │
│    progressFor · agrIdsForSegments · tdIdsForSegments · agrProgress · │
│    partyFlags · docProgress · regFor                                  │
└──────────────────────────────┬───────────────────────────────────────┘
      ClmDiagnosisResolutionController ─┐   method-injected, call index()
      ClmRegulatoryDefenseFileController ┘   and reuse `data` verbatim
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DATA (read-only)                                                     │
│   clm_segments · clm_segment_rules · segment_doc_uploads ·            │
│   clm_agreement_library · clm_trade_doc_library ·                     │
│   clm_signature_requests · customers · consignees ·                   │
│   leads · proforma_invoices · proforma_invoice_items · products ·     │
│   shipment_orders                                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmBuyerProfileController.php     ← the whole module
app/Models/  ClmSegment · ClmSegmentRule · SegmentDocUpload ·
             ClmAgreementLibrary · ClmTradeDocLibrary · ClmSignatureRequest ·
             Customer · Consignee · Lead · ProformaInvoice ·
             ProformaInvoiceItem · Product · ShipmentOrder
resources/js/pages/clm/operations/ClmBuyerProfilePage.tsx
resources/js/pages/clm/command-center/useClmAnalyticsData.ts
```

There is **no migration** for this module — it creates no tables.

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
| `clm_segments` | name→id map, id→regulatory tier |
| `clm_segment_rules` | `doc_selections` keyed by `[segment_id][document_type]` |
| `segment_doc_uploads` | the "done" side of `kyc` / `dd` / `tl` / `td` |
| `clm_agreement_library` | applicable agreements per segment (Active only) + `party` CSV |
| `clm_trade_doc_library` | applicable trade documents per segment (active only) + `party` CSV |
| `clm_signature_requests` | completed `agreement`, `trade_doc` and `proforma_invoice` requests |
| `customers` / `consignees` | the party rosters, with `primaryAddress.country` |
| `leads` | the transaction rows |
| `proforma_invoices` + `_items` | latest non-cancelled PI per lead → product ids |
| `products` | `product.segment_id` |
| `shipment_orders` | `shipment_code` + the with/without-shipment split |

Constant: `private const CATS = ['kyc', 'dd', 'tl', 'td'];` — note **`qc` is not tracked** by the scorecards.

---

## 4. API ENDPOINT CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get('/clm/buyer-profile', [ClmBuyerProfileController::class, 'index']);
});
```
No query parameters. A user with no `client_id` receives the empty envelope:
```php
['buyers'=>[], 'consignees'=>[], 'ws_eq'=>[], 'ws_neq'=>[], 'wos_eq'=>[], 'wos_neq'=>[]]
```
Full response shape in **CUSTOMER_PROFILE_API_DOCUMENTATION.md**.

---

## 5. CONTROLLER ANALYSIS — the nine phases

### 1. Segment masters
`$segIdByName[lower(name)] = id` and `$segRegById[id] = 'highly'|'less'`.

### 2. Segment rules → required-doc union
```php
$rulesBySegType[(int)$r->segment_id][(string)$r->document_type] = $r->doc_selections;

// A segment can carry a Domestic AND an International rule, so key the doc_selections
// by document_type and let each buyer draw the set that matches its own trade type.
// Falls back to the segment's OTHER-type rule when the matching one is absent, so
// legacy single-type setups never lose docs.
$selForSeg = fn(int $sid, string $docType) =>
    $rulesBySegType[$sid][$docType] ?? ($rulesBySegType[$sid] ? reset($rulesBySegType[$sid]) : []);
```

### 3. Uploads grouped by owner
`$uploadsByOwner["App\Models\Customer#88"]["kyc::KYC-003"] = true` — one pass over `segment_doc_uploads`, so the per-party lookup is O(1).

### 4. Applicable agreements + trade documents per segment
Both use `csvHasToken()` against the library row's `segment` CSV, matched on the segment's **name or code**, with an exact tier equality check. `agrPartyById` / `tdPartyById` retain each row's `party` CSV for the per-side split.

### 5. Completed signature requests, three indexes
| Index | Keyed by | Purpose |
|---|---|---|
| `sigByParty["Customer#88"]` | party | the party-roster `agr` ratio |
| `agrSigByLead[leadId]['Customer'\|'Consignee']` | lead + side | the transaction `agr` ratio |
| `tdSigByLead[leadId]['Customer'\|'Consignee']` | lead + side | the transaction `td` ratio |

### 6. Leads, PIs, shipments — all batched
- Latest non-cancelled PI per lead (`orderBy('id')`, later id wins).
- `$piSignedIds` — PIs with a **completed** `proforma_invoice` signature. *"The PI is a shipment's first (buyer-side) Trade Document, so a signed PI counts as a signed trade doc — the same source of truth the Q/PI list and Evidence Vault use."*
- `$leadSegIds` — PI line items → `product_id` → `products.segment_id`.
- `$shipLeadIds` / `$shipCodeByLead` / `$shipByCustomer` from `shipment_orders`; the **real** `shipment_code` is used so the txn tables show the same id as the Evidence Vault.

### 7–9. Rows
Buyers (`Customer::forUser($user)` with a filtered `consignees_count` and `primaryAddress`), consignees, then the four transaction buckets.

### The shared closures
| Closure | Does |
|---|---|
| `segIdsFromNames($csv)` | party segment CSV → segment ids |
| `docTypeForCountry($country)` | `India` ⇒ `domestic`, else `international` |
| `unionFor($segIds, $docType)` | union of required codes across segments, per category |
| `progressFor($union, $ownerKey)` | `['kyc'=>['d'=>n,'t'=>m], …]` from the uploads map |
| `agrIdsForSegments` / `tdIdsForSegments` | applicable library ids for a segment set |
| `agrProgress($ids, $signedSet)` | `d/t` from a completed-signature set |
| `partyFlags($partyCsv)` | `[forBuyer, forConsignee]`; **blank ⇒ both** |
| `docProgress($ids, $partyById, $signedForSide, $side)` | per-side `d/t`, mirroring the vault ratios |
| `regFor($segIds)` | `High` \| `Low` \| `Both` |

---

## 6. FRONTEND

`ClmBuyerProfilePage.tsx` renders the six collections as tabs with progress bars, using the shared operations theme (`useOpsTheme`). Rows drill into the party's Evidence Vault via `/segment-uploads/{type}/{id}/vault`.

`useClmAnalyticsData.ts` fetches this endpoint in parallel with `/clm/supplier-profile` and reshapes both for the Analytics dashboards — it documents the `ws_*` vs `wos_*` split as *"the real With- vs Without-Shipment split"*.

---

## 7. INTEGRATIONS

| Consumer | How |
|---|---|
| **CLM Analytics** | `useClmAnalyticsData` fetches this + supplier-profile in parallel |
| **Diagnosis & Resolution** | Method-injects this controller and calls `index()`, using the result as its `buyer` block |
| **Regulatory Defense File** | Method-injects it too; `withShipment()` expands `ws_eq + ws_neq` with procurements and suppliers |
| **Evidence Vault** | The drill-down target; shares `partyFlags` semantics and the same "done" definitions |
| **Sales Matrix** | Supplies the leads, PIs and shipment orders this screen reports on |

---

## 8. SECURITY & CAVEATS

1. `client_id` is derived from `auth()->user()`; the customer roster additionally goes through `Customer::forUser($user)`.
2. **Most sub-queries are `where('client_id', $cid)` rather than branch-scoped** — the aggregation is client-wide by design, while the customer roster itself honours the per-user scope.
3. Because the two injected consumers call `index()` directly, any scoping change here propagates to Diagnosis & Resolution and the Regulatory Defense File automatically.
4. There is **no pagination and no cache** — the whole tenant is loaded and aggregated in memory on every request. This is the heaviest read in CLM.
5. Party ↔ segment matching is by **name**; a stale name silently contributes zero required documents rather than erroring.
6. `qc` is deliberately absent from `CATS` — Quality & Compliance documents are not one of the five scorecard families.
7. Transaction segments come from the **latest non-cancelled PI only**; quotation-stage leads report no segments (unlike `applicableForLead`, which falls back to the quotation).

---

## 9. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmBuyerProfileController`, ~500 lines) |
| Own tables | 0 |
| Tables read | 13 |
| Endpoints | 1 (GET, no parameters) |
| Output collections | 6 |
| Document families | 5 (`kyc`, `dd`, `tl`, `td`, `agr`) |
| Permission slug | `clm.buyer_profile` |
| Downstream consumers | 3 (Analytics, Diagnosis & Resolution, RDF) |
| Test coverage | none automated |

---

*Related documents: CUSTOMER_PROFILE_FUNCTIONAL_DOCUMENTATION.md · CUSTOMER_PROFILE_CODE_WALKTHROUGH.md · CUSTOMER_PROFILE_API_DOCUMENTATION.md*
