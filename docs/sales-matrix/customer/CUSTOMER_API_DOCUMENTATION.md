# CUSTOMER MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Customer (buyer entity)
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS

**What a Customer is** — a buyer entity in the Sales Matrix, owning addresses (1 primary + N locations), KYC documents (`dd`/`tl`), owners, GST-scrutiny rows and consignees. Every record is tenant-scoped (`client_id`/`branch_id`).

**Auth & access** — all routes sit behind `auth:sanctum` + `user.active`. Reads are tenant-scoped server-side (`Customer::forUser`); the Axios client injects `?branch_id` on GETs; mutations pass `MasterVisibility::hierarchicalDenial`. `client_id`/`branch_id` come from the token, never the body.

**Response envelope** — no uniform wrapper. `index` → `{ tab, count, data[] }`; `show` → `{ data, documents[], owners[], segment_uploads{}, gst_scrutiny[] }`; `store`/`update` → `{ data }`; `destroy` → `{ message }`; GST `index` → `[…]`; `master-bundle`/`vault` → object.

**Status codes** — `200`/`201` success · `401` unauth · `403` inactive or hierarchical denial · `404` not found / out of scope · `422` validation (`{ message, errors }`).

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/customers/master-bundle` | Form dropdown data (cached 5 min/user) |
| 2 | GET | `/customers` | List (tabs + prioritized search) |
| 3 | POST | `/customers` | Create (+ addresses) |
| 4 | GET | `/customers/{customer}` | Full detail (docs, owners, segment uploads, GST) |
| 5 | PUT/PATCH | `/customers/{customer}` | Update (+ address replace + consignee mirror) |
| 6 | DELETE | `/customers/{customer}` | Soft-delete |
| 7–10 | GET/POST/PUT/DELETE | `/customers/{customer}/gst-scrutiny[/{gst}]` | GST-scrutiny CRUD |
| 11–15 | GET/POST/PUT/DELETE | `/customers/{customer}/documents[/{document}]` | Ad-hoc KYC documents (`dd`/`tl`) |
| 16–20 | GET/POST/PUT/DELETE | `/customers/{customer}/owners[/{owner}]` | Ad-hoc owner KYC |
| 21–23 | GET/POST | `/segment-uploads/{type}/{id}[/vault]` | Segment-rule uploads + Evidence Vault |
| 24–26 | GET/POST | `/clm/signature-requests[/{id}][/send\|/remind]` | Trade-document e-signatures (Zoho) |

> `/customers/master-bundle` is registered **before** `apiResource('customers')` so the literal path wins. #21–26 are on `SegmentDocUploadController`/`ClmSignatureController` (not `CustomerController`) but are core to KYC & the Evidence Vault.

---

## 3. CORE CUSTOMER ENDPOINTS

### 3.1 GET `/customers`
| Param | Notes |
|---|---|
| `tab` | `fresh` (no leads) / `recurring` (≥1 lead) / `all` |
| `q`/`search` | priority: exact `customer_code` → `primary_email` prefix → company/legal/segment/type `ilike` → address fields |
| `page`/`per_page` | optional; default returns all; `per_page` ≤ 200 |
| `branch_id` | injected by the Branch Switcher |

```json
{ "tab": "fresh", "count": 2, "data": [ {
  "id": "C-0001", "db_id": 1, "company": "Acme Corp", "legalName": "Acme Corporation Ltd",
  "type": "Retailer", "segment": "Dairy, Fruits", "classification": "Premium", "riskLevel": "Low",
  "gstApplicable": "Yes", "status": "Active", "country": "India", "city": "Mumbai", "pin": "400001",
  "contact": "John Doe", "phone": "+91-9876543210", "email": "john@acme.com", "whatsapp": "Yes",
  "consignees": 2, "hasSameAsCustomerConsignees": true,
  "locations": [ … ], "primary_address": { … } } ] }
```

### 3.2 GET `/customers/master-bundle`
Cached per-user 5 min; each list `MasterVisibility`-scoped, active only; states keyed by `country_id`.
```json
{ "customer_types": [{"id":1,"name":"Retailer"}], "segments": [{"id":1,"name":"Dairy","code":"DAIRY"}],
  "customer_classifications": [ … ], "risk_levels": [ … ], "address_types": [{"id":1,"name":"Registered Office"}],
  "countries": [{"id":1,"name":"India"}], "states": [{"id":1,"name":"Maharashtra","country_id":1}],
  "designations": [ … ], "document_type": [{"id":1,"title":"Certificate of Incorporation"}] }
```

### 3.3 POST `/customers`
Creates a customer + primary address (+ optional `locations[]`) in one `DB::transaction`. JSON or multipart. **Pre-processing:** GST/PAN uppercased, emails lowercased, phones digit-normalized.

**Key rules**
```
company_name*   2..30            legal_name   2..100  unique/tenant (case-insensitive)
type            master value     segment      <=1024  comma-separated
gst_applicable* Yes|No           website url · status Active|Inactive
primary_address (required): address_line* 4..75 · pin ^\d{6}$ · cp_name* 1..60
  cp_contact ^\+?[0-9\s-]{7,15}$ (unique/tenant, primary) · cp_email (unique/tenant, primary) · cp_whatsapp yes|no
locations[]: same shape; email/phone must not repeat within the customer (errors keyed locations.{i}.cp_email/.cp_contact)
```
**Behaviour:** `customer_code` auto `C-####` per client under a `clients` row lock (`withTrashed()`, never reused); one address `is_primary=true`; its `cp_email` mirrors to `customers.primary_email`.

**201** → `{ "data": { "id": "C-0001", "db_id": 1, … } }` · **422** on validation.

### 3.4 GET `/customers/{customer}`
Full detail for the edit modal — bundles the customer + its documents, owners, segment_uploads and GST rows.
```json
{ "data": { "id": "C-0001", "db_id": 1, … },
  "documents": [ { "id":1, "kind":"dd", "name":"Certificate of Incorporation", "issuing_authority":"MCA",
                   "issue_date":"2020-01-15", "expiry_date":"2030-01-15",
                   "attachment_url":"/storage/customer_documents/1/doc-abc.pdf", "status":"Active" } ],
  "owners": [ { "id":1, "owner_name":"Alice Smith", "designation":"Director",
                "id_proof_url":"…", "address_proof_url":"…", "photograph_url":"…", "status":"Active" } ],
  "segment_uploads": { "data":[…], "by_category":{…}, "count":3 },
  "gst_scrutiny": [ { "id":1, "gst_number":"27AADCI6120M1ZH", "status":"Active",
                      "last_filing_date":"2025-12-31", "prev_non_gst_2a_invoice":null, "red_flags":null } ] }
```
**404** if unknown / out of scope.

### 3.5 PUT/PATCH `/customers/{customer}`
Updates fields, **replaces the whole address set** (delete-all + recreate, IDs not preserved), guards segment removal, then syncs mirror consignees. `DB::transaction`. Same rules as create, uniqueness `->ignore(id)`.
- `SegmentGuard::blockedRemovals()` → **422** if a removed segment has uploaded docs.
- `ConsigneeKycMirror::syncCoreFromCustomer()` propagates core fields + addresses to "Same as Customer" consignees (failure logged, not fatal).

**200** → `{ "data": { … } }` · **403** denied · **404** · **422**.

### 3.6 DELETE `/customers/{customer}`
Soft-delete (after `hierarchicalDenial`) — recoverable. **200** → `{ "message": "Customer deleted successfully" }` · **403** · **404**.

---

## 4. GST SCRUTINY — `/customers/{customer}/gst-scrutiny`
**Validation (`validateGst`):** `gst_number` uppercased, regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` (e.g. `27AADCI6120M1ZH`), **cross-customer unique** (`customer_id != {id}`, `deleted_at IS NULL`) → *"already registered to another customer."* `status` in `Active,Inactive`; `last_filing_date` date; `prev_non_gst_2a_invoice` ≤255; `red_flags` ≤2000.

| Method | Path | Success |
|---|---|---|
| GET | `/…/gst-scrutiny` | `200` `[ …rows ]` |
| POST | `/…/gst-scrutiny` | `201 { data }` |
| PUT | `/…/gst-scrutiny/{gst}` | `200 { data }` |
| DELETE | `/…/gst-scrutiny/{gst}` | `200 { message }` (force-delete) |

Shaped row: `{ id, gst_number, status, last_filing_date, prev_non_gst_2a_invoice, red_flags }`.

---

## 5. DOCUMENTS — `/customers/{customer}/documents`  (ad-hoc store)
`kind` = `dd` (Due Diligence) / `tl` (Trade Licence). Any create/update/delete re-mirrors KYC to same-as-customer consignees.

| Method | Path | Notes |
|---|---|---|
| GET | `/…/documents?kind=dd\|tl&search=` | list (search name/license/authority) |
| POST | `/…/documents` | multipart; `kind*`, `name*`, `license_number`, `issuing_authority`, `issue_date`, `expiry_date` (≥ issue), `attachment` ≤2MB (jpg/png/pdf/doc/docx), `description` |
| GET | `/…/documents/{document}` | single |
| PUT | `/…/documents/{document}` | update meta + attachment; `remove_attachment` flag |
| DELETE | `/…/documents/{document}` | deletes row + file |

**201** → `{ "data": { "id":1, "kind":"dd", "attachment_url":"…" } }`.

---

## 6. OWNERS — `/customers/{customer}/owners`  (ad-hoc store)
| Method | Path | Notes |
|---|---|---|
| GET | `/…/owners` | list |
| POST | `/…/owners` | multipart; `owner_name*`, `designation`, `official_email`, `phone_number` (`^\+?[0-9\s-]{7,15}$`), `id_proof`/`address_proof` ≤2MB (doc/img/pdf), `photograph` ≤2MB (img only) |
| GET | `/…/owners/{owner}` | single |
| PUT | `/…/owners/{owner}` | update + `remove_id_proof`/`remove_address_proof`/`remove_photograph` flags |
| DELETE | `/…/owners/{owner}` | deletes row + all proof files |

> `/documents` + `/owners` are the **ad-hoc** store — separate from the **segment uploads** (§7) that back the Evidence Vault.

---

## 7. SEGMENT UPLOADS & EVIDENCE VAULT — `/segment-uploads/{type}/{id}`
`{type}` ∈ `customer`/`consignee`/`supplier`/`vendor`/`product`. Segment-rule-driven store (`segment_doc_uploads`).

| Method | Path | Notes |
|---|---|---|
| GET | `/segment-uploads/{type}/{id}[?category=kyc\|dd\|tl\|td\|qc]` | `{ data[], by_category{}, count }` |
| POST | `/segment-uploads/{type}/{id}` | multipart: `category*`, `doc_code*` (≤32, e.g. `DD-001`), `doc_name*`, `requirement` (M/O), `attachment*` (pdf/jpg/png ≤2MB) |
| GET | `/segment-uploads/{type}/{id}/vault` | Evidence-Vault read model |

Unique per `(uploadable_type, uploadable_id, category, doc_code)` — a repeat replaces the file; `doc_name`/`requirement` snapshotted.

**`…/vault` → 200**
```json
{ "data": {
  "same_as_customer": false, "total_documents": 22, "verified_signed": 18, "pending": 2,
  "core_total_documents": 15, "core_verified_signed": 14,
  "company_dd": [ { "name":"Certificate of Incorporation", "reference":"DD-001", "authority":"ROC",
                    "expiry":"—", "attachment_url":"…", "status":"Verified", "requirement":"M", "doc_code":"DD-001" } ],
  "owner_kyc": [ … ], "trade_licenses": [ … ],
  "trade_documents": [ { "…segment td merged with Zoho…":"…", "status":"Signed", "certificate_url":"…" } ],
  "shipment_agreements": [ { "shipment_id":"SHP-2026-00487", "opportunity_id":"OPP-107",
                             "due_dil":{"ratio":"2/2","pct":100}, "kyc":{…}, "risk":"Compliant" } ],
  "last_updated": "04/05/2026" } }
```
> **`status` is derived** — `Verified` = a file exists for that code, `Pending` = it doesn't, `Signed` = a completed Zoho request. **No stored verification.** A `same_as_customer` consignee returns the **parent customer's** documents; uploads to it return **409**.

---

## 8. TRADE-DOCUMENT SIGNATURES — `/clm/signature-requests`
| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/signature-requests?party_id=&model_name=Customer&lead_id=&document_type=&status=&sync=0\|1` | list/poll (`sync=1` refreshes from Zoho) |
| GET | `/clm/signature-requests/{id}` | one request + per-signer activity |
| POST | `/clm/signature-requests/send` | create + send (trade docs OR agreements) |
| POST | `/clm/signature-requests/{id}/remind` | send a reminder |

Statuses: `draft` → `inprogress` → `completed`/`declined`/`recalled`/`superseded`. Completed requests expose `signed_document_url` / `signed_document_paths[]` / `certificate_url`.

---

## 9. RELATED ENDPOINTS (used by the Customer UI)
| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/segment-rules/for-segment/{segmentId}` | required/optional docs for a segment (Stage-2 tables) |
| GET | `/clm/trade-doc-library/for-party/buyer` | trade-doc library for party = Buyer |
| GET | `/consignees?customer_id={db_id}` | a customer's consignees (Map Consignee) |

---

## 10. ERRORS & TYPICAL FLOW

**422** `{ "message": "…", "errors": { "company_name": ["required"], "gst_number": ["already registered to another customer."] } }` · **403** `{ "message": "You are not allowed to edit this customer." }` · **404** `{ "message": "No query results for model [App\\Models\\Customer] 999" }`

```
GET  /customers/master-bundle              # dropdowns
POST /customers                            # create + primary address (201)
GET  /customers?tab=fresh&q=acme           # list
GET  /customers/{id}                       # detail (docs, owners, gst)
POST /customers/{id}/gst-scrutiny          # add GSTIN (cross-customer unique)
POST /customers/{id}/documents (kind=dd)   # KYC doc     ·  POST /customers/{id}/owners  # owner KYC
GET  /segment-uploads/customer/{id}/vault  # Evidence Vault
PUT  /customers/{id}   ·  DELETE /customers/{id}          # edit (replaces addresses) · soft-delete
```

**Security notes:** server-side tenant scoping on every read (`forUser`) + `hierarchicalDenial` on writes · GSTIN uniqueness is cross-customer (one GSTIN ↔ one customer) · address edits replace the set (IDs not preserved) · Evidence-Vault "Verified" is display-only · uploads ≤2MB on the public disk (old files deleted on replace/destroy).

---

*Related documents: CUSTOMER_TECHNICAL_DOCUMENTATION.md · CUSTOMER_FUNCTIONAL_DOCUMENTATION.md · CUSTOMER_CODE_WALKTHROUGH.md*
