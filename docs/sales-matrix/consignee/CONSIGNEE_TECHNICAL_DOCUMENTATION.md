# CONSIGNEE MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Consignee (ship-to entity, belongs to a Customer)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the Consignee module is
A **Consignee** is a **recipient (ship-to) company** that belongs to a **Customer** (`customer_id`). It is a near-exact **mirror of the Customer entity** — same address/document/owner shape — with three additions: the parent `customer_id` FK, a `consignee_code` (`CN-####`), and a **`same_as_customer`** boolean that turns the record into a live mirror of its customer (identity, addresses and KYC auto-synced). It has **no `type` column and no GST-scrutiny** feature (both are Customer-only).

### 1.2 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                       CONSIGNEE (Sales Matrix)                       │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │            React 19 + TypeScript SPA (Vite)                    │ │
│  │  resources/js/pages/sales/core-masters/consignee/              │ │
│  │  ┌────────────────┐ ┌───────────────────────────────────────┐ │ │
│  │  │ SalesConsignee │ │ AddConsigneeModal                      │ │ │
│  │  │ (list)         │ │  Phase A: pick parent Customer         │ │ │
│  │  └────────────────┘ │  Stage 1 Legal Identity                │ │ │
│  │  ┌────────────────┐ │  Stage 2 KYC / Due Diligence           │ │ │
│  │  │ EvidenceVault  │ │  (Same-as-Customer toggle)             │ │ │
│  │  └────────────────┘ └───────────────────────────────────────┘ │ │
│  │  also reached from Customer → "Map Consignee" (customer locked)│ │
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
│  ConsigneeController ─ index/show/store/update/destroy               │
│                      ─ cloneFromCustomer  (deep-clone KYC)           │
│  ConsigneeDocumentController · ConsigneeOwnerController              │
│  Support: MasterVisibility (scope + hierarchicalDenial) · SegmentGuard│
│  Services: ConsigneeKycMirror  (Customer → Consignee sync)           │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  Consignee ─┬─ belongsTo Customer (customer_id)               │ │
│  │             ├─ hasMany ConsigneeAddress (1 primary)           │ │
│  │             ├─ hasMany ConsigneeDocument (dd/tl)              │ │
│  │             └─ hasMany ConsigneeOwner                         │ │
│  │  segment_doc_uploads (polymorphic, type='consignee')         │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│      PostgreSQL (c_b_c)  ·  attachments on the 'public' disk         │
│  consignees · consignee_addresses · consignee_documents ·           │
│  consignee_owners   (+ segment_doc_uploads · clm_signature_requests)│
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Access model
- All `/consignees*` routes carry `auth:sanctum` + `user.active`.
- Reads scoped via `Consignee::scopeForUser` → `MasterVisibility::applyReadScope`; mutations gated by `MasterVisibility::hierarchicalDenial`.
- **Cross-tenant FK guard:** linking to a customer runs `assertCustomerInScope()` — a `Customer::forUser()->whereKey()` lookup, `404` if the customer isn't visible (no info leak).

### 1.4 Module Structure

```
app/
├── Http/Controllers/Api/
│   ├── ConsigneeController.php          # CRUD + cloneFromCustomer + nextConsigneeCode
│   ├── ConsigneeDocumentController.php  # dd / tl documents (nested)
│   └── ConsigneeOwnerController.php     # owner KYC (nested)
├── Models/
│   ├── Consignee.php                    # mirror of Customer + customer_id/same_as_customer
│   ├── ConsigneeAddress.php
│   ├── ConsigneeDocument.php            # KIND_DD='dd' / KIND_TL='tl'; attachment_url append
│   └── ConsigneeOwner.php               # 3 proof paths + url appends
├── Support/  MasterVisibility.php · SegmentGuard.php · MasterBundleCache.php
└── Services/ ConsigneeKycMirror.php     # resyncForCustomer / syncCoreFromCustomer / resyncOne

database/migrations/
├── 2026_05_20_000010_create_consignees_tables.php   # consignees + consignee_addresses
├── 2026_05_20_000020_create_consignee_kyc_tables.php # consignee_documents + consignee_owners
├── 2026_05_20_000030_*_same_as_customer.php          # same_as_customer + (customer_id,same_as_customer)
├── 2026_06_02_000100_*_widen_segment.php             # segment varchar(64→1024)
└── 2026_06_05_000200_*_per_client_codes.php          # partial unique (client_id, consignee_code)

resources/js/pages/sales/core-masters/consignee/
├── SalesConsignee.tsx                   # list
├── AddConsigneeModal.tsx                # customer-picker + 2-stage wizard + same-as-customer
└── ConsigneeEvidenceVaultModal.tsx      # 5-tab vault (emerald theme)
```

---

## 2. TECHNOLOGY STACK
Identical to the Customer module — PHP 8.2 / Laravel 12 / **PostgreSQL** / Sanctum 4 / public-disk uploads on the backend; React 19 + TS 6 + Vite 7 + reactstrap/Bootstrap/Tailwind + @tanstack/react-table + xlsx + Axios on the frontend. The consignee UI shares `masterFormKit` (MasterSelect/MultiSelect/DatePicker), `WorklistPager`, `DeleteConfirmModal`, and the **`customerBundleCache`** (the master bundle is reused from `/customers/master-bundle`).

---

## 3. DATABASE SCHEMA

### 3.1 Entity Relationship Diagram

```
┌──────────────────────┐  1  ►*  ┌──────────────────────┐  1  ►*  ┌────────────────────────┐
│      customers       │─────────│      consignees      │─────────│  consignee_addresses   │
│  (buyer / §Customer) │ hasMany │  (ship-to mirror)    │ hasMany ├────────────────────────┤
├──────────────────────┤         ├──────────────────────┤         │ consignee_id FK cascade│
│ id            PK      │◄────────│ customer_id  FK       │         │ is_primary (1 true)    │
└──────────────────────┘cascade  │ consignee_code UNIQUE │         │ type/address_line/…    │
                                 │  (CN-####, per client)│         │ cp_name/cp_contact/…   │
                                 │ same_as_customer bool │         └────────────────────────┘
                                 │ company/legal/segment │  1  ►*  ┌────────────────────────┐
                                 │ classification/risk   │─────────│  consignee_documents   │
                                 │ primary_email/status  │ hasMany │ kind dd|tl · dates …   │
                                 │ deleted_at (softdel)  │         └────────────────────────┘
                                 │  (NO type, NO gst)    │  1  ►*  ┌────────────────────────┐
                                 └──────────────────────┘─────────│   consignee_owners     │
                                             │           hasMany  │ owner_name / 3 proofs  │
                                             │                    └────────────────────────┘
                                             └── segment_doc_uploads (polymorphic type='consignee';
                                                 same_as_customer → reads parent customer's rows)
```

### 3.2 Table: `consignees`  *(SoftDeletes; migration `2026_05_20_000010`, `…000030`, `…2026_06_05`)*
| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigint PK | no | auto | |
| client_id / branch_id | bigint FK | yes | — | tenant (nullOnDelete) |
| **customer_id** | bigint FK | no | — | → customers **cascadeOnDelete** (parent) |
| consignee_code | varchar(32) | yes | — | `CN-####`, **partial unique** `(client_id, consignee_code) WHERE deleted_at IS NULL` |
| company_name | varchar(255) | no | — | |
| legal_name | varchar(255) | yes | — | unique per tenant (case-insensitive) unless mirror |
| segment | varchar(1024) | yes | — | comma-separated multi-select (widened 2026-06-02) |
| classification | varchar(64) | yes | — | |
| risk_level | varchar(32) | yes | — | |
| website | varchar(500) | yes | — | |
| primary_email | varchar(255) | yes | — | mirror of primary address `cp_email` |
| status | varchar(16) | no | `Active` | |
| **same_as_customer** | boolean | no | `false` | mirror flag (added `2026_05_20_000030`) |
| created_by | bigint FK | yes | — | → users nullOnDelete |
| created_at / updated_at / deleted_at | timestamp | yes | — | |

**Indexes:** `status`, `classification`, `(client_id, branch_id)`, `(client_id, primary_email)`, `customer_id`, `(customer_id, same_as_customer)`. **No `type`, no `gst_applicable`** (Customer-only).

### 3.3 Table: `consignee_addresses`  *(migration `2026_05_20_000010`)*
Same shape as `customer_addresses`: `id`, `consignee_id` FK (cascade), `type`, `address_line`, `country/state/city`, `pin` (`^\d{6}$`), `cp_name`, `cp_designation`, `cp_contact` (`^\+?[0-9\s-]{7,15}$`), `cp_email`, `cp_whatsapp`, `is_primary` (exactly one true). Indexes `consignee_id`, `(consignee_id, is_primary)`.

### 3.4 Table: `consignee_documents`  *(migration `2026_05_20_000020`)*
`id`, `consignee_id` FK (cascade), `kind` (`dd`/`tl`), `name`, `license_number`, `issuing_authority`, `issue_date`/`expiry_date`, `attachment_path` (`consignee_documents/{id}/…`), `description`, `status`, `created_by`. Indexes `(consignee_id, kind)`, `expiry_date`. Model constants `KIND_DD`/`KIND_TL`; appends `attachment_url`.

### 3.5 Table: `consignee_owners`  *(migration `2026_05_20_000020`)*
`id`, `consignee_id` FK (cascade), `owner_name`, `designation`, `official_email`, `phone_number` (regex), `id_proof_path`/`address_proof_path`/`photograph_path`, `status`, `created_by`. Indexes `consignee_id`, `official_email`. Appends `id_proof_url`/`address_proof_url`/`photograph_url`.

### 3.6 Shared: `segment_doc_uploads` (polymorphic) & `clm_signature_requests`
Consignees use the **same** `segment_doc_uploads` (`uploadable_type = App\Models\Consignee`) and `clm_signature_requests` (`model_name = Consignee`) as Customer — see the Customer technical doc §3.7–3.8. For a `same_as_customer` consignee these resolve to the **parent customer** (§7.2).

> **No `consignee_gst_scrutiny` table exists.** Consignees have no GST-scrutiny feature.

---

## 4. MODEL RELATIONSHIPS

### 4.1 Consignee (`app/Models/Consignee.php`)
```php
class Consignee extends Model {
    use SoftDeletes;
    protected $casts = ['same_as_customer' => 'boolean'];
    // fillable: client_id, branch_id, created_by, customer_id, consignee_code,
    //   company_name, legal_name, segment, classification, risk_level,
    //   website, primary_email, status, same_as_customer   (NO type)

    public function customer()       { return $this->belongsTo(Customer::class); }
    public function addresses()      { return $this->hasMany(ConsigneeAddress::class)
                                          ->orderByDesc('is_primary')->orderBy('id'); }
    public function primaryAddress()  { return $this->hasOne(ConsigneeAddress::class)->where('is_primary', true); }
    public function documents()       { return $this->hasMany(ConsigneeDocument::class)->orderByDesc('id'); }
    public function owners()          { return $this->hasMany(ConsigneeOwner::class)->orderByDesc('id'); }
    public function client() / branch() / creator();

    public function scopeForUser($q, $user, ?int $branchFilter = null) { /* MasterVisibility::applyReadScope */ }
}
```
There is **no** `gstScrutiny()` relation (contrast Customer).

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum', 'user.active'])->group(function () {         // routes/api.php ~177-197
    Route::apiResource('consignees', ConsigneeController::class);
    Route::post('/consignees/{consignee}/clone-from-customer', [ConsigneeController::class, 'cloneFromCustomer']);
    Route::apiResource('consignees.documents', ConsigneeDocumentController::class);
    Route::apiResource('consignees.owners',    ConsigneeOwnerController::class);
    // segment uploads + vault reuse SegmentDocUploadController with type='consignee'
});
```
No dedicated `master-bundle` — the consignee form reuses `GET /customers/master-bundle`. Full request/response detail in **CONSIGNEE_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER METHOD ANALYSIS (`ConsigneeController`)

| Method | Line | Txn | Purpose |
|---|---|---|---|
| `index` | 21 | — | Tenant-scoped list; search on company/legal/code/email/segment; optional `customer_id` filter |
| `show` | 53 | — | Detail — bundles documents, owners, segment uploads, and the parent customer's locations |
| `store` | 169 | ✅ | Create + primary address; `assertCustomerInScope` + `assertSingleMirrorPerCustomer`; allocate `CN-####` under a `clients` row lock |
| `update` | 227 | ✅ | Update + replace addresses; `SegmentGuard` on segment removal; mirror mutex |
| `destroy` | 301 | — | Soft-delete (after `hierarchicalDenial`) |
| `cloneFromCustomer` | 337–435 | ✅ | Deep-clone the customer's Stage-2 KYC (documents + owners + files) into the consignee |
| `nextConsigneeCode` | 732–751 | — | Row-locked `CN-####` (regex `/^CN-0*(\d+)$/`, `withTrashed()`) |
| `validatePayload` | 511–659 | — | Field rules; **uniqueness (legal_name / email / phone) skipped when `same_as_customer`** |
| `assertSingleMirrorPerCustomer` | 690–707 | — | Max one `same_as_customer` per customer (422 on violation) |
| `assertCustomerInScope` | 674–681 | — | Parent-customer visibility guard (404 if not visible) |

Nested `ConsigneeDocumentController` (index 15 / store 42 / update 57 / destroy 80) and `ConsigneeOwnerController` (index 21 / store 35 / update 52 / destroy 72) mirror their Customer counterparts.

---

## 7. CONSIGNEE KYC MIRROR & SAME-AS-CUSTOMER

### 7.1 `ConsigneeKycMirror` (`app/Services/ConsigneeKycMirror.php`)
The sync is **one-directional: Customer → Consignee**, targeting `Consignee::where('customer_id',$id)->where('same_as_customer',true)`.

```php
// syncCoreFromCustomer(Customer, ?actingUserId)   [72–115] — on customer Stage-1 save
//   copies core fields (company/legal/segment/classification/risk/website/primary_email/status)
//   — deliberately SKIPS `type` (consignee has none) —
//   + replaces the consignee's whole address book (primary + locations).

// resyncForCustomer(Customer, ?actingUserId)       [40–55] — on any customer document/owner change
//   for each mirror consignee → resyncOne() [122–190] (own transaction):
//     wipe the consignee's docs/owners + on-disk files, then re-copy the customer's:
//       documents → consignee_documents/{id}/cloned-{hex}.{ext}
//       owner proofs → consignee_documents/{id}/owner-clone-{slot}-{hex}.{ext}
```
Each mirror is a **replace** (exact snapshot) and runs in its own transaction, so one failure doesn't block the rest.

### 7.2 Segment uploads / Evidence Vault pass-through (`SegmentDocUploadController`)
For `type='consignee'`, `resolveOwner()` (≈1200–1238) checks `same_as_customer`:
- **Read** (`GET /segment-uploads/consignee/{id}` and `…/vault`) → owner is **swapped to the parent Customer**; the payload carries `same_as_customer: true`.
- **Write** (`POST /segment-uploads/consignee/{id}`) → **409 Conflict** — *"manage uploads on the linked customer instead."*
- The **shipment matrix** still uses the original consignee id so shipments attribute correctly.

---

## 8. SECURITY IMPLEMENTATION
- `auth:sanctum` + `user.active`; server-side tenant scoping (`Consignee::forUser`) + `hierarchicalDenial` on writes.
- **Parent-customer scope guard** (`assertCustomerInScope`, 404) prevents linking to another tenant's customer.
- **One-mirror mutex** (`assertSingleMirrorPerCustomer`, 422) prevents duplicate mirrors.
- Uploads validated by mime + size (2 MB), stored on the public disk; old files deleted on replace/destroy; `file_url()` resolution.
- GSTIN / GST-scrutiny: **not applicable** (no consignee GST feature).

---

## 9. ERROR HANDLING

| Condition | HTTP | Source |
|---|---|---|
| Not authenticated | 401 | `auth:sanctum` |
| User inactive | 403 | `user.active` |
| Not permitted (edit/delete) | 403 | `hierarchicalDenial` |
| Parent customer not visible | 404 | `assertCustomerInScope` |
| Consignee / doc / owner not found | 404 | route-model binding + `forUser` |
| Second mirror per customer | 422 | `assertSingleMirrorPerCustomer` (`errors.same_as_customer`) |
| Upload to a same-as-customer consignee | 409 | `SegmentDocUploadController::resolveOwner` |
| Validation failure | 422 | `$request->validate()` |

`store`/`update`/`cloneFromCustomer` are transactional. Mirror-service failures during a customer edit are logged, not fatal.

---

## 10. PERFORMANCE

| Optimization | Where |
|---|---|
| Master bundle reused from `/customers/master-bundle` (cached per-user) | shared `customerBundleCache` |
| `show()` bundles documents + owners + segment uploads + parent-customer locations in one call | `ConsigneeController::show` |
| Same-as-customer preview uses the customer's locations already bundled in the edit payload (avoids an extra round-trip) | frontend |
| Row-locked code allocation | `nextConsigneeCode()` |
| Mirror resync runs per-consignee in isolated transactions | `ConsigneeKycMirror` |

---

## 11. CODE QUALITY METRICS

| Metric | Value |
|---|---|
| ConsigneeController LOC | ~750 |
| Nested controllers | ConsigneeDocumentController · ConsigneeOwnerController |
| Consignee tables | consignees · consignee_addresses · consignee_documents · consignee_owners (+ shared segment_doc_uploads / clm_signature_requests) |
| Transactions | store · update · cloneFromCustomer |
| Services | ConsigneeKycMirror · SegmentGuard · MasterVisibility |
| Frontend | `SalesConsignee.tsx` + `AddConsigneeModal.tsx` + `ConsigneeEvidenceVaultModal.tsx` |
| GST scrutiny | **none** (Customer-only) |
| FormRequest classes / tests | none |

---

## 12. CUSTOMER vs CONSIGNEE — QUICK DIFF

| Aspect | Customer | Consignee |
|---|---|---|
| Parent link | — | `customer_id` (required) |
| Code | `C-####` | `CN-####` |
| `type` column | yes | **no** |
| GST scrutiny | yes | **no** |
| Mirror flag | — | `same_as_customer` (max 1/customer) |
| KYC source | self-entered | self-entered **or** cloned/synced from customer |
| Vault | own uploads | own — **or the parent customer's** when `same_as_customer` |
| Sync service | (target of) `ConsigneeKycMirror` | (subject of) `ConsigneeKycMirror` |

---

*Related documents: CONSIGNEE_FUNCTIONAL_DOCUMENTATION.md · CONSIGNEE_CODE_WALKTHROUGH.md · CONSIGNEE_API_DOCUMENTATION.md*
