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

### 2.1 The flow at a glance

**Figure 1 — Where the four flavours diverge, and where they rejoin.** Split A (PO vs Direct) picks the entry; Split B (shipment vs not) tunes Stage 2's match and Stage 4's disposition. Stages 3 and 4 are one shared path.

```
                         ┌─────────────────────────┐
                         │  Create SPI → choose type│
                         └───────────┬─────────────┘
              Split A ───────────────┼───────────────────────────
                                     │
            With Purchase Order      │        Direct SPI (no PO)
          ┌──────────────────────┐   │   ┌──────────────────────────┐
          │ pick a submitted PO  │   │   │ Direct setup: shipment?  │
          │ (lines from the PO)  │   │   │  ├─ With Shipment ID      │
          └──────────┬───────────┘   │   │  └─ All Other's (no ship) │
                     │               │   │ then pick supplier        │
                     │               │   └──────────┬───────────────┘
                     │  Temporary Storage Selection  │  (warehouse gate)
                     └───────────────┬───────────────┘
                                     ▼
   ┌──────────────────────────────── 4-STAGE WIZARD ───────────────────────────────┐
   │ Stage 1  Supplier Details    PO read-only & locked │ Direct: supplier editable  │
   │                              ───────────────────────────  Direct+domestic: GST   │
   │                              gate may withhold the stage (senior approval)       │
   │ Stage 2  Invoice & Match     3-way (PO+PI) / 2-way (PO or PI) / plain entry      │
   │                              + invoice no/date/attachment  (Split B tunes this)  │
   │ Stage 3  Box Packaging       ══ identical in every flavour ══                    │
   │ Stage 4  Put-away Allocation ══ identical; disposition set by Split B ══         │
   └───────────────────────────────────┬───────────────────────────────────────────┘
                                        ▼
                         Map Invoice → status = mapped → GRN
```

**Figure 2 — Split B decides Stage-4 disposition for *correct* goods.**

```
   box remark ─┬─ damaged     → Damaged / Rejected
               ├─ mismatched  → Mismatch
               ├─ extra        → Inventory Stock
               └─ correct      → forDispatch = has PO OR has shipment ?
                                   ├─ yes → Shipment Dispatch
                                   └─ no  → Inventory Stock
```

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

Before the 4-stage wizard ever opens there is a **selection funnel** — choose the type, pick the source, then the storage. Only at the end of it does the invoice wizard appear (and, for a Direct SPI, the draft row is created).

**Figure 3 — The selection flow that runs *before* Stage 1.**

```
   "Create Supplier Purchase Invoice"
        │
        ▼
   Choose the SPI type ──┬─ With Purchase Order SPI (recommended)
        │                │     └─► PO PICKER (submitted POs)
        │                │           · blocked: Fully Invoiced · Inspection Pending
        │                │           · pick a PO → Stage 2 lines come from it
        │                │
        │                └─ Direct SPI (no PO)
        │                      └─► DIRECT SETUP rail:
        │                            1. Shipment (required)
        │                               ├─ With Shipment ID → pick shipment (+ PI no/date)
        │                               └─ All Other's (Without Shipment ID)
        │                            2. Procurement — disabled / "Coming soon"
        │                            3. Supplier (required) → pick domestic supplier
        ▼
   Temporary Storage Selection  (shared gate, StorageSelectionModal)
        │   Step 1  Storage Type ──┬─ Our Warehouse (own) → full put-away
        │                          └─ Third Party (3PL) — disabled / "Coming soon"
        │   Step 2  Select Warehouse  (own warehouses; incompatible ones greyed:
        │                              missing cold-chain / hazardous zone is blocked)
        │   Step 3  Confirm → "Continue to Invoice"
        │
        ├─ With PO  → open wizard at Stage 1  (NO server draft yet — draft on Stage-1 save)
        └─ Direct   → spiApi.create({ purchase_order_id: null, … }) → draft created → Stage 1
                                        ▼
                               4-STAGE WIZARD (§5)
```

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

### Stage 3 — Temporary Box Packaging — full flow
Screen: `Step3BoxPackaging.tsx` (+ `BoxDrawer`, `MultiBoxPanel`, `PackedProducts`, `ProductFlagsModal`, `TemperatureModal`, `BoxStickerModal`). **Goal: pack every billed unit of every product into physical boxes** — no unit may be left unpacked, and no box may hold more than what is left to pack.

#### (a) The three packing scenarios
Every box is one of three shapes (`SCENARIOS`; the *edit-mode* label is how a saved box is relabelled):
| Scenario | Shape | Edit label | Meaning |
|---|---|---|---|
| **Scenario 01** | 1 Product → 1 Box | *Single Box* | all units of one product in one carton — the simple case |
| **Scenario 02** | 1 Product → Multiple Boxes | *Split Carton* | one product's quantity split across N cartons, each its own label + dimensions |
| **Scenario 03** | Multiple Products → 1 Box | *Mixed Carton* | ≥2 distinct products in one master carton, one shared label |

#### (b) The "SPI Box Generation System" table
One row per billed product. Columns: **Qty (SPI)** · **Remaining Qty** (`spiQty − packed elsewhere`) · **Missing / Extra Qty** · **Sub-Box Count** · **Actions**. From a row the operator can:
- **"+ Single Box"** (`singleBox`) → opens the **Box Drawer** at Scenario 01, pre-filled with the remaining quantity.
- **Enter a Sub-Box Count N → Apply** (`applySplit`) → opens `MultiBoxPanel` at Scenario 02: the quantity is spread across N boxes (`splitQuantity`, capped at `maxSplitBoxes`), each box editable (`setBoxQty`) with its own Box Drawer. **A split that resolves to a single box collapses back to Scenario 01** (`normaliseBoxScenarios`).
- **Tick ≥2 products → "Pack into 1 Box"** (`packSelected` / `toggleSelect`) → a mixed-carton Box Drawer at Scenario 03, where each product's share is set per line (`mixedQty`, `setMixedLineQty`). The carton is labelled *"Mixed Master Carton — N SKUs"*.

#### (c) The Box Drawer — everything recorded per box (`BoxDrawer.tsx`)
| Group | Fields | Notes |
|---|---|---|
| **Dimensions** | Length · Width · Height (cm) | all **required**, all **> 0** |
| **Weights** | Weight · Net Weight · Gross Weight (kg) | **Gross required**; **Net ≤ Gross**; a **volumetric weight** (L×W×H ÷ 6000) is shown, computed not stored |
| **Box Condition** | perfect · minor · major · severe | *minor/major/severe* mark a damaged box |
| **Stackable** | toggle | feeds the Stage-4 stackable capacity check |
| **Temperature** | min / max °C via `TemperatureModal` | the cold-chain range |
| **Product Flags** | *Hazardous · Cold Chain · Fragile* (built-in) + **custom flags** | custom flags are created inline (`ProductFlagsModal`), colour-coded; flags drive warehouse eligibility and the sticker pictograms |
| **Identity** | Serial · Lot · Batch · Cat No. · Expiry · MFG | **per-box** for Scenario 01/02, **per-product** for Scenario 03 (each SKU its own identity) |
| **Product Remark** | Correct · Damaged/Rejected · Mismatched · Extra Quantity (+ a note) | decides the Stage-4 **disposition**; any non-*Correct* remark **requires a note** |
| **Photos** | upload **or camera capture** | one or more images of the box / its contents |

#### (d) Save-time validation (`validate`)
A box is refused (with a specific message) when:
- any of **Length / Width / Height / Gross Weight** is missing, or any dimension/weight is **≤ 0**, or **Net > Gross**;
- a box would hold **0 units**, or **more than the product's remaining SPI quantity** (*"can hold at most N units … the rest is already in other boxes"*);
- **Expiry ≤ MFG**, **Expiry is in the past**, or **MFG is in the future**;
- a **non-Correct remark has no note** (*"Damaged / Rejected needs a note saying what was found"*);
- **Extra Quantity** is chosen on a product **not billed above its PO/PI quantity** (*"Extra Quantity applies only to a product billed above its PO/PI quantity"*).

On pass → `spiApi.createBox` (server re-checks via `guardOverPacking`), the box gets code **`B-NNN`** (`nextBoxCodes`, restarts at B-001 per invoice) and appears in **Packed Products**.

#### (e) Packed Products / editing / stickers
- **Packed Products** lists each saved box: **Box ID · Scenario · Product(s) · Qty · Condition**, grouped by how it was packed.
- **Edit** (`openEdit`) a saved box — change its contents, dimensions, flags — **until it is allocated in Stage 4**, after which it is locked (*"A put-away method is selected for this box in Stage 04 — it is locked"*).
- **Delete** a box (`closePack` / `removeSplitBox`) — refused once it is put away.
- **Print sticker** (`BoxStickerModal` → 4×6 PDF with signed QR) — **printing locks the box code** (`isCodeLocked`), because the code is now being scanned on the floor.

#### (f) Finish-Stage-3 gate (`finishStage3` → `completeStage3`)
1. **Every unit of every product must be boxed** — otherwise *"N products are not fully boxed"* and the stage won't finish (`unboxed()`).
2. A **warehouse-capability** check runs: if the current warehouse has **no cold-chain / hazardous zone** for the packed boxes, the **"Warehouse can't hold these boxes"** modal (`WarehouseFixModal`) opens — incompatible warehouses are greyed with the reason; **"Change warehouse & continue"** (`spiApi.setWarehouse` → `completeStage3`) advances inline. Otherwise `completeStage3` → Stage 4.

> Behind the scenes every box save also runs `normaliseBoxScenarios` (s2→s1 collapse) and `syncPackingStage` (re-derive the 2↔3 boundary), so the stage never claims "packed" while units are still loose.

**Figure 4 — Stage 3: packing every unit, by scenario.**

```
   For each billed product line (Qty SPI, Remaining = SPI − already packed):
        │
        ├─ "+ Single Box" ───────────► Box Drawer (Scenario 01: 1 product → 1 box)
        │
        ├─ Sub-Box Count = N, Apply ─► MultiBoxPanel (Scenario 02: 1 product → N boxes)
        │                               splitQuantity across N (≤ maxSplitBoxes)
        │                               N collapses to 1 → back to Scenario 01
        │
        └─ tick ≥2 products, "Pack into 1 Box" ─► Box Drawer (Scenario 03: mixed carton)
                                                   │
   Box Drawer records:  dims · weights · condition · stackable · temp range
                        flags (haz/cold/fragile + custom) · identity (serial/lot/batch/…)
                        remark (Correct / Damaged / Mismatched / Extra Qty) · photos
                        │
                        Save → spiApi.createBox → box code B-NNN → Packed Products
                        (editable until Stage-4 allocation; sticker print locks the code)
        │
        ▼
   Every unit boxed?  ──no──► warning "N products are not fully boxed" (can't finish)
        │ yes
        ▼
   Finish Stage 3 → warehouse capability check
        ├─ warehouse can hold the boxes' cold-chain/hazardous needs → completeStage3 → Stage 4
        └─ cannot → WarehouseFixModal → pick compatible warehouse → setWarehouse → completeStage3
```

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

**Figure 5 — Stage 4: the per-box state machine (status is *derived*, not stored).**

```
   Each box carries a disposition tab + a status that the SERVER derives
   (stage4Status), never a column anyone sets by hand:

   ┌─ PENDING ──────────── no location chosen yet (sub-step 1: Review Box)
   │     │  assign (lock + reserve a Zone/Rack/Shelf)
   │     ▼
   ├─ DRAFT ────────────── location held but unconfirmed (sub-step 3: Confirm)
   │     │                  operator walked away → still DRAFT, lock held
   │     ├──── Option 02: Manual Confirmation ──────────────┐
   │     │        confirm-manual (attest placed)            │
   │     └──── Option 01: Zebra Device ─► scan-task          │
   │                 │  box → AWAITING SCAN                  │
   │                 ▼                                       │
   ├─ AWAITING SCAN ───── a device task is open             │
   │     │  handheld: scan Box QR + Shelf/Zone QR            │
   │     │  (either order; server judges each scan)          │
   │     │  /complete  ── the ONLY call that moves stock ──► │
   │     │  task may be cancelled → back to DRAFT            │
   │     ▼                                                   ▼
   └─────────────────────────► PLACED (confirmed, final — location can't change)
                                      │
   every box PLACED?  ──► Map Invoice enabled → submit → status = mapped → GRN
```

Disposition decides which tab a box sits in: **damaged → Damaged**, **mismatched → Mismatch**, **extra → Inventory**, **correct → Shipment Dispatch** if the SPI has a PO or a shipment (`forDispatch`) else **Inventory Stock**. Each box's 3 sub-steps (Review Box → Select Location → Confirm Placement) are per-box; the board tracks them independently, so one stuck box never blocks the others.

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

## 9. The Evidence Vault

The paperwork behind an invoice is scattered — the PO copy, signed trade documents, the uploaded invoice, box stickers, packing photos, payment proofs — and the **Evidence Vault** is the one read-only screen that gathers it in a single place for audit, dispute and hand-off. It **never generates or uploads** anything; it only shows what already exists elsewhere, and it is faithful about what is *missing*.

> There are **two distinct vaults** in SPI, opened from two places. Don't confuse them.

### 9.1 Invoice Evidence Vault (the SPI's own paperwork)
- **Opened from:** the SPI list **row action → Evidence Vault** (`InvoiceEvidenceVault.tsx`).
- **Subject:** one invoice. Header reads `SPI code · Supplier · PO code` and *"N of M on file"* (available vs total).
- **What it shows — grouped, each group → sections → documents:**
  | Group | Sections | Source |
  |---|---|---|
  | **Purchase Order** | Order Copy | the PO PDF (generated on demand) — *only when the SPI has a PO* |
  | **Trade Documents & Agreements** | Trade Documents · Agreements | PO documents, with each one's **signing state**; a Bill of Lading nobody uploaded is shown as **Awaited**, on purpose |
  | **Supplier Purchase Invoice** | Invoice & E-way Bill · Box Stickers · Box & Product Images · Payment Proofs | the uploaded invoice + e-way file, a sticker per box, packing photos, and the money released against this invoice |

- **Per document:** name, a meta line (code/date/amount), and a **status pill** whose colour follows the state. Two buttons — **View** (opens in a new tab) and **Download**. The state decides which are live:
  - **Uploaded / Signed** — a real file → View + Download both work.
  - **Generated** (PO PDF, box sticker) — rendered on demand → Download/print works; there's no stored file to "view".
  - **Awaited** — nobody has provided it yet → both greyed, titled *"This document has not been uploaded yet."* This empty row is deliberate: hiding it would make an incomplete file look complete.
- **Signed documents:** a signed trade doc shows the **executed** copy (from the signature request), not the unsigned draft it was sent as.
- **Empty states:** an unsaved invoice says *"This invoice has not been saved yet."*; a saved-but-bare one says *"Nothing has been filed against this invoice yet."*

### 9.2 Supplier Evidence Vault (the vendor's compliance file)
- **Opened from:** **Stage 1 → Legal Status card → Evidence Vault** link (`SupplierEvidenceVaultModal.tsx`).
- **Subject:** the **supplier**, not the invoice — its KYC, due-diligence and trade-licence documents by segment.
- This is the vendor's compliance paperwork (the same vault seen on the supplier master); it answers *"is this supplier's file complete?"*, which is also what the Stage-1 compliance % and the pending-document notice are drawn from.

> Rule of thumb: **invoice vault = this shipment's documents; supplier vault = the vendor's standing compliance.**

---

## 10. Payments

Payments are always raised and recorded **from the invoice** (the Payment Requests popup / "Make SPI Payment"), but *where the money is stored and who approves* depends on whether there is a PO behind it. Unlike raising the invoice, a payment **request needs an approver** — a named person decides it.

**Figure 6 — Raising and releasing money against an SPI.**

```
   SPI (Stage 2 saved, has an amount)
        │
        │  domestic? → deduct TDS first (save it, even as 0)
        ▼
   Raise Payment Request ──► goes to a named approver (requested_to)
        │                      • an active user of THIS invoice's branch
        │                      • never a client-admin — a request stops at the branch head
        ▼
   Approver decides ──┬─ rejected → nothing released
                      └─ approved → Add Payment (amount + bank + UTR/cheque + proof)
                                        │
                                        ▼
                               paid / balance update; proof lands in the Evidence Vault
```

**Where the row lives:**

```
   PO-backed SPI  ──► request & payment stored on the PURCHASE ORDER
                      (supplier_invoice_id stamped so it traces back to the SPI;
                       all SPIs under one PO share its balance)

   Direct SPI     ──► request & payment stored on the INVOICE ITSELF
                      (no PO; ceiling = this invoice's own net payable)
```

- **TDS:** on a Direct SPI, TDS is set on the invoice and **must be saved before** a request can be raised (domestic only; max **40%**); on a PO-backed SPI, TDS lives on the order.
- **Zoho bill:** only a **Direct SPI owns its own Zoho bill**; a PO-backed bill belongs to the order. The Zoho Books integration itself is built and documented (`docs/integrations/zoho-books/*`): a **With-PO SPI syncs as a Bill through the PO's Zoho Sync (live)**, while the **Direct-SPI standalone bill is planned but not yet wired** (its *Zoho sync* returns a "not wired" 501; the *Zoho tracker* works and says why).
- **Multi-currency needs the right Zoho plan:** an **international SPI** carries a foreign `currency_code`, so the Zoho Books org must be on a plan that supports multiple currencies (**Professional or higher** — the Standard plan is base-currency only), with that currency enabled. Domestic (INR) sync works on any plan. See the Zoho Books functional doc §5.4.
- **Cancelling a paid order is a different flow.** Once money has gone to the supplier, the **PO cannot be cancelled directly** — it goes through the **Advance Receipt Refund Adjustment** (its own module), which cancels the PO and **declines every still-pending payment request** on it. That path is **PO-only and has no approval step**; a Direct SPI (no PO) is simply deleted instead.

### 10.1 The payment rules in brief
These are the same rules as the Payment Request module (see `docs/p2p/payment-request/*`), because a PO-backed SPI raises its request on the PO; a Direct SPI applies the same rules against its own invoice balance.
- **Request code** `PRQ-NNN` — a plain running serial (not a financial-year code).
- **Approver** is a **named person** (`requested_to`), an active non-client-admin **of the invoice's branch** — *a request stops at the branch head*. **Only that addressee can decide it**, and only once.
- **Approval ceilings:** never more than **requested**, and never more than the **remaining headroom** (net payable less what other approved requests already hold/paid).
- **Approval is permission, not payment** — the release is recorded separately: amount, bank, **UTR/cheque number (6–22 letters/digits, unique across the whole company)**, **date (not in the future)**, and a proof file. **Several payments** may sit under one approved request. Paid/balance rebuild from the surviving rows.
- **PO-backed only:** payments can't be managed until the PO's **documents have gone out for signature** (a PO gate; *submitted* alone is not enough).

---

## 11. The variants, one by one

Each flavour is described on its own below. **Stages 3 and 4 (packing, board, manual vs Zebra, the handheld) are identical in every variant** — only the entry, the draft timing, the Stage-2 match and the Stage-4 disposition differ.

### 11.1 With PO
- **Entry:** the PO picker — Stage 2's lines are pulled from the chosen submitted PO.
- **Draft created:** at **Stage-1 save** (choosing the PO *is* Stage 1; no server draft before that).
- **GST senior approval:** not here — it belongs to the PO itself.
- **Stage 1:** read-only Purchase Order section; the **supplier is locked** (comes from the PO).
- **Stage 2 match:** **3-way** (PI · PO · SPI) if the PO carries a PI, otherwise **2-way** (PO · SPI). Lines come from the PO.
- **Stage 4 disposition:** correct goods → **Shipment Dispatch** (`forDispatch` is true — it has a PO).
- **Handheld "Raised Against":** the **PO Number**.

### 11.2 Direct + Shipment (Without PO, With Shipment ID)
- **Entry:** the Direct setup rail with **With Shipment ID** — the invoice is tied to a customer Shipment Order and its PI.
- **Draft created:** at **Storage confirm** (`spiApi.create` with `purchase_order_id: null`).
- **GST senior approval:** **required if the supplier's GST is overdue** (domestic only); the stage is withheld until it's approved.
- **Stage 1:** no PO section; the **supplier is editable**; shipment + PI pills shown.
- **Stage 2 match:** **2-way against the shipment's PI**; lines fixed to the PI, **no Add Product**.
- **Stage 4 disposition:** correct goods → **Shipment Dispatch** (`forDispatch` is true — it has a shipment).
- **Handheld "Raised Against":** the **Shipment ID**.

### 11.3 Direct, no shipment (Without PO, All Other's)
- **Entry:** the Direct setup rail with **All Other's (Without Shipment ID)** — not linked to any shipment.
- **Draft created:** at **Storage confirm** (`spiApi.create` with `purchase_order_id: null`).
- **GST senior approval:** **required if the supplier's GST is overdue** (domestic only).
- **Stage 1:** no PO section; the **supplier is editable**.
- **Stage 2 match:** **plain entry** — **+ Add Product** (pick product + quantity per row).
- **Stage 4 disposition:** correct goods → **Inventory Stock** (`forDispatch` is false — no PO, no shipment).
- **Handheld "Raised Against":** *"Direct SPI — no shipment"*.

---

## 12. Roles and access

> Read off `SupplierInvoiceController`, `SpiBoxController` and the put-away controllers — not assumed. This mirrors the finding in the Purchase Order (§14) and Payment Request (§12) documents: **the SPI endpoints carry no per-action permission test.**

### What guards the API
Every method calls `tenantUser()`, which requires a `client_id` and otherwise returns **`403 — No tenant context`**. Beyond that there is **no role test and no module-permission test** on creating, editing, saving items, packing boxes, allocating put-away, submitting, paying or syncing an SPI. Any authenticated user belonging to a client can call any of these endpoints for that client's data.

The one check that *is* about *who* you are lives on the **payment request** (reused from the PO module): the approver must be an active, non-client-admin user of the invoice's branch, and **only the addressee can decide** — *"A request stops at the branch head."*

### What guards the screen
The menu leaf **`p2p.invoice`** ("Supplier Purchase Invoice (Temporary Putaway)", route `/p2p/supplier-purchase-invoice`) falls through to the general sidebar rule — `perms[id]?.can_view` — so the **menu is permission-gated per leaf**, and a missing or expired plan hides it. A super admin sees the leaf but cannot use it: with no `client_id`, every call returns the 403 above.

### The handheld is a different gate
The device endpoints (`/scan/putaway/*`) have **no user session at all** — they authenticate the **device** by client certificate (`X-Scan-Cert-CN`) or an enrolled `X-Scan-Device` token, and the enrolling user authors every later scan. A suspended/unknown device is refused (`rejected_unauthorized_device` / `rejected_suspended_device`).

### The practical consequence
Hiding the menu item stops a user *finding* the screen; it does **not** stop the endpoints answering. So "can this user work an SPI?" has two different answers depending on whether you ask the UI or the API — worth raising as a finding rather than testing as intended behaviour. Tenant isolation itself (`BelongsToTenant`, `client_id` from the token, never the body) **is** enforced server-side and cannot be worked around.
