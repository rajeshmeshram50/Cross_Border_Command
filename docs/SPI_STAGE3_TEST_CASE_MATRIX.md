# Supplier Purchase Invoice — Stage 03 "Temporary Box Packaging" Test Case Matrix (r2)

Execution tracker for the **new Stage 03** of the Supplier Purchase Invoice
wizard (**With Purchase Order** flow), in the standard QA sheet format
(**Test Case ID · Test Scenario · Expected Result · Sev · AC Ref · Actual Result ·
Status · Bug Reference · Tester Remarks**).

Scope: **Supplier Purchase Invoice only.** Purchase Order, GRN, Debit Note and
Payment screens are referenced only where Stage 03 inherits data from them.

- **Section 1** — the as-built With-PO flow you must be able to reproduce before Stage 03 can be reached.
- **Section 2** — the 39 acceptance criteria the build must satisfy (Given / When / Then).
- **Section 3** — the execution sheet: 133 cases in 19 groups, one row per case.
- **Section 4** — design inconsistencies spotted in the Stage 03 screens; raise these **before** execution so they aren't logged 12 times.
- **Section 5** — test data set-up.

Companion docs:
[QA_TEST_PLAN.md](QA_TEST_PLAN.md) ·
[SAAS_FUNCTIONAL_DOCUMENTATION.md](SAAS_FUNCTIONAL_DOCUMENTATION.md) ·
[DEV_TICKET_LIST.md](DEV_TICKET_LIST.md)

**Severity key:** **S1** stock / quantity / money wrong, wrong product boxed, data
loss, cross-tenant leak — stop-ship · **S2** data right but the flow is blocked or a
valid line is dropped · **S3** display, label, copy or layout only.

**Status values:** `Pass` · `Fail` · `Blocked` · `Config` (behaviour follows a
setting, not the code) · `Not Run`.

---

## Revision 2 — what changed

Case IDs are **stable**: nothing has been renumbered, so a sheet already in progress
stays valid. Eleven cases were de-scoped and their IDs retired rather than reused.

| Change | Detail |
|---|---|
| **Retired (11)** | SPI3-01, 08, 09, 10, 11, 26, 71, 72, 83, 91, 100 — de-scoped by the team. These IDs are **not** reissued. |
| **Rule reversed** | SPI3-32 — box quantity is now **editable**, not fixed. Editability itself is tested by SPI3-111. |
| **Rule extended** | SPI3-30 — the box ID sequence is scoped **per SPI**. SPI3-36 — the split is a starting point; sub-box quantities are editable. |
| **Feature removed** | SPI3-73 — **Scan** is gone from the box card; the case now verifies its absence. |
| **New: cross-box consistency** | Group O, SPI3-103–110 — CM/M unit and Product Flags must match across every box of one product, applied through a confirmation popup. |
| **New: editable quantity** | Group P, SPI3-111–120 — quantity editable in all three scenarios, plus the PO-150 / SPI-160 dispatch split. |
| **New: quantity columns** | Group Q, SPI3-121–128 — five columns (PI / PO / SPI / Missing / Extra), Missing in red, Extra in orange. |
| **New: gallery** | Group R, SPI3-129–136 — view and download every uploaded and camera-captured photo per box. |
| **New: traceability columns** | Group S, SPI3-137–144 — Serial / Batch / Lot / MFG / Expiry as per-product columns on the Selected Products table. |
| **Decision recorded** | Service lines **are** boxable — see §4.3. Blocker count drops from 6 to 5. |

---

## Section 1 — The current SPI (With PO) flow, as built today

**Where it lives:** `P2P → Purchase Management → Supplier Purchase Invoice`.

**Code:**
[SupplierPurchaseInvoice.tsx](../resources/js/pages/p2p/purchase-management/supplier-purchase-invoice/SupplierPurchaseInvoice.tsx) (list) ·
[MapSupplierPurchaseInvoiceModal.tsx](../resources/js/pages/p2p/purchase-management/supplier-purchase-invoice/MapSupplierPurchaseInvoiceModal.tsx) (mapping modal) ·
[SpiDetail.tsx](../resources/js/pages/p2p/purchase-management/supplier-purchase-invoice/SpiDetail.tsx) (the wizard) ·
[SupplierPurchaseInvoiceController.php](../app/Http/Controllers/Api/SupplierPurchaseInvoiceController.php) (API).

### 1.1 Entry — how a With-PO invoice is started

1. Click **Add** on the SPI list → the **Map Supplier Purchase Invoice** modal opens.
2. Choose **With Purchase Order** → the PO dropdown loads from
   `GET /api/p2p/supplier-purchase-invoices/purchase-orders`.
3. Pick a PO → **Confirm** → the detail wizard opens with real PO context
   (supplier, PI number, shipment, warehouse, next SPI code).

The alternative path, **Without Purchase Order** (Direct invoice), skips the PO
section entirely and drives everything off the chosen supplier. Stage 03 must be
tested on **both**, but the With-PO path is the primary flow in this pack.

### 1.2 Step 01 — "PO Link Supplier Details"

- PO fields are **inherited read-only** from the linked PO: PO Type, Document Type,
  Mode of Transport, PO Date, Expected Delivery Date, **Delivery Location
  (= the warehouse shown in the Stage 03 header pill)**, Payment Type, and
  **Physical Inspection Required**.
- Supplier block shows KYC / DD / trade licences / documents from the supplier master.
- **Gate:** GST scrutiny older than **3 months** (`SCRUTINY_STALE_MONTHS = 3`)
  blocks Next with *"GST scrutiny overdue"*.
- International POs additionally show Currency, Exchange Rate, Inco Term, Port of
  Loading / Discharge, Final Destination, Country of Origin — all read-only.

### 1.3 Step 02 — "Invoice & Product Details (3-Way Match)"

- Read-only **summary of Step 01** at the top ("1 stage done").
- Invoice block: Purchase Invoice Number, Invoice Date, Attachment — all three mandatory.
- 3-way match grid: `PRODUCT NAME (PI) | (PO) | (SPI)` and `QUANTITY (PI) | (PO) | (SPI)`,
  plus **MISSING QTY**, **HSN CODE**, **RATE (PO)**, **RATE (SPI)**.
  PI columns are hidden when the PO has no linked Proforma Invoice.
- `MISSING QTY = PO qty − already-invoiced qty − this SPI's qty`.

**Validation already enforced (do not re-log these as new bugs):**

| Rule | Message / behaviour | Where |
|---|---|---|
| At least one product with qty **and** rate | *"No products added"* | `blockIfNoProducts()` |
| HSN must be 4–8 digits | *"Invalid HSN Code"* | `blockIfInvalidHsn()` |
| Cannot invoice more than the PO's remaining qty | *"Quantity exceeds PO — only N left"* | `blockIfOverInvoiced()` |
| Invoice number unique per tenant | HTTP 422 | `duplicateInvoiceNo()` |
| PO already fully invoiced | HTTP 422 *"already fully invoiced"* | `poFullyInvoiced()` |
| Invoice date cannot be in the future | inline error | `handleSave()` |
| With-PO invoice date cannot precede the PO date | inline error | `handleSave()` |
| Invoice no / date / attachment mandatory | inline error | `handleSave()` |

- **Code format:** `SPI/<FY>/<3-digit seq>` (e.g. `SPI/2025-26/001`), allocated
  per client under a `clients` row lock + advisory lock. A PO may be invoiced across
  **multiple** SPIs until its quantity is fully covered.
- **SPI Payment** button: With-PO pays against the **linked PO**; Direct pays against
  the **SPI itself**. Requires *Save Details* first. TDS is cut inside the payment popup.

### 1.4 What is new in this release

| Step | Status |
|---|---|
| 01 PO Link Supplier Details | **Existing** — unchanged |
| 02 Invoice & Product Details (3-Way Match) | **Existing** — unchanged |
| **03 Temporary Box Packaging** | **NEW — this pack** |
| 04 Temporary Putaway Allocation | **NEW — separate pack** |

> **Note for the tester:** the footer must now read **STEP 03 OF 04** (the current
> build reads *STEP 02 OF 02*). Any step counter still showing "OF 02" is a bug.
> There is currently **no backend table, migration or endpoint for boxes or
> putaway** — if Stage 03 does not survive a page refresh, that is a persistence
> gap, not a UI defect; log it once as **SPI3-08 / SPI3-84**, not per-field.

### 1.5 Stage 03 layout under test

```
Header pills   INVOICE NO · PO NUMBER · SUPPLIER · WAREHOUSE · [SPI Payment] · [Close]
Step tabs      01 DONE · 02 DONE · 03 ACTIVE · 04 (locked)
Section 1      Summary — "What We Did in the Previous Stages" (read-only, 2 stages done)
Section 2      Packaging Scenarios — 3 cards
                 SCENARIO 01  STANDARD       1 Product  → 1 Box
                 SCENARIO 02  SPLIT CARTON   1 Product  → Multiple Boxes
                 SCENARIO 03  MIXED CARTON   Multiple Products → 1 Box
Section 3      SPI Box Generation System   [0 Boxed] [4 Pending] [0 Total Boxes]
                 grid: ☐ | PRODUCT | CODE | PI QTY | PO QTY | SPI QTY | MISSING QTY |
                       EXTRA QTY | MODE | SUB-BOX COUNT | ACTIONS
                       └ MISSING renders red · EXTRA renders orange
Box card       BOX ID (PUT-B-001 / PUT-MB-001) · SCENARIO · MODE · PRODUCT · QUANTITY
                 QUANTITY is editable in all three scenarios
                 DIMENSIONS [CM|M] [Upload] [Camera] [Gallery] [Save] [Box Sticker]
                 └ CM/M and PRODUCT FLAGS propagate across every box of one product,
                   behind a confirmation popup
                 Box Core Details: LENGTH · WIDTH · HEIGHT · WEIGHT · NET WEIGHT ·
                                   GROSS WEIGHT · VOL. WEIGHT (AUTO)
                 PRODUCT REMARK · BOX CONDITION · PRODUCT FLAGS · Advanced Details
Mixed carton   Selected Products table gains five per-product columns:
                 SERIAL NUMBER · BATCH NUMBER · LOT NUMBER · MFG DATE · EXPIRY DATE
Footer         STEP 03 OF 04 · [Back] [Save & Next]
```

---

## Section 2 — Acceptance criteria

Every case in Section 3 maps to one of these. A case fails **only** when the
matching criterion is not met.

### Stage entry & context

**AC-BP-01 — Stage gating**
*Given* an SPI whose Steps 01 and 02 are saved, *when* the user opens the record,
*then* Step 03 is selectable and shows **ACTIVE**; *and given* Step 02 has not been
saved, *when* the user clicks Step 03, *then* navigation is blocked with a toast
naming the missing step and no Stage 03 state is created.

**AC-BP-02 — Stage context header**
*Given* Stage 03 is open, *then* INVOICE NO, PO NUMBER, SUPPLIER and WAREHOUSE are
read from the **saved** SPI (invoice code, linked PO code, PO supplier, and the PO's
Delivery Location respectively), are read-only, and match Step 01/02 exactly.

**AC-BP-03 — Previous-stage summary**
*Given* two stages are complete, *then* the summary reads *"2 stages done"*, lists
Step 01 and Step 02 as COMPLETED, contains **no editable control**, and every value
shown equals the value saved in that step.

### Packaging scenarios

**AC-BP-04 — Scenario catalogue**
*Then* exactly three scenarios render — 01 STANDARD (1 Product → 1 Box), 02 SPLIT
CARTON (1 Product → Multiple Boxes), 03 MIXED CARTON (Multiple Products → 1 Box) —
the counter badge reads **3 Scenarios**, and each card's title, badge and helper
text match the specification.

**AC-BP-05 — Scenario locking**
*Given* a product row has at least one generated box, *then* that row's scenario is
locked (SUB-BOX COUNT shows *Locked – Scenario NN*, the row shows the scenario chip
and a lock icon) and can only be changed by clearing the chip, which prompts for
confirmation and removes the generated boxes.

### Product grid

**AC-BP-06 — Grid is sourced from Stage 02**
*Then* the grid lists exactly the product lines saved in Step 02 — same names,
product codes, HSN codes and SPI quantities — read-only, in the same order.

**AC-BP-07 — Counters**
*Then* **Boxed + Pending = total boxable lines** at all times, **Total Boxes** equals
the number of box cards created, and all three update immediately on every box
create / delete without a page reload.

**AC-BP-08 — Zero-quantity lines**
*Given* a line has SPI qty 0, *then* it is not boxable, is excluded from the Pending
count, and cannot be selected into any box. **Service lines are boxable** — see the
decision recorded in §4.3.

### Box generation

**AC-BP-09 — Scenario 01 (Standard)**
*Given* Scenario 01 on a row with SPI qty Q, *when* **+ Single Box** is clicked,
*then* exactly one box is created carrying **all Q units as its default**, the row moves
to Boxed, and a second **+ Single Box** on that row is refused. The quantity is editable
from that default — see AC-BP-35.

**AC-BP-10 — Scenario 02 (Split carton)**
*Given* Scenario 02 with sub-box count N (1 < N ≤ Q), *when* **Apply** is pressed,
*then* exactly N boxes are created and **the sum of their quantities equals Q
exactly** — never more, never less.

**AC-BP-11 — Scenario 02 remainder**
*Given* Q is not divisible by N, *then* the remainder is distributed per the
documented rule, no box carries 0 units, and the sum still equals Q.

**AC-BP-12 — Scenario 03 (Mixed carton)**
*Given* two or more boxable rows are selected under Scenario 03, *then* one box is
created listing every selected SKU separately with its own quantity, the header shows
the SKU count and the summed TOTAL QTY, and a single-row selection is refused.

**AC-BP-13 — No double allocation**
*Then* a unit of a product can belong to exactly one box. A row already boxed cannot
be re-boxed or selected into a mixed carton, and the sum of all boxed quantities for
a product can never exceed its Stage-02 SPI quantity.

**AC-BP-14 — Box ID convention**
*Then* every box ID is unique within the SPI, follows the documented convention
(`PUT-B-###` single, `PUT-MB-###` mixed, sub-boxes per the split convention),
increments continuously across products, and a deleted box's ID is never silently
reassigned to different contents.

### Dimensions & weights

**AC-BP-15 — Dimension input**
*Then* Length, Width and Height accept positive decimals only; zero, negative,
alphabetic, symbol and exponent input is rejected at entry with a visible message.

**AC-BP-16 — Unit conversion**
*Given* values entered in CM, *when* the unit is switched to M, *then* all dimension
values and their unit chips convert correctly (100 CM = 1 M) with no data loss, and
switching back returns the original values.

**AC-BP-17 — Volumetric weight**
*Then* VOL. WEIGHT is read-only, marked AUTO, recomputes on every dimension or unit
change, and uses the documented divisor consistently for the selected unit.

**AC-BP-18 — Weight coherence**
*Then* Net Weight ≤ Gross Weight is enforced, the Weight / Net / Gross relationship
follows the documented rule, and violations are blocked at save with a clear message.

### Condition, remarks & evidence

**AC-BP-19 — Product remark**
*Then* PRODUCT REMARK is single-select and defaults to **Correct Product**;
*Damaged / Rejected* and *Mismatched* require supporting detail; *Extra Quantity* is
only selectable when the row's EXTRA is greater than zero.

**AC-BP-20 — Box condition**
*Then* the BOX CONDITION option set is **identical on every box type** (single,
split and mixed), single-select, and defaults to *Perfect*.

**AC-BP-21 — Product flags**
*Then* the PRODUCT FLAGS list is **identical on every box type**, multi-select,
persists on save, and any custom flag added via **+** is scoped to the tenant.

**AC-BP-22 — Evidence capture**
*Then* Upload accepts only the allowed file types within the size cap, Camera degrades
gracefully when permission is denied, and every captured item attaches to the box card
it was started from and appears in that box's Gallery (AC-BP-38). The **Scan** control
is removed from the box card.

**AC-BP-23 — Box sticker**
*Given* a saved box, *then* the sticker is generated with Box ID, SPI code, PO number,
supplier, product(s) and quantity, weight, dimensions and warehouse; its barcode /
QR resolves back to the same box; and a mixed carton prints one shared label listing
all SKUs.

### Batch, expiry & traceability

**AC-BP-31 — Batch & expiry granularity**
*Given* a box holds more than one SKU, *then* batch number, lot number, manufacture
date and expiry date are captured **against each product line inside the box**, never
once for the whole box. A box-level expiry, if it is shown at all, is **derived** —
the earliest expiry across the box's lines — and read-only. *And given* a box holds a
single SKU, *then* the same fields are still stored against that product line, so the
data shape is identical whichever scenario produced the box.

**AC-BP-32 — Expiry validity & carry-through**
*Then* an expiry date may not precede its manufacture date or the invoice date, a
non-expiring product does not require one, and every batch / lot / expiry value
captured in Stage 03 reaches Stage 04 and the box sticker **against the correct
product line** — so FEFO allocation is possible downstream.

### Cross-box consistency

**AC-BP-33 — Cross-box unit consistency**
*Given* a product is split across several boxes, *then* every box of that product shares
one dimension unit. Changing the unit on any one box **prompts for confirmation** before
applying it to all of them; cancelling leaves every box unchanged, including the one
touched; and the propagation is scoped to that product's boxes only, never the whole SPI.

**AC-BP-34 — Cross-box flag consistency**
*Given* a product is split across several boxes, *then* Product Flags are identical on
every box of that product, applied through the same confirm-then-propagate step. A box
holding several SKUs carries its own flags, with nothing to propagate to.

### Quantity handling

**AC-BP-35 — Editable box quantity**
*Then* the quantity on a box is editable in **all three scenarios** — single, split and
mixed. A quantity must be a valid positive number within the product's UOM rule, and the
sum of a product's boxed quantity may never exceed its SPI quantity.

**AC-BP-36 — Extra quantity & dispatch split**
*Given* the SPI quantity exceeds the PO quantity, *then* a box may be filled to the **PO
quantity** for dispatch while the surplus stays Pending and can be boxed separately.
Save & Next stays blocked until every SPI unit is accounted for in a box.

**AC-BP-37 — Quantity columns**
*Then* the box grid shows **PI QTY, PO QTY, SPI QTY, MISSING QTY and EXTRA QTY** as five
separate columns, every figure carried unchanged from the Stage-02 3-way match, with
Missing rendered **red** and Extra rendered **orange**, and a non-colour signal alongside
so the distinction survives for a colour-blind reader.

### Gallery & traceability

**AC-BP-38 — Photo gallery**
*Then* the box card offers a **Gallery** in place of Scan. The gallery lists every
uploaded file and camera capture for **that box and no other**, each viewable at full
size and downloadable individually or together, and everything survives a save and re-open.

**AC-BP-39 — Per-product traceability columns**
*Given* a box holds several SKUs, *then* Serial Number, Batch Number, Lot Number, MFG Date
and Expiry Date are **columns on the Selected Products table** — one independent set per
product — and are not duplicated at box level. The same five fields are stored per product
line on single and split boxes, so the data shape never changes with the scenario.

### Save, navigation, scope

**AC-BP-24 — Save box**
*Then* **Save** on a box card persists that box, confirms with a toast, updates the
counters, and a failed save leaves no phantom box behind.

**AC-BP-25 — Save & Next gate**
*Then* **Save & Next** is refused while any boxable line is still Pending or any box
is missing a mandatory field; on success Stage 03 is marked DONE and Stage 04 opens.

**AC-BP-26 — Back, Close & persistence**
*Then* **Back** returns to Stage 02 without discarding Stage 03 data, **Close** with
unsaved edits prompts for confirmation, and re-opening the SPI (or refreshing the
page) restores every saved box exactly.

**AC-BP-27 — Tenancy & branch scope**
*Then* Stage 03 data is scoped by `client_id` and `branch_id`; a user of another
tenant receives 403, and a branch switch never shows another branch's boxes.

**AC-BP-28 — Permissions**
*Then* a user without SPI edit permission sees Stage 03 read-only — no box creation,
no save, no sticker generation.

**AC-BP-29 — Performance & resilience**
*Then* a 40-line SPI renders and scrolls without freezing, and a network failure
mid-save surfaces an error with a working retry and no data corruption.

**AC-BP-30 — Responsiveness & accessibility**
*Then* the stage renders without clipping at 1366×768 and above, all controls are
keyboard reachable in a logical order, and every icon-only button has an accessible name.

---

## Section 3 — Execution sheet

> Fill **Actual Result**, **Status**, **Bug Reference** and **Tester Remarks** during the run.

### Group A — Stage entry, gating & context (SPI3-01 … SPI3-08)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-02 | From Stage 02, click Step 03 **before** pressing *Save Details* | Navigation blocked with a toast naming the unsaved step; no box state created | S2 | AC-BP-01 | | | | |
| SPI3-03 | From Stage 03 with zero boxes created, click Step 04 | Blocked — Stage 04 cannot open until every boxable line is boxed | S2 | AC-BP-25 | | | | |
| SPI3-04 | Verify the four header pills on Stage 03 | INVOICE NO = saved SPI code, PO NUMBER = linked PO code, SUPPLIER = PO supplier, WAREHOUSE = the PO's Delivery Location | S3 | AC-BP-02 | | | | |
| SPI3-05 | Change the PO's delivery warehouse, reopen the SPI | WAREHOUSE pill reflects the value stored on the SPI at creation — it must not silently change an in-flight invoice | S1 | AC-BP-02 | | | | Confirm the intended rule with dev before logging |
| SPI3-06 | Open Stage 03 on a **Without-PO (Direct)** SPI | Stage exists, PO NUMBER pill hidden or dashed, step counter still correct, box generation works off the SPI's own product lines | S2 | AC-BP-02 | | | | Regression path — Direct must not crash |
| SPI3-07 | From Stage 03, click back into Step 01, then return to Step 03 | Step 01 opens read-only; returning to Step 03 shows every previously created box intact | S1 | AC-BP-26 | | | | |

### Group B — Previous-stage summary (SPI3-09 … SPI3-12)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-12 | Compare Summary values against Step 01/02 saved data | Supplier, invoice number, invoice date, every product's SPI qty / rate / HSN match exactly | S1 | AC-BP-03 | | | | |

### Group C — Packaging scenario selector (SPI3-13 … SPI3-19)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-13 | Verify the three scenario cards and the counter badge | Badge reads **3 Scenarios**; cards read STANDARD / SPLIT CARTON / MIXED CARTON with the correct 1→1, 1→N, N→1 titles and helper text | S3 | AC-BP-04 | | | | |
| SPI3-14 | Select **Scenario 01** on a product row | Row enters single-box mode; SUB-BOX COUNT and Apply are disabled; **+ Single Box** is the only action | S2 | AC-BP-04 | | | | |
| SPI3-15 | Select **Scenario 02** on a product row | SUB-BOX COUNT input and **Apply** become enabled; **+ Single Box** hidden or disabled | S2 | AC-BP-04 | | | | |
| SPI3-16 | Select **Scenario 03** | Row checkboxes become the selection mechanism; a multi-select action appears; single-product actions are suppressed | S2 | AC-BP-04 | | | | |
| SPI3-17 | Apply Scenario 01 to P-002 and Scenario 02 to P-003 in the same SPI | Scenarios are per-row, not global — both rows keep their own scenario and behave independently | S2 | AC-BP-04 | | | | Key mixed-mode case |
| SPI3-18 | After generating a box, inspect the row | Row shows the scenario chip (e.g. *SCENARIO 01 · 1 PRODUCT → 1 BOX ×*), a lock icon, and SUB-BOX COUNT reads *Locked – Scenario 01* | S3 | AC-BP-05 | | | | |
| SPI3-19 | Click the **×** on the scenario chip of a row that already has boxes | Confirmation prompt; on confirm the boxes are removed, the row returns to Pending, counters correct; on cancel nothing changes | S1 | AC-BP-05 | | | | Silent deletion without a prompt is S1 |

### Group D — Box generation grid & counters (SPI3-20 … SPI3-27)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-20 | Compare the grid against the Step 02 product list | Same lines, same order, same product names, codes and HSN codes — nothing added, nothing dropped | S1 | AC-BP-06 | | | | |
| SPI3-21 | Verify the SPI QTY column | Equals the Stage-02 **SPI quantity** (not the PO quantity) and is read-only | S1 | AC-BP-06 | | | | Showing PO qty here is S1 |
| SPI3-22 | Verify the EXTRA column when SPI qty = PO qty, and when SPI qty > PO qty | Shows "—" when equal; shows the exact surplus when over-supplied | S1 | AC-BP-06 | | | | |
| SPI3-23 | Read the counters on first entry with 4 product lines | **0 Boxed · 4 Pending · 0 Total Boxes** | S3 | AC-BP-07 | | | | |
| SPI3-24 | Create one box, then watch the counters | Boxed +1, Pending −1, Total Boxes +1 — instantly, with no reload | S2 | AC-BP-07 | | | | |
| SPI3-25 | Use the header select-all checkbox, then clear it | All boxable rows select / deselect together; already-boxed and non-boxable rows are excluded | S3 | AC-BP-07 | | | | |
| SPI3-27 | Add a Step-02 line with SPI qty 0, then open Stage 03 | Zero-qty line is not boxable and not counted as Pending | S2 | AC-BP-08 | | | | |

### Group E — Scenario 01 · Standard, 1 Product → 1 Box (SPI3-28 … SPI3-33)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-28 | Scenario 01 on Whole Wheat Flour 50kg (150 units) → **+ Single Box** | One box card appears with BOX ID **PUT-B-001** | S2 | AC-BP-09 | | | | |
| SPI3-29 | Read the generated box header | SCENARIO *1 Product → 1 Box* · MODE *Single Box* · PRODUCT *Whole Wheat Flour 50kg* · QUANTITY **150 Units** | S1 | AC-BP-09 | | | | Any quantity other than the full 150 is S1 |
| SPI3-30 | Create a single box on a second product | New box takes the next ID in sequence (**PUT-B-002**) — numbering does not restart per product, and the sequence is scoped **per SPI** | S2 | AC-BP-14 | | | | Sequence restarts on a new SPI, not on a new product |
| SPI3-31 | Click **+ Single Box** twice on the same row | Second click is refused with a message; only one box exists for that row | S1 | AC-BP-13 | | | | Duplicate box = duplicate stock, S1 |
| SPI3-32 | Read the QUANTITY on a freshly generated Scenario 01 box | Pre-filled with the full SPI quantity (150) as the **default** — and editable from there | S1 | AC-BP-09 | | | | Rule changed in r2: editability is now SPI3-111 |
| SPI3-33 | Delete a generated box | Row returns to Pending, counters correct, and the freed Box ID is not reassigned to different contents | S1 | AC-BP-14 | | | | Confirm the ID-reuse rule with dev |

### Group F — Scenario 02 · Split carton, 1 Product → Multiple Boxes (SPI3-34 … SPI3-42)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-34 | Sub-box count **3** on a 150-unit line → **Apply** | Exactly 3 box cards are created | S2 | AC-BP-10 | | | | |
| SPI3-35 | Inspect the 3 sub-box IDs | All unique, all following the documented split convention, none colliding with existing PUT-B / PUT-MB IDs | S2 | AC-BP-14 | | | | Record the actual convention in Remarks |
| SPI3-36 | Verify the quantity split for 150 ÷ 3 | 50 + 50 + 50 = **150** — the sum equals the SPI quantity exactly. The split is the **starting point**; each sub-box quantity is editable afterwards | S1 | AC-BP-10 | | | | Editing is covered by SPI3-112 |
| SPI3-37 | Verify a non-divisible split: 100 units ÷ 3 boxes | Remainder distributed per rule (e.g. 34 / 33 / 33); no box has 0 units; sum = **100** | S1 | AC-BP-11 | | | | Rounding that loses or invents a unit is S1 |
| SPI3-38 | Enter sub-box count **0** → Apply | Blocked with a validation message; no boxes created | S2 | AC-BP-10 | | | | |
| SPI3-39 | Enter sub-box count `-2`, `2.5`, `abc`, `1e3`, and a blank | Each rejected or sanitised at entry; no box created; no console error | S2 | AC-BP-10 | | | | Whole positive numbers only |
| SPI3-40 | Enter sub-box count **200** on a 150-unit line | Blocked — a split can never produce more boxes than units | S1 | AC-BP-10 | | | | Otherwise zero-unit boxes reach the warehouse |
| SPI3-41 | Edit one sub-box's quantity upward after generation | Either the others rebalance automatically or the edit is blocked — the total can never exceed the SPI quantity | S1 | AC-BP-13 | | | | |
| SPI3-42 | Press **Apply** twice in quick succession | Only one set of boxes is created — no duplicates, no double count | S1 | AC-BP-10 | | | | Double-click / slow-network race |

### Group G — Scenario 03 · Mixed carton, Multiple Products → 1 Box (SPI3-43 … SPI3-50)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-43 | Select Whole Wheat Flour (150) + GreenBoost Fertilizer (50), generate a mixed box | BOX ID **PUT-MB-001**, PRODUCTS **2 SKUs**, TOTAL QTY **200 Units** | S1 | AC-BP-12 | | | | |
| SPI3-44 | Read the *Selected Products (2)* panel | Both lines listed with product code and their own SPI qty (150 u, 50 u); panel total reads **200 units** | S1 | AC-BP-12 | | | | |
| SPI3-45 | Remove one product from the mixed box using the row **×** | SKU count → 1, TOTAL QTY recalculates, the removed row returns to Pending | S1 | AC-BP-12 | | | | |
| SPI3-46 | Remove the **last** remaining product from a mixed box | Either blocked, or the empty box is dissolved and both rows return to Pending — never an orphan 0-SKU box | S2 | AC-BP-12 | | | | |
| SPI3-47 | Press **Clear Selection** | Panel empties, every selected row returns to Pending, counters correct | S2 | AC-BP-12 | | | | |
| SPI3-48 | Select only **one** row under Scenario 03 and try to generate | Refused — a mixed carton requires at least 2 SKUs | S2 | AC-BP-12 | | | | |
| SPI3-49 | Try to select a row already boxed under Scenario 01 into a mixed carton | Checkbox disabled / selection refused — a unit cannot be in two boxes | S1 | AC-BP-13 | | | | |
| SPI3-50 | Create a mixed box, then a second one | PUT-MB sequence increments independently of PUT-B and stays unique | S2 | AC-BP-14 | | | | |

### Group H — Box core details: dimensions & weights (SPI3-51 … SPI3-60)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-51 | Enter valid decimals in Length / Width / Height (e.g. 45.5) | Accepted and retained to the documented precision | S2 | AC-BP-15 | | | | |
| SPI3-52 | Enter `0`, `-10`, `abc`, `12@`, `1e5` in a dimension field | Each rejected with a visible message; no save proceeds; no console error | S2 | AC-BP-15 | | | | |
| SPI3-53 | Enter 100 / 80 / 60 in CM, then switch the unit toggle to **M** | Values convert to 1 / 0.8 / 0.6 and every unit chip on the card updates to M | S1 | AC-BP-16 | | | | Values that stay numerically identical are S1 |
| SPI3-54 | Switch back from **M** to **CM** | Original values return with no rounding loss | S1 | AC-BP-16 | | | | |
| SPI3-55 | Watch VOL. WEIGHT while entering dimensions | Read-only, marked AUTO, recalculates on every keystroke/blur using the documented divisor | S1 | AC-BP-17 | | | | Record the divisor used, in Remarks |
| SPI3-56 | Change the unit toggle and re-check VOL. WEIGHT | Volumetric weight is recomputed for the new unit — no stale value, no divisor mismatch | S1 | AC-BP-17 | | | | Classic defect spot |
| SPI3-57 | Enter Net Weight **50** and Gross Weight **40** | Blocked — net can never exceed gross | S1 | AC-BP-18 | | | | |
| SPI3-58 | Enter very large values (999999) in every numeric field | Handled per the documented cap; layout does not break; no overflow or exponent display | S3 | AC-BP-15 | | | | |
| SPI3-59 | Press **Save** on a box with all dimension fields empty | Blocked with the mandatory fields highlighted and the first error scrolled into view | S2 | AC-BP-24 | | | | |
| SPI3-60 | Save a box with dimensions filled but weights blank | Behaviour matches the documented mandatory set; message names the missing field | S2 | AC-BP-24 | | | | Confirm which weights are mandatory |

### Group I — Product remark, box condition & flags (SPI3-61 … SPI3-67)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-61 | Inspect PRODUCT REMARK defaults and selection behaviour | Single-select, defaults to **Correct Product**; selecting another option deselects the previous one | S3 | AC-BP-19 | | | | |
| SPI3-62 | Select **Damaged / Rejected** and save | A reason / remark is required; the damaged quantity is captured and carried to Stage 04 / debit note per the rule | S1 | AC-BP-19 | | | | Confirm the downstream rule with dev |
| SPI3-63 | Select **Extra Quantity** on a row whose EXTRA is "—" | Refused — the option is only valid when a surplus exists | S2 | AC-BP-19 | | | | |
| SPI3-64 | Select **Mismatched** and save | The actually-received product must be captured before saving | S2 | AC-BP-19 | | | | |
| SPI3-65 | Compare BOX CONDITION options on a **single-product** box vs a **mixed** box | Identical option sets on both | S2 | AC-BP-20 | | | | Screens currently differ — see §4.1 |
| SPI3-66 | Compare PRODUCT FLAGS on a **single-product** box vs a **mixed** box | Identical flag lists on both | S2 | AC-BP-21 | | | | Screens currently differ — see §4.2 |
| SPI3-67 | Select multiple flags, toggle Stackable, add a custom flag via **+**, then save and reopen | All flag states persist exactly; a custom flag is visible only within the same tenant | S2 | AC-BP-21 | | | | |

### Group J — Evidence capture: Upload / Camera / Scan (SPI3-68 … SPI3-73)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-68 | Upload a valid JPG / PNG / PDF | Accepted, thumbnail or filename shown against the correct box | S2 | AC-BP-22 | | | | |
| SPI3-69 | Upload a `.exe`, a `.svg` and a zero-byte file | Each rejected with a clear message; nothing attaches | S1 | AC-BP-22 | | | | Unfiltered upload is a security defect |
| SPI3-70 | Upload a file above the size cap | Rejected with a message stating the limit — not a silent failure or a 500 | S2 | AC-BP-22 | | | | Record the cap in Remarks |
| SPI3-73 | Look for the **Scan** control on the box card | Scan is **removed** — the card offers Upload, Camera, Gallery, Save and Box Sticker only | S2 | AC-BP-22 | | | | De-scoped in r2; replaced by the Gallery |

### Group K — Box sticker / label (SPI3-74 … SPI3-78)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-74 | Click **Box Sticker** on an unsaved box | Refused with a message telling the user to save the box first | S2 | AC-BP-23 | | | | |
| SPI3-75 | Generate the sticker on a saved single-product box | Shows Box ID, SPI code, PO number, supplier, product name + code, quantity, gross weight, dimensions and warehouse | S2 | AC-BP-23 | | | | |
| SPI3-76 | Scan the sticker's barcode / QR | Resolves to the same Box ID it was printed for | S1 | AC-BP-23 | | | | Wrong resolution breaks putaway |
| SPI3-77 | Generate the sticker on a **mixed carton** | One shared label listing every SKU in the box with its quantity | S2 | AC-BP-23 | | | | |
| SPI3-78 | Print and download the sticker | Output is not clipped, text is legible at label size, barcode is scannable from the printed copy | S3 | AC-BP-23 | | | | |

### Group L — Save, navigation & persistence (SPI3-79 … SPI3-85)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-79 | Press **Save** on a fully filled box card | Success toast; the card shows a saved state; counters update | S2 | AC-BP-24 | | | | |
| SPI3-80 | Press **Save & Next** while one product is still Pending | Blocked with a message naming the unboxed product(s) | S2 | AC-BP-25 | | | | |
| SPI3-81 | Box every product, then press **Save & Next** | Stage 03 marked DONE, Stage 04 "Temporary Putaway Allocation" opens with the generated boxes carried across | S1 | AC-BP-25 | | | | Boxes missing in Stage 04 is S1 |
| SPI3-82 | Press **Back** from Stage 03 | Returns to Stage 02; every Stage 03 box survives | S1 | AC-BP-26 | | | | |
| SPI3-84 | Re-open a completed SPI from the list and go to Stage 03 | Every saved box renders with its exact IDs, quantities, dimensions, remarks, flags and evidence | S1 | AC-BP-26 | | | | |
| SPI3-85 | Open the same SPI in two browser tabs and save a box in each | Defined behaviour — either the second save is rejected with a stale-data message, or it merges; never a silent overwrite | S1 | AC-BP-24 | | | | Confirm the intended rule with dev |

### Group M — Tenancy, permissions & non-functional (SPI3-86 … SPI3-92)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-86 | Create boxes on a Branch A SPI, then switch to Branch B via the branch switcher | Branch B does not show Branch A's SPI or its boxes | S1 | AC-BP-27 | | | | |
| SPI3-87 | As a user of Client B, call the Stage 03 box endpoints for a Client A SPI (Postman) | HTTP 403 / 404 — never another tenant's data | S1 | AC-BP-27 | | | | Tenant isolation |
| SPI3-88 | Log in as a user without SPI edit permission and open Stage 03 | Stage renders read-only: no box creation, no save, no sticker | S1 | AC-BP-28 | | | | |
| SPI3-89 | Open Stage 03 on an SPI with 40+ product lines | Grid renders and scrolls smoothly; counters correct; no browser freeze | S2 | AC-BP-29 | | | | Note the render time in Remarks |
| SPI3-90 | Disconnect the network mid-save on a box card | Error toast with a working retry; no phantom box; counters not corrupted | S1 | AC-BP-29 | | | | |
| SPI3-92 | Navigate Stage 03 by keyboard only (Tab / Enter / Space) | Every control is reachable in a logical order, focus is visible, and icon-only buttons announce a name | S3 | AC-BP-30 | | | | |

### Group N — Batch, expiry & traceability (SPI3-93 … SPI3-102)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-93 | On a mixed carton (PUT-MB-001, 2 SKUs), locate the Batch No / MFG Date / Expiry Date fields | Each field sits on **each product line inside the box** — two independent sets for two SKUs — not once at box level | S1 | AC-BP-31 | | | | The core defect this group exists for |
| SPI3-94 | Give the two SKUs in one mixed carton **different** expiry dates, save, reopen | Both dates are retained separately against their own product line — neither overwrites the other | S1 | AC-BP-31 | | | | One shared value overwriting both is S1 |
| SPI3-95 | Look for a box-level Expiry Date on a mixed carton | Either absent, or present as a **derived read-only** value showing the earliest expiry in the box | S1 | AC-BP-31 | | | | An editable box-level expiry is the bug |
| SPI3-96 | Enter batch and expiry on a **Scenario 01** single-product box, save, reopen | Stored against the product line, not the box — same data shape as a mixed carton | S2 | AC-BP-31 | | | | Two storage shapes will break Stage 04 |
| SPI3-97 | Split a line into 3 sub-boxes, then set a different batch on sub-box 2 | Each sub-box defaults to the line's batch/expiry and can be overridden individually — same SKU, different pallets | S2 | AC-BP-31 | | | | Confirm override is intended |
| SPI3-98 | Enter an expiry date already in the past | Blocked, or accepted only with an explicit warning per the documented rule — never accepted silently | S1 | AC-BP-32 | | | | Expired stock entering putaway is S1 |
| SPI3-99 | Enter an expiry date earlier than the MFG date, and earlier than the invoice date | Both rejected with a message naming the conflicting date | S2 | AC-BP-32 | | | | |
| SPI3-101 | Print the sticker for a mixed carton whose SKUs have different expiries | Each SKU printed with **its own** batch and expiry; any single box-level expiry on the label is the **earliest** of them | S1 | AC-BP-32 | | | | Wrong label drives wrong FEFO picking |
| SPI3-102 | Complete Stage 03 and open Stage 04 | Every batch / lot / expiry value arrives against the correct product line, so FEFO allocation is possible | S1 | AC-BP-32 | | | | Data lost between stages is S1 |

### Group O — Cross-box unit & flag consistency (SPI3-103 … SPI3-110)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-103 | Split a line into 3 sub-boxes, then change the unit on sub-box 1 from CM to M | A confirmation popup asks whether to apply the unit to **every box of that product** | S2 | AC-BP-33 | | | | Silent propagation with no prompt is a defect |
| SPI3-104 | Confirm that popup | All 3 sub-boxes switch to M together, and every dimension value converts with them | S1 | AC-BP-33 | | | |  |
| SPI3-105 | Repeat, then press **Cancel** on the popup | Nothing changes — the unit stays as it was on all 3 sub-boxes, including the one you touched | S2 | AC-BP-33 | | | | Cancel must not half-apply |
| SPI3-106 | Try to leave two sub-boxes of the same product on different units | Not possible — the unit is either synced automatically or the save is blocked with a message | S1 | AC-BP-33 | | | | Mixed units make the box weights incomparable |
| SPI3-107 | Set **Product Flags** on sub-box 2 of a split line | A confirmation popup offers to apply the flags to every box of that product; on confirm all sub-boxes match | S2 | AC-BP-34 | | | |  |
| SPI3-108 | Compare flags across the sub-boxes after confirming | Identical flag sets on every box of that product — no partial application | S1 | AC-BP-34 | | | |  |
| SPI3-109 | Change the unit and flags on P-002's boxes, then inspect P-003's boxes | P-003 is untouched — propagation is scoped to one product's boxes, never the whole SPI | S1 | AC-BP-33 | | | | Cross-product bleed is S1 |
| SPI3-110 | Change the unit and flags on a mixed carton (one box, several SKUs) | Applies to that box only, with no propagation popup — there is nothing to propagate to | S3 | AC-BP-34 | | | |  |

### Group P — Editable box quantity & extra-quantity dispatch (SPI3-111 … SPI3-120)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-111 | Edit the QUANTITY on a Scenario 01 single box | Editable — accepts a new value and the row's Pending balance recalculates | S1 | AC-BP-35 | | | | Replaces the old fixed-quantity rule |
| SPI3-112 | Edit a sub-box quantity on a Scenario 02 split | Editable per sub-box; the running total across sub-boxes updates live | S1 | AC-BP-35 | | | |  |
| SPI3-113 | Edit a product's quantity inside a Scenario 03 mixed carton | Editable per product line; the box TOTAL QTY recalculates | S1 | AC-BP-35 | | | |  |
| SPI3-114 | Enter a box quantity above the line's SPI quantity | Blocked — a product's total boxed quantity can never exceed its SPI quantity | S1 | AC-BP-35 | | | |  |
| SPI3-115 | Enter 0, a negative, or a non-numeric box quantity | Rejected at entry with a message; no box is saved carrying an invalid quantity | S2 | AC-BP-35 | | | |  |
| SPI3-116 | **PO 150 / SPI 160** — box exactly 150 units for dispatch | Accepted; the box carries 150 and the remaining 10 units stay Pending as the extra | S1 | AC-BP-36 | | | | The dispatch case this rule exists for |
| SPI3-117 | Box the remaining 10 extra units into a separate box | Allowed — a second box is created for the surplus and the line moves to Boxed | S1 | AC-BP-36 | | | |  |
| SPI3-118 | Press **Save & Next** with 150 of 160 units boxed | Blocked — every SPI unit must be accounted for before Stage 04 opens | S1 | AC-BP-36 | | | |  |
| SPI3-119 | Reduce a saved box quantity after the line was fully boxed | The line returns to partially Pending, counters update, and Save & Next blocks again | S2 | AC-BP-35 | | | |  |
| SPI3-120 | Enter a decimal quantity on a whole-unit UOM line (e.g. 12.5) | Handled per that product's UOM rule — rejected or accepted consistently | S2 | AC-BP-35 | | | | Confirm the UOM rule with dev |

### Group Q — Quantity columns in the box grid (SPI3-121 … SPI3-128)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-121 | Inspect the box generation grid columns | Shows **PI QTY, PO QTY, SPI QTY, MISSING QTY and EXTRA QTY** as five separate columns | S2 | AC-BP-37 | | | |  |
| SPI3-122 | Compare all five values against the Stage-02 3-way match | Every figure matches the Stage-02 grid exactly — carried across, not recalculated | S1 | AC-BP-37 | | | |  |
| SPI3-123 | Line with SPI 140 against PO 150 | MISSING QTY reads **10** and is rendered in **red** | S1 | AC-BP-37 | | | |  |
| SPI3-124 | Line with SPI 160 against PO 150 | EXTRA QTY reads **10** and is rendered in **orange** | S1 | AC-BP-37 | | | |  |
| SPI3-125 | Line where SPI qty equals PO qty | Missing and Extra both read 0 or a dash in neutral colour — not a red or orange zero | S3 | AC-BP-37 | | | |  |
| SPI3-126 | Open an SPI whose PO has **no linked Proforma Invoice** | PI QTY is blank or dashed, mirroring how Stage 02 hides its PI columns — never zero | S2 | AC-BP-37 | | | | Zero would read as a real PI quantity |
| SPI3-127 | Check that colour is not the only signal | Missing and Extra are also distinguishable by label, icon or sign for a colour-blind user | S3 | AC-BP-37 | | | |  |
| SPI3-128 | Edit a box quantity, then re-read the five columns | Unchanged — these are invoice-level figures, not box-level; boxing must not move them | S1 | AC-BP-37 | | | |  |

### Group R — Photo gallery (SPI3-129 … SPI3-136)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-129 | Inspect the box card action bar | Offers Upload, Camera, **Gallery**, Save and Box Sticker — Scan is gone | S2 | AC-BP-38 | | | |  |
| SPI3-130 | Upload two files and take one camera photo, then open **Gallery** | All three appear together in that box's gallery | S1 | AC-BP-38 | | | |  |
| SPI3-131 | Open a photo from the gallery | Opens at full size, readable, with a clear way back to the gallery | S2 | AC-BP-38 | | | |  |
| SPI3-132 | Download a single photo | Downloads successfully with a filename that identifies the box | S2 | AC-BP-38 | | | |  |
| SPI3-133 | Download all photos for a box | Every item downloads; nothing missing, nothing corrupt | S2 | AC-BP-38 | | | |  |
| SPI3-134 | Open the gallery on PUT-B-002 while PUT-B-001 also has photos | Only PUT-B-002's photos are shown — no cross-box leakage | S1 | AC-BP-38 | | | | Wrong evidence on a damage claim is S1 |
| SPI3-135 | Open the gallery on a box with no photos | A clear empty state — not a blank panel, a spinner or an error | S3 | AC-BP-38 | | | | Confirm whether delete-from-gallery is in scope |
| SPI3-136 | Save the box, reopen the SPI, open the gallery | Every photo is still present and still downloadable | S1 | AC-BP-38 | | | |  |

### Group S — Per-product traceability columns in a mixed carton (SPI3-137 … SPI3-144)

| Test Case ID | Test Scenario | Expected Result | Sev | AC Ref | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|---|
| SPI3-137 | Inspect the **Selected Products** table on a mixed carton | Carries SERIAL NUMBER, BATCH NUMBER, LOT NUMBER, MFG DATE and EXPIRY DATE as five per-product columns | S1 | AC-BP-39 | | | |  |
| SPI3-138 | Enter different values in all five columns for each of the 4 SKUs in PUT-MB-001 | Each row keeps its own values — nothing bleeds into another row | S1 | AC-BP-39 | | | |  |
| SPI3-139 | Save, reopen the SPI, re-read the table | All per-product values return exactly as entered, against the right products | S1 | AC-BP-39 | | | |  |
| SPI3-140 | Look for the same fields inside **Advanced Details** on a mixed carton | Not duplicated at box level — the per-product table is the only place they are captured | S2 | AC-BP-39 | | | | Two homes for one value guarantees drift |
| SPI3-141 | Enter an expiry earlier than the MFG date on row 2 only | Rejected with a message naming **that product**; the other rows are unaffected | S2 | AC-BP-39 | | | |  |
| SPI3-142 | Remove a product from the mixed carton after filling its five columns | That row's values go with it; the remaining rows keep theirs intact | S1 | AC-BP-39 | | | |  |
| SPI3-143 | Add a product to an existing mixed carton | New row appears with **empty** traceability columns — not pre-filled from another row | S2 | AC-BP-39 | | | | Copied batch numbers break recall |
| SPI3-144 | Check the same five fields on a single-product box and on a split sub-box | Present and stored per product line there too, so the data shape matches the mixed carton | S2 | AC-BP-39 | | | |  |

---

## Section 4 — Design inconsistencies to resolve before execution

Raise these with development first. They will otherwise produce many duplicate
bug reports.

### 4.1 BOX CONDITION option set differs between box types

| Box type | Options shown |
|---|---|
| Single-product box (PUT-B-001) | Perfect · **Minor Damage** *(Light wear)* · **Critical Damage** *(Not usable)* — **3 options** |
| Mixed carton (PUT-MB-001) | Perfect · **Minor** *(Light wear)* · **Major** *(Visible damage)* · **Severe** *(Critical)* — **4 options** |

One canonical list is required. Covered by **SPI3-65**.

### 4.2 PRODUCT FLAGS list differs between box types

| Box type | Flags shown |
|---|---|
| Single-product box | Hazardous · Cold Chain · Fragile · **Stackable** (toggle) |
| Mixed carton | Hazardous · **Regulated** · Cold Chain |

*Fragile*, *Stackable* and *Regulated* appear on one screen but not the other.
Covered by **SPI3-66**.

### 4.3 Service lines are boxable — RESOLVED, decision recorded

*Quality Testing Service* (HSN 999899, qty 1) is a non-stockable service line. The
question raised in r1 was whether it should be filtered out of Stage 03.

**Decision: service lines are boxable.** The r2 design shows PUT-MB-001 holding
4 SKUs and 301 units with the service line selected alongside three physical
products, and the r1 test case (SPI3-26) has been de-scoped.

One residual point worth a line in the sticker spec rather than a bug: a carton's
"301 Units" then includes one non-physical unit, so box unit counts and the
quantity printed on the label will not tie back to physical contents. Confirm how
the label should present it.

### 4.4 No persistence layer

There is no migration, model or endpoint for boxes or putaway in the repository —
the SPI schema is `supplier_purchase_invoices` + `supplier_purchase_invoice_items`
only. Until a box table ships, Stage 03 data will not survive a refresh, a Back, or
a re-open. Covered by **SPI3-08**, **SPI3-82**, **SPI3-84**.

### 4.5 Expiry and batch are modelled at the wrong level

**This is the most consequential item in this section.**

A mixed carton holds several SKUs in one box. Each of those SKUs has **its own**
batch number, manufacture date and expiry date — they are properties of the *goods*,
not of the *carton*. A single box-level Expiry Date field therefore cannot represent
a mixed carton at all: whichever value is entered is wrong for at least one product
in the box.

The correct shape:

| Field | Belongs to | Why |
|---|---|---|
| Batch No / Lot No | **Product line inside the box** | Two SKUs in one carton come from two different production batches |
| MFG Date | **Product line inside the box** | Follows the batch |
| Expiry Date | **Product line inside the box** | Follows the batch; drives FEFO picking per SKU |
| Earliest expiry in the box | Box (derived, read-only) | Useful on the label and for putaway zoning — but computed, never typed |
| Dimensions, box weight, box condition | Box | Genuine properties of the carton |

Two supporting facts from the codebase:

1. **Expiry does not exist anywhere in the SPI chain.** There is no `expiry_date`,
   `mfg_date` or `shelf_life` column on `supplier_purchase_invoices`,
   `supplier_purchase_invoice_items`, or the product master.
2. **Batch is modelled once per product, forever.** `Product` carries
   `batch_no`, `serial_no`, `cat_no` and `lot_no` as **product-master** fields
   ([Product.php](../app/Models/Product.php)) — one value for the SKU's whole life.
   Two inward consignments of the same SKU would share a single batch number, which
   makes per-consignment traceability and recall impossible.

Both need a per-receipt (per-box-line) home before Stage 03 can be signed off.
Covered by **Group N — SPI3-93 … SPI3-102**.

### 4.6 Undocumented conventions to confirm before testing

| Item | Question for dev |
|---|---|
| Sub-box ID format | What is the ID for a split-carton sub-box? (`PUT-B-003-01`? `PUT-SB-003`?) |
| Box ID reuse | Is a deleted box's ID retired or reused? |
| Split remainder rule | For 100 ÷ 3, is it 34/33/33, 33/33/34, or blocked? |
| Volumetric divisor | Which divisor, and does it change with CM ↔ M? |
| Weight relationship | Is Gross = Net + tare, and which of Weight / Net / Gross are mandatory? |
| Damaged flow | Does *Damaged / Rejected* create a Debit Note or only annotate the box? |
| Extra quantity | Resolved in r2 — over-supply is boxable; see Group P (SPI3-116–118). |
| Shelf-life products | Which product categories require an expiry, and where is that flag configured? |
| Past expiry | Is inward stock with an expired date blocked, or accepted with a warning? |

---

## Section 5 — Test data set-up

Reproduce the exact data in the design screens so the expected values in Section 3 apply verbatim.

1. **Supplier** — *Reliance Industries*, GST scrutiny dated **within the last 3 months**
   (older than 3 months blocks Step 01 → Step 02 with *"GST scrutiny overdue"*).
2. **Warehouse** — *Pune Phase 2 Warehouse*, set as the PO's Delivery Location.
3. **Purchase Order** — `PO/2025-26/001` for that supplier and warehouse, with four lines:

   | Product | Code | HSN | Qty |
   |---|---|---|---|
   | Whole Wheat Flour 50kg | P-002 | 11010000 | 150 |
   | GreenBoost Organic Fertilizer | P-003 | 31010000 | 50 |
   | Organic Mango Pulp | P-004 | 20079100 | 100 |
   | Quality Testing Service | P-005 | 999899 | 1 |

4. **SPI** — created via *Add → With Purchase Order → PO/2025-26/001 → Confirm*.
   Expect the code `SPI/2025-26/001` (first invoice of the FY for that tenant).
5. **Step 02** — enter the invoice number, an invoice date **on or after the PO date
   and not in the future**, attach a file, keep the SPI quantities equal to the PO
   quantities, then **Save Details**.
6. **Second data set for negative cases** — a copy of the PO with a **100-unit** line
   (for the non-divisible 100 ÷ 3 split, **SPI3-37**) and one line invoiced at an
   **over-supplied** quantity (for the EXTRA column, **SPI3-22** and **SPI3-63**).
7. **Scope cases** — a second branch under the same client (**SPI3-86**), a user in a
   second client (**SPI3-87**), and a user with SPI view-only permission (**SPI3-88**).

---

*Revision 2 · 2026-08-24 · Scope: Supplier Purchase Invoice, Stage 03 only · 133 cases · 39 acceptance criteria.*
