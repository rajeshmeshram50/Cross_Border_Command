# CLM ANALYTICS — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → CLM Command Center → **CLM Analytics**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
A **frontend-only** module. There is no `ClmAnalyticsController`, no `/clm/analytics` route and no table. The page is three files under `resources/js/pages/clm/command-center/`:

| File | Role |
|---|---|
| `ClmAnalyticsPage.tsx` | The dashboard UI |
| `useClmAnalyticsData.ts` | **The live data layer** — fetches and reshapes the two profile feeds |
| `clmAnalyticsData.ts` | **The embedded mock dataset** — a faithful port of the prototype's `rAnalytics()` view |

The hook's own comment states the design decision plainly:

> *"The real compliance data is already computed server-side by two existing endpoints (no new backend needed) — this hook just fetches both in parallel, tenant-scoped automatically (the Axios client injects the Bearer token and the active branch_id on every GET)."*

### 1.2 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT — the ENTIRE module                                           │
│                                                                       │
│  ClmAnalyticsPage.tsx                                                 │
│      ├── useClmAnalyticsData.ts    (live)                             │
│      │       Promise.all([                                            │
│      │         api.get('/clm/buyer-profile'),                         │
│      │         api.get('/clm/supplier-profile')                       │
│      │       ])                                                       │
│      │       → ApiTxnRow · ApiParty · ApiSupTxn                       │
│      │                                                                │
│      └── clmAnalyticsData.ts       (mock — prototype fixture)         │
│              WS_EQ · WS_NEQ · WOS_* rows with FIXED totals            │
│              (KYC 4, DD 3, TL 3, TD 4, AGR 2)                         │
└──────────────────────────────┬───────────────────────────────────────┘
              Axios: Bearer token + ?branch_id auto-injected
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  EXISTING ENDPOINTS (unchanged, not owned by this module)             │
│    GET /clm/buyer-profile     → ClmBuyerProfileController::index()    │
│    GET /clm/supplier-profile  → ClmSupplierProfileController::index() │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
resources/js/pages/clm/command-center/
    ClmAnalyticsPage.tsx        the dashboard
    useClmAnalyticsData.ts      the live fetch + reshape hook
    clmAnalyticsData.ts         the embedded prototype dataset
resources/js/pages/clm/operations/clmOpsData.ts   (the CtcContract type it imports)
```

**No controller. No model. No migration. No route.**

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Frontend | React 19 · TypeScript · shared CLM shell |
| Data | `api.ts` (Axios) — Bearer token + `?branch_id` injected by interceptor |
| Charts | Recharts (the project's charting library) |
| Backend | **none of its own** — reuses two CLM Operations endpoints |

---

## 3. DATA MODEL — the hook's TypeScript contract

`useClmAnalyticsData.ts` declares the shapes it expects back from the two feeds:

```ts
export type ApiProg = { d: number; t: number };

/** A transaction (opportunity) row from the buyer-profile endpoint. */
export type ApiTxnRow = {
  sr: number;
  opp: string;
  customer: string;
  pi?: string;
  reg?: string;
  shp?: string;          // present ONLY when a shipment exists
  consignee?: string;    // present ONLY when consignee ≠ customer
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
 *  Note: supplier txns are procurement-level — they carry NO opportunity id. */
export type ApiSupTxn = {
  sr: number;
  shpId?: string;        // "SHP-xxx" — present for with-shipment txns
  procId?: string;       // "PROC-xxx"
  supplier: string;
  supId: string;         // vendor_code ("V-xx")
  reg?: string; po?: string; inv?: string;
  kyc: ApiProg; dd: ApiProg; tl: ApiProg; td: ApiProg; agr: ApiProg;
};
```

### The With/Without-Shipment contract
The hook documents the rule it relies on:

> *"`ws_*` rows carry a `shp` code ("SHP-`<leadId>`") only when the opportunity completed the Victory stage and a shipment order exists; otherwise the row lands in `wos_*`. That's the real With- vs Without-Shipment split."*

---

## 4. THE MOCK DATASET — `clmAnalyticsData.ts`

```ts
/* CLM Analytics — mock dataset (faithful port of the `rAnalytics()` view from the
 * CLM_(28) prototype). There is no `/clm/analytics` API yet, so the page renders from
 * this embedded dataset exactly as the prototype did.
 *
 * Doc-completion totals are FIXED across With-Shipment rows (KYC 4, DD 3, TL 3, TD 4,
 * AGR 2); only the "done" counts vary. Without-Shipment rows match the same totals
 * except some have no agreement obligation (AGR 0/0), so that total is supplied per row. */

export type DocProg = { d: number; t: number };
export type DocKey  = 'kyc' | 'dd' | 'tl' | 'td' | 'agr';
export const DOC_KEYS: DocKey[] = ['kyc', 'dd', 'tl', 'td', 'agr'];

const ws  = (shp, opp, customer, k, d, t, td, a): WsRow => ({ … totals fixed … });
const wos = (k, d, t, td, a, at): WosRow           => ({ … AGR total per row … });

const WS_EQ: WsRow[] = [
  ws('SHP-001', 'OPP-101', 'Shree Exports Pvt Ltd', 4, 3, 3, 4, 2),
  ws('SHP-002', 'OPP-102', 'GreenHarvest Global',   4, 3, 3, 3, 2),
  …
];
```

**How to tell a mock chart from a live one:** prototype rows use fixed totals (KYC 4, DD 3, TL 3, TD 4, AGR 2) and fictional companies (*Shree Exports Pvt Ltd*, *GreenHarvest Global*, *QuickTrade Resellers*). Live rows carry your own party names and per-segment totals that vary by row.

---

## 5. API ENDPOINTS CONFIGURATION

**This module registers no routes.** It consumes:

```php
// app/routes/api.php — owned by the Operations modules
Route::get('/clm/buyer-profile',    [ClmBuyerProfileController::class,    'index']);
Route::get('/clm/supplier-profile', [ClmSupplierProfileController::class, 'index']);
```

Both take **no query parameters**. See **ANALYTICS_API_DOCUMENTATION.md** for the payloads as the dashboard consumes them, and the Customer/Supplier Profile API docs for the authoritative field reference.

---

## 6. THE FETCH LAYER — `useClmAnalyticsData.ts`

```ts
useEffect(() => {
  Promise.all([
    api.get('/clm/buyer-profile'),      // branch_id auto-injected by the interceptor
    api.get('/clm/supplier-profile'),
  ]).then(([buyer, supplier]) => {
    // reshape data.buyers / consignees / ws_* / wos_*   → ApiParty[] · ApiTxnRow[]
    // reshape data.ws_mat / … / txn_wos_logi            → ApiSupTxn[]
    setState(…);
  });
}, []);
```

Both calls fire in parallel; the page renders when both resolve. Tenant and branch scoping are handled entirely by the Axios interceptor and the two controllers — the hook adds none of its own.

---

## 7. INTEGRATIONS

| Integration | How |
|---|---|
| **Customer Profile** | `/clm/buyer-profile` — the buy-side rosters and transactions |
| **Supplier Profile** | `/clm/supplier-profile` — the sell-side party-wise and transaction-wise rows |
| **Case-to-Case** | The hook imports the `CtcContract` type from `clmOpsData.ts` for contract-related tiles |
| **Evidence Vault** | Indirect — it is what makes the `d` side of every ratio move |
| **Document Control Panel** | Indirect — it is what defines the `t` side |

---

## 8. SECURITY & CAVEATS

1. **No server-side surface of its own** — every authorisation and scoping decision is made by the two profile controllers.
2. The Axios interceptor injects the Bearer token and the active `branch_id` on both GETs; the page performs no filtering itself.
3. **The mock dataset ships in the bundle.** Any tile still wired to `clmAnalyticsData.ts` renders prototype figures regardless of tenant — a real risk of a dashboard that looks populated when the tenant has no data.
4. Every page load triggers the **two heaviest reads in CLM**, each aggregating the whole tenant in memory with no pagination or cache.
5. Neither endpoint accepts filters, so date ranges, segment narrowing and paging are not available.
6. The feeds are point-in-time; there is no stored history to trend.
7. `qc` is absent from both feeds and therefore from the dashboard.
8. Buy-side and sell-side transactions cannot be joined — supplier transactions are procurement-level and carry no opportunity id.

---

## 9. METRICS

| Metric | Value |
|---|---|
| Controllers | **0** |
| Routes | **0** (consumes 2) |
| Tables | 0 |
| Frontend files | 3 |
| Endpoints consumed | 2 (`/clm/buyer-profile`, `/clm/supplier-profile`) |
| Document families | 5 (`kyc`, `dd`, `tl`, `td`, `agr`) |
| Permission slug | `clm.analytics` |
| Mock dataset | still present (`clmAnalyticsData.ts`) |
| Test coverage | none automated |

---

*Related documents: ANALYTICS_FUNCTIONAL_DOCUMENTATION.md · ANALYTICS_CODE_WALKTHROUGH.md · ANALYTICS_API_DOCUMENTATION.md*
