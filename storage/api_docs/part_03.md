# Part 03 — Quotations, Proforma Invoices, Sales PDF/Email, Procurement, Shipment, Meetings & Reminders

> Base URL: `http://127.0.0.1:8000`
> All endpoints require `Authorization: Bearer {{token}}` **except** the two public signed-URL PDF views (marked _Public (signed URL)_).
> Response shape is generally `{ "status": true, "data": ... }`; validation failures return HTTP 422 with `{ "message": ..., "errors": {...} }`.

---

## QuotationController

Quotation code format: `QT/{FY}/{SEQ}` (e.g. `QT/2026-27/42`). Server recomputes every line `amount` plus `sub_total` / `grand_total` — client-sent totals are ignored.

### GET /api/sales/quotations
**Action:** `QuotationController@index` — paginated list of quotations (branch-scoped), each row stamped with `can_modify` + flattened creator fields.
**Auth:** Bearer token required
**Query params:** `page` (default 1), `per_page` (default 25, max 200), `status`, `doc_type`, `customer_id`, `opp_id`, `start_date` + `end_date` (both required together, `YYYY-MM-DD`), `search` (matches code / opp_code / customer_name / consignee_name).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/quotations?page=1&per_page=25&status=draft&search=QT/2026-27' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/quotations
**Action:** `QuotationController@store` — create a quotation header + line items in one request; allocates next `QT/` code under a client row-lock.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/quotations' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "doc_type": "International",
  "opp_id": 144,
  "customer_id": 21,
  "consignee_id": 9,
  "bank_account_id": 3,
  "currency": "USD",
  "exchange_rate": 83.25,
  "sales_manager_id": 7,
  "inco_term": "CIP – Carriage and Insurance Paid",
  "port_of_loading": "INMAA – Chennai Port",
  "port_of_discharge": "Jebel Ali, UAE",
  "final_destination": "Dubai, UAE",
  "origin_country": "India",
  "shipping": 12500,
  "terms": "50% advance, balance against B/L copy.",
  "status": "draft",
  "items": [
    {
      "product_id": 101,
      "product_name": "VITEK 2 Compact 30 Analyser",
      "hsn_code": "90189099",
      "quantity": 1,
      "unit": "NOS",
      "rate": 1725000,
      "tax_pct": 5
    },
    {
      "product_id": 102,
      "product_name": "Reagent Kit — VITEK 2 GN ID",
      "hsn_code": "38220090",
      "quantity": 2,
      "unit": "PACK",
      "rate": 32500,
      "tax_pct": 5
    }
  ]
}'
```

**Body fields:**
- `doc_type` (required, string) — one of `International` / `Domestic` (`Quotation::DOC_TYPES`).
- `customer_id` (required, int, exists:customers).
- `items` (required, array, min 1).
  - `items.*.product_name` (required, string ≤255)
  - `items.*.quantity` (required, numeric, min 0.01)
  - `items.*.rate` (required, numeric, **gt:0**)
  - `items.*.product_id` (optional, int)
  - `items.*.hsn_code` (optional, string ≤16)
  - `items.*.unit` (optional, string ≤16)
  - `items.*.tax_pct` (optional, numeric, min 0)
- `opp_id` (optional, int, exists:leads)
- `consignee_id` (optional, int, exists:consignees)
- `bank_account_id` (optional, int)
- `currency` (optional, free-form string)
- `exchange_rate` (optional, numeric ≥0)
- `sales_manager_id` (optional, int, exists:users — defaults to lead's salesperson, then creating user)
- `shipping` (optional, numeric ≥0)
- `terms` (optional, string ≤8000)
- `status` (optional) — one of `Quotation::STATUSES` (e.g. `draft`, `sent`, `approved`, `converted_to_pi`, `cancelled`)
- **International** `doc_type` makes these required: `inco_term` (≤100), `port_of_loading` (≤128), `port_of_discharge` (≤128), `final_destination` (≤128), `origin_country` (≤64).
- **Domestic** `doc_type` makes `state_code` (≤64) required; the shipping/port block becomes optional.

### GET /api/sales/quotations/preview-code
**Action:** `QuotationController@previewCode` — read-only preview of the next `QT/{FY}/{SEQ}` code (does not consume a sequence number).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/quotations/preview-code' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/sales/quotations/{id}
**Action:** `QuotationController@show` — single quotation with items, customer, consignee, lead, sales manager.
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/quotations/55' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/sales/quotations/{id}
**Action:** `QuotationController@update` — replace header + all line items (items are wholesale-replaced); enforces forward-only status transitions. Blocked (409) once status is `converted_to_pi`.
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/quotations/55' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "doc_type": "International",
  "customer_id": 21,
  "currency": "USD",
  "inco_term": "FOB Chennai",
  "port_of_loading": "INMAA – Chennai Port",
  "port_of_discharge": "Jebel Ali, UAE",
  "final_destination": "Dubai, UAE",
  "origin_country": "India",
  "shipping": 10000,
  "status": "sent",
  "items": [
    {
      "product_id": 101,
      "product_name": "VITEK 2 Compact 30 Analyser",
      "quantity": 1,
      "unit": "NOS",
      "rate": 1700000,
      "tax_pct": 5
    }
  ]
}'
```

**Body fields:** identical rule set to `store`. Status transitions are restricted: `draft → sent|cancelled`, `sent → approved|cancelled`, `approved → converted_to_pi|cancelled`; `converted_to_pi` and `cancelled` are terminal (422 on illegal move).

### DELETE /api/sales/quotations/{id}
**Action:** `QuotationController@destroy` — soft-cancel (sets `status = cancelled`). Blocked (409) if already `converted_to_pi`.
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/quotations/55' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/quotations/{id}/convert-to-pi
**Action:** `QuotationController@convertToPi` — marks the quotation `converted_to_pi`. Rejected (409) if already converted or cancelled. No request body.
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/quotations/55/convert-to-pi' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

### POST /api/sales/quotations/{id}/duplicate
**Action:** `QuotationController@duplicate` — clone quotation (+ items) as a new `draft` with a freshly allocated `QT/` code. No request body.
**Auth:** Bearer token required
**Path params:** `{id}` = source quotation id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/quotations/55/duplicate' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

---

## ProformaInvoiceController

PI code format: `INV/{FY}/{SEQ}` (e.g. `INV/2026-27/12`). With-shipment PIs also get a bank-transfer ref `BT-NNNN`. Rule: one non-cancelled PI per opportunity (`opp_id`).

### GET /api/sales/proforma-invoices
**Action:** `ProformaInvoiceController@index` — paginated PI list (branch-scoped); each row stamped with `can_modify` + `victory_reached` (lead reached Stage 6).
**Auth:** Bearer token required
**Query params:** `page`, `per_page` (max 200), `status`, `pi_type`, `doc_type`, `customer_id`, `opp_id`, `start_date` + `end_date` (together), `search` (code / bt_id / opp_code / customer_name / consignee_name / convert_from_code).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/proforma-invoices?page=1&per_page=25&pi_type=with_shipment&search=INV/2026-27' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/proforma-invoices
**Action:** `ProformaInvoiceController@store` — create a PI header + items; allocates `INV/` code (and `BT-` ref for with-shipment). Returns 409 if the opportunity already has a non-cancelled PI.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/proforma-invoices' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "pi_type": "with_shipment",
  "bt_date": "2026-06-03",
  "signing_mode": "digital",
  "source_quotation_id": 55,
  "doc_type": "International",
  "opp_id": 144,
  "customer_id": 21,
  "consignee_id": 9,
  "bank_account_id": 3,
  "currency": "USD",
  "exchange_rate": 83.25,
  "sales_manager_id": 7,
  "inco_term": "CIP – Carriage and Insurance Paid",
  "port_of_loading": "INMAA – Chennai Port",
  "port_of_discharge": "Jebel Ali, UAE",
  "final_destination": "Dubai, UAE",
  "origin_country": "India",
  "shipping": 12500,
  "terms": "50% advance against PI, balance before dispatch.",
  "status": "draft",
  "items": [
    {
      "product_id": 101,
      "product_name": "VITEK 2 Compact 30 Analyser",
      "hsn_code": "90189099",
      "quantity": 1,
      "unit": "NOS",
      "rate": 1725000,
      "tax_pct": 5
    }
  ]
}'
```

**Body fields:**
- `doc_type` (required) — `International` / `Domestic`.
- `customer_id` (required, int, exists:customers).
- `items` (required, array, min 1):
  - `items.*.product_name` (required, string ≤255)
  - `items.*.quantity` (required, numeric, min 0.0001)
  - `items.*.rate` (required, numeric, **min 0**)
  - `items.*.product_id` (optional, int), `items.*.hsn_code` (≤16), `items.*.unit` (≤16), `items.*.tax_pct` (numeric ≥0)
- `pi_type` (optional) — `ProformaInvoice::TYPES` (e.g. `with_shipment` / `without_shipment`; defaults `with_shipment`).
- `bt_id` (optional, string ≤24 — auto-allocated `BT-NNNN` when with-shipment and omitted)
- `bt_date` (optional, date)
- `signing_mode` (optional) — `ProformaInvoice::SIGN_MODES`
- `source_quotation_id` (optional, int, exists:quotations — flips that quotation to `converted_to_pi`)
- `opp_id` (optional, int, exists:leads), `consignee_id` (optional, exists:consignees), `bank_account_id` (optional, int)
- `currency` (optional string), `exchange_rate` (numeric ≥0), `sales_manager_id` (int, exists:users), `shipping` (numeric ≥0), `terms` (≤8000), `status` (`ProformaInvoice::STATUSES`)
- International requires `inco_term`/`port_of_loading`/`port_of_discharge`/`final_destination`/`origin_country`; Domestic requires `state_code`.

### POST /api/sales/proforma-invoices/from-quotation/{quotationId}
**Action:** `ProformaInvoiceController@fromQuotation` — create a PI seeded entirely from a quotation (copies header, items, totals); marks the source quotation `converted_to_pi`. No request body. Rejected (409) if the quotation is already converted/cancelled or the opportunity already has a PI.
**Auth:** Bearer token required
**Path params:** `{quotationId}` = source quotation id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/proforma-invoices/from-quotation/55' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

### GET /api/sales/proforma-invoices/preview-code
**Action:** `ProformaInvoiceController@previewCode` — read-only next `INV/{FY}/{SEQ}` preview (does not consume a number).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/proforma-invoices/preview-code' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/sales/proforma-invoices/{id}
**Action:** `ProformaInvoiceController@show` — single PI with items, customer, consignee, lead, source quotation, sales manager.
**Auth:** Bearer token required
**Path params:** `{id}` = PI id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/proforma-invoices/30' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/sales/proforma-invoices/{id}
**Action:** `ProformaInvoiceController@update` — replace header + all items. Blocked (409) once `converted_to_contract`; currency is locked (422) when the PI was created from a quotation.
**Auth:** Bearer token required
**Path params:** `{id}` = PI id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/proforma-invoices/30' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "pi_type": "with_shipment",
  "doc_type": "International",
  "customer_id": 21,
  "currency": "USD",
  "inco_term": "FOB Chennai",
  "port_of_loading": "INMAA – Chennai Port",
  "port_of_discharge": "Jebel Ali, UAE",
  "final_destination": "Dubai, UAE",
  "origin_country": "India",
  "shipping": 11000,
  "status": "draft",
  "items": [
    {
      "product_id": 101,
      "product_name": "VITEK 2 Compact 30 Analyser",
      "quantity": 1,
      "unit": "NOS",
      "rate": 1725000,
      "tax_pct": 5
    }
  ]
}'
```

**Body fields:** same rule set as `store`. Flipping `pi_type` to `without_shipment` clears `bt_id`/`bt_date`.

### DELETE /api/sales/proforma-invoices/{id}
**Action:** `ProformaInvoiceController@destroy` — soft-cancel (`status = cancelled`). Blocked (409) if `converted_to_contract`.
**Auth:** Bearer token required
**Path params:** `{id}` = PI id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/proforma-invoices/30' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/proforma-invoices/{id}/duplicate
**Action:** `ProformaInvoiceController@duplicate` — clone PI (+ items) as a new `draft` with a fresh `INV/` code. No request body.
**Auth:** Bearer token required
**Path params:** `{id}` = source PI id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/proforma-invoices/30/duplicate' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

---

## SalesPdfController

Renders Quotation / PI PDFs (DomPDF, A4 portrait). `signature` toggles the authorised-signatory block. Email + reminder endpoints attach the PDF and send via `SalesDocumentEmail` / `SalesReminderEmail`.

### POST /api/sales/pi/preview-pdf
**Action:** `SalesPdfController@previewPi` — render a dummy/mock-data PI PDF straight from the posted row fields (no DB record needed). Returns `application/pdf` inline.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/pi/preview-pdf' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --output pi-preview.pdf \
  --data '{
  "piNo": "INV/2026-27/12",
  "piDate": "03/06/2026",
  "btId": "BT-0007",
  "btDate": "03/06/2026",
  "oppId": "OPP-0144",
  "oppDate": "01/06/2026",
  "docType": "International",
  "currency": "$",
  "customer": "Al Falah Trading LLC",
  "consignee": "Jebel Ali Distribution FZE",
  "salesManager": "Ankita",
  "withSignature": true
}'
```

**Body fields (all optional):** `piNo` (≤64), `piDate` (≤32), `btId` (≤32), `btDate` (≤32), `oppId` (≤64), `oppDate` (≤32), `docType` (≤32), `currency` (≤8, accepts symbol or code), `customer` (≤255), `consignee` (≤255), `salesManager` (≤128), `withSignature` (boolean, default true).

### POST /api/sales/proforma-invoices/{id}/preview-pdf
**Action:** `SalesPdfController@previewProformaInvoice` — render the real saved PI as a PDF (inline). Tenant/branch scoped (read).
**Auth:** Bearer token required
**Path params:** `{id}` = PI id.
**Query params:** `signature` (boolean, default true).

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/proforma-invoices/30/preview-pdf?signature=1' \
  --header 'Authorization: Bearer {{token}}' \
  --output pi-30.pdf
```

**Body fields:** none (uses `?signature=` query flag).

### POST /api/sales/proforma-invoices/{id}/email
**Action:** `SalesPdfController@emailProformaInvoice` — render the PI PDF and email it to the customer; stamps `emailed_at` on first send. Requires write scope (normal branch users can't email main-branch records).
**Auth:** Bearer token required
**Path params:** `{id}` = PI id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/proforma-invoices/30/email' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "to": "buyer@alfalah.example",
  "signature": true
}'
```

**Body fields:**
- `to` (optional, string) — recipient override; must be a valid email. When omitted, falls back to the customer's primary-address `cp_email`, then `customer.primary_email`. Returns 422 if no valid recipient exists.
- `signature` (optional, boolean, default true) — picks the with/without-signature PDF variant.

### POST /api/sales/proforma-invoices/{id}/remind
**Action:** `SalesPdfController@remindProformaInvoice` — send a follow-up email with the PI PDF; bumps `reminder_count` + `last_reminded_at`. Returns 422 if the initial email (`emailed_at`) was never sent.
**Auth:** Bearer token required
**Path params:** `{id}` = PI id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/proforma-invoices/30/remind' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "to": "buyer@alfalah.example",
  "signature": true
}'
```

**Body fields:** `to` (optional email override), `signature` (optional boolean, default true) — same resolution rules as the email endpoint.

### GET /api/sales/proforma-invoices/{id}/view
**Action:** `SalesPdfController@publicViewProformaInvoice` — public signed-URL PDF view (with signature) opened from the email's "View PI" button.
**Auth:** Public (signed URL) — validated by Laravel `signed` middleware; URL is generated by the email sender via `temporarySignedRoute(..., now()->addDays(60))`. No bearer token.
**Path params:** `{id}` = PI id.
**Query params:** `expires`, `signature` (HMAC query string — generated, not hand-built).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/proforma-invoices/30/view?expires=1780000000&signature=abc123hmac' \
  --output pi-public.pdf
```

### POST /api/sales/quotations/{id}/preview-pdf
**Action:** `SalesPdfController@previewQuotation` — render the real saved quotation as a PDF (inline). Tenant/branch scoped (read).
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.
**Query params:** `signature` (boolean, default true).

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/quotations/55/preview-pdf?signature=0' \
  --header 'Authorization: Bearer {{token}}' \
  --output qt-55.pdf
```

**Body fields:** none (uses `?signature=` query flag).

### POST /api/sales/quotations/{id}/email
**Action:** `SalesPdfController@emailQuotation` — render the quotation PDF and email it to the customer; stamps `emailed_at`. Requires write scope.
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/quotations/55/email' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "to": "buyer@alfalah.example",
  "signature": true
}'
```

**Body fields:** `to` (optional email override; falls back to customer primary email; 422 if none valid), `signature` (optional boolean, default true).

### POST /api/sales/quotations/{id}/remind
**Action:** `SalesPdfController@remindQuotation` — send a reminder email with the quotation PDF; bumps `reminder_count` + `last_reminded_at`. Returns 422 if the initial email was never sent.
**Auth:** Bearer token required
**Path params:** `{id}` = quotation id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/quotations/55/remind' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "to": "buyer@alfalah.example",
  "signature": true
}'
```

**Body fields:** `to` (optional email override), `signature` (optional boolean, default true).

### GET /api/sales/quotations/{id}/view
**Action:** `SalesPdfController@publicViewQuotation` — public signed-URL PDF view (with signature) opened from the email's "View Quotation" button.
**Auth:** Public (signed URL) — validated by Laravel `signed` middleware; 60-day expiry. No bearer token.
**Path params:** `{id}` = quotation id.
**Query params:** `expires`, `signature` (HMAC query string — generated, not hand-built).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/quotations/55/view?expires=1780000000&signature=abc123hmac' \
  --output qt-public.pdf
```

---

## ProcurementController

Sales Matrix Stage 3. Multipart create with file attachments. Tenant-scoped to the caller's `client_id`; preview code is `PROC-###`.

### GET /api/procurements
**Action:** `ProcurementController@index` — list procurements for the caller's client (with assignee + products).
**Auth:** Bearer token required
**Query params:** `lead_id` (int), `status` (`inprogress` / `done`).

```bash
curl -X GET 'http://127.0.0.1:8000/api/procurements?lead_id=144&status=inprogress' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/procurements
**Action:** `ProcurementController@store` — create a procurement with nested products and file attachments (multipart). Validates lead + lead_product cross-tenant / cross-lead integrity.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/procurements' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'lead_id=144' \
  --form 'procurement_date=2026-06-03' \
  --form 'assign_id=7' \
  --form 'status=inprogress' \
  --form 'notes=Source best price from approved vendors' \
  --form 'attachments[]=@/path/to/rfq.pdf' \
  --form 'products[0][product_id]=101' \
  --form 'products[0][lead_product_id]=512' \
  --form 'products[0][qty]=10' \
  --form 'products[0][target_price]=1650000' \
  --form 'products[0][attachment][]=@/path/to/spec-sheet.pdf' \
  --form 'products[1][product_id]=102' \
  --form 'products[1][qty]=20' \
  --form 'products[1][target_price]=31000'
```

**Body fields (multipart):**
- `products` (required, array, min 1):
  - `products.*.product_id` (required, int, exists:products)
  - `products.*.lead_product_id` (optional, int, exists:lead_products — must belong to the same `lead_id`)
  - `products.*.qty` (optional, numeric, **gt:0**)
  - `products.*.target_price` (optional, numeric, **gt:0**)
  - `products.*.attachment[]` (optional files — `jpg,jpeg,png,webp,pdf`, max 5120 KB, magic-mime checked)
- `lead_id` (optional, int, exists:leads — required when any product references `lead_product_id`; must be in caller's tenant)
- `procurement_date` (optional, date)
- `assign_id` (optional, int, exists:users)
- `status` (optional, in: `inprogress`, `done`; default `inprogress`)
- `notes` (optional, string ≤2000)
- `attachments[]` (optional files — `jpg,jpeg,png,webp,pdf`, max 5120 KB, magic-mime checked)

### GET /api/procurements/next-number
**Action:** `ProcurementController@nextNumber` — preview the next `PROC-###` code + `next_id` for the caller's client.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/procurements/next-number' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/procurements/{id}
**Action:** `ProcurementController@show` — single procurement (assignee, creator, lead, products + linked lead products).
**Auth:** Bearer token required
**Path params:** `{id}` = procurement id (scoped to caller's client).

```bash
curl -X GET 'http://127.0.0.1:8000/api/procurements/12' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ShipmentOrderController

Sales Matrix Stage 6 (Victory). Multipart create/update. One shipment order per opportunity (DB-unique on `lead_id`; second insert → 409).

### GET /api/sales/leads/{leadId}/shipment-order
**Action:** `ShipmentOrderController@getByLead` — fetch the shipment order for a lead (Stage 6 feed). Returns `data: null` if none exists yet.
**Auth:** Bearer token required
**Path params:** `{leadId}` = lead id (scoped to caller's client).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/144/shipment-order' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/shipment-orders
**Action:** `ShipmentOrderController@store` — create the shipment/logistics block (multipart). Returns 409 if the opportunity already has a shipment order; 403 if lead/PI not in tenant.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/shipment-orders' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'lead_id=144' \
  --form 'proforma_invoice_id=30' \
  --form 'shipping_liability=Seller' \
  --form 'cold_chain=true' \
  --form 'zip_code=400001' \
  --form 'freight_cost=85000' \
  --form 'shipping_mode=Sea' \
  --form 'inco_term=CIP – Carriage and Insurance Paid' \
  --form 'port_of_loading=INMAA – Chennai Port' \
  --form 'port_of_unloading=Jebel Ali, UAE' \
  --form 'final_destination=Dubai, UAE' \
  --form 'origin_country=India' \
  --form 'remarks=Reefer container, temp 2-8C' \
  --form 'attachments[]=@/path/to/packing-list.pdf'
```

**Body fields (multipart):**
- `lead_id` (required, int, exists:leads — must be in caller's tenant)
- `port_of_loading` (required, string ≤128)
- `proforma_invoice_id` (optional, int, exists:proforma_invoices — must be in tenant)
- `shipping_liability` (optional, string ≤64)
- `cold_chain` (optional, boolean)
- `zip_code` (optional, string ≤12, regex `^[A-Za-z0-9\s\-]+$`)
- `freight_cost` (optional, numeric, **gt:0**)
- `shipping_mode` (optional, string ≤64)
- `inco_term` (optional, string ≤100)
- `port_of_unloading` (optional, string ≤128)
- `final_destination` (optional, string ≤128)
- `origin_country` (optional, string ≤64)
- `remarks` (optional, string ≤2000)
- `attachments[]` (optional files — `jpg,jpeg,png,webp,pdf,doc,docx`, max 5120 KB)

### GET /api/sales/shipment-orders/{id}
**Action:** `ShipmentOrderController@show` — single shipment order with lead, customer, consignee, PI, creator.
**Auth:** Bearer token required
**Path params:** `{id}` = shipment order id (scoped to caller's client).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/shipment-orders/8' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/shipment-orders/{id}
**Action:** `ShipmentOrderController@update` — update the shipment order (multipart); new attachments are appended to the existing list. (Route uses POST, not PUT.)
**Auth:** Bearer token required
**Path params:** `{id}` = shipment order id (scoped to caller's client).

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/shipment-orders/8' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'shipping_liability=Buyer' \
  --form 'cold_chain=false' \
  --form 'freight_cost=90000' \
  --form 'shipping_mode=Air' \
  --form 'port_of_loading=INMAA – Chennai Port' \
  --form 'remarks=Switched to air freight' \
  --form 'attachments[]=@/path/to/awb.pdf'
```

**Body fields (multipart):** same fields as `store` minus `lead_id` / `proforma_invoice_id` (those are fixed at creation). `port_of_loading` is `sometimes|required` (only validated if present). All others optional with the same rules. New `attachments[]` are appended; omit to keep existing files.

---

## SalesTodoController

Productivity tracker: reminders + meetings. Default scope is "mine" (own rows); admins / main-branch users may pass `?scope=all`. Free-text fields enforce a letters/digits/spaces-only rule. Meeting codes are `M-###` (virtual) / `P-###` (physical).

### GET /api/sales/meetings
**Action:** `SalesTodoController@listMeetings` — list meetings (scoped); ordered by date desc.
**Auth:** Bearer token required
**Query params:** `scope` (`mine` default / `all`), `type` (`SalesMeeting::TYPES` — `virtual` / `physical`), `status` (`SalesMeeting::STATUSES`), `search` (customer / opp_id / code / agenda).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/meetings?scope=mine&type=virtual&status=in_progress' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/meetings
**Action:** `SalesTodoController@storeMeeting` — create a meeting; allocates `M-`/`P-` code atomically. JSON body.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/meetings' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "type": "virtual",
  "opp_id": "OPP-0144",
  "customer": "Al Falah Trading LLC",
  "email": "buyer@alfalah.example",
  "contact": "+91 9850558881",
  "platform": "Google Meet",
  "date": "2026-06-10",
  "start_time": "15:00",
  "end_time": "15:30",
  "link": "https://meet.google.com/abc-defg-hij",
  "agenda": "Discuss VITEK pricing and delivery timeline",
  "status": "in_progress"
}'
```

**Body fields:**
- `type` (required) — `virtual` / `physical` (`SalesMeeting::TYPES`).
- `customer` (required, string ≤255, letters/digits/spaces only, 3–255 chars).
- `contact` (required, string ≤50, regex `^\+?[\d\s\-]{10,20}$`, 10–15 digits after stripping).
- `platform` (required, string ≤100).
- `date` (required, date).
- `start_time` (required, `H:i`).
- `end_time` (required, `H:i`, ≥ start_time).
- `agenda` (required, string ≤2000, safe-text 3–2000).
- `link` (string ≤2048, valid URL — **required when** `type=virtual`).
- `venue` (string ≤1000 — **required when** `type=physical`; safe-text 3–1000).
- `opp_id` (optional, string ≤60), `email` (optional, email ≤191), `status` (optional, `SalesMeeting::STATUSES`).

### GET /api/sales/meetings/next-code
**Action:** `SalesTodoController@nextMeetingCode` — preview next meeting code for a type (non-locking).
**Auth:** Bearer token required
**Query params:** `type` (`virtual` default / `physical`).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/meetings/next-code?type=physical' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/sales/meetings/{id}
**Action:** `SalesTodoController@updateMeeting` — update a meeting; if `type` flips, a fresh code is re-allocated. Only own rows unless admin/main-branch.
**Auth:** Bearer token required
**Path params:** `{id}` = meeting id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/meetings/17' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "type": "physical",
  "customer": "Al Falah Trading LLC",
  "contact": "+91 9850558881",
  "platform": "On-site",
  "date": "2026-06-12",
  "start_time": "11:00",
  "end_time": "12:00",
  "venue": "Solitaire Business Hub Baner Pune",
  "agenda": "Final negotiation and contract signing",
  "status": "in_progress"
}'
```

**Body fields:** same rule set as `storeMeeting` (`type`, `customer`, `contact`, `platform`, `date`, `start_time`, `end_time`, `agenda` required; `link`/`venue` conditionally required by type).

### DELETE /api/sales/meetings/{id}
**Action:** `SalesTodoController@destroyMeeting` — soft-delete a meeting. Only own rows unless admin/main-branch.
**Auth:** Bearer token required
**Path params:** `{id}` = meeting id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/meetings/17' \
  --header 'Authorization: Bearer {{token}}'
```

### PATCH /api/sales/meetings/{id}/status
**Action:** `SalesTodoController@setMeetingStatus` — update only the meeting status.
**Auth:** Bearer token required
**Path params:** `{id}` = meeting id.

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/sales/meetings/17/status' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "status": "done"
}'
```

**Body fields:** `status` (required) — one of `SalesMeeting::STATUSES` (e.g. `in_progress`, `done`, `postponed`, `cancelled`).

### GET /api/sales/reminders
**Action:** `SalesTodoController@listReminders` — list reminders (scoped); ordered by set_date desc.
**Auth:** Bearer token required
**Query params:** `scope` (`mine` default / `all`), `status` (`SalesReminder::STATUSES`), `search` (subject / opp_id / remark).

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/reminders?scope=mine&status=in_progress' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/sales/reminders
**Action:** `SalesTodoController@storeReminder` — create a personal follow-up reminder; optional single file attachment (multipart when attaching).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/reminders' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'opp_id=OPP-0144' \
  --form 'opp_date=2026-06-01' \
  --form 'subject=Follow up on VITEK quotation' \
  --form 'set_date=2026-06-05' \
  --form 'tat=24 Hours' \
  --form 'remark=Customer asked for revised pricing' \
  --form 'status=in_progress' \
  --form 'attachment=@/path/to/note.pdf'
```

**Body fields:**
- `subject` (required, string ≤255, letters/digits/spaces only, 3–255 chars).
- `set_date` (required, date).
- `opp_id` (optional, string ≤60), `opp_date` (optional, date), `tat` (optional, string ≤60; default `24 Hours`), `remark` (optional, string ≤2000), `status` (optional, `SalesReminder::STATUSES`).
- `attachment` (optional file — `png,jpg,jpeg,pdf,doc,docx,xls,xlsx,csv`, max 20480 KB).

### PUT /api/sales/reminders/{id}
**Action:** `SalesTodoController@updateReminder` — update a reminder; replacing the attachment deletes the old file. Only own rows unless admin/main-branch.
**Auth:** Bearer token required
**Path params:** `{id}` = reminder id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/reminders/9' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'subject=Follow up revised pricing' \
  --form 'set_date=2026-06-06' \
  --form 'tat=48 Hours' \
  --form 'remark=Sent revised PI' \
  --form 'status=in_progress'
```

**Body fields:** same rule set as `storeReminder` (`subject` + `set_date` required; others optional). Send as multipart when attaching a file.

### DELETE /api/sales/reminders/{id}
**Action:** `SalesTodoController@destroyReminder` — delete a reminder (and its attachment file). Only own rows unless admin/main-branch.
**Auth:** Bearer token required
**Path params:** `{id}` = reminder id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/reminders/9' \
  --header 'Authorization: Bearer {{token}}'
```

### PATCH /api/sales/reminders/{id}/status
**Action:** `SalesTodoController@setReminderStatus` — update only the reminder status.
**Auth:** Bearer token required
**Path params:** `{id}` = reminder id.

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/sales/reminders/9/status' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "status": "done"
}'
```

**Body fields:** `status` (required) — one of `SalesReminder::STATUSES` (e.g. `in_progress`, `done`).
