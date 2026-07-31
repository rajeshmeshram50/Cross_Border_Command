# REGULATORY DEFENSE FILE (RDF) — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → CLM Command Center → **Regulatory Defense File**
> Route `/clm/regulatory-defense` · Endpoint `GET /api/clm/regulatory-defense`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The **Regulatory Defense File** is the audit-ready evidence repository. Its name is literal: if a regulator, auditor or counterparty's lawyer asks *"show me everything you hold for this shipment"*, this is the screen that produces it.

Every other CLM screen answers a *forward-looking* question — what is required, what is missing, what needs approving. The RDF answers a *backward-looking* one:

> *For this transaction, who were all the parties, and where is every document we hold for each of them?*

The distinctive output is the **`vault` array** on every row: a ready-made list of Evidence-Vault drill-down targets — Buyer, Consignee and each Supplier involved — so one row expands into every party's document drawer.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Defensible in one place | Every party on a deal, and every document held for them, from one row |
| Full supply chain per shipment | A shipment expands to all its procurements and every supplier in each |
| Multi-party vault tabs | The drawer opens Buyer / Consignee / Supplier tabs without further lookups |
| Reuses the profile maths | Compliance fractions are the profile screens' fractions — no second source of truth |
| Covers all three deal shapes | Shipment-linked, procurement-only, and standalone contracts |

### 1.3 The three tabs
```
┌──────────────────────────────────────────────────────────────────────┐
│  with_shipment      shipment-linked records                           │
│                     buyer row ⨝ every procurement ⨝ every supplier    │
│                     vault: Buyer · Consignee · Supplier (each)        │
├──────────────────────────────────────────────────────────────────────┤
│  without_shipment   procurement-wise supplier records + compliance    │
│                     the five {d,t} ratios per supplier                │
│                     vault: Supplier                                    │
├──────────────────────────────────────────────────────────────────────┤
│  case_to_case       per-deal agreement records                        │
│                     EVERY counterparty becomes a vault tab            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All data, all tenants |
| Client Admin / Client User | The client's data; Branch Switcher narrows |
| Branch User | Own branch |
| Employee | The branch's book |

Menu slug: `clm.regulatory_defense`. The screen is entirely **read-only** — the per-record Evidence Vault is served by the existing `/segment-uploads/{type}/{id}/vault` endpoint; this controller only builds the three index lists.

---

## 3. BUSINESS PROCESS FLOW

```
   GET /clm/regulatory-defense
        │
        ├── with_shipment    ← Customer Profile's ws_eq + ws_neq rows,
        │                       then EXPANDED:
        │        lead ─▶ every Procurement raised under it
        │                  ─▶ every ProcurementProduct
        │                       ─▶ every Vendor mapped to that product
        │        so one opportunity shows ALL its procurement ids and
        │        ALL its suppliers stacked in one row
        │
        ├── without_shipment ← Supplier Profile's txn_wos_mat + txn_wos_logi
        │                       + txn_wos_svc rows, carrying their compliance
        │                       fractions unchanged
        │
        └── case_to_case     ← every CTC contract, with EVERY counterparty
                               resolved into an Evidence-Vault target
        │
        ▼
   USER OPENS A ROW
        │
        ▼
   The row's `vault` array names each party drawer to open:
        GET /segment-uploads/customer/{id}/vault
        GET /segment-uploads/consignee/{id}/vault
        GET /segment-uploads/vendor/{id}/vault
```

### 3.1 Why a shipment row is "expanded"
A single opportunity may have several procurements, and each procurement may draw on several suppliers. Earlier the row collapsed to one supplier; now **every** procurement id and **every** supplier is stacked into the same row, so the defence file for that shipment is genuinely complete.

Suppliers are de-duplicated by vendor id both within a procurement and across the whole row's vault list, so a vendor supplying two products in two procurements appears once in the drawer.

### 3.2 The RDF reference codes
| Tab | Reference | Note |
|---|---|---|
| `with_shipment` | `RDF-001`, `RDF-002` … | Sequential **within the response**, not stored |
| `without_shipment` | `RDF-001`, `RDF-002` … | Its own sequence, restarting at 001 |
| `case_to_case` | `RDF-C-001`, `RDF-C-002` … | Distinct `C-` prefix |

These are **display references generated per request** — they are not persisted and will change if the underlying data changes.

### 3.3 Vault tab labelling
- One supplier on a row → the tab reads simply **"Supplier"**.
- Two or more → each reads **"Supplier · Agro Mills Pvt Ltd"** so they are distinguishable.
- On the Case-to-Case tab, each counterparty's tab is labelled by **its own name**, falling back to its role — so a deal with two buyers still reads clearly.

---

## 4. SCREEN SPECIFICATION (`ClmRegulatoryDefenseFilePage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Title + collapsible "What We Are Doing Here" brief |
| Tabs | **With Shipment ID** · **Without Shipment ID** · **Case to Case** |
| With-shipment columns | RDF REF · SHIPMENT · OPPORTUNITY · CUSTOMER · CONSIGNEE · PI · PROCUREMENTS (each with its suppliers and PO) |
| Without-shipment columns | RDF REF · PROCUREMENT · SUPPLIER · PO · VTI · KYC · DD · TL · TD · AGR |
| Case-to-case columns | RDF REF · CTC CODE · TITLE · COUNTERPARTY · ROLE |
| Evidence drawer | Opens the party tabs named in the row's `vault` array |
| Read-only | No create / edit / delete |

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | The buyer and supplier aggregations are reused **verbatim** from the two profile controllers |
| 2 | A with-shipment row is built from `ws_eq + ws_neq` and expanded with every procurement and every supplier under its lead |
| 3 | Suppliers are de-duplicated by vendor id, both per procurement and across the row's vault list |
| 4 | A without-shipment row comes from the supplier profile's three `txn_wos_*` collections, carrying their `{d,t}` fractions unchanged |
| 5 | A case-to-case row exposes **every** counterparty as a vault tab, de-duplicated by resolved `(type, id)` |
| 6 | A counterparty reference resolves by numeric primary key **or** by party code (`C-009`, a `vendor_code`, a `consignee_code`) |
| 7 | Only Customer, Consignee and Vendor counterparties are vault-backed; anything else is skipped |
| 8 | RDF references are generated per response and are **not persisted** |
| 9 | `PROC-NNN` codes are synthesised from procurement primary keys |
| 10 | `PO` and `VTI` columns always render `—` — no source field is wired |

---

## 6. STATUS MODEL

The RDF has no status of its own. The `{d, t}` fractions on the without-shipment tab are the Supplier Profile's fractions, unchanged.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| **No compliance fractions on the with-shipment tab** | Shipment rows carry parties and procurements but **not** the five `{d,t}` ratios — those are on the without-shipment tab only |
| PO / VTI columns | Hard-coded to `—`; the underlying fields are not wired |
| Reference codes are ephemeral | `RDF-NNN` is generated per request and changes as data changes |
| No filters | The endpoint takes no query parameters; the whole tenant is aggregated every load |
| Heaviest read in CLM | Both profile aggregations run on every request |
| Coarse role badge | On the case-to-case tab a consignee is labelled **Partner**, not Consignee |
| First counterparty only in the column | The `counterparty` column shows the first; the vault tabs show all |
| Unresolvable references are dropped silently | A counterparty whose source record no longer exists simply produces no vault tab |
| `qc` not tracked | Quality & Compliance documents are not one of the five reported families |

---

*Related documents: REGULATORY_DEFENSE_FILE_TECHNICAL_DOCUMENTATION.md · REGULATORY_DEFENSE_FILE_CODE_WALKTHROUGH.md · REGULATORY_DEFENSE_FILE_API_DOCUMENTATION.md*
