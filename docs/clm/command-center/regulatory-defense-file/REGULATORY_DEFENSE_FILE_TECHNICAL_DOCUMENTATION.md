# REGULATORY DEFENSE FILE (RDF) — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → CLM Command Center → **Regulatory Defense File**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
`ClmRegulatoryDefenseFileController` — ~275 lines, **one endpoint, no table**. Like the Diagnosis Center it composes the two profile controllers by **method injection**, but where Diagnosis re-emits their payloads verbatim, the RDF **reshapes** them into evidence-oriented rows.

The controller's docblock:

> *"Read-only repository view. Composes the three tabs from the already-scoped Buyer / Supplier profile aggregations (so compliance progress + tenant isolation are inherited) plus the Case-to-Case contracts:*
> - *`with_shipment` — shipment-linked records (buyer ⨝ supplier by SHP code)*
> - *`without_shipment` — procurement-wise supplier records + compliance*
> - *`case_to_case` — per-deal agreement records mapped to counterparties*
>
> *The per-record Evidence Vault is served by the existing `/segment-uploads/{type}/{id}/vault` endpoint — this controller only builds the three index lists."*

### 1.2 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                               │
│  pages/clm/command-center/ClmRegulatoryDefenseFilePage.tsx            │
│    3 tabs · evidence drawer driven by each row's `vault[]`            │
└──────────────────────────────┬───────────────────────────────────────┘
        GET /api/clm/regulatory-defense
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmRegulatoryDefenseFileController                     │
│                                                                       │
│   index(Request, ClmBuyerProfileController $buyer,                    │
│                  ClmSupplierProfileController $supplier)              │
│        ├── withShipment($buyer, $cid)                                 │
│        │     ws_eq + ws_neq → leadIds                                 │
│        │       → Procurement  (lead → proc ids)                       │
│        │         → ProcurementProduct (proc → product ids)            │
│        │           → VendorProductMapping (product → vendor ids)      │
│        │             → Vendor (id → name, code)                       │
│        │     ⇒ procs[] + vault[] (Buyer · Consignee · each Supplier)  │
│        │                                                              │
│        ├── withoutShipment($supplier)                                 │
│        │     txn_wos_mat + txn_wos_logi + txn_wos_svc                 │
│        │     ⇒ rows carrying the five {d,t} fractions + vault[]       │
│        │                                                              │
│        └── caseToCase($cid)                                           │
│              ctc_contracts → EVERY counterparty →                     │
│              resolveVaultTarget() ⇒ vault[] tabs                      │
└──────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DATA                                                                 │
│   direct:      procurements · procurement_products ·                  │
│                vendor_product_mappings · vendors · ctc_contracts ·    │
│                customers · consignees   (code → id resolution)        │
│   transitive:  everything the two profile controllers read (~20)      │
│  DRILL-DOWN:  GET /segment-uploads/{type}/{id}/vault  (not owned here)│
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmRegulatoryDefenseFileController.php   ← the whole module
app/Http/Controllers/Api/ClmBuyerProfileController.php            (injected)
app/Http/Controllers/Api/ClmSupplierProfileController.php         (injected)
app/Http/Controllers/Api/SegmentDocUploadController.php           (the drill-down)
app/Models/  CtcContract · Procurement · ProcurementProduct ·
             Vendor · VendorProductMapping · Customer · Consignee
resources/js/pages/clm/command-center/ClmRegulatoryDefenseFilePage.tsx
```
**No migration** — the module creates no tables.

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| Composition | Laravel **method injection** over the two profile controllers |
| PHP features | `match (true)` expression for the vault-target mapping |
| Frontend | React 19 · TS · shared CLM command-center shell |

---

## 3. DATA MODEL

| Source | Read how |
|---|---|
| **Buyer aggregation** | `ClmBuyerProfileController::index()` — its `ws_eq` + `ws_neq` rows are the with-shipment seed |
| **Supplier aggregation** | `ClmSupplierProfileController::index()` — its three `txn_wos_*` collections are the without-shipment tab |
| `procurements` | lead → procurement ids |
| `procurement_products` | procurement → product ids |
| `vendor_product_mappings` | product → vendor ids |
| `vendors` | vendor id → `company_name`, `vendor_code` |
| `ctc_contracts` | four columns: `id`, `code`, `title`, `counterparties` |
| `customers` / `consignees` / `vendors` | code → id resolution in `resolveVaultTarget()` |

### The `vault` array — the module's distinctive output
Every row carries a list of Evidence-Vault drill-down targets:
```json
{ "key": "supplier-77", "label": "Supplier · Agro Mills Pvt Ltd",
  "type": "supplier", "id": 77 }
```
| Field | Purpose |
|---|---|
| `key` | Stable tab key; `buyer`, `consignee`, `supplier-{id}` or `{type}#{id}` on CTC rows |
| `label` | The tab caption |
| `type` | `customer` \| `consignee` \| `supplier` — the `{type}` path segment |
| `id` | The numeric party id — the `{id}` path segment |

The drawer then calls `GET /segment-uploads/{type}/{id}/vault` per tab.

---

## 4. API ENDPOINT CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get('/clm/regulatory-defense', [ClmRegulatoryDefenseFileController::class, 'index']);
});
```
No query parameters. Full response shape in **REGULATORY_DEFENSE_FILE_API_DOCUMENTATION.md**.

---

## 5. CONTROLLER ANALYSIS

### `index()` — composition
```php
public function index(Request $request,
                      ClmBuyerProfileController $buyer,
                      ClmSupplierProfileController $supplier): JsonResponse
{
    $user = $request->user(); if (!$user) abort(401);
    $b = $buyer->index($request)->getData(true)['data'] ?? [];
    $s = $supplier->index($request)->getData(true)['data'] ?? [];

    return response()->json(['status'=>true, 'data'=>[
        'with_shipment'    => $this->withShipment($b, (int) ($user->client_id ?? 0)),
        'without_shipment' => $this->withoutShipment($s),
        'case_to_case'     => $this->caseToCase((int) ($user->client_id ?? 0)),
    ]]);
}
```
Same in-process injection as the Diagnosis Center — tenant isolation and the compliance maths are inherited, not re-implemented.

### `withShipment(array $buyer, int $cid)` — the supply-chain expansion
> *"Each buyer shipment row (`ws_eq` + `ws_neq`) is expanded with EVERY procurement raised under its lead, and each procurement with EVERY supplier (vendor) that supplies a product in it. A single opportunity therefore shows all its procurement ids + suppliers stacked in one row, instead of being collapsed to a single supplier."*

Four batched lookups build the chain, each guarded so an empty predecessor short-circuits it:

| Map | Built from |
|---|---|
| `procByLead[lead][]` | `Procurement` where `lead_id` in the shipment rows' `leadId`s |
| `productsByProc[proc][]` | `ProcurementProduct` where `procurement_id` in those procurements |
| `vendorsByProduct[product][]` | `VendorProductMapping` where `product_id` in those products |
| `vendorById` | `Vendor::whereIn('id', …)->keyBy('id')` |

Then `suppliersForProc($procId)` walks products → vendors, **de-duplicating by vendor id**, and each row accumulates a second de-dup set (`$vendorSeen`) so a vendor supplying two products across two procurements appears once in `vault`.

### `withoutShipment(array $supplier)`
Flattens the supplier profile's `txn_wos_mat`, `txn_wos_logi` and `txn_wos_svc` in that order, carrying each row's five `{d, t}` fractions through unchanged and adding a single supplier vault target. `po` and `inv` (surfaced as `vti`) are passed through as `'—'`.

### `caseToCase(int $clientId)`
Selects four columns from `ctc_contracts` and, for **every** counterparty, resolves an Evidence-Vault target:

> *"Every counterparty becomes an Evidence-Vault party tab so the drawer can show each side's Company DD / KYC / Trade Licenses / Trade Documents. Deduped by resolved (type,id)."*
>
> *"Label the tab by the counterparty name (falls back to role) so a deal with two buyers reads clearly."*

### `resolveVaultTarget(string $sourceType, $sourceId, int $clientId)`
```php
[$type, $label, $model, $codeCol] = match (true) {
    str_contains($t,'buy') || $t === 'customer' => ['customer','Buyer',    Customer::class,  'customer_code'],
    str_contains($t,'consign')                   => ['consignee','Consignee',Consignee::class,'consignee_code'],
    str_contains($t,'supp') || $t === 'vendor'   => ['supplier','Supplier', Vendor::class,    'vendor_code'],
    default                                       => [null,null,null,null],   // not vault-backed
};
$id = is_numeric($sourceId) ? (int)$sourceId
                            : $model::where('client_id',$clientId)->where($codeCol,$sourceId)->value('id');
return $id ? ['key'=>$type,'label'=>$label,'type'=>$type,'id'=>$id] : null;
```
Numeric primary key **or** party code, both accepted; the code lookup is `client_id`-scoped. Unresolvable references return `null` and are silently skipped.

Note this mapping **does** distinguish consignees — unlike `normaliseRole()` on the same controller, which is only used for the display badge and collapses a consignee to `Partner`.

---

## 6. FRONTEND

`ClmRegulatoryDefenseFilePage.tsx` renders the three tabs and drives the evidence drawer from each row's `vault[]`, calling `/segment-uploads/{type}/{id}/vault` per tab. The page performs no party resolution of its own — the controller has already done it.

---

## 7. INTEGRATIONS

| Integration | How |
|---|---|
| **Customer Profile** | Method-injected; `ws_eq` + `ws_neq` seed the with-shipment tab |
| **Supplier Profile** | Method-injected; `txn_wos_*` become the without-shipment tab |
| **Case-to-Case** | Direct `ctc_contracts` read; every counterparty becomes a vault tab |
| **Evidence Vault** | The drill-down target — `SegmentDocUploadController::vault()` |
| **P2P / Procurement** | The lead → procurement → product → vendor chain |
| **Diagnosis & Resolution** | Uses the identical injection pattern over the same two controllers |

---

## 8. SECURITY & CAVEATS

1. Tenant isolation is **inherited** from the injected controllers; the direct queries add `client_id` where the model carries it.
2. `Procurement` and `ctc_contracts` reads are `client_id`-scoped; `ProcurementProduct`, `VendorProductMapping` and `Vendor` are reached **through ids already derived from scoped queries**, not scoped again themselves.
3. `resolveVaultTarget()` scopes its code lookup by `client_id`, so a party code cannot resolve across tenants.
4. **RDF reference codes are generated per response** and are not persisted — do not treat them as stable identifiers.
5. `PROC-NNN` is synthesised from the procurement primary key, not a stored code.
6. `po` / `vti` are hard-coded `'—'`.
7. The with-shipment tab carries **no compliance fractions** — only the without-shipment tab does.
8. Unresolvable counterparties are dropped silently, so a CTC row can show fewer vault tabs than it has counterparties.
9. This endpoint pays the cost of **both** profile aggregations — the two heaviest reads in CLM — with no filters, pagination or cache.

---

## 9. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmRegulatoryDefenseFileController`, ~275 lines) |
| Own tables | 0 |
| Tables queried directly | 7 |
| Tables read transitively | ~20, via the two injected controllers |
| Endpoints | 1 (GET, no parameters) |
| Output tabs | 3 (`with_shipment`, `without_shipment`, `case_to_case`) |
| Vault target types | 3 (`customer`, `consignee`, `supplier`) |
| Reference prefixes | `RDF-NNN` · `RDF-C-NNN` |
| Permission slug | `clm.regulatory_defense` |
| Test coverage | none automated |

---

*Related documents: REGULATORY_DEFENSE_FILE_FUNCTIONAL_DOCUMENTATION.md · REGULATORY_DEFENSE_FILE_CODE_WALKTHROUGH.md · REGULATORY_DEFENSE_FILE_API_DOCUMENTATION.md*
