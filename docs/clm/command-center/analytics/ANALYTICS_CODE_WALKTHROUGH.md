# CLM ANALYTICS — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → CLM Command Center → **CLM Analytics**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
This module is **frontend-only** — there is no controller to trace. The walkthrough follows the page's load: mount → parallel fetch → reshape → render, and then documents the mock dataset that still ships alongside it.

Files:
- [ClmAnalyticsPage.tsx](../../../../resources/js/pages/clm/command-center/ClmAnalyticsPage.tsx)
- [useClmAnalyticsData.ts](../../../../resources/js/pages/clm/command-center/useClmAnalyticsData.ts)
- [clmAnalyticsData.ts](../../../../resources/js/pages/clm/command-center/clmAnalyticsData.ts)

---

## 1. THE DESIGN DECISION (from the hook's header)

```ts
/* ─────────────────────────────────────────────────────────────────────────
 * Data-fetching layer for the CLM Analytics page.
 *
 * The real compliance data is already computed server-side by two existing
 * endpoints (no new backend needed) — this hook just fetches both in parallel,
 * tenant-scoped automatically (the Axios client injects the Bearer token and
 * the active branch_id on every GET):
 *
 *   GET /clm/buyer-profile     → { buyers, consignees, ws_eq, ws_neq, wos_eq, wos_neq }
 *   GET /clm/supplier-profile  → { ws_mat, ws_logi, wos_svc, wos_mat, wos_logi,
 *                                  txn_ws_mat, txn_ws_logi, txn_wos_svc,
 *                                  txn_wos_mat, txn_wos_logi }
 *
 * `ws_*` rows carry a `shp` code ("SHP-<leadId>") only when the opportunity
 * completed the Victory stage and a shipment order exists; otherwise the row
 * lands in `wos_*`. That's the real With- vs Without-Shipment split.
 * ───────────────────────────────────────────────────────────────────────── */
```

Two consequences worth internalising:
1. **No backend was added.** Every scoping and authorisation decision belongs to `ClmBuyerProfileController` and `ClmSupplierProfileController`.
2. **The With/Without-Shipment split is not applied here.** The dashboard reads collections that are already classified server-side.

---

## 2. THE LIVE PATH (`useClmAnalyticsData.ts`)

```ts
import { useEffect, useState } from 'react';
import api from '../../../api';
import type { CtcContract } from '../operations/clmOpsData';

export function useClmAnalyticsData() {
  const [state, setState] = useState(/* … */);

  useEffect(() => {
    Promise.all([
      api.get('/clm/buyer-profile'),      // ← Bearer + ?branch_id injected by the interceptor
      api.get('/clm/supplier-profile'),
    ]).then(([buyer, supplier]) => {
      // buyer.data.data    → { buyers, consignees, ws_eq, ws_neq, wos_eq, wos_neq }
      // supplier.data.data → { ws_mat, ws_logi, wos_svc, wos_mat, wos_logi,
      //                        txn_ws_mat, txn_ws_logi, txn_wos_svc,
      //                        txn_wos_mat, txn_wos_logi }
      setState(reshape(buyer, supplier));
    });
  }, []);

  return state;
}
```

`Promise.all` matters: the two feeds are the heaviest reads in CLM, so they run concurrently rather than in sequence. The page renders once both resolve.

Neither call passes query parameters — **neither endpoint accepts any**.

---

## 3. THE TYPE CONTRACT

The hook declares exactly what it expects back, which doubles as the module's schema documentation.

```ts
export type ApiProg = { d: number; t: number };

/** A transaction (opportunity) row from the buyer-profile endpoint. */
export type ApiTxnRow = {
  sr: number;
  opp: string;
  customer: string;
  pi?: string;
  reg?: string;
  shp?: string;          // present only when a shipment exists   ← the ws/wos marker
  consignee?: string;    // present only when consignee ≠ customer ← the eq/neq marker
  kyc: ApiProg; dd: ApiProg; tl: ApiProg; td: ApiProg; agr: ApiProg;
};

/** A party (buyer / consignee) roster row. */
export type ApiParty = {
  sr: number;
  id: string;            // customer_code / consignee_code (e.g. "C-001")
  cid?: string;          // parent customer_code (consignees only)
  db_id: number;
  name: string;
  seg: unknown;
  country: string;
  cn?: number;           // consignees count (buyers only)
  kyc: ApiProg; dd: ApiProg; tl: ApiProg; td: ApiProg; agr: ApiProg;
  ship: number;
};

/** A supplier transaction row from the supplier-profile endpoint.
 *  Note: supplier txns are procurement-level — they carry no opportunity id. */
export type ApiSupTxn = {
  sr: number;
  shpId?: string;        // "SHP-xxx" — present for with-shipment txns
  procId?: string;       // "PROC-xxx"
  supplier: string;      // supplier company name
  supId: string;         // vendor_code ("V-xx")
  reg?: string; po?: string; inv?: string;
  kyc: ApiProg; dd: ApiProg; tl: ApiProg; td: ApiProg; agr: ApiProg;
};
```

The optional markers are how the dashboard classifies without re-deriving anything:

| Field | Present ⇒ | Absent ⇒ |
|---|---|---|
| `shp` / `shpId` | With Shipment | Without Shipment |
| `consignee` | Buyer ≠ Consignee (`*_neq`) | Buyer == Consignee (`*_eq`) |
| `procId` (supplier) | procurement-level row | — |

Note also what `ApiSupTxn` does **not** have: an `opp` field. Supplier transactions are keyed by procurement, so buy-side and sell-side transaction rows cannot be joined.

---

## 4. THE MOCK PATH (`clmAnalyticsData.ts`)

```ts
/* ─────────────────────────────────────────────────────────────────────────
 * CLM Analytics — mock dataset (faithful port of the `rAnalytics()` view from
 * the CLM_(28) prototype). There is no `/clm/analytics` API yet, so the page
 * renders from this embedded dataset exactly as the prototype did.
 *
 * Doc-completion totals are fixed across With-Shipment rows
 * (KYC 4, DD 3, TL 3, TD 4, AGR 2); only the "done" counts vary. Without-
 * Shipment rows match the same totals except some have no agreement
 * obligation (AGR 0/0), so that total is supplied per row.
 * ───────────────────────────────────────────────────────────────────────── */

export type DocProg = { d: number; t: number };
export type DocKey  = 'kyc' | 'dd' | 'tl' | 'td' | 'agr';
export const DOC_KEYS: DocKey[] = ['kyc', 'dd', 'tl', 'td', 'agr'];

export type WsRow  = { shp: string; opp: string; customer: string;
                       kyc: DocProg; dd: DocProg; tl: DocProg; td: DocProg; agr: DocProg };
export type WosRow = { kyc: DocProg; dd: DocProg; tl: DocProg; td: DocProg; agr: DocProg };

// totals hard-coded in the row builders:
const ws = (shp, opp, customer, k, d, t, td, a): WsRow => ({
  shp, opp, customer,
  kyc: { d: k,  t: 4 },      // ← FIXED total
  dd:  { d,     t: 3 },
  tl:  { d: t,  t: 3 },
  td:  { d: td, t: 4 },
  agr: { d: a,  t: 2 },
});
const wos = (k, d, t, td, a, at): WosRow => ({ …, agr: { d: a, t: at } });  // AGR total per row

/* With Shipment ID — Equal (buyer == consignee) transactions. */
const WS_EQ: WsRow[] = [
  ws('SHP-001', 'OPP-101', 'Shree Exports Pvt Ltd',    4, 3, 3, 4, 2),
  ws('SHP-002', 'OPP-102', 'GreenHarvest Global',       4, 3, 3, 3, 2),
  ws('SHP-003', 'OPP-103', 'GreenHarvest Agri-Exports', 0, 0, 0, 0, 0),
  ws('SHP-004', 'OPP-104', 'Fit Nation Pvt Ltd',        4, 3, 3, 4, 2),
  ws('SHP-005', 'OPP-105', 'FreshMart Retailers',       4, 2, 2, 2, 1),
  ws('SHP-006', 'OPP-106', 'QuickTrade Resellers',      1, 0, 0, 0, 0),
  …
];
```

### Telling mock from live at a glance
| Signal | Mock | Live |
|---|---|---|
| Totals | **Fixed** — KYC 4, DD 3, TL 3, TD 4, AGR 2 on every With-Shipment row | Vary per row, driven by each party's segment rules |
| Party names | *Shree Exports Pvt Ltd*, *GreenHarvest Global*, *QuickTrade Resellers* … | Your own customers and suppliers |
| Codes | `SHP-001`, `OPP-101` — sequential fixtures | Real `shipment_code` / `opp_code` values |
| `db_id` | absent | present on live party rows |

Any tile still bound to `clmAnalyticsData.ts` will render populated-looking figures even for a tenant with no data at all. That is the single most important thing to check when a chart looks wrong.

---

## 5. WHAT THE SERVER SIDE ACTUALLY DOES

For completeness — the maths behind every `{ d, t }` pair lives in the two profile controllers, not here:

```php
// ClmBuyerProfileController::index()  — 9 phases
//   segments → rules[segment_id][document_type] → uploads → agreements/trade-docs
//   → completed signatures → leads/PIs/shipments → buyers → consignees → 4 txn buckets
//   'done' for td additionally counts a COMPLETED Proforma Invoice signature

// ClmSupplierProfileController::index()
//   segments → rules[segment_id] (single-type) → uploads → agreements
//   → completed signatures → vendor→product→procurement→lead→shipment chain
//   → 5 party-wise + 5 transaction-wise collections
```

See the Customer Profile and Supplier Profile walkthroughs for the annotated traces.

---

## 6. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Reuse existing endpoints, add no backend | the hook | The aggregation already exists and is already scoped |
| `Promise.all` | the hook | The two feeds are the heaviest reads in CLM |
| Scoping delegated to the interceptor | `api.ts` | Bearer token + `?branch_id` on every GET |
| Optional-field markers (`shp`, `consignee`) | the type contract | Classification is server-side; the page just reads it |
| Types as documentation | `useClmAnalyticsData.ts` | The hook's types are the module's schema |
| Prototype fixture kept beside the live path | `clmAnalyticsData.ts` | Ported before the feeds were wired — and never removed |

---

## 7. NOTES & CAVEATS

- **There is no `/clm/analytics` endpoint, controller, model or migration.** The module is three frontend files.
- **The mock dataset still ships.** Confirm which source a tile draws from before trusting it.
- Every page load fires the two heaviest reads in CLM, each aggregating the whole tenant with no pagination or cache.
- Neither endpoint accepts filters — no date range, no segment narrowing, no paging.
- The feeds are point-in-time snapshots; nothing is stored, so there is no trend to plot.
- `qc` is absent from both feeds and therefore from the dashboard.
- Supplier transactions are procurement-level and carry no opportunity id, so they cannot be joined to buy-side rows.

---

*Related documents: ANALYTICS_FUNCTIONAL_DOCUMENTATION.md · ANALYTICS_TECHNICAL_DOCUMENTATION.md · ANALYTICS_API_DOCUMENTATION.md*
