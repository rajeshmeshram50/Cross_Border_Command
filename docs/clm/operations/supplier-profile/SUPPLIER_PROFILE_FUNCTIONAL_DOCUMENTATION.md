# SUPPLIER PROFILE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · With Shipment ID → **Supplier Profile**
> Route `/clm/supplier-profile` · Endpoint `GET /api/clm/supplier-profile`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
**Supplier Profile** is the sell-side scorecard's mirror image: the buy-side view of the people *you* buy from. For every vendor and every procurement they were part of, it answers:

> *Of the documents this supplier's segment requires, how many have been collected and signed?*

Like Customer Profile it is entirely **read-only**, and it reports the same five document families — `kyc`, `dd`, `tl`, `td`, `agr` — as **X of Y** ratios.

### 1.2 What makes it different from Customer Profile
| | Customer Profile | **Supplier Profile** |
|---|---|---|
| Party | Customers + Consignees | **Vendors** |
| Segment source | The party's segment **name CSV** | The vendor's single **`segment_id`** |
| Trade type | Domestic vs international, from the party's country | **Not used** — one rule per segment |
| Transaction unit | Opportunity (lead / PI) | **Procurement** |
| Buckets | Shipment × buyer-equals-consignee | **Supplier type × shipment** |
| Extra column | Consignee count | **State** (from the vendor's primary address) |

### 1.3 Business value
| Benefit | Description |
|---|---|
| Supplier risk at a glance | One ratio per document family, per vendor |
| Typed buckets | Material, Logistic and Services suppliers are tracked separately |
| Shipment linkage | A supplier is "with shipment" when a product it supplies was procured on a lead that shipped |
| Procurement-level detail | Transaction rows are per `(procurement, supplier)`, not per opportunity |
| Feeds three other screens | CLM Analytics, Diagnosis & Resolution and the Regulatory Defense File reuse this aggregation |

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All vendors, all tenants |
| Client Admin / Client User | The client's vendors; Branch Switcher narrows |
| Branch User | Own branch |
| Employee | The branch's supplier book (products + suppliers are branch-shared) |

Menu slug: `clm.supplier_profile`. The screen is read-only — there are no write endpoints.

---

## 3. THE TEN COLLECTIONS

The endpoint returns ten collections: five **party-wise** (one row per vendor) and five **transaction-wise** (one row per procurement × supplier).

```
                          MATERIAL      LOGISTIC       SERVICES
  party-wise
    with shipment          ws_mat        ws_logi          —
    without shipment       wos_mat       wos_logi       wos_svc
  transaction-wise
    with shipment        txn_ws_mat    txn_ws_logi        —
    without shipment     txn_wos_mat   txn_wos_logi   txn_wos_svc
```

### 3.1 Supplier type → bucket
The vendor's **Vendor Type** master name decides its bucket:

| Vendor type name | Bucket |
|---|---|
| `Material` | material |
| `Logistic` / `Logistics` | logistic |
| **anything else** (Tech, Advisory, Risk Services, …) | **services** |

Services suppliers are **never** classified as "with shipment" — they always land in `wos_svc` / `txn_wos_svc`.

### 3.2 What "with shipment" means for a supplier
```
vendor
  └─ mapped products                     (VendorProductMapping)
        └─ procurements that included that product   (ProcurementProduct)
              └─ the lead behind the procurement     (Procurement.lead_id)
                    └─ does that lead have a ShipmentOrder?
```
If **any** of the vendor's products was procured on a lead that shipped, the vendor is "with shipment", and its `ship` count is the sum of shipment orders across all those leads.

Transaction rows decide the same question **per procurement**, so one vendor can appear in both `txn_ws_mat` and `txn_wos_mat`.

---

## 4. BUSINESS PROCESS FLOW

```
   INPUTS
     Segments            (id → name, id → regulatory tier)
     Segment rules       keyed [segment_id]  ← single-type, no domestic/international split
     Evidence Vault      segment_doc_uploads grouped per owner
     Agreement library   Active rows matched per segment
     Completed AGREEMENT signature requests, keyed per party
     Vendor→product map · Procurement→product map · Procurement→lead · Shipment orders
        │
        ▼
   FOR EACH VENDOR
     1. its single segment_id
     2. union the required doc codes from that segment's rule
     3. count uploads against the vendor → kyc / dd / tl / td ratios
     4. applicable agreements for the segment vs completed signatures → agr ratio
     5. roll up shipments across its mapped products → `ship` + with/without flag
     6. bucket by supplier type × shipment
        │
        ▼
   FOR EACH (VENDOR × PROCUREMENT that used one of its products)
     same five ratios (copied from the party-level computation)
     + procId  (PROC-NNN)
     + shpId   (SHP-NNN, when the procurement's lead shipped)
        │
        ▼
   OUTPUT  ten collections
```

---

## 5. SCREEN SPECIFICATION (`ClmSupplierProfilePage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Tabs | Party-wise (Material / Logistic / Services, split by shipment) and Transaction-wise equivalents |
| Party-wise columns | SR · ID (`vendor_code`) · SUPPLIER NAME · SEGMENT chip · **STATE** · KYC · DD · TL · TD · AGR · SHIPMENTS |
| Transaction columns | SR · SHP ID *(ws only)* · PROC ID · SUPPLIER · SUP ID · REG STATUS · PO · INVOICE · the five ratios |
| PO / Invoice columns | Always render **"—"** — the source fields are not wired yet |
| Progress cell | `d / t` with a completion bar |
| Drill-down | A row opens the vendor's Evidence Vault (`/segment-uploads/vendor/{id}/vault`) |
| Read-only | No create / edit / delete anywhere |

---

## 6. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | A vendor carries **one** `segment_id`; the required-doc set comes from that segment's rule alone |
| 2 | Supplier-profile rules are read **without** a `document_type` split — the first rule found for the segment is used |
| 3 | A document is **done** when an upload exists for `(vendor, category, code)` |
| 4 | An agreement is done only when a **completed** agreement signature request references it for that vendor |
| 5 | Only **Active** agreements count toward the `agr` total |
| 6 | An agreement applies when its regulatory tier equals the segment's **and** its `segment` CSV names that segment's name or code |
| 7 | Vendor type name decides the bucket: `Material`, `Logistic`/`Logistics`, everything else ⇒ **Services** |
| 8 | **Services suppliers are never "with shipment"** |
| 9 | A vendor is "with shipment" when any of its mapped products was procured on a lead that has a shipment order |
| 10 | Transaction rows exist per `(procurement, supplier)` and carry the **party-level** ratios |
| 11 | `reg` on a transaction row is `High` when the segment is highly regulated, otherwise `Low` |

---

## 7. STATUS MODEL

Nothing is stored. The classification axes are **supplier type** (material / logistic / services) and **shipment presence**, both derived.

---

## 8. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Read-only | Nothing can be fixed here; go to the vendor's Evidence Vault |
| No filters | The endpoint takes no query parameters and returns the whole tenant |
| One segment per vendor | Unlike customers, a vendor cannot span multiple segments |
| No domestic/international split | Supplier rules are read single-type, so a segment's domestic-vs-international distinction is ignored on this screen |
| PO / Invoice columns | Hard-coded to `—`; the underlying fields are not wired |
| Ratios are party-level | Every transaction row for a vendor repeats the same ratios — they are not recomputed per procurement |
| Synthetic codes | `PROC-NNN` and `SHP-NNN` are derived from primary keys here, not from a stored code column |
| `qc` not tracked | Quality & Compliance documents are not one of the five families |
| Cost | The whole tenant is aggregated in memory on every call |

---

*Related documents: SUPPLIER_PROFILE_TECHNICAL_DOCUMENTATION.md · SUPPLIER_PROFILE_CODE_WALKTHROUGH.md · SUPPLIER_PROFILE_API_DOCUMENTATION.md*
