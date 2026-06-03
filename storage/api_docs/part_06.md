# Part 06 — CLM: Agreements, Clauses, T&C, Trade Documents, Segments, Segment Rules, Authorities

> Base URL: `http://127.0.0.1:8000`
> All endpoints require header `Authorization: Bearer {{token}}` and run under `auth:sanctum` + `user.active`.
> CLM = Central Legal Module. All rows are tenant-scoped by the authenticated user's `client_id` (never sent in the body). Library entries hold TipTap rich-text HTML (`content`), segment/party mappings, and optional uploaded DOCX. `upload-docx` and `upload-header-logo` are multipart uploads.

---

## ClmAgreementController

### GET /api/clm/agreement-library
**Action:** `ClmAgreementController@libraryIndex` — list all agreement-library templates (A-NNN) for the tenant; each row carries an `is_signed` flag when a completed Zoho signature request references it.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/agreement-library' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/agreement-library
**Action:** `ClmAgreementController@libraryStore` — create an agreement-library template (auto-codes `A-NNN` per client).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/agreement-library' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "agreement_type": "Sales Contract",
  "title": "Tobacco Export Sales Contract",
  "party": "Buyer,Consignee",
  "regulatory": "highly",
  "signing": true,
  "segment": "Tobacco",
  "agr_status": "Active",
  "content": "<h1>Sales Contract</h1><p>This agreement is made between {{seller}} and {{buyer}}.</p>",
  "header_config": { "logo_path": null },
  "footer_config": { "text": "Confidential" }
}'
```

**Body fields:**
- `agreement_type` (required, string, max 255) — links to an agreement-type name.
- `title` (required, string, max 255).
- `party` (required, string, max 255) — CSV of party types, e.g. `Buyer,Consignee`.
- `regulatory` (optional, enum — one of `ClmAgreementLibrary::REG_VALUES`, e.g. `highly` / `less`; defaults to less).
- `signing` (optional, boolean; default `true`).
- `segment` (optional, string, max 1024) — CSV of segment names/codes.
- `agr_status` (optional, string, max 32; default `Active`).
- `content` (optional, string) — TipTap HTML body.
- `header_config` (optional, array/object) — page-shell config.
- `footer_config` (optional, array/object).

---

### POST /api/clm/agreement-library/upload-header-logo
**Action:** `ClmAgreementController@uploadHeaderLogo` — upload a header logo for the agreement page-shell; returns `{ path, url }`.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/agreement-library/upload-header-logo' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'logo=@/path/to/logo.png'
```

**Body fields (multipart):**
- `logo` (required, file; mimes `png,jpg,jpeg,svg,webp`; max 5120 KB).

---

### PUT /api/clm/agreement-library/{id}
**Action:** `ClmAgreementController@libraryUpdate` — update an agreement template. Returns 422 if the agreement already has a completed signature request (legal record lock).
**Auth:** Bearer token required
**Path params:** `{id}` = agreement-library row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/agreement-library/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "title": "Tobacco Export Sales Contract (Rev 2)",
  "regulatory": "highly",
  "agr_status": "Active",
  "content": "<p>Updated clause body…</p>"
}'
```

**Body fields:** all optional (use `sometimes`):
- `agreement_type` (string, max 255, required if present).
- `title` (string, max 255, required if present).
- `party` (string, max 255, required if present).
- `regulatory` (nullable, enum `ClmAgreementLibrary::REG_VALUES`).
- `signing` (nullable, boolean).
- `segment` (nullable, string, max 1024).
- `agr_status` (nullable, string, max 32).
- `content` (nullable, string).
- `header_config` (nullable, array).
- `footer_config` (nullable, array).

---

### DELETE /api/clm/agreement-library/{id}
**Action:** `ClmAgreementController@libraryDestroy` — delete an agreement template. Returns 422 if already signed (legal record lock).
**Auth:** Bearer token required
**Path params:** `{id}` = agreement-library row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/agreement-library/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clm/agreement-library/{id}/download
**Action:** `ClmAgreementController@downloadDocx` — download the agreement as DOCX (streams the uploaded DOCX if present, otherwise generates one from the `content` HTML). Binary response.
**Auth:** Bearer token required
**Path params:** `{id}` = agreement-library row id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/agreement-library/1/download' \
  --header 'Authorization: Bearer {{token}}' \
  --output agreement.docx
```

---

### POST /api/clm/agreement-library/{id}/upload-docx
**Action:** `ClmAgreementController@uploadDocx` — upload a revised Word doc; stores it and refreshes the row's `content` HTML from the DOCX.
**Auth:** Bearer token required
**Path params:** `{id}` = agreement-library row id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/agreement-library/1/upload-docx' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'docx=@/path/to/agreement.docx'
```

**Body fields (multipart):**
- `docx` (required, file; mimes `doc,docx`; max 20480 KB / 20 MB).

---

### GET /api/clm/agreement-types
**Action:** `ClmAgreementController@typesIndex` — list agreement types (AT-NNN: Sales Contract, MSA, NDA, …) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/agreement-types' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/agreement-types
**Action:** `ClmAgreementController@typesStore` — create an agreement type (auto-codes `AT-NNN`). Returns 409 on duplicate name (case-insensitive).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/agreement-types' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Non-Disclosure Agreement",
  "description": "Mutual NDA used before sharing pricing and process data."
}'
```

**Body fields:**
- `name` (required, string, max 255) — unique per client.
- `description` (required, string, max 500).

---

### PUT /api/clm/agreement-types/{id}
**Action:** `ClmAgreementController@typesUpdate` — update an agreement type. Returns 409 on rename to a duplicate name.
**Auth:** Bearer token required
**Path params:** `{id}` = agreement-type row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/agreement-types/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Master Service Agreement",
  "description": "Umbrella MSA covering recurring engagements."
}'
```

**Body fields:** both optional (`sometimes|required`):
- `name` (string, max 255).
- `description` (string, max 500).

---

### DELETE /api/clm/agreement-types/{id}
**Action:** `ClmAgreementController@typesDestroy` — delete an agreement type.
**Auth:** Bearer token required
**Path params:** `{id}` = agreement-type row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/agreement-types/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clm/leads/{leadId}/agreement-applicable
**Action:** `ClmAgreementController@applicableForLead` — resolve applicable agreements for a lead by walking its latest PI/quotation → product segments → matching agreement-library rows, grouped by regulatory tier, with live signature-request status.
**Auth:** Bearer token required
**Path params:** `{leadId}` = lead (opportunity) id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/leads/42/agreement-applicable' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmClauseController

### GET /api/clm/clause-library
**Action:** `ClmClauseController@libraryIndex` — list clause-library entries (CL-NNN: Force Majeure, Governing Law, …) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/clause-library' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/clause-library
**Action:** `ClmClauseController@libraryStore` — create a clause (auto-codes `CL-NNN`).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/clause-library' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "clause_type": "Core Legal",
  "name": "Force Majeure",
  "party": "Buyer",
  "clause_status": "Active",
  "content": "<p>Neither party shall be liable for failure to perform due to events beyond reasonable control.</p>"
}'
```

**Body fields:**
- `clause_type` (required, string, max 255).
- `name` (required, string, max 255).
- `party` (optional, string, max 255).
- `clause_status` (optional, string, max 32; default `Active`).
- `content` (optional, string) — TipTap HTML.

---

### PUT /api/clm/clause-library/{id}
**Action:** `ClmClauseController@libraryUpdate` — update a clause.
**Auth:** Bearer token required
**Path params:** `{id}` = clause-library row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/clause-library/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Governing Law",
  "clause_status": "Active",
  "content": "<p>This agreement is governed by the laws of India.</p>"
}'
```

**Body fields:** all optional:
- `clause_type` (string, max 255, required if present).
- `name` (string, max 255, required if present).
- `party` (nullable, string, max 255).
- `clause_status` (nullable, string, max 32).
- `content` (nullable, string).

---

### DELETE /api/clm/clause-library/{id}
**Action:** `ClmClauseController@libraryDestroy` — delete a clause.
**Auth:** Bearer token required
**Path params:** `{id}` = clause-library row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/clause-library/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clm/clause-types
**Action:** `ClmClauseController@typesIndex` — list clause types (CLT-NNN: Core Legal, Commercial, …) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/clause-types' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/clause-types
**Action:** `ClmClauseController@typesStore` — create a clause type (auto-codes `CLT-NNN`).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/clause-types' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Commercial",
  "description": "Pricing, payment terms, and delivery clauses."
}'
```

**Body fields:**
- `name` (required, string, max 255).
- `description` (optional/nullable, string, max 500).

---

### PUT /api/clm/clause-types/{id}
**Action:** `ClmClauseController@typesUpdate` — update a clause type.
**Auth:** Bearer token required
**Path params:** `{id}` = clause-type row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/clause-types/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Core Legal"
}'
```

**Body fields:** both optional:
- `name` (string, max 255, required if present).
- `description` (nullable, string, max 500).

---

### DELETE /api/clm/clause-types/{id}
**Action:** `ClmClauseController@typesDestroy` — delete a clause type.
**Auth:** Bearer token required
**Path params:** `{id}` = clause-type row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/clause-types/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmTncController

### GET /api/clm/tnc-categories
**Action:** `ClmTncController@categoriesIndex` — list T&C categories (DC-NNN: International - Proforma Invoice, …) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/tnc-categories' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/tnc-categories
**Action:** `ClmTncController@categoriesStore` — create a T&C category (auto-codes `DC-NNN`; `short_code` upper-cased).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/tnc-categories' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "short_code": "PI-INTL",
  "name": "International - Proforma Invoice"
}'
```

**Body fields:**
- `short_code` (required, string, max 12) — stored upper-cased.
- `name` (required, string, max 255).

---

### PUT /api/clm/tnc-categories/{id}
**Action:** `ClmTncController@categoriesUpdate` — update a T&C category.
**Auth:** Bearer token required
**Path params:** `{id}` = T&C category row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/tnc-categories/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "short_code": "QT-INTL",
  "name": "International - Quotation"
}'
```

**Body fields:** both optional (`sometimes|required`):
- `short_code` (string, max 12).
- `name` (string, max 255).

---

### DELETE /api/clm/tnc-categories/{id}
**Action:** `ClmTncController@categoriesDestroy` — delete a T&C category.
**Auth:** Bearer token required
**Path params:** `{id}` = T&C category row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/tnc-categories/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clm/tnc-library
**Action:** `ClmTncController@libraryIndex` — list T&C library blocks (TNC-NNN) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/tnc-library' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/tnc-library
**Action:** `ClmTncController@libraryStore` — create a reusable T&C block (auto-codes `TNC-NNN`).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/tnc-library' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "segment": "Rice",
  "category": "International - Proforma Invoice",
  "party": "Buyer",
  "content": "<ol><li>Payment 100% in advance by T/T.</li><li>Goods inspected before shipment.</li></ol>"
}'
```

**Body fields:**
- `segment` (optional/nullable, string, max 64; default `General`).
- `category` (required, string, max 255).
- `party` (required, string, max 255).
- `content` (optional, string) — TipTap HTML.

---

### PUT /api/clm/tnc-library/{id}
**Action:** `ClmTncController@libraryUpdate` — update a T&C block.
**Auth:** Bearer token required
**Path params:** `{id}` = T&C library row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/tnc-library/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "segment": "Food Grade Ethanol",
  "category": "International - Quotation",
  "party": "Consignee",
  "content": "<p>Revised terms and conditions.</p>"
}'
```

**Body fields:**
- `segment` (nullable, string, max 64).
- `category` (string, max 255, required if present).
- `party` (string, max 255, required if present).
- `content` (nullable, string).

---

### DELETE /api/clm/tnc-library/{id}
**Action:** `ClmTncController@libraryDestroy` — delete a T&C block.
**Auth:** Bearer token required
**Path params:** `{id}` = T&C library row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/tnc-library/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmTradeDocumentController

### GET /api/clm/trade-doc-library
**Action:** `ClmTradeDocumentController@libraryIndex` — list trade-document library entries (TD-NNN) for the tenant; rows carry an `is_signed` flag when a completed signature request references them.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/trade-doc-library' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/trade-doc-library
**Action:** `ClmTradeDocumentController@libraryStore` — create a trade-document library entry (auto-codes `TD-NNN`).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/trade-doc-library' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Commercial Invoice",
  "title": "Export Commercial Invoice Template",
  "doc_type": "Invoice",
  "purpose": "Customs clearance and buyer billing for export shipments.",
  "party": "Buyer,Consignee",
  "file_path": null,
  "content": "<h2>Commercial Invoice</h2><p>{{shipment_details}}</p>",
  "header_config": { "logo_path": null },
  "footer_config": { "text": "Page {{page}}" }
}'
```

**Body fields:**
- `name` (required, string, max 255).
- `title` (required, string, max 255).
- `doc_type` (required, string, max 64) — e.g. `Invoice`, `Packing List`, `Certificate`.
- `purpose` (required, string, max 500).
- `party` (required, string, max 255) — CSV: `Buyer`, `Consignee`, `Supplier-Material`, etc.
- `file_path` (optional/nullable, string, max 500).
- `content` (optional, string) — TipTap HTML.
- `header_config` (optional, array/object).
- `footer_config` (optional, array/object).

---

### GET /api/clm/trade-doc-library/for-party/{party}
**Action:** `ClmTradeDocumentController@libraryForParty` — filter trade-doc library rows whose `party` CSV mentions the given party bucket.
**Auth:** Bearer token required
**Path params:** `{party}` = party key. Logical buckets: `buyer`/`customer` → matches `Buyer`; `consignee` → matches `Consignee`; `supplier` → matches any `Supplier-*` sub-type; anything else → literal substring match.

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/trade-doc-library/for-party/buyer' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/trade-doc-library/upload-header-logo
**Action:** `ClmTradeDocumentController@uploadHeaderLogo` — upload a header logo for the trade-doc page-shell; returns `{ path, url }`.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/trade-doc-library/upload-header-logo' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'logo=@/path/to/logo.png'
```

**Body fields (multipart):**
- `logo` (required, file; mimes `png,jpg,jpeg,svg,webp`; max 5120 KB).

---

### PUT /api/clm/trade-doc-library/{id}
**Action:** `ClmTradeDocumentController@libraryUpdate` — update a trade-document entry. Returns 422 if already signed (legal record lock).
**Auth:** Bearer token required
**Path params:** `{id}` = trade-doc library row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/trade-doc-library/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "title": "Export Commercial Invoice Template (v2)",
  "doc_type": "Invoice",
  "purpose": "Updated customs + billing template.",
  "party": "Buyer",
  "content": "<p>Updated body…</p>"
}'
```

**Body fields:** all optional:
- `name` (string, max 255, required if present).
- `title` (string, max 255, required if present).
- `doc_type` (string, max 64, required if present).
- `purpose` (string, max 500, required if present).
- `party` (string, max 255, required if present).
- `file_path` (nullable, string, max 500).
- `content` (nullable, string).
- `header_config` (nullable, array).
- `footer_config` (nullable, array).

---

### DELETE /api/clm/trade-doc-library/{id}
**Action:** `ClmTradeDocumentController@libraryDestroy` — delete a trade-document entry. Returns 422 if already signed (legal record lock).
**Auth:** Bearer token required
**Path params:** `{id}` = trade-doc library row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/trade-doc-library/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clm/trade-doc-library/{id}/download
**Action:** `ClmTradeDocumentController@downloadDocx` — download the trade document as DOCX (uploaded DOCX if present, otherwise generated from `content` HTML). Binary response.
**Auth:** Bearer token required
**Path params:** `{id}` = trade-doc library row id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/trade-doc-library/1/download' \
  --header 'Authorization: Bearer {{token}}' \
  --output trade-document.docx
```

---

### POST /api/clm/trade-doc-library/{id}/upload-docx
**Action:** `ClmTradeDocumentController@uploadDocx` — upload a revised Word doc; stores it and refreshes the row's `content` HTML from the DOCX.
**Auth:** Bearer token required
**Path params:** `{id}` = trade-doc library row id.

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/trade-doc-library/1/upload-docx' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'docx=@/path/to/trade-document.docx'
```

**Body fields (multipart):**
- `docx` (required, file; mimes `doc,docx`; max 20480 KB / 20 MB).

---

### GET /api/clm/trade-doc-names
**Action:** `ClmTradeDocumentController@namesIndex` — list trade-document name catalog entries (TDN-NNN) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/trade-doc-names' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/trade-doc-names
**Action:** `ClmTradeDocumentController@namesStore` — create a trade-document name catalog entry (auto-codes `TDN-NNN`).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/trade-doc-names' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Certificate of Origin"
}'
```

**Body fields:**
- `name` (required, string, max 255).

---

### PUT /api/clm/trade-doc-names/{id}
**Action:** `ClmTradeDocumentController@namesUpdate` — rename a trade-document name catalog entry.
**Auth:** Bearer token required
**Path params:** `{id}` = trade-doc name row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/trade-doc-names/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Packing List"
}'
```

**Body fields:**
- `name` (required, string, max 255).

---

### DELETE /api/clm/trade-doc-names/{id}
**Action:** `ClmTradeDocumentController@namesDestroy` — delete a trade-document name catalog entry.
**Auth:** Bearer token required
**Path params:** `{id}` = trade-doc name row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/trade-doc-names/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmSegmentController

### GET /api/clm/segments
**Action:** `ClmSegmentController@index` — list business segments (S-NNN) for the tenant with `counts` for all / highly / less regulatory tiers.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/segments' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/segments
**Action:** `ClmSegmentController@store` — create a segment (auto-codes `S-NNN` under a row lock). Returns 409 on duplicate name (case-insensitive).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/segments' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Tobacco",
  "regulatory_status": "highly",
  "buyer_consignee": "both",
  "status": "active"
}'
```

**Body fields:**
- `name` (required, string, max 255) — unique per client.
- `regulatory_status` (required, enum — one of `ClmSegment::REG_VALUES`, e.g. `highly` / `less`).
- `buyer_consignee` (required, enum — one of `ClmSegment::BC_VALUES`, e.g. `buyer` / `consignee` / `both`).
- `status` (optional/nullable, enum — one of `ClmSegment::STATUSES`, e.g. `active` / `inactive`; default `active`).

---

### PUT /api/clm/segments/{id}
**Action:** `ClmSegmentController@update` — update a segment (`code` is immutable). Returns 409 on rename to a duplicate.
**Auth:** Bearer token required
**Path params:** `{id}` = segment row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/segments/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Food Grade Ethanol",
  "regulatory_status": "highly",
  "buyer_consignee": "both",
  "status": "active"
}'
```

**Body fields:** all optional:
- `name` (string, max 255, required if present).
- `regulatory_status` (enum `ClmSegment::REG_VALUES`, required if present).
- `buyer_consignee` (enum `ClmSegment::BC_VALUES`, required if present).
- `status` (nullable, enum `ClmSegment::STATUSES`).

---

### DELETE /api/clm/segments/{id}
**Action:** `ClmSegmentController@destroy` — hard-delete a segment. Returns 409 with `used_in` if referenced by segment rules, vendors, products, customers, consignees, T&C/agreement library, or vendor directory.
**Auth:** Bearer token required
**Path params:** `{id}` = segment row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/segments/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmSegmentRuleController

### GET /api/clm/segment-rules
**Action:** `ClmSegmentRuleController@index` — list segment rules (SR-NNN) for the tenant with `counts` for all / highly / less tiers.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/segment-rules' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/segment-rules
**Action:** `ClmSegmentRuleController@store` — create a segment rule (auto-codes `SR-NNN`; rolls up M/O counts). Returns 409 with the existing row if a rule already exists for that `segment_code` (one rule per segment per tenant).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/segment-rules' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "segment_code": "S-001",
  "regulatory_status": "highly",
  "auths": ["AUTH-001", "AUTH-002"],
  "doc_selections": {
    "kyc": { "KYC-001": "M", "KYC-002": "O" },
    "dd":  { "DD-001": "M" },
    "tl":  { "TL-001": "M" },
    "td":  { "TD-001": "O" },
    "qc":  { "QC-001": "O" }
  }
}'
```

**Body fields:**
- `segment_code` (required, string, max 16) — the segment's `S-NNN` code.
- `regulatory_status` (required, enum — one of `ClmSegmentRule::REG_VALUES`, e.g. `highly` / `less`).
- `auths` (optional/nullable, array of strings) — authority codes (e.g. `AUTH-001`); stored as `auths_json`.
- `doc_selections` (required, array/object) — per-category map. Sub-keys all optional arrays: `doc_selections.kyc`, `.dd`, `.tl`, `.td`, `.qc`. Each maps a document code → `M` (mandatory) or `O` (optional).

---

### GET /api/clm/segment-rules/bootstrap
**Action:** `ClmSegmentRuleController@bootstrap` — bundle every master collection the Add-Segment-Rule modal needs (segments, authorities, kyc, dd, tl, td, qc) in one round-trip.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/segment-rules/bootstrap' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/clm/segment-rules/for-segment/{segmentId}
**Action:** `ClmSegmentRuleController@forSegment` — resolve the segment rule for a segment plus full KYC/DD/TL/TD/QC master rows referenced by its `doc_selections`, each stamped with its `requirement` (`M`/`O`). Always 200 (`rule` is null when none exists).
**Auth:** Bearer token required
**Path params:** `{segmentId}` = segment row id.

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/segment-rules/for-segment/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/clm/segment-rules/{id}
**Action:** `ClmSegmentRuleController@update` — update a segment rule; re-rolls M/O counts and re-resolves `segment_id` from `segment_code`.
**Auth:** Bearer token required
**Path params:** `{id}` = segment-rule row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/segment-rules/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "segment_code": "S-001",
  "regulatory_status": "less",
  "auths": ["AUTH-001"],
  "doc_selections": {
    "kyc": { "KYC-001": "M" },
    "dd":  {},
    "tl":  { "TL-001": "O" },
    "td":  {},
    "qc":  {}
  }
}'
```

**Body fields:** same validation as POST:
- `segment_code` (required, string, max 16).
- `regulatory_status` (required, enum `ClmSegmentRule::REG_VALUES`).
- `auths` (nullable, array of strings).
- `doc_selections` (required, array/object) with optional `kyc`/`dd`/`tl`/`td`/`qc` sub-arrays of `code → M|O`.

---

### DELETE /api/clm/segment-rules/{id}
**Action:** `ClmSegmentRuleController@destroy` — delete a segment rule.
**Auth:** Bearer token required
**Path params:** `{id}` = segment-rule row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/segment-rules/1' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ClmAuthorityController

### GET /api/clm/authorities
**Action:** `ClmAuthorityController@index` — list regulatory authorities (AUTH-NNN: FSSAI, DGFT, BIS, …) for the tenant.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/clm/authorities' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/clm/authorities
**Action:** `ClmAuthorityController@store` — create an authority (auto-codes `AUTH-NNN` under a row lock). Returns 409 on duplicate name (case-insensitive).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/clm/authorities' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "FSSAI",
  "description": "Food Safety and Standards Authority of India.",
  "status": "active"
}'
```

**Body fields:**
- `name` (required, string, max 255) — unique per client.
- `description` (required, string, max 500).
- `status` (optional/nullable, enum — one of `ClmAuthority::STATUSES`, e.g. `active` / `inactive`; default `active`).

---

### PUT /api/clm/authorities/{id}
**Action:** `ClmAuthorityController@update` — update an authority. Returns 409 on rename to a duplicate.
**Auth:** Bearer token required
**Path params:** `{id}` = authority row id.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/clm/authorities/1' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "DGFT",
  "description": "Directorate General of Foreign Trade.",
  "status": "active"
}'
```

**Body fields:** all optional:
- `name` (string, max 255, required if present).
- `description` (string, max 500, required if present).
- `status` (nullable, enum `ClmAuthority::STATUSES`).

---

### DELETE /api/clm/authorities/{id}
**Action:** `ClmAuthorityController@destroy` — delete an authority. Returns 409 with `used_in` if referenced by KYC/DD/trade-license/QC docs, vendor/customer documents, vendor owners (by name), or segment rules (by code in `auths_json`).
**Auth:** Bearer token required
**Path params:** `{id}` = authority row id.

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/clm/authorities/1' \
  --header 'Authorization: Bearer {{token}}'
```
