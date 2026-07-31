# CUSTOMER PROFILE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · With Shipment ID → **Customer Profile**
> Route `/clm/buyer-profile` · Endpoint `GET /api/clm/buyer-profile`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
**Customer Profile** is the buy-side compliance scorecard. It answers, for every customer and consignee the tenant deals with, and for every transaction they are part of:

> *Of the documents this segment's rule requires, how many have actually been collected and signed?*

It is a **read-only** view. Nothing is created or edited here — the screen aggregates what the Document Control Panel requires, what the Evidence Vault holds, and what Zoho Sign has completed, and renders it as **X of Y** progress across five document families.

### 1.2 The five families
| Key | Family | Source of "done" |
|---|---|---|
| `kyc` | KYC documents | an upload exists in the Evidence Vault |
| `dd` | Due Diligence documents | an upload exists in the Evidence Vault |
| `tl` | Trade Licences | an upload exists in the Evidence Vault |
| `td` | Trade Documents | an upload exists, **or** a completed trade-document signature (the signed Proforma Invoice also counts) |
| `agr` | Agreements | a **completed** agreement signature request exists for that party |

### 1.3 Business value
| Benefit | Description |
|---|---|
| One number per party | "8 of 11 documents collected" instead of hunting through folders |
| Party-wise *and* deal-wise | Roster view (per customer/consignee) plus transaction view (per opportunity) |
| Shipment split | Deals that reached a shipment are separated from those that have not |
| Buyer ≠ Consignee split | Transactions where the consignee differs from the customer are tracked separately |
| Domestic vs export aware | Each party draws the document set matching **its own** trade type |
| Feeds three other screens | CLM Analytics, Diagnosis & Resolution and the Regulatory Defense File all reuse this aggregation |

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All parties, all tenants |
| Client Admin / Client User | The client's parties; Branch Switcher narrows |
| Branch User | Own branch |
| Employee | The branch's customer/consignee book (Sales is branch-shared) |

Menu slug: `clm.buyer_profile`. The screen is read-only — there are no write endpoints.

---

## 3. THE SIX SECTIONS

The endpoint returns six independent collections, which the page renders as tabs:

```
┌── PARTY ROSTERS ────────────────────────────────────────────────┐
│  buyers      one row per CUSTOMER    + consignee count + ships   │
│  consignees  one row per CONSIGNEE   + parent customer code      │
└─────────────────────────────────────────────────────────────────┘
┌── TRANSACTIONS ─────────────────────────────────────────────────┐
│                        buyer == consignee │ buyer ≠ consignee    │
│  WITH a shipment           ws_eq          │      ws_neq          │
│  WITHOUT a shipment        wos_eq         │      wos_neq         │
└─────────────────────────────────────────────────────────────────┘
```

- **With shipment** = a `ShipmentOrder` exists for that opportunity; the row carries the real `SHP-NNN` code.
- **Buyer == consignee** = the lead has no distinct consignee (or it is flagged *same as customer*).

Every row in all six carries the same five progress ratios.

---

## 4. BUSINESS PROCESS FLOW

```
   INPUTS
     Segments            (name → id, id → regulatory tier)
     Segment rules       keyed [segment_id][domestic|international]
     Evidence Vault      segment_doc_uploads, grouped per owner
     Agreement library   active rows matched per segment
     Trade-doc library   active rows matched per segment
     Completed signature requests (agreement + trade-doc + PI)
        │
        ▼
   FOR EACH PARTY
     1. segment names on the party  → segment ids
     2. party's country → India ? domestic : international
     3. union the required doc codes across all its segments,
        drawing the matching document_type from each segment's rule
     4. count how many of those codes have an upload → kyc/dd/tl/td ratios
     5. applicable agreements for those segments vs completed signatures → agr ratio
        │
        ▼
   FOR EACH TRANSACTION (lead)
     1. lead → latest non-cancelled PI → line items → products → segments
     2. same union + progress maths, but scoped to the lead's segments
     3. a COMPLETED PI signature counts toward the `td` family
     4. bucket by (shipment exists?) × (buyer == consignee?)
        │
        ▼
   OUTPUT  { buyers, consignees, ws_eq, ws_neq, wos_eq, wos_neq }
```

### 4.1 Why the trade type matters
A segment can hold **two** rules — one `domestic`, one `international`. Each party draws the set matching **its own** country (India ⇒ domestic). If a segment only has one of the two configured, the party falls back to whichever exists, so legacy single-type setups keep reporting sensibly.

### 4.2 The regulatory label
A party spanning several segments gets a single tier label: **High** if any of its segments is highly regulated, **Low** if none are, **Both** when it spans both tiers.

### 4.3 Per-party document applicability
A trade document or agreement whose `party` CSV names only `Buyer` counts toward the customer's total and not the consignee's, and vice versa. A **blank** party applies to both — the same rule the Evidence Vault uses.

---

## 5. SCREEN SPECIFICATION (`ClmBuyerProfilePage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Tabs | Buyers · Consignees · With-Shipment (Equal / Not-Equal) · Without-Shipment (Equal / Not-Equal) |
| Roster columns | SR · ID (customer/consignee code) · NAME · SEGMENT chips · COUNTRY · CONSIGNEES count *(buyers)* / PARENT CUSTOMER *(consignees)* · **KYC · DD · TL · TD · AGR** progress · SHIPMENTS |
| Transaction columns | SR · OPP code · CUSTOMER · CONSIGNEE *(neq tabs)* · PI code · SHP code *(ws tabs)* · REGULATORY · the five progress ratios |
| Progress cell | `d / t` with a completion bar; `0/0` means nothing is required |
| Drill-down | A row opens the party's Evidence Vault (`/segment-uploads/{type}/{id}/vault`) |
| Read-only | No create / edit / delete anywhere on the page |

---

## 6. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | The required document set is the **union** across all of a party's segments |
| 2 | The rule chosen per segment matches the party's trade type (India ⇒ `domestic`), falling back to the other type when absent |
| 3 | A document counts as **done** when an upload exists for its `(category, code)` against that party |
| 4 | An agreement counts as done only when a signature request for it reached **`completed`** |
| 5 | A **completed Proforma Invoice signature counts as a signed trade document** — the PI is the shipment's first buyer-side trade doc |
| 6 | Only **active** agreements (`agr_status = 'Active'`) and **active** trade documents count |
| 7 | An agreement/trade doc applies to a segment only when its regulatory tier matches **and** its segment CSV names that segment's name or code |
| 8 | A blank `party` CSV means the document applies to both buyer and consignee |
| 9 | The consignee count on a buyer row excludes consignees flagged *same as customer* |
| 10 | Transactions are bucketed by shipment existence and buyer/consignee equality |
| 11 | Cancelled Proforma Invoices are ignored; the **latest** non-cancelled PI per lead wins |

---

## 7. STATUS MODEL

There is no status of its own — every value is derived. The two axes that classify a transaction row are:
- **Shipment**: a `ShipmentOrder` exists (`ws_*`) or does not (`wos_*`).
- **Party equality**: consignee same as customer (`*_eq`) or distinct (`*_neq`).

---

## 8. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Read-only | Nothing can be fixed from this screen; the user must go to the party's Evidence Vault |
| No filters | The endpoint takes no query parameters — it returns everything for the tenant every time |
| Segment link by **name** | Party segments are stored as a CSV of names; a name that no longer matches a segment silently contributes nothing |
| PI-only transaction segments | Transaction rows resolve segments from the **latest PI** only — a lead still at quotation stage shows no segments |
| `qc` not tracked | The scorecards cover `kyc`, `dd`, `tl`, `td`, `agr`; Quality & Compliance docs are not one of the five families |
| Cost | The whole tenant is aggregated in memory on every call; there is no pagination |

---

*Related documents: CUSTOMER_PROFILE_TECHNICAL_DOCUMENTATION.md · CUSTOMER_PROFILE_CODE_WALKTHROUGH.md · CUSTOMER_PROFILE_API_DOCUMENTATION.md*
