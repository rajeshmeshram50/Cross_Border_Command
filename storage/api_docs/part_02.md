# Part 02 — Sales Leads & Acknowledgement Reasons

Base URL: `http://127.0.0.1:8000`
All endpoints require `Authorization: Bearer {{token}}` and sit behind `auth:sanctum` + `user.active`.
Tenant scoping: rows are pinned to the caller's `client_id`; sub-branch users are further pinned to their branch. Never send `client_id` in the body — it is derived from the token.

---

## SalesLeadController

### GET /api/sales/leads
**Action:** `SalesLeadController@index` — paginated lead list for the My Workplace worksheet, with status tab, facet filters, full-table search, and per-tab counters.
**Auth:** Bearer token required
**Query params:**
- `status` = `qualified` | `disqualified` | `all` (omit/anything else = no status filter)
- `platform` — scalar or array (`platform[]=Vortex&platform[]=Purvee`)
- `query_type` — scalar or array
- `salesperson_id` — scalar or array
- `assigned` = `1` (has salesperson) | `0` (unassigned)
- `lead_stage_id` — scalar or array (1–6)
- `sender_country_iso` — scalar or array (e.g. `IN`)
- `customer_id` — scalar or array
- `start_date` & `end_date` (both required together, `YYYY-MM-DD`) — filters on `query_time`
- `search` — matches opp_code, sender name/email/mobile/company, product, country, remark, salesperson & customer names
- `per_page` (1–200, default 50), `page` (default 1)
- `with_counts` = `1` (default) | `0` (skip tab counters on pure pagination)

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads?status=qualified&platform=Offline&search=Basmati&per_page=25&page=1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/leads
**Action:** `SalesLeadController@store` — manual lead capture (Add New Lead modal). Auto-fills `sender_country_iso` from the country master when only a name is sent; auto-allocates `opp_code` (`OPP-NNNN`), sets `platform=Offline`, `query_type=Manual`, `lead_stage_id=1`, `qualified=true`.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "sender_name": "Rahul Sharma",
  "sender_mobile": "+919876543210",
  "sender_email": "rahul.sharma@agriexports.in",
  "sender_company": "Agri Exports Pvt Ltd",
  "sender_address": "Plot 22, MIDC Industrial Area",
  "sender_city": "Pune",
  "sender_state": "Maharashtra",
  "sender_country_name": "India",
  "sender_pincode": "411019",
  "customer_id": 14,
  "consignee_id": 7,
  "query_message": "Need quote for 1000 MT Basmati Rice, FOB Nhava Sheva",
  "product_quantity": "1000 MT",
  "query_product_name": "Basmati Rice 1121"
}'
```

**Body fields:**
- `sender_name` — required, string, max 255
- `sender_mobile` — optional, string, max 32
- `sender_email` — optional, valid email, max 255
- `sender_company` — optional, string, max 255
- `sender_address` — optional, string, max 1000
- `sender_city` / `sender_state` — optional, string, max 128
- `sender_country_iso` — optional, string, max 8
- `sender_country_name` — optional, string, max 128 (resolves to ISO if iso omitted)
- `sender_pincode` — optional, string, max 32
- `customer_id` — optional, integer, must exist in `customers`
- `consignee_id` — optional, integer, must exist in `consignees`
- `query_message` — optional, string, max 10000
- `product_quantity` — optional, string, max 64
- `query_product_name` — optional, string, max 255

---

### POST /api/sales/leads/assign
**Action:** `SalesLeadController@assign` — assigns one or many leads to a single salesperson (row-level Assign + bulk modal). Out-of-tenant ids are silently skipped and reported in `skipped_no_scope`.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/assign' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "lead_ids": [101, 102, 103],
  "salesperson_id": 27
}'
```

**Body fields:**
- `lead_ids` — required, array, min 1; each item integer
- `salesperson_id` — required, integer, must exist in `users`

---

### POST /api/sales/leads/convert-to-qualified
**Action:** `SalesLeadController@convertToQualified` — flips disqualified leads back to qualified, clearing their `lead_ack_reason_id`. Tenant-scoped (hostile ids skipped).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/convert-to-qualified' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "lead_ids": [104, 105]
}'
```

**Body fields:**
- `lead_ids` — required, array, min 1; each item integer

---

### GET /api/sales/leads/filter-options
**Action:** `SalesLeadController@filterOptions` — one round-trip feeding the Filter modal: distinct platforms, query_types, countries (`{value,label}`), customer dropdown (capped at 500), and the 6 canonical stages.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/filter-options' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/sales/leads/salespeople
**Action:** `SalesLeadController@salespeople` — tenant-scoped roster of active users that can own a lead (client_admin / client_user / branch_user / employee). Used by the Assign/Distribute dropdowns.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/salespeople' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/sales/leads/salesperson-summary
**Action:** `SalesLeadController@salespersonSummary` — Lead-Distribution table data: header totals (sales persons / leads / assigned / unassigned), distinct platforms, and one enriched row per salesperson (department, designation, roles, reporting manager, per-platform lead counts).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/salesperson-summary' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/leads/sync
**Action:** `SalesLeadController@syncFromCrm` — pulls leads from the IndiaMart CRM keys configured per tenant. Gated by `config/lead_sync.php` (branch match); super_admin bypasses the gate. Returns 403 if the tenant gate fails.
**Auth:** Bearer token required
**Body:** none (empty POST).

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/sync' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/sales/leads/sync/config
**Action:** `SalesLeadController@syncConfig` — tells the frontend whether to render the "Sync from IndiaMart" button. Returns `{ enabled, labels }` (enabled iff the tenant gate passes and at least one CRM key is configured).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/sync/config' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/sales/leads/{id}
**Action:** `SalesLeadController@show` — full lead detail for the Sales Matrix detail page (salesperson, customer, consignee, ackReason, taskManager, acknowledgements). Tenant-scoped; 404 on cross-tenant id.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/101' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/sales/leads/{id}
**Action:** `SalesLeadController@update` — edit a lead. Auto-stamps `won_at` on first entry to Stage 6 and clears it when regressing below 6. Rejects qualified+disqualified both true (422).
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/leads/101' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "sender_name": "Rahul Sharma",
  "sender_mobile": "+919876543210",
  "sender_email": "rahul.sharma@agriexports.in",
  "qualified": true,
  "disqualified": false,
  "lead_stage_id": 3,
  "salesperson_id": 27,
  "key_opportunity": true,
  "remark": "Hot lead — wants delivery before Diwali",
  "price": "INR 8,50,000",
  "customer_id": 14,
  "whatsapp_status": "connected"
}'
```

**Body fields (all optional unless noted):**
- `sender_name` — sometimes required, string, max 255
- `sender_mobile` (max 32), `sender_email` (email, max 255), `sender_company` (max 255), `sender_address` (max 1000), `sender_city`/`sender_state` (max 128), `sender_pincode` (max 32), `sender_country_iso` (max 8)
- `qualified` / `disqualified` — boolean (cannot both be true → 422)
- `lead_stage_id` — integer, between 1 and 6
- `salesperson_id` — integer, must exist in `users` and not be soft-deleted
- `key_opportunity` — boolean
- `remark` — string, max 5000
- `price` — string, max 64
- `lead_ack_reason_id` — integer, must exist in `lead_ack_reasons` with `status=active`
- `customer_id` (exists customers) / `consignee_id` (exists consignees) — integer
- `has_whatsapp` — boolean
- `whatsapp_status` — in: `connected`, `pending`, `not_connected`, `opted_out`
- `whatsapp_reason` — string, max 1000

---

### DELETE /api/sales/leads/{id}
**Action:** `SalesLeadController@destroy` — soft-deletes a lead. Tenant-scoped.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/leads/101' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/sales/leads/{id}/acknowledgements
**Action:** `SalesLeadController@listAcknowledgements` — Stage 2 activity log feed for a lead, newest-first.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/101/acknowledgements' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/leads/{id}/acknowledgements
**Action:** `SalesLeadController@storeAcknowledgements` — bulk-creates Stage 2 activity rows from picked master reasons. All reason_ids must share one `opportunity_type` (422 otherwise). Side effect: flips the lead's qualified/disqualified flags to match the submitted bucket.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/101/acknowledgements' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "reason_ids": [3, 4]
}'
```

**Body fields:**
- `reason_ids` — required, array, min 1; each integer (must all belong to caller's tenant and same opportunity_type)

---

### GET /api/sales/leads/{id}/products
**Action:** `SalesLeadController@listLeadProducts` — Stage 3 mapped products for a lead, joined with the product master (code, name, status, segment/category) plus latest `procurement_id` and sourcing flags.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/101/products' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/leads/{id}/products
**Action:** `SalesLeadController@storeLeadProduct` — maps a product master to the lead. Enforces unique (lead, product) and the single-currency-per-lead rule (first product sets the currency; later additions are pinned to it, default USD).
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/101/products' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "product_id": 58,
  "currency": "INR",
  "quantity": 1000,
  "target_price": 78.50,
  "notes": "Customer wants 1121 grade, 2% broken max"
}'
```

**Body fields:**
- `product_id` — required, integer, must exist in `products`
- `currency` — optional, string (free-form code: INR, USD, EUR…); must match the lead's locked currency if one exists
- `quantity` — optional, numeric, min 0
- `target_price` — optional, numeric, min 0
- `notes` — optional, string, max 1000

--- 

### PUT /api/sales/leads/{id}/products/{mapping}
**Action:** `SalesLeadController@updateLeadProduct` — edit quantity / target_price / currency / notes for a mapping. Product itself is immutable. Currency change must still satisfy the single-currency-per-lead rule.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id; `{mapping}` = lead_product id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/leads/101/products/210' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "currency": "INR",
  "quantity": 1200,
  "target_price": 77.00,
  "notes": "Quantity revised up to 1200 MT"
}'
```

**Body fields (all optional):**
- `currency` — string (leave null/empty to keep unchanged)
- `quantity` — numeric, min 0
- `target_price` — numeric, min 0
- `notes` — string, max 1000

---

### DELETE /api/sales/leads/{id}/products/{mapping}
**Action:** `SalesLeadController@destroyLeadProduct` — unmaps a product from the lead.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id; `{mapping}` = lead_product id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/leads/101/products/210' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PATCH /api/sales/leads/{id}/products/{mapping}/mark-sourced
**Action:** `SalesLeadController@markLeadProductSourced` — flips `procurement_done` true. Only valid on `sourcing_status=required` rows that already have a linked procurement (422 otherwise). Returns 409 if already marked sourced (idempotency gate).
**Auth:** Bearer token required
**Path params:** `{id}` = lead id; `{mapping}` = lead_product id
**Body:** none

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/sales/leads/101/products/210/mark-sourced' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/leads/{id}/products/{mapping}/shared-prices
**Action:** `SalesLeadController@storeSharedPrice` — Stage 4, append-only quoted-price entry for a product mapping. Blocked for draft/inactive/pending product masters (422).
**Auth:** Bearer token required
**Path params:** `{id}` = lead id; `{mapping}` = lead_product id

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/101/products/210/shared-prices' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "quoted_price": 79.25
}'
```

**Body fields:**
- `quoted_price` — required, numeric, greater than 0

---

### GET /api/sales/leads/{id}/products/{mapping}/shared-prices
**Action:** `SalesLeadController@listSharedPricesByProduct` — quoted-price history for one product mapping (newest-first) plus the product's currency/quantity/target_price.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id; `{mapping}` = lead_product id

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/101/products/210/shared-prices' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PATCH /api/sales/leads/{id}/products/{mapping}/sourcing-status
**Action:** `SalesLeadController@updateLeadProductSourcingStatus` — Stage 3 label: marks a mapping `required` or `not_required`. Inactive/draft products cannot be `not_required` (422). Flipping to not_required clears `procurement_done`.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id; `{mapping}` = lead_product id

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/sales/leads/101/products/210/sourcing-status' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "sourcing_status": "required"
}'
```

**Body fields:**
- `sourcing_status` — required, in: `required`, `not_required`

---

### GET /api/sales/leads/{id}/shared-prices
**Action:** `SalesLeadController@listSharedPrices` — flat quoted-price history across all products on the lead (newest-first), enriched with product code/name/status/category/currency.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/leads/101/shared-prices' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/leads/{id}/task-manager
**Action:** `SalesLeadController@storeTaskManager` — Stage 1 (Inquiry Received) upsert; one row per (client, lead). multipart/form-data so an optional supporting document rides along. Re-saves overwrite the prior file on disk.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id
**Content-Type:** multipart/form-data

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/101/task-manager' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'name=Rahul Sharma' \
  --form 'mobile_no=919876543210' \
  --form 'email=rahul.sharma@agriexports.in' \
  --form 'order_value=850000' \
  --form 'buying_plan=2026-08-15' \
  --form 'attachment=@/path/to/inquiry.pdf'
```

**Body fields:**
- `name` — required, string, max 255
- `mobile_no` — required, string, regex `^\d{6,15}$` (6–15 digits, no `+`)
- `email` — required, valid email, max 255
- `order_value` — optional, numeric, min 0
- `buying_plan` — optional, date `Y-m-d`
- `attachment` — optional, file, mimes jpg/jpeg/png/webp/pdf, max 5120 KB

---

### POST /api/sales/leads/{id}/whatsapp
**Action:** `SalesLeadController@updateWhatsApp` — updates WhatsApp status on the lead; multipart for the optional screenshot. `has_whatsapp` auto-set true iff status is `connected`. Prior screenshot unlinked when a new one is uploaded.
**Auth:** Bearer token required
**Path params:** `{id}` = lead id
**Content-Type:** multipart/form-data

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/leads/101/whatsapp' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'whatsapp_status=connected' \
  --form 'whatsapp_reason=Customer confirmed on WhatsApp' \
  --form 'screenshot=@/path/to/chat.png'
```

**Body fields:**
- `whatsapp_status` — required, in: `connected`, `pending`, `not_connected`, `opted_out`
- `whatsapp_reason` — optional, string, max 1000
- `screenshot` — optional, file, mimes jpg/jpeg/png/webp/pdf, max 5120 KB

---

### GET /api/sales/shared-prices/{id}/pdf
**Action:** `SalesLeadController@sharedPricePdf` — generates the dompdf quotation PDF for a shared-price entry (tenant-branded, Code-128 barcode `Q-#####`).
**Auth:** Bearer token required
**Path params:** `{id}` = shared-price entry id
**Query params:** `inline=1` streams in-browser; omit to download

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/shared-prices/15/pdf?inline=1' \
  --header 'Authorization: Bearer {{token}}' \
  --output quotation_00015.pdf
```

---

## LeadAckReasonController

### GET /api/sales/lead-ack-reasons
**Action:** `LeadAckReasonController@index` — returns the master reasons grouped into three buckets (`qualified`, `disqualified`, `clarity_pending`), each sorted by id. Users without a tenant get empty arrays.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/sales/lead-ack-reasons' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/sales/lead-ack-reasons
**Action:** `LeadAckReasonController@store` — creates a new acknowledgement reason for the caller's tenant. `dq_status` is required only when `opportunity_type=disqualified` (422 otherwise), and ignored for the other two types.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/sales/lead-ack-reasons' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "opportunity_type": "disqualified",
  "reason": "Target price below our floor for Basmati Rice",
  "status": "active",
  "dq_status": "negative"
}'
```

**Body fields:**
- `opportunity_type` — required, in: `qualified`, `disqualified`, `clarity_pending`
- `reason` — required, string, max 500
- `status` — optional, in: `active`, `inactive` (defaults to `active`)
- `dq_status` — optional, in: `positive`, `negative`; **required** when opportunity_type is `disqualified`

---

### PUT /api/sales/lead-ack-reasons/{id}
**Action:** `LeadAckReasonController@update` — edits reason/status/dq_status (also used by the "Mark Inactive" button). `opportunity_type` is immutable; `dq_status` is only applied to disqualified rows.
**Auth:** Bearer token required
**Path params:** `{id}` = lead ack reason id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/sales/lead-ack-reasons/3' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "reason": "Target price below our INR floor for Basmati Rice",
  "status": "inactive",
  "dq_status": "negative"
}'
```

**Body fields (all optional; empty/null fields are ignored):**
- `reason` — string, max 500
- `status` — in: `active`, `inactive`
- `dq_status` — in: `positive`, `negative` (applied only when the row is `disqualified`)

---

### DELETE /api/sales/lead-ack-reasons/{id}
**Action:** `LeadAckReasonController@destroy` — hard-deletes an acknowledgement reason (true cleanup; the UI trash icon normally marks inactive via PUT instead). Tenant-scoped.
**Auth:** Bearer token required
**Path params:** `{id}` = lead ack reason id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/sales/lead-ack-reasons/3' \
  --header 'Authorization: Bearer {{token}}'
```
