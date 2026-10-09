# P2P Supplier Purchase Invoice (SPI) — API Documentation

> **Status: PROPOSED.** None of this is built. The tables it depends on are the
> five in `SPI_with_Shipment_Field_Mapping.xlsx` (tab *7 · Proposed Schema*),
> which are themselves awaiting approval. Treat every shape below as a design
> to agree on, not as a contract to test against.

## 0. How to read this

Base URL `/api`. Every route sits behind `auth:sanctum` + `user.active` and is
tenant-scoped: `client_id`, `branch_id` and `created_by` come from the
authenticated user and **never** from the request body.

Prefix for this module: **`/api/p2p/spi`**
Controllers: `SupplierInvoiceController`, `SpiBoxController`, `SpiPutawayController`

**Response envelope** — the same one `/p2p/orders` uses:

```json
{ "status": true,  "data": { } }
{ "status": false, "message": "…", "errors": { "field": ["…"] } }
```

`422` for validation and business-rule refusals, `403` cross-tenant, `404` not found.

**Four flavours of SPI.** The prototype splits the list two ways, and the two
splits are independent:

| | With Shipment | Without Shipment |
|---|---|---|
| **With PO** | `purchase_order_id` set, PO has a shipment | `purchase_order_id` set, PO has none |
| **Without PO** | — | standalone: `purchase_order_id` is `null`, supplier picked directly |

Everything conditional in this document keys off `purchase_order_id IS NULL`.

---

## 1. Lookups

### `GET /p2p/spi/next-code`
The code the next SPI would receive. **Read only** — nothing is locked or
reserved, exactly like `/p2p/orders/next-code`. The number is allocated for real
only when Stage 01 is saved, so two users with the form open can both see `004`
and the second one will get `005`.

```json
{ "status": true, "data": { "code": "SPI/2026-27/004", "financial_year": "2026-27" } }
```

### `GET /p2p/spi/suppliers`
Suppliers for the **standalone** flow, where there is no PO to inherit one from.

`?q=` optional search.

```json
{ "status": true, "data": [
  { "id": 12, "code": "SUP-0012", "name": "Shree Agro Exports",
    "gstin": "27AABCS1429B1ZX", "supplier_type": "domestic", "blacklisted": false }
] }
```

### `GET /p2p/spi/suppliers/{id}/orders`
Open POs for that supplier, for Stage 01 when the invoice **is** against a PO.
Fully-invoiced POs are excluded.

```json
{ "status": true, "data": [
  { "id": 41, "code": "PO/2026-27/016", "po_date": "2026-09-14",
    "po_type": "Domestic", "grand_total": 1740000.00,
    "shipment_order_id": 7, "shipment_code": "SHP-0007",
    "procurement_request_code": "PR/2026-27/031", "lead_id": 88,
    "invoiced_count": 1, "has_open_qty": true }
] }
```

> `shipment_code`, `procurement_request_code` and `lead_id` are returned **for
> display only**. They are not stored on the SPI — they are read back through
> `p2p_purchase_orders` whenever needed.

### `GET /p2p/spi/orders/{po}/lines`
PO lines to prefill Stage 02, each carrying what is still uninvoiced so the same
line is not billed twice.

```json
{ "status": true, "data": {
  "purchase_order_id": 41,
  "document_type": "domestic",
  "currency_code": "INR",
  "lines": [
    { "po_item_id": 310, "pi_item_id": 205, "product_id": 77,
      "description": "Basmati Rice 1121 Steam", "hsn_code": "10063020",
      "uom": "KG", "qty_pi": 20000, "qty_po": 15000, "qty_already_invoiced": 5000,
      "qty_open": 10000, "rate": 86.50, "gst_pct": 5 }
  ]
} }
```

### `GET /p2p/spi/warehouses`
Warehouses for Stage 04, filtered by the storage type chosen in step 1 of that
screen. The type lives on the master, not on the SPI.

`?wh_type=Own Warehouse` | `Third Party Warehouse`

```json
{ "status": true, "data": [
  { "id": 1, "wh_id": "WH-001", "wh_name": "Pune Main",
    "wh_type": "Own Warehouse", "city": "Pune", "status": "Active" }
] }
```

---

## 2. List and detail

### `GET /p2p/spi`
The SPI list — 17 columns in the prototype.

| Param | Values |
|---|---|
| `po_mode` | `with_po` · `without_po` — the top tab row |
| `shipment_mode` | `with_shipment` · `without_shipment` — the sub-tabs |
| `status` | `draft` · `mapped` · `grn_pending` · `closed` · `cancelled` |
| `vendor_id`, `from`, `to` | filters |
| `q` | the one search box — see below |
| `page`, `per_page` | default `per_page=10` |

**What `q` searches.** One query with LEFT JOINs out to the purchase order and,
through it, the shipment and opportunity — those columns are deliberately not
copied onto the invoice, so the search has to reach them. The joins are LEFT
because a Direct SPI has no PO and must still match on its own code or supplier.

| Typed | Matched against |
|---|---|
| `SPI/2026-27/001` | `p2p_supplier_invoices.code` |
| `INV-8841` | `invoice_no` — the supplier's own number |
| `draft` · `mapped` | `status` |
| `domestic` | `document_type` |
| `PO/2026-27/016` | `po.code` |
| `material_goods` | `po.po_type` |
| `PROC-001` | `po.procurement_request_code` |
| `SHP-001` | `sh.shipment_code` |
| `OPP-001` | `ld.opp_code` |
| `Reliance Industries` | `v.company_name` |
| `SUP-0015` | `v.vendor_code` |
| `direct spi without po` | `purchase_order_id IS NULL` — no column holds that phrase |

**Response**

```json
{
  "status": true,
  "data": [
    {
      "id": 9,
      "spi_number": "SPI/2026-27/001",
      "spi_date": "2026-06-01",
      "invoice_no": "INV-8841",

      "is_direct": false,
      "po_number": "PO/2026-27/001",
      "po_date": "2026-05-01",
      "po_type": "material_goods",
      "document_type": "domestic",
      "shipment_id": "SHP-001",
      "opportunity_id": 88,
      "procurement_id": "PROC-001",

      "supplier": {
        "id": 12, "code": "SUP-0015",
        "name": "Reliance Industries", "risk_level_id": 1
      },

      "expected_delivery_date": "2026-07-05",

      "total_po_amount":    23000.00,
      "net_payable_amount": 22540.00,
      "total_paid_amount":  22540.00,
      "balance_amount":         0.00,
      "total_spi_amount":   22540.00,

      "warehouse": {
        "id": 1, "code": "WH-001",
        "name": "Pune Phase 2 Warehouse", "is_own": true
      },

      "status": "mapped",
      "status_label": "Mapped",
      "stage_completed": 4
    }
  ],
  "tabs": {
    "all_spi": 60, "with_po": 30, "direct_spi": 30,
    "with_shipment": 30, "without_shipment": 30
  },
  "meta": { "page": 1, "per_page": 10, "total": 60 }
}
```

`tabs` feeds the two rows of tabs — *All SPI's 60 · With Purchase Order SPI 30 ·
Without Purchase Order SPI (Direct SPI) 30*, and under them *With Shipment ID 30
· All Other Transactions 30*. Four aggregates in one query, so the counts do not
cost four round trips, and they are **unfiltered** — a tab must still show its
total while another tab is selected.

> **A Direct SPI returns `is_direct: true`** and `po_number`, `po_date`,
> `po_type`, `shipment_id`, `opportunity_id`, `procurement_id` and all four PO
> money columns as `null`. The UI shows a dash. `total_spi_amount` is still
> present — that one is the invoice's own figure.

**Where the money comes from.** `total_po_amount`, `net_payable_amount`,
`total_paid_amount` and `balance_amount` are all read from the **purchase
order**, because that is where the balance lives. `net_payable_amount` is
`po.grand_total − po.tds_amount`. `total_spi_amount` is the invoice's own
`grand_total` — the supplier's claim, and **not** what the balance is measured
against.

**`warehouse.is_own`** drives the OWN / 3PL badge. It is derived from
`master_warehouse_master.wh_type`, never stored on the invoice, so a row cannot
claim OWN while pointing at a third-party warehouse.

### `GET /p2p/spi/{id}`
One SPI with its items, boxes and put-away rows — everything the four stages need.

```json
{ "status": true, "data": {
  "id": 9, "code": "SPI/2026-27/004",
  "status": "draft", "stage_completed": 2,
  "purchase_order_id": 41, "vendor_id": 12,
  "invoice_no": "INV-8841", "invoice_date": "2026-10-02",
  "invoice_file": { "name": "inv-8841.pdf", "url": "/storage/spi/9/inv-8841.pdf" },
  "eway_no": "381004412233",
  "eway_file": { "name": "eway.pdf", "url": "/storage/spi/9/eway.pdf" },
  "document_type": "domestic", "currency_code": "INR", "exchange_rate": null,
  "taxable_total": 1635047.62, "total_cgst": 40876.19, "total_sgst": 40876.19,
  "total_igst": 0.00, "grand_total": 1716800.00,
  "warehouse_id": 1,
  "zoho": { "bill_id": null, "bill_number": null, "status": null, "synced_at": null,
            "owns_bill": false },
  "items": [
    { "id": 51, "line_no": 1, "product_id": 77,
      "description": "Basmati Rice 1121 Steam", "hsn_code": "10063020", "uom": "KG",
      "po_item_id": 310, "pi_item_id": 205,
      "qty_pi": 20000, "qty_po": 15000, "qty_spi": 14800,
      "rate": 86.50, "taxable_amount": 1280200.00,
      "gst_pct": 5, "cgst_amount": 32005.00, "sgst_amount": 32005.00,
      "igst_amount": null, "line_total": 1344210.00,
      "qty_packed": 4000, "qty_pending": 10800 }
  ]
} }
```

> `zoho.owns_bill` is `purchase_order_id === null`. When it is `false` the bill
> lives on the PO and the SPI must not create a second one.
>
> `qty_packed` is **derived** — `SUM(p2p_spi_box_items.quantity)` where
> `deleted_at IS NULL`. It is never stored. `qty_pending` is `qty_spi − qty_packed`.

---

## 3. Stage 01 — supplier and PO linkage

### `POST /p2p/spi`
Creates the draft and allocates the code under a row lock on `clients`. **This is
the first write of the whole flow** — opening the form writes nothing.

```json
{
  "purchase_order_id": 41,
  "vendor_id": 12,
  "document_type": "domestic",
  "invoice_no": "INV-8841",
  "invoice_date": "2026-10-02",
  "eway_no": "381004412233",
  "currency_code": "INR",
  "exchange_rate": null
}
```

| Field | Rule |
|---|---|
| `purchase_order_id` | nullable — omit it for a standalone invoice |
| `vendor_id` | **required always**; with a PO it must match `po.vendor_id` |
| `document_type` | required, `domestic` \| `international` |
| `invoice_no` | required, unique per `(client_id, vendor_id)` |
| `invoice_date` | required, not in the future |
| `currency_code` | required when `document_type = international` |

```json
{ "status": true, "data": { "id": 9, "code": "SPI/2026-27/004", "stage_completed": 1 } }
```

Refusals:

```json
{ "status": false, "message": "This supplier has already billed invoice INV-8841.",
  "errors": { "invoice_no": ["Already used for this supplier."] } }
```

### `PUT /p2p/spi/{id}/stage-1`
Editable while `status = draft`. Same body as `POST`, minus the code (already
allocated and never reissued).

**Request**

```json
{
  "purchase_order_id": 41,
  "vendor_id": 12,
  "document_type": "domestic",
  "invoice_no": "INV-8841-A",
  "invoice_date": "2026-10-02",
  "eway_no": "381004412233",
  "currency_code": "INR",
  "exchange_rate": null
}
```

**Response**

```json
{ "status": true, "data": {
  "id": 9, "code": "SPI/2026-27/004", "status": "draft", "stage_completed": 1,
  "purchase_order_id": 41, "po_code": "PO/2026-27/016",
  "vendor_id": 12, "vendor_name": "Shree Agro Exports",
  "invoice_no": "INV-8841-A", "invoice_date": "2026-10-02",
  "document_type": "domestic", "currency_code": "INR", "exchange_rate": null
} }
```

Changing the PO after items exist is refused:

```json
{ "status": false,
  "message": "Items are already mapped to PO/2026-27/016 — clear Stage 02 before changing the purchase order.",
  "errors": { "purchase_order_id": ["Cannot be changed while items exist."] } }
```

### File upload
Invoice and e-way PDFs post as `multipart/form-data` to the same two endpoints.

**Request** (`Content-Type: multipart/form-data`)

```
invoice_no    INV-8841
invoice_date  2026-10-02
invoice_file  <binary>   pdf|jpg|png, max 10 MB
eway_file     <binary>
```

**Response**

```json
{ "status": true, "data": {
  "invoice_file": { "name": "inv-8841.pdf", "url": "/storage/spi/9/inv-8841.pdf", "size": 184233 },
  "eway_file":    { "name": "eway.pdf",     "url": "/storage/spi/9/eway.pdf",     "size": 41200 }
} }
```

---

## 4. Stage 02 — items and the 3-way match

### `PUT /p2p/spi/{id}/items`
The whole grid saves in one call — never row by row, or the header totals and the
lines can disagree.

```json
{ "items": [
  { "line_no": 1, "po_item_id": 310, "pi_item_id": 205, "product_id": 77,
    "description": "Basmati Rice 1121 Steam", "hsn_code": "10063020", "uom": "KG",
    "qty_spi": 14800, "rate": 86.50, "gst_pct": 5 }
] }
```

The server computes and stores `taxable_amount`, `cgst_amount`, `sgst_amount`,
`igst_amount`, `line_total`, then rolls them into the header totals. **The client
never sends a total.**

| Rule | Behaviour |
|---|---|
| With a PO | `qty_spi` may differ from `qty_po` — that difference *is* the match. Exceeding `qty_open` is refused. |
| Standalone | no `po_item_id` / `pi_item_id` / `qty_po`; `product_id`, `qty_spi` and `rate` are required. |
| `document_type = international` | the four GST columns are written **`null`**, not `0`. `null` means "does not apply"; `0` would mean "charged at zero rate". |
| Deleting a line | soft delete; its box allocations go with it. |

```json
{ "status": true, "data": {
  "taxable_total": 1635047.62, "total_cgst": 40876.19, "total_sgst": 40876.19,
  "total_igst": 0.00, "grand_total": 1716800.00,
  "items": [ /* as GET /{id} */ ] } }
```

---

## 5. Stage 03 — box packaging

### `GET /p2p/spi/{id}/boxes`

```json
{ "status": true, "data": [
  { "id": 10, "box_code": "BOX-01", "scenario": "s3",
    "length_cm": 40, "width_cm": 30, "height_cm": 25,
    "weight_kg": 12.5, "net_weight_kg": 11.8, "gross_weight_kg": 12.5,
    "volumetric_weight_kg": 6.0,
    "condition": "Perfect", "sticker_printed_at": null,
    "items": [
      { "id": 50, "supplier_invoice_item_id": 51, "quantity": 3000,
        "remark": "correct", "remark_note": null,
        "is_hazardous": false, "is_cold_chain": false, "is_regulated": false,
        "serial_no": null, "lot_no": "LT-114", "batch_no": "BT-2291",
        "cat_no": null, "expiry_date": "2027-04-30", "mfg_date": "2026-05-01" }
    ] }
] }
```

> **Advanced Details sit on the box item, not the box.** One box can hold two
> products from two batches with two expiry dates — a single set of fields on the
> box could not represent that.
>
> `volumetric_weight_kg` is computed (`L×W×H ÷ divisor`), not stored.

### `POST /p2p/spi/{id}/boxes` · `PUT /p2p/spi/{id}/boxes/{box}`
Box and its contents in one payload — the two must not be saveable apart.

```json
{
  "scenario": "s3",
  "length_cm": 40, "width_cm": 30, "height_cm": 25,
  "weight_kg": 12.5, "net_weight_kg": 11.8, "gross_weight_kg": 12.5,
  "condition": "Perfect",
  "items": [
    { "supplier_invoice_item_id": 51, "quantity": 3000,
      "remark": "correct", "batch_no": "BT-2291", "expiry_date": "2027-04-30",
      "is_cold_chain": true }
  ]
}
```

`box_code` is **allocated by the server**, sequential within the SPI
(`BOX-01 … BOX-n`), not client-wide. Three SPIs created at once therefore never
interleave their numbering.

| Rule | Behaviour |
|---|---|
| Over-packing | `SUM(quantity)` per item may not exceed `qty_spi`. Refused with the remaining figure. |
| `remark` | `correct` \| `damaged` \| `mismatched` \| `extra` |
| `condition` | `perfect` \| `minor` \| `major` \| `severe` — the **carton**, not the goods |
| Renumbering | on delete, remaining codes renumber **only while no sticker is printed**. After `sticker_printed_at` the code is frozen — the label is physically on a box being scanned. |

**Response** — the saved box **and** the recomputed packing summary, so the
screen's "remaining" table needs no second call.

```json
{ "status": true, "data": {
  "box": {
    "id": 10, "box_code": "BOX-01", "scenario": "s3",
    "length_cm": 40, "width_cm": 30, "height_cm": 25,
    "weight_kg": 12.5, "net_weight_kg": 11.8, "gross_weight_kg": 12.5,
    "volumetric_weight_kg": 6.0, "condition": "Perfect",
    "sticker_printed_at": null,
    "items": [
      { "id": 50, "supplier_invoice_item_id": 51, "quantity": 3000,
        "remark": "correct", "remark_note": null,
        "is_hazardous": false, "is_cold_chain": true, "is_regulated": false,
        "serial_no": null, "lot_no": null, "batch_no": "BT-2291",
        "cat_no": null, "expiry_date": "2027-04-30", "mfg_date": null }
    ]
  },
  "packing_summary": {
    "items": [
      { "supplier_invoice_item_id": 51, "qty_spi": 14800,
        "qty_packed": 3000, "qty_pending": 11800, "status": "pending" }
    ],
    "fully_packed": false, "boxes": 1
  }
} }
```

Over-packing is refused with the figure that is actually left:

```json
{ "status": false,
  "message": "Only 800 KG of Basmati Rice 1121 Steam is left to pack.",
  "errors": { "items.0.quantity": ["Exceeds the unpacked quantity."] } }
```

### `DELETE /p2p/spi/{id}/boxes/{box}`
Soft delete, cascading to its `box_items`. **Every packed-quantity sum must
exclude soft-deleted rows** — miss that filter and a removed box still counts as
packed, so the item reads fully packed when it is not.

**Request** — no body.

**Response** — the renumbered boxes and the recomputed summary, since deleting a
box frees its quantity and may renumber the codes after it.

```json
{ "status": true, "data": {
  "deleted_box_id": 11,
  "renumbered": [ { "id": 12, "from": "BOX-03", "to": "BOX-02" } ],
  "packing_summary": {
    "items": [
      { "supplier_invoice_item_id": 51, "qty_spi": 14800,
        "qty_packed": 3000, "qty_pending": 11800, "status": "pending" }
    ],
    "fully_packed": false, "boxes": 2
  }
} }
```

A printed box is not renumbered, and a box already placed cannot be removed:

```json
{ "status": false,
  "message": "BOX-02 is already put away — remove it from its shelf before deleting the box." }
```

### `GET /p2p/spi/{id}/packing-summary`
Packed vs pending per item. Also returned inside the Stage-03 save response, so
the screen needs no second call.

```json
{ "status": true, "data": {
  "items": [
    { "supplier_invoice_item_id": 51, "description": "Basmati Rice 1121 Steam",
      "uom": "KG", "qty_spi": 14800, "qty_packed": 4000, "qty_pending": 10800,
      "status": "pending" }
  ],
  "fully_packed": false, "boxes": 2 } }
```

One `GROUP BY` for the whole invoice, never one query per item:

```sql
SELECT supplier_invoice_item_id, SUM(quantity) AS packed
FROM p2p_spi_box_items
WHERE supplier_invoice_item_id IN (…) AND deleted_at IS NULL
GROUP BY supplier_invoice_item_id
```

### `POST /p2p/spi/{id}/boxes/{box}/sticker`
Renders the label and stamps `sticker_printed_at`, which freezes `box_code`.

**Request**

```json
{ "copies": 1, "format": "pdf" }
```

`format`: `pdf` (default) · `zpl` for a label printer.

**Response**

```json
{ "status": true, "data": {
  "box_code": "BOX-01",
  "sticker_printed_at": "2026-10-03T08:55:12Z",
  "code_locked": true,
  "file": { "name": "BOX-01.pdf", "url": "/storage/spi/9/stickers/BOX-01.pdf" },
  "payload": {
    "spi_code": "SPI/2026-27/004", "box_code": "BOX-01",
    "supplier": "Shree Agro Exports", "warehouse": "Pune Main",
    "products": [ { "description": "Basmati Rice 1121 Steam", "quantity": 3000, "uom": "KG" } ],
    "flags": ["cold_chain"], "gross_weight_kg": 12.5,
    "barcode": "SPI0426-BOX01"
  }
} }
```

`code_locked: true` is the signal to the UI that this box can no longer be
renumbered or silently deleted.

---

## 6. Stage 04 — temporary put-away

### `PUT /p2p/spi/{id}/storage-type`
Step 1 of the screen. Only the chosen **warehouse** is stored; its own/third-party
type is read from `master_warehouse_master.wh_type`.

```json
{ "warehouse_id": 1 }
```

```json
{ "status": true, "data": {
  "warehouse_id": 1, "wh_name": "Pune Main", "wh_type": "Own Warehouse",
  "putaway_mode": "full" } }
```

`putaway_mode` is `full` for an own warehouse (rack → shelf → box) and `summary`
for a 3PL (no rack/shelf allocation).

### `GET /p2p/spi/{id}/putaway`

```json
{ "status": true, "data": [
  { "id": 31, "box_id": 10, "box_code": "BOX-01",
    "warehouse_id": 1, "zone_id": 3, "rack_id": 14, "shelf_id": 56,
    "destination": "WH-001 / Z-03 / R-14 / S-56",
    "box_scanned_at": "2026-10-03T09:41:00Z",
    "location_scanned_at": "2026-10-03T09:41:30Z",
    "rack_scanned_at": "2026-10-03T09:42:02Z",
    "shelf_scanned_at": "2026-10-03T09:42:20Z",
    "confirmed_at": null, "confirmed_by": null,
    "condition_at_putaway": null }
] }
```

### `POST /p2p/spi/{id}/putaway/scan`
One scan per call — each stamps its own timestamp, so this is **POST, not PUT**.

```json
{ "box_code": "BOX-01", "scan_type": "shelf", "scanned_value": "S-56" }
```

`scan_type`: `box` · `location` · `rack` · `shelf`.

**Response** — the put-away row as it now stands, plus what to scan next.

```json
{ "status": true, "data": {
  "id": 31, "box_id": 10, "box_code": "BOX-01",
  "warehouse_id": 1, "zone_id": 3, "rack_id": 14, "shelf_id": 56,
  "destination": "WH-001 / Z-03 / R-14 / S-56",
  "box_scanned_at": "2026-10-03T09:41:00Z",
  "location_scanned_at": "2026-10-03T09:41:30Z",
  "rack_scanned_at": "2026-10-03T09:42:02Z",
  "shelf_scanned_at": "2026-10-03T09:42:20Z",
  "next_scan": null,
  "ready_to_confirm": true
} }
```

`next_scan` is the step still outstanding (`location` · `rack` · `shelf`), or
`null` when the chain is complete. On a 3PL warehouse (`putaway_mode: summary`)
it goes `null` straight after the `location` scan — there are no racks or shelves
to allocate.

Out-of-order and wrong-box refusals:

```json
{ "status": false, "message": "Scan the rack before the shelf." }
```

```json
{ "status": false, "message": "BOX-04 belongs to SPI/2026-27/007, not this invoice." }
```

```json
{ "status": false, "message": "Shelf S-56 is not on rack R-14." }
```

### `PUT /p2p/spi/{id}/putaway/{row}/confirm`

**Request**

```json
{ "condition_at_putaway": "minor", "note": "Corner dented in transit" }
```

`condition_at_putaway` is optional — `perfect` · `minor` · `major` · `severe`.
It records damage noticed **at the rack**, which is a later moment than the
condition recorded while unpacking in Stage 03.

**Response**

```json
{ "status": true, "data": {
  "id": 31, "box_code": "BOX-01",
  "destination": "WH-001 / Z-03 / R-14 / S-56",
  "confirmed_at": "2026-10-03T09:43:05Z",
  "confirmed_by": { "id": 24, "name": "Vikram Malhotra" },
  "condition_at_putaway": "minor",
  "spi_putaway_progress": { "placed": 1, "total": 2, "complete": false }
} }
```

**Until `confirmed_at` is set the box is picked but not placed** — that is the
distinction the Digital Warehouse view reads.

```json
{ "status": false, "message": "Scan the shelf before confirming BOX-01." }
```

---

## 7. Submit and delete

### `PUT /p2p/spi/{id}/submit`

**Request**

```json
{ "note": "Short by 200 KG against the PO — supplier confirmed by mail." }
```

`note` is optional, and is the place to explain a quantity that differs from the
PO rather than leaving the match unexplained.

**Response**

```json
{ "status": true, "data": {
  "id": 9, "code": "SPI/2026-27/004",
  "status": "mapped", "stage_completed": 4,
  "submitted_at": "2026-10-03T10:12:40Z",
  "submitted_by": { "id": 24, "name": "Vikram Malhotra" },
  "match": { "qty_po": 15000, "qty_spi": 14800, "variance": -200, "variance_pct": -1.33 },
  "next": { "grn_required": true }
} }
```

Refusals:

```json
{ "status": false,
  "message": "10,800 KG is still unpacked. Goods not in a box have no box code, so they cannot be scanned, racked or inspected." }
```

```json
{ "status": false, "message": "Add at least one item before submitting." }
```

> **Open decision.** Whether submit requires full packing is not yet agreed.
> The recommendation is yes — partial *packing* is normal mid-stage, partial
> *completion* strands stock that exists on paper and in no carton.

### `DELETE /p2p/spi/{id}`
Soft delete, cascading to items, boxes, box items and put-away rows.

**Request** — no body.

**Response**

```json
{ "status": true, "data": {
  "id": 9, "code": "SPI/2026-27/004", "deleted_at": "2026-10-03T10:20:00Z",
  "cascaded": { "items": 3, "boxes": 2, "box_items": 4, "putaways": 2 }
} }
```

Refused once goods have moved downstream:

```json
{ "status": false,
  "message": "SPI/2026-27/004 has GRN-0021 against it — a received invoice cannot be deleted." }
```

---

## 8. Zoho Books

### `POST /p2p/spi/{id}/zoho-sync`
**Only a standalone invoice creates its own Bill.** With a PO the bill already
exists on `p2p_purchase_orders.zoho_bill_id` and must not be created twice.

```json
{ "status": false,
  "message": "This invoice is against PO/2026-27/016 — its Zoho bill belongs to the purchase order." }
```

**Request**

```json
{ "force": false }
```

`force: true` retries after a failure. It never creates a second bill — if
`zoho_bill_id` is already set the existing bill is updated.

**Response**

```json
{ "status": true, "data": {
  "zoho_bill_id": "3200000012345", "zoho_bill_number": "BILL-00042",
  "zoho_status": "synced", "zoho_synced_at": "2026-10-03T11:02:00Z",
  "zoho_error": null } }
```

Failure is recorded, not thrown away — `zoho_error` is what the tracker shows:

```json
{ "status": false,
  "message": "Zoho rejected the bill: contact 'Shree Agro Exports' not found.",
  "data": { "zoho_status": "failed", "zoho_error": "contact_not_found",
            "zoho_synced_at": null } }
```

### `GET /p2p/spi/{id}/zoho-tracker`
Sync state and the last error, so a failed push can be explained and retried.

**Request** — no body.

**Response**

```json
{ "status": true, "data": {
  "owns_bill": true,
  "zoho_bill_id": "3200000012345", "zoho_bill_number": "BILL-00042",
  "zoho_status": "synced",
  "zoho_synced_at": "2026-10-03T11:02:00Z",
  "zoho_error": null,
  "can_retry": false
} }
```

When the bill belongs to the PO, the tracker says so instead of showing an empty
state that reads like a failure:

```json
{ "status": true, "data": {
  "owns_bill": false,
  "bill_owner": { "type": "purchase_order", "id": 41, "code": "PO/2026-27/016",
                  "zoho_bill_id": "3200000011987", "zoho_bill_number": "BILL-00031" },
  "zoho_bill_id": null, "zoho_status": null, "can_retry": false
} }
```

---

## 9. Not in this module

| Concern | Where it lives |
|---|---|
| **Payment** | `/p2p/orders/{po}/payment-requests`. Money moves on the PO; the SPI is the evidence that justifies releasing it. An SPI amount does **not** reduce `po.grand_total` — only an approved payment request does. |
| **GRN / QA** | separate modules. The prototype's rule is 1 SPI = 1 GRN = 1 QA. |
| **Bill of Entry** | not designed. Customs duty is not on the supplier's invoice. |

### Open decisions that change the above

1. **Standalone payment.** `p2p_po_payment_requests.purchase_order_id` is
   `NOT NULL`, so a standalone SPI cannot be paid today. If it should be, the fix
   is a nullable `purchase_order_id` plus `supplier_invoice_id` on the **existing**
   table — not a second payment ledger.
2. **SPI code format.** `SPI/26-27/001` (restarts each financial year, like PO and
   PI) or `SPI-001` (runs on, like `PRQ-001`). This document assumes the first.
3. **Submit rule.** Whether full packing is required, as in §7.
