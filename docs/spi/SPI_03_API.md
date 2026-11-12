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

### 5.1 Evidence Vault — response & the sibling endpoints
```jsonc
// GET /p2p/spi/{id}/evidence-vault  → { status, data: EvidenceVault }
{
  "subject": { "kind": "spi", "id": 42, "code": "SPI/25-26/017" },
  "related": { "purchase_order": { "id": 9, "code": "PO/25-26/004" } },
  "groups": [
    { "key": "po",        "title": "Purchase Order", "subtitle": "…",
      "sections": [ { "key": "order", "title": "Order Copy", "documents": [ /* VaultDocument */ ] } ] },
    { "key": "trade",     "title": "Trade Documents & Agreements",
      "sections": [ { "key": "trade_documents", … }, { "key": "agreements", … } ] },
    { "key": "spi:42",    "title": "Supplier Purchase Invoice",
      "sections": [ { "key": "general", … }, { "key": "box_stickers", … },
                    { "key": "box_attachments", … }, { "key": "payment_proofs", … } ] }
  ],
  "totals": { "documents": 11, "available": 8, "missing": 3 }
}

// VaultDocument
{ "name": "…", "meta": "code · date", "kind": "invoice", "status": "Uploaded",
  "source": "uploaded|generated|signed|awaited",   // ← branch on THIS, not on null urls
  "file_url": "…|null",                             // raw storage path (plain link)
  "url": "/api/p2p/files/download?path=…|null",     // authenticated stream (+?mode=preview|download)
  "modes": ["preview","download"],
  "action_url": "…|null", "action": "generate|print|null",   // generated docs / stickers
  "signed_file_url": "…|null",                      // executed copy, for source=signed
  "amount": 1234.00, "required": true }             // amount on payment rows; required on trade docs
```
- Empty sections/groups are **omitted** from the payload; an `awaited` document is a real row with `file_url:null` and no action — render it, don't hide it.
- **Files** are fetched from `url` (not `file_url`): `GET /p2p/files/download?path=…` (`P2pFileController@download`) — auth-checked, resolves the right disk, returns the original filename; `?mode=preview` vs `?mode=download` sets the disposition.

| Method | Path | Handler | Purpose |
|---|---|---|---|
| GET | `/p2p/files/download` | `P2pFileController@download` | Authenticated file stream for any vault `url` (`?path=`, `?mode=preview\|download`) |
| GET | `/p2p/orders/{po}/evidence-vault` | `PurchaseOrderDocumentController@evidenceVault` | **PO end** of the same vault (`forPo`): order + trade + one block per invoice + loose payments |
| GET | `/segment-uploads/supplier/{id}/vault` | `SegmentDocUploadController@vault` | **Supplier** vault (KYC/DD/licences) — the Stage-1 Legal Status link; *not* `P2pVaultService` |

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
| POST | `/p2p/spi/{id}/payment-requests` | `@storeFromSpi` | Raise a payment request | **PO-backed →** stored on the PO (`supplier_invoice_id` stamped). **Direct →** stored on the invoice (`purchase_order_id` NULL); ceiling = invoice net payable; approver must be an active non-admin user of the invoice's branch; **TDS must be saved first** (domestic) |
| POST | `/p2p/spi/{id}/payment-requests/{req}/payments` | `@storePaymentFromSpi` | "Make SPI Payment" | PO-backed → on the PO's balance; Direct → on the invoice's |
| POST / DELETE | `/p2p/spi/{id}/payment-requests/{req}/payments/{payment}` | `@update / @destroyPaymentFromSpi` | Edit/delete a Direct-SPI payment | |
| PUT | `/p2p/spi/{id}/tds` | `@saveTdsForSpi` | Set TDS (Direct SPI) | PO-backed → redirected to the order |
| POST | `/p2p/spi/{id}/zoho-sync` | `@zohoSync` | Standalone bill sync | **501** (not wired yet) |
| GET | `/p2p/spi/{id}/zoho-tracker` | `@zohoTracker` | Bill owner / status / can_retry | |

> **Cancelling a paid PO is a different module.** A PO with money on it can't be cancelled directly — it goes through the **Advance Receipt Refund Adjustment** (`PoRefundAdjustmentController`, `/p2p/advance-refund-adjustment`, code `ADR/<FY>/<SEQ>`), which cancels the PO and **declines every pending payment request** on it. It has **no approval step** and is a **PO-level** flow — a Direct SPI (no PO) is unwound with `DELETE /p2p/spi/{id}` instead. See `docs/p2p/refund-adjustment/*`.

---

## 9. Common response conventions

- Collections: `{ data: [...], tabs?: {...}, meta: { current_page, per_page, total, last_page } }`.
- Items/detail: `{ status: true, data: {...} }`.
- Validation failures: **HTTP 422** with `errors` keyed by field.
- Location already taken on `assign`: **HTTP 409**.
- Warehouse can't hold the boxes on `completeStage3`: **422** with key `warehouse_incompatible`.
- The handheld returns the server's verdict for each scan (verified / wrong box / wrong location / wrong label / attempts-left); the device only renders it.

---

## 10. Worked request / response examples

> Tenancy (`client_id` / `branch_id` / `created_by`) is always derived from the token — never send it. All bodies are JSON unless noted multipart.

### 10.1 Stage 1 — create draft · `POST /p2p/spi`
```jsonc
// Request — With PO
{ "purchase_order_id": 9, "vendor_id": 14, "document_type": "domestic", "warehouse_id": 3 }
// Request — Direct + Shipment (no PO; carries its own shipment)
{ "purchase_order_id": null, "vendor_id": 14, "document_type": "domestic",
  "warehouse_id": 3, "shipment_order_id": 51, "procurement_request_code": null }
```
```jsonc
// 201 — the draft row (stage_completed = 1 for With-PO, 0 for Direct)
{ "status": true,
  "data": { "id": 42, "code": "SPI/25-26/017", "status": "draft", "stage_completed": 1,
            "purchase_order_id": 9, "vendor_id": 14, "document_type": "domestic", "warehouse_id": 3 } }
```
```jsonc
// 422 — PO already fully billed (CS-937)
{ "status": false,
  "message": "PO/25-26/004 is fully invoiced — every line is already billed on its SPIs…",
  "errors": { "purchase_order_id": ["PO/25-26/004 is fully invoiced …"] } }
```
`PUT /p2p/spi/{id}/stage-1` takes the same body and returns `{ status, data, blockers:[] }` (Direct SPI may list `gst_blocked` / `gst_approval` / `expired_documents`).

### 10.2 Stage 2 — save grid + files · `POST /p2p/spi/{id}/items`
`multipart/form-data` (or JSON when no file changes). One row per product; send the totals block too — the grid owns the arithmetic.
```jsonc
// Request (fields shown as JSON; invoice_file/eway_file are file parts)
{ "invoice_no": "INV-9981", "invoice_date": "2026-05-20", "currency_code": "INR", "exchange_rate": 1,
  "items": [
    { "id": null, "po_item_id": 71, "pi_item_id": 120, "product_id": 88,
      "qty_spi": 100, "rate": 250, "extra_qty": 0, "gst_pct": 18,
      "taxable_amount": 25000, "cgst": 2250, "sgst": 2250, "igst": 0, "line_total": 29500 }
  ],
  "taxable_total": 25000, "total_cgst": 2250, "total_sgst": 2250, "total_igst": 0, "grand_total": 29500 }
```
```jsonc
// 200 — match recomputed; over-billing is a warning, never a block
{ "status": true,
  "data": {
    "invoice": { "id": 42, "stage_completed": 2, "invoice_no": "INV-9981", "grand_total": 29500 },
    "match": [ { "supplier_invoice_item_id": 301, "product_id": 88,
                 "qty_pi": 100, "qty_po": 100, "qty_spi": 100, "missing_qty": 0, "extra_qty": 0 } ],
    "warnings": [] } }        // e.g. ["Blue Widget billed 110 of 100 ordered (+10 extra)"]
```
- **Direct, no shipment:** rows carry `po_item_id:null, pi_item_id:null` and a chosen `product_id`.
- **Direct + Shipment:** rows carry `pi_item_id` (fixed to the PI), `po_item_id:null`.

### 10.3 Stage 3 — create a box · `POST /p2p/spi/{id}/boxes`
```jsonc
// Request — Scenario 03 (mixed carton, ≥2 products)
{ "scenario": "s3", "length_cm": 40, "width_cm": 30, "height_cm": 25,
  "weight_kg": 12, "net_weight_kg": 11, "gross_weight_kg": 12.5,
  "condition": "perfect", "is_stackable": true, "temp_min_c": null, "temp_max_c": null,
  "flags": [2, 5],
  "items": [
    { "supplier_invoice_item_id": 301, "quantity": 60, "remark": "correct",
      "batch_no": "B-77", "expiry_date": "2027-01-01" },
    { "supplier_invoice_item_id": 302, "quantity": 40, "remark": "correct" } ] }
```
```jsonc
// 201
{ "status": true, "data": { "id": 500, "box_code": "B-001", "scenario": "s3",
    "sticker_printed_at": null, "items": [ /* SpiBoxItem rows */ ] } }
```
**Box validation (`validateBox` + `guardOverPacking`) — 422 when:** a required dimension (`length/width/height_cm`, `gross_weight_kg`) is missing or ≤ 0; `net_weight_kg > gross_weight_kg`; any `items[].quantity ≤ 0`; a box's contents **exceed the line's pending qty** (*"can hold at most N units — the rest is already in other boxes"*); `expiry ≤ mfg`, `expiry` past, or `mfg` future; a non-`correct` `remark` has no `remark_note`; or `remark: "extra"` on a line not billed above its PO/PI qty. Scenario is derived (`s1`/`s2`/`s3`); an `s2` split that resolves to one box collapses to `s1`.

```jsonc
// Finish Stage 3 · PUT /p2p/spi/{id}/stage-3 → 422 when the warehouse can't hold the boxes
{ "status": false, "message": "This warehouse has no cold-chain zone for 2 of your boxes.",
  "errors": { "warehouse_incompatible": ["cold_chain"] } }
// … or 422 "N products are not fully boxed." when a unit is still loose
```

### 10.4 Stage 4 — allocate · scan-task · manual · submit
```jsonc
// POST /p2p/spi/{id}/putaway/assign  (lock + reserve + row→draft)
// Request
{ "box_id": 500, "mode": "rack", "zone_id": 2, "rack_id": 7, "shelf_id": 31, "session_id": "ui-abc" }
// 200
{ "status": true, "data": { "putaway_id": 900, "box_id": 500, "status": "draft",
    "destination": "ZN-A › RK-A1 › SH-102" } }
// 409 — someone else holds that shelf
{ "status": false, "message": "SH-102 is being put away by another device right now." }
```
```jsonc
// Option 01 · POST /p2p/spi/{id}/putaway/{row}/scan-task   (row → awaiting_scan)
// Request
{ "confirmed": true, "ttl_hours": 8 }
// 201
{ "status": true, "data": { "task_code": "ZT-20260520-004", "status": "pending",
    "box_id": 500, "expires_at": "2026-05-20T18:00:00Z" } }
```
```jsonc
// Option 02 · POST /p2p/spi/{id}/putaway/{row}/confirm-manual   (row → placed, final)
// Request
{ "confirmed": true, "condition_at_putaway": "perfect", "note": "placed by hand" }
// 200
{ "status": true, "data": { "putaway_id": 900, "status": "placed", "verify_method": "manual" } }
```
```jsonc
// Finish · PUT /p2p/spi/{id}/submit   (triple-guard: items / all packed / all placed)
// Request
{ "note": "all boxes down" }
// 200
{ "status": true, "data": { "id": 42, "status": "mapped", "stage_completed": 4 } }
// 422 — a box is still open
{ "status": false, "message": "2 boxes are not yet put away." }
```

### 10.5 Payment (raised from the invoice; PO-backed → on the PO, Direct → on the invoice)
```jsonc
// POST /p2p/spi/{id}/payment-requests
// Request
{ "amount": 29500, "note": "full against INV-9981" }
// 201
{ "status": true, "data": { "id": 610, "code": "PR/25-26/031", "supplier_invoice_id": 42,
    "amount": 29500, "status": "pending" } }
```
```jsonc
// POST /p2p/spi/{id}/payment-requests/{req}/payments   ("Make SPI Payment", multipart with proof)
// Request (fields; proof_file is a file part)
{ "amount": 29500, "bank_name": "HDFC", "utr_cheque_number": "UTR8841", "utr_cheque_date": "2026-05-21" }
// 201
{ "status": true, "data": { "id": 710, "amount": 29500, "proof_name": "utr.pdf" } }
```

### 10.6 Handheld scan verdict · `POST /scan/putaway/scan`
```jsonc
// Request (device-auth; no user session)
{ "scanned_value": "<box-qr>", "task_id": 55 }
// 200 — the server's verdict; the device only renders it
{ "status": true, "code": "box_ok",
  "data": { "task": { "step": "scan_shelf", "attempts_left": 3, "ready_to_complete": false },
            "box": { "box_code": "B-001", "scenario_label": "Mixed carton" } } }
// 200 — wrong label (no session break; just a verdict)
{ "status": true, "code": "wrong_box", "notice": "That's B-004 — you're placing B-001." }
```
