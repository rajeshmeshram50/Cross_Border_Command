# P2P SUPPLIER MANAGEMENT

## Technical Documentation

**Module:** P2P Supplier Management  
**Menu Path:** Procure to Pay (P2P) → P2P Master Management → Supplier Management  
**Technology Stack:** Laravel, PHP, React, TypeScript, PostgreSQL  
**Backend:** Laravel REST APIs  
**Frontend:** React / TypeScript  
**Document Type:** Technical Documentation  

---

## CONTENTS

1. Introduction
2. Technology Stack
3. System Architecture
4. Project File Structure
5. API Routes
6. Data Model
7. Business Logic
8. Security and Access Control
9. Frontend Architecture
10. UI — Responsive Layout, Dark Mode and CSS
11. Integration with Other Modules
12. Data Source and Storage Map
13. Known Technical Issues

---

## 1. INTRODUCTION

### 1.1 Purpose

This document explains **how Supplier Management is built**: the
architecture, the database, the business rules in the code, security, and how
the frontend is organised. It is written for developers who will maintain or
extend the module. The Functional document says *what* the screens do; this one
says *how*.

### 1.2 Related Documents

| Document | Use it for |
|---|---|
| Functional Documentation | What the module does for the user |
| Code Walkthrough | Step-by-step screen → API → database flow for every feature |
| API Documentation | Every endpoint with request and response |

### 1.3 Conventions

* **VC** = `app/Http/Controllers/Api/VendorController.php`
* **SDUC** = `app/Http/Controllers/Api/SegmentDocUploadController.php`
* **FE** = `resources/js/pages/p2p/p2p-master-management/supplier-management/`
* Code is referenced by **function, component or constant name** (e.g.
  `VC::storeIdentity()`, `Vendors.tsx recompute()`), not by line number — line
  numbers change with every edit (the backend files lost all their comments on
  23-Nov-2026). Search for the name.
* "Bundle" = `GET /vendors/master-bundle` (the wizard's dropdown masters).
* Verified against the code up to commit `cdc5aff67` (Supplier Behaviour from
  its master; CS-2327 no-GST product rule from `da7a6d271`; Convert link at the
  Contacts step from `bf7dad2ed`).

### 1.4 What This Module Does NOT Do

* It does **not** decide which documents are required — the CLM Document Control Panel does.
* It does **not** sign anything itself — signing runs through the PO's Stage 04 and Zoho Sign; the vault only starts and tracks it.
* It does **not** run background jobs or queued listeners. It does have model events: `Vendor::booted()` registers `saved` / `deleted` / `restored` hooks that call `MasterBundleCache::bump()`, and `EnforcesUniqueEmail` (`bootEnforcesUniqueEmail()`) adds a `saving` listener for the unique primary email.
* It does **not** enforce a separate add / edit permission.
* It does **not** show or change the supplier's `status` on screen; status moves only as a side effect of the KYC and product saves.

---

## 2. TECHNOLOGY STACK

| Layer | Technology |
|---|---|
| Backend | PHP 8.2, Laravel 12 |
| Database | PostgreSQL |
| Authentication | Sanctum bearer token + `user.active` + `tenant` middleware (the `Route::middleware(['auth:sanctum','user.active','tenant'])` group in `routes/api.php`). No per-route permission or throttle middleware |
| Frontend | React 19 + TypeScript, built with Vite |
| HTTP client | Axios (Bearer token, `branch_id` on GETs) |
| File storage | `public` disk — local `storage/app/public`, or Azure Blob when `FILESYSTEM_DISK=azure` |
| Queue / jobs | None for this module |
| Cache | `MasterBundleCache` (server, per user, 5 min) · `sessionStorage` bundle cache (browser, 5 min) |
| Service layer | None — there is **no `VendorService`**; all supplier CRUD and step logic is in `VendorController` |

---

## 3. SYSTEM ARCHITECTURE

### 3.1 Layer Diagram

```
React  supplier-management/
  Vendors.tsx                    the list
  ├─ SupplierScopeGate.tsx        Domestic / International chooser      (lazy)
  ├─ AddVendorModal.tsx           the wizard + Mapped Products / Services (lazy)
  ├─ SupplierEvidenceVaultModal   the vault                              (lazy)
  ├─ serviceMapping.ts            Supplier Type → service bucket
  └─ vendorBundleCache.ts         sessionStorage cache of /vendors/master-bundle
       │  axios (Bearer token, branch_id on GETs)
       ▼
routes/api.php   auth:sanctum · user.active · tenant
       ▼
VendorController            list, show, every wizard step, contacts, banks,
                            GST scrutiny, product + service mappings, delete
SegmentDocUploadController  KYC / DD / TL uploads, the Evidence Vault payload
P2p\ServiceController       the service catalogue (/p2p/services)
P2p\SourcingController      Convert to Supplier (prefill + final link; the link
                            itself is made by VendorController::storeContacts)
       ▼
SegmentGuard            supplier-type and segment locks
SupplierCompliance      Compliant / Non Compliant, batched
SegmentDocScope         which document codes apply (segment × Domestic/International)
ServiceSupplierMapping  which supplier may map which service, and its pricing
SupplierPricing         product pricing
MasterVisibility        tenant / branch row scope
       ▼
vendors · vendor_addresses · vendor_segments · vendor_documents · vendor_owners
vendor_bank_accounts · vendor_gst_scrutiny · vendor_product_mappings
p2p_service_suppliers · segment_doc_uploads · p2p_suppliers (New Suppliers)
```

### 3.2 Which Component Calls Which API

| Component | Calls |
|---|---|
| `Vendors.tsx` (list) | `GET /vendors` (rows + facets; up to 1000 rows for type tabs) · `GET /p2p/services?per_page=200` (Mapped Services counts) |
| `AddVendorModal` — Stage 1 | `GET /vendors/master-bundle` · `GET /vendors/{id}` · `GET /clm/segment-rules` · `POST /vendors/step/identity` · `PUT /vendors/{id}/step/contacts` (multipart, `_method=PUT`) · contacts CRUD · `GET /clm/segments?lite=1` / `POST /clm/segments` (Segment "+") |
| `AddVendorModal` — Stage 2 | `GET /clm/segment-rules/for-segment/{id}?document_type=` · `GET /clm/trade-doc-library/for-party/supplier` · `POST` / `DELETE /segment-uploads/supplier/{id}` · bank-accounts CRUD · gst-scrutiny CRUD · `POST /vendors/{id}/step/kyc` |
| Mapped Products (wizard / `MappedProductsViewPopup`) | `GET /products?per_page=500&lite=1` · `GET /vendors/{id}/product-mappings` · `POST /vendors/{id}/step/products` |
| Mapped Services (`MappedServicesViewPopup`) | `GET /vendors/{id}/service-mappings` · `GET /p2p/services` · `GET /p2p/services/master-bundle` · `POST /vendors/{id}/step/services` · `PATCH` / `DELETE /vendors/{id}/service-mappings/{map}` |
| `SupplierEvidenceVaultModal` | `GET /segment-uploads/supplier/{id}/vault` · `/summary` · `GET /segment-uploads/download` · CLM signature requests · PO document generate / download / sign / mark-sent |
| Convert (from Sourcing Tracker) | `GET` / `POST /p2p/new-suppliers/{id}/convert` around the wizard |

---

## 4. PROJECT FILE STRUCTURE

### 4.1 Backend

| File | Responsibility |
|---|---|
| `app/Http/Controllers/Api/VendorController.php` | List, show, every wizard step, contacts, banks, GST scrutiny, product + service mappings, delete, master bundle |
| `app/Http/Controllers/Api/SegmentDocUploadController.php` | KYC / DD / TL uploads, downloads, the Evidence Vault payload (`buildPoDeals()`, `shapePoDoc()`, `buildSpiDocs()`, `buildVendorDeals()`) |
| `app/Support/SegmentGuard.php` | Supplier-type and segment locks (`vendorCommittedDocument()`, `PO_COMMITTED`, `SPI_COMMITTED`, `docKeys()`) |
| `app/Support/SupplierCompliance.php` | Batched Compliant / Non Compliant |
| `app/Support/SegmentDocScope.php` | Which document codes apply |
| `app/Support/ServiceSupplierMapping.php` | Service bucket checks (`assertServes`), pricing (`priceFields`), `gstSplit`, `vendorServiceType()` |
| `app/Support/SupplierPricing.php` | Product pricing helpers |
| `app/Support/MasterVisibility.php` | Tenant / branch row scope, `hierarchicalDenial()` |
| `app/Support/MasterBundleCache.php` | Server bundle cache |
| `app/Support/Gst.php` | GST helpers (used by service pricing, not by VC) |
| `app/Models/Vendor.php` | `scopeForUser`, `EnforcesUniqueEmail`, `$convertingSupplierId`, `sameEmailOwnerRows()`, cache-bump hooks |

### 4.2 Frontend

| File | Responsibility |
|---|---|
| `Vendors.tsx` | The list: tabs, search, filters, auto-fit, count columns, popups |
| `SupplierScopeGate.tsx` | Domestic / International chooser |
| `AddVendorModal.tsx` | The wizard (Stage 1, Stage 2), Mapped Products, `SegmentRefUploadPopup` |
| `SupplierEvidenceVaultModal.tsx` | The Evidence Vault |
| `MappedProductsViewPopup`, `MappedServicesViewPopup` | List-row popups |
| `serviceMapping.ts` | `serviceBucketOf()` — Supplier Type → service bucket |
| `vendorBundleCache.ts` | `sessionStorage` bundle cache, `bustVendorMasterBundle()` |
| CSS | `supplier-management.css`, `add-vendor-modal.css`, `supplier-evidence-vault.css`, `supplier-scope-gate-teal.css` |

> `resources/js/pages/vendors/Vendors.tsx` is an **orphan copy** — nothing
> imports it and `/suppliers` does not use it. Edit the file under
> `pages/p2p/p2p-master-management/supplier-management/`, never this one.

---

## 5. API ROUTES

### 5.1 Supplier Routes (`VendorController`)

All in `routes/api.php`, inside the `auth:sanctum, user.active, tenant` group.

| Method | URI | VC method |
|---|---|---|
| GET | `/vendors` | `index` — list, search, filters, facets (`?light=1` = picker shape) |
| GET | `/vendors/master-bundle` | `masterBundle` — dropdown masters for the wizard |
| GET | `/vendors/{id}` | `show` (`?lite=1` supported) — includes the lock flags |
| GET | `/vendors/{id}/product-mappings` | `productMappings` |
| POST | `/vendors/step/identity` | `storeIdentity` — creates or updates Stage 1 |
| PUT | `/vendors/{id}/step/contacts` | `storeContacts` (the FE posts multipart with `_method=PUT`) |
| POST / PUT / DELETE | `/vendors/{id}/contacts[/{contact}]` | `storeContact` / `updateContact` / `destroyContact` |
| POST / PUT / DELETE | `/vendors/{id}/bank-accounts[/{bank}]` | `storeBankAccount` / `updateBankAccount` / `destroyBankAccount` |
| POST / PUT / DELETE | `/vendors/{id}/gst-scrutiny[/{gst}]` | `storeGstScrutiny` / `updateGstScrutiny` / `destroyGstScrutiny` |
| POST | `/vendors/{id}/step/kyc` | `storeKyc` |
| POST | `/vendors/{id}/step/products` | `storeProducts` — **replace-all** |
| GET | `/vendors/{id}/service-mappings` | `serviceMappings` — rows + summary + `meta` |
| POST | `/vendors/{id}/step/services` | `storeServices` — **replace-all** |
| PATCH / DELETE | `/vendors/{id}/service-mappings/{map}` | `updateServiceMapping` / `destroyServiceMapping` |
| DELETE | `/vendors/{id}` | `destroy` (soft delete) |

There is **no separate counts endpoint** — the facets come back with `GET /vendors`.

### 5.2 Related Endpoints Used by the Module

| Endpoint | Controller | Used for |
|---|---|---|
| `GET /segment-uploads/supplier/{id}/vault` · `/summary` | SDUC | The Evidence Vault |
| `POST /segment-uploads/supplier/{id}` · `DELETE …/{uploadId}` | SDUC | Upload / delete a KYC · DD · TL document |
| `GET /segment-uploads/download` | SDUC | Streams a file |
| `GET /clm/segment-rules/for-segment/{id}?document_type=` | `ClmSegmentRuleController::forSegment` | Which documents Stage 2 asks for |
| `GET /clm/segment-rules` | `ClmSegmentRuleController::index` | Which segments have a rule per origin (`useRuledSegments`) — DOM / INT badges, greyed-out segments |
| `GET /clm/segments?lite=1` · `POST /clm/segments` | CLM | The Segment "+" quick-add only |
| `GET /clm/trade-doc-library/for-party/supplier` | CLM | Called with the Stage 2 rules; its result never changes the screen (no `td` rows) |
| `GET` / `POST /clm/signature-requests` · `GET …/{id}` (+ `/view-file/0`, `/certificate`, `/declined-file`) · `POST …/{id}/remind` | `ClmSignatureController` | Vault: statuses (`sync=1`), CLM send, tracker, reminders |
| `POST /p2p/orders/{po}/documents/{doc}/generate` · `GET …/{doc}/download` · `POST /p2p/orders/{po}/documents/sign` · `POST …/documents/mark-sent` | `PurchaseOrderDocumentController` | Vault: PO PDF, PO-only send, marking a bundled PO sent |
| `GET /products?per_page=500&lite=1` | `ProductController::index` | Map Product options (capped at 200) |
| `GET /p2p/services` · `/p2p/services/master-bundle` | `P2p\ServiceController` | Service catalogue, currencies |
| `GET` / `POST /p2p/new-suppliers/{id}/convert` | `P2p\SourcingController` | Convert to Supplier (prefill / final link + business card). The link itself is made earlier, by `PUT /vendors/{id}/step/contacts` with `convert_supplier_id` |

---

## 6. DATA MODEL

### 6.1 Relationships

```
vendors
  ├─ vendor_addresses        (primary row = primary contact; extra rows = extra contacts)
  ├─ vendor_segments         → clm_segments
  ├─ vendor_documents        (legacy DD / TL)
  ├─ vendor_owners           (legacy Owner KYC)
  ├─ vendor_bank_accounts
  ├─ vendor_gst_scrutiny
  ├─ vendor_product_mappings → products        (mirrored to product_vendor_maps)
  ├─ p2p_service_suppliers   → p2p_services
  ├─ segment_doc_uploads     (polymorphic uploadable)
  └─ vendor_currency_locks
p2p_suppliers.converted_vendor_id → vendors.id   (Convert from Sourcing)
```

### 6.2 `vendors` — the supplier

| Column | Notes |
|---|---|
| `vendor_code` | `S-001` … per client + branch |
| `company_name`, `legal_name`, `website` | Stage 1 |
| `vendor_type_id`, `classification_id`, `risk_level_id`, `vendor_behaviour_id`, `segment_id` | Masters; `segment_id` = first segment |
| `gst_applicable`, `gst_number` | GST / TIN |
| `supplier_category` | default `general` |
| `primary_email` | Mirrored (lower-cased) from the primary contact |
| `status` | default `draft` |
| `step_completed` | Wizard progress |
| Soft deletes / indexes | Yes · indexes on status, (client_id, branch_id), (client_id, primary_email) |

### 6.3 Child Tables

| Table | Holds | Notes |
|---|---|---|
| `vendor_addresses` | Address **and** contact fields; `is_primary`, `address_type`, `google_location` | The primary contact is the primary address row. No soft deletes |
| `vendor_segments` | Supplier ↔ `clm_segments` pivot | `unique(vendor_id, segment_id)`, cascade |
| `vendor_documents` | Legacy DD (`kind=dd`) and TL (`kind=tl`) rows | Soft deletes; replaced on every KYC save |
| `vendor_owners` | Legacy Owner KYC rows | Soft deletes |
| `vendor_bank_accounts` | Bank, branch, account, IFSC / SWIFT, cheque | Soft deletes (but delete is `forceDelete`) |
| `vendor_gst_scrutiny` | GSTIN, status, last filing date, 2A invoice, red flags | Soft deletes (but delete is `forceDelete`) |
| `segment_doc_uploads` | **The KYC / DD / TL files the vault and compliance read** — polymorphic `uploadable`, `category`, `doc_code`, `requirement`, `issue_date`, `expiry_date` | `unique(uploadable_type, uploadable_id, category, doc_code)` |
| `vendor_currency_locks` | One trading currency per supplier (set by POs) | `unique(client_id, vendor_id)` |

### 6.4 `vendor_product_mappings` — supplier ↔ product

| Item | Detail |
|---|---|
| Columns | Price, GST, total, origin, currency, rate, ₹ amount |
| Notes | Soft deletes; mirrored to `product_vendor_maps` |
| Writer 1 — this module | `VC::storeProducts()` force-deletes and re-creates every row **without** `origin` / `currency_code` / `exchange_rate` / `inr_amount`. Its `forceDelete()` goes through the relation, so already **soft-deleted** rows are skipped and stay in the table |
| Writer 2 — Product side | `ProductController::storeVendors()` (`PUT /products/{id}/step/vendors`) — writes origin / currency / ₹ amount |
| Writer 3 — Product side | `updateVendorMapPrice()` / `destroyVendorMap()` (`PATCH` / `DELETE /products/{id}/vendor-maps/{mapId}`) |
| Writer 4 — Product GST step | `ProductController::storeSales()` rewrites `gst_percentage`, `gst_amount`, `total_amount` on every mapping of that product (and its `product_vendor_maps`) whenever the product's GST is saved |
| Conflict | A save from this module wipes what the Product side wrote (issue #20) |

### 6.5 `p2p_service_suppliers` — supplier ↔ service

Price, GST, total, origin, currency, rate, ₹ amount, remarks, `status`.
**`unique(service_id, vendor_id)`**; unmap = `status=inactive`. Shared with
Service Management.

### 6.6 `p2p_suppliers` — New Suppliers from Sourcing

`converted_vendor_id`, `converted_at`, `converted_by`. Soft deletes.

### 6.7 Fixed Values

| Field | Values | Enforced by |
|---|---|---|
| `vendors.status` | `draft` (Stage 1) · `inactive` (`storeKyc`, from `draft` only) · `active` (`VC::storeProducts()` with ≥ 1 product, or `ProductController::storeVendors()`, from **any** status). Not a strict sequence: Map Product works in Add mode right after Stage 1, so `draft` → `active` happens | Code only — **no CHECK constraint** |
| `supplier_category` | `star` · `general` · `high_risk` · `blacklisted` | Validation `in:` in `VC::storeIdentity()` — no CHECK |
| Supplier Type | Material/ Goods · FFD/ Transporter · 8 service types | Seeded fixed rows in `master_vendor_types` (`2026_11_19_100000_seed_fixed_vendor_types.php`); a name sent as `vendor_type` is resolved per tenant with `firstOrCreate` |
| Supplier Behaviour | The active rows of `master_vendor_behaviour` (bundle key `vendor_behaviour`), by name, de-duplicated case-insensitively; the fixed four (`SUPPLIER_BEHAVIOUR_OPTS`: Genuine · Cooperative & Responsive · Non Responsive & Inconsistent · Fraud Alert) only when that list is empty; a saved inactive value is kept in the list (since `cdc5aff67`) | Sent by name; resolved to `master_vendor_behaviour` with `firstOrCreate(client_id, trimmed name)` |

### 6.8 Uniqueness — Where It Really Lives

| Rule | Database | Code |
|---|---|---|
| Supplier code per branch | `unique(client_id, COALESCE(branch_id,0), vendor_code)` — **not partial**, so soft-deleted codes stay reserved | — |
| One service per supplier | `unique(service_id, vendor_id)` | — |
| One product per supplier | Only a non-unique index | `storeProducts` rejects duplicates |
| GSTIN unique in the tenant | **None** | `assertGstUniqueForClient` checks `vendors` and `vendor_gst_scrutiny` |
| One primary contact | None | `storeContacts` deletes and re-inserts the primary row (its id changes on every save) |
| Primary email unique **across all clients** | None | `Vendor` uses `EnforcesUniqueEmail` (scope `vendor` in `config/email_uniqueness.php`, `tenant => false`): `vendors.primary_email` must not match any other `vendors.primary_email` or `p2p_suppliers.email` (soft-deleted ignored). 422 `errors.primary_email`: *"This email address is already used by another vendor or supplier in the system. Please use a different address."* New Suppliers converted into this vendor, and the one being converted (`Vendor::$convertingSupplierId`), are excluded (`sameEmailOwnerRows()`). Extra contacts' emails are not checked on the server |

### 6.9 Migrations Referenced

| Migration | Note |
|---|---|
| `2026_11_19_100000_seed_fixed_vendor_types.php` | Seeds the fixed Supplier Types |

---

## 7. BUSINESS LOGIC

### 7.1 Supplier Code Allocation

```
storeIdentity (create)  →  DB::transaction
   1. insert vendor  (status = draft, step 1)
   2. SELECT … FOR UPDATE on the clients row      ← serialises codes per client
   3. nextVendorCode(client_id, branch_id)
        scan withTrashed() codes of that client + branch
        take the trailing digits, max + 1
        → 'S-' + str_pad(n, 3, '0')                 S-001, S-002 …
   4. save
```

| Rule | Detail |
|---|---|
| Scope | Per client **and branch** |
| Reuse | Soft-deleted suppliers keep their codes |
| Lock | Skipped when `client_id` is null |
| List fallback | `S-` + zero-padded id (3 digits) for a supplier with no `vendor_code` (`Vendors.tsx apiToVendor()`) |

### 7.2 The List Endpoint — `GET /vendors`

| Part | Implementation |
|---|---|
| Eager loads | primary address (+ state, country), addresses, vendorType, **segment** (singular first) and segments, riskLevel, complianceBehaviour |
| Counts | `withCount('productMappings')` → `product_mappings_count`; `opportunity_count` is a hard-coded `0` (`DB::raw('0 as opportunity_count')`) |
| Order | `id` descending |
| `status` | Optional exact filter, applied right after search — **before every facet** |
| `tab` | `recurring` → `whereRaw('1 = 0')` (no rows; not built). Applied **after** scope counts, before other facets |
| Search `q` | `ILIKE` on company / legal name, code, primary email, GSTIN, category (spaces → `_`), any address's contact name / phone / email / city / state code, primary state and country, type name, segment names |
| `scope` | **Domestic** = primary country India (`LOWER(name)='india'`), or no primary address, or no country. **International** = a country that is not India |
| `categories`, `compliance` | CSV filters; compliance is a `whereIn` on the computed id sets |
| Paging | `paginate(per_page)`, default 24, no maximum |
| Facets | `grand_total`, `scope{domestic,international}`, `category{…}`, `compliance{…}` |

**Facet timing.** Facets are counted *after* search, `status`, scope and tab but
*before* the category / compliance filters, so the Filter popup can show every
option's count. Scope counts are taken after search and `status` but before the
scope filter and `tab`, so both origin tabs always show their totals.

**No client.** `SupplierCompliance::statuses()` returns nothing when no client
id is found (e.g. a super admin); every row is then **Compliant** (default)
while `facets.compliance` reports `0` / `0`.

### 7.3 Compliance — Batched, Not Per Row

`SupplierCompliance::statuses($ids)` runs a **fixed set of queries** for the
whole scoped id list (segments and country, the tenant's segment rules, uploads,
the active agreement library, completed signature requests, which suppliers have
a PO), then evaluates in PHP:

| # | Rule |
|---|---|
| 1 | Every mandatory (`M`) code in kyc / dd / tl / td is uploaded and not expired — `td` only once the supplier has a PO |
| 2 | Any expired upload fails the supplier — **optional ones included** |
| 3 | Once there is a PO, every applicable **Supplier** agreement is signed and in date |
| 4 | A supplier with no rules has no mandatory codes — but rules 2 and 3 still apply. Rule 3's agreements come from `agreementLibrary()` (`clm_agreement_library`, `agr_status='Active'`, `regulatory` = the segment's `regulatory_status`, `segment` CSV containing the segment name or code, party blank or "supplier…"), **not** `clm_segment_rules`; signed = a `completed` `clm_signature_requests` row with `document_type='agreement'` |

**Edge cases**
* "Has a PO" is **any** `p2p_purchase_orders` row — drafts count.
* Origin is an exact, case-sensitive `country_name === 'India'`; **no country = international** (the list treats it as domestic). `SegmentDocScope` has the same rule.
* A segment with no rule for the supplier's origin uses the other origin's rule.

Stamped on each row as `compliance_status`. Cost grows with the **scoped
supplier set**, not the page size, and runs on every list call (including the
Filter popup's `per_page=1` calls).

### 7.4 Step Saves

| Step | Endpoint | What it does |
|---|---|---|
| Identity | `storeIdentity` | Validates identity, address, segments, category. **International**: TIN required (`^[A-Za-z0-9-/. ]{3,30}$`, upper-cased). **India**: `gst_applicable` must be `Yes`. GST uniqueness (only when `gst_applicable = Yes` and a number is sent). Segment-removal guards (7.5). In a transaction: create (`draft`) or update, sync `vendor_segments`, upsert the primary address. `normalizeSegmentIds()` keeps only segments whose `clm_segments.client_id` equals the user's client — the "segment needs a Document Control Panel rule" check is **browser-only**, and a global segment (`client_id` NULL), which the bundle offers, is silently dropped |
| Contacts | `storeContacts` | In a transaction: **deletes** the primary address row and inserts a new one built **only** from `primary_address[...]` (an API client sending only contact fields blanks the Stage 1 address; the screen always sends both). Mirrors its email to `vendors.primary_email` **lower-cased**; `vendor_addresses.email` keeps the sent casing. With `convert_supplier_id`: see 7.9 |
| One contact / bank / GST row | `contacts`, `bank-accounts`, `gst-scrutiny` | Saved immediately, no transaction. Bank: duplicate account number refused; IFSC vs SWIFT by the supplier's country. GST: after a save every scrutiny row is synced to the same GSTIN |
| KYC | `storeKyc` | **Replace-all** in a transaction: deletes files no longer referenced, hard-deletes and re-creates the legacy DD / owner rows, sets step ≥ 2, moves **`draft` → `inactive`**. Bank / GST rows untouched. The FE only blocks on missing files of the **legacy DD rows**, not the segment-rule rows |
| Products | `storeProducts` | **Replace-all** in a transaction: rejects duplicates; rejects the whole list when **any** product has `products.gst_id` NULL (CS-2327, `da7a6d271`: *These products have no GST rate and cannot be mapped to a supplier — set a GST on the product first: …*; the wizard's `saveMapDraft()` pre-checks, the list popup does not); **hard-deletes** all mappings and re-creates them; mirrors to `product_vendor_maps` (removing rows no longer listed); activates the mapped products; moves the supplier to **`active`** — only when the list is non-empty. Validation is only `exists:products,id` — no tenant, segment or status check |
| Services | `storeServices` | **Replace-all**: each `service_id` must be visible, editable, of the supplier's bucket (`assertServes`) and correctly priced (`priceFields`). In a transaction: upsert per (service, supplier) — reviving an old row — and complete the service's Stage 2. Active mappings left out → **`inactive`, never deleted** |
| Service edit / unmap | `PATCH` / `DELETE` mapping | PATCH recomputes the price fields; DELETE sets `status=inactive` |
| Delete supplier | `destroy` | Deletes files, soft-deletes the supplier, bumps the bundle cache. **No screen calls it** |

**Status.** `active` is set by `VC::storeProducts()` (non-empty list, from any
status) and by `ProductController::storeVendors()` (Product → Map Supplier,
Material/ Goods suppliers only). `storeServices` never touches the supplier's
status, so a service / FFD / untyped supplier stays `inactive`.

**Why the frontend always sends the whole list.** Products and services are
replace-all, so a request with one row would unmap everything else. The Map
Service form posts every current active mapping plus the new one.

### 7.5 Locks

**Supplier Type** — `SegmentGuard::vendorCommittedDocument($vendor)` returns
`po`, `spi` or null. Enforced on the **server** in `storeIdentity` (422) and
reported as `vendor_type_lock`.

| Source | Statuses that lock (`LOWER(status)`, soft-deleted ignored) |
|---|---|
| Purchase Order | `submitted`, `sent for sign`, `signed`, `approved` (`PO_COMMITTED`) |
| Supplier Invoice | `mapped`, `grn_pending`, `closed` (`SPI_COMMITTED`) |

**Segments** — checked in `storeIdentity` when a segment is removed, in order:

| Check | Response |
|---|---|
| A **mapped product** belongs to the segment | 422 |
| A product of the segment is on a committed **PO / Supplier Invoice** | 422 |
| Only **uploaded documents** of that segment remain | **409** `requires_doc_confirmation`, unless `confirm_segment_doc_removal=1`. The Supplier form **never sends it**: `saveIdentity()`'s `attempt()` catches the 409, shows *"Cannot remove segment — … Delete them in KYC / Due Diligence first"* and restores the saved segments. The confirm-and-delete branch is reachable only from the Customer form (`AddCustomerModal`) |

Only a **committed** PO / SPI (via `vendorLockSources()`) or a product mapping
locks a segment — a draft PO does not. `segment_required_doc_keys` is resolved
per segment **name** (`SegmentGuard::docKeys($clientId, $segmentName)` →
`resolveIds()`). `show()` reports `locked_segments`, `locked_segment_reasons`
(strongest of product < spi < po), `segment_required_doc_keys` and
`uploaded_doc_keys`.

**Address (`state_locked`)** — `true` when **any** PO exists for the supplier
(any status, draft included, tenant scope lifted). The form then locks
**Country, State, State Code and GST / TIN** only (Registered Office Address,
City, Google Location stay editable). **UI only** — the server does not refuse
the change.

**Map Product / Service (frontend)** — the wizard keeps `savedVendorType`; the
header button is disabled while the dropdown's type differs (`typeUnsaved`), and
mapping always uses the saved type.

**Supplier Type "kind" is decided two ways**

| Side | Rule |
|---|---|
| Browser | By **name**: `Vendors.tsx typeKind()` (*logist / transport / ffd / freight* → FFD; *service* → services) and `serviceMapping.ts serviceBucketOf()` |
| Server | `ServiceSupplierMapping::vendorServiceType()` reads `master_vendor_types.service_type` / `classification`, falling back to `VENDOR_TYPE_BY_NAME` only when `service_type` is empty |

A tenant-made or renamed type can be classified differently by list and server
(the Mapped Services popup trusts the server's `meta`). `storeIdentity()`
resolves a `vendor_type` name with `firstOrCreate(client_id, name)`, which reuses
a row of that name even when **Inactive**.

### 7.6 Supplier Behaviour (since `cdc5aff67`)

| Side | Behaviour |
|---|---|
| Options (FE) | Bundle `vendor_behaviour` names, trimmed and de-duplicated case-insensitively (`setBehaviourOpts`); if empty, the fixed `SUPPLIER_BEHAVIOUR_OPTS`; a saved value not in the list is appended (`supplierBehaviourOptions`) so editing never blanks it |
| Edit load | `vendor_behaviour_name` from `GET /vendors/{id}` |
| Sent | `vendor_behaviour` = the name |
| Server | `VendorBehaviour::firstOrCreate(['client_id', 'name' => trim(name)], ['branch_id', 'status' => 'Active', 'created_by'])` → `vendors.vendor_behaviour_id` |
| Quick-add | A `case 'vendor_behaviour'` exists in the quick-add switch but is unreachable (no `addNew` on the field; `setQuickAdd` only called with `null`) |

### 7.7 GST

| Piece | Where |
|---|---|
| `gst_applicable` | Sent by the form (India → `Yes`); the server only enforces *India ⇒ Yes* and clears the GSTIN of a domestic supplier sent with `No` |
| GSTIN format | Front end only (15-character pattern, `fieldValidators.ts`). Server allows up to 30 chars in Stage 1, 16 in scrutiny |
| GSTIN starts with the State Code | Front end. The server check exists but **never runs** (issue #1) |
| GST scrutiny re-sync | `storeGstScrutiny` / `updateGstScrutiny` set **every** scrutiny row to the saved GSTIN, but never update `vendors.gst_number` |
| GSTIN uniqueness | `assertGstUniqueForClient()` — `vendors.gst_number` and `vendor_gst_scrutiny` within the client; from `storeIdentity` only when `gst_applicable = Yes` |
| `app/Support/Gst.php` | `isDomestic`, `applicableFor`, `stateCodeFor`, `stateCodeFromGstin`, `homeStateCode`. Used by service pricing (`ServiceSupplierMapping::gstSplit`), **not** by `VendorController` |

### 7.8 File Storage

| Files | Path on the `public` disk | Types · size |
|---|---|---|
| Wizard files (business card, cheque, legacy DD / owner / TL) | `vendor_documents/{vendorId}/{slug}-{rand8hex}__{name}.{ext}` | jpg, jpeg, png, webp, pdf · 2 MB |
| KYC / DD / TL uploads (vault, compliance) | `segment_doc_uploads/{type}/{ownerId}/…` | pdf, jpg, jpeg, png · 2 MB |

Downloads stream through `GET /segment-uploads/download`.

### 7.9 Convert to Supplier (link at the Contacts step)

| Step | Logic |
|---|---|
| Prefill | `SourcingController::convertPrefill()` fills the Add Supplier form (ids matched by name) |
| Stage 1 | `storeIdentity()` creates the supplier (`draft`) |
| **Contacts — the link** | `storeContacts()` with `convert_supplier_id`: the New Supplier must belong to the client and not be converted into a *different* supplier (else 422); its own email passes the uniqueness check (`Vendor::$convertingSupplierId`); after the contact save a **second transaction links it** — its `source='new'` sourcing rows become `source='master'` rows of this supplier (a duplicate of an existing Master row is deleted instead) and `converted_vendor_id` / `converted_at` / `converted_by` are set. Skipped when already linked to this supplier |
| Save Supplier | `SourcingController::convertSupplier()` repeats the move idempotently (normally nothing left), re-stamps `converted_at` / `converted_by`, copies the business card. Finds the supplier by **client** (`Vendor::where('client_id', …)`), not branch |
| Abandoned | After Contacts → linked but unfinished `draft`. Before Contacts → an unlinked `draft` S-NNN stays and a retry creates another (issue #17) |

---

## 8. SECURITY AND ACCESS CONTROL

### 8.1 Middleware

Every route: `auth:sanctum` → `user.active` → `tenant`. No per-route
permission or throttle middleware.

### 8.2 Server Access Rules

| Concern | Implementation |
|---|---|
| Row scope | `Vendor::scopeForUser` — employees and branch users: `MasterVisibility::applyBranchScope` (rows with `client_id` NULL + own client with `branch_id` NULL or own branch); client admin / client user: own client, **every branch** (narrowed only by the BranchSwitcher `branch_id` on `GET /vendors`); super admin: everything |
| Edit / delete | `MasterVisibility::hierarchicalDenial` returns null for `Vendor` — **anyone in scope may edit a supplier** |
| Service mappings | Also check the user may edit the **service** (`ServiceSupplierMapping::serviceEditDenial()` → `hierarchicalDenial()` on the Service; an employee may edit a service of their own branch) — *can* return 403 |
| Segment uploads | `SDUC::resolveOwner` checks the **client** only, not the branch |
| Convert to Supplier | `convertPrefill()` / `convertSupplier()` check only that the New Supplier is in the user's client — no creator / assignee or permission check |
| `p2p.supplier.can_edit` | Read only by other modules (Create PO, Payment Request) |

### 8.3 Frontend Gates

| Gate | Rule |
|---|---|
| Page | `Vendors.tsx` shows the page to `branch_user` and `employee` only |
| Route | `routeAccess.ts canAccessPath()` returns `isBiz` for `/suppliers` / `/vendors` **without** checking `p2p.supplier` — the URL opens without the menu permission (issue #18) |
| Menu | `perms['p2p.supplier'].can_view` and an unexpired plan (`IdimsHeader can()`); super admin and client admin get fixed menus without P2P |
| Convert button | Sourcing Tracker shows it to every report viewer (Bulk Sourcing gates it by `canMap`) |

### 8.4 Derived on the Server, Never Trusted from the Client

Supplier code · status · step · compliance status · GST uniqueness · service
pricing (GST split, total, ₹ value) · the lock flags.

---

## 9. FRONTEND ARCHITECTURE

### 9.1 Component Loading

* `AddVendorModal`, `MappedProductsViewPopup`, `MappedServicesViewPopup`, `SupplierScopeGate` and `SupplierEvidenceVaultModal` are **lazy** (`lazyPage`) and rendered only while open, inside `<Suspense fallback={null}>`.
* `warmVendorWizard` preloads the wizard chunk when the pointer enters (or focus reaches) the Add Supplier button.
* `reqRef` tokens drop stale list responses.

### 9.2 The List Fills the Screen — `recompute()`

At ≤ 820 px there is no auto-fit (rows per page = stored size, else 10;
`recompute()` clears the heights).

| Trigger | Why |
|---|---|
| On mount and on the next animation frame | First layout |
| Once more **340 ms** later | The *What We Are Doing Here* strip collapses over 0.3 s; measuring earlier read the old table top and left a gap above the footer |
| Window `resize`, debounced **140 ms** | Screen size changed |
| `document.fonts.ready` | Web fonts change the height of the blocks above the table |
| `ResizeObserver` on **every block above the table** (earlier siblings of each ancestor of the scroller, up to `body`, `box: 'border-box'`) — calls `recompute()` **immediately** | Menu folding into "More", banner, toolbar or fonts can move the table top without a resize. The callback runs after layout but **before paint**, so no empty band flashes. Only blocks *above* are watched, so the table's own height change can't re-trigger it |

The effect re-runs when the tab, search, loading / swapping state, the strip's
open state, the page size or "has rows" changes, and cleans up timers, listener
and observer each time.

```
footerReserve = footer.footer height + 8   (15 when there is no footer)
cardH = max(240, innerHeight − tableTop − footerReserve − 2)
fit   = max(10, floor((cardH − thead − PAGER(56) − scrollbar) / rowHeight))
table scroller: min-height = height = max-height = cardH − PAGER
```

* `thead` and row height are **measured** (40 / 41 px fallbacks during the shimmer); `-2` absorbs border rounding that left 2 px of page scroll.
* `height` **and** `max-height` are both needed — the scroller is a flex item and would grow to its rows.
* While no page size is picked (`autoFitRef`), `fit` becomes rows-per-page (the page is recalculated so the first visible row stays) and is saved in `localStorage` `cbc.p2p.suppliers.perPage.v2` (read back only if 10–200). Picking 10 / 25 / 50 turns auto-fit off for the visit.
* CSS: scroller `overflow-y:auto`, `thead` sticky with solid background; above 820 px the last column is sticky right.

### 9.3 No Hovers While Scrolling

A capture-phase, passive `scroll` listener adds `is-scrolling` to
`.sup-table-wrap` and removes it 150 ms after the last scroll; CSS sets
`pointer-events:none` meanwhile. Only a class is toggled (no React state), so
scrolling causes no re-render.

### 9.4 Caches

| Cache | Where | Life | Cleared by |
|---|---|---|---|
| Master bundle (browser) | `sessionStorage` `vendor:master-bundle:v3` | 5 min | `bustVendorMasterBundle()` — Segment "+" quick-add in `AddVendorModal`, `ClmSegmentPage.tsx`, `utils/bustMasterBundles.ts` (the generic quick-add path also calls it but is dead code) |
| Master bundle (server) | `MasterBundleCache` — key `vendor:master-bundle:user:{id}:v{version}` | 5 min | `MasterBundleCache::bump()` on any Vendor save / delete / restore. One **global** version key, so it invalidates every user's and client's bundles |
| Type-tab rows | `kindCacheRef`, by filter key | Page life | A new filter set |
| Service catalogue | `useRef(Map)` per Mapped Services popup, key `serviceType\|classification` | Popup life | A failed fetch removes its entry |

The wizard shows the cached bundle first, then always refetches.

### 9.5 Type Tabs and Their Counts

The API cannot filter by kind, so a type tab loads **up to 1000** suppliers
(`KIND_FETCH_CAP`), classifies them with `typeKind()` and pages them in the
browser. Suppliers with **no type** appear only under All. Tab counts come from
one background fetch per filter set. Switching origin tab clears the counts in
the click.

### 9.6 Mapped Products / Services Count Column

* Products: `product_mappings_count` from the list.
* Services: one `GET /p2p/services?per_page=200`, counting each service's `supplier_names` per lower-cased company name; fetched only when a service-type supplier is on screen, and again after the Mapped Services popup changes.

### 9.7 Mapped Services

`GET /vendors/{id}/service-mappings` and the catalogue request start **in
parallel**. The response `meta` (`supplier_service_type`,
`supplier_classification`, `origin`) decides bucket and origin. Search uses a
pre-built string per row (`useMemo`), including every amount in the forms a user
types it.

### 9.8 Who Else Imports These Files

| File | Imported by |
|---|---|
| `AddVendorModal` | Add Product, Service Management (`ServiceSupplierModal`), Sourcing Tracker (+ its Supplier Master form), Bulk Sourcing's `SourcingReportModal`, Create PO (form, Step 1, Step 2, `AddSupplierFlow`), Supplier Invoice Step 1, Payment Request. `canMapProducts={false}` from `AddProductModal`, `ServiceSupplierModal` (add and edit), `SourcingTracker` (convert), `SupplierMasterForm`, `SourcingReportModal` (convert), `AddSupplierFlow`. `SupplierEvidenceVaultModal` imports `SegmentRefUploadPopup` from it |
| `SupplierEvidenceVaultModal` | CLM Supplier Profile, CLM CTC form, Create PO (form, Step 1, Step 4, docs notice), Supplier Invoice (form, Step 1), Payment Request; Lead / Consignee vaults reuse `VaultReuploadPopup` / `VaultDateBadge` |
| `SupplierScopeGate` | **Rendered** by `AddProductModal` and Create PO's `AddSupplierFlow` (both lazy), besides `Vendors.tsx`. Its `SupplierScope` **type** is imported by `ServiceSupplierModal` and the Sourcing Tracker's `MapSupplierModal`, `NewSupplierForm`, `SupplierMasterForm`, `SupplierTypeChooser` |

---

## 10. UI — RESPONSIVE LAYOUT, DARK MODE AND CSS

### 10.1 Responsive

| Width | Behaviour |
|---|---|
| > 820 px | Auto-fit table height and rows per page; last column sticky right |
| ≤ 820 px | No auto-fit; rows per page = stored size, else 10 |

### 10.2 CSS Files and Scope

| File | Scope |
|---|---|
| `supplier-management.css` | `.sup-fig`, `.sup-list`, `.sup-table-wrap` — the list. Also imported by Products, Sales lists, HRMS Document Templates, CredVault, Payment Request for the shared header strip |
| `add-vendor-modal.css` | Wizard rules under `:is(body:has(.smc-root.sup-list), body:has(.sct-page), body:has(.svm-page)) .avm-*` — Supplier list, Sourcing Tracker, Service Management. Also imported by the Customer and Consignee forms |
| `supplier-evidence-vault.css` | `.spev` / `.spev-ov` for Supplier-only rules. `.sev` / `.cev-*` are **shared** with the Customer and Consignee vaults |
| `supplier-scope-gate-teal.css` | The origin chooser |

**Rule for changes:** a Supplier-only style (including dark mode) must carry
`.spev`, `.sup-list` or the page scope above, so it can never reach Customer,
Consignee, Product or HRMS screens.

---

## 11. INTEGRATION WITH OTHER MODULES

| Module | Integration |
|---|---|
| **Purchase Order** | `p2p_purchase_orders.vendor_id` drives the type / segment locks, `state_locked` and compliance's "has a PO". PO creation reads `vendor_product_mappings` and `SegmentDocScope`. `vendor_currency_locks` pins one currency. The vault's Case to Case rows **are** the supplier's POs and their Stage 04 documents (`p2p_purchase_order_documents`, `needed='yes'`) — `SDUC::buildPoDeals()` |
| **Supplier Invoice** | Committed invoices (`SPI_COMMITTED`) lock the Supplier Type and segments |
| **Product Master** | Two-way mirror `vendor_product_mappings` ↔ `product_vendor_maps`; mapping activates the product; a product's segment decides segment locks. The Product side writes the same mappings (with origin / currency), and this module's replace-all save wipes those columns (#20) |
| **Service Management** | Shares `p2p_service_suppliers`; a supplier-side save can move a draft service to active |
| **CLM** | Segment rules decide required documents, the vault and compliance; `clm_agreement_library` and `clm_signature_requests` decide agreement compliance; `clm_segments` is the segment master |
| **Sourcing Tracker** | Convert to Supplier in three places (7.9). The link used to live only in `convertSupplier()`; since `bf7dad2ed` it is made at the Contacts step, and `convertSupplier()` looks the supplier up client-wide |
| **Procurement** | Reads `vendor_product_mappings` to find a product's only supplier |

---

## 12. DATA SOURCE AND STORAGE MAP

Every field: where its value or options are **read** from, and which column it
is **written** to. Every bundle list is `LOWER(status)='active'` in the user's
read scope (`MasterVisibility::applyReadScope`), ordered by id.

### 12.1 List

| Field | Read from | Stored in |
|---|---|---|
| Domestic / International tab counts | `GET /vendors` → `facets.scope` | — |
| Type tab counts | `countKinds()` over ≤ 1000 rows, by `vendor_type.name` | — |
| Sr. No | Row position | — |
| Supplier Code · created date | `vendors.vendor_code`, `vendors.created_at` | — |
| Supplier · State, Country | `vendors.company_name`; primary `vendor_addresses` → `master_states.name`, `master_countries.name` | — |
| Supplier Type | `vendors.vendor_type_id` → `master_vendor_types.name` | — |
| Segment (+N) | `vendor_segments` → `clm_segments.name`, `regulatory_status` (fallback `vendors.segment_id`) | — |
| Location · GST nn | Primary `vendor_addresses.state_code` | — |
| Contact Person (+N) | `vendor_addresses` (`contact_name`, `designation`, `contact_no`, `email`; primary first) | — |
| Supplier Category | `vendors.supplier_category` | — |
| Compliant Status | `SupplierCompliance::statuses()` → `compliance_status` (computed, never stored) | — |
| Mapped Products count | `withCount('productMappings')` | — |
| Mapped Services count | `GET /p2p/services?per_page=200` → `supplier_names`, matched on lower-cased name | — |
| Filter option counts | `facets.category`, `facets.compliance` | — |
| Rows per page | `localStorage` `cbc.p2p.suppliers.perPage.v2` (auto-fit only) | same |

### 12.2 Stage 1 — Supplier Identification & Address Details

| Field | Options / value read from | Stored in |
|---|---|---|
| Company Name | Typed (edit: `vendors.company_name`) | `vendors.company_name` |
| Company Legal Name | Typed | `vendors.legal_name` |
| Supplier Type | Fixed tree `SUPPLIER_TYPE_TREE` (FE); id from bundle `vendor_types` by name | `vendors.vendor_type_id` (no match → `master_vendor_types` `firstOrCreate`) |
| Company Website | Typed | `vendors.website` |
| Supplier Segment | Bundle `segments` (`clm_segments`: id, code, name, regulatory_status); DOM / INT from `GET /clm/segment-rules` | `vendor_segments` (sync, client's segments only) + `vendors.segment_id` (first) |
| Risk Level | Bundle `risk_levels` (`master_risk_levels`) | `vendors.risk_level_id` |
| Supplier Behaviour | Bundle `vendor_behaviour` (`master_vendor_behaviour.name`, de-duplicated); fallback `SUPPLIER_BEHAVIOUR_OPTS`; edit: `vendor_behaviour_name` | `vendors.vendor_behaviour_id` (name → `firstOrCreate(client_id, name)`) |
| Supplier Category | Fixed `SUPPLIER_CATEGORY_OPTS` | `vendors.supplier_category` (default `general`) |
| Registered Office Address | Typed | `vendor_addresses.address_line` (primary) |
| Country | Bundle `countries`, filtered by origin | `vendor_addresses.country_id` |
| State | Bundle `states` (by `country_id`) | `vendor_addresses.state_id` |
| State Code | Bundle `state_codes` | `vendor_addresses.state_code` |
| GST Number / TIN | Typed | `vendors.gst_number` (TIN upper-cased; GSTIN cleared when a non-international supplier is sent with GST Applicable = No) |
| GST Applicable | Derived from the country (no field) | `vendors.gst_applicable` |
| City | Typed | `vendor_addresses.city` |
| Google Location Link | Typed | `vendor_addresses.google_location` |
| Pincode | No field (an existing value is re-sent) | `vendor_addresses.pincode` |
| Supplier code (header) | Server | `vendors.vendor_code` (`nextVendorCode()`) |
| Status / step | Server | `vendors.status` (`draft`), `step_completed` (1) |
| Lock flags (edit) | `GET /vendors/{id}`: `vendor_type_lock`, `state_locked`, `locked_segments`, `segment_required_doc_keys` (`clm_segment_rules.doc_selections`), `uploaded_doc_keys` (`segment_doc_uploads`) | — |

### 12.3 Stage 1 — Contact Person Details

| Field | Read from | Stored in |
|---|---|---|
| Contact Person Name, Designation, Contact No, Email, WhatsApp Enabled? | Typed (edit / Convert: primary `vendor_addresses`, or the prefill) | Primary `vendor_addresses` — `contact_name`, `designation`, `contact_no`, `email`, `whatsapp_enabled` (row deleted and re-inserted on every save); email also `vendors.primary_email` (lower-cased) |
| Attachment (business card) | Picked file / saved `attachment_path` | File `vendor_documents/{id}/contact-{8hex}__{name}.{ext}`; `vendor_addresses.attachment_path` |
| Additional contacts | Typed | Non-primary `vendor_addresses` rows |
| Convert link | `convert_supplier_id` prop | `p2p_suppliers.converted_vendor_id` / `converted_at` / `converted_by`; `p2p_sourcing_product_suppliers.source`, `supplier_id`, `name` |

### 12.4 Stage 2

| Field | Read from | Stored in |
|---|---|---|
| Document rows (Auto Code, name, Issuing Authority, Requirement) | `GET /clm/segment-rules/for-segment/{id}?document_type=` → `clm_segment_rules.doc_selections` + CLM document libraries (`SegmentGuard::branchCatalogue`) | — (display only) |
| Uploaded file, Issue Date, Expiry | Upload popup; existing from `GET /vendors/{id}` → `segment_uploads` | `segment_doc_uploads` (`category`, `doc_code`, `doc_name`, `requirement='O'`, `attachment_path`, `attachment_name`, `issue_date`, `expiry_date`, `uploaded_by`, `client_id`); file under `segment_doc_uploads/supplier/{id}/` |
| Legacy DD / Owner KYC / Trade Licence rows | `GET /vendors/{id}` → `due_diligence`, `owner_kyc`, `trade_licenses` | `vendor_documents` (`kind='dd'` / `'tl'`), `vendor_owners` (replace-all by `step/kyc`); files `vendor_documents/{id}/{dd\|owner\|tl}-…`; `license_type_id` → `master_license_name` |
| Bank Name, Branch, Account Number, IFSC / SWIFT, Branch Address | Typed | `vendor_bank_accounts.bank_name`, `branch_name`, `account_number`, `ifsc` (upper-cased; SWIFT for international), `branch_address` |
| Cancelled Cheque | Picked file | `vendor_documents/{id}/cheque-…`; `vendor_bank_accounts.cheque_path` |
| GST Number (scrutiny) | Stage 1 `gstNumber` | `vendor_gst_scrutiny.gst_number` (every row re-synced) |
| GST Status, Last Filing Date, Prev. Non-GST 2A Invoice, Red Flags | Typed | `vendor_gst_scrutiny.status`, `last_filing_date`, `prev_non_gst_2a_invoice`, `red_flags` |
| Scrutiny Date | Server | `vendor_gst_scrutiny.created_at` (shown as `scrutiny_date`) |
| Supplier status after Stage 2 | Server | `vendors.status` `draft` → `inactive`, `step_completed ≥ 2` |

### 12.5 Mapped Products

| Field | Read from | Stored in |
|---|---|---|
| Product Name options | `GET /products?per_page=500&lite=1` (≤ 200 newest, with a segment), minus mapped, same segments | `vendor_product_mappings.product_id`; `product_vendor_maps.product_id` |
| Product Code, HSN / SAC, Segment | `products.product_code`, `master_hsn_codes.hsn_code`, `clm_segments.name` | — |
| Purchase Price | Typed | `vendor_product_mappings.purchase_price`, `product_vendor_maps.purchase_price` |
| GST % | `products.gst_id` → `master_gst_percentage.percentage` (empty without `gst_id` — blocked, CS-2327) | `vendor_product_mappings.gst_percentage`, `product_vendor_maps.gst_percentage` |
| GST Amount, Total | Computed in the browser | `gst_amount`, `total_amount` (both tables) |
| Supplier snapshot | `vendors` + primary `vendor_addresses` | `product_vendor_maps.vendor_code`, `vendor_name`, `vendor_website`, `contact_person`, `contact_no`, `email`, `designation`, `map_date` |
| Side effects | — | `products.status='active'`, `products.step_completed ≥ 4`; `vendors.status='active'`, `step_completed=4` |
| Existing rows | `GET /vendors/{id}/product-mappings` (list) / `GET /vendors/{id}` → `product_mappings` (wizard) | — |

### 12.6 Mapped Services

| Field | Read from | Stored in |
|---|---|---|
| Bucket, origin | `GET /vendors/{id}/service-mappings` → `meta` | — |
| Service Name options | `GET /p2p/services?service_type&classification&per_page=200&sort=name`, minus mapped and `inactive` | `p2p_service_suppliers.service_id` |
| Service Code, HSN / SAC | The catalogue row | — |
| Currency (international) | `GET /p2p/services/master-bundle` → currencies (not INR) | `p2p_service_suppliers.currency_code` (domestic `INR`) |
| Price | Typed | `p2p_service_suppliers.price` |
| Exchange Rate (international) | Currency's master rate, editable | `p2p_service_suppliers.exchange_rate` |
| GST % (domestic) | The service's `gst_id` / `gst_percentage` | `gst_id`, `gst_percentage` (international: NULL / 0) |
| GST Amount, Total, ₹ Value | Server (`priceFields()`) | `gst_amount`, `total_amount`, `inr_amount` |
| CGST / SGST / IGST, `gst_type` | Computed on every read (`gstSplit()`) | not stored |
| Remarks | Typed | `p2p_service_suppliers.remarks` |
| Mapped / unmapped | — | `p2p_service_suppliers.status`; `p2p_services.status` draft → active, `step_completed ≥ 2` |

### 12.7 Evidence Vault and Convert

| Field | Read from | Stored in |
|---|---|---|
| Standard rows | `GET /segment-uploads/supplier/{id}/vault` → `company_dd[]`, `owner_kyc[]`, `trade_licenses[]` | Uploads → `segment_doc_uploads` |
| Case to Case rows | `SDUC::buildPoDeals()` (12.8) | — |
| Document signature status | `clm_signature_requests.status` + `GET /clm/signature-requests?…&sync=1` overlay | Sends → `clm_signature_requests`; PO documents `p2p_purchase_order_documents.status='sent'`, `sent_at`, `signature_request_id` |
| PO PDF | `p2p_purchase_order_documents.file_path` | `generate` → `p2p/po-documents/{po}/…`, `file_path`, `original_name`, `generated_on` |
| Reminder | — | `clm_signature_requests.reminder_count`, `last_reminder_sent_at` |
| Convert prefill | `p2p_suppliers` fields; ids matched by name in `master_countries`, `master_states`, `clm_segments` | — (saved as 12.2–12.3) |
| Business card copy | `p2p_suppliers.card_path` | `vendor_documents/{id}/contact-…`; primary `vendor_addresses.attachment_path` (only when empty) |

### 12.8 Notes

| Item | Source |
|---|---|
| Required KYC / DD / TL rows | Stage 2: `clm_segment_rules.doc_selections` by segment **code** and exact document type (`forSegment`). Vault / compliance: by segment **id**, falling back to the other document type (`SegmentDocScope`, `SupplierCompliance`) |
| Bucket and origin in Mapped Services | `meta` of `GET /vendors/{id}/service-mappings` (server truth) |
| Evidence Vault deals | `SDUC::buildPoDeals()` — the supplier's `p2p_purchase_orders`. POs with a shipment are grouped per shipment into `vendor_with_shipment` (`pos[]`, `po_count`); the rest are one row each in `vendor_without_shipment` (`po_id`, `po_code`, `po_status`, `po_total`, …). Documents = `p2p_purchase_order_documents` with `needed='yes'`, shaped by `shapePoDoc()` (Signed / Pending / Declined / Recalled / Expired from the linked request); `spi_docs` from `buildSpiDocs()`. **No PO** → two empty arrays. `buildVendorDeals()` only supplies `vendor_deal_ratios` (KYC / DD / TL / TD, also merged into each PO row's `ratios`) and the `?ring=1` payload |

---

## 13. KNOWN TECHNICAL ISSUES

Grouped by area. Numbers are the issue IDs from earlier versions of this
document, kept so old references still work.

### 13.1 Data Integrity

| # | Issue | Where |
|---|---|---|
| 3 | GSTIN uniqueness and one-product-per-supplier have **no DB index**; `status` and `supplier_category` have **no CHECK constraint** | migrations |
| 5 | `destroy()` soft-deletes the supplier but leaves its child rows (soft delete doesn't fire the FK cascade) | `VC::destroy()` |
| 20 | `storeProducts` force-deletes and re-creates mappings without `origin` / `currency_code` / `exchange_rate` / `inr_amount`, wiping what the Product side wrote | `VC::storeProducts()` vs `ProductController::storeVendors()` / `updateVendorMapPrice()` |
| 22 | GST scrutiny saves never update `vendors.gst_number` | `VC::storeGstScrutiny()` / `updateGstScrutiny()` |
| 29 | If `GET /vendors/{id}/product-mappings` fails, `MappedProductsViewPopup` still allows Map New Product and the replace-all save deletes every other mapping | `MappedProductsViewPopup` `loadMappings()` / `saveMapping()` |
| 30 | Supplier Behaviour: `firstOrCreate(client_id, exact name)` — a name from a global (`client_id` NULL) row, or one differing only in case / spacing, creates a new tenant row; the FE de-duplicates case-insensitively, the server does not. The quick-add `case 'vendor_behaviour'` is unreachable | `AddVendorModal.tsx` `supplierBehaviourOptions`; `VC::storeIdentity()` |
| 35 | `SDUC::store()` always writes `requirement` (default `O`), so `summary()` counts are wrong | `SDUC::store()` |
| 37 | `storeContacts` rebuilds the primary address only from `primary_address[...]` — an API client sending only contact fields blanks the Stage 1 address | `VC::storeContacts()` |
| 40 | Convert: `convertPrefill()` matches the segment by name in the read scope; a global match is dropped by `normalizeSegmentIds()` → saved with no segment | `SourcingController::convertPrefill()`; `VC::normalizeSegmentIds()` |
| 41 | `VendorBehaviour::firstOrCreate()` stores the user's `branch_id`; branch-scoped bundle reads of other branches don't see it | `VC::storeIdentity()`; `MasterVisibility::applyBranchScope()` |
| 42 | `storeIdentity()` creates the Supplier Type row **before** the type-lock check, and the Type and Behaviour rows **before** the TIN / GST / segment checks — a refused save can still create them | `VC::storeIdentity()` |
| 46 | `storeProducts` trusts the client's `gst_percentage`, `gst_amount`, `total_amount`; international suppliers' product mappings are in ₹ with the product GST | `VC::storeProducts()` |
| 48 | `storeProducts` re-activates **every** listed product, including ones made inactive on purpose | `VC::storeProducts()` |
| 53 | `ProductController::storeSales()` silently re-prices GST on every supplier mapping of a product when its GST changes | `ProductController::storeSales()` |
| 54 | The CS-2327 no-GST rule exists only in `VC::storeProducts()`: `ProductController::storeVendors()` stores 0 % (`GstPercentage::find(null)`) — such a mapping then blocks every later `storeProducts()` save | `ProductController::storeVendors()`, `VC::storeProducts()` |

### 13.2 Performance

| # | Issue | Where |
|---|---|---|
| 6 | Type tabs and counts stop at **1000** suppliers; service counts at **200** services and match on company **name** | `Vendors.tsx` `KIND_FETCH_CAP`, `loadServiceCounts()` |
| 7 | The compliance sweep runs on **every** list call, including the Filter popup's `per_page=1` counts | `VC::index()` → `SupplierCompliance::statuses()` |
| 23 | `MasterBundleCache::bump()` invalidates every user's and client's bundles (one global version) | `App\Support\MasterBundleCache` |

### 13.3 Validation and Business Rules

| # | Issue | Where |
|---|---|---|
| 1 | **GSTIN state-code check never runs** on the server: `unset($data['address'])` runs right after validation, and the later check reads `$data['address']['state_code']` (always empty) | `VC::storeIdentity()` |
| 9 | Stage 2 only blocks on missing files of the legacy DD rows, not the segment-rule rows | `AddVendorModal.tsx saveKyc()` (`missingDd`) |
| 10 | The upload popup offers WEBP; the FE validator and the server refuse it | `SegmentRefUploadPopup` vs `validateVendorUpload()`; `SDUC::store()` |
| 11 | Only product mappings activate a supplier; service suppliers stay `inactive` | `VC::storeProducts()`, `ProductController::storeVendors()` |
| 12 | `storeProducts` doesn't check the product's tenant, segment or status | `VC::storeProducts()` |
| 14 | Compliance: no country ⇒ international; any PO (draft too) ⇒ "has a PO" | `SupplierCompliance::statuses()` |
| 19 | The segment-rule-for-origin check is browser-only; the server drops global segments without an error | `VC::normalizeSegmentIds()`; `saveIdentity()` |
| 21 | Supplier Type kind decided by name in the browser and by `service_type` on the server; `firstOrCreate` by name can reuse an Inactive type | `typeKind()`, `serviceBucketOf()` vs `vendorServiceType()`; `VC::storeIdentity()` |
| 24 | The wizard's product list has no status filter (draft / inactive offered) and the server caps it at 200 | `loadMappableProducts()` / `fetchProductOptsIfNeeded()`; `ProductController::index()` |
| 25 | `validateVendorUpload()` allows DOC / DOCX and refuses WEBP, while pickers allow JPG / PNG / WEBP / PDF and the server `jpg,jpeg,png,webp,pdf` / `pdf,jpg,jpeg,png`: WEBP refused in the browser; DOC / DOCX can never be picked | `AddVendorModal.tsx` |
| 27 | CS-2327 GST check runs over the **whole** list: an already-mapped product that lost its `gst_id` blocks every product save and `finishSupplier()` | `VC::storeProducts()`; `finishSupplier()` → `saveProducts()` |
| 28 | The list's Mapped Products popup has no GST pre-check; the wizard's is skipped for a product outside the 200 loaded options | `MappedProductsViewPopup saveMapping()`; `saveMapDraft()` |
| 32 | Compliance reads signed agreements only from `document_type='agreement'`; the vault's mixed envelope is stored as `trade_doc`, so those agreements never count | `SupplierCompliance::signedAgreements()`; `ClmSignatureController::send()` |
| 33 | Stage 2 reads rules by segment **code** + exact type; vault / compliance by **id** with fallback — they can list different documents | `ClmSegmentRuleController::forSegment()` vs `SegmentDocScope`, `SupplierCompliance::evaluate()` |
| 36 | Services: replace-all re-validates every kept row; inactive services accepted by the server; PATCH skips `assertServes()`; browser checks GST %, server `gst_id` | `VC::storeServices()` / `updateServiceMapping()`; `MappedServicesPopup` |
| 38 | The server does not require a GSTIN for an Indian supplier (browser-only rule) | `VC::storeIdentity()` |
| 39 | A segment with **no** rule at all is only greyed out, not flagged; an already-selected one saves | `saveIdentity()`, `disabledSegmentIds` |
| 47 | No Supplier Type check for product mapping: an FFD / untyped supplier with products can be given more | `Vendors.tsx`; `MappedProductsViewPopup`; `VC::storeProducts()` |
| 52 | The primary email is not checked against the extra contacts' emails | `saveContactDraft()` / `saveContacts()` |

### 13.4 Security and Access

| # | Issue | Where |
|---|---|---|
| 2 | `state_locked` is **UI only** — the server accepts an address / GST change on a supplier with a PO | `VC::show()`; `VC::storeIdentity()` |
| 4 | `hierarchicalDenial` never denies a Vendor — no edit permission enforced | `MasterVisibility::hierarchicalDenial()` |
| 13 | `/segment-uploads/supplier/{id}` checks the **client** only — another branch's supplier can be read, uploaded to, deleted | `SDUC::resolveOwner()` |
| 18 | `/suppliers` route not permission-checked (`isBiz` without `p2p.supplier.can_view`) | `routeAccess.ts canAccessPath()` |
| 31 | Convert endpoints check no permission (client match only); Sourcing Tracker shows Convert to every report viewer | `convertPrefill()` / `convertSupplier()`; `MappedSuppliers.tsx` |

### 13.5 User Experience

| # | Issue | Where |
|---|---|---|
| 17 | Convert: after Contact Person Details is saved, the New Supplier is linked even if the form is abandoned (supplier stays `draft`). Cancelling **before** it leaves an unlinked `draft` S-NNN, the Convert button stays, and a retry creates another | `VC::storeContacts()`, `storeIdentity()` |
| 26 | A supplier with legacy `vendor_documents` / `vendor_owners` rows sees the old tables instead of the segment-rule rows | Stage 2 render |
| 34 | Vault: no bulk send in the With-Shipment **tab view**; `sendSelection()` uses only the first PO of a mixed selection; the signature overlay matches by library id, not per PO (runtime check needed); `markSent` for a bundled PO probably fails silently (runtime check needed) | `SupplierEvidenceVaultModal.tsx`; `PurchaseOrderDocumentController::markSent()` |
| 43 | `persistSegmentRefUpload()` deletes the row's upload state on error → Upload shown until reload, though the old file remains | `AddVendorModal.tsx` |
| 44 | `LockField`'s tooltip always says *"…mapped to a Purchase Order"*, also for an SPI lock | `AddVendorModal.tsx LockField` |
| 49 | Vault for a global supplier: `resolveOwner()` 404s and the screen swallows it — empty vault, no message | `SDUC::resolveOwner()`; vault load `.catch` |
| 50 | Vault ring (`dealSplit`) needs `t > 0` per category — 0 required documents never counts complete | `SupplierEvidenceVaultModal.tsx` |
| 51 | A PO document with no signature request takes its status from `p2p_purchase_order_documents.status` — can read "Sent" without a CLM request | `SDUC::shapePoDoc()` |

### 13.6 Code Quality

| # | Issue | Where |
|---|---|---|
| 8 | The contacts step route is `PUT` but the FE sends `POST` multipart (method spoofing) | `routes/api.php`; `saveContacts()` |
| 15 | No screen calls `DELETE /vendors/{id}` | — |
| 16 | *(Removed — not reachable: `AttachmentCell` renders no clear control, so a saved cheque can't be cleared.)* | `AddVendorModal.tsx` `AttachmentCell` |
| 45 | `removeBankRow` / `openBankEdit` are dead code | `AddVendorModal.tsx` |

### 13.7 Fixed

| Fix | Where |
|---|---|
| Convert link moved to the Contacts step — a retry **after** Contacts no longer creates a second supplier; `convertSupplier()` finds the supplier client-wide | `bf7dad2ed` |
| Supplier Behaviour options now come from the `master_vendor_behaviour` master (fixed list only as a fallback) | `cdc5aff67` |

---

## END OF DOCUMENT

| Item | Covered |
|---|---|
| Purpose, conventions, scope | Section 1 |
| Stack and architecture | Sections 2–3 |
| Files and routes | Sections 4–5 |
| Database tables, fixed values, uniqueness | Section 6 |
| Business rules (code, list, compliance, steps, locks, behaviour, GST, files, Convert) | Section 7 |
| Security | Section 8 |
| Frontend internals | Section 9 |
| Responsive and CSS | Section 10 |
| Integrations | Section 11 |
| Field-level data map | Section 12 |
| Known issues (54, grouped) | Section 13 |

**Related documents:** Functional Documentation · Code Walkthrough · API
Documentation.

**Verified against code up to:** commit `cdc5aff67`.
