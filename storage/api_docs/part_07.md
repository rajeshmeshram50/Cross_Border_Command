# Part 07 — CLM: KYC, Due Diligence, QC, Trade Licenses, Zoho Signature, Buyer/Supplier Profiles

Base URL: `http://127.0.0.1:8000`
All endpoints require `Authorization: Bearer {{token}}`. The authenticated user's `client_id` scopes every query — never send it in the body.

---

## ClmKycController

KYC document master CRUD. Codes auto-allocate as `KYC-001`, `KYC-002`, … under a per-client row lock. `status` enum comes from `ClmKycDocument::STATUSES` (typically `active` / `inactive`). Name is unique per client (case-insensitive → 409 on collision).

### GET /api/clm/kyc-documents
**Action:** `ClmKycController@index` — list all KYC documents for the caller's tenant (ordered by id).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/kyc-documents' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/clm/kyc-documents
**Action:** `ClmKycController@store` — create a KYC document (auto `code`, dedup by name).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/kyc-documents' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "GST Registration Certificate",
  "authority": "GSTN",
  "expiry": "2027-03-31",
  "status": "active"
}'
```

**Body fields:**
- `name` (string, required, max 255) — unique per client
- `authority` (string, required, max 255)
- `expiry` (string, optional, max 32 — defaults to `"N/A"`)
- `status` (string, optional — must be in `ClmKycDocument::STATUSES`; defaults to active)

### PUT /api/clm/kyc-documents/{id}
**Action:** `ClmKycController@update` — partial update of a KYC document.
**Auth:** Bearer token required
**Path params:** `{id}` = KYC document id (scoped to caller's client)

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/kyc-documents/5' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "GST Registration Certificate (Updated)",
  "authority": "GSTN",
  "expiry": "2028-03-31",
  "status": "inactive"
}'
```

**Body fields (all optional, `sometimes`):**
- `name` (string, max 255, required-if-present, unique per client)
- `authority` (string, max 255, required-if-present)
- `expiry` (string, max 32, nullable)
- `status` (string, in `ClmKycDocument::STATUSES`, nullable)

### DELETE /api/clm/kyc-documents/{id}
**Action:** `ClmKycController@destroy` — delete a KYC document; blocked with 409 if referenced by Segment Rules or Segment Doc Uploads.
**Auth:** Bearer token required
**Path params:** `{id}` = KYC document id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/kyc-documents/5' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmDdController

Due-Diligence document master CRUD. Identical shape to KYC; codes auto-allocate as `DD-001`, `DD-002`, …. Name unique per client (409 on collision). Deletion blocked when referenced by Segment Rules / Segment Doc Uploads.

### GET /api/clm/dd-documents
**Action:** `ClmDdController@index` — list all DD documents for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/dd-documents' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/clm/dd-documents
**Action:** `ClmDdController@store` — create a DD document (auto `code`, dedup by name).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/dd-documents' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Sanctions Screening Report",
  "authority": "OFAC",
  "expiry": "2026-12-31",
  "status": "active"
}'
```

**Body fields:**
- `name` (string, required, max 255) — unique per client
- `authority` (string, required, max 255)
- `expiry` (string, optional, max 32 — defaults to `"N/A"`)
- `status` (string, optional — in `ClmDdDocument::STATUSES`)

### PUT /api/clm/dd-documents/{id}
**Action:** `ClmDdController@update` — partial update of a DD document.
**Auth:** Bearer token required
**Path params:** `{id}` = DD document id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/dd-documents/3' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Sanctions Screening Report (Q2)",
  "status": "inactive"
}'
```

**Body fields (all optional, `sometimes`):**
- `name` (string, max 255, required-if-present, unique per client)
- `authority` (string, max 255, required-if-present)
- `expiry` (string, max 32, nullable)
- `status` (string, in `ClmDdDocument::STATUSES`, nullable)

### DELETE /api/clm/dd-documents/{id}
**Action:** `ClmDdController@destroy` — delete a DD document; 409 if in use.
**Auth:** Bearer token required
**Path params:** `{id}` = DD document id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/dd-documents/3' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmQcController

Quality-Compliance document master CRUD. Codes auto-allocate as `QC-001`, …. Has a `doc_type` discriminator (`ClmQcDocument::TYPES` — cert vs comp; index returns `counts.cert`/`counts.comp`). Name unique per client. Deletion blocked if referenced by Segment Rules, Segment Doc Uploads, or Product QC Records (by name).

### GET /api/clm/qc-documents
**Action:** `ClmQcController@index` — list all QC documents plus type counts (`all`/`cert`/`comp`).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/qc-documents' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/clm/qc-documents
**Action:** `ClmQcController@store` — create a QC document (auto `code`, dedup by name).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/qc-documents' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Phytosanitary Certificate",
  "purpose": "Confirms consignment is free from quarantine pests",
  "issued_by": "Plant Quarantine Authority",
  "doc_type": "cert",
  "qa_params": "Moisture <= 14%; Foreign matter <= 1%",
  "min_criteria": "Grade A export quality",
  "status": "active"
}'
```

**Body fields:**
- `name` (string, required, max 255) — unique per client
- `purpose` (string, required, max 500)
- `issued_by` (string, required, max 255)
- `doc_type` (string, optional — in `ClmQcDocument::TYPES`; defaults to cert)
- `qa_params` (string, optional, nullable)
- `min_criteria` (string, optional, nullable)
- `status` (string, optional — in `ClmQcDocument::STATUSES`)

### PUT /api/clm/qc-documents/{id}
**Action:** `ClmQcController@update` — partial update of a QC document.
**Auth:** Bearer token required
**Path params:** `{id}` = QC document id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/qc-documents/7' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "purpose": "Updated quarantine confirmation scope",
  "doc_type": "comp",
  "min_criteria": "Grade A+ export quality"
}'
```

**Body fields (all optional, `sometimes`):**
- `name` (string, max 255, required-if-present, unique per client)
- `purpose` (string, max 500, required-if-present)
- `issued_by` (string, max 255, required-if-present)
- `doc_type` (string, in `ClmQcDocument::TYPES`, nullable)
- `qa_params` (string, nullable)
- `min_criteria` (string, nullable)
- `status` (string, in `ClmQcDocument::STATUSES`, nullable)

### DELETE /api/clm/qc-documents/{id}
**Action:** `ClmQcController@destroy` — delete a QC document; 409 if in use.
**Auth:** Bearer token required
**Path params:** `{id}` = QC document id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/qc-documents/7' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmTradeLicenseController

Trade-License master CRUD. Codes auto-allocate as `TL-001`, …. Uses `validity` (not `expiry`). Name unique per client. Deletion blocked if referenced by Segment Rules / Segment Doc Uploads.

### GET /api/clm/trade-licenses
**Action:** `ClmTradeLicenseController@index` — list all trade licenses for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/trade-licenses' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/clm/trade-licenses
**Action:** `ClmTradeLicenseController@store` — create a trade license (auto `code`, dedup by name).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/trade-licenses' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Importer Exporter Code (IEC)",
  "authority": "DGFT",
  "validity": "Lifetime",
  "status": "active"
}'
```

**Body fields:**
- `name` (string, required, max 255) — unique per client
- `authority` (string, required, max 255)
- `validity` (string, optional, max 32 — defaults to `"N/A"`)
- `status` (string, optional — in `ClmTradeLicense::STATUSES`)

### PUT /api/clm/trade-licenses/{id}
**Action:** `ClmTradeLicenseController@update` — partial update of a trade license.
**Auth:** Bearer token required
**Path params:** `{id}` = trade-license id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/trade-licenses/2' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "FSSAI License",
  "authority": "FSSAI",
  "validity": "5 years",
  "status": "active"
}'
```

**Body fields (all optional, `sometimes`):**
- `name` (string, max 255, required-if-present, unique per client)
- `authority` (string, max 255, required-if-present)
- `validity` (string, max 32, nullable)
- `status` (string, in `ClmTradeLicense::STATUSES`, nullable)

### DELETE /api/clm/trade-licenses/{id}
**Action:** `ClmTradeLicenseController@destroy` — delete a trade license; 409 if in use.
**Auth:** Bearer token required
**Path params:** `{id}` = trade-license id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/trade-licenses/2' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmSignatureController

Wraps Zoho Sign e-signature. Two send flows: **trade-doc** (`clm_trade_doc_library` against a single party) and **agreement** (`clm_agreement_library` against a Sales Matrix lead, auto-composing buyer + consignee signers). Send/preview render PDFs locally; send ships them to Zoho. Requires Zoho Sign configured (503 if not) and a tenant context (403 if user has no `client_id`).

### POST /api/clm/signature-requests
**Action:** `ClmSignatureController@send` — render selected trade-doc drafts to PDF, ship to Zoho Sign, persist the request.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/signature-requests' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "trade_doc_ids": [12, 13],
  "party_id": 45,
  "model_name": "Customer",
  "signers": [
    { "email": "rahul@example.com", "name": "Rahul Sharma", "order": 1 }
  ],
  "expiry_days": 30,
  "is_sequential": false,
  "notes": "Please review and sign these documents.",
  "document_settings": {
    "12": { "x": 400, "y": 700, "page": 1, "width": 180, "height": 60 },
    "13": { "x": 400, "y": 700, "page": 1, "width": 180, "height": 60 }
  }
}'
```

**Body fields:**
- `trade_doc_ids` (array, required, 1–10) of `integer` — each must exist in `clm_trade_doc_library`
- `party_id` (integer, required)
- `model_name` (string, optional — `Customer` | `Consignee` | `Vendor`; defaults `Customer`)
- `signers` (array, required, 1–5):
  - `signers.*.email` (email, required)
  - `signers.*.name` (string, required, max 255)
  - `signers.*.order` (integer, optional, min 1 — defaults to array position)
- `expiry_days` (integer, optional, 1–180 — defaults 30)
- `is_sequential` (boolean, optional)
- `notes` (string, optional, max 1000)
- `document_settings` (object, optional) — keyed by `trade_doc_id` → `{ x, y, page, width, height }` signature-field placement
- `header_config_overrides` (object, optional) — keyed by `trade_doc_id`, per-doc header overrides
- `footer_config_overrides` (object, optional) — keyed by `trade_doc_id`, per-doc footer overrides
- `content_overrides` (object, optional) — keyed by `trade_doc_id`, per-doc body HTML override

### GET /api/clm/signature-requests
**Action:** `ClmSignatureController@index` — list signature requests (latest first, max 200); optionally polls Zoho for live status.
**Auth:** Bearer token required
**Query params:**
- `party_id` (int) — filter by party (a `Consignee` flagged `same_as_customer` is transparently swapped to its parent customer)
- `model_name` (string) — `Customer` | `Consignee` | `Vendor`
- `document_type` (string) — e.g. `agreement` to scope agreement-flow rows
- `lead_id` (int) — scope to an opportunity
- `status` (string or array) — e.g. `inprogress`, `completed`, `recalled`
- `sync` (bool) — `true` to refresh still-inprogress (and completed-but-missing-file) rows from Zoho

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/signature-requests?party_id=45&model_name=Customer&status=inprogress&sync=true' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/clm/signature-requests/agreement-preview
**Action:** `ClmSignatureController@agreementPreview` — render one agreement against a lead's buyer/consignee and return the PDF inline (no Zoho call).
**Auth:** Bearer token required
**Response:** `application/pdf` (inline)

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/signature-requests/agreement-preview' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --output preview.pdf \
  --data '{
  "agreement_id": 8,
  "lead_id": 102
}'
```

**Body fields:**
- `agreement_id` (integer, required) — must exist in `clm_agreement_library`
- `lead_id` (integer, required) — must exist in `leads`
- `header_config_override` (object, optional)
- `footer_config_override` (object, optional)
- `content_override` (string, optional) — body HTML override

### POST /api/clm/signature-requests/agreement-send
**Action:** `ClmSignatureController@agreementSend` — render one or more agreements for a lead and send to Zoho. Buyer + consignee auto-resolved as signers; all selected agreements must share the same applicable party.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/signature-requests/agreement-send' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "agreement_ids": [8, 9],
  "lead_id": 102,
  "expiry_days": 30,
  "is_sequential": false,
  "notes": "Please review and sign these agreements.",
  "document_settings": {
    "8": { "x": 400, "y": 700, "page": 1, "width": 180, "height": 60 },
    "9": { "x": 400, "y": 700, "page": 1, "width": 180, "height": 60 }
  }
}'
```

**Body fields:**
- `agreement_id` (integer, optional) — single-send; must exist in `clm_agreement_library`
- `agreement_ids` (array, optional, 1–10) of `integer` — bulk-send; each must exist. (Supply one of `agreement_id` / `agreement_ids`; 422 if neither resolves.)
- `lead_id` (integer, required) — must exist in `leads`
- `expiry_days` (integer, optional, 1–180 — defaults 30)
- `is_sequential` (boolean, optional)
- `notes` (string, optional, max 1000)
- `document_settings` (object, optional) — keyed by `agreement_id` → `{ x, y, page, width, height }`
- `header_config_overrides` (object, optional) — keyed by `agreement_id`
- `footer_config_overrides` (object, optional) — keyed by `agreement_id`
- `content_overrides` (object, optional) — keyed by `agreement_id`

### POST /api/clm/signature-requests/preview
**Action:** `ClmSignatureController@preview` — render a single trade-doc draft against a party and return the PDF inline (no Zoho call).
**Auth:** Bearer token required
**Response:** `application/pdf` (inline)

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/signature-requests/preview' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --output preview.pdf \
  --data '{
  "trade_doc_id": 12,
  "party_id": 45,
  "model_name": "Customer"
}'
```

**Body fields:**
- `trade_doc_id` (integer, required) — must exist in `clm_trade_doc_library`
- `party_id` (integer, required)
- `model_name` (string, optional — `Customer` | `Consignee` | `Vendor`; defaults `Customer`)
- `header_config_override` (object, optional)
- `footer_config_override` (object, optional)
- `content_override` (string, optional) — body HTML override

### GET /api/clm/signature-requests/{id}
**Action:** `ClmSignatureController@show` — fetch one request, syncing status from Zoho; pulls signed PDFs + certificate on completion.
**Auth:** Bearer token required
**Path params:** `{id}` = signature-request id

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/signature-requests/31' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/clm/signature-requests/{id}/certificate
**Action:** `ClmSignatureController@viewCertificate` — stream the Zoho completion certificate PDF inline (lazy-pulls from Zoho if missing and status is completed; 404 otherwise).
**Auth:** Bearer token required
**Path params:** `{id}` = signature-request id
**Response:** `application/pdf` (inline)

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/signature-requests/31/certificate' \
  --header 'Authorization: Bearer {{token}}' \
  --output certificate.pdf
```

### GET /api/clm/signature-requests/{id}/download-file/{index}
**Action:** `ClmSignatureController@downloadFile` — download a signed PDF as an attachment (lazy-pulls from Zoho if missing; 404 if not found).
**Auth:** Bearer token required
**Path params:** `{id}` = signature-request id; `{index}` = 0-based index into the request's signed-document array
**Response:** `application/pdf` (attachment)

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/signature-requests/31/download-file/0' \
  --header 'Authorization: Bearer {{token}}' \
  --output signed-document.pdf
```

### POST /api/clm/signature-requests/{id}/recall
**Action:** `ClmSignatureController@recall` — recall an in-flight Zoho request (rejected with 400 if already completed); sets status `recalled`.
**Auth:** Bearer token required
**Path params:** `{id}` = signature-request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/signature-requests/31/recall' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "reason": "Incorrect consignee details — re-sending corrected version."
}'
```

**Body fields:**
- `reason` (string, required, max 500)

### POST /api/clm/signature-requests/{id}/remind
**Action:** `ClmSignatureController@remind` — send a Zoho reminder to pending signers (only when status is `inprogress`; bumps `reminder_count`). No body.
**Auth:** Bearer token required
**Path params:** `{id}` = signature-request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/signature-requests/31/remind' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/clm/signature-requests/{id}/view-file/{index}
**Action:** `ClmSignatureController@viewFile` — stream a signed PDF inline (same lazy-pull as download; 404 if not found).
**Auth:** Bearer token required
**Path params:** `{id}` = signature-request id; `{index}` = 0-based index into the signed-document array
**Response:** `application/pdf` (inline)

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/signature-requests/31/view-file/0' \
  --header 'Authorization: Bearer {{token}}' \
  --output signed-document.pdf
```

---

## ClmBuyerProfileController

### GET /api/clm/buyer-profile
**Action:** `ClmBuyerProfileController@index` — one read endpoint powering the whole Buyer Profile dashboard: customers (buyers) with KYC/DD/TL/TD + agreement progress, consignees grouped by parent, and the transaction matrix split by with-/without-shipment × buyer=consignee / buyer≠consignee. Returns `{ buyers, consignees, ws_eq, ws_neq, wos_eq, wos_neq }`.
**Auth:** Bearer token required
**Query params:** none (no input; tenant-scoped via auth)

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/buyer-profile' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmSupplierProfileController

### GET /api/clm/supplier-profile
**Action:** `ClmSupplierProfileController@index` — Supplier Profile dashboard data: vendors bucketed by supplier type and shipment status (`ws_mat`, `ws_logi`, `wos_svc`, `wos_mat`, `wos_logi`), each with KYC/DD/TL/TD + agreement progress and shipment count.
**Auth:** Bearer token required
**Query params:** none (no input; tenant-scoped via auth)

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/supplier-profile' \
  --header 'Authorization: Bearer {{token}}'
```
