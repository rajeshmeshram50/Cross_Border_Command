# CUSTOMER MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Customer (buyer entity)
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS

### 1.1 What a "Customer" is
A **Customer** is a buyer entity in the Sales Matrix. It owns addresses (one primary + N locations), KYC documents (`dd` / `tl`), owners, GST-scrutiny rows and consignees. Every record is tenant-scoped (`client_id` / `branch_id`).

### 1.2 Authentication & access
All endpoints sit behind `auth:sanctum` + `user.active` (`EnsureUserActive`). Send:
```
Authorization: Bearer <token>
Accept: application/json
```
Reads are **tenant-scoped server-side** (`Customer::forUser`); the Axios client injects `?branch_id` on GETs. Mutations pass `MasterVisibility::hierarchicalDenial` (edit/delete).

### 1.3 Response envelope
No uniform API-Resource envelope. Shapes:

| Endpoint | Success shape | Status |
|---|---|---|
| `index` | `{ tab, count, data[] }` (+ `page`/`per_page` when paginated) | 200 |
| `show` | `{ data, documents[], owners[], segment_uploads{}, gst_scrutiny[] }` | 200 |
| `store` | `{ data }` | **201** |
| `update` | `{ data }` | 200 |
| `destroy` | `{ message }` | 200 |
| GST `index` | `[ … ]` (array of GST rows) | 200 |
| GST `store`/`update` | `{ data }` (shaped GST row) | 201 / 200 |
| GST `destroy` | `{ message }` | 200 |
| `master-bundle` | `{ customer_types, segments, … }` | 200 |

### 1.4 Status codes
| Code | Meaning |
|---|---|
| 200 / 201 | Success (201 on create) |
| 401 | Not authenticated |
| 403 | User inactive, or not permitted (hierarchical denial) |
| 404 | Customer / GST row not found (or out of tenant scope) |
| 422 | Validation failure (`{ message, errors:{…} }`) |

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/customers/master-bundle` | Dropdown data for the form |
| 2 | GET | `/customers` | Tenant-scoped list (tabs + search) |
| 3 | POST | `/customers` | Create customer (+ addresses) |
| 4 | GET | `/customers/{customer}` | Full detail (docs, owners, segment uploads, GST) |
| 5 | PUT/PATCH | `/customers/{customer}` | Update customer (+ address replace + mirror) |
| 6 | DELETE | `/customers/{customer}` | Soft-delete customer |
| 7 | GET | `/customers/{customer}/gst-scrutiny` | List GST-scrutiny rows |
| 8 | POST | `/customers/{customer}/gst-scrutiny` | Add GST-scrutiny row |
| 9 | PUT | `/customers/{customer}/gst-scrutiny/{gst}` | Update GST-scrutiny row |
| 10 | DELETE | `/customers/{customer}/gst-scrutiny/{gst}` | Delete (force) GST-scrutiny row |
| 11 | GET/POST | `/customers/{customer}/documents[/{document}]` | Ad-hoc KYC documents CRUD (`dd`/`tl`) |
| 12 | GET/POST | `/customers/{customer}/owners[/{owner}]` | Ad-hoc owner KYC CRUD |
| 13 | GET/POST | `/segment-uploads/{type}/{id}` | Segment-rule document uploads (polymorphic) |
| 14 | GET | `/segment-uploads/{type}/{id}/vault` | Evidence-Vault read model |
| 15 | GET/POST | `/clm/signature-requests[/{id}][/remind\|/send]` | Trade-document e-signatures (Zoho) |

> `/customers/master-bundle` is registered **before** `apiResource('customers')` so the literal path wins over `{customer}`. Endpoints 13–15 are on `SegmentDocUploadController` / `ClmSignatureController` (see §3.10–3.11), not `CustomerController`, but are core to the customer's KYC & Evidence Vault.

---

## 3. ENDPOINT DETAIL

### 3.1 GET `/customers`
Tenant-scoped list with tabs and prioritized search.

**Query params**
| Param | Type | Notes |
|---|---|---|
| `tab` | string | `fresh` (no leads) / `recurring` (≥1 lead) / `all` |
| `q` / `search` | string | priority: exact `customer_code` → `primary_email` prefix → company/legal/segment/type `ilike` → primary-address fields |
| `page` / `per_page` | int | pagination optional; default returns all; `per_page` ≤ 200 (default 50 when paginating) |
| `branch_id` | int | injected by the Branch Switcher on GETs |

**Response 200**
```json
{
  "tab": "fresh",
  "count": 2,
  "data": [
    {
      "id": "C-0001", "db_id": 1, "company": "Acme Corp",
      "legalName": "Acme Corporation Ltd", "type": "Retailer",
      "segment": "Dairy, Fruits", "classification": "Premium",
      "riskLevel": "Low", "gstApplicable": "Yes", "website": "https://acme.com",
      "status": "Active", "country": "India", "state": "Maharashtra",
      "city": "Mumbai", "pin": "400001", "addr": "123 Business Park",
      "addrType": "Registered Office", "contact": "John Doe",
      "cpDesig": "Manager", "phone": "+91-9876543210", "email": "john@acme.com",
      "whatsapp": "Yes", "consignees": 2,
      "hasSameAsCustomerConsignees": true, "sameAsCustomerConsigneeCount": 1,
      "locations": [ { "…secondary addresses…": "…" } ],
      "primary_address": { "…": "…" }
    }
  ]
}
```

---

### 3.2 GET `/customers/master-bundle`
One-shot dropdown data (cached per-user 5 min; each list scoped by `MasterVisibility`, active only). States are included keyed by `country_id`.

**Response 200**
```json
{
  "customer_types":            [ { "id": 1, "name": "Retailer" } ],
  "segments":                  [ { "id": 1, "name": "Dairy", "code": "DAIRY" } ],
  "customer_classifications":  [ { "id": 1, "name": "Premium" } ],
  "risk_levels":               [ { "id": 1, "name": "Low" } ],
  "address_types":             [ { "id": 1, "name": "Registered Office" } ],
  "countries":                 [ { "id": 1, "name": "India" } ],
  "states":                    [ { "id": 1, "name": "Maharashtra", "country_id": 1 } ],
  "designations":              [ { "id": 1, "name": "Manager" } ],
  "document_type":             [ { "id": 1, "title": "Certificate of Incorporation" } ]
}
```

---

### 3.3 POST `/customers`
Creates a customer + its primary address (+ optional locations) in one `DB::transaction`.

**Content type:** `application/json` (or `multipart/form-data`).

**Pre-processing:** GST/PAN uppercased; emails lowercased+trimmed; phones digit-normalized (validation-time).

**Request body (key rules)**
```
company_name*        string(2..30)
legal_name           string(2..100)   unique per tenant (case-insensitive)
type                 string           Customer Type
segment              string(<=1024)   comma-separated multi-select
classification / risk_level           master values
gst_applicable*      in:Yes,No
website              url
status               Active | Inactive
# primary address (required)
primary_address.type            string  (locked "Registered Office" in UI)
primary_address.address_line*   string(4..75)
primary_address.country/state/city
primary_address.pin             regex ^\d{6}$
primary_address.cp_name*        string(1..60)
primary_address.cp_designation  string
primary_address.cp_contact      regex ^\+?[0-9\s-]{7,15}$   unique per tenant (primary)
primary_address.cp_email        email                       unique per tenant (primary)
primary_address.cp_whatsapp     yes | no
# additional locations[] — same shape; emails/phones unique within the customer
locations[i].*
```

**Behaviour**
- `customer_code` auto-allocated `C-####` **per client**, under a `clients` row lock (`withTrashed()` so codes never reuse).
- Exactly one address stored `is_primary = true`; its `cp_email` mirrored onto `customers.primary_email`.
- No email/phone may repeat across the customer's address bundle (errors keyed `locations.{i}.cp_email` / `.cp_contact`).

**Response 201**
```json
{ "data": { "id": "C-0001", "db_id": 1, "company": "Acme Corp", "…": "…" } }
```
**Errors:** 422 (validation).

---

### 3.4 GET `/customers/{customer}`
Full detail for the edit/detail modal.

**Response 200**
```json
{
  "data":     { "id": "C-0001", "db_id": 1, "company": "Acme Corp", "…": "…" },
  "documents": [
    { "id": 1, "kind": "dd", "name": "Certificate of Incorporation",
      "license_number": null, "issuing_authority": "MCA",
      "issue_date": "2020-01-15", "expiry_date": "2030-01-15",
      "attachment_path": "customer_documents/1/doc-abc.pdf",
      "attachment_url": "/storage/customer_documents/1/doc-abc.pdf",
      "status": "Active" }
  ],
  "owners": [
    { "id": 1, "owner_name": "Alice Smith", "designation": "Director",
      "official_email": "alice@acme.com", "phone_number": "+91-9876543200",
      "id_proof_url": "…", "address_proof_url": "…", "photograph_url": "…",
      "status": "Active" }
  ],
  "segment_uploads": { "data": [ … ], "by_category": { … }, "count": 3 },
  "gst_scrutiny": [
    { "id": 1, "gst_number": "27AADCI6120M1ZH", "status": "Active",
      "last_filing_date": "2025-12-31", "prev_non_gst_2a_invoice": null, "red_flags": null }
  ]
}
```
**Errors:** 404 (unknown / out of tenant scope).

---

### 3.5 PUT/PATCH `/customers/{customer}`
Updates fields, **replaces the whole address set**, guards segment removal, then syncs "Same as Customer" consignees. `DB::transaction`.

**Validation:** same rules as create; uniqueness `->ignore($customer->id)`.

**Behaviour**
- Address strategy = **delete-all + recreate** from the payload.
- `SegmentGuard::blockedRemovals()` → 422 if a removed segment already has uploaded documents.
- `ConsigneeKycMirror::syncCoreFromCustomer()` propagates core fields + address book to same-as-customer consignees (failure logged, not fatal).

**Response 200**
```json
{ "data": { "id": "C-0001", "db_id": 1, "company": "Acme Corp", "status": "Active", "…": "…" } }
```
**Errors:** 403 (denied) · 404 · 422.

---

### 3.6 DELETE `/customers/{customer}`
Soft-deletes the customer (after `hierarchicalDenial`). Cascade addresses/documents/owners follow the FK on hard delete; soft-delete keeps them recoverable.

**Response 200** — `{ "message": "Customer deleted successfully" }` · **Errors:** 403 · 404.

---

### 3.7 GST Scrutiny — `/customers/{customer}/gst-scrutiny`

**Shared validation (`validateGst`)**
- `gst_number` — uppercased, regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` (e.g. `27AADCI6120M1ZH`).
- **Cross-customer unique** — `Rule::unique('customer_gst_scrutiny','gst_number')->where(customer_id != {id}, deleted_at IS NULL)`. A GSTIN belongs to one customer; the same customer may repeat it. Error: *"This GST number is already registered to another customer."*
- `status` `in:Active,Inactive`; `last_filing_date` date; `prev_non_gst_2a_invoice` string(≤255); `red_flags` string(≤2000).

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/…/gst-scrutiny` | — | `200` array of shaped rows |
| POST | `/…/gst-scrutiny` | GST fields | `201 { data }` |
| PUT | `/…/gst-scrutiny/{gst}` | GST fields | `200 { data }` |
| DELETE | `/…/gst-scrutiny/{gst}` | — | `200 { message }` (force-delete) |

**Shaped row**
```json
{ "id": 1, "gst_number": "27AADCI6120M1ZH", "status": "Active",
  "last_filing_date": "2025-12-31", "prev_non_gst_2a_invoice": null, "red_flags": null }
```

---

### 3.8 Documents — `/customers/{customer}/documents`
`kind` = `dd` (Company Due Diligence) or `tl` (Trade Licence).

| Method | Path | Notes |
|---|---|---|
| GET | `/…/documents?kind=dd\|tl&search=` | list (search on name/license/authority) |
| POST | `/…/documents` | multipart; `kind*`, `name*`, `license_number`, `issuing_authority`, `issue_date`, `expiry_date` (≥ issue), `attachment` (≤2MB jpg/png/pdf/doc/docx), `description` |
| GET | `/…/documents/{document}` | single |
| POST/PUT | `/…/documents/{document}` | update meta + attachment; `remove_attachment` flag supported |
| DELETE | `/…/documents/{document}` | deletes row + on-disk file |

Any create/update/delete re-mirrors KYC to same-as-customer consignees (`ConsigneeKycMirror::resyncForCustomer`).

---

### 3.9 Owners — `/customers/{customer}/owners`
| Method | Path | Notes |
|---|---|---|
| GET | `/…/owners` | list |
| POST | `/…/owners` | multipart; `owner_name*`, `designation`, `official_email`, `phone_number` (regex), `id_proof` / `address_proof` (≤2MB doc/img/pdf), `photograph` (≤2MB img only) |
| GET | `/…/owners/{owner}` | single |
| POST/PUT | `/…/owners/{owner}` | update + `remove_id_proof` / `remove_address_proof` / `remove_photograph` flags |
| DELETE | `/…/owners/{owner}` | deletes row + all proof files |

Same KYC re-mirror on change.

> **Note:** `/customers/{id}/documents` (`kind=dd/tl`) and `/customers/{id}/owners` are the **ad-hoc** store — separate from the **segment uploads** below, which back the Evidence Vault.

---

### 3.10 Segment uploads & Evidence Vault — `/segment-uploads/{type}/{id}`
`{type}` ∈ `customer` / `consignee` / `supplier` / `vendor` / `product`. This is the **segment-rule-driven** document store (`segment_doc_uploads`), distinct from `/customers/{id}/documents`.

| Method | Path | Notes |
|---|---|---|
| GET | `/segment-uploads/{type}/{id}[?category=kyc\|dd\|tl\|td\|qc]` | List uploads; returns `{ data[], by_category{}, count }` |
| POST | `/segment-uploads/{type}/{id}` | Upload against a segment-rule code (multipart) |
| GET | `/segment-uploads/{type}/{id}/vault` | The Evidence-Vault read model |

**POST body (multipart)**
```
category*    in:kyc,dd,tl,td,qc
doc_code*    string(<=32)   e.g. "DD-001"
doc_name*    string(<=255)
requirement  in:M,O
attachment*  file  mimes:pdf,jpg,jpeg,png  max:2MB
```
Unique per `(uploadable_type, uploadable_id, category, doc_code)` — a repeat replaces the file. `doc_name`/`requirement` are snapshotted at upload time.

**GET `…/vault` — Response 200**
```json
{
  "data": {
    "same_as_customer": false,
    "total_documents": 22, "verified_signed": 18, "pending": 2,
    "core_total_documents": 15, "core_verified_signed": 14,
    "company_dd":      [ { "id": 1, "name": "Certificate of Incorporation", "reference": "DD-001",
                          "authority": "ROC", "expiry": "—", "attachment_url": "…",
                          "status": "Verified", "requirement": "M", "doc_code": "DD-001" } ],
    "owner_kyc":       [ … ], "trade_licenses": [ … ],
    "trade_documents": [ { "…segment td merged with Zoho status…": "…", "status": "Signed",
                          "certificate_url": "…" } ],
    "shipment_agreements": [ { "shipment_id": "SHP-2026-00487", "opportunity_id": "OPP-107",
                              "due_dil": {"ratio":"2/2","pct":100}, "kyc": {…}, "trade_lic": {…},
                              "trade_docs": {…}, "agreement": {…}, "risk": "Compliant" } ],
    "last_updated": "04/05/2026"
  }
}
```
> **`status` is derived** — `Verified` means a file exists for that code, `Pending` means it doesn't; `Signed` comes from a completed Zoho request. There is no stored verification. A `same_as_customer` consignee returns the **parent customer's** documents.

### 3.11 Trade-document signatures — `/clm/signature-requests`
| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/signature-requests?party_id=&model_name=Customer&lead_id=&document_type=&status=&sync=0\|1` | List/poll signature requests (`sync=1` refreshes from Zoho) |
| GET | `/clm/signature-requests/{id}` | One request + per-signer activity |
| POST | `/clm/signature-requests/send` | Create + send (trade docs OR agreements) to Zoho |
| POST | `/clm/signature-requests/{id}/remind` | Send a signing reminder |

Statuses: `draft` → `inprogress` → `completed` / `declined` / `recalled` / `superseded`. Completed requests expose `signed_document_url` / `signed_document_paths[]` / `certificate_url`.

---

## 4. RELATED ENDPOINTS USED BY THE CUSTOMER UI

| Method | Path | Purpose |
|---|---|---|
| GET | `/clm/segment-rules/for-segment/{segmentId}` | Required/optional docs for a segment (drives Stage-2 reference tables) |
| GET | `/clm/trade-doc-library/for-party/buyer` | Trade-document library filtered to party = Buyer |
| POST | `/segment-uploads/customer/{customerId}` | Upload a segment-rule reference document |
| GET | `/clm/signature-requests?party_id=&model_name=Customer&sync=0\|1` | Poll Zoho Sign status (Trade Documents tab, 15 s) |
| GET | `/consignees?customer_id={db_id}` | List a customer's consignees (Map Consignee modal) |

---

## 5. ERROR RESPONSE EXAMPLES

**422 — validation**
```json
{
  "message": "The company name field is required. (and 1 more error)",
  "errors": {
    "company_name": ["The company name field is required."],
    "gst_number": ["This GST number is already registered to another customer."]
  }
}
```
**403 — hierarchical denial**
```json
{ "message": "You are not allowed to edit this customer." }
```
**404 — not found**
```json
{ "message": "No query results for model [App\\Models\\Customer] 999" }
```

---

## 6. QUICK REFERENCE — TYPICAL FLOW

```
GET  /customers/master-bundle                     # dropdowns
POST /customers                                   # create + primary address (201)
GET  /customers?tab=fresh&q=acme                  # list
GET  /customers/{id}                              # detail (docs, owners, gst)
POST /customers/{id}/gst-scrutiny                 # add GSTIN (cross-customer unique)
POST /customers/{id}/documents (kind=dd)          # KYC due-diligence doc
POST /customers/{id}/owners                       # owner KYC + proofs
PUT  /customers/{id}                              # edit (replaces addresses; mirrors consignees)
DELETE /customers/{id}                            # soft-delete
```

---

## 7. SECURITY NOTES (customer-facing caveats)

1. **Server-side tenant scoping** — every read passes `Customer::forUser`; writes pass `hierarchicalDenial`. `client_id`/`branch_id` come from the token, never the body.
2. **GSTIN uniqueness is cross-customer** — one GSTIN ↔ one customer; repeats allowed within a customer.
3. **Address edits replace the set** — address IDs are not preserved across an update.
4. **Consignee mirror** — editing a customer or its KYC re-syncs "Same as Customer" consignees; a mirror failure is logged, not fatal.
5. **Uploads** capped at 2 MB, stored on the `public` disk; old files deleted on replace/destroy.

---

*Related documents: CUSTOMER_TECHNICAL_DOCUMENTATION.md · CUSTOMER_FUNCTIONAL_DOCUMENTATION.md · CUSTOMER_CODE_WALKTHROUGH.md*
