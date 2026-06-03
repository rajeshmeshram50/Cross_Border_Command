# Part 05 — Products, Vendors/Suppliers, Master Data (generic), Segment Uploads

> Base URL: `http://127.0.0.1:8000`
> All endpoints require `Authorization: Bearer {{token}}` (Sanctum) and pass through `auth:sanctum` + `user.active` middleware. All queries are tenant-scoped to the authenticated user's `client_id` / `branch_id` (creator-hierarchy via `MasterVisibility`); never send `client_id` in the body — it is derived server-side (only `super_admin` may pass `client_id`/`branch_id` to MasterController create).

---

## ProductController

Step-wise product wizard. Steps: **core → sales → quality → vendors**. Step 1 (core) creates the draft and returns an `id`; later steps target `/products/{id}/step/...`. `status` lifecycle: `draft` (after core) → `inactive` (after quality) → `active` (after vendors mapped). `product_code` auto-allocated as `P-01`, `P-02`, …

### GET /api/products
**Action:** `ProductController@index` — paginated product list, tenant-scoped, with masters + vendor maps + QC records eager-loaded.
**Auth:** Bearer token required
**Query params:** `status` (`active` | `inactive` — inactive bucket includes `draft`), `q` (search name / product_code / brand / generic_name), `vendor_id` (only products mapped to that vendor), `per_page` (default 24)

```bash
curl -X GET 'http://127.0.0.1:8000/api/products?status=active&q=Basmati&per_page=24' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/products/master-bundle
**Action:** `ProductController@masterBundle` — one-shot bundle of every dropdown the Add/Edit Product modal needs (segments, haz_class, uom, hsn_codes, conditions, packaging_material, gst_percentage, vendors). Cached 5 min per user; only `active` rows.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/products/master-bundle' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/products/owners
**Action:** `ProductController@owners` — users eligible to own a product (branch_user/employee), scoped to caller's branch tier. Returns `[]` for client/super admins.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/products/owners' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/products/stats
**Action:** `ProductController@stats` — header chip counts `{active, inactive, total}`.
**Auth:** Bearer token required
**Query params:** `vendor_id` (optional — narrows counts to one vendor's mapped products, mirrors index)

```bash
curl -X GET 'http://127.0.0.1:8000/api/products/stats' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/products/step/core
**Action:** `ProductController@storeCore` — create-or-update Core info (Step 1). Pass `id` to update an existing draft; omit to create. Supports image/file uploads → use multipart. On create it stamps `product_code`, `status=draft`, `step_completed=1`.
**Auth:** Bearer token required

Multipart (with images) example:

```bash
curl -X POST 'http://127.0.0.1:8000/api/products/step/core' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'name=Basmati Rice 1121' \
  --form 'generic_name=Long Grain Rice' \
  --form 'brand=IGC Gold' \
  --form 'segment_id=3' \
  --form 'haz_type=Non-Haz' \
  --form 'uom_id=5' \
  --form 'hsn_id=12' \
  --form 'condition_id=2' \
  --form 'packaging_material_id=4' \
  --form 'description=Premium aged 1121 basmati' \
  --form 'confidential_info=Internal sourcing notes' \
  --form 'primary_image_file=@C:/uploads/rice-front.jpg' \
  --form 'secondary_image_files[]=@C:/uploads/spec-sheet.pdf'
```

JSON (no new files) example:

```bash
curl -X POST 'http://127.0.0.1:8000/api/products/step/core' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "id": 41,
  "name": "Basmati Rice 1121",
  "brand": "IGC Gold",
  "segment_id": 3,
  "uom_id": 5,
  "hsn_id": 12,
  "primary_image": "products/images/abc__rice-front.jpg",
  "secondary_images": ["products/images/def__spec-sheet.pdf"]
}'
```

**Body fields:**
- `id` (optional, int — existing product to update; must exist in `products`)
- `name` (required, string ≤255)
- `generic_name` (optional, string ≤255)
- `description` (optional, string)
- `brand` (optional, string ≤255)
- `segment_id` (optional, int)
- `haz_type` (optional, string ≤20)
- `haz_class_id` (optional, int)
- `uom_id` (optional, int)
- `hsn_id` (optional, int)
- `condition_id` (optional, int)
- `packaging_material_id` (optional, int)
- `confidential_info` (optional, string)
- `primary_image` (optional, string ≤500 — existing path to keep; empty string clears)
- `primary_image_file` (optional, file — jpg,jpeg,png,pdf, max 2 MB — replaces primary)
- `secondary_images` (optional, array of strings ≤500 — existing paths to keep)
- `secondary_images.*` (optional, string ≤500)
- `secondary_image_files` (optional, array, max 10 files — appended)
- `secondary_image_files.*` (file — jpg,jpeg,png,pdf, max 2 MB)

### GET /api/products/{id}
**Action:** `ProductController@show` — full product with relations + inline `segment_uploads` (QC category).
**Auth:** Bearer token required
**Path params:** `{id}` = product id (numeric)

```bash
curl -X GET 'http://127.0.0.1:8000/api/products/41' \
  --header 'Authorization: Bearer {{token}}'
```

### DELETE /api/products/{id}
**Action:** `ProductController@destroy` — soft delete (hierarchical delete gate applies).
**Auth:** Bearer token required
**Path params:** `{id}` = product id (numeric)

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/products/41' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/products/{id}/step/sales
**Action:** `ProductController@storeSales` — Step 2 pricing. Sets `step_completed=2`.
**Auth:** Bearer token required
**Path params:** `{id}` = product id (numeric)

```bash
curl -X PUT 'http://127.0.0.1:8000/api/products/41/step/sales' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "base_price": 1200.00,
  "gst_id": 7,
  "gst_amount": 60.00,
  "total_price": 1260.00,
  "mark_bottom": "FOB"
}'
```

**Body fields:** (all optional)
- `base_price` (numeric ≥0)
- `gst_id` (int)
- `gst_amount` (numeric ≥0)
- `total_price` (numeric ≥0)
- `mark_bottom` (string ≤30)

### PUT /api/products/{id}/step/quality
**Action:** `ProductController@storeQuality` — Step 3 quality + inventory + full-sync QC records. Flips `draft` → `inactive`, sets `step_completed=3`. QC attachments → use multipart.
**Auth:** Bearer token required
**Path params:** `{id}` = product id (numeric)

```bash
curl -X PUT 'http://127.0.0.1:8000/api/products/41/step/quality' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'net_weight=25' \
  --form 'gross_weight=25.5' \
  --form 'length_cm=80' \
  --form 'width_cm=50' \
  --form 'height_cm=15' \
  --form 'batch_no=BATCH-2025-01' \
  --form 'lot_no=LOT-9' \
  --form 'qc_records[0][qc_name]=Moisture Test' \
  --form 'qc_records[0][qc_purpose]=Verify moisture <14%' \
  --form 'qc_records[0][issued_by]=Lab QA' \
  --form 'qc_records[0][qa_testing_parameter]=Moisture %' \
  --form 'qc_records[0][min_acceptance_criteria]=<= 14%' \
  --form 'qc_records[0][attachment_file]=@C:/uploads/moisture-report.pdf'
```

**Body fields:** (all optional unless noted)
- `net_weight`, `gross_weight`, `length_cm`, `width_cm`, `height_cm` (numeric ≥0)
- `batch_no`, `serial_no`, `cat_no`, `lot_no` (string ≤100)
- `qc_records` (array — full replace)
  - `qc_records.*.qc_name` (required when `qc_records` present, string ≤100)
  - `qc_records.*.qc_purpose` (string ≤255)
  - `qc_records.*.issued_by` (string ≤255)
  - `qc_records.*.qa_testing_parameter` (string)
  - `qc_records.*.min_acceptance_criteria` (string)
  - `qc_records.*.attachment_path` (string ≤500 — must start with `products/qc/` or it is dropped)
  - `qc_records.*.attachment_file` (file — jpg,jpeg,png,pdf, max 10 MB)

### PUT /api/products/{id}/step/vendors
**Action:** `ProductController@storeVendors` — Step 4 (final). Full-sync vendor mappings, mirrors to vendor side, activates product (`status=active`, `step_completed=4`) and auto-activates mapped vendors.
**Auth:** Bearer token required
**Path params:** `{id}` = product id (numeric)

```bash
curl -X PUT 'http://127.0.0.1:8000/api/products/41/step/vendors' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "vendors": [
    {
      "vendor_id": 8,
      "vendor_code": "V-08",
      "vendor_name": "ABC Exports Pvt Ltd",
      "vendor_website": "https://abcexports.com",
      "contact_person": "Ravi Sharma",
      "contact_no": "+91 9876543210",
      "email": "ravi@abcexports.com",
      "designation": "Procurement Head",
      "purchase_price": 1100.00,
      "gst_percentage": 5,
      "gst_amount": 55.00,
      "total_amount": 1155.00,
      "map_date": "2026-06-03",
      "remarks": "Primary supplier"
    }
  ]
}'
```

**Body fields:**
- `vendors` (required, array, min 1)
  - `vendors.*.vendor_id` (optional, int — must exist in `vendors`; required to mirror onto vendor side)
  - `vendors.*.vendor_code` (optional, string ≤50)
  - `vendors.*.vendor_name` (required, string ≤255)
  - `vendors.*.vendor_website` (optional, string ≤255)
  - `vendors.*.contact_person` (optional, string ≤255)
  - `vendors.*.contact_no` (optional, string ≤50)
  - `vendors.*.email` (optional, email ≤255)
  - `vendors.*.designation` (optional, string ≤100)
  - `vendors.*.attachment_path` (optional, string ≤500)
  - `vendors.*.purchase_price`, `gst_percentage`, `gst_amount`, `total_amount` (optional, numeric ≥0)
  - `vendors.*.map_date` (optional, date)
  - `vendors.*.remarks` (optional, string)

---

## VendorController

Step-wise supplier wizard. Steps: **identity → contacts → kyc → products**. Step 1 (identity) creates the draft and returns the vendor `id` inside `data`. `vendor_code` auto-allocated `V-01`, `V-02`, … `status` lifecycle: `draft` (identity) → `inactive` (after kyc) → `active` (after products mapped). Most responses wrap the vendor in `{ "data": {...} }`. (Stage 3 "Trade Document Management" is not persisted server-side.)

### GET /api/vendors
**Action:** `VendorController@index` — paginated supplier list, tenant-scoped, with primary address + type/segment/risk + product-mapping count.
**Auth:** Bearer token required
**Query params:** `q` (search company_name / legal_name / vendor_code / primary_email), `status` (e.g. `active` / `inactive` / `draft`), `per_page` (default 24)

```bash
curl -X GET 'http://127.0.0.1:8000/api/vendors?q=ABC%20Exports&status=active&per_page=24' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/vendors/master-bundle
**Action:** `VendorController@masterBundle` — one-shot bundle of vendor form dropdowns (vendor_types, risk_levels, vendor_behaviour, segments, compliance_behaviours, countries, state_codes, states, license_name, gst_percentage). Cached 5 min per user; only `active` rows.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/vendors/master-bundle' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/vendors/step/identity
**Action:** `VendorController@storeIdentity` — Step 1 create-or-update vendor identity. Pass `id` to update; omit to create (stamps `vendor_code`, `status=draft`, `step_completed=1`). `vendor_type` (a name string) is find-or-created into `master_vendor_types` and resolved to `vendor_type_id`.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/vendors/step/identity' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "company_name": "ABC Exports Pvt Ltd",
  "legal_name": "ABC Exports Private Limited",
  "website": "https://abcexports.com",
  "vendor_type": "Material",
  "risk_level_id": 2,
  "vendor_behaviour_id": 1,
  "segment_id": 3,
  "compliance_behaviour_id": 1
}'
```

**Body fields:**
- `id` (optional, int — existing vendor; must exist in `vendors`)
- `company_name` (required, string ≤255)
- `legal_name` (optional, string ≤255)
- `website` (optional, string ≤500)
- `vendor_type_id` (optional, int — must exist in `master_vendor_types`)
- `vendor_type` (optional, string ≤255 — supplier-type name; find-or-created, overrides `vendor_type_id`)
- `risk_level_id` (optional, int — exists `master_risk_levels`)
- `vendor_behaviour_id` (optional, int — exists `master_vendor_behaviour`)
- `segment_id` (optional, int — exists `clm_segments`)
- `compliance_behaviour_id` (optional, int — exists `master_compliance_behaviours`)

### GET /api/vendors/{id}
**Action:** `VendorController@show` — full vendor with all relations + inline `segment_uploads` (supplier).
**Auth:** Bearer token required
**Path params:** `{id}` = vendor id (numeric)

```bash
curl -X GET 'http://127.0.0.1:8000/api/vendors/8' \
  --header 'Authorization: Bearer {{token}}'
```

### DELETE /api/vendors/{id}
**Action:** `VendorController@destroy` — soft delete vendor + cleanup on-disk files (hierarchical delete gate applies).
**Auth:** Bearer token required
**Path params:** `{id}` = vendor id (numeric)

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/vendors/8' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/vendors/{id}/step/contacts
**Action:** `VendorController@storeContacts` — Step 1 contacts. Full-replace of `vendor_addresses` (primary + extras); mirrors primary email onto vendor.
**Auth:** Bearer token required
**Path params:** `{id}` = vendor id (numeric)

```bash
curl -X PUT 'http://127.0.0.1:8000/api/vendors/8/step/contacts' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "primary_address": {
    "address_line": "Plot 14, MIDC Industrial Area",
    "country_id": 1,
    "state_id": 21,
    "state_code": "MH",
    "city": "Pune",
    "pincode": "411001",
    "contact_name": "Ravi Sharma",
    "designation": "Procurement Head",
    "contact_no": "+91 9876543210",
    "email": "ravi@abcexports.com",
    "whatsapp_enabled": true
  },
  "extra_contacts": [
    {
      "contact_name": "Sneha Patil",
      "designation": "Accounts",
      "contact_no": "+91 9988776655",
      "email": "accounts@abcexports.com",
      "whatsapp_enabled": false
    }
  ]
}'
```

**Body fields:**
- `primary_address` (required, object)
  - `.address_line` (string ≤1000), `.country_id` (int, exists `master_countries`), `.state_id` (int, exists `master_states`), `.state_code` (string ≤32), `.city` (string ≤128), `.pincode` (string ≤16)
  - `.contact_name` (**required**, string ≤255)
  - `.designation` (string ≤128), `.contact_no` (string ≤32), `.email` (email ≤255), `.whatsapp_enabled` (boolean)
- `extra_contacts` (optional, array)
  - `.contact_name` (required, string ≤255)
  - `.designation` (string ≤128), `.contact_no` (string ≤32), `.email` (email ≤255), `.whatsapp_enabled` (boolean), `.attachment_path` (string ≤500)

### POST /api/vendors/{id}/step/kyc
**Action:** `VendorController@storeKyc` — Step 2 KYC/Due Diligence (multipart). Five full-replace sub-collections in one request, each with parallel file arrays. Flips `draft` → `inactive`, `step_completed=2`. Send kept-file references via each row's `existing_path`; new files via the `*_files[<index>]` slot.
**Auth:** Bearer token required
**Path params:** `{id}` = vendor id (numeric)

```bash
curl -X POST 'http://127.0.0.1:8000/api/vendors/8/step/kyc' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'due_diligence[0][code]=DD-01' \
  --form 'due_diligence[0][document_name]=Company Registration Certificate' \
  --form 'due_diligence[0][issuing_authority]=MCA' \
  --form 'due_diligence[0][expiry]=2027-12-31' \
  --form 'due_diligence[0][mandatory]=1' \
  --form 'dd_files[0]=@C:/uploads/incorporation.pdf' \
  --form 'owner_kyc[0][document_name]=Director PAN' \
  --form 'owner_kyc[0][document_number]=ABCDE1234F' \
  --form 'owner_kyc[0][status]=Active' \
  --form 'owner_files[0]=@C:/uploads/pan.pdf' \
  --form 'trade_licenses[0][license_type_id]=4' \
  --form 'trade_licenses[0][license_number]=IEC0987654321' \
  --form 'trade_licenses[0][issuing_authority]=DGFT' \
  --form 'tl_files[0]=@C:/uploads/iec.pdf' \
  --form 'bank_accounts[0][bank_name]=HDFC Bank' \
  --form 'bank_accounts[0][branch_name]=Pune MIDC' \
  --form 'bank_accounts[0][account_number]=50100123456789' \
  --form 'bank_accounts[0][ifsc]=HDFC0001234' \
  --form 'cheque_files[0]=@C:/uploads/cancelled-cheque.jpg' \
  --form 'gst_scrutiny[0][gst_number]=27ABCDE1234F1Z5' \
  --form 'gst_scrutiny[0][status]=Active'
```

**Body fields:** (all sub-collections optional arrays; full-replace on save)
- **Company Due Diligence** — `due_diligence[]`: `.document_name` (required, ≤255), `.code` (≤32), `.issuing_authority` (≤255), `.expiry` (≤32), `.mandatory` (boolean), `.existing_path` (≤500). Files: `dd_files[]` (jpg,jpeg,png,webp,pdf, max 2 MB)
- **Owner KYC** — `owner_kyc[]`: `.document_name` (required, ≤255), `.code` (≤32), `.issuing_authority` (≤255), `.document_number` (≤128), `.issue_date` (date), `.expiry` (≤32), `.status` (`Active`|`Inactive`), `.existing_path` (≤500). Files: `owner_files[]` (same mimes/size)
- **Trade Licenses** — `trade_licenses[]`: `.license_type_id` (int, exists `master_license_name`), `.code` (≤32), `.license_number` (≤128), `.issuing_authority` (≤255), `.issue_date` (date), `.expiry_date` (date), `.existing_path` (≤500). Files: `tl_files[]` (same mimes/size)
- **Bank Accounts** — `bank_accounts[]`: `.bank_name` (required, ≤255), `.branch_name` (required, ≤255), `.account_number` (required, ≤64), `.ifsc` (required, ≤16), `.branch_address` (≤500), `.existing_path` (≤500). Files: `cheque_files[]` (same mimes/size)
- **GST Scrutiny** — `gst_scrutiny[]`: `.gst_number` (required, ≤16), `.status` (`Active`|`Suspended`|`Cancelled`), `.last_filing_date` (date), `.prev_non_gst_2a_invoice` (≤255), `.red_flags` (≤2000)

### POST /api/vendors/{id}/step/products
**Action:** `VendorController@storeProducts` — Step 4 (final). Full-sync product mappings, mirror to product side, activate vendor (`status=active`, `step_completed=4`) and flip mapped products to active. Duplicate `product_id` in one payload → 422.
**Auth:** Bearer token required
**Path params:** `{id}` = vendor id (numeric)

```bash
curl -X POST 'http://127.0.0.1:8000/api/vendors/8/step/products' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "mappings": [
    {
      "product_id": 41,
      "batch_serial_lot": "LOT-9",
      "purchase_price": 1100.00,
      "gst_percentage": 5,
      "gst_amount": 55.00,
      "total_amount": 1155.00
    }
  ]
}'
```

**Body fields:**
- `mappings` (required, array, min 1)
  - `mappings.*.product_id` (required, int — exists in `products`; must be unique within payload)
  - `mappings.*.batch_serial_lot` (optional, string ≤128)
  - `mappings.*.purchase_price` (required, numeric ≥0)
  - `mappings.*.gst_percentage` (optional, numeric ≥0)
  - `mappings.*.gst_amount` (optional, numeric ≥0)
  - `mappings.*.total_amount` (optional, numeric ≥0 — defaults to purchase_price)

---

## MasterController

Generic schema-driven CRUD: a single set of routes dispatches ~50 master tables by `{slug}`. Body fields **vary per master** — they are declared per-master in the backend `SCHEMAS` map (and frontend `masterConfigs.ts`); the backend validates dynamically. Almost every master has a `status` enum (`Active` / `Inactive`). Permissions are enforced per slug via `master.{slug}` module (`can_view` / `can_add` / `can_edit` / `can_delete`); system-seeded rows (`is_system`) cannot be edited/deleted. Examples below use representative slugs: **`departments`**, **`countries`**, **`currencies`**.

Valid slugs include: `organization_types`, `company`, `bank_accounts`, `departments`, `roles`, `designations`, `kpis`, `legal_entities`, `countries`, `states`, `state_codes`, `address_types`, `port_of_loading`, `port_of_discharge`, `segments`, `hsn_codes`, `gst_percentage`, `currencies`, `uom`, `packaging_material`, `conditions`, `incoterms`, `customer_types`, `customer_classifications`, `vendor_types`, `vendor_behaviour`, `applicable_types`, `license_name`, `risk_levels`, `document_type`, `haz_class`, `compliance_behaviours`, `assets`, `asset_categories`, `expense_category`, `payment_terms`, `approval_authority`, `procurement_category`, `sourcing_type`, `deviation_reason`, `match_exception`, `advance_payment_rules`, `exchange_rate_log`, `goods_service_flag`, `vendor_directory`, `warehouse_master`, `zone_master`, `rack_type_master`, `temp_class_master`, `racks`, `shelf_master`, `digital_twin`, `freezers`, `leave_type`, `leave_plan`, `trigger_point`.

### GET /api/master-counts
**Action:** `MasterController@counts` — `{ slug: {active, inactive, total} }` map for every master the user can view. Powers the Master dashboard cards.
**Auth:** Bearer token required
**Query params:** `branch_id` (optional, int — branch filter)

```bash
curl -X GET 'http://127.0.0.1:8000/api/master-counts' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/master/{slug}
**Action:** `MasterController@list` — list rows for one master (tenant-scoped), with client/branch/creator names flattened in.
**Auth:** Bearer token required (`master.{slug}` `can_view`)
**Path params:** `{slug}` = master key (e.g. `departments`)
**Query params:** `search` (matches text/email/textarea/select fields), `country_id` (cascade filter for masters that have a `country_id` column, e.g. `states`), `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/master/departments?search=Finance' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/master/{slug}
**Action:** `MasterController@store` — create a row. Fields depend on the slug's schema; `client_id`/`branch_id`/`created_by` are stamped server-side (only `super_admin` may pass `client_id`/`branch_id`). File fields named `*_file` are stored and written to the matching `*_file_path` column. Some masters auto-generate a `code` (see `next-code`).
**Auth:** Bearer token required (`master.{slug}` `can_add`)
**Path params:** `{slug}` = master key

```bash
# departments (fields: name, code, parent_id, head, email, status)
curl -X POST 'http://127.0.0.1:8000/api/master/departments' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Procurement",
  "code": "DEPT-007",
  "email": "procurement@igc.com",
  "status": "Active"
}'

# countries (fields: name, iso_code, status)
curl -X POST 'http://127.0.0.1:8000/api/master/countries' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{ "name": "India", "iso_code": "IN", "status": "Active" }'

# currencies (fields: name, code, symbol, exchange_rate, status)
curl -X POST 'http://127.0.0.1:8000/api/master/currencies' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{ "name": "US Dollar", "code": "USD", "symbol": "$", "exchange_rate": 83.5, "status": "Active" }'
```

**Body fields:** Defined per-master by the backend `SCHEMAS` map (see `masterConfigs.ts` on the frontend). Each field has a name + type (`text` / `email` / `textarea` / `number` / `date` / `select`) + required flag. Common patterns: required `name`/`code`/`title`, required `status` select (`Active`/`Inactive`), `ref` fields are FK ids to another master (e.g. `country_id`, `state_id`, `department_id`). Uniqueness is enforced per-master (case-insensitive on most name/code fields).

### GET /api/master/{slug}/next-code
**Action:** `MasterController@nextCode` — next auto-generated prefixed code for masters that use one (`departments` → `DEPT-001`, `expense_category` → `EXC-01`). Returns `{code: null}` for masters without auto-codes.
**Auth:** Bearer token required (`master.{slug}` `can_view`)
**Path params:** `{slug}` = master key

```bash
curl -X GET 'http://127.0.0.1:8000/api/master/departments/next-code' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/master/{slug}/{id}
**Action:** `MasterController@show` — single master row (tenant-scoped) with ownership fields flattened.
**Auth:** Bearer token required (`master.{slug}` `can_view`)
**Path params:** `{slug}` = master key, `{id}` = row id

```bash
curl -X GET 'http://127.0.0.1:8000/api/master/departments/12' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/master/{slug}/{id}
**Action:** `MasterController@update` — update a row. Same dynamic per-slug validation as store. Blocked (403) for system-seeded rows and for users below the row's creator in the hierarchy.
**Auth:** Bearer token required (`master.{slug}` `can_edit`)
**Path params:** `{slug}` = master key, `{id}` = row id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/master/departments/12' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Procurement & Sourcing",
  "code": "DEPT-007",
  "status": "Active"
}'
```

**Body fields:** Same per-master schema as `POST /api/master/{slug}`.

### DELETE /api/master/{slug}/{id}
**Action:** `MasterController@destroy` — soft delete a row. Blocked (403) for system-seeded rows (e.g. seeded `customer_types`, `risk_levels`, `asset_categories`, `address_types`, `customer_classifications`) and by the hierarchical delete gate.
**Auth:** Bearer token required (`master.{slug}` `can_delete`)
**Path params:** `{slug}` = master key, `{id}` = row id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/master/departments/12' \
  --header 'Authorization: Bearer {{token}}'
```

---

## SegmentDocUploadController

Polymorphic segment-rule document uploads (KYC/DD/TL/TD/QC) for a party entity. `{type}` ∈ `customer` | `consignee` | `supplier` (alias `vendor`) | `product`; `{id}` = that entity's id (must belong to caller's tenant). The `(entity, category, doc_code)` tuple is unique — re-uploading the same tuple replaces the previous file. Categories: `kyc`, `dd`, `tl`, `td`, `qc`.

### GET /api/segment-uploads/{type}/{id}
**Action:** `SegmentDocUploadController@index` — list uploads for an entity, plus a `by_category` bucketed map and `count`.
**Auth:** Bearer token required
**Path params:** `{type}` = party type, `{id}` = entity id (numeric)
**Query params:** `category` (optional — `kyc`|`dd`|`tl`|`td`|`qc`)

```bash
curl -X GET 'http://127.0.0.1:8000/api/segment-uploads/supplier/8?category=kyc' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/segment-uploads/{type}/{id}
**Action:** `SegmentDocUploadController@store` — upload/replace a single reference document (multipart). Replace semantics on matching `(category, doc_code)`. Returns 201 on insert, 200 on replace. (For a `consignee` flagged `same_as_customer`, writes return 409 — manage uploads on the linked customer.)
**Auth:** Bearer token required
**Path params:** `{type}` = party type, `{id}` = entity id (numeric)

```bash
curl -X POST 'http://127.0.0.1:8000/api/segment-uploads/supplier/8' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'category=kyc' \
  --form 'doc_code=KYC-PAN' \
  --form 'doc_name=Director PAN Card' \
  --form 'requirement=M' \
  --form 'attachment=@C:/uploads/pan.pdf'
```

**Body fields:**
- `category` (required — one of `kyc`,`dd`,`tl`,`td`,`qc`)
- `doc_code` (required, string ≤32)
- `doc_name` (required, string ≤255)
- `requirement` (optional — `M` mandatory | `O` optional; defaults `O`)
- `attachment` (required, file — pdf,jpg,jpeg,png,doc,docx, max 2 MB)

### GET /api/segment-uploads/{type}/{id}/summary
**Action:** `SegmentDocUploadController@summary` — KPI roll-up `{total, mandatory, optional, by_category{...}}`.
**Auth:** Bearer token required
**Path params:** `{type}` = party type, `{id}` = entity id (numeric)

```bash
curl -X GET 'http://127.0.0.1:8000/api/segment-uploads/supplier/8/summary' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/segment-uploads/{type}/{id}/vault
**Action:** `SegmentDocUploadController@vault` — Evidence Vault payload: merges the entity's segment rules' expected docs with actual uploads; each doc marked `Verified` (uploaded) or `Pending`. Returns per-bucket arrays (company_dd, owner_kyc, trade_licenses, trade_documents) and counts.
**Auth:** Bearer token required
**Path params:** `{type}` = party type, `{id}` = entity id (numeric)

```bash
curl -X GET 'http://127.0.0.1:8000/api/segment-uploads/supplier/8/vault' \
  --header 'Authorization: Bearer {{token}}'
```

### DELETE /api/segment-uploads/{type}/{id}/{uploadId}
**Action:** `SegmentDocUploadController@destroy` — remove one upload (deletes the on-disk file).
**Auth:** Bearer token required
**Path params:** `{type}` = party type, `{id}` = entity id (numeric), `{uploadId}` = upload row id (numeric)

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/segment-uploads/supplier/8/57' \
  --header 'Authorization: Bearer {{token}}'
```

---

## DummyItemController

Simple `apiResource` (registered via `Route::apiResource('dummy-items', ...)`) — scaffold/diagnostic CRUD, no tenant scoping. Route-model binding param is `{dummy_item}`.

### GET /api/dummy-items
**Action:** `DummyItemController@index` — list all dummy items.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/dummy-items' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/dummy-items
**Action:** `DummyItemController@store` — create a dummy item. Returns 201.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/dummy-items' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Sample Item",
  "description": "A throwaway test record"
}'
```

**Body fields:**
- `name` (required, string ≤255)
- `description` (optional, string)

### GET /api/dummy-items/{dummy_item}
**Action:** `DummyItemController@show` — fetch one dummy item.
**Auth:** Bearer token required
**Path params:** `{dummy_item}` = dummy item id

```bash
curl -X GET 'http://127.0.0.1:8000/api/dummy-items/3' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/dummy-items/{dummy_item}
**Action:** `DummyItemController@update` — update a dummy item.
**Auth:** Bearer token required
**Path params:** `{dummy_item}` = dummy item id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/dummy-items/3' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Updated Item",
  "description": "Edited description"
}'
```

**Body fields:**
- `name` (optional but required-if-present, `sometimes|required`, string ≤255)
- `description` (optional, string)

### DELETE /api/dummy-items/{dummy_item}
**Action:** `DummyItemController@destroy` — delete a dummy item. Returns 204 (no content).
**Auth:** Bearer token required
**Path params:** `{dummy_item}` = dummy item id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/dummy-items/3' \
  --header 'Authorization: Bearer {{token}}'
```
