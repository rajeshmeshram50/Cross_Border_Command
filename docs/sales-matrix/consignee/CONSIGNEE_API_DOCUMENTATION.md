# CONSIGNEE MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Consignee (ship-to entity, belongs to a Customer)
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS

### 1.1 What a "Consignee" is
A **Consignee** is a recipient (ship-to) company that belongs to a **Customer** (`customer_id`). It mirrors the Customer entity (addresses, `dd`/`tl` documents, owners) **plus** a `consignee_code` (`CN-####`) and a `same_as_customer` flag. It has **no `type` and no GST-scrutiny** (Customer-only).

### 1.2 Authentication & access
All endpoints sit behind `auth:sanctum` + `user.active`. Reads are tenant-scoped (`Consignee::forUser`); the Axios client injects `?branch_id` on GETs. Mutations pass `MasterVisibility::hierarchicalDenial`. Linking to a customer is guarded by `assertCustomerInScope` (404 if the customer isn't visible).

### 1.3 Response envelope
No uniform API-Resource envelope. Shapes:

| Endpoint | Success shape | Status |
|---|---|---|
| `index` | `{ count, data[] }` (+ pagination when requested) | 200 |
| `show` | `{ data, documents[], owners[], segment_uploads{}, customer_locations[] }` | 200 |
| `store` | `{ data }` | **201** |
| `update` | `{ data }` | 200 |
| `destroy` | `{ message }` | 200 |
| `cloneFromCustomer` | `{ message, documents, owners }` (counts) | 200 |

### 1.4 Status codes
| Code | Meaning |
|---|---|
| 200 / 201 | Success (201 on create) |
| 401 / 403 | Not authenticated / inactive or not permitted |
| 404 | Consignee, doc, owner, or **parent customer** not found (or out of scope) |
| **409** | Upload attempted on a `same_as_customer` consignee |
| 422 | Validation failure — incl. a **second** `same_as_customer` per customer (`errors.same_as_customer`) |

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/consignees` | Tenant-scoped list (optional `?customer_id=`) |
| 2 | POST | `/consignees` | Create consignee (+ primary address) |
| 3 | GET | `/consignees/{consignee}` | Full detail (+ parent-customer locations) |
| 4 | PUT/PATCH | `/consignees/{consignee}` | Update (+ address replace) |
| 5 | DELETE | `/consignees/{consignee}` | Soft-delete |
| 6 | POST | `/consignees/{consignee}/clone-from-customer` | Deep-clone the customer's KYC into the consignee |
| 7 | GET/POST | `/consignees/{consignee}/documents[/{document}]` | Ad-hoc KYC documents CRUD (`dd`/`tl`) |
| 8 | GET/POST | `/consignees/{consignee}/owners[/{owner}]` | Ad-hoc owner KYC CRUD |
| 9 | GET/POST | `/segment-uploads/consignee/{id}` | Segment-rule uploads (read swaps to parent when mirror; write 409 when mirror) |
| 10 | GET | `/segment-uploads/consignee/{id}/vault` | Evidence-Vault read model |
| 11 | GET | `/clm/signature-requests?party_id=&model_name=Consignee` | Trade-document e-signatures (Zoho) |

> Consignee uses `GET /customers/master-bundle` for dropdowns (no dedicated bundle). Endpoints 9–11 are on `SegmentDocUploadController` / `ClmSignatureController` (see the Customer API doc §3.10–3.11).

---

## 3. ENDPOINT DETAIL

### 3.1 GET `/consignees`
Tenant-scoped list. `?customer_id={db_id}` narrows to one customer's consignees (used by the "Map Consignee" modal). Search matches company/legal/consignee-code/primary-email/segment (`ilike`).

**Response 200**
```json
{
  "count": 2,
  "data": [
    {
      "id": "CN-0001", "db_id": 5, "customerId": "C-0001", "customer_db_id": 1,
      "company": "Bharat Logistics", "legalName": "Bharat Logistics Pvt Ltd",
      "segment": "Dairy, Fruits", "classification": "Standard", "risk": "Low",
      "same_as_customer": true, "status": "Active",
      "country": "India", "state": "Gujarat", "city": "Surat", "pin": "395003",
      "contact": "Ravi K", "phone": "+91-9820000000", "email": "ops@bharat.example",
      "whatsapp": "Yes", "locations": [ … ], "primary_address": { … }
    }
  ]
}
```

### 3.2 POST `/consignees`
Creates a consignee + its primary address in one `DB::transaction`.

**Request body (key rules)**
```
customer_id*         integer   parent customer (must be in the caller's scope → else 404)
company_name*        string(2..30)
legal_name           string(2..100)   unique per tenant (case-insensitive) — SKIPPED when same_as_customer
segment              string(<=1024)   comma-separated multi-select
classification / risk_level           master values
website              url
status               Active | Inactive
same_as_customer     bool             (max ONE true per customer → else 422)
# primary address (required) + locations[] — same shape as Customer
primary_address.{address_line*,country,state,city,pin(^\d{6}$),cp_name*,cp_designation,
                 cp_contact(regex; unique/tenant unless mirror), cp_email(unique/tenant unless mirror), cp_whatsapp}
locations[i].*
```
- `consignee_code` auto-allocated `CN-####` **per client** under a `clients` row lock.
- When `same_as_customer = true`, legal-name / email / phone **uniqueness is skipped** (the mirror intentionally copies the customer's values).

**Response 201** — `{ "data": { "id": "CN-0001", "db_id": 5, "customerId": "C-0001", … } }` · **Errors:** 404 (customer scope) · 422.

### 3.3 GET `/consignees/{consignee}`
Full detail for the edit modal — bundles the consignee, its `documents` (`dd`/`tl`), `owners`, `segment_uploads` (`{ data, by_category, count }`), and the **parent customer's locations** (`customer_locations`) so the "Same as Customer" preview needs no extra round-trip.

**Errors:** 404.

### 3.4 PUT/PATCH `/consignees/{consignee}`
Updates fields, **replaces the address set**, guards segment removal (`SegmentGuard`), and enforces the one-mirror mutex. Same validation as create (`->ignore(id)`; uniqueness skipped when `same_as_customer`).

**Response 200** — `{ "data": { … } }` · **Errors:** 403 · 404 · 422.

### 3.5 DELETE `/consignees/{consignee}`
Soft-deletes the consignee (after `hierarchicalDenial`). **Response 200** — `{ "message": "Consignee deleted successfully" }`.

### 3.6 POST `/consignees/{consignee}/clone-from-customer`
Deep-clones the **parent customer's Stage-2 KYC** (documents + owners, **with file copies**) into the consignee — used when the Same-as-Customer toggle advances from Stage 1 → Stage 2. `DB::transaction`; **replace** semantics (wipes the consignee's existing docs/owners + files first).

**Request body**
```json
{ "customer_id": 1 }
```
**Response 200**
```json
{ "message": "Cloned from customer.", "documents": 4, "owners": 2 }
```
**Errors:** 404 (customer out of scope) · 422.

> After the initial clone, later customer edits keep the mirror in step automatically via `ConsigneeKycMirror` (core fields + addresses on customer save; KYC files on any customer document/owner change) — no client call needed.

### 3.7 Documents — `/consignees/{consignee}/documents`
`kind` = `dd` / `tl`. Same contract as the Customer nested documents (list/create/show/update/destroy; multipart; `attachment` ≤ 2 MB jpg/png/pdf/doc/docx; `remove_attachment` flag). Stored at `consignee_documents/{id}/…`.

### 3.8 Owners — `/consignees/{consignee}/owners`
Same contract as the Customer nested owners — `owner_name*`, `designation`, `official_email`, `phone_number` (regex), and `id_proof`/`address_proof`/`photograph` uploads (≤ 2 MB; photograph images only) with `remove_*` flags.

### 3.9 Segment uploads & Evidence Vault — `/segment-uploads/consignee/{id}`
Same as the Customer endpoints (`GET`/`POST`, and `GET …/vault`) but with **mirror handling**:
- **`same_as_customer = true`** → reads (list + vault) transparently return the **parent customer's** documents (payload carries `same_as_customer: true`); a **POST** upload returns **409 Conflict** (*"manage uploads on the linked customer instead"*).
- **`same_as_customer = false`** → the consignee's own uploads.

The vault payload matches the Customer vault (`company_dd` / `owner_kyc` / `trade_licenses` / `trade_documents` / `shipment_agreements` + KPIs); Trade Documents merge live Zoho status; **"Verified" is display-only**.

### 3.10 Trade-document signatures — `/clm/signature-requests`
Same as Customer, with `model_name=Consignee` and `party_id={consignee.db_id}`. Statuses `draft`/`inprogress`/`completed`/`declined`/`recalled`.

---

## 4. RELATED ENDPOINTS USED BY THE CONSIGNEE UI

| Method | Path | Purpose |
|---|---|---|
| GET | `/customers?tab=all` | Customer list for the Phase-A picker |
| GET | `/customers/{id}` | Parent customer detail (locations for the mirror preview) |
| GET | `/customers/master-bundle` | Dropdowns (segments/classifications/risk/countries/states/designations) |
| GET | `/clm/segment-rules/for-segment/{segmentId}` | Required/optional docs per segment (Stage-2 reference tables) |
| GET | `/clm/trade-doc-library/for-party/consignee` | Trade-document library filtered to party = Consignee |

---

## 5. ERROR RESPONSE EXAMPLES

**409 — same-as-customer upload**
```json
{ "message": "This consignee is flagged Same as Customer. Manage uploads on the linked customer instead." }
```
**422 — second mirror**
```json
{ "message": "This customer already has a Same-as-Customer consignee.",
  "errors": { "same_as_customer": ["Only one Same-as-Customer consignee is allowed per customer."] } }
```
**404 — parent customer out of scope**
```json
{ "message": "No query results for model [App\\Models\\Customer] 999" }
```

---

## 6. QUICK REFERENCE — TYPICAL FLOW

```
GET  /customers?tab=all                            # pick parent customer (Phase A)
POST /consignees {customer_id, same_as_customer}   # create + primary address (201)
POST /consignees/{id}/clone-from-customer          # (if mirror) copy customer KYC
GET  /consignees?customer_id={db_id}               # list a customer's consignees
GET  /consignees/{id}                              # detail (+ customer locations)
GET  /segment-uploads/consignee/{id}/vault         # Evidence Vault (parent's docs if mirror)
PUT  /consignees/{id}                              # edit (replaces addresses)
DELETE /consignees/{id}                            # soft-delete
```

---

## 7. SECURITY NOTES (consignee-facing caveats)

1. **Parent-customer scope guard** — you can only link a consignee to a customer you can see (404 otherwise).
2. **One mirror per customer** — a second `same_as_customer` is rejected (422).
3. **Mirror uploads blocked** — a `same_as_customer` consignee can't upload directly (409); its vault reflects the parent customer.
4. **No GST scrutiny** — the consignee has no GST endpoints (Customer-only).
5. **Address edits replace the set**; uploads capped at 2 MB on the public disk.

---

*Related documents: CONSIGNEE_TECHNICAL_DOCUMENTATION.md · CONSIGNEE_FUNCTIONAL_DOCUMENTATION.md · CONSIGNEE_CODE_WALKTHROUGH.md*
