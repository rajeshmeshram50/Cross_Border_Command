# CLM ANALYTICS — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → CLM Command Center → **CLM Analytics**
> Route `/clm/analytics`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
**CLM Analytics** is the compliance dashboard — the roll-up view over everything the Customer Profile and Supplier Profile screens report row by row. It answers the management-level question:

> *Across all our counterparties and all our deals, how complete is our compliance paperwork, and where are the gaps?*

It reports the same five document families used everywhere in CLM — **KYC · DD · TL · TD · AGR** — aggregated across parties and transactions, split by With-Shipment vs Without-Shipment.

### 1.2 Where the data comes from
There is **no `/clm/analytics` endpoint.** The page composes two existing feeds in parallel:

```
GET /clm/buyer-profile     → buyers · consignees · ws_eq · ws_neq · wos_eq · wos_neq
GET /clm/supplier-profile  → ws_mat · ws_logi · wos_svc · wos_mat · wos_logi
                             + txn_ws_mat · txn_ws_logi · txn_wos_svc
                             + txn_wos_mat · txn_wos_logi
```

Both are tenant-scoped automatically (the Axios client injects the Bearer token and the active `branch_id` on every GET), so no new backend work was needed to build the dashboard.

### 1.3 The mock dataset
The page **also ships an embedded mock dataset** (`clmAnalyticsData.ts`) — a faithful port of the `rAnalytics()` view from the CLM prototype. It exists because the page was ported before the live feeds were wired, and it is still present in the codebase.

> When reading a chart, know which source it is drawing from. Prototype fixtures use fixed totals (KYC 4, DD 3, TL 3, TD 4, AGR 2) and named companies like *"Shree Exports Pvt Ltd"*, *"GreenHarvest Global"*. Live data comes from your own customers, consignees and suppliers.

### 1.4 Business value
| Benefit | Description |
|---|---|
| One dashboard, whole tenant | Compliance completeness without opening a single party record |
| Same maths everywhere | The ratios are the profile screens' ratios — no second source of truth |
| Shipment split | Deals that reached a shipment vs those that have not |
| Buy-side and sell-side | Customers/consignees and suppliers in one view |
| No extra backend load path | Reuses two endpoints that already exist and are already scoped |

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All data, all tenants |
| Client Admin / Client User | The client's data; Branch Switcher narrows |
| Branch User | Own branch |
| Employee | The branch's book |

Menu slug: `clm.analytics`. The screen is entirely **read-only**.

---

## 3. WHAT THE DASHBOARD SHOWS

```
┌─────────────────────────────────────────────────────────────────┐
│  BUY-SIDE (from /clm/buyer-profile)                              │
│    Party rosters       buyers · consignees                       │
│    Transactions        With Shipment    (ws_eq  + ws_neq)        │
│                        Without Shipment (wos_eq + wos_neq)       │
│    Progress per family KYC · DD · TL · TD · AGR                  │
├─────────────────────────────────────────────────────────────────┤
│  SELL-SIDE (from /clm/supplier-profile)                          │
│    Party-wise          Material · Logistic · Services            │
│    Transaction-wise    per (procurement × supplier)              │
│    Progress per family KYC · DD · TL · TD · AGR                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 The With/Without-Shipment split
A buyer transaction row carries a `shp` code (`SHP-<id>`) **only** when the opportunity completed the Victory stage and a shipment order exists. Rows without one land in the `wos_*` collections. That is the real With- vs Without-Shipment split — it is not a filter the dashboard applies, it is how the underlying feed classifies each row.

### 3.2 Buyer ≠ Consignee
Buy-side transactions are further split by whether the consignee differs from the customer (`*_neq`) or is the same (`*_eq`). A consignee flagged *same as customer* counts as equal.

### 3.3 The five families
| Key | Family | Counted as done when |
|---|---|---|
| `kyc` | KYC documents | an upload exists in the Evidence Vault |
| `dd` | Due Diligence | an upload exists |
| `tl` | Trade Licences | an upload exists |
| `td` | Trade Documents | an upload exists, or a completed trade-doc signature — a **signed Proforma Invoice counts** |
| `agr` | Agreements | a **completed** agreement signature request exists |

Every value is a `{ d, t }` pair — *done* over *total required*.

---

## 4. SCREEN SPECIFICATION (`ClmAnalyticsPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Sections | Buy-side rosters · Buy-side transactions · Sell-side party-wise · Sell-side transaction-wise |
| Charts / tiles | Completion bars per document family, split by shipment presence |
| Party tables | The same rows the profile screens show, aggregated |
| Loading | Both feeds are fetched **in parallel**; the page renders once both resolve |
| Read-only | No create / edit / delete |

Supporting files:
- `useClmAnalyticsData.ts` — the data-fetching hook (the **live** path)
- `clmAnalyticsData.ts` — the embedded prototype dataset (the **mock** path)

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | There is **no dedicated analytics endpoint** — the page composes `/clm/buyer-profile` and `/clm/supplier-profile` |
| 2 | Both feeds are fetched in parallel and are tenant-scoped by the Axios interceptor |
| 3 | A transaction is "With Shipment" only when a `ShipmentOrder` exists for its opportunity |
| 4 | Supplier transactions are **procurement-level** and therefore carry no opportunity id |
| 5 | The five families and their "done" definitions are inherited unchanged from the profile controllers |
| 6 | `qc` (Quality & Compliance) is **not** one of the tracked families |
| 7 | The embedded mock dataset is a prototype fixture, not tenant data |

---

## 6. STATUS MODEL

None of its own. Every figure is derived from the two profile feeds, which are themselves derived from the DCP rules, the Evidence Vault and completed signature requests.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| **Mock data still ships** | `clmAnalyticsData.ts` remains in the codebase alongside the live hook; a chart drawing from it will show prototype companies, not yours |
| No dedicated endpoint | Every load pulls **both** full profile payloads — the two heaviest reads in CLM |
| No filters | Neither underlying endpoint accepts query parameters: no date range, no segment filter, no pagination |
| No trend over time | The feeds are point-in-time snapshots; there is no history to plot |
| `qc` absent | Quality & Compliance documents are not reported |
| Supplier txns lack an opportunity | They are procurement-level, so buy-side and sell-side transactions cannot be joined |
| Cost grows with tenant size | Both feeds aggregate the whole tenant in memory on every page load |

---

*Related documents: ANALYTICS_TECHNICAL_DOCUMENTATION.md · ANALYTICS_CODE_WALKTHROUGH.md · ANALYTICS_API_DOCUMENTATION.md*
