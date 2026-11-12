# SPI — Technical Documentation
**Module:** Supplier Purchase Invoice (SPI) / Inward · P2P
**Audience:** Backend / full-stack engineers
**Scope:** Data model, state machines, stage transitions, services. Pairs with the API doc and code walkthrough.

---

## 1. Architecture at a glance

A 4-stage inward flow, all under `/api/p2p/spi/*`, **except** the device-authenticated handheld (`/api/scan/putaway/*`) and the branch-wide floor queue (`/api/putaway/tasks/*`).

```
Stage 01  header draft          SupplierInvoice (status=draft)
Stage 02  invoice grid + match  SupplierInvoiceItem  (qty_pi / qty_po / qty_spi)
Stage 03  box packaging         SpiBox + SpiBoxItem (+ SpiBoxAttachment)
Stage 04  put-away              SpiPutaway  (+ SpiPutawayTask for Zebra)
          ────────────────────────────────────────────────────────────
Submit →  status=mapped, stage_completed=4  →  downstream GRN
```

- **Tenancy:** `BelongsToTenant` injects `client_id` + `branch_id` from the authenticated user — never from the request body. `created_by` / `updated_by` likewise.
- **Soft deletes** on the header, items, boxes, box items, attachments and put-away rows. `SpiPutawayTask` and `PutawayActivityLog` are **not** soft-deleted (tasks are reaped; the log is append-only).

---

## 2. Data model

### 2.1 `SupplierInvoice` — `p2p_supplier_invoices`
The header. **With-PO vs Without-PO is marked by `purchase_order_id IS NULL`** — there is deliberately **no** separate "standalone" flag (one source of truth).

- `isStandalone()` → `purchase_order_id === null` (there is no `isDirect`; queries use raw `whereNull/whereNotNull('purchase_order_id')`).
- `ownsZohoBill()` → `isStandalone()` (only a Direct SPI creates its own Zoho bill; a PO-backed bill belongs to the order).
- A Direct SPI carries its **own** `shipment_order_id`, `procurement_request_id/code`, TDS/payment columns; a PO-backed invoice leaves these null and reads the order's.

**`status`** — `STATUSES = ['draft','mapped','grn_pending','closed','cancelled']`
- `isEditable()` → status ∈ {draft, mapped} (gates Stage-1, items and box edits).
- Transitions: create → `draft`; `submit()` → `mapped` (+ `stage_completed = 4`); `destroy()` soft-deletes (logs *cancelled*, refused if `closed`); `grn_pending` is reserved for the downstream GRN.

**`stage_completed`** (int 0–4):
| Value | Meaning | Set by |
|---|---|---|
| 0 | draft exists, Stage 01 not answered (Direct SPI starts here) | `store` for Direct |
| 1 | Stage 01 done (PO-backed starts here — choosing the PO *is* Stage 01) | `store`/`updateStage1` via `max(blockers ? 0 : 1, current)` |
| 2 | items saved | `updateItems` via `max(2, current)` |
| 3 | fully packed | `syncPackingStage()` (walks 2↔3) + `completeStage3` |
| 4 | submitted | `submit()` only |

> Stage never falls back — every setter uses `max(new, current)`.

**`document_type`** — `DOC_TYPES = ['domestic','international']`. `isInternational()`. International → the four GST columns stay **NULL** (not 0), TDS does not apply, `currency_code` is required.

Key columns: `code` (`SPI/{FY}/NNN`, per branch), `purchase_order_id`, `vendor_id`, `shipment_order_id`, `procurement_request_id/code`, `invoice_no/date/file`, `eway_*`, totals (`taxable_total`, `total_cgst/sgst/igst`, `grand_total`), `tds_*`, `paid_amount`, `balance_amount`, `currency_code`, `exchange_rate`, `warehouse_id`, `zoho_bill_*`.

Relations: `purchaseOrder`, `shipmentOrder` (Direct), `vendor`, `warehouse` (→ `Inventory\Warehouse` = `inventory_warehouses`), `items`, `boxes`, `putaways`, `fulfilments`, `activities`, `gstApprovals`, `paymentRequests`.

### 2.2 `SupplierInvoiceItem` — `p2p_supplier_invoice_items`
The Stage-02 line and the **3-way match**: `qty_pi` (PI promised) · `qty_po` (PO ordered) · `qty_spi` (supplier billed).
- `missing_qty` (appended) = `max(0, (qty_po ?? qty_pi) − qty_spi)` — derived.
- `extra_qty` — over-supply, **stored** snapshot (opposite of missing).
- `isUnmapped()` → `po_item_id === null` (consumes no PO qty, writes no fulfilment).
- `variance()` → `qty_spi − qty_po`.
- Packed/pending is **not** stored here — it is summed from `SpiBoxItem`.

### 2.3 `SpiBox` — `p2p_spi_boxes`
One physical carton (Stage 03). Tenant-scoped (scanned by code on the floor).
- `SCENARIOS = ['s1','s2','s3']` — s1 one→one, s2 one→many (split), s3 many→one (mixed, ≥2 products).
- `CONDITIONS = ['perfect','minor','major','severe']`; `isDamaged()` → ≠ perfect.
- `box_code` = `B-NNN`, **unique only within an invoice** (every SPI restarts at B-001).
- `flags` (array of master flag ids), dims (`length/width/height_cm`), weights (`weight/net_weight/gross_weight_kg`), `condition`, `is_stackable`, `temp_min_c/temp_max_c`, `sticker_printed_at`.
- `isCodeLocked()` → `sticker_printed_at !== null` (printing the sticker fixes the code — it is being scanned).
- `volumetricWeightKg()` = (L×W×H)/6000 (computed, never stored).
- Relations: `items` (SpiBoxItem), `attachments`, `putaway` (**HasOne** — unique on `box_id`; a box rests in one place).

### 2.4 `SpiBoxItem` — `p2p_spi_box_items`
**This table is the packing tracker.** Packed qty for a line = `SUM(quantity)` of its box items (excluding soft-deleted); pending = `qty_spi − packed`.
- `REMARKS = ['correct','damaged','mismatched','extra']`; `isDamaged()` → ≠ correct (drives disposition).
- Columns: `box_id`, `supplier_invoice_item_id`, `quantity` (decimal:3), `is_stackable`, `remark/remark_note`, `flags`, identity (`serial_no`, `lot_no`, `batch_no`, `cat_no`, `expiry_date`, `mfg_date`).

### 2.5 `SpiBoxAttachment` — `p2p_spi_box_attachments`
One file per row. `box_item_id` NULL = about the carton; set = about one product in it. Appends `url`, `is_image`.

### 2.6 `SpiPutaway` — `p2p_spi_putaways`
Stage 04, **one row per box** (unique on `box_id`). Until `confirmed_at` is set, the box is *picked but not placed*.

**Scan chain timestamps:** `box_scanned_at` → `location_scanned_at` → `rack_scanned_at` → `shelf_scanned_at`.

**Status is DERIVED** to avoid drift (there is a `status` column, but the canonical state is computed):
```
stage4Status(hasOpenTask):
  confirmed_at        → 'placed'
  else open task      → 'awaiting_scan'
  else shelf||zone_id → 'draft'
  else                → 'pending'
```
| Derived status | Meaning |
|---|---|
| `pending` | nobody started (no row, or row with no location) |
| `draft` | location held/reserved+locked but unconfirmed (operator walked away) |
| `awaiting_scan` | a Zebra task is open |
| `placed` | confirmed (person or device) — final |

- `STEPS`: pending→(1, Review Box), draft→(3, Confirm Placement), awaiting_scan→(3, …awaiting scan), placed→(4, Put-away Summary). (Step 2 "choose a location" is transient, no status.)
- `nextScan(fullPutaway)` → 'box'/'location'/'rack'/'shelf'/null (on a 3PL/summary warehouse the chain ends at 'location').
- `isPlaced()` → `confirmed_at !== null`; `isReadyToConfirm($full)` → `nextScan` null and not placed.
- Columns: `warehouse_id`, `zone_id`, `rack_id`, `shelf_id`, `destination` (human path), `status`, `assigned_at/by`, the four `*_scanned_at`, `device_id/serial`, `scanned_by`, `confirmed_at/by`, `condition_at_putaway`, plus `occupancy_id`, `suggested_shelf_id`, `task_id`, `verify_method`.

### 2.7 `SpiPutawayTask` — `p2p_spi_putaway_tasks`
A box handed to the floor for Zebra verification — "outstanding work". Created **only** for Option 01 (manual confirmation makes none). Not soft-deleted (reaped).

**`status`** — `PENDING`, `SCANNED`, `FAILED`, `CANCELLED`, `EXPIRED`.
- `scopeOpen()` / `isOpen()` → pending.
- Transitions: created `pending` → `scanned` (both barcodes matched, on `/complete`) → or `cancelled` (cancel endpoint) → or `expired` (TTL reap, `DEFAULT_TTL_HOURS = 8`).

**Two-slot scan state machine** (box + location, scannable in **either** order): `box_scan_at`, `shelf_scan_at` (used for shelf OR zone), with `zone_scan_at`/`rack_scan_at` for the chain, and `box_confirmed_at`/`shelf_confirmed_at` (the operator's agreement at Complete). `required_scans = 2`, `completed_scans`, `fail_count`.
- **Location chain** (zone→rack→shelf): `locationChain()` (deepest-last, per-level scanned flag), `locationSlot()` → 'shelf' if `shelf_id` else 'zone', `markLocationScanned($kind)` marks that level **and all above** (a shelf proves its rack and zone), `nextLocationLevel()` = deepest unscanned.
- `currentStep()`: no box_scan → 'scan_box'; no location scan → 'scan_'+slot; else 'complete'. `readyToComplete()` = both box_scan_at & shelf_scan_at set.
- `MAX_FAILS = 3` → `resetScans()` (back to box). Idle reaping via `scansAreStale()` / `idleSecondsLeft()` (config `inventory.scan_stale_minutes`, default 30 stale / 5 idle countdown).
- `task_code` = `ZT-YYYYMMDD-NNN` per branch per day. Also: `putaway_id`, `box_id`, `occupancy_id`, location ids, `capacity_reserved_pct`, `issued_at/by`, `device_id/serial`, `completed_at`, `cancelled_at/by`, `failed_reason`, `expires_at`.

### 2.8 `PutawayActivityLog` — `inventory_putaway_activity_logs`
**Append-only** (no `updated_at`, no soft delete, no `update()`). Corrections are new rows. Records everything that isn't a bare scan.
- Events: `ASSIGNED`, `REASSIGNED`, `TASK_CREATED`, `TASK_CANCELLED`, `SCAN_PASSED`, `SCAN_FAILED`, `CONFIRMED_MANUAL`, `CONFIRMED_DEVICE`, `RELEASED`, `LOCK_ACQUIRED`, `LOCK_RELEASED`.
- Columns: `subject_type/id`, `occupancy_id`, `putaway_id`, `task_id`, `box_id`, `event`, `from_location`/`to_location` (array snapshots), `actor_type/id`, `device_id`, `meta` (array; `act` = scan|confirm|lookup|stale_reset, `slot`, `value`, `reason`).
- Distinct from `p2p_spi_scan_logs` (`SpiScanLog`), which logs **every** attempt (incl. refusals) from the older `SpiPutawayController::scan` path.

---

## 3. Stage transitions (gates)

**Stage 01 → draft.** `store` validates the header (`vendor_id` required; `purchase_order_id` nullable; `shipment_order_id` + `warehouse_id` tenant-scoped; `document_type` required), allocates `code`. PO-backed starts at `stage_completed = 1`, Direct at `0`. **Guard:** a PO whose lines are all fully invoiced is refused (CS-937). `updateStage1` only while `isEditable()`.

**Direct-SPI GST gate** — `stage1Blockers()` runs only for Direct SPI:
- `gst_blocked` — scrutiny older than `PurchaseOrderService::GST_STALE_MONTHS`.
- `gst_approval` — supplier's last GST return overdue → needs a senior approval raised against this invoice (`PoGstApproval`, must reach `STATUS_APPROVED`).
- `expired_documents` — supplier paperwork expired.
- Fields save regardless; the **stage is withheld** (`stage_completed` stays 0) rather than refusing — the invoice records goods that already arrived. While an approval is pending/approved, `vendor_id` and `document_type` lock.

**Stage 01 → 02.** `updateItems` (POST — PHP doesn't populate `$_FILES` on PUT) saves the **whole grid at once**. Validates `invoice_no` (unique per client+vendor), `invoice_date` (≥ PO/PI date, ≤ today), currency/FX, the line array and totals. Direct SPI → `guardSupplierSegments()` (each product's segment must belong to the supplier, CS-1140). Over-billing **warns** (`overBillWarnings`). Stores invoice/eway files (supersedes old). Sets `stage_completed = max(2, current)`; grid owns arithmetic; then `normaliseBoxScenarios()` + `syncPackingStage()`.

**Stage 02 → 03 (packing).** Boxes created/edited one-per-request via `SpiBoxController`. Each save → `guardOverPacking` (can't exceed pending), `normaliseBoxScenarios` (s2→s1 collapse), `syncPackingStage`. **Gate:** `completeStage3` refuses if no lines or any line not fully boxed, and enforces **warehouse capability** (`WarehouseCapabilityService::missingFor()` → 422 `warehouse_incompatible` if the warehouse lacks a zone allowing the boxes' cold-chain/hazardous flags).

**Stage 03 → 04 (put-away).** Warehouse chosen at Stage 01 (`setStorageType`) is changeable until the first put-away row exists; null warehouse = Third Party (summary). `isFullPutaway()`/`isOwnWarehouse()` reads `inventory_warehouses.wh_type === 'own'` → full rack+shelf chain; 3PL → summary (location only).
- **Allocate:** `assign` locks the location, reserves capacity, creates/moves the `SpiPutaway` row to `draft`.
- **Option 01 (Zebra):** `scan-task` → `SpiPutawayTask` (pending), row → `awaiting_scan`; the handheld's `/complete` → row `placed`, occupancy occupied, lock released, task `scanned`.
- **Option 02 (manual):** `confirm-manual` → row `placed`, `verify_method='manual'`, occupancy occupied, lock released.
- **Legacy hand-scan path:** `putaway/scan` (box→location→rack→shelf, logs every attempt to `SpiScanLog`) + `putaway/{row}/confirm`.

**Stage 04 → close.** `submit` refuses if no items, any qty unpacked, or **any box not placed** (`whereDoesntHave('putaway', status=placed)`). On success → `status = mapped`, `stage_completed = 4`. Downstream = GRN. `destroy` soft-deletes (refused if `closed`), returning each line's qty to the PO via `syncFulfilment(EVENT_CANCELLED)`.

---

## 4. Services & helpers

| Service | Responsibility |
|---|---|
| `P2p\SupplierInvoiceService` | `nextCode/previewCode` (per-branch SPI code), `financialYear`, `openQtyByPoItem`, `splitBalance` (open/over/closed), `packingSummary` (per-line packed/pending from `SpiBoxItem` SUM), `packingTotals`, `normaliseBoxScenarios` (s2→s1), `syncPackingStage` (derive 2↔3), `rollupTotals`, `saveItems`, `syncFulfilment` (writes `SpiPoFulfilment`; CANCELLED returns qty to PO), `log` (SpiActivity) |
| `P2p\SpiSummaryService` | `build` (summary dialog), `packedBoxes` |
| `P2p\P2pVaultService` | `forSpi` (evidence vault, grouped docs) |
| `Inventory\WarehouseCapabilityService` | `requiredFor`, `capabilitiesOf`, `missingGiven`, `missingFor` — gates Stage 3→4 and storage-type change |
| `Inventory\LocationFinderService` | `forBox` — ranked recommendation + location tree |
| `Inventory\LocationOccupancyService` | reserve / release / occupy, `liveFor` |
| `Inventory\LocationLockService` | `acquireOrExtend` / `held` / `release` / `heartbeat` (SHELF/ZONE locks; reasons PUTAWAY / RELEASED_REASSIGNED / RELEASED_COMPLETED) |
| `Inventory\PutawayActivityLogger` | `log` / `snapshot` |
| `Inventory\StickerKey` | `url('BOX',$id,$clientId)`, `idFor`, `parse` — signed sticker QR for BOX/ZONE/RACK/SHELF/WAREHOUSE |

**Stickers/PDF:** DomPDF (`Barryvdh\DomPDF\Facade\Pdf`, view `pdf.spi-box-sticker`), QR via `chillerlan\QRCode` (ECC-H), hand-drawn SVG pictograms for cold-chain/hazardous/fragile/do-not-stack. Flag behaviour (`none/warn/block`) comes from `inventory_product_flags`.

---

## 5. Shipment link (provenance only)

The shipment link is **optional** and the second of the two splits. All "shipment" mechanics live in the header/`SpiBoxController` — **no shipment write happens in the put-away stages**.
- `SupplierInvoice.shipment_order_id` (nullable) — set only on a Direct SPI (`shipmentOrder` → `App\Models\ShipmentOrder`). A PO-backed invoice reads the shipment through `purchaseOrder.shipment_order_id`.
- `applyShipmentMode()` (list filter): *with_shipment* = own `shipment_order_id` not null OR PO has one; *without_shipment* = the complement.
- A shipment carries a PI (`proforma_invoices`), which carries the opportunity (`opp_code`) and customer/consignee — read by the sticker (`SpiBoxController::refs()/parties()`), preferring the PO's own PI/lead and falling back to the shipment's for a Direct SPI.
- `validateHeader()` tenant-scopes `shipment_order_id` via `Rule::exists('shipment_orders','id')->where('client_id', …)`. Stage-02 `invoice_date` minimum falls back to the shipment's PI date for a Direct SPI.
