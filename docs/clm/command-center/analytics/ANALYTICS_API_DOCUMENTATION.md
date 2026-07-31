# CLM ANALYTICS — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → CLM Command Center → **CLM Analytics**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.analytics` gates the UI.
- **This module owns no endpoint.** There is no `/clm/analytics` route, controller, model or migration.
- The dashboard composes **two existing CLM Operations endpoints**, fetched in parallel.
- Both are tenant-scoped automatically — the Axios client injects the Bearer token and the active `branch_id` on every GET.
- Codes: 200 · 401.

---

## 2. ENDPOINTS CONSUMED

| Method | Path | Owned by | Supplies |
|---|---|---|---|
| GET | `/clm/buyer-profile` | Customer Profile | Buy-side rosters + transactions |
| GET | `/clm/supplier-profile` | Supplier Profile | Sell-side party-wise + transaction-wise rows |

Neither accepts **any** query parameters — no filters, no date range, no pagination.

```ts
Promise.all([
  api.get('/clm/buyer-profile'),
  api.get('/clm/supplier-profile'),
])
```

The authoritative field reference for each lives in:
- [CUSTOMER_PROFILE_API_DOCUMENTATION.md](../../operations/customer-profile/CUSTOMER_PROFILE_API_DOCUMENTATION.md)
- [SUPPLIER_PROFILE_API_DOCUMENTATION.md](../../operations/supplier-profile/SUPPLIER_PROFILE_API_DOCUMENTATION.md)

What follows is how the **dashboard** consumes them.

---

## 3. GET `/clm/buyer-profile` — as the dashboard reads it

**200**
```json
{
  "status": true,
  "data": {
    "buyers":     [ /* ApiParty  */ ],
    "consignees": [ /* ApiParty  */ ],
    "ws_eq":      [ /* ApiTxnRow */ ],
    "ws_neq":     [ /* ApiTxnRow */ ],
    "wos_eq":     [ /* ApiTxnRow */ ],
    "wos_neq":    [ /* ApiTxnRow */ ]
  }
}
```

### `ApiParty` — a roster row
```json
{ "sr": 1,
  "id": "C-009",
  "cid": null,
  "db_id": 88,
  "name": "Royal Cashews Pvt Ltd",
  "seg": ["Rice", "Food Grade Ethanol"],
  "country": "India",
  "cn": 2,
  "kyc": { "d": 4, "t": 4 },
  "dd":  { "d": 2, "t": 3 },
  "tl":  { "d": 3, "t": 3 },
  "td":  { "d": 1, "t": 4 },
  "agr": { "d": 1, "t": 2 },
  "ship": 5 }
```
| Field | Dashboard use |
|---|---|
| `id` / `db_id` | Row identity; `db_id` links to the Evidence Vault |
| `cid` | Present on **consignees only** — the parent `customer_code` |
| `cn` | Present on **buyers only** — distinct consignee count |
| `ship` | Shipment count attributable to the party |
| five `{d,t}` pairs | The completion bars |

### `ApiTxnRow` — a transaction row
```json
{ "sr": 1,
  "opp": "OPP-0341",
  "customer": "Royal Cashews Pvt Ltd",
  "consignee": "Royal Logistics FZE",
  "pi": "PI/25-26/0042",
  "shp": "SHP-001",
  "reg": "High",
  "kyc": { "d": 4, "t": 4 }, "dd": { "d": 3, "t": 3 },
  "tl":  { "d": 3, "t": 3 }, "td": { "d": 4, "t": 4 },
  "agr": { "d": 2, "t": 2 } }
```

**The two classification markers** — the dashboard never re-derives them, it reads which collection a row arrived in:

| Marker | Present ⇒ | Absent ⇒ |
|---|---|---|
| `shp` | With Shipment (`ws_*`) | Without Shipment (`wos_*`) |
| `consignee` | Buyer ≠ Consignee (`*_neq`) | Buyer == Consignee (`*_eq`) |

> `shp` is set only when the opportunity completed the Victory stage **and** a `ShipmentOrder` exists. That is the real With- vs Without-Shipment split.

---

## 4. GET `/clm/supplier-profile` — as the dashboard reads it

**200**
```json
{
  "status": true,
  "data": {
    "ws_mat":   [ /* party-wise */ ], "ws_logi":  [ … ],
    "wos_mat":  [ … ],                "wos_logi": [ … ], "wos_svc": [ … ],

    "txn_ws_mat":  [ /* ApiSupTxn */ ], "txn_ws_logi":  [ … ],
    "txn_wos_mat": [ … ],               "txn_wos_logi": [ … ], "txn_wos_svc": [ … ]
  }
}
```

### `ApiSupTxn` — a supplier transaction row
```json
{ "sr": 1,
  "shpId": "SHP-004",
  "procId": "PROC-011",
  "supplier": "Agro Mills Pvt Ltd",
  "supId": "V-014",
  "reg": "High",
  "po": "—",
  "inv": "—",
  "kyc": { "d": 3, "t": 4 }, "dd": { "d": 1, "t": 3 },
  "tl":  { "d": 2, "t": 2 }, "td": { "d": 0, "t": 1 },
  "agr": { "d": 1, "t": 1 } }
```

> **`ApiSupTxn` has no `opp` field.** Supplier transactions are **procurement-level**, so buy-side and sell-side transaction rows cannot be joined on an opportunity.

| Marker | Meaning |
|---|---|
| `shpId` present | With-shipment procurement |
| `procId` | The procurement identity (`PROC-NNN`) |
| `po` / `inv` | Always `"—"` — no source field is wired yet |

---

## 5. THE FIVE DOCUMENT FAMILIES

Every `{ d, t }` pair in both payloads uses the same definitions:

| Key | Family | `t` (required) | `d` (done) |
|---|---|---|---|
| `kyc` | KYC documents | union of the segment rules' `kyc` codes | an upload exists in the Evidence Vault |
| `dd` | Due Diligence | union of `dd` codes | an upload exists |
| `tl` | Trade Licences | union of `tl` codes | an upload exists |
| `td` | Trade Documents | applicable trade-doc library rows | an upload exists, a completed trade-doc signature, **or a completed Proforma Invoice signature** |
| `agr` | Agreements | applicable **Active** agreement rows | a **completed** agreement signature request |

> **`qc` (Quality & Compliance) is not tracked** by either feed, and therefore not by the dashboard.

---

## 6. THE MOCK DATASET

The page also ships an embedded prototype fixture, `clmAnalyticsData.ts` — a faithful port of the `rAnalytics()` view from the CLM prototype, kept from before the live feeds were wired.

**How to tell which source a tile is drawing from:**

| Signal | Mock fixture | Live feed |
|---|---|---|
| Totals | **Fixed** — KYC 4, DD 3, TL 3, TD 4, AGR 2 on every With-Shipment row | Vary per row, driven by each party's segment rules |
| Party names | *Shree Exports Pvt Ltd*, *GreenHarvest Global*, *QuickTrade Resellers* … | Your own customers and suppliers |
| Codes | `SHP-001`, `OPP-101` — sequential fixtures | Real `shipment_code` / `opp_code` values |
| `db_id` | absent | present on live party rows |

A tile still bound to the fixture renders populated-looking figures **even for a tenant with no data**.

---

## 7. QUICK REFERENCE

```
# the dashboard's entire network surface
GET /clm/buyer-profile        # buyers · consignees · ws_eq · ws_neq · wos_eq · wos_neq
GET /clm/supplier-profile     # ws_mat · ws_logi · wos_svc · wos_mat · wos_logi
                              # + txn_ws_mat · txn_ws_logi · txn_wos_svc
                              #   · txn_wos_mat · txn_wos_logi
# fetched in parallel; no query parameters accepted by either

# drill-down targets
GET /segment-uploads/customer/{db_id}/vault
GET /segment-uploads/consignee/{db_id}/vault
GET /segment-uploads/vendor/{supDbId}/vault
```

---

## 8. NOTES (caveats)

1. **There is no `/clm/analytics` endpoint.** The module registers no routes, owns no controller and creates no tables.
2. Both consumed endpoints take **no query parameters** — no filters, no date range, no pagination.
3. Every page load triggers the **two heaviest reads in CLM**, each aggregating the whole tenant in memory with no cache.
4. Scoping is entirely delegated: the Axios interceptor injects `?branch_id`, and the two profile controllers apply tenant and visibility rules.
5. The feeds are **point-in-time snapshots** — nothing is stored, so no trend can be plotted.
6. `qc` is absent from both feeds.
7. Supplier transactions carry **no opportunity id** (they are procurement-level), so the two sides cannot be joined.
8. The **embedded mock dataset still ships**; verify a tile's source before trusting its figures.

---

*Related documents: ANALYTICS_FUNCTIONAL_DOCUMENTATION.md · ANALYTICS_TECHNICAL_DOCUMENTATION.md · ANALYTICS_CODE_WALKTHROUGH.md*
