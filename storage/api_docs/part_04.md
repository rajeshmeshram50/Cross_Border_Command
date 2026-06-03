# Part 04 — Customers & Consignees (with Documents & Owners)

Base URL: `http://127.0.0.1:8000`
All endpoints require `Authorization: Bearer {{token}}` and are tenant-scoped (rows resolved via `forUser()` — client/branch hierarchy). Validation rules below are extracted directly from each controller.

---

## CustomerController

### GET /api/customers
**Action:** `CustomerController@index` — list customers (tenant-scoped), with primary address, consignee counts.
**Auth:** Bearer token required
**Query params:**
- `q` — search across customer_code (exact, upper), primary_email (starts-with), company_name / legal_name / segment / type (contains), and primary address country / cp_name / cp_contact.
- `tab` — `fresh` (default, no leads yet) | `recurring` (has ≥1 lead) | `all`.
- `page`, `per_page` — optional pagination (per_page capped at 200, defaults to 50 when paging is triggered). Omit both for the legacy "return everything" shape.

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers?q=Reliance&tab=all&page=1&per_page=50' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/customers
**Action:** `CustomerController@store` — create a customer + its primary address (and optional extra locations). Auto-generates `C-###` code. `primary_email` mirrors `primary_address.cp_email`.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/customers' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "company_name": "Reliance Exports Pvt Ltd",
  "legal_name": "Reliance Exports Private Limited",
  "type": "Retailer",
  "segment": "Rice",
  "classification": "Strategic",
  "risk_level": "Low",
  "website": "https://relianceexports.in",
  "status": "Active",
  "primary_address": {
    "type": "Registered Office",
    "address_line": "Plot 14, MIDC Industrial Area, Andheri East",
    "country": "India",
    "state": "Maharashtra",
    "city": "Mumbai",
    "pin": "400093",
    "cp_name": "Ramesh Iyer",
    "cp_designation": "Director",
    "cp_contact": "+91 9820012345",
    "cp_email": "ramesh.iyer@relianceexports.in",
    "cp_whatsapp": "yes"
  },
  "locations": [
    {
      "type": "Warehouse",
      "address_line": "Survey 88, Bhiwandi Logistics Park",
      "country": "India",
      "state": "Maharashtra",
      "city": "Bhiwandi",
      "pin": "421302",
      "cp_name": "Sunil Patil",
      "cp_designation": "Warehouse Manager",
      "cp_contact": "+91 9890054321",
      "cp_email": "sunil.patil@relianceexports.in",
      "cp_whatsapp": "no"
    }
  ]
}'
```

**Body fields:**
- `company_name` (required, string, max 255)
- `legal_name` (optional, string, max 255 — case-insensitive unique per tenant)
- `type` (optional, string, max 64)
- `segment` (optional, string, max 1024)
- `classification` (optional, string, max 64)
- `risk_level` (optional, string, max 32)
- `website` (optional, string, max 500)
- `status` (optional, in: `Active`,`Inactive` — defaults `Active`)
- `primary_address` (required, array):
  - `.type` (required, string, max 64)
  - `.address_line` (required, string, min 4, max 1000)
  - `.country` / `.state` / `.city` (optional, string, max 64)
  - `.pin` (optional, regex `^\d{6}$` — exactly 6 digits)
  - `.cp_name` (required, string, max 255)
  - `.cp_designation` (optional, string, max 128)
  - `.cp_contact` (required, regex `^\+?[0-9\s-]{7,15}$` — unique among primary addresses per tenant)
  - `.cp_email` (required, email, max 255, strict regex — unique against `customers.primary_email` per tenant)
  - `.cp_whatsapp` (optional, in: `yes`,`no`)
- `locations` (optional, array) — each item: `.type`, `.address_line`, `.cp_name` required-with-locations; `.country`/`.state`/`.city`, `.pin` (6-digit), `.cp_designation`, `.cp_contact` (phone regex), `.cp_email` (email regex), `.cp_whatsapp` optional. Email/phone may not duplicate the primary or another location row.

---

### GET /api/customers/master-bundle
**Action:** `CustomerController@masterBundle` — single response bundling 9 master dropdowns (customer_types, segments, customer_classifications, risk_levels, address_types, countries, states, designations, document_type). Tenant-scoped, cached per-user 5 min, only `active` rows.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers/master-bundle' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/customers/{customer}
**Action:** `CustomerController@show` — single customer with primary + extra addresses, plus embedded `documents`, `owners`, and `segment_uploads` (4 round-trips collapsed into 1).
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers/12' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/customers/{customer}
**Action:** `CustomerController@update` — update a customer; replace-all on addresses (existing rows deleted and recreated from payload). Hierarchical `edit` permission enforced.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/customers/12' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "company_name": "Reliance Exports Pvt Ltd",
  "legal_name": "Reliance Exports Private Limited",
  "type": "Distributor",
  "segment": "Rice",
  "classification": "Strategic",
  "risk_level": "Medium",
  "website": "https://relianceexports.in",
  "status": "Active",
  "primary_address": {
    "type": "Registered Office",
    "address_line": "Plot 14, MIDC Industrial Area, Andheri East",
    "country": "India",
    "state": "Maharashtra",
    "city": "Mumbai",
    "pin": "400093",
    "cp_name": "Ramesh Iyer",
    "cp_designation": "Managing Director",
    "cp_contact": "+91 9820012345",
    "cp_email": "ramesh.iyer@relianceexports.in",
    "cp_whatsapp": "yes"
  },
  "locations": []
}'
```

**Body fields:** Same rules as POST (uniqueness checks ignore the current row id).

---

### DELETE /api/customers/{customer}
**Action:** `CustomerController@destroy` — soft-delete a customer (addresses cascade). Hierarchical `delete` permission enforced.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/customers/12' \
  --header 'Authorization: Bearer {{token}}'
```

---

## CustomerDocumentController

Files land on the `public` disk under `customer_documents/{customer_id}/`. Every create/update/delete triggers `ConsigneeKycMirror::resyncForCustomer()` to keep same-as-customer consignees in sync.

### GET /api/customers/{customer}/documents
**Action:** `CustomerDocumentController@index` — list a customer's KYC documents (Company DD + Trade Licence).
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id
**Query params:** `kind` = `dd` | `tl`; `q` = search across name / license_number / issuing_authority.

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers/12/documents?kind=dd&q=IEC' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/customers/{customer}/documents
**Action:** `CustomerDocumentController@store` — upload a document (multipart). Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id

```bash
curl -X POST 'http://127.0.0.1:8000/api/customers/12/documents' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'kind=tl' \
  --form 'name=Import Export Code (IEC)' \
  --form 'license_number=0312345678' \
  --form 'issuing_authority=DGFT' \
  --form 'issue_date=2023-04-01' \
  --form 'expiry_date=2028-03-31' \
  --form 'description=Valid IEC certificate' \
  --form 'status=Active' \
  --form 'attachment=@/path/to/iec_certificate.pdf'
```

**Body fields (multipart):**
- `kind` (required, in: `dd`,`tl`)
- `name` (required, string, max 255)
- `license_number` (optional, string, max 128)
- `issuing_authority` (optional, string, max 255)
- `issue_date` (optional, date)
- `expiry_date` (optional, date, after_or_equal:issue_date)
- `description` (optional, string, max 1000)
- `status` (optional, in: `Active`,`Inactive`)
- `attachment` (optional file, mimes: jpg,jpeg,png,pdf,doc,docx, max 2 MB)

---

### GET /api/customers/{customer}/documents/{document}
**Action:** `CustomerDocumentController@show` — fetch a single document.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id, `{document}` = document id

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers/12/documents/45' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST|PUT /api/customers/{customer}/documents/{document}
**Action:** `CustomerDocumentController@update` — update a document. Use POST (multipart, method-spoofed) to replace/remove the file; use PUT (JSON) for metadata-only updates. Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id, `{document}` = document id

POST (multipart — replace file):
```bash
curl -X POST 'http://127.0.0.1:8000/api/customers/12/documents/45' \
  --header 'Authorization: Bearer {{token}}' \
  --form '_method=PUT' \
  --form 'kind=tl' \
  --form 'name=Import Export Code (IEC)' \
  --form 'license_number=0312345678' \
  --form 'issuing_authority=DGFT' \
  --form 'status=Active' \
  --form 'attachment=@/path/to/iec_certificate_v2.pdf'
```

PUT (JSON — metadata only):
```bash
curl -X PUT 'http://127.0.0.1:8000/api/customers/12/documents/45' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "kind": "tl",
  "name": "Import Export Code (IEC)",
  "license_number": "0312345678",
  "issuing_authority": "DGFT",
  "status": "Inactive"
}'
```

**Body fields:** Same rules as store. Extra flag: `remove_attachment` (boolean) deletes the existing file when no new `attachment` is sent.

---

### DELETE /api/customers/{customer}/documents/{document}
**Action:** `CustomerDocumentController@destroy` — delete a document and its file. Requires `delete` permission.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id, `{document}` = document id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/customers/12/documents/45' \
  --header 'Authorization: Bearer {{token}}'
```

---

## CustomerOwnerController

Owner KYC rows carry three file slots (`id_proof`, `address_proof`, `photograph`). Files land under `customer_documents/{customer_id}/owner-*`. Create/update/delete resync same-as-customer consignee mirrors.

### GET /api/customers/{customer}/owners
**Action:** `CustomerOwnerController@index` — list a customer's owner KYC rows.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers/12/owners' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/customers/{customer}/owners
**Action:** `CustomerOwnerController@store` — add an owner with identity-proof uploads (multipart). Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id

```bash
curl -X POST 'http://127.0.0.1:8000/api/customers/12/owners' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'owner_name=Ramesh Iyer' \
  --form 'designation=Managing Director' \
  --form 'official_email=ramesh.iyer@relianceexports.in' \
  --form 'phone_number=+91 9820012345' \
  --form 'status=Active' \
  --form 'id_proof=@/path/to/pan_AAAAA0000A.pdf' \
  --form 'address_proof=@/path/to/utility_bill.pdf' \
  --form 'photograph=@/path/to/owner_photo.jpg'
```

**Body fields (multipart):**
- `owner_name` (required, string, max 255)
- `designation` (optional, string, max 128)
- `official_email` (optional, email, max 255)
- `phone_number` (optional, regex `^\+?[0-9\s-]{7,15}$`)
- `status` (optional, in: `Active`,`Inactive`)
- `id_proof` (optional file, mimes: jpg,jpeg,png,pdf,doc,docx, max 2 MB)
- `address_proof` (optional file, mimes: jpg,jpeg,png,pdf,doc,docx, max 2 MB)
- `photograph` (optional file, mimes: jpg,jpeg,png only, max 2 MB)

---

### GET /api/customers/{customer}/owners/{owner}
**Action:** `CustomerOwnerController@show` — fetch a single owner.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id, `{owner}` = owner id

```bash
curl -X GET 'http://127.0.0.1:8000/api/customers/12/owners/7' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST|PUT /api/customers/{customer}/owners/{owner}
**Action:** `CustomerOwnerController@update` — update an owner. Use POST (multipart, method-spoofed) to replace/remove files; use PUT (JSON) for field-only updates. Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id, `{owner}` = owner id

POST (multipart — replace a file):
```bash
curl -X POST 'http://127.0.0.1:8000/api/customers/12/owners/7' \
  --header 'Authorization: Bearer {{token}}' \
  --form '_method=PUT' \
  --form 'owner_name=Ramesh Iyer' \
  --form 'designation=Chairman' \
  --form 'photograph=@/path/to/owner_photo_v2.jpg'
```

PUT (JSON — fields only):
```bash
curl -X PUT 'http://127.0.0.1:8000/api/customers/12/owners/7' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "owner_name": "Ramesh Iyer",
  "designation": "Chairman",
  "official_email": "ramesh.iyer@relianceexports.in",
  "phone_number": "+91 9820012345",
  "status": "Active"
}'
```

**Body fields:** Same rules as store. Per-slot removal flags: `remove_id_proof`, `remove_address_proof`, `remove_photograph` (boolean) delete the existing file when no replacement is uploaded.

---

### DELETE /api/customers/{customer}/owners/{owner}
**Action:** `CustomerOwnerController@destroy` — delete an owner and its three files. Requires `delete` permission.
**Auth:** Bearer token required
**Path params:** `{customer}` = customer id, `{owner}` = owner id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/customers/12/owners/7' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ConsigneeController

Mirrors CustomerController, plus a mandatory `customer_id` (each consignee belongs to a customer) and a `same_as_customer` mirror toggle (at most one mirror consignee per customer).

### GET /api/consignees
**Action:** `ConsigneeController@index` — list consignees (tenant-scoped) with primary address + linked customer.
**Auth:** Bearer token required
**Query params:** `q` = search across company_name / legal_name / consignee_code / primary_email / segment; `customer_id` = filter to one customer.

```bash
curl -X GET 'http://127.0.0.1:8000/api/consignees?q=Gulf&customer_id=12' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/consignees
**Action:** `ConsigneeController@store` — create a consignee under a customer; auto-generates `CN-###`. Cross-tenant guard on `customer_id`; only one `same_as_customer` consignee allowed per customer.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/consignees' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "customer_id": 12,
  "company_name": "Gulf Trading FZE",
  "legal_name": "Gulf Trading Free Zone Establishment",
  "segment": "Rice",
  "classification": "Standard",
  "risk_level": "Medium",
  "website": "https://gulftrading.ae",
  "status": "Active",
  "same_as_customer": false,
  "primary_address": {
    "type": "Delivery Address",
    "address_line": "Warehouse 22, Jebel Ali Free Zone",
    "country": "United Arab Emirates",
    "state": "Dubai",
    "city": "Dubai",
    "pin": "123456",
    "cp_name": "Khalid Al Mansoori",
    "cp_designation": "Procurement Head",
    "cp_contact": "+971 501234567",
    "cp_email": "khalid@gulftrading.ae",
    "cp_whatsapp": "yes"
  },
  "locations": []
}'
```

**Body fields:**
- `customer_id` (required, integer, exists:customers,id)
- `company_name` (required, string, max 255)
- `legal_name` (optional, string, max 255 — case-insensitive unique per tenant)
- `segment` (optional, string, max 1024)
- `classification` (optional, string, max 64)
- `risk_level` (optional, string, max 32)
- `website` (optional, string, max 500)
- `status` (optional, in: `Active`,`Inactive` — defaults `Active`)
- `same_as_customer` (optional, boolean) — when `true`, the `cp_email`/`cp_contact` uniqueness checks are skipped (the mirror deliberately copies the customer's contact). When `true`, `cp_contact` becomes optional.
- `primary_address` (required, array): same nested rules as customer — `.type` (required, max 64), `.address_line` (required, min 4, max 1000), `.country`/`.state`/`.city` (max 64), `.pin` (6-digit regex), `.cp_name` (required, max 255), `.cp_designation` (max 128), `.cp_whatsapp` (in: yes,no). When NOT same-as-customer: `.cp_email` (required, email regex, unique per tenant) + `.cp_contact` (required, phone regex, unique per tenant). When same-as-customer: `.cp_email` still required; `.cp_contact` nullable; no uniqueness.
- `locations` (optional, array) — same shape/rules as customer locations; in-payload email/phone duplication rejected.

---

### GET /api/consignees/{consignee}
**Action:** `ConsigneeController@show` — single consignee with addresses + linked customer, plus embedded `documents`, `owners`, `segment_uploads`, and parent `customer_locations`.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X GET 'http://127.0.0.1:8000/api/consignees/8' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/consignees/{consignee}
**Action:** `ConsigneeController@update` — update a consignee; replace-all on addresses. Hierarchical `edit` permission + cross-tenant + single-mirror guards enforced.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/consignees/8' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "customer_id": 12,
  "company_name": "Gulf Trading FZE",
  "legal_name": "Gulf Trading Free Zone Establishment",
  "segment": "Rice",
  "classification": "Standard",
  "risk_level": "Low",
  "status": "Active",
  "same_as_customer": false,
  "primary_address": {
    "type": "Delivery Address",
    "address_line": "Warehouse 22, Jebel Ali Free Zone",
    "country": "United Arab Emirates",
    "state": "Dubai",
    "city": "Dubai",
    "pin": "123456",
    "cp_name": "Khalid Al Mansoori",
    "cp_designation": "Procurement Head",
    "cp_contact": "+971 501234567",
    "cp_email": "khalid@gulftrading.ae",
    "cp_whatsapp": "yes"
  },
  "locations": []
}'
```

**Body fields:** Same rules as POST (uniqueness checks ignore the current row; `same_as_customer` defaults to the row's current value if omitted).

---

### DELETE /api/consignees/{consignee}
**Action:** `ConsigneeController@destroy` — soft-delete a consignee. Hierarchical `delete` permission enforced.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/consignees/8' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/consignees/{consignee}/clone-from-customer
**Action:** `ConsigneeController@cloneFromCustomer` — "Same as Customer" deep-clone via `ConsigneeKycMirror`. Wipes the consignee's existing KYC docs + owner rows (and on-disk files), then re-clones the customer's documents and owners (copying file attachments). Replace semantics. Both customer and consignee must be in tenant scope.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X POST 'http://127.0.0.1:8000/api/consignees/8/clone-from-customer' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "customer_id": 12
}'
```

**Body fields:**
- `customer_id` (required, integer, exists:customers,id)

Response: `{ "ok": true, "cloned": { "documents": N, "owners": M } }`.

---

## ConsigneeDocumentController

Mirrors CustomerDocumentController. Files land under `consignee_documents/{consignee_id}/`. (No mirror resync here — clone is driven from the consignee side.)

### GET /api/consignees/{consignee}/documents
**Action:** `ConsigneeDocumentController@index` — list a consignee's KYC documents.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id
**Query params:** `kind` = `dd` | `tl`; `q` = search across name / license_number / issuing_authority.

```bash
curl -X GET 'http://127.0.0.1:8000/api/consignees/8/documents?kind=dd' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/consignees/{consignee}/documents
**Action:** `ConsigneeDocumentController@store` — upload a document (multipart). Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X POST 'http://127.0.0.1:8000/api/consignees/8/documents' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'kind=dd' \
  --form 'name=Trade Licence' \
  --form 'license_number=JAFZA-99887' \
  --form 'issuing_authority=Jebel Ali Free Zone Authority' \
  --form 'issue_date=2024-01-15' \
  --form 'expiry_date=2027-01-14' \
  --form 'description=Free zone trade licence' \
  --form 'status=Active' \
  --form 'attachment=@/path/to/trade_licence.pdf'
```

**Body fields (multipart):**
- `kind` (required, in: `dd`,`tl`)
- `name` (required, string, max 255)
- `license_number` (optional, string, max 128)
- `issuing_authority` (optional, string, max 255)
- `issue_date` (optional, date)
- `expiry_date` (optional, date, after_or_equal:issue_date)
- `description` (optional, string, max 1000)
- `status` (optional, in: `Active`,`Inactive`)
- `attachment` (optional file, mimes: jpg,jpeg,png,pdf,doc,docx, max 2 MB)

---

### GET /api/consignees/{consignee}/documents/{document}
**Action:** `ConsigneeDocumentController@show` — fetch a single document.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id, `{document}` = document id

```bash
curl -X GET 'http://127.0.0.1:8000/api/consignees/8/documents/33' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST|PUT /api/consignees/{consignee}/documents/{document}
**Action:** `ConsigneeDocumentController@update` — update a document. POST (multipart, method-spoofed) replaces/removes the file; PUT (JSON) for metadata only. Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id, `{document}` = document id

POST (multipart — replace file):
```bash
curl -X POST 'http://127.0.0.1:8000/api/consignees/8/documents/33' \
  --header 'Authorization: Bearer {{token}}' \
  --form '_method=PUT' \
  --form 'kind=dd' \
  --form 'name=Trade Licence' \
  --form 'license_number=JAFZA-99887' \
  --form 'status=Active' \
  --form 'attachment=@/path/to/trade_licence_v2.pdf'
```

PUT (JSON — metadata only):
```bash
curl -X PUT 'http://127.0.0.1:8000/api/consignees/8/documents/33' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "kind": "dd",
  "name": "Trade Licence",
  "license_number": "JAFZA-99887",
  "issuing_authority": "Jebel Ali Free Zone Authority",
  "status": "Inactive"
}'
```

**Body fields:** Same rules as store. Extra flag: `remove_attachment` (boolean) clears the file when no new `attachment` is sent.

---

### DELETE /api/consignees/{consignee}/documents/{document}
**Action:** `ConsigneeDocumentController@destroy` — delete a document and its file. Requires `delete` permission.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id, `{document}` = document id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/consignees/8/documents/33' \
  --header 'Authorization: Bearer {{token}}'
```

---

## ConsigneeOwnerController

Mirrors CustomerOwnerController. Three file slots (`id_proof`, `address_proof`, `photograph`); files under `consignee_documents/{consignee_id}/owner-*`.

### GET /api/consignees/{consignee}/owners
**Action:** `ConsigneeOwnerController@index` — list a consignee's owner KYC rows.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X GET 'http://127.0.0.1:8000/api/consignees/8/owners' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/consignees/{consignee}/owners
**Action:** `ConsigneeOwnerController@store` — add an owner with identity-proof uploads (multipart). Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id

```bash
curl -X POST 'http://127.0.0.1:8000/api/consignees/8/owners' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'owner_name=Khalid Al Mansoori' \
  --form 'designation=Procurement Head' \
  --form 'official_email=khalid@gulftrading.ae' \
  --form 'phone_number=+971 501234567' \
  --form 'status=Active' \
  --form 'id_proof=@/path/to/passport.pdf' \
  --form 'address_proof=@/path/to/tenancy_contract.pdf' \
  --form 'photograph=@/path/to/owner_photo.png'
```

**Body fields (multipart):**
- `owner_name` (required, string, max 255)
- `designation` (optional, string, max 128)
- `official_email` (optional, email, max 255)
- `phone_number` (optional, regex `^\+?[0-9\s-]{7,15}$`)
- `status` (optional, in: `Active`,`Inactive`)
- `id_proof` (optional file, mimes: jpg,jpeg,png,pdf,doc,docx, max 2 MB)
- `address_proof` (optional file, mimes: jpg,jpeg,png,pdf,doc,docx, max 2 MB)
- `photograph` (optional file, mimes: jpg,jpeg,png only, max 2 MB)

---

### GET /api/consignees/{consignee}/owners/{owner}
**Action:** `ConsigneeOwnerController@show` — fetch a single owner.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id, `{owner}` = owner id

```bash
curl -X GET 'http://127.0.0.1:8000/api/consignees/8/owners/5' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST|PUT /api/consignees/{consignee}/owners/{owner}
**Action:** `ConsigneeOwnerController@update` — update an owner. POST (multipart, method-spoofed) replaces/removes files; PUT (JSON) for field-only updates. Requires `edit` permission.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id, `{owner}` = owner id

POST (multipart — replace a file):
```bash
curl -X POST 'http://127.0.0.1:8000/api/consignees/8/owners/5' \
  --header 'Authorization: Bearer {{token}}' \
  --form '_method=PUT' \
  --form 'owner_name=Khalid Al Mansoori' \
  --form 'designation=General Manager' \
  --form 'photograph=@/path/to/owner_photo_v2.png'
```

PUT (JSON — fields only):
```bash
curl -X PUT 'http://127.0.0.1:8000/api/consignees/8/owners/5' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "owner_name": "Khalid Al Mansoori",
  "designation": "General Manager",
  "official_email": "khalid@gulftrading.ae",
  "phone_number": "+971 501234567",
  "status": "Active"
}'
```

**Body fields:** Same rules as store. Per-slot removal flags: `remove_id_proof`, `remove_address_proof`, `remove_photograph` (boolean) clear the existing file when no replacement is uploaded.

---

### DELETE /api/consignees/{consignee}/owners/{owner}
**Action:** `ConsigneeOwnerController@destroy` — delete an owner and its three files. Requires `delete` permission.
**Auth:** Bearer token required
**Path params:** `{consignee}` = consignee id, `{owner}` = owner id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/consignees/8/owners/5' \
  --header 'Authorization: Bearer {{token}}'
```
