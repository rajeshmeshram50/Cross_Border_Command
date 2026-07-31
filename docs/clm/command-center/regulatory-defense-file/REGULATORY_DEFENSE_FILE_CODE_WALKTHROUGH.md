# REGULATORY DEFENSE FILE (RDF) — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → CLM Command Center → **Regulatory Defense File**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: the composed read → the with-shipment supply-chain expansion → the without-shipment flattening → the case-to-case vault resolution.
File: [ClmRegulatoryDefenseFileController.php](../../../../app/Http/Controllers/Api/ClmRegulatoryDefenseFileController.php).

---

## 1. THE DESIGN (class docblock)

```php
/**
 * CLM Command Center → Regulatory Defense File (RDF).
 *
 * Read-only repository view. Composes the three tabs from the already-scoped
 * Buyer / Supplier profile aggregations (so compliance progress + tenant
 * isolation are inherited) plus the Case-to-Case contracts:
 *
 *   with_shipment    — shipment-linked records (buyer ⨝ supplier by SHP code)
 *   without_shipment — procurement-wise supplier records + compliance
 *   case_to_case     — per-deal agreement records mapped to counterparties
 *
 * The per-record Evidence Vault is served by the existing
 * /segment-uploads/{type}/{id}/vault endpoint — this controller only builds
 * the three index lists.
 */
```

---

## 2. THE COMPOSED READ (`index`)

```php
public function index(
    Request $request,
    ClmBuyerProfileController $buyer,          // ← method injection
    ClmSupplierProfileController $supplier
): JsonResponse {
    $user = $request->user(); if (!$user) abort(401);

    $b = $buyer->index($request)->getData(true)['data'] ?? [];
    $s = $supplier->index($request)->getData(true)['data'] ?? [];
    //  in-process calls — same $request, same user, same scoping

    return response()->json(['status'=>true, 'data'=>[
        'with_shipment'    => $this->withShipment($b, (int)($user->client_id ?? 0)),
        'without_shipment' => $this->withoutShipment($s),
        'case_to_case'     => $this->caseToCase((int)($user->client_id ?? 0)),
    ]]);
}
```

Same technique as the Diagnosis Center — but where Diagnosis re-emits `$b` and `$s` verbatim, the RDF **reshapes** them.

---

## 3. WITH SHIPMENT — the supply-chain expansion (`withShipment`)

```php
/**
 * Shipment-linked RDF rows. Each buyer shipment row (ws_eq + ws_neq) is
 * expanded with EVERY procurement raised under its lead, and each procurement
 * with EVERY supplier (vendor) that supplies a product in it. A single
 * opportunity therefore shows all its procurement ids + suppliers stacked in
 * one row, instead of being collapsed to a single supplier.
 */
$wsRows  = array_merge($buyer['ws_eq'] ?? [], $buyer['ws_neq'] ?? []);
$leadIds = unique, non-zero  map($wsRows, fn($r) => (int)($r['leadId'] ?? 0));
//                                                        ^^^^^^^^^^ this is why the
//         buyer profile emits `leadId` on every transaction row
```

### The four batched maps
Each is guarded so an empty predecessor short-circuits the next query:

```php
// (1) lead → [procurement ids]
foreach (Procurement::where('client_id',$cid)->whereIn('lead_id',$leadIds)
           ->orderBy('id')->get(['id','lead_id']) as $p) {
    $procByLead[(int)$p->lead_id][] = (int)$p->id;
    $procIds[] = (int)$p->id;
}

// (2) procurement → [product ids]
foreach (ProcurementProduct::whereIn('procurement_id',$procIds)
           ->whereNotNull('product_id')->get(['procurement_id','product_id']) as $pp) {
    $productsByProc[(int)$pp->procurement_id][] = (int)$pp->product_id;
    $productIds[] = (int)$pp->product_id;
}

// (3) product → [vendor ids]
foreach (VendorProductMapping::whereIn('product_id', array_unique($productIds))
           ->get(['vendor_id','product_id']) as $m) {
    $vendorsByProduct[(int)$m->product_id][] = (int)$m->vendor_id;
    $vendorIds[] = (int)$m->vendor_id;
}

// (4) vendor id → {name, code}
$vendorById = Vendor::whereIn('id', array_unique($vendorIds))
                ->get(['id','company_name','vendor_code'])->keyBy('id');
```

Four queries total regardless of how many shipments are in the tenant — the chain is walked in memory afterwards.

### Suppliers per procurement, de-duplicated
```php
/** Suppliers for a procurement (deduped by vendor id). */
$suppliersForProc = function (int $procId) use (…): array {
    $seen = []; $out = [];
    foreach ($productsByProc[$procId] ?? [] as $pid)
        foreach ($vendorsByProduct[$pid] ?? [] as $vid) {
            if (isset($seen[$vid])) continue;          // ← same vendor, two products
            if (!($v = $vendorById->get($vid))) continue;
            $seen[$vid] = true;
            $out[] = ['id'=>(int)$v->id, 'name'=>$v->company_name,
                      'code'=>$v->vendor_code ?: 'S-'.str_pad($v->id,3,'0',STR_PAD_LEFT)];
        }
    return $out;
};
```

### Building the row + its vault
```php
foreach ($wsRows as $r) {
    $sr++;  $lead = (int)($r['leadId'] ?? 0);
    $procs = [];  $vendorSeen = [];  $vault = [];

    // the two buyer-side parties first
    if (!empty($r['custId'])) $vault[] = ['key'=>'buyer',     'label'=>'Buyer',
                                          'type'=>'customer',  'id'=>(int)$r['custId']];
    if (!empty($r['consId'])) $vault[] = ['key'=>'consignee', 'label'=>'Consignee',
                                          'type'=>'consignee', 'id'=>(int)$r['consId']];

    foreach ($procByLead[$lead] ?? [] as $procId) {
        $sups = $suppliersForProc($procId);
        $procs[] = ['proc'      => 'PROC-'.str_pad($procId,3,'0',STR_PAD_LEFT),  // SYNTHESISED
                    'suppliers' => $sups,
                    'po'        => '—'];                                          // not wired

        foreach ($sups as $s) {
            if (isset($vendorSeen[$s['id']])) continue;   // ← second dedupe: ACROSS procurements
            $vendorSeen[$s['id']] = true;
            $vault[] = ['key'   => 'supplier-'.$s['id'],
                        // one supplier ⇒ plain "Supplier"; two or more ⇒ named tabs
                        'label' => count($vendorSeen) > 1 ? 'Supplier · '.$s['name'] : 'Supplier',
                        'type'  => 'supplier', 'id' => $s['id']];
        }
    }

    $rows[] = [
        'rdf'       => 'RDF-'.str_pad($sr,3,'0',STR_PAD_LEFT),   // per-RESPONSE sequence
        'ship'      => $r['shp'] ?? '—',
        'opp'       => $r['opp'] ?? '—',
        'customer'  => $r['customer'] ?? '—',
        'consignee' => $r['consignee'] ?? ($r['customer'] ?? '—'),   // falls back to the customer
        'pi'        => $r['pi'] ?? '—',
        'procs'     => $procs,
        'vault'     => $vault,
    ];
}
```

**Two de-dup layers** matter here: `$seen` inside `suppliersForProc()` (same vendor, two products in one procurement) and `$vendorSeen` across the whole row (same vendor, two procurements). Without the second, the drawer would show duplicate supplier tabs.

**Note what this tab does *not* carry:** the five `{d, t}` compliance fractions. Shipment rows list parties and procurements; the fractions live on the without-shipment tab.

---

## 4. WITHOUT SHIPMENT — flattening (`withoutShipment`)

```php
/**
 * Procurement-wise RDF rows from the supplier "without shipment" transaction
 * tables, carrying the per-supplier compliance fractions.
 */
foreach (['txn_wos_mat', 'txn_wos_logi', 'txn_wos_svc'] as $key) {   // in this order
    foreach ($supplier[$key] ?? [] as $r) {
        $sr++;
        $supDbId = (int)($r['supDbId'] ?? 0);
        $rows[] = [
            'rdf'      => 'RDF-'.str_pad($sr,3,'0',STR_PAD_LEFT),  // its OWN sequence, from 001
            'proc'     => $r['procId']   ?? '—',
            'supplier' => $r['supplier'] ?? '—',
            'po'       => $r['po']  ?? '—',      // always '—' from the supplier profile
            'vti'      => $r['inv'] ?? '—',      // ← `inv` renamed to `vti` here
            'kyc'      => $r['kyc'] ?? ['d'=>0,'t'=>0],
            'dd'       => $r['dd']  ?? ['d'=>0,'t'=>0],
            'tl'       => $r['tl']  ?? ['d'=>0,'t'=>0],
            'td'       => $r['td']  ?? ['d'=>0,'t'=>0],
            'agr'      => $r['agr'] ?? ['d'=>0,'t'=>0],
            'vault'    => $supDbId ? [['key'=>'supplier','label'=>'Supplier',
                                       'type'=>'supplier','id'=>$supDbId]] : [],
        ];
    }
}
```

A straight pass-through of the supplier profile's fractions plus one vault target. Two renames to be aware of: `inv` → **`vti`**, and each row gets its own `RDF-NNN` counter restarting at 001 (so `RDF-001` exists on **both** the with- and without-shipment tabs).

---

## 5. CASE TO CASE — every counterparty becomes a tab (`caseToCase`)

```php
/** Per-deal agreement RDF rows mapped to their primary counterparty. */
return CtcContract::where('client_id',$clientId)->orderByDesc('id')
    ->get(['id','code','title','counterparties'])          // FOUR columns only
    ->map(function (CtcContract $c) use (&$sr, $clientId) {
        $sr++;
        $cps   = is_array($c->counterparties) ? $c->counterparties : [];
        $first = $cps[0] ?? [];

        /* Every counterparty becomes an Evidence-Vault party tab so the drawer can show
         * each side's Company DD / KYC / Trade Licenses / Trade Documents.
         * Deduped by resolved (type,id). */
        $vault = []; $seen = [];
        foreach ($cps as $cp) {
            $t = $this->resolveVaultTarget((string)($cp['source_type'] ?? ''),
                                           $cp['source_id'] ?? null, $clientId);
            if (!$t) continue;                              // ← silently skipped
            $dedupe = $t['type'].'#'.$t['id'];
            if (isset($seen[$dedupe])) continue;
            $seen[$dedupe] = true;
            /* Label the tab by the counterparty NAME (falls back to role) so a deal
             * with two buyers reads clearly. */
            $name = trim((string)($cp['name'] ?? ''));
            $t['label'] = $name !== '' ? $name : $t['label'];
            $t['key']   = $dedupe;
            $vault[] = $t;
        }

        return [
            'rdf'          => 'RDF-C-'.str_pad($sr,3,'0',STR_PAD_LEFT),   // distinct C- prefix
            'ctc'          => $c->code,
            'title'        => $c->title ?: '—',
            'counterparty' => $first['name'] ?? '—',                       // FIRST only
            'role'         => $this->normaliseRole($first['badge'] ?? $first['source_type'] ?? ''),
            'vault'        => $vault,                                       // ALL of them
        ];
    })->all();
```

Note the asymmetry: the `counterparty` **column** shows only the first party, while the `vault` **array** carries every resolvable one.

---

## 6. RESOLVING A VAULT TARGET (`resolveVaultTarget`)

```php
/**
 * Map a CTC counterparty reference to an Evidence-Vault target {key,label,type,id}.
 * source_id may be a numeric PK or a party code ("C-009" / vendor_code /
 * consignee_code); returns null when the party type isn't vault-backed or the
 * reference can't be resolved.
 */
if ($sourceId === null || $sourceId === '') return null;
$t = mb_strtolower(trim($sourceType));

[$type, $label, $model, $codeCol] = match (true) {
    str_contains($t,'buy') || $t === 'customer' => ['customer', 'Buyer',    Customer::class,  'customer_code'],
    str_contains($t,'consign')                   => ['consignee','Consignee',Consignee::class,'consignee_code'],
    str_contains($t,'supp') || $t === 'vendor'   => ['supplier', 'Supplier', Vendor::class,    'vendor_code'],
    default                                       => [null, null, null, null],   // NOT vault-backed
};
if (!$type) return null;

$id = is_numeric($sourceId)
    ? (int) $sourceId
    : $model::where('client_id',$clientId)->where($codeCol,(string)$sourceId)->value('id');
    //      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ the code lookup IS tenant-scoped

return $id ? ['key'=>$type, 'label'=>$label, 'type'=>$type, 'id'=>$id] : null;
```

### Two role mappings on one controller
```php
// resolveVaultTarget()  — DISTINGUISHES consignees
customer | consignee | supplier

// normaliseRole()       — collapses them (display badge only)
private function normaliseRole(string $raw): string {
    if (str_contains($r,'buy')  || $r === 'customer') return 'Buyer';
    if (str_contains($r,'supp') || $r === 'vendor')   return 'Supplier';
    return 'Partner';                                  // ← a consignee lands here
}
```
So a CTC row can show `role: "Partner"` in its column while its vault correctly opens a **Consignee** tab. The badge is cosmetic; the vault target is functional.

---

## 7. THE VAULT ARRAY IN USE

```
row.vault = [
  { key: "buyer",        label: "Buyer",                       type: "customer",  id: 88 },
  { key: "consignee",    label: "Consignee",                   type: "consignee", id: 51 },
  { key: "supplier-77",  label: "Supplier · Agro Mills Pvt Ltd", type: "supplier", id: 77 },
  { key: "supplier-92",  label: "Supplier · Nova Logistics",     type: "supplier", id: 92 }
]
        │
        ▼  the drawer opens one tab per entry
GET /segment-uploads/customer/88/vault
GET /segment-uploads/consignee/51/vault
GET /segment-uploads/vendor/77/vault
GET /segment-uploads/vendor/92/vault
```
The controller has already done all party resolution, so the page performs none of its own.

---

## 8. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Method injection + in-process call | `index` | Inherit scoping and the compliance maths |
| Four batched maps, guarded | `withShipment` | Constant query count regardless of tenant size |
| Two de-dup layers for suppliers | `withShipment` | Same vendor across products **and** across procurements |
| Conditional tab labelling | `withShipment` | "Supplier" alone, named when there are several |
| `leadId` passed through from the buyer profile | `withShipment` | The join key for the whole expansion |
| Pass-through of `{d,t}` fractions | `withoutShipment` | One source of truth for compliance |
| `match (true)` type mapping | `resolveVaultTarget` | Readable multi-condition dispatch |
| PK **or** code resolution, tenant-scoped | `resolveVaultTarget` | Counterparties store either form |
| Null-and-skip on unresolvable | `caseToCase` | A missing party must not break the row |
| Two role mappings, different jobs | badge vs vault | Cosmetic label vs functional target |

---

## 9. NOTES & CAVEATS

- **The with-shipment tab carries no compliance fractions** — only `without_shipment` does.
- `RDF-NNN` codes are generated **per response**, restart at 001 on each tab, and are not persisted.
- `PROC-NNN` is synthesised from the procurement primary key, not a stored code.
- `po` and `vti` are always `'—'`.
- `inv` from the supplier profile is renamed to `vti` here.
- Unresolvable counterparties are dropped silently, so a CTC row can show fewer vault tabs than it has counterparties.
- Consignees are badged **Partner** in the `role` column, though the vault correctly opens a Consignee tab.
- `ProcurementProduct`, `VendorProductMapping` and `Vendor` are reached through ids already derived from `client_id`-scoped queries rather than being scoped again themselves.
- This endpoint carries the cost of **both** profile aggregations, with no filters, pagination or cache.
- DB is PostgreSQL.

---

*Related documents: REGULATORY_DEFENSE_FILE_FUNCTIONAL_DOCUMENTATION.md · REGULATORY_DEFENSE_FILE_TECHNICAL_DOCUMENTATION.md · REGULATORY_DEFENSE_FILE_API_DOCUMENTATION.md*
