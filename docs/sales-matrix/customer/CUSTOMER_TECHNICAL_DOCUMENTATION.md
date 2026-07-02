# CUSTOMER MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Customer (buyer entity)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the Customer module is
A **Customer** is a buyer entity in the **Sales Matrix**. It owns a set of **addresses** (one primary + N locations), **KYC documents** (Due-Diligence `dd` + Trade-Licence `tl`), **owner** records, **GST-scrutiny** rows, and **consignees**. Records are multi-tenant (`client_id` / `branch_id`) and scoped on every read via `MasterVisibility`.

### 1.2 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                       CUSTOMER (Sales Matrix)                        │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │            React 19 + TypeScript SPA (Vite)                    │ │
│  │  resources/js/pages/sales/core-masters/customer/               │ │
│  │  ┌────────────────┐ ┌───────────────────────────────────────┐ │ │
│  │  │ SalesCustomers │ │ AddCustomerModal (2-stage wizard)      │ │ │
│  │  │ (list + tabs)  │ │  Stage 1 Legal Identity                │ │ │
│  │  └────────────────┘ │  Stage 2 KYC / Due Diligence           │ │ │
│  │  ┌────────────────┐ │  + GST Scrutiny popup                  │ │ │
│  │  │ Consignees /   │ └───────────────────────────────────────┘ │ │
│  │  │ EvidenceVault  │  api.ts → Bearer token (+?branch_id on GET)│ │
│  │  └────────────────┘                                            │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │  HTTPS / JSON (multipart on uploads)
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│           Laravel 12 API · routes/api.php  (prefix /api)             │
│           middleware: auth:sanctum → user.active                    │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       APPLICATION LAYER                              │
│  CustomerController ─ index/show/store/update/destroy                │
│                     ─ GST scrutiny CRUD · masterBundle               │
│  CustomerDocumentController · CustomerOwnerController                │
│  Support: MasterVisibility (scope + hierarchicalDenial) ·           │
│           MasterBundleCache · SegmentGuard                          │
│  Services: ConsigneeKycMirror (resync KYC + sync core fields)       │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  Customer ─┬─ hasMany CustomerAddress (1 primary)              │ │
│  │            ├─ hasMany CustomerDocument (dd/tl)                 │ │
│  │            ├─ hasMany CustomerOwner                            │ │
│  │            ├─ hasMany CustomerGstScrutiny (softdel)           │ │
│  │            └─ hasMany Consignee ─ (same_as_customer mirror)   │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│      PostgreSQL (c_b_c)  ·  attachments on the 'public' disk         │
│  customers · customer_addresses · customer_documents ·              │
│  customer_owners · customer_gst_scrutiny  (+ consignee_* mirror)     │
└─────────────────────────────────────────────────────────────────────┘
```

> **Stack note:** PostgreSQL (`DB_CONNECTION=pgsql`, database `c_b_c`). Search uses `ilike`. Attachments are stored on the `public` disk as relative paths and resolved via the `file_url()` helper.

### 1.3 Access model
- All `/customers*` routes carry `auth:sanctum` + `user.active`.
- Reads/writes are **tenant-scoped** via `Customer::scopeForUser($user)` → `MasterVisibility::applyReadScope`. Mutations additionally pass through `MasterVisibility::hierarchicalDenial($user, $entity, 'edit'|'delete')`.
- The Branch Switcher injects `?branch_id` on GETs; client-admins can narrow to a branch.

### 1.4 Module Structure

```
app/
├── Http/Controllers/Api/
│   ├── CustomerController.php          # CRUD + GST scrutiny CRUD + masterBundle
│   ├── CustomerDocumentController.php  # dd / tl documents (nested)
│   └── CustomerOwnerController.php     # owner KYC (nested)
├── Models/
│   ├── Customer.php                    # SoftDeletes, scopeForUser
│   ├── CustomerAddress.php             # primary + locations
│   ├── CustomerDocument.php            # kind dd/tl, attachment_url append
│   ├── CustomerOwner.php               # 3 identity-proof paths + url appends
│   ├── CustomerGstScrutiny.php         # SoftDeletes
│   └── Consignee.php                   # mirror of Customer (customer_id, same_as_customer)
├── Support/
│   ├── MasterVisibility.php            # read scope + hierarchicalDenial
│   ├── MasterBundleCache.php           # per-user cache key
│   └── SegmentGuard.php                # blocks segment removal when docs exist
└── Services/
    └── ConsigneeKycMirror.php          # resyncForCustomer / syncCoreFromCustomer

database/migrations/
├── 2026_05_19_000010_create_customers_tables.php        # customers + customer_addresses
├── 2026_05_19_000020_create_customer_kyc_tables.php     # customer_documents + customer_owners
├── 2026_05_20_*_consignee*.php                          # consignees (+ same_as_customer)
├── 2026_05_22_*_add_indexes*.php                        # created_by / created_at / email / phone indexes
├── 2026_06_02_*_widen_segment.php                       # segment varchar(64→1024)
└── 2026_06_29_000001_create_customer_gst_scrutiny_table.php

resources/js/pages/sales/core-masters/customer/
├── SalesCustomers.tsx                  # list + tabs + search + actions
├── AddCustomerModal.tsx                # 2-stage wizard + GST scrutiny + sub-modals
├── CustomerConsigneesModal.tsx         # map consignees
├── CustomerEvidenceVaultModal.tsx      # 5-tab evidence vault
├── SalesCustomerSendForSignatureModal.tsx  # Zoho Sign wizard
└── customerBundleCache.ts              # sessionStorage master-bundle cache
```

---

## 2. TECHNOLOGY STACK

### 2.1 Backend
| Component | Technology | Purpose |
|---|---|---|
| Language | PHP 8.2+ | Server-side |
| Framework | Laravel 12.x | MVC / routing / ORM |
| Database | PostgreSQL (`c_b_c`) | Relational store (`ilike` search) |
| Auth | Laravel Sanctum 4 | Bearer-token API auth |
| File storage | `public` disk (flysystem) | Document / owner-proof attachments |
| Scoping | `MasterVisibility` | Tenant + hierarchical visibility |

### 2.2 Frontend
| Component | Technology | Purpose |
|---|---|---|
| Framework | React 19 + TypeScript 6 | UI |
| Build | Vite 7 | Bundler |
| UI | reactstrap + Bootstrap 5.3 + Tailwind 4 | Velzon theme |
| Tables | @tanstack/react-table (TableContainer) | List grid |
| Export | xlsx + file-saver | Evidence Vault export |
| HTTP | Axios (`resources/js/api.ts`) | injects Bearer + `?branch_id` on GET |
| Editor / sign | TipTap · Zoho Sign (trade docs) | Composition + e-signature |

---

## 3. DATABASE SCHEMA

### 3.1 Entity Relationship Diagram

```
┌──────────────────────┐   1  ►*  ┌────────────────────────┐
│      customers       │──────────│   customer_addresses   │
├──────────────────────┤ hasMany  ├────────────────────────┤
│ id            PK      │          │ id            PK       │
│ client_id / branch_id│          │ customer_id   FK ──────┼─┐ cascade
│ customer_code UNIQUE  │          │ is_primary (1 true)    │ │
│ company_name          │          │ type / address_line    │ │
│ legal_name (uniq/ten) │          │ country/state/city/pin │ │
│ segment varchar(1024) │          │ cp_name / cp_contact   │ │
│ gst_applicable Yes/No │          │ cp_email / cp_whatsapp  │ │
│ primary_email (mirror)│          └────────────────────────┘ │
│ status / created_by   │                                     │
│ deleted_at (softdel)  │   1  ►*  ┌────────────────────────┐ │
├──────────────────────┤──────────│   customer_documents   │ │
│  hasMany …            │ hasMany  │ kind dd|tl · name      │ │
│                       │          │ license_number / dates │ │
│                       │          │ attachment_path        │ │
│                       │          └────────────────────────┘ │
│                       │   1  ►*  ┌────────────────────────┐ │
│                       │──────────│   customer_owners      │ │
│                       │ hasMany  │ owner_name / phone     │ │
│                       │          │ id/address/photo paths │ │
│                       │          └────────────────────────┘ │
│                       │   1  ►*  ┌────────────────────────┐ │
│                       │──────────│  customer_gst_scrutiny │ │
│                       │ hasMany  │ gst_number (uniq x-cust)│ │
│                       │          │ status / last_filing…  │ │
│                       │          │ deleted_at (softdel)   │ │
│                       │          └────────────────────────┘ │
│                       │   1  ►*  ┌────────────────────────┐ │
│                       │──────────│      consignees        │ │
│                       │ hasMany  │ customer_id FK ────────┼─┘
│                       │          │ same_as_customer bool  │
└──────────────────────┘          │ consignee_code CN-####  │
                                   └────────────────────────┘
```

### 3.2 Table: `customers`  *(SoftDeletes; migration `2026_05_19_000010`)*
| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigint PK | no | auto | |
| client_id | bigint FK | yes | — | → clients nullOnDelete (tenant) |
| branch_id | bigint FK | yes | — | → branches nullOnDelete (tenant) |
| customer_code | varchar(32) | yes | — | **UNIQUE** — `C-####` per client |
| company_name | varchar(255) | no | — | required |
| legal_name | varchar(255) | yes | — | unique per tenant (case-insensitive) |
| type | varchar(64) | yes | — | Customer Type master |
| segment | varchar(1024) | yes | — | comma-separated multi-select (widened 2026-06-02) |
| classification | varchar(64) | yes | — | Customer Classification master |
| risk_level | varchar(32) | yes | — | Risk Level master |
| gst_applicable | varchar(8) | yes | — | `Yes` / `No` — gates GST scrutiny |
| website | varchar(500) | yes | — | |
| primary_email | varchar(255) | yes | — | mirror of primary address `cp_email` |
| status | varchar(16) | no | `Active` | Active / Inactive |
| created_by | bigint FK | yes | — | → users nullOnDelete (creator) |
| created_at / updated_at / deleted_at | timestamp | yes | — | |

**Indexes:** `status`, `type`, `classification`, `(client_id, branch_id)`, `(client_id, primary_email)`, `created_by`, `created_at`, `(client_id, created_at)`. **Unique:** `customer_code`.

### 3.3 Table: `customer_addresses`  *(migration `2026_05_19_000010`)*
| Column | Type | Null | Notes |
|---|---|---|---|
| id | bigint PK | no | |
| customer_id | bigint FK | no | → customers cascadeOnDelete |
| type | varchar(64) | no | Address Type master |
| address_line | text | no | 4–75 chars |
| country / state / city | varchar(64) | yes | |
| pin | varchar(16) | yes | regex `^\d{6}$` |
| cp_name | varchar(255) | no | contact person |
| cp_designation | varchar(128) | yes | |
| cp_contact | varchar(32) | yes | regex `^\+?[0-9\s-]{7,15}$`; unique per tenant (primary only) |
| cp_email | varchar(255) | yes | → mirrors `customers.primary_email`; unique per tenant (primary only) |
| cp_whatsapp | varchar(4) | yes | `yes` / `no` |
| is_primary | boolean | no (def false) | exactly one per customer |

**Indexes:** `customer_id`, `(customer_id, is_primary)`, `(customer_id, cp_email)`, `(customer_id, cp_contact)`.

### 3.4 Table: `customer_documents`  *(migration `2026_05_19_000020`)*
| Column | Type | Null | Notes |
|---|---|---|---|
| id | bigint PK | no | |
| customer_id | bigint FK | no | → customers cascadeOnDelete |
| kind | varchar(8) | no | `dd` (Due Diligence) / `tl` (Trade Licence) |
| name | varchar(255) | no | document name |
| license_number | varchar(128) | yes | |
| issuing_authority | varchar(255) | yes | |
| issue_date / expiry_date | date | yes | expiry ≥ issue |
| attachment_path | varchar(500) | yes | `customer_documents/{id}/…` on public disk |
| description | text | yes | max 1000 |
| status | varchar(16) | no (`Active`) | |
| created_by | bigint FK | yes | → users nullOnDelete |

**Indexes:** `(customer_id, kind)`, `expiry_date`. **Appends:** `attachment_url` (via `file_url()`).

### 3.5 Table: `customer_owners`  *(migration `2026_05_19_000020`)*
| Column | Type | Null | Notes |
|---|---|---|---|
| id | bigint PK | no | |
| customer_id | bigint FK | no | → customers cascadeOnDelete |
| owner_name | varchar(255) | no | |
| designation | varchar(128) | yes | |
| official_email | varchar(255) | yes | |
| phone_number | varchar(32) | yes | regex `^\+?[0-9\s-]{7,15}$` |
| id_proof_path / address_proof_path / photograph_path | varchar(500) | yes | uploaded proofs |
| status | varchar(16) | no (`Active`) | |
| created_by | bigint FK | yes | → users nullOnDelete |

**Indexes:** `customer_id`, `official_email`. **Appends:** `id_proof_url`, `address_proof_url`, `photograph_url`.

### 3.6 Table: `customer_gst_scrutiny`  *(SoftDeletes; migration `2026_06_29_000001`)*
| Column | Type | Null | Notes |
|---|---|---|---|
| id | bigint PK | no | |
| customer_id | bigint FK | no | → customers cascadeOnDelete |
| gst_number | varchar(16) | no | 15-char GSTIN; **unique across customers** |
| status | varchar(16) | no (`Active`) | Active / Inactive |
| last_filing_date | date | yes | |
| prev_non_gst_2a_invoice | varchar(255) | yes | |
| red_flags | text | yes | compliance notes |
| created_by | bigint FK | yes | → users nullOnDelete |
| deleted_at | timestamp | yes | SoftDelete |

**Indexes:** `customer_id`, `gst_number`.

### 3.7 Table: `segment_doc_uploads`  *(polymorphic; migration `2026_05_27_000001`)*
The **segment-rule-driven** compliance store and the sole backing table of the Evidence Vault. Distinct from `customer_documents` (§3.4, the ad-hoc store).
| Column | Type | Null | Notes |
|---|---|---|---|
| id | bigint PK | no | |
| uploadable_type | varchar | no | polymorphic — `App\Models\Customer` / `Consignee` / `Vendor` |
| uploadable_id | bigint | no | entity id |
| client_id | bigint FK | no | tenant |
| category | varchar(8) | no | `kyc` / `dd` / `tl` / `td` / `qc` |
| doc_code | varchar(32) | no | segment-rule auto-code (`DD-001`, `KYC-003`, …) |
| doc_name | varchar(255) | no | **snapshot** of the doc name at upload time (rule edits don't rewrite it) |
| requirement | char(1) | yes | `M` / `O` (snapshot) |
| attachment_path | varchar | no | `segment_doc_uploads/{type}/{id}/{category}/{doc_code}/…` on public disk |
| attachment_name | varchar | yes | original filename |
| uploaded_by | bigint FK | yes | → users |

**Unique:** `(uploadable_type, uploadable_id, category, doc_code)` — one file per code; a re-upload deletes the old file and updates the row. **Index:** `(client_id, uploadable_type, uploadable_id)`. **Appends:** `attachment_url`.

> **Verification is not stored.** There is no `verified`/`verified_at`/`verified_by`. The vault computes `status = upload exists ? 'Verified' : 'Pending'`.

### 3.8 Table: `clm_signature_requests` (trade-doc signatures)  *(SoftDeletes)*
Backs the Trade Documents / Agreements tabs. Key columns: `id`, `client_id`, `branch_id`, `document_type` (`trade_doc`/`agreement`/`quotation`/`proforma_invoice`), `lead_id`, `trade_doc_ids` (json), `document_names` (json), `model_name` (`Customer`/`Consignee`/`Vendor`), `party_id`, `zoho_request_id`, `status` (`draft`/`inprogress`/`completed`/`declined`/`recalled`/`superseded`), `signers` (json), `signing_urls` (json), `signed_document_paths` (json), `certificate_path`, `completed_at`/`declined_at`/`recalled_at`, `last_reminder_sent_at`, `reminder_count`, `created_by`.

### 3.9 Table: `consignees` (mirror)
Same shape as `customers` **plus** `customer_id` (FK), `consignee_code` (`CN-####`), `same_as_customer` (bool). **No `type` column.** Index `(customer_id, same_as_customer)`. Has `consignee_addresses` / `consignee_documents` / `consignee_owners` mirroring the customer's KYC.

---

## 4. MODEL RELATIONSHIPS

### 4.1 Customer (`app/Models/Customer.php`)
```php
class Customer extends Model {
    use SoftDeletes;
    // fillable: client_id, branch_id, created_by, customer_code, company_name,
    //   legal_name, type, segment, classification, risk_level, gst_applicable,
    //   website, primary_email, status

    public function addresses()      { return $this->hasMany(CustomerAddress::class)
                                           ->orderByDesc('is_primary')->orderBy('id'); }
    public function primaryAddress()  { return $this->hasOne(CustomerAddress::class)
                                           ->where('is_primary', true); }
    public function documents()       { return $this->hasMany(CustomerDocument::class)->orderByDesc('id'); }
    public function owners()          { return $this->hasMany(CustomerOwner::class)->orderByDesc('id'); }
    public function gstScrutiny()     { return $this->hasMany(CustomerGstScrutiny::class)->orderByDesc('id'); }
    public function consignees()      { return $this->hasMany(Consignee::class); }
    public function client() / branch() / creator();

    // Read scope — tenant + hierarchical visibility (+ optional branch filter)
    public function scopeForUser($q, $user, ?int $branchFilter = null) { /* MasterVisibility::applyReadScope */ }
}
```

### 4.2 CustomerAddress / CustomerDocument / CustomerOwner / CustomerGstScrutiny
- `CustomerAddress` — `customer()` belongsTo; `is_primary` cast boolean.
- `CustomerDocument` — `customer()` belongsTo; date casts; appends `attachment_url`.
- `CustomerOwner` — `customer()` belongsTo; appends 3 proof URLs.
- `CustomerGstScrutiny` — `SoftDeletes`; `customer()` belongsTo; `last_filing_date` cast date.

### 4.3 Consignee
Mirror of Customer with `customer()` belongsTo Customer + its own `addresses()`/`documents()`/`owners()`. `same_as_customer` marks rows the mirror service keeps in sync.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum', 'user.active'])->group(function () {
    Route::get   ('/customers/master-bundle', [CustomerController::class, 'masterBundle']); // before apiResource
    Route::apiResource('customers', CustomerController::class);
    //  GET /customers · POST /customers · GET/PUT/DELETE /customers/{customer}

    // Nested — GST scrutiny
    Route::get   ('/customers/{customer}/gst-scrutiny',        [CustomerController::class, 'indexGstScrutiny']);
    Route::post  ('/customers/{customer}/gst-scrutiny',        [CustomerController::class, 'storeGstScrutiny']);
    Route::put   ('/customers/{customer}/gst-scrutiny/{gst}',  [CustomerController::class, 'updateGstScrutiny']);
    Route::delete('/customers/{customer}/gst-scrutiny/{gst}',  [CustomerController::class, 'destroyGstScrutiny']);

    // Nested — documents / owners
    Route::apiResource('customers.documents', CustomerDocumentController::class);
    Route::apiResource('customers.owners',    CustomerOwnerController::class);
});
```
Full request/response detail is in **CUSTOMER_API_DOCUMENTATION.md**. Responses are ad-hoc JSON (`{ data }` for items/collections; `{ tab, count, data }` for the list); no uniform API Resource envelope.

---

## 6. CONTROLLER METHOD ANALYSIS

| Method | Line | Txn | Purpose |
|---|---|---|---|
| `index` | 29 | — | Tenant-scoped list; search priority (code → email → name/segment/type → address); Fresh/Recurring tab via a leads EXISTS subquery; optional pagination (default all; per_page ≤ 200) |
| `show` | 149 | — | Full detail — embeds documents, owners, segment_uploads, gst_scrutiny |
| `store` | 221 | ✅ | Create customer + primary address + locations; allocate `C-####` under a `clients` row lock |
| `update` | 281 | ✅ | Update fields, replace address set, `SegmentGuard` on segment removal, then `ConsigneeKycMirror::syncCoreFromCustomer` |
| `destroy` | 360 | — | Soft-delete (after `hierarchicalDenial`) |
| `indexGstScrutiny` | 382 | — | List GST rows for the customer |
| `storeGstScrutiny` | 389 | — | Add GST row (`validateGst`) |
| `updateGstScrutiny` | 411 | — | Update GST row (`validateGst` with ignore id) |
| `destroyGstScrutiny` | 432 | — | Force-delete GST row |
| `masterBundle` | 776 | — | Cached (5-min/user) dropdown bundle |

Private helpers: `nextCustomerCode()` (row-locked `C-####`), `validatePayload()` (all field rules + cross-row email/phone uniqueness), `validateGst()` (GSTIN regex + cross-customer unique), `shapeCustomer()/shapeAddress()/shapeGst()` (response shapers).

---

## 7. FRONTEND COMPONENTS

### 7.1 Routing (`App.tsx`)
| Path | Component |
|---|---|
| `/sales/customers` | `SalesCustomers` (lazy) |

The Add/Edit form and popups are **modals**, not routes (lazy-loaded: `AddCustomerModal`, `CustomerConsigneesModal`, `CustomerEvidenceVaultModal`).

### 7.2 Components
| Component | Purpose | Key endpoints |
|---|---|---|
| `SalesCustomers.tsx` | List + Fresh/Recurring tabs + search + row actions | `GET /customers?tab=&q=` |
| `AddCustomerModal.tsx` | 2-stage wizard + GST scrutiny + KYC sub-modals | `GET/POST/PUT /customers`, `/customers/{id}/documents`, `/owners`, `/gst-scrutiny`, `/customers/master-bundle` |
| `CustomerConsigneesModal.tsx` | Map/add consignees | `GET /consignees?customer_id=` |
| `CustomerEvidenceVaultModal.tsx` | 5-tab evidence vault + export | document/signature reads |
| `SalesCustomerSendForSignatureModal.tsx` | Zoho Sign wizard | `GET /clm/signature-requests?…` |
| `customerBundleCache.ts` | sessionStorage master-bundle cache | — |

### 7.3 Shared building blocks
`MasterSelect` / `MasterMultiSelect` / `MasterDatePicker` (masterFormKit), `WorklistPager`, `DeleteConfirmModal`, `Tooltip`, `Field`, `resolveFileUrl` / `downloadFile`.

---

## 8. SECURITY IMPLEMENTATION

### 8.1 Authentication & scoping
- `auth:sanctum` + `user.active` on all routes.
- **Server-side tenant scoping** via `Customer::scopeForUser` on every read; mutations gated by `MasterVisibility::hierarchicalDenial`.
- `client_id` / `branch_id` derived from `auth()->user()` — never from the request body.

### 8.2 Validation & uniqueness
- Legal name (per-tenant, case-insensitive), primary email + primary phone (per-tenant), and cross-row uniqueness within a customer's addresses.
- **GSTIN** regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` + cross-customer unique (`customer_id != current`, `deleted_at IS NULL`).
- Pin `^\d{6}$`; phone `^\+?[0-9\s-]{7,15}$`.

### 8.3 File uploads
- Documents/owner proofs validated by mime + size (2 MB cap), stored on the `public` disk as relative paths; old files deleted before replace/destroy; URLs resolved via `file_url()`.

### 8.4 Segment guard
`SegmentGuard::blockedRemovals()` prevents removing a segment that already has uploaded documents (returns 422 with the offending segment names).

---

## 9. ERROR HANDLING

| Condition | HTTP | Source |
|---|---|---|
| Not authenticated | 401 | `auth:sanctum` |
| User inactive | 403 | `user.active` |
| Not permitted (edit/delete) | 403 | `MasterVisibility::hierarchicalDenial` |
| Customer / GST row not found | 404 | route-model binding + `forUser` scope |
| Validation failure | 422 | `$request->validate()` → `{ message, errors }` |

- `store`/`update` are transactional and roll back fully on error.
- `ConsigneeKycMirror` failures during update are **logged, not fatal** (the customer save still succeeds).

---

## 10. PERFORMANCE

| Optimization | Where |
|---|---|
| `master-bundle` cached per-user (5-min TTL); states excluded (lazy per country) | `masterBundle()` / `customerBundleCache.ts` |
| Search priority short-circuits on the indexed `customer_code` / `primary_email` before falling to `ilike` scans | `index()` |
| Fresh/Recurring implemented as an EXISTS subquery on `leads` | `index()` |
| Single `GET /customers/{id}` bundles documents + owners + segment_uploads + gst_scrutiny (no N+1 round-trips) | `show()` |
| Row-locked code allocation avoids race duplicates | `nextCustomerCode()` |
| Heavy modals lazy-loaded (TipTap / pdf libs) | `SalesCustomers.tsx` |

---

## 11. CODE QUALITY METRICS

| Metric | Value |
|---|---|
| CustomerController LOC | ~811 |
| Nested controllers | CustomerDocumentController · CustomerOwnerController |
| Customer tables | customers · customer_addresses · customer_documents · customer_owners · customer_gst_scrutiny (+ consignee_* mirror) |
| Transactions | store · update |
| Services | ConsigneeKycMirror · SegmentGuard · MasterVisibility · MasterBundleCache |
| Frontend | `SalesCustomers.tsx` (~531 ln) + `AddCustomerModal.tsx` (~5980 ln) + 3 modals |
| FormRequest classes | none (inline validation) |
| Automated tests | none |

---

## 12. EVIDENCE VAULT & DOCUMENT MODEL

### 12.1 Two document stores
| Store | Table | Endpoints | Controller | Purpose |
|---|---|---|---|---|
| **Segment uploads** | `segment_doc_uploads` (polymorphic) | `GET/POST /segment-uploads/{type}/{id}`, `GET /segment-uploads/{type}/{id}/vault` | `SegmentDocUploadController` | Segment-rule compliance docs; **the Evidence Vault** |
| **Ad-hoc KYC** | `customer_documents` (`dd`/`tl`), `customer_owners` | `/customers/{id}/documents`, `/owners` | `CustomerDocument`/`OwnerController` | Free-form docs + owner records; back the edit form + the consignee mirror |

`{type}` ∈ `customer` / `consignee` / `supplier` / `vendor` / `product`.

### 12.2 Vault composition — `SegmentDocUploadController::vault()`
`GET /segment-uploads/{type}/{id}/vault` builds the read model on the server:
1. Resolve the entity's **segment ids** (customers/consignees parse the comma-joined segment string; vendors use an FK).
2. Load `ClmSegmentRule` rows → union each category's `doc_selections` (`M` beats `O` on the same code).
3. Load the master doc lists (`ClmKycDocument` / `ClmDdDocument` / `ClmTradeLicense` / `ClmTradeDocLibrary`) for names/authority/expiry.
4. Load actual `segment_doc_uploads`, keyed `category::doc_code`.
5. Emit one row per required code: `status = upload ? 'Verified' : 'Pending'`.
6. KPIs: `verified_signed`, `pending`, and a **core** count (mandatory DD+KYC+TL only).
7. Build the **shipment matrix** (`buildShipmentAgreements()`) from the entity's leads + `shipment_orders` + `clm_signature_requests`, with per-category coverage ratios and a risk badge. Proforma-invoice rows are prepended on the buyer side.

### 12.3 Trade Documents ↔ Zoho merge
The Trade Documents tab overlays **live** signature status onto the segment-rule base: the SPA fetches `GET /clm/signature-requests?party_id=&model_name=Customer&sync=1` and merges (`mergeTradeDocuments`) so each row shows `Draft`/`Pending`/`Signed`/`Declined`/`Recalled`. `sync=1` polls Zoho for `inprogress` rows and, on completion, pulls the signed PDFs + certificate. A `same_as_customer` consignee query transparently reads the parent customer's requests.

### 12.4 File storage paths
| Store | Path (public disk) |
|---|---|
| Segment uploads | `segment_doc_uploads/{type}/{id}/{category}/{doc_code}/…` |
| Customer documents | `customer_documents/{customerId}/doc-{rand}.{ext}` |
| Owner proofs | `customer_documents/{customerId}/owner-{field}-{rand}.{ext}` |
| Signed PDFs (Zoho) | `uploads/signed_documents/{type}/{id}/…pdf` |

All resolved at read time via the `file_url()` helper (public disk + Azure blob aware).

---

*Related documents: CUSTOMER_FUNCTIONAL_DOCUMENTATION.md · CUSTOMER_CODE_WALKTHROUGH.md · CUSTOMER_API_DOCUMENTATION.md*
