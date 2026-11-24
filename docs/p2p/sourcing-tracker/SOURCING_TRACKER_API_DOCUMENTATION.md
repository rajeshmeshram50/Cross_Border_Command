# P2P SOURCING MANAGEMENT TRACKER

## Complete API Documentation

**Module:** P2P Sourcing Management Tracker  
**Menu Path:** Procure to Pay (P2P) → Procurement Management → Sourcing Management Tracker  
**Technology Stack:** Laravel, PHP, React, TypeScript, PostgreSQL  
**Backend:** Laravel REST APIs  
**Frontend:** React / TypeScript  
**API Base URL:** `/api`  
**API Prefix:** `/p2p/sourcing-targets` (plus `/p2p` lookups and `/p2p/new-suppliers`)  
**Authentication:** Laravel Sanctum  
**Controller:** `App\Http\Controllers\Api\P2p\SourcingController`  
**Document Type:** API Documentation — Backend API Reference & Integration Guide  

---

## CONTENTS

1. API Overview
2. Master Data and Lookup APIs
3. File APIs
4. Sourcing Target APIs
5. Target Product APIs
6. Supplier Mapping APIs
7. New Supplier Directory and Convert APIs
8. curl API Testing Reference
9. Complete API Endpoint Reference
10. Known API Gaps
11. Important Implementation Notes

---

## 1. API OVERVIEW

### 1.1 General Configuration

| Configuration | Details |
|---|---|
| Base URL | `/api` |
| Authentication | `Authorization: Bearer <sanctum token>` |
| Middleware | `auth:sanctum` → `user.active` → `tenant` (no permission middleware — every access check is inside the controller) |
| Controller | `App\Http\Controllers\Api\P2p\SourcingController` (**SC**) |
| Pricing service | `App\Support\SupplierPricing` |
| Supplier integration | `App\Http\Controllers\Api\VendorController::storeContacts()` — `PUT /vendors/{id}/step/contacts` (the Convert link) |
| Content type | JSON for every route, except `POST /p2p/upload` (multipart) |
| Routes file | `routes/api.php` — one block inside the authenticated group (search `P2p\SourcingController`) |
| Verified up to | commit `6170fa175` (includes `bf7dad2ed`) |

### 1.2 API Response Structure

| Case | Shape |
|---|---|
| Success | `{ "status": true, "data": <payload> }` |
| Refusal written by the controller (403 / 422) | `{ "status": false, "message": "…" }` — no `errors` key |
| Validation (422) | `{ "message": "<first error> (and N more errors)", "errors": { "field": ["…"] } }` — no `status` key |
| Not found (`abort(404, …)`) | `{ "message": "…" }` |

**Standard Error Responses**

| HTTP Status | Description | Response |
|---|---|---|
| 401 | Missing or expired token | `{"message":"Unauthenticated."}` |
| 401 | User, client or branch inactive (all tokens revoked) | `{"message":"Account is no longer active. Please sign in again."}` |
| 403 | Not allowed for this target (see 1.4) | `{"status":false,"message":"<denial text>"}` |
| 404 | Target / product / mapping not found in your company | `{"message":"Sourcing target not found."}` |
| 422 | Validation failure or business-rule refusal | `{"message":"…","errors":{"<field>":["…"]}}` or `{"status":false,"message":"…"}` |

> **Important — Tenant Visibility:** `{target}` is looked up **inside your
> company only**. A target of another company returns **404**, not 403, so its
> existence is never confirmed.

### 1.3 Path Parameters and Supported Values

| Item | Values |
|---|---|
| `{target}` | The target **code**, e.g. `ST-001` (not an id) |
| `{product}`, `{supplier}` / `{m}` | Numeric ids |
| `source` (target / product) | `master`, `manual` |
| Mapping `source` (response) | `Master`, `New Supplier` |
| Product `status` | `In Progress`, `Completed` |
| List `tab` | `all`, `created`, `assigned` |
| `origin` | `domestic`, `international` |
| `gst_type` | `intra`, `inter` (`none` for international, set by the server) |
| `clarity.type` | `text`, `link`, `pdf` |
| Upload `kind` | `clarity`, `card` |

### 1.4 Access Checks

| Check | Allows | Refusal |
|---|---|---|
| **View** (`viewDenial`) | super admin, client admin, creator, assignee | 403 *Only the creator, the assignee or the client admin can open this sourcing target.* |
| **Map** (`canMapSuppliers`) | assignee, creator, super admin — **not** client admin | 403 *Only the creator or the assignee of this sourcing target can map suppliers.* (wording varies per endpoint) |
| **Edit target** | creator only | 403 *Only the creator can edit this sourcing target.* |
| **Company only** | any user of the company | Convert (prefill and `POST …/convert`), `/new-suppliers`, `/sourcings` |
| **Supplier wizard Contacts step** | vendor visible to you (`Vendor::forUser`); New Supplier in your company | 404 (vendor not visible) · 422 `errors.convert_supplier_id` |

### 1.5 Limits

| Item | Server | Screen (typing cap, `format.ts limitNum()`) |
|---|---|---|
| Supplier price | ≤ 9,999,999,999.99 (`SupplierPricing::MAX_PRICE`) | 10 digits + 2 decimals |
| Exchange rate | ≤ 99,999.9999 (`MAX_RATE`) | 5 digits + 4 decimals |
| Target price | format `^\d[\d,]*(\.\d{1,2})?$`, ≤ 64 characters — **no value cap** | 10 + 2 digits; > 0 and ≤ 9,999,999,999.99 on save |
| Total / INR amount | ≤ 999,999,999,999.99 (`MAX_AMOUNT`) | — (reachable only for International) |
| Upload | 5 MB | 5 MB |
| List `per_page` | ≤ 200 | 10 / 25 / 50 or the fitted size |
| Search `q` | ≤ 100 characters | not limited |

---

## 2. MASTER DATA AND LOOKUP APIS

### 2.1 Get Product Master Picker

**Endpoint:** `GET /api/p2p/products`

**Purpose:** List the company's Product Master for the target form.

| Item | Detail |
|---|---|
| Scope | `products` of your company, filtered to your branch (`?branch_id` only when you have no branch) |
| Order | By the number in the code (PostgreSQL `regexp_replace(product_code, '[^0-9]', '', 'g')::int`), then the code |
| Code | Padded to 3 digits (`P-41` → `P-041`) |
| Empty segment / HSN | `""` |
| Access | Authenticated group only |
| Caller | `AssignTargetModal` (Add and Edit) |

**Example Response**

```json
{ "status": true, "data": [ { "code": "P-001", "name": "Bolt M8", "segment": "Hardware", "hsn": "7318" } ] }
```

### 2.2 Get Team Members (Assign To)

**Endpoint:** `GET /api/p2p/team-members`

**Purpose:** List who a target can be assigned to.

**Who is returned** — users of your company who are:
* **(a)** the user of an employee of **any department** that is active with onboarding stage ≥ 6 (`user_id` not null; the employee's own branch isn't checked), **or**
* **(b)** a branch user, **or**
* **(c)** you (self-assign is allowed);

and the user is active, not a super admin, with `users.branch_id` = your branch
(`?branch_id` only when you have no branch). Sorted by name.

**Example Response**

```json
{ "status": true, "data": [
  { "id": "42", "name": "Ravi", "code": "EMP-001", "department": "Purchase", "role": "Purchase Executive" },
  { "id": "7",  "name": "Asha", "code": null, "department": "Branch Admin", "role": "Branch User" } ] }
```

| Field | Value |
|---|---|
| `code` | `emp_code` |
| `department` | employee's department; else `"Branch Admin"` for a branch user; else `null` |
| `role` | employee's designation; else `users.designation`; else the user type |

> **Important:** `POST /p2p/sourcing-targets` re-checks only "active,
> non-super-admin user of the company" — not these list rules.

Callers: `AssignTargetModal` (Add only) and Bulk Sourcing.

### 2.3 Get Supplier Master Pool

**Endpoint:** `GET /api/p2p/suppliers`

**Purpose:** List Supplier Master suppliers for the Map Supplier form.

**Query Parameters**

| Parameter | Required | Description |
|---|---|---|
| `origin` | No | `domestic` or `international`; anything else → 422 *The selected origin is invalid.*; left out → every origin (the type chooser uses this to count) |
| `branch_id` | No | Passed to `Vendor::scopeForUser` |

**Visibility (`Vendor::scopeForUser`)**

| User | Sees |
|---|---|
| Employee / branch user | vendors with no company, or of your company with no branch or your branch |
| Client admin / client user | your company (or no company) |
| Super admin | all |

**No vendor status filter.** Ordered by `company_name`.

**Origin identification** — from the country of the vendor's **primary**
address (`is_primary` desc, then id): India or blank → `domestic` / `INR`;
otherwise the country's currency, else `USD`.

**Example Response**

```json
{ "status": true, "data": [ { "id": "17", "code": "S-017", "name": "Acme", "origin": "domestic",
  "currency": "INR", "supplierType": "Material/ Goods", "segment": "…",
  "contact": "…", "mobile": "…", "email": "…", "country": "India",
  "state": "Gujarat", "stateCode": "24", "city": "…", "region": "Domestic" } ] }
```

### 2.4 Get Form Masters

**Endpoint:** `GET /api/p2p/form-masters`

**Purpose:** All dropdown data for the New Supplier and Supplier Master forms in
one call. **Active rows only**, read through `MasterVisibility::applyReadScope()`.
The browser caches it for the page visit (`formMasters.ts`).

**Returned Sections**

| Key | Content |
|---|---|
| `segments` | `[{id, name, regulatory_status}]` |
| `countries` | `[{id, name}]` |
| `states` | `[{id, country_id, name}]` |
| `stateCodes` | `[{id, state_id, state_code}]` (statutory first) |
| `supplierOrigins` | `[{value:"domestic", label, note}, {value:"international", …}]` |
| `gstRates` | e.g. `[0, 5, 12, 18, 28]` |
| `gstTypes` | `intra` → *CGST + SGST (Intra-state)*, `inter` → *IGST (Inter-state)* |
| `currencies` | `[{id, code, name, symbol, exchange_rate}]` — **INR excluded** |
| `homeState` | `{state, stateCode}` — your branch (`branches.state`, `branches.gst_state_code`; nulls without a branch) |

**Example Response**

```json
{ "status": true, "data": {
  "segments": [ { "id": 2, "name": "Hardware", "regulatory_status": "…" } ],
  "countries": [ { "id": 1, "name": "India" }, { "id": 7, "name": "United States" } ],
  "states": [ { "id": 14, "country_id": 1, "name": "Maharashtra" } ],
  "stateCodes": [ { "id": 27, "state_id": 14, "state_code": "27" } ],
  "supplierOrigins": [ { "value": "domestic", "label": "Domestic Supplier", "note": "Supplier based in India — price in ₹ with GST applied" },
                       { "value": "international", "label": "International Supplier", "note": "Overseas supplier — price in its currency, no GST" } ],
  "gstRates": [ 0, 5, 12, 18, 28 ],
  "gstTypes": [ { "value": "intra", "label": "CGST + SGST (Intra-state)" }, { "value": "inter", "label": "IGST (Inter-state)" } ],
  "currencies": [ { "id": 3, "code": "USD", "name": "US Dollar", "symbol": "$", "exchange_rate": "84.2000" } ],
  "homeState": { "state": "Maharashtra", "stateCode": "27" } } }
```

---

## 3. FILE APIS

### 3.1 File Storage Structure

| File | Location (public disk) |
|---|---|
| Product clarity | `p2p/clarity/c{client_id}/{random24}/{name}.{ext}` |
| Supplier business card | `p2p/supplier-cards/c{client_id}/{random24}/{name}.{ext}` |
| Card copied on Convert | `vendor_documents/{vendor_id}/contact-{8 hex}__{name}.{ext}` |

`{name}` = original base name with only letters, digits, `- _ .` and spaces,
at most 120 characters (`document` if empty); `{ext}` = lower-cased extension.

### 3.2 Upload a File

**Endpoint:** `POST /api/p2p/upload`
**Content Type:** `multipart/form-data`

**Purpose:** Upload a clarity file or business card. Upload first, then put the
returned `path` into the target (clarity) or the mapping (card).

**Fields**

| Field | Validation |
|---|---|
| `file` | `required\|file\|max:5120`; extension **pdf, jpg, jpeg, png, webp** (by name only) |
| `kind` | `nullable\|in:clarity,card`; left out → stored as clarity |

**Validation Messages**

| Case | Message |
|---|---|
| Wrong type | 422 `errors.file` *The file must be a PDF, JPG, PNG, or WEBP.* |
| No file | *The file field is required.* |
| Too large | *The file field must not be greater than 5120 kilobytes.* |
| Bad kind | *The selected kind is invalid.* |

**What the screens send**

```
POST /api/p2p/upload        multipart/form-data
file=<spec.pdf>   kind=clarity       ← AssignTargetModal, on save, one per product with a new file
file=<card.jpg>   kind=card          ← MapSupplierModal, before saving a New Supplier mapping
```

**Example Response**

```json
{ "status": true, "data": { "path": "/storage/p2p/clarity/c12/Ab3…/spec.pdf", "name": "spec.pdf" } }
```

### 3.3 Download a Clarity File

**Endpoint:** `GET /api/p2p/clarity/download?path=<stored path>`

**Purpose:** Stream a clarity file after a company check.

| Rule | Detail |
|---|---|
| Allowed | Path under `p2p/clarity/c{your client}/`, or (older files) referenced by one of your company's products |
| Refused (404) | Contains `..`, outside `p2p/clarity/`, other company, or file missing |
| Not served | Business cards |

> **Note:** files are on the public disk, so their `/storage/…` URL is also
> reachable directly (the random 24-character folder is the only protection).

---

## 4. SOURCING TARGET APIS

### 4.1 Get All Sourcing Targets (List)

**Endpoint:** `GET /api/p2p/sourcing-targets`

**Purpose:** Paginated list of the targets you created or are assigned to.

**Query Parameters**

| Parameter | Validation | Description |
|---|---|---|
| `tab` | `required\|in:all,created,assigned` | `all` = created by you **or** assigned to you (not the whole company) |
| `q` | `nullable\|string\|max:100` | Search text |
| `status` | `nullable\|in:In Progress,Completed,Overdue` | Not sent by the screen |
| `page` | `nullable\|integer\|min:1` | A page past the end returns the last page |
| `per_page` | `nullable\|integer\|min:1\|max:200` | Default 10 |

**Searchable Fields** (case-insensitive "contains"): code, source labels,
creator, assignee, progress status, the word *overdue*, product names, due date
as `yyyy-mm-dd` / `dd/mm/yyyy`.

**Example Request (as the screen sends)**

```
GET /api/p2p/sourcing-targets?tab=all&page=1&per_page=8&q=30/11/2026
```

**Example Response**

```json
{ "status": true, "data": {
  "rows": [ {
    "id": "ST-004", "source": "Product Master", "sources": ["Product Master", "Manual Entry"],
    "start": "2026-11-20", "due": "2026-11-30",
    "createdBy": "Asha", "createdById": "7", "assignee": "Ravi", "assigneeId": "42",
    "products": 3, "totalProducts": 3, "completed": 1, "completedProducts": 1, "pending": 2,
    "progress": 33, "progressPercent": "33%", "progressStatus": "In Progress",
    "overdue": false, "firstProduct": "Bolt M8", "moreProducts": 2, "mappedSuppliers": 5 } ],
  "counts": { "all": 12, "created": 7, "assigned": 5 },
  "pagination": { "page": 1, "per_page": 10, "total": 12, "last_page": 2 } } }
```

**Important**
* `counts` ignore `q` and `status`.
* `overdue` = not complete and the due date's end of day has passed (server time zone).
* Without `tab` the endpoint returns the older `{assigned:[…], created:[…]}` shape (Bulk Sourcing).
* A user without a company gets 200 with empty rows and zero counts.
* A bad parameter → 422 (Laravel default message); the screen shows *Couldn't load sourcing targets*.

### 4.2 Get Next Target Code

**Endpoint:** `GET /api/p2p/sourcing-targets/next-code`

**Example Response**

```json
{ "status": true, "data": { "code": "ST-005" } }
```

> **Important:** a **preview** only (counted without the lock). The real code
> is allocated during create; two users can see the same preview.

### 4.3 Create a Sourcing Target

**Endpoint:** `POST /api/p2p/sourcing-targets`
**Content Type:** JSON

**Request Fields**

| Field | Validation |
|---|---|
| `due_date` | `required\|date\|after_or_equal:today` |
| `source` | `required\|in:master,manual` |
| `assignee_id` | `required` |
| `products` | `required\|array\|min:1` |
| `products.*.id` | `nullable\|integer` (Edit only: a kept product) |
| `products.*.from` | `required\|in:master,manual` |
| `products.*.code` | required for `master`, ≤ 64 |
| `products.*.name` | required for `manual`, ≤ 255 |
| `products.*.target_price` | required for `manual`; `^\d[\d,]*(\.\d{1,2})?$`, ≤ 64. Error key `products.N.target_price` (N = index in `products`) |
| `products.*.clarity` | `{ type: text \| link \| pdf, val: string }` (`value` also accepted) |

**Example Request (as `AssignTargetModal.tsx submit()` sends)**

```json
{ "source": "master", "due_date": "2026-11-30", "assignee_id": "42",
  "products": [
    { "from": "master", "code": "P-001", "target_price": "1250",
      "clarity": { "type": "pdf", "val": "/storage/p2p/clarity/c12/Ab3…/spec.pdf" } },
    { "from": "master", "code": "P-014", "target_price": "870.50",
      "clarity": { "type": "link", "val": "https://example.com/spec" } },
    { "from": "manual", "name": "Custom gasket", "target_price": "85.50", "clarity": null } ] }
```

`source` = the radio's last choice; `assignee_id` = the picked id as a string;
products in list order; clarity files already uploaded.

**Example Response**

```json
{ "status": true, "data": { "id": "ST-005" } }
```

**Validation Messages**

| Field | Message |
|---|---|
| `assignee_id` | *Assign this sourcing target to a team member before saving.* |
| `due_date` | *Pick the Sourcing TAT (target completion date).* · *The Sourcing TAT cannot be in the past.* |
| `products` | *Add at least one product to the Product List.* |
| `products.*.code` | *Pick a product from the Product Master.* |
| `products.*.name` | *Enter the product name.* |
| `products.*.target_price` | *Enter the target price.* · *The target price must be a number (up to 2 decimals).* |

**Refusals**

| Case | Status / message |
|---|---|
| User has no company | 403 *No tenant context* |
| Assignee not an active, non-super-admin user of the company | 422 `errors.assignee_id` *Pick an active team member of your company to assign this sourcing target.* |

**Set by the server:** `code` (under a lock on the `clients` row), company,
branch, `start_date` = today, the names, `status` = *In Progress*; for a master
product its id, name, segment and HSN (looked up by code). **Self-assign is
allowed.** An unknown master code is accepted (`product_id` null, name = code).

### 4.4 Get a Sourcing Target (for Edit)

**Endpoint:** `GET /api/p2p/sourcing-targets/{code}` — view check

**Example Response**

```json
{ "status": true, "data": { "id": "ST-004", "source": "Product Master", "start": "2026-11-20", "due": "2026-11-30",
  "assignee": "Ravi", "assigneeId": "42", "assigneeActive": true,
  "masterRows": [ { "id": 12, "mapped": true, "code": "P-001", "name": "Bolt M8",
                    "segment": "Hardware", "hsn": "7318", "price": "1250",
                    "clarity": { "type": "pdf", "val": "/storage/…" } } ],
  "manualRows": [ { "id": 13, "mapped": false, "name": "Custom gasket", "price": "85.50", "clarity": null } ] } }
```

| Field | Meaning |
|---|---|
| `mapped` | The product has suppliers — it can't be removed |
| `assigneeActive` | `false` → the target is view-only |
| Master name / segment / HSN | Read **live** from the Product Master (the stored snapshot is not changed) |

### 4.5 Update a Sourcing Target

**Endpoint:** `PUT /api/p2p/sourcing-targets/{code}` — creator only

**Purpose:** Same body and rules as create, except `due_date` may be in the past.

**Checks, in order**

| # | Check | Refusal |
|---|---|---|
| 1 | Target in your company | 404 |
| 2 | You are the creator | 403 *Only the creator can edit this sourcing target.* |
| 3 | Validation | 422 |
| 4 | No product with suppliers is left out | 422 *"X" has suppliers mapped in the Sourcing Report and can't be removed. Unmap its suppliers first.* |
| 5 | Assignee active | 403 *This sourcing target's assignee is inactive or exited — it is view-only and can't be edited.* |

**Body Behaviour**

| In the body | What happens |
|---|---|
| `source`, `due_date` | Updated |
| `assignee_id` | **Required by validation but ignored** — send the current one |
| Product with a known `id` | Only `target_price`, `clarity` (and `name` if manual) change — **leaving `target_price` or `clarity` out clears it** |
| Product without `id`, or with an `id` of **another** target | Created as a new product |
| Product left out | Soft-deleted with its suppliers (refused if it has any — check 4) |

**Example Request (as the Edit form sends)**

```json
{ "source": "manual", "due_date": "2026-12-05", "assignee_id": "42",
  "products": [
    { "id": 12, "from": "master", "code": "P-001", "target_price": "1200",
      "clarity": { "type": "text", "val": "Grade A only" } },
    { "id": 13, "from": "manual", "name": "Custom gasket (EPDM)", "target_price": "85.50", "clarity": null },
    { "from": "manual", "name": "Spacer ring", "target_price": "40", "clarity": null } ] }
```

**Example Response**

```json
{ "status": true, "data": { "id": "ST-004" } }
```

**Never changed by edit:** assignee, start date, code, status, a kept master
product's snapshot.

### 4.6 Get the Sourcing Target Report

**Endpoint:** `GET /api/p2p/sourcing-targets/{code}/report` — view check

**Example Response**

```json
{ "status": true, "data": { "id": "ST-004", "source": "Product Master", "start": "2026-11-20", "due": "2026-11-30",
  "createdBy": "Asha", "assignee": "Ravi",
  "products": [ { "id": 12, "type": "master", "code": "P-001", "name": "Bolt M8",
                  "segment": "Hardware", "hsn": "7318", "price": "1250",
                  "status": "Completed", "supplierCount": 2,
                  "clarity": { "type": "pdf", "val": "/storage/…" } } ] } }
```

| Field | Meaning |
|---|---|
| `price` | Target price **exactly as stored** (e.g. `"1250"` or `"18,500"`) |
| `code` | Padded to 3 digits |
| `name` / `segment` / `hsn` | Live Product Master values for master rows with a `product_id`; else the snapshot |

> **Note:** there is **no delete** endpoint for a sourcing target.

---

## 5. TARGET PRODUCT APIS

### 5.1 Set Product Status

**Endpoint:** `PATCH /api/p2p/sourcing-targets/{code}/products/{id}/status` — view check

```json
{ "status": "Completed" }
```

**Response:** `{ "status": true, "data": { "id": 12, "status": "Completed" } }`

| Rule | Detail |
|---|---|
| Values | `Completed`, `In Progress` |
| Unknown product | 404 *Product not found in this sourcing target.* |
| Caller | **No screen calls it** |

### 5.2 Replace Product Clarity

**Endpoint:** `PUT /api/p2p/sourcing-targets/{code}/products/{id}/clarity` — view check

```json
{ "clarity_type": "text", "clarity_value": "Grade A only" }
```

**Response:** `{ "status": true, "data": { "id": 12, "clarity_type": "text", "clarity_value": "Grade A only" } }`

> **Important:** used by **Bulk Sourcing** only. Always send the
> `clarity_type` key (null to clear) — leaving it out causes a **500**
> (*Undefined array key*).

---

## 6. SUPPLIER MAPPING APIS

### 6.1 Supplier Mapping Object

```json
{
  "id": "31", "converted": false, "supplier_id": 17, "source": "Master", "canConvert": false,
  "name": "Acme", "segment": "…", "contact": "…", "mobile": "…", "email": "…",
  "card": "", "gmaps": "", "address": "", "country": "India", "state": "Gujarat",
  "state_code": "24", "city": "",
  "origin": "domestic", "currency": "INR", "price": 100.0,
  "gstPercentage": 18.0, "gstType": "inter", "cgst": 0.0, "sgst": 0.0, "igst": 18.0,
  "gstAmount": 18.0, "total": 118.0, "exchangeRate": null, "inrAmount": 118.0,
  "validTill": "2026-12-31",
  "vsTarget": { "target": 110.0, "difference": -10.0, "percent": 9.09, "status": "below" },
  "mappedOn": "2026-11-20T10:00:00+05:30"
}
```

| Field | Meaning |
|---|---|
| `source` | `Master` (Supplier Master vendor) or `New Supplier` |
| `canConvert` | A New Supplier not yet converted |
| `converted` | A **Master** row whose vendor is the `converted_vendor_id` of a New Supplier of your company — **per vendor**, so also `true` for that vendor's rows mapped directly |
| `vsTarget` | Compares the target with the **ex-GST price** (domestic) or the **INR amount** (international); `percent` always positive; `status` `below` / `above` / `at`; `null` without a price or target |

### 6.2 Supplier Pricing Rules

Applied to every mapping write (`SC::sourcingPrice()` → `SupplierPricing`).

| Field | Domestic Supplier | International Supplier |
|---|---|---|
| `origin` | Must match: supplier in India | Must match: supplier outside India |
| `currency` | Always INR | Sent, else by country (else USD); **INR refused** |
| `exchange_rate` | `null` | Sent, else the Currency master's rate |
| `gst_percentage` | Sent, default **18** | 0 |
| `gst_type` | Sent; else **intra** when the supplier's GST state code (or, without codes, state name) equals **your branch's**, else **inter** | `none` |
| `gst_amount` | `round(price × GST% ÷ 100, 2)` | 0 |
| CGST / SGST / IGST | intra: CGST = `round(GST ÷ 2, 2)`, SGST = GST − CGST · inter: IGST = GST | 0 |
| `total_amount` | Price + GST | Price |
| `inr_amount` | = total | `round(price × rate, 2)` |

**Price Validation**

| Rule | Value |
|---|---|
| Minimum price | Greater than 0 |
| Maximum price | 9,999,999,999.99 |
| Maximum total / INR amount | 999,999,999,999.99 |
| Exchange rate | Greater than 0, at most 99,999.9999 |
| GST % | 0–100 |
| `valid_till` | Today or later |

**Domestic Example** — Price ₹100, GST 18 %, intra → GST ₹18.00 (CGST ₹9.00 +
SGST ₹9.00), Total ₹118.00, INR ₹118.00.

**International Example** — Price USD 250, rate ₹84.20 → GST 0, Total USD
250.00, INR ₹21,050.00.

### 6.3 Supplier Mapping Validation Messages

| Validation | Field | Message |
|---|---|---|
| Missing price | `price` | *Please enter the supplier's unit price.* |
| Price ≤ 0 | `price` | *The unit price must be more than 0.* |
| Price too high | `price` | *The unit price cannot be more than 9,999,999,999.99.* |
| Rate ≤ 0 | `exchange_rate` | *The exchange rate must be more than 0.* |
| Rate too high | `exchange_rate` | *The exchange rate cannot be more than 99999.9999.* |
| Past Valid Till | `valid_till` | *Price Valid Till cannot be in the past.* |
| Indian supplier mapped as international | `origin` | *This supplier is based in India — map it as a Domestic supplier.* |
| Foreign supplier mapped as domestic | `origin` | *This supplier is based in {country} — map it as an International supplier.* |
| International with INR | `currency` | *Pick the supplier's currency — an International price is not in ₹.* |
| No rate anywhere | `exchange_rate` | *Please enter the exchange rate (₹ per {currency}).* |
| Total too large | `price` | *The total value is too large (max ₹ 999,999,999,999.99). Check the price and exchange rate.* |

These custom messages apply to `POST …/suppliers` and `PATCH …/price`.
`PUT …/suppliers/{m}` uses Laravel's default messages for price / rate / date.

### 6.4 Get Mapped Suppliers of a Product

**Endpoint:** `GET /api/p2p/sourcing-targets/{code}/products/{id}/suppliers` — view check

**Response:** `{ "status": true, "data": [ <mapping object>, … ] }` — newest first.

### 6.5 Map a Supplier Master Supplier

**Endpoint:** `POST /api/p2p/sourcing-targets/{code}/products/{id}/suppliers` — map check

**Example Request (as `SupplierMasterForm.tsx save()` sends)**

```json
{ "supplier_id": "17", "origin": "domestic", "price": 100, "gst_percentage": 18 }
```

```json
{ "supplier_id": "88", "origin": "international", "price": 250, "currency": "USD", "exchange_rate": 84.2 }
```

`supplier_id` is sent as a string. Domestic sends **no `gst_type`** (the server
derives it); the form has no `valid_till`.

**Rules and Refusals**

| Case | Status / message |
|---|---|
| Not creator / assignee / super admin | 403 *Only the creator or the assignee of this sourcing target can map suppliers.* |
| Neither `supplier_id` nor `new_supplier` | 422 *Provide supplier_id or new_supplier* |
| Unknown product | 404 *Product not found in this sourcing target.* |
| `supplier_id` not visible to you | **404** |
| Already mapped — a Master row for this vendor, **or** (CS-2308) a New Supplier row on the product converted into this vendor | 422 *"X" is already mapped to this product.* |
| Pricing rules | Section 6.3 |

**Saved:** a snapshot of the vendor's name, segment, primary-address contact /
mobile / email (else `vendors.primary_email`), country, state, state code, city
(no gmaps / address / card), plus pricing, `price_valid_till`, `mapped_by`. The
product's status becomes **Completed**.

**Example Response**

```json
{ "status": true, "data": { "supplierCount": 3 } }
```

`supplierCount` = all mappings of the product.

### 6.6 Map a New Supplier

**Endpoint:** `POST /api/p2p/sourcing-targets/{code}/products/{id}/suppliers` — map check

**Example Request — Domestic (as `NewSupplierForm.tsx save()` sends)**

```json
{ "new_supplier": { "name": "ABC Traders", "segment": "Hardware", "contact": "Priya",
                    "mobile": "9876543210", "email": "abc@example.com", "gmaps": "…",
                    "address": "Plot 4", "country": "India", "state": "Maharashtra",
                    "state_code": "27", "city": "Pune", "card": "/storage/p2p/supplier-cards/…" },
  "origin": "domestic", "price": 100, "gst_percentage": 18, "gst_type": "intra",
  "valid_till": "2026-12-31" }
```

**Example Request — International**

```json
{ "new_supplier": { "name": "Global Parts LLC", "segment": "Hardware", "contact": "Sam",
                    "mobile": "+1 555-123-4567", "email": "sam@globalparts.com",
                    "address": "1 Main St", "country": "United States", "state": "Texas", "city": "Austin" },
  "origin": "international", "price": 250, "currency": "USD", "exchange_rate": 84.2 }
```

Empty optional fields are left out. Domestic always sends `country: "India"` and a
`gst_type`. International sends no `state_code`. `card` is the path from
`POST /p2p/upload kind=card`. `valid_till` only when picked.

**Request Fields**

| Field | Validation | Attribute name in messages |
|---|---|---|
| `new_supplier.name` | required with `new_supplier`, ≤ 255 | *Supplier Company Name* |
| `new_supplier.email` | `nullable\|email\|max:255` | *Email* |
| `new_supplier.segment` | ≤ 512 | *Segment* |
| `new_supplier.contact` | ≤ 255 | *Contact Person* |
| `new_supplier.mobile` | ≤ 64 | *Contact Number* |
| `new_supplier.address` | ≤ 255 | *Street Address* |
| `new_supplier.country` / `.state` / `.city` | ≤ 128 | *Country* / *State* / *City* |
| `new_supplier.state_code` | ≤ 16 | *State Code* |
| `new_supplier.gmaps` | ≤ 512 | *Google Maps Link* |
| `new_supplier.card` | ≤ 512 | — |
| `origin` | `domestic` \| `international` (defaults from the country) | — |
| `price`, `gst_percentage`, `gst_type`, `currency`, `exchange_rate`, `valid_till` | Section 6.2 | — |

**Refusals (in addition to Section 6.3)**

| Case | Status / message |
|---|---|
| Name missing / bad email | 422 *Enter the supplier company name.* / *Enter a valid supplier email address.* |
| International but country India or blank | 422 `errors["new_supplier.country"]` *Please select the supplier's country (outside India).* |
| Domestic but country outside India | 422 `errors["new_supplier.country"]` *A Domestic supplier must be in India — choose International for an overseas supplier.* |
| Directory entry already converted | 422 *"X" is already in the Supplier Master — map it from Supplier Master.* |
| Already mapped to this product | 422 *"X" is already mapped to this product.* |
| Email used anywhere in the system | 422 `errors.email` *This email address is already used by another vendor or supplier in the system. Please use a different address.* |

**New Supplier Directory Rule**

| Condition | Result |
|---|---|
| An entry with the same name (ignoring case) exists in your company | **Reused as is** — not updated, email not checked |
| No such entry | A new `p2p_suppliers` row is created (system-wide email check runs) |

Pricing and origin errors come before the entry is created, and a duplicate
email stops the create, so a refused request normally leaves nothing behind.

**Saved:** one mapping row with every field as sent + pricing + `mapped_by`;
the product's status becomes **Completed**.

**Example Response:** `{ "status": true, "data": { "supplierCount": 3 } }`

### 6.7 Edit a New Supplier Mapping

**Endpoint:** `PUT /api/p2p/sourcing-targets/{code}/products/{id}/suppliers/{m}` — map check

**Purpose:** Edit a New Supplier's details and quote. Same body as 6.6.

**Example Request (as the Edit form sends)**

```json
{ "new_supplier": { "name": "ABC Traders", "segment": "Hardware", "contact": "Priya Shah",
                    "mobile": "9876543210", "email": "abc@example.com", "address": "Plot 4, MIDC",
                    "country": "India", "state": "Maharashtra", "state_code": "27", "city": "Pune",
                    "card": "/storage/p2p/supplier-cards/c12/Xy…/card.jpg" },
  "origin": "domestic", "price": 95, "gst_percentage": 18, "gst_type": "intra" }
```

**Rules and Refusals**

| Case | Status / message |
|---|---|
| Not creator / assignee / super admin | 403 *Only the creator or the assignee of this sourcing target can edit its suppliers.* |
| Unknown mapping | 404 *Mapped supplier not found for this product.* |
| Not a New Supplier row | 422 *Only new (manual) suppliers can be edited here. Edit master suppliers from the Supplier master.* |
| Country vs the saved origin | 422 *This is an International supplier — choose a country outside India.* / *This is a Domestic supplier — the country must be India.* |
| `new_supplier` / `name` | required |

**Important Behaviour**
* `price` re-prices only when sent (the screen always sends it).
* **Optional fields left out are cleared** — including `card` (send the current path to keep it; `""` removes it).
* `price_valid_till` becomes the sent `valid_till` or null.
* Also updates the shared directory entry (`p2p_suppliers`: name + every contact field) with a query-builder `update()` — **without** the unique-email check.
* `mapped_by` is **not** changed.

**Example Response:** `{ "status": true, "data": { "id": "31" } }`

### 6.8 Re-quote a Mapping (Edit Price)

**Endpoint:** `PATCH /api/p2p/sourcing-targets/{code}/products/{id}/suppliers/{m}/price` — map check

**Purpose:** Change only the price of any mapping. The screen uses it for Master
rows (**Edit price**).

**Example Request (as the Edit price form sends)**

```json
{ "origin": "domestic", "price": 95, "gst_percentage": 12, "valid_till": "2026-12-31" }
```

```json
{ "origin": "international", "price": 240, "currency": "USD", "exchange_rate": 84.5 }
```

`valid_till` = the card's stored date, sent only when there is one.

**Rules**

| Rule | Detail |
|---|---|
| Fields | `price` required; `gst_percentage`, `gst_type`, `currency`, `exchange_rate`, `valid_till` as in 6.2 (custom messages) |
| Access | 403 *Only the creator or the assignee of this sourcing target can change a mapped supplier's price.* |
| Origin | Taken from the **row** — a sent `origin` is overwritten |
| Country / state | From the row; for Domestic without `gst_type`, GST type is re-derived against the **calling user's** branch |
| `valid_till` | Left out → cleared; a stored date now in the past → refused |
| `mapped_by` | Becomes the current user |

**Response:** the full mapping object (Section 6.1) — `converted` is always
`false` here.

---

## 7. NEW SUPPLIER DIRECTORY AND CONVERT APIS

### 7.1 Convert Overview

Convert turns a New Supplier into a Supplier Master vendor. It uses **three**
calls; the **link** is made at the Supplier wizard's Contacts step.

```
1. GET  /api/p2p/new-suppliers/{s}/convert        → prefill for the Add Supplier wizard
2. (wizard) POST /api/vendors/step/identity       → vendor created
3. POST /api/vendors/{id}/step/contacts (_method=PUT) + convert_supplier_id   ══► LINK
4. (wizard) KYC → finish
5. POST /api/p2p/new-suppliers/{s}/convert {vendor_id}   → confirm + copy business card
```

### 7.2 List New Suppliers

**Endpoint:** `GET /api/p2p/new-suppliers` — company only

```json
{ "status": true, "data": [ { "id": 5, "name": "ABC Traders", "origin": "domestic", "email": "…",
  "sourcing_count": 2, "converted": false, "converted_vendor_id": null,
  "converted_at": null, "created_at": "…" } ] }
```

`sourcing_count` = distinct targets. **No screen calls it.**

### 7.3 Where a New Supplier Is Mapped

**Endpoint:** `GET /api/p2p/new-suppliers/{s}/sourcings` — company only

```json
{ "status": true, "data": [ { "code": "ST-003", "due_date": "2026-12-01", "products": ["Bolt M8"] } ] }
```

An unknown id returns **200 with `[]`**. No screen calls it.

### 7.4 Get Convert Prefill

**Endpoint:** `GET /api/p2p/new-suppliers/{s}/convert` — company only

**Example Response**

```json
{ "status": true, "data": { "supplier_id": 5, "origin": "domestic", "converted": false,
  "converted_vendor_id": null, "sourcing_count": 3,
  "identity": { "company_name": "ABC Traders", "legal_name": "ABC Traders",
                "primary_email": "…", "segment_id": 2, "segment": "Hardware",
                "gst_applicable": null },
  "address": { "address_line": "…", "country_id": 1, "country": "India",
               "state_id": 14, "state": "Maharashtra", "state_code": "27",
               "city": "Pune", "google_location": "…", "contact_name": "Priya",
               "contact_no": "…", "email": "…", "is_primary": true },
  "business_card": "/storage/…" } }
```

| Field | Note |
|---|---|
| `country_id`, `state_id`, `segment_id` | Matched by name (case-insensitive) |
| `gst_applicable` | `"No"` for international |
| `business_card` | Returned, but the screen does not pass it to the wizard; the card reaches the vendor only through 7.6 |
| `sourcing_count` | Counts **mapping rows** (7.2 counts targets) |
| Unknown id | 404 |

### 7.5 The Link — Supplier Wizard Contacts Step

**Endpoint:** `PUT /api/vendors/{id}/step/contacts` (sent as multipart `POST` with `_method=PUT`)
**Controller:** `VendorController::storeContacts()` (Supplier Management)

**Example Request (as `AddVendorModal.tsx saveContacts()` sends)**

```
POST /api/vendors/88/step/contacts      multipart/form-data
_method=PUT
primary_address[address_type]=…            primary_address[address_line]=Plot 4, MIDC
primary_address[country_id]=1              primary_address[state_id]=14
primary_address[state_code]=27             primary_address[city]=Pune
primary_address[pincode]=                  primary_address[google_location]=https://maps.google.com/…
primary_address[contact_name]=Priya        primary_address[designation]=Sales Manager
primary_address[contact_no]=9876543210     primary_address[email]=abc@example.com
primary_address[whatsapp_enabled]=1
primary_attachment=<file>   or   primary_address[attachment_path]=<saved path>   (only if there is one)
convert_supplier_id=5
```

**Validation (Supplier Management's own)**

| Field | Rule |
|---|---|
| `primary_address` | required |
| `contact_name` | `required\|string\|max:255` |
| `email` | `nullable\|email\|max:255` |
| `google_location` | must start with `http(s)://` |
| `country_id` / `state_id` | must exist in `master_countries` / `master_states` |
| `primary_attachment` | `jpg,jpeg,png,webp,pdf` |
| `convert_supplier_id` | `nullable\|integer` |

**Refusals**

| Case | Status / message |
|---|---|
| Vendor not visible (`Vendor::forUser()->findOrFail`) | 404 (`hierarchicalDenial()` returns null for vendors, so no 403) |
| New Supplier not in your company, or converted into a **different** vendor | 422 `errors.convert_supplier_id` *This New Supplier cannot be converted into this supplier.* |
| Email used by another vendor / New Supplier | 422 `errors.primary_email` *This email address is already used by another vendor or supplier in the system. Please use a different address.* |

**Processing**
1. While the contact is saved, the New Supplier's own email is exempt from the duplicate check (`Vendor::$convertingSupplierId`, plus New Suppliers already converted into this vendor).
2. If not yet linked to this vendor: each `source=new` mapping **moves** to the vendor (takes the vendor's name, keeps the old contact / email / mobile / card snapshot) or is **merged** (soft-deleted) when that product already has the vendor as Master.
3. `converted_vendor_id`, `converted_at`, `converted_by` are stamped.
4. **The business card is not copied here.**

**Response:** the Supplier API's normal contacts-step response. In Convert, a
refusal shows as the wizard's *"Save failed"* toast.

### 7.6 Confirm Convert

**Endpoint:** `POST /api/p2p/new-suppliers/{s}/convert` — company only

**Purpose:** After the wizard has saved the whole supplier: confirm the link and
copy the business card.

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
| Vendor not in your company (any branch accepted) | 422 `errors.vendor_id` *Unknown supplier in the Supplier Master.* |
| Converted to another vendor | 422 `{"status":false,"message":"“X” is already converted to another supplier in the Supplier Master."}` |

**Processing**
1. Converting into the **same** vendor is allowed (the normal case — the Contacts step already linked it).
2. Any `source=new` mapping still left moves or merges (normally none, so `mappings_moved` / `mappings_merged` are usually 0).
3. `converted_*` stamped again (`converted_at` / `converted_by` overwritten).
4. `copyBusinessCard()`: the New Supplier's card file is copied to `vendor_documents/{vendor_id}/contact-{8 hex}__{name}.{ext}` and set as the primary address's `attachment_path` — skipped (`business_card_copied: false`) when there is no card, no primary row, the row already has an attachment, or the file is missing.

**Example Response**

```json
{ "status": true, "data": { "supplier_id": 5, "vendor_id": 88, "vendor_code": "S-088", "vendor_name": "ABC Traders",
  "mappings_moved": 0, "mappings_merged": 0, "business_card_copied": true,
  "message": "ABC Traders is now in the Supplier Master as S-088." } }
```

---

## 8. CURL API TESTING REFERENCE

### 8.1 Configure Authentication and Base URL

```bash
TOKEN=…
API=http://localhost:8000/api
T="Authorization: Bearer $TOKEN"
```

### 8.2 List My Targets (search by due date)

```bash
curl -H "$T" "$API/p2p/sourcing-targets?tab=all&page=1&per_page=10&q=30/11/2026"
```

### 8.3 Upload a Clarity PDF

```bash
curl -X POST -H "$T" "$API/p2p/upload" -F kind=clarity -F file=@spec.pdf
```

### 8.4 Create a Target

```bash
curl -X POST -H "$T" -H "Content-Type: application/json" "$API/p2p/sourcing-targets" -d '{
  "source":"master","due_date":"2026-11-30","assignee_id":42,
  "products":[{"from":"master","code":"P-001","target_price":"1250",
               "clarity":{"type":"text","val":"Grade A only"}}]}'
```

### 8.5 Get the Report

```bash
curl -H "$T" "$API/p2p/sourcing-targets/ST-004/report"
```

### 8.6 Map a Supplier Master Supplier (Domestic)

```bash
curl -X POST -H "$T" -H "Content-Type: application/json" \
  "$API/p2p/sourcing-targets/ST-004/products/12/suppliers" \
  -d '{"supplier_id":17,"origin":"domestic","price":100,"gst_percentage":18}'
```

**Expected:** the product becomes **Completed**; response `{ supplierCount }`.

### 8.7 Map a New Supplier (International)

```bash
curl -X POST -H "$T" -H "Content-Type: application/json" \
  "$API/p2p/sourcing-targets/ST-004/products/12/suppliers" -d '{
  "new_supplier":{"name":"Global Parts LLC","contact":"Sam","mobile":"+1 5551234567",
                  "email":"sam@globalparts.com","address":"1 Main St","country":"United States","city":"Austin"},
  "origin":"international","price":250,"currency":"USD","exchange_rate":84.2}'
```

### 8.8 Re-quote a Mapping

```bash
curl -X PATCH -H "$T" -H "Content-Type: application/json" \
  "$API/p2p/sourcing-targets/ST-004/products/12/suppliers/31/price" \
  -d '{"origin":"domestic","price":95,"gst_percentage":18}'
```

### 8.9 Confirm Convert

Run after the Add Supplier wizard saved vendor 88 (its Contacts step with
`convert_supplier_id=5` already linked it):

```bash
curl -X POST -H "$T" -H "Content-Type: application/json" \
  "$API/p2p/new-suppliers/5/convert" -d '{"vendor_id":88}'
```

---

## 9. COMPLETE API ENDPOINT REFERENCE

All paths are relative to `/api`.

| No. | Method | Endpoint | Function | Access | Section |
|---|---|---|---|---|---|
| 1 | GET | `/p2p/products` | Product Master picker | group | 2.1 |
| 2 | GET | `/p2p/team-members` | Assign To list | group | 2.2 |
| 3 | GET | `/p2p/suppliers` | Supplier Master pool | group | 2.3 |
| 4 | GET | `/p2p/form-masters` | Dropdown masters | group | 2.4 |
| 5 | POST | `/p2p/upload` | Upload clarity / card | group | 3.2 |
| 6 | GET | `/p2p/clarity/download` | Download clarity | company | 3.3 |
| 7 | GET | `/p2p/sourcing-targets` | List targets | group | 4.1 |
| 8 | GET | `/p2p/sourcing-targets/next-code` | Preview next code | group | 4.2 |
| 9 | POST | `/p2p/sourcing-targets` | Create target | company | 4.3 |
| 10 | GET | `/p2p/sourcing-targets/{target}` | Get target for Edit | view | 4.4 |
| 11 | PUT | `/p2p/sourcing-targets/{target}` | Update target | creator | 4.5 |
| 12 | GET | `/p2p/sourcing-targets/{target}/report` | Report | view | 4.6 |
| 13 | PATCH | `…/products/{product}/status` | Set product status (unused) | view | 5.1 |
| 14 | PUT | `…/products/{product}/clarity` | Replace clarity (Bulk Sourcing) | view | 5.2 |
| 15 | GET | `…/products/{product}/suppliers` | Mapped suppliers | view | 6.4 |
| 16 | POST | `…/products/{product}/suppliers` | Map a supplier (Master or New) | map | 6.5 / 6.6 |
| 17 | PUT | `…/products/{product}/suppliers/{supplier}` | Edit a New Supplier mapping | map | 6.7 |
| 18 | PATCH | `…/products/{product}/suppliers/{supplier}/price` | Re-quote a mapping | map | 6.8 |
| 19 | GET | `/p2p/new-suppliers` | New Supplier directory (unused) | company | 7.2 |
| 20 | GET | `/p2p/new-suppliers/{supplier}/sourcings` | Where mapped (unused) | company | 7.3 |
| 21 | GET | `/p2p/new-suppliers/{supplier}/convert` | Convert prefill | company | 7.4 |
| 22 | POST | `/p2p/new-suppliers/{supplier}/convert` | Confirm convert | company | 7.6 |
| 23 | PUT | `/vendors/{id}/step/contacts` | Supplier wizard Contacts step (Convert link) | vendor visible | 7.5 |

**Total documented endpoints: 23** (22 in `SourcingController` + 1 in `VendorController`).

---

## 10. KNOWN API GAPS

### 10.1 Data Integrity

| # | Gap |
|---|---|
| 3 | Mapping a New Supplier creates the directory entry and the mapping without a transaction — an orphan entry only if the mapping insert itself fails |
| 11 | Target codes are count + 1 with no unique index — duplicates are possible |
| 14 | A **target product's** segment column is 128 characters while a Product Master segment can be 255 → `POST` / `PUT` target → 500. *(The New Supplier segment columns were fixed to 512.)* |
| 15 | `PUT` target silently clears a kept product's `target_price` / `clarity` when left out |
| 28 | `PUT …/suppliers/{m}` mass-updates the **shared** `p2p_suppliers` row (name included) — every mapping of that New Supplier on every target, and a later convert prefill, are affected; the new name isn't checked |

### 10.2 Validation and Business Rules

| # | Gap |
|---|---|
| 2 | `PUT` target requires `assignee_id` but ignores it |
| 6 | `PATCH …/price` refuses a saved `valid_till` now in the past, so a Supplier Master re-quote after expiry fails from the screen |
| 20 | No upper value cap on `target_price` on the server (only the 64-character / format rule) |
| 22 | `GET /p2p/suppliers` has no vendor status filter — inactive / incomplete vendors can be mapped |
| 23 | `PATCH …/price` on a Domestic row re-derives `gst_type` from the **calling user's** branch — can flip intra ↔ inter |
| 24 | `POST` / `PUT` mapping trusts a sent `gst_type` |
| 25 | `PUT …/suppliers/{m}` does not update `mapped_by`; `PATCH …/price` does |
| 26 | `/p2p/team-members` filters by the **user's** branch only; `POST` target doesn't re-check the list rules |
| 27 | `PUT …/suppliers/{m}` keeps `valid_till` `after_or_equal:today` with Laravel's default message; a card whose Valid Till has passed can't be saved until the date is changed or cleared |

### 10.3 Security and Access

| # | Gap |
|---|---|
| 1 | Client admin can **view** a target and change product **status / clarity**, but can't map or re-price |
| 4 | The duplicate-email check is **system-wide** (all companies) |
| 5 | `PUT …/suppliers/{m}` skips the email check and clears optional fields not sent |
| 10 | Upload type checked by extension only; clarity files reachable by their direct `/storage/…` URL |
| 12 | Convert endpoints (and the `convert_supplier_id` link) check only the company — any user can convert any New Supplier of the company |

### 10.4 Consistency and Unused Endpoints

| # | Gap |
|---|---|
| 7 | `sourcing_count` means targets in one endpoint and mapping rows in another |
| 8 | `/new-suppliers/{s}/sourcings` returns 200 `[]` for an unknown id |
| 9 | `PATCH …/status`, `GET /p2p/new-suppliers` and `…/sourcings` have no caller in the app |
| 13 | `PUT …/clarity` without `clarity_type` → 500 |
| 17 | Convert link split over two calls: abandoned **after** Contacts → converted but card never copied; abandoned **before** → the vendor from the identity step stays unlinked |
| 18 | `converted` on a mapped row is per **vendor**, not per row |
| 19 | `PATCH …/price` returns `converted: false` for every row |
| 21 | There is **no delete** endpoint for a sourcing target |

### 10.5 Fixed

| # | Fix |
|---|---|
| 14 (part) | `2026_06_24_000010` widened the New Supplier segment columns to 512 |
| 16 | `bf7dad2ed` — the Convert link now happens at the Contacts step, and `POST …/convert` looks the vendor up client-wide (was branch-scoped) |

---

## 11. IMPORTANT IMPLEMENTATION NOTES

### 11.1 Sourcing Workflow (API order)

**Stage 1 — Create the target**
1. `GET /p2p/products`, `GET /p2p/team-members`, `GET /p2p/sourcing-targets/next-code`.
2. For each product with a new clarity file: `POST /p2p/upload kind=clarity`.
3. `POST /p2p/sourcing-targets` → `ST-005`, status *In Progress*.

**Stage 2 — Map suppliers**
1. `GET …/report`.
2. Supplier Master path: `GET /p2p/suppliers?origin=` + `GET …/products/{id}/suppliers` (to know who is already mapped) → `POST …/suppliers` with `supplier_id`.
3. New Supplier path: `GET /p2p/form-masters` → optional `POST /p2p/upload kind=card` → `POST …/suppliers` with `new_supplier`.
4. Each successful map marks the product **Completed**; the target is complete when every product is.

**Stage 3 — (optional) Convert a New Supplier**
1. `GET /p2p/new-suppliers/{s}/convert`.
2. Add Supplier wizard: identity → **contacts with `convert_supplier_id`** (link) → KYC.
3. `POST /p2p/new-suppliers/{s}/convert {vendor_id}`.

### 11.2 Key Backend Considerations

| Topic | Note |
|---|---|
| Tenant isolation | Targets are looked up inside your company; another company's target → 404 |
| Server-computed money | GST, totals and INR are always computed on the server; never trust client amounts |
| International currency | INR is refused for an international mapping |
| Snapshots | Product name / segment / HSN and supplier contact are copied when saved |
| Product status | Set to *Completed* by mapping; there is no unmap, so it never reverts |
| Target status | The `status` column stays *In Progress*; progress is computed |
| Full-row edits | `PUT` target and `PUT …/suppliers/{m}` clear fields left out — always send the whole row |
| Directory by name | New Suppliers are matched by name (ignoring case) and reused as is |
| Unique email | System-wide across `vendors` and `p2p_suppliers` |
| File security | Clarity download checks the company, but public-disk URLs bypass it |

---

## END OF DOCUMENT

**Document:** P2P Sourcing Management Tracker — API Documentation  
**Module:** Sourcing Management Tracker  
**Framework:** Laravel  
**Authentication:** Laravel Sanctum  
**Scope:** Lookups, file upload / download, sourcing target CRUD, report, supplier mapping and pricing, New Supplier directory, Convert to Supplier Master (incl. Supplier Management integration)  
**Total endpoints:** 23  
**Related documents:** Functional Documentation · Technical Documentation · Code Walkthrough  
**Verified against code up to:** commit `6170fa175`
