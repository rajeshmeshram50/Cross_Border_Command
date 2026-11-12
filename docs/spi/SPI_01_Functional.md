# SPI — Functional Documentation
**Module:** Supplier Purchase Invoice (SPI) / Inward · P2P
**Audience:** Product, QA, implementation, support
**Scope:** The complete end-to-end flow as the screens present it today — **With PO**, **Without PO (Direct SPI)**, and **With / Without Shipment**.

---

## 1. What SPI is

SPI is the **inward** flow of the Procure-to-Pay (P2P) module. It records the supplier's invoice for goods that have arrived, matches it against what was ordered, packs the goods into physical boxes, and puts those boxes away into the warehouse.

It is a **4-stage wizard**:

| Stage | Name | What happens |
|---|---|---|
| **01** | Supplier Details | Create the invoice header; pick the supplier (from the PO, or directly). |
| **02** | Invoice & Product Details | Enter the invoice number/date/attachment and the product grid — the **N-way match**. |
| **03** | Temporary Box Packaging | Pack each product's quantity into physical boxes / cartons; print stickers. |
| **04** | Temporary Put-away Allocation | Allocate each box to a warehouse location and confirm it is placed (manually or via a Zebra handheld scan). |

Finishing Stage 04 **"Maps"** the invoice (status → *Mapped*); the goods then flow downstream to GRN.

---

## 2. The two independent splits

Every SPI is defined by **two independent choices**:

### Split A — With PO vs Without PO (Direct SPI)
- **With PO:** the invoice is raised against an existing Purchase Order. Product lines are **pulled from the PO**, enabling the 3-way match (PO · GRN/PI · Invoice).
- **Without PO (Direct SPI):** no PO behind it — the supplier is picked directly and products are entered manually. The backend marker is simply `purchase_order_id IS NULL`.

### Split B — With Shipment vs Without Shipment
- **With Shipment:** the invoice is tied to a customer **Shipment Order**, which carries a **Proforma Invoice (PI)**. Product lines are then fixed to the PI, and the box **disposition** defaults to *Shipment Dispatch*.
- **Without Shipment:** no shipment link; correct goods default to *Inventory Stock*.

> These combine into four flavours: With-PO, With-PO+Shipment, Direct+Shipment, Direct (no shipment). **Stages 3 and 4 are identical across all of them** — only the entry point, the match type, and the box disposition differ.

---

## 3. Landing page — SPI List

Screen: **Supplier Purchase Invoice (SPI)** list.

- **Create button:** *"Create Supplier Purchase Invoice"* → opens the **Choose SPI type** modal.
- **Scope tabs:** *With Purchase Order SPI* · *Without Purchase Order SPI (Direct SPI)*.
- **Shipment sub-tabs (filter only):** *With Shipment ID* · *All Other Transactions (Without Shipment ID)*.
- **Row actions:** Edit (reopen the wizard), Zoho sync, Payment Requests, Summary (Put-away summary), Evidence Vault.

Each row shows live progress — boxes total / placed, put-away complete, whether it is Direct, Zoho status, and pending/approved-unpaid payment info.

---

## 4. Creating an SPI

### 4.1 Choose the type (`Choose the SPI type`)
Two cards under **SELECT SPI TYPE**:
- **With Purchase Order SPI** — *Recommended*. "3-way match: PO · GRN · Invoice", "Products & prices pulled from the PO". Reveals **Select Purchase Order** (the PO picker).
- **Direct SPI** — *Without Purchase Order*. "Pick the supplier directly", "Enter products & prices manually". Reveals the Direct-SPI setup wizard.

### 4.2 With PO — the PO picker
Lists **submitted** POs (searchable, infinite scroll). Each row shows PO code, supplier, shipment (or "No shipment"), amounts and a status pill. Two kinds of rows are **blocked**:
- **Fully Invoiced** — nothing left to bill.
- **Inspection: Pending** — an order that needs physical inspection can be invoiced only once inspection is complete.

Picking a PO means Stage 2's lines are pulled from that PO.

### 4.3 Direct SPI — the setup wizard
A 3-step rail:
1. **Shipment** *(Required)* — *"Is this Direct SPI raised against a customer shipment?"*
   - **With Shipment ID** → pick a Shipment; captures the shipment, its PI number and date.
   - **All Other's (Without Shipment ID)** → not linked to any shipment.
2. **Procurement** — *currently disabled / "Coming soon"* (not part of this release).
3. **Supplier** *(Required)* — pick the domestic supplier directly.

### 4.4 Temporary Storage Selection (shared gate) — detailed flow
Screen: **"Temporary Storage Selection"** (`StorageSelectionModal.tsx`). A 3-step stepper — `STEPS = ['Storage Type', 'Select Warehouse', 'Confirm']` — with a reference chip at the top (`PO: <code>` or `Supplier: <name>`).

**Step 1 — Storage Type** (`step === 1`)
- Two choice cards (`StorageCard`, radio group):
  - **Our Warehouse** (`own`) — the full put-away flow (Rack → Shelf → Box, digital warehouse, live tracking).
  - **Third Party Warehouse** (`third-party`) — 3PL, **summary-only**, currently **disabled / "Coming soon"**.
- **Gate (`canAdvance`):** a type must be selected.
- If the chosen type **skips the warehouse** (`skipsWarehouse`), Step 1 jumps straight to **Step 3** (no warehouse picked for 3PL/summary).

**Step 2 — Select Warehouse** (`step === 2`)
- Heading **"Select Warehouse"**; lists the client/branch's **own** warehouses (`WarehousePicker`, from `spiApi.warehouses()`).
- **Eligibility:** incompatible warehouses are greyed with a reason via `whBlockReason(eligibility, warehouseId)` — a warehouse missing a required **cold-chain** or **hazardous** zone is blocked (`selectedBlocked`). The required capabilities are read from `eligibility.required` (`cold_chain` / `hazardous`).
  > At create time boxes/flags don't exist yet, so eligibility matters most on a **re-pick from inside the wizard**; the first pick is usually unconstrained.
- **Gate (`canAdvance`):** a warehouse is chosen **and** it is not blocked (`!!warehouseId && !selectedBlocked`).

**Step 3 — Confirm** (`step === 3`)
- Review card: PO / Supplier + Storage Type + Warehouse.
- Primary button **"Continue to Invoice"** (spinner label *"Opening invoice…"*).

**What happens on confirm:**
- **With PO:** opens the wizard directly — **no server draft yet** (the draft is created when Stage 1 is saved).
- **Without PO:** calls `spiApi.create({ purchase_order_id: null, vendor_id, document_type, warehouse_id, shipment_order_id, procurement_request_id/code })` → toast *"{code} created … Saved as a draft"* → opens the wizard at Stage 1. Requires a chosen supplier (else *"Choose a supplier"*).

---

## 5. The 4-stage wizard

The wizard header shows pills for Invoice No, PO Number / Shipment ID, Procurement Case ID, Supplier and Warehouse. The stage labels adapt:
- With PO: *Supplier Details · Invoice & Product Details (3-Way Match) · Temporary Box Packaging · Temporary Put-away Allocation*
- Direct + Shipment: Stage 2 becomes *2-Way Match … against the PI of the shipment*
- Direct, no shipment: Stage 2 becomes plain *Invoice & Product Details*

### Stage 1 — Supplier Details
- **With PO:** a read-only Purchase Order section (type, dates, transport, payment, inspection; international adds currency/FX/Incoterms/ports/origin). Supplier comes from the PO and is locked.
- **Direct:** no PO section; the **Select Supplier** dropdown is editable ("Add Supplier" to onboard).
- Supplier cards for all modes: Details, Address & Contact, **Legal Status** (compliance %, Evidence Vault link), **GST Scrutiny**, **Risk Alert**.
- **Gate to advance:** a supplier must be chosen. **For Direct SPI**, the GST rule applies (see §7). Pending supplier documents raise a notice before advancing.

### Stage 2 — Invoice & Product Details (the match)
- **Invoice section:** Purchase Invoice Number *, Purchase Invoice Date * (not before the PO/PI date, not in the future), Purchase Invoice Attachment * (PDF/JPG/PNG/WEBP ≤10MB, upload or camera), E-Way Bill Attachment (optional).
- **Products section (the match table):**
  - **With PO (PO has PI):** 3-Way Match (PI vs PO vs SPI). Lines fixed to the PO; quantities editable, lines removable/restorable — but a line already packed in Stage 3 cannot be removed or shrunk below the packed quantity.
  - **With PO (no PI):** 2-Way Match (PO vs SPI).
  - **Direct + Shipment:** 2-Way Match against the PI of the shipment; lines fixed to the PI; no "Add Product".
  - **Direct, no shipment:** plain entry with **+ Add Product** (pick product + quantity per row).
- **Gates:** invoice number/date/attachment required; Direct rows need a product and qty ≥ 1; nothing below what Stage 3 already packed; at least one line with qty > 0.
- Over-billing beyond PO/PI **warns** but never blocks.

### Stage 3 — Temporary Box Packaging — detailed flow
Screen: `Step3BoxPackaging.tsx`. Goal: pack **every billed unit** of **every** product into physical boxes.

**The three packing scenarios** (`SCENARIOS`, edit-mode label in brackets):
| Scenario | Meaning | Edit mode |
|---|---|---|
| **Scenario 01 — 1 Product → 1 Box** | one product fully in one carton (Standard) | *Single Box* |
| **Scenario 02 — 1 Product → Multiple Boxes** | one product's qty split across N cartons | *Split Carton* |
| **Scenario 03 — Multiple Products → 1 Box** | ≥2 distinct products in one mixed carton | *Mixed Carton* |

**The "SPI Box Generation System" table** — one row per billed product, columns: **Qty (SPI)**, **Remaining Qty**, **Missing / Extra Qty**, **Sub-Box Count**, **Actions**. Per product the operator can:
- **"+ Single Box"** → opens the **Box Drawer** (Scenario 01).
- **Apply** a *Sub-Box Count* → opens `MultiBoxPanel` (Scenario 02) — split the product's quantity across N boxes, each its own Box Drawer (`splitQuantity`, up to `maxSplitBoxes`). A split that ends up as one box collapses back to Scenario 01.
- Tick **≥2 products** → **"Pack into 1 Box"** → mixed-carton Box Drawer (Scenario 03).

**The Box Drawer** (`BoxDrawer.tsx`) — what the operator records per box:
- **Core dimensions:** Length · Width · Height.
- **Weights:** Weight · Net Weight · Gross Weight.
- **Condition** (perfect / minor / major / severe) and **Stackable** toggle.
- **Temperature** range via `TemperatureModal` (cold-chain min/max).
- **Flags:** *Hazardous · Cold Chain · Fragile* + **custom flags** (created inline via `AddProductFlagModal`).
- **Identity fields:** Serial No. · Lot No. · Batch No. · Cat No. · Expiry Date · MFG Date.
- **Remark** per box: **Correct · Damaged / Rejected · Mismatched · Extra Quantity** (+ an optional remark note). Rule: *"Extra Quantity applies only to a product billed above its PO/PI quantity."*
- **Photos:** upload or **camera capture** (`CameraCaptureModal`).
- **Save** → `spiApi.createBox`; the box gets a code (`nextBoxCodes`) and appears in **Packed Products** (`PackedProducts`).

**Editing & locks:** a saved box can be edited **until it is allocated in Stage 4** (then *"A put-away method is selected for this box in Stage 04 — it is locked"*). Printing a sticker (`BoxStickerModal`) **locks the box code**.

**Gate to advance (finish Stage 3):**
1. Every unit of every product must be boxed (`unboxed()` → warning *"N products are not fully boxed"*).
2. On finishing (`finishStage3`), a **warehouse capability** check runs first: if the current warehouse lacks a required **cold-chain / hazardous** zone for the packed boxes, the **"Warehouse can't hold these boxes"** modal (`WarehouseFixModal`) opens — pick a compatible warehouse (incompatible ones greyed with the reason) and **"Change warehouse & continue"** (`spiApi.setWarehouse` → `completeStage3`) advances inline. Otherwise `spiApi.completeStage3` → Stage 4.

### Stage 4 — Temporary Put-away Allocation
The workspace lists boxes by **disposition** tabs: *All Boxes · Shipment Dispatch Boxes · Inventory Stock (Extra Stock) Boxes · Damaged / Rejected Boxes · Mismatch Boxes*.
- Damaged → Damaged; Mismatched → Mismatch; Extra → Inventory.
- Correct goods: go to **Shipment Dispatch** when the SPI has a PO **or** a shipment (`forDispatch`), otherwise **Inventory Stock**.

Per box, a 3-step panel:
1. **Review Box Details** — the box exactly as Stage 3 closed it → choose storage mode: *Zone with Rack* (Zone › Rack › Shelf) or *Zone without Rack*.
2. **Select Location** — two sections:
   - **System Recommended Location** — the engine's top pick with a Match %, capacity math and parameter checks (fit, weight, stackable, cold-chain/hazardous). **Use Recommended Spot**.
   - **Custom Location Selection** — browse Zone › Rack › Shelf (or a flat zone list), split into *Available* / *Fully Utilized* / *Not Eligible*. When nothing fits, the server's diagnosis is shown.
3. **Confirm Placement** — review the selected location, then choose the **Put-away Method**.

#### The two confirm options
- **Option 01 — Using Zebra Device:** sends the box to the floor for physical QR verification. Creates a **scan task**; the box becomes *Awaiting scan*. The floor operator scans the Box QR then the Shelf/Zone QR on a handheld; both passing flips the box to *Put-away Completed*.
- **Option 02 — Manual Confirmation:** the operator attests the box is already placed; the box completes **instantly** (no device). This is final and the location cannot be changed.

A **Zebra task** can be cancelled (*Cancel Task Only* or *Cancel & Continue with Manual*) — but not once scanning has started.

- **Final gate:** the footer **Map Invoice** button is enabled only when **every box is placed**. Mapping finishes the SPI.

---

## 6. The handheld (Zebra) scan flow

A separate, server-authoritative device screen used for Option 01:
1. **Queue** — open boxes awaiting verification; tap a task or scan any box to start.
2. **Scan the box** — scanning the correct box label verifies it and reveals its contents.
3. **Scan the location** — scan the zone / rack / shelf; a slots strip ticks each level; "NEXT SCAN" points at the box's deepest destination level.
4. **Complete** — once the server says it's ready, *Complete put-away* places the box. *Clear box* abandons the run.

Wrong box/location/label give short verdicts naming what to scan instead; three wrong scans reset the task; an idle run returns to the queue.

---

## 7. Business rules that gate the flow

1. **PO fully invoiced** — a PO whose lines are all billed cannot start a new SPI.
2. **Physical inspection** — a PO needing inspection can be invoiced only after inspection is complete.
3. **Direct SPI + GST (domestic only):** if the supplier's GST scrutiny is stale or last return is overdue, Stage 1 is gated — the invoice fields save, but the **stage is withheld** until a **senior approval** is raised and approved against that invoice. While the approval is pending/approved, the supplier can no longer be changed. (International Direct SPIs skip GST checks.)
4. **Full packing** — Stage 3 can't complete until every unit is boxed.
5. **Warehouse capability** — Stage 3→4 blocked if the warehouse can't hold the boxes' cold-chain/hazardous needs.
6. **All boxes placed** — the invoice can't be mapped until every box is put away.
7. **Over-supply** warns, never blocks.

---

## 8. Statuses the user sees

- **Invoice:** Draft → Mapped (→ GRN Pending → Closed; Cancelled on delete).
- **Box (Stage 4):** Pending → Allocated/Draft → Awaiting scan (Zebra) → Put-away Completed.
- **Zebra task:** Pending → Scanned (done) / Cancelled / Expired / Failed.

---

## 9. With-PO vs Without-PO vs With-Shipment — quick reference

| Aspect | With PO | Direct + Shipment | Direct, no shipment |
|---|---|---|---|
| Entry | PO picker (lines from PO) | Direct setup, *With Shipment ID* | Direct setup, *All Other's* |
| Draft created | at Stage-1 save | at Storage confirm | at Storage confirm |
| GST senior approval | not here (on the PO) | required if GST overdue (domestic) | required if GST overdue (domestic) |
| Stage 1 | PO section (read-only), supplier locked | no PO section, supplier editable, shipment + PI pills | no PO section, supplier editable |
| Stage 2 match | 3-way (if PO has PI) else 2-way; lines from PO | 2-way vs the shipment's PI; lines fixed, no Add | plain entry; **+ Add Product** |
| Stage 4 disposition | correct goods → Shipment Dispatch | correct goods → Shipment Dispatch | correct goods → Inventory Stock |
| Handheld "Raised Against" | PO Number | Shipment ID | "Direct SPI — no shipment" |

Stages 3 and 4 mechanics (packing, board, manual vs Zebra, handheld) are **identical** in all variants.
