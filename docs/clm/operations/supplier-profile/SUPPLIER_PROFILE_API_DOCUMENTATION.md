# SUPPLIER PROFILE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · With Shipment ID → **Supplier Profile**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.supplier_profile` gates the UI.
- **Read-only module** — one endpoint, **no query parameters**.
- Success: `{ status: true, data: { …ten collections… } }`.
- Codes: 200 · 401.
- A user with no `client_id` receives the empty envelope (200, not 403).

---

## 2. ENDPOINT INDEX

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/supplier-profile` | The whole buy-side (vendor) compliance scorecard |

Related (drill-down and reuse):

| Method | Path | Relationship |
|---|---|---|
| GET | `/segment-uploads/vendor/{id}/vault` | Row drill-down — the vendor's Evidence Vault |
| GET | `/clm/diagnosis-resolution` | Embeds this payload as its `supplier` block |
| GET | `/clm/regulatory-defense` | Builds its without-shipment tab from `wos_*` |

---

## 3. GET `/clm/supplier-profile`

Returns **ten** collections: five party-wise (one row per vendor) and five transaction-wise (one row per procurement × supplier).

```
                          MATERIAL        LOGISTIC          SERVICES
  party-wise
    with shipment          ws_mat          ws_logi             —
    without shipment       wos_mat         wos_logi          wos_svc
  transaction-wise
    with shipment        txn_ws_mat      txn_ws_logi           —
    without shipment     txn_wos_mat     txn_wos_logi      txn_wos_svc
```

**200**
```json
{
  "status": true,
  "data": {
    "ws_mat": [
      { "sr": 1,
        "id": "V-014",
        "db_id": 77,
        "name": "Agro Mills Pvt Ltd",
        "seg": "Rice",
        "sc": "#0e7490", "sb": "#f0fdff", "sc2": "#0891b2",
        "state": "Maharashtra",
        "kyc": { "d": 3, "t": 4 },
        "dd":  { "d": 1, "t": 3 },
        "tl":  { "d": 2, "t": 2 },
        "td":  { "d": 0, "t": 1 },
        "agr": { "d": 1, "t": 1 },
        "ship": 3 }
    ],
    "ws_logi":  [ "…" ],
    "wos_svc":  [ "…" ],
    "wos_mat":  [ "…" ],
    "wos_logi": [ "…" ],

    "txn_ws_mat": [
      { "sr": 1,
        "shpId": "SHP-004",
        "procId": "PROC-011",
        "supplier": "Agro Mills Pvt Ltd",
        "supId": "V-014",
        "supDbId": 77,
        "reg": "High",
        "po": "—",
        "inv": "—",
        "kyc": { "d": 3, "t": 4 },
        "dd":  { "d": 1, "t": 3 },
        "tl":  { "d": 2, "t": 2 },
        "td":  { "d": 0, "t": 1 },
        "agr": { "d": 1, "t": 1 } }
    ],
    "txn_ws_logi":  [ "…" ],
    "txn_wos_svc":  [ "…" ],
    "txn_wos_mat":  [ "…" ],
    "txn_wos_logi": [ "…" ]
  }
}
```

### Field reference — party-wise rows
| Field | Meaning |
|---|---|
| `sr` | Row number **within its own collection** (each bucket counts from 1) |
| `id` | `vendor_code`, falling back to `S-NNN` from the primary key |
| `db_id` | Numeric vendor id — use this for the Evidence Vault drill-down |
| `name` | `company_name` |
| `seg` | The vendor's **single** segment name, or `—` |
| `sc` / `sb` / `sc2` | Chip colours |
| `state` | Resolved from `master_states` via the vendor's primary address |
| `ship` | Total shipment orders across every lead that procured one of this vendor's products |
| `kyc` `dd` `tl` `td` `agr` | `{ "d": done, "t": total }` |

### Field reference — transaction-wise rows
| Field | Meaning |
|---|---|
| `sr` | Row number within its collection |
| `shpId` | `SHP-NNN` — **present on `txn_ws_*` only**, synthesised from the first shipment order id |
| `procId` | `PROC-NNN`, synthesised from the procurement id |
| `supplier` / `supId` / `supDbId` | Vendor name, code and numeric id |
| `reg` | `High` when the segment is highly regulated, else `Low` |
| `po` / `inv` | Always `"—"` — no source field is wired yet |
| `kyc` `dd` `tl` `td` `agr` | **The vendor's party-level ratios, copied** — not recomputed per procurement |

**Empty payload** (no `client_id`): all ten keys present, each an empty array.

---

## 4. HOW A VENDOR IS BUCKETED

### By supplier type
The vendor's **Vendor Type** master name decides the bucket:

| Vendor type name (case-insensitive) | Bucket |
|---|---|
| `Material` | material |
| `Logistic` or `Logistics` | logistic |
| **anything else** — Tech, Advisory, Risk Services, unset | **services** |

### By shipment
```
vendor → its mapped products (VendorProductMapping)
       → procurements that included those products (ProcurementProduct)
       → the lead behind each procurement (Procurement.lead_id)
       → does that lead have a ShipmentOrder?
```
Any hit makes the vendor "with shipment"; `ship` sums the shipment orders across all such leads.

**Services suppliers are never classified as with-shipment** — they always land in `wos_svc` / `txn_wos_svc`.

Transaction rows decide the same question **per procurement**, so one vendor can legitimately appear in both `txn_ws_mat` and `txn_wos_mat`.

---

## 5. HOW THE RATIOS ARE COMPUTED

### The required side (`t`)
1. The vendor's single `segment_id`.
2. That segment's DCP rule is read **without a `document_type` filter** — suppliers have no domestic/international split on this screen.
3. The `doc_selections` codes for `kyc`, `dd`, `tl`, `td` become the totals.

For `agr` the total is the count of **Active** agreements whose regulatory tier equals the segment's **and** whose `segment` CSV names that segment's name or code.

### The done side (`d`)
| Family | "Done" means |
|---|---|
| `kyc` `dd` `tl` `td` | A `segment_doc_uploads` row exists for `(vendor, category, code)` |
| `agr` | A **completed** `agreement` signature request references that agreement for this vendor |

> Unlike the customer profile, `td` here counts **uploads only** — there is no trade-document signature index on this endpoint.

---

## 6. RELATED ENDPOINTS

### Drill-down
```
GET  /segment-uploads/vendor/{db_id}/vault      # the vendor's Evidence Vault
GET  /segment-uploads/vendor/{db_id}/summary    # the same X-of-Y for one vendor
POST /segment-uploads/vendor/{db_id}            # upload the missing evidence → d increases
```

### Reuse
```
GET /clm/diagnosis-resolution   → { data: { buyer: …, supplier: <this payload>, ctc: … } }
GET /clm/regulatory-defense     → without_shipment[] built from wos_*
```
Both call this controller's `index()` **in-process** (method injection), not over HTTP.

---

## 7. QUICK REFERENCE

```
GET /clm/supplier-profile                     # the whole supplier scorecard
    → data.ws_mat / ws_logi                   party-wise, shipment-linked
    → data.wos_mat / wos_logi / wos_svc       party-wise, no shipment
    → data.txn_ws_mat / txn_ws_logi           per (procurement, supplier), shipment-linked
    → data.txn_wos_mat / txn_wos_logi / txn_wos_svc

GET  /segment-uploads/vendor/{db_id}/vault    # drill into a row
POST /segment-uploads/vendor/{db_id}          # upload what's missing
```

---

## 8. NOTES (caveats)

1. **Read-only** — there are no POST/PUT/DELETE endpoints for this module.
2. The endpoint accepts **no query parameters**: no filters, no pagination, no branch narrowing.
3. A vendor carries exactly **one** `segment_id`; there is no multi-segment union as there is for customers.
4. **Supplier rules are read single-type.** If a segment holds both a domestic and an international rule, the last one read wins — the domestic/international distinction is not applied on this screen.
5. `td` counts **uploads only**; completed trade-document signatures are not folded in here.
6. `qc` is **not** one of the five families.
7. `PROC-NNN` and `SHP-NNN` are **synthesised from primary keys**, whereas the customer profile uses the real `shipment_orders.shipment_code` — the two screens can show different ids for the same shipment.
8. Only the **first** shipment order id of a lead is used for `shpId`.
9. `po` and `inv` are hard-coded `"—"`.
10. Transaction rows repeat the vendor's party-level ratios; they are not recomputed per procurement.
11. Any unrecognised vendor type falls into **Services**, which never carries a shipment.

---

*Related documents: SUPPLIER_PROFILE_FUNCTIONAL_DOCUMENTATION.md · SUPPLIER_PROFILE_TECHNICAL_DOCUMENTATION.md · SUPPLIER_PROFILE_CODE_WALKTHROUGH.md*
