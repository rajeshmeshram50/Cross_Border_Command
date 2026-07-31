# REGULATORY DEFENSE FILE (RDF) — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → CLM Command Center → **Regulatory Defense File**
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Menu slug `clm.regulatory_defense` gates the UI.
- **Read-only module** — one endpoint, **no query parameters**.
- Success: `{ status: true, data: { with_shipment, without_shipment, case_to_case } }`.
- Codes: 200 · 401.
- The per-record Evidence Vault is **not** served here — it is `GET /segment-uploads/{type}/{id}/vault`.

---

## 2. ENDPOINT INDEX

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/regulatory-defense` | The three index lists |

Drill-down (owned by `SegmentDocUploadController`):

| Method | Path |
|---|---|
| GET | `/segment-uploads/customer/{id}/vault` · `/consignee/{id}/vault` · `/vendor/{id}/vault` |

---

## 3. GET `/clm/regulatory-defense`

**200**
```json
{
  "status": true,
  "data": {
    "with_shipment": [
      { "rdf": "RDF-001",
        "ship": "SHP-001",
        "opp": "OPP-0341",
        "customer": "Royal Cashews Pvt Ltd",
        "consignee": "Royal Logistics FZE",
        "pi": "PI/25-26/0042",
        "procs": [
          { "proc": "PROC-011",
            "suppliers": [
              { "id": 77, "name": "Agro Mills Pvt Ltd", "code": "V-014" },
              { "id": 92, "name": "Nova Logistics",     "code": "V-021" }
            ],
            "po": "—" },
          { "proc": "PROC-014",
            "suppliers": [ { "id": 77, "name": "Agro Mills Pvt Ltd", "code": "V-014" } ],
            "po": "—" }
        ],
        "vault": [
          { "key": "buyer",       "label": "Buyer",                        "type": "customer",  "id": 88 },
          { "key": "consignee",   "label": "Consignee",                    "type": "consignee", "id": 51 },
          { "key": "supplier-77", "label": "Supplier · Agro Mills Pvt Ltd","type": "supplier",  "id": 77 },
          { "key": "supplier-92", "label": "Supplier · Nova Logistics",    "type": "supplier",  "id": 92 }
        ] }
    ],

    "without_shipment": [
      { "rdf": "RDF-001",
        "proc": "PROC-023",
        "supplier": "Agro Mills Pvt Ltd",
        "po": "—",
        "vti": "—",
        "kyc": { "d": 3, "t": 4 },
        "dd":  { "d": 1, "t": 3 },
        "tl":  { "d": 2, "t": 2 },
        "td":  { "d": 0, "t": 1 },
        "agr": { "d": 1, "t": 1 },
        "vault": [ { "key": "supplier", "label": "Supplier", "type": "supplier", "id": 77 } ] }
    ],

    "case_to_case": [
      { "rdf": "RDF-C-001",
        "ctc": "CTC-004",
        "title": "Mutual Non-Disclosure Agreement",
        "counterparty": "Royal Cashews",
        "role": "Buyer",
        "vault": [
          { "key": "customer#88",  "label": "Royal Cashews",      "type": "customer",  "id": 88 },
          { "key": "consignee#51", "label": "Royal Logistics FZE","type": "consignee", "id": 51 }
        ] }
    ]
  }
}
```

---

## 4. THE `vault` ARRAY — the module's key output

Every row in all three tabs carries a `vault` array. Each entry is a ready-made Evidence-Vault drill-down target:

| Field | Meaning |
|---|---|
| `key` | Stable tab key — `buyer`, `consignee`, `supplier-{id}`, or `{type}#{id}` on case-to-case rows |
| `label` | The tab caption shown to the user |
| `type` | `customer` \| `consignee` \| `supplier` — the `{type}` path segment |
| `id` | The numeric party id — the `{id}` path segment |

```
vault entry  { "type": "supplier", "id": 77 }
             ↓
GET /segment-uploads/vendor/77/vault
```

| `type` | Vault path segment |
|---|---|
| `customer` | `/segment-uploads/customer/{id}/vault` |
| `consignee` | `/segment-uploads/consignee/{id}/vault` |
| `supplier` | `/segment-uploads/vendor/{id}/vault` |

All party resolution has already been done server-side — the page performs none of its own.

### Labelling
- **One** supplier on a row → the tab reads simply `"Supplier"`.
- **Two or more** → each reads `"Supplier · <company name>"`.
- On **case-to-case** rows every tab is labelled by the counterparty's own name (falling back to its role), so a deal with two buyers reads clearly.

Suppliers are de-duplicated by vendor id twice — within a procurement and across the whole row — so a vendor supplying several products across several procurements appears **once**.

---

## 5. TAB 1 — `with_shipment`

Built from the Customer Profile's `ws_eq` + `ws_neq` rows, then **expanded** down the supply chain:

```
lead ─▶ every Procurement raised under it
          ─▶ every ProcurementProduct
               ─▶ every Vendor mapped to that product
```

| Field | Meaning |
|---|---|
| `rdf` | `RDF-NNN` — a **per-response** display reference, not persisted |
| `ship` | The real `shipment_orders.shipment_code` |
| `opp` | The opportunity code |
| `customer` / `consignee` | Party names; `consignee` falls back to the customer when there is no distinct one |
| `pi` | The latest non-cancelled Proforma Invoice code |
| `procs[]` | `{ proc: "PROC-NNN", suppliers: [{id,name,code}], po: "—" }` |
| `vault[]` | Buyer + Consignee + every distinct supplier |

> **This tab carries no compliance fractions.** Shipment rows list parties and procurements; the five `{d, t}` ratios appear only on `without_shipment`.

---

## 6. TAB 2 — `without_shipment`

A flattening of the Supplier Profile's `txn_wos_mat`, `txn_wos_logi` and `txn_wos_svc` collections, in that order, with their compliance fractions passed through unchanged.

| Field | Meaning |
|---|---|
| `rdf` | `RDF-NNN` — **its own sequence**, restarting at 001 (so `RDF-001` exists on this tab *and* on `with_shipment`) |
| `proc` | `PROC-NNN`, synthesised from the procurement primary key |
| `supplier` | Vendor company name |
| `po` | Always `"—"` — not wired |
| `vti` | Always `"—"` — this is the supplier profile's `inv` field, **renamed** |
| `kyc` `dd` `tl` `td` `agr` | `{ d, t }` — the Supplier Profile's per-vendor fractions |
| `vault[]` | A single supplier target (empty when the vendor id is missing) |

---

## 7. TAB 3 — `case_to_case`

One row per CTC contract, newest first.

| Field | Meaning |
|---|---|
| `rdf` | `RDF-C-NNN` — note the distinct `C-` prefix |
| `ctc` | The contract code (`CTC-NNN`) |
| `title` | Contract title, `—` when blank |
| `counterparty` | The **first** counterparty's name only |
| `role` | `Buyer` \| `Supplier` \| **`Partner`** |
| `vault[]` | **Every** resolvable counterparty, de-duplicated by `(type, id)` |

### Two different role mappings
| Purpose | Mapping |
|---|---|
| The `role` **column** (cosmetic) | `buy…`/`customer` → **Buyer** · `supp…`/`vendor` → **Supplier** · everything else → **Partner** |
| The `vault` **targets** (functional) | `buy…`/`customer` → `customer` · `consign…` → **`consignee`** · `supp…`/`vendor` → `supplier` |

So a row can display `role: "Partner"` for a consignee while its vault correctly opens a **Consignee** tab. The badge is cosmetic; the vault entry is what actually resolves.

### Counterparty reference resolution
A counterparty's `source_id` may be a **numeric primary key** or a **party code** (`C-009`, a `vendor_code`, a `consignee_code`). Code lookups are `client_id`-scoped, so a code cannot resolve across tenants. Counterparties that are not vault-backed, or whose reference cannot be resolved, are **silently skipped** — a row may therefore show fewer vault tabs than it has counterparties.

---

## 8. QUICK REFERENCE

```
GET /clm/regulatory-defense
    → data.with_shipment      RDF-NNN · SHP · OPP · customer/consignee · PI
                              · procs[] (PROC-NNN + suppliers[]) · vault[]
    → data.without_shipment   RDF-NNN · PROC-NNN · supplier · kyc/dd/tl/td/agr · vault[]
    → data.case_to_case       RDF-C-NNN · CTC-NNN · counterparty · role · vault[]

# then, per vault entry
GET /segment-uploads/customer/{id}/vault
GET /segment-uploads/consignee/{id}/vault
GET /segment-uploads/vendor/{id}/vault
```

---

## 9. NOTES (caveats)

1. **Read-only** — one GET, **no query parameters**: no filters, no date range, no pagination, no branch narrowing.
2. The buyer and supplier aggregations are produced by calling those controllers **in-process** (method injection), so tenant scoping and the compliance maths are inherited, not re-implemented.
3. This endpoint therefore carries the cost of **both** of CLM's heaviest reads on every call.
4. **`RDF-NNN` references are generated per response**, restart at 001 on each tab, and are **not persisted** — never treat them as stable identifiers.
5. `PROC-NNN` is synthesised from the procurement primary key, not a stored code.
6. `po` and `vti` always render `"—"` — the source fields are not wired.
7. The **with-shipment tab carries no `{d, t}` fractions**; only `without_shipment` does.
8. The `counterparty` column shows the **first** counterparty; `vault[]` carries them all.
9. **Consignees are badged `Partner`** in the `role` column, though their vault target resolves correctly as `consignee`.
10. Unresolvable or non-vault-backed counterparties are dropped silently.
11. `qc` (Quality & Compliance) is not one of the five reported document families.

---

*Related documents: REGULATORY_DEFENSE_FILE_FUNCTIONAL_DOCUMENTATION.md · REGULATORY_DEFENSE_FILE_TECHNICAL_DOCUMENTATION.md · REGULATORY_DEFENSE_FILE_CODE_WALKTHROUGH.md*
