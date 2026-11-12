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

### 3.1 Stage 3 packing internals (scenarios, validation, codes)

**Scenario model (`SpiBox::SCENARIOS = ['s1','s2','s3']`).** A box's scenario is *derived from its contents*, not a free choice: `s1` = one product fully in one box, `s2` = one product across N boxes, `s3` = ≥2 products in one box. `normaliseBoxScenarios()` **collapses an s2 split that resolves to a single box back to s1**, so the scenario always matches reality. The mixed carton (`s3`) carries each SKU's own identity; `s1`/`s2` carry one box-level identity.

**Packing is a SUM, never a stored column.** Packed qty for a line = `SUM(SpiBoxItem.quantity)` (soft-deleted excluded); pending = `qty_spi − packed` (`SupplierInvoiceService::packingSummary`). `syncPackingStage()` re-derives the 2↔3 boundary on every box change — so `stage_completed` tracks reality and never claims "packed" with units loose. **Do not add a cached packed column.**

**Server-side box validation (`SpiBoxController::validateBox` + `guardOverPacking`)** — the browser's `validate()` is mirrored here, server is authority:
- dimensions `length/width/height_cm` **required** and `> 0`; `gross_weight_kg` required; `net_weight_kg ≤ gross_weight_kg`.
- each `items[]` row `quantity > 0`; **`guardOverPacking` refuses a box whose contents exceed the line's pending qty** (sum of other boxes excluded) → 422.
- identity date sanity: `expiry > mfg`, `expiry ≥ today`, `mfg ≤ today`.
- a non-`correct` `remark` (`damaged`/`mismatched`/`extra`) **requires** `remark_note`; `extra` only on a line with `extra_qty > 0`.
- `flags[]` are master flag ids (built-in Hazardous/Cold-Chain/Fragile + custom from `inventory_product_flags`); they drive warehouse eligibility and the sticker pictograms.

**Codes & locks.** `box_code = B-NNN` is allocated per invoice (`nextBoxCodes`, restarts at B-001 each SPI, **unique only within the invoice**). `sticker_printed_at` set by `printSticker` → `isCodeLocked()` true (the code is now on the floor). A box is editable until a `SpiPutaway` row exists for it (allocated in Stage 4), then locked; `destroy` is refused once put away.

**Finish gate (`completeStage3`).** Refuses with 422 if there are no lines or any line is not fully boxed, then runs `WarehouseCapabilityService::missingFor()` — if the warehouse lacks a zone allowing the boxes' cold-chain/hazardous flags it returns **422 `warehouse_incompatible`** (the UI's `WarehouseFixModal`); a `setWarehouse` to a compatible one clears it. On pass → `stage_completed = max(3, current)` → Stage 4.

---

## 4. Services & helpers

| Service | Responsibility |
|---|---|
| `P2p\SupplierInvoiceService` | `nextCode/previewCode` (per-branch SPI code), `financialYear`, `openQtyByPoItem`, `splitBalance` (open/over/closed), `packingSummary` (per-line packed/pending from `SpiBoxItem` SUM), `packingTotals`, `normaliseBoxScenarios` (s2→s1), `syncPackingStage` (derive 2↔3), `rollupTotals`, `saveItems`, `syncFulfilment` (writes `SpiPoFulfilment`; CANCELLED returns qty to PO), `log` (SpiActivity) |
| `P2p\SpiSummaryService` | `build` (summary dialog), `packedBoxes` |
| `P2p\P2pVaultService` | `forSpi` / `forPo` (the Evidence Vault — gathers grouped docs; see §6) |
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

---

## 6. Stage 2 — the match engine (all variants)

Stage 2 is one endpoint — `@updateItems` (**POST**, because PHP skips `$_FILES` on PUT) — saving the **whole grid at once**. What differs per flavour is only **where the lines come from** and **how many quantity columns are meaningful**; the save path, the gates and the arithmetic are shared.

### 6.1 Line provenance per flavour
| Flavour | Lines seeded from | Match columns that matter | Add / remove rows |
|---|---|---|---|
| **With PO, PO has a PI** | the PO (`@poLines`), each PO line carrying its PI promise | **3-way:** `qty_pi` · `qty_po` · `qty_spi` | no Add; a line may be removed/restored, but **not** below what Stage 3 already packed |
| **With PO, no PI** | the PO | **2-way:** `qty_po` · `qty_spi` (`qty_pi` null) | same |
| **Direct + Shipment** | the shipment's **PI** (lines fixed to the PI) | **2-way:** `qty_pi` · `qty_spi` (no PO) | no Add; lines fixed |
| **Direct, no shipment** | nothing — operator adds rows | plain entry, `qty_spi` only | **+ Add Product** (product + qty per row) |

- `@poLines` (`GET /p2p/spi/orders/{po}/lines`) returns `qty_po / qty_billed / qty_open / qty_over / closed / rate / gst_pct`; `?exclude_spi` excludes the current invoice's own draft so re-opening Stage 2 doesn't double-count it.
- A **PI-seeded** Direct row carries `pi_item_id`; a **PO-seeded** row carries `po_item_id`. A row with neither (`po_item_id === null`) is **unmapped** (`SupplierInvoiceItem::isUnmapped()`) — it consumes no PO open qty and writes no `SpiPoFulfilment`.

### 6.2 The match arithmetic (`SupplierInvoiceItem`)
- `qty_pi` — PI promised · `qty_po` — PO ordered · `qty_spi` — supplier billed (the only column the operator edits here).
- `missing_qty` (appended, derived) = `max(0, (qty_po ?? qty_pi) − qty_spi)`.
- `extra_qty` — over-supply, **stored** snapshot (the opposite of missing); drives the *Extra Quantity* box remark and the Inventory disposition in Stage 4.
- `variance()` = `qty_spi − qty_po`.
- **Packed is never stored here** — it is `SUM(SpiBoxItem.quantity)` (see §2.4). So a Stage-2 line can't be shrunk below what Stage 3 already boxed.

### 6.3 Save path & gates (`@updateItems`)
1. Validate `invoice_no` (**unique per client+vendor**), `invoice_date` (≥ PO date, or the PI date for a Direct+Shipment SPI; ≤ today), currency/FX (international), the `items[]` array and the totals block.
2. Validate files: `invoice_file` **required** (PDF/JPG/PNG/WEBP ≤10MB), `eway_file` optional — stored via the file service, **superseding** any previous upload.
3. **Direct SPI only** → `guardSupplierSegments()`: every product's segment must belong to the supplier (CS-1140).
4. **Over-billing warns, never blocks** (`overBillWarnings` → `warnings[]` in the response).
5. Persist lines + totals (the grid owns the arithmetic — the server trusts the sent totals block, it does not recompute prices), set `stage_completed = max(2, current)`.
6. Run `normaliseBoxScenarios()` (collapse a 1-box split back to s1) then `syncPackingStage()` (re-derive the 2↔3 boundary from current packing).

> **International:** the four GST columns stay **NULL** (not 0), TDS does not apply, and `currency_code` + `exchange_rate` are required. `isInternational()` reads `document_type === 'international'`.

---

## 7. Payment flow — PO-backed vs Direct (they are NOT the same)

Payments are always raised and viewed **from the invoice**, but *where the row is stored, what the ceiling is, and who approves* split cleanly on `purchase_order_id`. Both handlers (`PoPaymentRequestController@storeFromSpi` / `@storePaymentFromSpi`) branch on it in their first line: no PO → the invoice pays on its own; PO → hand off to the order.

| | **PO-backed SPI** | **Direct SPI** (`isStandalone()`) |
|---|---|---|
| Request row | `store($po)` — on the **PO** (`purchase_order_id` set), `supplier_invoice_id` stamped so it traces back to the SPI | `storeForSpi` — on the **invoice** (`purchase_order_id` **NULL**, `supplier_invoice_id` set) |
| Payment row | `storePayment($po)` — lands on the PO, checked against the **PO's** balance | `savePaymentForSpi` — on the invoice, checked against the **invoice's** balance |
| Ceiling | the PO's net payable (all its SPIs share it) | the **invoice's own** net payable = `grand_total − tds_amount` |
| Approver (`requested_to`) | the PO's rule | an **active, non-`client_admin` user of the invoice's branch** — *a request stops at the branch head* |
| TDS | on the order | **must be saved first** (even as 0) before a request, domestic only; `tds_updated_at` gate |
| Zoho bill | belongs to the **order** | the invoice **owns its own** bill (`ownsZohoBill()` → `isStandalone()`) |

> **There IS an approver on a payment request** — the named `requested_to`. (Contrast the refund-adjustment module below, which has *no* approval.) A PO-backed request can also be raised from a sibling SPI; any of them pays from the one PO ledger.

- **Tables:** `p2p_po_payment_requests` (the ask: `code`, `purchase_order_id`, `supplier_invoice_id`, `requested_amount`, `requested_to`, `status`) → `p2p_po_payments` (the release: `amount`, `proof_path/name`, `utr_cheque_number/date`, `bank_name`).
- **Endpoints:** `POST …/payment-requests` (`@storeFromSpi`), `POST …/payment-requests/{req}/payments` (`@storePaymentFromSpi`, *"Make SPI Payment"*), edit/delete via the `{payment}` verbs (Direct-SPI payments only), `PUT …/tds` (`@saveTdsForSpi` — Direct SPI; PO-backed is redirected to the order), history `GET …/payment-requests` (`@paymentRequests` → `{spi, requests_summary, po, ledger, requests[]}`). The list row carries `pending_payment_requests` / `approved_unpaid_amount`.
- **In the vault:** released payments surface in the invoice's **Payment Proofs** section (`P2pVaultService::paymentRows`), labelled with request code, the SPI they were *"against"*, bank and UTR; money released on a PO with **no invoice behind it** is a separate *"released against the order"* group (`loosePaymentGroup`, `forPo` only).

### 7.1 Cancelling a paid order — the Refund Adjustment is a PO module, not an SPI one
Once money has gone to the supplier, a **PO cannot be cancelled directly** — it must be reversed through the **Advance Receipt Refund Adjustment** (`PoRefundAdjustmentController`, code `ADR/<FY>/<SEQ>`, route `/p2p/advance-refund-adjustment`). Raising it cancels the PO, **declines every still-pending payment request on it** (note *"Closed — PO cancelled (ADR/…)"*), releases its PI lines, and opens a receivable recovered by repayment entries until the balance hits zero. See `docs/p2p/refund-adjustment/*`.

Its relevance to **SPI**:
- A **PO-backed SPI** whose payments were declined by a refund adjustment will show those requests in the **Declined** tab — the money it raised can no longer be paid. The refund lives on the **PO**, never on the SPI.
- A **Direct SPI has no PO**, so the refund-adjustment path **does not apply** to it. A Direct SPI is unwound with `@destroy` (soft delete, refused once `closed`), which returns no PO quantity because there was none; its own payments are the invoice's to reconcile.
- **No approval, immediate effect** distinguishes the refund adjustment from the payment request above: raising it is approved by nobody and takes effect in one transaction, whereas a payment request always names an approver.

---

## 8. The Evidence Vault (`P2pVaultService`)

Read-only, and it **gathers rather than generates** — every document it lists was produced somewhere else. It answers the same chain from **either end**:
- `forSpi($spi)` — one invoice's own papers, plus the order's documents above it. Backs `GET /p2p/spi/{id}/evidence-vault`.
- `forPo($po)` — the order, its trade documents, **one block per invoice** raised under it, and any payment released on the order itself. Backs `GET /p2p/orders/{po}/evidence-vault`.

> This is the **same service** behind the PO's **six-section** Evidence Vault (Purchase Order · Supplier Purchase Invoices · Trade Documents & Agreements · Advance Receipt Refund Adjustment · Payment Paid Proofs · Recovery Payment Proofs — see `docs/p2p/purchase-order/…` §8B). The SPI view (`forSpi`) is the **invoice-centric** slice of it: it drops the per-invoice fan-out and the refund/recovery sections (those exist only on a cancelled PO, which a Direct SPI never has) and adds the box stickers and packing images that belong to *this* invoice.

**Shape — one level the whole way down:** `body → groups[] → sections[] → documents[]`. A section with no documents is dropped; a group whose every section dropped is dropped (`group()`/`section()`/`body()` all filter nulls) — *a heading with nothing under it reads as a gap in the file, not an unfilled section.*

**Groups produced by `forSpi`:** `poGroup` (Order Copy — only if the SPI has a PO) · `tradeGroup` (Trade Documents + Agreements, with signing state; **null** if the PO has no trade docs) · `invoiceGroup` (Invoice & E-way Bill · Box Stickers · Box & Product Images · Payment Proofs). `invoiceGroup` is **nullable** on purpose — a brand-new SPI has none of these, and declaring it non-null threw a TypeError on exactly the freshest invoice the vault is most likely opened against.

**The `source` field is what a screen branches on** (never inferring state from which URLs are null):
| `source` | Meaning | Screen offers |
|---|---|---|
| `uploaded` | a person filed this file | View + Download |
| `generated` | rendered on demand (PO PDF, box sticker) | the action (`action_url`), until a file exists |
| `signed` | came back from the signer | View + Download, from the **signature request** (`signed_file_url`), not the unsigned draft in `file_path` |
| `awaited` | nobody has provided it yet | nothing — this is the gap, drawn on purpose |

- `doc()` demotes any row with no `path` to `awaited` (unless it was `generated`).
- **A sticker is not a stored file** — it carries an `action_url` (`…/boxes/{box}/sticker/download`) to print on demand, not a `file_url` to save (`boxDocs`).
- **Files stream through `/p2p/files/download?path=…`** (authenticated, picks the right disk, restores the original filename) because Azure keeps blobs off-origin where a direct link can't be saved. `?mode=preview` opens in-tab, `?mode=download` saves.
- `totals = {documents, available, missing}` drives the header's *"N of M on file"*.

> **Not the supplier's vault.** KYC / due-diligence / trade licences belong to the **vendor**, not an order, and live at `GET /segment-uploads/supplier/{id}/vault` (`SegmentDocUploadController@vault`) — opened from Stage 1's Legal Status card. `P2pVaultService` never touches those.

---

## 9. Roles & access (verified)

The SPI controllers carry **no per-action permission check** — same as the PO and Payment Request modules. The single API guard is `tenantUser()`:
```php
private function tenantUser(Request $request) {
    $user = $request->user();
    if (!$user?->client_id) abort(response()->json(['status' => false, 'message' => 'No tenant context'], 403));
    return $user;   // no role test, no module-permission test
}
```
- `grep` for `can_view|can_approve|authorize|Gate::|->can(` across `SupplierInvoiceController`, `SpiBoxController`, `SpiPutaway*Controller` returns **zero** hits. Any authenticated user with a `client_id` can drive the whole flow for that client.
- The only *who-you-are* rule is on the reused **payment request**: approver must be an active non-`client_admin` of the invoice's branch, and only the addressee decides.
- **Menu gate:** leaf `p2p.invoice` via `perms[id]?.can_view` (plan-gated); a super admin sees it but 403s on every call (no `client_id`).
- **Handheld** (`/scan/putaway/*`) is device-authenticated (`X-Scan-Cert-CN` / enrolled `X-Scan-Device`), no user session — a separate gate; unknown/suspended devices are refused.
- **Tenant isolation** (`BelongsToTenant`, `client_id`/`branch_id` from the token, never the body) **is** enforced and cannot be bypassed. Hiding the menu does not stop the endpoints answering — raise as a finding, not intended behaviour.
