# SUPPLIER MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · P2P → Master Management → Supplier Management

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-10-06 | System | Initial technical documentation |
| 1.1 | 2026-10-07 | System | Added dropdown conditions, pagination, supplier card |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
The Supplier module is the P2P **supplier master**. In code every artefact is named **Vendor** (`VendorController`, `Vendor` model, `vendors` table, `/api/vendors`), while the UI, validation labels and route (`/suppliers`) say "Supplier". A supplier row carries identity, GST/TIN, master classifications, a multi-segment pivot, addresses/contacts, KYC documents, owners, bank accounts, GST scrutiny and product mappings. It is created through a step-wise wizard where each step (and each contact / bank / GST row) is independently saveable.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  Vendors.tsx (list, facets, Domestic/International, pager)            │
│  SupplierScopeGate.tsx → AddVendorModal.tsx (3-step wizard)           │
│  SupplierEvidenceVaultModal.tsx · vendorBundleCache.ts                │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ JSON / multipart (_method=PUT spoofing)
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  VendorController (~2061 lines) — list/show/steps/sub-CRUD/delete      │
│    Vendor::scopeForUser → MasterVisibility (read scope)               │
│    MasterVisibility::hierarchicalDenial → null for Vendor (open edit)  │
│    SupplierCompliance (derived status) · SegmentGuard (segment locks)  │
│    MasterBundleCache · EnforcesUniqueEmail · SegmentDocUploadController│
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL)                       │
│  vendors ─┬─ vendor_addresses (primary + contacts)                    │
│           ├─ vendor_documents (dd / tl) · vendor_owners               │
│           ├─ vendor_bank_accounts · vendor_gst_scrutiny               │
│           ├─ vendor_product_mappings ⇄ product_vendor_maps            │
│           ├─ vendor_segments → clm_segments                           │
│           └─ vendor_currency_locks (written by the PO flow)           │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/VendorController.php   # ~2061 lines
app/Models/Vendor.php                           # + VendorAddress, VendorBankAccount, VendorDocument,
                                                #   VendorOwner, VendorGstScrutiny, VendorProductMapping,
                                                #   VendorCurrencyLock (no separate contact model)
app/Support/{MasterVisibility,SupplierCompliance,SegmentGuard,MasterBundleCache}.php
app/Services/P2p/VendorCurrencyGuard.php        # currency lock logic (PO side)
database/migrations/2026_05_20_100010_create_vendors_tables.php  (+ 12 follow-ups, §3)
resources/js/pages/p2p/p2p-master-management/supplier-management/
  Vendors.tsx (1580) · AddVendorModal.tsx (6459) · SupplierEvidenceVaultModal.tsx (2617)
  SupplierScopeGate.tsx (344) · vendorBundleCache.ts (78) · *.css
resources/js/pages/vendors/Vendors.tsx          # 710 lines, LEGACY — not imported anywhere
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`ilike`, `regexp_replace`, expression unique index) · Sanctum |
| Files | `public` disk, `vendor_documents/{vendorId}/{slug}-{8 hex}__{original}.{ext}` |
| Cache | `Cache::remember` 5 min per user for `/vendors/master-bundle`; `MasterBundleCache::bump()` on write |
| Frontend | React 19 · TS · reactstrap/Bootstrap (Velzon) · lazy-loaded wizard/vault chunks |

---

## 3. DATABASE SCHEMA

### 3.1 `vendors`
`SoftDeletes`. FKs `client_id`, `branch_id`, `created_by` (nullOnDelete).

| Group | Columns |
|---|---|
| Tenancy | client_id, branch_id, created_by |
| Identity | **vendor_code** (32), company_name (255), legal_name, website (500), gst_applicable (`Yes`/`No`), gst_number (TIN for intl), primary_email |
| Classification | vendor_type_id, risk_level_id, **supplier_category** (20, default `general`), vendor_behaviour_id, segment_id (→ clm_segments after consolidation), compliance_behaviour_id, classification_id |
| Integration | zoho_contact_id (added by `2026_07_11_000001_add_zoho_ref_to_purchase_orders`) |
| Lifecycle | **status** (16, default `draft`), **step_completed** (tinyint, default 0) |

Indexes: `status`, `(client_id, branch_id)`, `(client_id, primary_email)`. **Unique `vendors_client_branch_vendor_code_unique` on `(client_id, COALESCE(branch_id,0), vendor_code)`** — non-partial, so soft-deleted codes stay reserved. History: global unique → `(client_id, vendor_code)` (2026-05-20) → per branch (2026-07-15). Prefix history: `V-` → `SUP-` (2026-06-25) → `S-###` (2026-06-30).

> There are **no per-step status columns** — progress is the single `step_completed` value (1, 2 or 4) plus `status`.

### 3.2 Child tables
| Table | Key columns | Notes |
|---|---|---|
| `vendor_addresses` | address_type, address_line, country_id, state_id, state_code, city, pincode, google_location (1000), contact_name (NOT NULL), designation, contact_no, email, whatsapp_enabled (default true), attachment_path, is_primary | No soft deletes; primary row = registered office + primary contact; extras = contacts |
| `vendor_documents` | kind (`dd`/`tl`), code, document_name, license_type_id, license_number, issuing_authority, expiry (string, DD), issue_date/expiry_date (TL), mandatory, attachment_path | SoftDeletes, but replaced by force delete |
| `vendor_owners` | code, document_name, issuing_authority, document_number, issue_date, expiry, status, attachment_path | Owner KYC |
| `vendor_bank_accounts` | bank_name, branch_name, account_number (64), ifsc (16; holds SWIFT for intl), branch_address, cheque_path | |
| `vendor_gst_scrutiny` | gst_number (16), status, last_filing_date, prev_non_gst_2a_invoice, red_flags | |
| `vendor_product_mappings` | product_id, batch_serial_lot, purchase_price, gst_percentage, gst_amount, total_amount (decimal) | Mirrors `product_vendor_maps` |
| `vendor_segments` | vendor_id, segment_id → clm_segments | Unique `(vendor_id, segment_id)` |
| `vendor_currency_locks` | client_id, branch_id, vendor_id, supplier_code, po_ids/po_codes (JSON), currency_code, zoho_synced (`yes`/`no`) | Unique `(client_id, vendor_id)`; `BelongsToTenant` |

All child FKs to `vendors` are `cascadeOnDelete` — effective only on a hard delete.

---

## 4. MODEL (`app/Models/Vendor.php`)

```php
class Vendor extends Model {
    use EnforcesUniqueEmail;                       // scope 'vendor', column primary_email
    use SoftDeletes;
    // relations: client, branch, creator, vendorType, riskLevel, vendorBehaviour, segment,
    //   complianceBehaviour, classification, segments (pivot vendor_segments),
    //   addresses (primary first), primaryAddress (hasOne is_primary), documents, owners,
    //   bankAccounts, gstScrutiny, productMappings
    public function scopeForUser(Builder $q, $user, ?int $branchFilter = null);
}
```
**Email uniqueness:** `config/email_uniqueness.php` scope `vendor` has `tenant => false` — `primary_email` is unique **system-wide** across `vendors` and `p2p_suppliers` (soft-deleted excluded; re-checked on restore). Violations surface as 422 on `primary_email`.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active','tenant'])->group(function () {
    Route::get   ('/vendors',                         [VendorController::class,'index']);
    Route::get   ('/vendors/master-bundle',           [VendorController::class,'masterBundle']);
    Route::get   ('/vendors/{id}',                    [VendorController::class,'show']);
    Route::get   ('/vendors/{id}/product-mappings',   [VendorController::class,'productMappings']);
    Route::post  ('/vendors/step/identity',           [VendorController::class,'storeIdentity']);
    Route::put   ('/vendors/{id}/step/contacts',      [VendorController::class,'storeContacts']);
    Route::post|put|delete ('/vendors/{id}/contacts[/{contact}]',   ...);
    Route::post|put|delete ('/vendors/{id}/bank-accounts[/{bank}]', ...);
    Route::post|put|delete ('/vendors/{id}/gst-scrutiny[/{gst}]',   ...);
    Route::post  ('/vendors/{id}/step/kyc',           [VendorController::class,'storeKyc']);
    Route::post  ('/vendors/{id}/step/products',      [VendorController::class,'storeProducts']);
    Route::delete('/vendors/{id}',                    [VendorController::class,'destroy']);
});   // routes/api.php 184–206; ids constrained with whereNumber()
```
Full detail in **SUPPLIER_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS (`VendorController`)

| Method | Purpose | Notes |
|---|---|---|
| `index` (101) | List + facets; `?light=1` picker | forUser + switcher; compliance derived in bulk |
| `show` (435) | Wizard payload | Embeds segment uploads, segment locks, `state_locked` |
| `storeIdentity` (595) | Create/update step 1 + primary address | GST/TIN rules, segment guards, code under client row lock |
| `storeContacts` (980) | Replace primary contact row | Mirrors `primary_email` |
| `storeContact`/`updateContact`/`destroyContact` | Extra contacts | `is_primary=false` only |
| `store/update/destroyBankAccount` | Bank rows | IFSC vs SWIFT by country; force delete |
| `store/update/destroyGstScrutiny` | GST rows | Unique per client; syncs GSTIN across rows; force delete |
| `storeKyc` (1528) | DD / owners / TL replace-all | `draft → inactive`, step ≥ 2 |
| `storeProducts` (1666) | Mappings replace-all | Mirrors product side; `active`, step 4 |
| `destroy` (566) | Soft delete | Purges files; bumps bundle cache |
| `masterBundle` (2014) | Dropdown masters | `MasterVisibility::applyReadScope`, 5-min cache |

**Authorization:** no permission slug is checked server-side. Every mutator calls `hierarchicalDenial($user, $vendor, 'edit'|'delete')`, which returns `null` for `Vendor` by design ("the module grant is the gate"), so the effective gate is tenant read scope only.

---

## 7. FRONTEND

### 7.1 `Vendors.tsx` — list
Renders only for `branch_user` / `employee`. Server-paged (`page`, `per_page`, `q`, `scope`, `tab`, `categories`, `compliance`) with a stale-response guard. Columns: Sr, Supplier Code, Name, Type, Segment, Country, State, GST State Code, Contact Person, Contact No, Email, Supplier Category, Compliant Status, Mapped Products, Actions. Deep link `?edit=<id>&return=<path>`.

### 7.2 `AddVendorModal.tsx` — wizard
Three UI steps: **Identity & Address** (tabs Identification / Address) → **KYC** (Company DD · Owner KYC · Trade Licence · Bank · GST Scrutiny) → **Map Products**. Also exports `MappedProductsViewPopup`. Pulls `/products?per_page=500&lite=1`, `/clm/segments`, `/clm/segment-rules/for-segment/{id}`, `/clm/trade-doc-library/for-party/supplier`, `/clm/signature-requests`.

### 7.3 Consumers of the vendor master
| Consumer | How |
|---|---|
| Products (`ProductController` vendor maps / `storeVendors`) | `product_vendor_maps` ⇄ `vendor_product_mappings` mirror |
| P2P sourcing (`SourcingController::suppliers`, `MapSupplierModal`) | `GET /p2p/suppliers`, branch-isolated |
| Purchase Orders / Supplier Invoices / Debit Notes | `vendor_id` FK (nullOnDelete); `VendorCurrencyGuard` locks currency |
| Zoho Books (`ZohoBooksService`, `PoZohoService`) | Syncs supplier as a Contact, stores `zoho_contact_id`; overseas → TIN in notes |
| CLM (`ClmSupplierProfileController`, signatures, segment uploads) | Supplier profile, agreements, evidence vault |

---

## 8. SECURITY & CAVEATS
1. **No server-side module permission** — API is open to any authenticated user within read scope; the UI gate is user-type based.
2. **Open edit** — no creator/tier lock for suppliers.
3. **GSTIN state-code prefix check never runs** (reads unset `$data['address']`).
4. **Soft delete leaves children & `product_vendor_maps`**; files are purged so restored rows would have dead paths; no restore endpoint; no PO usage guard.
5. **`storeKyc` unlinks files inside the transaction** — not reversible on rollback.
6. **Email uniqueness is global**, not per tenant.
7. **Legacy page** `resources/js/pages/vendors/Vendors.tsx` is unreferenced dead code (CLAUDE.md still points to it).

---

## 9. METRICS
| Metric | Value |
|---|---|
| VendorController LOC | ~2061 |
| Endpoints | 18 routes |
| Tables | 9 (vendors + 8 child/pivot) |
| Migrations | 13 vendor-specific |
| Permission slug | `p2p.supplier` (frontend menu only) |
| Test coverage | none automated |

---

## 10. SUPPLIER SELECTION IN DROPDOWNS (where & which suppliers appear)

### 10.1 Shared backend rule
Every vendor picker endpoint builds on `Vendor::query()->forUser($user, $branchFilter)`:
- `employee` → `applyBranchScope`: `client_id IS NULL OR (client_id = user.client_id AND (branch_id IS NULL OR branch_id = user.branch_id))`. The switcher is ignored.
- `branch_user` → same as employee. `client_admin`/`client_user` → `client_id IS NULL OR client_id = own`, plus `branch_id = ?` when a switcher branch is sent. `super_admin` → all rows (+ optional `branch_id`).
- `SoftDeletes` global scope → trashed vendors are excluded everywhere.
- **No endpoint filters on `status`, `step_completed`, `supplier_category` or segment.**
- `branch_id` reaches the server only when `api.ts` injects it: on GETs, when `localStorage.cbc_selected_branch_id_{userId}` holds a positive id and the caller didn't pass one. Only endpoints that read `$request->integer('branch_id')` honour it (marked ✓ below).

### 10.2 Endpoint × screen matrix
| Endpoint (controller) | Switcher | Query / sort | Response fields | Consumers |
|---|---|---|---|---|
| `GET /products/master-bundle` → `vendors` (`ProductController::masterBundle`, cached 5 min/user) | ✗ | `forUser`, `orderByDesc('id')`, all rows | id, vendor_code, company_name, website, primary_email, status, vendor_type_name, segment_ids (scalar + pivot), state, primary_address{contact…} | `AddProductModal` supplier select |
| `GET /p2p/suppliers` (`SourcingController::suppliers`) | ✓ | `forUser`, `orderBy('company_name')` | id (string), code, name, segment (scalar), contact/mobile/email (first address = primary), country, region Domestic/International/'' | `MapSupplierModal` |
| `GET /p2p/sourcing-targets/{t}/products/{p}/suppliers` (`mappedSuppliers`) | — | `p2p_sourcing_product_suppliers` of the product, `latest()` | snapshot + `source` Master/New Supplier | `MappedSuppliersModal` |
| `GET /p2p/purchase-orders/suppliers` (`PurchaseOrderController::suppliers`) | ✓ | `forUser`, `orderBy('company_name')` | id, code, name (company ?: legal), document_type (India id → domestic; no country → domestic), supplier_type, supplier_category | `Step1LinkSupplier` (via `po-api.ts`), `CreatePoWizard` |
| `GET /p2p/supplier-purchase-invoices/suppliers` (`SupplierPurchaseInvoiceController::suppliers`) | ✓ | `forUser`, `orderBy('company_name')` | id, code, name, document_type | `MapSupplierPurchaseInvoiceModal`, `SpiDetail` (name → id lookup only; its `pickSupplier` is never called) |
| `GET /vendors?light=1` (`VendorController::index`) | ✓ | `forUser`, `orderBy('company_name')`, **unpaginated** | id, db_id, vendor_code, company_name, country, mobile, primary_email | `ClmCtcForm` counterparty picker; `PaymentRequestDetail` (vault lookup by name) |
| `GET /products/{id}/vendor-maps` (`ProductController::vendorMaps`) | — | `product_vendor_maps WHERE product_id`, `orderBy('id')`; empty for department-hidden (Sales) users | snapshot rows | `VendorMappingsModal` (Sales Matrix Stage 3 / Product Sourcing) |
| `GET /clm/supplier-profile` (`ClmSupplierProfileController::index`) | ✗ | `forUser($user)` (no switcher), `orderBy('id')` | bucketed by vendorType (services / material / logistic) × shipment; scalar `segment_id` only | `ClmSupplierProfilePage` |
| `GET /master/vendor_directory` (`MasterController::list`) | ✓ | `master_vendor_directory` (separate table), `orderByDesc('id')` | directory rows | Assets master "Supplier" field (`masterConfigs.ts` 1229) |

### 10.3 Frontend filters per screen
| Screen (file) | Client-side conditions | Label / value |
|---|---|---|
| `AddProductModal.tsx` | `vendorPickOpts` drops vendors whose id **or** code is already in the product's mapping rows (except the row being edited). Save guard: duplicate → "Already mapped"; product `segmentId` ∉ vendor `segmentIds` (non-empty) → "Segment mismatch". No status filter | value `vendor_code`; label `formatSupplierCode(code): name` + segment badges |
| `MapSupplierModal.tsx` | None. Duplicate rejected server-side (`mapSupplier` 761, 422); `mapSupplier` re-resolves with `forUser()->findOrFail` | value id; label `${code \|\| id} — ${name}`; region badge |
| `Step1LinkSupplier.tsx` | `disabled` when `supplier_category` contains "blacklist" or `supplier_type` ≠ PO type (`draft.poType \|\| OPEN_PO_TYPE`), except the currently picked vendor. Currency options locked via `zohoCurrencySettled` (`VendorCurrencyGuard`), not the supplier list | label `${code} — ${name}` |
| `CreatePoWizard.tsx` | `suppliers.filter(s => s.code)`, sorted by numeric code **desc**; no blacklist/type lock | value code; meta DOM/INT |
| `MapSupplierPurchaseInvoiceModal.tsx` | Sorted by numeric code desc | label `${code} — ${name}` or name |
| `ClmCtcForm.tsx` | `(name+id+email).includes(search)`; category lock `isDomesticCountry(country) === requiredDomestic` once an anchor counterparty exists; supplier tab disabled once used | `toEntry(company_name, country, mobile, primary_email, vendor_code)` |
| `MasterSelect` (shared) | Case-insensitive `label.includes(search)`; renders `OPTION_PAGE = 10`, more on scroll | — |
| `MasterPage.tsx` (Assets) | If `/master/vendor_directory` returns `[]`, falls back to `masterConfigs` seed `data` (2 demo rows) | `vendor_company_name` |

### 10.4 Server guards after picking
- `SourcingController::mapSupplier` → 422 if `(product, vendor)` already mapped.
- `PurchaseOrderController::supplier($id)` → `forUser` + `findOrFail`; returns `mapped_product_ids` (Stage 2 only offers products whose segment or product is mapped to the vendor) and Zoho currency fields; `VendorCurrencyGuard::conflict()` refuses a PO currency other than the settled one.

---

## 11. PAGINATION

### 11.1 `GET /vendors` (list)
- **Server-side**: `$q->paginate((int) $request->query('per_page', 24))` (index line 354). Backend default 24, **no upper cap**; the SPA always sends `per_page`.
- Pipeline order: `forUser` → `q` search → `status` → `scope` → `tab` → **facet snapshot** (`grand_total`, category counts, compliance evaluated over **all** scoped ids) → `categories` / `compliance` filters → `orderByDesc('id')` → paginate → stamp `compliance_status`.
- Response = Laravel `LengthAwarePaginator::toArray()` (`current_page, data, first_page_url, from, last_page, last_page_url, links, next_page_url, path, per_page, prev_page_url, to, total`) + `facets`. The SPA reads only `data`, `total` and `facets`.
- Frontend (`Vendors.tsx`): params `page, per_page, q (debounced 500 ms; clear is immediate), categories, compliance, scope, tab` (`tab` is always `'all'`, which the backend ignores). `rpp` init = `localStorage['cbc.p2p.suppliers.perPage.v2']` if 10–200, else 10. A debounced `window` resize listener computes `fit = max(10, floor(avail / ROW))` while `autoFitRef` is true and re-anchors the page on the first visible row. A manual pick sets `autoFitRef = false` and `page = 1`. `useEffect(() => setPage(1), [tab, debouncedSearch, scopeTab, catParam, compParam])`. A `reqRef` token drops stale responses. Pager = `WorklistPager` with options `[10, 25, 50]`. An auto-fitted size outside those options (e.g. 17) is still sent.
- Note: a code comment at Vendors.tsx 662/1218 still says "client-side pagination (10 rows/page)" — stale.

### 11.2 Other supplier endpoints
| Endpoint | Paging |
|---|---|
| `/vendors?light=1`, `/p2p/suppliers`, `/p2p/purchase-orders/suppliers`, `/p2p/supplier-purchase-invoices/suppliers`, `/products/master-bundle`, `/vendors/master-bundle`, `/vendors/{id}/product-mappings`, `/products/{id}/vendor-maps`, `/clm/supplier-profile` | None — full `->get()` |
| Mapped Products popup (`AddVendorModal` `MAPPED_PAGE_SIZE = 3`), Product wizard supplier grid (`SUP_PAGE_SIZE = 3`) | Client-side slice |

---

## 12. SUPPLIER CARD (list row) — field mapping

`apiToVendor()` (Vendors.tsx ~709) maps each `index` row:

| UI cell | Source → transform | Empty fallback |
|---|---|---|
| Sr No | `start + i + 1`, `start = (curPage-1)*rpp` | — |
| Code | `vendor_code` | `S-${pad3(id)}` |
| Name | `company_name` | `'Untitled Supplier'` |
| Type pill | `vendor_type.name` → `typeKind()`: logist/transport/ffd/freight → logistics (teal), service → services (amber), else material (purple) | `'Pending'` |
| Segment | `segments[]` (pivot) else `segment` → first name + `SegmentBadge(regulatory_status)` + `+N` popover | `—` |
| Country | `primary_address.country.name` | `—` |
| State | `primary_address.state.name` → `state_code` | `—` |
| GST State Code | `primary_address.state_code` (hidden when `scope=international`) | `—` |
| Contact | `addresses` with non-empty `contact_name`, primary first → first; `+N` opens contacts popup | `primary_address.contact_name` → `—` |
| Contact No | `primary_address.contact_no` | `—` |
| Email | `primary_address.email` → `primary_email` | `—` (still `mailto:—`) |
| Category | `supplierCategory()`: star / general / high_risk / blacklisted → `sl-cat--star/general/risk/black` | `—` + tooltip |
| Compliant Status | `compliance_status` (server-stamped, default `Compliant`) → `complianceTone()`: starts with "non" → `sl-compliant--no`, else `--yes` | `—` (unreachable) |
| Mapped Products | `product_mappings_count` (`withCount`) → `>0` button opens `MappedProductsViewPopup`, else flat badge | `0` |
| Actions | Edit Supplier (`setEditingId`), Evidence Vault (`SupplierEvidenceVaultModal`) | Zoho Entry commented out |

**Mapped but never rendered in a cell:** `status` (collapsed to `'Active' \| 'Inactive'`, so draft → Inactive), `legalName`, `designation` (hard-coded `'—'`), `opportunityCount` (always 0). `risk` and `city` only feed the Evidence Vault target. `complianceBehaviour` is still eager-loaded but unused. No avatar or logo on the row.

---

*Related documents: SUPPLIER_FUNCTIONAL_DOCUMENTATION.md · SUPPLIER_CODE_WALKTHROUGH.md · SUPPLIER_API_DOCUMENTATION.md*
