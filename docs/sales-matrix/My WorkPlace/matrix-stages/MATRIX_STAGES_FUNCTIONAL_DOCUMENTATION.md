# MATRIX STAGES MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Opportunity Pipeline (the 6 stages *inside* the Matrix Detail)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
This module is the **opportunity pipeline detail** — the deep, per-opportunity workspace opened by clicking a lead in the Lead Worksheet. It runs a single opportunity through **6 stages**: Inquiry Received → Lead Acknowledgement → Product Sourcing → Price Shared → Quotation vs PI → Victory. Each stage has its own sub-workspace, gate, and data; the surrounding **Matrix Detail** shell adds a customer banner, a step tracker, a left **CLM** panel (customer/consignee KYC + agreements) and a right **Task Manager** panel.

> **Boundary:** these stages live **inside** `SalesMatrixDetail` (route `/sales/matrix/{oppId}/stage/{stage}`) — separate from the Lead Worksheet toolbar (Add/Assign/Distribution/Filter). This doc set is the "inside the stages" KT.

### 1.2 Business Value

| Benefit | Description |
|---|---|
| End-to-end deal execution | One screen carries a lead from inquiry to quotation, PI, procurement and shipment |
| Gated progression | Each stage must be completed before the next unlocks — enforced client- and server-side |
| Compliance built in | Creating a PI requires the customer/consignee's mandatory KYC docs (DCP gate) |
| Auditable documents | Quotations/PIs carry FY-scoped codes, versions, e-signature status, and email/reminder history |
| Signed-doc delivery | Customer-facing quotation/PI PDFs are delivered via 60-day signed links + e-signature |
| Win capture | Victory stage records the shipment order and stamps the deal won |

### 1.3 Key Features
- **6-stage stepper** with earned progression (future stages locked until the current one is complete) and a **PI-signed read-only lock**.
- **3-zone layout** — left CLM (customer/consignee KYC vault tallies + agreements/trade-doc signing), center stage, right Task Manager (Purchase Decision Maker capture).
- **Stage 1 Inquiry** — Task Manager (PDM name/mobile/email + order value/buying plan + attachment) and WhatsApp status.
- **Stage 2 Acknowledgement** — qualify/clarity/disqualify via reason picker; append-only activity log.
- **Stage 3 Sourcing** — map products, set sourcing Required/Not-Required, create procurements, mark sourced, vendor mapping.
- **Stage 4 Price Shared** — record quoted prices per product (append-only) with barcoded PDF.
- **Stage 5 Quotation vs PI** — create/edit quotations & PIs, convert Quotation→PI, e-sign (Zoho), email/remind, download signed PDF + certificate.
- **Stage 6 Victory** — celebration (RupeeRain), deal summary + KPIs, and shipment-order capture (logistics).

---

## 2. USER ROLES & PERMISSIONS
Reached from the worksheet (gated by `sales.workplace`). Within the stages, every write is tenant-scoped (`client_id`/`branch_id`) and role-scoped (`SalesVisibility`). Toolbar actions (Change Owner, Remark, Key Opportunity, Reminders, Meetings, WhatsApp, agreement send) stay available even when the center is PI-locked; only the **center stage** goes read-only after the PI is signed.

---

## 3. THE 6 STAGES (each with its gate)

### 3.0 At-a-glance

| # | Stage | What the user does | Gate to advance |
|---|---|---|---|
| 1 | **Inquiry Received** | Read the captured inquiry; fill **Task Manager** (PDM name/mobile/email) on the right | PDM name + mobile + email present |
| 2 | **Lead Acknowledgement** | Pick acknowledgement reasons (Qualified / Clarity Pending / Disqualified±) | **Latest** acknowledgement must be *Qualified* |
| 3 | **Product Sourcing** | Map products, set each **Sourcing Required / Not Required**, create procurements, **Mark as Done** | All products have a status; every *Required* one is procured |
| 4 | **Price Shared** | Submit a **quoted price** per product (append-only) + view PDF | Customer mapped **and** ≥1 shared price |
| 5 | **Quotation vs PI** | Create quotation, **Convert to PI**, send for e-signature, email/remind | A non-cancelled PI has been **sent for signature or emailed** (+ mandatory KYC complete to create the PI) |
| 6 | **Victory** | Celebrate; capture the **Shipment Order** (logistics) | — (terminal; `won_at` stamped) |

> **PI-signed lock:** once the PI is e-signed, the center stage becomes **read-only** (Stages 3–5 can't be edited); Shipment capture in Stage 6 stays open. The stepper lets you revisit any completed stage, but not jump ahead of the furthest earned stage.

Each stage is detailed below: what's on screen, the inputs, the exact **Save & Next** gate, and the rules.

---

### 3.1 Stage 1 — Inquiry Received
**Purpose:** confirm the captured inquiry and capture the buyer's decision-maker.

**On screen (read-only):**
- **Opportunity Details** cards — Opportunity ID, Opportunity Date, Customer Name, Buying Plan (date, `—` if missing), Order Value (Indian-format ₹, e.g. `₹7,00,000`).
- **Purchase Decision Maker (PDM)** cards — Name, Mobile Number, Email. Empty state prompts: *"No Purchase Decision Maker captured yet — fill the Task Manager panel on the right."*
- A status badge (QUALIFIED / DISQUALIFIED / PENDING) mirrors the lead header.

**Input:** the stage itself has **no editable fields** — the PDM is entered in the **Task Manager** panel on the right (Name, Mobile 6–15 digits, Email, plus Order Value / Buying Plan / attachment) and posts to `POST /sales/leads/{id}/task-manager` (upsert — one PDM per lead; a new attachment replaces the old on disk).

**Gate → Stage 2:** PDM **Name + Mobile + Email** must all be present. Otherwise *Save & Next* is disabled and warns *"Fill in the Purchase Decision Maker details to proceed."* On success it persists `lead_stage_id = 2`.

---

### 3.2 Stage 2 — Lead Acknowledgement
**Purpose:** qualify (or disqualify) the lead, with an audited reason trail.

**On screen:**
- Three **status pills** — **Qualified Lead** (violet), **Clarity Pending** (amber), **Disqualified** (red).
- Clicking a pill opens a **reason picker** (multi-select from the reasons master). For **Disqualified** the reasons split two columns by `dq_status` — *Negative Status* (red) / *Positive Status* (green); Qualified/Clarity show a single list. *Confirm* is disabled until ≥1 reason is ticked.
- **Activity Report** table (append-only) — `#` · Date · Status (color pill) · Reason (snapshot text), with a count badge; *"No activity yet"* when empty.

**Behaviour:** *Confirm* creates **one activity row per selected reason** (`POST /sales/leads/{id}/acknowledgements`), optimistically shown, then flips the lead's `qualified`/`disqualified` flags to match the chosen bucket. It does **not** move the stage — the SPA's *Save & Next* does.

**Gate → Stage 3:** the **latest** acknowledgement must be **Qualified** (`opportunity_type = 'qualified'`). Otherwise it warns *"Qualify the lead first…"* (or *"Acknowledge the lead first…"* if none exist).

---

### 3.3 Stage 3 — Product Sourcing
**Purpose:** decide which mapped products need sourcing and procure them.

**Three tabs:**
1. **Product Details** — every mapped product: SR# · Code · Product Name (+ category) · Status · Qty · Target Price · Currency · **Sourcing Status** dropdown (`— Select —` / *Sourcing Required* / *Not Required*) · **Set** indicator. A `X / Y set` progress bar. *(Rule: an **Inactive** product can only be set **Sourcing Required** — the dropdown hides Not Required.)*
2. **Sourcing Required** — warning banner + table adding **Procurement ID** (`—` or a clickable `PROC-###` chip → details modal), a state cell (`— pending` / **✓ Mark as Done** / **✓ Done**), **Vendor** count chip (→ vendor-mappings modal), and an **Action** (`+ Create` / `✓ Created`). With 2+ unchecked rows a **+ Create Group Procurement [N]** CTA appears. Progress bar `X / Y done`.
3. **Sourcing Not Required** — SR#/Code/Name/Status/Qty/Target/Currency/Vendor + a static **Ready** badge and a **revert** action (*Convert to Sourcing Required*).

**Readiness checklist** (below the tabs) lists every blocker, each with a jump CTA: *Map at least one product* · *N product(s) need a sourcing status → Go to Product Details* · *N product(s) not active* · *N sourcing-required product(s) pending → Go to Sourcing Required*.

**Actions:** set status → `PATCH …/products/{m}/sourcing-status`; create procurement (single/group) → `POST /procurements` (a product with exactly **one** vendor mapping is **auto-assigned**); mark sourced → `PATCH …/products/{m}/mark-sourced`.

**Gate → Stage 4:** **all** readiness checks pass — products mapped, every product has a sourcing status, all products Active, and **every *Required* product is marked done**. Footer confirms *"✓ Ready : All checks passed"* or *"⚠ N pending…"*. *(After this stage the product list locks — `lead_stage_id ≥ 4` → unmapping returns 422.)*

---

### 3.4 Stage 4 — Price Shared
**Purpose:** record the quoted price sent to the customer, per product.

**Two tabs:**
- **Price To Be Share** — each mapped product with a **Quoted Price** input (currency chip + numeric, `≥ 0`) and a per-row **Submit**. A per-row **eye** icon (with a submit-count badge) opens that product's **History View** (Date/Time · Qty · Target · Quoted + View/Download PDF). *(Draft / Inactive / Pending products are blocked — row dimmed, input & Submit disabled.)*
- **Shared Price** — append-only history across the whole lead: Sr · Code · Name · Date & Time · Qty · Target · Quoted · **View/Download PDF** (barcoded `Q-#####`, tenant-branded).

**Behaviour:** Submit appends a `LeadProductSharedPrice` row (`POST …/products/{m}/shared-prices`, `quoted_price > 0`) — append-only (prices are never overwritten).

**Gate → Stage 5:** a **customer must be mapped** (from the toolbar) **and ≥ 1 shared price** exists — else it warns and switches to *Price To Be Share*. *(Consignee is not required here; it can be set in the Create-Quotation form in Stage 5.)*

---

### 3.5 Stage 5 — Quotation vs PI
**Purpose:** produce the quotation, convert it to a Proforma Invoice, and get it e-signed.

**On screen:**
- A **Quotation / Proforma Invoice** segmented toggle (each with a live count), a **View Latest Quoted Price Summary** button, and two create buttons.
- **Create Quotation** — greyed once a PI exists or the deal is locked. **Create PI** — greyed if locked, a PI already exists (**one PI per opportunity**), or the **mandatory KYC / Due-Diligence / Trade-Licence docs** for customer & consignee aren't 100% uploaded (DCP gate). Clicking a greyed button explains the blocker.
- The create wizard is pre-fed the lead's **already-mapped customer & consignee** (never re-typed).
- **Quotation table:** Sr · Quotation No (→ edit) · Date · Doc Type · Currency · Value · Action (**Convert to PI**; terminal chips *Converted to PI* / *Cancelled* lock the row).
- **PI table:** adds **Converted From** (source quotation code), **Status** e-signature pill, and per-row actions.

**E-signature (Zoho, auto-syncs ~every 20s):** the PI status pill runs **Not Sent → Sent → Signed**. *Not Sent* exposes **Send for Signature**; *Sent* shows **View sent doc** + **Remind**; *Signed* exposes **View/Download signed PDF + Certificate** in the 3-dot menu. Signed / in-progress documents are **read-only** (no edit/delete). Per-row **Email** is rate-limited **3/min** (429 → cooldown).

**Gate → Stage 6:** a non-cancelled PI must have been **sent for signature (a signature request exists) or emailed** — *not necessarily signed*. No PI → *"Moving to Victory needs a Proforma Invoice — a quotation alone isn't enough."* PI that was never sent/emailed → blocked server-side (`SalesLeadController::update()`). On success it advances to Stage 6 and arms the Victory confetti. *(A **completed** e-signature is a separate thing — it stamps `pi_signed_at`, which makes Stages 3–5 read-only.)*

---

### 3.6 Stage 6 — Victory
**Purpose:** celebrate the win and capture the shipment order. **Terminal stage — no Save & Next.**

**Pre-shipment view:**
- **Celebration panel** — bobbing trophy, *Congratulations!*, *"Won on {date}"*, and the **Create Shipment ID** CTA. Confetti fires **once per lead** (localStorage-gated) and re-fires on shipment creation.
- **Deal Summary** — Opportunity ID · Customer · Won Date · Latest Quotation (code chip) · Latest PI (code chip) · Deal Value · Consignee · Status (● Won).
- **KPI strip** — Products · Quotations · PI Issued · **Days** (opportunity-created → PI-signed).

**Create Shipment modal** (auto-filled from the latest PI — opp/PI codes & dates, customer/consignee, inco term, ports, origin, freight from the PI's shipping cost): the user confirms **Shipping Liability, Cold Chain, Zip Code, Freight Cost, Shipping Mode, Remarks, Attachments** → `POST /sales/shipment-orders` (`SHP-###`, **one shipment per opportunity → 409 on a second**).

**Post-shipment view:** a success banner with the `SHP-###` chip plus three cards — **Shipment Details** (id/dates/PI/created-by/deal value), **Inquiry Details** (customer & consignee id/name/country), and **Logistics Instructions** (liability, cold chain, zip, freight, mode, inco term, ports, destination, origin, remarks).

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Matrix Detail shell — `SalesMatrixDetail.tsx`
```
┌───────────────────────────────────────────────────────────────────────────────┐
│  👤 Customer name  ·  Opp ID · Opp Date · Country   [WhatsApp ●] [← Back]        │
│  ①Inquiry ─ ②Ack ─ ③Sourcing ─ ④Price ─ ⑤Quotation/PI ─ ⑥Victory   (stepper)     │
├──────────────┬──────────────────────────────────────┬────────────────────────────┤
│ CLM DETAILS  │            STAGE CONTENT               │  DEAL EXECUTION            │
│ (left panel) │       (Stage 1..6 component)           │  Task Manager (PDM form)   │
│ Customer KYC │                                        │  Chanakya · Sarthi · Chat  │
│ Consignee KYC│                                        │  (coming soon)             │
│ Segment/Agmts│                                        │                            │
└──────────────┴──────────────────────────────────────┴────────────────────────────┘
```
- **Banner:** customer name, Opp ID/date/country, a **WhatsApp status** button, and **Back to Worksheet**.
- **Stepper:** 6 steps — `done` (✓) · `active` · `idle` · `locked` (beyond the furthest earned stage). Clicking a locked step is a no-op.
- **Left CLM panel** (collapsible): Customer & Consignee KYC tally bars (verified/total from the Evidence-Vault endpoint); a **Segment Details** card (visible once a PI exists) showing **Agreements** and **Trade Documents** signing tallies → opens the agreement-send modal.
- **Right Deal-Execution panel** (collapsible): **Task Manager** tab (PDM capture; other tabs "coming soon").
- **Toolbar actions:** Change Owner · Remark · Key Opportunity · Reminders · Meetings · WhatsApp · Agreement send.

### 4.2 Stage sub-workspaces
- **Stage 1** — read-only opportunity + PDM summary; *Save & Next* advances to Stage 2 once the Task Manager is filled.
- **Stage 2** — status pills open a **reason picker** (multi-select from the reasons master); an append-only **activity table**; advance requires the latest to be *Qualified*.
- **Stage 3** — three tabs (Product Details / Sourcing Required / Sourcing Not Required) with a **readiness checklist**; **Create Procurement** (single or grouped), **Mark as Done**, and **Vendor** mapping.
- **Stage 4** — *Price To Be Shared* (quoted-price input + Submit) and *Shared Price* (history + View/Download **barcoded PDF**).
- **Stage 5** — Quotation/PI toggle, **Create Quotation** / **Create PI**, **Convert to PI**, per-row **Send for Signature / Signed? / Remind / Signing Tracker / Certificate**, edit/delete, email.
- **Stage 6** — pre-shipment celebration + deal summary + KPI tiles → **Create Shipment ID**; post-shipment shows the shipment/inquiry/logistics cards.

### 4.3 Left-panel & toolbar helpers (modals)
Product Directory · Product Sourcing (embed) · Vendor Mappings · Price Shared history · Create Procurement · Create Shipment Order · Procurement Details · Change Owner · Key Opportunity · Remarks · WhatsApp Status · Reminders · Meetings · Lead-Agreement send · Sales-Doc send-for-signature.

---

## 5. BUSINESS RULES

| # | Rule | Behaviour |
|---|---|---|
| 1 | Stage progression | Each *Save & Next* persists `lead_stage_id`; future stages stay locked until earned |
| 2 | Quotation / PI codes | `QT/FY/SEQ` and `PI/FY/SEQ` — per-client, financial-year, row-locked (never reused) |
| 3 | One PI per opportunity | A second non-cancelled PI on the same opportunity is blocked (409) |
| 4 | Convert to PI | Copies all quotation fields + line items; marks the quotation *converted_to_pi*; PI currency is then locked |
| 5 | DCP gate | Creating a PI requires the customer/consignee's **mandatory KYC/DD/Trade-Licence** docs |
| 6 | Product list lock | After Stage 3 (`lead_stage_id ≥ 4`) products can't be unmapped (would orphan quotation/PI items) |
| 7 | Server-side totals | Line amount = qty × rate × (1 + tax%/100), recomputed server-side; client totals never trusted |
| 8 | Signed PDF links | Customer view links are **signed + expire after 60 days** |
| 9 | Email / reminder | Email is rate-limited (3/min); `emailed_at` stamped once; reminders require a prior email |
| 10 | Victory gate | Stage 6 requires a **signed PI**; `won_at` is stamped on entry |
| 11 | One shipment per opportunity | `shipment_orders.lead_id` is unique (409 on a second) |
| 12 | Documents are soft-cancelled | Quotations/PIs are cancelled (status), never hard-deleted — audit preserved |

---

## 6. STATUS MODELS
- **Quotation:** `draft → sent → approved → converted_to_pi` (or `cancelled`).
- **Proforma Invoice:** `draft → sent → approved → converted_to_contract` (or `cancelled`); `pi_type` = with/without shipment; `signing_mode` with/without signature.
- **E-signature (Zoho):** Not Sent → Sent (awaiting) → Signed (+ certificate).
- **Procurement:** `inprogress` / `done`. **Shipment:** created (one per opp).
- **Reminders/Meetings:** In Progress / Done (meetings also Postponed / Cancelled).

---

## 7. KNOWN LIMITATIONS
| Area | Limitation |
|---|---|
| PI-signed lock | After signing, Stages 3–5 are read-only; you must recall/supersede the signature to edit |
| Product re-mapping | Can't unmap products after Stage 3 without stepping the opportunity back |
| PDF cache | Rendered PDFs are cached by content hash; template changes need a manual cache clear |
| Currency | A PI created from a quotation is locked to the quotation's currency |
| Right panel | Chanakya / Sarthi / Chat View tabs are placeholders ("coming soon") |
| Convert-to-PI | `convert-to-pi` on the quotation only marks intent; the real copy happens via PI *from-quotation* |

---

*Related documents: MATRIX_STAGES_TECHNICAL_DOCUMENTATION.md · MATRIX_STAGES_CODE_WALKTHROUGH.md · MATRIX_STAGES_API_DOCUMENTATION.md*
