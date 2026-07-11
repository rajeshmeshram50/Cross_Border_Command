# 02 · App Purchase Order APIs

All app endpoints for Purchase Orders. Base: `/api` · Auth: `Authorization: Bearer <sanctum_token>`
(all routes are behind `auth:sanctum` + `user.active`). Controller:
`app/Http/Controllers/Api/PurchaseOrderController.php`.

GET list endpoints also accept `?branch_id=<id>` (auto-injected by the SPA).

---

## Endpoint index

| Method | Path | Purpose |
|---|---|---|
| GET | `/p2p/purchase-orders` | List (paginated, filters + search) |
| GET | `/p2p/purchase-orders/{id}` | One PO with items |
| POST | `/p2p/purchase-orders` | Create |
| PUT | `/p2p/purchase-orders/{id}` | Update (**blocked once synced**) |
| DELETE | `/p2p/purchase-orders/{id}` | Delete |
| POST | `/p2p/purchase-orders/{id}/sync` | **Sync to Zoho Books** |
| GET | `/p2p/purchase-orders/{id}/zoho-pdf` | Stream Zoho's cached PDF |
| GET | `/p2p/purchase-orders/preview-code` | Next `PO/FY/NNN` code |
| POST | `/p2p/purchase-orders/preview-pdf` | Render PDF from unsaved form |
| GET | `/p2p/purchase-orders/suppliers` | Supplier dropdown |
| GET | `/p2p/purchase-orders/suppliers/{id}` | Supplier detail (auto-fill) |
| GET | `/p2p/purchase-orders/suppliers/{id}/trade-documents` | CLM trade docs |
| GET | `/p2p/purchase-orders/shipments` | Shipment dropdown |
| GET | `/p2p/purchase-orders/shipments/{id}/pi-products` | PI products for a shipment |
| POST | `/p2p/purchase-orders/{id}/email` | Email the PO PDF to supplier |
| GET | `/p2p/purchase-orders/{id}/pdf` | Stream the app's own PO PDF |

---

## Create — `POST /p2p/purchase-orders`

Request:

```json
{
  "po_type": "Material / Goods",
  "document_type": "Domestics",
  "po_date": "2026-07-11",
  "expected_delivery_date": "2026-07-20",
  "vendor_id": 26,
  "shipment_order_id": null,
  "currency_id": 1,
  "currency_code": "INR",
  "exchange_rate": 1,
  "inco_term": "FOB",
  "port_of_loading": null,
  "port_of_discharge": null,
  "country_of_origin": "India",
  "warehouse_id": null,
  "delivery_location": "Pune",
  "payment_type": "Advance",
  "terms": "Terms & Conditions text",
  "shipping_charges": 0,
  "packaging_charges": 0,
  "other_charges": 0,
  "items": [
    { "product_id": 97, "product_code": "P-97", "product_name": "FCV Tobacco Leaf Grade L2",
      "pi_product_name": null, "pi_quantity": null, "quantity": 12, "rate": 653210.88, "gst_pct": 12 },
    { "product_id": 91, "product_code": "P-91", "product_name": "Iron Ore Fines Fe62%",
      "quantity": 1, "rate": 483255.04, "gst_pct": 28 }
  ]
}
```

Response `201`:

```json
{ "status": true, "data": { "id": 4, "po": "PO/2026-27/004", "grand_total": 9397720.68, "items": [ ... ] } }
```

- `client_id` / `branch_id` are stamped from the **authenticated user**, never the body.
- `code` is allocated per client as `PO/<FY>/NNN` under a row lock + Postgres advisory lock.

### Tax & totals math (server-side)

```
per line:
  base = quantity × rate
  cgst% = sgst% = gst_pct ÷ 2          # 12% → 6/6,  28% → 14/14
  cgst_amount = base × cgst% ÷ 100
  sgst_amount = base × sgst% ÷ 100
  cost = round(base + cgst_amount + sgst_amount, 2)

header:
  total_product_cost = Σ cost          # includes tax
  total_cgst = Σ cgst_amount ; total_sgst = Σ sgst_amount
  additional_charges = shipping + packaging + other
  grand_total = total_product_cost + additional_charges
```

> Intra- vs inter-state does **not** change the amount — only the label
> (CGST+SGST vs IGST) and the Zoho tax type. The rate is always split in half.

---

## Update — `PUT /p2p/purchase-orders/{id}`

Same body as create. **Locked after sync:**

```json
// if the PO already has a zoho_purchaseorder_id →
{ "status": false, "message": "This PO is locked — it has already been synced to Zoho Books and can no longer be edited." }   // HTTP 422
```

---

## Sync — `POST /p2p/purchase-orders/{id}/sync`

No body. Pushes the PO to Zoho Books.

Success `200`:

```json
{ "status": true, "message": "Synced to Zoho Books (PO-00007).",
  "data": { "id": 4, "po": "PO/2026-27/004", "zoho": "Sync", "status": "Draft" } }
```

Idempotent (already synced) `200`:

```json
{ "status": true, "message": "This PO is already synced with Zoho Books.", "data": { ... } }
```

Errors:

| HTTP | Message | Meaning |
|---|---|---|
| 503 | `Zoho Books is not connected yet…` | `.env` creds missing |
| 422 | `Attach a supplier…` / `Add at least one product line…` | Pre-checks |
| 422 | `Zoho Books: <upstream message>` | Zoho rejected (tax not configured, etc.) — see 03/04 |

On failure the PO stays `zoho_status = "Not Sync"` and the reason is saved to
`purchase_orders.zoho_error`.

## Zoho PDF — `GET /p2p/purchase-orders/{id}/zoho-pdf`

Streams `application/pdf` — Zoho's own rendered PO, cached at
`purchase_orders.zoho_pdf_path` during sync. `404` if the PO was never synced.

---

## DB columns added for Zoho

`purchase_orders`: `zoho_status` (`Sync`/`Not Sync`), `zoho_purchaseorder_id`,
`zoho_synced_at`, `zoho_error`, `zoho_pdf_path`.
`vendors`: `zoho_contact_id` (cached Zoho vendor id).
