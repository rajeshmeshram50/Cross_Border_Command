# MATRIX STAGES MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Opportunity Pipeline (6 stages)
> Base URL: `{APP_URL}/api` · Authenticated endpoints require `Authorization: Bearer <sanctum_token>`

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS
**Scope** — all endpoints (except the public PDF views) are `auth:sanctum` + `user.active`, tenant-scoped (`client_id`/`branch_id`) + `SalesVisibility`. Envelope is mixed: lists → `{ status, data[], pagination }`; items → `{ status, data }`; actions → `{ status, message, … }`.
**Codes** — `200`/`201` · `401`/`403` · `404` · **`409`** (one-PI / one-shipment) · `422` (validation / gate) · `429` (email rate limit).
**Stage data lives in two places:** Stages 1–4 on `/sales/leads/{id}/…`; Stages 5–6 on the quotation/PI/procurement/shipment controllers.

---

## 2. ENDPOINT INDEX
| Area | Method · Path |
|---|---|
| Stage 1 | `POST /sales/leads/{id}/task-manager` · `POST /sales/leads/{id}/whatsapp` |
| Stage 2 | `GET/POST /sales/leads/{id}/acknowledgements` |
| Stage 3 | `GET/POST/PUT/DELETE /sales/leads/{id}/products[/{m}]` · `PATCH …/{m}/sourcing-status` · `PATCH …/{m}/mark-sourced` · `POST/GET /procurements[/{id}]` · `GET /procurements/next-number` |
| Stage 4 | `GET /sales/leads/{id}/shared-prices` · `POST/GET …/products/{m}/shared-prices` · `GET /sales/shared-prices/{id}/pdf` |
| Stage 5 (Quotation) | `GET /sales/quotations` · `GET /preview-code` · `POST` · `GET/PUT/DELETE /{id}` · `POST /{id}/duplicate` · `POST /{id}/convert-to-pi` |
| Stage 5 (PI) | `GET /sales/proforma-invoices` · `GET /preview-code` · `POST` · `POST /from-quotation/{qtId}` · `GET/PUT/DELETE /{id}` · `POST /{id}/duplicate` |
| Stage 5 (PDF/email) | `POST /sales/{quotations\|proforma-invoices}/{id}/preview-pdf \| /email \| /remind` · `GET …/{id}/view` (signed) |
| Stage 6 | `GET /sales/shipment-orders` · `POST` · `PUT /{id}` · `GET /{id}` · `GET /next-code` · `GET /by-lead/{leadId}` |
| Panels | `GET/POST/PUT/PATCH/DELETE /sales/reminders[/{id}]` · `/sales/meetings[/{id}]` · `GET /sales/meetings/next-code` |
| E-sign | `GET /clm/signature-requests?lead_id=&document_type=&sync=1` · `POST …/send` · `POST …/{id}/remind` · `GET …/{id}/{view-file\|download-file\|certificate}` |

---

## 3. STAGE 1–4 (lead side)
| Method · Path | Body / notes |
|---|---|
| `POST /sales/leads/{id}/task-manager` | multipart: `name*`, `mobile_no*` (6–15 digits), `email*`, `order_value`, `buying_plan`, `attachment`; upsert per lead |
| `POST /sales/leads/{id}/whatsapp` | `whatsapp_status` (connected/pending/not_connected/opted_out), `whatsapp_reason`, `screenshot`; sets `has_whatsapp` |
| `GET/POST /sales/leads/{id}/acknowledgements` | POST `{ reason_ids[] }` (same bucket) → creates rows + flips `qualified`/`disqualified` (no stage change) |
| `GET/POST/PUT/DELETE /sales/leads/{id}/products[/{m}]` | map product (currency/quantity/target_price); single currency per lead; **DELETE 422 once `lead_stage_id ≥ 4`** |
| `PATCH …/products/{m}/sourcing-status` | `{ sourcing_status: required\|not_required }` (not_required clears `procurement_done`) |
| `PATCH …/products/{m}/mark-sourced` | requires `required` + a linked procurement → `procurement_done=true` (409 if already) |
| `POST /sales/leads/{id}/products/{m}/shared-prices` | `{ quoted_price >0 }`; append-only |
| `GET /sales/shared-prices/{id}/pdf?inline=1` | barcoded (`Q-#####`), tenant-branded PDF |

---

## 4. QUOTATIONS — `/sales/quotations`
`store`/`update` body: `doc_type`, `customer_id*`, `consignee_id`, `currency`, `inco_term`/ports (International), `terms`, `items[]` (`product_id`, `quantity >0`, `rate >0`, `tax_pct`, `unit`). Totals **recomputed server-side**.
```json
POST /sales/quotations → 201 { "status":true,
  "data": { "id":9, "code":"QT/2026-27/12", "version":1, "status":"draft",
    "customer_name":"Acme Corp", "grand_total":"12500.00", "currency":"USD" },
  "items": [ { "product_name":"P-01 – Basmati Rice", "quantity":"10.000", "rate":"1200.0000", "amount":"12000.00" } ] }
```
- `GET /preview-code` → `{ data:{ code:"QT/2026-27/13" } }` (no allocation). `POST /{id}/duplicate` → new code, draft.
- `PUT /{id}` — **blocked (422) if converted or signed**; wholesale item replace; bumps `version`; supersedes any e-signature.
- `POST /{id}/convert-to-pi` — marks the quotation `converted_to_pi` (intent); the actual PI is created via **PI `from-quotation`**.
- `DELETE /{id}` — soft-cancel (`status=cancelled`); blocked if already converted.

## 5. PROFORMA INVOICES — `/sales/proforma-invoices`
Same shape as quotations + `pi_type` (with/without_shipment → `BT-####`), `signing_mode`, `source_quotation_id`.
- `POST /from-quotation/{qtId}` → **core conversion**: copies fields + line items, sets `source_quotation_id`/`convert_from_code`, marks the quotation converted. **Gates:** one-PI-per-opp (**409** + `existing_pi`), DCP mandatory KYC/DD/TL docs (**422**).
- `PUT /{id}` — blocked if signed/converted; **currency locked** when `source_quotation_id` set (422).
```json
POST /sales/proforma-invoices/from-quotation/12 → 201
{ "status":true, "data": { "id":4, "code":"PI/2026-27/3", "bt_id":"BT-0007",
   "source_quotation_id":12, "convert_from_code":"QT/2026-27/12", "status":"draft" } }
```

## 6. PDF / EMAIL / SIGNED VIEW — `SalesPdfController`
| Method · Path | Notes |
|---|---|
| `POST /sales/{quotations\|proforma-invoices}/{id}/preview-pdf?signature=1` | dompdf (cached), blob |
| `POST …/{id}/email` | recipient resolved; **429** if >3/min; stamps `emailed_at` once; mail carries a 60-day signed link → `{ to, emailed_at, reminder_count }` |
| `POST …/{id}/remind` | **422** if never emailed; fresh PDF + fresh link; bumps `reminder_count` |
| `GET /sales/{quotations\|proforma-invoices}/{id}/view?expires=&signature=` | **public**, `signed` middleware, 60-day, inline PDF |

## 7. PROCUREMENT & SHIPMENT
**`POST /procurements`** — `{ lead_id, procurement_date, assign_id, status, products:[{ product_id, lead_product_id, qty>0, target_price>0, vendor_id? }] }`; sole-vendor auto-assign; `PROC-###`. `GET /procurements[/{id}]`, `GET /procurements/next-number`.

**`POST /sales/shipment-orders`** — `{ lead_id*, proforma_invoice_id, shipping_liability, cold_chain, zip_code, freight_cost>0, shipping_mode, inco_term, port_of_loading*, port_of_unloading, final_destination, origin_country, remarks, attachments[] }`. **409** on a second shipment (unique `lead_id`). `SHP-###` per branch. `GET /next-code`, `GET /by-lead/{leadId}`, `PUT /{id}` (appends attachments).

## 8. E-SIGNATURE (Zoho) & PANELS
- `GET /clm/signature-requests?lead_id=&document_type=quotation|proforma_invoice&sync=1` · `POST …/send` · `POST …/{id}/remind` · `GET …/{id}/view-file/0` · `/download-file/0` · `/certificate`. A completed request sets `pi_signed_at` (unlocks Victory).
- **Reminders/Meetings:** `/sales/reminders` + `/sales/meetings` (CRUD + `PATCH` status); meeting codes `M-###`/`P-###` via `/sales/meetings/next-code`.

## 9. ADVANCING STAGES
Each stage advances by `PUT /sales/leads/{id}` with `lead_stage_id: n` (2→6). Victory (6) is gated on a **signed PI**; `won_at` is stamped on entry; the center goes read-only.

---

## 10. ERROR EXAMPLES
```json
409 { "status":false, "message":"This opportunity already has a Proforma Invoice.",
      "existing_pi": { "id":4, "code":"PI/2026-27/3" } }
422 { "status":false, "message":"Upload the mandatory KYC / DD / Trade Licence documents first." }
422 { "status":false, "message":"This PI was created from a quotation and is locked to USD." }
429 { "status":false, "message":"Too many emails — please wait a minute." }
```

---

*Related documents: MATRIX_STAGES_TECHNICAL_DOCUMENTATION.md · MATRIX_STAGES_FUNCTIONAL_DOCUMENTATION.md · MATRIX_STAGES_CODE_WALKTHROUGH.md*
