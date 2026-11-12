# SPI — API Documentation
**Module:** Supplier Purchase Invoice (SPI) / Inward · P2P
**Audience:** Frontend / integration engineers, QA
**Base:** all paths are under `/api`. Unless noted, routes require **`auth:sanctum`** + tenant scoping (client_id / branch_id come from the user, never the body).

Routes live in `routes/api.php`: the `Route::prefix('p2p/spi')` block (~L562–672), the handheld `scan/putaway` block (~L117–125), and the floor-queue `/putaway/tasks` block (~L1536–1542).

---

## 1. Lookups · List · Detail

| Method | Path | Handler | Purpose | Key params / response |
|---|---|---|---|---|
| GET | `/p2p/spi/next-code` | `SupplierInvoiceController@nextCode` | Preview the next SPI code (writes nothing) | → `{code, financial_year}` |
| GET | `/p2p/spi/orders/{po}/lines` | `@poLines` | PO lines to prefill Stage 02 | `?exclude_spi` · → lines[] with `qty_po/qty_billed/qty_open/qty_over/closed/rate/gst_pct` |
| GET | `/p2p/spi` | `@index` | Paginated list + tab counts | filters: `po_mode` (with_po/without_po), `shipment_mode` (with_shipment/without_shipment), `status`, `vendor_id`, `from`, `to`, `q`, `page`, `per_page` · → `{data[], tabs, meta}` (rows carry `boxes_total/boxes_placed/putaway_complete, is_direct, zoho_status, pending_payment_requests, approved_unpaid_amount`) |
| GET | `/p2p/spi/{id}` | `@show` | One invoice + items + packing + put-away summary | → `{invoice, owns_zoho_bill, match, packing_summary, packing_totals, putaway{mode,placed,total,rows[]}}` |

---

## 2. Stage 01 — Header

| Method | Path | Handler | Purpose | Notes |
|---|---|---|---|---|
| POST | `/p2p/spi` | `@store` | **Create draft** (first write) | body = `validateHeader` (`vendor_id` req; `purchase_order_id` nullable; `shipment_order_id`, `warehouse_id` tenant-scoped; `document_type` req). PO fully-invoiced is refused. → 201 invoice |
| PUT | `/p2p/spi/{id}/stage-1` | `@updateStage1` | Edit draft header | → `{data, blockers[]}` (only while `isEditable()`) |
| POST | `/p2p/spi/{id}/gst-approval/request` | `PoGstApprovalController@storeForInvoice` | Raise GST senior approval (**Direct SPI only**) | PO-backed → refused (approve on the PO) |
| GET | `/p2p/spi/{id}/gst-approvals` | `PoGstApprovalController@indexForInvoice` | Approvals for this invoice, newest first | |

---

## 3. Stage 02 — Items / Match

| Method | Path | Handler | Purpose | Notes |
|---|---|---|---|---|
| POST | `/p2p/spi/{id}/items` | `@updateItems` | Save grid + totals + invoice/eway files | **POST** (PHP skips `$_FILES` on PUT); multipart or JSON. Body: `items[].{id,po_item_id,pi_item_id,product_id,qty_spi,rate,extra_qty,gst_pct,taxable_amount,cgst/sgst/igst,line_total}` + `taxable_total/total_* /grand_total` + `invoice_file/eway_file`. → `{invoice, match, warnings[]}` |
| PUT | `/p2p/spi/{id}/submit` | `@submit` | Close Stage 04 → status `mapped` | `note` · refuses on unpacked/unplaced |
| DELETE | `/p2p/spi/{id}` | `@destroy` | Soft delete, returns qty to PO | refused if `closed` |

---

## 4. Stage 03 — Boxes / Stickers (`SpiBoxController`)

| Method | Path | Handler | Purpose | Notes |
|---|---|---|---|---|
| GET | `/p2p/spi/{id}/boxes` | `@index` | All boxes + items + packing summary + uoms/flags maps | |
| GET | `/p2p/spi/{id}/boxes/next-codes` | `@nextCodes` | Preview next box codes | `?count` (1–100) |
| GET | `/p2p/spi/{id}/packing-summary` | `@packingSummary` | Per-line packed/pending + totals | |
| GET | `/p2p/spi/{id}/boxes/{box}` | `@show` | One box | |
| POST | `/p2p/spi/{id}/boxes` | `@store` | Create a box | `validateBox` (scenario, dims, weights, condition, temp range, `items[]`, `flags[]`) |
| PUT / POST | `/p2p/spi/{id}/boxes/{box}` | `@update` | Edit a box | POST variant for photo multipart |
| DELETE | `/p2p/spi/{id}/boxes/{box}` | `@destroy` | Delete a box | refused if already put away |
| DELETE | `/p2p/spi/{id}/boxes/{box}/attachments/{attachment}` | `@destroyAttachment` | Remove a box photo | |
| POST | `/p2p/spi/{id}/boxes/{box}/sticker` | `@printSticker` | Stamp `sticker_printed_at` + return payload | locks the box code |
| GET | `/p2p/spi/{id}/boxes/{box}/sticker/download` | `@downloadSticker` | 4×6 PDF label (DomPDF `pdf.spi-box-sticker`, signed QR) | stamps printed_at |
| GET | `/p2p/spi/sticker-preview` | `@stickerPreview` | Local-only synthetic preview (**no auth**) | query: `cold/haz/fragile/nostack/condition/scenario/refs` |
| PUT | `/p2p/spi/{id}/stage-3` | `SupplierInvoiceController@completeStage3` | **Gate:** packing finished + warehouse capable | refuses if not fully packed / `warehouse_incompatible` |

---

## 5. Stage 03/04 — Read helpers (`SupplierInvoiceController`)

| Method | Path | Handler | Purpose | Notes |
|---|---|---|---|---|
| GET | `/p2p/spi/{id}/summary` | `@summary` | Temporary Put-away Summary dialog | `SpiSummaryService::build` |
| GET | `/p2p/spi/{id}/packed-boxes` | `@packedBoxes` | Every packed box resolved, paged/filtered | `bucket` (all/ship/inv/damaged/mismatch), `handling` (haz/non_haz/cold), `search`, page/per_page |
| GET | `/p2p/spi/{id}/evidence-vault` | `@evidenceVault` | All docs filed against the invoice | `P2pVaultService::forSpi` |

---

## 6. Stage 04 — Put-away (`SpiPutawayController`)

| Method | Path | Handler | Purpose | Notes |
|---|---|---|---|---|
| GET | `/p2p/spi/{id}/putaway` | `@index` | Rows + put-away mode (full/summary) + progress | |
| PUT | `/p2p/spi/{id}/storage-type` | `@setStorageType` | Set/clear warehouse (null = 3PL) | fixed once put-away started; capability-checked |
| GET | `/p2p/spi/{id}/warehouse-eligibility` | `@warehouseEligibility` | Required (cold/haz) + per-warehouse compatibility | → `{required, warehouses{}}` |
| POST | `/p2p/spi/{id}/putaway/scan` | `@scan` | One hand-scan (box→location→rack→shelf); logs every attempt | `scan_type, scanned_value, box_code, device_serial, latency_ms` |
| PUT | `/p2p/spi/{id}/putaway/{row}/confirm` | `@confirm` | Confirm placement (hand-scan path) | `condition_at_putaway, note` |

### Allocation (`SpiPutawayAllocationController`)
| Method | Path | Handler | Purpose | Notes |
|---|---|---|---|---|
| GET | `/p2p/spi/{id}/putaway/board` | `@board` | Every box's status/sub-step + counts (driven from BOXES) | `counts{pending,draft,awaiting_scan,placed,remaining}, steps[], boxes[]` |
| GET | `/p2p/spi/{id}/putaway/locations` | `@locations` | Where a box may go (tree + recommendation) | `box_id` req, `mode` (rack/norack) · `LocationFinderService::forBox` |
| POST | `/p2p/spi/{id}/putaway/assign` | `@assign` | Lock + reserve + create/move row → `draft` | `box_id, mode, zone_id, rack_id, shelf_id, suggested_shelf_id, session_id` · **409** if location in use |
| POST | `/p2p/spi/{id}/putaway/{row}/confirm-manual` | `@confirmManual` | **Option 02:** operator attests → `placed` | `confirmed, condition_at_putaway, note` |

### Tasks (`SpiPutawayTaskController`)
| Method | Path | Handler | Purpose | Notes |
|---|---|---|---|---|
| POST | `/p2p/spi/{id}/putaway/{row}/scan-task` | `@store` | **Option 01:** raise Zebra task (row → `awaiting_scan`) | `confirmed, ttl_hours` (1–72, default 8) · → 201 task |
| GET | `/p2p/spi/{id}/putaway/tasks` | `@index` | This invoice's task queue + counts | |
| GET | `/p2p/spi/{id}/putaway/boxes/{box}/activity` | `@boxActivity` | A box's frozen activity log (handheld + manual) | → `{box_code, timeline[]}` |
| GET | `/putaway/tasks` | `@queue` | Branch-wide floor queue, open first | `?status, per_page` |
| POST | `/putaway/tasks/{task}/cancel` | `@cancel` | Close task (occupancy stays reserved) → `cancelled`, row → `draft` | `reason` · blocked once scanning started |
| GET | `/putaway/tasks/{task}` | `@show` | One task status (poll-cheap) | `step/step_label/ready_to_complete/attempts_left/is_open/is_done` |
| GET | `/putaway/tasks/{task}/activity` | `@activity` | Full scan history incl. refusals | → `task/timeline[]/stickers[]/counts` |

---

## 7. Handheld (device-auth, **no user session**) — `SpiPutawayScanController`

Prefix `scan/putaway`, `throttle:120,1`. Device identified by client certificate (`X-Scan-Cert-CN`) or an `X-Scan-Device` token (enrolled via `/enroll#<credential>`).

| Method | Path | Handler | Purpose | Notes |
|---|---|---|---|---|
| POST | `/scan/putaway/session` | `@session` | Who is this handheld + its open tasks | |
| POST | `/scan/putaway/scan` | `@scan` | A barcode arrived; server classifies box/shelf/rack/zone and judges it | `scanned_value, task_id?, staged_location?, staged_kind?` · the scan that closes the pair auto-completes |
| GET | `/scan/putaway/{task}` | `@show` | Current task state (page refresh); drops stale scans | |
| POST | `/scan/putaway/{task}/confirm` | `@confirm` | Operator agrees with a scanned slot | `slot` (box/shelf/zone) |
| POST | `/scan/putaway/{task}/complete` | `@complete` | **The only call that moves stock** | commits occupancy occupy + row `placed` + task `scanned` |
| POST | `/scan/putaway/{task}/release` | `@release` | "Clear box" — give back proved scans, task stays pending | |
| POST | `/scan/device-check` | `ScanDeviceController@check` | Public device credential check (`throttle:60,1`) | |
| POST | `/scan-devices/enroll` | `ScanDeviceController@enroll` | Finish enrollment on the handheld (needs login) | enroller authors every later scan |

---

## 8. Payment / Zoho (SPI-scoped)

| Method | Path | Handler | Purpose | Notes |
|---|---|---|---|---|
| GET | `/p2p/spi/{id}/payment-requests` | `@paymentRequests` | Payment Requests History popup | → `spi/requests_summary/po/ledger/requests[]` |
| PUT | `/p2p/spi/{id}/tds` | `PoPaymentRequestController@saveTdsForSpi` | Set TDS on **Direct SPI** | PO-backed → sent to order |
| POST | `/p2p/spi/{id}/payment-requests` | `@storeFromSpi` | Raise a payment request from the invoice (still against the PO) | |
| POST | `/p2p/spi/{id}/payment-requests/{req}/payments` | `@storePaymentFromSpi` | "Make SPI Payment" | |
| POST / DELETE | `/p2p/spi/{id}/payment-requests/{req}/payments/{payment}` | `@update / @destroyPaymentFromSpi` | Edit/delete a Direct-SPI payment | |
| POST | `/p2p/spi/{id}/zoho-sync` | `@zohoSync` | Standalone bill sync | **501** (not wired yet) |
| GET | `/p2p/spi/{id}/zoho-tracker` | `@zohoTracker` | Bill owner / status / can_retry | |

---

## 9. Common response conventions

- Collections: `{ data: [...], tabs?: {...}, meta: { current_page, per_page, total, last_page } }`.
- Validation failures: **HTTP 422** with `errors` keyed by field.
- Location already taken on `assign`: **HTTP 409**.
- Warehouse can't hold the boxes on `completeStage3`: **422** with key `warehouse_incompatible`.
- The handheld returns the server's verdict for each scan (verified / wrong box / wrong location / wrong label / attempts-left); the device only renders it.
