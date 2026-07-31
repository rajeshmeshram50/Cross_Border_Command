# CUSTOMER PROFILE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · With Shipment ID → **Customer Profile**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.buyer_profile` gates the UI.
- **Read-only module** — there is exactly one endpoint and it takes **no query parameters**.
- Success: `{ status: true, data: { …six collections… } }`.
- Codes: 200 · 401.
- A user with no `client_id` receives the empty envelope (200, not 403).

---

## 2. ENDPOINT INDEX

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/buyer-profile` | The whole buy-side compliance scorecard |

Related (drill-down and reuse):

| Method | Path | Relationship |
|---|---|---|
| GET | `/segment-uploads/{type}/{id}/vault` | Row drill-down — the party's Evidence Vault |
| GET | `/clm/diagnosis-resolution` | Embeds this payload as its `buyer` block |
| GET | `/clm/regulatory-defense` | Expands `ws_eq` + `ws_neq` into the with-shipment tab |

---

## 3. GET `/clm/buyer-profile`

Returns six independent collections in one payload.

```
buyers      one row per CUSTOMER
consignees  one row per CONSIGNEE
ws_eq       transactions WITH a shipment,    buyer == consignee
ws_neq      transactions WITH a shipment,    buyer ≠  consignee
wos_eq      transactions WITHOUT a shipment, buyer == consignee
wos_neq     transactions WITHOUT a shipment, buyer ≠  consignee
```

**200**
```json
{
  "status": true,
  "data": {
    "buyers": [
      { "sr": 1,
        "id": "C-009",
        "db_id": 88,
        "name": "Royal Cashews Pvt Ltd",
        "seg": ["Rice", "Food Grade Ethanol"],
        "sc": "#0e7490", "sb": "#f0fdff",
        "country": "India",
        "cn": 2,
        "kyc": { "d": 4, "t": 4 },
        "dd":  { "d": 2, "t": 3 },
        "tl":  { "d": 3, "t": 3 },
        "td":  { "d": 1, "t": 4 },
        "agr": { "d": 1, "t": 2 },
        "ship": 5 }
    ],
    "consignees": [
      { "sr": 1, "id": "CN-014", "cid": "C-009", "db_id": 51,
        "name": "Royal Logistics FZE", "seg": ["Rice"],
        "country": "UAE",
        "kyc": {"d":3,"t":4}, "dd": {"d":1,"t":3}, "tl": {"d":2,"t":3},
        "td": {"d":0,"t":4}, "agr": {"d":0,"t":2}, "ship": 2 }
    ],
    "ws_eq": [
      { "sr": 1, "opp": "OPP-0341", "leadId": 341,
        "customer": "Royal Cashews Pvt Ltd",
        "pi": "PI/25-26/0042",
        "shp": "SHP-001",
        "reg": "High",
        "kyc": {"d":4,"t":4}, "dd": {"d":3,"t":3}, "tl": {"d":3,"t":3},
        "td": {"d":4,"t":4}, "agr": {"d":2,"t":2} }
    ],
    "ws_neq":  [ { "…": "…", "consignee": "Royal Logistics FZE" } ],
    "wos_eq":  [ "…" ],
    "wos_neq": [ "…" ]
  }
}
```

### Field reference — roster rows (`buyers`, `consignees`)
| Field | Meaning |
|---|---|
| `sr` | Row number within the collection |
| `id` | `customer_code` / `consignee_code`, falling back to `C-NNN` / `CN-NNN` from the primary key |
| `db_id` | Numeric primary key — use this for the Evidence Vault drill-down |
| `name` | `company_name` |
| `seg` | Array of segment **names** taken from the party's CSV |
| `sc` / `sb` | Chip colours for the segment badges |
| `country` | From `primaryAddress.country`; drives domestic vs international |
| `cn` *(buyers)* | Count of **distinct** consignees — those flagged *same as customer* are excluded |
| `cid` *(consignees)* | Parent `customer_code` |
| `ship` | Number of shipments attributable to this party |
| `kyc` `dd` `tl` `td` `agr` | `{ "d": done, "t": total }` |

### Field reference — transaction rows (`ws_*`, `wos_*`)
| Field | Meaning |
|---|---|
| `opp` | The lead's `opp_code` |
| `leadId` | Numeric lead id (used by the Regulatory Defense File to expand the row) |
| `customer` | Customer company name |
| `consignee` | Present on the `*_neq` collections only |
| `pi` | Latest non-cancelled Proforma Invoice code |
| `shp` | Real `shipment_orders.shipment_code` — present on `ws_*` only |
| `reg` | `High` \| `Low` \| `Both` across the transaction's segments |
| `kyc` `dd` `tl` `td` `agr` | `{ d, t }` scoped to the transaction's segments |

**Empty payload** (no `client_id`):
```json
{ "status": true,
  "data": { "buyers": [], "consignees": [], "ws_eq": [], "ws_neq": [], "wos_eq": [], "wos_neq": [] } }
```

---

## 4. HOW THE RATIOS ARE COMPUTED

### The required side (`t`)
1. The party's `segment` CSV is resolved to segment **ids** (unknown names are dropped).
2. The party's country decides the trade type: **India ⇒ `domestic`**, anything else ⇒ `international`.
3. For each segment, the DCP rule of that `document_type` is read — falling back to the segment's **other** rule if the matching one is absent.
4. The document codes from all those rules are **unioned** per category, so a code required by two segments counts once.

For `agr` and `td` the total instead counts the applicable **library rows** — an agreement or trade document applies when its regulatory tier equals the segment's **and** its `segment` CSV names that segment's name or code, and when its `party` CSV covers the side being measured (a **blank** `party` covers both).

### The done side (`d`)
| Family | "Done" means |
|---|---|
| `kyc` `dd` `tl` | A `segment_doc_uploads` row exists for `(party, category, code)` |
| `td` | An upload exists, a completed `trade_doc` signature exists for that side, **or** the lead's Proforma Invoice has a completed `proforma_invoice` signature |
| `agr` | A completed `agreement` signature request references that agreement for that party/side |

Only `agr_status = 'Active'` agreements and `status = 'active'` trade documents are counted.

---

## 5. WORKED EXAMPLE

A customer in **India** carrying segments `Rice, Food Grade Ethanol`:

| Step | Result |
|---|---|
| Segment ids | `Rice → 12`, `Food Grade Ethanol → 14` |
| Trade type | country `India` ⇒ **`domestic`** |
| Rule for 12 (domestic) | `kyc: {KYC-001:M, KYC-003:M}` · `dd: {DD-002:M}` |
| Rule for 14 (domestic) | absent ⇒ **falls back** to 14's international rule: `kyc: {KYC-003:M, KYC-007:O}` · `tl: {TL-001:M}` |
| Union | `kyc: {KYC-001, KYC-003, KYC-007}` (3) · `dd: {DD-002}` (1) · `tl: {TL-001}` (1) |
| Uploads present | `kyc::KYC-001`, `kyc::KYC-003`, `tl::TL-001` |
| Result | `kyc {d:2,t:3}` · `dd {d:0,t:1}` · `tl {d:1,t:1}` |

---

## 6. RELATED ENDPOINTS

### Drill-down
```
GET /segment-uploads/customer/{db_id}/vault
GET /segment-uploads/consignee/{db_id}/vault
GET /segment-uploads/{type}/{id}/summary        # the same X-of-Y for one party
POST /segment-uploads/{type}/{id}               # upload the missing evidence
```

### Reuse
```
GET /clm/diagnosis-resolution   → { data: { buyer: <this payload>, supplier: …, ctc: … } }
GET /clm/regulatory-defense     → with_shipment[] built from ws_eq + ws_neq
```
Both call this controller's `index()` **in-process** (method injection), not over HTTP — so the scoping and the maths are guaranteed identical.

---

## 7. QUICK REFERENCE

```
GET /clm/buyer-profile                       # the whole buy-side scorecard
    → data.buyers      per-customer progress
    → data.consignees  per-consignee progress
    → data.ws_eq / ws_neq    transactions that reached a shipment
    → data.wos_eq / wos_neq  transactions that have not

GET /segment-uploads/customer/{db_id}/vault  # drill into a row
POST /segment-uploads/customer/{db_id}       # upload what's missing → d increases
```

---

## 8. NOTES (caveats)

1. **Read-only** — there are no POST/PUT/DELETE endpoints for this module.
2. The endpoint accepts **no query parameters**: no filters, no pagination, no branch narrowing. The whole tenant is aggregated on every call.
3. `qc` is **not** one of the five families — Quality & Compliance documents do not appear in these ratios.
4. Transaction rows resolve their segments from the **latest non-cancelled Proforma Invoice only**; a quotation-stage lead shows no segments and therefore `0/0` everywhere.
5. Party ↔ segment matching is by **name** — a segment name that no longer exists silently contributes zero required documents.
6. A completed **Proforma Invoice** signature counts toward the `td` family, because the PI is the shipment's first buyer-side trade document.
7. `cn` excludes consignees flagged *same as customer*, so it matches the consignee popup.
8. `shp` is the real `shipment_orders.shipment_code`; legacy rows with a NULL code fall back to a synthetic id.
9. This is the heaviest read in CLM — expect it to grow with tenant size.

---

*Related documents: CUSTOMER_PROFILE_FUNCTIONAL_DOCUMENTATION.md · CUSTOMER_PROFILE_TECHNICAL_DOCUMENTATION.md · CUSTOMER_PROFILE_CODE_WALKTHROUGH.md*
