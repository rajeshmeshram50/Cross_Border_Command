# P2P SUPPLIER MANAGEMENT

## Complete API Documentation

**Module:** P2P Supplier Management  
**Menu Path:** Procure to Pay (P2P) → P2P Master Management → Supplier Management  
**Technology Stack:** Laravel, PHP, React, TypeScript, PostgreSQL  
**Backend:** Laravel REST APIs  
**Frontend:** React / TypeScript  
**API Base URL:** `/api`  
**API Prefix:** `/vendors` (plus `/segment-uploads/supplier` and `/p2p/new-suppliers`)  
**Authentication:** Laravel Sanctum  
**Controller:** `App\Http\Controllers\Api\VendorController`  
**Document Type:** API Documentation — Backend API Reference & Integration Guide  

---

## CONTENTS

1. API Overview
2. Supplier List and Lookup APIs
3. Stage 1 — Identity and Contacts APIs
4. Stage 2 — KYC, Bank and GST Scrutiny APIs
5. Product and Service Mapping APIs
6. Documents and Evidence Vault APIs
7. Convert to Supplier APIs
8. Other Endpoints the Supplier Screens Call
9. curl API Testing Reference
10. Complete API Endpoint Reference
11. Known API Gaps
12. Important Implementation Notes

---

## 1. API OVERVIEW

### 1.1 General Configuration

| Configuration | Details |
|---|---|
| Base URL | `/api` |
| Authentication | `Authorization: Bearer <sanctum token>` |
| Middleware | `auth:sanctum` → `user.active` → `tenant` (the main authenticated group in `routes/api.php`) |
| Main controller | `App\Http\Controllers\Api\VendorController` (**VC**) |
| Documents and vault | `SegmentDocUploadController` (**SDU**) |
| Convert to Supplier | `App\Http\Controllers\Api\P2p\SourcingController` |
| Server-set fields | `client_id`, `branch_id`, `created_by` come from the signed-in user, **never** from the request body |
| Naming | The table is `vendors` and the routes say `/vendors`; the screens say **Supplier** — the same thing |
| Code references | By function name (e.g. `VC::storeContacts()`), not line numbers |

### 1.2 API Response Structure

There is **no single envelope**.

| Endpoint group | Success shape |
|---|---|
| `GET /vendors` | The Laravel paginator (`current_page`, `data[]`, `total`, …) **plus** `facets` |
| `GET /vendors/{id}`, every `step/*` | `{ "data": <supplier> }` (`GET /vendors/{id}` adds `segment_uploads`) |
| Contacts, banks, GST scrutiny | `{ "data": <row> }` (201 on create) · delete: `{ "message": "… deleted" }` |
| Service-mapping PATCH / DELETE | The row object itself, **not** wrapped in `data` |
| Convert to Supplier | `{ "status": true, "data": { … } }` |

**Standard Error Responses**

| HTTP Status | When | Response |
|---|---|---|
| 401 | No / bad token | `{"message":"Unauthenticated."}` |
| 401 | User, client or branch inactive (tokens revoked) | `{"message":"Account is no longer active. Please sign in again."}` |
| 403 | Service mappings only — you may not edit that **service** (`ServiceSupplierMapping::serviceEditDenial()` → `MasterVisibility::hierarchicalDenial()` on the Service) | `POST step/services`: `{"message":"{SERVICE_CODE}: {reason}"}` · `PATCH` / `DELETE service-mappings/{map}`: `{"message":"{reason}"}` |
| 404 | Not found, **or a supplier outside your read scope** | `No query results for model [App\Models\Vendor] {id}` |
| 409 | Removing a segment would delete documents only it uses | See 3.2 |
| 422 | Validation and business rules | `{"message":"…","errors":{"field":["…"]}}` |

**Field labels in 422 messages** are relabelled (`VendorController::FIELD_LABELS`,
e.g. `vendor_type_id` → "supplier type", `gst_number` → "GST Number") **only**
in `storeIdentity`, `storeContacts`, `validateContact`, `validateGst`,
`storeKyc` and `storeProducts`. `validateBank()` passes the labels as an ignored
4th argument; `storeServices`, `updateServiceMapping` and `SDU::store()` pass none.

> **Important — Tenant Visibility:** every `/vendors/{id}` is resolved through
> `Vendor::scopeForUser`. A supplier outside your scope returns **404**, not
> 403, so its existence is never confirmed.

### 1.3 Supported Field Values

| Field | Allowed values |
|---|---|
| Supplier `status` | `draft`, `inactive`, `active` |
| `supplier_category` | `star`, `general`, `high_risk`, `blacklisted` |
| `gst_applicable` | `Yes`, `No` |
| List `scope` | `domestic`, `international` (anything else = both) |
| List `compliance` | `compliant`, `non_compliant` |
| Service mapping `origin` | `domestic`, `international` |
| Service mapping `status` | `active`, `inactive` |
| `gst_type` (service mapping, computed) | `intra`, `inter`, `none` |
| Document `category` | `kyc`, `dd`, `tl`, `td`, `qc` |
| Document `requirement` | `M`, `O` |
| Owner KYC / GST scrutiny `status` | `Active`, `Inactive` |
| `{type}` in `/segment-uploads/{type}` | `supplier` (or `vendor`) |

### 1.4 Access Checks

| Layer | Rule |
|---|---|
| Read scope (`Vendor::scopeForUser`) | Branch users and employees see their own client's rows with **no branch or their own branch**; client admin / client user see **every branch** of their client; rows with `client_id` NULL are visible to everyone |
| Row edit / delete (`MasterVisibility::hierarchicalDenial`) | Returns "allowed" for every supplier by design — a supplier is shared data that anyone with supplier access maintains |
| Service-mapping writes | Also check whether you may edit each **service** — this *can* return 403 (e.g. an employee and a service another user created outside their branch) |
| Page access | The `/suppliers` screen is limited to branch users and employees in the browser, but `routeAccess.ts canAccessPath()` does not check `p2p.supplier` for that URL, and the API checks **no supplier permission** |
| `/segment-uploads/supplier/{id}` | Checks the **client** only — a supplier in another branch of the same client is reachable (Section 6) |
| Convert endpoints | Company only — no permission, creator or assignee check |

### 1.5 Limits and Conventions

| Item | Rule |
|---|---|
| Files | **2048 KB** (2 MB) |
| Rate limit | None |
| `GET /vendors` `per_page` | **No cap** (default 24); no `validate()` |
| Supplier service price | > 0, ≤ 9,999,999,999.99 |
| Exchange rate | > 0, ≤ 99,999.9999 |
| Total / ₹ value | ≤ 999,999,999,999.99 (`SupplierPricing::assertFits()`) |
| **Multipart updates** | PHP does not read a multipart body on a real `PUT`. Send file-carrying updates as **`POST` with `_method=PUT`** (as the screens do). There is no `POST` alias for those routes |

---

## 2. SUPPLIER LIST AND LOOKUP APIS

### 2.1 Get All Suppliers

**Endpoint:** `GET /api/vendors`

**Purpose:** Paginated supplier list with filters and facet counts.

**Query Parameters**

| Parameter | Description |
|---|---|
| `q` | Case-insensitive search on company / legal name, code, primary email, GSTIN, category (`high risk` matches `high_risk`), any contact's name / phone / email / city / state code, primary state and country, Supplier Type, segment names |
| `scope` | `domestic` (primary country India, or none) · `international` (any other country) · anything else = both |
| `categories` | CSV of `star,general,high_risk,blacklisted` |
| `compliance` | CSV of `compliant,non_compliant` |
| `status` | `draft` · `inactive` · `active` — exact match, applied right after `q`, so it narrows **every** facet too |
| `tab` | `recurring` → `whereRaw('1 = 0')`, returns nothing (not built) |
| `per_page` | Default **24**, no cap |
| `page` | 1-based |
| `branch_id` | BranchSwitcher (client admin / client user only; a branch outside your client is ignored) |
| `light=1` | Picker shape (see below) — every other parameter is ignored **except `branch_id`** |

There is **no `kind` filter** (Material / FFD / Services tabs are worked out in
the browser) and no `validate()`: `per_page` is only `(int)`-cast, `%` / `_` in
`q` act as wildcards, and a bad value never returns 422.

**What the Supplier list sends**

```
GET /api/vendors?scope=domestic&tab=all&page=1&per_page=12[&q=…][&categories=…][&compliance=…]   (the list)
GET /api/vendors?…&page=1&per_page=1000                                                         (type tabs and counts)
GET /api/vendors?…&page=1&per_page=1                                                            (Filter popup live count)
```

**Facets (added to the paginator)**

```json
"facets": {
  "grand_total": 27,
  "scope":      { "domestic": 25, "international": 2 },
  "category":   { "star": 0, "general": 27, "high_risk": 0, "blacklisted": 0 },
  "compliance": { "compliant": 20, "non_compliant": 7 }
}
```

Facets are counted **after** `q`, `status`, `scope` and `tab` and **before**
`categories` / `compliance`. `scope` counts are taken after `q` and `status`
but **before** `scope` and `tab`, so they ignore the chosen scope and tab.

**Each Row** — the `Vendor` model plus:

| Key | Meaning |
|---|---|
| `compliance_status` | `"Compliant"` or `"Non Compliant"` (server-computed). With no client id for the user (e.g. super admin) nothing is computed: every row says `"Compliant"` while `facets.compliance` is 0 / 0 |
| `product_mappings_count` | Mapped products |
| `opportunity_count` | Always `0` (hard-coded `DB::raw('0 as opportunity_count')`) |
| `segment` | `{id, name, regulatory_status}` — the first segment (`vendors.segment_id`), besides `segments[]` |
| `primary_address` | `{city, state_code, contact_name, email, contact_no, designation, state{id,name}, country{id,name}}` |
| `addresses[]` | Every contact row |
| `vendor_type` | `{id, name, kind, service_type, classification}` |
| `segments[]` | `{id, name, regulatory_status}` |
| `risk_level`, `compliance_behaviour` | `{id, name}` |

**Picker shape (`light=1`)**

```json
{ "count": 2, "data": [ { "id": 31, "db_id": 31, "vendor_code": "S-031", "company_name": "ABC Logistics",
  "country": "India", "mobile": "9876543210", "primary_email": "priya@abc.in" } ] }
```

Ordered by company name; unpaged.

### 2.2 Get Master Bundle

**Endpoint:** `GET /api/vendors/master-bundle`

**Purpose:** Every dropdown the wizard needs, in one call.

**Caching:** 5 minutes per user (`MasterBundleCache` key
`vendor:master-bundle:user:{id}:v{version}`).

**Rules:** each list is `LOWER(status) = 'active'`, limited to your read scope
(`MasterVisibility::applyReadScope` — own client plus global `client_id` NULL
rows; employees on `master_*` tables also by branch), ordered by id. No request
parameters; no error besides 401.

**Returned Sections**

| Section | Fields |
|---|---|
| `vendor_types` | `id, name, kind, service_type, classification, group` |
| `risk_levels` | `id, name` |
| `vendor_behaviour` | `id, name` |
| `segments` | `id, code, name, regulatory_status` |
| `compliance_behaviours`, `classifications`, `address_types`, `countries` | `id, name` |
| `states` | `id, name, country_id` |
| `state_codes` | `id, state_id, state_code, status, state{id,name,country_id}` (ordered `statutoryFirst()`) |
| `license_name` | `id, name` |
| `gst_percentage` | `id, percentage` |

**Supplier Behaviour (commit `cdc5aff67`):** the wizard's Supplier Behaviour
dropdown is built from `vendor_behaviour` — valued by **name**, de-duplicated
case-insensitively. The four fixed values are used only when the master returns
no rows (a new tenant). A saved behaviour that is no longer active is kept in
the list, so editing never blanks it.

### 2.3 Get Supplier Details

**Endpoint:** `GET /api/vendors/{id}`

**Query Parameters**

| Parameter | Description |
|---|---|
| `lite=1` | Short shape: names, GSTIN, category, type, segments, primary address, GST scrutiny, product prices — with an empty `segment_uploads` |

**Full Response:** `{ "data": <supplier>, "segment_uploads": {data[], by_category, count} }`

`<supplier>` carries identity (incl. `status`, `step_completed`, `client_id`,
`branch_id`, `created_by`, `primary_email`), masters (ids **and** names: type,
risk level, behaviour, segment, compliance behaviour, classification),
`segment_ids[]`, `segments[]`,
`primary_address{…, whatsapp_enabled, attachment_url}`, `extra_contacts[]`,
`due_diligence[]`, `owner_kyc[]`, `trade_licenses[]`, `bank_accounts[]`,
`gst_scrutiny[]`, `product_mappings[]`, and the **lock flags**:

| Flag | Meaning |
|---|---|
| `vendor_type_lock` | `"po"`, `"spi"` or `null` — Supplier Type can't change |
| `state_locked` | `true` when any Purchase Order exists, a draft included (UI lock only; the form then locks Country, State, State Code and GST / TIN) |
| `locked_segments` | Segment ids that can't be removed |
| `locked_segment_reasons` | `{"<segId>": "po" \| "spi" \| "product"}` — strongest wins |
| `segment_required_doc_keys` | `{"<segId>": ["kyc\|PAN", …]}` |
| `uploaded_doc_keys` | `["kyc\|PAN", …]` |

### 2.4 Get Supplier Product Mappings

**Endpoint:** `GET /api/vendors/{id}/product-mappings`

**Example Response**

```json
{ "data": [ { "id": 1, "product_id": 5, "product_code": "P-001", "product_name": "…",
              "hsn_sac_code": "…", "segment": "…", "segment_regulatory_status": "High",
              "batch_serial_lot": null,
              "purchase_price": "100.00", "gst_percentage": "18.00", "gst_amount": "18.00",
              "total_amount": "118.00" } ],
  "meta": { "vendor_id": 1, "vendor_code": "S-001", "vendor_name": "…", "count": 1 } }
```

Amounts are **decimal strings with two places** (`decimal:2` casts on
`VendorProductMapping`). Ordered by mapping id.

### 2.5 Delete a Supplier

**Endpoint:** `DELETE /api/vendors/{id}`

**Purpose:** Soft-delete a supplier and remove its files.

| Step | Detail |
|---|---|
| Lookup | `Vendor::forUser()->findOrFail` (404) |
| Check | `MasterVisibility::hierarchicalDenial(…, 'delete')` → 403 (returns null for suppliers in practice) |
| Files | Deletes every due diligence, owner KYC, cheque and contact attachment from the `public` disk (`deleteAllVendorFiles()`) |
| Delete | `$vendor->delete()`; master-bundle cache bumped |

**Response:** `{ "id": 31, "deleted": true }`

> **Note:** **no Supplier screen calls this endpoint.**

---

## 3. STAGE 1 — IDENTITY AND CONTACTS APIS

### 3.1 Create or Update Supplier Identity

**Endpoint:** `POST /api/vendors/step/identity`
**Content Type:** JSON

**Operation Rules**

| Condition | Operation |
|---|---|
| No `id` | Create (status `draft`) |
| `id` provided | Update |

**Request Fields**

| Field | Validation |
|---|---|
| `id` | `nullable\|integer\|exists:vendors,id` |
| `company_name`, `legal_name` | `required\|string\|max:255` (the form caps at 100) |
| `website` | `nullable\|string\|max:500` |
| `vendor_type_id` | `nullable\|integer\|exists:master_vendor_types,id` — **what the screen sends** (with `vendor_type: null`) |
| `vendor_type` | Name, e.g. `"Material/ Goods"` — resolved per tenant (`firstOrCreate`) and **wins over `vendor_type_id`**; the screen uses it only as a fallback |
| `vendor_behaviour` | `nullable\|string\|max:255`. Name, e.g. `"Genuine"` — resolved with `VendorBehaviour::firstOrCreate(['client_id' => your client, 'name' => trim(name)], ['branch_id', 'status' => 'Active', 'created_by'])`; wins over `vendor_behaviour_id`. The screen sends a name from the Supplier Behaviour master. The match is exact and per client: a name that exists only as a global row, or differs in case / spacing, creates a new tenant row |
| `vendor_behaviour_id` | `nullable\|integer\|exists:master_vendor_behaviour,id` (the screen sends the name instead) |
| `risk_level_id` | `nullable\|integer\|exists:master_risk_levels,id` |
| `segment_ids` | Array or CSV of `clm_segments` ids. **Only ids whose `client_id` equals your client are kept** — a global segment (`client_id` NULL) is silently dropped. `segment_id` = the first kept id |
| `segment_id` | `nullable\|integer\|exists:clm_segments,id` — fallback when `segment_ids` is empty |
| `classification_id` | `nullable\|integer\|exists:master_customer_classifications,id` |
| `compliance_behaviour_id` | `nullable\|integer\|exists:master_compliance_behaviours,id` |
| `supplier_category` | `nullable\|in:star,general,high_risk,blacklisted` |
| `gst_applicable` | `nullable\|in:Yes,No` |
| `gst_number` | `nullable\|string\|max:30` — GSTIN (domestic) or TIN (international). A **GSTIN** is not format-checked and **not required** on the server; a **TIN** is required and must match `^[A-Za-z0-9-/. ]{3,30}$`. Uniqueness is checked only when `gst_applicable = Yes` and a number is sent |
| `address` | `nullable\|array` |
| `address.address_line` | `nullable\|string\|max:1000` (the form caps at 200) |
| `address.country_id` · `address.state_id` | `nullable\|integer`, `exists` on `master_countries` / `master_states` |
| `address.state_code` | `nullable\|string\|max:32` |
| `address.city` | `nullable\|string\|max:128` (the form caps at 60) |
| `address.pincode` | `nullable\|string\|max:16` |
| `address.google_location` | `nullable\|string\|max:1000`, must match `^https?://\S+$` |
| `confirm_segment_doc_removal` | `1` to confirm the 409 (3.2). **The Supplier screen never sends it** |

**Example Request (as the screen sends — create)**

```json
{ "id": null, "company_name": "ABC Logistics", "legal_name": "ABC Logistics Pvt Ltd",
  "website": "www.abclogistics.com", "gst_applicable": "Yes", "gst_number": "27ABCDE1234F1Z5",
  "vendor_type_id": 1, "vendor_type": null, "risk_level_id": 2, "vendor_behaviour": "Genuine",
  "segment_id": 4, "segment_ids": [4, 7], "supplier_category": "general",
  "address": { "address_line": "Plot 21, Industrial Area", "country_id": 1, "state_id": 14,
               "state_code": "27", "city": "Pune", "pincode": null, "google_location": null } }
```

International: `"gst_applicable": "No"`, `"gst_number": "GB123456789"` (the TIN),
no State Code needed. On update `id` is the supplier id.

**Example Response:** **200** `{ "data": <supplier> }`

**Set by the server, ignored if sent:** `vendor_code` (`S-NNN`, per branch),
`status` (`draft` on create), `step_completed`, `client_id`, `branch_id`,
`created_by`, `primary_email`.

**Validation Messages** — Laravel defaults with `FIELD_LABELS` (e.g. *The
supplier type field must be an integer.*, *The selected country is invalid.*,
*The company name field is required.*).

**Business-Rule 422s**

| Rule | Message |
|---|---|
| International without a TIN | *Tax Identification Number (TIN) is required for an international supplier.* (`errors.gst_number`: *Tax Identification Number (TIN) is required.*) |
| Bad TIN | *Tax Identification Number (TIN) is invalid.* (`errors.gst_number`: *TIN must be 3–30 characters: letters, digits, hyphen, slash, period and spaces only.*) |
| India with `gst_applicable` ≠ Yes | *GST is mandatory for an Indian supplier — set GST Applicable to Yes.* (`errors.gst_applicable`: *GST is mandatory for an Indian supplier.*) |
| GSTIN already used in the company | *GST number X is already registered to another supplier.* (`errors.gst_number`: *This GST number is already registered to another supplier.*) |
| Supplier Type locked — a **committed** PO (`SegmentGuard::PO_COMMITTED`: submitted / sent for sign / signed / approved) or Supplier Invoice (`SPI_COMMITTED`: mapped / grn_pending / closed). A draft PO does not lock; it only sets `state_locked` | *This supplier is already on a Purchase Order \| a Supplier Invoice, so its Supplier Type can no longer be changed.* (`errors.vendor_type`) |
| Removing a segment of a mapped product | *This Segment cannot be removed because the Supplier is currently associated with one or more Products under this Segment. Please remove the Product dependency before removing this Segment.* (`errors.segment_ids`: *Segment(s) mapped to a supplier product cannot be removed: X.*) |
| Removing a segment used on a PO / Supplier Invoice | *Cannot remove X — a product on a Purchase Order or Supplier Invoice belongs to it.* (`errors.segment_ids`: *Segment(s) used by a PO / Supplier Invoice product cannot be removed: X.*) |
| GSTIN does not start with the State Code | *GST Number must start with the state code NN.* — **never returned today** (see 11.2) |

**Important**
* The "segment must have a Document Control Panel rule for this origin" rule is **browser-only** — the server does not check it.

### 3.2 The 409 — Documents Only a Removed Segment Uses

```json
{ "requires_doc_confirmation": true,
  "message": "Removing this segment will delete 2 document(s) used only by it. Shared documents are kept. Confirm to proceed.",
  "orphan_documents": [ { "id": 12, "name": "PAN.pdf", "category": "kyc" } ] }
```

Resend with `confirm_segment_doc_removal=1` to delete them in the same save. The
Supplier screen **never** sends that flag: `saveIdentity()` catches the 409,
shows *"Cannot remove segment — … Delete them in KYC / Due Diligence first, then
remove the segment."* and puts the saved segments back. The confirm-and-delete
branch is reachable only by a direct API call.

### 3.3 Save the Primary Contact

**Endpoint:** `PUT /api/vendors/{id}/step/contacts`
**Content Type:** multipart — send as `POST` + `_method=PUT`

**Request Fields**

| Field | Validation |
|---|---|
| `primary_address` | `required\|array` — the address fields of 3.1 (same limits), plus `address_type` (`nullable\|max:64`) and: |
| `primary_address.contact_name` | `required\|string\|max:255` |
| `primary_address.designation` | `nullable\|max:128` |
| `primary_address.contact_no` | `nullable\|max:32` |
| `primary_address.email` | `nullable\|email\|max:255` |
| `primary_address.whatsapp_enabled` | `nullable\|boolean` |
| `primary_address.attachment_path` | `nullable\|string\|max:500` — keep the existing file (omit it and send no file to drop the card) |
| `primary_attachment` | `nullable\|file\|mimes:jpg,jpeg,png,webp,pdf\|max:2048` — wins over `attachment_path` |
| `convert_supplier_id` | `nullable\|integer` — Convert to Supplier only; **links** the New Supplier to this supplier (Section 7) |

**Example Request (as the screen sends)**

```
POST /api/vendors/31/step/contacts   (multipart)
_method=PUT
primary_address[address_type]=Registered Office   primary_address[address_line]=Plot 21, Industrial Area
primary_address[country_id]=1   primary_address[state_id]=14   primary_address[state_code]=27
primary_address[city]=Pune   primary_address[pincode]=   primary_address[google_location]=
primary_address[contact_name]=Priya Sharma   primary_address[designation]=Manager
primary_address[contact_no]=9876543210   primary_address[email]=priya@abc.in
primary_address[whatsapp_enabled]=1
primary_attachment=<File>   (or primary_address[attachment_path]=<kept path>)
convert_supplier_id=4       (Convert to Supplier only)
```

**Example Response:** `{ "data": <supplier> }`

**Validation Messages**

| Case | Message |
|---|---|
| Email used by any supplier or New Supplier in **any** client (`EnforcesUniqueEmail`, scope `vendor`, `tenant => false`) | 422 `errors.primary_email` *This email address is already used by another vendor or supplier in the system. Please use a different address.* |
| `convert_supplier_id` not in your client, or converted into a **different** supplier | 422 `errors.convert_supplier_id` *This New Supplier cannot be converted into this supplier.* |

**Important**
* Replaces **only** the primary row — it is deleted and inserted again, so its `id` changes on every save; extra contacts are untouched.
* The new row is built **only** from `primary_address[...]`: send the address fields too (as the screen does), or the Stage 1 address is **blanked**.
* Sets `vendors.primary_email` (lower case); `vendor_addresses.email` is stored **as sent** (mixed case kept).
* The primary email is not checked against the extra contacts' emails.
* With `convert_supplier_id`, the link happens in the same request; the response shape does not change.

### 3.4 Extra Contacts

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/vendors/{id}/contacts` | Add a contact |
| PUT | `/api/vendors/{id}/contacts/{contact}` (send as `POST` + `_method=PUT`) | Edit a contact |
| DELETE | `/api/vendors/{id}/contacts/{contact}` | Delete a contact |

**Request Fields (multipart)**

| Field | Validation |
|---|---|
| `contact_name` | `required\|string\|max:255` |
| `designation` | `nullable\|string\|max:128` |
| `contact_no` | `nullable\|string\|max:32` |
| `email` | `nullable\|email\|max:255` (lower-cased) |
| `whatsapp_enabled` | `nullable\|boolean` |
| `attachment` | `nullable\|file\|mimes:jpg,jpeg,png,webp,pdf\|max:2048` |
| `attachment_path` | `nullable\|string\|max:500` |
| `remove_attachment` | Update only: `1` drops the file |

**Example Request (as the screen sends)**

```
contact_name=Ravi Kumar   designation=Accounts   contact_no=9123456780
email=ravi@abc.in   whatsapp_enabled=1   attachment=<File>  (or attachment_path / remove_attachment=1)
```

**Responses**

| Action | Response |
|---|---|
| Create | **201** `{data:{id, contact_name, designation, contact_no, email, whatsapp_enabled, attachment_path, attachment_url}}` |
| Update | 200 |
| Delete | `{"message":"Contact deleted"}` |
| Primary contact id | 404 (not reachable here) |

> **Note:** no email uniqueness check on the server (the screen checks
> duplicates within the supplier).

---

## 4. STAGE 2 — KYC, BANK AND GST SCRUTINY APIS

### 4.1 Save Legacy KYC Lists

**Endpoint:** `POST /api/vendors/{id}/step/kyc`
**Content Type:** multipart

**Request Fields**

| Field | Validation |
|---|---|
| `due_diligence[]`, `owner_kyc[]`, `trade_licenses[]` | Arrays of rows |
| `dd_files[i]`, `owner_files[i]`, `tl_files[i]` | Each `jpg,jpeg,png,webp,pdf`, 2 MB |
| `*.existing_path` | Keeps the row's current file |
| `due_diligence.*.document_name`, `owner_kyc.*.document_name` | **required** |
| `*.code` | ≤ 32 |
| `owner_kyc.*.status` | `Active` / `Inactive` |
| `trade_licenses.*.license_type_id` | must exist in `master_license_name` |

**Example Response:** `{ "data": <supplier> }` (messages relabelled by `FIELD_LABELS`)

**Important**
* **Replace-all** for these three lists. Files not echoed back are deleted.
* Bank accounts and GST scrutiny are **not** touched.
* Moves the supplier **`draft` → `inactive`**, `step_completed ≥ 2`. The screen calls it on every Stage 2 Save & Next and on Save / Update Supplier, usually with **empty** lists, so the first Stage 2 Save & Next makes the supplier `inactive` even with no document.
* Files go to `vendor_documents/{id}/{dd|owner|tl}-{8 hex}__{name}.{ext}`; an `existing_path` is not checked to belong to this supplier.

> The documents the screens actually show and that compliance reads are the
> **segment uploads** (Section 6), not these lists.

### 4.2 Bank Accounts

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/vendors/{id}/bank-accounts` | Add a bank account |
| PUT | `/api/vendors/{id}/bank-accounts/{bank}` (send as `POST` + `_method=PUT`) | Edit (not used by the screen) |
| DELETE | `/api/vendors/{id}/bank-accounts/{bank}` | **Hard** delete — `{"message":"Bank account deleted"}` |

**Request Fields**

| Field | Domestic | International |
|---|---|---|
| `bank_name`, `branch_name` | `required\|string\|max:255` | same |
| `account_number` | `^[0-9]{9,18}$` — *Account Number must be 9–18 digits.* | `^[A-Za-z0-9]{8,34}$` — *…8–34 letters or digits, with no spaces.* |
| `ifsc` | IFSC `^[A-Za-z]{4}0[A-Za-z0-9]{6}$` — *IFSC Code is invalid (format: 4 letters + 0 + 6 characters, e.g. HDFC0001234).* | SWIFT / BIC `^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$` — *SWIFT / BIC is invalid (8 or 11 characters: 6 letters then alphanumeric, e.g. HDFCINBB or HDFCINBBXXX).* |
| `branch_address` | optional, ≤ 500 | same |
| `cheque` / `cheque_path` | `nullable\|file\|mimes:jpg,jpeg,png,webp,pdf\|max:2048` / `nullable` — **optional on the server** (the screen requires a cheque); an update without a file keeps the old cheque | same |

Domestic vs international is decided by the **primary address country** (no
country = domestic).

**Example Request (as the screen sends)**

```
bank_name=HDFC Bank   branch_name=Andheri   account_number=50100123456789
ifsc=HDFC0001234   branch_address=   cheque=<File>
```

**Example Response (201):** `{ "data": {id, bank_name, branch_name, account_number, ifsc, branch_address, cheque_path, cheque_url} }`

**Validation Messages**

| Case | Message |
|---|---|
| Repeated account number | *This account number is already added for this supplier.* |
| `bank_name` / `branch_name` | Laravel defaults with raw field names (labels ignored) |

**Important:** `ifsc` is stored **upper-cased** (the SWIFT / BIC goes into the same column).

### 4.3 GST Scrutiny

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/vendors/{id}/gst-scrutiny` | Add a row (JSON) |
| PUT | `/api/vendors/{id}/gst-scrutiny/{gst}` | Edit (not used by the screen) |
| DELETE | `/api/vendors/{id}/gst-scrutiny/{gst}` | **Hard** delete — `{"message":"GST scrutiny deleted"}` |

**Request Fields (labels applied)**

| Field | Validation |
|---|---|
| `gst_number` | `required\|string\|max:16` (upper-cased) |
| `status` | `nullable\|in:Active,Inactive` (default `Active`) |
| `last_filing_date` | `nullable\|date` (no future check on the server) |
| `prev_non_gst_2a_invoice` | `nullable\|string\|max:255` |
| `red_flags` | `nullable\|string\|max:2000` |

**Example**

```json
POST /api/vendors/31/gst-scrutiny
{ "gst_number": "27ABCDE1234F1Z5", "status": "Active", "last_filing_date": "2026-10-20",
  "prev_non_gst_2a_invoice": null, "red_flags": null }
→ 201 { "data": { "id": 9, "gst_number": "27ABCDE1234F1Z5", "status": "Active",
                  "scrutiny_date": "2026-11-23", "last_filing_date": "2026-10-20",
                  "prev_non_gst_2a_invoice": null, "red_flags": null } }
```

**Validation Messages**

| Case | Message |
|---|---|
| GSTIN used by another supplier of the client (`vendors.gst_number` or its scrutiny rows) | 422 *GST number X is already registered to another supplier.* (`errors.gst_number`: *This GST number is already registered to another supplier.*) |

**Important:** after every save **all** the supplier's scrutiny rows are set to
the same GSTIN — but `vendors.gst_number` (Stage 1) is **not** updated.

---

## 5. PRODUCT AND SERVICE MAPPING APIS

### 5.1 Replace Product Mappings

**Endpoint:** `POST /api/vendors/{id}/step/products` — **replace-all**
**Content Type:** JSON

**Request Fields**

| Field | Validation |
|---|---|
| `mappings` | `present\|array` — an empty array removes every mapping |
| `mappings.*.product_id` | `required\|integer\|exists:products,id` |
| `mappings.*.batch_serial_lot` | `nullable\|string\|max:128` |
| `mappings.*.purchase_price` | `required\|numeric\|min:0` |
| `gst_percentage`, `gst_amount`, `total_amount` | `nullable\|numeric\|min:0` (missing → `0`, `0`, `purchase_price`). Stored **as sent** — not recomputed from the product's GST. Always in ₹ (no currency fields), also for an international supplier |

**Example Request**

```json
{ "mappings": [
    { "product_id": 5, "purchase_price": 100, "gst_percentage": 18,
      "gst_amount": 18, "total_amount": 118 } ] }
```

**Example Response:** `{ "data": <supplier> }`

**Validation Messages**

| Case | Message |
|---|---|
| A product twice | 422 *A product can only be mapped once per supplier.* (no `errors` key) |
| A product with no GST rate (`products.gst_id` NULL — CS-2327, `da7a6d271`) | 422 `{ "message": "These products have no GST rate and cannot be mapped to a supplier — set a GST on the product first: Bolt M8, Gasket.", "errors": { "mappings": ["One or more products have no GST rate mapped."] } }` |
| Field rules | Laravel defaults with `FIELD_LABELS` (e.g. *The mappings.0.purchase_price field must be at least 0.*) |

A product whose GST is a real 0 % (a `gst_id` pointing at a 0 % row) passes.

**Important**
* **Always send the full list.** A request with one row unmaps everything else.
* The GST check covers the **whole** list, so an already-mapped product that has lost its GST blocks every later save — including the one *Save / Update Supplier* makes. The wizard pre-checks the picked product (*"GST required — …"*); the list popup does not.
* No tenant, segment or status check on the product — only `exists:products,id`.
* All current mappings are **hard-deleted and re-created** — **without** `origin`, `currency_code`, `exchange_rate` and `inr_amount`, so values the Product side wrote (`PUT /products/{id}/step/vendors`, `PATCH` / `DELETE /products/{id}/vendor-maps/{mapId}`) are lost — and mirrored to `product_vendor_maps` (rows no longer listed are deleted there). The force-delete goes through the relation, so already soft-deleted mapping rows are not removed.
* Every listed product becomes `active` with `step_completed ≥ 4` on every save (an inactive product is re-activated).
* No Supplier Type check: an FFD or untyped supplier is accepted.
* A non-empty list makes the supplier **`active`** (`step_completed = 4`).

### 5.2 Get Service Mappings

**Endpoint:** `GET /api/vendors/{id}/service-mappings`

**Example Response**

```json
{ "data": [ { "id": 7, "service_id": 3, "service_code": "SRV-003", "service_name": "…",
              "service_type": "other_operational", "classification": "professional",
              "origin": "domestic", "currency": "INR", "price": 100.0,
              "exchange_rate": null, "gst_percentage": 18.0, "gst_amount": 18.0,
              "total_amount": 118.0, "inr_amount": 118.0, "remarks": null,
              "status": "active", "gst_type": "intra",
              "cgst_amount": 9.0, "sgst_amount": 9.0, "igst_amount": 0.0 } ],
  "summary": { "count": 1, "domestic_count": 1, "international_count": 0,
               "inactive_count": 0, "total_amount": 118.0 },
  "meta": { "vendor_id": 1, "vendor_code": "S-001", "vendor_name": "…",
            "supplier_type": "Professional Services",
            "supplier_service_type": "other_operational",
            "supplier_classification": "professional",
            "origin": "domestic", "country": "India", "currency": "INR" } }
```

| Item | Meaning |
|---|---|
| Extra row fields | `service_type_label`, `classification_label`, `category`, `service_status`, `vendor_id`, `gst_id`, `mapped_at` |
| `gst_type` | `intra` / `inter` (domestic, supplier's state vs your branch's home state) or `none` (international, all GST 0) |
| Home state | `Gst::homeStateCode()`: `branches.gst_state_code`, else the first two digits of the branch GSTIN, else `27` |
| `data` | Includes **inactive** rows; `summary` counts active ones |
| `meta` | The server's truth for which services this supplier may map and whether it is domestic |
| Visibility | Only services visible to you are listed |

### 5.3 Replace Service Mappings

**Endpoint:** `POST /api/vendors/{id}/step/services` — **replace-all**
**Content Type:** JSON

**Request Fields**

| Field | Validation |
|---|---|
| `mappings` | `present\|array` |
| `service_id` | `required\|integer\|distinct` — *A service can only be mapped once per supplier.* |
| `origin` | `nullable\|in:domestic,international` — defaults to the supplier's origin; must match its country if sent |
| `price` | `required\|numeric\|gt:0\|max:9999999999.99` — *Enter the supplier's price.* · *The price must be more than 0.* · *The price cannot be more than 9,999,999,999.99.* |
| `currency` | `nullable\|string\|size:3\|alpha` — *Pick a currency (3-letter code, e.g. USD).* (`size` only; `alpha` gives Laravel's default with the raw field name). International: INR refused; missing → the supplier's country currency (`COUNTRY_CURRENCY`, default USD). Ignored for domestic. The screen requires it |
| `exchange_rate` | `nullable\|numeric\|gt:0\|max:99999.9999` — *The exchange rate must be more than 0.* · *The exchange rate cannot be more than 99999.9999.* International: missing → the currency's active master rate. The screen requires it |
| `gst_id` | `nullable\|integer`. Domestic: must be the **service's** GST. The screen never sends it |
| `remarks` | `nullable\|string\|max:1000` |

Messages are not relabelled (raw names such as `mappings.0.price` in defaults).

**Example Request**

```json
{ "mappings": [
    { "service_id": 3, "origin": "domestic", "price": 100, "remarks": "…" },
    { "service_id": 9, "origin": "international", "price": 250,
      "currency": "USD", "exchange_rate": 84.2 } ] }
```

**Example Response:** the same payload as 5.2.

**Pricing Rules**

| Field | Domestic | International |
|---|---|---|
| GST | The service's GST | 0 |
| Total | Price + GST | Price |
| `inr_amount` | = total | `price × rate` |
| CGST / SGST / IGST, `gst_type` | **Not stored** — `gstSplit()` works them out on every read | `none` |

**Business-Rule 422s** (`ServiceSupplierMapping::assertServes()` and `priceFields()`)

| Rule | Message |
|---|---|
| Unknown, invisible or soft-deleted service | *Unknown service id: X.* |
| Supplier has no type | *Set this supplier's Supplier Type first — only a supplier whose type serves {X} can be mapped to {CODE}.* |
| Non-service type | *A {Type} supplier cannot supply a service. Only a supplier whose type serves {X} can be mapped to {CODE}.* |
| Another bucket | *This supplier's type ({Type}) does not serve {X} — {CODE} needs a {X} supplier.* |
| Origin vs country | *This supplier is based in India — map it as a Domestic supplier.* / *This supplier is based in {Country} — map it as an International supplier.* |
| International with INR | *Pick the supplier's currency — an International price is not in ₹.* |
| No exchange rate anywhere | *Enter the exchange rate (₹ per {CUR}).* |
| Service has no `gst_id` | *Map a GST % to this service first (Stage 1) — domestic suppliers use the service GST.* |
| Wrong GST | *The supplier GST must be the service GST ({n}%, gst_id {id}).* |
| Total too large | *The total value is too large (max ₹ 999,999,999,999.99). Check the price and exchange rate.* |

**403** — each listed service, **and** each active mapping left out, must pass
`serviceEditDenial($user, $service, 'edit')`: `{"message": "{SERVICE CODE}: You
cannot edit this record — employees can only manage rows they created
themselves."}` or `"… — it was created by {a Super Admin | a Client Admin | a
Client user | another Branch}."` (an employee whose client and branch match the
service's branch is always allowed).

**Important**
* Each listed service is upserted (an old row is revived). A **draft** service becomes **active**.
* Active mappings **left out are set `inactive`**, never deleted.
* An **inactive** service is accepted by the server (only the screen hides it).
* A kept row that now fails (country or type changed, the service lost its `gst_id`, or a 403) blocks the whole request.
* Kept domestic rows are re-priced at the service's current GST.

### 5.4 Update One Service Mapping

**Endpoint:** `PATCH /api/vendors/{id}/service-mappings/{map}`

**Request Fields**

| Field | Validation |
|---|---|
| `price` | `sometimes\|required\|numeric\|gt:0\|max:9999999999.99` |
| `gst_id` | `sometimes\|nullable\|integer` — must be the service's GST |
| `currency` | `sometimes\|required\|size:3\|alpha` |
| `exchange_rate` | `sometimes\|required\|numeric\|gt:0\|max:99999.9999` |
| `remarks` | `sometimes\|nullable\|max:1000` |

**Example Request (as the screen sends)**

```json
{ "price": 120, "remarks": null }
{ "price": 260, "currency": "USD", "exchange_rate": 85, "remarks": "…" }
```

**Example Response:** the **row** (not wrapped).

**Important**
* The 403 check (`{"message": "{reason}"}`, no code prefix) runs **before** validation.
* Price fields are re-computed through `priceFields()` with the **stored** origin (same 422s as 5.3 — a supplier whose country changed gets the origin-mismatch 422).
* `assertServes()` is **not** run, and the row's status is not changed (an inactive row can be edited).
* Unknown mapping → 404 *Service mapping not found for this supplier.*

### 5.5 Unmap a Service

**Endpoint:** `DELETE /api/vendors/{id}/service-mappings/{map}`

**Purpose:** Soft unmap — `status = inactive` (idempotent).

**Response:** 200 with the row plus `service_suppliers_count` (the service's
active mappings). 403 as for PATCH (the reason says "edit").

### 5.6 Service Catalogue (as the Supplier Screens Call It)

**Endpoint:** `GET /api/p2p/services` (Service Management)

| Parameter | Rule |
|---|---|
| `service_type` | `self_consumable` · `soft_digital` · `other_operational` |
| `classification` | e.g. `trackable`, `professional` |
| `sort` | `recent` · `oldest` · `name` |
| `per_page` | 1–**200**, default 10 |

Each row carries `supplier_names[]` (company names of its active mappings) and
`gst_percentage`. The Supplier list counts services per supplier from this
field (first 200 services only).

---

## 6. DOCUMENTS AND EVIDENCE VAULT APIS

### 6.1 Owner Resolution (applies to every `/segment-uploads/{type}/{id}` route)

| Step | Rule |
|---|---|
| `{type}` | `supplier` (or `vendor`); unknown → 404 *Unsupported uploadable type: {type}* |
| Supplier | `Vendor::findOrFail` (missing or soft-deleted → 404) |
| Client | The supplier's `client_id` must equal yours, else 404 with no message — this includes a **global** supplier (`client_id` NULL), which the list does show; the vault screen swallows the 404 and opens empty |
| Not checked | Branch, read scope (`forUser`) or permission — any user of the client can read, upload to and delete from any of its suppliers |

### 6.2 List Uploaded Documents and Summary

**Endpoints:** `GET /api/segment-uploads/supplier/{id}` · `GET /api/segment-uploads/supplier/{id}/summary`

| Endpoint | Response |
|---|---|
| Index | `{data[], by_category{kyc,dd,tl,td,qc}, count}`; a row is `{id, category, doc_code, doc_name, requirement, attachment_url, attachment_name, issue_date, expiry_date, uploaded_by, …}`. `?category=` filters |
| Summary | `{total, mandatory, optional, by_category{…{total,mandatory,optional}}}` |

### 6.3 Upload One Document

**Endpoint:** `POST /api/segment-uploads/supplier/{id}`
**Content Type:** multipart

**Request Fields**

| Field | Validation |
|---|---|
| `category` | `kyc` · `dd` · `tl` · `td` · `qc` |
| `doc_code` | `required\|max:32` |
| `doc_name` | `required\|max:255` |
| `requirement` | `M` \| `O` (default `O`) |
| `issue_date` | `nullable\|date\|before_or_equal:today` |
| `expiry_date` | `nullable\|date\|after_or_equal:issue_date` |
| `attachment` | `pdf,jpg,jpeg,png`, **2 MB** (no webp here) |

**Example Request (wizard Stage 2 and the vault)**

```
POST /api/segment-uploads/supplier/31   (multipart)
category=dd   doc_code=DD-001   doc_name=GST Registration Certificate
issue_date=2026-01-10   expiry_date=2027-01-09   attachment=<File>
```

**Example Response:** **201** (new) / 200 → `{ "data": <row>, "vault": <vault data> }`

**Validation Messages** — Laravel defaults (no custom text, no relabelling):

| Case | Message |
|---|---|
| Expiry before issue | *The expiry date field must be a date after or equal to issue date.* |
| Wrong type | *The attachment field must be a file of type: pdf, jpg, jpeg, png.* |
| Too large | *The attachment field must not be greater than 2048 kilobytes.* |
| No file and no existing row | *Select a file to upload.* |

**Important**
* Stored at `segment_doc_uploads/supplier/{id}/{slug(category-doc_code)}-{random 8}.{ext}` on the `public` disk (the replaced file is deleted). No transaction.
* Upsert on (supplier, category, doc_code).
* The Supplier screen never sends `requirement`, so its uploads are stored as `O` (compliance reads the requirement from the segment rules, not this column).
* An existing row with no file keeps its file but **overwrites `doc_name`, `requirement` and both dates** — a blank date clears the stored one.

### 6.4 Delete a Document

**Endpoint:** `DELETE /api/segment-uploads/supplier/{id}/{uploadId}`

**Response:** `{"data":{"id":N},"message":"Deleted"}`

### 6.5 Get the Evidence Vault

**Endpoint:** `GET /api/segment-uploads/supplier/{id}/vault`

Every mode returns `{ "data": { … } }`.

| Mode | `data` keys |
|---|---|
| *(none)* | Everything: standard buckets (`company_dd[]`, `owner_kyc[]`, `trade_licenses[]`), deals (`vendor_with_shipment[]`, `vendor_without_shipment[]`, `vendor_deal_ratios`), `trade_documents[]`, `agreements[]`, `shipment_agreements[]`, counts (`total_documents`, `verified_signed`, `pending`, `core_total_documents`, `core_verified_signed`, `core_catalog_documents`, `core_catalog_verified`, `company_dd_count`, `owner_kyc_count`, `trade_license_count`, `trade_documents_count`, `agreements_count`, `total_shipments`), `party_contact{name,email}`, `segment_rows`, `same_as_customer`, `mirror_customer`, `last_updated`, `last_updated_at` |
| `?docs=1` | `segment_rows`, `party_contact`, `same_as_customer`, `mirror_customer`, `company_dd[]`, `owner_kyc[]`, `trade_licenses[]`, `company_dd_count`, `owner_kyc_count`, `trade_license_count`, the four `core_*` counts, `last_updated` |
| `?tally=1` | The four `core_*` counts only — `core_total_documents` / `core_verified_signed` count **mandatory** documents only |
| `?ring=1` | `core_total_documents`, `core_verified_signed`, `shipment_agreements[{has_shipment, trade_docs{ratio}, agreement{ratio}}]`, `vendor_with_shipment[{ratios{td}}]` — this last one comes from `buildVendorDeals()` (procurement-based), **not** from the PO rows below |

**Bucket Row:** `{id, db_id, name, reference, authority, issue_date, expiry,
expiry_date, attachment, attachment_url, status:"Verified"|"Pending",
requirement:"M"|"O", doc_code, party}`.

| Field | Meaning |
|---|---|
| `id` | `segment_doc_uploads` id when a file is uploaded, otherwise the row's position (1, 2, …) |
| `db_id` | The CLM library document's id |
| `expiry` | The upload's `expiry_date` (`d-M-Y`), else the library document's free-text validity (e.g. *Lifetime*), else `—` |
| `expiry_date` | The upload's date only (null without one) |
| `status` | `Verified` only means a file is uploaded; **Expired** is worked out by the screen |
| Supplier `agreements[]` (`overlaySupplierDocs()`) | `Signed` / `Pending` / `Declined` / `Recalled` / `Expired` from their signature request |

**Deals (`buildPoDeals()`)** — built from the supplier's `p2p_purchase_orders`
(not deleted, newest first). A supplier with **no PO** gets
`vendor_with_shipment: []` and `vendor_without_shipment: []`.

| Row | Shape |
|---|---|
| **PO row** (each entry of a shipment's `pos[]`) | `{po_id, po_code, procurement_id, po_date, po_status, po_total, currency, docs[], agreements[], spi_docs[], ratios}`; a `vendor_without_shipment[]` row adds `sr` and `supplier` |
| **Shipment row** (`vendor_with_shipment[]`, POs whose shipment order has a code) | `{sr, shipment_id, customer, consignee:"—", supplier, pos[], po_count, docs[], agreements[], spi_docs[], ratios}` — `docs` / `agreements` / `spi_docs` merged across its POs |
| `docs[]` / `agreements[]` | The PO's `p2p_purchase_order_documents` with `needed = 'yes'` (split by "agreement" in sub / kind / name), shaped by `shapePoDoc()`: `{id, db_id, po_id, po_code, po_doc_id, party:"Vendor", signature_request_id, sig_state, name, reference, authority: null, issue_date, expiry, attachment, attachment_url, certificate_url: null, status, doc_code, requirement:"M", is_agreement, doc_kind}` |
| `spi_docs[]` (`buildSpiDocs()`) | Per Supplier Invoice of the PO — invoice file, E-Way Bill, each unpacking photo: `{id, spi_id, spi_code, po_id, party:"Supplier", kind:"invoice"\|"eway"\|"photo", name, reference, issue_date, attachment, attachment_url, status:"Received"\|"Awaited"}`. Not shown by the Supplier screen |
| `ratios` | `vendor_deal_ratios` (`kyc`, `dd`, `tl`, `td`) with `td` and `agr` replaced by `{d: signed, t: total}` of the row's own docs / agreements |

**PO document `status`** follows the linked `clm_signature_requests.status`:
`Signed` (completed), `Pending` (in progress), `Declined`, `Recalled`,
`Expired`. With **no** signature request it falls back to the PO document's own
status: `sent` → `Pending`, `signed` / `declined` / `recalled` / `expired` →
the same names, anything else → `Pending`. `sig_state` uses the same fallback,
so a row can carry `sig_state: "sent"` (shown as *Sent*) without a CLM request.

### 6.6 Download a Document

**Endpoint:** `GET /api/segment-uploads/download?path=…` (or `?url=…`)

| Rule | Response |
|---|---|
| Path must start with `segment_doc_uploads/` and contain no `..` | — |
| Another client (a super admin skips this check) | 403 *You are not allowed to download this file.* |
| Bad path, **or** no `segment_doc_uploads` row has that exact `attachment_path` | 404 *File not found.* |
| File missing on disk | 404 *File is missing on storage.* |

---

## 7. CONVERT TO SUPPLIER APIS

### 7.1 Convert Overview

Convert turns a Sourcing **New Supplier** into a Supplier Master supplier. The
**link** is made at this module's Contacts step.

```
1. GET  /api/p2p/new-suppliers/{s}/convert              → prefill for the Add Supplier wizard
2. POST /api/vendors/step/identity                      → supplier created (draft)
3. POST /api/vendors/{id}/step/contacts (_method=PUT) + convert_supplier_id   ══► LINK
4. Stage 2 (KYC, bank, GST scrutiny) → finish
5. POST /api/p2p/new-suppliers/{s}/convert {vendor_id}  → confirm + copy business card
```

### 7.2 Get Convert Prefill

**Endpoint:** `GET /api/p2p/new-suppliers/{id}/convert`

**Example Response**

```json
{ "status": true,
  "data": { "supplier_id": 4, "origin": "domestic", "converted": false,
            "converted_vendor_id": null, "sourcing_count": 2,
            "identity": { "company_name": "…", "legal_name": "…", "primary_email": "…",
                          "segment_id": 2, "segment": "…", "gst_applicable": null },
            "address":  { "address_line": "…", "country_id": 1, "country": "India",
                          "state_id": 14, "state": "…", "state_code": "27",
                          "city": "Pune", "google_location": "…",
                          "contact_name": "…", "contact_no": "…", "email": "…",
                          "is_primary": true },
            "business_card": "…" } }
```

| Item | Rule |
|---|---|
| Lookup | The New Supplier within your client, else 404 *No query results for model [App\Models\P2p\Supplier] {id}* — the **only** check on both convert endpoints |
| Ids | Country, state and segment matched by name (case-insensitive) in your read scope; no match → `null` id |
| `gst_applicable` | `"No"` for international, `null` otherwise |
| `sourcing_count` | Its sourcing rows still mapped as a New Supplier |
| `business_card` | Returned, but the screen does not put it in the wizard; it reaches the supplier only through 7.4 |

### 7.3 The Link (Contacts Step)

Sent through 3.3 with `convert_supplier_id`. After the contact is saved, in the
same request:

1. The New Supplier must be in your client and not converted into a **different** supplier, else 422 `errors.convert_supplier_id` *This New Supplier cannot be converted into this supplier.*
2. While the contact is saved, the New Supplier's own email is exempt from the system-wide duplicate check (`Vendor::$convertingSupplierId`, plus New Suppliers already converted into this supplier).
3. If not yet linked: each of its `source=new` sourcing mappings **moves** to this supplier (takes the supplier's name, keeps the old contact / email / mobile / card snapshot) or is **merged** (soft-deleted) when that product already has the supplier as Master.
4. `converted_vendor_id`, `converted_at`, `converted_by` are stamped on the New Supplier.
5. **The business card is not copied here.**

The response is the normal contacts-step response; a refusal shows as the
wizard's *"Save failed"* toast.

### 7.4 Confirm Convert

**Endpoint:** `POST /api/p2p/new-suppliers/{id}/convert`

**Request Body**

```json
{ "vendor_id": 88 }
```

**Refusals**

| Case | Status / message |
|---|---|
| Unknown New Supplier | 404 |
| No `vendor_id` | 422 *Save the supplier in the Supplier Master first.* |
| `vendor_id` not an integer | 422 `errors.vendor_id` (Laravel default) |
| Supplier not in your client (any branch accepted) | 422 `errors.vendor_id` *Unknown supplier in the Supplier Master.* |
| Converted to another supplier | 422 `{"status":false,"message":"“X” is already converted to another supplier in the Supplier Master."}` |

**Processing**
1. Converting into the **same** supplier is allowed (the normal case — 7.3 already linked it).
2. Any `source=new` mapping still left moves or merges (normally none, so `mappings_moved` / `mappings_merged` are usually 0).
3. `converted_*` stamped again (`converted_at` / `converted_by` overwritten).
4. `copyBusinessCard()`: the New Supplier's card is copied to `vendor_documents/{vendor_id}/contact-{8 hex}__{name}.{ext}` and set as the primary contact's `attachment_path` — skipped (`business_card_copied: false`) when there is no card, no primary row, the row already has an attachment, or the file is missing.

**Example Response**

```json
{ "status": true, "data": { "supplier_id": 4, "vendor_id": 88, "vendor_code": "S-088", "vendor_name": "ABC Traders",
  "mappings_moved": 0, "mappings_merged": 0, "business_card_copied": true,
  "message": "ABC Traders is now in the Supplier Master as S-088." } }
```

---

## 8. OTHER ENDPOINTS THE SUPPLIER SCREENS CALL

Owned by other modules; listed so the full set of calls is in one place.

| Endpoint | Called from | For |
|---|---|---|
| `GET /clm/segments?lite=1` · `POST /clm/segments` | Wizard | Segment "+" quick-add only (next code + existing names; create). The segment list itself comes from `master-bundle` |
| `GET /clm/segment-rules` | Wizard (`useRuledSegments`) | `[{segment_id, segment_code, document_type, …}]` — which segments have a rule per origin (DOM / INT badges, greyed segments). On failure every segment stays selectable |
| `GET /clm/segment-rules/for-segment/{id}?document_type=domestic\|international` | Wizard (Stage 2) | `{status:true, data:{rule, kyc[], dd[], tl[], qc[]}}`, each row `{id, code, name, status, authority, authority_list, expiry, validity, requirement:"M"\|"O"}`. Rule found by the segment's **code** (exact) and document type; 403 *No tenant context* without a client |
| `GET /clm/trade-doc-library/for-party/supplier?view=list&vendor_type=` | Wizard | Called with the Stage 2 rules; only filters `td` rows, which `for-segment` never returns — no visible effect |
| `GET /clm/signature-requests?party_id={id}&model_name=Vendor&sync=1` | Evidence Vault | Signature statuses (in-progress requests re-synced with Zoho; read scope, latest 200) |
| `POST /clm/signature-requests` | Evidence Vault | CLM send (trade documents / agreements, optionally one PO via `p2p_po_document_id`); `document_type` `trade_doc` when any trade document is included, else `agreement` |
| `GET /clm/signature-requests/{id}` (+ `/view-file/0`, `/certificate`, `/declined-file`) | Evidence Vault | Signing activity tracker, certificate |
| `POST /clm/signature-requests/{id}/remind` | Evidence Vault | Reminder — 400 *Reminder cannot be sent. Current status is '{state}'.*, 409 when the Zoho request no longer exists (marked recalled), 500 *Failed to send reminder: …*; success `{status, message:"Reminder sent", data}` |
| `POST /p2p/orders/{po}/documents/mark-sent` | Evidence Vault | After a CLM send that bundled a PO (errors ignored) |
| `GET /p2p/services/master-bundle` | Mapped Services | Currencies (international) |
| `GET /products?per_page=500&lite=1` | Map Product (wizard and list) | Product list — server caps `per_page` at **200**, no status filter |
| `POST /p2p/orders/{po}/documents/{doc}/generate` | Evidence Vault | Generate a PO's PDF before sending (rows without `attachment_url`). Refusals: *Only the Purchase Order document is generated.* · *A sent or signed document cannot be regenerated.* · 500 *Could not generate the PDF: …* |
| `GET /p2p/orders/{po}/documents/{doc}/download` | Evidence Vault | PO PDF preview in the send popup |
| `POST /p2p/orders/{po}/documents/sign` | Evidence Vault | **PO-only** selections: `{document_ids, signers[{name,email,role,order}], is_sequential, expiry_days, notes, document_settings}`. Refusals: *Submit the PO before sending documents for signature.* · *Some documents were not found on this PO.* · *Attach a file first: …* · *Already sent or signed: …* · *No valid email for this supplier. Set a primary contact email on the supplier first.* · 502 *Could not send for signature: …*. Mixed selections go through `POST /clm/signature-requests` |

---

## 9. CURL API TESTING REFERENCE

### 9.1 Configure Authentication and Base URL

```bash
TOKEN=…
API=http://localhost:8000/api
T="Authorization: Bearer $TOKEN"
```

### 9.2 List Domestic Suppliers

```bash
curl -H "$T" "$API/vendors?scope=domestic&tab=all&page=1&per_page=12&q=abc"
```

### 9.3 Retrieve Dropdown Masters

```bash
curl -H "$T" "$API/vendors/master-bundle"
```

### 9.4 Create a Supplier (Stage 1 — identity)

```bash
curl -X POST -H "$T" -H "Content-Type: application/json" "$API/vendors/step/identity" -d '{
  "company_name":"ABC Logistics","legal_name":"ABC Logistics Pvt Ltd",
  "gst_applicable":"Yes","gst_number":"27ABCDE1234F1Z5","vendor_type_id":1,
  "vendor_behaviour":"Genuine","segment_ids":[4],"supplier_category":"general",
  "address":{"address_line":"Plot 21","country_id":1,"state_id":14,"state_code":"27","city":"Pune"}}'
```

### 9.5 Save the Primary Contact (multipart, POST + `_method=PUT`)

```bash
curl -X POST -H "$T" "$API/vendors/31/step/contacts" \
  -F _method=PUT \
  -F "primary_address[address_line]=Plot 21" -F "primary_address[country_id]=1" \
  -F "primary_address[state_id]=14" -F "primary_address[state_code]=27" -F "primary_address[city]=Pune" \
  -F "primary_address[contact_name]=Priya Sharma" -F "primary_address[email]=priya@abc.in" \
  -F "primary_address[contact_no]=9876543210"
```

### 9.6 Add a Bank Account

```bash
curl -X POST -H "$T" "$API/vendors/31/bank-accounts" \
  -F bank_name="HDFC Bank" -F branch_name=Andheri -F account_number=50100123456789 \
  -F ifsc=HDFC0001234 -F cheque=@cheque.pdf
```

### 9.7 Upload a Segment Document

```bash
curl -X POST -H "$T" "$API/segment-uploads/supplier/31" \
  -F category=dd -F doc_code=DD-001 -F "doc_name=GST Registration Certificate" \
  -F issue_date=2026-01-10 -F expiry_date=2027-01-09 -F attachment=@gst.pdf
```

### 9.8 Replace Product Mappings (send the full list)

```bash
curl -X POST -H "$T" -H "Content-Type: application/json" "$API/vendors/31/step/products" \
  -d '{"mappings":[{"product_id":5,"purchase_price":100,"gst_percentage":18,"gst_amount":18,"total_amount":118}]}'
```

**Expected:** the supplier becomes **active**.

### 9.9 Replace Service Mappings

```bash
curl -X POST -H "$T" -H "Content-Type: application/json" "$API/vendors/31/step/services" \
  -d '{"mappings":[{"service_id":3,"origin":"domestic","price":100}]}'
```

### 9.10 Unmap a Service

```bash
curl -X DELETE -H "$T" "$API/vendors/31/service-mappings/7"
```

---

## 10. COMPLETE API ENDPOINT REFERENCE

All paths are relative to `/api`. Rows 1–22 are `VendorController` (verified
against `routes/api.php` — these are all its routes), 23–28
`SegmentDocUploadController`, 29–30 `SourcingController`.

| No. | Method | Endpoint | Function | Section |
|---|---|---|---|---|
| 1 | GET | `/vendors` | List suppliers (+ `light=1` picker) | 2.1 |
| 2 | GET | `/vendors/master-bundle` | Dropdown masters | 2.2 |
| 3 | GET | `/vendors/{id}` | Supplier details (+ `lite=1`) | 2.3 |
| 4 | GET | `/vendors/{id}/product-mappings` | Product mappings | 2.4 |
| 5 | DELETE | `/vendors/{id}` | Delete supplier (no screen caller) | 2.5 |
| 6 | POST | `/vendors/step/identity` | Create / update identity | 3.1 |
| 7 | PUT | `/vendors/{id}/step/contacts` | Primary contact (+ Convert link) | 3.3 |
| 8 | POST | `/vendors/{id}/contacts` | Add extra contact | 3.4 |
| 9 | PUT | `/vendors/{id}/contacts/{contact}` | Edit extra contact | 3.4 |
| 10 | DELETE | `/vendors/{id}/contacts/{contact}` | Delete extra contact | 3.4 |
| 11 | POST | `/vendors/{id}/step/kyc` | Legacy KYC lists | 4.1 |
| 12 | POST | `/vendors/{id}/bank-accounts` | Add bank account | 4.2 |
| 13 | PUT | `/vendors/{id}/bank-accounts/{bank}` | Edit bank account | 4.2 |
| 14 | DELETE | `/vendors/{id}/bank-accounts/{bank}` | Delete bank account | 4.2 |
| 15 | POST | `/vendors/{id}/gst-scrutiny` | Add GST scrutiny | 4.3 |
| 16 | PUT | `/vendors/{id}/gst-scrutiny/{gst}` | Edit GST scrutiny | 4.3 |
| 17 | DELETE | `/vendors/{id}/gst-scrutiny/{gst}` | Delete GST scrutiny | 4.3 |
| 18 | POST | `/vendors/{id}/step/products` | Replace product mappings | 5.1 |
| 19 | GET | `/vendors/{id}/service-mappings` | Service mappings | 5.2 |
| 20 | POST | `/vendors/{id}/step/services` | Replace service mappings | 5.3 |
| 21 | PATCH | `/vendors/{id}/service-mappings/{map}` | Update one service mapping | 5.4 |
| 22 | DELETE | `/vendors/{id}/service-mappings/{map}` | Unmap a service | 5.5 |
| 23 | GET | `/segment-uploads/supplier/{id}` | List documents | 6.2 |
| 24 | GET | `/segment-uploads/supplier/{id}/summary` | Document summary | 6.2 |
| 25 | POST | `/segment-uploads/supplier/{id}` | Upload one document | 6.3 |
| 26 | DELETE | `/segment-uploads/supplier/{id}/{uploadId}` | Delete document | 6.4 |
| 27 | GET | `/segment-uploads/supplier/{id}/vault` | Evidence Vault | 6.5 |
| 28 | GET | `/segment-uploads/download` | Download document | 6.6 |
| 29 | GET | `/p2p/new-suppliers/{id}/convert` | Convert prefill | 7.2 |
| 30 | POST | `/p2p/new-suppliers/{id}/convert` | Confirm convert | 7.4 |

**Total documented endpoints: 30** — 22 in `VendorController`, 6 in
`SegmentDocUploadController`, 2 in `SourcingController`. Endpoints owned by
other modules (`/p2p/services`, CLM, PO documents, `/products`) are listed in
Sections 5.6 and 8 and not counted.

---

## 11. KNOWN API GAPS

### 11.1 Data Integrity

| # | Gap |
|---|---|
| 1 | `POST step/products` is replace-all: all mappings are hard-deleted and re-created **without** `origin`, `currency_code`, `exchange_rate`, `inr_amount` — values written from the Product side are lost |
| 2 | `POST step/products` stores `gst_percentage` / `gst_amount` / `total_amount` **as sent** (not recomputed); missing values save 0 % GST |
| 3 | `POST step/products` re-activates **every** listed product on every save |
| 4 | `POST step/kyc` is replace-all; files not echoed back are deleted; `existing_path` is not checked to belong to this supplier |
| 5 | `PUT step/contacts` deletes and re-inserts the primary row (its id changes) and blanks the address if the address fields are not sent |
| 6 | GST scrutiny saves set every scrutiny row to the same GSTIN but do **not** update `vendors.gst_number` |
| 7 | `vendor_behaviour` by name uses an exact, per-client `firstOrCreate` — a different case / spacing, or a global-only name, creates a new tenant row |
| 8 | `segment_ids` silently drops global segments (`client_id` NULL) |
| 9 | Segment uploads: an existing row with no new file overwrites `doc_name`, `requirement` and both dates (a blank date clears the stored one); no transaction |

### 11.2 Validation and Business Rules

| # | Gap |
|---|---|
| 10 | The GSTIN-starts-with-State-Code message exists in `storeIdentity` but is never returned today |
| 11 | A GSTIN is not format-checked and not required on the server for an Indian supplier |
| 12 | The "segment must have a Document Control Panel rule" check is browser-only |
| 13 | `state_locked` is a UI lock only — the server still accepts a country / state change |
| 14 | Bank cheque is optional on the server (the screen requires it); bank field labels are ignored |
| 15 | `GET /vendors` has no `validate()` and no `per_page` cap; `%` / `_` in `q` act as wildcards |
| 16 | `POST step/products` has no tenant, segment, status or Supplier Type check on the product |
| 17 | A product that has lost its GST blocks every later `step/products` save (whole-list check) |
| 18 | `POST step/services` accepts an **inactive** service; a kept row that now fails blocks the whole request |
| 19 | `PATCH service-mappings/{map}` does not run `assertServes()` and can edit an inactive row |
| 20 | Extra-contact emails are not checked for uniqueness on the server |
| 21 | The 409 confirm flag is never sent by the Supplier screen — the confirm-and-delete branch is API-only |

### 11.3 Security and Access

| # | Gap |
|---|---|
| 22 | No supplier permission is checked by the API; `routeAccess.ts` does not check `p2p.supplier` for `/suppliers` |
| 23 | `hierarchicalDenial()` returns "allowed" for every supplier — any user with access can edit or delete any visible supplier |
| 24 | `/segment-uploads/supplier/{id}` checks the client only — no branch, read-scope or permission check |
| 25 | A global supplier (`client_id` NULL) is listed but its vault / uploads return 404 |
| 26 | Convert endpoints check only the company — any user can convert any New Supplier of the company |
| 27 | The primary email must be unique **across all clients** (system-wide) |

### 11.4 Consistency and Unused Endpoints

| # | Gap |
|---|---|
| 28 | `opportunity_count` is always 0 in `GET /vendors` |
| 29 | `tab=recurring` returns nothing (not built) |
| 30 | With no client id (e.g. super admin) every row says `"Compliant"` while `facets.compliance` is 0 / 0 |
| 31 | `GET /products?per_page=500` is capped at 200 by the server |
| 32 | `DELETE /vendors/{id}`, bank / GST scrutiny edit and delete routes are not used by the Supplier screen |
| 33 | Segment upload download returns 404 when no `segment_doc_uploads` row has that exact path |
| 34 | Convert: abandoned **after** the Contacts step → linked, but the business card is never copied (only 7.4 copies it) |

---

## 12. IMPORTANT IMPLEMENTATION NOTES

### 12.1 Supplier Creation Workflow (API order)

**Stage 1 — Identity and contacts**
1. `GET /vendors/master-bundle` (+ `GET /clm/segment-rules`).
2. `POST /vendors/step/identity` → supplier created as **draft**, `vendor_code` allocated.
3. `PUT /vendors/{id}/step/contacts` (POST + `_method=PUT`) → primary contact and `primary_email`.
4. Optional extra contacts: `POST /vendors/{id}/contacts`.

**Stage 2 — KYC and banking**
1. `GET /clm/segment-rules/for-segment/{id}` → which documents each segment needs.
2. `POST /segment-uploads/supplier/{id}` per document.
3. `POST /vendors/{id}/bank-accounts`; `POST /vendors/{id}/gst-scrutiny` when GST applies.
4. `POST /vendors/{id}/step/kyc` → supplier becomes **inactive** (`step_completed ≥ 2`).

**Stage 3 — Products / services**
1. Products: `POST /vendors/{id}/step/products` (full list) → supplier becomes **active**.
2. Services: `POST /vendors/{id}/step/services` (full list); edit with `PATCH`, unmap with `DELETE`.

### 12.2 Key Backend Considerations

| Topic | Note |
|---|---|
| Tenant isolation | `/vendors/*` resolves through `Vendor::scopeForUser`; out-of-scope → 404 |
| Server-set fields | `client_id`, `branch_id`, `created_by`, `vendor_code`, `status`, `step_completed`, `primary_email` are never taken from the body |
| Status flow | `draft` (identity) → `inactive` (KYC step) → `active` (product list saved) |
| Replace-all endpoints | `step/products`, `step/services`, `step/kyc` — always send the full list |
| Multipart updates | Use `POST` + `_method=PUT` |
| Unique email | System-wide across `vendors.primary_email` and `p2p_suppliers.email` |
| GST for products | Stored as sent; a product with no GST can't be mapped |
| GST for services | Domestic uses the service's GST; split computed on read |
| International services | INR refused; currency / rate fall back to country currency / master rate |
| Service unmap | Soft — `status = inactive`, never deleted |
| Locks | Supplier Type locked by a committed PO / Supplier Invoice; segments locked by products, POs, Supplier Invoices |
| Supplier Behaviour | From the Supplier Behaviour master, by name (`cdc5aff67`) |
| Convert | Link at the Contacts step (`convert_supplier_id`); card copied only by the final `POST …/convert` |
| Files | 2 MB everywhere; public disk |

---

## END OF DOCUMENT

**Document:** P2P Supplier Management — API Documentation  
**Module:** Supplier Management  
**Framework:** Laravel  
**Authentication:** Laravel Sanctum  
**Scope:** Supplier list and lookups, identity and contacts, KYC / bank / GST scrutiny, product and service mapping, documents and Evidence Vault, Convert to Supplier, and the other-module endpoints the screens call  
**Total endpoints:** 30 (plus other-module endpoints listed in Sections 5.6 and 8)  
**Related documents:** Functional Documentation · Technical Documentation · Code Walkthrough
