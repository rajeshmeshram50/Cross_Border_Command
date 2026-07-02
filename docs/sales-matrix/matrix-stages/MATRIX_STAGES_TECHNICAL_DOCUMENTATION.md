# MATRIX STAGES MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Opportunity Pipeline (6 stages inside the Matrix Detail)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
The per-opportunity **Matrix Detail** view runs a lead through 6 stages. Stage 1–4 data lives on the **lead** side (`SalesLeadController` — task manager, acknowledgements, products, shared prices); Stages 5–6 are backed by dedicated controllers/models — **Quotation**, **ProformaInvoice**, **Procurement**, **ShipmentOrder** — plus **SalesPdf** (PDF/email/signed links) and **SalesTodo** (reminders/meetings). The **Matrix Detail shell** (`SalesMatrixDetail.tsx`) hosts the stepper, left CLM panel and right Task-Manager panel.

### 1.2 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│         MATRIX DETAIL  ·  /sales/matrix/{oppId}/stage/{stage}             │
│  resources/js/pages/sales/opportunity-pipeline/matrix/                    │
│  SalesMatrixDetail  ── stepper · LEFT CLM · CENTER stage · RIGHT TaskMgr  │
│  stages/Stage1..Stage6  +  ~16 modals (procurement, shipment, signing…)  │
└──────────────────────────────────────────────────────────────────────────┘
                                   │  HTTPS / JSON (+ multipart uploads)
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              Laravel 12 API · auth:sanctum → user.active                  │
│  SalesLeadController (stage 1–4 data) · QuotationController ·             │
│  ProformaInvoiceController · ProcurementController · ShipmentOrderController│
│  SalesPdfController (pdf/email/remind/public-view) · SalesTodoController   │
│  CLM: ClmSignatureController (Zoho e-sign)                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐│
│  │ Lead ─ LeadProduct ─ LeadProductSharedPrice · LeadAcknowledgement ·   ││
│  │ LeadTaskManager    Quotation─QuotationItem   ProformaInvoice─PIItem   ││
│  │ Procurement─ProcurementProduct   ShipmentOrder   SalesMeeting/Reminder││
│  └──────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  PostgreSQL (c_b_c)  ·  dompdf (PDF cache)  ·  Zoho Sign  ·  SMTP mail     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Access model
All routes `auth:sanctum` + `user.active`; every query tenant-scoped (`client_id`/`branch_id`) + `SalesVisibility`. The **public PDF view** routes are the exception — guarded by Laravel's **`signed`** middleware (60-day expiry), no login.

### 1.4 Module Structure
```
app/Http/Controllers/Api/
  QuotationController.php · ProformaInvoiceController.php · ProcurementController.php
  ShipmentOrderController.php · SalesPdfController.php · SalesTodoController.php
  SalesLeadController.php (stage 1–4 methods)
app/Models/
  Quotation · QuotationItem · ProformaInvoice · ProformaInvoiceItem
  Procurement · ProcurementProduct · ShipmentOrder · SalesMeeting · SalesReminder
  (+ Lead · LeadProduct · LeadProductSharedPrice · LeadAcknowledgement · LeadTaskManager)
database/migrations/ 2026_05_30_0000{10..110}_*  ·  2026_06_15_000001_* (shipment code)  ·  2026_06_23_* (vendor_id)
resources/js/pages/sales/opportunity-pipeline/matrix/
  SalesMatrixDetail.tsx · TaskManagerPanel.tsx · stages/Stage1..6 · ~16 *Modal.tsx
```

---

## 2. TECHNOLOGY STACK
PHP 8.2 / Laravel 12 / **PostgreSQL** / Sanctum 4 · **dompdf** (quotation/PI/shared-price PDFs, disk-cached) · **milon/barcode** (Code-128 on shared-price PDF) · **Zoho Sign** (e-signature) · SMTP mail (SalesDocumentEmail / SalesReminderEmail). Frontend React 19 + TS + Vite + reactstrap/Bootstrap/Tailwind.

---

## 3. DATABASE SCHEMA

### 3.1 ERD (stage-owned tables)
```
leads ─┬─ lead_task_managers (1:1)         ── Stage 1
       ├─ lead_acknowledgements (1:*)       ── Stage 2
       ├─ lead_products (1:*) ─ lead_product_shared_prices (1:*)   ── Stage 3–4
       ├─ quotations (1:*) ─ quotation_items (1:*)                 ── Stage 5
       ├─ proforma_invoices (1:*) ─ proforma_invoice_items (1:*)   ── Stage 5
       │      └─ source_quotation_id → quotations
       ├─ procurements (1:*) ─ procurement_products (1:*) → vendor ── Stage 3/6
       └─ shipment_orders (1:1, unique lead_id) → proforma_invoice ── Stage 6
sales_reminders · sales_meetings (opp_id string ref)              ── side panels
```

### 3.2 `quotations` / `proforma_invoices`  *(migrations `2026_05_30_000010`/`…000030`)*
Shared columns: `id`, `client_id`/`branch_id`, **`code`** (UNIQUE `(client_id, code)`), `version`, `doc_type` (International/Domestic), `opp_id`/`opp_code`/`opportunity_date`, `customer_id`/`customer_name`, `consignee_id`/`consignee_name`, `bank_account_id`/`bank_label`, `currency`/`exchange_rate`, `inco_term`/`port_of_loading`/`port_of_discharge`/`final_destination`/`origin_country`/`state_code`, `sales_manager_id`/`_name`, `sub_total`/`shipping`/`grand_total`, `status`, `emailed_at`/`last_reminded_at`/`reminder_count`, `terms`, `created_by`/`updated_by`.
**PI adds:** `pi_type` (with/without_shipment), `bt_id` (`BT-####`) + `bt_date`, `signing_mode`, **`source_quotation_id`** (FK, nullOnDelete) + `convert_from_code`. Indexes: `(client_id, code)` unique, `(client_id, status)`, `(client_id, doc_type)`, `(client_id, opp_id)`, `(client_id, customer_id)`.

### 3.3 `quotation_items` / `proforma_invoice_items`  *(`…000020`/`…000040`)*
`id`, parent FK (cascade), `product_id` (nullable soft ref), `product_name` (snapshot `CODE – NAME`), `hsn_code`, `quantity` (≥0.01), `unit`, `rate`, `tax_pct`, **`amount`** (server-computed `qty×rate×(1+tax%/100)`, 2dp), `line_no`.

### 3.4 `procurements` / `procurement_products`  *(`…000060`/`…000070`, `+2026_06_23` vendor_id)*
`procurements`: `id`, `client_id`, `lead_id`, `procurement_date`, `assign_id`, `status` (inprogress/done), `attachments` (json), `notes`, `created_by`. `procurement_products`: `procurement_id` (cascade), `lead_product_id` (nullable), `product_id`, **`vendor_id`** (auto-assigned when a product has a single vendor mapping), `qty`, `target_price`, `attachments`.

### 3.5 `shipment_orders`  *(`…000110`, `+2026_06_15` shipment_code)*
`id`, `client_id`/`branch_id`, **`shipment_code`** (`SHP-###` per branch), **`lead_id` (UNIQUE — one per opp)**, `proforma_invoice_id`, `shipping_liability`, `cold_chain` (bool), `zip_code`, `freight_cost` (>0), `shipping_mode`, `inco_term`, `port_of_loading` (required)/`port_of_unloading`/`final_destination`/`origin_country`, `attachments` (json), `remarks`, `created_by`.

### 3.6 `sales_reminders` / `sales_meetings`  *(`2026_05_19_000001`; SoftDeletes)*
Reminders: `opp_id` (string), `subject`, `set_date`, `tat`, `remark`, `attachment_*`, `status` (In Progress/Done). Meetings: **`code`** (`M-###` virtual / `P-###` physical, unique `(client_id, branch_id, code)`), `opp_id`, `customer`, `contact`, `platform`, `date`/`start_time`/`end_time`, `link`/`venue`, `agenda`, `status`, `type`.

*(Stage 1–4 lead-side tables — `lead_task_managers`, `lead_acknowledgements`, `lead_products`, `lead_product_shared_prices` — are documented in the Lead Worksheet technical doc.)*

---

## 4. MODEL HIGHLIGHTS
- **Quotation / ProformaInvoice** — `items()` hasMany; `branch`/`customer`/`consignee`/`lead`/`salesManager`/`creator` belongsTo; PI adds `shipmentOrder()` hasOne + `sourceQuotation()` belongsTo. Totals cast decimal:2; `emailed_at`/`last_reminded_at` datetime.
- **Procurement** — `attachments` cast array; `lead`/`assignee`/`creator` belongsTo; `products()` hasMany ProcurementProduct.
- **ShipmentOrder** — `cold_chain` bool, `attachments` array; `lead`/`proformaInvoice`/`creator` belongsTo.
- **SalesReminder / SalesMeeting** — SoftDeletes; owner (`created_by_user_id`) + `employee_id`; tenant-scoped.

---

## 5. API ENDPOINTS (stage controllers)
```php
// Stage 5 — Quotation
GET /sales/quotations · GET /preview-code · POST · GET/PUT/DELETE /{id} · POST /{id}/duplicate · POST /{id}/convert-to-pi
// Stage 5 — Proforma Invoice
GET /sales/proforma-invoices · GET /preview-code · POST · POST /from-quotation/{qtId} · GET/PUT/DELETE /{id} · POST /{id}/duplicate
// Stage 5 — PDF / email / signed public view
POST /sales/{quotations|proforma-invoices}/{id}/preview-pdf · /email · /remind
GET  /sales/{quotations|proforma-invoices}/{id}/view   (signed, 60-day, public)
// Stage 3/6 — Procurement & Shipment
POST/GET /procurements[/{id}] · GET /procurements/next-number
GET /sales/shipment-orders[/{id}] · POST · PUT /{id} · GET /next-code · GET /by-lead/{leadId}
// Side panels
GET/POST/PUT/PATCH/DELETE /sales/reminders[/{id}] · /sales/meetings[/{id}] · GET /sales/meetings/next-code
// Stage 1–4 (lead side): /sales/leads/{id}/{task-manager|acknowledgements|whatsapp|products|shared-prices}
```
Full detail in **MATRIX_STAGES_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER METHOD MAP
| Controller | Methods | Notes |
|---|---|---|
| **Quotation** | index · previewCode · store · show · update · destroy · duplicate · convertToPi | `QT/FY/SEQ` (advisory + row lock); edit blocked if converted/signed; `convertToPi` marks intent only |
| **ProformaInvoice** | index · previewCode · store · fromQuotation · show · update · destroy · duplicate | `PI/FY/SEQ` + `BT-####`; one-PI-per-opp (409); DCP gate; `fromQuotation` copies fields+items; currency lock |
| **Procurement** | store · index · show · nextNumber | `PROC-###`; sole-vendor auto-assign; ProcurementProduct children |
| **ShipmentOrder** | store · index · show · getByLead · nextCode · update | `SHP-###` per branch; unique `lead_id` (409); links PI |
| **SalesPdf** | preview/email/remind/publicView × {quotation,PI} | dompdf + md5 cache; 60-day signed links; email 3/min, `emailed_at` idempotent, reminders need prior email |
| **SalesTodo** | reminders CRUD + status · meetings CRUD + status + next-code | `M-###`/`P-###`; owner-scoped |
| **SalesLead** (stages) | storeTaskManager · store/listAcknowledgements · updateWhatsApp · lead-products CRUD + sourcing-status + mark-sourced · shared-prices · sharedPricePdf | Stage 1–4 data; product list locks at `lead_stage_id ≥ 4` |

---

## 7. QUOTATION → PI → PROCUREMENT → SHIPMENT FLOW
1. **Stage 4** quotation created (`store`) — FY code, server totals, status draft.
2. **Stage 5** convert (`fromQuotation`) — DCP + one-PI-per-opp gates pass → copies fields + items, sets `source_quotation_id`/`convert_from_code`, marks quotation `converted_to_pi`, allocates `PI/FY/SEQ` (+ `BT-####` if `with_shipment`).
3. PI is emailed (signed 60-day link) and/or **sent for e-signature** (Zoho `ClmSignatureRequest`). Completion → `pi_signed_at`.
4. **Victory gate:** a signed PI unlocks Stage 6; `won_at` stamped; the center becomes read-only.
5. **Stage 6** `ShipmentOrder` created (`SHP-###`, unique `lead_id`) linking the PI + logistics.
Procurements (`PROC-###`) are created in **Stage 3** to source *Required* products (vendor auto-assign when a product has one mapping).

---

## 8. PDF, EMAIL & SIGNED LINKS
- **Render:** dompdf on a shared quotation/PI Blade; `renderSalesPdfCached()` keys on `md5(viewData + signature_flag)` → `pdf-cache/sales-*.pdf` (manual clear on template change). Buyer/company details use **live** master data (edits flow into historical PDFs).
- **Email:** recipient resolved (override → customer primary email); **rate-limited 3/min**; `emailed_at` stamped once; the mail carries a **60-day signed view URL**.
- **Reminder:** requires a prior email; re-renders a fresh PDF + a fresh 60-day link; bumps `reminder_count`.
- **Public view:** `sales.quotation.view` / `sales.pi.view` under `signed` middleware — inline PDF, no login, dies after 60 days.
- **Shared-price PDF** (Stage 4): tenant-branded, Code-128 barcode (`Q-#####`).

---

## 9. ERROR HANDLING
| Condition | HTTP | Source |
|---|---|---|
| Edit a converted/signed quotation or PI | 422 | update() guards |
| Second PI on an opportunity | 409 | one-PI-per-opp gate (+ `existing_pi`) |
| Missing mandatory KYC docs | 422 | DCP `partyDocsBlockResponse` |
| Change a from-quotation PI's currency | 422 | currency lock |
| Second shipment on an opportunity | 409 | unique `lead_id` |
| Email over rate / reminder before email | 429 / 422 | SalesPdf email guards |
| Signed URL tampered / expired | 403 / 404 | `signed` middleware |
Code allocation, `store`/`fromQuotation`/shipment `store` are transactional (client row lock + advisory locks).

---

## 10. PERFORMANCE
FY/advisory-locked code allocation (no gaps/collisions) · disk PDF cache · server-side total recomputation · one-PI/one-shipment unique constraints · eager-loaded relations on list/show · signed links offload doc delivery (no auth round-trips).

---

## 11. CODE QUALITY METRICS
| Metric | Value |
|---|---|
| Stage controllers | Quotation · ProformaInvoice · Procurement · ShipmentOrder · SalesPdf · SalesTodo (+ SalesLead stage methods) |
| Stage tables | quotations/items · proforma_invoices/items · procurements/products · shipment_orders · sales_reminders/meetings (+ lead-side) |
| Codes | `QT/FY/SEQ` · `PI/FY/SEQ` · `BT-####` · `PROC-###` · `SHP-###` · `M-###`/`P-###` |
| Integrations | dompdf + barcode · Zoho Sign · SMTP · signed public links |
| Frontend | SalesMatrixDetail + 6 stages + TaskManagerPanel + ~16 modals |
| Tests | none |

---

*Related documents: MATRIX_STAGES_FUNCTIONAL_DOCUMENTATION.md · MATRIX_STAGES_CODE_WALKTHROUGH.md · MATRIX_STAGES_API_DOCUMENTATION.md*
