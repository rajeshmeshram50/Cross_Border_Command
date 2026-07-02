# SALES MATRIX — END-TO-END FLOW & STAGE GATES

> Cross_Border_Command SaaS ERP · Sales Matrix (the whole pipeline)
> **One-page understanding doc:** the full flow chart + every *"you cannot move to the next step without this"* gate, in one place.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-02 | System | Initial flow & gates overview |

**Purpose.** New joiners and QA keep asking *"why won't it let me advance?"* — e.g. **you can't leave Stage 3 until you create a Procurement and mark the sourced products done.** This document maps the **entire Sales Matrix** as a flow chart and lists **every hard gate** between steps, with a pointer to the detailed doc for each area.

**Reading order.** §1 the big picture · §2 the 6-stage flow chart · §3 the *"can't proceed without…"* master table · §4 stage-by-stage detail · §5 entity & code dependencies · §6 cross-cutting gates · §7 related documents.

---

## 1. THE BIG PICTURE

A **Lead** becomes an **Opportunity** (`OPP-####`) that flows through **6 stages** inside the Matrix Detail. Along the way it acquires master + document entities that each unlock the next:

```
  Lead Worksheet ("My Workplace")                 Matrix Detail (the 6 stages)
  ───────────────────────────────                 ─────────────────────────────
  Inbound (IndiaMart) / Manual add                 open a lead row ▼
  → assign → qualify                    ┌───────────────────────────────────────────────┐
                                        │ 1 Inquiry → 2 Ack → 3 Sourcing → 4 Price →     │
                                        │ 5 Quotation vs PI → 6 Victory                  │
                                        └───────────────────────────────────────────────┘
  Entities created along the way:
     Customer ─┬─► Consignee (ship-to; optional mirror)
               │
     Products ─┴─► Procurement (Stage 3)  ─►  Quotation (Stage 5) ─► Proforma Invoice (Stage 5)
                                                                          │
                                                                          └─► Shipment Order (Stage 6)
  Compliance runs in parallel: CLM / DCP KYC-DD-Trade-Licence docs gate the Proforma Invoice.
```

> **Boundary:** the **worksheet toolbar** (add/assign/distribute/filter/export) is *outside* the stages; the **6 stages** live *inside* `SalesMatrixDetail`. See `My WorkPlace/lead-worksheet/` vs `My WorkPlace/matrix-stages/`.

---

## 2. THE 6-STAGE FLOW CHART (with the gate on every arrow)

```
        ┌──────────────────────────┐
        │ 1 · INQUIRY RECEIVED      │  fill Task Manager (PDM)
        └──────────────┬───────────┘
           GATE ▶ PDM name + mobile + email present
        ┌──────────────▼───────────┐
        │ 2 · LEAD ACKNOWLEDGEMENT  │  pick reason (Qualified/Clarity/Disqualified)
        └──────────────┬───────────┘
           GATE ▶ the LATEST acknowledgement must be "Qualified"
        ┌──────────────▼───────────┐
        │ 3 · PRODUCT SOURCING      │  map products · set Required/Not-Required
        │                          │  ★ CREATE PROCUREMENT · Mark as Done
        └──────────────┬───────────┘
           GATE ▶ every product has a sourcing status, all products Active,
           GATE ▶ and EVERY "Sourcing Required" product has a Procurement + is Marked Done
        ┌──────────────▼───────────┐
        │ 4 · PRICE SHARED          │  submit a quoted price per product
        └──────────────┬───────────┘
           GATE ▶ a Customer is mapped  AND  ≥ 1 shared price exists
        ┌──────────────▼───────────┐
        │ 5 · QUOTATION vs PI       │  create Quotation → Convert to PI → send for e-sign
        └──────────────┬───────────┘
           GATE ▶ a non-cancelled PI has been SENT for signature or EMAILED
           (to CREATE the PI: mandatory KYC/DD/Trade-Licence docs complete + only one PI per opp)
        ┌──────────────▼───────────┐
        │ 6 · VICTORY               │  celebrate · CREATE SHIPMENT ID (logistics)
        └──────────────────────────┘
           (terminal — won_at stamped on entry · one shipment per opportunity)
```

> **Progression is *earned*.** The stepper never lets you jump ahead of the furthest stage you've completed. After the **PI is e-signed**, the centre stage becomes **read-only** (Stages 3–5 can't be edited); only the toolbar/side-panels and Stage-6 shipment stay live.

---

## 3. "YOU CANNOT PROCEED WITHOUT…" — master gate table

| From → To | You must first… | If you don't | Enforced |
|---|---|---|---|
| **1 → 2** | Capture the **Purchase Decision Maker** (name + mobile + email) in the Task Manager | *Save & Next* disabled; *"Fill in the Purchase Decision Maker details…"* | client + `PUT lead_stage_id` |
| **2 → 3** | Log an acknowledgement whose **latest bucket = Qualified** | *"Qualify the lead first…"* | client + flags |
| **3 → 4** | Give every product a sourcing status, keep all products **Active**, and for each **"Sourcing Required"** product **create a Procurement and Mark as Done** | readiness checklist blocks; *"N sourcing-required product(s) pending"* | client checklist + `mark-sourced` needs a linked procurement |
| **4 → 5** | **Map a Customer** and submit **≥ 1 shared price** | *"…needs a customer + at least one shared price"* | client gate |
| **create a PI** | Complete the customer/consignee **mandatory KYC / DD / Trade-Licence** docs (DCP), and have **no existing non-cancelled PI** on the opp | **422** *"required documents still pending"* / **409** *"already has a PI"* | `ProformaInvoiceController` |
| **5 → 6** | Have a non-cancelled PI that has **at least been sent for signature (a signature request exists) or emailed** — *not necessarily signed* | **422** *"Send the Proforma Invoice … for signature before moving to Victory"* | `SalesLeadController::update()` (~627) |
| **within 6** | Create the **Shipment Order** (one per opportunity) | **409** on a second shipment | `ShipmentOrderController` |
| **any stage ≥ 4** | (blocking rule) you **cannot unmap a product** once Stage 3 is complete | **422** *"Product Sourcing (Stage 3) is already complete"* | `destroyLeadProduct()` |

> The row you flagged: **Stage 3 → 4 is the procurement gate.** A product you mark *Sourcing Required* stays "pending" until a **Procurement (`PROC-###`)** is created and the product is **Marked as Done**; the stage won't advance while any Required product is still pending. Products marked *Not Required* need no procurement.

---

## 4. STAGE-BY-STAGE DEPENDENCY DETAIL

### Stage 1 — Inquiry Received
- **Do:** fill the **Task Manager** (PDM name, mobile 6–15 digits, email; + order value / buying plan / attachment) — it's on the *right* panel, not the stage body.
- **Gate:** PDM name **+** mobile **+** email. → `PUT lead_stage_id: 2`.

### Stage 2 — Lead Acknowledgement
- **Do:** pick a status pill (Qualified / Clarity Pending / Disqualified±) → choose reasons from the **Lead Acknowledgement Master**; each selection appends an activity row and flips the lead's qualified/disqualified flags.
- **Gate:** the **latest** acknowledgement must be **Qualified**.

### Stage 3 — Product Sourcing  ← the "create procurement" step
- **Do:** map products; on the **Product Details** tab set each to **Sourcing Required** or **Not Required**; on **Sourcing Required** tab **+ Create** (single) or **+ Create Group Procurement** → then **✓ Mark as Done**; optionally map vendors.
- **Auto-assist:** a product with exactly **one** vendor mapping is auto-assigned a vendor on procurement.
- **Gate (all must pass):** ① at least one product mapped · ② every product has a sourcing status · ③ all products **Active** · ④ **every Required product has a linked Procurement and is Marked Done**. Only then → `PUT lead_stage_id: 4`.
- **Lock created here:** from Stage 4 onward the **product list is frozen** (unmapping → 422) so it can't orphan quotation/PI lines.

### Stage 4 — Price Shared
- **Do:** enter a **Quoted Price** per product and **Submit** (append-only history; barcoded `Q-#####` PDF available). Draft/Inactive/Pending products are blocked.
- **Gate:** a **Customer is mapped** (from the toolbar) **and ≥ 1 shared price** exists. → `PUT lead_stage_id: 5`. *(Consignee can be set later in the Quotation form.)*

### Stage 5 — Quotation vs PI
- **Do:** **Create Quotation** (`QT/FY/SEQ`) → **Convert to PI** (`PI/FY/SEQ`, copies fields + line items) → **Send for Signature** (Zoho) and/or **Email** (60-day signed link).
- **Create-PI gates:** ① mandatory **KYC/DD/Trade-Licence** docs for customer & consignee complete (DCP) · ② **only one non-cancelled PI per opportunity**. *Create Quotation* also greys out once a PI exists.
- **Gate to advance:** a non-cancelled PI **sent for signature or emailed**. → `PUT lead_stage_id: 6` (arms the Victory confetti).

### Stage 6 — Victory (terminal)
- **Do:** celebrate; **Create Shipment ID** (`SHP-###`) — the modal auto-fills from the latest PI (opp/PI codes, customer/consignee, inco term, ports, origin, freight).
- **Rule:** **one shipment per opportunity** (409 on a second). `won_at` was stamped on entering Stage 6; regressing below 6 clears it.

---

## 5. ENTITY & CODE DEPENDENCIES

```
Customer (C-####) ──┬── Consignee (CN-####)   [optional; "Same as Customer" mirror copies KYC]
                    │
Lead (OPP-####) ────┴── LeadProduct ──► Procurement (PROC-###) ──► ProcurementProduct → Vendor
        │
        ├── Quotation (QT/FY/SEQ) ──► ProformaInvoice (PI/FY/SEQ) [+ BT-#### if with-shipment]
        │                                     │
        └─────────────────────────────────────┴──► ShipmentOrder (SHP-###)
```

| Entity | Code | Allocated | Doc |
|---|---|---|---|
| Customer | `C-####` | per-client row lock | `customer/` |
| Consignee | `CN-####` | per-client row lock | `consignee/` |
| Opportunity/Lead | `OPP-####` | per-client row lock | `My WorkPlace/lead-worksheet/` |
| Procurement | `PROC-###` | per-client | `My WorkPlace/matrix-stages/` |
| Quotation | `QT/FY/SEQ` | row lock + advisory | `masters-and-documents/QUOTATION.md` |
| Proforma Invoice | `PI/FY/SEQ` (+ `BT-####`) | row lock + advisory | `masters-and-documents/PROFORMA_INVOICE.md` |
| Shipment Order | `SHP-###` | per-branch | `My WorkPlace/matrix-stages/` |
| Meeting / Reminder | `M-###` / `P-###` | per-client | `My WorkPlace/matrix-stages/` |

**Key dependency:** the **PI depends on** a live Quotation (or standalone), **complete DCP docs**, and **one-per-opp**; **Victory depends on** the PI being sent for signature; **Shipment depends on** the PI.

---

## 6. CROSS-CUTTING GATES (apply across stages)

| Gate | Rule |
|---|---|
| **Earned progression** | Can't skip ahead of the furthest completed stage (the stepper no-ops locked steps) |
| **PI-signed lock** | Once the PI is e-signed, Stages 3–5 are read-only; only Shipment + toolbar stay live |
| **Product list lock** | After Stage 3 (`lead_stage_id ≥ 4`) products can't be unmapped (422) |
| **DCP compliance** | No PI until mandatory KYC/DD/Trade-Licence docs are uploaded for the parties |
| **One-per-opportunity** | One non-cancelled PI, and one shipment, per opportunity (409) |
| **Server-side totals** | Line `amount = qty × rate × (1+tax%/100)`; header totals recomputed server-side |
| **Segment (Buyer≠Consignee)** | Can't map a consignee/customer that violates a product's segment rule (422) |
| **Tenant isolation** | Every read/write scoped by `client_id`/`branch_id` + sales visibility tier |
| **Signed PDF links** | Customer-facing quotation/PI links are signed and expire after 60 days |

---

## 7. RELATED DOCUMENTS (where to go deeper)

| Area | Folder / file |
|---|---|
| **Worksheet** (add/assign/distribute/filter/export, CTQ, visibility) | `My WorkPlace/lead-worksheet/` (Functional · Technical · API · Code-Walkthrough) |
| **The 6 stages inside the Matrix** (Quotation/PI/Procurement/Shipment/PDF/e-sign) | `My WorkPlace/matrix-stages/` |
| **Lead Acknowledgement Master** (Stage-2 reasons) | `masters-and-documents/LEAD_ACKNOWLEDGEMENT_MASTER.md` |
| **Quotation** (combined) | `masters-and-documents/QUOTATION.md` |
| **Proforma Invoice** (combined) | `masters-and-documents/PROFORMA_INVOICE.md` |
| **Customer** (Stage-A entity + KYC + GST scrutiny) | `customer/` |
| **Consignee** (ship-to + Same-as-Customer mirror + Evidence Vault) | `consignee/` |

> **Correction captured here:** the Victory gate is *"PI sent for signature or emailed"*, **not** *"PI signed"* — verified in `SalesLeadController::update()`. The stage-level docs use the same wording.

---

*This is the umbrella overview. Each arrow/gate above links to a module doc that walks the real code paths.*
